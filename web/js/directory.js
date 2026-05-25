import { createApiClient } from "./api/client.js";
import { mountDeveloperDiagnosticsPanel } from "./diagnostics.js";
import { ensureLocalIdentity, loadLocalState, saveLocalIdentity, saveSessionId } from "./state/local-state.js";

function el(id, doc = document) {
  return doc.getElementById(id);
}

function navigateToSession(sessionId, locationApi = globalThis.location) {
  if (locationApi?.assign) {
    locationApi.assign(`/session.html?sessionId=${encodeURIComponent(sessionId)}`);
  } else if (locationApi) {
    locationApi.href = `/session.html?sessionId=${encodeURIComponent(sessionId)}`;
  }
}

function renderSessions(sessions, state, { document: doc, onOpen, onJoin }) {
  const container = el("sessionDirectory", doc);
  if (!container) return;
  container.innerHTML = "";

  if (!sessions.length) {
    const empty = doc.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No sessions yet. Create the first one.";
    container.appendChild(empty);
    return;
  }

  for (const session of sessions) {
    const card = doc.createElement("article");
    card.className = "session-card";

    const header = doc.createElement("div");
    header.className = "session-card-header";

    const title = doc.createElement("h2");
    title.textContent = session.title || session.sessionId;
    header.appendChild(title);

    const badge = doc.createElement("span");
    badge.className = "session-state";
    badge.textContent = session.state;
    header.appendChild(badge);

    const meta = doc.createElement("p");
    meta.className = "session-meta";
    meta.textContent = `GM: ${session.gm?.nickname || "Unknown"} · Participants: ${session.participantCount}`;

    const flags = doc.createElement("p");
    flags.className = "session-flags";
    const markers = [];
    if (session.currentUserParticipant) markers.push("You are in this session");
    if (session.joinable) markers.push("Joinable");
    else markers.push("Closed");
    flags.textContent = markers.join(" · ");

    const actions = doc.createElement("div");
    actions.className = "session-actions";
    const button = doc.createElement("button");
    if (session.currentUserParticipant) {
      button.textContent = "Open workspace";
      button.addEventListener("click", () => onOpen(session.sessionId));
    } else {
      button.textContent = session.joinable ? "Join session" : "Unavailable";
      button.disabled = !session.joinable;
      button.addEventListener("click", () => onJoin(session.sessionId));
    }
    actions.appendChild(button);

    card.appendChild(header);
    card.appendChild(meta);
    card.appendChild(flags);
    card.appendChild(actions);
    container.appendChild(card);
  }
}

export async function initializeDirectoryApp({
  document: doc = globalThis.document,
  storage = globalThis.localStorage,
  locationApi = globalThis.location,
  cryptoApi = globalThis.crypto,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!doc?.getElementById) return;

  await mountDeveloperDiagnosticsPanel();

  const state = ensureLocalIdentity(storage, cryptoApi);
  const api = createApiClient({
    fetchImpl,
    getIdentity() {
      return { uuid: state.uuid, nickname: state.nickname };
    },
  });

  const status = el("status", doc);
  const uuidInput = el("identityUuid", doc);
  const nicknameInput = el("identityNickname", doc);
  const sessionTitleInput = el("sessionTitle", doc);

  function setStatus(text) {
    if (status) status.textContent = text;
  }

  function persistState() {
    saveLocalIdentity(state, storage);
    saveSessionId(state.sessionId, storage);
    if (uuidInput) uuidInput.value = state.uuid;
    if (nicknameInput) nicknameInput.value = state.nickname;
  }

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
    persistState();
    return true;
  }

  async function refreshSessions() {
    const response = await api("/api/sessions", {
      method: "GET",
      operation: "list-sessions",
    });
    if (!response.ok) {
      setStatus(response.error?.message || "Failed to load sessions.");
      return;
    }
    renderSessions(response.data.sessions || [], state, {
      document: doc,
      onOpen(sessionId) {
        state.sessionId = sessionId;
        saveSessionId(sessionId, storage);
        navigateToSession(sessionId, locationApi);
      },
      async onJoin(sessionId) {
        const joinResponse = await api(`/api/sessions/${sessionId}/join`, {
          method: "POST",
          operation: "join-session-from-directory",
          body: JSON.stringify({}),
        });
        if (!joinResponse.ok) {
          setStatus(joinResponse.error?.message || "Failed to join session.");
          return;
        }
        state.sessionId = sessionId;
        saveSessionId(sessionId, storage);
        navigateToSession(sessionId, locationApi);
      },
    });
    setStatus("Session Directory updated.");
  }

  const identityForm = el("identityForm", doc);
  if (identityForm) {
    identityForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      state.uuid = uuidInput?.value.trim() || state.uuid;
      state.nickname = nicknameInput?.value.trim() || state.nickname;
      persistState();
      if (await registerIdentity()) {
        setStatus(`Identity ready: ${state.nickname}`);
        await refreshSessions();
      }
    });
  }

  const createSessionForm = el("createSessionForm", doc);
  if (createSessionForm) {
    createSessionForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!(await registerIdentity())) return;
      const response = await api("/api/sessions", {
        method: "POST",
        operation: "create-session",
        body: JSON.stringify({ title: sessionTitleInput?.value.trim() || "" }),
      });
      if (!response.ok) {
        setStatus(response.error?.message || "Failed to create session.");
        return;
      }
      state.sessionId = response.data.sessionId;
      saveSessionId(state.sessionId, storage);
      navigateToSession(state.sessionId, locationApi);
    });
  }

  const refreshButton = el("refreshSessions", doc);
  if (refreshButton) {
    refreshButton.addEventListener("click", async () => {
      await refreshSessions();
    });
  }

  persistState();
  setStatus(`Identity ready: ${state.nickname}`);
  if (await registerIdentity()) {
    await refreshSessions();
  }
}

if (typeof document !== "undefined") {
  void initializeDirectoryApp();
}
