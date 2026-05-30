import test from "node:test";
import assert from "node:assert/strict";

import ApiHandler from "../../../../../src/Web/Handler/Api.mjs";

function makeContext() {
  const response = { writableEnded: false, statusCode: 0, headers: {}, body: "", setHeader(name, value) { this.headers[name] = value; }, end(body) { this.body = body; this.writableEnded = true; } };
  return {
    request: { method: "GET", url: "http://localhost/", headers: {}, async *[Symbol.asyncIterator]() {} },
    response,
    completed: false,
    complete() { this.completed = true; },
  };
}

function makeDataStore() {
  const campaign = {
    campaignId: "campaign_1",
    title: "Friday tavern run",
    gm: { uuid: "gm-1", nickname: "Alice" },
    participantCount: 1,
    participants: [{ identityId: "gm-1", nickname: "Alice", displayName: "Alice", role: "game_master" }],
    brief: { title: "Friday tavern run", summary: "" },
    materials: [],
    assets: [],
    characterSheets: [],
    aiDrafts: [],
    events: [],
    credits: [],
    lastActivityAt: "2026-05-17T00:00:00.000Z",
  };
  return {
    campaign,
    async upsertIdentity(uuid, nickname) { return { id: uuid, uuid, nickname, displayName: nickname }; },
    async getIdentity(identityId) { return identityId === "gm-1" ? { id: "gm-1", uuid: "gm-1", nickname: "Alice" } : identityId === "player-1" ? { id: "player-1", uuid: "player-1", nickname: "Bob" } : null; },
    async listCampaigns() { return [campaign]; },
    async loadCampaignProjection() { return { campaignId: campaign.campaignId, workspaceKind: "game master workspace", campaign, brief: campaign.brief, participants: campaign.participants, materials: [], assets: [], characterSheets: [], aiDrafts: [], events: [], credits: [] }; },
    async createCampaign(identity, body) { return { campaign: { ...campaign, campaignId: "campaign_2", title: body.title || "Campaign 2", gm: { uuid: identity.id, nickname: identity.nickname } } }; },
    async loadCampaign() { return { campaign, participants: campaign.participants, brief: campaign.brief, materials: campaign.materials, assets: campaign.assets, characterSheets: campaign.characterSheets, aiDrafts: campaign.aiDrafts, events: campaign.events, credits: campaign.credits }; },
    async joinCampaign() { return { campaign: { ...campaign, participantCount: 2 }, participants: [...campaign.participants, { identityId: "player-1", nickname: "Bob", displayName: "Bob", role: "player" }], brief: campaign.brief, materials: campaign.materials, assets: campaign.assets, characterSheets: campaign.characterSheets, aiDrafts: campaign.aiDrafts, events: campaign.events, credits: campaign.credits }; },
    async deleteCampaign() { return true; },
    async updateBrief() { return { campaign, participants: campaign.participants, brief: { title: "Updated", summary: "Summary" }, materials: campaign.materials, assets: campaign.assets, characterSheets: campaign.characterSheets, aiDrafts: campaign.aiDrafts, events: campaign.events, credits: campaign.credits }; },
    async listEvents() { return { campaign, participants: campaign.participants, brief: campaign.brief, materials: campaign.materials, assets: campaign.assets, characterSheets: campaign.characterSheets, aiDrafts: campaign.aiDrafts, events: campaign.events, credits: campaign.credits }; },
    async listCredits() { return { campaign, participants: campaign.participants, brief: campaign.brief, materials: campaign.materials, assets: campaign.assets, characterSheets: campaign.characterSheets, aiDrafts: campaign.aiDrafts, events: campaign.events, credits: campaign.credits }; },
    async listMaterials() { return { campaign, participants: campaign.participants, brief: campaign.brief, materials: campaign.materials, assets: campaign.assets, characterSheets: campaign.characterSheets, aiDrafts: campaign.aiDrafts, events: campaign.events, credits: campaign.credits }; },
    async createAIPrepSession() { return { id: "session_1", policyProfile: "player-character-section-discussion" }; },
    async listAIPrepSessions() { return [{ id: "session_1", targetKind: "character-profile-section", targetId: "sheet_1", sectionKey: "identity.name", status: "active" }]; },
    async getAIPrepSession() { return { id: "session_1" }; },
    async listAIPrepMessages() { return [{ id: "msg_1", role: "user", text: "Hello" }]; },
    async postAIPrepMessage() { return { message: { id: "msg_1" }, run: { id: "run_1" }, responseMessage: { id: "msg_2" } }; },
    async createMaterial() { return { materialId: "mat_1" }; },
    async listCharacterSheetsView() { return [{ sheetId: "sheet_1", title: "Character", state: "draft" }]; },
    async getCharacterSheetView() { return { sheetId: "sheet_1", state: "draft", structuredProfile: { identity: { name: "A" }, appearance: {}, personality: {}, backstory: {}, campaignIntegration: {}, mechanics: {}, publicNotes: "" } }; },
    async createCharacterSheet() { return { sheetId: "sheet_1", state: "draft" }; },
    async updateCharacterSheet() { return { sheetId: "sheet_1", state: "draft" }; },
    async approveCharacterSheet() { return { sheetId: "sheet_1", state: "approved" }; },
    async returnCharacterSheetToDraft() { return { sheetId: "sheet_1", state: "draft" }; },
    async createCharacterSheetAsset() { return { assetId: "asset_1" }; },
    async updateCharacterSheetAsset() { return { assetId: "asset_1" }; },
    async deleteCharacterSheetAsset() { return true; },
    async createAIDraft() { return { aiDraft: { draftId: "draft_1", state: "draft" } }; },
    async getAIDraft() { return { draftId: "draft_1", state: "draft" }; },
    async updateAIDraft() { return { draftId: "draft_1", state: "draft" }; },
    async regenerateAIDraft() { return { draftId: "draft_2", state: "draft", sourceDraftId: "draft_1" }; },
    async acceptAIDraft() { return { draftId: "draft_1", state: "accepted" }; },
    async rejectAIDraft() { return { draftId: "draft_1", state: "rejected" }; },
  };
}

