import test from "node:test";
import assert from "node:assert/strict";

import { STORAGE_KEYS, createDefaultNickname, createLocalIdentityUuid, ensureLocalIdentity, loadLocalState, saveCampaignId, saveLocalIdentity } from "../../../../../web/js/state/local-state.js";

function makeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem(key) { return data.has(key) ? data.get(key) : null; }, setItem(key, value) { data.set(key, String(value)); }, get data() { return Object.fromEntries(data.entries()); } };
}

test("local state stores campaign id alongside identity values", () => {
  const storage = makeStorage();
  saveLocalIdentity({ uuid: "id", nickname: "Alice" }, storage);
  saveCampaignId("campaign-1", storage);
  assert.equal(storage.data[STORAGE_KEYS.campaignId], "campaign-1");
  assert.deepEqual(loadLocalState(storage), { uuid: "id", nickname: "Alice", campaignId: "campaign-1" });
  assert.equal(createDefaultNickname("4d8b6f10-4a8b-48f4-b38c-d5128972e289"), "Adventurer-4d8b6f");
  assert.match(createLocalIdentityUuid({ randomUUID: () => "4d8b6f10-4a8b-48f4-b38c-d5128972e289" }), /^[0-9a-f-]{36}$/);
  assert.deepEqual(ensureLocalIdentity(makeStorage(), { randomUUID: () => "4d8b6f10-4a8b-48f4-b38c-d5128972e289" }), { uuid: "4d8b6f10-4a8b-48f4-b38c-d5128972e289", nickname: "Adventurer-4d8b6f", campaignId: "" });
});
