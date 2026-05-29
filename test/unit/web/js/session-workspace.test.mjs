import test from "node:test";
import assert from "node:assert/strict";

import { initializeWorkspaceApp } from "../../../../web/js/workspace.js";

function makeNode(id = "") {
  const node = { id, value: "", textContent: "", className: "", disabled: false, attributes: {}, children: [], listeners: new Map(), appendChild(child) { this.children.push(child); return child; }, addEventListener(name, listener) { this.listeners.set(name, listener); }, setAttribute(name, value) { this.attributes[name] = value; } };
  Object.defineProperty(node, "innerHTML", { get() { return ""; }, set() { node.children = []; } });
  return node;
}

function makeDocument() {
  const nodes = new Map();
  return { body: makeNode("body"), location: { href: "http://localhost/player-workspace.html?campaignId=campaign-1" }, addEventListener() {}, createElement: () => makeNode(), getElementById(id) { if (!nodes.has(id)) nodes.set(id, makeNode(id)); return nodes.get(id); }, nodes };
}

function makeStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { getItem(key) { return values.has(key) ? values.get(key) : null; }, setItem(key, value) { values.set(key, String(value)); }, values };
}

test("player workspace loads campaign data from the role-resolved campaign projection", async () => {
  const document = makeDocument();
  const storage = makeStorage({ "dnd-gm.identity.uuid": "4d8b6f10-4a8b-48f4-b38c-d5128972e289", "dnd-gm.identity.nickname": "Alice" });
  const fetchCalls = [];
  const shell = {
    document,
    storage,
    locationApi: document.location,
    api: async (path) => {
      fetchCalls.push(path);
      if (path === "/api/campaigns/campaign-1") return { ok: true, data: { campaignId: "campaign-1", workspaceKind: "player workspace", campaign: { campaignId: "campaign-1", title: "Friday tavern run", gm: { nickname: "Alice" } }, participants: [{ identityId: "1" }], brief: { title: "Friday tavern run" }, events: [], aiDrafts: [], credits: [] } };
      if (path === "/api/campaigns/campaign-2") return { ok: true, data: { campaignId: "campaign-2", workspaceKind: "game master workspace", campaign: { campaignId: "campaign-2", title: "Another game", gm: { nickname: "Alice" }, brief: { title: "Nested title", summary: "Nested brief" } }, participants: [{ identityId: "1" }], events: [], aiDrafts: [], credits: [] } };
      if (path === "/api/event-delivery/context") return { ok: true, data: { tabIdentityId: "tab-1", campaignId: "campaign-1" } };
      throw new Error(`Unexpected fetch path: ${path}`);
    },
    setPageContext(context) { this.pageContext = context; },
    pageError() {},
  };
  await initializeWorkspaceApp(shell, "player workspace");

  assert.equal(document.getElementById("campaignTitle").textContent, "Friday tavern run");
  assert.match(document.getElementById("campaignSubtitle").textContent, /1 participant/);
  assert.match(document.getElementById("workspaceDetails").textContent, /Friday tavern run/);
  assert.equal(fetchCalls.includes("/api/campaigns/campaign-1"), true);
  assert.equal(document.getElementById("status").textContent, "Workspace ready.");

  const beforeNotification = fetchCalls.length;
  await shell.handleNotification({ type: "campaign.event.created", scope: "campaign", campaignId: "campaign-1" });
  assert.equal(fetchCalls.length, beforeNotification + 1);
  assert.equal(fetchCalls.at(-1), "/api/campaigns/campaign-1");
  assert.equal(fetchCalls.includes("/api/events"), false);
});

test("player workspace auto-joins on direct entry when the player is not yet a participant", async () => {
  const document = makeDocument();
  const fetchCalls = [];
  const shell = {
    document,
    storage: makeStorage({ "dnd-gm.identity.uuid": "4d8b6f10-4a8b-48f4-b38c-d5128972e289", "dnd-gm.identity.nickname": "Alice" }),
    locationApi: document.location,
    api: async (path, options = {}) => {
      fetchCalls.push([path, options.method || "GET"]);
      if (path === "/api/campaigns/campaign-1" && (!options.method || options.method === "GET") && fetchCalls.length === 1) return { ok: false, error: { code: "forbidden", message: "Identity is not authorized for this campaign." } };
      if (path === "/api/campaigns/campaign-1/join") return { ok: true, data: { campaignId: "campaign-1" } };
      if (path === "/api/campaigns/campaign-1") return { ok: true, data: { campaignId: "campaign-1", workspaceKind: "player workspace", campaign: { campaignId: "campaign-1", title: "Friday tavern run", gm: { nickname: "Alice" } }, participants: [{ identityId: "1" }], brief: { title: "Friday tavern run" }, events: [], aiDrafts: [], credits: [] } };
      if (path === "/api/event-delivery/context") return { ok: true, data: { tabIdentityId: "tab-1", campaignId: "campaign-1" } };
      throw new Error(`Unexpected fetch path: ${path}`);
    },
    setPageContext(context) { this.pageContext = context; },
    pageError() {},
  };

  await initializeWorkspaceApp(shell, "player workspace");

  assert.deepEqual(fetchCalls.map(([path, method]) => `${method} ${path}`).slice(0, 3), [
    "GET /api/campaigns/campaign-1",
    "POST /api/campaigns/campaign-1/join",
    "GET /api/campaigns/campaign-1",
  ]);
  assert.equal(document.getElementById("status").textContent, "Workspace ready.");
});
