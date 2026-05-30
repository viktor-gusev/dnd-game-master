function el(id, doc = document) {
  return doc.getElementById(id);
}

function formField(form, name) {
  const field = form?.elements?.namedItem?.(name);
  return field && typeof field === "object" && "value" in field ? field : null;
}

function renderStatus(doc, id, value) {
  const node = el(id, doc);
  if (node) node.textContent = value;
}

async function loadWorkspace(shell, campaignId, kind) {
  const response = await shell.api(`/api/campaigns/${campaignId}`, { operation: "load-campaign" });
  if (!response.ok) {
    if (kind === "player workspace" && response.error?.code === "forbidden") {
      const joined = await shell.api(`/api/campaigns/${campaignId}/join`, {
        method: "POST",
        operation: "join-campaign-from-workspace",
        body: JSON.stringify({}),
      });
      if (!joined.ok) return shell.pageError(joined.error?.message || "Failed to join campaign.");
      const retry = await shell.api(`/api/campaigns/${campaignId}`, { operation: "load-campaign" });
      if (!retry.ok) return shell.pageError(retry.error?.message || "Failed to load campaign.");
      if (retry.data.workspaceKind !== kind) {
        shell.pageError("This workspace is unavailable for the current identity.");
        return null;
      }
      return retry.data;
    }
    return shell.pageError(response.error?.message || "Failed to load campaign.");
  }
  if (response.data.workspaceKind !== kind) {
    shell.pageError("This workspace is unavailable for the current identity.");
    return null;
  }
  return response.data;
}

function profileValue(profile, path) {
  return path.split(".").reduce((value, key) => value?.[key], profile) || "";
}

function setProfileValue(profile, path, value) {
  const parts = path.split(".");
  let cursor = profile;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    cursor[key] = cursor[key] && typeof cursor[key] === "object" ? cursor[key] : {};
    cursor = cursor[key];
  }
  cursor[parts.at(-1)] = value;
}

function renderWorkshop(doc, sheet, canEdit) {
  const container = el("characterWorkshopFields", doc);
  if (!container) return;
  const profile = sheet?.structuredProfile || {};
  const fields = [
    ["Identity", [["identity.name", "Name"], ["identity.shortDescription", "Short description"], ["identity.ancestry", "Ancestry"], ["identity.characterClass", "Class"], ["identity.role", "Role"]]],
    ["Appearance", [["appearance.text", "Appearance"]]],
    ["Personality", [["personality.traits", "Traits"], ["personality.motivation", "Motivation"], ["personality.fears", "Fears"], ["personality.mannerisms", "Mannerisms"], ["personality.speechStyle", "Speech style"]]],
    ["Backstory", [["backstory.text", "Backstory"], ["backstory.importantNpc", "Important NPC"], ["backstory.openHooks", "Open hooks"]]],
    ["Campaign integration", [["campaignIntegration.reasonToJoin", "Reason to join"], ["campaignIntegration.linksToOtherCharacters", "Links to other characters"], ["campaignIntegration.gmUsableHooks", "GM-usable hooks"], ["campaignIntegration.boundaries", "Boundaries"]]],
    ["Mechanics", [["mechanics.text", "Mechanics text"]]],
    ["Public notes", [["publicNotes", "Public notes"]]],
    ["GM hooks", [["gmHooks", "GM hooks"]]],
    ["Player intent", [["playerIntent.playStyle", "Play style"], ["playerIntent.themes", "Themes"], ["playerIntent.aiHelpMode", "AI help mode"]]],
  ];
  container.innerHTML = fields.map(([label, group]) => `<fieldset class="workshop-group"><legend>${label}</legend>${group.map(([name, labelText]) => `<label class="workshop-field">${labelText}<textarea name="${name}" ${canEdit ? "" : "disabled"}>${profileValue(profile, name)}</textarea></label>`).join("")}</fieldset>`).join("");
}

function buildDraftFromForm(form, baseSheet) {
  const profile = JSON.parse(JSON.stringify(baseSheet?.structuredProfile || {}));
  const fd = new FormData(form);
  for (const [name, value] of fd.entries()) setProfileValue(profile, name, String(value));
  return profile;
}

export async function initializeWorkspaceApp(shell, kind) {
  const doc = shell.document;
  shell.handleNotification = async (notification) => {
    if (!notification || notification.scope !== "campaign") return;
    if (notification.campaignId !== (shell.pageContext?.campaignId || "")) return;
    await loadWorkspace(shell, shell.pageContext.campaignId, kind);
  };
  const params = new URL(shell.locationApi?.href || doc.location?.href || "http://localhost/workspace.html").searchParams;
  const campaignId = params.get("campaignId") || "";
  shell.setPageContext({ kind, campaignId });
  renderStatus(doc, "status", campaignId ? "Loading workspace." : "Campaign id is missing. Return to Campaigns.");
  if (!campaignId) return;
  const title = el("campaignTitle", doc);
  const subtitle = el("campaignSubtitle", doc);
  const details = el("workspaceDetails", doc);
  const preview = el("publicPreview", doc);
  const form = el("characterWorkshopForm", doc);
  const backLink = el("backToDirectory", doc);
  if (backLink) backLink.setAttribute("href", "/");
  const data = await loadWorkspace(shell, campaignId, kind);
  if (!data) return;
  const sheet = Array.isArray(data.characterSheets) ? data.characterSheets.find((item) => item.playerIdentityId === shell.identity.uuid) || data.characterSheets[0] : null;
  if (title) title.textContent = data.campaign?.title || "Campaign";
  if (subtitle) subtitle.textContent = `${kind === "player workspace" ? "Player Workspace" : "Game Master Workspace"} · GM ${data.campaign?.gm?.nickname || "Unknown"} · ${Array.isArray(data.participants) ? data.participants.length : 0} participant${Array.isArray(data.participants) && data.participants.length === 1 ? "" : "s"}`;
  if (details) details.textContent = JSON.stringify({ sheetStatus: sheet ? { sheetId: sheet.sheetId, state: sheet.state } : { sheetId: "", state: "none" } }, null, 2);
  if (preview) preview.textContent = JSON.stringify(sheet ? {
    identity: sheet.structuredProfile?.identity || {},
    appearance: sheet.structuredProfile?.appearance || {},
    personality: sheet.structuredProfile?.personality || {},
    backstory: sheet.structuredProfile?.backstory || {},
    campaignIntegration: sheet.structuredProfile?.campaignIntegration || {},
    mechanics: sheet.structuredProfile?.mechanics || {},
    publicNotes: sheet.structuredProfile?.publicNotes || "",
  } : {}, null, 2);
  renderWorkshop(doc, sheet, kind === "player workspace");
  if (form && kind === "player workspace" && sheet) {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const structuredProfile = buildDraftFromForm(form, sheet);
      const response = await shell.api(`/api/campaigns/${campaignId}/character-sheets/${sheet.sheetId}`, {
        method: "PATCH",
        operation: "save-character-workshop-draft",
        body: JSON.stringify({ structuredProfile }),
      });
      if (response.ok) renderStatus(doc, "status", "Draft saved.");
      else renderStatus(doc, "status", response.error?.message || "Failed to save draft.");
    });
  }
  renderStatus(doc, "status", "Workspace ready.");
}
