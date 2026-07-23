// DownMan MSE ownership probe. Runs in the page's MAIN world at document_start.
// It reports URL/MediaSource timing evidence only; media bytes are never copied.
(() => {
  "use strict";
  if (window.__downmanMseProbeInstalled) return;
  window.__downmanMseProbeInstalled = true;

  const SIGNAL = "__downmanMseSignalV1";
  const CONTROL = "__downmanMseControlV1";
  const RECENT_LIMIT = 16;
  const REPLAY_LIMIT = 32;
  const CORRELATION_MS = 2500;
  const REPLAY_TTL_MS = 2 * 60 * 1000;
  const MEDIA_URL_RE = /\.(?:m3u8|mpd|mp4|m4v|webm|mkv|mov|m4a|mp3|aac|flac|ogg|wav|opus|ts)(?:[?#]|$)/i;
  const sourceIds = new WeakMap();
  const recent = [];
  const objectUrls = new Map();
  const ownership = [];
  let sequence = 0;

  function sourceId(source) {
    let id = sourceIds.get(source);
    if (!id) {
      sequence += 1;
      id = `dm-ms-${sequence}`;
      sourceIds.set(source, id);
    }
    return id;
  }

  function emit(payload) {
    try { window.postMessage({ [SIGNAL]: true, ...payload }, "*"); } catch (_) { /* detached frame */ }
  }

  function rememberOwnership(payload) {
    ownership.push(payload);
    if (ownership.length > REPLAY_LIMIT) ownership.shift();
    emit(payload);
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window || !event.data || event.data[CONTROL] !== true || event.data.kind !== "ready") return;
    const now = Date.now();
    for (const [objectUrl, id] of objectUrls) emit({ kind: "object-url", sourceId: id, objectUrl });
    for (const payload of ownership) {
      if (now - payload.observedAt <= REPLAY_TTL_MS) emit(payload);
    }
  }, false);

  function mediaLike(url, contentType) {
    return /^https?:/i.test(url)
      && (/^(?:video|audio)\//i.test(contentType)
        || /(?:mpegurl|dash\+xml)/i.test(contentType)
        || MEDIA_URL_RE.test(url));
  }

  function record(url, contentType) {
    if (!mediaLike(url, contentType)) return;
    recent.push({ url, contentType, at: performance.now() });
    if (recent.length > RECENT_LIMIT) recent.shift();
  }

  try {
    const original = URL.createObjectURL;
    URL.createObjectURL = function downmanCreateObjectURL(value) {
      const url = original.call(this, value);
      if (typeof MediaSource !== "undefined" && value instanceof MediaSource) {
        const id = sourceId(value);
        objectUrls.set(url, id);
        while (objectUrls.size > REPLAY_LIMIT) objectUrls.delete(objectUrls.keys().next().value);
        emit({ kind: "object-url", sourceId: id, objectUrl: url });
      }
      return url;
    };
  } catch (_) { /* frozen API */ }

  if (typeof MediaSource !== "undefined") {
    try {
      const originalAdd = MediaSource.prototype.addSourceBuffer;
      MediaSource.prototype.addSourceBuffer = function downmanAddSourceBuffer(mimeType) {
        const buffer = originalAdd.call(this, mimeType);
        const id = sourceId(this);
        try {
          const originalAppend = buffer.appendBuffer;
          buffer.appendBuffer = function downmanAppendBuffer(data) {
            const now = performance.now();
            const matches = recent
              .filter((entry) => now - entry.at <= CORRELATION_MS)
              .slice(-4);
            for (const entry of matches) {
              rememberOwnership({
                kind: "owned-url",
                sourceId: id,
                url: entry.url,
                contentType: mimeType || entry.contentType,
                observedAt: Date.now(),
              });
            }
            return originalAppend.call(this, data);
          };
        } catch (_) { /* frozen SourceBuffer */ }
        return buffer;
      };
    } catch (_) { /* frozen MediaSource */ }
  }

  if (typeof fetch === "function") {
    try {
      const originalFetch = fetch;
      window.fetch = function downmanFetch(input, init) {
        const requestUrl = typeof input === "string" ? input : input?.url || String(input || "");
        const promise = originalFetch.call(this, input, init);
        promise.then((response) => {
          try { record(response.url || requestUrl, response.headers?.get("content-type") || ""); } catch (_) { /* opaque response */ }
        }).catch(() => {});
        return promise;
      };
    } catch (_) { /* frozen fetch */ }
  }

  try {
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function downmanXhrOpen(method, url, ...rest) {
      this.__downmanUrl = String(url || "");
      return originalOpen.call(this, method, url, ...rest);
    };
    XMLHttpRequest.prototype.send = function downmanXhrSend(body) {
      this.addEventListener("loadend", () => {
        try { record(this.responseURL || this.__downmanUrl || "", this.getResponseHeader("content-type") || ""); } catch (_) { /* opaque response */ }
      }, { once: true });
      return originalSend.call(this, body);
    };
  } catch (_) { /* frozen XHR */ }
})();
