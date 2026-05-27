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

  setText(el("shellIdentity", doc), `${identity.nickname} · ${identity.uuid}`);
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
