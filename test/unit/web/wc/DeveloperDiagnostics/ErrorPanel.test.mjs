import test from "node:test";
import assert from "node:assert/strict";

const modulePath = "../../../../../web/wc/DeveloperDiagnostics/ErrorPanel.mjs";

class FakeEventTarget {
  #listeners = new Map();

  addEventListener(type, listener) {
    if (!this.#listeners.has(type)) {
      this.#listeners.set(type, new Set());
    }
    this.#listeners.get(type).add(listener);
  }

  removeEventListener(type, listener) {
    this.#listeners.get(type)?.delete(listener);
  }

  dispatchEvent(event) {
    const listeners = this.#listeners.get(event.type);
    if (!listeners) return true;
    for (const listener of listeners) {
      listener.call(this, event);
    }
    return !event.defaultPrevented;
  }

  listenerCount(type) {
    return this.#listeners.get(type)?.size || 0;
  }
}

class FakeHTMLElement extends FakeEventTarget {
  #attributes = new Map();

  constructor() {
    super();
    this.shadowRoot = null;
  }

  attachShadow(init) {
    this.shadowRoot = {
      mode: init.mode,
      children: [],
      appendChild(node) {
        this.children.push(node);
        return node;
      },
    };
    return this.shadowRoot;
  }

  setAttribute(name, value = "") {
    const oldValue = this.getAttribute(name);
    this.#attributes.set(name, String(value));
    this.attributeChangedCallback?.(name, oldValue, String(value));
  }

  getAttribute(name) {
    return this.#attributes.has(name) ? this.#attributes.get(name) : null;
  }

  hasAttribute(name) {
    return this.#attributes.has(name);
  }

  removeAttribute(name) {
    const oldValue = this.getAttribute(name);
    this.#attributes.delete(name);
    this.attributeChangedCallback?.(name, oldValue, null);
  }
}

class FakeCustomEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.detail = init.detail;
    this.defaultPrevented = false;
  }
}

function makeConsoleSpy() {
  const calls = [];
  return {
    calls,
    error(...args) {
      calls.push(["error", args]);
    },
    log(...args) {
      calls.push(["log", args]);
    },
    info(...args) {
      calls.push(["info", args]);
    },
    warn(...args) {
      calls.push(["warn", args]);
    },
  };
}

function makeWindowSpy() {
  const target = new FakeEventTarget();
  const adds = [];
  const removes = [];

  return {
    adds,
    removes,
    addEventListener(type, listener) {
      adds.push([type, listener]);
      target.addEventListener(type, listener);
    },
    removeEventListener(type, listener) {
      removes.push([type, listener]);
      target.removeEventListener(type, listener);
    },
    dispatchEvent(event) {
      return target.dispatchEvent(event);
    },
    listenerCount(type) {
      return target.listenerCount(type);
    },
  };
}

function makeCustomElementsRegistry() {
  const registry = new Map();
  return {
    define(name, ctor) {
      registry.set(name, ctor);
    },
    get(name) {
      return registry.get(name);
    },
  };
}

function makeDocumentStub() {
  return {
    createElement(tagName) {
      return {
        tagName: tagName.toUpperCase(),
        children: [],
        textContent: "",
        innerHTML: "",
        appendChild(node) {
          this.children.push(node);
          return node;
        },
        setAttribute() {},
        classList: { add() {} },
      };
    },
  };
}

function installBrowserGlobals(t) {
  const previous = new Map();
  const keys = ["window", "document", "HTMLElement", "CustomEvent", "customElements", "navigator", "console"];

  for (const key of keys) {
    previous.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  }

  const window = makeWindowSpy();
  const consoleSpy = makeConsoleSpy();
  const customElements = makeCustomElementsRegistry();

  Object.defineProperty(globalThis, "window", { configurable: true, value: window });
  Object.defineProperty(globalThis, "document", { configurable: true, value: makeDocumentStub() });
  Object.defineProperty(globalThis, "HTMLElement", { configurable: true, value: FakeHTMLElement });
  Object.defineProperty(globalThis, "CustomEvent", { configurable: true, value: FakeCustomEvent });
  Object.defineProperty(globalThis, "customElements", { configurable: true, value: customElements });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      clipboard: {
        async writeText() {},
      },
    },
  });
  Object.defineProperty(globalThis, "console", { configurable: true, value: consoleSpy });

  t.after(() => {
    for (const [key, descriptor] of previous.entries()) {
      if (descriptor) {
        Object.defineProperty(globalThis, key, descriptor);
      } else {
        delete globalThis[key];
      }
    }
  });

  return { window, consoleSpy, customElements };
}

