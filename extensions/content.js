// DownMan content script.
//   1) A per-<video> "⤓ Download" button that appears on hover — targets the exact
//      video you point at (not the whole page), with a dynamic real-quality menu.
//   2) A secondary floating pill (top frame only) for sniffed background streams.

const Z = 2147483647;
const TOP = window.top === window;

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
      if (cb) cb(err ? { ok: false, error: "Extension reloaded — refresh this page" } : res);
    });
  } catch (_) {
    if (cb) cb({ ok: false, error: "Extension reloaded — refresh this page" });
  }
}

/* ============================ per-video button ============================ */
let btn, menu, target = null, hideT = null, menuOpen = false, prefetching = null, suppressed = null;
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
  if (v.muted && (v.loop || v.autoplay) && !v.controls && (!v.duration || v.duration < 60)) return false; // hero/bg loops
  // Thumbnails / hover-previews live inside a link; the real player does not.
  if (v.closest && v.closest("a[href]")) return false;
  return true;
}

// A direct src worth grabbing as-is: an http(s) URL that looks like a real media file.
const MEDIA_SRC_RE = /\.(mp4|m4v|webm|mkv|mov|m4a|mp3|aac|flac|ogg|wav|opus|ts)(\?|$)/i;

// Any directly-downloadable file (video OR image) — gifs/images/progressive video
// should go straight to aria2 rather than through yt-dlp.
const DIRECT_FILE_RE = /\.(mp4|m4v|webm|mkv|mov|m4a|mp3|aac|flac|ogg|wav|opus|ts|gif|jpe?g|png|webp|avif|bmp|svg)(\?|$)/i;

// Reddit (and similar) wrap the real media in a viewer link like
// reddit.com/media?url=<encoded real url> — unwrap it to the actual file.
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
  const x = el("span", "padding-left:7px;border-left:1px solid rgba(255,255,255,.4);opacity:.9;font-size:13px;line-height:1", "✕");
  x.title = "Hide (lets you use the player's controls)";
  x.onclick = (e) => { e.stopPropagation(); e.preventDefault(); dismissBtn(); };
  btn.appendChild(lbl);
  btn.appendChild(x);
  btn.onmouseenter = () => { clearTimeout(hideT); prefetchFormats(); };
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
  btn.style.display = "flex";
  const r = v.getBoundingClientRect();
  const bh = btn.offsetHeight || 34;
  const above = r.top - bh - 6;
  // Hang just outside the top-right corner so we don't cover the player's own
  // controls (e.g. YouTube's info/share buttons); sit inside only if there's no room above.
  btn.style.top = (above >= 8 ? above : r.top + 8) + "px";
  btn.style.left = Math.max(8, r.right - btn.offsetWidth) + "px";
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
  setLabel(res && res.ok ? "Sent ✓" : reload ? "Refresh page ↻" : "App offline");
  setTimeout(reset, 1900);
}

// The URL we hand to yt-dlp. Inside an iframe this is the embed's own URL. On a
// feed page (e.g. Reddit) the current media sits inside a post link/permalink, so
// resolve that specific URL rather than the whole listing page.
function scoped() {
  if (!TOP) return location.href; // inside an embed iframe, the frame URL is the video
  return bestSiteUrl(target);
}

// Best site URL for a media element: its post permalink (Reddit & similar) or the
// nearest enclosing link, else the current page. yt-dlp extracts the media from it.
function bestSiteUrl(m) {
  if (m && m.closest) {
    const post = m.closest("[permalink]");
    const pl = post && post.getAttribute("permalink");
    if (pl) { try { return new URL(pl, location.origin).href; } catch (_) { /* ignore */ } }
    const a = m.closest("a[href]");
    if (a && /^https?:/i.test(a.href) && a.href !== location.href && !/\/media\?url=/i.test(a.href)) return a.href;
  }
  return location.href;
}

// Resolve the best download target for a right-clicked media element.
function resolveMediaUrl(m) {
  const file = directFileFor(m);
  if (file) return { kind: "file", url: file };
  return { kind: "site", url: m && TOP ? bestSiteUrl(m) : location.href };
}

// Remember what the user right-clicked so the context-menu handler can resolve a
// real URL (feed videos are blob/MSE with no file src). We also capture the post
// permalink from the click ancestry directly, which survives shadow-DOM players.
let lastCtx = { srcFile: null, wrapFile: null, url: null, isVideo: false };
document.addEventListener(
  "contextmenu",
  (e) => {
    const t = e.target;
    let m = t && t.closest ? t.closest("video, audio") : null;
    if (!m && t && t.tagName === "VIDEO") m = t;
    let srcFile = null, wrapFile = null, url = null;
    if (m) {
      const s = m.currentSrc || m.src || "";
      if (/^https?:/i.test(s) && DIRECT_FILE_RE.test(s)) srcFile = s;
    }
    if (t && t.closest) {
      const post = t.closest("[permalink]");
      const pl = post && post.getAttribute("permalink");
      if (pl) { try { url = new URL(pl, location.origin).href; } catch (_) { /* ignore */ } }
      // A media-viewer link in the click ancestry (e.g. Reddit's /media?url=…).
      const a = t.closest("a[href]");
      if (a) {
        const real = unwrapMediaUrl(a.href);
        if (/^https?:/i.test(real) && DIRECT_FILE_RE.test(real)) wrapFile = real;
      }
      if (!m) {
        const container = t.closest("[permalink], shreddit-post, article");
        if (container) m = container.querySelector("video, audio");
      }
    }
    lastCtx = { srcFile, wrapFile, url, isVideo: !!(m && (m.tagName === "VIDEO" || m.tagName === "AUDIO")) };
  },
  true
);

