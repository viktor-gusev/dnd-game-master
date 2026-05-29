import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { initializeBrowserApplicationShell } from "../../../../web/js/browser-shell.js";
import { initializeCampaignDirectoryApp } from "../../../../web/js/campaign-directory.js";
import { initializeWorkspaceApp } from "../../../../web/js/workspace.js";

function makeNode(id = "") {
  const node = {
    id,
    value: "",
    textContent: "",
    className: "",
    hidden: true,
    disabled: false,
    attributes: {},
    dataset: {},
    children: [],
    listeners: new Map(),
    appendChild(child) { this.children.push(child); return child; },
    addEventListener(name, listener) { this.listeners.set(name, listener); },
    setAttribute(name, value) { this.attributes[name] = value; },
    querySelector() { return null; },
    showModal() { this.opened = true; },
    close() { this.closed = true; },
  };
  Object.defineProperty(node, "innerHTML", { get() { return ""; }, set() { node.children = []; } });
  return node;
}

function makeDocument() {
  const nodes = new Map();
  return {
    body: makeNode("body"),
    location: { href: "http://localhost/player-workspace.html?campaignId=campaign-1" },
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
  assert.equal(document.getElementById("shellContextTitle").textContent, "Campaigns");
  assert.equal(document.getElementById("shellLogs").attributes["aria-label"], "Errors 0");
  assert.equal(document.getElementById("shellDeviceStatus").textContent, "");
  assert.equal(document.getElementById("shellDeviceStatus").attributes["aria-label"], "Device ready");
});

test("shell panels close when clicking their backdrop", async () => {
  const document = makeDocument();
  const shell = await initializeBrowserApplicationShell({
    document,
    storage: makeStorage({ "dnd-gm.identity.uuid": "4d8b6f10-4a8b-48f4-b38c-d5128972e289", "dnd-gm.identity.nickname": "Alice" }),
    cryptoApi: { randomUUID: () => "tab-1" },
    fetchImpl: async () => ({ ok: true, headers: { get: () => "application/json" }, async json() { return { ok: true, data: {} }; } }),
  });

  shell.openShellMenu();
  const shellPanel = document.getElementById("shellPanel");
  assert.equal(shellPanel.hidden, false);
  await shellPanel.listeners.get("click")({ target: shellPanel });
  assert.equal(shellPanel.hidden, true);

  const identityDialog = document.getElementById("identityDialog");
  shell.openIdentityEditor();
  assert.equal(identityDialog.opened, true);
  await identityDialog.listeners.get("click")({ target: identityDialog });
  assert.equal(identityDialog.closed, true);
});

test("shell updates reflect notification freshness", async () => {
  const document = makeDocument();
  const shell = await initializeBrowserApplicationShell({
    document,
    storage: makeStorage({ "dnd-gm.identity.uuid": "4d8b6f10-4a8b-48f4-b38c-d5128972e289", "dnd-gm.identity.nickname": "Alice" }),
    cryptoApi: { randomUUID: () => "tab-1" },
    fetchImpl: async () => ({ ok: true, headers: { get: () => "application/json" }, async json() { return { ok: true, data: {} }; } }),
  });

  shell.markUpdatesFresh({ type: "campaign.event.created" });
  assert.equal(document.getElementById("shellNotifications").attributes["aria-label"], "Updates available");
  assert.equal(document.getElementById("shellNotifications").dataset.freshness, "campaign.event.created");
});

test("campaign directory is list-first, hides identity edit from page actions, and opens details through the shell", async () => {
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
    openCampaignDetails() { document.getElementById("campaignDetailsDialog").opened = true; },
  };

  await initializeCampaignDirectoryApp(shell);
  assert.deepEqual(shell.pageContext, { kind: "campaign directory", campaignId: "" });
  assert.equal(document.getElementById("campaignDirectory").children.length, 1);
  assert.equal(document.getElementById("campaignDirectory").children[0].className, "campaign-list-item");
  assert.match(document.getElementById("campaignDirectory").children[0].children[0].children[1].children[2].textContent, /Today|Yesterday|May/);
  await document.getElementById("campaignDirectory").children[0].children[1].children[1].listeners.get("click")();
  assert.equal(document.getElementById("campaignDetailsDialog").opened, true);
  assert.equal(shellCalls[0][0], "/api/campaigns");
});

test("campaign directory renders a useful empty state with primary create action", async () => {
  const document = makeDocument();
  const shell = {
    document,
    locationApi: { href: "http://localhost/", assign() {} },
    confirmImpl: () => true,
    identity: { uuid: "4d8b6f10-4a8b-48f4-b38c-d5128972e289", nickname: "Alice" },
    api: async (path) => {
      if (path === "/api/campaigns") return { ok: true, data: { campaigns: [] } };
      return { ok: true, data: {} };
    },
    setPageContext(context) { this.pageContext = context; },
    pageError(message) { this.lastError = message; },
    openCampaignCreator() { document.getElementById("createCampaignDialog").opened = true; },
  };

  await initializeCampaignDirectoryApp(shell);
  assert.equal(document.getElementById("campaignDirectory").children[0].className, "campaign-empty-state");
  assert.equal(document.getElementById("campaignDirectory").children[0].children[0].textContent, "No campaigns yet");
  await document.getElementById("campaignDirectory").children[0].children[2].children[0].listeners.get("click")();
  assert.equal(document.getElementById("createCampaignDialog").opened, true);
});

