// @ts-check

/**
 * @namespace Dnd_Gm_Web_Handler_Api
 * @description HTTP API handler for the application.
 */

function json(res, status, body) {
  if (!res.writableEnded) {
    res.statusCode = status;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify(body));
  }
}

function jsonNoStore(res, status, body) {
  if (!res.writableEnded) {
    res.setHeader("cache-control", "no-store");
    res.setHeader("pragma", "no-cache");
    json(res, status, body);
  }
}

function error(code, message) {
  return { ok: false, error: { code, message } };
}

function success(data) {
  return { ok: true, data };
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw Object.assign(new Error("Invalid JSON body."), { code: "invalid_json" });
  }
}

function logEventDeliveryFailure(req, err) {
  const url = new URL(req.url, "http://localhost");
  const tokenHint = url.pathname === "/api/event-delivery/stream" ? (url.searchParams.get("token") ? "present" : "missing") : undefined;
  const details = [
    `method=${req.method || "GET"}`,
    `path=${url.pathname}`,
    `errorCode=${err?.code || "internal_error"}`,
  ];
  if (req.headers?.["x-local-identity-id"]) details.push(`identityId=${req.headers["x-local-identity-id"]}`);
  if (tokenHint) details.push(`token=${tokenHint}`);
  console.warn(`[event-delivery] request failed ${details.join(" ")}`, err?.message ? `message=${err.message}` : "");
}

function findParticipantOrThrow(current, identityId) {
  if (!current.participants.some((participant) => participant.identityId === identityId)) {
    throw Object.assign(new Error("Identity is not a session participant."), { code: "invalid_input" });
  }
}

