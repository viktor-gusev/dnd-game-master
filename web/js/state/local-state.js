export const STORAGE_KEYS = {
  uuid: "dnd-gm.identity.uuid",
  nickname: "dnd-gm.identity.nickname",
  sessionId: "dnd-gm.sessionId",
};

function fallbackUuid() {
  const template = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx";
  return template.replace(/[xy]/g, (char) => {
    const random = Math.floor(Math.random() * 16);
    const value = char === "x" ? random : ((random & 0x3) | 0x8);
    return value.toString(16);
  });
}

export function createLocalIdentityUuid(cryptoApi = globalThis.crypto) {
  if (typeof cryptoApi?.randomUUID === "function") return cryptoApi.randomUUID();
  return fallbackUuid();
}

export function createDefaultNickname(uuid) {
  const suffix = String(uuid || "").replace(/-/g, "").slice(0, 6) || "guest";
  return `Adventurer-${suffix}`;
}

export function loadLocalState(storage = globalThis.localStorage) {
  return {
    uuid: storage?.getItem(STORAGE_KEYS.uuid) || "",
    nickname: storage?.getItem(STORAGE_KEYS.nickname) || "",
    sessionId: storage?.getItem(STORAGE_KEYS.sessionId) || "",
  };
}

export function saveLocalIdentity(identity, storage = globalThis.localStorage) {
  if (!storage) return;
  storage.setItem(STORAGE_KEYS.uuid, identity?.uuid || "");
  storage.setItem(STORAGE_KEYS.nickname, identity?.nickname || "");
}

export function saveSessionId(sessionId, storage = globalThis.localStorage) {
  if (!storage) return;
  storage.setItem(STORAGE_KEYS.sessionId, sessionId || "");
}

export function ensureLocalIdentity(storage = globalThis.localStorage, cryptoApi = globalThis.crypto) {
  const current = loadLocalState(storage);
  if (current.uuid && current.nickname) return current;
  const uuid = current.uuid || createLocalIdentityUuid(cryptoApi);
  const nickname = current.nickname || createDefaultNickname(uuid);
  const identity = { uuid, nickname, sessionId: current.sessionId };
  saveLocalIdentity(identity, storage);
  return identity;
}
