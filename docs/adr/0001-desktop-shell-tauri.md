# ADR‑0001: Desktop shell — Tauri 2

- **Status:** Accepted
- **Date:** 2026-06-29
- **Deciders:** Project owner

## Context

DownMan needs a desktop app with a fully custom, modern UI, but the owner's hard constraint is
**"feature rich, not a burden on RAM."** Target is Ubuntu 26.04 / GNOME 50. We also want simple
Linux packaging (`.deb`, AppImage) and the ability to bundle a native binary (aria2c) and call
ffmpeg.

## Decision

Use **Tauri 2** (Rust core + the OS WebView, WebKitGTK on Linux) as the application shell.

## Alternatives considered

- **Electron** — bundles Chromium; ~250–500 MB RAM and large installers. Violates the RAM constraint.
- **PySide/PyQt** — native widgets but harder to make a unique, modern UI; heavier theming effort.
- **Flutter desktop** — great custom UI, but Linux desktop support is less mature and pulls a large toolchain.

## Consequences

- Positive: ~80–150 MB RAM (shares the system WebView), small binaries, first‑class `.deb`/AppImage
  bundling, easy sidecar + Rust backend for the engine and bridge.
- Negative: rendering depends on the installed WebKitGTK (we depend on `libwebkit2gtk-4.1-0`);
  some web APIs differ from Chromium. Rust learning curve for backend work.
- Follow‑up: build profile needs care — see ADR‑0008.
