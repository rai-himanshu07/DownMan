# ADR-0015: Backend-owned bounded media automation and scheduling

- **Status:** Accepted
- **Date:** 2026-07-17
- **Deciders:** Project owner
- **Relates to:** [ADR-0010](0010-multi-engine-media-capture.md), [ADR-0013](0013-host-agnostic-media-resolver.md), [ADR-0014](0014-sqlite-policy-state.md)

## Context

Playlist/channel inspection, keyword search, followed-source polling, archive synchronization, and
download schedules must continue when the window is hidden. Running them in React would couple
correctness to WebView timers and could load an entire large channel into memory. Unbounded yt-dlp
processes would also make cancellation, progress, duplicate prevention, and resource use difficult
to reason about.

Automation adds a second safety concern: a poll may discover many old items or overlap with another
poll. DownMan must not produce duplicate storms or turn a followed source into auto-download without
an explicit user choice.

## Decision

1. Treat React as the control and review surface. Rust owns extraction workers, persisted workflow
   state, subscription polling, enqueue loops, and schedule enforcement.
2. Request bounded yt-dlp ranges for collection and search work. Persist normalized items, then let
   the UI request fixed-size pages, filters, and selection counts instead of receiving one complete
   source payload.
3. Make collection and search sessions cancellable. Track active extractor/media processes and
   stop their process groups when cancellation is requested.
4. Resolve one validated profile snapshot at enqueue and process selected collection rows in a
   deterministic worker. Skip archive matches and record archive identity only after completion.
5. Bound subscriptions to a minimum poll interval and a maximum match count per run. Acquire a
   persisted `running` claim so overlapping polls are rejected; clear stale claims at startup.
6. Send new subscription matches to the Review Inbox by default. Auto-download is an explicit
   per-source action and still obeys the poll cap, seen identities, archive deduplication, profile,
   live policy, and cookies selection.
7. Enforce schedules in Rust for both aria2 and site jobs. Effective precedence is per-job window,
   then queue window, then global window.
8. Track scheduler-owned pauses separately. Reopen a window by resuming only work paused by the
   scheduler, never work paused manually by the user.
9. Keep preflight separate from enqueue: normalize, classify, estimate, and review first; commit
   only selected accepted rows.

## Alternatives considered

- **React timers and in-memory rows** — easier UI code, but hidden/suspended windows would stop
  scheduling and polling, and large sources would consume unbounded memory.
- **One yt-dlp process for an entire channel** — fewer subprocess launches, but poor cancellation,
  no stable paging, and potentially huge output.
- **Auto-download followed sources by default** — less interaction, but unsafe for old backlogs,
  broad filters, and mistaken source configuration.
- **Resume every paused job when a window opens** — simple, but violates explicit user pauses.

## Consequences

- Positive: schedules and follows continue with the UI hidden.
- Positive: playlist/channel/search memory and process use are bounded and testable.
- Positive: archive and seen identities prevent repeated imports and poll duplicates.
- Positive: review is the safe default while power users can opt into bounded automation.
- Negative: large collections require multiple extractor pages and take longer to enumerate.
- Negative: backend worker lifecycle and pause ownership add state that must be recovered on startup.
- Risk: extractor behavior and site authentication still depend on the installed yt-dlp build and
  user-selected browser cookies.