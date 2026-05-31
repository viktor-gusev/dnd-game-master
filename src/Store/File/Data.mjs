// @ts-check

/**
 * @namespace Dnd_Gm_Store_File_Data
 * @description File-backed data store for identities and campaign durable state.
 */

function safeCampaignId(campaignId) {
  if (typeof campaignId !== "string" || !/^[a-zA-Z0-9_-]+$/.test(campaignId)) {
    throw Object.assign(new Error("Invalid campaign id."), { code: "invalid_campaign_id" });
  }
  return campaignId;
}

function normalizeUuid(uuid) {
  if (typeof uuid !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid.trim())) {
    throw Object.assign(new Error("Local identity uuid is invalid."), { code: "invalid_input" });
  }
  return uuid.trim().toLowerCase();
}

function normalizeNickname(nickname) {
  if (!nickname || !String(nickname).trim()) {
    throw Object.assign(new Error("Local identity nickname is required."), { code: "invalid_input" });
  }
  return String(nickname).trim();
}

const RETENTION_WINDOW_MS = 10 * 24 * 60 * 60 * 1000;

const STRUCTURED_PROFILE_DEFAULTS = Object.freeze({
  identity: { name: "", shortDescription: "", ancestry: "", characterClass: "", role: "" },
  appearance: { text: "" },
  personality: { traits: "", motivation: "", fears: "", mannerisms: "", speechStyle: "" },
  backstory: { text: "", importantNpc: "", openHooks: "" },
  campaignIntegration: { reasonToJoin: "", linksToOtherCharacters: "", gmUsableHooks: "", boundaries: "" },
  mechanics: { text: "" },
  publicNotes: "",
  gmHooks: "",
  playerIntent: { playStyle: "", themes: "", aiHelpMode: "" },
});

const AI_POLICY_PROFILES = Object.freeze({
  "player-character-section-discussion": { ownerRole: "player" },
  "player-character-image-prep": { ownerRole: "player" },
  "gm-campaign-material-prep": { ownerRole: "game_master" },
  "gm-campaign-brief-prep": { ownerRole: "game_master" },
  "gm-image-material-prep": { ownerRole: "game_master" },
});

const AI_TARGET_KINDS = new Set([
  "character-profile-section",
  "character-sheet-section",
  "campaign-brief",
  "campaign-material",
  "npc-material",
  "location-material",
  "handout",
  "map",
  "asset-task",
]);

const AI_MODES = new Set([
  "text-discussion",
  "text-draft-generation",
  "image-prompt-discussion",
  "image-generation",
  "image-editing",
  "summary",
]);

const AI_OUTPUT_KINDS = new Set(["message", "draft", "asset"]);

function requireKnownAiValue(field, value, allowed) {
  if (!value) return "";
  const normalized = String(value).trim();
  if (!allowed.has(normalized)) throw Object.assign(new Error(`Unsupported ${field}.`), { code: "invalid_input" });
  return normalized;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function normalizeText(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function isUserVisibleAiMessage(message) {
  return message && (message.role === "user" || message.role === "assistant");
}

function safeInt(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? Math.trunc(num) : fallback;
}

function normalizeStructuredProfile(profile = {}) {
  const next = clone(STRUCTURED_PROFILE_DEFAULTS);
  const source = profile && typeof profile === "object" ? profile : {};
  for (const [section, defaults] of Object.entries(STRUCTURED_PROFILE_DEFAULTS)) {
    if (typeof defaults === "string") {
      next[section] = typeof source[section] === "string" ? source[section] : defaults;
      continue;
    }
    const input = source[section] && typeof source[section] === "object" ? source[section] : {};
    next[section] = { ...defaults };
    for (const key of Object.keys(defaults)) next[section][key] = typeof input[key] === "string" ? input[key] : defaults[key];
  }
  return next;
}

function getSectionValue(profile, sectionPath) {
  return sectionPath.split(".").reduce((value, key) => value?.[key], profile);
}

function setSectionValue(profile, sectionPath, value) {
  const parts = sectionPath.split(".");
  let cursor = profile;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    cursor[key] = cursor[key] && typeof cursor[key] === "object" ? cursor[key] : {};
    cursor = cursor[key];
  }
  cursor[parts.at(-1)] = value;
}

function sectionValueForPath(profile, sectionPath) {
  return clone(getSectionValue(profile, sectionPath));
}

function sectionValueForSectionKey(profile, sectionKey) {
  if (!sectionKey) return null;
  if (Object.prototype.hasOwnProperty.call(profile, sectionKey)) return sectionValueForPath(profile, sectionKey);
  if (sectionKey === "identity") return sectionValueForPath(profile, "identity");
  if (sectionKey === "appearance") return sectionValueForPath(profile, "appearance");
  if (sectionKey === "personality") return sectionValueForPath(profile, "personality");
  if (sectionKey === "backstory") return sectionValueForPath(profile, "backstory");
  if (sectionKey === "campaignIntegration") return sectionValueForPath(profile, "campaignIntegration");
  if (sectionKey === "mechanics") return sectionValueForPath(profile, "mechanics");
  if (sectionKey === "publicNotes") return sectionValueForPath(profile, "publicNotes");
  if (sectionKey === "gmHooks") return sectionValueForPath(profile, "gmHooks");
  if (sectionKey === "playerIntent") return sectionValueForPath(profile, "playerIntent");
  return null;
}

function isTrivialAssistantText(value) {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) return true;
  return [
    /^hello[!.?\s]*how can i help/,
    /^hi[!.?\s]*how can i help/,
    /^hey[!.?\s]*how can i help/,
    /^hello[!.?\s]*$/,
    /^hi[!.?\s]*$/,
    /^hey[!.?\s]*$/,
    /^привет[!.?\s]*$/,
    /^привет[!.?\s]*чем помочь/,
    /^чем помочь[!?.\s]*$/,
    /^how can i help/,
    /^what can i help/,
  ].some((pattern) => pattern.test(normalized));
}

function summarizeDialogContext(messages = []) {
  const entries = Array.isArray(messages) ? messages : [];
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const message = entries[i] || {};
    if (message.role !== "assistant") continue;
    const summary = normalizeText(message.text || message.content || "");
    if (!summary || isTrivialAssistantText(summary)) continue;
    return summary;
  }
  return "";
}

function parseJsonCandidate(text) {
  const raw = normalizeText(text);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {}
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

function structuredSnapshotSchema(snapshot) {
  if (snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)) {
    const keys = Object.keys(snapshot);
    return {
      type: "object",
      additionalProperties: false,
      properties: Object.fromEntries(keys.map((key) => [key, { type: "string" }])),
      required: keys,
    };
  }
  return { type: "string" };
}

function normalizeStructuredCandidate(baseline, candidate) {
  if (baseline && typeof baseline === "object" && !Array.isArray(baseline)) {
    const source = candidate && typeof candidate === "object" && !Array.isArray(candidate) ? candidate : {};
    const next = {};
    for (const [key, value] of Object.entries(baseline)) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        next[key] = normalizeStructuredCandidate(value, source[key]);
        continue;
      }
      if (typeof value === "string") {
        next[key] = typeof source[key] === "string" ? source[key].trim() : value;
        continue;
      }
      next[key] = clone(value);
    }
    return next;
  }
  if (typeof baseline === "string") {
    return typeof candidate === "string" ? candidate.trim() : baseline;
  }
  return candidate ?? baseline;
}

function formatDialogContext(messages = []) {
  const entries = Array.isArray(messages) ? messages : [];
  return entries.map((message) => {
    const role = String(message?.role || "message").toUpperCase();
    const content = normalizeText(message?.text || message?.content || "");
    return content ? `${role}: ${content}` : "";
  }).filter(Boolean).join("\n");
}

function buildStructuredDraftPrompt(sectionKey, sectionSnapshot, dialogContext) {
  const snapshotText = JSON.stringify(sectionSnapshot, null, 2);
  const schema = JSON.stringify(structuredSnapshotSchema(sectionSnapshot), null, 2);
  return [
    {
      role: "system",
      contentType: "text",
      text: `You materialize a structured candidate for the ${sectionKey || "selected"} section.\nReturn only valid JSON. Do not include markdown, code fences, or commentary.\nThe JSON must match the provided schema exactly.\nIf the conversation produced no new proposal, return the baseline unchanged.`,
      assetRefs: [],
      draftRefs: [],
      providerResponseId: null,
    },
    {
      role: "system",
      contentType: "text",
      text: `Schema:\n${schema}\n\nBaseline section snapshot:\n${snapshotText}`,
      assetRefs: [],
      draftRefs: [],
      providerResponseId: null,
    },
    {
      role: "user",
      contentType: "text",
      text: `Dialog context:\n${formatDialogContext(dialogContext)}\n\nReturn the structured candidate JSON only.`,
      assetRefs: [],
      draftRefs: [],
      providerResponseId: null,
    },
  ];
}

function assetVisibilityForOwner(asset, isOwnerOrGM) {
  if (isOwnerOrGM) return asset;
  return null;
}

function publicAssetProjection(asset) {
  if (!asset || asset.visibilityAudience === "GM-only") return null;
  return {
    assetId: asset.assetId,
    campaignId: asset.campaignId,
    kind: asset.kind,
    source: asset.source,
    purpose: asset.purpose,
    ownerRole: asset.ownerRole,
    ownerIdentityId: asset.ownerIdentityId,
    visibilityAudience: asset.visibilityAudience,
    publicationState: asset.publicationState,
    publishOnApproval: asset.publishOnApproval,
    linkedSheetId: asset.linkedSheetId,
  };
}

function normalizeAsset(asset = {}, defaults = {}) {
  const now = defaults.now || new Date().toISOString();
  return {
    assetId: asset.assetId || `asset_${Date.now().toString(16)}${Math.random().toString(16).slice(2, 8)}`,
    campaignId: asset.campaignId || defaults.campaignId,
    kind: asset.kind || "other",
    source: asset.source || "external",
    purpose: asset.purpose || "other",
    ownerRole: asset.ownerRole || defaults.ownerRole || "player",
    ownerIdentityId: asset.ownerIdentityId || defaults.ownerIdentityId || "",
    linkedSheetId: asset.linkedSheetId || "",
    linkedMaterialIds: Array.isArray(asset.linkedMaterialIds) ? asset.linkedMaterialIds : [],
    mediaType: asset.mediaType || "",
    originalName: asset.originalName || "",
    storagePath: asset.storagePath || "",
    externalUrl: asset.externalUrl || "",
    visibilityAudience: asset.visibilityAudience || "specific players",
    publicationState: asset.publicationState || "draft",
    publishOnApproval: asset.publishOnApproval === true,
    metadata: asset.metadata && typeof asset.metadata === "object" ? asset.metadata : {},
    createdAt: asset.createdAt || now,
    updatedAt: asset.updatedAt || now,
  };
}

