// @ts-check

/**
 * @namespace Dnd_Gm_Bootstrap
 * @description Root application component that starts and stops the web server.
 */

const DEFAULT_PORT = 3000;

function parseEnvFile(content) {
  const env = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex < 0) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    if (!key) continue;
    let value = trimmed.slice(eqIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

async function loadEnvFile(envPath) {
  const fs = await import("node:fs/promises");
  try {
    const content = await fs.readFile(envPath, "utf8");
    Object.assign(process.env, parseEnvFile(content));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function parsePort(cliArgs) {
  let port = Number(process.env.PORT || DEFAULT_PORT);
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

export default class Bootstrap {
  constructor({ pipeline, server, staticHandler, sourceFactory, configFactory, apiHandler, dataStore }) {
    let running = false;
    let stoppedBeforeRun = false;
    let done = null;
    let doneResolve = null;
    let stopped = false;

    this.run = async function ({ projectRoot, cliArgs }) {
      if (stoppedBeforeRun) return 0;
      await loadEnvFile(`${projectRoot}/.env`);
      if (dataStore) {
        await dataStore.init();
        await dataStore.cleanupExpiredCampaigns();
      }
      const port = parsePort(cliArgs);
      const webRoot = `${projectRoot}/web`;
      const source = sourceFactory.create({ root: webRoot, prefix: "/", allow: { ".": ["."] }, defaults: ["index.html"] });
      await staticHandler.init({ sources: [source] });
      if (apiHandler) {
        if (typeof pipeline.addHandler === "function") pipeline.addHandler(apiHandler);
        else pipeline.registerHandler(apiHandler);
      }
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
  apiHandler: "Dnd_Gm_Web_Handler_Api$",
  dataStore: "Dnd_Gm_Store_File_Data$",
});
