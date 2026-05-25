import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
    server.on("error", reject);
  });
}

async function waitFor(url, timeoutMs = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timeout waiting for ${url}`);
}

async function startApp(port, env = {}) {
  const child = spawn(process.execPath, ["./bin/cli.mjs", "--port", String(port)], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitFor(`http://127.0.0.1:${port}/`);
  return child;
}

async function createIdentity(port, uuid, nickname) {
  const res = await fetch(`http://127.0.0.1:${port}/api/identity/local`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ uuid, nickname }),
  });
  const json = await res.json();
  return { res, json };
}

test("first-slice api contract and persistence flow", async () => {
  const port = await getFreePort();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dnd-gm-api-contract-"));
  const child = await startApp(port, { DND_GM_DATA_ROOT: path.join(root, "data") });
  const cleanup = () => new Promise((resolve) => child.once("exit", resolve));

  try {
    let result = await createIdentity(port, "4d8b6f10-4a8b-48f4-b38c-d5128972e289", "Alice");
    assert.equal(result.res.status, 200);
    assert.equal(result.res.headers.get("content-type"), "application/json; charset=utf-8");
    assert.equal(result.json.ok, true);
    const identityId = result.json.data.identity.uuid;

    let res = await fetch(`http://127.0.0.1:${port}/api/identity/current`, {
      headers: { "x-local-identity-id": identityId },
    });
    let json = await res.json();
    assert.equal(json.ok, true);
    assert.equal(json.data.identity.id, identityId);

    res = await fetch(`http://127.0.0.1:${port}/api/sessions`, {
      headers: { "x-local-identity-id": identityId },
    });
    json = await res.json();
    assert.equal(json.ok, true);
    assert.deepEqual(json.data.sessions, []);

    res = await fetch(`http://127.0.0.1:${port}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-local-identity-id": identityId },
      body: JSON.stringify({ title: "Friday tavern run" }),
    });
    json = await res.json();
    assert.equal(json.ok, true);
    const sessionId = json.data.sessionId;
    assert.match(sessionId, /^[a-f0-9]+$/);
    assert.equal(json.data.session.gm.nickname, "Alice");

    result = await createIdentity(port, "c53f5c97-f2f1-4fa0-a7a8-870e5a73a2b9", "Bob");
    const bobId = result.json.data.identity.uuid;

    res = await fetch(`http://127.0.0.1:${port}/api/sessions`, {
      headers: { "x-local-identity-id": bobId },
    });
    json = await res.json();
    assert.equal(json.ok, true);
    assert.equal(json.data.sessions[0].sessionId, sessionId);
    assert.equal(json.data.sessions[0].title, "Friday tavern run");
    assert.equal(json.data.sessions[0].state, "lobby");
    assert.equal(json.data.sessions[0].gm.nickname, "Alice");
    assert.equal(json.data.sessions[0].participantCount, 1);
    assert.equal(json.data.sessions[0].joinable, true);
    assert.equal(json.data.sessions[0].currentUserParticipant, false);
    assert.equal("participants" in json.data.sessions[0], false);
    assert.equal("messages" in json.data.sessions[0], false);

    res = await fetch(`http://127.0.0.1:${port}/api/sessions/${sessionId}/join`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-local-identity-id": bobId },
      body: "{}",
    });
    json = await res.json();
    assert.equal(json.ok, true);

    res = await fetch(`http://127.0.0.1:${port}/api/sessions/${sessionId}`, {
      headers: { "x-local-identity-id": bobId },
    });
    json = await res.json();
    assert.equal(json.ok, true);
    assert.equal(json.data.participants.length, 2);

    res = await fetch(`http://127.0.0.1:${port}/api/sessions/${sessionId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-local-identity-id": bobId },
      body: JSON.stringify({ text: "We enter the tavern." }),
    });
    json = await res.json();
    assert.equal(json.ok, true);
    assert.equal(json.data.message.type, "player_action");
    assert.equal(json.data.message.identityId, bobId);

    res = await fetch(`http://127.0.0.1:${port}/api/sessions/${sessionId}/messages`, {
      headers: { "x-local-identity-id": bobId },
    });
    json = await res.json();
    assert.equal(json.ok, true);
    assert.equal(json.data.messages[0].text, "We enter the tavern.");

    res = await fetch(`http://127.0.0.1:${port}/api/sessions/${sessionId}/messages`);
    json = await res.json();
    assert.equal(res.status, 400);
    assert.equal(json.error.code, "missing_identity");

    res = await fetch(`http://127.0.0.1:${port}/api/sessions/${sessionId}`, {
      method: "DELETE",
      headers: { "x-local-identity-id": bobId },
    });
    json = await res.json();
    assert.equal(res.status, 403);
    assert.equal(json.error.code, "forbidden");

    res = await fetch(`http://127.0.0.1:${port}/api/sessions/${sessionId}`, {
      method: "DELETE",
      headers: { "x-local-identity-id": identityId },
    });
    json = await res.json();
    assert.equal(res.status, 200);
    assert.equal(json.ok, true);
    assert.equal(json.data.deleted, true);

    res = await fetch(`http://127.0.0.1:${port}/api/sessions`, {
      headers: { "x-local-identity-id": identityId },
    });
    json = await res.json();
    assert.equal(json.ok, true);
    assert.equal(json.data.sessions.length, 0);

    res = await fetch(`http://127.0.0.1:${port}/api/sessions/${sessionId}`, {
      headers: { "x-local-identity-id": identityId },
    });
    json = await res.json();
    assert.equal(res.status, 404);
    assert.equal(json.error.code, "unknown_session");

    res = await fetch(`http://127.0.0.1:${port}/api/sessions/${sessionId}/messages`, {
      headers: { "x-local-identity-id": identityId },
    });
    json = await res.json();
    assert.equal(res.status, 404);
    assert.equal(json.error.code, "unknown_session");

    res = await fetch(`http://127.0.0.1:${port}/api/sessions/${sessionId}/join`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-local-identity-id": bobId },
      body: "{}",
    });
    json = await res.json();
    assert.equal(res.status, 404);
    assert.equal(json.error.code, "unknown_session");

    res = await fetch(`http://127.0.0.1:${port}/api/sessions/${sessionId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-local-identity-id": identityId },
      body: JSON.stringify({ text: "Still there?" }),
    });
    json = await res.json();
    assert.equal(res.status, 404);
    assert.equal(json.error.code, "unknown_session");
  } finally {
    child.kill("SIGTERM");
    await cleanup();
  }
});

test("api returns stable errors for invalid and missing input", async () => {
  const port = await getFreePort();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dnd-gm-api-contract-"));
  const child = await startApp(port, { DND_GM_DATA_ROOT: path.join(root, "data") });
  const cleanup = () => new Promise((resolve) => child.once("exit", resolve));

  try {
    const identity = await createIdentity(port, "4d8b6f10-4a8b-48f4-b38c-d5128972e289", "Alice");
    const identityId = identity.json.data.identity.uuid;

    let res = await fetch(`http://127.0.0.1:${port}/api/identity/current`);
    let json = await res.json();
    assert.equal(res.status, 400);
    assert.equal(json.ok, false);
    assert.equal(json.error.code, "missing_identity");

    res = await fetch(`http://127.0.0.1:${port}/api/identity/current`, {
      headers: { "x-local-identity-id": "11111111-1111-4111-8111-111111111111" },
    });
    json = await res.json();
    assert.equal(res.status, 400);
    assert.equal(json.error.code, "unknown_identity");

    res = await fetch(`http://127.0.0.1:${port}/api/identity/local`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ uuid: "bad-uuid", nickname: "Alice" }),
    });
    json = await res.json();
    assert.equal(res.status, 400);
    assert.equal(json.error.code, "invalid_input");

    res = await fetch(`http://127.0.0.1:${port}/api/sessions/bad.id`, {
      headers: { "x-local-identity-id": identityId },
    });
    json = await res.json();
    assert.equal(res.status, 400);
    assert.equal(json.error.code, "invalid_session_id");

    res = await fetch(`http://127.0.0.1:${port}/api/does-not-exist`);
    json = await res.json();
    assert.equal(res.status, 404);
    assert.equal(json.error.code, "not_found");

    res = await fetch(`http://127.0.0.1:${port}/api/sessions/session_1`, {
      method: "DELETE",
    });
    json = await res.json();
    assert.equal(res.status, 400);
    assert.equal(json.error.code, "missing_identity");

    res = await fetch(`http://127.0.0.1:${port}/api/sessions/session_1`, {
      method: "DELETE",
      headers: { "x-local-identity-id": "11111111-1111-4111-8111-111111111111" },
    });
    json = await res.json();
    assert.equal(res.status, 400);
    assert.equal(json.error.code, "unknown_identity");

    res = await fetch(`http://127.0.0.1:${port}/api/sessions/session_1`, {
      method: "DELETE",
      headers: { "x-local-identity-id": identityId },
    });
    json = await res.json();
    assert.equal(res.status, 404);
    assert.equal(json.ok, false);
    assert.equal(json.error.code, "unknown_session");
  } finally {
    child.kill("SIGTERM");
    await cleanup();
  }
});

