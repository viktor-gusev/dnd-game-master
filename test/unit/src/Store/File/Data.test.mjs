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

  const identity = await store.upsertIdentity("Alice");
  const session = await store.createSession(identity);
  await store.joinSession(session.id, identity);
  await store.appendMessage(session.id, {
    id: "msg_1",
    sessionId: session.id,
    identityId: identity.id,
    type: "player_action",
    text: "Hello there",
    createdAt: "2026-05-10T00:00:00.000Z",
  });

  const reloaded = new DataStore();
  const current = await reloaded.loadSession(session.id);
  assert.equal(current.session.id, session.id);
  assert.equal(current.participants[0].identityId, identity.id);
  assert.equal(current.messages[0].text, "Hello there");

  const identitiesText = await fs.readFile(path.join(process.env.DND_GM_DATA_ROOT, "identities.json"), "utf8");
  assert.match(identitiesText, /"displayName": "Alice"/);
  const messageText = await fs.readFile(path.join(process.env.DND_GM_DATA_ROOT, "sessions", session.id, "messages.ndjson"), "utf8");
  assert.match(messageText, /"text":"Hello there"/);
});

test("file store rejects invalid session ids", async () => {
  const store = new DataStore();
  assert.throws(() => store.sessionDir("../escape"), /Invalid session id/);
});
