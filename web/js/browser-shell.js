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
    pageContext: { ...pageContext },
    pageError(message) {
      setText(el("shellError", doc), message || "");
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
      const nextOpen = !el("shellPanel", doc)?.hidden;
      setPanelContent(doc, `
        <div class="shell-panel-card">
          <p class="eyebrow">Shell</p>
          <p>Campaigns, updates, profile, and diagnostics remain shell-owned controls.</p>
        </div>
      `, !nextOpen);
      const menu = el("shellMenu", doc);
      if (menu) menu.setAttribute("aria-expanded", String(!nextOpen));
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
  setText(el("shellUpdates", doc), "Updates");
  setText(el("shellProfile", doc), identity.nickname);
  setText(el("shellError", doc), "Errors 0");
  const footerCampaigns = el("footerCampaigns", doc);
  if (footerCampaigns) footerCampaigns.addEventListener("click", () => { locationApi.href = "/"; });
  const footerUpdates = el("footerUpdates", doc);
  if (footerUpdates) footerUpdates.addEventListener("click", () => shell.pageError("Updates available."));
  const footerProfile = el("footerProfile", doc);
  if (footerProfile) footerProfile.addEventListener("click", () => shell.openIdentityEditor());
  const shellProfile = el("shellProfile", doc);
  if (shellProfile) shellProfile.addEventListener("click", () => shell.openIdentityEditor());
  const shellUpdates = el("shellUpdates", doc);
  if (shellUpdates) shellUpdates.addEventListener("click", () => shell.pageError("Updates available."));
  const shellDeviceStatus = el("shellDeviceStatus", doc);
  if (shellDeviceStatus) shellDeviceStatus.addEventListener("click", () => shell.pageError("Local storage ready."));
  const shellError = el("shellError", doc);
  if (shellError) shellError.addEventListener("click", () => shell.pageError("No shell errors recorded."));
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
}
