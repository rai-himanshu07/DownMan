use once_cell::sync::Lazy;
use rusqlite::Connection;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

pub const CORE_SCHEMA_VERSION: i64 = 7;
pub const LEGACY_BACKUP_DIR: &str = ".downman-1.0.1-backup";
static INITIALIZED_DATABASES: Lazy<Mutex<HashSet<PathBuf>>> =
    Lazy::new(|| Mutex::new(HashSet::new()));

pub fn database_path(state_dir: &Path) -> PathBuf {
    state_dir.join("downman-state.sqlite3")
}

pub fn open(state_dir: &Path) -> Result<Connection, String> {
    std::fs::create_dir_all(state_dir)
        .map_err(|error| format!("could not create DownMan state directory: {error}"))?;
    let path = database_path(state_dir);
    if !path.exists() {
        backup_legacy_state(state_dir)?;
    }
    let mut connection = Connection::open(&path)
        .map_err(|error| format!("could not open DownMan state database: {error}"))?;
    connection
        .busy_timeout(Duration::from_secs(5))
        .map_err(|error| format!("could not configure state database timeout: {error}"))?;
    connection
        .pragma_update(None, "foreign_keys", "ON")
        .map_err(|error| format!("could not enable database foreign keys: {error}"))?;
    let mut initialized = INITIALIZED_DATABASES
        .lock()
        .map_err(|_| "state database initialization lock is unavailable".to_string())?;
    if !initialized.contains(&path) {
        connection
            .pragma_update(None, "journal_mode", "WAL")
            .map_err(|error| format!("could not enable database WAL mode: {error}"))?;
        migrate(&mut connection)?;
        initialized.insert(path);
    }
    Ok(connection)
}

fn backup_legacy_state(state_dir: &Path) -> Result<(), String> {
    let backup = state_dir.join(LEGACY_BACKUP_DIR);
    if backup.exists() {
        return Ok(());
    }
    let entries = std::fs::read_dir(state_dir)
        .map_err(|error| format!("could not inspect legacy state for backup: {error}"))?;
    let legacy_files = entries
        .filter_map(Result::ok)
        .filter(|entry| {
            entry
                .file_type()
                .map(|kind| kind.is_file())
                .unwrap_or(false)
        })
        .filter(|entry| {
            entry
                .file_name()
                .to_str()
                .is_some_and(|name| name.starts_with(".downman-"))
        })
        .collect::<Vec<_>>();
    if legacy_files.is_empty() {
        return Ok(());
    }
    let temporary = state_dir.join(format!("{LEGACY_BACKUP_DIR}.tmp-{}", std::process::id()));
    if temporary.exists() {
        std::fs::remove_dir_all(&temporary)
            .map_err(|error| format!("could not clear incomplete legacy backup: {error}"))?;
    }
    std::fs::create_dir(&temporary)
        .map_err(|error| format!("could not create legacy state backup: {error}"))?;
    for entry in legacy_files {
        let destination = temporary.join(entry.file_name());
        if let Err(error) = std::fs::copy(entry.path(), &destination) {
            let _ = std::fs::remove_dir_all(&temporary);
            return Err(format!("could not back up legacy state: {error}"));
        }
    }
    match std::fs::rename(&temporary, &backup) {
        Ok(()) => Ok(()),
        Err(_) if backup.exists() => {
            let _ = std::fs::remove_dir_all(temporary);
            Ok(())
        }
        Err(error) => {
            let _ = std::fs::remove_dir_all(temporary);
            Err(format!("could not finalize legacy state backup: {error}"))
        }
    }
}

