import test from "node:test";
import assert from "node:assert/strict";

import { loadBrowserState, saveBrowserState, STORAGE_KEYS } from "../../../../web/js/browser-state.js";

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
    [STORAGE_KEYS.uuid]: "4d8b6f10-4a8b-48f4-b38c-d5128972e289",
    [STORAGE_KEYS.nickname]: "Alice",
    [STORAGE_KEYS.sessionId]: "session-1",
  });

  assert.deepEqual(loadBrowserState(storage), {
    uuid: "4d8b6f10-4a8b-48f4-b38c-d5128972e289",
    nickname: "Alice",
    sessionId: "session-1",
  });
});

test("loads empty browser state when storage is empty", () => {
  assert.deepEqual(loadBrowserState(makeStorage()), {
    uuid: "",
    nickname: "",
    sessionId: "",
  });
});

test("saves browser state to localStorage", () => {
  const storage = makeStorage();
  saveBrowserState(storage, {
    uuid: "4d8b6f10-4a8b-48f4-b38c-d5128972e289",
    nickname: "Bob",
    sessionId: "session-2",
  });

  assert.equal(storage.values.get(STORAGE_KEYS.uuid), "4d8b6f10-4a8b-48f4-b38c-d5128972e289");
  assert.equal(storage.values.get(STORAGE_KEYS.nickname), "Bob");
  assert.equal(storage.values.get(STORAGE_KEYS.sessionId), "session-2");
});
