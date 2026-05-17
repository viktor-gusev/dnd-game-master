// @ts-check

/**
 * @namespace Dnd_Gm_Service_EventDelivery_Runtime
 * @description Issues stream tokens and manages active SSE transport channels.
 */

const DEFAULT_TOKEN_TTL_MS = 30_000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 1_000;
const CLIENT_INSTANCE_ID_RE = /^[A-Za-z0-9_-]{16,128}$/;

function nowIso(date = new Date()) {
  return date.toISOString();
}

async function createOpaqueToken() {
  const crypto = await import("node:crypto");
  return crypto.randomBytes(24).toString("base64url");
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function makeEnvelope(name, clientInstanceId, payload = {}) {
  return JSON.stringify({
    kind: "control",
    name,
    clientInstanceId,
    emittedAt: nowIso(),
    payload,
  });
}

function emitSse(response, name, clientInstanceId, payload = {}) {
  response.write(`event: ${name}\n`);
  response.write(`data: ${makeEnvelope(name, clientInstanceId, payload)}\n\n`);
}

function makeLogContext({ clientInstanceId, principalRef, expiresAt } = {}) {
  const parts = [];
  if (clientInstanceId) parts.push(`clientInstanceId=${clientInstanceId}`);
  if (principalRef) parts.push(`principalRef=${principalRef}`);
  if (expiresAt) parts.push(`expiresAt=${expiresAt}`);
  return parts.join(" ");
}

export default class Dnd_Gm_Service_EventDelivery_Runtime {
  constructor({ principalResolver, channelRegistry }) {
    if (!principalResolver || typeof principalResolver.resolvePrincipalRef !== "function") {
      throw new Error("Event Delivery principal resolver is required.");
    }

    const tokenTtlMs = parsePositiveInt(process.env.DND_GM_EVENT_DELIVERY_TOKEN_TTL_MS, DEFAULT_TOKEN_TTL_MS);
    const heartbeatIntervalMs = parsePositiveInt(process.env.DND_GM_EVENT_DELIVERY_HEARTBEAT_MS, DEFAULT_HEARTBEAT_INTERVAL_MS);

    this.validateClientInstanceId = function (clientInstanceId) {
      if (typeof clientInstanceId !== "string" || !CLIENT_INSTANCE_ID_RE.test(clientInstanceId)) {
        throw Object.assign(new Error("Invalid client instance id."), { code: "invalid_client_instance_id" });
      }
      return clientInstanceId;
    };

    this.issueToken = async function ({ clientInstanceId, requestContext }) {
      const validatedClientInstanceId = this.validateClientInstanceId(clientInstanceId);
      const principalRef = await principalResolver.resolvePrincipalRef(requestContext);
      if (typeof principalRef !== "string" || !principalRef.trim()) {
        throw Object.assign(new Error("Unable to resolve principal ref."), { code: "principal_unresolved" });
      }
      const streamToken = await createOpaqueToken();
      const expiresAt = new Date(Date.now() + tokenTtlMs).toISOString();
      channelRegistry.saveToken({ token: streamToken, clientInstanceId: validatedClientInstanceId, principalRef, expiresAt });
      console.info(`[event-delivery] issued stream token ${makeLogContext({ clientInstanceId: validatedClientInstanceId, principalRef, expiresAt })}`);
      return { streamToken, expiresAt, clientInstanceId: validatedClientInstanceId, principalRef };
    };

    this.validateToken = function (streamToken) {
      if (typeof streamToken !== "string" || !streamToken.trim()) {
        throw Object.assign(new Error("Missing stream token."), { code: "missing_token" });
      }
      const tokenRecord = channelRegistry.readToken(streamToken);
      if (!tokenRecord) throw Object.assign(new Error("Invalid stream token."), { code: "invalid_token" });
      if (Date.parse(tokenRecord.expiresAt) <= Date.now()) {
        channelRegistry.deleteToken(streamToken);
        throw Object.assign(new Error("Expired stream token."), { code: "expired_token" });
      }
      return tokenRecord;
    };

    this.openStream = function ({ streamToken, request, response }) {
      const tokenRecord = this.validateToken(streamToken);
      const { clientInstanceId, principalRef } = tokenRecord;

      /** @type {NodeJS.Timeout|undefined} */
      let heartbeatTimer;
      /** @type {(() => void)|undefined} */
      let cleanup;

      const handle = {
        key: `${clientInstanceId}::${principalRef}`,
        clientInstanceId,
        principalRef,
        response,
        close: () => {
          if (cleanup) cleanup();
          if (!response.writableEnded) response.end();
        },
      };

      const previous = channelRegistry.activateChannel({ clientInstanceId, principalRef, handle });

      response.statusCode = 200;
      response.setHeader("content-type", "text/event-stream; charset=utf-8");
      response.setHeader("cache-control", "no-store");
      response.setHeader("connection", "keep-alive");
      response.setHeader("x-accel-buffering", "no");
      if (typeof response.flushHeaders === "function") response.flushHeaders();

      cleanup = () => {
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        heartbeatTimer = undefined;
        channelRegistry.releaseChannel(handle);
        console.info(`[event-delivery] closed stream ${makeLogContext({ clientInstanceId, principalRef })}`);
        if (typeof request.off === "function") request.off("close", cleanup);
        if (typeof response.off === "function") {
          response.off("close", cleanup);
          response.off("error", cleanup);
        }
        cleanup = undefined;
      };

      if (typeof request.on === "function") request.on("close", cleanup);
      if (typeof response.on === "function") {
        response.on("close", cleanup);
        response.on("error", cleanup);
      }

      if (previous && previous !== handle) {
        console.info(`[event-delivery] superseded previous stream ${makeLogContext({ clientInstanceId, principalRef })}`);
        previous.close();
      }

      console.info(`[event-delivery] opened stream ${makeLogContext({ clientInstanceId, principalRef })}`);

      emitSse(response, "delivery.connected", clientInstanceId, {});
      heartbeatTimer = setInterval(() => {
        if (response.writableEnded) return;
        emitSse(response, "delivery.heartbeat", clientInstanceId, {});
      }, heartbeatIntervalMs);

      return { clientInstanceId, principalRef };
    };
  }
}

export const __deps__ = Object.freeze({
  principalResolver: "Dnd_Gm_Service_EventDelivery_PrincipalResolver$",
  channelRegistry: "Dnd_Gm_Store_Memory_EventDelivery_ChannelRegistry$",
});
