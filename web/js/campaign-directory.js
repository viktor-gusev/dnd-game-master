import { updateShellIdentity } from "./browser-shell.js";

function el(id, doc = document) {
  return doc.getElementById(id);
}

function navigateToCampaign(campaignId, locationApi = globalThis.location) {
  const url = `/campaign.html?campaignId=${encodeURIComponent(campaignId)}`;
  if (locationApi?.assign) locationApi.assign(url); else if (locationApi) locationApi.href = url;
}

export async function initializeCampaignDirectoryApp(shell) {
  const doc = shell.document;
  const list = el("campaignDirectory", doc);
  const summary = el("campaignDirectorySummary", doc);
  const status = el("status", doc);
  const identityDialog = el("identityDialog", doc);
  const createDialog = el("createCampaignDialog", doc);
  const detailsDialog = el("campaignDetailsDialog", doc);
  const details = el("selectedCampaignDetail", doc);
  const identityUuid = el("identityUuid", doc);
  const identityNickname = el("identityNickname", doc);
  const campaignTitleInput = el("campaignTitle", doc);
  const refreshButton = el("refreshCampaigns", doc);
  const shellPanel = el("shellPanel", doc);

  shell.setPageContext({ kind: "campaign directory", campaignId: "" });
  if (identityUuid) identityUuid.value = shell.identity.uuid;
  if (identityNickname) identityNickname.value = shell.identity.nickname;
  if (status) status.textContent = "Preparing browser-local identity.";

  function renderCampaignDetails(campaign, response) {
    if (!details) return;
    details.innerHTML = "";
    const card = doc.createElement("article");
    card.className = "campaign-card";
    card.innerHTML = `<p class="eyebrow">Selected campaign</p><h3>${campaign.title}</h3><p>Campaign ID: ${campaign.campaignId}</p><p>Game Master: ${campaign.gm?.nickname || "Unknown"}</p><p>Participants: ${response.data.participants.length}</p><p>Last activity: ${campaign.lastActivityAt || "n/a"}</p>`;
    const openBtn = doc.createElement("button");
    openBtn.type = "button";
    openBtn.textContent = "Open workspace";
    openBtn.addEventListener("click", () => navigateToCampaign(campaign.campaignId, shell.locationApi));
    card.appendChild(openBtn);
    if (campaign.gm?.uuid === shell.identity.uuid) {
      const del = doc.createElement("button");
      del.type = "button";
      del.textContent = "Delete Campaign";
      del.addEventListener("click", async () => {
        if (!shell.confirmImpl("Delete this campaign?")) return;
        const deleted = await shell.api(`/api/campaigns/${campaign.campaignId}`, { method: "DELETE", operation: "delete-campaign" });
        if (!deleted.ok) return shell.pageError(deleted.error?.message || "Failed to delete campaign.");
        await refresh();
      });
      card.appendChild(del);
    }
    details.appendChild(card);
    if (detailsDialog && typeof detailsDialog.showModal === "function") detailsDialog.showModal();
  }

  async function refresh() {
    const response = await shell.api("/api/campaigns", { operation: "list-campaigns" });
    if (!response.ok) return shell.pageError(response.error?.message || "Failed to load campaigns.");
    const campaigns = response.data.campaigns || [];
    if (list) {
      list.innerHTML = "";
      for (const campaign of campaigns) {
        const item = doc.createElement("article");
        item.className = "campaign-list-item";
        item.innerHTML = `<h3>${campaign.title || campaign.campaignId}</h3><p>GM ${campaign.gm?.nickname || "unknown"} · ${campaign.participantCount} participants · Last activity ${campaign.lastActivityAt || "n/a"}</p>`;
        const actions = doc.createElement("div");
        const open = doc.createElement("button");
        open.type = "button";
        open.textContent = campaign.currentUserParticipant ? "Open workspace" : "Join campaign";
        open.addEventListener("click", async () => {
          if (!campaign.currentUserParticipant) {
            const joined = await shell.api(`/api/campaigns/${campaign.campaignId}/join`, { method: "POST", operation: "join-campaign", body: JSON.stringify({}) });
            if (!joined.ok) return shell.pageError(joined.error?.message || "Failed to join campaign.");
          }
          navigateToCampaign(campaign.campaignId, shell.locationApi);
        });
        const detailsBtn = doc.createElement("button");
        detailsBtn.type = "button";
        detailsBtn.textContent = "Details";
        detailsBtn.addEventListener("click", async () => {
          const selected = await shell.api(`/api/campaigns/${campaign.campaignId}`, { operation: "load-campaign", method: "GET" });
          if (selected.ok) renderCampaignDetails(selected.data.campaign, selected);
        });
        actions.appendChild(open);
        actions.appendChild(detailsBtn);
        item.appendChild(actions);
        list.appendChild(item);
      }
    }
    if (summary) summary.textContent = `${campaigns.length} campaign${campaigns.length === 1 ? "" : "s"} listed.`;
    if (status) status.textContent = "Campaign Directory updated.";
  }

  if (refreshButton) refreshButton.addEventListener("click", refresh);
  if (el("openIdentityEditor", doc)) el("openIdentityEditor", doc).addEventListener("click", () => shell.openIdentityEditor());
  if (el("openCreateCampaign", doc)) el("openCreateCampaign", doc).addEventListener("click", () => shell.openCampaignCreator());
  if (identityDialog) {
    const form = identityDialog.querySelector("form");
    if (form) form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const response = await shell.api("/api/identity/local", {
        method: "POST",
        operation: "save-identity",
        body: JSON.stringify({ uuid: identityUuid?.value, nickname: identityNickname?.value }),
      });
      if (!response.ok) return shell.pageError(response.error?.message || "Failed to save identity.");
      updateShellIdentity(shell, response.data.identity);
      if (identityUuid) identityUuid.value = shell.identity.uuid;
      if (identityNickname) identityNickname.value = shell.identity.nickname;
    });
  }
  if (createDialog) {
    const form = createDialog.querySelector("form");
    if (form) form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const response = await shell.api("/api/campaigns", { method: "POST", operation: "create-campaign", body: JSON.stringify({ title: campaignTitleInput?.value }) });
      if (!response.ok) return shell.pageError(response.error?.message || "Failed to create campaign.");
      navigateToCampaign(response.data.campaignId, shell.locationApi);
    });
  }

  shell.pageError("");
  if (shellPanel) shellPanel.hidden = true;
  await refresh();
}

if (typeof document !== "undefined") void import("./browser-shell.js").then(({ initializeBrowserApplicationShell }) => initializeBrowserApplicationShell({ pageController: initializeCampaignDirectoryApp }));
