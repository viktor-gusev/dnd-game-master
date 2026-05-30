import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import DataStore from "../../src/Store/File/Data.mjs";

function getFreePort() { return new Promise((resolve, reject) => { const server = net.createServer(); server.listen(0, "127.0.0.1", () => { const address = server.address(); server.close(() => resolve(address.port)); }); server.on("error", reject); }); }
async function waitFor(url, timeoutMs = 10000) { const started = Date.now(); while (Date.now() - started < timeoutMs) { try { const res = await fetch(url); if (res.ok) return res; } catch {} await new Promise((resolve) => setTimeout(resolve, 100)); } throw new Error(`Timeout waiting for ${url}`); }
async function startApp(port, env = {}) { const child = spawn(process.execPath, ["./bin/cli.mjs", "--port", String(port)], { cwd: process.cwd(), env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] }); await waitFor(`http://127.0.0.1:${port}/`); return child; }

test("campaign API supports create join brief events credits and deletion", async () => {
  const port = await getFreePort();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dnd-gm-api-contract-"));
  process.env.DND_GM_DATA_ROOT = path.join(root, "data");
  const child = await startApp(port, { DND_GM_DATA_ROOT: path.join(root, "data") });
  const cleanup = () => new Promise((resolve) => child.once("exit", resolve));
  try {
    let res = await fetch(`http://127.0.0.1:${port}/api/identity/local`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ uuid: "4d8b6f10-4a8b-48f4-b38c-d5128972e289", nickname: "Alice" }) });
    let json = await res.json();
    const alice = json.data.identity.uuid;
    res = await fetch(`http://127.0.0.1:${port}/api/campaigns`, { method: "POST", headers: { "content-type": "application/json", "x-local-identity-id": alice }, body: JSON.stringify({ title: "Friday tavern run" }) });
    json = await res.json();
    assert.equal(json.ok, true);
    const campaignId = json.data.campaignId;
    res = await fetch(`http://127.0.0.1:${port}/api/campaigns/${campaignId}/brief`, { headers: { "x-local-identity-id": alice } });
    json = await res.json();
    assert.equal(json.ok, true);
    assert.match(JSON.stringify(json.data.brief), /Friday tavern run/);
    res = await fetch(`http://127.0.0.1:${port}/api/identity/local`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ uuid: "c53f5c97-f2f1-4fa0-a7a8-870e5a73a2b9", nickname: "Bob" }) });
    json = await res.json();
    const bob = json.data.identity.uuid;
    res = await fetch(`http://127.0.0.1:${port}/api/campaigns/${campaignId}/join`, { method: "POST", headers: { "content-type": "application/json", "x-local-identity-id": bob }, body: "{}" });
    json = await res.json();
    assert.equal(json.ok, true);
    res = await fetch(`http://127.0.0.1:${port}/api/campaigns/${campaignId}/events`, { headers: { "x-local-identity-id": bob } });
    json = await res.json();
    assert.equal(json.ok, true);
    assert.equal(json.data.events.some((event) => event.type === "player.joined"), true);
    const store = new DataStore();
    const draft = await store.createAIDraft(campaignId, { title: "Prep draft", content: "Draft content" }, { id: alice, nickname: "Alice" });
    const draftId = draft.aiDraft.draftId;
    const regenerated = await store.regenerateAIDraft(campaignId, draftId, { id: alice, nickname: "Alice" });
    assert.equal(regenerated.sourceDraftId, draftId);
    res = await fetch(`http://127.0.0.1:${port}/api/campaigns/${campaignId}/credits`, { headers: { "x-local-identity-id": alice } });
    json = await res.json();
    assert.equal(json.ok, true);
    assert.equal(json.data.credits.length >= 2, true);
    res = await fetch(`http://127.0.0.1:${port}/api/campaigns/${campaignId}`, { method: "DELETE", headers: { "x-local-identity-id": alice } });
    json = await res.json();
    assert.equal(json.ok, true);
    res = await fetch(`http://127.0.0.1:${port}/api/campaigns/${campaignId}`, { headers: { "x-local-identity-id": alice } });
    json = await res.json();
    assert.equal(res.status, 404);
    assert.equal(json.error.code, "unknown_campaign");
  } finally {
    child.kill("SIGTERM");
    await cleanup();
  }
});

test("character sheet reads project draft data by role and keep private fields hidden from other players", async () => {
  const port = await getFreePort();
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dnd-gm-character-"));
  process.env.DND_GM_DATA_ROOT = path.join(root, "data");
  const child = await startApp(port, { DND_GM_DATA_ROOT: path.join(root, "data") });
  const cleanup = () => new Promise((resolve) => child.once("exit", resolve));
  try {
    let res = await fetch(`http://127.0.0.1:${port}/api/identity/local`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ uuid: "4d8b6f10-4a8b-48f4-b38c-d5128972e289", nickname: "Alice" }) });
    let json = await res.json();
    const alice = json.data.identity.uuid;
    res = await fetch(`http://127.0.0.1:${port}/api/campaigns`, { method: "POST", headers: { "content-type": "application/json", "x-local-identity-id": alice }, body: JSON.stringify({ title: "Workshop" }) });
    json = await res.json();
    const campaignId = json.data.campaignId;
    res = await fetch(`http://127.0.0.1:${port}/api/campaigns/${campaignId}/character-sheets`, { method: "POST", headers: { "content-type": "application/json", "x-local-identity-id": alice }, body: JSON.stringify({ structuredProfile: { identity: { name: "Asha" }, gmHooks: "Hidden", playerIntent: { playStyle: "Support" } } }) });
    json = await res.json();
    const sheetId = json.data.characterSheet.sheetId;
    res = await fetch(`http://127.0.0.1:${port}/api/identity/local`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ uuid: "c53f5c97-f2f1-4fa0-a7a8-870e5a73a2b9", nickname: "Bob" }) });
    json = await res.json();
    const bob = json.data.identity.uuid;
    res = await fetch(`http://127.0.0.1:${port}/api/campaigns/${campaignId}/join`, { method: "POST", headers: { "content-type": "application/json", "x-local-identity-id": bob }, body: "{}" });
    json = await res.json();
    assert.equal(json.ok, true);
    res = await fetch(`http://127.0.0.1:${port}/api/campaigns/${campaignId}/character-sheets/${sheetId}`, { headers: { "x-local-identity-id": bob } });
    json = await res.json();
    assert.equal(json.ok, true);
    assert.equal(json.data.characterSheet.structuredProfile.gmHooks, undefined);
    assert.equal(json.data.characterSheet.structuredProfile.playerIntent, undefined);
  } finally {
    child.kill("SIGTERM");
    await cleanup();
  }
});
