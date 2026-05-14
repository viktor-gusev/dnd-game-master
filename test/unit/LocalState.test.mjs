import test from "node:test";
import assert from "node:assert/strict";

import { loadLocalState, saveDisplayName, saveIdentityId, saveSessionId } from "../../web/js/state/local-state.js";

function makeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
    get data() {
      return Object.fromEntries(data.entries());
    },
  };
}

test("loads empty local state when storage is empty", () => {
  assert.deepEqual(loadLocalState(makeStorage()), { displayName: "", identityId: "", sessionId: "" });
});

test("loads persisted local state", () => {
  const storage = makeStorage({
    "dnd-gm.displayName": "Alice",
    "dnd-gm.identityId": "id-123",
    "dnd-gm.sessionId": "sess-456",
  });
  assert.deepEqual(loadLocalState(storage), { displayName: "Alice", identityId: "id-123", sessionId: "sess-456" });
});

test("saves display name, identity id, and session id", () => {
  const storage = makeStorage();
  saveDisplayName("Alice", storage);
  saveIdentityId("id-123", storage);
  saveSessionId("sess-456", storage);
  assert.deepEqual(storage.data, {
    "dnd-gm.displayName": "Alice",
    "dnd-gm.identityId": "id-123",
    "dnd-gm.sessionId": "sess-456",
  });
});
