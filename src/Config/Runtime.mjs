// @ts-check

/**
 * @namespace Dnd_Gm_Config_Runtime
 * @description Runtime configuration data for the application.
 */
export class Data {
  /** @type {number|undefined} */
  httpPort;
  /** @type {string|undefined} */
  dataRoot;
  /** @type {string|undefined} */
  aiProvider;
  /** @type {string|undefined} */
  openaiApiKey;
  /** @type {string|undefined} */
  openaiDefaultModel;
  /** @type {string|undefined} */
  openaiImageModel;
  /** @type {number|undefined} */
  aiProviderTimeoutMs;
  /** @type {number|undefined} */
  aiMaxInputTokens;
  /** @type {number|undefined} */
  aiMaxOutputTokens;
  /** @type {number|undefined} */
  aiCreditPreauthMultiplier;
  /** @type {string|undefined} */
  aiDefaultPricingPolicyId;
  /** @type {number|undefined} */
  aiCampaignInitialCredits;
}

/** @type {Data} */
const cfg = new Data();

const facade = {};
let initialized = false;

function resetState() {
  cfg.httpPort = undefined;
  cfg.dataRoot = undefined;
  cfg.aiProvider = undefined;
  cfg.openaiApiKey = undefined;
  cfg.openaiDefaultModel = undefined;
  cfg.openaiImageModel = undefined;
  cfg.aiProviderTimeoutMs = undefined;
  cfg.aiMaxInputTokens = undefined;
  cfg.aiMaxOutputTokens = undefined;
  cfg.aiCreditPreauthMultiplier = undefined;
  cfg.aiDefaultPricingPolicyId = undefined;
  cfg.aiCampaignInitialCredits = undefined;
  initialized = false;
}

const proxy = new Proxy(facade, {
  get(_target, prop) {
    const isServiceProp = prop === "then" || typeof prop === "symbol";
    if (!initialized && !isServiceProp) {
      throw new Error("Runtime configuration is not initialized.");
    }
    return Reflect.get(cfg, prop);
  },
  set() {
    throw new Error("Runtime configuration is immutable.");
  },
  defineProperty() {
    throw new Error("Runtime configuration wrapper is immutable.");
  },
  deleteProperty() {
    throw new Error("Runtime configuration wrapper is immutable.");
  },
  preventExtensions() {
    throw new Error("Runtime configuration wrapper cannot be frozen.");
  },
});

/**
 * @namespace Dnd_Gm_Config_Runtime__Factory
 * @description Runtime configuration factory.
 */
export class Factory {
  /**
   * @param {object} deps
   */
  constructor() {
    let frozen = false;
    resetState();
    this.configure = function (params = {}) {
      if (frozen) {
        throw new Error("Runtime configuration is already frozen.");
      }
      if (params.httpPort !== undefined && cfg.httpPort === undefined) cfg.httpPort = params.httpPort;
      if (params.dataRoot !== undefined && cfg.dataRoot === undefined) cfg.dataRoot = params.dataRoot;
      if (params.aiProvider !== undefined && cfg.aiProvider === undefined) cfg.aiProvider = params.aiProvider;
      if (params.openaiApiKey !== undefined && cfg.openaiApiKey === undefined) cfg.openaiApiKey = params.openaiApiKey;
      if (params.openaiDefaultModel !== undefined && cfg.openaiDefaultModel === undefined) cfg.openaiDefaultModel = params.openaiDefaultModel;
      if (params.openaiImageModel !== undefined && cfg.openaiImageModel === undefined) cfg.openaiImageModel = params.openaiImageModel;
      if (params.aiProviderTimeoutMs !== undefined && cfg.aiProviderTimeoutMs === undefined) cfg.aiProviderTimeoutMs = params.aiProviderTimeoutMs;
      if (params.aiMaxInputTokens !== undefined && cfg.aiMaxInputTokens === undefined) cfg.aiMaxInputTokens = params.aiMaxInputTokens;
      if (params.aiMaxOutputTokens !== undefined && cfg.aiMaxOutputTokens === undefined) cfg.aiMaxOutputTokens = params.aiMaxOutputTokens;
      if (params.aiCreditPreauthMultiplier !== undefined && cfg.aiCreditPreauthMultiplier === undefined) cfg.aiCreditPreauthMultiplier = params.aiCreditPreauthMultiplier;
      if (params.aiDefaultPricingPolicyId !== undefined && cfg.aiDefaultPricingPolicyId === undefined) cfg.aiDefaultPricingPolicyId = params.aiDefaultPricingPolicyId;
      if (params.aiCampaignInitialCredits !== undefined && cfg.aiCampaignInitialCredits === undefined) cfg.aiCampaignInitialCredits = params.aiCampaignInitialCredits;
    };
    this.freeze = function () {
      if (frozen) return proxy;
      if (cfg.httpPort === undefined) cfg.httpPort = 3000;
      if (cfg.dataRoot === undefined) cfg.dataRoot = "var/data";
      if (cfg.aiProvider === undefined) cfg.aiProvider = "fake";
      if (cfg.aiProviderTimeoutMs === undefined) cfg.aiProviderTimeoutMs = 60000;
      if (cfg.aiMaxInputTokens === undefined) cfg.aiMaxInputTokens = 12000;
      if (cfg.aiMaxOutputTokens === undefined) cfg.aiMaxOutputTokens = 2048;
      if (cfg.aiCreditPreauthMultiplier === undefined) cfg.aiCreditPreauthMultiplier = 1;
      if (cfg.aiCampaignInitialCredits === undefined) cfg.aiCampaignInitialCredits = 100;
      frozen = true;
      initialized = true;
      return proxy;
    };
  }
}

/**
 * Runtime configuration wrapper.
 */
export default class Wrapper {
  constructor() {
    return proxy;
  }
}

Object.freeze(Data.prototype);
Object.freeze(Factory.prototype);
Object.freeze(Wrapper.prototype);
