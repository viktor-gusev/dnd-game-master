import test from "node:test";
import assert from "node:assert/strict";

import Runtime from "../../../../../src/Service/EventDelivery/Runtime.mjs";
import ChannelRegistry from "../../../../../src/Store/Memory/EventDelivery/ChannelRegistry.mjs";

test("runtime opens SSE, rebinds context, and delivers scoped hints", () => {
  const registry = new ChannelRegistry();
  const runtime = new Runtime({ channelRegistry: registry });
  const response = { writableEnded: false, headers: {}, chunks: [], setHeader(name, value) { this.headers[name] = value; }, flushHeaders() {}, write(chunk) { this.chunks.push(chunk); }, end() { this.writableEnded = true; } };
  const request = { on() {}, off() {} };
  runtime.openStream({ tabIdentityId: "tab-1", localIdentityId: "local-1", campaignId: "campaign-1", request, response });
  assert.equal(registry.get("tab-1").localIdentityId, "local-1");
  runtime.rebindContext({ tabIdentityId: "tab-1", localIdentityId: "local-1", campaignId: "" });
  assert.equal(registry.get("tab-1").campaignId, "");
  const delivered = runtime.notifyUser({ localIdentityId: "local-1", type: "user.identity.changed", resourceKind: "identity" });
  assert.deepEqual(delivered, ["tab-1"]);
  assert.match(response.chunks.join(""), /"type":"user.identity.changed"/);
});
