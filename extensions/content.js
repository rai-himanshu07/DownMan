// DownMan content script: a per-media Download button that targets the exact
// video or audio under the pointer. Some sites also get an explicit quality menu.

const Z = 2147483647;
const TOP = window.top === window;
const MEDIA_SCHEMA_VERSION = 2;
const MediaResolver = globalThis.DownManMediaResolver;
// Verbose per-action diagnostics. Off for releases; flip to true and reload the
// extension to trace media-intent/result/resolve decisions in the console.
const DM_DEBUG = false;
const mediaIds = new WeakMap();
const mediaObservedAt = new WeakMap();
let mediaSequence = 0;

function el(tag, css, html) {
  const e = document.createElement(tag);
  if (css) e.style.cssText = css;
  if (html != null) e.innerHTML = html;
  return e;
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Messaging that survives the extension being reloaded/updated. A stale content
// script (old context) throws "Extension context invalidated" on sendMessage —
// catch it and tell the user to refresh instead of emitting uncaught errors.
function rt(msg, cb) {
  try {
    if (!chrome.runtime || !chrome.runtime.id) throw 0;
    chrome.runtime.sendMessage(msg, (res) => {
      const err = chrome.runtime.lastError; // read it to silence the console warning
      if (!cb) return;
      if (!err) {
        cb(res);
        return;
      }
      const message = String(err.message || err);
      const invalidated = !chrome.runtime?.id || /context invalidated|extension.*reloaded/i.test(message);
      cb({ ok: false, error: invalidated ? "Extension reloaded — refresh this page" : message || "DownMan extension worker is unavailable" });
    });
  } catch (_) {
    if (cb) cb({ ok: false, error: "Extension reloaded — refresh this page" });
  }
}

/* ============================ per-video button ============================ */
let btn, menu, target = null, hideT = null, menuOpen = false, suppressed = null;
let curTitle = ""; // title of the last-rendered format list (sent with the pick)
// Cache the (slow) yt-dlp format lookups so re-opening the menu is instant.
const fmtCache = new Map(); // url -> { formats, title, ts }
const FMT_TTL = 5 * 60 * 1000;

// Only offer a button for media a human would actually want to save.
function worthy(v) {
  if (v.tagName === "AUDIO") {
    const ar = v.getBoundingClientRect();
    if (ar.width < 120 || ar.height < 20) return false;       // needs a visible player
    const src = v.currentSrc || v.src || "";
    return (v.controls || (v.duration && v.duration > 30)) && !!src;
  }
  const r = v.getBoundingClientRect();
  if (r.width < 240 || r.height < 150) return false;          // thumbnails / icons
  return true;
}

// Any directly-downloadable file (video OR image) — gifs/images/progressive video
// should go straight to aria2 rather than through yt-dlp.
const DIRECT_FILE_RE = /\.(mp4|m4v|webm|mkv|mov|m4a|mp3|aac|flac|ogg|wav|opus|ts|gif|jpe?g|png|webp|avif|bmp|svg)(\?|$)/i;

// Some sites wrap the real media in a viewer link like
// <host>/media?url=<encoded real url> — unwrap it to the actual file.
function unwrapMediaUrl(url) {
  try {
    const u = new URL(url, location.href);
    const inner = u.searchParams.get("url");
    if (inner && /\/media$/i.test(u.pathname)) return inner;
  } catch (_) { /* ignore */ }
  return url;
}

// A directly-downloadable file for a media element: its own src, or the real file
// behind a nearby viewer link. Returns null if only a stream/permalink is available.
function directFileFor(m) {
  if (!m) return null;
  const src = m.currentSrc || m.src || "";
  if (/^https?:/i.test(src) && DIRECT_FILE_RE.test(src)) return src;
  if (m.closest) {
    const a = m.closest("a[href]");
    if (a) {
      const real = unwrapMediaUrl(a.href);
      if (/^https?:/i.test(real) && DIRECT_FILE_RE.test(real)) return real;
    }
  }
  return null;
}

function mediaIdFor(media) {
  if (!mediaIds.has(media)) {
    mediaSequence += 1;
    mediaIds.set(media, `${Date.now().toString(36)}-${mediaSequence.toString(36)}`);
  }
  return mediaIds.get(media);
}

// The innermost nested post boundary between the media and its article. Some sites
// render a quoted or embedded post as a role="link" block that navigates to its OWN
// permalink, so a video inside one belongs to that inner post, never the outer post.
function nestedPostUnit(media, article) {
  if (!media || !article) return null;
  let node = media.parentElement;
  while (node && node !== article) {
    if (node.getAttribute?.("role") === "link") return node;
    node = node.parentElement;
  }
  return null;
}

function nearbyPageUrls(media) {
  const ranked = new Map();
  const current = MediaResolver.pageIdentity(location.href);
  const article = media.closest?.("article, [role='article']");
  const mediaUnit = nestedPostUnit(media, article);

  function distanceToMedia(node) {
    const mediaAncestors = new Map();
    let currentNode = media;
    let depth = 0;
    while (currentNode) {
      mediaAncestors.set(currentNode, depth++);
      currentNode = currentNode.parentElement;
    }
    currentNode = node;
    depth = 0;
    while (currentNode) {
      if (mediaAncestors.has(currentNode)) return depth + mediaAncestors.get(currentNode);
      currentNode = currentNode.parentElement;
      depth += 1;
    }
    return Number.POSITIVE_INFINITY;
  }

  function add(rawUrl, proximity, bound, anchor, binding) {
    if (!rawUrl) return;
    try {
      const identity = MediaResolver.pageIdentity(rawUrl, location.href);
      const url = new URL(identity.url);
      if (!/^https?:$/.test(url.protocol) || url.origin !== location.origin) return;
      if (url.pathname === "/" || DIRECT_FILE_RE.test(url.href)) return;
      const segments = url.pathname.split("/").filter(Boolean);
      const idLike = segments.some((segment) => /\d/.test(segment) || segment.length >= 8);
      const hasTime = !!anchor?.querySelector?.("time");
      const imageOnly = !!anchor?.querySelector?.("img") && !(anchor?.textContent || "").trim();
      const strength = Math.min(40, proximity + segments.length * 3 + (idLike ? 8 : 0) + (hasTime ? 10 : 0) - (imageOnly ? 8 : 0));
      if (strength < 10) return;
      const previous = ranked.get(identity.key);
      const candidate = {
        url: identity.url,
        identityKey: identity.key,
        strength: Math.max(strength, previous?.strength || 0),
        bound: !!(bound || previous?.bound),
        binding: binding || previous?.binding || "nearby",
      };
      ranked.set(identity.key, candidate);
    } catch (_) { /* ignore malformed page links */ }
  }

  // Bind only a permalink that lives in the SAME post unit as the clicked media,
  // so the outer post's link is never attached to an embedded/related video and an
  // embedded permalink is never attached to the outer video.
  function bindNearestStatus(scope) {
    if (!scope) return;
    const links = [...scope.querySelectorAll("a[href]")]
      .map((anchor) => {
        try {
          const identity = MediaResolver.pageIdentity(anchor.href, location.href);
          const hasTime = !!anchor.querySelector("time");
          if (!identity.specific && !hasTime) return null;
          return { anchor, identity, hasTime, distance: distanceToMedia(anchor), unit: nestedPostUnit(anchor, article) };
        } catch (_) {
          return null;
        }
      })
      .filter(Boolean)
      .filter((entry) => entry.unit === mediaUnit)
      .sort((left, right) => left.distance - right.distance || Number(right.hasTime) - Number(left.hasTime));
    const nearest = links[0];
    if (nearest) add(nearest.identity.url, nearest.hasTime ? 40 : 30, true, nearest.anchor, nearest.hasTime ? "timestamp" : "semantic-link");
  }

  if (mediaUnit && mediaUnit.tagName === "A" && mediaUnit.getAttribute("href")) {
    add(mediaUnit.getAttribute("href"), 38, true, mediaUnit, "quoted-link");
  } else if (!mediaUnit) {
    const closestAnchor = media.closest?.("a[href]");
    if (closestAnchor && !nestedPostUnit(closestAnchor, article)) add(closestAnchor.href, 32, true, closestAnchor, "ancestor");
  }

  bindNearestStatus(mediaUnit || article);

  // The current document is the OUTER post's permalink; only trust it for the outer
  // post's own video, so an embedded/related video is never bound to the post URL.
  if (current.specific && !mediaUnit) add(current.url, 40, true, document.documentElement, "document");

  return [...ranked.values()].sort((left, right) => right.strength - left.strength).slice(0, 3);
}

// Some sites name a video's media by an ID that appears both in the
// player's poster thumbnail and in its HLS manifest URL. Capturing it lets the
// resolver pick the EXACT manifest for the clicked player even when one post
// holds several videos that share a page URL.
function mediaKeysFor(media) {
  const keys = new Set();
  const urls = [media.poster, media.currentSrc, media.src];
  media.querySelectorAll?.("source").forEach((source) => urls.push(source.src || source.getAttribute?.("src")));
  for (const url of urls) {
    const match = String(url || "").match(/(?:amplify_video|ext_tw_video|tweet_video)(?:_thumb)?\/([A-Za-z0-9]+)/);
    if (match) keys.add(match[1]);
  }
  return [...keys];
}

function mediaIntent(media, trigger) {
  const rect = media.getBoundingClientRect();
  const owner = media.closest?.("article, [role='article']");
  const documentIdentity = MediaResolver.pageIdentity(location.href);
  const visibleWidth = Math.max(0, Math.min(rect.right, innerWidth) - Math.max(rect.left, 0));
  const visibleHeight = Math.max(0, Math.min(rect.bottom, innerHeight) - Math.max(rect.top, 0));
  const direct = directFileFor(media);
  const currentSrc = direct || media.currentSrc || media.src || "";
  return {
    schemaVersion: MEDIA_SCHEMA_VERSION,
    intentId: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`,
    mediaId: mediaIdFor(media),
    trigger,
    triggeredAt: Date.now(),
    frameUrl: location.href,
    topUrl: TOP ? location.href : document.referrer || "",
    title: document.title || "",
    referer: location.href,
    pageUrls: nearbyPageUrls(media),
    feedContext: !!owner,
    nested: !!nestedPostUnit(media, owner),
    mediaKeys: mediaKeysFor(media),
    contextKind: documentIdentity.specific ? "detail" : owner ? "collection" : "document",
    ownerMediaCount: owner?.querySelectorAll?.("video, audio").length || 1,
    element: media.tagName.toLowerCase(),
    currentSrc,
    sourceKind: /^https?:/i.test(currentSrc) ? "http" : /^blob:/i.test(currentSrc) ? "blob" : "empty",
    playing: !media.paused && !media.ended,
    muted: !!media.muted,
    duration: Number.isFinite(media.duration) ? media.duration : null,
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    viewportArea: Math.round(visibleWidth * visibleHeight),
  };
}

function observeMedia(media, trigger) {
  const now = Date.now();
  if (now - (mediaObservedAt.get(media) || 0) < 1500) return;
  mediaObservedAt.set(media, now);
  rt({ dm: "media-observed", intent: mediaIntent(media, trigger) });
}

function build() {
  if (btn) return;
  btn = el(
    "div",
    "display:none;align-items:center;gap:6px;position:fixed;z-index:" + Z +
      ";background:linear-gradient(135deg,#1f93ff,#f04ec0);color:#fff;border-radius:10px;padding:8px 12px;" +
      "font:700 12px Inter,system-ui,sans-serif;cursor:pointer;box-shadow:0 6px 20px -6px rgba(31,147,255,.7);user-select:none"
  );
  // A label span (status text updates here) + a ✕ to dismiss the button so it
  // never blocks the player's own controls on an embed we can't escape.
  const lbl = el("span", "display:inline-flex;align-items:center;gap:6px", '<span style="font-size:15px;line-height:1">⤓</span> Download');
  lbl.className = "dm-lbl";
  const quality = el("span", "display:none;padding-left:7px;border-left:1px solid rgba(255,255,255,.4);font-size:11px;line-height:1", "Quality ▾");
  quality.className = "dm-quality";
  quality.title = "Choose video quality";
  quality.onclick = (e) => { e.stopPropagation(); e.preventDefault(); openMenu(); };
  const x = el("span", "padding-left:7px;border-left:1px solid rgba(255,255,255,.4);opacity:.9;font-size:13px;line-height:1", "✕");
  x.title = "Hide (lets you use the player's controls)";
  x.onclick = (e) => { e.stopPropagation(); e.preventDefault(); dismissBtn(); };
  btn.appendChild(lbl);
  btn.appendChild(quality);
  btn.appendChild(x);
  btn.onmouseenter = () => clearTimeout(hideT);
  btn.onmouseleave = scheduleHide;
  btn.onclick = onClick;

  menu = el(
    "div",
    "display:none;position:fixed;z-index:" + Z +
      ";width:256px;max-height:320px;overflow:auto;background:rgba(17,20,33,.97);backdrop-filter:blur(14px);" +
      "border:1px solid rgba(255,255,255,.12);border-radius:12px;box-shadow:0 16px 50px -12px rgba(0,0,0,.7);" +
      "font:600 12px Inter,system-ui,sans-serif;color:#fff"
  );
  menu.onmouseenter = () => clearTimeout(hideT);
  menu.onmouseleave = scheduleHide;

  document.body.appendChild(btn);
  document.body.appendChild(menu);
}

function showFor(v) {
  build();
  if (menuOpen) { clearTimeout(hideT); return; } // keep an already-open menu intact
  if (v === suppressed) return; // user dismissed the button for this media
  target = v;
  menu.style.display = "none";
  setLabel('<span style="font-size:15px;line-height:1">⤓</span> Download');
  const quality = btn.querySelector(".dm-quality");
  if (quality) quality.style.display = supportsExactQuality(scoped()) ? "inline-flex" : "none";
  btn.style.display = "flex";
  placeButton(v);
}

function placeButton(v) {
  const r = v.getBoundingClientRect();
  const bh = btn.offsetHeight || 34;
  const above = r.top - bh - 6;
  // Hang just outside the top-right corner so we don't cover the player's own
  // controls (e.g. the player's own info/share buttons); sit inside only if there's no room above.
  btn.style.top = (above >= 8 ? above : r.top + 8) + "px";
  const visibleRight = Math.min(r.right, innerWidth - 8);
  btn.style.left = Math.max(8, visibleRight - btn.offsetWidth) + "px";
}
function scheduleHide() {
  if (menuOpen) return; // never hide while the quality menu is open or loading
  clearTimeout(hideT);
  hideT = setTimeout(() => {
    if (menuOpen) return;
    if (btn) btn.style.display = "none";
    if (menu) menu.style.display = "none";
  }, 450);
}
// The ✕ on the button: hide it so the user can reach the player's own controls
// underneath (which we can't move out from under on a cross-origin embed). It
// comes back when the pointer leaves the media and returns.
function dismissBtn() {
  suppressed = target;
  menuOpen = false;
  detachDismiss();
  clearTimeout(hideT);
  if (btn) btn.style.display = "none";
  if (menu) menu.style.display = "none";
}
function setLabel(t) {
  const lbl = btn && btn.querySelector(".dm-lbl");
  if (lbl) lbl.innerHTML = t;
}
function reset() {
  setLabel('<span style="font-size:15px;line-height:1">⤓</span> Download');
}
function done(res) {
  const reload = res && !res.ok && /refresh|reload/i.test(res.error || "");
  const openPost = res && !res.ok && /open .*post/i.test(res.error || "");
  const playFirst = res && !res.ok && /play (?:the )?(?:video|media)|no media/i.test(res.error || "");
  const workerUnavailable = res && !res.ok && /receiving end|message port|worker/i.test(res.error || "");
  setLabel(res && res.ok ? "Sent ✓" : reload ? "Refresh page ↻" : openPost ? "Open post, retry" : playFirst ? "Play video, retry" : workerUnavailable ? "Extension unavailable" : "App offline");
  setTimeout(reset, 1900);
}

let pendingMediaBundle = null;

function handleMediaResult(res) {
  if (res && res.code === "choose" && res.bundle && Array.isArray(res.choices)) {
    showCandidateChooser(res);
    return;
  }
  done(res);
}

function showCandidateChooser(result) {
  build();
  if (target) showFor(target);
  pendingMediaBundle = result.bundle;
  menuOpen = true;
  clearTimeout(hideT);
  attachDismiss();
  setLabel("Choose source");
  menu.innerHTML = "";
  const head = el("div", "display:flex;align-items:center;gap:8px;padding:9px 13px;font-size:11px;color:#8b93b0;border-bottom:1px solid rgba(255,255,255,.08)");
  head.appendChild(el("span", "flex:1", "Choose the media you meant"));
  const close = el("span", "cursor:pointer;opacity:.6;font-size:14px;line-height:1;padding:0 2px", "✕");
  close.onclick = closeMenu;
  head.appendChild(close);
  menu.appendChild(head);
  result.choices.forEach((choice) => {
    const row = el(
      "div",
      "padding:9px 13px;cursor:pointer;border-bottom:1px solid rgba(255,255,255,.04)",
      `<div>${esc(choice.label)}</div><div style="margin-top:3px;color:#8b93b0;font-size:10px;font-weight:500">${esc(choice.detail || "")}</div>`
    );
    row.onmouseenter = () => (row.style.background = "rgba(31,147,255,.2)");
    row.onmouseleave = () => (row.style.background = "transparent");
    row.onclick = () => pickMediaCandidate(choice.index);
    menu.appendChild(row);
  });
  placeMenu();
  menu.style.display = "block";
}

function pickMediaCandidate(index) {
  const bundle = pendingMediaBundle;
  pendingMediaBundle = null;
  menuOpen = false;
  detachDismiss();
  menu.style.display = "none";
  setLabel("Sending…");
  rt({ dm: "media-choice", bundle, selectedIndex: index }, done);
}

// Explicit quality selection is a page-extractor workflow. Generic media capture
// below does not guess post permalinks or maintain a site allowlist.
function scoped() {
  return location.href;
}

function supportsExactQuality(url) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === "youtu.be" || host === "youtube.com" || host.endsWith(".youtube.com")
      || host === "youtube-nocookie.com" || host.endsWith(".youtube-nocookie.com");
  } catch (_) {
    return false;
  }
}

// Remember the exact media player under the context-menu click. The background
// correlates this intent with network evidence from the same frame and session.
let lastCtx = { intent: null, wrapFile: null };
document.addEventListener(
  "contextmenu",
  (e) => {
    const t = e.target;
    let m = t && t.closest ? t.closest("video, audio") : null;
    if (!m && t && t.tagName === "VIDEO") m = t;
    if (!m) m = mediaAtPoint(e.clientX, e.clientY);
    let wrapFile = null;
    if (t && t.closest) {
      // A media-viewer link in the click ancestry (e.g. a /media?url=… viewer wrapper).
      const a = t.closest("a[href]");
      if (a) {
        const real = unwrapMediaUrl(a.href);
        if (/^https?:/i.test(real) && DIRECT_FILE_RE.test(real)) wrapFile = real;
      }
    }
    if (m) target = m;
    const intent = m ? mediaIntent(m, "context-menu") : null;
    if (intent && wrapFile && !/^https?:/i.test(intent.currentSrc || "")) {
      intent.currentSrc = wrapFile;
      intent.sourceKind = "http";
    }
    lastCtx = { intent, wrapFile };
  },
  true
);

function onClick() {
  let v = target;
  if (!v || !v.isConnected || !worthy(v)) {
    const fallback = mediaAtPoint(pointX, pointY);
    if (fallback) v = fallback;
  }
  if (!v || !v.isConnected || !worthy(v)) {
    if (DM_DEBUG) console.log("[DownMan] Download clicked but no media is under the button", { hadTarget: !!target });
    done({ ok: false, error: "Play the media briefly, then retry Download." });
    return;
  }
  target = v;
  setLabel("Sending…");
  let intent;
  try {
    intent = mediaIntent(v, "button");
  } catch (err) {
    console.error("[DownMan] failed to read the clicked media", err);
    done({ ok: false, error: "Extension reloaded — refresh this page" });
    return;
  }
  if (DM_DEBUG) console.log("[DownMan] media-intent", JSON.stringify({
    build: "1.1.0",
    context: intent.contextKind,
    element: intent.element,
    currentSrc: intent.currentSrc,
    ownerMediaCount: intent.ownerMediaCount,
    nested: intent.nested,
    mediaKeys: intent.mediaKeys,
    pageUrls: intent.pageUrls,
  }));
  rt({ dm: "media-intent", intent }, (res) => {
    if (DM_DEBUG) console.log("[DownMan] media-result", JSON.stringify(res));
    handleMediaResult(res);
  });
}

function openMenu() {
  build();
  menuOpen = true;
  clearTimeout(hideT);
  attachDismiss();
  const url = scoped();
  const cached = fmtCache.get(url);
  if (cached && Date.now() - cached.ts < FMT_TTL) {
    render(cached.formats, cached.title);
    placeMenu();
    menu.style.display = "block";
    return;
  }
  menu.innerHTML = '<div style="padding:11px 13px;color:#9aa3c0">Loading qualities…</div>';
  placeMenu();
  menu.style.display = "block";
  rt({ dm: "formats", url, referer: location.href }, (res) => {
    if (!menuOpen) return; // user dismissed it while we waited
    if (!res || !res.ok) {
      menu.innerHTML = '<div style="padding:11px 13px;color:#ff8b8b">' + esc((res && res.error) || "Could not read formats") + "</div>";
      return;
    }
    fmtCache.set(url, { formats: res.formats || [], title: res.title || "", ts: Date.now() });
    render(res.formats || [], res.title || "");
    placeMenu();
  });
}

function placeMenu() {
  const b = btn.getBoundingClientRect();
  const mh = Math.min(320, menu.offsetHeight || 320);
  let top = b.bottom + 6;
  if (top + mh > innerHeight - 8) top = Math.max(8, b.top - 6 - mh); // flip above if it would overflow
  menu.style.top = top + "px";
  menu.style.left = Math.max(8, Math.min(b.right - 256, innerWidth - 264)) + "px";
}

function render(formats, title) {
  curTitle = title || "";
  if (!formats.length) {
    menu.innerHTML = '<div style="padding:11px 13px;color:#ff8b8b">No downloadable formats</div>';
    return;
  }
  menu.innerHTML = "";
  const head = el("div", "display:flex;align-items:center;gap:8px;padding:9px 13px;font-size:11px;color:#8b93b0;border-bottom:1px solid rgba(255,255,255,.08)");
  head.appendChild(el("span", "flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis", title ? esc(title) : "Choose quality"));
  const x = el("span", "cursor:pointer;opacity:.6;font-size:14px;line-height:1;padding:0 2px", "✕");
  x.onclick = closeMenu;
  head.appendChild(x);
  menu.appendChild(head);
  formats.forEach((f) => {
    const tag = f.kind === "audio" ? "♪" : f.kind === "video" ? "▷" : "◆";
    const row = el(
      "div",
      "padding:9px 13px;cursor:pointer;display:flex;align-items:center;gap:9px;border-bottom:1px solid rgba(255,255,255,.04)",
      '<span style="opacity:.6;width:12px;text-align:center">' + tag + "</span><span>" + esc(f.label) + "</span>"
    );
    row.onmouseenter = () => (row.style.background = "rgba(31,147,255,.2)");
    row.onmouseleave = () => (row.style.background = "transparent");
    row.onclick = () => pick(f.selector, f.label);
    menu.appendChild(row);
  });
}

function pick(selector, label) {
  menuOpen = false;
  detachDismiss();
  menu.style.display = "none";
  setLabel("Sending…");
  rt({ dm: "site", url: scoped(), format: selector, referer: location.href, title: curTitle, quality: label || "" }, done);
}

function closeMenu() {
  menuOpen = false;
  pendingMediaBundle = null;
  detachDismiss();
  if (menu) menu.style.display = "none";
  scheduleHide();
}
function attachDismiss() {
  detachDismiss();
  // Defer so the very click that opened the menu doesn't instantly close it.
  setTimeout(() => {
    if (!menuOpen) return;
    document.addEventListener("mousedown", onDocDown, true);
    document.addEventListener("keydown", onKeyDown, true);
  }, 0);
}
function detachDismiss() {
  document.removeEventListener("mousedown", onDocDown, true);
  document.removeEventListener("keydown", onKeyDown, true);
}
function onDocDown(e) {
  if ((menu && menu.contains(e.target)) || (btn && btn.contains(e.target))) return;
  closeMenu();
}
function onKeyDown(e) {
  if (e.key === "Escape") closeMenu();
}

// Players often put an interaction overlay above <video>, so delegated mouseover
// never targets the media itself. Walk the full hit-test stack and
// nearby containers to find the actual player under the pointer.
function mediaAtPoint(x, y) {
  const candidates = new Set();
  const roots = new Set();
  for (const node of document.elementsFromPoint(x, y)) {
    if (isMedia(node)) candidates.add(node);
    if (node.closest) {
      const direct = node.closest("video, audio");
      if (direct) candidates.add(direct);
      const feed = node.closest("[role='article'], article");
      if (feed) roots.add(feed);
      let container = node;
      for (let depth = 0; container && depth < 4; depth++, container = container.parentElement) {
        if (container.querySelector) roots.add(container);
      }
    }
  }
  let scanned = 0;
  for (const root of roots) {
    if (scanned++ >= 6) break;
    if (root.querySelectorAll) root.querySelectorAll("video, audio").forEach((media) => candidates.add(media));
  }
  const containing = [...candidates].filter((media) => {
    if (!media.isConnected || !worthy(media)) return false;
    const r = media.getBoundingClientRect();
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
  });
  return containing.length === 1 ? containing[0] : null;
}

function revealPlayingMedia(root) {
  const items = [];
  if (isMedia(root)) items.push(root);
  if (root && root.querySelectorAll) root.querySelectorAll("video, audio").forEach((media) => items.push(media));
  const playable = items.filter((media) => !media.paused && !media.ended && media.readyState >= 2 && worthy(media) && media !== suppressed);
  playable.forEach((media) => {
    observeMedia(media, "playing");
  });
  if (playable.length === 1) {
    const media = playable[0];
    clearTimeout(hideT);
    showFor(media);
    clearTimeout(window.__dmPlayHide);
    window.__dmPlayHide = setTimeout(scheduleHide, 4000);
  }
}

// Hover detection (delegated; cheap) + keep the button glued while scrolling.
function isMedia(t) {
  return t && (t.tagName === "VIDEO" || t.tagName === "AUDIO");
}
document.addEventListener(
  "mouseover",
  (e) => {
    const v = isMedia(e.target) ? e.target : null;
    if (v && worthy(v)) {
      clearTimeout(hideT);
      showFor(v);
    }
  },
  true
);

let pointFrame = 0;
let pointX = 0;
let pointY = 0;
let lastPointScan = 0;
document.addEventListener(
  "pointermove",
  (e) => {
    if ((btn && btn.contains(e.target)) || (menu && menu.contains(e.target))) return;
    pointX = e.clientX;
    pointY = e.clientY;
    if (pointFrame) return;
    pointFrame = requestAnimationFrame(() => {
      pointFrame = 0;
      const now = performance.now();
      if (now - lastPointScan < 80) return;
      lastPointScan = now;
      const media = mediaAtPoint(pointX, pointY);
      if (media) {
        clearTimeout(hideT);
        showFor(media);
      } else if (btn && btn.style.display !== "none" && !menuOpen) {
        scheduleHide();
      }
    });
  },
  true
);
document.addEventListener(
  "mouseout",
  (e) => {
    if (isMedia(e.target)) { suppressed = null; scheduleHide(); }
  },
  true
);
// Reveal the capture button on the media you actually start playing, then
// let it fade if you don't reach for it.
document.addEventListener(
  "playing",
  (e) => {
    const v = isMedia(e.target) ? e.target : null;
    if (!v || !worthy(v) || v === suppressed) return;
    observeMedia(v, "playing");
    clearTimeout(hideT);
    showFor(v);
    clearTimeout(window.__dmPlayHide);
    window.__dmPlayHide = setTimeout(scheduleHide, 4000);
  },
  true
);
document.addEventListener("loadedmetadata", (e) => revealPlayingMedia(e.target), true);
document.addEventListener("canplay", (e) => revealPlayingMedia(e.target), true);

// Content scripts can arrive after autoplay has started, and SPA feeds add
// players long after document_idle. Cover both without polling the whole page.
setTimeout(() => revealPlayingMedia(document), 0);
setTimeout(() => revealPlayingMedia(document), 800);
let mutationFrame = 0;
let mutationTimer = 0;
const pendingMediaRoots = new Set();
new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    mutation.addedNodes.forEach((node) => {
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      pendingMediaRoots.add(node);
    });
  }
  if (!mutationFrame) {
    mutationFrame = requestAnimationFrame(() => {
      mutationFrame = 0;
      [...pendingMediaRoots].slice(0, 40).forEach(revealPlayingMedia);
    });
  }
  clearTimeout(mutationTimer);
  mutationTimer = setTimeout(() => {
    [...pendingMediaRoots].slice(-80).forEach(revealPlayingMedia);
    pendingMediaRoots.clear();
  }, 300);
}).observe(document.documentElement, { childList: true, subtree: true });
window.addEventListener(
  "scroll",
  () => {
    if (btn && btn.style.display !== "none" && target) {
      const r = target.getBoundingClientRect();
      if ((r.bottom < 0 || r.top > innerHeight) && !menuOpen) {
        btn.style.display = "none";
        menu.style.display = "none";
      } else {
        placeButton(target);
        if (menuOpen) placeMenu();
      }
    }
  },
  true
);

// Collect every sizeable image + direct image link on the page (the "grab all" feature).
function scanImages() {
  const urls = new Set();
  document.querySelectorAll("img").forEach((img) => {
    const w = img.naturalWidth || img.width || 0;
    const h = img.naturalHeight || img.height || 0;
    const src = img.currentSrc || img.src || "";
    if (w >= 200 && h >= 200 && /^https?:/i.test(src)) urls.add(src);
  });
  document.querySelectorAll("a[href]").forEach((a) => {
    if (/\.(jpe?g|png|gif|webp|bmp|svg|avif|tiff?)(\?|$)/i.test(a.href)) urls.add(a.href);
  });
  document.querySelectorAll("source[srcset]").forEach((s) => {
    const first = (s.srcset || "").split(",")[0].trim().split(" ")[0];
    if (/^https?:/i.test(first)) urls.add(first);
  });
  return [...urls];
}

chrome.runtime.onMessage.addListener((m, _s, reply) => {
  if (m.dm === "scan-images") { reply(scanImages()); return; }
  if (m.dm === "media-chooser" && m.result) {
    showCandidateChooser(m.result);
    reply({ ok: true });
    return;
  }
  if (m.dm === "ctx-url") {
    if (lastCtx.intent) reply({ kind: "intent", intent: lastCtx.intent });
    else if (lastCtx.wrapFile) reply({ kind: "file", url: lastCtx.wrapFile });
    else reply({ kind: "none" });
    return;
  }
});
