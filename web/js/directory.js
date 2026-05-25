import { createApiClient } from "./api/client.js";
import { mountDeveloperDiagnosticsPanel } from "./diagnostics.js";
import { ensureLocalIdentity, saveLocalIdentity, saveSessionId } from "./state/local-state.js";

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

function createActionButton(doc, { label, disabled = false, onClick }) {
  const button = doc.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.disabled = disabled;
  if (typeof onClick === "function") {
    button.addEventListener("click", async (event) => {
      event?.stopPropagation?.();
      await onClick(event);
    });
  }
  return button;
}

function appendTextFragment(doc, container, text, className = "") {
  const fragment = doc.createElement("span");
  fragment.textContent = text;
  if (className) fragment.className = className;
  container.appendChild(fragment);
  return fragment;
}

function getSessionTitle(session) {
  return session.title || session.name || session.sessionId;
}

function getSessionGmNickname(session) {
  return session.gm?.nickname || "unknown";
}

function getJoinableLabel(session) {
  return session.joinable ? "Joinable" : "Non-joinable";
}

function getParticipationLabel(session) {
  return session.currentUserParticipant ? "You are in this session" : "Not joined";
}

function getPrimaryActionLabel(session) {
  if (session.currentUserParticipant) return "Open workspace";
  if (session.joinable) return "Join session";
  return "Unavailable";
}

function setDirectorySummary(sessions, doc) {
  const summary = el("sessionDirectorySummary", doc);
  if (!summary) return;
  const count = sessions.length;
  summary.textContent = `${count} session${count === 1 ? "" : "s"} listed.`;
}

function createSessionSummary(session, doc) {
  const summary = doc.createElement("div");
  summary.className = "session-summary";
  summary.setAttribute("data-role", "session-summary");

  appendTextFragment(doc, summary, getSessionTitle(session), "session-summary-title");
  appendTextFragment(doc, summary, session.state, "session-state");
  appendTextFragment(doc, summary, `GM ${getSessionGmNickname(session)}`, "session-summary-meta");
  appendTextFragment(doc, summary, `${session.participantCount} participant${session.participantCount === 1 ? "" : "s"}`, "session-summary-meta");
  appendTextFragment(doc, summary, session.currentUserParticipant ? "Member" : "Not joined", "session-summary-flag");
  appendTextFragment(doc, summary, getJoinableLabel(session), "session-summary-flag");

  return summary;
}

function renderSelectedSessionDetail(selectedSession, { document: doc, currentIdentityId, onOpen, onJoin, onDelete }) {
  const container = el("selectedSessionDetail", doc);
  if (!container) return;
  container.innerHTML = "";

  if (!selectedSession) return;

  const card = doc.createElement("article");
  card.className = "session-card";
  card.setAttribute("data-role", "selected-session-card");

  const eyebrow = doc.createElement("p");
  eyebrow.className = "eyebrow";
  eyebrow.textContent = "Selected session";

  const title = doc.createElement("h3");
  title.textContent = getSessionTitle(selectedSession);

  const idLine = doc.createElement("p");
  idLine.textContent = `Session ID: ${selectedSession.sessionId}`;

  const stateLine = doc.createElement("p");
  stateLine.textContent = `Lifecycle state: ${selectedSession.state}`;

  const gmLine = doc.createElement("p");
  gmLine.textContent = `Game Master: ${getSessionGmNickname(selectedSession)}`;

  const participantLine = doc.createElement("p");
  participantLine.textContent = `Participants: ${selectedSession.participantCount}`;

  const participationLine = doc.createElement("p");
  participationLine.textContent = `Participation: ${getParticipationLabel(selectedSession)}`;

  const joinableLine = doc.createElement("p");
  joinableLine.textContent = `Joinable status: ${getJoinableLabel(selectedSession)}`;

  const actions = doc.createElement("div");
  actions.className = "session-actions";
  actions.appendChild(createActionButton(doc, {
    label: getPrimaryActionLabel(selectedSession),
    disabled: !selectedSession.currentUserParticipant && !selectedSession.joinable,
    onClick() {
      if (selectedSession.currentUserParticipant) return onOpen(selectedSession.sessionId);
      return onJoin(selectedSession.sessionId);
    },
  }));

  if (selectedSession.gm?.uuid === currentIdentityId) {
    actions.appendChild(createActionButton(doc, {
      label: "Delete Session",
      onClick() {
        return onDelete(selectedSession.sessionId);
      },
    }));
  }

  card.appendChild(eyebrow);
  card.appendChild(title);
  card.appendChild(idLine);
  card.appendChild(stateLine);
  card.appendChild(gmLine);
  card.appendChild(participantLine);
  card.appendChild(participationLine);
  card.appendChild(joinableLine);
  card.appendChild(actions);
  container.appendChild(card);
}

