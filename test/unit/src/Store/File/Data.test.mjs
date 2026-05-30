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

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
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

test("character sheet projections preserve private and public boundaries", async () => {
  const { store } = await createStore();
  const alice = await store.upsertIdentity("4d8b6f10-4a8b-48f4-b38c-d5128972e289", "Alice");
  const bob = await store.upsertIdentity("c53f5c97-f2f1-4fa0-a7a8-870e5a73a2b9", "Bob");
  const created = await store.createCampaign(alice, { title: "Profile campaign" });
  await store.joinCampaign(created.campaignId, bob);
  const sheet = await store.createCharacterSheet(created.campaignId, {
    structuredProfile: {
      identity: { name: "Asha" },
      appearance: { text: "Blue cloak" },
      personality: { traits: "Calm" },
      backstory: { text: "A wanderer" },
      campaignIntegration: { reasonToJoin: "Seek allies" },
      mechanics: { text: "Free-form" },
      publicNotes: "Visible note",
      gmHooks: "Private hook",
      playerIntent: { playStyle: "Support", themes: "Mystery", aiHelpMode: "Ideas" },
    },
  }, alice);
  await store.createCharacterSheetAsset(created.campaignId, sheet.sheetId, {
    kind: "image",
    source: "external",
    purpose: "portrait",
    externalUrl: "https://example.com/portrait.png",
    publishOnApproval: false,
    metadata: { label: "private portrait" },
  }, alice);
  const ownerView = await store.getCharacterSheetView(created.campaignId, sheet.sheetId, alice);
  const otherView = await store.getCharacterSheetView(created.campaignId, sheet.sheetId, bob);
  assert.equal(ownerView.structuredProfile.gmHooks, "Private hook");
  assert.equal(ownerView.structuredProfile.playerIntent.playStyle, "Support");
  assert.equal(otherView.structuredProfile.gmHooks, undefined);
  assert.equal(otherView.structuredProfile.playerIntent, undefined);
  assert.equal(otherView.assetRefs[0].metadata, undefined);
});

test("player asset metadata links are owner-bound and approval only publishes marked assets", async () => {
  const { store } = await createStore();
  const alice = await store.upsertIdentity("4d8b6f10-4a8b-48f4-b38c-d5128972e289", "Alice");
  const bob = await store.upsertIdentity("c53f5c97-f2f1-4fa0-a7a8-870e5a73a2b9", "Bob");
  const created = await store.createCampaign(alice, { title: "Asset campaign" });
  await store.joinCampaign(created.campaignId, bob);
  const sheet = await store.createCharacterSheet(created.campaignId, { structuredProfile: { identity: { name: "Asha" } } }, alice);
  const asset = await store.createCharacterSheetAsset(created.campaignId, sheet.sheetId, {
    kind: "image",
    source: "external",
    purpose: "portrait",
    externalUrl: "https://example.com/portrait.png",
    publishOnApproval: true,
  }, alice);
  await assert.rejects(() => store.createCharacterSheetAsset(created.campaignId, sheet.sheetId, { kind: "image", source: "external", purpose: "reference" }, bob), /Only the owner/);
  await store.approveCharacterSheet(created.campaignId, sheet.sheetId, alice);
  const current = await store.getCharacterSheetView(created.campaignId, sheet.sheetId, bob);
  assert.equal(current.assetRefs.some((item) => item.assetId === asset.assetId), true);
});

