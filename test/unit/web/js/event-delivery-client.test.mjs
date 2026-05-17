import test from "node:test";
import assert from "node:assert/strict";

import { createEventDeliveryChannel, getOrCreateClientInstanceId } from "../../../../web/js/event-delivery-client.js";

function makeStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    values,
  };
}

test("getOrCreateClientInstanceId persists one runtime id in session storage", () => {
  const storage = makeStorage();
  const first = getOrCreateClientInstanceId(storage);
  const second = getOrCreateClientInstanceId(storage);

  assert.match(first, /^[a-f0-9]{32}$/);
  assert.equal(second, first);
});

test("event delivery channel requests a token with clientInstanceId only and tracks connected state", async () => {
  const fetchCalls = [];
  const createdUrls = [];
  const listeners = new Map();
  let state = "closed";

  const channel = createEventDeliveryChannel({
    clientInstanceId: "0123456789abcdef0123456789abcdef",
    getRequestHeaders() {
      return { "x-local-identity-id": "identity-1" };
    },
    fetchImpl: async (path, options) => {
      fetchCalls.push([path, options]);
      return {
        ok: true,
        async json() {
          return { ok: true, data: { streamToken: "token-1", expiresAt: "2026-05-17T00:00:00.000Z" } };
        },
      };
    },
    eventSourceFactory: (url) => {
      createdUrls.push(url);
      return {
        addEventListener(name, listener) {
          listeners.set(name, listener);
        },
        close() {},
      };
    },
    onStateChange(next) {
      state = next;
    },
  });

  await channel.start();
  listeners.get("delivery.connected")?.();

  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0][0], "/api/event-delivery/token");
  assert.deepEqual(JSON.parse(fetchCalls[0][1].body), {
    clientInstanceId: "0123456789abcdef0123456789abcdef",
  });
  assert.equal(fetchCalls[0][1].headers["x-local-identity-id"], "identity-1");
  assert.equal(createdUrls[0], "/api/event-delivery/stream?token=token-1");
  assert.equal(state, "connected");
});
