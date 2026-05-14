import test from "node:test";
import assert from "node:assert/strict";

import { loadBrowserState, saveBrowserState, STORAGE_KEYS } from "../../web/js/browser-state.js";

function makeStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    values,
  };
}

test("loads browser state from localStorage", () => {
  const storage = makeStorage({
    [STORAGE_KEYS.displayName]: "Alice",
    [STORAGE_KEYS.identityId]: "identity-1",
    [STORAGE_KEYS.sessionId]: "session-1",
  });

  assert.deepEqual(loadBrowserState(storage), {
    displayName: "Alice",
    identityId: "identity-1",
    sessionId: "session-1",
  });
});

test("loads empty browser state when storage is empty", () => {
  assert.deepEqual(loadBrowserState(makeStorage()), {
    displayName: "",
    identityId: "",
    sessionId: "",
  });
});

test("saves browser state to localStorage", () => {
  const storage = makeStorage();
  saveBrowserState(storage, {
    displayName: "Bob",
    identityId: "identity-2",
    sessionId: "session-2",
  });

  assert.equal(storage.values.get(STORAGE_KEYS.displayName), "Bob");
  assert.equal(storage.values.get(STORAGE_KEYS.identityId), "identity-2");
  assert.equal(storage.values.get(STORAGE_KEYS.sessionId), "session-2");
});
