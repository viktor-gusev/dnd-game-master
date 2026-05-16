import test from "node:test";
import assert from "node:assert/strict";

import {
  summarizeConsoleError,
  summarizeUnhandledRejection,
  summarizeWindowError,
} from "../../../../../web/js/Diagnostics/ErrorSummary.mjs";

const allowedKeys = new Set([
  "timestamp",
  "sourceType",
  "message",
  "sourceUrl",
  "lineNumber",
  "columnNumber",
  "stackText",
  "details",
]);

function assertAllowedFields(record) {
  for (const [key, value] of Object.entries(record)) {
    assert.ok(allowedKeys.has(key), `Unexpected field: ${key}`);
    assert.ok(
      (value === undefined) || ["string", "number"].includes(typeof value),
      `Unexpected field type for ${key}`,
    );
  }
}

test("ErrorSummary returns documented safe fields for window-error, unhandled-rejection, and console-error", () => {
  const windowRecord = summarizeWindowError({
    message: "Window exploded",
    filename: "https://example.test/app.js",
    lineno: 9,
    colno: 3,
    error: new Error("Window exploded"),
  });
  const rejectionRecord = summarizeUnhandledRejection({
    reason: new Error("Promise rejected"),
  });
  const consoleRecord = summarizeConsoleError({
    arguments: ["Console issue", { cause: "network" }],
  });

  assert.equal(windowRecord.sourceType, "window-error");
  assert.equal(rejectionRecord.sourceType, "unhandled-rejection");
  assert.equal(consoleRecord.sourceType, "console-error");
  assertAllowedFields(windowRecord);
  assertAllowedFields(rejectionRecord);
  assertAllowedFields(consoleRecord);
});

test("ErrorSummary does not retain arbitrary objects and handles circular and deep inputs", () => {
  const circular = { label: "root" };
  circular.self = circular;
  circular.deep = { nested: { hidden: "value" } };

  const record = summarizeUnhandledRejection({ reason: circular });

  circular.label = "mutated";

  assert.equal(typeof record.details, "string");
  assert.match(record.details, /\[Circular\]|\[Object\]/);
  assert.doesNotMatch(record.details, /mutated/);
  assertAllowedFields(record);
});

test("ErrorSummary bounds long strings, hides function bodies, handles mixed inputs, and redacts common sensitive text", () => {
  function sampleFunction() {
    return "password=secret";
  }

  const veryLong = `Bearer abcdefghijklmnopqrstuvwxyz ${"x".repeat(500)}`;
  const record = summarizeConsoleError({
    arguments: [
      veryLong,
      sampleFunction,
      null,
      undefined,
      42,
      false,
      Symbol("token"),
      ["token=alpha", { authorization: "authorization: hidden" }],
    ],
  });

  assert.ok(record.message.length < 260);
  assert.ok(record.details.length < 1220);
  assert.match(record.message, /\[Function sampleFunction\]/);
  assert.doesNotMatch(record.details, /return "password=secret"/);
  assert.doesNotMatch(record.message, /Bearer abcdefghijklmnopqrstuvwxyz/);
  assert.match(record.message, /Bearer \[REDACTED\]/);
  assert.match(record.details, /token=\[REDACTED\]/);
  assert.match(record.details, /authorization: \[REDACTED\]/i);
  assertAllowedFields(record);
});
