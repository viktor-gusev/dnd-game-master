import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import ChannelRegistry from "../../../../../src/Store/Memory/EventDelivery/ChannelRegistry.mjs";
import Runtime from "../../../../../src/Service/EventDelivery/Runtime.mjs";

function withEnv(name, value, fn) {
  const previous = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    });
}

function makeRequest(headers = {}) {
  const req = new EventEmitter();
  req.headers = headers;
  return req;
}

function makeResponse() {
  const res = new EventEmitter();
  res.headers = {};
  res.statusCode = 0;
  res.writableEnded = false;
  res.body = "";
  res.setHeader = (name, value) => {
    res.headers[name] = value;
  };
  res.flushHeaders = () => {};
  res.write = (chunk) => {
    res.body += chunk;
    return true;
  };
  res.end = (chunk = "") => {
    if (chunk) res.body += chunk;
    res.writableEnded = true;
    res.emit("close");
  };
  return res;
}

test("runtime requires a DI principal resolver", () => {
  assert.throws(() => new Runtime({ principalResolver: null, channelRegistry: new ChannelRegistry() }), /principal resolver is required/i);
});

test("issueToken validates client instance id and binds token to principal and client", async () => {
  let seenContext = null;
  const registry = new ChannelRegistry();
  const runtime = new Runtime({
    principalResolver: {
      async resolvePrincipalRef(context) {
        seenContext = context;
        return "principal-1";
      },
    },
    channelRegistry: registry,
  });

  const requestContext = { request: { headers: { "x-local-identity-id": "local_1" } } };
  const issued = await runtime.issueToken({
    clientInstanceId: "0123456789abcdef0123456789abcdef",
    requestContext,
  });

  assert.equal(seenContext, requestContext);
  assert.match(issued.streamToken, /^[A-Za-z0-9_-]+$/);
  assert.ok(Date.parse(issued.expiresAt) > Date.now());
  assert.deepEqual(runtime.validateToken(issued.streamToken), {
    token: issued.streamToken,
    clientInstanceId: "0123456789abcdef0123456789abcdef",
    principalRef: "principal-1",
    expiresAt: issued.expiresAt,
  });
  await assert.rejects(() => runtime.issueToken({ clientInstanceId: "bad!", requestContext }), /Invalid client instance id/);
});

test("validateToken rejects missing, invalid, and expired tokens", async () => {
  const registry = new ChannelRegistry();
  const runtime = new Runtime({
    principalResolver: { async resolvePrincipalRef() { return "principal-1"; } },
    channelRegistry: registry,
  });

  assert.throws(() => runtime.validateToken(""), /Missing stream token/);
  assert.throws(() => runtime.validateToken("missing"), /Invalid stream token/);

  registry.saveToken({
    token: "expired-token",
    clientInstanceId: "0123456789abcdef0123456789abcdef",
    principalRef: "principal-1",
    expiresAt: new Date(Date.now() - 1000).toISOString(),
  });
  assert.throws(() => runtime.validateToken("expired-token"), /Expired stream token/);
});

test("openStream emits connected and heartbeat events and cleans the active handle on close", async () => {
  await withEnv("DND_GM_EVENT_DELIVERY_HEARTBEAT_MS", "10", async () => {
    const registry = new ChannelRegistry();
    const runtime = new Runtime({
      principalResolver: { async resolvePrincipalRef() { return "principal-1"; } },
      channelRegistry: registry,
    });
    const issued = await runtime.issueToken({
      clientInstanceId: "0123456789abcdef0123456789abcdef",
      requestContext: {},
    });
    const request = makeRequest();
    const response = makeResponse();

    runtime.openStream({ streamToken: issued.streamToken, request, response });
    await new Promise((resolve) => setTimeout(resolve, 30));

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["content-type"], "text/event-stream; charset=utf-8");
    assert.equal(response.headers["cache-control"], "no-store");
    assert.match(response.body, /event: delivery\.connected/);
    assert.match(response.body, /event: delivery\.heartbeat/);
    assert.equal(registry.countActiveChannels(), 1);

    request.emit("close");
    assert.equal(registry.countActiveChannels(), 0);
  });
});

