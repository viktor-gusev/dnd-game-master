import test from "node:test";
import assert from "node:assert/strict";

import App from "../../src/App.mjs";

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

test("default port is 3000", async () => {
  const deps = makeDeps();
  const app = new App(deps);
  const run = app.run({ projectRoot: "/tmp/project", cliArgs: [] });
  await Promise.resolve();
  await app.stop();
  assert.deepEqual(deps.calls.find((x) => x[0] === "server.start")[1], { port: 3000, type: "http" });
  await run;
});

test("parses --port 3456", async () => {
  const deps = makeDeps();
  const app = new App(deps);
  const run = app.run({ projectRoot: "/tmp/project", cliArgs: ["--port", "3456"] });
  await Promise.resolve();
  await app.stop();
  assert.equal(deps.calls.find((x) => x[0] === "server.start")[1].port, 3456);
  await run;
});

test("parses --port=3456", async () => {
  const deps = makeDeps();
  const app = new App(deps);
  const run = app.run({ projectRoot: "/tmp/project", cliArgs: ["--port=3456"] });
  await Promise.resolve();
  await app.stop();
  assert.equal(deps.calls.find((x) => x[0] === "server.start")[1].port, 3456);
  await run;
});

test("parses -p 3456", async () => {
  const deps = makeDeps();
  const app = new App(deps);
  const run = app.run({ projectRoot: "/tmp/project", cliArgs: ["-p", "3456"] });
  await Promise.resolve();
  await app.stop();
  assert.equal(deps.calls.find((x) => x[0] === "server.start")[1].port, 3456);
  await run;
});

test("invalid port fails with Error", async () => {
  const app = new App(makeDeps());
  await assert.rejects(() => app.run({ projectRoot: "/tmp/project", cliArgs: ["--port", "0"] }), Error);
});

test("initializes static handler and registers it before server start", async () => {
  const deps = makeDeps();
  const app = new App(deps);
  const run = app.run({ projectRoot: "/tmp/project", cliArgs: [] });
  await Promise.resolve();
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
  const app = new App(deps);
  const run = app.run({ projectRoot: "/tmp/project", cliArgs: [] });
  let settled = false;
  run.then(() => {
    settled = true;
  });
  await Promise.resolve();
  assert.equal(settled, false);
  await app.stop();
  assert.equal(await run, 0);
});

test("stop is idempotent", async () => {
  const deps = makeDeps();
  const app = new App(deps);
  const run = app.run({ projectRoot: "/tmp/project", cliArgs: [] });
  await Promise.resolve();
  await app.stop();
  await app.stop();
  assert.equal(deps.calls.filter((x) => x[0] === "server.stop").length, 1);
  await run;
});
