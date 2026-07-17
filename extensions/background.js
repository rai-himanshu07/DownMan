// DownMan Connector — background service worker.
// Intercepts downloads and correlates media intents with frame-scoped network
// evidence for blob/MSE players.

if (!globalThis.DownManMediaResolver && typeof importScripts === "function") {
  importScripts("media-resolver.js");
}
const MediaResolver = globalThis.DownManMediaResolver;

const DEFAULT_ENDPOINT = "http://127.0.0.1:6802";
const WORKER_STARTED_AT = Date.now();
const DM_BUILD = "1.1.0";
// Verbose resolver diagnostics for the service-worker console. Off for releases.
const DM_DEBUG = false;
const NEW_DOWNLOAD_GRACE_MS = 60 * 1000;
const DEFAULT_AUTO_EXTS = [
  "3GP", "7Z", "AAC", "ACE", "AIF", "APK", "ARJ", "ASF", "AVI", "BIN", "BZ2", "DEB", "EXE",
  "GZ", "GZIP", "IMG", "ISO", "LZH", "M4A", "M4V", "MKV", "MOV", "MP3", "MP4", "MPA",
  "MD", "MPE", "MPEG", "MPG", "MSI", "MSU", "OGG", "OGV", "PDF", "PLJ", "PPS", "PPT", "QT",
  "RA", "RAR", "RM", "RMVB", "SEA", "SIT", "SITX", "TAR", "TIF", "TIFF", "WAV", "WMA",
  "WMV", "Z", "ZIP",
];
const LEDGER_STORAGE_KEY = "dmMediaLedgerV2";
const DOWNLOAD_STATE_KEY = "dmBrowserDownloadStateV2";
const MAX_TAB_CANDIDATES = 200;
const MEDIA_ASSOCIATION_MS = 15000;
const ACTIVE_MEDIA_MS = 45000;
// Adaptive manifests are always interesting.
const STREAM_RE = /\.(m3u8|mpd)(\?|$)/i;
// Progressive media files (kept only if large enough — see MIN_FILE).
const FILE_RE = /\.(mp4|webm|mkv|m4a|mp3|aac|flac|ts|mov|ogg|wav|opus)(\?|$)/i;
// Any directly-downloadable file (video OR image) — these go straight to aria2.
const DIRECT_FILE_RE = /\.(mp4|m4v|webm|mkv|mov|m4a|mp3|aac|flac|ogg|wav|opus|ts|gif|jpe?g|png|webp|avif|bmp|svg)(\?|$)/i;
// Some sites wrap the real media in a viewer link like
// <host>/media?url=<encoded real url> — unwrap it to the actual file.
function unwrapUrl(url) {
  try {
    const u = new URL(url);
    const inner = u.searchParams.get("url");
    if (inner && /\/media$/i.test(u.pathname)) return inner;
  } catch (_) { /* ignore */ }
  return url;
}
// UI sounds / notification blips that look like media but aren't (e.g. player UI chimes).
const JUNK_NAME_RE = /\/(failure|success|open|close|no_input|notification|click|ding|dong|pop|beep|silence|blank|error|alert|chime|tone|tick|swoosh|whoosh)\.(mp3|m4a|wav|ogg|aac|opus)(\?|$)/i;
const MIN_TAKEOVER = 8 * 1024 * 1024; // hand large files to DownMan
const mediaByTab = new Map(); // tabId -> Map(canonicalKey -> Candidate)
const activeMediaByFrame = new Map(); // "tabId:frameId" -> Map(mediaId -> observedAt)
const resetDuringRestore = new Set();
let restoringLedger = true;
let persistTimer = null;

function canonicalKey(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    const volatile = /^(?:token|sig|signature|expires?|policy|key-pair-id|hdnts|hmac|bytestart|byteend|range|x-amz-.+|x-goog-.+)$/i;
    for (const key of [...parsed.searchParams.keys()]) {
      if (volatile.test(key)) parsed.searchParams.delete(key);
    }
    parsed.searchParams.sort();
    return parsed.href;
  } catch {
    return url;
  }
}

function candidateTtl(candidate) {
  return candidate.kind === "file" ? MediaResolver.FILE_TTL_MS : MediaResolver.MANIFEST_TTL_MS;
}

function pruneTab(tabId, now = Date.now()) {
  const ledger = mediaByTab.get(tabId);
  if (!ledger) return;
  for (const [key, candidate] of ledger) {
    if (now - (candidate.lastSeen || 0) > candidateTtl(candidate)) ledger.delete(key);
  }
  if (ledger.size > MAX_TAB_CANDIDATES) {
    const keep = [...ledger.values()]
      .sort((left, right) => {
        const kindDelta = Number(right.kind === "manifest") - Number(left.kind === "manifest");
        return kindDelta || (right.lastSeen || 0) - (left.lastSeen || 0);
      })
      .slice(0, MAX_TAB_CANDIDATES);
    ledger.clear();
    keep.forEach((candidate) => ledger.set(candidate.canonicalKey, candidate));
  }
  if (!ledger.size) mediaByTab.delete(tabId);
}

function sessionStorage() {
  return chrome.storage && chrome.storage.session ? chrome.storage.session : null;
}

