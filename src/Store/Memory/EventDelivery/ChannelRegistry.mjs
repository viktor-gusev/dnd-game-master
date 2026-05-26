// @ts-check

/**
 * @namespace Dnd_Gm_Store_Memory_EventDelivery_ChannelRegistry
 * @description Runtime-only storage for tab-level SSE connections.
 */

export default class Dnd_Gm_Store_Memory_EventDelivery_ChannelRegistry {
  constructor() {
    const entriesByTab = new Map();
    const tabsByLocalIdentity = new Map();

    const removeFromIndex = (entry) => {
      const tabs = tabsByLocalIdentity.get(entry.localIdentityId);
      if (!tabs) return;
      tabs.delete(entry.tabIdentityId);
      if (tabs.size === 0) tabsByLocalIdentity.delete(entry.localIdentityId);
    };

    this.put = function ({ tabIdentityId, localIdentityId, campaignId = "", response }) {
      const previous = entriesByTab.get(tabIdentityId) || null;
      if (previous) {
        removeFromIndex(previous);
        if (previous.response && previous.response !== response && !previous.response.writableEnded) previous.response.end();
      }
      const entry = { tabIdentityId, localIdentityId, campaignId: campaignId || "", response, createdAt: new Date().toISOString() };
      entriesByTab.set(tabIdentityId, entry);
      const tabs = tabsByLocalIdentity.get(localIdentityId) || new Set();
      tabs.add(tabIdentityId);
      tabsByLocalIdentity.set(localIdentityId, tabs);
      return previous;
    };

    this.updateContext = function (tabIdentityId, campaignId = "") {
      const entry = entriesByTab.get(tabIdentityId) || null;
      if (!entry) return null;
      entry.campaignId = campaignId || "";
      return entry;
    };

    this.delete = function (tabIdentityId) {
      const entry = entriesByTab.get(tabIdentityId) || null;
      if (!entry) return null;
      entriesByTab.delete(tabIdentityId);
      removeFromIndex(entry);
      return entry;
    };

    this.get = function (tabIdentityId) {
      return entriesByTab.get(tabIdentityId) || null;
    };

    this.listByLocalIdentity = function (localIdentityId) {
      const tabs = tabsByLocalIdentity.get(localIdentityId);
      if (!tabs) return [];
      return Array.from(tabs).map((tabIdentityId) => entriesByTab.get(tabIdentityId)).filter(Boolean);
    };

    this.list = function () {
      return Array.from(entriesByTab.values());
    };
  }
}
