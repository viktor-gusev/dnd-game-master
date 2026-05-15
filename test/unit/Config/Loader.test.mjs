import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import ConfigLoader from "../../../src/Config/Loader.mjs";

function makeRuntimeFactory() {
  const calls = [];
  return {
    calls,
    configure(params) {
      calls.push(["configure", params]);
    },
    freeze() {
      calls.push(["freeze"]);
      return { frozen: true };
    },
  };
}

async function writeEnvFile(content) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dnd-gm-config-loader-"));
  await fs.writeFile(path.join(root, ".env"), content, "utf8");
  return root;
}

test("loads defaults when .env is missing", async () => {
  const runtimeFactory = makeRuntimeFactory();
  const loader = new ConfigLoader({ fs, path, appCfgRuntimeFactory: runtimeFactory });
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dnd-gm-config-loader-"));

  const runtime = await loader.load({ projectRoot: root });

  assert.deepEqual(runtimeFactory.calls, [
    ["configure", { httpPort: 3000 }],
    ["freeze"],
  ]);
  assert.deepEqual(runtime, { frozen: true });
});

test("parses .env values and validates PORT", async () => {
  const runtimeFactory = makeRuntimeFactory();
  const loader = new ConfigLoader({ fs, path, appCfgRuntimeFactory: runtimeFactory });
  const root = await writeEnvFile([
    "# comment",
    "HOST=0.0.0.0",
    "PORT=8080",
    "WORKSPACE_ROOT=/tmp/work",
    "WEBHOOK_SECRET=secret",
    "",
  ].join("\n"));

  const runtime = await loader.load({ projectRoot: root });

  assert.deepEqual(runtimeFactory.calls, [
    ["configure", { httpPort: 8080 }],
    ["freeze"],
  ]);
  assert.deepEqual(runtime, { frozen: true });
});

test("rejects invalid PORT values", async () => {
  const runtimeFactory = makeRuntimeFactory();
  const loader = new ConfigLoader({ fs, path, appCfgRuntimeFactory: runtimeFactory });
  const root = await writeEnvFile("PORT=abc\n");

  await assert.rejects(() => loader.load({ projectRoot: root }), /PORT/i);
  assert.deepEqual(runtimeFactory.calls, []);
});

test("accepts quoted values", async () => {
  const runtimeFactory = makeRuntimeFactory();
  const loader = new ConfigLoader({ fs, path, appCfgRuntimeFactory: runtimeFactory });
  const root = await writeEnvFile('PORT="8081"\n');

  await loader.load({ projectRoot: root });

  assert.deepEqual(runtimeFactory.calls[0][1], { httpPort: 8081 });
});
