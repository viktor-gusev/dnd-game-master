import test from "node:test";
import assert from "node:assert/strict";

import { createApiErrorConsoleSummary } from "../../../../../web/js/Diagnostics/ApiErrorSummary.mjs";

test("ApiErrorSummary builds a safe bounded summary for console.error logging", () => {
  const summary = createApiErrorConsoleSummary({
    operation: "load-messages",
    method: "get",
    path: "https://example.test/api/sessions/session-123/messages?token=alpha#details",
    status: 400,
    errorCode: "SESSION_NOT_FOUND",
    errorMessage: "Unexpected API response.",
  });

  assert.deepEqual(summary, {
    operation: "load-messages",
    method: "GET",
    path: "/api/sessions/[session-id]/messages",
    status: 400,
    errorCode: "SESSION_NOT_FOUND",
    errorMessage: "Unexpected API response.",
  });
});
