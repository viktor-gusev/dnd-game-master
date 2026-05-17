// @ts-check

/**
 * @namespace Dnd_Gm_Store_Memory_EventDelivery_ChannelRegistry
 * @description Runtime-only storage for stream tokens and active event delivery channels.
 */

function makeChannelKey(clientInstanceId, principalRef) {
  return `${clientInstanceId}::${principalRef}`;
}

export default class Dnd_Gm_Store_Memory_EventDelivery_ChannelRegistry {
  constructor() {
    const tokens = new Map();
    const channelsByKey = new Map();
    const channelsByClient = new Map();

    this.saveToken = function ({ token, clientInstanceId, principalRef, expiresAt }) {
      tokens.set(token, { token, clientInstanceId, principalRef, expiresAt });
    };

    this.readToken = function (token) {
      return tokens.get(token) || null;
    };

    this.deleteToken = function (token) {
      tokens.delete(token);
    };

    this.activateChannel = function ({ clientInstanceId, principalRef, handle }) {
      const activeByClient = channelsByClient.get(clientInstanceId) || null;
      if (activeByClient && activeByClient.principalRef !== principalRef) {
        throw Object.assign(new Error("Client instance is already bound to another principal."), { code: "security_conflict" });
      }

      const key = makeChannelKey(clientInstanceId, principalRef);
      const previous = channelsByKey.get(key) || null;
      channelsByKey.set(key, handle);
      channelsByClient.set(clientInstanceId, { principalRef, key, handle });
      return previous;
    };

    this.releaseChannel = function (handle) {
      if (!handle?.key) return;
      if (channelsByKey.get(handle.key) === handle) channelsByKey.delete(handle.key);
      const activeByClient = channelsByClient.get(handle.clientInstanceId);
      if (activeByClient?.handle === handle) channelsByClient.delete(handle.clientInstanceId);
    };

    this.countActiveChannels = function () {
      return channelsByKey.size;
    };

    this.findActiveChannel = function (clientInstanceId, principalRef) {
      return channelsByKey.get(makeChannelKey(clientInstanceId, principalRef)) || null;
    };
  }
}