test("campaign directory shows a join action for non-participants", async () => {
  const document = makeDocument();
  const shellCalls = [];
  const shell = {
    document,
    locationApi: { href: "http://localhost/", assign(url) { this.href = url; } },
    confirmImpl: () => true,
    identity: { uuid: "4d8b6f10-4a8b-48f4-b38c-d5128972e289", nickname: "Alice" },
    api: async (path, options = {}) => {
      shellCalls.push([path, options.method || "GET"]);
      if (path === "/api/campaigns") return { ok: true, data: { campaigns: [{ campaignId: "campaign-2", title: "Secret run", gm: { uuid: "9", nickname: "Bob" }, participantCount: 3, currentUserParticipant: false, currentUserRole: "", lastActivityAt: "2026-05-25T10:00:00.000Z" }] } };
      if (path === "/api/campaigns/campaign-2/join") return { ok: true, data: { campaignId: "campaign-2" } };
      return { ok: true, data: {} };
    },
    setPageContext(context) { this.pageContext = context; },
    pageError(message) { this.lastError = message; },
  };

  await initializeCampaignDirectoryApp(shell);
  const joinButton = document.getElementById("campaignDirectory").children[0].children[1].children[0];
  assert.equal(joinButton.textContent, "Join campaign");
  await joinButton.listeners.get("click")();
  assert.equal(shellCalls.some(([path]) => path === "/api/campaigns/campaign-2/join"), true);
  assert.equal(shell.locationApi.href.endsWith("/player-workspace.html?campaignId=campaign-2"), true);
});

test("campaign directory header create button opens the campaign dialog", async () => {
  const document = makeDocument();
  const shell = {
    document,
    locationApi: { href: "http://localhost/", assign() {} },
    confirmImpl: () => true,
    identity: { uuid: "4d8b6f10-4a8b-48f4-b38c-d5128972e289", nickname: "Alice" },
    api: async (path) => {
      if (path === "/api/campaigns") return { ok: true, data: { campaigns: [] } };
      return { ok: true, data: {} };
    },
    setPageContext(context) { this.pageContext = context; },
    pageError(message) { this.lastError = message; },
    openCampaignCreator() { document.getElementById("createCampaignDialog").opened = true; },
  };

  await initializeCampaignDirectoryApp(shell);
  await document.getElementById("openCreateCampaign").listeners.get("click")();
  assert.equal(document.getElementById("createCampaignDialog").opened, true);
});

test("player workspace declares player workspace context with campaignId", async () => {
  const document = makeDocument();
  const shell = {
    document,
    locationApi: { href: "http://localhost/player-workspace.html?campaignId=campaign-1" },
    identity: { uuid: "4d8b6f10-4a8b-48f4-b38c-d5128972e289", nickname: "Alice" },
    api: async (path) => {
      if (path === "/api/campaigns/campaign-1") return { ok: true, data: { campaignId: "campaign-1", workspaceKind: "player workspace", campaign: { campaignId: "campaign-1", title: "Friday tavern run", gm: { nickname: "Alice" } }, participants: [{ identityId: "1" }], brief: {}, events: [], aiDrafts: [], credits: [] } };
      return { ok: true, data: {} };
    },
    setPageContext(context) { this.pageContext = context; },
    pageError(message) { this.lastError = message; },
  };

  await initializeWorkspaceApp(shell, "player workspace");
  assert.deepEqual(shell.pageContext, { kind: "player workspace", campaignId: "campaign-1" });
  assert.equal(document.getElementById("campaignTitle").textContent, "Friday tavern run");
  assert.match(document.getElementById("campaignSubtitle").textContent, /GM Alice/);
  assert.match(document.getElementById("campaignSubtitle").textContent, /1 participant/);
});

test("browser entry pages contain the shared shell frame and dedicated page runtime area", async () => {
  const [directoryHtml, workspaceHtml, gmWorkspaceHtml] = await Promise.all([
    readFile(new URL("../../../../web/index.html", import.meta.url), "utf8"),
    readFile(new URL("../../../../web/player-workspace.html", import.meta.url), "utf8"),
    readFile(new URL("../../../../web/game-master-workspace.html", import.meta.url), "utf8"),
  ]);

  for (const html of [directoryHtml, workspaceHtml, gmWorkspaceHtml]) {
    assert.match(html, /class="application-header"/);
    assert.match(html, /class="page-runtime-area"/);
    assert.match(html, /class="application-footer"/);
    assert.match(html, /id="shellPanel"/);
    assert.doesNotMatch(html, /Browser Shell/);
    assert.doesNotMatch(html, /Primary Flow/);
    assert.doesNotMatch(html, /Secondary Flow/);
    assert.doesNotMatch(html, /Edit identity<\/button>/);
  }
});
