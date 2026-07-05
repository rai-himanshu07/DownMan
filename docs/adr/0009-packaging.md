# ADR‑0009: Packaging strategy

- **Status:** Accepted
- **Date:** 2026-06-29
- **Deciders:** Project owner

## Context

The owner wants to run from source during development and also install natively. Stated targets:
**AppImage, `.deb`, and run‑from‑source.** Platform is Ubuntu 26.04 / GNOME 50.

## Decision

- Primary day‑to‑day: **run from source** via `npm run app` (`tauri dev`).
- Distributable: **`.deb`** built first (`npm run app:build -- --bundles deb`), declaring
  `aria2, ffmpeg, libayatana-appindicator3-1, libwebkit2gtk-4.1-0, libgtk-3-0` as dependencies.
- **AppImage** is planned but deferred: the bundled `aria2c` dynamically links `libaria2`, so the
  AppImage must carry that library to stay self‑contained. The `.deb` sidesteps this via its `aria2`
  dependency.

## Consequences

- Positive: a working 5.7 MB `.deb` today with correct dependencies, desktop entry, and icons.
- Negative: AppImage needs extra work to bundle `libaria2` (or statically link aria2c) before it's
  truly portable.
- Follow‑ups: AppImage target; optionally a statically‑linked aria2c to drop the runtime `aria2` dep.

## Update (2026‑07)

- **AppImage is now an active target** alongside `.deb` (`bundle.targets = ["appimage", "deb"]`).
- aria2c is **not** bundled — `externalBin` is empty and aria2 is launched from `PATH` (see the ADR‑0002 update).
- The explicit `.deb` dependencies are `aria2, ffmpeg`; Tauri adds the WebKit/GTK/appindicator libraries automatically.
