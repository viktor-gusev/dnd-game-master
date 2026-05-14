export const STORAGE_KEYS = {
  displayName: "dnd-gm.displayName",
  identityId: "dnd-gm.identityId",
  sessionId: "dnd-gm.sessionId",
};

export function loadBrowserState(storage) {
  return {
    displayName: storage.getItem(STORAGE_KEYS.displayName) || "",
    identityId: storage.getItem(STORAGE_KEYS.identityId) || "",
    sessionId: storage.getItem(STORAGE_KEYS.sessionId) || "",
  };
}

export function saveBrowserState(storage, state) {
  storage.setItem(STORAGE_KEYS.displayName, state.displayName || "");
  storage.setItem(STORAGE_KEYS.identityId, state.identityId || "");
  storage.setItem(STORAGE_KEYS.sessionId, state.sessionId || "");
}
