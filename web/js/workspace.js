function el(id, doc = document) {
  return doc.getElementById(id);
}

function text(value) {
  return String(value ?? "").trim();
}

function valueFor(profile, path) {
  return path.split(".").reduce((current, key) => current?.[key], profile) || "";
}

function setValueFor(profile, path, value) {
  const parts = path.split(".");
  let cursor = profile;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i];
    cursor[key] = cursor[key] && typeof cursor[key] === "object" ? cursor[key] : {};
    cursor = cursor[key];
  }
  cursor[parts.at(-1)] = value;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function formatPerson(value) {
  return text(value) || "None yet";
}

const SECTION_ACTIONS = {
  edit: { label: "Manual edit", icon: "✎" },
  ai: { label: "AI assist", icon: "✦" },
};

function structuredProfileFallback(sheet) {
  const raw = sheet?.structuredProfile || {
    publicFace: { identity: { name: "", shortDescription: "", ancestry: "", characterClass: "", role: "" }, appearance: "", personality: { traits: [], mannerisms: [], speechStyle: "" }, background: [] },
    innerLife: { secrets: [], goals: [], fears: [], hooks: [] },
  };
  if (raw.publicFace) return clone(raw);
  return clone({
    publicFace: {
      identity: raw.identity || { name: "", shortDescription: "", ancestry: "", characterClass: "", role: "" },
      appearance: raw.appearance?.text || raw.appearance || "",
      personality: {
        traits: Array.isArray(raw.personality?.traits) ? raw.personality.traits : typeof raw.personality?.traits === "string" ? [raw.personality.traits] : [],
        mannerisms: Array.isArray(raw.personality?.mannerisms) ? raw.personality.mannerisms : [],
        speechStyle: raw.personality?.speechStyle || "",
      },
      background: Array.isArray(raw.backstory) ? raw.backstory : raw.backstory?.text ? [raw.backstory.text] : [],
    },
    innerLife: { secrets: [], goals: [], fears: [], hooks: [] },
  });
}

function publicProjection(sheet) {
  return {
    publicFace: sheet?.structuredProfile?.publicFace || {},
  };
}

function previewProfile(sheet) {
  return sheet?.structuredProfile || structuredProfileFallback(null);
}

function sectionGroups(profile, isOwner) {
  return [
    { key: "publicFace.identity", title: "Identity", fields: [["publicFace.identity.name", "Name"], ["publicFace.identity.shortDescription", "Short description"], ["publicFace.identity.ancestry", "Ancestry"], ["publicFace.identity.characterClass", "Class"], ["publicFace.identity.role", "Role"]] },
    { key: "publicFace.appearance", title: "Appearance", fields: [["publicFace.appearance", "Appearance"]] },
    { key: "publicFace.personality", title: "Personality", fields: [["publicFace.personality.traits", "Traits"], ["publicFace.personality.mannerisms", "Mannerisms"], ["publicFace.personality.speechStyle", "Speech style"]] },
    { key: "publicFace.background", title: "Background", fields: [["publicFace.background", "Background"]] },
    { key: "innerLife.secrets", title: "Secrets", fields: [["innerLife.secrets", "Secrets"]], hidden: !isOwner },
    { key: "innerLife.goals", title: "Goals", fields: [["innerLife.goals", "Goals"]], hidden: !isOwner },
    { key: "innerLife.fears", title: "Fears", fields: [["innerLife.fears", "Fears"]], hidden: !isOwner },
    { key: "innerLife.hooks", title: "Hooks", fields: [["innerLife.hooks", "Hooks"]], hidden: !isOwner },
  ].filter((group) => !group.hidden);
}

function sectionDataForGroup(profile, groupKey) {
  return clone(profile?.[groupKey] ?? null);
}

function buildAiWorkflow(state, onRefresh) {
  return {
    campaignId: state.campaignId,
    sectionKey: "structuredProfile",
    sectionTitle: "Character Profile",
    sheet: clone(state.sheet || {}),
    structuredProfile: clone(state.sheet?.structuredProfile || structuredProfileFallback(null)),
    sectionSnapshot: clone(state.sheet?.structuredProfile || structuredProfileFallback(null)),
    currentDraft: null,
    onRefresh,
    getStructuredProfile: () => clone(state.sheet?.structuredProfile || structuredProfileFallback(null)),
    getDialogContext: () => [],
  };
}

