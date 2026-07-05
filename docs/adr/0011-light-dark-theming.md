# ADR‑0011: Light/dark theming via CSS custom properties

- **Status:** Accepted
- **Date:** 2026-07-02
- **Deciders:** Project owner
- **Relates to:** [ADR‑0003](0003-frontend-stack.md)

## Context

The UI shipped dark‑only ("aurora"). Adding a genuine **light mode** to a Tailwind app whose
surface/text colors were hardcoded dark hex would normally mean either sprinkling `dark:`
variants across every component (the base is dark, so the *inversion* is what's hard) or
maintaining two parallel class sets. Both are high‑churn and drift out of sync, and Tailwind's
`darkMode: "class"` alone doesn't help when the *default* palette is the dark one.

## Decision

Drive the two semantic palettes from **CSS custom properties** so a single class flips the app:

- `ink` (surfaces) and `slate` (text) are defined in `tailwind.config.js` as
  `rgb(var(--ink-XXX) / <alpha-value>)`, so every `bg-ink-*` / `text-slate-*` **and all their
  opacity variants** resolve through variables.
- `:root` holds the dark values; a **`.dm-light`** class on `<html>` redefines them to light
  values (plus `color-scheme`). The toggle lives in *Settings → Appearance*, persists to
  `localStorage["dm-light"]`, and is re‑applied on startup.
- Dark overlays that don't use those scales are overridden under `.dm-light`: white‑alpha
  borders/backgrounds, `.glass` / `.card` / `.chip` / `.btn-ghost`, `.text-white`, and the aurora
  backdrop. `<select>` `<option>`s had their inline dark styles removed so the CSS
  `select option` / `.dm-light select option` rules theme dropdowns in both modes.

## Alternatives considered

- **`dark:` variants everywhere** — the base palette is dark, so light becomes the exception on
  every element: enormous, error‑prone churn.
- **Two hardcoded theme class sets** — duplication that drifts out of sync.
- **CSS‑in‑JS / runtime theme objects** — heavier, and Tailwind is already the styling system.

## Consequences

- Positive: one `.dm-light` toggle flips surfaces, text, borders **and every alpha variant**
  automatically; new components inherit theming for free.
- Negative / trade‑offs: accent‑*tint* text tuned for dark (`aurora-300`, `magenta-400`, the
  silver `shiny-text`) washes out on white and must be deepened under `.dm-light`; solid accent
  buttons need `color:#fff` forced back (the global `.text-white` flip darkened them).
- Follow‑ups / risks: **`tailwind.config.js` changes require a dev‑server restart** (the JIT
  caches the config) — this briefly masked the feature as "not working" until a clean restart;
  extra theme presets are cheap to add on top of this.
