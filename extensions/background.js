// DownMan Connector — background service worker.
// Intercepts downloads and keeps detected media as an invisible fallback for
// per-media buttons on blob/MSE players.

const DEFAULT_ENDPOINT = "http://127.0.0.1:6802";
// Adaptive manifests are always interesting.
const STREAM_RE = /\.(m3u8|mpd)(\?|$)/i;
// Progressive media files (kept only if large enough — see MIN_FILE).
const FILE_RE = /\.(mp4|webm|mkv|m4a|mp3|aac|flac|ts|mov|ogg|wav|opus)(\?|$)/i;
// Any directly-downloadable file (video OR image) — these go straight to aria2.
const DIRECT_FILE_RE = /\.(mp4|m4v|webm|mkv|mov|m4a|mp3|aac|flac|ogg|wav|opus|ts|gif|jpe?g|png|webp|avif|bmp|svg)(\?|$)/i;
// Reddit (and similar) wrap the real media in a viewer link like
// reddit.com/media?url=<encoded real url> — unwrap it to the actual file.
function unwrapUrl(url) {
  try {
    const u = new URL(url);
    const inner = u.searchParams.get("url");
    if (inner && /\/media$/i.test(u.pathname)) return inner;
  } catch (_) { /* ignore */ }
  return url;
}
// UI sounds / notification blips that look like media but aren't (e.g. YouTube).
const JUNK_NAME_RE = /\/(failure|success|open|close|no_input|notification|click|ding|dong|pop|beep|silence|blank|error|alert|chime|tone|tick|swoosh|whoosh)\.(mp3|m4a|wav|ogg|aac|opus)(\?|$)/i;
const JUNK_HOST_RE = /(gstatic\.com|google\.com\/recaptcha|fonts\.|doubleclick|googlesyndication)/i;
const MIN_FILE = 1024 * 1024; // ignore progressive media smaller than 1 MB
const MIN_TAKEOVER = 8 * 1024 * 1024; // hand large files to DownMan
const mediaByTab = new Map(); // tabId -> Map(url -> {url,type,size,contentType,frameId,seen})

function header(headers, name) {
  const h = headers && headers.find((x) => x.name.toLowerCase() === name);
  return h ? h.value || "" : "";
}

async function endpoint() {
  const { server } = await chrome.storage.local.get("server");
  return server || DEFAULT_ENDPOINT;
}

