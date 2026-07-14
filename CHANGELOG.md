# Changelog

All notable changes to DownMan are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] — 2026-07-15

First stable release. Consolidates the host-agnostic media resolver and cross-site capture
into a 1.0 milestone.

### Added

- Download the exact clicked video on posts that contain several videos: each player's
  poster/manifest media ID is matched to its own HLS manifest, so a post that shows a main
  video plus an embedded or related video (or several videos) downloads the one you clicked.
- Read browser cookies automatically from the browser the extension runs in, so logged-in,
  private, and age-restricted content works without extra setup; an explicit "Don't use
  cookies" option remains on the extension options page.
- Hide Chrome's own download bubble while interception is active so handed-off downloads no
  longer flash a vanishing entry; it is restored when interception is off or DownMan closes.

### Changed

- Bind a permalink only within the clicked video's own post unit, so an embedded or related
  video is never attributed to the outer post, and refuse rather than guess when a nested
  video exposes no permalink of its own.
- Keep a structurally bound permalink and the clicked video's own manifest in the candidate
  bundle even when a busy feed surfaces many unrelated players' streams.
- Normalize the various post and permalink URL shapes through one host-neutral identity
  classifier and sync interception file types from the app within ~15 seconds.

### Packaging

- Produce an AMO-clean Firefox package: rewrite the background to an event page and strip the
  Chromium-only `key` and `downloads.shelf`/`downloads.ui` permissions.

## [0.1.4] — 2026-07-11

### Changed

- Replace site-specific media URL guessing with a versioned media-intent resolver that correlates
  the chosen player with recent frame-scoped network evidence.
- Rank direct files, HLS/DASH manifests, and page-extractor fallbacks by deterministic evidence;
  ambiguous matches now show a source chooser instead of silently selecting the newest request.
- Preserve a bounded, expiring candidate ledger across MV3 service-worker suspension, while keeping
  signed download URLs unchanged and using canonical URLs only for deduplication.
- Send ranked candidate bundles to the Rust bridge, where one route planner selects aria2 or yt-dlp
  and advances to the next candidate when an engine rejects a source.
- Replace separate Speed/Time-left table columns with live transfer information and one sortable
  Date/time column for added and completed timestamps.
- Rebalance the table around a readable Name column, fold active speed/ETA into compact Status,
  and move Queue assignment from every row into Properties.
- Let Settings use the available content width and keep its eight tabs on one adaptive row as the
  window expands.
- Preserve each Settings tab label at narrow widths and scroll the tab strip horizontally instead
  of wrapping or overlapping text.
- Use one persisted browser-interception rule set across the app, extension popup, and options page;
  matching downloads are captured through Chromium and Firefox download events.

### Fixed

- Detect already-playing and overlay-covered videos without requiring users to pause and replay.
- Reject byte-range media fragments that produced unplayable social-feed files, and prefer nearby
  semantic page links as generic extractor fallbacks without website-specific selectors.
- Submit a lone page-extractor fallback directly instead of showing a one-item source chooser.
- Give every yt-dlp run a collision-safe output name so repeated quality selections cannot report an
  older file as a newly completed download.
- Pause, resume, and remove yt-dlp/ffmpeg process groups from row, selected, global, tray, and remote
  controls.
- Switch row and card Pause/Resume status and icons optimistically, with rollback if the backend
  rejects the command, instead of waiting for the next snapshot poll.
- Make failed retries replace their predecessor instead of adding another row; collapse and remove
  legacy failed retry chains while preserving successful/completed downloads.
- Repair malformed retry output names derived from signed query parameters such as
  `&Filename=...`, and make retry requests idempotent when a successor is already running.
- Capture configured `.exe`, `.zip`, redirected downloads, and manually added extensions reliably;
  DownMan must accept a handoff before the browser download is canceled.
- Ignore completed/old browser-history events after Chrome restarts, while persisting active capture
  transactions across MV3 service-worker suspension.
- Pause new browser downloads before handing them to DownMan, cancel only after acceptance, and
  resume the browser copy if handoff fails so ZIP/EXE files cannot silently download twice.
- Replace the article-wide feed gate with one host-neutral page-identity classifier and pure
  resolution policy shared by social feeds and ordinary media pages.
- Canonicalize equivalent post and query-based detail URLs; preserve the strongest DOM binding
  when duplicate page candidates merge.
- Submit collection media only from an exact HTTP element source or one uniquely bound post with no
  visibly competing player, preventing extractor failure or timing-only manifests from selecting a
  neighboring feed item.
- Reject audio-only adaptive renditions for video intents and expose at most one unresolved stream
  choice instead of several indistinguishable manifests.
- Treat generic shell page titles as confirmation hints only; unless edited, yt-dlp now supplies
  the real extractor title and resolution for the output filename.
- Capture tiny Markdown downloads while Chromium is holding filename finalization, even when the
  file finishes receiving before the downloads API can pause it.
- Adopt browser-local `blob:` downloads such as GitHub-generated Markdown after Chrome completes
  them: securely move the file from Downloads into its DownMan category, record one completed task,
  and remove the stale Chrome history entry.
