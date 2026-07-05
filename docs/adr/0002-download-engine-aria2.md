# ADR‑0002: Download engine — aria2 via JSON‑RPC

- **Status:** Accepted
- **Date:** 2026-06-29
- **Deciders:** Project owner

## Context

The product is explicitly "a download manager **based on aria2**." We need HTTP/FTP, BitTorrent,
and magnet support, multi‑connection segmented downloads, pause/resume, and progress/stat reporting —
without reimplementing a download engine.

## Decision

Run **aria2c as a child process** with its JSON‑RPC interface enabled, and drive it from the Rust core.

- Launch flags: `--enable-rpc --rpc-listen-all=false --rpc-listen-port=6810 --rpc-secret=<random>`
  plus tuned defaults (`--continue`, `--max-connection-per-server=16`, `--split=16`, `--seed-time=0`,
  `--follow-torrent=true`, …).
- The Rust client (`aria2.rs`) speaks HTTP JSON‑RPC and prefixes every call with the secret token.
- aria2c is launched from the system `PATH` (declared as the `.deb` dependency `aria2`); it is **not**
  bundled as a sidecar, which avoids clobbering the distro's own `/usr/bin/aria2c`.

## Alternatives considered

- **libaria2 FFI** — tighter integration but fragile bindings and harder builds; RPC is the supported,
  stable contract.
- **Custom Rust downloader** (reqwest + segments) — large effort, no torrent/magnet, reinvents aria2.

## Consequences

- Positive: full feature set for free; clean process isolation; the same RPC the broader aria2
  ecosystem uses.
- Negative: must manage the child lifecycle and the RPC port (orphans on dev hot‑reload → see the
  self‑heal `pkill` in `start_engine`). Secret‑token handling required on every call.
- Security: RPC is loopback‑only and token‑authenticated.