function bindSectionWorkflowListeners(panel, shell) {
  if (panel._sectionWorkflowListenersBound) return;
  panel._sectionWorkflowListenersBound = true;
  panel.addEventListener("dgm-ai-conversation-panel-candidate-requested", async () => {
    const workflow = panel._sectionWorkflow;
    if (!workflow) return;
    const session = panel._sessionState?.session || (typeof panel.ensureSession === "function" ? await panel.ensureSession() : null);
    if (!session?.id) {
      const status = el("status", shell.document);
      if (status) status.textContent = "Open the session first before reviewing a candidate.";
      return;
    }
    const baseline = clone(typeof workflow.getStructuredProfile === "function" ? workflow.getStructuredProfile() : structuredProfileFallback(null));
    panel.candidateReviewText = JSON.stringify(baseline ?? {}, null, 2);
    const draftResponse = await shell.api(`/api/campaigns/${workflow.campaignId}/ai/sessions/${session.id}/drafts`, {
      method: "POST",
      operation: "create-ai-session-draft",
      body: JSON.stringify({
        clientRequestId: `${Date.now()}`,
        sectionKey: "structuredProfile",
        sectionPath: "structuredProfile",
        sectionData: baseline,
        sectionSnapshot: baseline,
        dialogContext: typeof workflow.getDialogContext === "function" ? workflow.getDialogContext() : [],
        structuredInput: {
          sectionKind: "structuredProfile",
          structuredProfile: baseline,
          characterSummary: previewProfile(workflow.sheet),
        },
        title: `${workflow.sectionTitle} structured candidate`,
      }),
    });
    if (!draftResponse.ok) {
      if (typeof shell.pageError === "function") shell.pageError(draftResponse.error?.message || "Failed to create structured candidate.");
      return;
    }
    const aiDraft = draftResponse.data.aiDraft;
    panel.candidate = aiDraft;
    panel.candidateReviewText = JSON.stringify(aiDraft.candidateData?.sectionData ?? aiDraft.candidateData ?? aiDraft, null, 2);
    workflow.currentDraft = aiDraft;
    if (typeof workflow.onRefresh === "function") {
      workflow.onRefresh({ aiDraft, statusMessage: aiDraft.candidateData?.noChanges ? "No new proposal; showing current section snapshot." : "Structured candidate ready." });
    }
  });
  panel.addEventListener("dgm-ai-conversation-panel-candidate-accepted", async (event) => {
    const workflow = panel._sectionWorkflow;
    const draftId = event.detail?.candidate?.draftId;
    if (!workflow || !draftId) return;
    await shell.api(`/api/campaigns/${workflow.campaignId}/ai/drafts/${draftId}/accept`, {
      method: "POST",
      operation: "accept-player-ai-draft",
      body: JSON.stringify({}),
    });
    if (typeof workflow.onRefresh === "function") workflow.onRefresh({ aiDraft: null, statusMessage: "Structured candidate accepted." });
    await loadWorkspace(shell, workflow.campaignId, shell.pageContext.kind, workflow.onRefresh);
  });
  panel.addEventListener("dgm-ai-conversation-panel-candidate-rejected", async () => {
    const workflow = panel._sectionWorkflow;
    const draftId = panel.candidate?.draftId;
    if (!workflow || !draftId) return;
    await shell.api(`/api/campaigns/${workflow.campaignId}/ai/drafts/${draftId}/reject`, {
      method: "POST",
      operation: "reject-player-ai-draft",
      body: JSON.stringify({}),
    });
    if (typeof workflow.onRefresh === "function") workflow.onRefresh({ aiDraft: null, statusMessage: "Structured candidate rejected." });
  });
}

