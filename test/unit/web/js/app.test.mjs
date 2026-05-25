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

function collectText(node) {
  if (!node) return "";
  return [node.textContent || "", ...node.children.map((child) => collectText(child))]
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function findButtonByText(node, text) {
  if (!node) return null;
  if (node.id === "button" && node.textContent === text) return node;
  for (const child of node.children) {
    const found = findButtonByText(child, text);
    if (found) return found;
  }
  return null;
}

function createSessionFixture(count) {
  return Array.from({ length: count }, (_, index) => ({
    sessionId: `session-${index + 1}`,
    title: index % 3 === 0 ? `Session ${index + 1}` : "",
    state: index % 4 === 0 ? "lobby" : "closed",
    gm: index % 5 === 0 ? null : { uuid: `gm-${index + 1}`, nickname: `GM ${index + 1}` },
    participantCount: (index % 6) + 1,
    joinable: index % 4 !== 1,
    currentUserParticipant: index % 7 === 0,
  }));
}

test("directory renders a compact 35-session directory instead of expanded field blocks", async () => {
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
              sessions: createSessionFixture(35),
            },
          };
        },
      };
    },
  });

  assert.equal(document.getElementById("identityUuid").value, "4d8b6f10-4a8b-48f4-b38c-d5128972e289");
  assert.equal(document.getElementById("identityNickname").value, "Alice");
  assert.equal(document.getElementById("sessionDirectory").children.length, 35);
  assert.match(document.getElementById("sessionDirectorySummary").textContent, /35/i);
  assert.match(document.getElementById("sessionDirectorySummary").textContent, /session/i);
  assert.equal(document.getElementById("selectedSessionDetail").children.length, 0);
  assert.equal(/Delete Session/i.test(collectText(document.getElementById("sessionDirectory"))), false);

  for (const item of document.getElementById("sessionDirectory").children.slice(0, 5)) {
    const text = collectText(item);
    assert.equal(item.attributes["data-role"], "session-list-item");
    assert.match(text, /session-|Session /);
    assert.match(text, /lobby|closed/i);
    assert.match(text, /GM /);
    assert.match(text, /participant/i);
    assert.match(text, /Member|Not joined/);
    assert.match(text, /Joinable|Non-joinable/);
    assert.match(text, /Open workspace|Join session|Unavailable/);
    assert.equal(/State:|Participants:|You are in this session|Joinable status:/i.test(text), false);
  }

  assert.equal(fetchCalls[0][0], "/api/identity/local");
  assert.equal(fetchCalls.at(-1)[0], "/api/sessions");
});