async function loadModule() {
  return import(`${modulePath}?test=${Date.now()}-${Math.random()}`);
}

function assertSafePrimitiveFields(record) {
  for (const [key, value] of Object.entries(record)) {
    assert.match(
      key,
      /^(timestamp|sourceType|message|sourceUrl|lineNumber|columnNumber|stackText|details)$/,
      `Unexpected field ${key}`,
    );
    assert.ok(
      value === null || ["string", "number", "boolean"].includes(typeof value),
      `Expected field ${key} to be a safe primitive value`,
    );
  }
}

function makeRecord(id, overrides = {}) {
  return {
    timestamp: `2026-05-16T10:00:0${id}.000Z`,
    sourceType: "console-error",
    message: `Record ${id}`,
    details: `Details ${id}`,
    ...overrides,
  };
}

test("ErrorPanel module registers the documented custom element and uses open Shadow DOM", async (t) => {
  const { customElements } = installBrowserGlobals(t);

  await loadModule();

  const ErrorPanel = customElements.get("dgm-dev-error-panel");

  assert.equal(typeof ErrorPanel, "function");
  assert.ok(Array.isArray(ErrorPanel.observedAttributes));
  assert.ok(ErrorPanel.observedAttributes.includes("open"));

  const element = new ErrorPanel();

  assert.equal(element.shadowRoot?.mode, "open");
});

test("ErrorPanel maxRecords property uses documented default and bounds", async (t) => {
  const { customElements } = installBrowserGlobals(t);

  await loadModule();
  const ErrorPanel = customElements.get("dgm-dev-error-panel");
  const element = new ErrorPanel();

  assert.equal(element.maxRecords, 50);

  element.maxRecords = 1;
  assert.equal(element.maxRecords, 1);

  element.maxRecords = 200;
  assert.equal(element.maxRecords, 200);
});

test("ErrorPanel maxRecords falls back to the documented default for invalid values", async (t) => {
  const { customElements } = installBrowserGlobals(t);

  await loadModule();
  const ErrorPanel = customElements.get("dgm-dev-error-panel");

  for (const value of [0, -1, 201, NaN, Infinity, "10", null]) {
    const element = new ErrorPanel();
    element.maxRecords = value;
    assert.equal(element.maxRecords, 50, `Expected invalid maxRecords ${String(value)} to fall back to 50`);
  }
});

test("ErrorPanel installs window listeners and wraps only console.error without duplicate installation", async (t) => {
  const { customElements, window, consoleSpy } = installBrowserGlobals(t);

  await loadModule();
  const ErrorPanel = customElements.get("dgm-dev-error-panel");
  const element = new ErrorPanel();
  const originalError = consoleSpy.error;
  const originalLog = consoleSpy.log;
  const originalInfo = consoleSpy.info;
  const originalWarn = consoleSpy.warn;

  element.connectedCallback?.();
  element.connectedCallback?.();

  assert.equal(window.listenerCount("error"), 1);
  assert.equal(window.listenerCount("unhandledrejection"), 1);
  assert.notEqual(consoleSpy.error, originalError);
  assert.equal(consoleSpy.log, originalLog);
  assert.equal(consoleSpy.info, originalInfo);
  assert.equal(consoleSpy.warn, originalWarn);

  consoleSpy.error("Top level failure", { nested: true });

  assert.deepEqual(consoleSpy.calls[0], ["error", ["Top level failure", { nested: true }]]);
});

test("ErrorPanel restores the original console.error when disconnected if it installed the wrapper", async (t) => {
  const { customElements, consoleSpy } = installBrowserGlobals(t);

  await loadModule();
  const ErrorPanel = customElements.get("dgm-dev-error-panel");
  const element = new ErrorPanel();
  const originalError = consoleSpy.error;

  element.connectedCallback?.();
  assert.notEqual(consoleSpy.error, originalError);

  element.disconnectedCallback?.();
  assert.equal(consoleSpy.error, originalError);
});

