// @ts-check

import DataStore from "../../Store/File/Data.mjs";

/**
 * @namespace Dnd_Gm_Web_Handler_Api
 * @description HTTP API handler for campaign-centered application state.
 */

function json(res, status, body) {
  if (!res.writableEnded) {
    res.statusCode = status;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify(body));
  }
}

function jsonNoStore(res, status, body) {
  if (!res.writableEnded) {
    res.setHeader("cache-control", "no-store");
    res.setHeader("pragma", "no-cache");
    json(res, status, body);
  }
}

function error(code, message) {
  return { ok: false, error: { code, message } };
}

function success(data) {
  return { ok: true, data };
}

function complete(context) {
  if (typeof context?.complete === "function") context.complete();
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw Object.assign(new Error("Invalid JSON body."), { code: "invalid_json" });
  }
}

function logEventDeliveryFailure(req, err) {
  const url = new URL(req.url, "http://localhost");
  const details = [
    `method=${req.method || "GET"}`,
    `path=${url.pathname}`,
    `errorCode=${err?.code || "internal_error"}`,
  ];
  if (req.headers?.["x-local-identity-id"]) details.push(`identityId=${req.headers["x-local-identity-id"]}`);
  console.warn(`[event-delivery] request failed ${details.join(" ")}`, err?.message ? `message=${err.message}` : "");
}

function campaignSummaryForList(campaign, currentIdentityId = "") {
  return {
    campaignId: campaign.campaignId,
    title: campaign.title,
    gm: campaign.gm,
    participantCount: campaign.participantCount,
    currentUserParticipant: !!currentIdentityId && campaign.participants.some((participant) => participant.identityId === currentIdentityId),
    lastActivityAt: campaign.lastActivityAt,
    brief: campaign.brief,
  };
}

function campaignFrom(current) {
  return current?.campaign || current || null;
}

function ensureParticipant(campaign, identityId) {
  if (!campaign.participants.some((participant) => participant.identityId === identityId)) {
    throw Object.assign(new Error("Identity is not a campaign participant."), { code: "invalid_input" });
  }
}

