import { loadLocalState, saveDisplayName, saveIdentityId, saveSessionId } from "./state/local-state.js";

const state = loadLocalState(localStorage);

const el = (id) => document.getElementById(id);

function saveState() {
  saveDisplayName(state.displayName, localStorage);
  saveIdentityId(state.identityId, localStorage);
  saveSessionId(state.sessionId, localStorage);
  const displayNameInput = el("displayName");
  if (displayNameInput) displayNameInput.value = state.displayName;
  const sessionInput = el("sessionId");
  if (sessionInput) sessionInput.value = state.sessionId;
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set("content-type", "application/json");
  if (state.identityId && path !== "/api/identity/local") {
    headers.set("x-local-identity-id", state.identityId);
  }
  const res = await fetch(path, { ...options, headers });
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    return { ok: false, error: { message: `Unexpected response from ${path}.` } };
  }
  return res.json();
}

async function refreshMessages() {
  if (!state.sessionId) return;
  const data = await api(`/api/sessions/${state.sessionId}/messages`, { method: "GET" });
  el("status").textContent = data.ok ? "Loaded messages." : data.error.message;
  el("messages").innerHTML = "";
  for (const message of data.ok ? data.data.messages : []) {
    const li = document.createElement("li");
    li.textContent = `${message.identityId}: ${message.text}`;
    el("messages").appendChild(li);
  }
}

el("identityForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const displayName = el("displayName").value.trim();
  const data = await api("/api/identity/local", { method: "POST", body: JSON.stringify({ displayName }) });
  if (data.ok) {
    state.displayName = displayName;
    state.identityId = data.data.identityId;
    saveState();
    el("status").textContent = `Identity ready: ${state.identityId}`;
  } else {
    el("status").textContent = data.error.message;
  }
});

el("sessionForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = await api("/api/sessions", { method: "POST", body: JSON.stringify({}) });
  if (data.ok) {
    state.sessionId = data.data.sessionId;
    saveState();
    el("status").textContent = `Session ready: ${state.sessionId}`;
    await refreshMessages();
  } else {
    el("status").textContent = data.error.message;
  }
});

el("joinForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  state.sessionId = el("sessionId").value.trim();
  saveState();
  const data = await api(`/api/sessions/${state.sessionId}/join`, { method: "POST", body: JSON.stringify({}) });
  el("status").textContent = data.ok ? "Joined session." : data.error.message;
  await refreshMessages();
});

async function submitMessage(event) {
  event.preventDefault();
  if (!state.identityId) {
    el("status").textContent = "Create a local identity before sending messages.";
    return;
  }
  if (!state.sessionId) {
    el("status").textContent = "Join or create a session before sending messages.";
    return;
  }
  const text = el("messageText").value.trim();
  const data = await api(`/api/sessions/${state.sessionId}/messages`, { method: "POST", body: JSON.stringify({ text, type: "player_action" }) });
  if (data.ok) {
    el("messageText").value = "";
    el("status").textContent = "Message sent.";
    await refreshMessages();
  } else {
    el("status").textContent = data.error.message || "Failed to send message.";
  }
}

el("messageForm").addEventListener("submit", submitMessage);
el("sendMessage").addEventListener("click", submitMessage);

saveState();
el("displayName").value = state.displayName;
el("sessionId").value = state.sessionId;
if (state.sessionId) refreshMessages();
