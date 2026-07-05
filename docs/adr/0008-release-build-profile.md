# ADR‑0008: Release build profile — disable LTO

- **Status:** Accepted
- **Date:** 2026-06-29
- **Deciders:** Project owner

## Context

The first `tauri build` was configured for the smallest binary:

```toml
[profile.release]
panic = "abort"
codegen-units = 1
lto = true
opt-level = "s"
```

This **hung for ~1 hour** while "Compiling tray-icon / webkit2gtk / tao". Diagnosis: `rustc` sat at
**0 % CPU** with no log progress, and the machine had ~19 GB RAM free — i.e. not OOM, but a
pathological LTO codegen stall serialized onto a single codegen unit across the heavy GTK/WebKit
binding crates.

## Decision

Use a **fast, parallel** release profile:

```toml
[profile.release]
opt-level = 2
codegen-units = 16
lto = false
strip = true
incremental = true
```

With this, the `.deb` built in ~2–3 minutes on 16 cores.

## Alternatives considered

- **Thin LTO** (`lto = "thin"`) — a middle ground worth trying *only* for final shipping builds,
  with a watchdog to confirm it doesn't stall.
- **Keep full LTO** — rejected; the time cost and hang risk aren't worth marginal size savings for a
  personal app.

## Consequences

- Positive: reliable, fast builds; binary ~16 MB (still `strip`ped).
- Negative: slightly larger/less‑optimized binary than full‑LTO would produce.
- Diagnostic playbook: `ps -eo pid,etimes,%cpu,comm | grep rustc` — **0 % CPU + stale log = hung**,
  not working. Kill with `pkill -9 rustc; pkill -9 -f 'tauri build'`.
