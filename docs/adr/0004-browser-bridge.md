# ADR‑0004: Browser ↔ app integration over a local HTTP bridge

- **Status:** Accepted
- **Date:** 2026-06-29
- **Deciders:** Project owner

## Context

The product must let **browser extensions hand downloads to the app** (Chromium + Firefox). The
transport needs to work from an MV3 service worker, be simple to call, and not require pairing the
two apps through a store‑signed native‑messaging manifest during development.

## Decision

Expose a tiny **localhost HTTP endpoint** from the Rust core and have the extension `fetch()` it.

- Server: `tiny_http` on `127.0.0.1:6802`, started in a background thread (`start_bridge`).
- Contract: `POST /add` with `{ "uris": [...], "options": {...} }` → `{ "ok": true|false }`.
- Handles CORS preflight (`OPTIONS` → 204, `Access-Control-Allow-Origin: *`).
- The bridge forwards to aria2 — or to ffmpeg when the URI is an HLS/DASH manifest (see ADR‑0007).

## Alternatives considered

- **Native messaging** — robust for production, but needs a host manifest registered per browser and
  is awkward to iterate on. Kept as a future hardening option.
- **WebSocket** — useful for push, but the extension only needs fire‑and‑forget *add* calls; HTTP is simpler.

## Consequences

- Positive: trivial to call from any browser; one endpoint; works in dev with zero registration.
- Negative: CORS is wide‑open (`*`). Acceptable because the socket is **loopback‑only**, but if exposed
  more broadly it should require a shared token and restrict origins.
- The extension's endpoint is configurable on its options page (defaults to `http://127.0.0.1:6802`).

## Update (2026‑07)

The bridge now **rejects requests carrying a web‑page `Origin`** (`http(s)://…` or `null`) with `403`,
while still allowing extension origins and header‑less native callers. This closes the “a website could
POST to the loopback socket” gap noted above, without needing native‑messaging pairing.

## Update (2026-07-22)

Operational routes now also require a persisted 48-character capability token in
`X-DownMan-Token`. A browser installation obtains it only through `POST /pair` during a one-shot,
60-second window explicitly opened from the app's Browser settings. The user can cancel pairing or
rotate the token to revoke every paired extension. The token is stored under the application data
root with mode `0600`; it is never exposed through diagnostics or the ordinary bridge-status API.

The HTTP transport remains deliberate: the extension only polls while its popup is open, while the
Rust backend continues to own schedules, completion handling, and follows. Authenticated routes now
cover add, format lookup, rules, task snapshots, Site Grabber requests, and bounded task actions.
