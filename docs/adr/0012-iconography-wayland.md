# ADR‑0012: App, tray, and window iconography (GNOME/Wayland)

- **Status:** Accepted
- **Date:** 2026-07-02
- **Deciders:** Project owner
- **Relates to:** [ADR‑0001](0001-desktop-shell-tauri.md), [ADR‑0009](0009-packaging.md)

## Context

DownMan has **three** icon surfaces with different constraints, and one desktop reality
(Ubuntu/GNOME on **Wayland**) that breaks the naive approach:

- The source artwork is a detailed mascot on a **dark** rounded tile (with white canvas corners
  and a baked‑in "DownMan" wordmark).
- **System‑tray** icons render tiny (~22 px) beside bold, near‑white symbolic glyphs — a dark
  tile there is effectively invisible.
- On **GNOME/Wayland the window's embedded icon is ignored** for the taskbar/dash/alt‑tab; the
  shell matches the window's **app‑id to an installed `.desktop`** file and uses *its* `Icon=`.

## Decision

Treat each surface as its own asset:

1. **App icon** — prep the source with `branding/prep_icon.py` (flood‑fill the exterior white to
   transparent rounded corners; crop out the baked‑in text → a clean "hero"), then
   `npm run tauri icon` regenerates the whole set referenced by `bundle.icon`.
2. **Tray icon** — a **dedicated bold, high‑contrast glyph** (a hollow white "D + down‑arrow"),
   embedded as raw RGBA (`icons/tray_rgba.bin` via `include_bytes!` + `tauri::image::Image::new`)
   and set on the `TrayIconBuilder`. Deliberately *not* the dark app tile.
3. **Window icon** — embedded via `generate_context!` (from `bundle.icon`) **and** applied
   explicitly at startup with `WebviewWindow::set_icon(...)`, because Linux WMs don't reliably
   apply the config icon to the live window.
4. **Taskbar on Wayland** — accepted as an install‑time concern: the icon appears once the
   package is installed (its `.desktop` matches the app‑id). For development, a user `.desktop`
   in `~/.local/share/applications` reproduces it.

## Alternatives considered

- **Reuse the app icon for the tray** — the dark tile disappears on dark trays.
- **Hand‑drawn emblem for the tray** — didn't match the artwork; extracting/redrawing it as a
  bold symbolic glyph reads far better at ~22 px.
- **Rely on `set_icon` for the taskbar** — ignored under Wayland; only `.desktop` matching works.

## Consequences

- Positive: the tray icon is always visible and on‑brand; the app icon is crisp at every size with
  clean transparent corners; the window icon is deterministic.
- Negative / trade‑offs: three separate assets to keep in sync; the Wayland taskbar icon needs the
  app installed (dev `.desktop` workaround documented).
- Follow‑ups / risks: assets embedded via `include_bytes!` / `generate_context!` may not
  retrigger a rebuild — touch `tauri.conf.json` or `cargo clean -p downman` if the cache is stale;
  `tauri build` already emits a correct `.desktop` for installed packages.
