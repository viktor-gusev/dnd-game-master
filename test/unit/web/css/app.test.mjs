import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const cssUrl = new URL("../../../../web/css/app.css", import.meta.url);

test("application shell stays compact and mobile footer hides on desktop", async () => {
  const source = await readFile(cssUrl, "utf8");

  assert.match(source, /\.application-header\s*,[\s\S]*\.application-footer\s*,[\s\S]*\.panel/);
  assert.match(source, /\.application-header\s*\{[\s\S]*position:\s*sticky;[\s\S]*display:\s*grid;[\s\S]*gap:\s*6px;/);
  assert.match(source, /\.shell-row-primary\s*\{[\s\S]*justify-content:\s*space-between;/);
  assert.match(source, /\.application-footer\s*\{[\s\S]*position:\s*sticky;[\s\S]*display:\s*flex;/);
  assert.match(source, /@media \(min-width:\s*720px\)\s*\{[\s\S]*\.application-footer\s*\{[\s\S]*display:\s*none;/);
});
