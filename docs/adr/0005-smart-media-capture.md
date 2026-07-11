# ADR‑0005: Smart media capture UX

- **Status:** Superseded in 0.1.3
- **Date:** 2026-06-29
- **Deciders:** Project owner

## Context

We want to capture audio/video from web pages, but the owner flagged the obvious approach as a
UX problem: putting a download button on **every thumbnail/video** clutters pages and ruins the
browsing experience. The question was explicitly *"how can we be smart about this?"*

## Decision

**Passive detection, single on‑demand entry point.**

1. The extension's background worker watches `webRequest` for media signatures
   (`.m3u8`, `.mpd`, `.mp4`, `.webm`, audio types) and dedupes per tab.
2. The toolbar icon shows a **badge count** of capturable streams — nothing when there are none.
3. A **single floating "pill"** appears bottom‑corner only when ≥1 stream is detected, and
   **auto‑hides after ~6 s**. Clicking it (or the popup list) sends the chosen stream to the app.
4. Right‑click context menu and the popup provide alternative, explicit entry points.

No per‑element overlays are ever injected.

## Alternatives considered

- **Per‑thumbnail buttons** — rejected by the owner; clutters pages.
- **Badge only, no overlay** — viable, but the pill gives a faster path without being intrusive.

## Consequences

- Positive: pages stay clean; the feature is invisible until it's useful; one obvious action.
- Negative: stream picking is currently "first/most‑recent"; quality/variant selection for HLS/DASH
  is a follow‑up. Detection relies on URL/extension heuristics and may miss obfuscated streams.

## Update (2026‑07‑11)

The visible badge, floating pill, and popup stream list were superseded by a single per‑media
**Download** control. Network detection remains internal as a frame‑scoped fallback for blob/MSE
players; YouTube alone exposes an explicit quality menu. This preserves passive detection without
maintaining a second capture workflow.
