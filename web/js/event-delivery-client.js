const TAB_KEY = "dnd-gm.eventDelivery.tabIdentityId";

function randomId(cryptoApi = globalThis.crypto) {
  if (typeof cryptoApi?.randomUUID === "function") return cryptoApi.randomUUID();
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

export function getOrCreateTabIdentityId(storage = globalThis.sessionStorage, cryptoApi = globalThis.crypto) {
  if (!storage) return "";
  const existing = storage.getItem(TAB_KEY);
  if (existing) return existing;
  const created = randomId(cryptoApi);
  storage.setItem(TAB_KEY, created);
  return created;
}

export function createEventDeliveryClient({ fetchImpl = globalThis.fetch, eventSourceFactory = (url) => { if (typeof EventSource !== "function") return null; return new EventSource(url); }, tabIdentityId, localIdentityId, campaignId = "", onNotification = () => {}, onStateChange = () => {} }) {
  let source = null;
  const connect = () => {
    if (!tabIdentityId || !localIdentityId) return;
    onStateChange("connecting");
    source = eventSourceFactory(`/api/event-delivery?tabIdentityId=${encodeURIComponent(tabIdentityId)}&localIdentityId=${encodeURIComponent(localIdentityId)}${campaignId ? `&campaignId=${encodeURIComponent(campaignId)}` : ""}`);
    if (!source) { onStateChange("unavailable"); return; }
    source.onmessage = (event) => {
      try { onNotification(JSON.parse(event.data)); } catch {}
    };
    source.onerror = () => onStateChange("reconnecting");
    source.onopen = () => onStateChange("connected");
  };
  return {
    connect,
    updateCampaignContext: async (nextCampaignId) => {
      campaignId = nextCampaignId || "";
      await fetchImpl("/api/event-delivery/context", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-local-identity-id": localIdentityId,
        },
        body: JSON.stringify({ tabIdentityId, campaignId: campaignId || null }),
      });
    },
    close() { if (source) source.close(); source = null; onStateChange("closed"); },
    getTabIdentityId() { return tabIdentityId; },
  };
}
