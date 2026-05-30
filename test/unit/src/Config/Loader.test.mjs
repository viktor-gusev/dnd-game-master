import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import ConfigLoader from "../../../../src/Config/Loader.mjs";

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

test("loads runtime env keys including data root and AI provider settings", async () => {
  const runtimeFactory = makeRuntimeFactory();
  const loader = new ConfigLoader({ fs, path, appCfgRuntimeFactory: runtimeFactory });
  const root = await writeEnvFile([
    "PORT=8082",
    "DND_GM_DATA_ROOT=/tmp/dnd-gm-data",
    "AI_PROVIDER=openai",
    "OPENAI_API_KEY=sk-test",
    "OPENAI_DEFAULT_MODEL=gpt-4.1-mini",
    "OPENAI_IMAGE_MODEL=gpt-image-1",
    "AI_PROVIDER_TIMEOUT_MS=60000",
    "AI_MAX_INPUT_TOKENS=12000",
    "AI_MAX_OUTPUT_TOKENS=2048",
    "AI_CREDIT_PREAUTH_MULTIPLIER=2",
    "AI_DEFAULT_PRICING_POLICY_ID=pricing-openai-standard-v1",
    "AI_CAMPAIGN_INITIAL_CREDITS=100",
  ].join("\n"));

  await loader.load({ projectRoot: root });

  assert.deepEqual(runtimeFactory.calls[0][1], {
    httpPort: 8082,
    dataRoot: "/tmp/dnd-gm-data",
    aiProvider: "openai",
    openaiApiKey: "sk-test",
    openaiDefaultModel: "gpt-4.1-mini",
    openaiImageModel: "gpt-image-1",
    aiProviderTimeoutMs: 60000,
    aiMaxInputTokens: 12000,
    aiMaxOutputTokens: 2048,
    aiCreditPreauthMultiplier: 2,
    aiDefaultPricingPolicyId: "pricing-openai-standard-v1",
    aiCampaignInitialCredits: 100,
  });
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
