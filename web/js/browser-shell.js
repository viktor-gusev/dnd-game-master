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
      setText(el("shellError", doc), shell.errorCount ? `Errors ${shell.errorCount}` : "Errors 0");
      if (message) setText(el("shellConnectionState", doc), message);
    },
    recordShellError(message) {
      shell.errorCount += 1;
      setText(el("shellError", doc), `Errors ${shell.errorCount}`);
      if (message) setText(el("shellConnectionState", doc), message);
    },
    setConnectionState(state) {
      setText(el("shellConnectionState", doc), state || "");
    },
    setPageContext(nextContext) {
      shell.pageContext = { ...shell.pageContext, ...nextContext };
      setText(el("shellContextTitle", doc), shell.pageContext.kind === "campaign workspace" ? "Campaign Workspace" : "Campaigns");
      if (shell.eventDelivery) {
        void shell.eventDelivery.updateCampaignContext(shell.pageContext.campaignId || "");
      }
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
    onStateChange(state) {
      shell.setConnectionState(state);
    },
  });
  shell.eventDelivery = eventDelivery;
  eventDelivery.connect();

  setText(el("shellContextTitle", doc), pageContext.kind === "campaign workspace" ? "Campaign Workspace" : "Campaigns");
  setText(el("shellDeviceStatus", doc), "Device ready");
  setText(el("shellProfile", doc), identity.nickname);
  setText(el("shellError", doc), "Errors 0");

  const footerCampaigns = el("footerCampaigns", doc);
  if (footerCampaigns) footerCampaigns.addEventListener("click", () => { locationApi.href = "/"; });
  const footerUpdates = el("footerUpdates", doc);
  if (footerUpdates) footerUpdates.addEventListener("click", () => openDeveloperPanel(doc));
  const footerProfile = el("footerProfile", doc);
  if (footerProfile) footerProfile.addEventListener("click", () => shell.openIdentityEditor());
  const shellProfile = el("shellProfile", doc);
  if (shellProfile) shellProfile.addEventListener("click", () => shell.openIdentityEditor());
  const shellUpdates = el("shellUpdates", doc);
  if (shellUpdates) shellUpdates.addEventListener("click", () => openDeveloperPanel(doc));
  const shellDeviceStatus = el("shellDeviceStatus", doc);
  if (shellDeviceStatus) shellDeviceStatus.addEventListener("click", () => setPanelContent(doc, "<p>Local storage ready.</p>", true));
  const shellError = el("shellError", doc);
  if (shellError) shellError.addEventListener("click", () => openDeveloperPanel(doc));
  const shellMenu = el("shellMenu", doc);
  if (shellMenu) shellMenu.addEventListener("click", () => shell.openShellMenu());
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
  if (profile) profile.textContent = shell.identity.nickname;
}
