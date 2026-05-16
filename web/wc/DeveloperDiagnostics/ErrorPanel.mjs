import { installConsoleErrorPatch } from "../../js/Diagnostics/ConsoleErrorPatch.mjs";
import { ErrorRecordBuffer } from "../../js/Diagnostics/ErrorRecordBuffer.mjs";
import { createErrorReport } from "../../js/Diagnostics/ErrorReport.mjs";
import { summarizeUnhandledRejection, summarizeWindowError } from "../../js/Diagnostics/ErrorSummary.mjs";

const TAG_NAME = "dgm-dev-error-panel";
const TEMPLATE_URL = new URL("./ErrorPanel.html", import.meta.url);
const STYLE_URL = new URL("./ErrorPanel.css", import.meta.url);

let resourcesPromise;

function loadResources() {
  if (!resourcesPromise) {
    resourcesPromise = Promise.all([
      fetch(TEMPLATE_URL).then((response) => response.text()),
      fetch(STYLE_URL).then((response) => response.text()),
    ]).then(([template, style]) => ({ template, style }));
  }
  return resourcesPromise;
}

export class DeveloperDiagnosticsErrorPanel extends HTMLElement {
  static get observedAttributes() {
    return ["open"];
  }

  #buffer = new ErrorRecordBuffer();
  #listenersInstalled = false;
  #restoreConsoleError = null;
  #selectedIndex = 0;
  #statusText = "No errors captured.";
  #resources = null;

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.maxRecords = this.#buffer.maxRecords;
  }

  get maxRecords() {
    return this.#buffer.maxRecords;
  }

  set maxRecords(value) {
    this.#buffer.setMaxRecords(value);
    this.#selectedIndex = 0;
    this.render();
  }

  get open() {
    return this.hasAttribute("open");
  }

  set open(value) {
    if (value) this.setAttribute("open", "");
    else this.removeAttribute("open");
  }

  attributeChangedCallback(name) {
    if (name === "open") this.render();
  }

  connectedCallback() {
    this.#installCapture();
    void this.#ensureResources();
  }

  disconnectedCallback() {
    this.#removeCapture();
  }

  async #ensureResources() {
    if (!this.#resources) {
      this.#resources = await loadResources();
    }
    this.render();
  }

  #installCapture() {
    if (this.#listenersInstalled) return;
    this.#listenersInstalled = true;
    window.addEventListener("error", this.#onWindowError);
    window.addEventListener("unhandledrejection", this.#onUnhandledRejection);
    this.#restoreConsoleError = installConsoleErrorPatch({
      consoleObject: console,
      onError: (record) => this.#addRecord(record),
    });
  }

  #removeCapture() {
    if (!this.#listenersInstalled) return;
    this.#listenersInstalled = false;
    window.removeEventListener("error", this.#onWindowError);
    window.removeEventListener("unhandledrejection", this.#onUnhandledRejection);
    this.#restoreConsoleError?.();
    this.#restoreConsoleError = null;
  }

  #onWindowError = (event) => {
    this.#addRecord(summarizeWindowError(event));
  };

  #onUnhandledRejection = (event) => {
    this.#addRecord(summarizeUnhandledRejection(event));
  };

  #addRecord(record) {
    this.#buffer.add(record);
    this.#selectedIndex = 0;
    this.#statusText = `${this.#buffer.size} error record${this.#buffer.size === 1 ? "" : "s"} captured.`;
    this.render();
  }

  #emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, {
      bubbles: true,
      composed: true,
      detail,
    }));
  }

  #formatRecordDetails(record) {
    if (!record) return "No record selected.";
    const lines = [
      `timestamp: ${record.timestamp}`,
      `sourceType: ${record.sourceType}`,
      `message: ${record.message}`,
    ];
    if (record.sourceUrl) lines.push(`sourceUrl: ${record.sourceUrl}`);
    if (record.lineNumber !== undefined) lines.push(`lineNumber: ${record.lineNumber}`);
    if (record.columnNumber !== undefined) lines.push(`columnNumber: ${record.columnNumber}`);
    if (record.stackText) lines.push(`stackText: ${record.stackText}`);
    if (record.details) lines.push(`details: ${record.details}`);
    return lines.join("\n");
  }

  async #handleAction(action, index) {
    if (action === "open") {
      this.open = true;
      this.#emit("dgm-dev-error-panel-open", { count: this.#buffer.size });
      return;
    }

    if (action === "close") {
      this.open = false;
      this.#emit("dgm-dev-error-panel-close", { count: this.#buffer.size });
      return;
    }

    if (action === "clear") {
      this.#buffer.clear();
      this.#selectedIndex = 0;
      this.#statusText = "No errors captured.";
      this.render();
      this.#emit("dgm-dev-error-panel-clear", { count: 0 });
      return;
    }

    if (action === "copy") {
      let copied = false;
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(createErrorReport({
            copiedAt: new Date().toISOString(),
            records: this.#buffer.getRecords(),
            url: window.location?.href,
          }));
          copied = true;
          this.#statusText = "Report copied.";
        } else {
          this.#statusText = "Clipboard API is unavailable.";
        }
      } catch {
        this.#statusText = "Copy failed.";
      }
      this.render();
      this.#emit("dgm-dev-error-panel-copy", { copied, count: this.#buffer.size });
      return;
    }

    if (action === "select") {
      this.#selectedIndex = index;
      this.render();
    }
  }

  render() {
    if (!this.shadowRoot || !this.#resources) return;

    const records = this.#buffer.getRecords().reverse();
    const selectedRecord = records[this.#selectedIndex] || records[0];
    const listItems = records.map((record, index) => `
      <li>
        <button
          class="record-button${index === this.#selectedIndex ? " is-selected" : ""}"
          type="button"
          data-action="select"
          data-index="${index}"
        >
          <span class="record-message">${record.message}</span>
          <span class="record-meta">${record.sourceType} · ${record.timestamp}</span>
        </button>
      </li>
    `).join("");

    this.shadowRoot.innerHTML = `
      <style>${this.#resources.style}</style>
      ${this.#resources.template}
    `;

    const toggle = this.shadowRoot.querySelector(".toggle");
    const panel = this.shadowRoot.querySelector(".panel");
    const count = this.shadowRoot.querySelector("[data-role='count']");
    const status = this.shadowRoot.querySelector("[data-role='status']");
    const recordsList = this.shadowRoot.querySelector("[data-role='records']");
    const details = this.shadowRoot.querySelector("[data-role='details']");

    toggle?.setAttribute("aria-expanded", String(this.open));
    if (panel) panel.hidden = !this.open;
    if (count) count.textContent = String(this.#buffer.size);
    if (status) status.textContent = this.#statusText;
    if (recordsList) recordsList.innerHTML = listItems || "<li>No records captured.</li>";
    if (details) details.textContent = this.#formatRecordDetails(selectedRecord);

    for (const element of this.shadowRoot.querySelectorAll("[data-action]")) {
      element.addEventListener("click", async (event) => {
        const action = event.currentTarget.getAttribute("data-action");
        const safeIndex = Number(event.currentTarget.getAttribute("data-index"));
        await this.#handleAction(action, safeIndex);
      });
    }
  }
}

if (!customElements.get(TAG_NAME)) {
  customElements.define(TAG_NAME, DeveloperDiagnosticsErrorPanel);
}
