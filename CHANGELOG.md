# Changelog

All notable changes to DownMan are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this
project aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.3] — 2026-07-11

### Changed

- UI redesign
- Consolidated browser media handling into the per-media **Download** button; removed the
  separate stream pill, detected-stream popup list, page-capture controls, and stream badge.
- Downloads now start directly instead of probing every site for qualities. YouTube keeps an
  explicit quality picker; X and other supported sites use their post/page URL, while ordinary
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

[0.1.3]: https://github.com/rai-himanshu07/DownMan/releases/tag/v0.1.3
[0.1.2]: https://github.com/rai-himanshu07/DownMan/releases/tag/v0.1.2
