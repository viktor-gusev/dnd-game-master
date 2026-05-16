import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const moduleUrl = new URL("../../../../../web/wc/DeveloperDiagnostics/ErrorPanel.mjs", import.meta.url);
const htmlUrl = new URL("../../../../../web/wc/DeveloperDiagnostics/ErrorPanel.html", import.meta.url);
const cssUrl = new URL("../../../../../web/wc/DeveloperDiagnostics/ErrorPanel.css", import.meta.url);

test("ErrorPanel source artifacts exist", async () => {
  await access(moduleUrl);
  await access(htmlUrl);
  await access(cssUrl);
});

test("ErrorPanel source uses guarded custom element registration and Diagnostics helpers", async () => {
  const source = await readFile(moduleUrl, "utf8");

  assert.match(source, /customElements\.get\(TAG_NAME\)/);
  assert.match(source, /customElements\.define\(TAG_NAME,\s*DeveloperDiagnosticsErrorPanel\)/);
  assert.match(source, /dgm-dev-error-panel/);
  assert.match(source, /attachShadow\(\{\s*mode:\s*"open"\s*\}\)/);
  assert.match(source, /"\.\.\/\.\.\/js\/Diagnostics\/ErrorRecordBuffer\.mjs"/);
  assert.match(source, /"\.\.\/\.\.\/js\/Diagnostics\/ErrorSummary\.mjs"/);
  assert.match(source, /"\.\.\/\.\.\/js\/Diagnostics\/ErrorReport\.mjs"/);
  assert.match(source, /"\.\.\/\.\.\/js\/Diagnostics\/ConsoleErrorPatch\.mjs"/);
});

test("ErrorPanel styles keep the open panel content scrollable", async () => {
  const source = await readFile(cssUrl, "utf8");

  assert.match(source, /--panel-viewport-inset:\s*12px/);
  assert.match(source, /left:\s*var\(--panel-safe-left\);[\s\S]*right:\s*var\(--panel-safe-right\);/);
  assert.match(source, /\.panel\s*\{[\s\S]*width:\s*auto;[\s\S]*max-width:\s*none;[\s\S]*max-height:/);
  assert.match(source, /\.panel\[hidden\]\s*\{[\s\S]*display:\s*none;/);
  assert.match(source, /\.content\s*\{[\s\S]*min-height:\s*0;[\s\S]*overflow:\s*hidden;/);
  assert.match(source, /\.records,\s*\.details\s*\{[\s\S]*overscroll-behavior:\s*contain;[\s\S]*overflow:\s*auto;/);
  assert.match(source, /grid-template-rows:\s*minmax\(0,\s*1fr\)\s*minmax\(0,\s*1fr\)/);
  assert.match(source, /\.record-message,\s*\.record-meta\s*\{[\s\S]*overflow-wrap:\s*anywhere;/);
  assert.match(source, /\.details\s*\{[\s\S]*overflow-wrap:\s*anywhere;[\s\S]*white-space:\s*pre-wrap;/);
});
