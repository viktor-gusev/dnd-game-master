import test from "node:test";
import assert from "node:assert/strict";

import ApiHandler from "../../../../src/Web/Handler/Api.mjs";

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
      this.sessions.set(session.id, { session, participants: [{ identityId: identity.id, displayName: identity.displayName }] });
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
    async appendMessage() {},
  };
}

test("registration info reports PROCESS stage", () => {
  const handler = new ApiHandler({ dataStore: makeDataStore() });
  assert.deepEqual(handler.getRegistrationInfo(), { name: "Dnd_Gm_Web_Handler_Api", stage: "PROCESS" });
});

test("POST /api/identity/local returns normalized success envelope", async () => {
  const handler = new ApiHandler({ dataStore: makeDataStore() });
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
  const handler = new ApiHandler({ dataStore: makeDataStore() });
  const context = makeContext();
  context.request.method = "GET";
  context.request.url = "http://localhost/api/identity/current";

  await handler.handle(context);

  assert.equal(context.response.statusCode, 400);
  assert.match(context.response.body, /"missing_identity"/);
});

