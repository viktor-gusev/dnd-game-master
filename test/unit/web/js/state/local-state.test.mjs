import test from "node:test";
import assert from "node:assert/strict";

import {
  STORAGE_KEYS,
  createDefaultNickname,
  createLocalIdentityUuid,
  ensureLocalIdentity,
  loadLocalState,
  saveLocalIdentity,
  saveSessionId,
} from "../../../../../web/js/state/local-state.js";

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
  assert.deepEqual(loadLocalState(makeStorage()), { uuid: "", nickname: "", sessionId: "" });
});

test("loads persisted local state", () => {
  const storage = makeStorage({
    [STORAGE_KEYS.uuid]: "4d8b6f10-4a8b-48f4-b38c-d5128972e289",
    [STORAGE_KEYS.nickname]: "Alice",
    [STORAGE_KEYS.sessionId]: "sess-456",
  });
  assert.deepEqual(loadLocalState(storage), {
    uuid: "4d8b6f10-4a8b-48f4-b38c-d5128972e289",
    nickname: "Alice",
    sessionId: "sess-456",
  });
});

test("saves local identity and session id", () => {
  const storage = makeStorage();
  saveLocalIdentity({ uuid: "4d8b6f10-4a8b-48f4-b38c-d5128972e289", nickname: "Alice" }, storage);
  saveSessionId("sess-456", storage);
  assert.deepEqual(storage.data, {
    [STORAGE_KEYS.uuid]: "4d8b6f10-4a8b-48f4-b38c-d5128972e289",
    [STORAGE_KEYS.nickname]: "Alice",
    [STORAGE_KEYS.sessionId]: "sess-456",
  });
});

test("ensureLocalIdentity creates and persists a browser-local identity when missing", () => {
  const storage = makeStorage();
  const cryptoApi = {
    randomUUID() {
      return "4d8b6f10-4a8b-48f4-b38c-d5128972e289";
    },
  };

  const identity = ensureLocalIdentity(storage, cryptoApi);

  assert.deepEqual(identity, {
    uuid: "4d8b6f10-4a8b-48f4-b38c-d5128972e289",
    nickname: "Adventurer-4d8b6f",
    sessionId: "",
  });
  assert.equal(storage.data[STORAGE_KEYS.uuid], identity.uuid);
  assert.equal(storage.data[STORAGE_KEYS.nickname], identity.nickname);
});

test("ensureLocalIdentity reuses a stored identity", () => {
  const storage = makeStorage({
    [STORAGE_KEYS.uuid]: "4d8b6f10-4a8b-48f4-b38c-d5128972e289",
    [STORAGE_KEYS.nickname]: "Alice",
  });
  assert.deepEqual(ensureLocalIdentity(storage), {
    uuid: "4d8b6f10-4a8b-48f4-b38c-d5128972e289",
    nickname: "Alice",
    sessionId: "",
  });
});

test("default nickname and uuid helpers provide browser-local identity values", () => {
  assert.equal(createDefaultNickname("4d8b6f10-4a8b-48f4-b38c-d5128972e289"), "Adventurer-4d8b6f");
  assert.match(createLocalIdentityUuid({ randomUUID: () => "4d8b6f10-4a8b-48f4-b38c-d5128972e289" }), /^[0-9a-f-]{36}$/);
});