export default class Dnd_Gm_Web_Handler_Api {
  constructor({ dataStore, eventDelivery }) {
    this.dataStore = dataStore || new DataStore();
    this.eventDelivery = eventDelivery;
    this.getRegistrationInfo = () => ({ name: this.constructor.name, stage: "PROCESS" });

    this.resolveIdentityFromHeader = async (req) => {
      const identityId = req.headers["x-local-identity-id"];
      if (!identityId) throw Object.assign(new Error("Missing local identity id."), { code: "missing_identity" });
      const identity = await this.dataStore.getIdentity(identityId);
      if (!identity) throw Object.assign(new Error("Unknown local identity id."), { code: "unknown_identity" });
      return identity;
    };

    this.postLocalIdentity = async (req, res, context) => {
      const body = await readBody(req);
      const identity = await this.dataStore.upsertIdentity(body.uuid, body.nickname);
      complete(context);
      json(res, 200, success({ identity }));
    };

    this.getCurrentIdentity = async (req, res, context) => {
      const identity = await this.resolveIdentityFromHeader(req);
      complete(context);
      json(res, 200, success({ identity }));
    };

    this.listCampaigns = async (req, res, context) => {
      const identityId = req.headers["x-local-identity-id"] || "";
      if (identityId) await this.resolveIdentityFromHeader(req);
      const campaigns = await this.dataStore.listCampaigns(identityId);
      complete(context);
      json(res, 200, success({ campaigns: campaigns.map((campaign) => campaignSummaryForList(campaign, identityId)) }));
    };

    this.createCampaign = async (req, res, context) => {
      const identity = await this.resolveIdentityFromHeader(req);
      const body = await readBody(req);
      const current = await this.dataStore.createCampaign(identity, { title: body.title, linkCode: body.linkCode });
      const campaign = campaignFrom(current);
      complete(context);
      json(res, 200, success({ campaignId: campaign.campaignId, campaign }));
    };

    this.getCampaign = async (campaignId, req, res, context) => {
      const identity = await this.resolveIdentityFromHeader(req);
      const current = await this.dataStore.loadCampaign(campaignId, identity.id);
      if (!current) throw Object.assign(new Error("Unknown campaign id."), { code: "unknown_campaign" });
      ensureParticipant(current, identity.id);
      complete(context);
      json(res, 200, success({ campaign: campaignFrom(current), brief: current.brief, participants: current.participants, materials: current.materials, assets: current.assets, characterSheets: current.characterSheets, aiDrafts: current.aiDrafts, events: current.events, credits: current.credits }));
    };

    this.patchCampaign = async (campaignId, req, res, context) => {
      const identity = await this.resolveIdentityFromHeader(req);
      const current = await this.dataStore.loadCampaign(campaignId, identity.id);
      if (!current) throw Object.assign(new Error("Unknown campaign id."), { code: "unknown_campaign" });
      const campaign = campaignFrom(current);
      if (campaign.gm.uuid !== identity.id) throw Object.assign(new Error("Only the Game Master may update this campaign."), { code: "forbidden" });
      const body = await readBody(req);
      const updated = await this.dataStore.updateCampaign(campaignId, body, identity);
      complete(context);
      json(res, 200, success({ campaign: campaignFrom(updated) }));
    };

    this.joinCampaign = async (campaignId, req, res, context) => {
      const identity = await this.resolveIdentityFromHeader(req);
      const body = await readBody(req);
      const current = await this.dataStore.joinCampaign(campaignId, identity, body);
      if (!current) throw Object.assign(new Error("Unknown campaign id."), { code: "unknown_campaign" });
      complete(context);
      json(res, 200, success({ campaignId: campaignFrom(current).campaignId, joined: true, campaign: campaignFrom(current) }));
    };

    this.deleteCampaign = async (campaignId, req, res, context) => {
      const identity = await this.resolveIdentityFromHeader(req);
      const current = await this.dataStore.loadCampaign(campaignId, identity.id);
      if (!current) throw Object.assign(new Error("Unknown campaign id."), { code: "unknown_campaign" });
      if (campaignFrom(current).gm?.uuid !== identity.id) {
        throw Object.assign(new Error("Only the Game Master may delete this campaign."), { code: "forbidden" });
      }
      const deleted = await this.dataStore.deleteCampaign(campaignId);
      if (!deleted) throw Object.assign(new Error("Unknown campaign id."), { code: "unknown_campaign" });
      this.eventDelivery?.notifyCampaignDeletion?.({ campaignId, localIdentityIds: current.participants.map((participant) => participant.identityId) });
      complete(context);
      json(res, 200, success({ campaignId, deleted: true }));
    };

    this.getBrief = async (campaignId, req, res, context) => {
      const identity = await this.resolveIdentityFromHeader(req);
      const current = await this.dataStore.loadCampaign(campaignId, identity.id);
      if (!current) throw Object.assign(new Error("Unknown campaign id."), { code: "unknown_campaign" });
      ensureParticipant(current, identity.id);
      complete(context);
      json(res, 200, success({ brief: current.brief }));
    };

    this.patchBrief = async (campaignId, req, res, context) => {
      const identity = await this.resolveIdentityFromHeader(req);
      const current = await this.dataStore.loadCampaign(campaignId, identity.id);
      if (!current) throw Object.assign(new Error("Unknown campaign id."), { code: "unknown_campaign" });
      if (campaignFrom(current).gm.uuid !== identity.id) throw Object.assign(new Error("Only the Game Master may update brief data."), { code: "forbidden" });
      const body = await readBody(req);
      const updated = await this.dataStore.updateBrief(campaignId, body, identity);
      complete(context);
      json(res, 200, success({ brief: updated.brief }));
    };

    this.listEvents = async (campaignId, req, res, context) => {
      const identity = await this.resolveIdentityFromHeader(req);
      const current = await this.dataStore.loadCampaign(campaignId, identity.id);
      if (!current) throw Object.assign(new Error("Unknown campaign id."), { code: "unknown_campaign" });
      ensureParticipant(current, identity.id);
      complete(context);
      json(res, 200, success({ events: current.events }));
    };

    this.listCredits = async (campaignId, req, res, context) => {
      const identity = await this.resolveIdentityFromHeader(req);
      const current = await this.dataStore.loadCampaign(campaignId, identity.id);
      if (!current) throw Object.assign(new Error("Unknown campaign id."), { code: "unknown_campaign" });
      ensureParticipant(current, identity.id);
      complete(context);
      json(res, 200, success({ credits: current.credits }));
    };

    this.listMaterials = async (campaignId, req, res, context) => {
      const identity = await this.resolveIdentityFromHeader(req);
      const current = await this.dataStore.loadCampaign(campaignId, identity.id);
      if (!current) throw Object.assign(new Error("Unknown campaign id."), { code: "unknown_campaign" });
      ensureParticipant(current, identity.id);
      complete(context);
      json(res, 200, success({ materials: current.materials }));
    };

    this.postMaterial = async (campaignId, req, res, context) => {
      const identity = await this.resolveIdentityFromHeader(req);
      const body = await readBody(req);
      const current = await this.dataStore.loadCampaign(campaignId, identity.id);
      if (!current) throw Object.assign(new Error("Unknown campaign id."), { code: "unknown_campaign" });
      if (campaignFrom(current).gm.uuid !== identity.id) throw Object.assign(new Error("Only the Game Master may create materials."), { code: "forbidden" });
      const material = await this.dataStore.createMaterial(campaignId, body, identity);
      complete(context);
      json(res, 200, success({ material }));
    };

    this.listCharacterSheets = async (campaignId, req, res, context) => {
      const identity = await this.resolveIdentityFromHeader(req);
      const current = await this.dataStore.loadCampaign(campaignId, identity.id);
      if (!current) throw Object.assign(new Error("Unknown campaign id."), { code: "unknown_campaign" });
      ensureParticipant(current, identity.id);
      complete(context);
      json(res, 200, success({ characterSheets: current.characterSheets }));
    };

    this.postCharacterSheet = async (campaignId, req, res, context) => {
      const identity = await this.resolveIdentityFromHeader(req);
      const body = await readBody(req);
      const sheet = await this.dataStore.createCharacterSheet(campaignId, body, identity);
      complete(context);
      json(res, 200, success({ characterSheet: sheet }));
    };

    this.patchCharacterSheet = async (campaignId, sheetId, req, res, context) => {
      const identity = await this.resolveIdentityFromHeader(req);
      const body = await readBody(req);
      const sheet = await this.dataStore.updateCharacterSheet(campaignId, sheetId, body, identity);
      if (!sheet) throw Object.assign(new Error("Unknown character sheet id."), { code: "unknown_character_sheet" });
      complete(context);
      json(res, 200, success({ characterSheet: sheet }));
    };

    this.approveCharacterSheet = async (campaignId, sheetId, req, res, context) => {
      const identity = await this.resolveIdentityFromHeader(req);
      const sheet = await this.dataStore.approveCharacterSheet(campaignId, sheetId, identity);
      if (!sheet) throw Object.assign(new Error("Unknown character sheet id."), { code: "unknown_character_sheet" });
      complete(context);
      json(res, 200, success({ characterSheet: sheet }));
    };

    this.returnCharacterSheet = async (campaignId, sheetId, req, res, context) => {
      const identity = await this.resolveIdentityFromHeader(req);
      const sheet = await this.dataStore.returnCharacterSheetToDraft(campaignId, sheetId, identity);
      if (!sheet) throw Object.assign(new Error("Unknown character sheet id."), { code: "unknown_character_sheet" });
      complete(context);
      json(res, 200, success({ characterSheet: sheet }));
    };

    this.postAIDraft = async (campaignId, req, res, context) => {
      const identity = await this.resolveIdentityFromHeader(req);
      const body = await readBody(req);
      const result = await this.dataStore.createAIDraft(campaignId, body, identity);
      complete(context);
      json(res, 200, success({ aiDraft: result.aiDraft || result }));
    };

    this.getAIDraft = async (campaignId, draftId, req, res, context) => {
      const identity = await this.resolveIdentityFromHeader(req);
      const draft = await this.dataStore.getAIDraft(campaignId, draftId, identity.id);
      if (!draft) throw Object.assign(new Error("Unknown AI draft id."), { code: "unknown_ai_draft" });
      complete(context);
      json(res, 200, success({ aiDraft: draft }));
    };

    this.patchAIDraft = async (campaignId, draftId, req, res, context) => {
      const identity = await this.resolveIdentityFromHeader(req);
      const body = await readBody(req);
      const draft = await this.dataStore.updateAIDraft(campaignId, draftId, body, identity);
      if (!draft) throw Object.assign(new Error("Unknown AI draft id."), { code: "unknown_ai_draft" });
      complete(context);
      json(res, 200, success({ aiDraft: draft }));
    };

    this.regenerateAIDraft = async (campaignId, draftId, req, res, context) => {
      const identity = await this.resolveIdentityFromHeader(req);
      const draft = await this.dataStore.regenerateAIDraft(campaignId, draftId, identity);
      if (!draft) throw Object.assign(new Error("Unknown AI draft id."), { code: "unknown_ai_draft" });
      complete(context);
      json(res, 200, success({ aiDraft: draft }));
    };

    this.acceptAIDraft = async (campaignId, draftId, req, res, context) => {
      const identity = await this.resolveIdentityFromHeader(req);
      const accepted = await this.dataStore.acceptAIDraft(campaignId, draftId, identity);
      if (!accepted) throw Object.assign(new Error("Unknown AI draft id."), { code: "unknown_ai_draft" });
      complete(context);
      json(res, 200, success({ aiDraft: accepted }));
    };

    this.rejectAIDraft = async (campaignId, draftId, req, res, context) => {
      const identity = await this.resolveIdentityFromHeader(req);
      const rejected = await this.dataStore.rejectAIDraft(campaignId, draftId, identity);
      if (!rejected) throw Object.assign(new Error("Unknown AI draft id."), { code: "unknown_ai_draft" });
      complete(context);
      json(res, 200, success({ aiDraft: rejected }));
    };

    this.getEventDeliveryStream = async (req, res, context) => {
      res.setHeader("cache-control", "no-store");
      res.setHeader("pragma", "no-cache");
      const url = new URL(req.url, "http://localhost");
      const tabIdentityId = url.searchParams.get("tabIdentityId");
      const localIdentityId = url.searchParams.get("localIdentityId");
      if (!tabIdentityId) throw Object.assign(new Error("tabIdentityId is required."), { code: "invalid_input" });
      if (!localIdentityId) throw Object.assign(new Error("localIdentityId is required."), { code: "invalid_input" });
      this.eventDelivery.openStream({
        tabIdentityId,
        localIdentityId,
        campaignId: url.searchParams.get("campaignId") || "",
        request: req,
        response: res,
      });
      complete(context);
    };

    this.postEventDeliveryContext = async (req, res, context) => {
      const identity = await this.resolveIdentityFromHeader(req);
      const body = await readBody(req);
      if (typeof body.tabIdentityId !== "string" || !body.tabIdentityId.trim()) throw Object.assign(new Error("tabIdentityId is required."), { code: "invalid_input" });
      if ("localIdentityId" in body) throw Object.assign(new Error("localIdentityId is not accepted."), { code: "invalid_input" });
      const entry = this.eventDelivery.rebindContext({ tabIdentityId: body.tabIdentityId, campaignId: body.campaignId ?? "", localIdentityId: identity.id });
      complete(context);
      jsonNoStore(res, 200, success({ tabIdentityId: body.tabIdentityId, campaignId: entry?.campaignId || "" }));
    };

    this.handle = async (context) => {
      const req = context.request;
      const res = context.response;
      const url = new URL(req.url, "http://localhost");
      const method = req.method || "GET";
      try {
        if (url.pathname === "/api/identity/local" && method === "POST") return await this.postLocalIdentity(req, res, context);
        if (url.pathname === "/api/identity/current" && method === "GET") return await this.getCurrentIdentity(req, res, context);
        if (url.pathname === "/api/event-delivery" && method === "GET") return await this.getEventDeliveryStream(req, res, context);
        if (url.pathname === "/api/event-delivery/context" && method === "POST") return await this.postEventDeliveryContext(req, res, context);

        if (url.pathname === "/api/campaigns" && method === "GET") return await this.listCampaigns(req, res, context);
        if (url.pathname === "/api/campaigns" && method === "POST") return await this.createCampaign(req, res, context);

        const campaignMatch = url.pathname.match(/^\/api\/campaigns\/([^/]+)(?:\/(.+))?$/);
        if (campaignMatch) {
          const campaignId = campaignMatch[1];
          const tail = campaignMatch[2] || "";

          if (!tail && method === "GET") return await this.getCampaign(campaignId, req, res, context);
          if (!tail && method === "PATCH") return await this.patchCampaign(campaignId, req, res, context);
          if (!tail && method === "DELETE") return await this.deleteCampaign(campaignId, req, res, context);
          if (tail === "join" && method === "POST") return await this.joinCampaign(campaignId, req, res, context);
          if (tail === "brief" && method === "GET") return await this.getBrief(campaignId, req, res, context);
          if (tail === "brief" && method === "PATCH") return await this.patchBrief(campaignId, req, res, context);
          if (tail === "events" && method === "GET") return await this.listEvents(campaignId, req, res, context);
          if (tail === "credits" && method === "GET") return await this.listCredits(campaignId, req, res, context);
          if (tail === "materials" && method === "GET") return await this.listMaterials(campaignId, req, res, context);
          if (tail === "materials" && method === "POST") return await this.postMaterial(campaignId, req, res, context);
          if (tail === "character-sheets" && method === "GET") return await this.listCharacterSheets(campaignId, req, res, context);
          if (tail === "character-sheets" && method === "POST") return await this.postCharacterSheet(campaignId, req, res, context);

          const subMatch = tail.match(/^(character-sheets|ai\/drafts)\/([^/]+)(?:\/(approve|return-to-draft|regenerate|accept|reject))?$/);
          if (subMatch) {
            const collection = subMatch[1];
            const itemId = subMatch[2];
            const action = subMatch[3] || "";
            if (collection === "character-sheets" && !action && method === "PATCH") return await this.patchCharacterSheet(campaignId, itemId, req, res, context);
            if (collection === "character-sheets" && action === "approve" && method === "POST") return await this.approveCharacterSheet(campaignId, itemId, req, res, context);
            if (collection === "character-sheets" && action === "return-to-draft" && method === "POST") return await this.returnCharacterSheet(campaignId, itemId, req, res, context);
            if (collection === "ai/drafts" && !action && method === "GET") return await this.getAIDraft(campaignId, itemId, req, res, context);
            if (collection === "ai/drafts" && !action && method === "PATCH") return await this.patchAIDraft(campaignId, itemId, req, res, context);
            if (collection === "ai/drafts" && action === "regenerate" && method === "POST") return await this.regenerateAIDraft(campaignId, itemId, req, res, context);
            if (collection === "ai/drafts" && action === "accept" && method === "POST") return await this.acceptAIDraft(campaignId, itemId, req, res, context);
            if (collection === "ai/drafts" && action === "reject" && method === "POST") return await this.rejectAIDraft(campaignId, itemId, req, res, context);
          }
        }

        if (url.pathname.startsWith("/api/")) {
          complete(context);
          return json(res, 404, error("not_found", "Not found."));
        }
        return;
      } catch (err) {
        if (url.pathname.startsWith("/api/event-delivery/")) logEventDeliveryFailure(req, err);
        if (err?.code === "invalid_json") return json(res, 400, error("invalid_json", "Invalid JSON body."));
        if (err?.code === "missing_identity") return json(res, 400, error("missing_identity", "Missing local identity id."));
        if (err?.code === "unknown_identity") return json(res, 400, error("unknown_identity", "Unknown local identity id."));
        if (err?.code === "invalid_input") return json(res, 400, error("invalid_input", err.message));
        if (err?.code === "forbidden") return json(res, 403, error("forbidden", err.message || "Forbidden."));
        if (err?.code === "unknown_campaign") return json(res, 404, error("unknown_campaign", "Unknown campaign id."));
        if (err?.code === "unknown_character_sheet") return json(res, 404, error("unknown_character_sheet", "Unknown character sheet id."));
        if (err?.code === "unknown_ai_draft") return json(res, 404, error("unknown_ai_draft", "Unknown AI draft id."));
        if (err?.code === "invalid_client_instance_id") return json(res, 400, error("invalid_client_instance_id", "Invalid client instance id."));
        return json(res, 500, error("internal_error", "Internal server error."));
      }
    };
  }
}

export const __deps__ = Object.freeze({
  dataStore: "Dnd_Gm_Store_File_Data$",
  eventDelivery: "Dnd_Gm_Service_EventDelivery_Runtime$",
});
