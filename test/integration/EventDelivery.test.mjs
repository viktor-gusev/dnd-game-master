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

async function startApp(port, env = {}) {
  const child = spawn(process.execPath, ["./bin/cli.mjs", "--port", String(port)], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await waitFor(`http://127.0.0.1:${port}/`);
  return child;
}

async function createIdentity(port, displayName) {
  const res = await fetch(`http://127.0.0.1:${port}/api/identity/local`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ displayName }),
  });
  const json = await res.json();
  return json.data.identityId;
}

async function requestToken(port, identityId, body) {
  const res = await fetch(`http://127.0.0.1:${port}/api/event-delivery/token`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-local-identity-id": identityId,
    },
    body: JSON.stringify(body),
  });
  return { res, json: await res.json() };
}

async function readSseEvents(response, count) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  const events = [];

  while (events.length < count) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });

    let delimiterIndex = text.indexOf("\n\n");
    while (delimiterIndex >= 0) {
      const raw = text.slice(0, delimiterIndex);
      text = text.slice(delimiterIndex + 2);
      const eventName = raw.match(/^event: (.+)$/m)?.[1];
      const dataText = raw.match(/^data: (.+)$/m)?.[1];
      if (eventName && dataText) {
        events.push({ event: eventName, data: JSON.parse(dataText) });
      }
      delimiterIndex = text.indexOf("\n\n");
      if (events.length >= count) break;
    }
  }

  return { events, reader };
}

test("token endpoint returns a no-store JSON envelope with a stream token", async () => {
  const port = await getFreePort();
  const child = await startApp(port);
  const cleanup = () => new Promise((resolve) => child.once("exit", resolve));

  try {
    const identityId = await createIdentity(port, "Alice");
    const { res, json } = await requestToken(port, identityId, {
      clientInstanceId: "0123456789abcdef0123456789abcdef",
    });

    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.equal(json.ok, true);
    assert.match(json.data.streamToken, /^[A-Za-z0-9_-]+$/);
    assert.ok(Date.parse(json.data.expiresAt) > Date.now());
  } finally {
    child.kill("SIGTERM");
    await cleanup();
  }
});

test("token endpoint rejects missing or malformed clientInstanceId and unresolved principal", async () => {
  const port = await getFreePort();
  const child = await startApp(port);
  const cleanup = () => new Promise((resolve) => child.once("exit", resolve));

  try {
    const identityId = await createIdentity(port, "Alice");

    let result = await requestToken(port, identityId, {});
    assert.equal(result.res.status, 400);
    assert.equal(result.json.error.code, "invalid_client_instance_id");

    result = await requestToken(port, identityId, { clientInstanceId: "bad!" });
    assert.equal(result.res.status, 400);
    assert.equal(result.json.error.code, "invalid_client_instance_id");

    result = await fetch(`http://127.0.0.1:${port}/api/event-delivery/token`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientInstanceId: "0123456789abcdef0123456789abcdef" }),
    }).then(async (res) => ({ res, json: await res.json() }));
    assert.equal(result.res.status, 400);
    assert.equal(result.json.error.code, "missing_identity");
  } finally {
    child.kill("SIGTERM");
    await cleanup();
  }
});