function renderSectionCard(doc, shell, state, group, readOnly, onRefresh) {
  const sheetId = state.sheetId || state.sheet?.sheetId || "";
  const card = doc.createElement("section");
  card.className = "workshop-section";
  const header = doc.createElement("div");
  header.className = "workshop-section-header";
  const title = doc.createElement("h3");
  title.textContent = group.title;
  header.appendChild(title);
  const status = doc.createElement("p");
  status.className = "workshop-section-status";
  status.textContent = state.editingSection === group.key ? "Editing locally" : state.assistSection === group.key ? "AI assist open" : "Readable";
  header.appendChild(status);
  const actions = doc.createElement("div");
  actions.className = "workshop-actions workshop-actions-icon";
  const edit = doc.createElement("button");
  edit.type = "button";
  edit.className = "workshop-icon-button";
  edit.textContent = SECTION_ACTIONS.edit.icon;
  edit.title = SECTION_ACTIONS.edit.label;
  edit.setAttribute("aria-label", SECTION_ACTIONS.edit.label);
  edit.addEventListener("click", () => onRefresh({ editingSection: group.key, assistSection: "", draftProfile: clone(state.sheet?.structuredProfile || structuredProfileFallback(null)), aiDraft: null }));
  actions.appendChild(edit);
  header.appendChild(actions);
  card.appendChild(header);

  if (state.editingSection === group.key) {
    const form = doc.createElement("form");
    form.className = "workshop-section-form";
    let saveInProgress = false;
    async function submitSection(event) {
      event?.preventDefault?.();
      saveInProgress = true;
      const nextProfile = clone(state.draftProfile || state.sheet?.structuredProfile || structuredProfileFallback(null));
      for (const [path] of group.fields) {
        const field = form.elements.namedItem(path);
        if (field && "value" in field) setValueFor(nextProfile, path, String(field.value));
      }
      const response = sheetId
        ? await shell.api(`/api/campaigns/${state.campaignId}/character-sheets/${sheetId}`, {
          method: "PATCH",
          operation: "save-character-section",
          body: JSON.stringify({ structuredProfile: nextProfile }),
        })
        : await shell.api(`/api/campaigns/${state.campaignId}/character-sheets`, {
          method: "POST",
          operation: "create-character-section-draft",
          body: JSON.stringify({ structuredProfile: nextProfile }),
        });
      if (!response.ok) {
        saveInProgress = false;
        if (typeof shell.pageError === "function") shell.pageError(response.error?.message || "Failed to save section.");
        const status = el("status", doc);
        if (status) status.textContent = response.error?.message || "Failed to save section.";
        return "";
      }
      if (typeof shell.pageError === "function") shell.pageError("");
      saveInProgress = false;
      const nextSheetId = response.data.characterSheet?.sheetId || sheetId;
      onRefresh({ editingSection: "", draftProfile: null, sheet: response.data.characterSheet, sheetId: nextSheetId, statusMessage: "Section saved." });
      return nextSheetId;
    }
    const actions = doc.createElement("div");
    actions.className = "workshop-actions";
    const save = doc.createElement("button");
    save.type = "submit";
    save.textContent = "Save";
    save.addEventListener("click", submitSection);
    const cancel = doc.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => onRefresh({ editingSection: "", draftProfile: null, aiDraft: null }));
    actions.appendChild(save);
    actions.appendChild(cancel);
    form.appendChild(actions);
    for (const [path, label] of group.fields) {
      const labelEl = doc.createElement("label");
      labelEl.className = "workshop-field";
      labelEl.textContent = label;
      const input = doc.createElement("textarea");
      input.name = path;
      input.value = state.draftProfile ? valueFor(state.draftProfile, path) : "";
      input.rows = path === "identity.shortDescription" || path === "publicNotes" ? 2 : 4;
      labelEl.appendChild(input);
      form.appendChild(labelEl);
    }
    form.addEventListener("submit", submitSection);
    card.appendChild(form);
  } else {
    const body = doc.createElement("div");
    body.className = "workshop-section-body";
    for (const [path, label] of group.fields) {
      const row = doc.createElement("p");
      const strong = doc.createElement("strong");
      strong.textContent = `${label}: `;
      const span = doc.createElement("span");
      span.textContent = formatPerson(valueFor(state.publicPreview || state.sheet?.structuredProfile || structuredProfileFallback(null), path));
      row.appendChild(strong);
      row.appendChild(span);
      body.appendChild(row);
    }
    card.appendChild(body);
    const actions = doc.createElement("div");
    actions.className = "workshop-actions";
    if (state.aiDraft?.sectionPath === group.fields[0][0] && state.aiDraft.state === "draft") {
      const candidate = doc.createElement("p");
      candidate.className = "workshop-candidate";
      candidate.textContent = `AI candidate: ${state.aiDraft.candidateText || state.aiDraft.content || "Pending"}`;
      actions.appendChild(candidate);
      const accept = doc.createElement("button");
      accept.type = "button";
      accept.textContent = "Accept AI suggestion";
      accept.addEventListener("click", async () => {
        const response = await shell.api(`/api/campaigns/${state.campaignId}/ai/drafts/${state.aiDraft.draftId}/accept`, {
          method: "POST",
          operation: "accept-player-ai-draft",
          body: JSON.stringify({}),
        });
        if (!response.ok) return shell.pageError(response.error?.message || "Failed to accept AI suggestion.");
        onRefresh({ aiDraft: null, statusMessage: "AI suggestion accepted." });
        await loadWorkspace(shell, state.campaignId, shell.pageContext.kind, onRefresh);
      });
      const reject = doc.createElement("button");
      reject.type = "button";
      reject.textContent = "Reject AI suggestion";
      reject.addEventListener("click", () => onRefresh({ aiDraft: null, statusMessage: "AI suggestion rejected." }));
      actions.appendChild(accept);
      actions.appendChild(reject);
    }
    card.appendChild(actions);
  }
  return card;
}

