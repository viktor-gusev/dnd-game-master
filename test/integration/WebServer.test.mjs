import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";

function getFreePort() { return new Promise((resolve, reject) => { const server = net.createServer(); server.listen(0, "127.0.0.1", () => { const address = server.address(); server.close(() => resolve(address.port)); }); server.on("error", reject); }); }
async function waitFor(url, timeoutMs = 10000) { const started = Date.now(); while (Date.now() - started < timeoutMs) { try { const res = await fetch(url); if (res.ok) return res; } catch {} await new Promise((resolve) => setTimeout(resolve, 100)); } throw new Error(`Timeout waiting for ${url}`); }

test("web server serves the campaign directory and campaign workspace shells", async () => {
  const port = await getFreePort();
  const child = spawn(process.execPath, ["./bin/cli.mjs", "--port", String(port)], { cwd: process.cwd(), stdio: ["ignore", "pipe", "pipe"] });
  const exited = new Promise((resolve) => child.once("exit", resolve));
  try {
    const home = await waitFor(`http://127.0.0.1:${port}/`);
    const homeHtml = await home.text();
    assert.match(homeHtml, /Campaigns/);
    const workspace = await waitFor(`http://127.0.0.1:${port}/campaign.html?campaignId=campaign-1`);
    const workspaceHtml = await workspace.text();
    assert.match(workspaceHtml, /Campaign Workspace/);
  } finally {
    child.kill("SIGTERM");
    await exited;
  }
});
