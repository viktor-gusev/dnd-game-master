import test from "node:test";
import assert from "node:assert/strict";

import ConfigRuntime, { Factory } from "../../../../src/Config/Runtime.mjs";

test("wrapper rejects reads before initialization", () => {
  const runtime = new ConfigRuntime();
  assert.throws(() => runtime.httpPort, /initialized/i);
});

test("factory accepts configuration, freezes state, and returns a read-only wrapper", () => {
  const factory = new Factory();

  factory.configure({
    httpPort: 8080,
  });
  const runtime = factory.freeze();

  assert.equal(runtime.httpPort, 8080);
  assert.throws(() => {
    runtime.httpPort = 9000;
  }, /immutable/i);
});

test("configure uses first write wins", () => {
  const factory = new Factory();

  factory.configure({ httpPort: 8080 });
  factory.configure({ httpPort: 9090 });
  const runtime = factory.freeze();

  assert.equal(runtime.httpPort, 8080);
});

test("freeze applies defaults for missing fields", () => {
  const factory = new Factory();

  factory.configure({});
  const runtime = factory.freeze();

  assert.equal(runtime.httpPort, 3000);
  assert.equal(runtime.dataRoot, "var/data");
  assert.equal(runtime.aiProvider, "fake");
});

test("freeze is idempotent", () => {
  const factory = new Factory();

  factory.configure({ httpPort: 3000 });
  const runtime1 = factory.freeze();
  const runtime2 = factory.freeze();

  assert.equal(runtime1, runtime2);
});
