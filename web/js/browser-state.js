export const STORAGE_KEYS = {
  uuid: "dnd-gm.identity.uuid",
  nickname: "dnd-gm.identity.nickname",
  campaignId: "dnd-gm.campaignId",
};

export function loadBrowserState(storage) {
  return {
    uuid: storage.getItem(STORAGE_KEYS.uuid) || "",
    nickname: storage.getItem(STORAGE_KEYS.nickname) || "",
    campaignId: storage.getItem(STORAGE_KEYS.campaignId) || "",
  };
}

export function saveBrowserState(storage, state) {
  storage.setItem(STORAGE_KEYS.uuid, state.uuid || "");
  storage.setItem(STORAGE_KEYS.nickname, state.nickname || "");
  storage.setItem(STORAGE_KEYS.campaignId, state.campaignId || "");
}
