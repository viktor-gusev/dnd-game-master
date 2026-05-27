import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { initializeBrowserApplicationShell } from "../../../../web/js/browser-shell.js";
import { initializeCampaignDirectoryApp } from "../../../../web/js/campaign-directory.js";
import { initializeCampaignWorkspace } from "../../../../web/js/campaign-workspace.js";

function makeNode(id = "") {
  const node = { id, value: "", textContent: "", className: "", disabled: false, attributes: {}, children: [], listeners: new Map(), appendChild(child) { this.children.push(child); return child; }, addEventListener(name, listener) { this.listeners.set(name, listener); }, setAttribute(name, value) { this.attributes[name] = value; }, querySelector() { return null; }, showModal() { this.opened = true; } };
  Object.defineProperty(node, "innerHTML", { get() { return ""; }, set() { node.children = []; } });
  return node;
}

function makeDocument() {
  const nodes = new Map();
  return {
    body: makeNode("body"),
    location: { href: "http://localhost/campaign.html?campaignId=campaign-1" },
    addEventListener() {},
    createElement: () => makeNode(),
    getElementById(id) { if (!nodes.has(id)) nodes.set(id, makeNode(id)); return nodes.get(id); },
    querySelector() { return null; },
    nodes,
  };
}

function makeStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return { getItem(key) { return values.has(key) ? values.get(key) : null; }, setItem(key, value) { values.set(key, String(value)); }, values };
}

test("shared shell resolves identity and tab identity before page controllers start", async () => {
  const document = makeDocument();
  const storage = makeStorage({ "dnd-gm.identity.uuid": "4d8b6f10-4a8b-48f4-b38c-d5128972e289", "dnd-gm.identity.nickname": "Alice" });
  let pageStarted = false;
  const shell = await initializeBrowserApplicationShell({
    document,
    storage,
    cryptoApi: { randomUUID: () => "tab-1" },
    fetchImpl: async () => ({ ok: true, headers: { get: () => "application/json" }, async json() { return { ok: true, data: {} }; } }),
    pageController: async (runtime) => {
      pageStarted = true;
      assert.equal(runtime.identity.uuid, "4d8b6f10-4a8b-48f4-b38c-d5128972e289");
      assert.equal(runtime.tabIdentityId, "tab-1");
    },
  });

  assert.equal(pageStarted, true);
  assert.equal(shell.tabIdentityId, "tab-1");
  assert.equal(document.getElementById("shellContextTitle").textContent, "Campaign Directory");
  assert.equal(document.getElementById("shellError").textContent, "Errors 0");
  assert.equal(document.getElementById("shellDeviceStatus").textContent, "Device ready");
});

test("campaign directory declares campaign directory context without campaignId and opens details through a popup surface", async () => {
  const document = makeDocument();
  const shellCalls = [];
  const shell = {
    document,
    locationApi: { href: "http://localhost/", assign() {} },
    confirmImpl: () => true,
    identity: { uuid: "4d8b6f10-4a8b-48f4-b38c-d5128972e289", nickname: "Alice" },
    api: async (path, options = {}) => {
      shellCalls.push([path, options.method || "GET"]);
      if (path === "/api/campaigns") return { ok: true, data: { campaigns: [{ campaignId: "campaign-1", title: "Friday tavern run", gm: { uuid: "4d8b6f10-4a8b-48f4-b38c-d5128972e289", nickname: "Alice" }, participantCount: 1, currentUserParticipant: true, lastActivityAt: "2026-05-25T10:00:00.000Z" }] } };
      if (path === "/api/campaigns/campaign-1") return { ok: true, data: { campaign: { campaignId: "campaign-1", title: "Friday tavern run", gm: { uuid: "4d8b6f10-4a8b-48f4-b38c-d5128972e289", nickname: "Alice" } }, participants: [{ identityId: "1" }] } };
      return { ok: true, data: {} };
    },
    setPageContext(context) { this.pageContext = context; },
    pageError(message) { this.lastError = message; },
  };

  await initializeCampaignDirectoryApp(shell);
  assert.deepEqual(shell.pageContext, { kind: "campaign directory", campaignId: "" });
  assert.equal(document.getElementById("campaignDirectory").children.length, 1);
  await document.getElementById("campaignDirectory").children[0].children[0].children[1].listeners.get("click")();
  assert.equal(document.getElementById("campaignDetailsDialog").opened, true);
  assert.equal(shellCalls[0][0], "/api/campaigns");
});

test("campaign workspace declares campaign workspace context with campaignId", async () => {
  const document = makeDocument();
  const shell = {
    document,
    locationApi: { href: "http://localhost/campaign.html?campaignId=campaign-1" },
    identity: { uuid: "4d8b6f10-4a8b-48f4-b38c-d5128972e289", nickname: "Alice" },
    api: async (path) => {
      if (path === "/api/campaigns/campaign-1") return { ok: true, data: { campaign: { campaignId: "campaign-1", title: "Friday tavern run", gm: { nickname: "Alice" } }, participants: [{ identityId: "1" }], brief: {}, events: [], aiDrafts: [], credits: [] } };
      return { ok: true, data: {} };
    },
    setPageContext(context) { this.pageContext = context; },
    pageError(message) { this.lastError = message; },
  };

  await initializeCampaignWorkspace(shell);
  assert.deepEqual(shell.pageContext, { kind: "campaign workspace", campaignId: "campaign-1" });
  assert.equal(document.getElementById("campaignTitle").textContent, "Friday tavern run");
});

test("browser entry pages contain the shared shell frame and dedicated page runtime area", async () => {
  const [directoryHtml, workspaceHtml] = await Promise.all([
    readFile(new URL("../../../../web/index.html", import.meta.url), "utf8"),
    readFile(new URL("../../../../web/campaign.html", import.meta.url), "utf8"),
  ]);

  for (const html of [directoryHtml, workspaceHtml]) {
    assert.match(html, /class="application-header panel"/);
    assert.match(html, /class="page-runtime-area"/);
    assert.match(html, /class="application-footer panel"/);
    assert.doesNotMatch(html, /shellIdentity/);
  }
});