fn migrate(connection: &mut Connection) -> Result<(), String> {
    let transaction = connection
        .transaction()
        .map_err(|error| format!("could not start state migration: {error}"))?;
    transaction
        .execute_batch(
            r#"
            CREATE TABLE IF NOT EXISTS schema_migrations (
                component TEXT PRIMARY KEY NOT NULL,
                version INTEGER NOT NULL,
                applied_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY NOT NULL,
                value TEXT NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS download_profiles (
                id TEXT PRIMARY KEY NOT NULL,
                name TEXT NOT NULL,
                builtin INTEGER NOT NULL DEFAULT 0,
                profile_json TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_download_profiles_name
                ON download_profiles(name COLLATE NOCASE);

            CREATE TABLE IF NOT EXISTS collection_sessions (
                id TEXT PRIMARY KEY NOT NULL,
                source_url TEXT NOT NULL,
                source_type TEXT NOT NULL,
                title TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL,
                total_known INTEGER NOT NULL DEFAULT 0,
                loaded_count INTEGER NOT NULL DEFAULT 0,
                page_size INTEGER NOT NULL,
                next_index INTEGER NOT NULL DEFAULT 1,
                profile_id TEXT NOT NULL,
                error TEXT NOT NULL DEFAULT '',
                cancel_requested INTEGER NOT NULL DEFAULT 0,
                enqueue_status TEXT NOT NULL DEFAULT '',
                enqueued_count INTEGER NOT NULL DEFAULT 0,
                failed_count INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS collection_items (
                session_id TEXT NOT NULL REFERENCES collection_sessions(id) ON DELETE CASCADE,
                item_index INTEGER NOT NULL,
                media_id TEXT NOT NULL DEFAULT '',
                extractor TEXT NOT NULL DEFAULT '',
                source_url TEXT NOT NULL,
                title TEXT NOT NULL DEFAULT '',
                uploader TEXT NOT NULL DEFAULT '',
                duration_sec INTEGER NOT NULL DEFAULT 0,
                upload_date TEXT NOT NULL DEFAULT '',
                thumbnail TEXT NOT NULL DEFAULT '',
                live_state TEXT NOT NULL DEFAULT '',
                estimated_size INTEGER NOT NULL DEFAULT 0,
                availability TEXT NOT NULL DEFAULT '',
                selected INTEGER NOT NULL DEFAULT 1,
                enqueue_status TEXT NOT NULL DEFAULT '',
                archived INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY(session_id, item_index)
            );

            CREATE TABLE IF NOT EXISTS media_archive (
                extractor TEXT NOT NULL DEFAULT '',
                media_id TEXT NOT NULL DEFAULT '',
                canonical_url TEXT NOT NULL DEFAULT '',
                title TEXT NOT NULL DEFAULT '',
                source_url TEXT NOT NULL DEFAULT '',
                file_path TEXT NOT NULL DEFAULT '',
                completed_at INTEGER NOT NULL,
                PRIMARY KEY(extractor, media_id)
            );

            CREATE UNIQUE INDEX IF NOT EXISTS idx_media_archive_url
                ON media_archive(canonical_url) WHERE canonical_url <> '';

            CREATE TABLE IF NOT EXISTS preflight_sessions (
                id TEXT PRIMARY KEY NOT NULL,
                status TEXT NOT NULL,
                profile_id TEXT NOT NULL,
                total_count INTEGER NOT NULL DEFAULT 0,
                accepted_count INTEGER NOT NULL DEFAULT 0,
                rejected_count INTEGER NOT NULL DEFAULT 0,
                estimate_sizes INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS preflight_items (
                session_id TEXT NOT NULL REFERENCES preflight_sessions(id) ON DELETE CASCADE,
                item_index INTEGER NOT NULL,
                original TEXT NOT NULL,
                normalized_url TEXT NOT NULL DEFAULT '',
                kind TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL,
                reason TEXT NOT NULL DEFAULT '',
                filename TEXT NOT NULL DEFAULT '',
                conflict_path TEXT NOT NULL DEFAULT '',
                estimated_size INTEGER NOT NULL DEFAULT 0,
                estimated_seconds INTEGER NOT NULL DEFAULT 0,
                content_type TEXT NOT NULL DEFAULT '',
                selected INTEGER NOT NULL DEFAULT 0,
                commit_status TEXT NOT NULL DEFAULT '',
                PRIMARY KEY(session_id, item_index)
            );

            CREATE INDEX IF NOT EXISTS idx_preflight_items_status
                ON preflight_items(session_id, status, item_index);

            CREATE TABLE IF NOT EXISTS subscriptions (
                id TEXT PRIMARY KEY NOT NULL,
                name TEXT NOT NULL,
                kind TEXT NOT NULL,
                source_url TEXT NOT NULL,
                profile_id TEXT NOT NULL,
                poll_interval_min INTEGER NOT NULL DEFAULT 60,
                enabled INTEGER NOT NULL DEFAULT 1,
                action TEXT NOT NULL DEFAULT 'review',
                notify INTEGER NOT NULL DEFAULT 1,
                include_keywords TEXT NOT NULL DEFAULT '[]',
                exclude_keywords TEXT NOT NULL DEFAULT '[]',
                min_duration_sec INTEGER NOT NULL DEFAULT 0,
                max_duration_sec INTEGER NOT NULL DEFAULT 0,
                content_type TEXT NOT NULL DEFAULT 'all',
                max_items_per_poll INTEGER NOT NULL DEFAULT 10,
                live_policy_override TEXT NOT NULL DEFAULT '',
                cookies_browser TEXT NOT NULL DEFAULT '',
                m3u_target TEXT NOT NULL DEFAULT '',
                running INTEGER NOT NULL DEFAULT 0,
                last_run_at INTEGER NOT NULL DEFAULT 0,
                last_success_at INTEGER NOT NULL DEFAULT 0,
                next_run_at INTEGER NOT NULL DEFAULT 0,
                last_error TEXT NOT NULL DEFAULT '',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_source
                ON subscriptions(source_url);

            CREATE TABLE IF NOT EXISTS subscription_seen (
                subscription_id TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
                extractor TEXT NOT NULL,
                media_id TEXT NOT NULL,
                canonical_url TEXT NOT NULL DEFAULT '',
                first_seen_at INTEGER NOT NULL,
                action TEXT NOT NULL DEFAULT '',
                PRIMARY KEY(subscription_id, extractor, media_id)
            );

            CREATE TABLE IF NOT EXISTS review_inbox (
                id TEXT PRIMARY KEY NOT NULL,
                subscription_id TEXT NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
                extractor TEXT NOT NULL,
                media_id TEXT NOT NULL,
                canonical_url TEXT NOT NULL,
                title TEXT NOT NULL DEFAULT '',
                uploader TEXT NOT NULL DEFAULT '',
                duration_sec INTEGER NOT NULL DEFAULT 0,
                upload_date TEXT NOT NULL DEFAULT '',
                thumbnail TEXT NOT NULL DEFAULT '',
                live_state TEXT NOT NULL DEFAULT '',
                profile_id TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'new',
                selected INTEGER NOT NULL DEFAULT 1,
                discovered_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                UNIQUE(subscription_id, extractor, media_id)
            );

            CREATE INDEX IF NOT EXISTS idx_review_inbox_status
                ON review_inbox(status, discovered_at DESC);

            CREATE TABLE IF NOT EXISTS search_sessions (
                id TEXT PRIMARY KEY NOT NULL,
                query TEXT NOT NULL,
                status TEXT NOT NULL,
                loaded_count INTEGER NOT NULL DEFAULT 0,
                total_limit INTEGER NOT NULL DEFAULT 500,
                page_size INTEGER NOT NULL DEFAULT 50,
                error TEXT NOT NULL DEFAULT '',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS search_items (
                session_id TEXT NOT NULL REFERENCES search_sessions(id) ON DELETE CASCADE,
                item_index INTEGER NOT NULL,
                extractor TEXT NOT NULL,
                media_id TEXT NOT NULL,
                canonical_url TEXT NOT NULL,
                title TEXT NOT NULL DEFAULT '',
                uploader TEXT NOT NULL DEFAULT '',
                duration_sec INTEGER NOT NULL DEFAULT 0,
                upload_date TEXT NOT NULL DEFAULT '',
                thumbnail TEXT NOT NULL DEFAULT '',
                live_state TEXT NOT NULL DEFAULT '',
                selected INTEGER NOT NULL DEFAULT 0,
                archived INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY(session_id, item_index)
            );

            CREATE INDEX IF NOT EXISTS idx_collection_items_title
                ON collection_items(session_id, title COLLATE NOCASE);
            CREATE INDEX IF NOT EXISTS idx_collection_items_selected
                ON collection_items(session_id, selected, item_index);
            "#,
        )
        .map_err(|error| format!("could not create state database schema: {error}"))?;
    add_column_if_missing(
        &transaction,
        "collection_sessions",
        "enqueue_status",
        "TEXT NOT NULL DEFAULT ''",
    )?;
    add_column_if_missing(
        &transaction,
        "collection_sessions",
        "enqueued_count",
        "INTEGER NOT NULL DEFAULT 0",
    )?;
    add_column_if_missing(
        &transaction,
        "collection_sessions",
        "failed_count",
        "INTEGER NOT NULL DEFAULT 0",
    )?;
    add_column_if_missing(
        &transaction,
        "collection_items",
        "enqueue_status",
        "TEXT NOT NULL DEFAULT ''",
    )?;
    add_column_if_missing(
        &transaction,
        "collection_items",
        "archived",
        "INTEGER NOT NULL DEFAULT 0",
    )?;
    add_column_if_missing(
        &transaction,
        "subscriptions",
        "cookies_browser",
        "TEXT NOT NULL DEFAULT ''",
    )?;
    add_column_if_missing(
        &transaction,
        "subscriptions",
        "m3u_target",
        "TEXT NOT NULL DEFAULT ''",
    )?;
    add_column_if_missing(
        &transaction,
        "subscriptions",
        "running",
        "INTEGER NOT NULL DEFAULT 0",
    )?;
    transaction
        .execute_batch(
            "CREATE INDEX IF NOT EXISTS idx_subscriptions_due
             ON subscriptions(enabled, running, next_run_at);",
        )
        .map_err(|error| format!("could not index subscription schedule: {error}"))?;
    transaction
        .execute(
            "INSERT INTO schema_migrations(component, version, applied_at) VALUES('core', ?1, unixepoch())
             ON CONFLICT(component) DO UPDATE SET version=excluded.version, applied_at=excluded.applied_at",
            [CORE_SCHEMA_VERSION],
        )
        .map_err(|error| format!("could not record state migration: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("could not commit state migration: {error}"))
}

fn add_column_if_missing(
    transaction: &rusqlite::Transaction<'_>,
    table: &str,
    column: &str,
    definition: &str,
) -> Result<(), String> {
    let mut statement = transaction
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|error| format!("could not inspect {table} schema: {error}"))?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| format!("could not read {table} schema: {error}"))?;
    for existing in columns {
        if existing.map_err(|error| format!("could not decode {table} schema: {error}"))? == column
        {
            return Ok(());
        }
    }
    transaction
        .execute_batch(&format!(
            "ALTER TABLE {table} ADD COLUMN {column} {definition}"
        ))
        .map_err(|error| format!("could not add {table}.{column}: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn state_database_migrates_idempotently() {
        let root = std::env::temp_dir().join(format!(
            "downman-state-db-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let first = open(&root).unwrap();
        let version: i64 = first
            .query_row(
                "SELECT version FROM schema_migrations WHERE component='core'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(version, CORE_SCHEMA_VERSION);
        drop(first);
        open(&root).unwrap();
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn version_two_collection_schema_upgrades_without_losing_rows() {
        let root = std::env::temp_dir().join(format!(
            "downman-state-upgrade-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let path = database_path(&root);
        let connection = Connection::open(&path).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE schema_migrations(component TEXT PRIMARY KEY, version INTEGER, applied_at INTEGER);
                 INSERT INTO schema_migrations VALUES('core', 2, 0);
                 CREATE TABLE collection_sessions(
                    id TEXT PRIMARY KEY, source_url TEXT, source_type TEXT, title TEXT,
                    status TEXT, total_known INTEGER, loaded_count INTEGER,
                    page_size INTEGER, next_index INTEGER, profile_id TEXT,
                    error TEXT, cancel_requested INTEGER, created_at INTEGER, updated_at INTEGER
                 );
                 CREATE TABLE collection_items(
                    session_id TEXT, item_index INTEGER, media_id TEXT, extractor TEXT,
                    source_url TEXT, title TEXT, uploader TEXT, duration_sec INTEGER,
                    upload_date TEXT, thumbnail TEXT, live_state TEXT, estimated_size INTEGER,
                    availability TEXT, selected INTEGER, PRIMARY KEY(session_id, item_index)
                 );
                 INSERT INTO collection_sessions VALUES(
                    'old', 'https://example.test/list', 'playlist', 'Old', 'ready',
                    1, 1, 100, 2, 'best', '', 0, 1, 1
                 );",
            )
            .unwrap();
        drop(connection);
        let upgraded = open(&root).unwrap();
        let row: (String, String) = upgraded
            .query_row(
                "SELECT id, enqueue_status FROM collection_sessions WHERE id='old'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(row, ("old".into(), String::new()));
        let archived_column: u32 = upgraded
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('collection_items') WHERE name='archived'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(archived_column, 1);
        drop(upgraded);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn early_subscription_schema_adds_runtime_columns() {
        let root = std::env::temp_dir().join(format!(
            "downman-subscription-upgrade-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let path = database_path(&root);
        let connection = Connection::open(&path).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE subscriptions (
                    id TEXT PRIMARY KEY NOT NULL,
                    name TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    source_url TEXT NOT NULL,
                    profile_id TEXT NOT NULL,
                    poll_interval_min INTEGER NOT NULL DEFAULT 60,
                    enabled INTEGER NOT NULL DEFAULT 1,
                    action TEXT NOT NULL DEFAULT 'review',
                    notify INTEGER NOT NULL DEFAULT 1,
                    include_keywords TEXT NOT NULL DEFAULT '[]',
                    exclude_keywords TEXT NOT NULL DEFAULT '[]',
                    min_duration_sec INTEGER NOT NULL DEFAULT 0,
                    max_duration_sec INTEGER NOT NULL DEFAULT 0,
                    content_type TEXT NOT NULL DEFAULT 'all',
                    max_items_per_poll INTEGER NOT NULL DEFAULT 10,
                    live_policy_override TEXT NOT NULL DEFAULT '',
                    cookies_browser TEXT NOT NULL DEFAULT '',
                    last_run_at INTEGER NOT NULL DEFAULT 0,
                    last_success_at INTEGER NOT NULL DEFAULT 0,
                    next_run_at INTEGER NOT NULL DEFAULT 0,
                    last_error TEXT NOT NULL DEFAULT '',
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                 );
                 INSERT INTO subscriptions(
                    id, name, kind, source_url, profile_id, created_at, updated_at
                 ) VALUES(
                    'early', 'Early source', 'channel', 'https://example.test/channel',
                    'best', 1, 1
                 );",
            )
            .unwrap();
        drop(connection);

        let upgraded = open(&root).unwrap();
        let row: (String, i64) = upgraded
            .query_row(
                "SELECT m3u_target, running FROM subscriptions WHERE id='early'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(row, (String::new(), 0));
        drop(upgraded);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn first_sqlite_open_preserves_legacy_state_and_never_overwrites_backup() {
        let root = std::env::temp_dir().join(format!(
            "downman-state-backup-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let history = root.join(".downman-history.json");
        let queues = root.join(".downman-queues.json");
        std::fs::write(&history, b"[{\"gid\":\"legacy\"}]").unwrap();
        std::fs::write(&queues, b"[{\"id\":\"main\"}]").unwrap();

        open(&root).unwrap();
        let backup = root.join(LEGACY_BACKUP_DIR);
        assert_eq!(
            std::fs::read(backup.join(".downman-history.json")).unwrap(),
            b"[{\"gid\":\"legacy\"}]"
        );
        assert_eq!(
            std::fs::read(backup.join(".downman-queues.json")).unwrap(),
            b"[{\"id\":\"main\"}]"
        );
        assert_eq!(std::fs::read(&history).unwrap(), b"[{\"gid\":\"legacy\"}]");

        std::fs::write(&history, b"new state").unwrap();
        open(&root).unwrap();
        assert_eq!(
            std::fs::read(backup.join(".downman-history.json")).unwrap(),
            b"[{\"gid\":\"legacy\"}]"
        );
        std::fs::remove_dir_all(root).unwrap();
    }
}
