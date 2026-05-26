import test from "node:test";
import assert from "node:assert/strict";

import { initializeCampaignWorkspace } from "../../../../web/js/campaign-workspace.js";

function makeNode(id = "") {
  const node = { id, value: "", textContent: "", className: "", disabled: false, attributes: {}, children: [], listeners: new Map(), appendChild(child) { this.children.push(child); return child; }, addEventListener(name, listener) { this.listeners.set(name, listener); }, setAttribute(name, value) { this.attributes[name] = value; } };
  Object.defineProperty(node, "innerHTML", { get() { return ""; }, set() { node.children = []; } });
  return node;
}

function makeDocument() {
  const nodes = new Map();
  return { body: makeNode("body"), location: { href: "http://localhost/campaign.html?campaignId=campaign-1" }, addEventListener() {}, createElement: () => makeNode(), getElementById(id) { if (!nodes.has(id)) nodes.set(id, makeNode(id)); return nodes.get(id); }, nodes };
}

function makeStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { getItem(key) { return values.has(key) ? values.get(key) : null; }, setItem(key, value) { values.set(key, String(value)); }, values };
}

test("campaign workspace loads campaign data and shows durable projections", async () => {
  const document = makeDocument();
  const storage = makeStorage({ "dnd-gm.identity.uuid": "4d8b6f10-4a8b-48f4-b38c-d5128972e289", "dnd-gm.identity.nickname": "Alice" });
  const fetchCalls = [];
  await initializeCampaignWorkspace({
    document,
    storage,
    fetchImpl: async (path) => {
      fetchCalls.push(path);
      if (path === "/api/campaigns/campaign-1") return { ok: true, headers: { get: () => "application/json" }, async json() { return { ok: true, data: { campaign: { campaignId: "campaign-1", title: "Friday tavern run", gm: { nickname: "Alice" } }, participants: [{ identityId: "1" }], brief: { title: "Friday tavern run" }, events: [], aiDrafts: [], credits: [] } }; } };
      if (path === "/api/campaigns/campaign-2") return { ok: true, headers: { get: () => "application/json" }, async json() { return { ok: true, data: { campaign: { campaignId: "campaign-2", title: "Another game", gm: { nickname: "Alice" }, brief: { title: "Nested title", summary: "Nested brief" } }, participants: [{ identityId: "1" }], events: [], aiDrafts: [], credits: [] } }; } };
      if (path === "/api/event-delivery/context") return { ok: true, headers: { get: () => "application/json" }, async json() { return { ok: true, data: { tabIdentityId: "tab-1", campaignId: "campaign-1" } }; } };
      throw new Error(`Unexpected fetch path: ${path}`);
    },
  });

  assert.equal(document.getElementById("campaignTitle").textContent, "Friday tavern run");
  assert.match(document.getElementById("campaignSubtitle").textContent, /Participants: 1/);
  assert.match(document.getElementById("brief").textContent, /Friday tavern run/);
  assert.equal(fetchCalls.includes("/api/campaigns/campaign-1"), true);
});
