import "../wc/AIConversationPanel.mjs";

function text(value) {
  return String(value ?? "").trim();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function createAIConversationPanel(shell, binding, options = {}) {
  const doc = shell.document;
  const cryptoApi = shell.cryptoApi || globalThis.crypto;
  const existing = doc.querySelector?.("dgm-ai-conversation-panel[data-role='ai-conversation-panel']");
  if (existing) {
    existing.binding = { ...existing.binding, ...binding };
    existing._sessionState = { session: null, messages: [] };
    existing.candidate = null;
    existing.candidateReviewText = "";
    existing.state = "resolving-session";
    void syncConversation(existing, shell, options);
    return existing;
  }
  const panel = doc.createElement("dgm-ai-conversation-panel");
  panel.dataset.role = "ai-conversation-panel";
  panel.binding = {
    ...binding,
    campaignId: text(binding?.campaignId),
    targetKind: text(binding?.targetKind),
    targetId: text(binding?.targetId),
    sectionKey: text(binding?.sectionKey),
    mode: text(binding?.mode),
    policyProfile: text(binding?.policyProfile),
    outputKind: text(binding?.outputKind),
    sectionSnapshot: binding?.sectionSnapshot && typeof binding.sectionSnapshot === "object" ? clone(binding.sectionSnapshot) : null,
  };
  panel.state = "resolving-session";
  panel.setAttribute("aria-label", options.title || "AI conversation panel");
  panel._sessionState = { session: null, messages: [] };
  panel.ensureSession = async () => ensureSession(panel, shell, options, cryptoApi);
  panel.addEventListener("dgm-ai-conversation-panel-submit", async (event) => {
    const messageText = text(event.detail?.text);
    if (!messageText) return;
    await submitMessage(panel, shell, options, messageText, cryptoApi);
  });
  panel.addEventListener("dgm-ai-conversation-panel-close", (event) => {
    if (typeof options.onClose === "function") options.onClose(event.detail);
  });
  if (doc.body?.appendChild) doc.body.appendChild(panel);
  else doc.documentElement?.appendChild?.(panel);
  void syncConversation(panel, shell, options);
  return panel;
}

async function ensureSession(panel, shell, options = {}, cryptoApi) {
  const binding = panel.binding;
  const state = panel._sessionState || { session: null, messages: [] };
  if (state.session) return state.session;
  if (state.creatingSessionPromise) return state.creatingSessionPromise;

  state.creatingSessionPromise = (async () => {
    const sessionResponse = await shell.api(`/api/campaigns/${binding.campaignId}/ai/sessions`, {
      method: "POST",
      operation: "create-ai-session",
      body: JSON.stringify({
        title: options.title || "AI session",
        targetKind: binding.targetKind,
        targetId: binding.targetId,
        sectionKey: binding.sectionKey || "",
        sectionSnapshot: binding.sectionSnapshot && typeof binding.sectionSnapshot === "object" ? clone(binding.sectionSnapshot) : null,
        mode: binding.mode,
        policyProfile: binding.policyProfile,
        outputKind: binding.outputKind || "",
      }),
    });
    if (!sessionResponse.ok) {
      state.creatingSessionPromise = null;
      panel.state = sessionResponse.error?.code === "forbidden" ? "session-closed" : "provider-error";
      return null;
    }
    state.session = sessionResponse.data.session;
    state.creatingSessionPromise = null;
    panel._sessionState = state;
    return state.session;
  })();

  return state.creatingSessionPromise;
}

async function syncConversation(panel, shell, options = {}) {
  const binding = panel.binding;
  if (!text(binding.campaignId) || !text(binding.targetKind)) {
    panel.state = "provider-error";
    panel.transcript = [];
    return;
  }

  panel.state = "resolving-session";
  const params = new URLSearchParams({
    targetKind: binding.targetKind,
    targetId: binding.targetId,
    sectionKey: binding.sectionKey || "",
    status: "active",
  });
  const response = await shell.api(`/api/campaigns/${binding.campaignId}/ai/sessions?${params.toString()}`, { operation: "list-ai-sessions" });
  if (!response.ok) {
    panel.state = response.error?.code === "forbidden" ? "session-closed" : "provider-error";
    panel.transcript = [];
    return;
  }

  const session = Array.isArray(response.data.sessions) ? response.data.sessions[0] || null : null;
  panel._sessionState.session = session;
  if (!session) {
    panel.state = "creating-session";
    const createdSession = await ensureSession(panel, shell, options, shell.cryptoApi || globalThis.crypto);
    if (!createdSession) return;
    panel.transcript = [];
    panel.state = "ready-empty";
    return;
  }

  panel.state = "loading-history";
  const messagesResponse = await shell.api(`/api/campaigns/${binding.campaignId}/ai/sessions/${session.id}/messages`, { operation: "load-ai-messages" });
  panel._sessionState.messages = messagesResponse.ok && Array.isArray(messagesResponse.data.messages) ? messagesResponse.data.messages : [];
  panel.transcript = panel._sessionState.messages;
  panel.state = panel._sessionState.messages.length ? "ready-with-thread" : "ready-empty";
}

async function submitMessage(panel, shell, options, textValue, cryptoApi) {
  const binding = panel.binding;
  const state = panel._sessionState || { session: null, messages: [] };

  if (!text(binding.campaignId) || !text(binding.targetKind)) {
    panel.state = "provider-error";
    return;
  }

  if (!state.session) {
    panel.state = "creating-session";
    const createdSession = await ensureSession(panel, shell, options, cryptoApi);
    if (!createdSession) return;
    state.session = createdSession;
    panel._sessionState = state;
  }

  panel.state = "submitting-message";
  const messageResponse = await shell.api(`/api/campaigns/${binding.campaignId}/ai/sessions/${state.session.id}/messages`, {
    method: "POST",
    operation: "run-ai-session",
    body: JSON.stringify({
      clientRequestId: cryptoApi?.randomUUID?.() || `${Date.now()}`,
      contentType: "text",
      operation: binding.mode,
      sectionSnapshot: binding.sectionSnapshot && typeof binding.sectionSnapshot === "object" ? clone(binding.sectionSnapshot) : null,
      text: textValue,
    }),
  });
  if (!messageResponse.ok) {
    panel.state = messageResponse.error?.code === "forbidden" ? "session-closed" : "provider-error";
    return;
  }

  state.messages.push(messageResponse.data.message);
  if (messageResponse.data.responseMessage) state.messages.push(messageResponse.data.responseMessage);
  panel._sessionState = state;
  panel.transcript = state.messages;
  panel.state = messageResponse.data.responseMessage ? "candidate-ready" : "ready-with-thread";
  if (messageResponse.data.responseMessage) {
    panel.candidate = messageResponse.data.responseMessage;
  }
}
