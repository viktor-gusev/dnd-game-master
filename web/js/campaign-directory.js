import { updateShellIdentity } from "./browser-shell.js";

function el(id, doc = document) {
  return doc.getElementById(id);
}

function navigateToCampaign(campaignId, locationApi = globalThis.location) {
  const url = `/campaign.html?campaignId=${encodeURIComponent(campaignId)}`;
  if (locationApi?.assign) locationApi.assign(url);
  else if (locationApi) locationApi.href = url;
}

function formatLastActivity(value) {
  if (!value) return "Last activity n/a";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Last activity n/a";
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay) {
    return `Today ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  }
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatParticipantCount(count = 0) {
  const value = Number(count) || 0;
  return `${value} participant${value === 1 ? "" : "s"}`;
}

function renderCampaignCard(doc, shell, campaign, response, refresh) {
  const item = doc.createElement("article");
  item.className = "campaign-list-item";
  const role = campaign.currentUserParticipant ? "You are participating" : "Join to participate";
  const summary = doc.createElement("div");
  const heading = doc.createElement("h2");
  heading.textContent = campaign.title || campaign.campaignId;
  const meta = doc.createElement("div");
  meta.className = "campaign-meta";
  const gm = doc.createElement("span");
  gm.textContent = `GM ${campaign.gm?.nickname || "unknown"}`;
  const participants = doc.createElement("span");
  participants.textContent = formatParticipantCount(campaign.participantCount);
  const activity = doc.createElement("span");
  activity.textContent = formatLastActivity(campaign.lastActivityAt);
  const roleLine = doc.createElement("p");
  roleLine.textContent = role;
  meta.appendChild(gm);
  meta.appendChild(participants);
  meta.appendChild(activity);
  summary.appendChild(heading);
  summary.appendChild(meta);
  summary.appendChild(roleLine);
  item.appendChild(summary);

  const actions = doc.createElement("div");
  actions.className = "campaign-actions";

  const open = doc.createElement("button");
  open.type = "button";
  open.textContent = "Open workspace";
  open.addEventListener("click", async () => {
    if (!campaign.currentUserParticipant) {
      const joined = await shell.api(`/api/campaigns/${campaign.campaignId}/join`, {
        method: "POST",
        operation: "join-campaign",
        body: JSON.stringify({}),
      });
      if (!joined.ok) return shell.pageError(joined.error?.message || "Failed to join campaign.");
    }
    navigateToCampaign(campaign.campaignId, shell.locationApi);
  });

  const detailsBtn = doc.createElement("button");
  detailsBtn.type = "button";
  detailsBtn.textContent = "Details";
  detailsBtn.addEventListener("click", async () => {
    const selected = await shell.api(`/api/campaigns/${campaign.campaignId}`, { operation: "load-campaign", method: "GET" });
    if (!selected.ok) return shell.pageError(selected.error?.message || "Failed to load campaign.");
    const details = el("selectedCampaignDetail", doc);
    if (details) {
      details.innerHTML = "";
      const card = doc.createElement("article");
      card.className = "campaign-detail";
      const detailTitle = doc.createElement("h2");
      detailTitle.textContent = campaign.title || campaign.campaignId;
      const campaignIdLine = doc.createElement("p");
      campaignIdLine.textContent = `Campaign ID: ${campaign.campaignId}`;
      const gmLine = doc.createElement("p");
      gmLine.textContent = `GM: ${campaign.gm?.nickname || "Unknown"}`;
      const participantsLine = doc.createElement("p");
      participantsLine.textContent = `Participants: ${(selected.data.participants || []).length}`;
      const activityLine = doc.createElement("p");
      activityLine.textContent = formatLastActivity(campaign.lastActivityAt);
      card.appendChild(detailTitle);
      card.appendChild(campaignIdLine);
      card.appendChild(gmLine);
      card.appendChild(participantsLine);
      card.appendChild(activityLine);
      const openBtn = doc.createElement("button");
      openBtn.type = "button";
      openBtn.textContent = "Open workspace";
      openBtn.addEventListener("click", () => navigateToCampaign(campaign.campaignId, shell.locationApi));
      card.appendChild(openBtn);
      if (campaign.gm?.uuid === shell.identity.uuid) {
        const deleteBtn = doc.createElement("button");
        deleteBtn.type = "button";
        deleteBtn.textContent = "Delete campaign";
        deleteBtn.addEventListener("click", async () => {
          if (!shell.confirmImpl("Delete this campaign?")) return;
          const deleted = await shell.api(`/api/campaigns/${campaign.campaignId}`, {
            method: "DELETE",
            operation: "delete-campaign",
          });
          if (!deleted.ok) return shell.pageError(deleted.error?.message || "Failed to delete campaign.");
          await refresh();
        });
        card.appendChild(deleteBtn);
      }
      details.appendChild(card);
    }
    shell.openCampaignDetails();
  });

  actions.appendChild(open);
  actions.appendChild(detailsBtn);
  item.appendChild(actions);
  return item;
}

export async function initializeCampaignDirectoryApp(shell) {
  const doc = shell.document;
  const list = el("campaignDirectory", doc);
  const summary = el("campaignDirectorySummary", doc);
  const status = el("status", doc);
  const identityDialog = el("identityDialog", doc);
  const createDialog = el("createCampaignDialog", doc);
  const detailsDialog = el("campaignDetailsDialog", doc);
  const identityUuid = el("identityUuid", doc);
  const identityNickname = el("identityNickname", doc);
  const campaignTitleInput = el("campaignTitle", doc);
  const refreshButton = el("refreshCampaigns", doc);

  shell.setPageContext({ kind: "campaign directory", campaignId: "" });
  if (identityUuid) identityUuid.value = shell.identity.uuid;
  if (identityNickname) identityNickname.value = shell.identity.nickname;
  if (status) status.textContent = "Loading campaigns.";

  async function refresh() {
    const response = await shell.api("/api/campaigns", { operation: "list-campaigns" });
    if (!response.ok) return shell.pageError(response.error?.message || "Failed to load campaigns.");
    const campaigns = response.data.campaigns || [];
    if (list) {
      list.innerHTML = "";
      if (!campaigns.length) {
        const empty = doc.createElement("article");
        empty.className = "campaign-empty-state";
        const title = doc.createElement("h2");
        title.textContent = "No campaigns yet";
        const copy = doc.createElement("p");
        copy.textContent = "Create the first campaign to start a workspace or refresh if you expect one to appear.";
        const actions = doc.createElement("div");
        actions.className = "campaign-actions";
        const create = doc.createElement("button");
        create.type = "button";
        create.textContent = "Create campaign";
        create.addEventListener("click", () => shell.openCampaignCreator());
        const refreshButton = doc.createElement("button");
        refreshButton.type = "button";
        refreshButton.textContent = "Refresh list";
        refreshButton.addEventListener("click", refresh);
        actions.appendChild(create);
        actions.appendChild(refreshButton);
        empty.appendChild(title);
        empty.appendChild(copy);
        empty.appendChild(actions);
        list.appendChild(empty);
      } else {
        for (const campaign of campaigns) {
          list.appendChild(renderCampaignCard(doc, shell, campaign, response, refresh));
        }
      }
    }
    if (summary) summary.textContent = `${campaigns.length} campaign${campaigns.length === 1 ? "" : "s"} available.`;
    if (status) status.textContent = campaigns.length ? "Campaigns ready." : "No campaigns yet.";
    shell.pageError("");
  }

  if (refreshButton) refreshButton.addEventListener("click", refresh);
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
      const response = await shell.api("/api/campaigns", {
        method: "POST",
        operation: "create-campaign",
        body: JSON.stringify({ title: campaignTitleInput?.value }),
      });
      if (!response.ok) return shell.pageError(response.error?.message || "Failed to create campaign.");
      navigateToCampaign(response.data.campaignId, shell.locationApi);
    });
  }

  if (detailsDialog) detailsDialog.addEventListener("close", () => {});
  shell.pageError("");
  await refresh();
}

if (typeof document !== "undefined") {
  void import("./browser-shell.js").then(({ initializeBrowserApplicationShell }) => initializeBrowserApplicationShell({ pageController: initializeCampaignDirectoryApp }));
}
