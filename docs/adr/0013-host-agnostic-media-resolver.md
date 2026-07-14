# ADR-0013: Host-agnostic media intent resolver

- **Status:** Accepted
- **Date:** 2026-07-11
- **Deciders:** Project owner
- **Relates to:** [ADR-0005](0005-smart-media-capture.md), [ADR-0010](0010-multi-engine-media-capture.md)

## Context

The per-media extension initially chose one URL before the app saw the available evidence. Direct
DOM sources, post/page guesses, and the newest frame-scoped network response competed through
separate rules. Dynamic feeds then required website-specific selectors and permalink handling, but
those patches could not generalize across changing DOMs, blob/MSE players, multiple videos in one
frame, signed CDN URLs, or suspended MV3 workers.

The browser must decide which observed source belongs to the media the user selected. The app must
separately decide which engine can download that source.

## Decision

Adopt a versioned, host-agnostic media resolver:

1. The content script emits a `MediaIntent` containing a stable per-element media ID, trigger time,
   frame/page URLs, source kind, playback state, duration, dimensions, visible area, a
   `detail`/`collection`/`document` context, and total plus visibly competing owner-media counts.
   Feed-page extraction candidates must be structurally bound through direct media ancestry or the
   unique nearest timestamp permalink; unrelated links elsewhere in an article are not media
   evidence. A pure URL-identity classifier canonicalizes common content routes and query identities
   without consulting the host name, so equivalent post and permalink variants collapse together.
2. The background records direct-media and HLS/DASH responses in a bounded candidate ledger. Each
   candidate retains its raw URL, a separate canonical deduplication key, frame/document context,
   content type, response size, timestamps, request type, and associated media IDs.
3. File candidates expire after 10 minutes; volatile manifest/page candidates expire after 2
   minutes. The ledger is capped at 200 candidates per tab, cleared on navigation/tab close, and
   stored in `storage.session` when available so MV3 worker suspension does not erase it.
4. A dependency-free pure scorer ranks candidates using exact `currentSrc`, player-session and frame
   correlation, content type, manifest evidence, timing, size, visible geometry, and generic
   segment/UI/ad penalties. Partial byte-range media is evidence about playback but is never a
   downloadable candidate. Host names do not participate in browser selection.
   Concurrent players are tracked independently; unbound network responses are never promoted to a
   specific player merely because they share a frame, and audio-only manifests are rejected for
   video intents.
5. A dependency-free pure planner applies one decision table after scoring. A collection capture may
   automatically submit only an exact HTTP element source or one uniquely bound post page with no
   visibly competing media. Detail pages use the same binding rule, including the canonical current
   document. Unbound or competing collection captures fail safely; frame timing or a temporal player
   association alone cannot authorize a feed download. Low-confidence non-collection evidence may
   show at most three source choices. Every automatic or explicit choice carries a selected index, so
   extractor failure cannot fall through to an unrelated candidate.
6. The Rust bridge validates schema version 2 and remains the final route planner. Observed media
   content goes to aria2, manifests/pages go to yt-dlp, and ambiguous URLs are probed. Known extractor
   hosts remain only a legacy soft hint after stronger evidence. A failed engine advances to the next
   ranked candidate, including after asynchronous yt-dlp failure, unless the browser supplied an
   explicit selected index.
7. Site Grabber remains a separate static crawler for linked files and is not a media fallback.

## Privacy and security

- Raw signed media URLs are kept only in browser session memory and are never written to application
   logs. They remain unchanged for downloading and use separate canonical keys only for deduplication.
- Page-extractor URLs are canonicalized by content identity to remove navigation/tracking variants.
- Cookies are not copied into the ledger or candidate bundle. The existing browser-cookie preference
  is forwarded only to yt-dlp through the local origin-gated bridge.
- Blob URLs are evidence about the player but are never sent as downloadable candidates.
- Completed browser-generated blob files may be adopted only from a canonical path inside the user's
   Downloads directory; arbitrary local paths are rejected by the bridge.

## Consequences

- Positive: the resolver handles changing site DOMs without adding website branches.
- Positive: multi-video feeds, extensionless media, HLS/DASH, overlay-covered players, signed URLs,
  iframes, and MV3 worker suspension share one deterministic pipeline.
- Positive: scorer and worker behavior are testable without contacting live websites.
- Positive: shell page titles remain UI hints only; extractor metadata names media unless the user
   explicitly edits the filename.
- Negative: network timing cannot safely identify one player in a collection and is never sufficient
   there without an exact element source or structurally bound page identity.
- Negative: ambiguous feed posts, including posts with multiple media elements, are refused rather
   than guessed and may require opening the individual post before retrying.
- Negative: page extraction remains dependent on yt-dlp support, authentication, and current site
   extractors after partial media fragments have been intentionally excluded.
- Negative: DRM-protected media remains unsupported, and an accepted aria2 task can still fail later
  if a signed URL expires after submission.