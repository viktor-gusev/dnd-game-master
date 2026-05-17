import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";

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

async function startApp(port) {
  const child = spawn(process.execPath, ["./bin/cli.mjs", "--port", String(port)], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitFor(`http://127.0.0.1:${port}/`);
  return child;
}

test("first-slice api contract and persistence flow", async () => {
  const port = await getFreePort();
  const child = await startApp(port);
  const cleanup = () => new Promise((resolve) => child.once("exit", resolve));

  try {
    let res = await fetch(`http://127.0.0.1:${port}/api/identity/local`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Alice" }),
    });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("content-type"), "application/json; charset=utf-8");
    let json = await res.json();
    assert.equal(json.ok, true);
    assert.ok(json.data.identityId);
    const identityId = json.data.identityId;

    res = await fetch(`http://127.0.0.1:${port}/api/identity/current`, {
      headers: { "x-local-identity-id": identityId },
    });
    json = await res.json();
    assert.equal(json.ok, true);
    assert.equal(json.data.identity.id, identityId);

    res = await fetch(`http://127.0.0.1:${port}/api/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-local-identity-id": identityId },
      body: "{}",
    });
    json = await res.json();
    assert.equal(json.ok, true);
    const sessionId = json.data.sessionId;
    assert.match(sessionId, /^[a-f0-9]+$/);

    const bob = await (await fetch(`http://127.0.0.1:${port}/api/identity/local`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ displayName: "Bob" }),
    })).json();
    const bobId = bob.data.identityId;

    res = await fetch(`http://127.0.0.1:${port}/api/sessions/${sessionId}/join`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-local-identity-id": bobId },
      body: "{}",
    });
    json = await res.json();
    assert.equal(json.ok, true);

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

    res = await fetch(`http://127.0.0.1:${port}/api/sessions/${sessionId}`);
    json = await res.json();
    assert.equal(json.ok, true);
    assert.equal(json.data.participants.length, 2);
  } finally {
    child.kill("SIGTERM");
    await cleanup();
  }
});

test("api returns stable errors for invalid and missing input", async () => {
  const port = await getFreePort();
  const child = await startApp(port);
  const cleanup = () => new Promise((resolve) => child.once("exit", resolve));

  try {
    let res = await fetch(`http://127.0.0.1:${port}/api/identity/current`);
    let json = await res.json();
    assert.equal(res.status, 400);
    assert.equal(json.ok, false);
    assert.equal(json.error.code, "missing_identity");

    res = await fetch(`http://127.0.0.1:${port}/api/identity/current`, {
      headers: { "x-local-identity-id": "unknown" },
    });
    json = await res.json();
    assert.equal(res.status, 400);
    assert.equal(json.error.code, "unknown_identity");

    res = await fetch(`http://127.0.0.1:${port}/api/sessions/bad.id`);
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
