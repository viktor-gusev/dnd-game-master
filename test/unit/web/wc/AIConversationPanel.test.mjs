import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";

const moduleUrl = new URL("../../../../web/wc/AIConversationPanel.mjs", import.meta.url);

test("AIConversationPanel source artifact exists", async () => {
  await access(moduleUrl);
});

test("AIConversationPanel source uses a guarded custom element registration", async () => {
  const source = await readFile(moduleUrl, "utf8");

  assert.match(source, /const TAG_NAME = "dgm-ai-conversation-panel"/);
  assert.match(source, /customElements\.get\(TAG_NAME\)/);
  assert.match(source, /customElements\.define\(TAG_NAME,\s*AIConversationPanelElement\)/);
  assert.match(source, /position:\s*fixed;/);
  assert.match(source, /inset:\s*0;/);
  assert.match(source, /observedAttributes/);
  assert.match(source, /aria-busy=/);
  assert.match(source, /Review candidate/);
  assert.match(source, /candidate-review/);
  assert.match(source, /#scrollTranscriptToLatest/);
  assert.match(source, /requestAnimationFrame/);
  assert.match(source, /scrollIntoView/);
  assert.match(source, /offsetTop/);
  assert.match(source, /candidate-ready/);
  assert.match(source, /provider-error/);
  assert.match(source, /stale-refresh-needed/);
});
