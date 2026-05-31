import test from "node:test";
import assert from "node:assert/strict";

import { initializeWorkspaceApp } from "../../../../web/js/workspace.js";

function makeNode(id = "") {
  const node = { id, value: "", textContent: "", className: "", disabled: false, attributes: {}, dataset: {}, children: [], listeners: new Map(), appendChild(child) { this.children.push(child); return child; }, addEventListener(name, listener) { this.listeners.set(name, listener); }, setAttribute(name, value) { this.attributes[name] = value; }, removeAttribute(name) { delete this.attributes[name]; }, querySelector(selector) { return this.children.find((child) => child?.attributes?.["data-action"] === selector.match(/data-action='([^']+)'/)?.[1]) || null; } };
  Object.defineProperty(node, "innerHTML", { get() { return ""; }, set() { node.children = []; } });
  return node;
}

function makeDocument() {
  const nodes = new Map();
  const body = makeNode("body");
  body.querySelector = (selector) => body.children.find((node) => selector === "dgm-ai-conversation-panel[data-role='ai-conversation-panel']" && node.dataset.role === "ai-conversation-panel") || null;
  return { body, querySelector: (...args) => body.querySelector(...args), location: { href: "http://localhost/player-workspace.html?campaignId=campaign-1" }, addEventListener() {}, createElement: () => makeNode(), getElementById(id) { if (!nodes.has(id)) nodes.set(id, makeNode(id)); return nodes.get(id); }, nodes };
}

function collectText(node) {
  const own = node?.textContent || "";
  const children = Array.isArray(node?.children) ? node.children.map(collectText).join(" ") : "";
  return `${own} ${children}`.trim();
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
      if (path === "/api/campaigns/campaign-1") return { ok: true, data: { campaignId: "campaign-1", workspaceKind: "player workspace", campaign: { campaignId: "campaign-1", title: "Friday tavern run", gm: { nickname: "Alice" } }, participants: [{ identityId: "1" }], brief: { title: "Friday tavern run" }, events: [], aiDrafts: [], credits: [], characterSheets: [{ sheetId: "sheet-1", playerIdentityId: "4d8b6f10-4a8b-48f4-b38c-d5128972e289", ownerIdentityId: "4d8b6f10-4a8b-48f4-b38c-d5128972e289", title: "Asha", state: "draft", structuredProfile: { identity: { name: "Asha", shortDescription: "Wizard", ancestry: "", characterClass: "", role: "" }, appearance: { text: "Blue cloak" }, personality: { traits: "Curious", motivation: "Learn", fears: "", mannerisms: "", speechStyle: "" }, backstory: { text: "An apprentice", importantNpc: "", openHooks: "" }, campaignIntegration: { reasonToJoin: "Adventure", linksToOtherCharacters: "", gmUsableHooks: "", boundaries: "" }, mechanics: { text: "Wizard" }, publicNotes: "Public note", gmHooks: "Hidden", playerIntent: { playStyle: "Support", themes: "", aiHelpMode: "" } } }] } };
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
  assert.equal(document.getElementById("characterWorkshop").children.length > 0, true);
  assert.equal(document.getElementById("publicPreview").children.length > 0, true);
  assert.equal(fetchCalls.includes("/api/campaigns/campaign-1"), true);
  assert.equal(document.getElementById("status").textContent, "Workspace ready.");
  const workshop = document.getElementById("characterWorkshop");
  assert.equal(workshop.children.length > 0, true);
  const firstSection = workshop.children[0];
  const header = firstSection.children[0];
  const actionButtons = header.children.at(-1).children;
  assert.equal(actionButtons[0].attributes["aria-label"], "Manual edit");
  assert.equal(actionButtons[1].attributes["aria-label"], "AI assist");
  assert.match(collectText(firstSection), /Asha/);

  const beforeNotification = fetchCalls.length;
  await shell.handleNotification({ type: "campaign.event.created", scope: "campaign", campaignId: "campaign-1" });
  assert.equal(fetchCalls.length, beforeNotification + 1);
  assert.equal(fetchCalls.at(-1), "/api/campaigns/campaign-1");
  assert.equal(fetchCalls.includes("/api/events"), false);
});

test("player workspace manual edit is section-local and AI assist opens the shared panel for the selected section", async () => {
  const document = makeDocument();
  const apiCalls = [];
  const shell = {
    document,
    storage: makeStorage({ "dnd-gm.identity.uuid": "4d8b6f10-4a8b-48f4-b38c-d5128972e289", "dnd-gm.identity.nickname": "Alice" }),
    locationApi: document.location,
    api: async (path, options = {}) => {
      apiCalls.push([path, options.method || "GET", options.body || ""]);
      if (path === "/api/campaigns/campaign-1") return { ok: true, data: { campaignId: "campaign-1", workspaceKind: "player workspace", campaign: { campaignId: "campaign-1", title: "Friday tavern run", gm: { nickname: "Alice" } }, participants: [{ identityId: "1" }], brief: { title: "Friday tavern run" }, events: [], aiDrafts: [], credits: [], characterSheets: [{ sheetId: "sheet-1", playerIdentityId: "4d8b6f10-4a8b-48f4-b38c-d5128972e289", ownerIdentityId: "4d8b6f10-4a8b-48f4-b38c-d5128972e289", title: "Asha", state: "draft", structuredProfile: { identity: { name: "Asha", shortDescription: "Wizard", ancestry: "", characterClass: "", role: "" }, appearance: { text: "Blue cloak" }, personality: { traits: "Curious", motivation: "Learn", fears: "", mannerisms: "", speechStyle: "" }, backstory: { text: "An apprentice", importantNpc: "", openHooks: "" }, campaignIntegration: { reasonToJoin: "Adventure", linksToOtherCharacters: "", gmUsableHooks: "", boundaries: "" }, mechanics: { text: "Wizard" }, publicNotes: "Public note", gmHooks: "Hidden", playerIntent: { playStyle: "Support", themes: "", aiHelpMode: "" } } }] } };
      if (path.startsWith("/api/campaigns/campaign-1/ai/sessions?")) return { ok: true, data: { sessions: [] } };
      if (path === "/api/campaigns/campaign-1/ai/sessions") return { ok: true, data: { session: { id: "ai-session-1" } } };
      if (path === "/api/campaigns/campaign-1/ai/sessions/ai-session-1/drafts") return { ok: true, data: { aiDraft: { draftId: "draft-1", state: "draft", title: "Identity structured candidate", candidateData: { sectionKey: "identity", sectionData: { name: "Asha", shortDescription: "Wizard" } } } } };
      if (path === "/api/campaigns/campaign-1/ai/drafts/draft-1/accept") return { ok: true, data: { aiDraft: { draftId: "draft-1", state: "accepted" } } };
      return { ok: true, data: { session: { id: "session-1" } } };
    },
    setPageContext(context) { this.pageContext = context; },
    pageError() {},
  };

  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
  await initializeWorkspaceApp(shell, "player workspace");
  const workshop = document.getElementById("characterWorkshop");
  let firstSection = workshop.children[0];
  let headerActions = firstSection.children[0].children.at(-1).children;
  await headerActions[0].listeners.get("click")();
  await tick();
  firstSection = workshop.children[0];
  assert.equal(firstSection.children.some((child) => child.className === "workshop-section-form"), true);
  assert.equal(workshop.children[1].children.some((child) => child.className === "workshop-section-form"), false);

  headerActions = firstSection.children[0].children.at(-1).children;
  await headerActions[1].listeners.get("click")();
  await tick();
  assert.equal(document.body.children.some((node) => node.dataset.role === "ai-conversation-panel"), true);
  assert.equal(apiCalls.some(([path]) => path.startsWith("/api/campaigns/campaign-1/ai/sessions?")), true);
  const panel = document.body.children.find((node) => node.dataset.role === "ai-conversation-panel");
  await panel.listeners.get("dgm-ai-conversation-panel-candidate-requested")({ detail: { binding: panel.binding } });
  await tick();
  assert.match(panel.candidateReviewText, /"name": "Asha"/);
  assert.equal(apiCalls.some(([path, method]) => path === "/api/campaigns/campaign-1/ai/sessions" && method === "POST"), true);
  assert.equal(apiCalls.some(([path]) => path === "/api/campaigns/campaign-1/ai/sessions/ai-session-1/drafts"), true);
  const accepted = panel.listeners.get("dgm-ai-conversation-panel-candidate-accepted");
  await accepted({ detail: { candidate: { draftId: "draft-1" } } });
  await tick();
  assert.equal(apiCalls.some(([path]) => path === "/api/campaigns/campaign-1/ai/drafts/draft-1/accept"), true);
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
