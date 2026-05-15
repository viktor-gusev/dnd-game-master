import test from "node:test";
import assert from "node:assert/strict";

const nodes = new Map();

function makeField(id, value = "") {
  return {
    id,
    value,
    textContent: "",
    innerHTML: "",
    addEventListener() {},
    appendChild() {},
  };
}

globalThis.localStorage = {
  getItem(key) {
    return {
      "dnd-gm.displayName": "Alice",
      "dnd-gm.identityId": "identity-1",
      "dnd-gm.sessionId": "session-1",
    }[key] || null;
  },
  setItem() {},
};

globalThis.document = {
  getElementById(id) {
    if (!nodes.has(id)) {
      nodes.set(id, makeField(id));
    }
    return nodes.get(id);
  },
  createElement() {
    return makeField("li");
  },
};

globalThis.Headers = class Headers {
  constructor() {}
  set() {}
};

globalThis.fetch = async () => ({
  headers: { get() { return "application/json"; } },
  json: async () => ({ ok: true, data: { messages: [] } }),
});

await import("../../web/js/app.js");

test("browser entry restores stored state into inputs", () => {
  assert.equal(nodes.get("displayName").value, "Alice");
  assert.equal(nodes.get("sessionId").value, "session-1");
});

