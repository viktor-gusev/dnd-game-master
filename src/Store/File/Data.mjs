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
    this.eventsNdjson = (campaignId) => `${this.campaignRoot(campaignId)}/events.ndjson`;
    this.creditsNdjson = (campaignId) => `${this.campaignRoot(campaignId)}/credits.ndjson`;

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
        events: await readNdjson(this.eventsNdjson(campaignId)),
        credits: await readNdjson(this.creditsNdjson(campaignId)),
      };
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
      characterSheets: Array.isArray(current.characterSheets) ? current.characterSheets : [],
      aiDrafts: Array.isArray(current.aiDrafts) ? current.aiDrafts : [],
      events: Array.isArray(current.events) ? current.events : [],
      credits: Array.isArray(current.credits) ? current.credits : [],
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
      await this.appendEvent(campaignId, { eventId: `evt_${campaignId}_created`, campaignId, type: "campaign.created", actorId: identity.id, createdAt: now, payload: { title: campaign.title } });
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
        characterSheets: (Array.isArray(current.characterSheets) ? current.characterSheets : []).filter((sheet) => isGM || sheet.playerIdentityId === identityId || sheet.state === "approved"),
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
      if (sheet.playerIdentityId !== identity.id && current.campaign.gm.uuid !== identity.id) throw Object.assign(new Error("Only the owner or Game Master may edit this sheet."), { code: "forbidden" });
      if (typeof body.title === "string") sheet.title = body.title.trim() || sheet.title;
      if (typeof body.content === "string") sheet.content = body.content;
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
      };
      current.aiDrafts.push(draft);
      await writeJson(this.aiDraftsJson(campaignId), { aiDrafts: current.aiDrafts });
      await this.appendCredit(campaignId, { creditId: `credit_${draft.draftId}`, campaignId, actorId: identity.id, draftId: draft.draftId, operation: "ai.draft.create", estimatedCredits: 1, actualCredits: 1, createdAt: draft.createdAt });
      await this.touchCampaign(campaignId, identity.id, "ai.draft.created", { draftId: draft.draftId });
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
      if (current.campaign.gm.uuid !== identity.id || draft.ownerRole !== "game_master") throw Object.assign(new Error("Only the Game Master may accept Game Master AI drafts."), { code: "forbidden" });
      draft.state = "accepted";
      draft.updatedAt = this.timestamp();
      await writeJson(this.aiDraftsJson(campaignId), { aiDrafts: current.aiDrafts });
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
