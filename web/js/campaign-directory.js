import { createApiClient } from "./api/client.js";
import { createEventDeliveryClient, getOrCreateTabIdentityId } from "./event-delivery-client.js";
import { mountDeveloperDiagnosticsPanel } from "./diagnostics.js";
import { ensureLocalIdentity, saveLocalIdentity, saveCampaignId } from "./state/local-state.js";

function el(id, doc = document) { return doc.getElementById(id); }
function navigateToCampaign(campaignId, locationApi = globalThis.location) {
  const url = `/campaign.html?campaignId=${encodeURIComponent(campaignId)}`;
  if (locationApi?.assign) locationApi.assign(url); else if (locationApi) locationApi.href = url;
}

export async function initializeCampaignDirectoryApp({
  document: doc = globalThis.document,
  storage = globalThis.localStorage,
  locationApi = globalThis.location,
  cryptoApi = globalThis.crypto,
  fetchImpl = globalThis.fetch,
  confirmImpl = globalThis.confirm ? globalThis.confirm.bind(globalThis) : () => false,
} = {}) {
  if (!doc?.getElementById) return;
  await mountDeveloperDiagnosticsPanel();
  const state = ensureLocalIdentity(storage, cryptoApi);
  state.campaignId = "";
  const api = createApiClient({ fetchImpl, getIdentity: () => ({ uuid: state.uuid, nickname: state.nickname }) });
  const status = el("status", doc);
  const uuidInput = el("identityUuid", doc);
  const nicknameInput = el("identityNickname", doc);
  const campaignTitleInput = el("campaignTitle", doc);
  const list = el("campaignDirectory", doc);
  const detail = el("selectedCampaignDetail", doc);
  const summary = el("campaignDirectorySummary", doc);
  const tabIdentityId = getOrCreateTabIdentityId(storage, cryptoApi);
  const eventDelivery = createEventDeliveryClient({
    tabIdentityId,
    localIdentityId: state.uuid,
    campaignId: state.campaignId || "",
    fetchImpl,
    onMessage: () => {},
  });
  eventDelivery.connect();

  function persist() { saveLocalIdentity(state, storage); saveCampaignId(state.campaignId, storage); if (uuidInput) uuidInput.value = state.uuid; if (nicknameInput) nicknameInput.value = state.nickname; }
  function setStatus(text) { if (status) status.textContent = text; }
  function renderCampaigns(campaigns) {
    if (!list) return;
    list.innerHTML = "";
    if (summary) summary.textContent = `${campaigns.length} campaign${campaigns.length === 1 ? "" : "s"} listed.`;
    for (const campaign of campaigns) {
      const item = doc.createElement("article");
      item.className = "campaign-list-item";
      item.setAttribute("data-role", "campaign-list-item");
      const title = doc.createElement("h3");
      title.textContent = campaign.title || campaign.campaignId;
      const meta = doc.createElement("p");
      meta.textContent = `GM ${campaign.gm?.nickname || "unknown"} · ${campaign.participantCount} participants · Last activity ${campaign.lastActivityAt || "n/a"}`;
      const actions = doc.createElement("div");
      const open = doc.createElement("button");
      open.type = "button";
      open.textContent = campaign.currentUserParticipant ? "Open workspace" : "Join campaign";
      open.addEventListener("click", async () => {
        if (!campaign.currentUserParticipant) {
          const joined = await api(`/api/campaigns/${campaign.campaignId}/join`, { method: "POST", operation: "join-campaign", body: JSON.stringify({}) });
          if (!joined.ok) return setStatus(joined.error?.message || "Failed to join campaign.");
        }
        state.campaignId = campaign.campaignId;
        persist();
        void eventDelivery.updateCampaignContext(state.campaignId);
        navigateToCampaign(campaign.campaignId, locationApi);
      });
      actions.appendChild(open);
      item.addEventListener("click", async () => {
        state.campaignId = campaign.campaignId;
        persist();
        const response = await api(`/api/campaigns/${campaign.campaignId}`, { operation: "load-campaign", method: "GET" });
        if (response.ok && detail) {
          const data = response.data.campaign;
          detail.innerHTML = "";
          const card = doc.createElement("article");
          card.className = "campaign-card";
          card.innerHTML = `<p class="eyebrow">Selected campaign</p><h3>${data.title}</h3><p>Campaign ID: ${data.campaignId}</p><p>Game Master: ${data.gm?.nickname || "Unknown"}</p><p>Participants: ${response.data.participants.length}</p><p>Last activity: ${data.lastActivityAt || "n/a"}</p>`;
          const openBtn = doc.createElement("button");
          openBtn.type = "button";
          openBtn.textContent = "Open workspace";
          openBtn.addEventListener("click", () => navigateToCampaign(campaign.campaignId, locationApi));
          card.appendChild(openBtn);
          if (data.gm?.uuid === state.uuid) {
            const del = doc.createElement("button");
            del.type = "button";
            del.textContent = "Delete Campaign";
            del.addEventListener("click", async () => {
              if (!confirmImpl("Delete this campaign?")) return;
              const deleted = await api(`/api/campaigns/${campaign.campaignId}`, { method: "DELETE", operation: "delete-campaign" });
              if (!deleted.ok) return setStatus(deleted.error?.message || "Failed to delete campaign.");
              state.campaignId = "";
              persist();
              void eventDelivery.updateCampaignContext("");
              await refresh();
            });
            card.appendChild(del);
          }
          detail.appendChild(card);
        }
      });
      item.appendChild(title);
      item.appendChild(meta);
      item.appendChild(actions);
      list.appendChild(item);
    }
  }

  async function refresh() {
    const response = await api("/api/campaigns", { operation: "list-campaigns" });
    if (!response.ok) return setStatus(response.error?.message || "Failed to load campaigns.");
    renderCampaigns(response.data.campaigns || []);
    setStatus("Campaign Directory updated.");
  }

  const refreshButton = doc.getElementById("refreshCampaigns");
  if (refreshButton) {
    refreshButton.addEventListener("click", async () => {
      setStatus("Refreshing campaign list.");
      await refresh();
    });
  }

  if (doc.getElementById("identityForm")) {
    doc.getElementById("identityForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const response = await api("/api/identity/local", { method: "POST", operation: "save-identity", body: JSON.stringify({ uuid: uuidInput?.value, nickname: nicknameInput?.value }) });
      if (!response.ok) return setStatus(response.error?.message || "Failed to save identity.");
      state.uuid = response.data.identity.uuid; state.nickname = response.data.identity.nickname; persist(); setStatus("Local identity saved.");
    });
  }
  if (doc.getElementById("createCampaignForm")) {
    doc.getElementById("createCampaignForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const response = await api("/api/campaigns", { method: "POST", operation: "create-campaign", body: JSON.stringify({ title: campaignTitleInput?.value }) });
      if (!response.ok) return setStatus(response.error?.message || "Failed to create campaign.");
      state.campaignId = response.data.campaignId; persist(); void eventDelivery.updateCampaignContext(state.campaignId); navigateToCampaign(response.data.campaignId, locationApi);
    });
  }

  persist();
  await refresh();
}

if (typeof document !== "undefined") void initializeCampaignDirectoryApp();
