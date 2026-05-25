import test from "node:test";
import assert from "node:assert/strict";

import { initializeSessionWorkspace } from "../../../../web/js/session-workspace.js";

function makeNode(id = "") {
  const node = {
    id,
    value: "",
    textContent: "",
    className: "",
    disabled: false,
    scrollTop: 0,
    scrollHeight: 0,
    attributes: {},
    children: [],
    listeners: new Map(),
    classList: {
      added: [],
      add(name) {
        this.added.push(name);
      },
    },
    appendChild(child) {
      this.children.push(child);
      this.scrollHeight = this.children.length;
      return child;
    },
    addEventListener(name, listener) {
      this.listeners.set(name, listener);
    },
    setAttribute(name, value) {
      this.attributes[name] = value;
    },
  };

  Object.defineProperty(node, "innerHTML", {
    get() {
      return "";
    },
    set() {
      node.children = [];
      node.scrollHeight = 0;
    },
  });

  return node;
}

function makeDocument() {
  const nodes = new Map();
  const body = makeNode("body");
  return {
    body,
    location: { href: "http://localhost/session.html" },
    querySelector() {
      return null;
    },
    addEventListener() {},
    createElement(tagName) {
      return makeNode(tagName);
    },
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, makeNode(id));
      return nodes.get(id);
    },
    nodes,
  };
}

function makeStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    values,
  };
}

test("workspace shows a clear error when sessionId is missing", async () => {
  const document = makeDocument();
  const storage = makeStorage();

  await initializeSessionWorkspace({
    document,
    storage,
    locationApi: { href: "http://localhost/session.html" },
    cryptoApi: { randomUUID: () => "4d8b6f10-4a8b-48f4-b38c-d5128972e289" },
    fetchImpl: async () => {
      throw new Error("fetch should not be used without a session id");
    },
  });

  assert.match(document.getElementById("status").textContent, /Session id is missing/);
  assert.deepEqual(document.getElementById("workspaceShell").classList.added, ["workspace-error"]);
  assert.equal(storage.getItem("dnd-gm.identity.uuid"), "4d8b6f10-4a8b-48f4-b38c-d5128972e289");
  assert.equal(storage.getItem("dnd-gm.identity.nickname"), "Adventurer-4d8b6f");
});

test("workspace joins the selected session, loads session data, and refreshes messages on session SSE", async () => {
  const document = makeDocument();
  const storage = makeStorage({
    "dnd-gm.identity.uuid": "4d8b6f10-4a8b-48f4-b38c-d5128972e289",
    "dnd-gm.identity.nickname": "Alice",
  });
  const sessionStorageApi = makeStorage();
  const fetchCalls = [];
  let messagesReadCount = 0;
  let source = null;
  const originalEventSource = globalThis.EventSource;

  globalThis.EventSource = class FakeEventSource {
    constructor(url) {
      this.url = url;
      this.listeners = new Map();
      source = this;
    }
    addEventListener(name, listener) {
      this.listeners.set(name, listener);
    }
    close() {}
  };

  try {
    await initializeSessionWorkspace({
      document,
      storage,
      sessionStorageApi,
      locationApi: { href: "http://localhost/session.html?sessionId=session-1" },
      fetchImpl: async (path, options = {}) => {
        fetchCalls.push([path, options.method || "GET", options.headers]);
        if (path === "/api/identity/local") {
          return {
            ok: true,
            headers: { get() { return "application/json"; } },
            async json() {
              return {
                ok: true,
                data: {
                  identity: {
                    id: "4d8b6f10-4a8b-48f4-b38c-d5128972e289",
                    uuid: "4d8b6f10-4a8b-48f4-b38c-d5128972e289",
                    nickname: "Alice",
                  },
                },
              };
            },
          };
        }
        if (path === "/api/sessions/session-1/join") {
          return {
            ok: true,
            headers: { get() { return "application/json"; } },
            async json() {
              return { ok: true, data: { sessionId: "session-1" } };
            },
          };
        }
        if (path === "/api/sessions/session-1") {
          return {
            ok: true,
            headers: { get() { return "application/json"; } },
            async json() {
              return {
                ok: true,
                data: {
                  session: {
                    sessionId: "session-1",
                    title: "Friday tavern run",
                    state: "lobby",
                    gm: { uuid: "4d8b6f10-4a8b-48f4-b38c-d5128972e289", nickname: "Alice" },
                  },
                  participants: [
                    {
                      identityId: "4d8b6f10-4a8b-48f4-b38c-d5128972e289",
                      nickname: "Alice",
                      role: "game_master",
                    },
                  ],
                },
              };
            },
          };
        }
        if (path === "/api/sessions/session-1/messages") {
          messagesReadCount += 1;
          const messages = messagesReadCount === 1
            ? [{ displayName: "Alice", text: "Hello there", createdAt: "2026-05-25T10:00:00.000Z" }]
            : [
              { displayName: "Alice", text: "Hello there", createdAt: "2026-05-25T10:00:00.000Z" },
              { displayName: "Alice", text: "Again", createdAt: "2026-05-25T10:01:00.000Z" },
            ];
          return {
            ok: true,
            headers: { get() { return "application/json"; } },
            async json() {
              return { ok: true, data: { messages } };
            },
          };
        }
        if (path === "/api/event-delivery/token") {
          return {
            ok: true,
            headers: { get() { return "application/json"; } },
            async json() {
              return { ok: true, data: { streamToken: "token-1", expiresAt: "2026-05-25T11:00:00.000Z" } };
            },
          };
        }
        throw new Error(`Unexpected fetch path: ${path}`);
      },
    });

    assert.equal(document.getElementById("sessionTitle").textContent, "Friday tavern run");
    assert.match(document.getElementById("sessionSubtitle").textContent, /GM: Alice/);
    assert.equal(document.getElementById("participants").children.length, 1);
    assert.equal(document.getElementById("messages").children.length, 1);
    assert.equal(document.getElementById("backToDirectory").attributes.href, "/");
    assert.equal(storage.getItem("dnd-gm.sessionId"), "session-1");
    assert.equal(document.getElementById("channelStatus").textContent, "Channel: connecting");
    assert.equal(fetchCalls.some(([path]) => path === "/api/event-delivery/token"), true);
    assert.equal(fetchCalls.some(([path, , headers]) => path === "/api/sessions/session-1" && headers.get("x-local-identity-id") === "4d8b6f10-4a8b-48f4-b38c-d5128972e289"), true);

    source.listeners.get("delivery.connected")?.();
    assert.equal(document.getElementById("channelStatus").textContent, "Channel: connected");

    source.listeners.get("session.messages.changed")?.({
      data: JSON.stringify({
        name: "session.messages.changed",
        payload: { sessionId: "session-1", reason: "message_appended" },
      }),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(document.getElementById("messages").children.length, 2);
    assert.equal(messagesReadCount, 2);
  } finally {
    globalThis.EventSource = originalEventSource;
  }
});
