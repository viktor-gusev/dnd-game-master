import { summarizeConsoleError } from "./ErrorSummary.mjs";

const installedPatches = new WeakMap();

export function installConsoleErrorPatch({ consoleObject, onError } = {}) {
  if (!consoleObject || (typeof consoleObject.error !== "function")) {
    return () => {};
  }

  const existing = installedPatches.get(consoleObject);
  if (existing) return existing.restore;

  const originalError = consoleObject.error;
  let restored = false;

  function wrappedConsoleError(...args) {
    originalError.apply(this, args);
    if (typeof onError === "function") {
      try {
        onError(summarizeConsoleError({ arguments: args }));
      } catch {
        // Diagnostics capture must not break the original console path.
      }
    }
  }

  function restore() {
    if (restored) return;
    restored = true;
    if (consoleObject.error === wrappedConsoleError) {
      consoleObject.error = originalError;
    }
    installedPatches.delete(consoleObject);
  }

  consoleObject.error = wrappedConsoleError;
  installedPatches.set(consoleObject, { restore });
  return restore;
}
