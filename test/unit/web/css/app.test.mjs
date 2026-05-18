import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const cssUrl = new URL("../../../../web/css/app.css", import.meta.url);

test("chat panel is vertically bounded and message list scrolls", async () => {
  const source = await readFile(cssUrl, "utf8");

  assert.match(source, /\.chat-panel\s*\{[\s\S]*max-height:\s*min\(72vh,\s*44rem\);[\s\S]*overflow:\s*hidden;/);
  assert.match(source, /#messages\s*\{[\s\S]*overflow-y:\s*auto;[\s\S]*min-height:\s*0;/);
  assert.match(source, /@media \(min-width:\s*720px\)\s*\{[\s\S]*\.chat-panel\s*\{[\s\S]*max-height:\s*min\(76vh,\s*48rem\);[\s\S]*\}/);
});
