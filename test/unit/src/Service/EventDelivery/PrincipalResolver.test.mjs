import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import Container from "@teqfw/di/src/Container.mjs";
import NamespaceRegistry from "@teqfw/di/src/Config/NamespaceRegistry.mjs";

import PrincipalResolver from "../../../../../src/Service/EventDelivery/PrincipalResolver.mjs";

test("principal resolver adapts the local identity store", async () => {
  const resolver = new PrincipalResolver({
    dataStore: {
      async getIdentity(identityId) {
        return identityId === "local_1" ? { id: "local_1", displayName: "Alice" } : null;
      },
    },
  });

  const principalRef = await resolver.resolvePrincipalRef({
    request: { headers: { "x-local-identity-id": "local_1" } },
  });

  assert.equal(principalRef, "local_1");
  await assert.rejects(() => resolver.resolvePrincipalRef({ request: { headers: {} } }), /Missing local identity id/);
  await assert.rejects(() => resolver.resolvePrincipalRef({ request: { headers: { "x-local-identity-id": "missing" } } }), /Unknown local identity id/);
});

test("principal resolver is registered in DI", async () => {
  const projectRoot = path.resolve(process.cwd());
  const container = new Container();
  const registry = new NamespaceRegistry({ fs, path, appRoot: projectRoot });
  const entries = await registry.build();
  for (const entry of entries) container.addNamespaceRoot(entry.prefix, entry.dirAbs, entry.ext);

  const resolver = await container.get("Dnd_Gm_Service_EventDelivery_PrincipalResolver$");
  const runtime = await container.get("Dnd_Gm_Service_EventDelivery_Runtime$");

  assert.equal(typeof resolver.resolvePrincipalRef, "function");
  assert.equal(typeof runtime.openStream, "function");
  assert.equal(typeof runtime.notifyUser, "function");
});
