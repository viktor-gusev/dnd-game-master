import test from "node:test";
import assert from "node:assert/strict";

import { initializeDirectoryApp } from "../../../../web/js/directory.js";

function makeNode(id = "") {
  const node = {
    id,
    value: "",
    textContent: "",
    className: "",
    disabled: false,
    attributes: {},
    children: [],
    listeners: new Map(),
    appendChild(child) {
      this.children.push(child);
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
    },
  });

  return node;
}

function makeDocument() {
  const nodes = new Map();
  const body = makeNode("body");
  return {
    body,
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

test("directory entry restores local identity and renders session summaries", async () => {
  const document = makeDocument();
  const storage = makeStorage({
    "dnd-gm.identity.uuid": "4d8b6f10-4a8b-48f4-b38c-d5128972e289",
    "dnd-gm.identity.nickname": "Alice",
  });
  const locationApi = {
    href: "http://localhost/",
    assign() {},
  };
  const fetchCalls = [];

  await initializeDirectoryApp({
    document,
    storage,
    locationApi,
    fetchImpl: async (path, options = {}) => {
      fetchCalls.push([path, options.method || "GET"]);
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
      return {
        ok: true,
        headers: { get() { return "application/json"; } },
        async json() {
          return {
            ok: true,
            data: {
              sessions: [
                {
                  sessionId: "session-1",
                  title: "Friday tavern run",
                  state: "lobby",
                  gm: { uuid: "4d8b6f10-4a8b-48f4-b38c-d5128972e289", nickname: "Alice" },
                  participantCount: 1,
                  joinable: true,
                  currentUserParticipant: true,
                },
              ],
            },
          };
        },
      };
    },
  });

  assert.equal(document.getElementById("identityUuid").value, "4d8b6f10-4a8b-48f4-b38c-d5128972e289");
  assert.equal(document.getElementById("identityNickname").value, "Alice");
  assert.equal(document.getElementById("sessionDirectory").children.length, 1);
  assert.equal(fetchCalls[0][0], "/api/identity/local");
  assert.equal(fetchCalls.at(-1)[0], "/api/sessions");
});

test("directory joins a listed session and navigates to the workspace", async () => {
  const document = makeDocument();
  const storage = makeStorage({
    "dnd-gm.identity.uuid": "4d8b6f10-4a8b-48f4-b38c-d5128972e289",
    "dnd-gm.identity.nickname": "Alice",
  });
  let assignedTo = "";
  const locationApi = {
    href: "http://localhost/",
    assign(url) {
      assignedTo = url;
    },
  };
  const fetchCalls = [];

  await initializeDirectoryApp({
    document,
    storage,
    locationApi,
    fetchImpl: async (path, options = {}) => {
      fetchCalls.push([path, options.method || "GET"]);
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
      if (path === "/api/sessions") {
        return {
          ok: true,
          headers: { get() { return "application/json"; } },
          async json() {
            return {
              ok: true,
              data: {
                sessions: [
                  {
                    sessionId: "session-2",
                    title: "Open table",
                    state: "lobby",
                    gm: { uuid: "c53f5c97-f2f1-4fa0-a7a8-870e5a73a2b9", nickname: "Bob" },
                    participantCount: 1,
                    joinable: true,
                    currentUserParticipant: false,
                  },
                ],
              },
            };
          },
        };
      }
      return {
        ok: true,
        headers: { get() { return "application/json"; } },
        async json() {
          return { ok: true, data: { sessionId: "session-2" } };
        },
      };
    },
  });

  const card = document.getElementById("sessionDirectory").children[0];
  const joinButton = card.children[3].children[0];
  await joinButton.listeners.get("click")();

  assert.equal(fetchCalls.at(-1)[0], "/api/sessions/session-2/join");
  assert.equal(storage.getItem("dnd-gm.sessionId"), "session-2");
  assert.equal(assignedTo, "/session.html?sessionId=session-2");
});