- Consume callback-style `downloads.pause/cancel/resume/erase/search` runtime errors across Chrome
  API modes, avoiding stale `Unchecked runtime.lastError: Download must be in progress` reports when
  tiny downloads finish before they can be paused.
- Track multiple recent players per frame and refuse automatic stream selection when concurrent
  playback, a missing bound permalink, or a multi-video post makes identity ambiguous; the button
  asks to open the post instead of downloading a random neighboring video.
- Include MD and DEB in fresh browser-interception defaults; assign MD to Documents and DEB to
  Programs in fresh category defaults without overwriting saved user categories.
- Include extractor uploader/media ID in automatic media filenames so weak social-feed titles remain
  attributable even when the extractor supplies an empty or generic title.
- Surface Site Grabber start, crawl, and download errors; explain zero-result behavior on
  JavaScript/session-heavy sites and distinguish empty filters from empty crawls.
- Show the Site Grabber resource warning on the first Explore click instead of silently returning.
- Reject stale signed Firefox packages whenever extension source or manifest content changes.

## [0.1.3] — 2026-07-11

### Changed

- UI redesign
- Consolidated browser media handling into the per-media **Download** button; removed the
  separate stream pill, detected-stream popup list, page-capture controls, and stream badge.
- Downloads now start directly instead of probing every site for qualities. Supported video sites
  keep an explicit quality picker; social sites use their post/page URL, while ordinary
  blob/MSE players use frame-scoped detected media as an invisible fallback.
- Upgraded the frontend to React 19, Framer Motion 12, TypeScript 7, Vite 8, Tailwind CSS 4,
  Zustand 5, and current Tauri 2 JavaScript packages.
- Migrated the Rust crate to edition 2024 and upgraded reqwest to 0.13, rand to 0.10, dirs to 6,
  Tauri to 2.11.5, and all compatible locked dependencies.
- Refreshed third-party dependency attribution from the current Cargo and npm graphs.
- Added persistent lifetime download statistics with seven-day and category totals, independent
  from removable download history, plus an explicit reset action in Stats.

### Fixed

- Avoid live tooltip mutations on Linux tray hosts, which could intermittently repaint tray-menu
  labels without a visible foreground color.
- Corrected Firefox package guidance and improved keyboard navigation, dialog focus, and offline
  status feedback.

## [0.1.2] — 2026-07-04

Initial public release — a low‑footprint, aria2‑powered download manager for Linux with
a streamlined, click‑to‑grab experience. (Version numbers begin at 0.1.2 so the app and the browser
extension share one version line; the extension's 0.1.0–0.1.1 builds were pre‑release.)

### Added

- **Download engine** — aria2 core: multi‑connection HTTP/FTP, BitTorrent, magnet, and
  Metalink; pause/resume (per item and all), with global and per‑download speed limits.
- **Smart routing** — an evidence‑based router chooses aria2 vs yt‑dlp per download
  (URL shape → DOM context → known‑host list → content‑type probe), so nothing dead‑ends
  and files get correct names and folders — even extensionless URLs.
- **Site & media capture** — yt‑dlp integration for 1800+ sites with a real per‑video
  quality picker, subtitles, SponsorBlock, and optional browser cookies; HLS/DASH stream
  sniffing and merging via FFmpeg.
- **Browser extensions** — Chromium and Firefox (MV3) companions that talk to the app over
  a loopback bridge.
- **Queues & scheduling** — multiple queues with concurrency and speed caps, plus per‑queue
  and global active‑hours windows.
- **Reliability** — automatic retry of transient failures with backoff, checksum
  verification (MD5 / SHA‑1 / SHA‑256 / SHA‑512), safe re‑download, and missing‑file detection.
- **Organization** — automatic sorting into Video / Audio / Images / Documents / Archives,
  editable categories, duplicate detection, per‑download on‑complete actions, archive
  auto‑extract, and optional ClamAV scanning.
- **Linux desktop integration** — a system tray with live speed/count and a speed‑limit toggle,
  dock/launcher progress (Unity LauncherEntry), a sleep inhibitor while downloading, a
  clipboard link watcher, and metered‑connection auto‑pause.
- **Interface** — Tauri 2 + React “aurora” UI, light/dark themes, drag‑and‑drop, keyboard
  shortcuts, history export, and a diagnostics panel.
- **Self‑maintenance** — yt‑dlp auto‑updates on a daily schedule (checksum‑verified), and
  BitTorrent trackers refresh automatically.

### Security

- The local browser bridge (`127.0.0.1:6802`) is **origin‑gated**: requests originating from
  web pages are rejected, so a website cannot drive the download manager. See
  [`SECURITY.md`](SECURITY.md).

[1.0.0]: https://github.com/rai-himanshu07/DownMan/releases/tag/v1.0.0
[0.1.4]: https://github.com/rai-himanshu07/DownMan/releases/tag/v0.1.4
[0.1.3]: https://github.com/rai-himanshu07/DownMan/releases/tag/v0.1.3
[0.1.2]: https://github.com/rai-himanshu07/DownMan/releases/tag/v0.1.2
