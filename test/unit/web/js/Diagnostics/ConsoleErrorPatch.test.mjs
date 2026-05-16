import test from "node:test";
import assert from "node:assert/strict";

import { installConsoleErrorPatch } from "../../../../../web/js/Diagnostics/ConsoleErrorPatch.mjs";

function createConsoleLike() {
  const calls = [];
  return {
    calls,
    error(...args) {
      calls.push(["error", args]);
    },
    log() {
      calls.push(["log"]);
    },
    info() {
      calls.push(["info"]);
    },
    warn() {
      calls.push(["warn"]);
    },
  };
}

test("ConsoleErrorPatch preserves original console.error behavior and sends a safe summary to onError", () => {
  const consoleObject = createConsoleLike();
  const summaries = [];

  const restore = installConsoleErrorPatch({
    consoleObject,
    onError(summary) {
      summaries.push(summary);
    },
  });

  const originalLog = consoleObject.log;
  const originalInfo = consoleObject.info;
  const originalWarn = consoleObject.warn;
  const error = new Error("authorization: Bearer abc");

  consoleObject.error("failure", error, { token: "token=alpha" });

  assert.deepEqual(consoleObject.calls[0][0], "error");
  assert.deepEqual(consoleObject.calls[0][1], ["failure", error, { token: "token=alpha" }]);
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].sourceType, "console-error");
  assert.equal(typeof summaries[0].message, "string");
  assert.match(summaries[0].message, /failure/);
  assert.match(summaries[0].details, /authorization: \[REDACTED\]/i);
  assert.equal(consoleObject.log, originalLog);
  assert.equal(consoleObject.info, originalInfo);
  assert.equal(consoleObject.warn, originalWarn);

  restore();
});

test("ConsoleErrorPatch prevents duplicate wrapping and restore is safe to repeat", () => {
  const consoleObject = createConsoleLike();
  const firstOriginal = consoleObject.error;
  let callCount = 0;

  const restoreA = installConsoleErrorPatch({
    consoleObject,
    onError() {
      callCount += 1;
    },
  });
  const wrappedError = consoleObject.error;
  const restoreB = installConsoleErrorPatch({
    consoleObject,
    onError() {
      callCount += 100;
    },
  });

  assert.notEqual(wrappedError, firstOriginal);
  assert.equal(consoleObject.error, wrappedError);

  consoleObject.error("once");
  assert.equal(callCount, 1);

  restoreB();
  assert.equal(consoleObject.error, firstOriginal);

  restoreA();
  restoreA();
  assert.equal(consoleObject.error, firstOriginal);
});