test("ErrorPanel module exports Phase 1 record summarizers with documented safe fields", async (t) => {
  installBrowserGlobals(t);
  const {
    summarizeWindowError,
    summarizeUnhandledRejection,
    summarizeConsoleError,
  } = await loadModule();

  const windowError = new Error("Window failure");
  windowError.stack = "Error: Window failure\n    at line 1";
  const rejectionReason = new Error("Promise failed");
  rejectionReason.stack = "Error: Promise failed\n    at line 2";

  const summary1 = summarizeWindowError({
    timestamp: "2026-05-16T10:10:00.000Z",
    message: "Window failure",
    sourceUrl: "https://example.test/app.js",
    lineNumber: 12,
    columnNumber: 34,
    error: windowError,
  });

  const summary2 = summarizeUnhandledRejection({
    timestamp: "2026-05-16T10:11:00.000Z",
    reason: rejectionReason,
  });

  const payload = { nested: { value: "before" } };
  const summary3 = summarizeConsoleError({
    timestamp: "2026-05-16T10:12:00.000Z",
    arguments: ["Top level failure", payload, "x".repeat(10_000)],
  });

  payload.nested.value = "after";

  assert.equal(summary1.sourceType, "window-error");
  assert.equal(summary2.sourceType, "unhandled-rejection");
  assert.equal(summary3.sourceType, "console-error");
  assert.match(summary3.message, /Top level failure/);
  assert.doesNotMatch(summary3.details, /after/);
  assert.ok(summary3.details.length < 10_000);

  assertSafePrimitiveFields(summary1);
  assertSafePrimitiveFields(summary2);
  assertSafePrimitiveFields(summary3);
});

test("ErrorPanel module summarizers handle circular, deep, and mixed inputs without throwing or exposing function bodies", async (t) => {
  installBrowserGlobals(t);
  const { summarizeConsoleError, summarizeUnhandledRejection } = await loadModule();

  const circular = { label: "circular" };
  circular.self = circular;

  const deep = { a: { b: { c: { d: { e: { value: "deep-value" } } } } } };
  const namedFunction = function namedFunction() {
    return "secret-body";
  };
  const values = [
    circular,
    deep,
    namedFunction,
    Symbol("token"),
    null,
    undefined,
    42,
    false,
    ["a", "b"],
    new Error("Console error"),
    { plain: true },
  ];

  assert.doesNotThrow(() => {
    summarizeConsoleError({
      timestamp: "2026-05-16T10:13:00.000Z",
      arguments: values,
    });
  });

  const rejection = summarizeUnhandledRejection({
    timestamp: "2026-05-16T10:14:00.000Z",
    reason: values,
  });

  assert.equal(typeof rejection.message, "string");
  assert.equal(typeof rejection.details, "string");
  assert.doesNotMatch(rejection.details, /secret-body/);
  assert.ok(rejection.details.length < 5_000);
  assertSafePrimitiveFields(rejection);
});

test("ErrorPanel module exports a plain-text copy report generator that uses only current records and sanitized URL", async (t) => {
  installBrowserGlobals(t);
  const { createErrorReport } = await loadModule();
  const report = createErrorReport({
    copiedAt: "2026-05-16T10:15:00.000Z",
    records: [
      makeRecord(1, {
        sourceUrl: "https://example.test/app.js",
        lineNumber: 10,
        columnNumber: 20,
        stackText: "Error: Visible error",
      }),
    ],
    url: "https://example.test/play?token=secret#debug",
  });

  assert.equal(typeof report, "string");
  assert.match(report, /2026-05-16T10:15:00.000Z/);
  assert.match(report, /Record 1/);
  assert.match(report, /https:\/\/example\.test\/play/);
  assert.doesNotMatch(report, /\?token=secret/);
  assert.doesNotMatch(report, /#debug/);
});

test("ErrorPanel module copy report omits forbidden content, may omit URL, and remains size-bounded", async (t) => {
  installBrowserGlobals(t);
  const { createErrorReport } = await loadModule();
  const oversized = "z".repeat(20_000);
  const forbiddenValues = [
    "localStorage-secret",
    "cookie=session=abc",
    "Bearer super-secret-token",
    "\"requestBody\":\"full payload\"",
    "\"responseBody\":\"full payload\"",
    "Alice Player",
    "Chat message body",
    "Preference answer",
    "World content",
    "Story content",
  ];

  const report = createErrorReport({
    copiedAt: "2026-05-16T10:16:00.000Z",
    records: [
      makeRecord(1, {
        message: oversized,
        details: oversized,
        stackText: oversized,
        localStorageDump: forbiddenValues[0],
        cookies: forbiddenValues[1],
        authorization: forbiddenValues[2],
        requestBody: forbiddenValues[3],
        responseBody: forbiddenValues[4],
        playerDisplayName: forbiddenValues[5],
        chatMessageBody: forbiddenValues[6],
        preferenceAnswer: forbiddenValues[7],
        worldContent: forbiddenValues[8],
        storyContent: forbiddenValues[9],
      }),
      makeRecord(2, {
        message: oversized,
        details: oversized,
        stackText: oversized,
      }),
    ],
  });

  for (const value of forbiddenValues) {
    assert.doesNotMatch(report, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  assert.ok(report.length < oversized.length * 2);
  assert.doesNotMatch(report, /Current URL:/);
});
