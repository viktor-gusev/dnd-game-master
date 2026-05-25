import test from "node:test";
import assert from "node:assert/strict";

import ApiHandler from "../../../../../src/Web/Handler/Api.mjs";

function makeContext() {
  const response = {
    writableEnded: false,
    statusCode: 0,
    headers: {},
    body: "",
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(body) {
      this.body = body;
      this.writableEnded = true;
    },
  };
  const context = {
    request: {
      method: "GET",
      url: "http://localhost/",
      headers: {},
      async *[Symbol.asyncIterator]() {},
    },
    response,
    completed: false,
    complete() {
      this.completed = true;
    },
  };
  return context;
}

function makeDataStore() {
  return {
    identities: new Map(),
    sessions: new Map(),
    async upsertIdentity(uuid, nickname) {
      const identity = { id: uuid, uuid, nickname, displayName: nickname };
      this.identities.set(identity.id, identity);
      return identity;
    },
    async getIdentity(identityId) {
      return this.identities.get(identityId) || null;
    },
    async listSessions(identityId = "") {
      return Array.from(this.sessions.values()).map((current) => ({
        ...current.session,
        participantCount: current.participants.length,
        joinable: true,
        currentUserParticipant: !!identityId && current.participants.some((participant) => participant.identityId === identityId),
      }));
    },
    async createSession(identity, { title } = {}) {
      const session = {
        id: "session_1",
        sessionId: "session_1",
        title: title || "Session session",
        state: "lobby",
        gm: { uuid: identity.id, nickname: identity.nickname },
        lastActivityAt: "2026-05-17T00:00:00.000Z",
      };
      const current = {
        session: {
          ...session,
          participantCount: 1,
          joinable: true,
          currentUserParticipant: true,
        },
        participants: [{ identityId: identity.id, nickname: identity.nickname, displayName: identity.nickname, role: "game_master" }],
        messages: [],
      };
      this.sessions.set(session.sessionId, current);
      return current;
    },
    async loadSession(sessionId, identityId = "") {
      const current = this.sessions.get(sessionId);
      if (!current) return null;
      return {
        session: {
          ...current.session,
          participantCount: current.participants.length,
          joinable: true,
          currentUserParticipant: !!identityId && current.participants.some((participant) => participant.identityId === identityId),
        },
        participants: current.participants,
        messages: current.messages,
      };
    },
    async joinSession(sessionId, identity) {
      const current = this.sessions.get(sessionId);
      if (!current) return null;
      if (!current.participants.some((participant) => participant.identityId === identity.id)) {
        current.participants.push({ identityId: identity.id, nickname: identity.nickname, displayName: identity.nickname, role: "player" });
      }
      return this.loadSession(sessionId, identity.id);
    },
    async appendMessage(sessionId, message) {
      this.sessions.get(sessionId)?.messages.push(message);
    },
    async deleteSession(sessionId) {
      return this.sessions.delete(sessionId);
    },
  };
}

function makeEventDelivery() {
  return {
    issuedTokens: [],
    emittedFrames: [],
    issueToken({ clientInstanceId, requestContext }) {
      this.issuedTokens.push({ clientInstanceId, requestContext });
      return Promise.resolve({ streamToken: "token-1", expiresAt: "2026-05-17T00:00:00.000Z" });
    },
    emitExtensionFrame(frame) {
      this.emittedFrames.push(frame);
      return [];
    },
    openStream() {},
  };
}

test("registration info reports PROCESS stage", () => {
  const handler = new ApiHandler({ dataStore: makeDataStore(), eventDelivery: makeEventDelivery() });
  assert.deepEqual(handler.getRegistrationInfo(), { name: "Dnd_Gm_Web_Handler_Api", stage: "PROCESS" });
});

test("POST /api/identity/local returns browser-declared local identity", async () => {
  const handler = new ApiHandler({ dataStore: makeDataStore(), eventDelivery: makeEventDelivery() });
  const context = makeContext();
  context.request.method = "POST";
  context.request.url = "http://localhost/api/identity/local";
  context.request = Object.assign(context.request, {
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify({
        uuid: "4d8b6f10-4a8b-48f4-b38c-d5128972e289",
        nickname: "Alice",
      }));
    },
  });

  await handler.handle(context);

  assert.equal(context.completed, true);
  assert.equal(context.response.statusCode, 200);
  assert.match(context.response.body, /"uuid":"4d8b6f10-4a8b-48f4-b38c-d5128972e289"/);
  assert.match(context.response.body, /"nickname":"Alice"/);
});

test("GET /api/identity/current rejects missing identity header", async () => {
  const handler = new ApiHandler({ dataStore: makeDataStore(), eventDelivery: makeEventDelivery() });
  const context = makeContext();
  context.request.method = "GET";
  context.request.url = "http://localhost/api/identity/current";

  await handler.handle(context);

  assert.equal(context.response.statusCode, 400);
  assert.match(context.response.body, /"missing_identity"/);
});

test("GET /api/sessions returns summary data only", async () => {
  const dataStore = makeDataStore();
  const identity = await dataStore.upsertIdentity("4d8b6f10-4a8b-48f4-b38c-d5128972e289", "Alice");
  await dataStore.createSession(identity, { title: "Friday tavern run" });
  const handler = new ApiHandler({ dataStore, eventDelivery: makeEventDelivery() });
  const context = makeContext();
  context.request.method = "GET";
  context.request.url = "http://localhost/api/sessions";
  context.request.headers["x-local-identity-id"] = identity.id;

  await handler.handle(context);

  assert.equal(context.response.statusCode, 200);
  assert.match(context.response.body, /"sessionId":"session_1"/);
  assert.match(context.response.body, /"title":"Friday tavern run"/);
  assert.match(context.response.body, /"state":"lobby"/);
  assert.match(context.response.body, /"gm":\{"uuid":"4d8b6f10-4a8b-48f4-b38c-d5128972e289","nickname":"Alice"\}/);
  assert.match(context.response.body, /"participantCount":1/);
  assert.match(context.response.body, /"joinable":true/);
  assert.match(context.response.body, /"currentUserParticipant":true/);
  assert.equal(/"participants"/.test(context.response.body), false);
  assert.equal(/"messages"/.test(context.response.body), false);
});

