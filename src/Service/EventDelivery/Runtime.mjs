// @ts-check

/**
 * @namespace Dnd_Gm_Service_EventDelivery_Runtime
 * @description Manages runtime-only tab-level SSE connections and notification delivery.
 */

function nowIso() {
  return new Date().toISOString();
}

function writeNotification(response, payload) {
  response.write(`event: notification\n`);
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function buildNotificationPayload({ type, scope, resourceKind, occurredAt = nowIso(), campaignId, resourceId, campaignEventId, version }) {
  const payload = { type, scope, resourceKind, occurredAt };
  if (campaignId) payload.campaignId = campaignId;
  if (resourceId) payload.resourceId = resourceId;
  if (campaignEventId) payload.campaignEventId = campaignEventId;
  if (version) payload.version = version;
  return payload;
}

export default class Dnd_Gm_Service_EventDelivery_Runtime {
  constructor({ channelRegistry }) {
    this.channelRegistry = channelRegistry;

    this.openStream = function ({ tabIdentityId, localIdentityId, campaignId = "", request, response }) {
      response.statusCode = 200;
      response.setHeader("content-type", "text/event-stream; charset=utf-8");
      response.setHeader("cache-control", "no-store");
      response.setHeader("connection", "keep-alive");
      response.setHeader("x-accel-buffering", "no");
      if (typeof response.flushHeaders === "function") response.flushHeaders();

      const previous = channelRegistry.put({ tabIdentityId, localIdentityId, campaignId, response });
      const cleanup = () => {
        channelRegistry.delete(tabIdentityId);
        if (typeof request.off === "function") request.off("close", cleanup);
        if (typeof response.off === "function") {
          response.off("close", cleanup);
          response.off("error", cleanup);
        }
      };
      if (typeof request.on === "function") request.on("close", cleanup);
      if (typeof response.on === "function") {
        response.on("close", cleanup);
        response.on("error", cleanup);
      }
      if (previous && previous.response && !previous.response.writableEnded) previous.response.end();
      writeNotification(response, { type: "delivery.connected", scope: "user", resourceKind: "identity", occurredAt: nowIso() });
      return channelRegistry.get(tabIdentityId);
    };

    this.rebindContext = function ({ tabIdentityId, campaignId = "", localIdentityId }) {
      const entry = channelRegistry.get(tabIdentityId);
      if (!entry) return null;
      if (entry.localIdentityId !== localIdentityId) throw Object.assign(new Error("Local identity mismatch."), { code: "forbidden" });
      entry.campaignId = campaignId || "";
      return entry;
    };

    this.notifyUser = function ({ localIdentityId, type, resourceKind, resourceId = "", campaignEventId = "", version = "", occurredAt = nowIso() }) {
      const delivered = [];
      for (const entry of channelRegistry.listByLocalIdentity(localIdentityId)) {
        if (!entry.response || entry.response.writableEnded) continue;
        writeNotification(entry.response, buildNotificationPayload({ type, scope: "user", resourceKind, resourceId, campaignEventId, version, occurredAt }));
        delivered.push(entry.tabIdentityId);
      }
      return delivered;
    };

    this.notifyCampaign = function ({ campaignId, localIdentityIds = [], type, resourceKind, resourceId = "", campaignEventId = "", version = "", occurredAt = nowIso() }) {
      const delivered = [];
      for (const entry of channelRegistry.list()) {
        if (!entry.campaignId || entry.campaignId !== campaignId) continue;
        if (!localIdentityIds.includes(entry.localIdentityId)) continue;
        if (!entry.response || entry.response.writableEnded) continue;
        writeNotification(entry.response, buildNotificationPayload({ type, scope: "campaign", campaignId, resourceKind, resourceId, campaignEventId, version, occurredAt }));
        delivered.push(entry.tabIdentityId);
      }
      return delivered;
    };

    this.notifyCampaignDeletion = function ({ campaignId, localIdentityIds = [], occurredAt = nowIso() }) {
      const delivered = [];
      for (const localIdentityId of new Set(localIdentityIds)) {
        delivered.push(...this.notifyUser({ localIdentityId, type: "user.campaign-list.changed", resourceKind: "campaign-list", resourceId: campaignId, occurredAt }));
      }
      return delivered;
    };
  }
}

export const __deps__ = Object.freeze({
  channelRegistry: "Dnd_Gm_Store_Memory_EventDelivery_ChannelRegistry$",
});