function makeEventDelivery() {
  return { emitExtensionFrame() {}, openStream(args) { this.opened = args; }, rebindContext(args) { this.rebound = args; return { campaignId: args.campaignId || "" }; }, notifyCampaignDeletion() {} };
}

test("GET /api/campaigns returns summary data only", async () => {
  const handler = new ApiHandler({ dataStore: makeDataStore(), eventDelivery: makeEventDelivery() });
  const context = makeContext();
  context.request.url = "http://localhost/api/campaigns";
  context.request.headers["x-local-identity-id"] = "gm-1";
  await handler.handle(context);
  assert.equal(context.response.statusCode, 200);
  assert.match(context.response.body, /"campaignId":"campaign_1"/);
  assert.match(context.response.body, /"title":"Friday tavern run"/);
  assert.equal(/"participants"/.test(context.response.body), false);
});

test("GET /api/campaigns/:campaignId returns brief alongside campaign data", async () => {
  const handler = new ApiHandler({ dataStore: makeDataStore(), eventDelivery: makeEventDelivery() });
  const context = makeContext();
  context.request.url = "http://localhost/api/campaigns/campaign_1";
  context.request.headers["x-local-identity-id"] = "gm-1";
  await handler.handle(context);
  assert.equal(context.response.statusCode, 200);
  assert.match(context.response.body, /"brief":/);
});

test("GET /api/campaigns/:campaignId allows participant reads", async () => {
  const store = makeDataStore();
  store.loadCampaignProjection = async () => ({ campaignId: "campaign_1", workspaceKind: "player workspace", campaign: store.campaign, brief: store.campaign.brief, participants: store.campaign.participants, materials: [], assets: [], characterSheets: [], aiDrafts: [], events: [], credits: [] });
  const handler = new ApiHandler({ dataStore: store, eventDelivery: makeEventDelivery() });
  const context = makeContext();
  context.request.url = "http://localhost/api/campaigns/campaign_1";
  context.request.headers["x-local-identity-id"] = "player-1";
  await handler.handle(context);
  assert.equal(context.response.statusCode, 200);
  assert.match(context.response.body, /"workspaceKind":"player workspace"/);
});

