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
  const backLink = el("backToDirectory", doc);
  if (backLink) backLink.setAttribute("href", "/");
  const data = await loadWorkspace(shell, campaignId, kind);
  if (!data) return;
  if (title) title.textContent = data.campaign?.title || "Campaign";
  if (subtitle) subtitle.textContent = `${kind === "player workspace" ? "Player Workspace" : "Game Master Workspace"} · GM ${data.campaign?.gm?.nickname || "Unknown"} · ${Array.isArray(data.participants) ? data.participants.length : 0} participant${Array.isArray(data.participants) && data.participants.length === 1 ? "" : "s"}`;
  if (details) details.textContent = JSON.stringify(data, null, 2);
  renderStatus(doc, "status", "Workspace ready.");
}
