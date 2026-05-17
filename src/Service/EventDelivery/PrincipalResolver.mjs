// @ts-check

/**
 * @namespace Dnd_Gm_Service_EventDelivery_PrincipalResolver
 * @description Resolves Event Delivery principal refs from the local MVP identity model.
 */

export default class Dnd_Gm_Service_EventDelivery_PrincipalResolver {
  constructor({ dataStore }) {
    this.resolvePrincipalRef = async function (requestContext) {
      const req = requestContext?.request;
      const identityId = req?.headers?.["x-local-identity-id"];
      if (!identityId) throw Object.assign(new Error("Missing local identity id."), { code: "missing_identity" });
      const identity = await dataStore.getIdentity(identityId);
      if (!identity) throw Object.assign(new Error("Unknown local identity id."), { code: "unknown_identity" });
      return identity.id;
    };
  }
}

export const __deps__ = Object.freeze({
  dataStore: "Dnd_Gm_Store_File_Data$",
});
