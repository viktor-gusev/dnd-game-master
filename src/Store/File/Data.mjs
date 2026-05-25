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

function normalizeUuid(uuid) {
  if (typeof uuid !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid.trim())) {
    throw Object.assign(new Error("Local identity uuid is invalid."), { code: "invalid_input" });
  }
  return uuid.trim().toLowerCase();
}

function normalizeNickname(nickname) {
  if (!nickname || !String(nickname).trim()) {
    throw Object.assign(new Error("Local identity nickname is required."), { code: "invalid_input" });
  }
  return String(nickname).trim();
}

function deriveJoinable(state) {
  return state !== "completed";
}

const RETENTION_WINDOW_MS = 10 * 24 * 60 * 60 * 1000;

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
  constructor({ now = () => new Date() } = {}) {
    this.root = process.env.DND_GM_DATA_ROOT || `${process.cwd()}/var/data`;
    this.now = now;

    this.currentTimestamp = function () {
      return this.now().toISOString();
    };

    this.markSessionActivity = function (session, timestamp = this.currentTimestamp()) {
      session.updatedAt = timestamp;
      session.lastActivityAt = timestamp;
      return session;
    };

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

    this.upsertIdentity = async function (uuid, nickname) {
      const normalizedUuid = normalizeUuid(uuid);
      const normalizedNickname = normalizeNickname(nickname);
      const identities = await this.loadIdentities();
      const now = new Date().toISOString();
      let identity = identities.identities.find((item) => item.id === normalizedUuid);

      if (!identity) {
        identity = {
          id: normalizedUuid,
          uuid: normalizedUuid,
          nickname: normalizedNickname,
          displayName: normalizedNickname,
          createdAt: now,
          updatedAt: now,
        };
        identities.identities.push(identity);
      } else {
        identity.nickname = normalizedNickname;
        identity.displayName = normalizedNickname;
        identity.updatedAt = now;
      }

      await this.saveIdentities(identities);
      return identity;
    };

    this.getIdentity = async function (identityId) {
      const normalizedUuid = normalizeUuid(identityId);
      const identities = await this.loadIdentities();
      return identities.identities.find((item) => item.id === normalizedUuid) || null;
    };

    this.sessionDir = function (sessionId) {
      return `${this.root}/sessions/${safeSessionId(sessionId)}`;
    };

    this.readSessionFiles = async function (sessionId) {
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
      return { dir, session, participants: participants.participants || [], messages };
    };

    this.summarizeSession = function (session, participants, currentIdentityId = "") {
      const gmParticipant = participants.find((participant) => participant.identityId === session.gm?.uuid);
      const gm = session.gm || {
        uuid: gmParticipant?.identityId || "",
        nickname: gmParticipant?.nickname || gmParticipant?.displayName || "Unknown",
      };
      return {
        id: session.id || session.sessionId,
        sessionId: session.sessionId || session.id,
        title: session.title,
        state: session.state,
        gm,
        participantCount: participants.length,
        joinable: deriveJoinable(session.state),
        currentUserParticipant: !!currentIdentityId && participants.some((participant) => participant.identityId === currentIdentityId),
        createdAt: session.createdAt,
        updatedAt: session.updatedAt || session.lastActivityAt || session.createdAt,
        lastActivityAt: session.lastActivityAt || session.updatedAt || session.createdAt,
      };
    };

    this.loadSession = async function (sessionId, currentIdentityId = "") {
      const current = await this.readSessionFiles(sessionId);
      if (!current) return null;
      const participantByIdentityId = new Map(current.participants.map((participant) => [participant.identityId, participant]));
      const normalizedMessages = current.messages.map((message) => {
        const participant = participantByIdentityId.get(message.identityId);
        const displayName = message.displayName || message.nickname || participant?.displayName || participant?.nickname || message.identityId;
        return { ...message, displayName };
      });
      return {
        session: this.summarizeSession(current.session, current.participants, currentIdentityId),
        participants: current.participants,
        messages: normalizedMessages,
      };
    };

    this.listSessions = async function (currentIdentityId = "") {
      await this.init();
      const fs = await import("node:fs/promises");
      const dir = `${this.root}/sessions`;
      const entries = await fs.readdir(dir, { withFileTypes: true }).catch((error) => {
        if (error?.code === "ENOENT") return [];
        throw error;
      });
      const sessions = [];

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const current = await this.readSessionFiles(entry.name);
        if (!current) continue;
        sessions.push(this.summarizeSession(current.session, current.participants, currentIdentityId));
      }

      sessions.sort((first, second) => String(second.updatedAt || "").localeCompare(String(first.updatedAt || "")));
      return sessions;
    };

    this.createSession = async function (identity, { title = "" } = {}) {
      const fs = await import("node:fs/promises");
      const sessionId = `${Date.now().toString(16)}${Math.random().toString(16).slice(2, 8)}`;
      const dir = this.sessionDir(sessionId);
      await ensureDir(dir);
      const now = this.currentTimestamp();
      const normalizedTitle = String(title || "").trim() || `Session ${sessionId.slice(0, 6)}`;
      const session = this.markSessionActivity({
        id: sessionId,
        sessionId,
        title: normalizedTitle,
        state: "lobby",
        gm: {
          uuid: identity.id,
          nickname: identity.nickname,
        },
        createdBy: identity.id,
        createdAt: now,
      }, now);
      const participants = {
        participants: [
          {
            identityId: identity.id,
            uuid: identity.id,
            nickname: identity.nickname,
            displayName: identity.nickname,
            role: "game_master",
            joinedAt: now,
          },
        ],
      };
      await writeJson(`${dir}/session.json`, session);
      await writeJson(`${dir}/participants.json`, participants);
      await fs.writeFile(`${dir}/messages.ndjson`, "", "utf8");
      return this.loadSession(sessionId, identity.id);
    };

    this.joinSession = async function (sessionId, identity) {
      const current = await this.readSessionFiles(sessionId);
      if (!current) return null;
      if (!deriveJoinable(current.session.state)) {
        throw Object.assign(new Error("Session is not joinable."), { code: "invalid_input" });
      }
      const alreadyParticipant = current.participants.some((participant) => participant.identityId === identity.id);
      if (!alreadyParticipant) {
        const joinedAt = this.currentTimestamp();
        current.participants.push({
          identityId: identity.id,
          uuid: identity.id,
          nickname: identity.nickname,
          displayName: identity.nickname,
          role: "player",
          joinedAt,
        });
        await writeJson(`${current.dir}/participants.json`, { participants: current.participants });
        this.markSessionActivity(current.session, joinedAt);
        await writeJson(`${current.dir}/session.json`, current.session);
      }
      return this.loadSession(sessionId, identity.id);
    };

    this.appendMessage = async function (sessionId, message) {
      const fs = await import("node:fs/promises");
      const current = await this.readSessionFiles(sessionId);
      if (!current) throw Object.assign(new Error("Unknown session id."), { code: "unknown_session" });
      const line = `${JSON.stringify(message)}\n`;
      await fs.appendFile(`${current.dir}/messages.ndjson`, line, "utf8");
      this.markSessionActivity(current.session, message.createdAt || this.currentTimestamp());
      await writeJson(`${current.dir}/session.json`, current.session);
    };

    this.listMessages = async function (sessionId, currentIdentityId = "") {
      const current = await this.loadSession(sessionId, currentIdentityId);
      return current ? current.messages : null;
    };

    this.deleteSession = async function (sessionId) {
      const fs = await import("node:fs/promises");
      const dir = this.sessionDir(sessionId);
      const current = await this.readSessionFiles(sessionId);
      if (!current) return false;
      await fs.rm(dir, { recursive: true, force: true });
      return true;
    };

    this.cleanupExpiredSessions = async function () {
      const fs = await import("node:fs/promises");
      await this.init();
      const sessionsRoot = `${this.root}/sessions`;
      const entries = await fs.readdir(sessionsRoot, { withFileTypes: true }).catch((error) => {
        if (error?.code === "ENOENT") return [];
        throw error;
      });
      const removedSessionIds = [];
      const nowMs = this.now().getTime();

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const dir = `${sessionsRoot}/${entry.name}`;
        let shouldDelete = false;

        try {
          const session = await readJson(`${dir}/session.json`, null);
          const lastActivityAt = session?.lastActivityAt;
          const lastActivityMs = typeof lastActivityAt === "string" ? Date.parse(lastActivityAt) : Number.NaN;
          shouldDelete = !session || !Number.isFinite(lastActivityMs) || (nowMs - lastActivityMs > RETENTION_WINDOW_MS);
        } catch {
          shouldDelete = true;
        }

        if (!shouldDelete) continue;
        await fs.rm(dir, { recursive: true, force: true });
        removedSessionIds.push(entry.name);
      }

      return removedSessionIds;
    };
  }
}
