function el(id, doc = document) {
  return doc.getElementById(id);
}

function text(value) {
  return String(value ?? "").trim();
}

function summarizeMessages(messages) {
  return Array.isArray(messages) ? messages.map((message) => `${message.role}: ${message.text || ""}`.trim()) : [];
}

export function createAIPrepConversationPanel(shell, binding, options = {}) {
  const doc = shell.document;
  const panel = doc.createElement("section");
  panel.className = "ai-prep-conversation-panel";
  panel.dataset.targetKind = binding.targetKind;
  panel.dataset.policyProfile = binding.policyProfile;

  const title = doc.createElement("h3");
  title.textContent = options.title || "AIPrepConversationPanel";
  panel.appendChild(title);

  const status = doc.createElement("p");
  status.className = "ai-prep-conversation-status";
  status.textContent = "Resolving session.";
  panel.appendChild(status);

  const transcript = doc.createElement("div");
  transcript.className = "ai-prep-conversation-transcript";
  panel.appendChild(transcript);

  const input = doc.createElement("textarea");
  input.rows = 4;
  input.placeholder = options.placeholder || "Enter preparation notes or questions.";
  panel.appendChild(input);

  const actions = doc.createElement("div");
  actions.className = "ai-prep-conversation-actions";
  panel.appendChild(actions);

  const launch = doc.createElement("button");
  launch.type = "button";
  launch.textContent = "Ask AI";
  actions.appendChild(launch);

  const sessionState = { session: null, messages: [], ready: false };
  const cryptoApi = shell.cryptoApi || crypto;

  async function loadSession() {
    status.textContent = "Resolving session.";
    const params = new URLSearchParams({
      targetKind: binding.targetKind,
      targetId: binding.targetId,
      sectionKey: binding.sectionKey || "",
      status: "active",
    });
    const response = await shell.api(`/api/campaigns/${binding.campaignId}/ai/sessions?${params.toString()}`, { operation: "list-ai-sessions" });
    if (!response.ok) {
      status.textContent = response.error?.message || "Failed to load AI session.";
      return null;
    }
    const session = Array.isArray(response.data.sessions) ? response.data.sessions[0] || null : null;
    sessionState.session = session;
    if (session) {
      const messagesResponse = await shell.api(`/api/campaigns/${binding.campaignId}/ai/sessions/${session.id}/messages`, { operation: "load-ai-messages" });
      sessionState.messages = messagesResponse.ok && Array.isArray(messagesResponse.data.messages) ? messagesResponse.data.messages : [];
    } else {
      sessionState.messages = [];
    }
    sessionState.ready = true;
    return session;
  }

  function renderTranscript() {
    transcript.innerHTML = "";
    if (!sessionState.messages.length) {
      const empty = doc.createElement("p");
      empty.textContent = "No messages yet.";
      transcript.appendChild(empty);
      return;
    }
    for (const message of sessionState.messages) {
      const row = doc.createElement("p");
      row.textContent = summarizeMessages([message])[0];
      transcript.appendChild(row);
    }
  }

  launch.addEventListener("click", async () => {
    const messageText = text(input.value);
    if (!messageText) {
      status.textContent = "Enter a message first.";
      return;
    }
    if (!text(binding.targetId) && typeof options.ensureTargetId === "function") {
      status.textContent = "Saving target first.";
      const ensuredTargetId = await options.ensureTargetId();
      if (!text(ensuredTargetId)) {
        status.textContent = "Failed to save target before starting AI session.";
        return;
      }
      binding.targetId = ensuredTargetId;
    }
    if (!text(binding.targetId)) {
      status.textContent = "Save the section before starting AI.";
      return;
    }
    if (!sessionState.session) {
      status.textContent = "Creating session.";
      const sessionResponse = await shell.api(`/api/campaigns/${binding.campaignId}/ai/sessions`, {
        method: "POST",
        operation: "create-ai-session",
        body: JSON.stringify({
          title: options.title || "AI session",
          targetKind: binding.targetKind,
          targetId: binding.targetId,
          sectionKey: binding.sectionKey || "",
          mode: binding.mode,
          policyProfile: binding.policyProfile,
          outputKind: binding.outputKind || "",
        }),
      });
      if (!sessionResponse.ok) {
        status.textContent = sessionResponse.error?.message || "Failed to create AI session.";
        return;
      }
      sessionState.session = sessionResponse.data.session;
    }
    status.textContent = "Submitting message.";
    const messageResponse = await shell.api(`/api/campaigns/${binding.campaignId}/ai/sessions/${sessionState.session.id}/messages`, {
      method: "POST",
      operation: "run-ai-session",
      body: JSON.stringify({
        clientRequestId: cryptoApi.randomUUID(),
        contentType: "text",
        operation: binding.mode,
        text: messageText,
      }),
    });
    if (!messageResponse.ok) {
      status.textContent = messageResponse.error?.message || "Failed to submit AI message.";
      return;
    }
    sessionState.messages.push(messageResponse.data.message);
    if (messageResponse.data.responseMessage) sessionState.messages.push(messageResponse.data.responseMessage);
    input.value = "";
    status.textContent = "Candidate output ready.";
    renderTranscript();
  });

  loadSession().then(() => {
    status.textContent = sessionState.session ? "Ready with thread." : "Ready empty.";
    renderTranscript();
  });

  return panel;
}
