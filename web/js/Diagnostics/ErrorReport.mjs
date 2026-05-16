const REPORT_LIMIT = 12000;
const ALLOWED_FIELDS = [
  "timestamp",
  "sourceType",
  "message",
  "sourceUrl",
  "lineNumber",
  "columnNumber",
  "stackText",
  "details",
];

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

function sanitizeText(value) {
  if (value === null || value === undefined) return "";
  return redactSensitiveText(String(value));
}

function sanitizeUrl(url) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    parsed.search = "";
    parsed.hash = "";
    return sanitizeText(parsed.toString());
  } catch {
    return "";
  }
}

function formatRecord(record, index) {
  const lines = [`Record ${index + 1}`];
  for (const field of ALLOWED_FIELDS) {
    if (!(field in record)) continue;
    const value = record[field];
    if (value === undefined || value === null || value === "") continue;
    lines.push(`${field}: ${sanitizeText(value)}`);
  }
  return lines.join("\n");
}

function boundReport(text) {
  if (text.length <= REPORT_LIMIT) return text;
  return `${text.slice(0, REPORT_LIMIT - 27)}\n[report truncated]\n`;
}

export function createErrorReport({ copiedAt, records = [], url } = {}) {
  const lines = [
    "Developer diagnostics error report",
    `Copied at: ${sanitizeText(copiedAt || new Date().toISOString())}`,
  ];

  const safeUrl = sanitizeUrl(url);
  if (safeUrl) lines.push(`URL: ${safeUrl}`);

  lines.push(`Record count: ${records.length}`);

  const formattedRecords = records.map((record, index) => {
    const safeRecord = {};
    for (const field of ALLOWED_FIELDS) {
      if (!(field in record)) continue;
      safeRecord[field] = record[field];
    }
    return formatRecord(safeRecord, index);
  });

  if (formattedRecords.length > 0) {
    lines.push("");
    lines.push(formattedRecords.join("\n\n"));
  }

  return boundReport(lines.join("\n"));
}
