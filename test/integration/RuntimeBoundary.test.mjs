import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const projectRoot = process.cwd();

function readText(relPath) {
  return fs.readFileSync(path.join(projectRoot, relPath), "utf8");
}

test("Dnd_Gm_Bootstrap remains the root application component", () => {
  const appSource = readText("src/Bootstrap.mjs");
  assert.match(appSource, /export default class Bootstrap/);
  assert.match(appSource, /@namespace Dnd_Gm_Bootstrap/);
});

test("runtime boundary does not introduce alternative HTTP server frameworks", () => {
  const packageJson = JSON.parse(readText("package.json"));
  const deps = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };
  for (const name of ["express", "fastify", "koa", "nest", "nestjs", "hono"]) {
    assert.equal(deps[name], undefined, `${name} must not be added`);
  }
  const source = readText("src/Bootstrap.mjs");
  assert.doesNotMatch(source, /node:http/);
  assert.doesNotMatch(source, /express|fastify|koa|nest|hono/i);
});