function normalizeSheet(sheet = {}, campaignId) {
  return {
    sheetId: sheet.sheetId,
    campaignId,
    playerIdentityId: sheet.playerIdentityId || sheet.ownerIdentityId || "",
    ownerIdentityId: sheet.ownerIdentityId || sheet.playerIdentityId || "",
    title: sheet.title || "Character Sheet",
    state: sheet.state || "draft",
    structuredProfile: normalizeStructuredProfile(sheet.structuredProfile || {}),
    assetRefs: Array.isArray(sheet.assetRefs) ? sheet.assetRefs : [],
    primaryPortraitAssetId: sheet.primaryPortraitAssetId || "",
    tokenAssetId: sheet.tokenAssetId || "",
    createdAt: sheet.createdAt || "",
    updatedAt: sheet.updatedAt || "",
  };
}

function publicStructuredProfile(sheet) {
  return {
    identity: sheet.structuredProfile.identity,
    appearance: sheet.structuredProfile.appearance,
    personality: sheet.structuredProfile.personality,
    backstory: sheet.structuredProfile.backstory,
    campaignIntegration: sheet.structuredProfile.campaignIntegration,
    mechanics: sheet.structuredProfile.mechanics,
    publicNotes: sheet.structuredProfile.publicNotes,
  };
}

async function ensureDir(dir) {
  const fs = await import("node:fs/promises");
  await fs.mkdir(dir, { recursive: true });
}

