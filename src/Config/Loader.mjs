// @ts-check

/**
 * @namespace Dnd_Gm_Config_Loader
 * @description Runtime configuration loader for the application.
 */
export default class Dnd_Gm_Config_Loader {
  /**
   * @param {object} deps
   * @param {typeof import("node:fs/promises")} deps.fs
   * @param {typeof import("node:path")} deps.path
   * @param {Dnd_Gm_Config_Runtime__Factory} deps.appCfgRuntimeFactory
   */
  constructor({ fs, path, appCfgRuntimeFactory }) {
    const parseEnv = (content) => {
      const result = {};
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const idx = trimmed.indexOf("=");
        if (idx <= 0) continue;
        const key = trimmed.slice(0, idx).trim();
        if (!key) continue;
        let value = trimmed.slice(idx + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        result[key] = value;
      }
      return result;
    };

    const parsePort = (value) => {
      const result = Number.parseInt(value, 10);
      if (!Number.isInteger(result) || String(result) !== value || result < 1 || result > 65535) {
        throw new Error("Invalid runtime configuration field PORT: value must be an integer from 1 to 65535.");
      }
      return result;
    };

    const buildRuntimeConfig = (env) => ({
      httpPort: env.PORT !== undefined ? parsePort(env.PORT) : 3000,
    });

    const readEnvFile = async (projectRoot) => {
      const filePath = path.join(projectRoot, ".env");
      try {
        const content = await fs.readFile(filePath, "utf8");
        return parseEnv(content);
      } catch (error) {
        if (error && error.code === "ENOENT") return {};
        throw error;
      }
    };

    this.load = async function ({ projectRoot }) {
      const env = await readEnvFile(projectRoot);
      const cfg = buildRuntimeConfig(env);
      appCfgRuntimeFactory.configure(cfg);
      return appCfgRuntimeFactory.freeze();
    };
  }
}

export const __deps__ = Object.freeze({
  default: {
    fs: "node:fs/promises",
    path: "node:path",
    appCfgRuntimeFactory: "Dnd_Gm_Config_Runtime__Factory$",
  },
});
