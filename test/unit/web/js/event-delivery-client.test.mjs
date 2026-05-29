import test from "node:test";
import assert from "node:assert/strict";

import { createEventDeliveryClient, getOrCreateTabIdentityId } from "../../../../web/js/event-delivery-client.js";

test("notification client reuses a tab identity and rebinds context without creating a new one", async () => {
  const storage = { data: new Map(), getItem(key) { return this.data.get(key) || ""; }, setItem(key, value) { this.data.set(key, value); } };
  const tabIdentityId = getOrCreateTabIdentityId(storage, { randomUUID: () => "tab-1" });
  const calls = [];
  const client = createEventDeliveryClient({
    tabIdentityId,
    localIdentityId: "local-1",
    fetchImpl: async (url, options) => { calls.push([url, options]); return { ok: true, json: async () => ({ ok: true, data: {} }) }; },
    eventSourceFactory: (url) => ({ url, close() {} }),
  });
  client.connect();
  await client.updateCampaignContext("campaign-1");
  assert.equal(tabIdentityId, "tab-1");
  assert.equal(calls[0][0], "/api/event-delivery/context");
  assert.match(calls[0][1].body, /"tabIdentityId":"tab-1"/);
  assert.equal(calls[0][1].headers["x-local-identity-id"], "local-1");
});