test("DELETE /api/sessions/:sessionId lets the Game Master delete the session", async () => {
  const dataStore = makeDataStore();
  const identity = await dataStore.upsertIdentity("4d8b6f10-4a8b-48f4-b38c-d5128972e289", "Alice");
  await dataStore.createSession(identity, { title: "Friday tavern run" });
  const handler = new ApiHandler({ dataStore, eventDelivery: makeEventDelivery() });
  const context = makeContext();
  context.request.method = "DELETE";
  context.request.url = "http://localhost/api/sessions/session_1";
  context.request.headers["x-local-identity-id"] = identity.id;

  await handler.handle(context);

  assert.equal(context.response.statusCode, 200);
  assert.match(context.response.body, /"deleted":true/);
  assert.equal(dataStore.sessions.has("session_1"), false);
});

test("DELETE /api/sessions/:sessionId rejects non-Game-Master deletion", async () => {
  const dataStore = makeDataStore();
  const alice = await dataStore.upsertIdentity("4d8b6f10-4a8b-48f4-b38c-d5128972e289", "Alice");
  const bob = await dataStore.upsertIdentity("c53f5c97-f2f1-4fa0-a7a8-870e5a73a2b9", "Bob");
  await dataStore.createSession(alice, { title: "Friday tavern run" });
  await dataStore.joinSession("session_1", bob);
  const handler = new ApiHandler({ dataStore, eventDelivery: makeEventDelivery() });
  const context = makeContext();
  context.request.method = "DELETE";
  context.request.url = "http://localhost/api/sessions/session_1";
  context.request.headers["x-local-identity-id"] = bob.id;

  await handler.handle(context);

  assert.equal(context.response.statusCode, 403);
  assert.match(context.response.body, /"forbidden"/);
  assert.equal(dataStore.sessions.has("session_1"), true);
});

test("POST /api/event-delivery/token sends only clientInstanceId to the runtime and disables caching", async () => {
  const eventDelivery = makeEventDelivery();
  const handler = new ApiHandler({ dataStore: makeDataStore(), eventDelivery });
  const context = makeContext();
  context.request.method = "POST";
  context.request.url = "http://localhost/api/event-delivery/token";
  context.request = Object.assign(context.request, {
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify({ clientInstanceId: "0123456789abcdef0123456789abcdef" }));
    },
  });

  await handler.handle(context);

  assert.equal(context.response.statusCode, 200);
  assert.equal(context.response.headers["cache-control"], "no-store");
  assert.equal(eventDelivery.issuedTokens[0].clientInstanceId, "0123456789abcdef0123456789abcdef");
  assert.equal(eventDelivery.issuedTokens[0].requestContext, context);
  assert.match(context.response.body, /"streamToken":"token-1"/);
});

test("POST /api/sessions/:sessionId/messages emits a freshness notification after append", async () => {
  const dataStore = makeDataStore();
  const identity = await dataStore.upsertIdentity("4d8b6f10-4a8b-48f4-b38c-d5128972e289", "Alice");
  await dataStore.createSession(identity);
  const eventDelivery = makeEventDelivery();
  const handler = new ApiHandler({ dataStore, eventDelivery });
  const context = makeContext();
  context.request.method = "POST";
  context.request.url = "http://localhost/api/sessions/session_1/messages";
  context.request.headers["x-local-identity-id"] = identity.id;
  context.request = Object.assign(context.request, {
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify({ text: "Hello there", type: "player_action" }));
    },
  });

  await handler.handle(context);

  assert.equal(context.response.statusCode, 200);
  assert.equal(dataStore.sessions.get("session_1").messages.length, 1);
  assert.equal(eventDelivery.emittedFrames.length, 1);
  assert.equal(eventDelivery.emittedFrames[0].name, "session.messages.changed");
  assert.deepEqual(eventDelivery.emittedFrames[0].principalRefs, [identity.id]);
  assert.equal(eventDelivery.emittedFrames[0].payload.sessionId, "session_1");
  assert.equal(eventDelivery.emittedFrames[0].payload.reason, "message_appended");
  assert.ok(eventDelivery.emittedFrames[0].payload.messageId);
  assert.equal("text" in eventDelivery.emittedFrames[0].payload, false);
  assert.equal(dataStore.sessions.get("session_1").messages[0].displayName, "Alice");
  assert.ok(dataStore.sessions.get("session_1").messages[0].createdAt);
});

test("GET /api/sessions/:sessionId/messages rejects non-participants", async () => {
  const dataStore = makeDataStore();
  const alice = await dataStore.upsertIdentity("4d8b6f10-4a8b-48f4-b38c-d5128972e289", "Alice");
  const bob = await dataStore.upsertIdentity("c53f5c97-f2f1-4fa0-a7a8-870e5a73a2b9", "Bob");
  await dataStore.createSession(alice);
  const handler = new ApiHandler({ dataStore, eventDelivery: makeEventDelivery() });
  const context = makeContext();
  context.request.method = "GET";
  context.request.url = "http://localhost/api/sessions/session_1/messages";
  context.request.headers["x-local-identity-id"] = bob.id;

  await handler.handle(context);

  assert.equal(context.response.statusCode, 400);
  assert.match(context.response.body, /"invalid_input"/);
});
