import { createApiClient } from "./api/client.js";
import { createEventDeliveryClient, getOrCreateTabIdentityId } from "./event-delivery-client.js";
import { mountDeveloperDiagnosticsPanel } from "./diagnostics.js";
import { createDefaultNickname, ensureLocalIdentity, saveLocalIdentity } from "./state/local-state.js";

function el(id, doc = document) {
  return doc.getElementById(id);
}

function setText(node, value) {
  if (node) node.textContent = value;
}

function setValue(node, value) {
  if (node && "value" in node) node.value = value;
}

function setConnectionStateControl(doc, state) {
  const control = el("shellConnectionState", doc);
  if (!control) return;
  const normalized = state === "connected" || state === "reconnecting" ? state : "not-connected";
  control.dataset.state = normalized;
  control.setAttribute("aria-label", `Connection ${normalized}`);
}

function setPanelContent(doc, content, open = false) {
  const panel = el("shellPanel", doc);
  if (!panel) return;
  panel.hidden = !open;
  panel.innerHTML = content || "";
}

function openDeveloperPanel(doc) {
  const panel = doc.querySelector?.("dgm-dev-error-panel");
  if (panel) panel.open = true;
}

function enableBackdropClose(element, close) {
  if (!element || typeof element.addEventListener !== "function") return;
  element.addEventListener("click", (event) => {
    if (event.target !== element) return;
    close();
  });
}

