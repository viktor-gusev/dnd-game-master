// @ts-check

/**
 * @namespace Dnd_Gm_Config_Runtime
 * @description Runtime configuration data for the application.
 */
export class Data {
  /** @type {number|undefined} */
  httpPort;
}

/** @type {Data} */
const cfg = new Data();

const facade = {};
let initialized = false;

function resetState() {
  cfg.httpPort = undefined;
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
    };
    this.freeze = function () {
      if (frozen) return proxy;
      if (cfg.httpPort === undefined) cfg.httpPort = 3000;
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