export default class Dnd_Gm_Web_Handler_Api {
  constructor({ dataStore, eventDelivery }) {
    this.dataStore = dataStore;
    this.eventDelivery = eventDelivery;
    this.getRegistrationInfo = () => ({ name: this.constructor.name, stage: "PROCESS" });

    this.resolveIdentityFromHeader = async (req) => {
      const identityId = req.headers["x-local-identity-id"];
      if (!identityId) throw Object.assign(new Error("Missing local identity id."), { code: "missing_identity" });
      const identity = await this.dataStore.getIdentity(identityId);
      if (!identity) throw Object.assign(new Error("Unknown local identity id."), { code: "unknown_identity" });
      return identity;
    };

    this.postLocalIdentity = async (req, res, context) => {
      const body = await readBody(req);
      const identity = await this.dataStore.upsertIdentity(body.uuid, body.nickname);
      context.complete();
      json(res, 200, success({ identity }));
    };

    this.getCurrentIdentity = async (req, res, context) => {
      const identity = await this.resolveIdentityFromHeader(req);
      context.complete();
      json(res, 200, success({ identity }));
    };

    this.listSessions = async (req, res, context) => {
      const identityId = req.headers["x-local-identity-id"] || "";
      if (identityId) await this.resolveIdentityFromHeader(req);
      const sessions = await this.dataStore.listSessions(identityId);
      context.complete();
      json(res, 200, success({ sessions }));
    };

    this.createSession = async (req, res, context) => {
      const identity = await this.resolveIdentityFromHeader(req);
      const body = await readBody(req);
      const current = await this.dataStore.createSession(identity, { title: body.title });
      context.complete();
      json(res, 200, success({ sessionId: current.session.sessionId, session: current.session }));
    };

    this.getSession = async (sessionId, req, res, context) => {
      const identity = await this.resolveIdentityFromHeader(req);
      const current = await this.dataStore.loadSession(sessionId, identity.id);
      if (!current) throw Object.assign(new Error("Unknown session id."), { code: "unknown_session" });
      findParticipantOrThrow(current, identity.id);
      context.complete();
      json(res, 200, success({ session: current.session, participants: current.participants }));
    };

    this.joinSession = async (sessionId, req, res, context) => {
      const identity = await this.resolveIdentityFromHeader(req);
      const current = await this.dataStore.joinSession(sessionId, identity);
      if (!current) throw Object.assign(new Error("Unknown session id."), { code: "unknown_session" });
      context.complete();
      json(res, 200, success({ sessionId: current.session.sessionId, joined: true, session: current.session }));
    };

    this.deleteSession = async (sessionId, req, res, context) => {
      const identity = await this.resolveIdentityFromHeader(req);
      const current = await this.dataStore.loadSession(sessionId, identity.id);
      if (!current) throw Object.assign(new Error("Unknown session id."), { code: "unknown_session" });
      if (current.session.gm?.uuid !== identity.id) {
        throw Object.assign(new Error("Only the Game Master may delete this session."), { code: "forbidden" });
      }
      const deleted = await this.dataStore.deleteSession(sessionId);
      if (!deleted) throw Object.assign(new Error("Unknown session id."), { code: "unknown_session" });
      context.complete();
      json(res, 200, success({ sessionId, deleted: true }));
    };

    this.postMessage = async (sessionId, req, res, context) => {
      const crypto = await import("node:crypto");
      const identity = await this.resolveIdentityFromHeader(req);
      const current = await this.dataStore.loadSession(sessionId, identity.id);
      if (!current) throw Object.assign(new Error("Unknown session id."), { code: "unknown_session" });
      findParticipantOrThrow(current, identity.id);

      const body = await readBody(req);
      if (!body.text || !String(body.text).trim()) {
        throw Object.assign(new Error("Message text is required."), { code: "invalid_input" });
      }

      const message = {
        id: `msg_${crypto.randomBytes(6).toString("hex")}`,
        sessionId,
        identityId: identity.id,
        nickname: identity.nickname,
        displayName: identity.nickname,
        type: body.type || "player_action",
        text: String(body.text).trim(),
        createdAt: new Date().toISOString(),
      };

      await this.dataStore.appendMessage(sessionId, message);
      try {
        this.eventDelivery.emitExtensionFrame({
          name: "session.messages.changed",
          principalRefs: current.participants.map((participant) => participant.identityId),
          payload: {
            sessionId,
            reason: "message_appended",
            messageId: message.id,
          },
        });
      } catch (notifyError) {
        console.warn(`[event-delivery] message notification failed sessionId=${sessionId}`, notifyError?.message || notifyError);
      }

      context.complete();
      json(res, 200, success({ message }));
    };

    this.getMessages = async (sessionId, req, res, context) => {
      const identity = await this.resolveIdentityFromHeader(req);
      const current = await this.dataStore.loadSession(sessionId, identity.id);
      if (!current) throw Object.assign(new Error("Unknown session id."), { code: "unknown_session" });
      findParticipantOrThrow(current, identity.id);
      context.complete();
      json(res, 200, success({ messages: current.messages }));
    };

    this.postEventDeliveryToken = async (req, res, context) => {
      res.setHeader("cache-control", "no-store");
      res.setHeader("pragma", "no-cache");
      const body = await readBody(req);
      if ("principalRef" in body) throw Object.assign(new Error("principalRef is not accepted."), { code: "invalid_input" });
      const token = await this.eventDelivery.issueToken({
        clientInstanceId: body.clientInstanceId,
        requestContext: context,
      });
      context.complete();
      jsonNoStore(res, 200, success({ streamToken: token.streamToken, expiresAt: token.expiresAt }));
    };

    this.getEventDeliveryStream = async (req, res, context) => {
      res.setHeader("cache-control", "no-store");
      res.setHeader("pragma", "no-cache");
      const url = new URL(req.url, "http://localhost");
      this.eventDelivery.openStream({
        streamToken: url.searchParams.get("token"),
        request: req,
        response: res,
      });
      context.complete();
    };

    this.handle = async (context) => {
      const req = context.request;
      const res = context.response;
      const url = new URL(req.url, "http://localhost");
      const method = req.method || "GET";
      try {
        if (url.pathname === "/api/identity/local" && method === "POST") return await this.postLocalIdentity(req, res, context);
        if (url.pathname === "/api/identity/current" && method === "GET") return await this.getCurrentIdentity(req, res, context);
        if (url.pathname === "/api/event-delivery/token" && method === "POST") return await this.postEventDeliveryToken(req, res, context);
        if (url.pathname === "/api/event-delivery/stream" && method === "GET") return await this.getEventDeliveryStream(req, res, context);
        if (url.pathname === "/api/sessions" && method === "GET") return await this.listSessions(req, res, context);
        if (url.pathname === "/api/sessions" && method === "POST") return await this.createSession(req, res, context);

        const sessionMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)(?:\/(join|messages))?$/);
        if (sessionMatch) {
          const sessionId = sessionMatch[1];
          const action = sessionMatch[2] || null;
          if (action === null && method === "GET") return await this.getSession(sessionId, req, res, context);
          if (action === null && method === "DELETE") return await this.deleteSession(sessionId, req, res, context);
          if (action === "join" && method === "POST") return await this.joinSession(sessionId, req, res, context);
          if (action === "messages" && method === "POST") return await this.postMessage(sessionId, req, res, context);
          if (action === "messages" && method === "GET") return await this.getMessages(sessionId, req, res, context);
        }

        if (url.pathname.startsWith("/api/")) {
          context.complete();
          return json(res, 404, error("not_found", "Not found."));
        }
        return;
      } catch (err) {
        if (url.pathname.startsWith("/api/event-delivery/")) logEventDeliveryFailure(req, err);
        if (err?.code === "invalid_json") return json(res, 400, error("invalid_json", "Invalid JSON body."));
        if (err?.code === "invalid_session_id") return json(res, 400, error("invalid_session_id", "Invalid session id."));
        if (err?.code === "invalid_client_instance_id") return json(res, 400, error("invalid_client_instance_id", "Invalid client instance id."));
        if (err?.code === "invalid_input") return json(res, 400, error("invalid_input", err.message));
        if (err?.code === "missing_identity") return json(res, 400, error("missing_identity", "Missing local identity id."));
        if (err?.code === "unknown_identity") return json(res, 400, error("unknown_identity", "Unknown local identity id."));
        if (err?.code === "forbidden") return json(res, 403, error("forbidden", err.message || "Forbidden."));
        if (err?.code === "principal_unresolved") return json(res, 400, error("principal_unresolved", "Unable to resolve principal ref."));
        if (err?.code === "missing_token") return json(res, 400, error("missing_token", "Missing stream token."));
        if (err?.code === "invalid_token") return json(res, 401, error("invalid_token", "Invalid stream token."));
        if (err?.code === "expired_token") return json(res, 401, error("expired_token", "Expired stream token."));
        if (err?.code === "security_conflict") return json(res, 409, error("security_conflict", "Client instance is already bound to another principal."));
        if (err?.code === "unknown_session") return json(res, 404, error("unknown_session", "Unknown session id."));
        return json(res, 500, error("internal_error", "Internal server error."));
      }
    };
  }
}

export const __deps__ = Object.freeze({
  dataStore: "Dnd_Gm_Store_File_Data$",
  eventDelivery: "Dnd_Gm_Service_EventDelivery_Runtime$",
});
