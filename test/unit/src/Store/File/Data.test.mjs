import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import DataStore from "../../../../../src/Store/File/Data.mjs";

async function createStore({ now } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dnd-gm-"));
  process.env.DND_GM_DATA_ROOT = path.join(root, "data");
  return {
    root,
    store: new DataStore(now ? { now } : {}),
  };
}

function iso(text) {
  return new Date(text).toISOString();
}

test("file store persists identities sessions participants messages and last activity", async () => {
  const now = () => new Date("2026-05-20T10:00:00.000Z");
  const { store } = await createStore({ now });

  const identity = await store.upsertIdentity("4d8b6f10-4a8b-48f4-b38c-d5128972e289", "Alice");
  const created = await store.createSession(identity, { title: "Friday tavern run" });
  const joined = await store.joinSession(created.session.sessionId, identity);
  assert.equal(joined.participants.length, 1);

  await store.appendMessage(created.session.sessionId, {
    id: "msg_1",
    sessionId: created.session.sessionId,
    identityId: identity.id,
    nickname: identity.nickname,
    displayName: identity.nickname,
    type: "player_action",
    text: "Hello there",
    createdAt: "2026-05-21T00:00:00.000Z",
  });

  const reloaded = new DataStore({ now });
  const current = await reloaded.loadSession(created.session.sessionId, identity.id);
  assert.equal(current.session.sessionId, created.session.sessionId);
  assert.equal(current.session.gm.nickname, "Alice");
  assert.equal(current.participants[0].identityId, identity.id);
  assert.equal(current.participants[0].role, "game_master");
  assert.equal(current.messages[0].text, "Hello there");
  assert.equal(current.messages[0].displayName, "Alice");
  assert.equal(current.session.lastActivityAt, "2026-05-21T00:00:00.000Z");

  const sessionText = await fs.readFile(path.join(process.env.DND_GM_DATA_ROOT, "sessions", created.session.sessionId, "session.json"), "utf8");
  assert.match(sessionText, /"title": "Friday tavern run"/);
  assert.match(sessionText, /"lastActivityAt": "2026-05-21T00:00:00.000Z"/);
});

test("file store lists summary data for the session directory", async () => {
  const { store } = await createStore();
  const identity = await store.upsertIdentity("4d8b6f10-4a8b-48f4-b38c-d5128972e289", "Alice");
  await store.createSession(identity, { title: "Friday tavern run" });

  const summaries = await store.listSessions(identity.id);

  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].title, "Friday tavern run");
  assert.equal(summaries[0].participantCount, 1);
  assert.equal(summaries[0].currentUserParticipant, true);
  assert.equal(summaries[0].joinable, true);
  assert.ok(summaries[0].lastActivityAt);
});

test("file store updates last activity when a new participant joins", async () => {
  let currentNow = iso("2026-05-20T10:00:00.000Z");
  const now = () => new Date(currentNow);
  const { store } = await createStore({ now });
  const alice = await store.upsertIdentity("4d8b6f10-4a8b-48f4-b38c-d5128972e289", "Alice");
  const bob = await store.upsertIdentity("c53f5c97-f2f1-4fa0-a7a8-870e5a73a2b9", "Bob");
  const created = await store.createSession(alice, { title: "Friday tavern run" });

  currentNow = iso("2026-05-20T12:00:00.000Z");
  await store.joinSession(created.session.sessionId, bob);

  const current = await store.loadSession(created.session.sessionId, bob.id);
  assert.equal(current.participants.length, 2);
  assert.equal(current.session.lastActivityAt, "2026-05-20T12:00:00.000Z");
});

test("file store deletes only the requested session subtree", async () => {
  const { store } = await createStore();
  const alice = await store.upsertIdentity("4d8b6f10-4a8b-48f4-b38c-d5128972e289", "Alice");
  const first = await store.createSession(alice, { title: "First" });
  const second = await store.createSession(alice, { title: "Second" });

  const deleted = await store.deleteSession(first.session.sessionId);

  assert.equal(deleted, true);
  assert.equal(await store.loadSession(first.session.sessionId, alice.id), null);
  assert.ok(await fs.stat(path.join(process.env.DND_GM_DATA_ROOT, "sessions", second.session.sessionId)));
});

test("file store cleanup removes only expired and old-format session directories", async () => {
  const now = () => new Date("2026-05-20T00:00:00.000Z");
  const { store } = await createStore({ now });
  await store.init();
  const sessionsRoot = path.join(process.env.DND_GM_DATA_ROOT, "sessions");
  const expiredId = "expired";
  const boundaryId = "boundary";
  const freshId = "fresh";
  const legacyId = "legacy";
  const malformedId = "malformed";
  const unrelatedFile = path.join(process.env.DND_GM_DATA_ROOT, "keep.txt");

  await fs.writeFile(unrelatedFile, "keep", "utf8");

  for (const id of [expiredId, boundaryId, freshId, legacyId, malformedId]) {
    await fs.mkdir(path.join(sessionsRoot, id), { recursive: true });
  }

  await fs.writeFile(path.join(sessionsRoot, expiredId, "session.json"), JSON.stringify({
    sessionId: expiredId,
    title: "Expired",
    state: "lobby",
    gm: { uuid: "gm", nickname: "GM" },
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-09T23:59:59.999Z",
    lastActivityAt: "2026-05-09T23:59:59.999Z",
  }), "utf8");
  await fs.writeFile(path.join(sessionsRoot, boundaryId, "session.json"), JSON.stringify({
    sessionId: boundaryId,
    title: "Boundary",
    state: "lobby",
    gm: { uuid: "gm", nickname: "GM" },
    createdAt: "2026-05-10T00:00:00.000Z",
    updatedAt: "2026-05-10T00:00:00.000Z",
    lastActivityAt: "2026-05-10T00:00:00.000Z",
  }), "utf8");
  await fs.writeFile(path.join(sessionsRoot, freshId, "session.json"), JSON.stringify({
    sessionId: freshId,
    title: "Fresh",
    state: "lobby",
    gm: { uuid: "gm", nickname: "GM" },
    createdAt: "2026-05-19T00:00:00.000Z",
    updatedAt: "2026-05-19T00:00:00.000Z",
    lastActivityAt: "2026-05-19T00:00:00.000Z",
  }), "utf8");
  await fs.writeFile(path.join(sessionsRoot, legacyId, "session.json"), JSON.stringify({
    sessionId: legacyId,
    title: "Legacy",
    state: "lobby",
    gm: { uuid: "gm", nickname: "GM" },
    createdAt: "2026-05-01T00:00:00.000Z",
    updatedAt: "2026-05-01T00:00:00.000Z",
  }), "utf8");
  await fs.writeFile(path.join(sessionsRoot, malformedId, "session.json"), "{bad json", "utf8");

  const removed = await store.cleanupExpiredSessions();

  assert.deepEqual(removed.sort(), [expiredId, legacyId, malformedId]);
  await assert.rejects(fs.stat(path.join(sessionsRoot, expiredId)));
  assert.ok(await fs.stat(path.join(sessionsRoot, boundaryId)));
  assert.ok(await fs.stat(path.join(sessionsRoot, freshId)));
  assert.equal(await fs.readFile(unrelatedFile, "utf8"), "keep");
});

test("file store rejects invalid session ids", async () => {
  const store = new DataStore();
  assert.throws(() => store.sessionDir("../escape"), /Invalid session id/);
});
