import test from "node:test";
import assert from "node:assert/strict";

import { loadBrowserState, saveBrowserState, STORAGE_KEYS } from "../../../../web/js/browser-state.js";

function makeStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { getItem(key) { return values.has(key) ? values.get(key) : null; }, setItem(key, value) { values.set(key, String(value)); }, values };
}

test("browser state uses campaign id convenience storage", () => {
  const storage = makeStorage({ [STORAGE_KEYS.uuid]: "id", [STORAGE_KEYS.nickname]: "Alice", [STORAGE_KEYS.campaignId]: "campaign-1" });
  assert.deepEqual(loadBrowserState(storage), { uuid: "id", nickname: "Alice", campaignId: "campaign-1" });
  saveBrowserState(storage, { uuid: "id2", nickname: "Bob", campaignId: "campaign-2" });
  assert.equal(storage.values.get(STORAGE_KEYS.campaignId), "campaign-2");
});
