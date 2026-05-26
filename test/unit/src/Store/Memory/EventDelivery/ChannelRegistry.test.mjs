import test from "node:test";
import assert from "node:assert/strict";

import ChannelRegistry from "../../../../../../src/Store/Memory/EventDelivery/ChannelRegistry.mjs";

test("registry is keyed by tab identity and replaces existing entries", () => {
  const registry = new ChannelRegistry();
  const responseA = { writableEnded: false, endCalled: 0, end() { this.endCalled += 1; this.writableEnded = true; } };
  const responseB = { writableEnded: false, endCalled: 0, end() { this.endCalled += 1; this.writableEnded = true; } };
  registry.put({ tabIdentityId: "tab-1", localIdentityId: "local-1", campaignId: "campaign-1", response: responseA });
  const previous = registry.put({ tabIdentityId: "tab-1", localIdentityId: "local-1", campaignId: "campaign-2", response: responseB });
  assert.equal(previous.response, responseA);
  assert.equal(responseA.endCalled, 1);
  assert.equal(registry.get("tab-1").campaignId, "campaign-2");
  assert.equal(registry.listByLocalIdentity("local-1").length, 1);
  registry.delete("tab-1");
  assert.equal(registry.get("tab-1"), null);
});
