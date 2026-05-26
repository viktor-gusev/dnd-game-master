import { createApiClient } from "./api/client.js";
import { mountDeveloperDiagnosticsPanel } from "./diagnostics.js";
import { ensureLocalIdentity, saveLocalIdentity, saveCampaignId } from "./state/local-state.js";

function el(id, doc = document) { return doc.getElementById(id); }

export async function initializeCampaignWorkspace({
  document: doc = globalThis.document,
  storage = globalThis.localStorage,
  locationApi = globalThis.location,
  cryptoApi = globalThis.crypto,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!doc?.getElementById) return;
  await mountDeveloperDiagnosticsPanel();
  const params = new URL(locationApi?.href || doc.location?.href || "http://localhost/campaign.html").searchParams;
  const campaignId = params.get("campaignId") || "";
  const state = ensureLocalIdentity(storage, cryptoApi);
  state.campaignId = campaignId;
  saveLocalIdentity(state, storage); saveCampaignId(campaignId, storage);
  const api = createApiClient({ fetchImpl, getIdentity: () => ({ uuid: state.uuid, nickname: state.nickname }) });
  const status = el("status", doc); const title = el("campaignTitle", doc); const subtitle = el("campaignSubtitle", doc);
  const brief = el("brief", doc); const events = el("events", doc); const drafts = el("drafts", doc); const credits = el("credits", doc);
  const backLink = el("backToDirectory", doc); if (backLink) backLink.setAttribute("href", "/");
  if (!campaignId) { if (status) status.textContent = "Campaign id is missing. Return to the Campaign Directory."; return; }

  async function load() {
    const response = await api(`/api/campaigns/${campaignId}`, { operation: "load-campaign" });
    if (!response.ok) return status && (status.textContent = response.error?.message || "Failed to load campaign.");
    const campaign = response.data.campaign;
    if (title) title.textContent = campaign.title;
    if (subtitle) subtitle.textContent = `GM: ${campaign.gm?.nickname || "Unknown"} · Participants: ${response.data.participants.length}`;
    if (brief) brief.textContent = JSON.stringify(response.data.brief || {}, null, 2);
    if (events) events.textContent = JSON.stringify(response.data.events || [], null, 2);
    if (drafts) drafts.textContent = JSON.stringify(response.data.aiDrafts || [], null, 2);
    if (credits) credits.textContent = JSON.stringify(response.data.credits || [], null, 2);
  }

  if (doc.getElementById("briefForm")) {
    doc.getElementById("briefForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const response = await api(`/api/campaigns/${campaignId}/brief`, { method: "PATCH", operation: "update-brief", body: JSON.stringify({ title: form.title.value, summary: form.summary.value, planning: form.planning.value, recap: form.recap.value }) });
      if (!response.ok) return status && (status.textContent = response.error?.message || "Failed to update brief.");
      await load();
    });
  }
  if (doc.getElementById("sheetForm")) {
    doc.getElementById("sheetForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const response = await api(`/api/campaigns/${campaignId}/character-sheets`, { method: "POST", operation: "create-sheet", body: JSON.stringify({ title: form.title.value, content: form.content.value }) });
      if (!response.ok) return status && (status.textContent = response.error?.message || "Failed to create sheet.");
      await load();
    });
  }
  if (doc.getElementById("draftForm")) {
    doc.getElementById("draftForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget;
      const response = await api(`/api/campaigns/${campaignId}/ai/drafts`, { method: "POST", operation: "create-draft", body: JSON.stringify({ title: form.title.value, content: form.content.value }) });
      if (!response.ok) return status && (status.textContent = response.error?.message || "Failed to create draft.");
      await load();
    });
  }
  if (doc.getElementById("refreshButton")) {
    doc.getElementById("refreshButton").addEventListener("click", load);
  }
  await load();
}

if (typeof document !== "undefined") void initializeCampaignWorkspace();