async function readJson(file, fallback) {
  const fs = await import("node:fs/promises");
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJson(file, value) {
  const fs = await import("node:fs/promises");
  await ensureDir(file.slice(0, file.lastIndexOf("/")));
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(temp, file);
}

async function readNdjson(file) {
  const fs = await import("node:fs/promises");
  try {
    const text = await fs.readFile(file, "utf8");
    return text.split("\n").filter(Boolean).map((line) => JSON.parse(line));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

async function appendNdjson(file, record) {
  const fs = await import("node:fs/promises");
  await ensureDir(file.slice(0, file.lastIndexOf("/")));
  await fs.appendFile(file, `${JSON.stringify(record)}\n`, "utf8");
}

async function sha256(value) {
  const crypto = await import("node:crypto");
  return crypto.createHash("sha256").update(value).digest("hex");
}

export default class Dnd_Gm_Store_File_Data {
  constructor({ now = () => new Date() } = {}) {
    this.root = process.env.DND_GM_DATA_ROOT || `${process.cwd()}/var/data`;
    this.now = now;

    this.timestamp = () => this.now().toISOString();
    this.campaignRoot = (campaignId) => `${this.root}/campaigns/${safeCampaignId(campaignId)}`;
    this.campaignJson = (campaignId) => `${this.campaignRoot(campaignId)}/campaign.json`;
    this.participantsJson = (campaignId) => `${this.campaignRoot(campaignId)}/participants.json`;
    this.briefJson = (campaignId) => `${this.campaignRoot(campaignId)}/brief.json`;
    this.materialsJson = (campaignId) => `${this.campaignRoot(campaignId)}/materials/materials.json`;
    this.assetsJson = (campaignId) => `${this.campaignRoot(campaignId)}/assets/assets.json`;
    this.characterSheetsJson = (campaignId) => `${this.campaignRoot(campaignId)}/character-sheets/character-sheets.json`;
    this.aiDraftsJson = (campaignId) => `${this.campaignRoot(campaignId)}/ai-drafts/ai-drafts.json`;
    this.aiSessionsJson = (campaignId) => `${this.campaignRoot(campaignId)}/ai-sessions/ai-sessions.json`;
    this.aiThreadsJson = (campaignId) => `${this.campaignRoot(campaignId)}/ai-threads/ai-threads.json`;
    this.aiMessagesJson = (campaignId) => `${this.campaignRoot(campaignId)}/ai-messages/ai-messages.json`;
    this.aiRunsJson = (campaignId) => `${this.campaignRoot(campaignId)}/ai-runs/ai-runs.json`;
    this.aiRunLogJson = (campaignId, sessionId, runId) => `${this.campaignRoot(campaignId)}/ai/logs/${sessionId}/${runId}.json`;
    this.aiAssetsJson = (campaignId) => `${this.campaignRoot(campaignId)}/ai-assets/ai-assets.json`;
    this.aiIdempotencyJson = (campaignId, identityId, endpointKey, clientRequestId) => `${this.campaignRoot(campaignId)}/ai/idempotency/${identityId}/${endpointKey}/${clientRequestId}.json`;
    this.walletJson = (campaignId) => `${this.campaignRoot(campaignId)}/credits/wallet.json`;
    this.eventsNdjson = (campaignId) => `${this.campaignRoot(campaignId)}/events.ndjson`;
    this.creditsNdjson = (campaignId) => `${this.campaignRoot(campaignId)}/credits.ndjson`;
    this.usageNdjson = (campaignId) => `${this.campaignRoot(campaignId)}/usage.ndjson`;

    this.init = async () => {
      await ensureDir(this.root);
      await ensureDir(`${this.root}/campaigns`);
    };

    this.loadIdentities = async () => {
      await this.init();
      return readJson(`${this.root}/identities.json`, { identities: [] });
    };

    this.saveIdentities = async (data) => writeJson(`${this.root}/identities.json`, data);

    this.upsertIdentity = async (uuid, nickname) => {
      const normalizedUuid = normalizeUuid(uuid);
      const normalizedNickname = normalizeNickname(nickname);
      const identities = await this.loadIdentities();
      const now = this.timestamp();
      let identity = identities.identities.find((item) => item.id === normalizedUuid);
      if (!identity) {
        identity = { id: normalizedUuid, uuid: normalizedUuid, nickname: normalizedNickname, displayName: normalizedNickname, createdAt: now, updatedAt: now };
        identities.identities.push(identity);
      } else {
        identity.nickname = normalizedNickname;
        identity.displayName = normalizedNickname;
        identity.updatedAt = now;
      }
      await this.saveIdentities(identities);
      return identity;
    };

    this.getIdentity = async (identityId) => {
      const normalizedUuid = normalizeUuid(identityId);
      const identities = await this.loadIdentities();
      return identities.identities.find((item) => item.id === normalizedUuid) || null;
    };

    this.appendEvent = async (campaignId, event) => appendNdjson(this.eventsNdjson(campaignId), event);
    this.appendCredit = async (campaignId, credit) => appendNdjson(this.creditsNdjson(campaignId), credit);
    this.appendUsage = async (campaignId, usage) => appendNdjson(this.usageNdjson(campaignId), usage);
    this.loadIdempotencyRecord = async (campaignId, identityId, endpointKey, clientRequestId) => readJson(this.aiIdempotencyJson(campaignId, identityId, endpointKey, clientRequestId), null);
    this.saveIdempotencyRecord = async (campaignId, identityId, endpointKey, clientRequestId, record) => {
      await writeJson(this.aiIdempotencyJson(campaignId, identityId, endpointKey, clientRequestId), record);
    };

    this.readCampaign = async (campaignId) => {
      const dir = this.campaignRoot(campaignId);
      const campaign = await readJson(this.campaignJson(campaignId), null);
      if (!campaign) return null;
      return {
        dir,
        campaign,
        participants: (await readJson(this.participantsJson(campaignId), { participants: [] })).participants || [],
        brief: await readJson(this.briefJson(campaignId), campaign.brief || {}),
        materials: (await readJson(this.materialsJson(campaignId), { materials: [] })).materials || [],
        assets: (await readJson(this.assetsJson(campaignId), { assets: [] })).assets || [],
        characterSheets: (await readJson(this.characterSheetsJson(campaignId), { characterSheets: [] })).characterSheets || [],
        aiDrafts: (await readJson(this.aiDraftsJson(campaignId), { aiDrafts: [] })).aiDrafts || [],
        aiSessions: (await readJson(this.aiSessionsJson(campaignId), { aiSessions: [] })).aiSessions || [],
        aiThreads: (await readJson(this.aiThreadsJson(campaignId), { aiThreads: [] })).aiThreads || [],
        aiMessages: (await readJson(this.aiMessagesJson(campaignId), { aiMessages: [] })).aiMessages || [],
        aiRuns: (await readJson(this.aiRunsJson(campaignId), { aiRuns: [] })).aiRuns || [],
        aiAssets: (await readJson(this.aiAssetsJson(campaignId), { aiAssets: [] })).aiAssets || [],
        wallet: await readJson(this.walletJson(campaignId), null),
        events: await readNdjson(this.eventsNdjson(campaignId)),
        credits: await readNdjson(this.creditsNdjson(campaignId)),
        usage: await readNdjson(this.usageNdjson(campaignId)),
      };
    };

    this.getAIPrepThread = (current, session) => {
      if (!current || !session) return null;
      if (session.activeThreadId) {
        const existing = (current.aiThreads || []).find((item) => item.id === session.activeThreadId);
        if (existing) return existing;
      }
      return null;
    };

    this.listVisibleAIPrepMessages = (messages, sessionId, threadId = "") => (Array.isArray(messages) ? messages : []).filter((message) => message.sessionId === sessionId && (!threadId || message.threadId === threadId) && isUserVisibleAiMessage(message));

    this.getAIPrepSectionSnapshot = (current, session) => {
      if (!current || !session || session.targetKind !== "character-profile-section") return null;
      if (session.sectionSnapshot && typeof session.sectionSnapshot === "object") return clone(session.sectionSnapshot);
      const sheet = (current.characterSheets || []).find((item) => item.sheetId === session.targetId) || null;
      if (!sheet) return null;
      const normalizedProfile = normalizeStructuredProfile(sheet.structuredProfile);
      if (session.sectionKey && Object.prototype.hasOwnProperty.call(normalizedProfile, session.sectionKey)) {
        return clone(normalizedProfile[session.sectionKey]);
      }
      if (session.sectionKey && session.sectionKey.includes(".")) {
        return clone(getSectionValue(normalizedProfile, session.sectionKey));
      }
      return clone(normalizedProfile);
    };

    this.buildAIPrepProviderMessages = (current, session, thread, userMessage) => {
      const transcript = this.listVisibleAIPrepMessages(current.aiMessages, session.id, thread.id);
      const sectionSnapshot = this.getAIPrepSectionSnapshot(current, session);
      const messages = [];
      if (sectionSnapshot !== null && sectionSnapshot !== undefined) {
        messages.push({
          role: "system",
          contentType: "text",
          text: `Current section snapshot:\n${JSON.stringify(sectionSnapshot, null, 2)}`,
          assetRefs: [],
          draftRefs: [],
          providerResponseId: null,
        });
      }
      return [...messages, ...transcript, userMessage];
    };

    this.decorateCampaign = (current, identityId = "") => ({
      campaignId: current.campaign.campaignId,
      title: current.campaign.title,
      gm: current.campaign.gm,
      participantCount: Array.isArray(current.participants) ? current.participants.length : 0,
      participants: Array.isArray(current.participants) ? current.participants : [],
      brief: current.brief || {},
      materials: Array.isArray(current.materials) ? current.materials : [],
      assets: Array.isArray(current.assets) ? current.assets : [],
      characterSheets: Array.isArray(current.characterSheets) ? current.characterSheets.map((sheet) => normalizeSheet(sheet, current.campaign.campaignId)) : [],
      aiDrafts: Array.isArray(current.aiDrafts) ? current.aiDrafts : [],
      aiSessions: Array.isArray(current.aiSessions) ? current.aiSessions : [],
      aiThreads: Array.isArray(current.aiThreads) ? current.aiThreads : [],
      aiMessages: Array.isArray(current.aiMessages) ? current.aiMessages : [],
      aiRuns: Array.isArray(current.aiRuns) ? current.aiRuns : [],
      aiAssets: Array.isArray(current.aiAssets) ? current.aiAssets : [],
      events: Array.isArray(current.events) ? current.events : [],
      credits: Array.isArray(current.credits) ? current.credits : [],
      usage: Array.isArray(current.usage) ? current.usage : [],
      lastActivityAt: current.campaign.lastActivityAt || current.campaign.createdAt,
      createdAt: current.campaign.createdAt,
      currentUserParticipant: !!identityId && Array.isArray(current.participants) && current.participants.some((participant) => participant.identityId === identityId),
      currentUserRole: current.campaign.gm?.uuid === identityId ? "game_master" : (identityId && Array.isArray(current.participants) && current.participants.some((participant) => participant.identityId === identityId) ? "player" : ""),
    });

    this.resolveWorkspaceKind = (current, identityId) => {
      if (!current) return "";
      const participants = Array.isArray(current.participants) ? current.participants : [];
      if (current.campaign?.gm?.uuid === identityId) return "game master workspace";
      if (participants.some((participant) => participant.identityId === identityId)) return "player workspace";
      return "";
    };

    this.listCampaigns = async (identityId = "") => {
      await this.init();
      const fs = await import("node:fs/promises");
      const entries = await fs.readdir(`${this.root}/campaigns`, { withFileTypes: true }).catch((error) => {
        if (error?.code === "ENOENT") return [];
        throw error;
      });
      const campaigns = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const current = await this.readCampaign(entry.name);
        if (!current) continue;
        campaigns.push(this.decorateCampaign(current, identityId));
      }
      campaigns.sort((a, b) => String(b.lastActivityAt || "").localeCompare(String(a.lastActivityAt || "")));
      return campaigns;
    };

    this.createCampaign = async (identity, { title = "", linkCode = "" } = {}) => {
      const campaignId = `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 8)}`;
      const dir = this.campaignRoot(campaignId);
      const now = this.timestamp();
      const campaign = {
        campaignId,
        title: String(title || "").trim() || `Campaign ${campaignId.slice(0, 6)}`,
        linkCode: String(linkCode || "").trim() || campaignId,
        gm: { uuid: identity.id, nickname: identity.nickname },
        createdBy: identity.id,
        createdAt: now,
        updatedAt: now,
        lastActivityAt: now,
      };
      const participants = {
        participants: [{ identityId: identity.id, uuid: identity.id, nickname: identity.nickname, displayName: identity.nickname, role: "game_master", joinedAt: now }],
      };
      const brief = { title: campaign.title, summary: "", planning: "", recap: "" };
      await ensureDir(dir);
      await writeJson(this.campaignJson(campaignId), campaign);
      await writeJson(this.participantsJson(campaignId), participants);
      await writeJson(this.briefJson(campaignId), brief);
      await writeJson(this.materialsJson(campaignId), { materials: [] });
      await writeJson(this.assetsJson(campaignId), { assets: [] });
      await writeJson(this.characterSheetsJson(campaignId), { characterSheets: [] });
      await writeJson(this.aiDraftsJson(campaignId), { aiDrafts: [] });
      await writeJson(this.aiSessionsJson(campaignId), { aiSessions: [] });
      await writeJson(this.aiThreadsJson(campaignId), { aiThreads: [] });
      await writeJson(this.aiMessagesJson(campaignId), { aiMessages: [] });
      await writeJson(this.aiRunsJson(campaignId), { aiRuns: [] });
      await writeJson(this.aiAssetsJson(campaignId), { aiAssets: [] });
      await writeJson(this.walletJson(campaignId), { campaignId, balanceCredits: this.getAiRuntimeConfig().initialCredits, pricingPolicyId: this.getAiRuntimeConfig().pricingPolicyId || "pricing-openai-standard-v1", createdAt: now, updatedAt: now });
      await ensureDir(`${this.campaignRoot(campaignId)}/ai/idempotency`);
      await this.appendEvent(campaignId, { eventId: `evt_${campaignId}_created`, campaignId, type: "campaign.created", actorId: identity.id, createdAt: now, payload: { title: campaign.title } });
      await this.appendCredit(campaignId, { creditId: `credit_${campaignId}_grant`, campaignId, actorId: identity.id, entryType: "grant", creditsDelta: 100, creditsBefore: 0, creditsAfter: 100, createdAt: now });
      return this.loadCampaign(campaignId, identity.id);
    };

    this.loadCampaign = async (campaignId, identityId = "") => {
      const current = await this.readCampaign(campaignId);
      return current ? this.decorateCampaign(current, identityId) : null;
    };

    this.loadCampaignProjection = async (campaignId, identityId = "") => {
      const current = await this.readCampaign(campaignId);
      if (!current) return null;
      const campaign = this.decorateCampaign(current, identityId);
      const workspaceKind = this.resolveWorkspaceKind(current, identityId);
      if (!workspaceKind) return { campaignId, workspaceKind: "", campaign: null };
      const isGM = workspaceKind === "game master workspace";
      return {
        campaignId,
        workspaceKind,
        campaign,
        brief: current.brief || {},
        participants: Array.isArray(current.participants) ? current.participants : [],
        materials: isGM ? (Array.isArray(current.materials) ? current.materials : []) : [],
        assets: isGM ? (Array.isArray(current.assets) ? current.assets : []) : [],
        characterSheets: (Array.isArray(current.characterSheets) ? current.characterSheets.map((sheet) => normalizeSheet(sheet, current.campaign.campaignId)) : []).filter((sheet) => isGM || sheet.playerIdentityId === identityId || sheet.state === "approved"),
        aiDrafts: isGM ? (Array.isArray(current.aiDrafts) ? current.aiDrafts : []) : (Array.isArray(current.aiDrafts) ? current.aiDrafts : []).filter((draft) => draft.ownerIdentityId === identityId || !draft.ownerIdentityId),
        events: Array.isArray(current.events) ? current.events : [],
        credits: isGM ? (Array.isArray(current.credits) ? current.credits : []) : [],
      };
    };

    this.saveCampaign = async (campaignId, campaign) => writeJson(this.campaignJson(campaignId), campaign);

    this.touchCampaign = async (campaignId, actorId, type, payload = {}) => {
      const current = await this.readCampaign(campaignId);
      if (!current) return null;
      const now = this.timestamp();
      current.campaign.updatedAt = now;
      current.campaign.lastActivityAt = now;
      await this.saveCampaign(campaignId, current.campaign);
      await this.appendEvent(campaignId, { eventId: `evt_${campaignId}_${Date.now().toString(16)}${Math.random().toString(16).slice(2, 6)}`, campaignId, type, actorId, createdAt: now, payload });
      return this.loadCampaign(campaignId, actorId);
    };

    this.joinCampaign = async (campaignId, identity) => {
      const current = await this.readCampaign(campaignId);
      if (!current) return null;
      const now = this.timestamp();
      if (!current.participants.some((participant) => participant.identityId === identity.id)) {
        current.participants.push({ identityId: identity.id, uuid: identity.id, nickname: identity.nickname, displayName: identity.nickname, role: "player", joinedAt: now });
        await writeJson(this.participantsJson(campaignId), { participants: current.participants });
        current.campaign.updatedAt = now;
        current.campaign.lastActivityAt = now;
        await this.saveCampaign(campaignId, current.campaign);
        await this.appendEvent(campaignId, { eventId: `evt_${campaignId}_join_${Date.now().toString(16)}`, campaignId, type: "player.joined", actorId: identity.id, createdAt: now, payload: { identityId: identity.id } });
      }
      return this.loadCampaign(campaignId, identity.id);
    };

    this.updateCampaign = async (campaignId, body, identity) => {
      const current = await this.readCampaign(campaignId);
      if (!current) return null;
      Object.assign(current.campaign, {
        title: typeof body.title === "string" ? body.title.trim() || current.campaign.title : current.campaign.title,
        updatedAt: this.timestamp(),
        lastActivityAt: this.timestamp(),
      });
      await this.saveCampaign(campaignId, current.campaign);
      await this.appendEvent(campaignId, { eventId: `evt_${campaignId}_patch_${Date.now().toString(16)}`, campaignId, type: "campaign.details.updated", actorId: identity.id, createdAt: current.campaign.updatedAt, payload: { title: current.campaign.title } });
      return this.loadCampaign(campaignId, identity.id);
    };

    this.updateBrief = async (campaignId, body, identity) => {
      const current = await this.readCampaign(campaignId);
      if (!current) return null;
      const brief = {
        title: typeof body.title === "string" ? body.title.trim() : current.brief.title || current.campaign.title,
        summary: typeof body.summary === "string" ? body.summary.trim() : current.brief.summary || "",
        planning: typeof body.planning === "string" ? body.planning.trim() : current.brief.planning || "",
        recap: typeof body.recap === "string" ? body.recap.trim() : current.brief.recap || "",
      };
      await writeJson(this.briefJson(campaignId), brief);
      await this.touchCampaign(campaignId, identity.id, "campaign.brief.updated", { brief });
      return this.loadCampaign(campaignId, identity.id);
    };

    this.createMaterial = async (campaignId, body, identity) => {
      const current = await this.readCampaign(campaignId);
      if (!current) return null;
      const material = {
        materialId: `mat_${Date.now().toString(16)}${Math.random().toString(16).slice(2, 8)}`,
        title: String(body.title || "").trim() || "Material",
        content: String(body.content || "").trim(),
        visibility: body.visibility || "GM-only",
        publicationState: body.publicationState || "draft",
        createdAt: this.timestamp(),
        updatedAt: this.timestamp(),
      };
      current.materials.push(material);
      await writeJson(this.materialsJson(campaignId), { materials: current.materials });
      await this.touchCampaign(campaignId, identity.id, "campaign.material.created", { materialId: material.materialId });
      return material;
    };

    this.createCharacterSheet = async (campaignId, body, identity) => {
      const current = await this.readCampaign(campaignId);
      if (!current) return null;
      const sheet = {
        sheetId: `sheet_${Date.now().toString(16)}${Math.random().toString(16).slice(2, 8)}`,
        playerIdentityId: identity.id,
        ownerIdentityId: identity.id,
        title: String(body.title || "").trim() || "Character Sheet",
        state: "draft",
        content: String(body.content || "").trim(),
        structuredProfile: normalizeStructuredProfile(body.structuredProfile || {}),
        assetRefs: Array.isArray(body.assetRefs) ? body.assetRefs : [],
        primaryPortraitAssetId: typeof body.primaryPortraitAssetId === "string" ? body.primaryPortraitAssetId : "",
        tokenAssetId: typeof body.tokenAssetId === "string" ? body.tokenAssetId : "",
        createdAt: this.timestamp(),
        updatedAt: this.timestamp(),
      };
      current.characterSheets.push(sheet);
      await writeJson(this.characterSheetsJson(campaignId), { characterSheets: current.characterSheets });
      await this.touchCampaign(campaignId, identity.id, "character.sheet.created", { sheetId: sheet.sheetId });
      return sheet;
    };

    this.updateCharacterSheet = async (campaignId, sheetId, body, identity) => {
      const current = await this.readCampaign(campaignId);
      if (!current) return null;
      const sheet = current.characterSheets.find((item) => item.sheetId === sheetId);
      if (!sheet) return null;
      if (sheet.playerIdentityId !== identity.id) throw Object.assign(new Error("Only the owner may edit this draft sheet."), { code: "forbidden" });
      if (typeof body.title === "string") sheet.title = body.title.trim() || sheet.title;
      if (typeof body.content === "string") sheet.content = body.content;
      if (body.structuredProfile) sheet.structuredProfile = normalizeStructuredProfile(body.structuredProfile);
      if (body.sectionPath && Object.prototype.hasOwnProperty.call(body, "sectionValue")) {
        const normalized = normalizeStructuredProfile(sheet.structuredProfile);
        setSectionValue(normalized, body.sectionPath, typeof body.sectionValue === "string" ? body.sectionValue : "");
        sheet.structuredProfile = normalized;
      }
      if (Array.isArray(body.assetRefs)) sheet.assetRefs = body.assetRefs;
      if (typeof body.primaryPortraitAssetId === "string") sheet.primaryPortraitAssetId = body.primaryPortraitAssetId;
      if (typeof body.tokenAssetId === "string") sheet.tokenAssetId = body.tokenAssetId;
      sheet.updatedAt = this.timestamp();
      await writeJson(this.characterSheetsJson(campaignId), { characterSheets: current.characterSheets });
      await this.touchCampaign(campaignId, identity.id, "character.sheet.updated", { sheetId });
      return sheet;
    };

    this.approveCharacterSheet = async (campaignId, sheetId, identity) => {
      const current = await this.readCampaign(campaignId);
      if (!current) return null;
      const sheet = current.characterSheets.find((item) => item.sheetId === sheetId);
      if (!sheet) return null;
      if (current.campaign.gm.uuid !== identity.id) throw Object.assign(new Error("Only the Game Master may approve character sheets."), { code: "forbidden" });
      sheet.state = "approved";
      for (const asset of current.assets) {
        if (asset.linkedSheetId === sheetId && asset.publishOnApproval) asset.publicationState = "published";
      }
      sheet.updatedAt = this.timestamp();
      await writeJson(this.characterSheetsJson(campaignId), { characterSheets: current.characterSheets });
      await this.touchCampaign(campaignId, identity.id, "character.sheet.approved", { sheetId });
      return sheet;
    };

    this.returnCharacterSheetToDraft = async (campaignId, sheetId, identity) => {
      const current = await this.readCampaign(campaignId);
      if (!current) return null;
      const sheet = current.characterSheets.find((item) => item.sheetId === sheetId);
      if (!sheet) return null;
      if (current.campaign.gm.uuid !== identity.id) throw Object.assign(new Error("Only the Game Master may return character sheets to draft."), { code: "forbidden" });
      sheet.state = "draft";
      sheet.updatedAt = this.timestamp();
      await writeJson(this.characterSheetsJson(campaignId), { characterSheets: current.characterSheets });
      await this.touchCampaign(campaignId, identity.id, "character.sheet.returned-to-draft", { sheetId });
      return sheet;
    };

    this.createAIDraft = async (campaignId, body, identity) => {
      const current = await this.readCampaign(campaignId);
      if (!current) return null;
      const isGM = current.campaign.gm.uuid === identity.id;
      const isParticipant = current.participants.some((participant) => participant.identityId === identity.id);
      if (!isGM && !isParticipant) throw Object.assign(new Error("Identity is not authorized for this campaign."), { code: "forbidden" });
      const draft = {
        draftId: `draft_${Date.now().toString(16)}${Math.random().toString(16).slice(2, 8)}`,
        title: String(body.title || "").trim() || "AI Draft",
        content: String(body.content || "").trim() || "",
        state: "draft",
        createdAt: this.timestamp(),
        updatedAt: this.timestamp(),
        sourceDraftId: "",
        ownerIdentityId: identity.id,
        ownerRole: isGM ? "game_master" : "player",
        targetSheetId: typeof body.targetSheetId === "string" ? body.targetSheetId : "",
        sectionPath: typeof body.sectionPath === "string" ? body.sectionPath : "",
        candidateText: typeof body.candidateText === "string" ? body.candidateText : "",
      };
      current.aiDrafts.push(draft);
      await writeJson(this.aiDraftsJson(campaignId), { aiDrafts: current.aiDrafts });
      await this.appendCredit(campaignId, { creditId: `credit_${draft.draftId}`, campaignId, actorId: identity.id, draftId: draft.draftId, operation: "ai.draft.create", estimatedCredits: 1, actualCredits: 1, createdAt: draft.createdAt });
      await this.touchCampaign(campaignId, identity.id, "ai.draft.created", { draftId: draft.draftId });
      return { aiDraft: draft };
    };

    this.createAIPrepSessionDraft = async (campaignId, sessionId, body, identity) => {
      const current = await this.readCampaign(campaignId);
      if (!current) return null;
      const session = (current.aiSessions || []).find((item) => item.id === sessionId);
      if (!session) return null;
      if (session.ownerIdentityId !== identity.id && current.campaign.gm.uuid !== identity.id) throw Object.assign(new Error("Forbidden."), { code: "forbidden" });
      const clientRequestId = String(body.clientRequestId || "").trim();
      if (!clientRequestId) throw Object.assign(new Error("clientRequestId is required."), { code: "invalid_input" });
      const endpointKey = "POST ai.sessions.drafts";
      const sectionKey = String(body.sectionKey || session.sectionKey || "").trim();
      const sectionPath = String(body.sectionPath || session.sectionKey || "").trim();
      const dialogContext = Array.isArray(body.dialogContext)
        ? body.dialogContext
        : this.listVisibleAIPrepMessages(current.aiMessages, sessionId, session.activeThreadId || "");
      const dialogSummary = summarizeDialogContext(dialogContext);
      const effectiveInput = stableStringify({
        campaignId,
        identityId: identity.id,
        endpointKey,
        sessionId,
        operation: body.operation || "draft-generation",
        sectionKey,
        sectionPath,
        sectionData: body.sectionData && typeof body.sectionData === "object" ? body.sectionData : null,
        sectionSnapshot: body.sectionSnapshot && typeof body.sectionSnapshot === "object"
          ? body.sectionSnapshot
          : session.sectionSnapshot && typeof session.sectionSnapshot === "object"
            ? session.sectionSnapshot
            : null,
        structuredInput: body.structuredInput && typeof body.structuredInput === "object" ? body.structuredInput : null,
        dialogSummary,
        targetKind: session.targetKind,
        targetId: session.targetId,
        policyProfile: session.policyProfile,
      });
      const requestHash = await sha256(effectiveInput);
      const idempotency = await this.loadIdempotencyRecord(campaignId, identity.id, endpointKey, clientRequestId);
      if (idempotency) {
        if (idempotency.requestHash !== requestHash) throw Object.assign(new Error("Idempotency conflict."), { code: "ai.idempotency_conflict" });
        if (idempotency.status === "completed" && idempotency.responseRef) {
          return { aiDraft: current.aiDrafts.find((item) => item.draftId === idempotency.responseRef.draftId) || null };
        }
      }
      await this.saveIdempotencyRecord(campaignId, identity.id, endpointKey, clientRequestId, { clientRequestId, campaignId, identityId: identity.id, endpointKey, sessionId, requestHash, status: "started", createdAt: this.timestamp() });
      const targetSheet = current.characterSheets.find((item) => item.sheetId === session.targetId) || null;
      const currentSectionShape = targetSheet?.structuredProfile && sectionKey
        ? sectionValueForSectionKey(normalizeStructuredProfile(targetSheet.structuredProfile), sectionKey)
        : null;
      const baselineSectionData = currentSectionShape && typeof currentSectionShape === "object"
        ? normalizeStructuredCandidate(currentSectionShape, body.sectionSnapshot && typeof body.sectionSnapshot === "object" ? body.sectionSnapshot : body.sectionData && typeof body.sectionData === "object" ? body.sectionData : session.sectionSnapshot && typeof session.sectionSnapshot === "object" ? session.sectionSnapshot : currentSectionShape)
        : body.sectionSnapshot && typeof body.sectionSnapshot === "object"
          ? clone(body.sectionSnapshot)
          : body.sectionData && typeof body.sectionData === "object"
            ? clone(body.sectionData)
            : session.sectionSnapshot && typeof session.sectionSnapshot === "object"
              ? clone(session.sectionSnapshot)
              : null;
      if (baselineSectionData && !session.sectionSnapshot) session.sectionSnapshot = clone(baselineSectionData);
      const structuredMessages = buildStructuredDraftPrompt(sectionKey, baselineSectionData ?? {}, dialogContext);
      const schema = structuredSnapshotSchema(baselineSectionData ?? {});
      const providerResult = await this.callAiProvider({
        session: { ...session, mode: "text-draft-generation" },
        thread: { id: session.activeThreadId || "", providerConversationId: null, lastResponseId: null },
        messages: structuredMessages,
        operation: "draft-generation",
        textFormat: { type: "json_schema", name: `section_${sectionKey || "candidate"}_candidate`, strict: true, schema },
      });
      const parsedCandidate = parseJsonCandidate(providerResult.outputText);
      const normalizedSectionData = baselineSectionData && parsedCandidate
        ? normalizeStructuredCandidate(baselineSectionData, parsedCandidate)
        : baselineSectionData && parsedCandidate === null
          ? clone(baselineSectionData)
          : parsedCandidate;
      const sectionData = normalizedSectionData && baselineSectionData && typeof baselineSectionData === "object" && typeof normalizedSectionData === "object"
        ? normalizeStructuredCandidate(baselineSectionData, normalizedSectionData)
        : normalizedSectionData;
      const noChanges = stableStringify(sectionData) === stableStringify(baselineSectionData);
      const draft = {
        draftId: `draft_${Date.now().toString(16)}${Math.random().toString(16).slice(2, 8)}`,
        title: String(body.title || session.title || "AI Draft").trim() || "AI Draft",
        content: providerResult.outputText || "",
        state: "draft",
        createdAt: this.timestamp(),
        updatedAt: this.timestamp(),
        sourceDraftId: "",
        ownerIdentityId: identity.id,
        ownerRole: current.campaign.gm.uuid === identity.id ? "game_master" : "player",
        targetSheetId: session.targetKind === "character-profile-section" ? session.targetId : "",
        sectionPath,
        candidateText: "",
        candidateData: {
          targetKind: session.targetKind,
          targetId: session.targetId,
          sectionKey,
          sectionPath,
          sectionData,
          structuredInput: body.structuredInput && typeof body.structuredInput === "object" ? clone(body.structuredInput) : {},
          assistantSummary: providerResult.outputText || "",
          providerOutputText: providerResult.outputText || "",
          dialogContext: Array.isArray(dialogContext) ? clone(dialogContext) : [],
          noChanges,
        },
      };
      current.aiDrafts.push(draft);
      await writeJson(this.aiDraftsJson(campaignId), { aiDrafts: current.aiDrafts });
      await this.saveIdempotencyRecord(campaignId, identity.id, endpointKey, clientRequestId, { clientRequestId, campaignId, identityId: identity.id, endpointKey, sessionId, requestHash, status: "completed", responseRef: { draftId: draft.draftId }, createdAt: this.timestamp() });
      await this.touchCampaign(campaignId, identity.id, "ai.draft.created", { draftId: draft.draftId, sessionId });
      return { aiDraft: draft };
    };

    this.getAIDraft = async (campaignId, draftId) => {
      const current = await this.readCampaign(campaignId);
      return current?.aiDrafts.find((item) => item.draftId === draftId) || null;
    };

    this.updateAIDraft = async (campaignId, draftId, body, identity) => {
      const current = await this.readCampaign(campaignId);
      if (!current) return null;
      const draft = current.aiDrafts.find((item) => item.draftId === draftId);
      if (!draft) return null;
      if (current.campaign.gm.uuid !== identity.id || draft.ownerRole !== "game_master") throw Object.assign(new Error("Only the Game Master may edit Game Master AI drafts."), { code: "forbidden" });
      if (typeof body.title === "string") draft.title = body.title.trim() || draft.title;
      if (typeof body.content === "string") draft.content = body.content;
      if (typeof body.candidateText === "string") draft.candidateText = body.candidateText;
      draft.updatedAt = this.timestamp();
      await writeJson(this.aiDraftsJson(campaignId), { aiDrafts: current.aiDrafts });
      await this.touchCampaign(campaignId, identity.id, "ai.draft.edited", { draftId });
      return draft;
    };

    this.regenerateAIDraft = async (campaignId, draftId, identity) => {
      const current = await this.readCampaign(campaignId);
      if (!current) return null;
      const source = current.aiDrafts.find((item) => item.draftId === draftId);
      if (!source) return null;
      const isGM = current.campaign.gm.uuid === identity.id;
      if (isGM && source.ownerRole !== "game_master") throw Object.assign(new Error("Game Master AI cannot regenerate player-owned drafts."), { code: "forbidden" });
      if (!isGM && source.ownerIdentityId !== identity.id) throw Object.assign(new Error("Players may only regenerate their own drafts."), { code: "forbidden" });
      const regenerated = {
        draftId: `draft_${Date.now().toString(16)}${Math.random().toString(16).slice(2, 8)}`,
        title: `${source.title} (regenerated)`,
        content: source.content,
        state: "draft",
        sourceDraftId: draftId,
        ownerIdentityId: identity.id,
        ownerRole: isGM ? "game_master" : "player",
        createdAt: this.timestamp(),
        updatedAt: this.timestamp(),
      };
      current.aiDrafts.push(regenerated);
      await writeJson(this.aiDraftsJson(campaignId), { aiDrafts: current.aiDrafts });
      await this.appendCredit(campaignId, { creditId: `credit_${regenerated.draftId}`, campaignId, actorId: identity.id, draftId: regenerated.draftId, sourceDraftId: draftId, operation: "ai.draft.regenerate", estimatedCredits: 1, actualCredits: 1, createdAt: regenerated.createdAt });
      await this.touchCampaign(campaignId, identity.id, "ai.draft.regenerated", { draftId, regeneratedDraftId: regenerated.draftId });
      return regenerated;
    };

    this.acceptAIDraft = async (campaignId, draftId, identity) => {
      const current = await this.readCampaign(campaignId);
      if (!current) return null;
      const draft = current.aiDrafts.find((item) => item.draftId === draftId);
      if (!draft) return null;
      const isGM = current.campaign.gm.uuid === identity.id;
      const isOwner = draft.ownerIdentityId === identity.id;
      if (!isGM && !isOwner) throw Object.assign(new Error("Only the authorized owner may accept this AI draft."), { code: "forbidden" });
      if (!draft.targetSheetId) {
        draft.state = "accepted";
        draft.updatedAt = this.timestamp();
        await writeJson(this.aiDraftsJson(campaignId), { aiDrafts: current.aiDrafts });
        await this.touchCampaign(campaignId, identity.id, "ai.draft.accepted", { draftId });
        return draft;
      }
      const sheet = current.characterSheets.find((item) => item.sheetId === draft.targetSheetId);
      if (!sheet) throw Object.assign(new Error("Unknown character sheet id."), { code: "unknown_character_sheet" });
      if (sheet.playerIdentityId !== identity.id && !isGM) throw Object.assign(new Error("Only the authorized owner may accept this AI draft."), { code: "forbidden" });
      if (draft.candidateData && draft.candidateData.sectionData && draft.candidateData.sectionKey) {
        const normalized = normalizeStructuredProfile(sheet.structuredProfile);
        setSectionValue(normalized, draft.candidateData.sectionKey, draft.candidateData.sectionData);
        sheet.structuredProfile = normalized;
      } else if (draft.sectionPath) {
        const normalized = normalizeStructuredProfile(sheet.structuredProfile);
        setSectionValue(normalized, draft.sectionPath, draft.candidateText || draft.content || "");
        sheet.structuredProfile = normalized;
      }
      sheet.updatedAt = this.timestamp();
      draft.state = "accepted";
      draft.updatedAt = this.timestamp();
      await writeJson(this.aiDraftsJson(campaignId), { aiDrafts: current.aiDrafts });
      await writeJson(this.characterSheetsJson(campaignId), { characterSheets: current.characterSheets });
      await this.touchCampaign(campaignId, identity.id, "ai.draft.accepted", { draftId });
      return draft;
    };

    this.rejectAIDraft = async (campaignId, draftId, identity) => {
      const current = await this.readCampaign(campaignId);
      if (!current) return null;
      const draft = current.aiDrafts.find((item) => item.draftId === draftId);
      if (!draft) return null;
      if (current.campaign.gm.uuid !== identity.id || draft.ownerRole !== "game_master") throw Object.assign(new Error("Only the Game Master may reject Game Master AI drafts."), { code: "forbidden" });
      draft.state = "rejected";
      draft.updatedAt = this.timestamp();
      await writeJson(this.aiDraftsJson(campaignId), { aiDrafts: current.aiDrafts });
      await this.touchCampaign(campaignId, identity.id, "ai.draft.rejected", { draftId });
      return draft;
    };

    this.getAiRuntimeConfig = () => ({
      provider: process.env.AI_PROVIDER || "fake",
      openaiApiKey: process.env.OPENAI_API_KEY || "",
      openaiDefaultModel: process.env.OPENAI_DEFAULT_MODEL || "gpt-4.1-mini",
      openaiImageModel: process.env.OPENAI_IMAGE_MODEL || "gpt-image-1",
      timeoutMs: safeInt(process.env.AI_PROVIDER_TIMEOUT_MS, 60000),
      maxInputTokens: safeInt(process.env.AI_MAX_INPUT_TOKENS, 12000),
      maxOutputTokens: safeInt(process.env.AI_MAX_OUTPUT_TOKENS, 2048),
      creditPreauthMultiplier: Math.max(1, Number(process.env.AI_CREDIT_PREAUTH_MULTIPLIER || 1) || 1),
      pricingPolicyId: process.env.AI_DEFAULT_PRICING_POLICY_ID || "",
      initialCredits: safeInt(process.env.AI_CAMPAIGN_INITIAL_CREDITS, 100),
    });

    this.getPricingPolicy = async (campaignId) => {
      const policy = {
        id: this.getAiRuntimeConfig().pricingPolicyId || "pricing-openai-standard-v1",
        name: "OpenAI Standard",
        provider: "openai",
        model: this.getAiRuntimeConfig().openaiDefaultModel,
        modality: "text",
        validFrom: this.timestamp(),
        validTo: "",
        creditUsdValue: 0.01,
        markupMultiplier: 1.25,
        fixedOperationFeeCredits: 1,
        tokenRates: {
          textInput: 0.000001,
          textCachedInput: 0.0000005,
          textOutput: 0.000002,
          reasoning: 0.000002,
        },
        imageRates: {
          generation: 0.02,
          editing: 0.02,
        },
      };
      return policy;
    };

    this.normalizeUsage = (usage = {}, operation = "text-discussion", provider = "openai", model = "") => {
      const items = Array.isArray(usage.usageItems) ? usage.usageItems : [];
      const normalizedItems = items.map((item) => ({
        kind: String(item.kind || "text-output-token"),
        unit: String(item.unit || "token"),
        quantity: safeInt(item.quantity, 0),
        providerUnitPriceUsd: Number(item.providerUnitPriceUsd || 0),
        providerCostUsd: Number(item.providerCostUsd || 0),
      }));
      const providerCostUsd = normalizedItems.reduce((sum, item) => sum + item.providerCostUsd, 0);
      return {
        id: usage.id || `usage_${Date.now().toString(16)}`,
        campaignId: usage.campaignId || "",
        sessionId: usage.sessionId || "",
        threadId: usage.threadId || "",
        runId: usage.runId || "",
        initiatorIdentityId: usage.initiatorIdentityId || "",
        payerKind: usage.payerKind || "campaign-wallet",
        payerCampaignId: usage.payerCampaignId || "",
        provider,
        model,
        modality: usage.modality || "text",
        operation,
        inputTokens: safeInt(usage.inputTokens, 0),
        cachedInputTokens: safeInt(usage.cachedInputTokens, 0),
        outputTokens: safeInt(usage.outputTokens, 0),
        reasoningTokens: safeInt(usage.reasoningTokens, 0),
        imageInputTokens: safeInt(usage.imageInputTokens, 0),
        imageOutputTokens: safeInt(usage.imageOutputTokens, 0),
        usageItems: normalizedItems,
        providerCostUsd,
        pricingSource: usage.pricingSource || "openai-responses",
        createdAt: usage.createdAt || this.timestamp(),
      };
    };

    this.computeEstimatedChargeCredits = async (policy, operation = "text-discussion", operationEstimate = {}) => {
      const estimatedProviderCostUsd = Number(operationEstimate.providerCostUsd || 0);
      const estimatedUserChargeCredits = Math.ceil(((estimatedProviderCostUsd * policy.markupMultiplier) / policy.creditUsdValue) + policy.fixedOperationFeeCredits);
      return Math.ceil(estimatedUserChargeCredits * this.getAiRuntimeConfig().creditPreauthMultiplier);
    };

    this.computeChargeCredits = (policy, usageRecord) => Math.ceil(((Number(usageRecord.providerCostUsd || 0) * policy.markupMultiplier) / policy.creditUsdValue) + policy.fixedOperationFeeCredits);

    this.getCampaignWallet = async (campaignId) => {
      const existing = await readJson(this.walletJson(campaignId), null);
      if (existing) return existing;
      const now = this.timestamp();
      const wallet = {
        campaignId,
        balanceCredits: this.getAiRuntimeConfig().initialCredits,
        pricingPolicyId: this.getAiRuntimeConfig().pricingPolicyId || "pricing-openai-standard-v1",
        createdAt: now,
        updatedAt: now,
      };
      await this.saveCampaignWallet(campaignId, wallet);
      return wallet;
    };

    this.saveCampaignWallet = async (campaignId, wallet) => {
      await writeJson(this.walletJson(campaignId), wallet);
      return wallet;
    };

    this.saveAIPrepRunLog = async (campaignId, sessionId, runId, log) => {
      await writeJson(this.aiRunLogJson(campaignId, sessionId, runId), log);
      return log;
    };

    this.callAiProvider = async ({ session, thread, messages, operation, textFormat = null }) => {
      const cfg = this.getAiRuntimeConfig();
      if (cfg.provider !== "openai") {
        if (operation === "draft-generation") {
          const baselineMessage = (Array.isArray(messages) ? messages : []).find((message) => message.role === "system" && normalizeText(message.text || "").includes("Baseline section snapshot:"));
          const marker = "Baseline section snapshot:";
          const baselineMessageText = normalizeText(baselineMessage?.text || "");
          const markerIndex = baselineMessageText.indexOf(marker);
          const baselineText = markerIndex >= 0 ? baselineMessageText.slice(markerIndex + marker.length).trim() : "";
          let structuredText = baselineText;
          try {
            const parsed = JSON.parse(baselineText);
            structuredText = JSON.stringify(parsed);
          } catch {}
          const providerResponseId = `resp_${Date.now().toString(16)}`;
          return {
            provider: "fake",
            model: "fake",
            providerResponseId,
            providerConversationId: thread.providerConversationId || "",
            outputText: structuredText,
            usage: this.normalizeUsage({
              inputTokens: 1,
              outputTokens: 1,
              usageItems: [{ kind: "text-output-token", unit: "token", quantity: 1, providerUnitPriceUsd: 0, providerCostUsd: 0 }],
            }, operation, "fake", "fake"),
            status: "completed",
            assistantMessages: structuredText ? [{ role: "assistant", contentType: "text", text: structuredText, providerResponseId }] : [],
            receivedMessages: messages,
          };
        }
        return {
          provider: "fake",
          model: "fake",
          providerResponseId: `resp_${Date.now().toString(16)}`,
          providerConversationId: thread.providerConversationId || "",
          outputText: `Draft response: ${messages.at(-1)?.text || ""}`.trim(),
          usage: this.normalizeUsage({
            inputTokens: 1,
            outputTokens: 1,
            usageItems: [{ kind: "text-output-token", unit: "token", quantity: 1, providerUnitPriceUsd: 0, providerCostUsd: 0 }],
          }, operation, "fake", "fake"),
          status: "completed",
          assistantMessages: [],
          receivedMessages: messages,
        };
      }
      if (!cfg.openaiApiKey) throw Object.assign(new Error("Missing OpenAI API key."), { code: "ai.provider.unavailable" });
      const body = {
        model: session.mode && session.mode.startsWith("image") ? cfg.openaiImageModel : cfg.openaiDefaultModel,
        instructions: `You are assisting in campaign preparation. Policy profile: ${session.policyProfile}. Target kind: ${session.targetKind}.`,
        input: messages.map((message) => ({
          role: message.role === "assistant" ? "assistant" : message.role === "system" ? "system" : "user",
          content: message.text || "",
        })),
        max_output_tokens: cfg.maxOutputTokens,
      };
      if (textFormat) body.text = { format: textFormat };
      if (thread.lastResponseId) body.previous_response_id = thread.lastResponseId;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(new Error("OpenAI request timed out.")), cfg.timeoutMs);
      try {
        const response = await fetch("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: {
            authorization: `Bearer ${cfg.openaiApiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        if (!response.ok) {
          const text = await response.text().catch(() => "");
          const code = response.status === 401 || response.status === 403 || response.status === 429 || response.status >= 500 ? "ai.provider.unavailable" : "ai.provider.failed";
          throw Object.assign(new Error(`OpenAI request failed with status ${response.status}.`), { code, details: { status: response.status, body: text.slice(0, 500) } });
        }
        const json = await response.json();
        const outputText = Array.isArray(json.output) ? json.output.flatMap((item) => Array.isArray(item.content) ? item.content : []).map((content) => content?.text || content?.input_text || "").filter(Boolean).join("\n").trim() : "";
        const usage = this.normalizeUsage({
          inputTokens: safeInt(json.usage?.input_tokens, 0),
          cachedInputTokens: safeInt(json.usage?.input_tokens_details?.cached_tokens, 0),
          outputTokens: safeInt(json.usage?.output_tokens, 0),
          reasoningTokens: safeInt(json.usage?.output_tokens_details?.reasoning_tokens, 0),
          usageItems: [],
        }, operation, "openai", body.model);
        return {
          provider: "openai",
          model: body.model,
          providerResponseId: json.id || "",
          outputText,
          usage,
          status: outputText ? "completed" : "failed",
          assistantMessages: outputText ? [{ role: "assistant", contentType: "text", text: outputText, providerResponseId: json.id || "" }] : [],
        };
      } catch (error) {
        if (error?.name === "AbortError") throw Object.assign(new Error("OpenAI request timed out."), { code: "ai.provider.unavailable" });
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    };

    this.createAIPrepSession = async (campaignId, body, identity) => {
      const current = await this.readCampaign(campaignId);
      if (!current) return null;
      const profile = AI_POLICY_PROFILES[body.policyProfile] || null;
      const isGM = current.campaign.gm.uuid === identity.id;
      if (profile?.ownerRole === "game_master" && !isGM) throw Object.assign(new Error("Only the Game Master may create this AI session."), { code: "forbidden" });
      if (profile?.ownerRole === "player" && isGM) throw Object.assign(new Error("Game Master may not create a player-owned AI session."), { code: "forbidden" });
      const targetKind = requireKnownAiValue("targetKind", body.targetKind, AI_TARGET_KINDS);
      const mode = requireKnownAiValue("mode", body.mode || "text-discussion", AI_MODES);
      const outputKind = requireKnownAiValue("outputKind", body.outputKind || "", AI_OUTPUT_KINDS);
      if (!String(body.targetId || "").trim()) throw Object.assign(new Error("targetId is required."), { code: "invalid_input" });
      if (!String(body.policyProfile || "").trim()) throw Object.assign(new Error("policyProfile is required."), { code: "invalid_input" });
      const session = {
        id: `ai_session_${Date.now().toString(16)}${Math.random().toString(16).slice(2, 8)}`,
        campaignId,
        ownerIdentityId: identity.id,
        ownerRole: isGM ? "game_master" : "player",
        targetKind,
        targetId: String(body.targetId || "").trim(),
        sectionKey: String(body.sectionKey || ""),
        mode,
        policyProfile: String(body.policyProfile || "").trim(),
        outputKind,
        status: "active",
        title: String(body.title || "").trim() || "AI session",
        summary: null,
        activeThreadId: null,
        sectionSnapshot: body.sectionSnapshot && typeof body.sectionSnapshot === "object" ? clone(body.sectionSnapshot) : null,
        createdAt: this.timestamp(),
        updatedAt: this.timestamp(),
        closedAt: null,
      };
      current.aiSessions.push(session);
      await writeJson(this.aiSessionsJson(campaignId), { aiSessions: current.aiSessions });
      await this.touchCampaign(campaignId, identity.id, "ai.session.created", { sessionId: session.id });
      return session;
    };

    this.listAIPrepSessions = async (campaignId, identity) => {
      const current = await this.readCampaign(campaignId);
      if (!current) return null;
      const isGM = current.campaign.gm.uuid === identity.id;
      return (current.aiSessions || []).filter((session) => isGM || session.ownerIdentityId === identity.id);
    };

    this.getAIPrepSession = async (campaignId, sessionId, identity) => {
      const current = await this.readCampaign(campaignId);
      if (!current) return null;
      const session = (current.aiSessions || []).find((item) => item.id === sessionId);
      if (!session) return null;
      const isGM = current.campaign.gm.uuid === identity.id;
      if (!isGM && session.ownerIdentityId !== identity.id) throw Object.assign(new Error("Identity is not authorized for this AI session."), { code: "forbidden" });
      return session;
    };

    this.listAIPrepMessages = async (campaignId, sessionId, identity) => {
      const current = await this.readCampaign(campaignId);
      if (!current) return null;
      const session = (current.aiSessions || []).find((item) => item.id === sessionId);
      if (!session) return null;
      const isGM = current.campaign.gm.uuid === identity.id;
      if (!isGM && session.ownerIdentityId !== identity.id) throw Object.assign(new Error("Identity is not authorized for this AI session."), { code: "forbidden" });
      return this.listVisibleAIPrepMessages(current.aiMessages, sessionId, session.activeThreadId || "");
    };

    this.postAIPrepMessage = async (campaignId, sessionId, body, identity) => {
      const current = await this.readCampaign(campaignId);
      if (!current) return null;
      const session = (current.aiSessions || []).find((item) => item.id === sessionId);
      if (!session) return null;
      if (session.ownerIdentityId !== identity.id && current.campaign.gm.uuid !== identity.id) throw Object.assign(new Error("Forbidden."), { code: "forbidden" });
      const clientRequestId = String(body.clientRequestId || "").trim();
      if (!clientRequestId) throw Object.assign(new Error("clientRequestId is required."), { code: "invalid_input" });
      const endpointKey = "POST ai.sessions.messages";
      const normalizedText = normalizeText(body.text);
      const sectionSnapshot = body.sectionSnapshot && typeof body.sectionSnapshot === "object"
        ? clone(body.sectionSnapshot)
        : session.sectionSnapshot && typeof session.sectionSnapshot === "object"
          ? clone(session.sectionSnapshot)
          : this.getAIPrepSectionSnapshot(current, session);
      if (sectionSnapshot && typeof sectionSnapshot === "object") session.sectionSnapshot = clone(sectionSnapshot);
      const effectiveInput = stableStringify({
        campaignId,
        identityId: identity.id,
        endpointKey,
        sessionId,
        operation: body.operation || "text-discussion",
        contentType: body.contentType || "text",
        text: normalizedText,
        assetRefs: Array.isArray(body.assetRefs) ? [...body.assetRefs] : [],
        draftRefs: Array.isArray(body.draftRefs) ? [...body.draftRefs] : [],
        policyProfile: session.policyProfile,
        targetKind: session.targetKind,
        targetId: session.targetId,
        sectionKey: session.sectionKey,
        sectionSnapshot,
      });
      const requestHash = await sha256(effectiveInput);
      const idempotency = await this.loadIdempotencyRecord(campaignId, identity.id, endpointKey, clientRequestId);
      if (idempotency) {
        if (idempotency.requestHash !== requestHash) throw Object.assign(new Error("Idempotency conflict."), { code: "ai.idempotency_conflict" });
        if (idempotency.status === "completed" && idempotency.responseRef) {
          return { message: current.aiMessages.find((item) => item.id === idempotency.responseRef.userMessageId) || null, run: current.aiRuns.find((item) => item.id === idempotency.runId) || null, responseMessage: current.aiMessages.find((item) => item.id === idempotency.responseRef.assistantMessageId) || null };
        }
      }
      await this.saveIdempotencyRecord(campaignId, identity.id, endpointKey, clientRequestId, { clientRequestId, campaignId, identityId: identity.id, endpointKey, sessionId, requestHash, status: "started", createdAt: this.timestamp() });
      let thread = this.getAIPrepThread(current, session);
      if (!thread) {
        thread = {
          id: session.activeThreadId || `ai_thread_${Date.now().toString(16)}${Math.random().toString(16).slice(2, 8)}`,
          sessionId,
          campaignId,
          provider: "openai",
          model: this.getAiRuntimeConfig().openaiDefaultModel,
          mode: session.mode,
          providerConversationId: null,
          lastResponseId: null,
          status: "active",
          createdAt: this.timestamp(),
          updatedAt: this.timestamp(),
        };
        current.aiThreads.push(thread);
      }
      if (!session.activeThreadId) session.activeThreadId = thread.id;
      const userMessage = { id: `ai_msg_${Date.now().toString(16)}u`, sessionId, threadId: thread.id, role: "user", contentType: body.contentType || "text", text: normalizedText, assetRefs: Array.isArray(body.assetRefs) ? body.assetRefs : [], draftRefs: Array.isArray(body.draftRefs) ? body.draftRefs : [], providerResponseId: null, createdAt: this.timestamp() };
      current.aiMessages.push(userMessage);
      const run = { id: `ai_run_${Date.now().toString(16)}`, sessionId, threadId: thread.id, campaignId, provider: "openai", model: thread.model, operation: body.operation || "text-discussion", inputMessageIds: [userMessage.id], outputMessageIds: [], inputAssetIds: Array.isArray(body.assetRefs) ? body.assetRefs : [], outputAssetIds: [], relatedDraftId: "", providerResponseId: null, usageRecordId: null, status: "started", errorCode: "", createdAt: this.timestamp(), completedAt: null };
      current.aiRuns.push(run);
      await writeJson(this.aiSessionsJson(campaignId), { aiSessions: current.aiSessions });
      await writeJson(this.aiThreadsJson(campaignId), { aiThreads: current.aiThreads });
      await writeJson(this.aiMessagesJson(campaignId), { aiMessages: current.aiMessages });
      await writeJson(this.aiRunsJson(campaignId), { aiRuns: current.aiRuns });
      const policy = await this.getPricingPolicy(campaignId);
      const estimateCredits = await this.computeEstimatedChargeCredits(policy, body.operation || "text-discussion", { providerCostUsd: 0.01 });
      const wallet = await this.getCampaignWallet(campaignId);
      if (!wallet || safeInt(wallet.balanceCredits, 0) < estimateCredits) throw Object.assign(new Error("Campaign wallet does not satisfy the required estimate check."), { code: "ai.wallet.insufficient_credits" });
      const providerMessages = this.buildAIPrepProviderMessages(current, session, thread, userMessage);
      const startedAt = this.timestamp();
      let providerResult;
      try {
        providerResult = await this.callAiProvider({ session, thread, messages: providerMessages, operation: body.operation || "text-discussion" });
      } catch (error) {
        const failedLog = {
          campaignId,
          sessionId,
          threadId: thread.id,
          runId: run.id,
          provider: thread.provider,
          model: thread.model,
          operation: body.operation || "text-discussion",
          status: "failed",
          errorCode: error?.code || "internal_error",
          errorMessage: error?.message || "",
          createdAt: startedAt,
          completedAt: this.timestamp(),
          request: {
            messageCount: providerMessages.length,
            messageIds: providerMessages.map((message) => message.id),
            roles: providerMessages.map((message) => message.role),
            hasPreviousResponseId: !!thread.lastResponseId,
            continuationMode: thread.lastResponseId ? "provider-side" : "local-history",
          },
        };
        await this.saveAIPrepRunLog(campaignId, sessionId, run.id, failedLog);
        throw error;
      }
      const assistantMessages = [];
      for (const assistantMessage of providerResult.assistantMessages || []) {
        assistantMessages.push({ id: `ai_msg_${Date.now().toString(16)}a`, sessionId, threadId: thread.id, role: "assistant", contentType: assistantMessage.contentType || "text", text: assistantMessage.text || "", assetRefs: [], draftRefs: [], providerResponseId: providerResult.providerResponseId || null, createdAt: this.timestamp() });
      }
      current.aiMessages.push(...assistantMessages);
      const usageRecord = this.normalizeUsage({
        id: `usage_${Date.now().toString(16)}`,
        campaignId,
        sessionId,
        threadId: thread.id,
        runId: run.id,
        initiatorIdentityId: identity.id,
        payerKind: "campaign-wallet",
        payerCampaignId: campaignId,
        provider: providerResult.provider,
        model: providerResult.model,
        modality: "text",
        operation: body.operation || "text-discussion",
        inputTokens: providerResult.usage.inputTokens,
        cachedInputTokens: providerResult.usage.cachedInputTokens,
        outputTokens: providerResult.usage.outputTokens,
        reasoningTokens: providerResult.usage.reasoningTokens,
        imageInputTokens: providerResult.usage.imageInputTokens,
        imageOutputTokens: providerResult.usage.imageOutputTokens,
        usageItems: providerResult.usage.usageItems,
        providerCostUsd: providerResult.usage.providerCostUsd,
        pricingSource: "openai-responses",
        createdAt: this.timestamp(),
      }, body.operation || "text-discussion", providerResult.provider, providerResult.model);
      await this.appendUsage(campaignId, usageRecord);
      run.outputMessageIds = assistantMessages.map((message) => message.id);
      run.providerResponseId = providerResult.providerResponseId;
      run.usageRecordId = usageRecord.id;
      run.status = providerResult.status === "completed" ? "completed" : "failed";
      run.completedAt = this.timestamp();
      thread.providerConversationId = thread.providerConversationId || providerResult.providerConversationId || "";
      thread.lastResponseId = providerResult.status === "completed" ? (providerResult.providerResponseId || thread.lastResponseId) : thread.lastResponseId;
      thread.updatedAt = this.timestamp();
      session.activeThreadId = thread.id;
      session.updatedAt = this.timestamp();
      await writeJson(this.aiSessionsJson(campaignId), { aiSessions: current.aiSessions });
      await writeJson(this.aiThreadsJson(campaignId), { aiThreads: current.aiThreads });
      await writeJson(this.aiMessagesJson(campaignId), { aiMessages: current.aiMessages });
      await writeJson(this.aiRunsJson(campaignId), { aiRuns: current.aiRuns });
      await this.saveAIPrepRunLog(campaignId, sessionId, run.id, {
        campaignId,
        sessionId,
        threadId: thread.id,
        runId: run.id,
        provider: providerResult.provider,
        model: providerResult.model,
        operation: body.operation || "text-discussion",
        status: run.status,
        providerResponseId: providerResult.providerResponseId || "",
        inputMessageIds: providerMessages.map((message) => message.id),
        outputMessageIds: assistantMessages.map((message) => message.id),
        continuation: {
          strategy: thread.lastResponseId ? "local-history" : "local-history",
          previousResponseIdUsed: false,
          threadLastResponseId: thread.lastResponseId || "",
          providerConversationId: thread.providerConversationId || "",
        },
        request: {
          messageCount: providerMessages.length,
          messageIds: providerMessages.map((message) => message.id),
          roles: providerMessages.map((message) => message.role),
          hasPreviousResponseId: !!thread.lastResponseId,
          continuationMode: thread.lastResponseId ? "provider-side" : "local-history",
        },
        response: {
          assistantMessageCount: assistantMessages.length,
          outputTextLength: providerResult.outputText ? providerResult.outputText.length : 0,
        },
        createdAt: startedAt,
        completedAt: this.timestamp(),
      });
      const finalChargeCredits = this.computeChargeCredits(policy, usageRecord);
      const nextBalance = safeInt(wallet.balanceCredits, 0) - finalChargeCredits;
      if (nextBalance < 0) throw Object.assign(new Error("Campaign wallet charge failed."), { code: "ai.wallet.charge_failed" });
      wallet.balanceCredits = nextBalance;
      wallet.updatedAt = this.timestamp();
      await this.saveCampaignWallet(campaignId, wallet);
      const ledgerEntry = { id: `ledger_${Date.now().toString(16)}`, campaignId, entryType: "charge", reason: "ai-usage", usageRecordId: usageRecord.id, sessionId, runId: run.id, initiatorIdentityId: identity.id, payerKind: "campaign-wallet", payerCampaignId: campaignId, creditsBefore: nextBalance + finalChargeCredits, creditsDelta: -finalChargeCredits, creditsCharged: finalChargeCredits, creditsAfter: nextBalance, providerCostUsd: usageRecord.providerCostUsd, userChargeUsd: finalChargeCredits * policy.creditUsdValue, platformMarginUsd: (finalChargeCredits * policy.creditUsdValue) - usageRecord.providerCostUsd, pricingPolicyId: policy.id, pricingSnapshot: policy, createdAt: this.timestamp() };
      await this.appendCredit(campaignId, ledgerEntry);
      await this.saveIdempotencyRecord(campaignId, identity.id, endpointKey, clientRequestId, { clientRequestId, campaignId, identityId: identity.id, endpointKey, sessionId, requestHash, status: "completed", responseRef: { userMessageId: userMessage.id, assistantMessageId: assistantMessages[0]?.id || null }, runId: run.id, usageRecordId: usageRecord.id, ledgerEntryId: ledgerEntry.id, createdAt: this.timestamp() });
      await this.touchCampaign(campaignId, identity.id, "ai.session.message", { sessionId });
      return { message: userMessage, run, responseMessage: assistantMessages[0] || null };
    };

    this.listCharacterSheetsView = async (campaignId, identity) => {
      const current = await this.readCampaign(campaignId);
      if (!current) return null;
      const isGM = current.campaign.gm.uuid === identity.id;
      const isParticipant = current.participants.some((participant) => participant.identityId === identity.id);
      if (!isGM && !isParticipant) return null;
      const sheets = (current.characterSheets || []).map((sheet) => normalizeSheet(sheet, campaignId));
      return sheets.map((sheet) => ({
        sheetId: sheet.sheetId,
        title: sheet.title,
        state: sheet.state,
        playerIdentityId: sheet.playerIdentityId,
        ownerIdentityId: sheet.ownerIdentityId,
        summary: {
          name: sheet.structuredProfile.identity.name,
          shortDescription: sheet.structuredProfile.identity.shortDescription,
        },
      }));
    };

    this.getCharacterSheetView = async (campaignId, sheetId, identity) => {
      const current = await this.readCampaign(campaignId);
      if (!current) return null;
      const sheet = normalizeSheet(current.characterSheets.find((item) => item.sheetId === sheetId), campaignId);
      if (!sheet.sheetId) return null;
      const isGM = current.campaign.gm.uuid === identity.id;
      const isOwner = sheet.playerIdentityId === identity.id;
      const isParticipant = current.participants.some((participant) => participant.identityId === identity.id);
      if (!isGM && !isOwner && !isParticipant) return null;
      const assets = (current.assets || []).filter((asset) => asset.linkedSheetId === sheetId);
      const publicProfile = publicStructuredProfile(sheet);
      const privateProfile = {
        gmHooks: sheet.structuredProfile.gmHooks,
        playerIntent: sheet.structuredProfile.playerIntent,
      };
      const visibleAssets = assets.map(publicAssetProjection).filter(Boolean);
      const ownerAssets = assets.map((asset) => (isGM || isOwner ? normalizeAsset(asset, { campaignId, ownerIdentityId: sheet.playerIdentityId, ownerRole: "player" }) : null)).filter(Boolean);
      return {
        sheetId: sheet.sheetId,
        state: sheet.state,
        playerIdentityId: sheet.playerIdentityId,
        ownerIdentityId: sheet.ownerIdentityId,
        title: sheet.title,
        structuredProfile: isGM || isOwner ? { ...publicProfile, ...privateProfile } : publicProfile,
        assetRefs: isGM || isOwner ? ownerAssets : visibleAssets,
        primaryPortraitAssetId: sheet.primaryPortraitAssetId,
        tokenAssetId: sheet.tokenAssetId,
      };
    };

    this.createCharacterSheetAsset = async (campaignId, sheetId, body, identity) => {
      const current = await this.readCampaign(campaignId);
      if (!current) return null;
      const sheet = current.characterSheets.find((item) => item.sheetId === sheetId);
      if (!sheet) return null;
      if (sheet.playerIdentityId !== identity.id) throw Object.assign(new Error("Only the owner may add assets to this draft sheet."), { code: "forbidden" });
      const asset = normalizeAsset({
        campaignId,
        ownerIdentityId: identity.id,
        ownerRole: "player",
        kind: body.kind,
        source: body.source,
        purpose: body.purpose,
        linkedSheetId: sheetId,
        mediaType: body.mediaType,
        originalName: body.originalName,
        storagePath: body.storagePath,
        externalUrl: body.externalUrl,
        visibilityAudience: body.visibilityAudience || "specific players",
        publicationState: body.publicationState || "draft",
        publishOnApproval: body.publishOnApproval === true,
        metadata: body.metadata,
      }, { campaignId, ownerIdentityId: identity.id, ownerRole: "player", now: this.timestamp() });
      current.assets.push(asset);
      await writeJson(this.assetsJson(campaignId), { assets: current.assets });
      await this.touchCampaign(campaignId, identity.id, "asset.created", { assetId: asset.assetId, sheetId });
      return asset;
    };

    this.updateCharacterSheetAsset = async (campaignId, sheetId, assetId, body, identity) => {
      const current = await this.readCampaign(campaignId);
      if (!current) return null;
      const sheet = current.characterSheets.find((item) => item.sheetId === sheetId);
      const asset = current.assets.find((item) => item.assetId === assetId && item.linkedSheetId === sheetId);
      if (!sheet || !asset) return null;
      if (sheet.playerIdentityId !== identity.id) throw Object.assign(new Error("Only the owner may update this draft asset."), { code: "forbidden" });
      if (typeof body.purpose === "string") asset.purpose = body.purpose;
      if (typeof body.publishOnApproval === "boolean") asset.publishOnApproval = body.publishOnApproval;
      if (typeof body.visibilityAudience === "string") asset.visibilityAudience = body.visibilityAudience;
      asset.updatedAt = this.timestamp();
      await writeJson(this.assetsJson(campaignId), { assets: current.assets });
      await this.touchCampaign(campaignId, identity.id, "asset.updated", { assetId, sheetId });
      return asset;
    };

    this.deleteCharacterSheetAsset = async (campaignId, sheetId, assetId, identity) => {
      const current = await this.readCampaign(campaignId);
      if (!current) return null;
      const sheet = current.characterSheets.find((item) => item.sheetId === sheetId);
      if (!sheet) return null;
      if (sheet.playerIdentityId !== identity.id) throw Object.assign(new Error("Only the owner may remove this draft asset."), { code: "forbidden" });
      current.assets = current.assets.filter((item) => !(item.assetId === assetId && item.linkedSheetId === sheetId));
      sheet.assetRefs = (sheet.assetRefs || []).filter((ref) => ref !== assetId);
      if (sheet.primaryPortraitAssetId === assetId) sheet.primaryPortraitAssetId = "";
      if (sheet.tokenAssetId === assetId) sheet.tokenAssetId = "";
      await writeJson(this.assetsJson(campaignId), { assets: current.assets });
      await writeJson(this.characterSheetsJson(campaignId), { characterSheets: current.characterSheets });
      await this.touchCampaign(campaignId, identity.id, "asset.deleted", { assetId, sheetId });
      return true;
    };

    this.deleteCampaign = async (campaignId) => {
      const fs = await import("node:fs/promises");
      const dir = this.campaignRoot(campaignId);
      const current = await this.readCampaign(campaignId);
      if (!current) return false;
      await fs.rm(dir, { recursive: true, force: true });
      return true;
    };

    this.cleanupExpiredCampaigns = async () => {
      const fs = await import("node:fs/promises");
      await this.init();
      const root = `${this.root}/campaigns`;
      const entries = await fs.readdir(root, { withFileTypes: true }).catch((error) => {
        if (error?.code === "ENOENT") return [];
        throw error;
      });
      const removedCampaignIds = [];
      const nowMs = this.now().getTime();
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const dir = `${root}/${entry.name}`;
        let shouldDelete = false;
        try {
          const campaign = await readJson(`${dir}/campaign.json`, null);
          const lastActivityAt = campaign?.lastActivityAt;
          const lastActivityMs = typeof lastActivityAt === "string" ? Date.parse(lastActivityAt) : Number.NaN;
          shouldDelete = !campaign || !Number.isFinite(lastActivityMs) || (nowMs - lastActivityMs > RETENTION_WINDOW_MS);
        } catch {
          shouldDelete = true;
        }
        if (!shouldDelete) continue;
        await fs.rm(dir, { recursive: true, force: true });
        removedCampaignIds.push(entry.name);
      }
      return removedCampaignIds;
    };
  }
}
