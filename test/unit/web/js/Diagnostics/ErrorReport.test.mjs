import test from "node:test";
import assert from "node:assert/strict";

import { createErrorReport } from "../../../../../web/js/Diagnostics/ErrorReport.mjs";

test("ErrorReport creates plain text from current records with copy timestamp and sanitized URL", () => {
  const report = createErrorReport({
    copiedAt: "2026-05-16T12:00:00.000Z",
    url: "https://example.test/play?token=alpha#chat",
    records: [{
      timestamp: "2026-05-16T11:59:00.000Z",
      sourceType: "console-error",
      message: "authorization: Bearer abc",
      sourceUrl: "https://example.test/app.js",
      lineNumber: 12,
      columnNumber: 7,
      stackText: "Error: boom",
      details: "token=alpha",
    }],
  });

  assert.equal(typeof report, "string");
  assert.match(report, /Copied at: 2026-05-16T12:00:00.000Z/);
  assert.match(report, /URL: https:\/\/example\.test\/play/);
  assert.doesNotMatch(report, /\?token=alpha|#chat/);
  assert.match(report, /sourceType: console-error/);
  assert.match(report, /authorization: \[REDACTED\]/i);
  assert.match(report, /token=\[REDACTED\]/);
});

test("ErrorReport omits URL when absent, uses whitelisted fields only, and excludes forbidden extras", () => {
  const report = createErrorReport({
    copiedAt: "2026-05-16T12:00:00.000Z",
    records: [{
      timestamp: "2026-05-16T11:59:00.000Z",
      sourceType: "window-error",
      message: "boom",
      details: "cookie: abc",
      playerDisplayName: "Alice",
      cookies: "abc",
      localStorageDump: "{bad:true}",
    }],
  });

  assert.doesNotMatch(report, /^URL:/m);
  assert.match(report, /message: boom/);
  assert.match(report, /cookie: \[REDACTED\]/i);
  assert.doesNotMatch(report, /playerDisplayName|localStorageDump|cookies: abc/);
});

test("ErrorReport remains size-bounded", () => {
  const report = createErrorReport({
    copiedAt: "2026-05-16T12:00:00.000Z",
    records: [{
      timestamp: "2026-05-16T11:59:00.000Z",
      sourceType: "console-error",
      message: "boom",
      details: "x".repeat(20000),
    }],
  });

  assert.ok(report.length <= 12000);
  assert.match(report, /\[report truncated\]/);
});