async function persistLedger() {
  persistTimer = null;
  const storage = sessionStorage();
  if (!storage) return;
  for (const tabId of mediaByTab.keys()) pruneTab(tabId);
  const rows = [...mediaByTab].map(([tabId, ledger]) => [tabId, [...ledger.values()]]);
  try { await storage.set({ [LEDGER_STORAGE_KEY]: rows }); } catch (_) { /* session storage is best-effort */ }
}

function queuePersist() {
  if (persistTimer || !sessionStorage()) return;
  persistTimer = setTimeout(persistLedger, 250);
}

async function restoreLedger() {
  const storage = sessionStorage();
  if (!storage) return;
  try {
    const stored = (await storage.get(LEDGER_STORAGE_KEY))[LEDGER_STORAGE_KEY];
    for (const row of Array.isArray(stored) ? stored : []) {
      const tabId = Number(row[0]);
      if (!Number.isInteger(tabId) || resetDuringRestore.has(tabId) || !Array.isArray(row[1])) continue;
      const ledger = mediaByTab.get(tabId) || new Map();
      for (const candidate of row[1]) {
        if (!candidate || !candidate.canonicalKey || !candidate.url) continue;
        const current = ledger.get(candidate.canonicalKey);
        if (!current || (candidate.lastSeen || 0) > (current.lastSeen || 0)) {
          ledger.set(candidate.canonicalKey, candidate);
        }
      }
      mediaByTab.set(tabId, ledger);
      pruneTab(tabId);
    }
  } catch (_) { /* continue with the in-memory ledger */ }
}

const ledgerReady = restoreLedger().finally(() => {
  restoringLedger = false;
  resetDuringRestore.clear();
});

function frameKey(tabId, frameId) {
  return `${tabId}:${frameId}`;
}

function recentMediaSessions(tabId, frameId, now = Date.now()) {
  const key = frameKey(tabId, frameId);
  const sessions = activeMediaByFrame.get(key) || new Map();
  for (const [mediaId, observedAt] of sessions) {
    if (now - observedAt > ACTIVE_MEDIA_MS) sessions.delete(mediaId);
  }
  if (sessions.size) activeMediaByFrame.set(key, sessions);
  else activeMediaByFrame.delete(key);
  return sessions;
}

function associateMedia(tabId, frameId, intent) {
  if (!intent || !intent.mediaId) return;
  const now = Date.now();
  const sessions = recentMediaSessions(tabId, frameId, now);
  sessions.set(intent.mediaId, now);
  activeMediaByFrame.set(frameKey(tabId, frameId), sessions);
  const triggerAt = Number.isFinite(intent.triggeredAt) ? intent.triggeredAt : now;
  const ledger = mediaByTab.get(tabId);
  if (!ledger || intent.trigger !== "playing" || sessions.size !== 1) return;
  const nearest = [...ledger.values()]
    .filter((candidate) => candidate.frameId === frameId)
    .filter((candidate) => !(candidate.mediaIds || []).length)
    .filter((candidate) => Math.abs((candidate.lastSeen || 0) - triggerAt) <= MEDIA_ASSOCIATION_MS)
    .sort((left, right) => Math.abs((left.lastSeen || 0) - triggerAt) - Math.abs((right.lastSeen || 0) - triggerAt))[0];
  if (nearest) nearest.mediaIds = [intent.mediaId];
  queuePersist();
}

function recordCandidate(details, kind, contentType, size, partial) {
  const now = Date.now();
  const key = canonicalKey(details.url);
  const ledger = mediaByTab.get(details.tabId) || new Map();
  const previous = ledger.get(key);
  const sessions = recentMediaSessions(details.tabId, details.frameId, now);
  const mediaIds = new Set(Array.isArray(previous?.mediaIds) ? previous.mediaIds : []);
  if (!mediaIds.size && sessions.size === 1) mediaIds.add(sessions.keys().next().value);
  ledger.set(key, {
    schemaVersion: MediaResolver.SCHEMA_VERSION,
    url: details.url,
    canonicalKey: key,
    kind,
    type: kind === "manifest" ? "stream" : "file",
    size,
    contentType,
    frameId: details.frameId,
    documentUrl: details.documentUrl || "",
    initiator: details.initiator || "",
    requestType: details.type || "",
    partial,
    firstSeen: previous?.firstSeen || now,
    lastSeen: now,
    mediaIds: [...mediaIds].slice(-4),
  });
  mediaByTab.set(details.tabId, ledger);
  pruneTab(details.tabId, now);
  queuePersist();
}

function header(headers, name) {
  const h = headers && headers.find((x) => x.name.toLowerCase() === name);
  return h ? h.value || "" : "";
}

async function endpoint() {
  const { server } = await chrome.storage.local.get("server");
  return server || DEFAULT_ENDPOINT;
}

// Backend aria2 RPC calls are bounded at 10s; keep a buffer so the browser never
// resumes at the exact instant DownMan may have accepted the same download.
const BRIDGE_REQUEST_TIMEOUT_MS = 15000;
const RULES_REQUEST_TIMEOUT_MS = 2500;

