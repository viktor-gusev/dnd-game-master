import test from "node:test";
import assert from "node:assert/strict";

import { initializeCampaignDirectoryApp } from "../../../../web/js/campaign-directory.js";

function makeNode(id = "") {
  const node = { id, value: "", textContent: "", className: "", disabled: false, attributes: {}, children: [], listeners: new Map(), appendChild(child) { this.children.push(child); return child; }, addEventListener(name, listener) { this.listeners.set(name, listener); }, setAttribute(name, value) { this.attributes[name] = value; } };
  Object.defineProperty(node, "innerHTML", { get() { return ""; }, set() { node.children = []; } });
  return node;
}

function makeDocument() {
  const nodes = new Map();
  return { body: makeNode("body"), addEventListener() {}, createElement: () => makeNode(), getElementById(id) { if (!nodes.has(id)) nodes.set(id, makeNode(id)); return nodes.get(id); }, nodes };
}

function makeStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { getItem(key) { return values.has(key) ? values.get(key) : null; }, setItem(key, value) { values.set(key, String(value)); }, values };
}

test("campaign directory renders campaign summaries and create/open actions", async () => {
  const document = makeDocument();
  const storage = makeStorage({ "dnd-gm.identity.uuid": "4d8b6f10-4a8b-48f4-b38c-d5128972e289", "dnd-gm.identity.nickname": "Alice" });
  const fetchCalls = [];
  await initializeCampaignDirectoryApp({
    document,
    storage,
    locationApi: { href: "http://localhost/", assign() {} },
    confirmImpl: () => true,
    fetchImpl: async (path, options = {}) => {
      fetchCalls.push([path, options.method || "GET"]);
      if (path === "/api/identity/local") return { ok: true, headers: { get: () => "application/json" }, async json() { return { ok: true, data: { identity: { uuid: "4d8b6f10-4a8b-48f4-b38c-d5128972e289", nickname: "Alice" } } }; } };
      if (path === "/api/campaigns") return { ok: true, headers: { get: () => "application/json" }, async json() { return { ok: true, data: { campaigns: [{ campaignId: "campaign-1", title: "Friday tavern run", gm: { uuid: "4d8b6f10-4a8b-48f4-b38c-d5128972e289", nickname: "Alice" }, participantCount: 1, currentUserParticipant: true, lastActivityAt: "2026-05-25T10:00:00.000Z" }] } }; } };
      if (path === "/api/event-delivery/context") return { ok: true, headers: { get: () => "application/json" }, async json() { return { ok: true, data: { tabIdentityId: "tab-1", campaignId: "campaign-1" } }; } };
      throw new Error(`Unexpected fetch path: ${path}`);
    },
  });

  assert.equal(document.getElementById("campaignDirectory").children.length, 1);
  assert.match(document.getElementById("campaignDirectorySummary").textContent, /1 campaign/i);
  assert.equal(fetchCalls.at(-1)[0], "/api/campaigns");
});

test("campaign directory refresh button reloads the campaign list", async () => {
  const document = makeDocument();
  const storage = makeStorage({ "dnd-gm.identity.uuid": "4d8b6f10-4a8b-48f4-b38c-d5128972e289", "dnd-gm.identity.nickname": "Alice" });
  let campaignFetchCount = 0;
  await initializeCampaignDirectoryApp({
    document,
    storage,
    locationApi: { href: "http://localhost/", assign() {} },
    confirmImpl: () => true,
    fetchImpl: async (path, options = {}) => {
      if (path === "/api/identity/local") return { ok: true, headers: { get: () => "application/json" }, async json() { return { ok: true, data: { identity: { uuid: "4d8b6f10-4a8b-48f4-b38c-d5128972e289", nickname: "Alice" } } }; } };
      if (path === "/api/campaigns") {
        campaignFetchCount += 1;
        return { ok: true, headers: { get: () => "application/json" }, async json() { return { ok: true, data: { campaigns: [{ campaignId: `campaign-${campaignFetchCount}`, title: `Campaign ${campaignFetchCount}`, gm: { uuid: "4d8b6f10-4a8b-48f4-b38c-d5128972e289", nickname: "Alice" }, participantCount: 1, currentUserParticipant: true, lastActivityAt: "2026-05-25T10:00:00.000Z" }] } }; } };
      }
      throw new Error(`Unexpected fetch path: ${path}`);
    },
  });

  const refreshButton = document.getElementById("refreshCampaigns");
  await refreshButton.listeners.get("click")();
  assert.equal(campaignFetchCount, 2);
  assert.match(document.getElementById("campaignDirectorySummary").textContent, /1 campaign/i);
});
