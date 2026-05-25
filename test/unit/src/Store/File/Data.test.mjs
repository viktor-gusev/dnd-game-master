import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import DataStore from "../../../../../src/Store/File/Data.mjs";

test("file store persists identities sessions participants and messages", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dnd-gm-"));
  process.env.DND_GM_DATA_ROOT = path.join(root, "data");
  const store = new DataStore();

  const identity = await store.upsertIdentity("4d8b6f10-4a8b-48f4-b38c-d5128972e289", "Alice");
  const created = await store.createSession(identity, { title: "Friday tavern run" });
  await store.joinSession(created.session.sessionId, identity);
  await store.appendMessage(created.session.sessionId, {
    id: "msg_1",
    sessionId: created.session.sessionId,
    identityId: identity.id,
    nickname: identity.nickname,
    displayName: identity.nickname,
    type: "player_action",
    text: "Hello there",
    createdAt: "2026-05-10T00:00:00.000Z",
  });

  const reloaded = new DataStore();
  const current = await reloaded.loadSession(created.session.sessionId, identity.id);
  assert.equal(current.session.sessionId, created.session.sessionId);
  assert.equal(current.session.gm.nickname, "Alice");
  assert.equal(current.participants[0].identityId, identity.id);
  assert.equal(current.participants[0].role, "game_master");
  assert.equal(current.messages[0].text, "Hello there");
  assert.equal(current.messages[0].displayName, "Alice");

  const identitiesText = await fs.readFile(path.join(process.env.DND_GM_DATA_ROOT, "identities.json"), "utf8");
  assert.match(identitiesText, /"nickname": "Alice"/);
  const sessionText = await fs.readFile(path.join(process.env.DND_GM_DATA_ROOT, "sessions", created.session.sessionId, "session.json"), "utf8");
  assert.match(sessionText, /"title": "Friday tavern run"/);
  const participantsText = await fs.readFile(path.join(process.env.DND_GM_DATA_ROOT, "sessions", created.session.sessionId, "participants.json"), "utf8");
  assert.match(participantsText, /"role": "game_master"/);
  const messageText = await fs.readFile(path.join(process.env.DND_GM_DATA_ROOT, "sessions", created.session.sessionId, "messages.ndjson"), "utf8");
  assert.match(messageText, /"text":"Hello there"/);
  assert.match(messageText, /"displayName":"Alice"/);
});

test("file store lists summary data for the session directory", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dnd-gm-"));
  process.env.DND_GM_DATA_ROOT = path.join(root, "data");
  const store = new DataStore();

  const identity = await store.upsertIdentity("4d8b6f10-4a8b-48f4-b38c-d5128972e289", "Alice");
  await store.createSession(identity, { title: "Friday tavern run" });

  const summaries = await store.listSessions(identity.id);

  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].title, "Friday tavern run");
  assert.equal(summaries[0].participantCount, 1);
  assert.equal(summaries[0].currentUserParticipant, true);
  assert.equal(summaries[0].joinable, true);
});

test("file store rejects invalid session ids", async () => {
  const store = new DataStore();
  assert.throws(() => store.sessionDir("../escape"), /Invalid session id/);
});
