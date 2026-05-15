import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import Bootstrap from "../../src/Bootstrap.mjs";

function makeDeps() {
  const calls = [];
  const pipeline = {
    addHandler(handler) {
      calls.push(["pipeline.addHandler", handler]);
    },
  };
  const server = {
    start(args) {
      calls.push(["server.start", args]);
    },
    stop() {
      calls.push(["server.stop"]);
    },
  };
  const staticHandler = {
    init(args) {
      calls.push(["staticHandler.init", args]);
    },
  };
  const configFactory = {
    configure(args) {
      calls.push(["configFactory.configure", args]);
    },
    freeze() {
      calls.push(["configFactory.freeze"]);
    },
  };
  const sourceFactory = {
    create(args) {
      calls.push(["sourceFactory.create", args]);
      return { ...args };
    },
  };
  return { calls, pipeline, server, staticHandler, sourceFactory, configFactory };
}

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

function waitForStart() {
  return new Promise((resolve) => setImmediate(resolve));
}

async function waitUntilServerStart(deps) {
  while (!deps.calls.some((x) => x[0] === "server.start")) {
    await waitForStart();
  }
}

test("default port is 3000", async () => {
  await withEnv("PORT", undefined, async () => {
    const deps = makeDeps();
    const app = new Bootstrap(deps);
    const run = app.run({ projectRoot: "/tmp/project", cliArgs: [] });
    await waitUntilServerStart(deps);
    await app.stop();
    assert.deepEqual(deps.calls.find((x) => x[0] === "server.start")[1], { port: 3000, type: "http" });
    await run;
  });
});

test("loads port from .env file", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dnd-gm-app-"));
  await fs.writeFile(path.join(root, ".env"), "PORT=4567\n", "utf8");
  await withEnv("PORT", undefined, async () => {
    const deps = makeDeps();
    const app = new Bootstrap(deps);
    const run = app.run({ projectRoot: root, cliArgs: [] });
    await waitUntilServerStart(deps);
    await app.stop();
    assert.equal(deps.calls.find((x) => x[0] === "server.start")[1].port, 4567);
    await run;
  });
});

test("parses --port 3456", async () => {
  const deps = makeDeps();
  const app = new Bootstrap(deps);
  const run = app.run({ projectRoot: "/tmp/project", cliArgs: ["--port", "3456"] });
  await waitUntilServerStart(deps);
  await app.stop();
  assert.equal(deps.calls.find((x) => x[0] === "server.start")[1].port, 3456);
  await run;
});

test("parses --port=3456", async () => {
  const deps = makeDeps();
  const app = new Bootstrap(deps);
  const run = app.run({ projectRoot: "/tmp/project", cliArgs: ["--port=3456"] });
  await waitUntilServerStart(deps);
  await app.stop();
  assert.equal(deps.calls.find((x) => x[0] === "server.start")[1].port, 3456);
  await run;
});

test("parses -p 3456", async () => {
  const deps = makeDeps();
  const app = new Bootstrap(deps);
  const run = app.run({ projectRoot: "/tmp/project", cliArgs: ["-p", "3456"] });
  await waitUntilServerStart(deps);
  await app.stop();
  assert.equal(deps.calls.find((x) => x[0] === "server.start")[1].port, 3456);
  await run;
});

test("invalid port fails with Error", async () => {
  const app = new Bootstrap(makeDeps());
  await assert.rejects(() => app.run({ projectRoot: "/tmp/project", cliArgs: ["--port", "0"] }), Error);
});

test("initializes static handler and registers it before server start", async () => {
  const deps = makeDeps();
  const app = new Bootstrap(deps);
  const run = app.run({ projectRoot: "/tmp/project", cliArgs: [] });
  await waitUntilServerStart(deps);
  await app.stop();
  assert.deepEqual(deps.calls[0], ["sourceFactory.create", { root: "/tmp/project/web", prefix: "/", allow: { ".": ["."] }, defaults: ["index.html"] }]);
  assert.deepEqual(deps.calls[1], ["staticHandler.init", { sources: [{ root: "/tmp/project/web", prefix: "/", allow: { ".": ["."] }, defaults: ["index.html"] }] }]);
  assert.equal(deps.calls[2][0], "pipeline.addHandler");
  assert.equal(deps.calls[3][0], "configFactory.configure");
  assert.equal(deps.calls[4][0], "configFactory.freeze");
  assert.equal(deps.calls[5][0], "server.start");
  await run;
});

test("run resolves only after stop is called", async () => {
  const deps = makeDeps();
  let release;
  deps.server.stop = () => {
    if (release) release();
  };
  const app = new Bootstrap(deps);
  const run = app.run({ projectRoot: "/tmp/project", cliArgs: [] });
  let settled = false;
  run.then(() => {
    settled = true;
  });
  await waitUntilServerStart(deps);
  assert.equal(settled, false);
  await app.stop();
  assert.equal(await run, 0);
});

test("stop is idempotent", async () => {
  const deps = makeDeps();
  const app = new Bootstrap(deps);
  const run = app.run({ projectRoot: "/tmp/project", cliArgs: [] });
  await waitUntilServerStart(deps);
  await app.stop();
  await app.stop();
  assert.equal(deps.calls.filter((x) => x[0] === "server.stop").length, 1);
  await run;
});

