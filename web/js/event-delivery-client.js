const CLIENT_INSTANCE_KEY = "dnd-gm.eventDelivery.clientInstanceId";

function randomHex(byteLength, cryptoApi = globalThis.crypto) {
  if (cryptoApi?.getRandomValues) {
    const bytes = new Uint8Array(byteLength);
    cryptoApi.getRandomValues(bytes);
    return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  }
  return `${Date.now().toString(16)}${Math.random().toString(16).slice(2)}`.slice(0, byteLength * 2);
}

export function getOrCreateClientInstanceId(storage = globalThis.sessionStorage) {
  if (!storage) return "";
  const existing = storage.getItem(CLIENT_INSTANCE_KEY);
  if (existing) return existing;
  const created = randomHex(16);
  storage.setItem(CLIENT_INSTANCE_KEY, created);
  return created;
}

export function createEventDeliveryChannel({
  fetchImpl = globalThis.fetch,
  eventSourceFactory = (url) => {
    if (typeof EventSource !== "function") throw new Error("EventSource is unavailable.");
    return new EventSource(url);
  },
  clientInstanceId,
  getRequestHeaders = () => ({}),
  onStateChange = () => {},
  tokenPath = "/api/event-delivery/token",
  streamPath = "/api/event-delivery/stream",
}) {
  let channelState = "closed";
  let source = null;
  let reconnectTimer = null;
  let closedIntentionally = false;

  const setState = (next) => {
    channelState = next;
    onStateChange(next);
  };

  const stopSource = () => {
    if (source && typeof source.close === "function") source.close();
    source = null;
  };

  const clearReconnect = () => {
    if (!reconnectTimer) return;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  };

  const scheduleReconnect = () => {
    if (closedIntentionally) return;
    clearReconnect();
    setState("reconnecting");
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      void connect(true);
    }, 250);
  };

  const connect = async (isReconnect = false) => {
    if (!clientInstanceId || typeof fetchImpl !== "function") {
      setState("failed");
      return;
    }

    clearReconnect();
    stopSource();
    setState(isReconnect ? "reconnecting" : "connecting");

    let response;
    try {
      const headers = {
        "content-type": "application/json",
        ...getRequestHeaders(),
      };
      response = await fetchImpl(tokenPath, {
        method: "POST",
        headers,
        body: JSON.stringify({ clientInstanceId }),
      });
    } catch {
      scheduleReconnect();
      return;
    }

    let data;
    try {
      data = await response.json();
    } catch {
      setState("failed");
      return;
    }

    if (!response.ok || !data?.ok || !data?.data?.streamToken) {
      setState("failed");
      return;
    }

    closedIntentionally = false;
    try {
      source = eventSourceFactory(`${streamPath}?token=${encodeURIComponent(data.data.streamToken)}`);
    } catch {
      setState("failed");
      return;
    }
    source.addEventListener("delivery.connected", () => {
      setState("connected");
    });
    source.addEventListener("delivery.heartbeat", () => {
      if (channelState !== "connected") setState("connected");
    });
    source.addEventListener("error", () => {
      stopSource();
      scheduleReconnect();
    });
  };

  return {
    getClientInstanceId() {
      return clientInstanceId;
    },
    getState() {
      return channelState;
    },
    async start() {
      if (channelState === "connecting" || channelState === "connected" || channelState === "reconnecting") return;
      await connect(false);
    },
    close() {
      closedIntentionally = true;
      clearReconnect();
      stopSource();
      setState("closed");
    },
  };
}
