# ADR‑0003: Frontend stack — React + TS + Vite + Tailwind + Zustand

- **Status:** Accepted
- **Date:** 2026-06-29
- **Deciders:** Project owner (delegated UI framework choice)

## Context

We want a **unique, modern UI** (not a template) with good UX, fast iteration, and a small runtime
payload inside the WebView. The owner had no framework preference and delegated the choice.

## Decision

- **React + TypeScript** via **Vite** for fast HMR and a tiny production bundle.
- **Tailwind CSS** with a hand‑built design system (custom "aurora" palette, glass surfaces,
  shimmer/progress animations) for a distinctive look without a component‑library template.
- **Zustand** for state — a minimal store that holds the polled snapshot and view state.

## Alternatives considered

- **Svelte** — leaner still, but React's ecosystem is larger for future features.
- **Vue** — fine, but no advantage here over React for this team.
- **Component kits (MUI/AntD)** — would make the UI look templated; rejected for the "unique" goal.

## Consequences

- Positive: ~50 KB gzipped JS, sub‑second builds, easy to extend; CSS‑variable theming
  (accent swatches) layers cleanly on Tailwind.
- Negative: Tailwind class density; design system is bespoke and must be maintained by hand.
