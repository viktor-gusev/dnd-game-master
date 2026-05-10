// @ts-check

import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

function safeSessionId(sessionId) {
  if (typeof sessionId !== "string" || !/^[a-zA-Z0-9_-]+$/.test(sessionId)) {
    throw Object.assign(new Error("Invalid session id."), { code: "invalid_session_id" });
  }
  return sessionId;
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJson(file, value) {
  await ensureDir(path.dirname(file));
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await fs.rename(temp, file);
}

export default class Dnd_Gm_Store_File_Data {
  constructor() {
    this.root = process.env.DND_GM_DATA_ROOT || path.join(process.cwd(), "var", "data");
  }

  async init() {
    await ensureDir(this.root);
    await ensureDir(path.join(this.root, "sessions"));
  }

  async loadIdentities() {
    await this.init();
    return readJson(path.join(this.root, "identities.json"), { identities: [] });
  }

  async saveIdentities(data) {
    await writeJson(path.join(this.root, "identities.json"), data);
  }

  identityIdFromDisplayName(displayName) {
    return `local_${crypto.createHash("sha1").update(String(displayName)).digest("hex").slice(0, 12)}`;
  }

  async upsertIdentity(displayName) {
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
  }

  async getIdentity(identityId) {
    const identities = await this.loadIdentities();
    return identities.identities.find((item) => item.id === identityId) || null;
  }

  sessionDir(sessionId) {
    return path.join(this.root, "sessions", safeSessionId(sessionId));
  }

  async loadSession(sessionId) {
    const dir = this.sessionDir(sessionId);
    const session = await readJson(path.join(dir, "session.json"), null);
    if (!session) return null;
    const participants = await readJson(path.join(dir, "participants.json"), { participants: [] });
    const messagesFile = path.join(dir, "messages.ndjson");
    let messages = [];
    try {
      const text = await fs.readFile(messagesFile, "utf8");
      messages = text.split("\n").filter(Boolean).map((line) => JSON.parse(line));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    return { session, participants: participants.participants || [], messages };
  }

  async createSession(identity) {
    const sessionId = crypto.randomBytes(6).toString("hex");
    const dir = this.sessionDir(sessionId);
    await ensureDir(dir);
    const now = new Date().toISOString();
    const session = { id: sessionId, state: "lobby", createdBy: identity.id, createdAt: now };
    await writeJson(path.join(dir, "session.json"), session);
    await writeJson(path.join(dir, "participants.json"), { participants: [{ identityId: identity.id, displayName: identity.displayName, role: "player", joinedAt: now }] });
    await fs.writeFile(path.join(dir, "messages.ndjson"), "", "utf8");
    return session;
  }

  async joinSession(sessionId, identity) {
    const dir = this.sessionDir(sessionId);
    const current = await this.loadSession(sessionId);
    if (!current) return null;
    if (!current.participants.some((p) => p.identityId === identity.id)) {
      current.participants.push({ identityId: identity.id, displayName: identity.displayName, role: "player", joinedAt: new Date().toISOString() });
      await writeJson(path.join(dir, "participants.json"), { participants: current.participants });
    }
    return current.session;
  }

  async appendMessage(sessionId, message) {
    const dir = this.sessionDir(sessionId);
    await ensureDir(dir);
    const line = `${JSON.stringify(message)}\n`;
    await fs.appendFile(path.join(dir, "messages.ndjson"), line, "utf8");
  }

  async listMessages(sessionId) {
    const current = await this.loadSession(sessionId);
    return current ? current.messages : null;
  }
}

export const __deps__ = Object.freeze({});
