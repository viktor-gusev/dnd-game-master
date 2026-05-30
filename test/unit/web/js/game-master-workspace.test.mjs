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
  return { body: makeNode("body"), location: { href: "http://localhost/game-master-workspace.html?campaignId=campaign-1" }, addEventListener() {}, createElement: () => makeNode(), getElementById(id) { if (!nodes.has(id)) nodes.set(id, makeNode(id)); return nodes.get(id); }, nodes };
}

test("game master workspace renders readable material sections by default", async () => {
  const document = makeDocument();
  const shell = {
    document,
    storage: { getItem() { return null; }, setItem() {} },
    locationApi: document.location,
    api: async (path) => {
      if (path === "/api/campaigns/campaign-1") return { ok: true, data: { campaignId: "campaign-1", workspaceKind: "game master workspace", campaign: { campaignId: "campaign-1", title: "Friday tavern run", gm: { nickname: "Alice" } }, participants: [{ identityId: "1" }], materials: [{ materialId: "mat-1", title: "Brief", content: "Readable" }], assets: [], aiDrafts: [], events: [], credits: [] } };
      if (path === "/api/event-delivery/context") return { ok: true, data: { tabIdentityId: "tab-1", campaignId: "campaign-1" } };
      throw new Error(`Unexpected fetch path: ${path}`);
    },
    setPageContext(context) { this.pageContext = context; },
    pageError() {},
  };

  await initializeWorkspaceApp(shell, "game master workspace");

  assert.equal(document.getElementById("campaignTitle").textContent, "Friday tavern run");
  assert.equal(document.getElementById("characterWorkshop").children.length > 0, true);
  assert.equal(document.getElementById("workspaceDetails").textContent.includes("Friday tavern run"), true);
});