test("player-owned AI draft acceptance updates only the selected section", async () => {
  const { store } = await createStore();
  const alice = await store.upsertIdentity("4d8b6f10-4a8b-48f4-b38c-d5128972e289", "Alice");
  const created = await store.createCampaign(alice, { title: "AI profile" });
  const sheet = await store.createCharacterSheet(created.campaignId, {
    structuredProfile: {
      identity: { name: "Asha" },
      appearance: { text: "Short cloak" },
      personality: { traits: "Calm" },
      backstory: { text: "A wanderer" },
      campaignIntegration: { reasonToJoin: "Seek allies" },
      mechanics: { text: "Free-form" },
      publicNotes: "Visible note",
      gmHooks: "Hidden hook",
      playerIntent: { playStyle: "Support" },
    },
  }, alice);
  const draft = await store.createAIDraft(created.campaignId, {
    title: "Identity suggestion",
    targetSheetId: sheet.sheetId,
    sectionPath: "identity.name",
    candidateText: "Asha the Bold",
  }, alice);
  const accepted = await store.acceptAIDraft(created.campaignId, draft.aiDraft.draftId, alice);
  const projected = await store.getCharacterSheetView(created.campaignId, sheet.sheetId, alice);
  assert.equal(accepted.state, "accepted");
  assert.equal(projected.structuredProfile.identity.name, "Asha the Bold");
  assert.equal(projected.structuredProfile.appearance.text, "Short cloak");
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

test("legacy campaigns without wallet file get a wallet on first access", async () => {
  const { store } = await createStore();
  const alice = await store.upsertIdentity("4d8b6f10-4a8b-48f4-b38c-d5128972e289", "Alice");
  const created = await store.createCampaign(alice, { title: "Legacy wallet campaign" });
  const walletFile = path.join(process.env.DND_GM_DATA_ROOT, "campaigns", created.campaignId, "credits", "wallet.json");
  await fs.rm(walletFile, { force: true });

  const wallet = await store.getCampaignWallet(created.campaignId);
  const saved = JSON.parse(await fs.readFile(walletFile, "utf8"));

  assert.equal(wallet.campaignId, created.campaignId);
  assert.equal(wallet.balanceCredits, 100);
  assert.equal(saved.balanceCredits, 100);
  assert.equal(saved.pricingPolicyId, "pricing-openai-standard-v1");
});

test("AI message posting reuses active thread state and preserves continuation fields", async () => {
  const { store } = await createStore();
  const alice = await store.upsertIdentity("4d8b6f10-4a8b-48f4-b38c-d5128972e289", "Alice");
  const bob = await store.upsertIdentity("c53f5c97-f2f1-4fa0-a7a8-870e5a73a2b9", "Bob");
  const created = await store.createCampaign(alice, { title: "Continuity campaign" });
  await store.joinCampaign(created.campaignId, bob);
  const session = await store.createAIPrepSession(created.campaignId, {
    title: "AI",
    targetKind: "character-profile-section",
    targetId: "sheet_1",
    sectionKey: "identity.name",
    mode: "text-draft-generation",
    policyProfile: "player-character-section-discussion",
  }, bob);
  const thread = {
    id: "ai_thread_existing",
    sessionId: session.id,
    campaignId: created.campaignId,
    provider: "openai",
    model: "gpt-4.1-mini",
    mode: session.mode,
    providerConversationId: "conv_prev",
    lastResponseId: "resp_prev",
    status: "active",
    createdAt: "2026-05-30T00:00:00.000Z",
    updatedAt: "2026-05-30T00:00:00.000Z",
  };
  session.activeThreadId = thread.id;
  await writeJson(path.join(process.env.DND_GM_DATA_ROOT, "campaigns", created.campaignId, "ai-sessions", "ai-sessions.json"), { aiSessions: [session] });
  await writeJson(path.join(process.env.DND_GM_DATA_ROOT, "campaigns", created.campaignId, "ai-threads", "ai-threads.json"), { aiThreads: [thread] });
  await writeJson(path.join(process.env.DND_GM_DATA_ROOT, "campaigns", created.campaignId, "ai-messages", "ai-messages.json"), { aiMessages: [
    { id: "msg_user_0", sessionId: session.id, threadId: thread.id, role: "user", contentType: "text", text: "Propose variants for the ranger.", assetRefs: [], draftRefs: [], providerResponseId: null, createdAt: "2026-05-30T00:00:01.000Z" },
    { id: "msg_assistant_0", sessionId: session.id, threadId: thread.id, role: "assistant", contentType: "text", text: "First variant. Second variant. Third variant.", assetRefs: [], draftRefs: [], providerResponseId: "resp_prev", createdAt: "2026-05-30T00:00:02.000Z" },
  ] });
  await writeJson(path.join(process.env.DND_GM_DATA_ROOT, "campaigns", created.campaignId, "ai-runs", "ai-runs.json"), { aiRuns: [] });
  await writeJson(path.join(process.env.DND_GM_DATA_ROOT, "campaigns", created.campaignId, "credits", "wallet.json"), { campaignId: created.campaignId, balanceCredits: 100, pricingPolicyId: "pricing-openai-standard-v1", createdAt: "2026-05-30T00:00:00.000Z", updatedAt: "2026-05-30T00:00:00.000Z" });

  const providerCalls = [];
  store.callAiProvider = async ({ thread: providerThread, messages }) => {
    providerCalls.push({
      lastResponseId: providerThread.lastResponseId,
      providerConversationId: providerThread.providerConversationId,
      transcript: messages.map((message) => `${message.role}:${message.text}`),
    });
    return {
      provider: "fake",
      model: "fake",
      providerResponseId: `resp_${providerCalls.length}`,
      providerConversationId: providerThread.providerConversationId || "conv_1",
      outputText: "Assistant reply",
      usage: store.normalizeUsage({
        inputTokens: 1,
        outputTokens: 1,
        usageItems: [{ kind: "text-output-token", unit: "token", quantity: 1, providerUnitPriceUsd: 0, providerCostUsd: 0 }],
      }, "text-discussion", "fake", "fake"),
      status: "completed",
      assistantMessages: [{ role: "assistant", contentType: "text", text: "Assistant reply" }],
    };
  };

  const first = await store.postAIPrepMessage(created.campaignId, session.id, { clientRequestId: "req-1", text: "Use the third variant and make it darker.", operation: "text-discussion" }, bob);
  const second = await store.postAIPrepMessage(created.campaignId, session.id, { clientRequestId: "req-2", text: "Now regroup the previously generated text by Name, Short description, Ancestry, Class, Role.", operation: "text-discussion" }, bob);
  const current = await store.readCampaign(created.campaignId);
  const log1 = JSON.parse(await fs.readFile(path.join(process.env.DND_GM_DATA_ROOT, "campaigns", created.campaignId, "ai", "logs", session.id, first.run.id + ".json"), "utf8"));
  const log2 = JSON.parse(await fs.readFile(path.join(process.env.DND_GM_DATA_ROOT, "campaigns", created.campaignId, "ai", "logs", session.id, second.run.id + ".json"), "utf8"));

  assert.equal(first.run.status, "completed");
  assert.equal(second.run.status, "completed");
  assert.equal(current.aiSessions[0].activeThreadId, thread.id);
  assert.equal(current.aiThreads[0].lastResponseId, "resp_2");
  assert.equal(providerCalls[0].lastResponseId, "resp_prev");
  assert.equal(providerCalls[1].lastResponseId, "resp_1");
  assert.equal(providerCalls[1].transcript.some((line) => line.includes("First variant. Second variant. Third variant.")), true);
  assert.equal(providerCalls[1].transcript[providerCalls[1].transcript.length - 1].startsWith("user:Now regroup"), true);
  assert.equal(log1.status, "completed");
  assert.equal(log1.request.messageCount >= 3, true);
  assert.equal(log1.request.roles.includes("assistant"), true);
  assert.equal(JSON.stringify(log1).includes("Third variant"), false);
  assert.equal(log2.status, "completed");
  assert.equal(log2.request.messageCount >= 4, true);
  assert.equal(JSON.stringify(log2).includes("Short description"), false);
});

test("AI transcript reads project only user-visible dialogue messages", async () => {
  const { store } = await createStore();
  const alice = await store.upsertIdentity("4d8b6f10-4a8b-48f4-b38c-d5128972e289", "Alice");
  const bob = await store.upsertIdentity("c53f5c97-f2f1-4fa0-a7a8-870e5a73a2b9", "Bob");
  const created = await store.createCampaign(alice, { title: "Transcript campaign" });
  await store.joinCampaign(created.campaignId, bob);
  const session = await store.createAIPrepSession(created.campaignId, {
    title: "AI",
    targetKind: "character-profile-section",
    targetId: "sheet_1",
    sectionKey: "identity.name",
    mode: "text-draft-generation",
    policyProfile: "player-character-section-discussion",
  }, bob);
  session.activeThreadId = "ai_thread_1";
  await writeJson(path.join(process.env.DND_GM_DATA_ROOT, "campaigns", created.campaignId, "ai-sessions", "ai-sessions.json"), { aiSessions: [session] });
  await writeJson(path.join(process.env.DND_GM_DATA_ROOT, "campaigns", created.campaignId, "ai-messages", "ai-messages.json"), { aiMessages: [
    { id: "msg_user_0", sessionId: session.id, threadId: "ai_thread_1", role: "user", contentType: "text", text: "Hello", assetRefs: [], draftRefs: [], providerResponseId: null, createdAt: "2026-05-30T00:00:01.000Z" },
    { id: "msg_sys_0", sessionId: session.id, threadId: "ai_thread_1", role: "system-note", contentType: "text", text: "Hidden prompt", assetRefs: [], draftRefs: [], providerResponseId: null, createdAt: "2026-05-30T00:00:02.000Z" },
    { id: "msg_tool_0", sessionId: session.id, threadId: "ai_thread_1", role: "tool-note", contentType: "text", text: "Tool trace", assetRefs: [], draftRefs: [], providerResponseId: null, createdAt: "2026-05-30T00:00:03.000Z" },
    { id: "msg_assistant_0", sessionId: session.id, threadId: "ai_thread_1", role: "assistant", contentType: "text", text: "Reply", assetRefs: [], draftRefs: [], providerResponseId: "resp_1", createdAt: "2026-05-30T00:00:04.000Z" },
  ] });

  const messages = await store.listAIPrepMessages(created.campaignId, session.id, bob);

  assert.deepEqual(messages.map((message) => message.role), ["user", "assistant"]);
  assert.equal(messages.some((message) => message.role === "system-note"), false);
  assert.equal(messages.some((message) => message.role === "tool-note"), false);
});
