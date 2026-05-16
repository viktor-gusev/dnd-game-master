import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { ErrorRecordBuffer, normalizeMaxRecords } from "../../../../../web/js/Diagnostics/ErrorRecordBuffer.mjs";

test("ErrorRecordBuffer uses documented defaults and bounds", () => {
  const buffer = new ErrorRecordBuffer();

  assert.equal(buffer.maxRecords, 50);
  assert.equal(normalizeMaxRecords(1), 1);
  assert.equal(normalizeMaxRecords(200), 200);
  assert.equal(normalizeMaxRecords(0), 50);
  assert.equal(normalizeMaxRecords(201), 50);
  assert.equal(normalizeMaxRecords("nope"), 50);
});

test("ErrorRecordBuffer preserves insertion order, discards oldest overflow, and clears records", () => {
  const buffer = new ErrorRecordBuffer({ maxRecords: 2 });

  buffer.add({ message: "first" });
  buffer.add({ message: "second" });
  buffer.add({ message: "third" });

  assert.deepEqual(buffer.getRecords(), [
    { message: "second" },
    { message: "third" },
  ]);

  buffer.clear();
  assert.deepEqual(buffer.getRecords(), []);
});

test("ErrorRecordBuffer returns copies without exposing mutable internal state", () => {
  const buffer = new ErrorRecordBuffer({ maxRecords: 3 });

  buffer.add({ message: "original" });
  const records = buffer.getRecords();

  records[0].message = "changed";
  records.push({ message: "injected" });

  assert.deepEqual(buffer.getRecords(), [{ message: "original" }]);
});

test("ErrorRecordBuffer source avoids browser storage and backend transport APIs", async () => {
  const source = await readFile(new URL("../../../../../web/js/Diagnostics/ErrorRecordBuffer.mjs", import.meta.url), "utf8");

  assert.doesNotMatch(source, /localStorage|sessionStorage|IndexedDB|fetch|sendBeacon/);
});