export async function initializeBrowserApplicationShell({
  document: doc = globalThis.document,
  storage = globalThis.localStorage,
  locationApi = globalThis.location,
  cryptoApi = globalThis.crypto,
  fetchImpl = globalThis.fetch,
  pageController,
  pageContext = {},
  confirmImpl = globalThis.confirm ? globalThis.confirm.bind(globalThis) : () => false,
} = {}) {
  if (!doc?.getElementById) return null;

  await mountDeveloperDiagnosticsPanel();

  const identity = ensureLocalIdentity(storage, cryptoApi);
  const tabIdentityId = getOrCreateTabIdentityId(globalThis.sessionStorage || storage, cryptoApi);
  const api = createApiClient({ fetchImpl, getIdentity: () => identity });
  const shell = {
    document: doc,
    storage,
    locationApi,
    fetchImpl,
    confirmImpl,
    api,
    identity,
    tabIdentityId,
    errorCount: 0,
    pageContext: { ...pageContext },
    pageError(message) {
      const shellLogs = el("shellLogs", doc);
      if (shellLogs) shellLogs.setAttribute("aria-label", shell.errorCount ? `Errors ${shell.errorCount}` : "Errors 0");
      if (message) setConnectionStateControl(doc, "not-connected");
    },
    recordShellError(message) {
      shell.errorCount += 1;
      const shellLogs = el("shellLogs", doc);
      if (shellLogs) shellLogs.setAttribute("aria-label", `Errors ${shell.errorCount}`);
      if (message) setConnectionStateControl(doc, "not-connected");
    },
    setConnectionState(state) {
      setConnectionStateControl(doc, state);
    },
    setPageContext(nextContext) {
      shell.pageContext = { ...shell.pageContext, ...nextContext };
      setText(el("shellContextTitle", doc), shell.pageContext.kind === "player workspace" ? "Player Workspace" : shell.pageContext.kind === "game master workspace" ? "Game Master Workspace" : "Campaigns");
      if (shell.eventDelivery) {
        void shell.eventDelivery.updateCampaignContext(shell.pageContext.campaignId || "");
      }
    },
    markUpdatesFresh(notification) {
      const shellNotifications = el("shellNotifications", doc);
      if (!shellNotifications) return;
      const label = notification?.type === "campaign.event.created" ? "Updates available" : "Updates";
      shellNotifications.setAttribute("aria-label", label);
      shellNotifications.dataset.freshness = notification?.type || "notification";
    },
    openIdentityEditor() {
      const dialog = el("identityDialog", doc);
      if (!dialog) return;
      setValue(el("identityUuid", doc), identity.uuid);
      setValue(el("identityNickname", doc), identity.nickname);
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    },
    openShellMenu() {
      const panel = el("shellPanel", doc);
      const isOpen = !panel?.hidden;
      setPanelContent(doc, isOpen ? "" : `
        <div class="shell-panel-card">
          <p class="status-line">Shell controls</p>
          <button type="button" data-action="diagnostics">Open diagnostics</button>
          <button type="button" data-action="identity">Edit identity</button>
        </div>
      `, !isOpen);
      const menu = el("shellMenu", doc);
      if (menu) menu.setAttribute("aria-expanded", String(!isOpen));
      if (!isOpen) {
        panel?.querySelectorAll?.("[data-action='diagnostics']")?.[0]?.addEventListener("click", () => openDeveloperPanel(doc));
        panel?.querySelectorAll?.("[data-action='identity']")?.[0]?.addEventListener("click", () => shell.openIdentityEditor());
      }
    },
    openCampaignCreator() {
      const dialog = el("createCampaignDialog", doc);
      if (!dialog) return;
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    },
    openCampaignDetails() {
      const dialog = el("campaignDetailsDialog", doc);
      if (!dialog) return;
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    },
  };

  const eventDelivery = createEventDeliveryClient({
    tabIdentityId,
    localIdentityId: identity.uuid,
    campaignId: shell.pageContext.campaignId || "",
    fetchImpl,
    onNotification(notification) {
      shell.markUpdatesFresh(notification);
      if (typeof shell.handleNotification === "function") shell.handleNotification(notification);
    },
    onStateChange(state) {
      shell.setConnectionState(state);
    },
  });
  shell.eventDelivery = eventDelivery;
  eventDelivery.connect();

  setText(el("shellContextTitle", doc), pageContext.kind === "player workspace" ? "Player Workspace" : pageContext.kind === "game master workspace" ? "Game Master Workspace" : "Campaigns");
  const shellDeviceStatus = el("shellDeviceStatus", doc);
  if (shellDeviceStatus) shellDeviceStatus.setAttribute("aria-label", "Device ready");
  const shellProfile = el("shellProfile", doc);
  if (shellProfile) shellProfile.setAttribute("aria-label", identity.nickname);
  const shellLogs = el("shellLogs", doc);
  if (shellLogs) shellLogs.setAttribute("aria-label", "Errors 0");
  setConnectionStateControl(doc, "reconnecting");

  const footerCampaigns = el("footerCampaigns", doc);
  if (footerCampaigns) footerCampaigns.addEventListener("click", () => { locationApi.href = "/"; });
  const footerUpdates = el("footerUpdates", doc);
  if (footerUpdates) footerUpdates.addEventListener("click", () => openDeveloperPanel(doc));
  const footerProfile = el("footerProfile", doc);
  if (footerProfile) footerProfile.addEventListener("click", () => shell.openIdentityEditor());
  if (shellProfile) shellProfile.addEventListener("click", () => shell.openIdentityEditor());
  const shellNotifications = el("shellNotifications", doc);
  if (shellNotifications) shellNotifications.addEventListener("click", () => openDeveloperPanel(doc));
  if (shellDeviceStatus) shellDeviceStatus.addEventListener("click", () => setPanelContent(doc, "<p>Local storage ready.</p>", true));
  if (shellLogs) shellLogs.addEventListener("click", () => openDeveloperPanel(doc));
  const shellMenu = el("shellMenu", doc);
  if (shellMenu) shellMenu.addEventListener("click", () => shell.openShellMenu());
  enableBackdropClose(el("shellPanel", doc), () => {
    setPanelContent(doc, "", false);
    if (shellMenu) shellMenu.setAttribute("aria-expanded", "false");
  });
  enableBackdropClose(el("identityDialog", doc), () => el("identityDialog", doc)?.close?.());
  enableBackdropClose(el("createCampaignDialog", doc), () => el("createCampaignDialog", doc)?.close?.());
  enableBackdropClose(el("campaignDetailsDialog", doc), () => el("campaignDetailsDialog", doc)?.close?.());
  shell.setConnectionState("connected");

  if (typeof pageController === "function") {
    await pageController(shell);
  }

  return shell;
}

export function updateShellIdentity(shell, nextIdentity) {
  if (!shell?.storage || !nextIdentity) return;
  shell.identity.uuid = nextIdentity.uuid || shell.identity.uuid;
  shell.identity.nickname = nextIdentity.nickname || createDefaultNickname(shell.identity.uuid);
  saveLocalIdentity(shell.identity, shell.storage);
  const profile = el("shellProfile", shell.document);
  if (profile) profile.setAttribute("aria-label", shell.identity.nickname);
}