function renderWorkshopAiControl(doc, shell, state, onRefresh) {
  const controls = doc.createElement("div");
  controls.className = "workshop-ai-control";
  const button = doc.createElement("button");
  button.type = "button";
  button.className = "workshop-icon-button";
  button.textContent = SECTION_ACTIONS.ai.icon;
  button.title = SECTION_ACTIONS.ai.label;
  button.setAttribute("aria-label", SECTION_ACTIONS.ai.label);
  button.addEventListener("click", async () => {
    const draftProfile = state.draftProfile || state.sheet?.structuredProfile || structuredProfileFallback(null);
    let activeSheetId = state.sheetId || state.sheet?.sheetId || "";
    if (!activeSheetId) {
      const response = await shell.api(`/api/campaigns/${state.campaignId}/character-sheets`, {
        method: "POST",
        operation: "create-character-section-draft",
        body: JSON.stringify({ structuredProfile: draftProfile }),
      });
      if (!response.ok) {
        if (typeof shell.pageError === "function") shell.pageError(response.error?.message || "Failed to prepare AI target.");
        const statusLine = el("status", doc);
        if (statusLine) statusLine.textContent = response.error?.message || "Failed to prepare AI target.";
        return;
      }
      activeSheetId = response.data.characterSheet?.sheetId || "";
      onRefresh({ sheet: response.data.characterSheet, sheetId: activeSheetId });
    }
    onRefresh({ editingSection: "", assistSection: "profile", draftProfile: clone(draftProfile), aiDraft: null });
    createAIConversationPanel(shell, {
      campaignId: state.campaignId,
      targetKind: "character-profile",
      targetId: activeSheetId,
      sectionKey: "structuredProfile",
      mode: "text-draft-generation",
      policyProfile: "player-character-section-discussion",
      outputKind: "draft",
      sectionSnapshot: state.sheet?.structuredProfile || structuredProfileFallback(null),
    }, {
      title: "Character Profile AI session",
      placeholder: "Discuss the whole character profile.",
    });
    const panel = doc.querySelector?.("dgm-ai-conversation-panel[data-role='ai-conversation-panel']");
    if (panel) {
      bindSectionWorkflowListeners(panel, shell);
      panel._sectionWorkflow = buildAiWorkflow(state, onRefresh);
      panel._sectionWorkflow.getDialogContext = () => panel.transcript.map((message) => ({
        role: message.role,
        text: text(message.text || message.content || ""),
      }));
      panel.candidate = null;
      panel.candidateReviewText = JSON.stringify((panel._sectionWorkflow.getStructuredProfile?.() || {}) ?? {}, null, 2);
    }
  });
  controls.appendChild(button);
  return controls;
}

