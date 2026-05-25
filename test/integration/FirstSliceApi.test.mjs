import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import net from "node:net";

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
    server.on("error", reject);
  });
}

async function waitFor(url, timeoutMs = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timeout waiting for ${url}`);
}

async function startApp(port) {
  const child = spawn(process.execPath, ["./bin/cli.mjs", "--port", String(port)], {
    cwd: process.cwd(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  return { child, stderrRef: () => stderr };
}

test("first-slice identity and session APIs respond through the runtime", async () => {
  const port = await getFreePort();
  const { child, stderrRef } = await startApp(port);
  const exited = new Promise((resolve) => child.once("exit", resolve));

  try {
    await waitFor(`http://127.0.0.1:${port}/`);

    const res = await fetch(`http://127.0.0.1:${port}/api/identity/local`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        uuid: "4d8b6f10-4a8b-48f4-b38c-d5128972e289",
        nickname: "Alice",
      }),
    });
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.ok, true);
    assert.equal(json.data.identity.uuid, "4d8b6f10-4a8b-48f4-b38c-d5128972e289");
    assert.equal(json.data.identity.nickname, "Alice");
  } finally {
    child.kill("SIGTERM");
    await exited;
  }
  assert.equal(stderrRef(), "");
});

test("static UI exposes session directory and session workspace entrypoints", async () => {
  const port = await getFreePort();
  const { child } = await startApp(port);
  const exited = new Promise((resolve) => child.once("exit", resolve));

  try {
    const directory = await waitFor(`http://127.0.0.1:${port}/`);
    const directoryHtml = await directory.text();
    assert.match(directoryHtml, /Session Directory/);
    assert.match(directoryHtml, /\/js\/directory\.js/);

    const workspace = await waitFor(`http://127.0.0.1:${port}/session.html?sessionId=session-1`);
    const workspaceHtml = await workspace.text();
    assert.match(workspaceHtml, /Session Workspace/);
    assert.match(workspaceHtml, /\/js\/session-workspace\.js/);
  } finally {
    child.kill("SIGTERM");
    await exited;
  }
});
