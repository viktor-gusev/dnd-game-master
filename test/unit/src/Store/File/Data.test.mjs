import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import DataStore from "../../../../../src/Store/File/Data.mjs";

async function createStore({ now } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "dnd-gm-"));
  process.env.DND_GM_DATA_ROOT = path.join(root, "data");
  return { root, store: new DataStore(now ? { now } : {}) };
}

test("file store persists campaigns under var/data/campaigns and records events and credits", async () => {
  const { store } = await createStore();
  const alice = await store.upsertIdentity("4d8b6f10-4a8b-48f4-b38c-d5128972e289", "Alice");
  const created = await store.createCampaign(alice, { title: "Friday tavern run" });
  const joined = await store.joinCampaign(created.campaignId, await store.upsertIdentity("c53f5c97-f2f1-4fa0-a7a8-870e5a73a2b9", "Bob"));
  const brief = await store.updateBrief(created.campaignId, { summary: "Updated" }, alice);
  const draftResult = await store.createAIDraft(created.campaignId, { title: "Prep draft", content: "Draft content" }, alice);
  const regenerated = await store.regenerateAIDraft(created.campaignId, draftResult.aiDraft.draftId, alice);
  const accepted = await store.acceptAIDraft(created.campaignId, draftResult.aiDraft.draftId, alice);

  assert.equal(joined.participants.length, 2);
  assert.equal(brief.brief.summary, "Updated");
  assert.equal(draftResult.aiDraft.state, "draft");
  assert.equal(regenerated.sourceDraftId, draftResult.aiDraft.draftId);
  assert.equal(accepted.state, "accepted");

  const reloaded = new DataStore();
  const current = await reloaded.loadCampaign(created.campaignId, alice.id);
  assert.equal(current.title, "Friday tavern run");
  assert.equal(current.participantCount, 2);
  assert.equal(current.events.length > 0, true);
  assert.equal(current.credits.length > 0, true);

  const campaignText = await fs.readFile(path.join(process.env.DND_GM_DATA_ROOT, "campaigns", created.campaignId, "campaign.json"), "utf8");
  assert.match(campaignText, /"lastActivityAt":/);
});

test("loadCampaignProjection tolerates older campaigns missing participants data", async () => {
  const { store } = await createStore();
  const alice = await store.upsertIdentity("4d8b6f10-4a8b-48f4-b38c-d5128972e289", "Alice");
  const created = await store.createCampaign(alice, { title: "Legacy campaign" });
  const campaignFile = path.join(process.env.DND_GM_DATA_ROOT, "campaigns", created.campaignId, "campaign.json");
  const campaign = JSON.parse(await fs.readFile(campaignFile, "utf8"));
  delete campaign.participants;
  await fs.writeFile(campaignFile, `${JSON.stringify(campaign, null, 2)}\n`, "utf8");

  const projection = await store.loadCampaignProjection(created.campaignId, alice.id);

  assert.equal(projection.workspaceKind, "game master workspace");
  assert.equal(Array.isArray(projection.participants), true);
  assert.equal(projection.participants.length, 1);
  assert.equal(projection.participants[0].role, "game_master");
  assert.equal(projection.campaign.currentUserParticipant, true);
});

test("loadCampaignProjection resolves a joined player from the loaded participants aggregate", async () => {
  const { store } = await createStore();
  const alice = await store.upsertIdentity("4d8b6f10-4a8b-48f4-b38c-d5128972e289", "Alice");
  const bob = await store.upsertIdentity("c53f5c97-f2f1-4fa0-a7a8-870e5a73a2b9", "Bob");
  const created = await store.createCampaign(alice, { title: "Joinable campaign" });
  await store.joinCampaign(created.campaignId, bob);

  const projection = await store.loadCampaignProjection(created.campaignId, bob.id);

  assert.equal(projection.workspaceKind, "player workspace");
  assert.equal(projection.campaign.currentUserParticipant, true);
  assert.equal(projection.participants.some((participant) => participant.identityId === bob.id), true);
});

test("file store cleanup removes expired campaigns and the 10-day boundary remains", async () => {
  const now = () => new Date("2026-05-20T00:00:00.000Z");
  const { store } = await createStore({ now });
  await store.init();
  const campaignsRoot = path.join(process.env.DND_GM_DATA_ROOT, "campaigns");
  await fs.mkdir(path.join(campaignsRoot, "expired"), { recursive: true });
  await fs.mkdir(path.join(campaignsRoot, "boundary"), { recursive: true });
  await fs.mkdir(path.join(campaignsRoot, "fresh"), { recursive: true });
  await fs.writeFile(path.join(campaignsRoot, "expired", "campaign.json"), JSON.stringify({ campaignId: "expired", lastActivityAt: "2026-05-09T23:59:59.999Z" }), "utf8");
  await fs.writeFile(path.join(campaignsRoot, "boundary", "campaign.json"), JSON.stringify({ campaignId: "boundary", lastActivityAt: "2026-05-10T00:00:00.000Z" }), "utf8");
  await fs.writeFile(path.join(campaignsRoot, "fresh", "campaign.json"), JSON.stringify({ campaignId: "fresh", lastActivityAt: "2026-05-19T00:00:00.000Z" }), "utf8");

  const removed = await store.cleanupExpiredCampaigns();

  assert.deepEqual(removed, ["expired"]);
  await assert.rejects(fs.stat(path.join(campaignsRoot, "expired")));
  assert.ok(await fs.stat(path.join(campaignsRoot, "boundary")));
  assert.ok(await fs.stat(path.join(campaignsRoot, "fresh")));
});
