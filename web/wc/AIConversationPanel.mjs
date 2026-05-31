const TAG_NAME = "dgm-ai-conversation-panel";
const BaseHTMLElement = globalThis.HTMLElement || class {};

function text(value) {
  return String(value ?? "").trim();
}

function normalizeBinding(binding = {}) {
  return {
    conversationId: text(binding.conversationId || binding.sessionId || ""),
    sessionId: text(binding.sessionId || binding.conversationId || ""),
    campaignId: text(binding.campaignId || ""),
    ownerIdentityId: text(binding.ownerIdentityId || ""),
    ownerRole: text(binding.ownerRole || ""),
    targetKind: text(binding.targetKind || ""),
    targetId: text(binding.targetId || ""),
    sectionKey: text(binding.sectionKey || ""),
    mode: text(binding.mode || ""),
    policyProfile: text(binding.policyProfile || ""),
    outputKind: text(binding.outputKind || ""),
    returnAnchor: text(binding.returnAnchor || ""),
    sourceMessageIds: Array.isArray(binding.sourceMessageIds) ? [...binding.sourceMessageIds] : [],
    sourceDraftIds: Array.isArray(binding.sourceDraftIds) ? [...binding.sourceDraftIds] : [],
    sourceAssetIds: Array.isArray(binding.sourceAssetIds) ? [...binding.sourceAssetIds] : [],
  };
}

function emit(target, type, detail = {}) {
  target.dispatchEvent(new CustomEvent(type, { bubbles: true, composed: true, detail }));
}

export class AIConversationPanelElement extends BaseHTMLElement {
  static get observedAttributes() {
    return ["state", "conversation-id", "campaign-id", "target-kind", "target-id", "section-key", "mode", "policy-profile", "output-kind", "return-anchor"];
  }