test("a new stream supersedes the previous active stream for the same client and principal", async () => {
  const registry = new ChannelRegistry();
  const runtime = new Runtime({
    principalResolver: { async resolvePrincipalRef() { return "principal-1"; } },
    channelRegistry: registry,
  });
  const first = await runtime.issueToken({
    clientInstanceId: "0123456789abcdef0123456789abcdef",
    requestContext: {},
  });
  const second = await runtime.issueToken({
    clientInstanceId: "0123456789abcdef0123456789abcdef",
    requestContext: {},
  });

  const firstResponse = makeResponse();
  const secondResponse = makeResponse();

  runtime.openStream({ streamToken: first.streamToken, request: makeRequest(), response: firstResponse });
  runtime.openStream({ streamToken: second.streamToken, request: makeRequest(), response: secondResponse });

  assert.equal(firstResponse.writableEnded, true);
  assert.equal(secondResponse.writableEnded, false);
  assert.equal(registry.countActiveChannels(), 1);
  secondResponse.emit("close");
});

test("a different principal cannot reuse the same client instance while another stream is active", async () => {
  const registry = new ChannelRegistry();
  const runtime = new Runtime({
    principalResolver: { async resolvePrincipalRef() { return "principal-1"; } },
    channelRegistry: registry,
  });

  registry.saveToken({
    token: "token-1",
    clientInstanceId: "0123456789abcdef0123456789abcdef",
    principalRef: "principal-1",
    expiresAt: new Date(Date.now() + 1000).toISOString(),
  });
  registry.saveToken({
    token: "token-2",
    clientInstanceId: "0123456789abcdef0123456789abcdef",
    principalRef: "principal-2",
    expiresAt: new Date(Date.now() + 1000).toISOString(),
  });

  const firstResponse = makeResponse();
  runtime.openStream({ streamToken: "token-1", request: makeRequest(), response: firstResponse });
  assert.throws(() => runtime.openStream({ streamToken: "token-2", request: makeRequest(), response: makeResponse() }), /another principal/);
  firstResponse.emit("close");
});

test("emitExtensionFrame writes a named extension event to every active recipient channel", async () => {
  const registry = new ChannelRegistry();
  const runtime = new Runtime({
    principalResolver: { async resolvePrincipalRef() { return "principal-1"; } },
    channelRegistry: registry,
  });

  registry.saveToken({
    token: "token-1",
    clientInstanceId: "0123456789abcdef0123456789abcdef",
    principalRef: "principal-1",
    expiresAt: new Date(Date.now() + 1000).toISOString(),
  });
  registry.saveToken({
    token: "token-2",
    clientInstanceId: "fedcba9876543210fedcba9876543210",
    principalRef: "principal-1",
    expiresAt: new Date(Date.now() + 1000).toISOString(),
  });

  const firstResponse = makeResponse();
  const secondResponse = makeResponse();
  runtime.openStream({ streamToken: "token-1", request: makeRequest(), response: firstResponse });
  runtime.openStream({ streamToken: "token-2", request: makeRequest(), response: secondResponse });

  const delivered = runtime.emitExtensionFrame({
    name: "session.messages.changed",
    principalRefs: ["principal-1"],
    payload: { sessionId: "session-1", reason: "message_appended", messageId: "msg_1" },
  });

  assert.equal(delivered.length, 2);
  assert.match(firstResponse.body, /event: session\.messages\.changed/);
  assert.match(firstResponse.body, /"kind":"extension"/);
  assert.match(firstResponse.body, /"name":"session\.messages\.changed"/);
  assert.match(firstResponse.body, /"clientInstanceId":"0123456789abcdef0123456789abcdef"/);
  assert.doesNotMatch(firstResponse.body, /"text":/);
  assert.match(secondResponse.body, /"clientInstanceId":"fedcba9876543210fedcba9876543210"/);

  firstResponse.emit("close");
  secondResponse.emit("close");
});
