import { createApiErrorConsoleSummary } from "./Diagnostics/ApiErrorSummary.mjs";
import { loadLocalState, saveDisplayName, saveIdentityId, saveSessionId } from "./state/local-state.js";

const state = loadLocalState(localStorage);

const el = (id) => document.getElementById(id);

const diagnosticsReady = mountDeveloperDiagnosticsPanel();

async function mountDeveloperDiagnosticsPanel() {
  if ((typeof window === "undefined") || (typeof document === "undefined") || (typeof customElements === "undefined")) return;

  try {
    await import("../wc/DeveloperDiagnostics/ErrorPanel.mjs");
  } catch (error) {
    console.error("Developer diagnostics panel failed to load.", error);
    return;
  }

  const mount = () => {
    if (!document.body) return;
    if (typeof document.querySelector === "function" && document.querySelector("dgm-dev-error-panel")) return;
    document.body.appendChild(document.createElement("dgm-dev-error-panel"));
  };

  if (document.body) {
    mount();
  } else {
    document.addEventListener("DOMContentLoaded", mount, { once: true });
  }
}

function saveState() {
  saveDisplayName(state.displayName, localStorage);
  saveIdentityId(state.identityId, localStorage);
  saveSessionId(state.sessionId, localStorage);
  const displayNameInput = el("displayName");
  if (displayNameInput) displayNameInput.value = state.displayName;
  const sessionInput = el("sessionId");
  if (sessionInput) sessionInput.value = state.sessionId;
}

function logApiFailure({ operation, method, path, status, errorCode, errorMessage }) {
  console.error("API request failed.", createApiErrorConsoleSummary({
    operation,
    method,
    path,
    status,
    errorCode,
    errorMessage,
  }));
}

async function api(path, options = {}) {
  const { operation, ...fetchOptions } = options;
  const method = fetchOptions.method || "GET";
  const headers = new Headers(fetchOptions.headers || {});
  headers.set("content-type", "application/json");
  if (state.identityId && path !== "/api/identity/local") {
    headers.set("x-local-identity-id", state.identityId);
  }

  try {
    const res = await fetch(path, { ...fetchOptions, headers });
    const contentType = res.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      const error = { message: "Unexpected API response." };
      logApiFailure({ operation, method, path, status: res.status, errorMessage: error.message });
      return { ok: false, error };
    }

    const data = await res.json();
    const responseFailed = (typeof res.ok === "boolean") ? !res.ok : false;
    if (responseFailed || !data.ok) {
      logApiFailure({ operation, method, path, status: res.status, errorCode: data?.error?.code });
    }
    return data;
  } catch (error) {
    const safeError = {
      message: "Network request failed.",
    };
    logApiFailure({ operation, method, path, errorMessage: safeError.message });
    return { ok: false, error: { message: "Request failed." } };
  }
}

async function refreshMessages() {
  if (!state.sessionId) return;
  const data = await api(`/api/sessions/${state.sessionId}/messages`, { method: "GET", operation: "load-messages" });
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
  const data = await api("/api/identity/local", { method: "POST", body: JSON.stringify({ displayName }), operation: "create-local-identity" });
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
  const data = await api("/api/sessions", { method: "POST", body: JSON.stringify({}), operation: "create-session" });
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
  const data = await api(`/api/sessions/${state.sessionId}/join`, { method: "POST", body: JSON.stringify({}), operation: "join-session" });
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
  const data = await api(`/api/sessions/${state.sessionId}/messages`, { method: "POST", body: JSON.stringify({ text, type: "player_action" }), operation: "send-message" });
  if (data.ok) {
    el("messageText").value = "";
    el("status").textContent = "Message sent.";
    await refreshMessages();
  } else {
    el("status").textContent = data.error.message || "Failed to send message.";
  }
}

await diagnosticsReady;

el("messageForm").addEventListener("submit", submitMessage);
el("sendMessage").addEventListener("click", submitMessage);

saveState();
el("displayName").value = state.displayName;
el("sessionId").value = state.sessionId;
if (state.sessionId) refreshMessages();
