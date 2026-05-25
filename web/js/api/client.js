import { createApiErrorConsoleSummary } from "../Diagnostics/ApiErrorSummary.mjs";

function logApiFailure({ operation, method, path, status, errorCode, errorMessage }) {
  console.error("API request failed.", createApiErrorConsoleSummary({
    operation,
    method,
    path,
    status,
    errorCode,
    errorMessage,
  }));
}

export function createApiClient({
  fetchImpl = globalThis.fetch,
  getIdentity = () => null,
} = {}) {
  return async function api(path, options = {}) {
    const { operation, ...fetchOptions } = options;
    const method = fetchOptions.method || "GET";
    const headers = new Headers(fetchOptions.headers || {});
    const identity = getIdentity();

    if (fetchOptions.body && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    if (identity?.uuid && path !== "/api/identity/local") {
      headers.set("x-local-identity-id", identity.uuid);
    }

    try {
      const response = await fetchImpl(path, { ...fetchOptions, method, headers });
      const contentType = response.headers.get("content-type") || "";
      if (!contentType.includes("application/json")) {
        const error = { message: "Unexpected API response." };
        logApiFailure({ operation, method, path, status: response.status, errorMessage: error.message });
        return { ok: false, error };
      }

      const data = await response.json();
      if (!response.ok || !data?.ok) {
        logApiFailure({
          operation,
          method,
          path,
          status: response.status,
          errorCode: data?.error?.code,
          errorMessage: data?.error?.message,
        });
      }
      return data;
    } catch {
      const error = { message: "Request failed." };
      logApiFailure({ operation, method, path, errorMessage: error.message });
      return { ok: false, error };
    }
  };
}