test("stream endpoint opens an SSE channel, emits control events, and avoids JSON envelopes", async () => {
  const port = await getFreePort();
  const child = await startApp(port, { DND_GM_EVENT_DELIVERY_HEARTBEAT_MS: "20" });
  const cleanup = () => new Promise((resolve) => child.once("exit", resolve));

  try {
    const identityId = await createIdentity(port, "Alice");
    const { json } = await requestToken(port, identityId, {
      clientInstanceId: "0123456789abcdef0123456789abcdef",
    });

    const response = await fetch(`http://127.0.0.1:${port}/api/event-delivery/stream?token=${encodeURIComponent(json.data.streamToken)}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "text/event-stream; charset=utf-8");
    assert.equal(response.headers.get("cache-control"), "no-store");

    const { events, reader } = await readSseEvents(response, 2);
    assert.equal(events[0].event, "delivery.connected");
    assert.equal(events[0].data.kind, "control");
    assert.equal(events[0].data.name, "delivery.connected");
    assert.equal(events[1].event, "delivery.heartbeat");
    assert.equal(events[1].data.name, "delivery.heartbeat");
    assert.equal(events[1].data.clientInstanceId, "0123456789abcdef0123456789abcdef");

    await reader.cancel();
  } finally {
    child.kill("SIGTERM");
    await cleanup();
  }
});

test("a new stream supersedes the previous stream for the same client instance and principal", async () => {
  const port = await getFreePort();
  const child = await startApp(port, { DND_GM_EVENT_DELIVERY_HEARTBEAT_MS: "20" });
  const cleanup = () => new Promise((resolve) => child.once("exit", resolve));

  try {
    const identityId = await createIdentity(port, "Alice");
    const clientInstanceId = "0123456789abcdef0123456789abcdef";
    const firstToken = await requestToken(port, identityId, { clientInstanceId });
    const firstResponse = await fetch(`http://127.0.0.1:${port}/api/event-delivery/stream?token=${encodeURIComponent(firstToken.json.data.streamToken)}`);
    const firstReader = firstResponse.body.getReader();
    await firstReader.read();

    const secondToken = await requestToken(port, identityId, { clientInstanceId });
    const secondResponse = await fetch(`http://127.0.0.1:${port}/api/event-delivery/stream?token=${encodeURIComponent(secondToken.json.data.streamToken)}`);
    const secondRead = await readSseEvents(secondResponse, 1);

    const firstDone = await firstReader.read();
    assert.equal(firstDone.done, true);
    assert.equal(secondRead.events[0].event, "delivery.connected");
    await secondRead.reader.cancel();
  } finally {
    child.kill("SIGTERM");
    await cleanup();
  }
});

test("a different principal cannot reuse the same client instance while a stream is active", async () => {
  const port = await getFreePort();
  const child = await startApp(port);
  const cleanup = () => new Promise((resolve) => child.once("exit", resolve));

  try {
    const clientInstanceId = "0123456789abcdef0123456789abcdef";
    const aliceId = await createIdentity(port, "Alice");
    const bobId = await createIdentity(port, "Bob");
    const aliceToken = await requestToken(port, aliceId, { clientInstanceId });
    const aliceResponse = await fetch(`http://127.0.0.1:${port}/api/event-delivery/stream?token=${encodeURIComponent(aliceToken.json.data.streamToken)}`);
    const aliceReader = aliceResponse.body.getReader();
    await aliceReader.read();

    const bobToken = await requestToken(port, bobId, { clientInstanceId });
    const rejected = await fetch(`http://127.0.0.1:${port}/api/event-delivery/stream?token=${encodeURIComponent(bobToken.json.data.streamToken)}`);
    const rejectedJson = await rejected.json();

    assert.equal(rejected.status, 409);
    assert.equal(rejectedJson.error.code, "security_conflict");
    await aliceReader.cancel();
  } finally {
    child.kill("SIGTERM");
    await cleanup();
  }
});

test("stream endpoint rejects missing, invalid, and expired tokens before opening the stream", async () => {
  const port = await getFreePort();
  const child = await startApp(port, { DND_GM_EVENT_DELIVERY_TOKEN_TTL_MS: "25" });
  const cleanup = () => new Promise((resolve) => child.once("exit", resolve));

  try {
    let response = await fetch(`http://127.0.0.1:${port}/api/event-delivery/stream`);
    let json = await response.json();
    assert.equal(response.status, 400);
    assert.equal(json.error.code, "missing_token");

    response = await fetch(`http://127.0.0.1:${port}/api/event-delivery/stream?token=invalid`);
    json = await response.json();
    assert.equal(response.status, 401);
    assert.equal(json.error.code, "invalid_token");

    const identityId = await createIdentity(port, "Alice");
    const token = await requestToken(port, identityId, {
      clientInstanceId: "0123456789abcdef0123456789abcdef",
    });
    await new Promise((resolve) => setTimeout(resolve, 40));

    response = await fetch(`http://127.0.0.1:${port}/api/event-delivery/stream?token=${encodeURIComponent(token.json.data.streamToken)}`);
    json = await response.json();
    assert.equal(response.status, 401);
    assert.equal(json.error.code, "expired_token");
  } finally {
    child.kill("SIGTERM");
    await cleanup();
  }
});