async function loadWorkspace(shell, campaignId, kind, onRefresh) {
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
      if (retry.data.workspaceKind !== kind) return shell.pageError("This workspace is unavailable for the current identity.");
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

function renderReadablePreview(doc, sheet) {
  const preview = el("publicPreview", doc);
  if (!preview) return;
  preview.innerHTML = "";
  const data = publicProjection(sheet);
  for (const [section, value] of Object.entries(data)) {
    const block = doc.createElement("section");
    const heading = doc.createElement("h3");
    heading.textContent = section;
    const body = doc.createElement("pre");
    body.textContent = typeof value === "string" ? value || "None yet" : JSON.stringify(value, null, 2);
    block.appendChild(heading);
    block.appendChild(body);
    preview.appendChild(block);
  }
}

async function renderWorkspace(shell, kind, state, onRefresh) {
  const doc = shell.document;
  const title = el("campaignTitle", doc);
  const subtitle = el("campaignSubtitle", doc);
  const details = el("workspaceDetails", doc);
  const workshop = el("characterWorkshop", doc);
  const sheet = state.sheet;
  if (title) title.textContent = state.campaign?.title || "Campaign";
  if (subtitle) subtitle.textContent = `${kind === "player workspace" ? "Player Workspace" : "Game Master Workspace"} · GM ${state.campaign?.gm?.nickname || "Unknown"} · ${Array.isArray(state.participants) ? state.participants.length : 0} participant${Array.isArray(state.participants) && state.participants.length === 1 ? "" : "s"}`;
  if (details) details.textContent = JSON.stringify({
    campaignTitle: state.campaign?.title || "",
    sheetStatus: sheet ? { sheetId: sheet.sheetId, state: sheet.state } : { sheetId: "", state: "none" },
  }, null, 2);
  if (workshop) {
    workshop.innerHTML = "";
    if (kind === "player workspace") {
      const profile = structuredProfileFallback(sheet);
      const groups = sectionGroups(profile, true);
      workshop.appendChild(renderWorkshopAiControl(doc, shell, state, onRefresh));
      for (const group of groups) workshop.appendChild(renderSectionCard(doc, shell, state, group, false, onRefresh));
      renderReadablePreview(doc, sheet || { structuredProfile: structuredProfileFallback(null) });
    } else {
      const sections = [
        ["Participants", state.participants || []],
        ["Materials", state.materials || []],
        ["Assets", state.assets || []],
        ["AI drafts", state.aiDrafts || []],
        ["Events", state.events || []],
        ["Credits", state.credits || []],
      ];
      for (const [titleText, value] of sections) {
        const section = doc.createElement("section");
        section.className = "workshop-section";
        const heading = doc.createElement("h3");
        heading.textContent = titleText;
        const body = doc.createElement("pre");
        body.textContent = JSON.stringify(value, null, 2);
        section.appendChild(heading);
        section.appendChild(body);
        workshop.appendChild(section);
      }
    }
  }
}

export async function initializeWorkspaceApp(shell, kind) {
  const doc = shell.document;
  const params = new URL(shell.locationApi?.href || doc.location?.href || "http://localhost/workspace.html").searchParams;
  const campaignId = params.get("campaignId") || "";
  const state = { campaignId, editingSection: "", assistSection: "", draftProfile: null, aiDraft: null, sheet: null, campaign: null, participants: [], materials: [], assets: [], aiDrafts: [], events: [], credits: [], publicPreview: null };
  shell.setPageContext({ kind, campaignId });
  shell.handleNotification = async (notification) => {
    if (!notification || notification.scope !== "campaign") return;
    if (notification.campaignId !== (shell.pageContext?.campaignId || "")) return;
    await refresh();
  };

  function sync(next) {
    Object.assign(state, next);
  }

  async function refresh(overrides = {}) {
    sync(overrides);
    const data = await loadWorkspace(shell, state.campaignId, kind, sync);
    if (!data) return;
    const identityId = shell.identity?.uuid || shell.identity?.id || "";
    const sheet = Array.isArray(data.characterSheets) ? data.characterSheets.find((item) => item.playerIdentityId === identityId) || data.characterSheets[0] : null;
    sync({
      campaign: data.campaign,
      participants: data.participants || [],
      materials: data.materials || [],
      assets: data.assets || [],
      aiDrafts: data.aiDrafts || [],
      events: data.events || [],
      credits: data.credits || [],
      sheet,
      sheetId: sheet?.sheetId || "",
      publicPreview: previewProfile(sheet),
      editingSection: overrides.editingSection || state.editingSection,
      assistSection: overrides.assistSection || state.assistSection,
      draftProfile: overrides.draftProfile || state.draftProfile,
      aiDraft: overrides.aiDraft === undefined ? state.aiDraft : overrides.aiDraft,
    });
    await renderWorkspace(shell, kind, state, refresh);
    renderReadablePreview(doc, sheet || { structuredProfile: structuredProfileFallback(null) });
    const status = el("status", doc);
    if (status) status.textContent = overrides.statusMessage || "Workspace ready.";
  }

  const backLink = el("backToDirectory", doc);
  if (backLink) backLink.setAttribute("href", "/");
  if (!campaignId) {
    const status = el("status", doc);
    if (status) status.textContent = "Campaign id is missing. Return to Campaigns.";
    return;
  }
  const status = el("status", doc);
  if (status) status.textContent = "Loading workspace.";
  await refresh();
}
import { createAIConversationPanel } from "./aiprep-conversation-panel.js";
