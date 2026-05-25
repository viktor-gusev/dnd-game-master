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
    assert.equal(json.data.sessions[0].title, "Friday tavern run");
    assert.equal(json.data.sessions[0].participantCount, 1);
    assert.equal(json.data.sessions[0].currentUserParticipant, false);
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
  } finally {
    child.kill("SIGTERM");
    await cleanup();
  }
});
