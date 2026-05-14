const KEYS = {
  displayName: "dnd-gm.displayName",
  identityId: "dnd-gm.identityId",
  sessionId: "dnd-gm.sessionId",
};

export function loadLocalState(storage = localStorage) {
  return {
    displayName: storage.getItem(KEYS.displayName) || "",
    identityId: storage.getItem(KEYS.identityId) || "",
    sessionId: storage.getItem(KEYS.sessionId) || "",
  };
}

export function saveDisplayName(displayName, storage = localStorage) {
  storage.setItem(KEYS.displayName, displayName);
}

export function saveIdentityId(identityId, storage = localStorage) {
  storage.setItem(KEYS.identityId, identityId);
}

export function saveSessionId(sessionId, storage = localStorage) {
  storage.setItem(KEYS.sessionId, sessionId);
}
