function el(id, doc = document) {
  return doc.getElementById(id);
}

function formField(form, name) {
  const field = form?.elements?.namedItem?.(name);
  return field && typeof field === "object" && "value" in field ? field : null;
}

export async function initializeCampaignWorkspace(shell) {
  const doc = shell.document;
  const params = new URL(shell.locationApi?.href || doc.location?.href || "http://localhost/campaign.html").searchParams;
  const campaignId = params.get("campaignId") || "";
  const status = el("status", doc);
  const title = el("campaignTitle", doc);
  const subtitle = el("campaignSubtitle", doc);
  const brief = el("brief", doc);
  const events = el("events", doc);
  const drafts = el("drafts", doc);
  const credits = el("credits", doc);
  const backLink = el("backToDirectory", doc);
  const briefForm = doc.getElementById("briefForm");
  const sheetForm = doc.getElementById("sheetForm");
  const draftForm = doc.getElementById("draftForm");

  shell.setPageContext({ kind: "campaign workspace", campaignId });
  if (!campaignId) {
    if (status) status.textContent = "Campaign id is missing. Return to the Campaign Directory.";
    return;
  }
  if (backLink) backLink.setAttribute("href", "/");

  async function load() {
    const response = await shell.api(`/api/campaigns/${campaignId}`, { operation: "load-campaign" });
    if (!response.ok) return shell.pageError(response.error?.message || "Failed to load campaign.");
    const campaign = response.data.campaign;
    const loadedBrief = response.data.brief || {};
    if (title) title.textContent = campaign.title;
    if (subtitle) subtitle.textContent = `GM: ${campaign.gm?.nickname || "Unknown"} · Participants: ${response.data.participants.length}`;
    if (briefForm) {
      const titleField = formField(briefForm, "title");
      const summaryField = formField(briefForm, "summary");
      const planningField = formField(briefForm, "planning");
      const recapField = formField(briefForm, "recap");
      if (titleField) titleField.value = loadedBrief.title || campaign.title || "";
      if (summaryField) summaryField.value = loadedBrief.summary || "";
      if (planningField) planningField.value = loadedBrief.planning || "";
      if (recapField) recapField.value = loadedBrief.recap || "";
    }
    if (brief) brief.textContent = JSON.stringify(loadedBrief, null, 2);
    if (events) events.textContent = JSON.stringify(response.data.events || [], null, 2);
    if (drafts) drafts.textContent = JSON.stringify(response.data.aiDrafts || [], null, 2);
    if (credits) credits.textContent = JSON.stringify(response.data.credits || [], null, 2);
  }

  if (briefForm) briefForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const response = await shell.api(`/api/campaigns/${campaignId}/brief`, {
      method: "PATCH",
      operation: "update-brief",
      body: JSON.stringify({
        title: formField(form, "title")?.value || "",
        summary: formField(form, "summary")?.value || "",
        planning: formField(form, "planning")?.value || "",
        recap: formField(form, "recap")?.value || "",
      }),
    });
    if (!response.ok) return shell.pageError(response.error?.message || "Failed to update brief.");
    await load();
  });
  if (sheetForm) sheetForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const response = await shell.api(`/api/campaigns/${campaignId}/character-sheets`, { method: "POST", operation: "create-sheet", body: JSON.stringify({ title: formField(form, "title")?.value || "", content: formField(form, "content")?.value || "" }) });
    if (!response.ok) return shell.pageError(response.error?.message || "Failed to create sheet.");
    await load();
  });
  if (draftForm) draftForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const response = await shell.api(`/api/campaigns/${campaignId}/ai/drafts`, { method: "POST", operation: "create-draft", body: JSON.stringify({ title: formField(form, "title")?.value || "", content: formField(form, "content")?.value || "" }) });
    if (!response.ok) return shell.pageError(response.error?.message || "Failed to create draft.");
    await load();
  });

  if (el("refreshButton", doc)) el("refreshButton", doc).addEventListener("click", load);
  await load();
}

if (typeof document !== "undefined") void import("./browser-shell.js").then(({ initializeBrowserApplicationShell }) => initializeBrowserApplicationShell({ pageController: initializeCampaignWorkspace }));