test("startup cleanup removes expired and old-format sessions before requests are served", async () => {
  const port = await getFreePort();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dnd-gm-api-cleanup-"));
  const dataRoot = path.join(root, "data");
  const sessionsRoot = path.join(dataRoot, "sessions");
  await fs.mkdir(sessionsRoot, { recursive: true });

  const expiredId = "expired-session";
  const boundaryId = "boundary-session";
  const freshId = "fresh-session";
  const legacyId = "legacy-session";
  const malformedId = "malformed-session";
  const boundaryTime = new Date(Date.now() - (10 * 24 * 60 * 60 * 1000) + 1000).toISOString();
  const freshTime = new Date(Date.now() - (2 * 24 * 60 * 60 * 1000)).toISOString();

  await fs.mkdir(path.join(sessionsRoot, expiredId), { recursive: true });
  await fs.writeFile(path.join(sessionsRoot, expiredId, "session.json"), JSON.stringify({
    sessionId: expiredId,
    title: "Expired",
    state: "lobby",
    gm: { uuid: "gm-1", nickname: "Alice" },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    lastActivityAt: "2026-01-01T00:00:00.000Z",
  }), "utf8");

  await fs.mkdir(path.join(sessionsRoot, boundaryId), { recursive: true });
  await fs.writeFile(path.join(sessionsRoot, boundaryId, "session.json"), JSON.stringify({
    sessionId: boundaryId,
    title: "Boundary",
    state: "lobby",
    gm: { uuid: "gm-1", nickname: "Alice" },
    createdAt: boundaryTime,
    updatedAt: boundaryTime,
    lastActivityAt: boundaryTime,
  }), "utf8");

  await fs.mkdir(path.join(sessionsRoot, freshId), { recursive: true });
  await fs.writeFile(path.join(sessionsRoot, freshId, "session.json"), JSON.stringify({
    sessionId: freshId,
    title: "Fresh",
    state: "lobby",
    gm: { uuid: "gm-1", nickname: "Alice" },
    createdAt: freshTime,
    updatedAt: freshTime,
    lastActivityAt: freshTime,
  }), "utf8");

  await fs.mkdir(path.join(sessionsRoot, legacyId), { recursive: true });
  await fs.writeFile(path.join(sessionsRoot, legacyId, "session.json"), JSON.stringify({
    sessionId: legacyId,
    title: "Legacy",
    state: "lobby",
    gm: { uuid: "gm-1", nickname: "Alice" },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }), "utf8");

  await fs.mkdir(path.join(sessionsRoot, malformedId), { recursive: true });
  await fs.writeFile(path.join(sessionsRoot, malformedId, "session.json"), "{bad json", "utf8");

  const child = await startApp(port, { DND_GM_DATA_ROOT: dataRoot });
  const cleanup = () => new Promise((resolve) => child.once("exit", resolve));

  try {
    const identity = await createIdentity(port, "4d8b6f10-4a8b-48f4-b38c-d5128972e289", "Alice");
    const identityId = identity.json.data.identity.uuid;

    const res = await fetch(`http://127.0.0.1:${port}/api/sessions`, {
      headers: { "x-local-identity-id": identityId },
    });
    const json = await res.json();

    assert.equal(json.ok, true);
    assert.deepEqual(json.data.sessions.map((session) => session.sessionId).sort(), [boundaryId, freshId]);
    await assert.rejects(fs.stat(path.join(sessionsRoot, expiredId)));
    await assert.rejects(fs.stat(path.join(sessionsRoot, legacyId)));
    await assert.rejects(fs.stat(path.join(sessionsRoot, malformedId)));
    assert.ok(await fs.stat(path.join(sessionsRoot, boundaryId)));
    assert.ok(await fs.stat(path.join(sessionsRoot, freshId)));
  } finally {
    child.kill("SIGTERM");
    await cleanup();
  }
});