function onClick() {
  const v = target;
  if (!v) return;
  const s = v.currentSrc || v.src || "";
  // Only the media's OWN direct file is a safe fast-path (aria2). A nearby wrapper
  // link may be a gif *reference* for a video whose real download is an mp4 — those
  // go through yt-dlp on the permalink via openMenu().
  if (/^https?:/i.test(s) && DIRECT_FILE_RE.test(s)) {
    setLabel("Sending…");
    rt({ dm: "file", url: s, referer: location.href }, done);
    return;
  }
  openMenu();
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
// Warm the format cache when the user hovers the Download button (a clear intent
// signal) so the first click opens instantly instead of waiting on yt-dlp.
function prefetchFormats() {
  const v = target;
  if (!v) return;
  const src = v.currentSrc || v.src || "";
  if (/^https?:/i.test(src) && !/^blob:/i.test(src) && MEDIA_SRC_RE.test(src)) return; // direct file needs no lookup
  const url = scoped();
  const cached = fmtCache.get(url);
  if (cached && Date.now() - cached.ts < FMT_TTL) return;
  if (prefetching === url) return;
  prefetching = url;
  rt({ dm: "formats", url, referer: location.href }, (res) => {
    prefetching = null;
    if (res && res.ok) fmtCache.set(url, { formats: res.formats || [], title: res.title || "", ts: Date.now() });
  });
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
  "play",
  (e) => {
    const v = isMedia(e.target) ? e.target : null;
    if (!v || !worthy(v) || v === suppressed) return;
    clearTimeout(hideT);
    showFor(v);
    clearTimeout(window.__dmPlayHide);
    window.__dmPlayHide = setTimeout(scheduleHide, 4000);
  },
  true
);
window.addEventListener(
  "scroll",
  () => {
    if (btn && btn.style.display !== "none" && target) {
      const r = target.getBoundingClientRect();
      if ((r.bottom < 0 || r.top > innerHeight) && !menuOpen) {
        btn.style.display = "none";
        menu.style.display = "none";
      } else {
        const bh = btn.offsetHeight || 34;
        const above = r.top - bh - 6;
        btn.style.top = (above >= 8 ? above : r.top + 8) + "px";
        btn.style.left = Math.max(8, r.right - btn.offsetWidth) + "px";
        if (menuOpen) placeMenu();
      }
    }
  },
  true
);

/* ===================== secondary pill (top frame only) ==================== */
let pill;
function ensurePill() {
  if (pill) return;
  pill = el(
    "div",
    "position:fixed;right:18px;bottom:18px;z-index:" + Z +
      ";backdrop-filter:blur(12px);background:rgba(17,20,33,.85);color:#fff;border:1px solid rgba(255,255,255,.1);" +
      "border-radius:999px;padding:8px 14px;font:600 13px Inter,system-ui;box-shadow:0 8px 30px -8px rgba(31,147,255,.6);" +
      "cursor:pointer;display:none;gap:8px;align-items:center",
    '<span style="color:#f04ec0">●</span> DownMan: <span id="dm-n">0</span> streams'
  );
  pill.onclick = () =>
    rt({ dm: "list", tabId: -1 }, (items) => {
      if (Array.isArray(items) && items[0]) rt({ dm: "grab", url: items[0].url, referer: location.href });
    });
  document.body.appendChild(pill);
}
chrome.runtime.onMessage.addListener((m) => {
  if (m.dm !== "media" || !TOP) return;
  ensurePill();
  pill.querySelector("#dm-n").textContent = m.count;
  pill.style.display = "flex";
  clearTimeout(window.__dmT);
  window.__dmT = setTimeout(() => (pill.style.display = "none"), 6000);
});

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
  if (m.dm === "ctx-url") {
    // Exact playing file wins; a real video prefers yt-dlp on its permalink (gets the
    // mp4) over a possibly-broken gif reference; else a direct file, else the page.
    if (lastCtx.srcFile) reply({ kind: "file", url: lastCtx.srcFile });
    else if (lastCtx.isVideo && lastCtx.url) reply({ kind: "site", url: lastCtx.url });
    else if (lastCtx.wrapFile) reply({ kind: "file", url: lastCtx.wrapFile });
    else if (lastCtx.url) reply({ kind: "site", url: lastCtx.url });
    else reply({ kind: "site", url: location.href });
    return;
  }
});
