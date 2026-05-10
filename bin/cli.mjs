#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import Container from "@teqfw/di/src/Container.mjs";
import NamespaceRegistry from "@teqfw/di/src/Config/NamespaceRegistry.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

const container = new Container();
const namespaceRegistry = new NamespaceRegistry({ fs, path, appRoot: projectRoot });
const entries = await namespaceRegistry.build();
for (const entry of entries) {
  container.addNamespaceRoot(entry.prefix, entry.dirAbs, entry.ext);
}

const app = await container.get("Dnd_Gm_App$");
const cliArgs = process.argv.slice(2);

let exitCode = 1;
let stopping = false;
const stopApp = async () => {
  if (stopping) return;
  stopping = true;
  await app.stop();
};

process.once("SIGINT", () => void stopApp());
process.once("SIGTERM", () => void stopApp());

try {
  exitCode = await app.run({ projectRoot, cliArgs });
} catch (error) {
  console.error(error);
  exitCode = 1;
} finally {
  await stopApp();
}

process.exit(typeof exitCode === "number" ? exitCode : 1);
