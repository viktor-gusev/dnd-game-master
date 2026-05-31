import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { createAIConversationPanel } from "../../../../web/js/aiprep-conversation-panel.js";

function makeNode(id = "") {
  const node = { id, value: "", textContent: "", className: "", disabled: false, attributes: {}, dataset: {}, children: [], listeners: new Map(), appendChild(child) { this.children.push(child); return child; }, addEventListener(name, listener) { this.listeners.set(name, listener); }, setAttribute(name, value) { this.attributes[name] = value; }, removeAttribute(name) { delete this.attributes[name]; } };
  Object.defineProperty(node, "innerHTML", { get() { return ""; }, set() { node.children = []; } });
  return node;
}

function makeDocument() {
  const nodes = new Map();
  const body = { children: [], appendChild(node) { this.children.push(node); return node; }, querySelector(selector) { return this.children.find((node) => selector === "dgm-ai-conversation-panel[data-role='ai-conversation-panel']" && node.dataset.role === "ai-conversation-panel") || null; } };
  return { location: { href: "http://localhost/" }, body, createElement: () => makeNode(), querySelector(selector) { return body.querySelector(selector); }, getElementById(id) { if (!nodes.has(id)) nodes.set(id, makeNode(id)); return nodes.get(id); }, nodes };
}

test("AIConversationPanel helper binds to a target and exposes the custom element", async () => {
  const document = makeDocument();
  const apiCalls = [];
  const shell = {
    document,
    cryptoApi: { randomUUID: () => "client-request-1" },
    api: async (path, options = {}) => {
      apiCalls.push([path, options.method || "GET", options.body || ""]);
      if (path.startsWith("/api/campaigns/campaign-1/ai/sessions?")) return { ok: true, data: { sessions: [] } };
      throw new Error(`Unexpected API path: ${path}`);
    },
  };
  const panel = createAIConversationPanel(shell, { campaignId: "campaign-1", targetKind: "character-profile-section", targetId: "sheet-1", sectionKey: "identity.name", mode: "text-draft-generation", policyProfile: "player-character-section-discussion", outputKind: "draft" }, { title: "Identity AI" });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(panel.attributes["aria-label"], "Identity AI");
  assert.equal(panel.binding.campaignId, "campaign-1");
  assert.equal(panel.binding.targetKind, "character-profile-section");
  assert.equal(panel.state, "ready-empty");
  assert.equal(document.body.children.includes(panel), true);
  assert.equal(apiCalls.some(([path]) => path.startsWith("/api/campaigns/campaign-1/ai/sessions?")), true);
});

test("AIConversationPanel helper reuses the page singleton panel", async () => {
  const document = makeDocument();
  const shell = {
    document,
    api: async (path) => {
      if (path.startsWith("/api/campaigns/campaign-1/ai/sessions?")) return { ok: true, data: { sessions: [] } };
      return { ok: true, data: { sessions: [] } };
    },
  };
  const first = createAIConversationPanel(shell, { campaignId: "campaign-1", targetKind: "character-profile-section", targetId: "sheet-1" }, { title: "Identity AI" });
  const second = createAIConversationPanel(shell, { campaignId: "campaign-1", targetKind: "character-profile-section", targetId: "sheet-2" }, { title: "Identity AI" });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.strictEqual(second, first);
  assert.equal(second.binding.targetId, "sheet-2");
});

test("AIConversationPanel helper source registers the custom element boundary", async () => {
  const source = await readFile(new URL("../../../../web/wc/AIConversationPanel.mjs", import.meta.url), "utf8");

  assert.match(source, /const TAG_NAME = "dgm-ai-conversation-panel"/);
  assert.match(source, /const BaseHTMLElement = globalThis\.HTMLElement \|\| class \{\}/);
  assert.match(source, /class AIConversationPanelElement extends BaseHTMLElement/);
  assert.match(source, /customElements\.get\(TAG_NAME\)/);
  assert.match(source, /customElements\.define\(TAG_NAME,\s*AIConversationPanelElement\)/);
  assert.match(source, /dgm-ai-conversation-panel-open/);
  assert.match(source, /dgm-ai-conversation-panel-submit/);
  assert.match(source, /dgm-ai-conversation-panel-candidate-ready/);
  assert.match(source, /dgm-ai-conversation-panel-refresh/);
  assert.match(source, /dgm-ai-conversation-panel-close/);
});
