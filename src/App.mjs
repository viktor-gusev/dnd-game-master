// @ts-check

/**
 * @namespace Dnd_Gm_App
 * @description Root application component that starts and stops the web server.
 */

const DEFAULT_PORT = 3000;

/**
 * Parses the HTTP port from CLI arguments.
 *
 * @param {string[]} cliArgs
 * @returns {number}
 */
function parsePort(cliArgs) {
  let port = DEFAULT_PORT;
  for (let i = 0; i < cliArgs.length; i += 1) {
    const arg = cliArgs[i];
    if (arg === "--port" || arg === "-p") {
      const value = cliArgs[i + 1];
      if (value == null) throw new Error("Invalid port.");
      port = Number(value);
      i += 1;
      continue;
    }
    if (arg.startsWith("--port=")) {
      port = Number(arg.slice("--port=".length));
    }
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid port.");
  return port;
}

export default class App {
  /**
   * @param {object} deps
   * @param {Fl32_Web_Back_PipelineEngine} deps.pipeline
   * @param {Fl32_Web_Back_Server} deps.server
   * @param {Fl32_Web_Back_Handler_Static} deps.staticHandler
   * @param {Fl32_Web_Back_Dto_Source__Factory} deps.sourceFactory
   * @param {Fl32_Web_Back_Config_Runtime__Factory} deps.configFactory
   */
  constructor({ pipeline, server, staticHandler, sourceFactory, configFactory }) {
    let running = false;
    let stoppedBeforeRun = false;
    let done = null;
    let doneResolve = null;
    let stopped = false;

    /**
     * Starts the web server and waits until shutdown is requested.
     *
     * @param {object} params
     * @param {string} params.projectRoot
     * @param {string[]} params.cliArgs
     * @returns {Promise<number>}
     */
    this.run = async function ({ projectRoot, cliArgs }) {
      if (stoppedBeforeRun) return 0;
      const port = parsePort(cliArgs);
      const webRoot = `${projectRoot}/web`;
      const source = sourceFactory.create({ root: webRoot, prefix: "/", allow: { ".": ["."] }, defaults: ["index.html"] });
      await staticHandler.init({ sources: [source] });
      if (typeof pipeline.addHandler === "function") pipeline.addHandler(staticHandler);
      else pipeline.registerHandler(staticHandler);
      configFactory.configure({ port, type: "http" });
      configFactory.freeze();
      running = true;
      done = new Promise((resolve) => {
        doneResolve = resolve;
      });
      await server.start({ port, type: "http" });
      await done;
      running = false;
      return 0;
    };

    /**
     * Stops the web server and resolves the running application.
     *
     * @returns {Promise<void>}
     */
    this.stop = async function () {
      if (stopped) return;
      stopped = true;
      if (!running) stoppedBeforeRun = true;
      try {
        if (typeof server.stop === "function") await server.stop();
        else if (typeof server.close === "function") await server.close();
      } finally {
        if (doneResolve) doneResolve();
        if (running && done) await done;
      }
    };
  }
}

export const __deps__ = Object.freeze({
  pipeline: "Fl32_Web_Back_PipelineEngine$",
  server: "Fl32_Web_Back_Server$",
  staticHandler: "Fl32_Web_Back_Handler_Static$",
  sourceFactory: "Fl32_Web_Back_Dto_Source__Factory$",
  configFactory: "Fl32_Web_Back_Config_Runtime__Factory$",
});
