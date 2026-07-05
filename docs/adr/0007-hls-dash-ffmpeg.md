# ADR‑0007: HLS/DASH capture via ffmpeg

- **Status:** Accepted
- **Date:** 2026-06-29
- **Deciders:** Project owner

## Context

Streaming media is delivered as **HLS (`.m3u8`)** or **DASH (`.mpd`)** manifests pointing at many
segments. aria2 downloads files, not adaptive manifests, so capturing a watchable video needs a
muxing step.

## Decision

Route manifest URLs to **ffmpeg** instead of aria2.

- The bridge (and a `grab_hls` command) detect `.m3u8`/`.mpd` and spawn
  `ffmpeg -y -i <url> -c copy <Video>/<name>.mp4`.
- `-c copy` remuxes without re‑encoding — fast and lossless — writing into the `Video/` category folder.
- ffmpeg is a declared `.deb` dependency.

## Alternatives considered

- **aria2 segment download + manual concat** — brittle; doesn't handle variant playlists, keys, or
  container differences.
- **Bundle a custom HLS downloader** — reinvents ffmpeg's mature demux/mux.

## Consequences

- Positive: reliable single‑file `.mp4` output from streams; no re‑encode cost.
- Negative: progress for ffmpeg jobs isn't yet surfaced in the aria2 task list (fire‑and‑forget spawn);
  encrypted/DRM streams are out of scope. Variant/quality selection is a follow‑up (see ADR‑0005).
