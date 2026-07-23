# ADR-0014: Versioned SQLite workflow state and immutable job policies

- **Status:** Accepted
- **Date:** 2026-07-17
- **Deciders:** Project owner
- **Relates to:** [ADR-0002](0002-download-engine-aria2.md), [ADR-0010](0010-multi-engine-media-capture.md)

## Context

DownMan 1.0 stores history, rules, categories, queues, and download metadata in small JSON files,
while presentation settings and the global schedule live in WebView `localStorage`. That is adequate
for independent preferences, but 1.1 adds related and potentially large state: reusable profiles,
paged collections, preflight review, media identity, followed sources, a review inbox, and search
sessions.

These workflows need transactions, uniqueness constraints, bounded page queries, crash recovery,
and additive schema upgrades. They must also survive while the WebView is closed without replacing
or risking the established 1.0 state files.

A profile is a mutable reusable definition. A queued download, however, must remain reproducible:
editing a profile later cannot silently change its format, output, network, clip, or live policy.

## Decision

1. Use `rusqlite` with bundled SQLite for 1.1 workflow state at
   `~/.local/share/DownMan/downman-state.sqlite3` (through the platform state directory).
2. Enable foreign keys, WAL journaling, and a five-second busy timeout. Apply migrations in one
   transaction and record the core schema version in `schema_migrations`.
3. Make migrations idempotent. New tables use `CREATE TABLE IF NOT EXISTS`; columns introduced
   during 1.1 development are inspected and added before indexes that depend on them.
4. Before the first database is created, copy existing `.downman-*` files once into
   `.downman-1.0.1-backup`. Do not delete, rewrite, or eagerly import the originals.
5. Store profiles, collection/preflight/search sessions and items, the completed-media archive,
   subscriptions, seen identities, Review Inbox rows, and backend scheduler settings in SQLite.
   Existing history, rules, categories, queues, and download metadata retain their compatible
   stores.
6. Resolve and validate a `DownloadProfile` before enqueue. Copy the complete resolved profile into
   the job metadata as an immutable snapshot; retain the profile ID only for attribution.
7. Store per-job schedule and non-secret network overrides with the job. Keep HTTP passwords in
   process memory only and never expose them through snapshots or diagnostics.
8. Write media archive identity only after confirmed completion and a final output path. Prefer
   `(extractor, media_id)` and use canonical URL as a fallback deduplication key.

## Alternatives considered

- **Extend the JSON files** — simple, but multi-row updates, uniqueness, paging, and concurrent
  workers would require a fragile database layer implemented in application code.
- **Replace every legacy store immediately** — one persistence model, but an unnecessary migration
  blast radius for stable history, rules, categories, and queue behavior.
- **Store only a profile ID on each job** — smaller metadata, but queued behavior would change when
  a user edits or deletes that profile.
- **Use the system SQLite library** — smaller binary, but distro version differences would make
  migrations and release behavior less reproducible.

## Consequences

- Positive: large workflows are transactional, page-addressable, and recoverable after restart.
- Positive: migrations can upgrade early 1.1 databases without losing rows.
- Positive: queued work remains stable even when reusable profiles change.
- Positive: the 1.0 state remains available with a one-time non-destructive backup.
- Negative: release binaries grow because SQLite is bundled.
- Negative: two persistence families remain until a later migration is justified.
- Risk: profile headers and proxy settings may contain sensitive values, so logs and diagnostics
  must continue to omit policy contents.

## Update (2026-07-22)

The original implementation accidentally resolved the state root to `~/Downloads/DownMan` despite
this ADR choosing the platform application-data directory. State now lives at
`~/.local/share/DownMan`. Before database initialization, DownMan copies an allowlist of durable
legacy files and a checkpointed SQLite database through temporary files, runs `PRAGMA quick_check`,
and atomically publishes the result. It never copies transient WAL/SHM files or runtime markers and
does not delete or overwrite the legacy source. The state root uses mode `0700`; migrated state
files, the SQLite database, the migration marker, and the bridge token use mode `0600`.

The global schedule is also cached in backend memory after startup and updated after successful
persistence. Queue enforcement no longer opens a WAL connection every two seconds merely to reread
unchanged policy.