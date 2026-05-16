const ALLOWED_SOURCE_TYPES = new Set(["window-error", "unhandled-rejection", "console-error"]);
const MAX_MESSAGE_LENGTH = 240;
const MAX_SOURCE_URL_LENGTH = 300;
const MAX_STACK_LENGTH = 2000;
const MAX_DETAILS_LENGTH = 1200;
const MAX_STRING_LENGTH = 160;
const MAX_DEPTH = 2;
const MAX_ARRAY_ITEMS = 5;
const MAX_OBJECT_KEYS = 6;

function redactSensitiveText(text) {
  return String(text)
    .replace(/\bBearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(/\b(token)=([^&\s]+)/gi, "$1=[REDACTED]")
    .replace(/\b(access_token)=([^&\s]+)/gi, "$1=[REDACTED]")
    .replace(/\b(password)=([^&\s]+)/gi, "$1=[REDACTED]")
    .replace(/\b(secret)=([^&\s]+)/gi, "$1=[REDACTED]")
    .replace(/\b(authorization\s*:\s*)([^\n\r]+)/gi, "$1[REDACTED]")
    .replace(/\b(cookie\s*:\s*)([^\n\r]+)/gi, "$1[REDACTED]");
}

function limitText(text, maxLength) {
  const safe = redactSensitiveText(text);
  if (safe.length <= maxLength) return safe;
  return `${safe.slice(0, maxLength - 14)}… [truncated]`;
}

function summarizeValue(value, depth = MAX_DEPTH, seen = new WeakSet()) {
  if (value === null) return "null";
  if (value === undefined) return "undefined";

  const valueType = typeof value;
  if (valueType === "string") return limitText(value, MAX_STRING_LENGTH);
  if ((valueType === "number") || (valueType === "boolean") || (valueType === "bigint")) return String(value);
  if (valueType === "symbol") return String(value);
  if (valueType === "function") return value.name ? `[Function ${value.name}]` : "[Function]";

  if (value instanceof Error) {
    const label = `${value.name || "Error"}: ${value.message || ""}`.trim();
    return limitText(label, MAX_DETAILS_LENGTH);
  }

  if (depth <= 0) {
    return Array.isArray(value) ? `[Array(${value.length})]` : "[Object]";
  }

  if (seen.has(value)) return "[Circular]";
  seen.add(value);

  try {
    if (Array.isArray(value)) {
      const items = value.slice(0, MAX_ARRAY_ITEMS).map((item) => summarizeValue(item, depth - 1, seen));
      if (value.length > MAX_ARRAY_ITEMS) items.push(`… ${value.length - MAX_ARRAY_ITEMS} more`);
      return limitText(`[${items.join(", ")}]`, MAX_DETAILS_LENGTH);
    }

    const keys = Object.keys(value).sort().slice(0, MAX_OBJECT_KEYS);
    const parts = keys.map((key) => `${key}: ${summarizeValue(value[key], depth - 1, seen)}`);
    if (Object.keys(value).length > MAX_OBJECT_KEYS) parts.push("…");
    return limitText(`{${parts.join(", ")}}`, MAX_DETAILS_LENGTH);
  } catch {
    return "[Unserializable]";
  } finally {
    seen.delete(value);
  }
}

function toFiniteNumber(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return value;
}

function createRecord(fields) {
  const record = {
    timestamp: new Date().toISOString(),
    sourceType: fields.sourceType,
    message: limitText(fields.message || "Unknown error", MAX_MESSAGE_LENGTH),
  };

  if (!ALLOWED_SOURCE_TYPES.has(record.sourceType)) {
    throw new Error(`Unsupported source type: ${fields.sourceType}`);
  }

  if (fields.sourceUrl) record.sourceUrl = limitText(fields.sourceUrl, MAX_SOURCE_URL_LENGTH);
  if (fields.lineNumber !== undefined) record.lineNumber = fields.lineNumber;
  if (fields.columnNumber !== undefined) record.columnNumber = fields.columnNumber;
  if (fields.stackText) record.stackText = limitText(fields.stackText, MAX_STACK_LENGTH);
  if (fields.details) record.details = limitText(fields.details, MAX_DETAILS_LENGTH);

  return record;
}

export function summarizeWindowError(input = {}) {
  const error = input.error instanceof Error ? input.error : undefined;
  return createRecord({
    sourceType: "window-error",
    message: input.message || error?.message || summarizeValue(input.error || input),
    sourceUrl: input.filename || input.sourceUrl,
    lineNumber: toFiniteNumber(input.lineno ?? input.lineNumber),
    columnNumber: toFiniteNumber(input.colno ?? input.columnNumber),
    stackText: error?.stack,
    details: summarizeValue(input.error ?? {
      message: input.message,
      filename: input.filename,
      lineno: input.lineno,
      colno: input.colno,
    }),
  });
}

export function summarizeUnhandledRejection(input = {}) {
  const reason = input.reason;
  const error = reason instanceof Error ? reason : undefined;
  return createRecord({
    sourceType: "unhandled-rejection",
    message: error?.message || summarizeValue(reason),
    stackText: error?.stack,
    details: summarizeValue(reason),
  });
}

export function summarizeConsoleError(input = {}) {
  const args = Array.isArray(input.arguments) ? input.arguments : [];
  const firstError = args.find((item) => item instanceof Error);
  const fragments = args.map((item) => summarizeValue(item));
  const message = fragments.join(" ").trim() || "console.error called without arguments";
  return createRecord({
    sourceType: "console-error",
    message,
    stackText: firstError?.stack,
    details: fragments.join(" | "),
  });
}
