import test from "node:test";
import assert from "node:assert/strict";

import { createAIPrepConversationPanel } from "../../../../web/js/aiprep-conversation-panel.js";

function makeNode(id = "") {
  const node = { id, value: "", textContent: "", className: "", disabled: false, attributes: {}, dataset: {}, children: [], listeners: new Map(), appendChild(child) { this.children.push(child); return child; }, addEventListener(name, listener) { this.listeners.set(name, listener); }, setAttribute(name, value) { this.attributes[name] = value; } };
  Object.defineProperty(node, "innerHTML", { get() { return ""; }, set() { node.children = []; } });
  return node;
}

function makeDocument() {
  const nodes = new Map();
  return { location: { href: "http://localhost/" }, createElement: () => makeNode(), getElementById(id) { if (!nodes.has(id)) nodes.set(id, makeNode(id)); return nodes.get(id); }, nodes };
}

test("AIPrepConversationPanel binds to a target and can launch a session", async () => {
  const document = makeDocument();
  const apiCalls = [];
  const shell = {
    document,
    cryptoApi: { randomUUID: () => "client-request-1" },
    api: async (path, options = {}) => {
      apiCalls.push([path, options.method || "GET"]);
      if (path.startsWith("/api/campaigns/campaign-1/ai/sessions?")) return { ok: true, data: { sessions: [] } };
      if (path === "/api/campaigns/campaign-1/ai/sessions") return { ok: true, data: { session: { id: "session-1" } } };
      if (path === "/api/campaigns/campaign-1/ai/sessions/session-1/messages") return { ok: true, data: { message: { id: "msg-1", role: "user", text: "Refine the name." }, responseMessage: { id: "msg-2", role: "assistant", text: "Candidate output." } } };
      throw new Error(`Unexpected API path: ${path}`);
    },
  };

  const panel = createAIPrepConversationPanel(shell, {
    campaignId: "campaign-1",
    targetKind: "character-profile-section",
    targetId: "sheet-1",
    sectionKey: "identity.name",
    mode: "text-draft-generation",
    policyProfile: "player-character-section-discussion",
    outputKind: "draft",
  }, { title: "Identity AI" });

  assert.equal(panel.dataset.targetKind, "character-profile-section");
  panel.children[3].value = "Refine the name.";
  await panel.children[4].children[0].listeners.get("click")();
  assert.equal(apiCalls.some(([path]) => path.includes("/ai/sessions?targetKind=character-profile-section")), true);
  assert.equal(apiCalls.some(([path]) => path === "/api/campaigns/campaign-1/ai/sessions"), true);
  assert.equal(apiCalls.some(([path]) => path === "/api/campaigns/campaign-1/ai/sessions/session-1/messages"), true);
});
