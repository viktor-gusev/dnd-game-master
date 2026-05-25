import { createApiClient } from "./api/client.js";
import { mountDeveloperDiagnosticsPanel } from "./diagnostics.js";
import { createEventDeliveryChannel, getOrCreateClientInstanceId } from "./event-delivery-client.js";
import { ensureLocalIdentity, saveLocalIdentity, saveSessionId } from "./state/local-state.js";

function el(id, doc = document) {
  return doc.getElementById(id);
}

function renderParticipants(participants, doc = document) {
  const list = el("participants", doc);
  if (!list) return;
  list.innerHTML = "";
  for (const participant of participants || []) {
    const item = doc.createElement("li");
    item.textContent = `${participant.nickname || participant.displayName || participant.identityId} · ${participant.role}`;
    list.appendChild(item);
  }
}

function renderMessages(messages, doc = document) {
  const list = el("messages", doc);
  if (!list) return;
  list.innerHTML = "";
  for (const message of messages || []) {
    const item = doc.createElement("li");
    const timestamp = message.createdAt ? new Date(message.createdAt).toISOString().slice(11, 16) : "";
    item.textContent = `[${timestamp}] ${message.displayName}: ${message.text}`;
    list.appendChild(item);
  }
  list.scrollTop = list.scrollHeight;
}

export async function initializeSessionWorkspace({
  document: doc = globalThis.document,
  storage = globalThis.localStorage,
  sessionStorageApi = globalThis.sessionStorage,
  locationApi = globalThis.location,
  cryptoApi = globalThis.crypto,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!doc?.getElementById) return;

  await mountDeveloperDiagnosticsPanel();

  const params = new URL(locationApi?.href || doc.location?.href || "http://localhost/session.html").searchParams;
  const sessionId = params.get("sessionId") || "";
  const state = ensureLocalIdentity(storage, cryptoApi);
  state.sessionId = sessionId || state.sessionId || "";
  saveLocalIdentity(state, storage);
  saveSessionId(state.sessionId, storage);

  const status = el("status", doc);
  const channelStatus = el("channelStatus", doc);
  const title = el("sessionTitle", doc);
  const subtitle = el("sessionSubtitle", doc);
  const backLink = el("backToDirectory", doc);
  const messageInput = el("messageText", doc);

  function setStatus(text) {
    if (status) status.textContent = text;
  }

  if (backLink) backLink.setAttribute("href", "/");

  if (!sessionId) {
    setStatus("Session id is missing. Return to the Session Directory.");
    const shell = el("workspaceShell", doc);
    if (shell) shell.classList.add("workspace-error");
    return;
  }

  const api = createApiClient({
    fetchImpl,
    getIdentity() {
      return { uuid: state.uuid, nickname: state.nickname };
    },
  });

  const channel = createEventDeliveryChannel({
    clientInstanceId: getOrCreateClientInstanceId(sessionStorageApi),
    fetchImpl,
    getRequestHeaders() {
      return state.uuid ? { "x-local-identity-id": state.uuid } : {};
    },
    onConnected({ isReconnect }) {
      if (isReconnect) void refreshMessages();
    },
    onExtensionFrame(frame) {
      if (frame?.name !== "session.messages.changed") return;
      if (frame?.payload?.sessionId !== sessionId) return;
      void refreshMessages();
    },
    onStateChange(next) {
      if (channelStatus) channelStatus.textContent = `Channel: ${next}`;
    },
  });

  async function registerIdentity() {
    const response = await api("/api/identity/local", {
      method: "POST",
      operation: "register-local-identity",
      body: JSON.stringify({ uuid: state.uuid, nickname: state.nickname }),
    });
    if (!response.ok) {
      setStatus(response.error?.message || "Failed to register identity.");
      return false;
    }
    state.uuid = response.data.identity.uuid;
    state.nickname = response.data.identity.nickname;
    saveLocalIdentity(state, storage);
    return true;
  }

  async function joinSession() {
    const response = await api(`/api/sessions/${sessionId}/join`, {
      method: "POST",
      operation: "join-session-workspace",
      body: JSON.stringify({}),
    });
    if (!response.ok) {
      setStatus(response.error?.message || "Failed to open session.");
      return false;
    }
    return true;
  }

  async function loadSession() {
    const response = await api(`/api/sessions/${sessionId}`, {
      method: "GET",
      operation: "load-session-workspace",
    });
    if (!response.ok) {
      setStatus(response.error?.message || "Failed to load session.");
      return false;
    }
    const session = response.data.session;
    if (title) title.textContent = session.title || session.sessionId;
    if (subtitle) {
      subtitle.textContent = `State: ${session.state} · GM: ${session.gm?.nickname || "Unknown"} · Participants: ${response.data.participants.length}`;
    }
    renderParticipants(response.data.participants, doc);
    return true;
  }

  async function refreshMessages() {
    const response = await api(`/api/sessions/${sessionId}/messages`, {
      method: "GET",
      operation: "load-session-messages",
    });
    if (!response.ok) {
      setStatus(response.error?.message || "Failed to load messages.");
      return;
    }
    renderMessages(response.data.messages, doc);
    setStatus("Workspace updated.");
  }

  const messageForm = el("messageForm", doc);
  if (messageForm) {
    messageForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const text = messageInput?.value.trim() || "";
      const response = await api(`/api/sessions/${sessionId}/messages`, {
        method: "POST",
        operation: "send-session-message",
        body: JSON.stringify({ text, type: "player_action" }),
      });
      if (!response.ok) {
        setStatus(response.error?.message || "Failed to send message.");
        return;
      }
      if (messageInput) messageInput.value = "";
      await refreshMessages();
      setStatus("Message sent.");
    });
  }

  if (!(await registerIdentity())) return;
  if (!(await joinSession())) return;
  if (!(await loadSession())) return;
  await refreshMessages();
  await channel.start();
}

if (typeof document !== "undefined") {
  void initializeSessionWorkspace();
}
