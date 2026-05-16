function sanitizePath(path) {
  if (!path) return "";

  let pathname = String(path);
  try {
    pathname = new URL(pathname, "https://diagnostics.local").pathname;
  } catch {
    pathname = pathname.split("#", 1)[0].split("?", 1)[0];
  }

  return pathname.replace(/(\/api\/sessions\/)[^/]+/g, "$1[session-id]");
}

export function createApiErrorConsoleSummary({
  operation,
  method = "GET",
  path,
  status,
  errorCode,
  errorMessage,
} = {}) {
  const summary = {
    operation: operation || "api-request-failed",
    method: String(method).toUpperCase(),
  };

  const safePath = sanitizePath(path);
  if (safePath) summary.path = safePath;
  if (Number.isInteger(status)) summary.status = status;
  if (errorCode) summary.errorCode = String(errorCode);
  if (errorMessage) summary.errorMessage = String(errorMessage);

  return summary;
}