async function fetchWithTimeout(url, options = {}, timeoutMs = BRIDGE_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function post(payload) {
  const base = await endpoint();
  const r = await fetchWithTimeout(`${base}/add`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  let data = null;
  try { data = await r.json(); } catch (_) { /* older bridge responses may be empty */ }
  if (!r.ok) throw new Error((data && data.error) || "DownMan offline");
  if (data && data.ok === false) throw new Error(data.error || "DownMan rejected the media source");
  return data || { ok: true };
}

// Which browser yt-dlp should read cookies from. Default to the browser this
// extension runs in so logged-in, private, and age-restricted content works
// without extra setup. Users can force a specific browser or disable it entirely
// on the options page.
function detectCookieBrowser() {
  try {
    if (typeof browser !== "undefined" && browser.runtime && browser.runtime.getBrowserInfo) return "firefox";
    const ua = (typeof navigator !== "undefined" && navigator.userAgent) || "";
    if (/\bEdg\//.test(ua)) return "edge";
    if (/\bOPR\/|\bOpera\b/.test(ua)) return "opera";
    if (/\bVivaldi\//.test(ua)) return "vivaldi";
    if (/\bFirefox\//.test(ua)) return "firefox";
    if (/\bChromium\//.test(ua)) return "chromium";
    return "chrome";
  } catch (_) {
    return "chrome";
  }
}

async function cookiesPref() {
  const { cookies } = await chrome.storage.local.get("cookies");
  if (cookies === "none") return "";
  if (cookies && cookies !== "auto") return cookies;
  return detectCookieBrowser();
}

// --- Interception rules (fetched from the app, cached briefly) ---
// A short TTL keeps the extension in sync with file types added in the DownMan
// app: the next download after a change re-fetches the current rule set.
const RULES_TTL_MS = 15000;
let _rules = null;
let _rulesAt = 0;
async function rules() {
  const now = Date.now();
  if (_rules && now - _rulesAt < RULES_TTL_MS) return _rules;
  try {
    const base = await endpoint();
    const r = await fetchWithTimeout(`${base}/rules`, {}, RULES_REQUEST_TIMEOUT_MS);
    if (!r.ok) throw new Error("rules unavailable");
    _rules = await r.json();
    _rulesAt = now;
  } catch {
    // Fail open: if DownMan cannot confirm the current interception rules, leave
    // the file with the browser instead of pausing it on stale/default settings.
    _rules = null;
    _rulesAt = 0;
  }
  const effective = _rules || { enabled: false, autoExts: DEFAULT_AUTO_EXTS, blockSites: [], blockAddresses: [] };
  // Keep the browser's own download UI visible. Files DownMan does not take over
  // (unconfigured extensions, small files) must stay visible so the browser hands
  // them to the user — hiding the UI made those downloads look like they vanished.
  applyDownloadUi(false);
  return effective;
}

if (chrome.storage?.onChanged) {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes.server) {
      _rules = null;
      _rulesAt = 0;
    }
  });
}

function extOf(s) {
  try {
    const path = s.startsWith("http") ? new URL(s).pathname : s;
    const m = path.match(/\.([A-Za-z0-9]+)(?:$|\?)/);
    return m ? m[1].toUpperCase() : "";
  } catch {
    return "";
  }
}

function matchGlob(patterns, value) {
  if (!value) return false;
  return (patterns || []).some((p) => {
    const rx = new RegExp("^" + p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$", "i");
    return rx.test(value);
  });
}

function siteBlocked(rs, url, referrer) {
  const hosts = [];
  try { hosts.push(new URL(url).hostname); } catch {}
  try { if (referrer) hosts.push(new URL(referrer).hostname); } catch {}
  return hosts.some((h) => matchGlob(rs.blockSites, h));
}

async function send(uris, options = {}) {
  return post({ uris, options });
}

// Capture a whole page/site via yt-dlp (1800+ sites + generic).
async function sendSite(url, format = "best", referer = "", title = "", quality = "") {
  url = unwrapUrl(url);
  // If the URL is (or unwrapped to) a direct file, download it straight via aria2
  // rather than handing an unsupported URL (e.g. a /media?url=… viewer wrapper) to yt-dlp.
  if (DIRECT_FILE_RE.test(url)) return send([url], referer ? { referer } : {});
  return post({ kind: "page", uris: [url], options: { format, referer, title, quality, cookies: await cookiesPref() } });
}

// Capture a sniffed stream URL, forwarding the page as Referer so CDNs don't 403.
async function sendStream(url, referer = "") {
  return post({ kind: "stream", uris: [url], options: { referer, cookies: await cookiesPref() } });
}

function notifyFailure(title, error) {
  if (!chrome.notifications) return;
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icon48.png",
    title,
    message: String(error).replace(/^Error:\s*/, "").slice(0, 240),
  });
}

function intentCandidate(intent, frameId) {
  if (!/^https?:/i.test(intent.currentSrc || "")) return null;
  const manifest = STREAM_RE.test(intent.currentSrc);
  const partial = /[?&](?:bytestart|byteend|range)=/i.test(intent.currentSrc);
  return {
    schemaVersion: MediaResolver.SCHEMA_VERSION,
    url: intent.currentSrc,
    canonicalKey: canonicalKey(intent.currentSrc),
    kind: manifest ? "manifest" : "file",
    type: manifest ? "stream" : "file",
    size: 0,
    contentType: "",
    frameId,
    documentUrl: intent.frameUrl || "",
    requestType: "dom-current-src",
    partial,
    firstSeen: intent.triggeredAt,
    lastSeen: intent.triggeredAt,
    mediaIds: intent.mediaId ? [intent.mediaId] : [],
  };
}

function pageCandidate(intent, frameId, source) {
  const rawUrl = source?.url || intent.frameUrl || "";
  if (!/^https?:/i.test(rawUrl)) return null;
  const identity = MediaResolver.pageIdentity(rawUrl);
  return {
    schemaVersion: MediaResolver.SCHEMA_VERSION,
    url: identity.url,
    canonicalKey: identity.key,
    kind: "page",
    type: "page",
    size: 0,
    contentType: "text/html",
    frameId,
    documentUrl: intent.frameUrl || "",
    requestType: source ? "dom-nearby-page" : "page-fallback",
    pageStrength: source?.strength || 0,
    pageBound: !!source?.bound || (!source && identity.specific && !intent.nested),
    pageIdentity: source?.identityKey || identity.key,
    firstSeen: intent.triggeredAt,
    lastSeen: intent.triggeredAt,
    mediaIds: [],
  };
}

function mergeCandidate(target, candidate) {
  if (!candidate) return;
  const previous = target.get(candidate.canonicalKey);
  if (!previous) {
    target.set(candidate.canonicalKey, candidate);
    return;
  }
  const mediaIds = new Set([...(previous.mediaIds || []), ...(candidate.mediaIds || [])]);
  const hasFullDomSource = (previous.requestType === "dom-current-src" && !previous.partial)
    || (candidate.requestType === "dom-current-src" && !candidate.partial);
  const previousPageStrength = previous.pageStrength || 0;
  const candidatePageStrength = candidate.pageStrength || 0;
  const keepPreviousPageSource = previous.kind === "page" && candidate.kind === "page" && (
    (!!previous.pageBound && !candidate.pageBound) || previousPageStrength > candidatePageStrength
  );
  target.set(candidate.canonicalKey, {
    ...previous,
    ...candidate,
    kind: previous.kind === "manifest" || candidate.kind === "manifest" ? "manifest" : candidate.kind,
    size: Math.max(previous.size || 0, candidate.size || 0),
    contentType: candidate.contentType || previous.contentType || "",
    requestType: keepPreviousPageSource ? previous.requestType : candidate.requestType,
    pageStrength: Math.max(previousPageStrength, candidatePageStrength),
    pageBound: !!(previous.pageBound || candidate.pageBound),
    pageIdentity: candidate.pageIdentity || previous.pageIdentity,
    partial: hasFullDomSource ? false : !!(previous.partial || candidate.partial),
    firstSeen: Math.min(previous.firstSeen || candidate.firstSeen, candidate.firstSeen || previous.firstSeen),
    lastSeen: Math.max(previous.lastSeen || 0, candidate.lastSeen || 0),
    mediaIds: [...mediaIds].slice(-4),
  });
}

async function mediaBundle(tabId, frameId, rawIntent) {
  await ledgerReady;
  const now = Date.now();
  const intent = {
    ...rawIntent,
    schemaVersion: MediaResolver.SCHEMA_VERSION,
    frameId,
    triggeredAt: Number.isFinite(rawIntent?.triggeredAt) ? rawIntent.triggeredAt : now,
  };
  associateMedia(tabId, frameId, intent);
  intent.mediaSessionCount = recentMediaSessions(tabId, frameId, now).size;
  pruneTab(tabId, now);
  const combined = new Map();
  for (const candidate of mediaByTab.get(tabId)?.values() || []) mergeCandidate(combined, candidate);
  mergeCandidate(combined, intentCandidate(intent, frameId));
  for (const source of Array.isArray(intent.pageUrls) ? intent.pageUrls : []) {
    mergeCandidate(combined, pageCandidate(intent, frameId, source));
  }
  mergeCandidate(combined, pageCandidate(intent, frameId));
  if (intent.topUrl && intent.topUrl !== intent.frameUrl) {
    mergeCandidate(combined, pageCandidate(intent, frameId, { url: intent.topUrl, strength: 4 }));
  }
  const candidates = MediaResolver.rankCandidates([...combined.values()], intent, now);
  let confidence = MediaResolver.confidenceFor(candidates);
  const top = candidates[0];
  const topBound = top && (
    top.pageBound
    || (top.mediaIds || []).includes(intent.mediaId)
    || (/^https?:/i.test(intent.currentSrc || "") && top.url === intent.currentSrc)
  );
  if (intent.mediaSessionCount > 1 && top && top.kind !== "page" && !topBound) confidence = "low";
  return {
    schemaVersion: MediaResolver.SCHEMA_VERSION,
    intent,
    candidates,
    confidence,
  };
}

function humanSize(bytes) {
  if (!bytes) return "size unknown";
  if (bytes >= 1024 * 1024) return `${Math.round(bytes / 1024 / 1024)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

function choiceFor(candidate, index) {
  let location = "media source";
  try {
    const url = new URL(candidate.url);
    const name = decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() || "");
    location = name ? `${url.hostname}/${name}` : url.hostname;
  } catch (_) { /* use the generic label */ }
  const label = candidate.kind === "manifest"
    ? "Adaptive stream"
    : candidate.kind === "page"
      ? "Try the page extractor"
      : /^audio\//i.test(candidate.contentType || "")
        ? "Audio file"
        : "Video file";
  const type = candidate.contentType ? candidate.contentType.split(";")[0] : candidate.kind;
  return { index, label, detail: `${location} · ${type} · ${humanSize(candidate.size)}` };
}

async function submitMediaBundle(bundle, selectedIndex) {
  const selected = Number.isInteger(selectedIndex) ? selectedIndex : undefined;
  return post({
    schemaVersion: MediaResolver.SCHEMA_VERSION,
    kind: "media",
    intent: bundle.intent,
    candidates: bundle.candidates,
    selectedIndex: selected,
    options: {
      referer: bundle.intent.referer || bundle.intent.frameUrl || "",
      elem: bundle.intent.sourceKind === "blob" ? `${bundle.intent.element || "video"}-mse` : bundle.intent.element || "video",
      cookies: await cookiesPref(),
      format: "best",
      title: bundle.intent.title || "",
    },
  });
}

async function resolveMediaIntent(tabId, frameId, intent) {
  const bundle = await mediaBundle(tabId, frameId, intent || {});
  const plan = MediaResolver.planResolution(bundle.candidates, bundle.intent, bundle.confidence);
  const diag = {
    build: DM_BUILD,
    context: bundle.intent.contextKind,
    confidence: bundle.confidence,
    action: plan.action,
    reason: plan.reason,
    candidates: bundle.candidates.map((candidate) => ({
      kind: candidate.kind,
      bound: !!candidate.pageBound,
      score: candidate.score,
      url: candidate.url,
    })),
  };
  if (DM_DEBUG) { try { console.log("[DownMan] resolve", diag); } catch (_) { /* diagnostics only */ } }
  if (plan.action === "submit") {
    await submitMediaBundle(bundle, plan.index);
    return { ok: true, _diag: diag };
  }
  if (plan.action === "choose") {
    return {
      ok: false,
      code: "choose",
      bundle,
      choices: plan.indexes.map((index) => choiceFor(bundle.candidates[index], index)),
      _diag: diag,
    };
  }
  if (plan.code === "ambiguous-player") {
    return { ok: false, code: plan.code, error: "Open this media's post, play it briefly, then retry Download.", _diag: diag };
  }
  return { ok: false, code: "no-candidate", error: "Play the video for a moment, then try Download again.", _diag: diag };
}

// Ask the app for the real, per-video quality list (yt-dlp -J under the hood).
async function fetchFormats(url, referer = "") {
  const base = await endpoint();
  const r = await fetchWithTimeout(`${base}/formats`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, referer, cookies: await cookiesPref() }),
  });
  if (!r.ok) throw new Error("DownMan offline");
  const data = await r.json();
  if (data.error) throw new Error(data.error);
  return data; // { title, formats: [{ selector, label, kind, height, ext, size }] }
}

// --- Hand off ordinary browser downloads to DownMan. onCreated/onChanged work in
// Chromium and Firefox; onDeterminingFilename gives Chromium an earlier chance.
const capturedBrowserDownloads = new Set();
const checkingBrowserDownloads = new Map();
const observedBrowserDownloads = new Map();
const heldBrowserDownloads = new Set();
let browserStateTimer = null;

function downloadsCall(method, ...args) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const succeed = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error instanceof Error ? error : new Error(String(error)));
    };
    const callback = (value) => {
      const error = chrome.runtime.lastError;
      if (error) fail(new Error(error.message || String(error)));
      else succeed(value);
    };
    try {
      const result = chrome.downloads[method](...args, callback);
      if (result && typeof result.then === "function") result.then(succeed, fail);
    } catch (error) {
      fail(error);
    }
  });
}

// DownMan no longer hides the browser's own download UI. An earlier build hid
// Chrome's download bubble so hand-offs wouldn't flash, but that also hid every
// download DownMan did NOT take over (unconfigured extensions, small files), which
// made them look like they had vanished. applyDownloadUi now only RESTORES the UI,
// once, and only if that earlier build had actually hidden it; a fresh install is
// left untouched (the browser shows its downloads normally).
let _downloadUiChecked = false;
async function applyDownloadUi(hidden) {
  if (hidden || _downloadUiChecked) return; // never hide — see note above
  try {
    const stored = await chrome.storage?.local?.get?.("dmHideDownloadUi");
    if (!stored || !stored.dmHideDownloadUi) {
      _downloadUiChecked = true;
      return; // never hidden — leave the UI as-is
    }
    if (chrome.downloads?.setUiOptions) {
      await downloadsCall("setUiOptions", { enabled: true });
    } else if (chrome.downloads?.setShelfEnabled) {
      chrome.downloads.setShelfEnabled(true);
      void chrome.runtime.lastError;
    }
    _downloadUiChecked = true;
    chrome.storage?.local?.set?.({ dmHideDownloadUi: false });
  } catch (_) { /* download UI control is best-effort */ }
}

// On service-worker start, restore the browser download UI if a previous build left
// it hidden, so downloads the browser handles are visible again.
(async () => {
  try { await applyDownloadUi(false); } catch (_) { /* reconciles on the next rules fetch */ }
})();

async function persistBrowserDownloadState() {
  browserStateTimer = null;
  const storage = sessionStorage();
  if (!storage) return;
  const now = Date.now();
  for (const [id, state] of observedBrowserDownloads) {
    if (now - state.observedAt > 60 * 60 * 1000) observedBrowserDownloads.delete(id);
  }
  try {
    await storage.set({
      [DOWNLOAD_STATE_KEY]: {
        observed: [...observedBrowserDownloads].slice(-200),
        captured: [...capturedBrowserDownloads].slice(-500),
      },
    });
  } catch (_) { /* session persistence is best-effort */ }
}

function queueBrowserStatePersist() {
  if (browserStateTimer || !sessionStorage()) return;
  browserStateTimer = setTimeout(persistBrowserDownloadState, 100);
}

async function restoreBrowserDownloadState() {
  const storage = sessionStorage();
  if (!storage) return;
  try {
    const state = (await storage.get(DOWNLOAD_STATE_KEY))[DOWNLOAD_STATE_KEY] || {};
    for (const row of Array.isArray(state.observed) ? state.observed : []) {
      if (Array.isArray(row) && Number.isInteger(row[0]) && row[1]?.observedAt) observedBrowserDownloads.set(row[0], row[1]);
    }
    for (const id of Array.isArray(state.captured) ? state.captured : []) {
      if (Number.isInteger(id)) capturedBrowserDownloads.add(id);
    }
  } catch (_) { /* use in-memory state only */ }
}

const browserDownloadStateReady = restoreBrowserDownloadState();

function isNewBrowserDownload(item) {
  if (!item || item.id == null || item.endTime || item.error) return false;
  if (item.state && item.state !== "in_progress") return false;
  if (observedBrowserDownloads.has(item.id)) return true;
  const startedAt = Date.parse(item.startTime || "");
  return Number.isFinite(startedAt) && startedAt >= WORKER_STARTED_AT - NEW_DOWNLOAD_GRACE_MS;
}

function observeBrowserDownload(item) {
  if (capturedBrowserDownloads.has(item?.id) || !isNewBrowserDownload(item)) return false;
  if (!observedBrowserDownloads.has(item.id)) {
    observedBrowserDownloads.set(item.id, { startTime: item.startTime || "", observedAt: Date.now() });
    queueBrowserStatePersist();
  }
  return true;
}

async function maybeCaptureBrowserDownload(item, filenameHeld = false) {
  await browserDownloadStateReady;
  if (!isNewBrowserDownload(item) || !observedBrowserDownloads.has(item.id) || capturedBrowserDownloads.has(item.id)) return false;
  if (checkingBrowserDownloads.has(item.id)) return checkingBrowserDownloads.get(item.id);
  const check = (async () => {
    const rs = await rules();
    if (rs.enabled === false) return false;
    const url = item.finalUrl || item.url || "";
    if (!/^https?:/i.test(url) || siteBlocked(rs, url, item.referrer) || matchGlob(rs.blockAddresses, url)) return false;
    const ext = extOf(item.filename || url);
    const typeListed = (rs.autoExts || []).some((entry) => String(entry).replace(/^\./, "").toUpperCase() === ext);
    const size = Math.max(item.fileSize || 0, item.totalBytes || 0);
    if (!typeListed && size < MIN_TAKEOVER) return false;
    if (!chrome.downloads?.pause) return false;
    let pausedByUs = false;
    try {
      await downloadsCall("pause", item.id);
      pausedByUs = true;
    } catch (_) {
      if (!filenameHeld && !heldBrowserDownloads.has(item.id)) return false;
    }
    capturedBrowserDownloads.add(item.id);
    queueBrowserStatePersist();
    try {
      const filename = String(item.filename || "").split(/[\\/]/).pop() || "";
      await post({
        kind: "browser",
        uris: [url],
        options: {
          ...(item.referrer ? { referer: item.referrer } : {}),
          ...(filename ? { filename } : {}),
        },
      });
      try {
        await downloadsCall("cancel", item.id);
        // Remove the cancelled stub so it doesn't linger in the browser's download
        // list now that DownMan owns the file and the browser UI is visible again.
        if (chrome.downloads?.erase) {
          try { await downloadsCall("erase", { id: item.id }); } catch (_) { /* stub cleanup is best-effort */ }
        }
      } catch (error) {
        notifyFailure("DownMan accepted this download, but the browser copy may continue", error);
      }
      observedBrowserDownloads.delete(item.id);
      queueBrowserStatePersist();
      return true;
    } catch (error) {
      capturedBrowserDownloads.delete(item.id);
      observedBrowserDownloads.delete(item.id);
      queueBrowserStatePersist();
      if (pausedByUs && chrome.downloads?.resume) {
        try { await downloadsCall("resume", item.id); } catch (_) { /* browser owns the fallback */ }
      }
      notifyFailure("DownMan could not capture this download", error);
      return false;
    }
  })().finally(() => checkingBrowserDownloads.delete(item.id));
  checkingBrowserDownloads.set(item.id, check);
  return check;
}

async function maybeAdoptCompletedDownload(item) {
  await browserDownloadStateReady;
  if (!item || item.id == null || capturedBrowserDownloads.has(item.id) || !observedBrowserDownloads.has(item.id)) return false;
  if (item.state !== "complete" || !item.filename || !String(item.url || "").startsWith("blob:")) return false;
  const rs = await rules();
  if (rs.enabled === false) return false;
  const ext = extOf(item.filename || "");
  const typeListed = (rs.autoExts || []).some((entry) => String(entry).replace(/^\./, "").toUpperCase() === ext);
  const size = Math.max(item.fileSize || 0, item.totalBytes || 0);
  if (!typeListed && size < MIN_TAKEOVER) return false;
  capturedBrowserDownloads.add(item.id);
  queueBrowserStatePersist();
  try {
    await post({
      kind: "local",
      paths: [item.filename],
      sourceUrl: item.finalUrl || item.url || "",
      options: { referer: item.referrer || "" },
    });
    observedBrowserDownloads.delete(item.id);
    queueBrowserStatePersist();
    if (chrome.downloads?.erase) {
      try { await downloadsCall("erase", { id: item.id }); } catch (_) { /* imported file is already safe */ }
    }
    return true;
  } catch (error) {
    capturedBrowserDownloads.delete(item.id);
    observedBrowserDownloads.delete(item.id);
    queueBrowserStatePersist();
    notifyFailure("DownMan could not import this browser file", error);
    return false;
  }
}

if (chrome.downloads?.onDeterminingFilename) {
  chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
    heldBrowserDownloads.add(item.id);
    void browserDownloadStateReady.then(() => {
      if (!observeBrowserDownload(item)) return false;
      return maybeCaptureBrowserDownload(item, true);
    }).finally(() => {
      heldBrowserDownloads.delete(item.id);
      suggest();
    });
    return true;
  });
}
if (chrome.downloads?.onCreated) {
  chrome.downloads.onCreated.addListener((item) => {
    void browserDownloadStateReady.then(() => {
      if (observeBrowserDownload(item)) return maybeCaptureBrowserDownload(item);
      return false;
    });
  });
}
if (chrome.downloads?.onChanged && chrome.downloads?.search) {
  chrome.downloads.onChanged.addListener((delta) => {
    void browserDownloadStateReady.then(() => {
      if (delta.state?.current === "complete" || delta.state?.current === "interrupted") {
        if (delta.state.current === "complete" && observedBrowserDownloads.has(delta.id) && !capturedBrowserDownloads.has(delta.id)) {
          return downloadsCall("search", { id: delta.id }).then((items) => {
            if (items && items[0]) return maybeAdoptCompletedDownload(items[0]);
            return false;
          });
        }
        observedBrowserDownloads.delete(delta.id);
        queueBrowserStatePersist();
        return false;
      }
      if (!observedBrowserDownloads.has(delta.id) || capturedBrowserDownloads.has(delta.id)) return false;
      if (!delta.filename && !delta.finalUrl && !delta.totalBytes && !delta.fileSize) return false;
      return downloadsCall("search", { id: delta.id }).then((items) => {
        if (items && items[0]) return maybeCaptureBrowserDownload(items[0]);
        return false;
      });
    }).catch(() => {});
  });
}

// --- Reset a tab's detections on full navigation ---
chrome.webRequest.onBeforeRequest.addListener(
  (d) => {
    if (d.type === "main_frame" && d.tabId >= 0) {
      if (restoringLedger) resetDuringRestore.add(d.tabId);
      mediaByTab.delete(d.tabId);
      for (const key of activeMediaByFrame.keys()) {
        if (key.startsWith(`${d.tabId}:`)) activeMediaByFrame.delete(key);
      }
      queuePersist();
    }
  },
  { urls: ["<all_urls>"], types: ["main_frame"] }
);

// --- Sniff real media streams (filters out UI sounds and tiny blips) ---
chrome.webRequest.onHeadersReceived.addListener(
  (d) => {
    if (d.tabId < 0) return;
    if (JUNK_NAME_RE.test(d.url)) return;

    const ctype = header(d.responseHeaders, "content-type").toLowerCase();
    const clen = parseInt(header(d.responseHeaders, "content-length") || "0", 10);
    const partial = d.statusCode === 206 || !!header(d.responseHeaders, "content-range")
      || /[?&](?:bytestart|byteend|range)=/i.test(d.url);
    const isStream = STREAM_RE.test(d.url) || /application\/(?:dash\+xml|x-mpegurl|vnd\.apple\.mpegurl)/.test(ctype);
    const mediaType = /^(?:audio|video)\//.test(ctype);
    const isFile = !isStream && (FILE_RE.test(d.url) || mediaType);
    if (!isStream && !isFile) return;

    if (isFile) {
      if (ctype && !/^(audio|video|application\/(octet-stream|dash|x-mpegurl|vnd\.apple\.mpegurl|mp4))/.test(ctype)) return;
    }

    recordCandidate(d, isStream ? "manifest" : "file", ctype, clen, partial);
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

chrome.tabs.onRemoved.addListener((id) => {
  resetDuringRestore.delete(id);
  mediaByTab.delete(id);
  for (const key of activeMediaByFrame.keys()) {
    if (key.startsWith(`${id}:`)) activeMediaByFrame.delete(key);
  }
  queuePersist();
});

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.dm === "rules-changed") {
    _rules = null;
    _rulesAt = 0;
    rules().catch(() => {});
    reply({ ok: true });
    return;
  }
  if (msg.dm === "file") send([msg.url], msg.referer ? { referer: msg.referer } : {}).then(() => reply({ ok: true })).catch((e) => reply({ ok: false, error: String(e) }));
  if (msg.dm === "site") sendSite(msg.url, msg.format, msg.referer, msg.title, msg.quality).then(() => reply({ ok: true })).catch((e) => reply({ ok: false, error: String(e) }));
  if (msg.dm === "media-observed") ledgerReady.then(() => {
    associateMedia(sender.tab?.id ?? -1, sender.frameId ?? 0, msg.intent);
    reply({ ok: true });
  }).catch(() => reply({ ok: false }));
  if (msg.dm === "media-intent") resolveMediaIntent(sender.tab?.id ?? -1, sender.frameId ?? 0, msg.intent).then(reply).catch((e) => reply({ ok: false, error: String(e) }));
  if (msg.dm === "media-choice") submitMediaBundle(msg.bundle, msg.selectedIndex).then(() => reply({ ok: true })).catch((e) => reply({ ok: false, error: String(e) }));
  if (msg.dm === "formats") fetchFormats(msg.url, msg.referer).then((d) => reply({ ok: true, ...d })).catch((e) => reply({ ok: false, error: String(e) }));
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.action.setBadgeText({ text: "" });
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "dm-grab", title: "Grab files from this page (DownMan)", contexts: ["page"] });
    chrome.contextMenus.create({ id: "dm-link", title: "Download with DownMan", contexts: ["link", "image", "video", "audio"] });
  });
});
async function grabPage(url) {
  const base = await endpoint();
  await fetchWithTimeout(`${base}/grab`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
}

// Ask the content script in the clicked frame for the exact media intent.
function resolveCtxIntent(tab, info, cb) {
  if (!tab || tab.id == null) { cb(null); return; }
  try {
    chrome.tabs.sendMessage(tab.id, { dm: "ctx-url" }, { frameId: info.frameId || 0 }, (res) => {
      if (chrome.runtime.lastError || !res) { cb(null); return; }
      cb(res);
    });
  } catch (_) { cb(null); }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "dm-grab") {
    grabPage(info.pageUrl || info.srcUrl).catch(() => {});
    return;
  }
  // dm-link: links/images download directly; media elements use the same
  // intent/ledger resolver as the in-player button.
  const isAV = info.mediaType === "video" || info.mediaType === "audio";
  if (isAV) {
    resolveCtxIntent(tab, info, (resolved) => {
      if (resolved?.kind === "file" && resolved.url) {
        send([resolved.url], info.pageUrl ? { referer: info.pageUrl } : {}).catch((error) => notifyFailure("DownMan could not add this media", error));
        return;
      }
      if (resolved?.kind !== "intent") {
        const src = /^https?:/i.test(info.srcUrl || "") ? info.srcUrl : "";
        if (!src) {
          notifyFailure("DownMan could not detect this media", "Play it for a moment, then try again.");
          return;
        }
        resolved = {
          kind: "intent",
          intent: {
            schemaVersion: MediaResolver.SCHEMA_VERSION,
            intentId: `context-${Date.now().toString(36)}`,
            trigger: "context-menu",
            triggeredAt: Date.now(),
            frameUrl: info.frameUrl || info.pageUrl || "",
            topUrl: info.pageUrl || "",
            referer: info.frameUrl || info.pageUrl || "",
            element: info.mediaType || "video",
            currentSrc: src,
            sourceKind: "http",
            playing: true,
            viewportArea: 0,
          },
        };
      }
      resolveMediaIntent(tab?.id ?? -1, info.frameId || 0, resolved.intent).then((result) => {
        if (result.code === "choose") {
          chrome.tabs.sendMessage(tab.id, { dm: "media-chooser", result }, { frameId: info.frameId || 0 }, () => {
            if (chrome.runtime.lastError) {
              notifyFailure("DownMan could not show media choices", "Refresh the page, play the media briefly, and try again.");
            }
          });
        } else if (!result.ok) {
          notifyFailure("DownMan needs more media evidence", result.error);
        }
      }).catch((error) => notifyFailure("DownMan could not add this media", error));
    });
    return;
  }
  const url = unwrapUrl(info.linkUrl || info.srcUrl || "");
  if (!url) return;
  if (/^https?:/i.test(url)) {
    send([url], info.pageUrl ? { referer: info.pageUrl } : {}).catch(() => {});
  } else {
    sendSite(info.pageUrl || url, "best", info.pageUrl).catch(() => {});
  }
});
