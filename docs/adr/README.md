# Architecture Decision Records

This log captures the significant technical decisions behind DownMan — the context, the
choice made, and its consequences — so future changes build on intent rather than guesswork.

We use a lightweight [MADR](https://adr.github.io/madr/)‑style format. Each record is immutable
once **Accepted**; to change a decision, add a new ADR that **supersedes** the old one.

## Format

See [`0000-template.md`](0000-template.md). Status is one of:
`Proposed · Accepted · Deprecated · Superseded by ADR‑XXXX`.

## Index

| #    | Title                                                              | Status   |
| ---- | ------------------------------------------------------------------ | -------- |
| 0001 | [Desktop shell: Tauri 2](0001-desktop-shell-tauri.md)              | Accepted |
| 0002 | [Download engine: aria2 via JSON‑RPC](0002-download-engine-aria2.md) | Accepted |
| 0003 | [Frontend stack](0003-frontend-stack.md)                          | Accepted |
| 0004 | [Browser↔app bridge over local HTTP](0004-browser-bridge.md)       | Accepted |
| 0005 | [Smart media capture UX](0005-smart-media-capture.md)             | Superseded in 0.1.3 |
| 0006 | [File organization by category](0006-file-organization.md)        | Accepted |
| 0007 | [HLS/DASH capture via ffmpeg](0007-hls-dash-ffmpeg.md)            | Accepted |
| 0008 | [Release build profile (no LTO)](0008-release-build-profile.md)   | Accepted |
| 0009 | [Packaging strategy](0009-packaging.md)                           | Accepted |
| 0010 | [Multi-engine media capture (yt-dlp)](0010-multi-engine-media-capture.md) | Accepted |
| 0011 | [Light/dark theming via CSS variables](0011-light-dark-theming.md) | Accepted |
| 0012 | [App/tray/window iconography (Wayland)](0012-iconography-wayland.md) | Accepted |
| 0013 | [Host-agnostic media intent resolver](0013-host-agnostic-media-resolver.md) | Accepted |

## Conventions referenced by ADRs

- aria2 JSON‑RPC: `127.0.0.1:6810`, per‑launch secret token, `--rpc-listen-all=false`.
- Extension bridge: `127.0.0.1:6802`, `POST /add { uris, options }`.
- Download root: `~/Downloads/DownMan/`.