async function post(payload) {
  const base = await endpoint();
  const r = await fetch(`${base}/add`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error("DownMan offline");
}

async function cookiesPref() {
  const { cookies } = await chrome.storage.local.get("cookies");
  return cookies || "";
}

// --- Interception rules (fetched from the app, cached briefly) ---
let _rules = null;
let _rulesAt = 0;
async function rules() {
  const now = Date.now();
  if (_rules && now - _rulesAt < 60000) return _rules;
  try {
    const base = await endpoint();
    const r = await fetch(`${base}/rules`);
    if (r.ok) {
      _rules = await r.json();
      _rulesAt = now;
    }
  } catch {}
  return _rules || { enabled: true, autoExts: [], blockSites: [], blockAddresses: [] };
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

// Capture a whole page/site via yt-dlp (YouTube, Vimeo, 1800+ sites + generic).
async function sendSite(url, format = "best", referer = "", title = "", quality = "") {
  url = unwrapUrl(url);
  // If the URL is (or unwrapped to) a direct file, download it straight via aria2
  // rather than handing an unsupported URL (e.g. reddit.com/media?url=…) to yt-dlp.
  if (DIRECT_FILE_RE.test(url)) return send([url], referer ? { referer } : {});
  return post({ kind: "page", uris: [url], options: { format, referer, title, quality, cookies: await cookiesPref() } });
}

// Capture a sniffed stream URL, forwarding the page as Referer so CDNs don't 403.
async function sendStream(url, referer = "") {
  return post({ kind: "stream", uris: [url], options: { referer, cookies: await cookiesPref() } });
}

async function sendDetectedOrSite(tabId, frameId, url, referer = "") {
  const detected = [...(mediaByTab.get(tabId)?.values() || [])];
  const newest = (items) => items.sort((a, b) => (b.seen || 0) - (a.seen || 0))[0];
  const sameFrame = detected.filter((item) => item.frameId === frameId);
  const candidates = sameFrame.length ? sameFrame : detected;
  const candidate = newest(candidates.filter((item) => item.type === "stream"))
    || newest(candidates.filter((item) => /^video\//i.test(item.contentType || "")))
    || newest(candidates.filter((item) => !/^audio\//i.test(item.contentType || "")));
  if (!candidate) return sendSite(url, "best", referer);
  if (candidate.type === "stream") return sendStream(candidate.url, referer);
  return send([candidate.url], referer ? { referer } : {});
}

// Ask the app for the real, per-video quality list (yt-dlp -J under the hood).
async function fetchFormats(url, referer = "") {
  const base = await endpoint();
  const r = await fetch(`${base}/formats`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url, referer, cookies: await cookiesPref() }),
  });
  if (!r.ok) throw new Error("DownMan offline");
  const data = await r.json();
  if (data.error) throw new Error(data.error);
  return data; // { title, formats: [{ selector, label, kind, height, ext, size }] }
}

// --- Hand off browser downloads (Chrome-only API; Firefox has no onDeterminingFilename) ---
if (chrome.downloads && chrome.downloads.onDeterminingFilename) {
chrome.downloads.onDeterminingFilename.addListener((item) => {
  (async () => {
    const { intercept } = await chrome.storage.local.get("intercept");
    if (intercept !== true) return; // browser-download auto-capture is opt-in (click-only by default)
    const rs = await rules();
    if (rs.enabled === false) return;
    const url = item.finalUrl || item.url;
    if (siteBlocked(rs, url, item.referrer) || matchGlob(rs.blockAddresses, url)) return;
    const ext = extOf(item.filename || url);
    const typeListed = rs.autoExts && rs.autoExts.length ? matchGlob(rs.autoExts, ext) : false;
    const bigEnough = item.fileSize > 0 && item.fileSize >= MIN_TAKEOVER;
    // Grab when the file type is on the auto-download list, or (fallback) it's a big file.
    if (!typeListed && !bigEnough) return;
    chrome.downloads.cancel(item.id);
    send([url], item.referrer ? { referer: item.referrer } : {}).catch(() => {});
  })();
});
}

// --- Reset a tab's detections on full navigation ---
chrome.webRequest.onBeforeRequest.addListener(
  (d) => {
    if (d.type === "main_frame" && d.tabId >= 0) {
      mediaByTab.delete(d.tabId);
    }
  },
  { urls: ["<all_urls>"], types: ["main_frame"] }
);

// --- Sniff real media streams (filters out UI sounds and tiny blips) ---
chrome.webRequest.onHeadersReceived.addListener(
  (d) => {
    if (d.tabId < 0) return;
    const isStream = STREAM_RE.test(d.url);
    const isFile = !isStream && FILE_RE.test(d.url);
    if (!isStream && !isFile) return;
    if (JUNK_NAME_RE.test(d.url) || JUNK_HOST_RE.test(d.url)) return;

    const ctype = header(d.responseHeaders, "content-type").toLowerCase();
    const clen = parseInt(header(d.responseHeaders, "content-length") || "0", 10);

    if (isFile) {
      if (clen && clen < MIN_FILE) return; // skip small UI audio/sprites
      if (ctype && !/^(audio|video|application\/(octet-stream|dash|x-mpegurl|vnd\.apple\.mpegurl|mp4))/.test(ctype)) return;
    }

    const m = mediaByTab.get(d.tabId) || new Map();
    m.set(d.url, { url: d.url, type: isStream ? "stream" : "file", size: clen, contentType: ctype, frameId: d.frameId, seen: Date.now() });
    mediaByTab.set(d.tabId, m);
  },
  { urls: ["<all_urls>"] },
  ["responseHeaders"]
);

chrome.tabs.onRemoved.addListener((id) => mediaByTab.delete(id));

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg.dm === "file") send([msg.url], msg.referer ? { referer: msg.referer } : {}).then(() => reply({ ok: true })).catch((e) => reply({ ok: false, error: String(e) }));
  if (msg.dm === "site") sendSite(msg.url, msg.format, msg.referer, msg.title, msg.quality).then(() => reply({ ok: true })).catch((e) => reply({ ok: false, error: String(e) }));
  if (msg.dm === "media-download") sendDetectedOrSite(sender.tab?.id ?? -1, sender.frameId ?? 0, msg.url, msg.referer).then(() => reply({ ok: true })).catch((e) => reply({ ok: false, error: String(e) }));
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
  await fetch(`${base}/grab`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url }) });
}

// Ask the content script (in the clicked frame) to resolve the real URL for the
// media under the last right-click — feed videos are blob/MSE with no file URL
// but sit inside a link/permalink to their post.
function resolveCtxUrl(tab, info, cb) {
  if (!tab || tab.id == null) { cb(null); return; }
  try {
    chrome.tabs.sendMessage(tab.id, { dm: "ctx-url" }, { frameId: info.frameId || 0 }, (res) => {
      if (chrome.runtime.lastError || !res) { cb(null); return; }
      cb(res.url || null, res.kind);
    });
  } catch (_) { cb(null); }
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "dm-grab") {
    grabPage(info.pageUrl || info.srcUrl).catch(() => {});
    return;
  }
  // dm-link: links/images download directly; media elements resolve to the
  // specific post's real URL (its permalink) via the content script.
  const isAV = info.mediaType === "video" || info.mediaType === "audio";
  if (isAV) {
    resolveCtxUrl(tab, info, (u, kind) => {
      if (!u) { sendSite(info.pageUrl, "best", info.pageUrl).catch(() => {}); return; }
      if (kind === "file") send([u], info.pageUrl ? { referer: info.pageUrl } : {}).catch(() => {});
      else sendSite(u, "best", info.pageUrl || u).catch(() => {});
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
