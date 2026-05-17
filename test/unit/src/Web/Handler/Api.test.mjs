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
      body: "",
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
    async upsertIdentity(displayName) {
      const identity = { id: `id_${displayName}`, displayName };
      this.identities.set(identity.id, identity);
      return identity;
    },
    async getIdentity(identityId) {
      return this.identities.get(identityId) || null;
    },
    async createSession(identity) {
      const session = { id: "session_1", state: "lobby", createdBy: identity.id };
      this.sessions.set(session.id, { session, participants: [{ identityId: identity.id, displayName: identity.displayName }], messages: [] });
      return session;
    },
    async loadSession(sessionId) {
      return this.sessions.get(sessionId) || null;
    },
    async joinSession(sessionId, identity) {
      const current = this.sessions.get(sessionId);
      if (!current) return null;
      current.participants.push({ identityId: identity.id, displayName: identity.displayName });
      return current.session;
    },
    async appendMessage(sessionId, message) {
      this.sessions.get(sessionId)?.messages.push(message);
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

test("POST /api/identity/local returns normalized success envelope", async () => {
  const handler = new ApiHandler({ dataStore: makeDataStore(), eventDelivery: makeEventDelivery() });
  const context = makeContext();
  context.request.method = "POST";
  context.request.url = "http://localhost/api/identity/local";
  context.request = Object.assign(context.request, {
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify({ displayName: "Alice" }));
    },
  });

  await handler.handle(context);

  assert.equal(context.completed, true);
  assert.equal(context.response.statusCode, 200);
  assert.match(context.response.body, /"ok":true/);
  assert.match(context.response.body, /"identityId":"id_Alice"/);
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

test("POST /api/event-delivery/token rejects principalRef in request body", async () => {
  const handler = new ApiHandler({ dataStore: makeDataStore(), eventDelivery: makeEventDelivery() });
  const context = makeContext();
  context.request.method = "POST";
  context.request.url = "http://localhost/api/event-delivery/token";
  context.request = Object.assign(context.request, {
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify({
        clientInstanceId: "0123456789abcdef0123456789abcdef",
        principalRef: "spoofed",
      }));
    },
  });

  await handler.handle(context);

  assert.equal(context.response.statusCode, 400);
  assert.match(context.response.body, /"invalid_input"/);
});

test("POST /api/sessions/:sessionId/messages emits a freshness notification after append", async () => {
  const dataStore = makeDataStore();
  const identity = await dataStore.upsertIdentity("Alice");
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
});

test("POST /api/sessions/:sessionId/messages rejects non-participants and emits nothing", async () => {
  const dataStore = makeDataStore();
  const alice = await dataStore.upsertIdentity("Alice");
  const bob = await dataStore.upsertIdentity("Bob");
  await dataStore.createSession(alice);
  const eventDelivery = makeEventDelivery();
  const handler = new ApiHandler({ dataStore, eventDelivery });
  const context = makeContext();
  context.request.method = "POST";
  context.request.url = "http://localhost/api/sessions/session_1/messages";
  context.request.headers["x-local-identity-id"] = bob.id;
  context.request = Object.assign(context.request, {
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify({ text: "Intrusion" }));
    },
  });

  await handler.handle(context);

  assert.equal(context.response.statusCode, 400);
  assert.equal(eventDelivery.emittedFrames.length, 0);
  assert.equal(dataStore.sessions.get("session_1").messages.length, 0);
});

test("POST /api/sessions/:sessionId/messages stays successful when notification delivery fails", async () => {
  const dataStore = makeDataStore();
  const identity = await dataStore.upsertIdentity("Alice");
  await dataStore.createSession(identity);
  const eventDelivery = makeEventDelivery();
  eventDelivery.emitExtensionFrame = () => {
    throw new Error("delivery failed");
  };
  const handler = new ApiHandler({ dataStore, eventDelivery });
  const context = makeContext();
  context.request.method = "POST";
  context.request.url = "http://localhost/api/sessions/session_1/messages";
  context.request.headers["x-local-identity-id"] = identity.id;
  context.request = Object.assign(context.request, {
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify({ text: "Still persisted" }));
    },
  });

  await handler.handle(context);

  assert.equal(context.response.statusCode, 200);
  assert.equal(dataStore.sessions.get("session_1").messages.length, 1);
});

test("POST /api/sessions/:sessionId/messages does not emit a notification when append fails", async () => {
  const dataStore = makeDataStore();
  const identity = await dataStore.upsertIdentity("Alice");
  await dataStore.createSession(identity);
  dataStore.appendMessage = async () => {
    throw new Error("append failed");
  };
  const eventDelivery = makeEventDelivery();
  const handler = new ApiHandler({ dataStore, eventDelivery });
  const context = makeContext();
  context.request.method = "POST";
  context.request.url = "http://localhost/api/sessions/session_1/messages";
  context.request.headers["x-local-identity-id"] = identity.id;
  context.request = Object.assign(context.request, {
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify({ text: "No notify" }));
    },
  });

  await handler.handle(context);

  assert.equal(context.response.statusCode, 500);
  assert.equal(eventDelivery.emittedFrames.length, 0);
});

test("GET /api/sessions/:sessionId/messages requires a participant identity", async () => {
  const dataStore = makeDataStore();
  const alice = await dataStore.upsertIdentity("Alice");
  const bob = await dataStore.upsertIdentity("Bob");
  await dataStore.createSession(alice);
  const handler = new ApiHandler({ dataStore, eventDelivery: makeEventDelivery() });

  const missingIdentity = makeContext();
  missingIdentity.request.method = "GET";
  missingIdentity.request.url = "http://localhost/api/sessions/session_1/messages";
  await handler.handle(missingIdentity);
  assert.equal(missingIdentity.response.statusCode, 400);

  const nonParticipant = makeContext();
  nonParticipant.request.method = "GET";
  nonParticipant.request.url = "http://localhost/api/sessions/session_1/messages";
  nonParticipant.request.headers["x-local-identity-id"] = bob.id;
  await handler.handle(nonParticipant);
  assert.equal(nonParticipant.response.statusCode, 400);
});