test("selecting a compact session item opens detail without navigating and explicit actions drive navigation", async () => {
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
    confirmImpl: () => false,
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
                    sessionId: "session-1",
                    title: "Friday tavern run",
                    state: "lobby",
                    gm: { uuid: "4d8b6f10-4a8b-48f4-b38c-d5128972e289", nickname: "Alice" },
                    participantCount: 1,
                    joinable: true,
                    currentUserParticipant: true,
                  },
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
      if (path === "/api/sessions/session-2") {
        return {
          ok: true,
          headers: { get() { return "application/json"; } },
          async json() {
            return {
              ok: true,
              data: {
                session: {
                  sessionId: "session-2",
                  title: "Open table",
                  state: "lobby",
                  gm: { uuid: "c53f5c97-f2f1-4fa0-a7a8-870e5a73a2b9", nickname: "Bob" },
                  participantCount: 1,
                  joinable: true,
                  currentUserParticipant: false,
                },
                participants: [
                  { identityId: "c53f5c97-f2f1-4fa0-a7a8-870e5a73a2b9", nickname: "Bob", displayName: "Bob", role: "game_master" },
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

  const firstItem = document.getElementById("sessionDirectory").children[0];
  const secondItem = document.getElementById("sessionDirectory").children[1];
  const initialStoredSessionId = storage.getItem("dnd-gm.sessionId");

  await firstItem.listeners.get("click")?.();
  assert.equal(assignedTo, "");
  assert.equal(storage.getItem("dnd-gm.sessionId"), initialStoredSessionId);
  assert.equal(document.getElementById("selectedSessionDetail").children.length, 1);
  assert.match(collectText(document.getElementById("selectedSessionDetail")), /Friday tavern run/);
  assert.match(collectText(document.getElementById("selectedSessionDetail")), /session-1/);
  assert.match(collectText(document.getElementById("selectedSessionDetail")), /Delete Session/i);
  assert.equal(/Delete Session/i.test(collectText(firstItem)), false);

  await secondItem.listeners.get("click")?.();
  assert.equal(assignedTo, "");
  assert.equal(storage.getItem("dnd-gm.sessionId"), initialStoredSessionId);
  assert.equal(document.getElementById("selectedSessionDetail").children.length, 1);
  assert.match(collectText(document.getElementById("selectedSessionDetail")), /Open table/);
  assert.match(collectText(document.getElementById("selectedSessionDetail")), /session-2/);
  assert.match(collectText(document.getElementById("selectedSessionDetail")), /Bob/);
  assert.equal(/Delete Session/i.test(collectText(document.getElementById("selectedSessionDetail"))), false);
  assert.equal(/Delete Session/i.test(collectText(secondItem)), false);
  assert.equal(/State:|Participants:|You are in this session|Joinable status:/i.test(collectText(secondItem)), false);

  const deleteButton = findButtonByText(document.getElementById("selectedSessionDetail"), "Delete Session");
  assert.equal(deleteButton, null);
  assert.equal(fetchCalls.some(([path, method]) => method === "DELETE" && path === "/api/sessions/session-2"), false);
  assert.equal(document.getElementById("sessionDirectory").children.length, 2);
  assert.equal(storage.getItem("dnd-gm.sessionId"), initialStoredSessionId);

  const joinButton = findButtonByText(document.getElementById("selectedSessionDetail"), "Join session");
  await joinButton.listeners.get("click")();

  assert.equal(fetchCalls.at(-1)[0], "/api/sessions/session-2/join");
  assert.equal(storage.getItem("dnd-gm.sessionId"), "session-2");
  assert.equal(assignedTo, "/session.html?sessionId=session-2");
});

test("directory deletion confirmation cancel does not call API or mutate selection", async () => {
  const document = makeDocument();
  const storage = makeStorage({
    "dnd-gm.identity.uuid": "4d8b6f10-4a8b-48f4-b38c-d5128972e289",
    "dnd-gm.identity.nickname": "Alice",
  });
  let confirmCount = 0;
  const fetchCalls = [];

  await initializeDirectoryApp({
    document,
    storage,
    confirmImpl: () => {
      confirmCount += 1;
      return false;
    },
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

  const firstItem = document.getElementById("sessionDirectory").children[0];
  await firstItem.listeners.get("click")?.();
  const deleteButton = findButtonByText(document.getElementById("selectedSessionDetail"), "Delete Session");

  await deleteButton.listeners.get("click")?.();

  assert.equal(confirmCount, 1);
  assert.equal(fetchCalls.some(([path, method]) => method === "DELETE" && path === "/api/sessions/session-1"), false);
  assert.match(collectText(document.getElementById("selectedSessionDetail")), /Friday tavern run/);
  assert.equal(document.getElementById("sessionDirectory").children.length, 1);
});

test("directory deletion success refreshes the list and clears selected detail", async () => {
  const document = makeDocument();
  const storage = makeStorage({
    "dnd-gm.identity.uuid": "4d8b6f10-4a8b-48f4-b38c-d5128972e289",
    "dnd-gm.identity.nickname": "Alice",
  });
  const fetchCalls = [];
  let sessionsCallCount = 0;

  await initializeDirectoryApp({
    document,
    storage,
    confirmImpl: () => true,
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
      if (path === "/api/sessions" && (options.method || "GET") === "GET") {
        sessionsCallCount += 1;
        const sessions = sessionsCallCount === 1
          ? [{
            sessionId: "session-1",
            title: "Friday tavern run",
            state: "lobby",
            gm: { uuid: "4d8b6f10-4a8b-48f4-b38c-d5128972e289", nickname: "Alice" },
            participantCount: 1,
            joinable: true,
            currentUserParticipant: true,
          }]
          : [];
        return {
          ok: true,
          headers: { get() { return "application/json"; } },
          async json() {
            return { ok: true, data: { sessions } };
          },
        };
      }
      if (path === "/api/sessions/session-1" && (options.method || "GET") === "DELETE") {
        return {
          ok: true,
          headers: { get() { return "application/json"; } },
          async json() {
            return { ok: true, data: { sessionId: "session-1", deleted: true } };
          },
        };
      }
      throw new Error(`Unexpected fetch path: ${path}`);
    },
  });

  const firstItem = document.getElementById("sessionDirectory").children[0];
  await firstItem.listeners.get("click")?.();
  const deleteButton = findButtonByText(document.getElementById("selectedSessionDetail"), "Delete Session");

  await deleteButton.listeners.get("click")?.();

  assert.equal(fetchCalls.some(([path, method]) => method === "DELETE" && path === "/api/sessions/session-1"), true);
  assert.equal(document.getElementById("selectedSessionDetail").children.length, 0);
  assert.match(document.getElementById("status").textContent, /Session deleted/);
  assert.match(document.getElementById("sessionDirectorySummary").textContent, /0 session/i);
});