  #binding = normalizeBinding();
  #state = "closed";
  #statusText = "Closed.";
  #transcript = [];
  #candidate = null;
  #candidateReviewOpen = false;
  #candidateReviewText = "";
  #scrollTranscriptToLatest = false;
  #scrollTranscriptHandle = 0;

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
  }

  get binding() {
    return normalizeBinding(this.#binding);
  }

  set binding(value) {
    this.#binding = normalizeBinding(value);
    this.#syncAttributesFromBinding();
    this.render();
  }

  get state() {
    return this.#state;
  }

  set state(value) {
    this.#state = text(value) || "closed";
    this.render();
  }

  get transcript() {
    return Array.isArray(this.#transcript) ? [...this.#transcript] : [];
  }

  set transcript(value) {
    const nextTranscript = Array.isArray(value) ? [...value] : [];
    this.#scrollTranscriptToLatest = nextTranscript.length > this.#transcript.length;
    this.#transcript = nextTranscript;
    this.render();
  }

  get candidate() {
    return this.#candidate ? { ...this.#candidate } : null;
  }

  set candidate(value) {
    this.#candidate = value && typeof value === "object" ? { ...value } : null;
    if (!this.#candidate) this.#candidateReviewOpen = false;
    this.render();
  }

  set candidateReviewText(value) {
    this.#candidateReviewText = text(value);
    this.render();
  }

  get candidateReviewText() {
    return this.#candidateReviewText;
  }

  connectedCallback() {
    this.render();
  }

  disconnectedCallback() {
    this.#cancelTranscriptScroll();
  }

  attributeChangedCallback(name, oldValue, newValue) {
    if (oldValue === newValue) return;
    if (name === "state") this.#state = text(newValue) || "closed";
    if (name === "conversation-id") this.#binding.conversationId = text(newValue);
    if (name === "campaign-id") this.#binding.campaignId = text(newValue);
    if (name === "target-kind") this.#binding.targetKind = text(newValue);
    if (name === "target-id") this.#binding.targetId = text(newValue);
    if (name === "section-key") this.#binding.sectionKey = text(newValue);
    if (name === "mode") this.#binding.mode = text(newValue);
    if (name === "policy-profile") this.#binding.policyProfile = text(newValue);
    if (name === "output-kind") this.#binding.outputKind = text(newValue);
    if (name === "return-anchor") this.#binding.returnAnchor = text(newValue);
    this.render();
  }

  open(binding = null) {
    if (binding) this.binding = binding;
    this.state = "resolving-session";
    emit(this, "dgm-ai-conversation-panel-open", { binding: this.binding, state: this.state });
  }

  close() {
    this.state = "closed";
    emit(this, "dgm-ai-conversation-panel-close", { binding: this.binding, state: this.state, returnAnchor: this.#binding.returnAnchor });
  }

  submit(textValue) {
    const messageText = text(textValue);
    emit(this, "dgm-ai-conversation-panel-submit", { binding: this.binding, text: messageText });
  }

  refresh() {
    emit(this, "dgm-ai-conversation-panel-refresh", { binding: this.binding, state: this.state });
  }

  requestCandidateReady(candidate = null) {
    this.#candidate = candidate && typeof candidate === "object" ? { ...candidate } : this.#candidate;
    this.#candidateReviewOpen = false;
    this.state = "candidate-ready";
    emit(this, "dgm-ai-conversation-panel-candidate-ready", { binding: this.binding, candidate: this.#candidate });
  }

  openCandidateReview() {
    this.#candidateReviewOpen = true;
    this.render();
    emit(this, "dgm-ai-conversation-panel-candidate-requested", { binding: this.binding, candidate: this.#candidate });
  }

  closeCandidateReview() {
    this.#candidateReviewOpen = false;
    this.render();
    emit(this, "dgm-ai-conversation-panel-candidate-close", { binding: this.binding });
  }

  acceptCandidate() {
    if (!this.#candidate) return;
    emit(this, "dgm-ai-conversation-panel-candidate-accepted", { binding: this.binding, candidate: this.#candidate });
    this.#candidateReviewOpen = false;
    this.render();
  }

  rejectCandidate() {
    if (!this.#candidate) return;
    emit(this, "dgm-ai-conversation-panel-candidate-rejected", { binding: this.binding, candidate: this.#candidate });
    this.#candidateReviewOpen = false;
    this.render();
  }

  #syncAttributesFromBinding() {
    const mapping = {
      "conversation-id": this.#binding.conversationId,
      "campaign-id": this.#binding.campaignId,
      "target-kind": this.#binding.targetKind,
      "target-id": this.#binding.targetId,
      "section-key": this.#binding.sectionKey,
      mode: this.#binding.mode,
      "policy-profile": this.#binding.policyProfile,
      "output-kind": this.#binding.outputKind,
      "return-anchor": this.#binding.returnAnchor,
    };
    for (const [name, value] of Object.entries(mapping)) {
      if (value) this.setAttribute(name, value);
      else this.removeAttribute(name);
    }
  }

  #renderTranscript() {
    if (!this.#transcript.length) return "<p class=\"empty\">No messages yet.</p>";
    return this.#transcript.map((message) => {
      const role = text(message?.role) || "message";
      const content = text(message?.text || message?.content || "");
      return `<article class="message message-${role}"><strong class="message-role">${role}</strong><p class="message-body">${content || " "}</p></article>`;
    }).join("");
  }

  render() {
    if (!this.shadowRoot) return;
    this.hidden = this.#state === "closed";
    const running = this.#state === "provider-running" || this.#state === "submitting-message" || this.#state === "creating-session" || this.#state === "loading-history" || this.#state === "resolving-session" || this.#state === "accepting-draft" || this.#state === "rejecting-draft" || this.#state === "regenerating";
    const allowActions = this.#state !== "closed" && this.#state !== "session-closed";
    const showReviewButton = this.#state !== "closed" && this.#state !== "session-closed";
    this.#statusText = ({
      closed: "Closed.",
      "resolving-session": "Resolving session.",
      "creating-session": "Creating session.",
      "loading-history": "Loading history.",
      "ready-empty": "Ready.",
      "ready-with-thread": "Ready with thread.",
      "submitting-message": "Submitting message.",
      "provider-running": "Provider running.",
      "candidate-ready": "Candidate ready.",
      "accepting-draft": "Accepting candidate.",
      "rejecting-draft": "Rejecting candidate.",
      regenerating: "Regenerating.",
      "asset-ready": "Asset ready.",
      "provider-error": "Provider error.",
      "insufficient-credits": "Insufficient credits.",
      "session-closed": "Session closed.",
      "stale-refresh-needed": "Refresh needed.",
    })[this.#state] || this.#state;
    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; position: fixed; inset: 0; z-index: 1000; }
        :host([hidden]) { display: none; }
        .scrim { position: fixed; inset: 0; background: rgba(10, 12, 18, 0.58); }
        .panel { position: relative; width: min(42rem, calc(100vw - 1.5rem)); max-height: min(42rem, calc(100vh - 1.5rem)); margin: 0.75rem auto; display: grid; grid-template-rows: auto minmax(0, 1fr) auto; gap: 0.75rem; padding: 1rem; box-sizing: border-box; background: Canvas; color: CanvasText; border: 1px solid rgba(127,127,127,0.2); border-radius: 18px; box-shadow: 0 24px 80px rgba(0,0,0,0.35); }
        .meta { display: flex; align-items: baseline; justify-content: space-between; gap: 0.75rem; }
        .title { margin: 0; font-size: 1rem; font-weight: 650; }
        .status { margin: 0; font-size: 0.875rem; opacity: 0.75; }
        .transcript { min-height: 0; display: grid; gap: 0.625rem; padding: 0.25rem 0; overflow: auto; }
        .message, .candidate { max-width: 85%; border-radius: 16px; padding: 0.75rem 0.875rem; display: grid; gap: 0.25rem; }
        .message strong, .candidate h4 { margin: 0; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.06em; opacity: 0.7; }
        .message p, .candidate p, .empty { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
        .message-user { justify-self: end; background: color-mix(in oklab, CanvasText 8%, Canvas); }
        .message-assistant, .message-system, .message-message { justify-self: start; background: color-mix(in oklab, CanvasText 4%, Canvas); }
        .message-role { display: inline-block; }
        .message-body { line-height: 1.45; }
        .candidate { justify-self: start; border: 1px solid rgba(127,127,127,0.25); background: color-mix(in oklab, CanvasText 3%, Canvas); }
        .candidate h4 { font-size: 0.72rem; }
        .composer { display: grid; gap: 0.5rem; }
        textarea { width: 100%; min-height: 4.75rem; box-sizing: border-box; resize: vertical; }
        .actions { display: flex; flex-wrap: wrap; gap: 0.5rem; justify-content: flex-end; }
        .candidate-overlay { position: fixed; inset: 0; display: grid; place-items: center; padding: 1rem; background: rgba(10, 12, 18, 0.3); }
        .candidate-review { width: min(36rem, calc(100vw - 1.5rem)); max-height: min(32rem, calc(100vh - 1.5rem)); overflow: auto; display: grid; gap: 0.75rem; padding: 1rem; box-sizing: border-box; background: Canvas; color: CanvasText; border: 1px solid rgba(127,127,127,0.2); border-radius: 16px; box-shadow: 0 20px 60px rgba(0,0,0,0.28); }
        .candidate-review p { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
      </style>
      <div class="scrim" aria-hidden="true"></div>
      <section class="panel" aria-busy="${running ? "true" : "false"}" role="dialog" aria-modal="true" aria-label="AI conversation">
        <header class="meta">
          <strong class="title">AI conversation</strong>
          <p class="status" data-role="status">${this.#statusText}</p>
        </header>
        <section class="transcript" data-role="transcript" aria-label="Conversation transcript">${this.#renderTranscript()}</section>
        <label class="composer">
          <span>Message</span>
          <textarea data-role="input" placeholder="Enter a message."></textarea>
          <div class="actions">
          <button type="button" data-action="submit" ${allowActions ? "" : "disabled"}>Ask AI</button>
          <button type="button" data-action="open-candidate" ${showReviewButton ? "" : "disabled"}>Review candidate</button>
          <button type="button" data-action="refresh" ${this.#state === "stale-refresh-needed" ? "" : "disabled"}>Refresh</button>
          <button type="button" data-action="close">Close</button>
          </div>
        </label>
      </section>
      ${this.#candidateReviewOpen ? `
        <div class="candidate-overlay" role="presentation">
          <section class="candidate-review" role="dialog" aria-modal="true" aria-label="Candidate output review">
            <h4>Candidate output</h4>
            <pre>${text(this.#candidateReviewText || this.#candidate.text || this.#candidate.content || JSON.stringify(this.#candidate, null, 2) || "Pending")}</pre>
            <div class="actions">
              <button type="button" data-action="accept-candidate">Approve and use</button>
              <button type="button" data-action="reject-candidate">Reject</button>
              <button type="button" data-action="close-candidate">Close</button>
            </div>
          </section>
        </div>
      ` : ""}
    `;

    const submit = this.shadowRoot.querySelector("[data-action='submit']");
    const openCandidate = this.shadowRoot.querySelector("[data-action='open-candidate']");
    const refresh = this.shadowRoot.querySelector("[data-action='refresh']");
    const close = this.shadowRoot.querySelector("[data-action='close']");
    const input = this.shadowRoot.querySelector("[data-role='input']");
    const acceptCandidate = this.shadowRoot.querySelector("[data-action='accept-candidate']");
    const rejectCandidate = this.shadowRoot.querySelector("[data-action='reject-candidate']");
    const closeCandidate = this.shadowRoot.querySelector("[data-action='close-candidate']");

    submit?.addEventListener("click", () => this.submit(input?.value));
    openCandidate?.addEventListener("click", () => this.openCandidateReview());
    refresh?.addEventListener("click", () => this.refresh());
    close?.addEventListener("click", () => this.close());
    acceptCandidate?.addEventListener("click", () => this.acceptCandidate());
    rejectCandidate?.addEventListener("click", () => this.rejectCandidate());
    closeCandidate?.addEventListener("click", () => this.closeCandidateReview());
    this.#scheduleTranscriptScroll();
  }

  #scheduleTranscriptScroll() {
    if (!this.#scrollTranscriptToLatest || this.#scrollTranscriptHandle) return;
    const run = () => {
      this.#scrollTranscriptHandle = 0;
      if (!this.#scrollTranscriptToLatest) return;
      this.#scrollTranscriptToLatest = false;
      const transcript = this.shadowRoot?.querySelector("[data-role='transcript']");
      const messages = transcript ? transcript.querySelectorAll(".message") : [];
      const lastMessage = messages?.[messages.length - 1];
      if (!transcript || !lastMessage) return;
      if (typeof lastMessage.scrollIntoView === "function") {
        lastMessage.scrollIntoView({ block: "start", inline: "nearest", behavior: "auto" });
        return;
      }
      const targetTop = Math.max(0, (lastMessage.offsetTop || 0) - 8);
      transcript.scrollTop = targetTop;
    };
    if (typeof globalThis.requestAnimationFrame === "function") {
      this.#scrollTranscriptHandle = globalThis.requestAnimationFrame(run);
      return;
    }
    this.#scrollTranscriptHandle = globalThis.setTimeout(run, 0);
  }

  #cancelTranscriptScroll() {
    if (!this.#scrollTranscriptHandle) return;
    if (typeof globalThis.cancelAnimationFrame === "function") {
      globalThis.cancelAnimationFrame(this.#scrollTranscriptHandle);
    } else {
      globalThis.clearTimeout(this.#scrollTranscriptHandle);
    }
    this.#scrollTranscriptHandle = 0;
  }
}

if (globalThis.customElements && !customElements.get(TAG_NAME)) {
  customElements.define(TAG_NAME, AIConversationPanelElement);
}