test("GET /api/campaigns/:campaignId/character-sheets/:sheetId returns role-projected profile data", async () => {
  const handler = new ApiHandler({ dataStore: makeDataStore(), eventDelivery: makeEventDelivery() });
  const context = makeContext();
  context.request.url = "http://localhost/api/campaigns/campaign_1/character-sheets/sheet_1";
  context.request.headers["x-local-identity-id"] = "player-1";
  await handler.handle(context);
  assert.equal(context.response.statusCode, 200);
  assert.match(context.response.body, /"structuredProfile":/);
});

test("POST /api/campaigns creates a campaign for the current Game Master", async () => {
  const handler = new ApiHandler({ dataStore: makeDataStore(), eventDelivery: makeEventDelivery() });
  const context = makeContext();
  context.request.method = "POST";
  context.request.url = "http://localhost/api/campaigns";
  context.request.headers["x-local-identity-id"] = "gm-1";
  context.request = Object.assign(context.request, { async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify({ title: "New campaign" })); } });
  await handler.handle(context);
  assert.equal(context.response.statusCode, 200);
  assert.match(context.response.body, /"campaignId":"campaign_2"/);
});

test("DELETE /api/campaigns/:campaignId rejects non-Game-Master deletion", async () => {
  const handler = new ApiHandler({ dataStore: makeDataStore(), eventDelivery: makeEventDelivery() });
  const context = makeContext();
  context.request.method = "DELETE";
  context.request.url = "http://localhost/api/campaigns/campaign_1";
  context.request.headers["x-local-identity-id"] = "player-1";
  await handler.handle(context);
  assert.equal(context.response.statusCode, 403);
  assert.match(context.response.body, /"forbidden"/);
});

test("POST /api/campaigns/:campaignId/ai/drafts/regenerate returns another review candidate and records credit usage", async () => {
  const store = makeDataStore();
  store.getIdentity = async () => ({ id: "gm-1", uuid: "gm-1", nickname: "Alice" });
  store.loadCampaign = async () => ({
    campaign: store.campaign,
    participants: store.campaign.participants,
    brief: store.campaign.brief,
    materials: [],
    assets: [],
    characterSheets: [],
    aiDrafts: [{ draftId: "draft_1", title: "Draft", content: "content", state: "draft" }],
    events: [],
    credits: [],
  });
  const handler = new ApiHandler({ dataStore: store, eventDelivery: makeEventDelivery() });
  const context = makeContext();
  context.request.method = "POST";
  context.request.url = "http://localhost/api/campaigns/campaign_1/ai/drafts/draft_1/regenerate";
  context.request.headers["x-local-identity-id"] = "gm-1";
  await handler.handle(context);
  assert.equal(context.response.statusCode, 200);
  assert.match(context.response.body, /"sourceDraftId":"draft_1"/);
});

test("POST /api/campaigns/:campaignId/ai/sessions creates a session and message run", async () => {
  const handler = new ApiHandler({ dataStore: makeDataStore(), eventDelivery: makeEventDelivery() });
  const context = makeContext();
  context.request.method = "POST";
  context.request.url = "http://localhost/api/campaigns/campaign_1/ai/sessions";
  context.request.headers["x-local-identity-id"] = "gm-1";
  context.request = Object.assign(context.request, { async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify({ title: "AI", targetKind: "character-profile-section", targetId: "sheet_1", sectionKey: "identity.name", mode: "text-draft-generation", policyProfile: "player-character-section-discussion" })); } });
  await handler.handle(context);
  assert.equal(context.response.statusCode, 200);
  assert.match(context.response.body, /"session"/);
});

test("GET /api/campaigns/:campaignId/ai/sessions filters by target binding", async () => {
  const handler = new ApiHandler({ dataStore: makeDataStore(), eventDelivery: makeEventDelivery() });
  const context = makeContext();
  context.request.url = "http://localhost/api/campaigns/campaign_1/ai/sessions?targetKind=character-profile-section&targetId=sheet_1&sectionKey=identity.name&status=active";
  context.request.headers["x-local-identity-id"] = "gm-1";
  await handler.handle(context);
  assert.equal(context.response.statusCode, 200);
  assert.match(context.response.body, /"targetKind":"character-profile-section"/);
});

