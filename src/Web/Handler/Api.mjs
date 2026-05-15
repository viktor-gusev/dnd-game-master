// @ts-check

/**
 * @namespace Dnd_Gm_Web_Handler_Api
 * @description HTTP API handler for the application.
 */

function json(res, status, body) {
  if (!res.writableEnded) {
    res.statusCode = status;
    res.setHeader("content-type", "application/json; charset=utf-8");
    res.end(JSON.stringify(body));
  }
}

function error(code, message) {
  return { ok: false, error: { code, message } };
}

function success(data) {
  return { ok: true, data };
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw Object.assign(new Error("Invalid JSON body."), { code: "invalid_json" });
  }
}

export default class Dnd_Gm_Web_Handler_Api {
  constructor({ dataStore }) {
    this.dataStore = dataStore;
    this.getRegistrationInfo = () => ({ name: this.constructor.name, stage: "PROCESS" });

    this.postLocalIdentity = async (req, res, context) => {
      const body = await readBody(req);
      const identity = await this.dataStore.upsertIdentity(body.displayName);
      context.complete();
      json(res, 200, success({ identityId: identity.id, displayName: identity.displayName }));
    };

    this.getCurrentIdentity = async (req, res, context) => {
      const identityId = req.headers["x-local-identity-id"];
      if (!identityId) throw Object.assign(new Error("Missing local identity id."), { code: "missing_identity" });
      const identity = await this.dataStore.getIdentity(identityId);
      if (!identity) throw Object.assign(new Error("Unknown local identity id."), { code: "unknown_identity" });
      context.complete();
      json(res, 200, success({ identity }));
    };

    this.createSession = async (req, res, context) => {
      const identityId = req.headers["x-local-identity-id"];
      if (!identityId) throw Object.assign(new Error("Missing local identity id."), { code: "missing_identity" });
      const identity = await this.dataStore.getIdentity(identityId);
      if (!identity) throw Object.assign(new Error("Unknown local identity id."), { code: "unknown_identity" });
      const session = await this.dataStore.createSession(identity);
      context.complete();
      json(res, 200, success({ sessionId: session.id, session }));
    };

    this.getSession = async (sessionId, res, context) => {
      const current = await this.dataStore.loadSession(sessionId);
      if (!current) throw Object.assign(new Error("Unknown session id."), { code: "unknown_session" });
      context.complete();
      json(res, 200, success({ session: current.session, participants: current.participants }));
    };

    this.joinSession = async (sessionId, req, res, context) => {
      const identityId = req.headers["x-local-identity-id"];
      if (!identityId) throw Object.assign(new Error("Missing local identity id."), { code: "missing_identity" });
      const identity = await this.dataStore.getIdentity(identityId);
      if (!identity) throw Object.assign(new Error("Unknown local identity id."), { code: "unknown_identity" });
      const session = await this.dataStore.joinSession(sessionId, identity);
      if (!session) throw Object.assign(new Error("Unknown session id."), { code: "unknown_session" });
      context.complete();
      json(res, 200, success({ sessionId: session.id, joined: true }));
    };

    this.postMessage = async (sessionId, req, res, context) => {
      const crypto = await import("node:crypto");
      const identityId = req.headers["x-local-identity-id"];
      if (!identityId) throw Object.assign(new Error("Missing local identity id."), { code: "missing_identity" });
      const identity = await this.dataStore.getIdentity(identityId);
      if (!identity) throw Object.assign(new Error("Unknown local identity id."), { code: "unknown_identity" });
      const current = await this.dataStore.loadSession(sessionId);
      if (!current) throw Object.assign(new Error("Unknown session id."), { code: "unknown_session" });
      if (!current.participants.some((p) => p.identityId === identity.id)) throw Object.assign(new Error("Identity is not a session participant."), { code: "invalid_input" });
      const body = await readBody(req);
      if (!body.text || !String(body.text).trim()) throw Object.assign(new Error("Message text is required."), { code: "invalid_input" });
      const message = {
        id: `msg_${crypto.randomBytes(6).toString("hex")}`,
        sessionId,
        identityId: identity.id,
        type: body.type || "player_action",
        text: String(body.text).trim(),
        createdAt: new Date().toISOString(),
      };
      await this.dataStore.appendMessage(sessionId, message);
      context.complete();
      json(res, 200, success({ message }));
    };

    this.getMessages = async (sessionId, res, context) => {
      const current = await this.dataStore.loadSession(sessionId);
      if (!current) throw Object.assign(new Error("Unknown session id."), { code: "unknown_session" });
      context.complete();
      json(res, 200, success({ messages: current.messages }));
    };

    this.handle = async (context) => {
      const req = context.request;
      const res = context.response;
      const url = new URL(req.url, "http://localhost");
      const method = req.method || "GET";
      try {
        if (url.pathname === "/api/identity/local" && method === "POST") return await this.postLocalIdentity(req, res, context);
        if (url.pathname === "/api/identity/current" && method === "GET") return await this.getCurrentIdentity(req, res, context);
        if (url.pathname === "/api/sessions" && method === "POST") return await this.createSession(req, res, context);
        const sessionMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)(?:\/(join|messages))?$/);
        if (sessionMatch) {
          const sessionId = sessionMatch[1];
          const action = sessionMatch[2] || null;
          if (action === null && method === "GET") return await this.getSession(sessionId, res, context);
          if (action === "join" && method === "POST") return await this.joinSession(sessionId, req, res, context);
          if (action === "messages" && method === "POST") return await this.postMessage(sessionId, req, res, context);
          if (action === "messages" && method === "GET") return await this.getMessages(sessionId, res, context);
        }
        if (url.pathname.startsWith("/api/")) {
          context.complete();
          return json(res, 404, error("not_found", "Not found."));
        }
        return;
      } catch (err) {
        if (err?.code === "invalid_json") return json(res, 400, error("invalid_json", "Invalid JSON body."));
        if (err?.code === "invalid_session_id") return json(res, 400, error("invalid_session_id", "Invalid session id."));
        if (err?.code === "invalid_input") return json(res, 400, error("invalid_input", err.message));
        if (err?.code === "missing_identity") return json(res, 400, error("missing_identity", "Missing local identity id."));
        if (err?.code === "unknown_identity") return json(res, 400, error("unknown_identity", "Unknown local identity id."));
        if (err?.code === "unknown_session") return json(res, 404, error("unknown_session", "Unknown session id."));
        return json(res, 500, error("internal_error", "Internal server error."));
      }
    };
  }
}

export const __deps__ = Object.freeze({
  dataStore: "Dnd_Gm_Store_File_Data$",
});