function renderSessions(sessions, selectedSessionId, {
  document: doc,
  onSelect,
  onOpen,
  onJoin,
}) {
  const container = el("sessionDirectory", doc);
  if (!container) return;
  container.innerHTML = "";
  setDirectorySummary(sessions, doc);

  if (!sessions.length) {
    const empty = doc.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No sessions yet. Create the first one.";
    container.appendChild(empty);
    return;
  }

  for (const session of sessions) {
    const item = doc.createElement("article");
    item.className = "session-list-item";
    item.setAttribute("data-role", "session-list-item");
    item.setAttribute("role", "button");
    item.setAttribute("tabindex", "0");
    item.setAttribute("aria-pressed", String(session.sessionId === selectedSessionId));
    item.addEventListener("click", () => {
      onSelect(session.sessionId);
    });

    const actions = doc.createElement("div");
    actions.className = "session-actions";
    actions.setAttribute("data-role", "session-row-action");
    actions.appendChild(createActionButton(doc, {
      label: getPrimaryActionLabel(session),
      disabled: !session.currentUserParticipant && !session.joinable,
      onClick() {
        if (session.currentUserParticipant) return onOpen(session.sessionId);
        return onJoin(session.sessionId);
      },
    }));

    item.appendChild(createSessionSummary(session, doc));
    item.appendChild(actions);
    container.appendChild(item);
  }
}

export async function initializeDirectoryApp({
  document: doc = globalThis.document,
  storage = globalThis.localStorage,
  locationApi = globalThis.location,
  cryptoApi = globalThis.crypto,
  fetchImpl = globalThis.fetch,
  confirmImpl = globalThis.confirm ? globalThis.confirm.bind(globalThis) : () => false,
} = {}) {
  if (!doc?.getElementById) return;

  await mountDeveloperDiagnosticsPanel();

  const state = ensureLocalIdentity(storage, cryptoApi);
  state.sessions = [];
  state.selectedSessionId = "";
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

  function findSelectedSession() {
    return state.sessions.find((session) => session.sessionId === state.selectedSessionId) || null;
  }

  function renderDirectory() {
    renderSessions(state.sessions, state.selectedSessionId, {
      document: doc,
      onSelect(sessionId) {
        state.selectedSessionId = sessionId;
        renderDirectory();
      },
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

    renderSelectedSessionDetail(findSelectedSession(), {
      document: doc,
      currentIdentityId: state.uuid,
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
      async onDelete(sessionId) {
        if (!confirmImpl("Delete this session permanently?")) return;
        const response = await api(`/api/sessions/${sessionId}`, {
          method: "DELETE",
          operation: "delete-session",
        });
        if (!response.ok) {
          setStatus(response.error?.message || "Failed to delete session.");
          return;
        }
        await refreshSessions();
        setStatus("Session deleted.");
      },
    });
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
    state.sessions = response.data.sessions || [];
    if (!state.sessions.some((session) => session.sessionId === state.selectedSessionId)) {
      state.selectedSessionId = "";
    }
    renderDirectory();
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
  renderDirectory();
  setStatus(`Identity ready: ${state.nickname}`);
  if (await registerIdentity()) {
    await refreshSessions();
  }
}

if (typeof document !== "undefined") {
  void initializeDirectoryApp();
}