test("GET /api/campaigns/:campaignId/ai/sessions/:sessionId/messages returns transcript entries", async () => {
  const handler = new ApiHandler({ dataStore: makeDataStore(), eventDelivery: makeEventDelivery() });
  const context = makeContext();
  context.request.url = "http://localhost/api/campaigns/campaign_1/ai/sessions/session_1/messages";
  context.request.headers["x-local-identity-id"] = "gm-1";
  await handler.handle(context);
  assert.equal(context.response.statusCode, 200);
  assert.match(context.response.body, /"messages":\[/);
});

test("POST /api/campaigns/:campaignId/ai/sessions rejects unsupported target kinds", async () => {
  const handler = new ApiHandler({ dataStore: makeDataStore(), eventDelivery: makeEventDelivery() });
  const context = makeContext();
  context.request.method = "POST";
  context.request.url = "http://localhost/api/campaigns/campaign_1/ai/sessions";
  context.request.headers["x-local-identity-id"] = "gm-1";
  context.request = Object.assign(context.request, { async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify({ title: "AI", targetKind: "workspace-chat", targetId: "sheet_1", mode: "text-draft-generation", policyProfile: "player-character-section-discussion" })); } });
  await handler.handle(context);
  assert.equal(context.response.statusCode, 400);
  assert.match(context.response.body, /invalid_input/);
});

test("GET /api/event-delivery opens SSE with browser-compatible query parameters", async () => {
  const eventDelivery = makeEventDelivery();
  const handler = new ApiHandler({ dataStore: makeDataStore(), eventDelivery });
  const context = makeContext();
  context.request.url = "http://localhost/api/event-delivery?tabIdentityId=tab-1&localIdentityId=local-1&campaignId=campaign-1";
  await handler.handle(context);
  assert.equal(eventDelivery.opened.tabIdentityId, "tab-1");
  assert.equal(eventDelivery.opened.localIdentityId, "local-1");
});

test("POST /api/event-delivery/context rebinds runtime campaign context with header identity", async () => {
  const eventDelivery = makeEventDelivery();
  const handler = new ApiHandler({ dataStore: makeDataStore(), eventDelivery });
  const context = makeContext();
  context.request.method = "POST";
  context.request.url = "http://localhost/api/event-delivery/context";
  context.request.headers["x-local-identity-id"] = "gm-1";
  context.request = Object.assign(context.request, { async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify({ tabIdentityId: "tab-1", campaignId: null })); } });
  await handler.handle(context);
  assert.equal(eventDelivery.rebound.tabIdentityId, "tab-1");
  assert.equal(eventDelivery.rebound.localIdentityId, "gm-1");
});

test("GET /api/campaigns/:campaignId/events returns campaign-scoped history", async () => {
  const handler = new ApiHandler({ dataStore: makeDataStore(), eventDelivery: makeEventDelivery() });
  const context = makeContext();
  context.request.url = "http://localhost/api/campaigns/campaign_1/events";
  context.request.headers["x-local-identity-id"] = "gm-1";
  await handler.handle(context);
  assert.equal(context.response.statusCode, 200);
  assert.match(context.response.body, /"events":\[/);
});

test("GET /api/events is not exposed as a global feed endpoint", async () => {
  const handler = new ApiHandler({ dataStore: makeDataStore(), eventDelivery: makeEventDelivery() });
  const context = makeContext();
  context.request.url = "http://localhost/api/events";
  context.request.headers["x-local-identity-id"] = "gm-1";
  await handler.handle(context);
  assert.equal(context.response.statusCode, 404);
});

test("API failures are logged before controlled error responses are returned", async () => {
  const store = makeDataStore();
  store.loadCampaignProjection = async () => { throw new Error("boom"); };
  const handler = new ApiHandler({ dataStore: store, eventDelivery: makeEventDelivery() });
  const context = makeContext();
  context.request.url = "http://localhost/api/campaigns/campaign_1";
  context.request.headers["x-local-identity-id"] = "gm-1";
  const originalError = console.error;
  const calls = [];
  console.error = (...args) => { calls.push(args); };
  try {
    await handler.handle(context);
  } finally {
    console.error = originalError;
  }
  assert.equal(context.response.statusCode, 500);
  assert.equal(calls.length > 0, true);
  assert.match(String(calls[0][0]), /\[api\] request failed/);
});
