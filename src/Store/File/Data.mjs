// @ts-check

/**
 * @namespace Dnd_Gm_Store_File_Data
 * @description File-backed data store for identities, sessions, participants, and messages.
 */

function safeSessionId(sessionId) {
  if (typeof sessionId !== "string" || !/^[a-zA-Z0-9_-]+$/.test(sessionId)) {
    throw Object.assign(new Error("Invalid session id."), { code: "invalid_session_id" });
  }
  return sessionId;
}

async function ensureDir(dir) {
  const fs = await import("node:fs/promises");
  await fs.mkdir(dir, { recursive: true });
}

async function readJson(file, fallback) {
  const fs = await import("node:fs/promises");
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJson(file, value) {
  const fs = await import("node:fs/promises");
  await ensureDir(file.slice(0, file.lastIndexOf("/")));
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(temp, file);
}

export default class Dnd_Gm_Store_File_Data {
  constructor() {
    this.root = process.env.DND_GM_DATA_ROOT || `${process.cwd()}/var/data`;
    this.init = async function () {
      await ensureDir(this.root);
      await ensureDir(`${this.root}/sessions`);
    };
    this.loadIdentities = async function () {
      await this.init();
      return readJson(`${this.root}/identities.json`, { identities: [] });
    };
    this.saveIdentities = async function (data) {
      await writeJson(`${this.root}/identities.json`, data);
    };
    this.identityIdFromDisplayName = function (displayName) {
      const text = String(displayName);
      let hash = 0;
      for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
      return `local_${hash.toString(16).padStart(8, "0")}`;
    };
    this.upsertIdentity = async function (displayName) {
      if (!displayName || !String(displayName).trim()) throw Object.assign(new Error("Display name is required."), { code: "invalid_input" });
      const identities = await this.loadIdentities();
      const id = this.identityIdFromDisplayName(displayName.trim());
      const now = new Date().toISOString();
      let identity = identities.identities.find((item) => item.id === id);
      if (!identity) {
        identity = { id, displayName: displayName.trim(), createdAt: now };
        identities.identities.push(identity);
        await this.saveIdentities(identities);
      }
      return identity;
    };
    this.getIdentity = async function (identityId) {
      const identities = await this.loadIdentities();
      return identities.identities.find((item) => item.id === identityId) || null;
    };
    this.sessionDir = function (sessionId) {
      return `${this.root}/sessions/${safeSessionId(sessionId)}`;
    };
    this.loadSession = async function (sessionId) {
      const dir = this.sessionDir(sessionId);
      const session = await readJson(`${dir}/session.json`, null);
      if (!session) return null;
      const participants = await readJson(`${dir}/participants.json`, { participants: [] });
      const messagesFile = `${dir}/messages.ndjson`;
      let messages = [];
      try {
        const fs = await import("node:fs/promises");
        const text = await fs.readFile(messagesFile, "utf8");
        messages = text.split("\n").filter(Boolean).map((line) => JSON.parse(line));
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
      return { session, participants: participants.participants || [], messages };
    };
    this.createSession = async function (identity) {
      const fs = await import("node:fs/promises");
      const sessionId = `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 8)}`;
      const dir = this.sessionDir(sessionId);
      await ensureDir(dir);
      const now = new Date().toISOString();
      const session = { id: sessionId, state: "lobby", createdBy: identity.id, createdAt: now };
      await writeJson(`${dir}/session.json`, session);
      await writeJson(`${dir}/participants.json`, { participants: [{ identityId: identity.id, displayName: identity.displayName, role: "player", joinedAt: now }] });
      await fs.writeFile(`${dir}/messages.ndjson`, "", "utf8");
      return session;
    };
    this.joinSession = async function (sessionId, identity) {
      const dir = this.sessionDir(sessionId);
      const current = await this.loadSession(sessionId);
      if (!current) return null;
      if (!current.participants.some((p) => p.identityId === identity.id)) {
        current.participants.push({ identityId: identity.id, displayName: identity.displayName, role: "player", joinedAt: new Date().toISOString() });
        await writeJson(`${dir}/participants.json`, { participants: current.participants });
      }
      return current.session;
    };
    this.appendMessage = async function (sessionId, message) {
      const fs = await import("node:fs/promises");
      const dir = this.sessionDir(sessionId);
      await ensureDir(dir);
      const line = `${JSON.stringify(message)}\n`;
      await fs.appendFile(`${dir}/messages.ndjson`, line, "utf8");
    };
    this.listMessages = async function (sessionId) {
      const current = await this.loadSession(sessionId);
      return current ? current.messages : null;
    };
  }
}
