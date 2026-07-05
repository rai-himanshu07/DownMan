# ADR‑0006: File organization by category

- **Status:** Accepted
- **Date:** 2026-06-29
- **Deciders:** Project owner

## Context

The owner wants downloads "organized in a configured download folder" rather than dumped flat.

## Decision

On completion, sort files into category subfolders under the download root:
`Video / Audio / Images / Documents / Archives / Other`, chosen by file extension.

- Trigger: the UI poll loop detects a task whose status became `complete` and calls
  `organize(gid)` **once** (tracked by a seen‑set so a file is never moved twice).
- Move: Rust resolves the real path via `aria2.tellStatus`, then `rename`s into the category folder,
  falling back to copy+remove across mount boundaries.
- Toggle: a Settings switch (`dm-organize`) lets the user disable auto‑sorting.

## Alternatives considered

- **Set aria2's `dir` per download up front** — we don't reliably know the final filename/type before
  the response headers, so post‑completion sorting is more accurate.
- **User‑defined rule engine** — deferred; the fixed taxonomy covers the common case now.

## Consequences

- Positive: a tidy library with zero user effort; reversible (just a move).
- Negative: extension‑based categorization is heuristic; unknown types land in `Other`.
  Torrents that produce a folder are left in place by design.
- Follow‑up: user‑configurable categories/rules and per‑category destinations.
