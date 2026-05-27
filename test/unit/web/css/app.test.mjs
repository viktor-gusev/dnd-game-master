import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const cssUrl = new URL("../../../../web/css/app.css", import.meta.url);

test("application shell stays compact and mobile footer hides on desktop", async () => {
  const source = await readFile(cssUrl, "utf8");

  assert.match(source, /\.application-header\s*\{[\s\S]*position:\s*sticky;[\s\S]*top:\s*0;[\s\S]*padding:\s*14px 16px;/);
  assert.match(source, /\.application-footer\s*\{[\s\S]*position:\s*sticky;[\s\S]*bottom:\s*0;[\s\S]*padding:\s*10px 12px;/);
  assert.match(source, /\.page-runtime-area\s*\{[\s\S]*display:\s*grid;[\s\S]*gap:\s*18px;/);
  assert.match(source, /@media \(min-width:\s*720px\)\s*\{[\s\S]*\.application-footer\s*\{[\s\S]*display:\s*none;/);
});
