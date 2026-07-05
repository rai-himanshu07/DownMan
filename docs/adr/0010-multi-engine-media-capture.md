# ADR‑0010: Multi‑engine media capture (yt‑dlp + sniffer + context)

- **Status:** Accepted
- **Date:** 2026-06-29
- **Deciders:** Project owner
- **Relates to:** [ADR‑0005](0005-smart-media-capture.md), [ADR‑0007](0007-hls-dash-ffmpeg.md)

## Context

Sending a video *page* URL (e.g. `youtube.com/watch?v=…`) to aria2 just downloads the HTML page
(observed: a 379 KiB file named `watch`). The real video on YouTube‑class sites is delivered as
adaptive `googlevideo` DASH chunks with range requests — not a direct file, and not a sniffable
`.m3u8`/`.mpd`. No single mechanism captures "video from any website."

## Decision

Adopt a **three‑layer** capture strategy:

1. **yt‑dlp** as a dedicated engine for **page/site** captures — ~1800+ site extractors plus a
   generic extractor for unknown pages. Bundled as the self‑contained `yt-dlp_linux` binary at
   `src-tauri/binaries/yt-dlp`; resolved via `DOWNMAN_YTDLP` → bundled path → `PATH`.
2. **Network sniffer** (the extension) remains the universal layer for **direct DRM‑free streams**,
   because it observes real media requests *after* page JS runs and *with the user's session*.
3. **Context forwarding** — the extension passes **Referer** (the page URL) and an optional
   **cookies‑from‑browser** source, so CDN URLs don't 403 and logged‑in/age‑gated videos work.

Routing (in the bridge): `kind=page|site|stream` or a `.m3u8/.mpd` URL → yt‑dlp; everything else
(direct files, torrents, magnets) → aria2. yt‑dlp jobs appear as first‑class cards via a job
registry merged into the `snapshot` payload (`dmKind: "site"`), with live progress parsed from
yt‑dlp's `--progress-template`.

## Boundary (explicit non‑goal)

**DRM‑protected services** (Netflix, Disney+, Spotify, etc.) are **out of scope** — the content is
encrypted and circumventing it violates the DMCA. yt‑dlp refuses such sites and so do we.

## Alternatives considered

- **aria2 only** — cannot resolve adaptive site video; downloads the page HTML.
- **ffmpeg `-i <page>`** — only works for direct manifests, not site pages.
- **Bundle a browser/headless engine** — heavyweight; the extension already provides browser context.

## Consequences

- Positive: real one‑click capture from YouTube/Vimeo/X/etc.; quality picker (best/1080/720/audio);
  authenticated content via browser cookies; unified task list.
- Negative: adds a 39 MB `yt-dlp` binary; site extractors need periodic updates (`yt-dlp -U`);
  yt‑dlp job progress is parsed text (not aria2 RPC), so it's best‑effort.
- Follow‑ups: include `yt-dlp` in the `.deb`/AppImage bundle (currently dev‑resolved from
  `binaries/`); variant/format picker for raw HLS; surface yt‑dlp errors in the UI.

## Update (2026‑07)

- **yt‑dlp is fetched at runtime, not bundled.** The in‑app updater keeps a current copy at
  `~/.local/share/DownMan/bin/yt-dlp` (checksum‑verified, refreshed daily); `ytdlp_bin()` prefers that
  copy and otherwise falls back to `PATH`. `externalBin` is empty, so nothing ships in the package —
  this keeps site support current without waiting on a release.
- **Routing is now evidence‑based** (`decide_route`): on top of the `kind`/extension rules above, an
  ambiguous URL is settled by a content‑type `HEAD` probe (media → aria2, page/stream → yt‑dlp), and a
  yt‑dlp “Unsupported URL” on a real file falls back to aria2.
