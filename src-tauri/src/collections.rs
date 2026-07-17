use crate::state_db;
use once_cell::sync::Lazy;
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::os::unix::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

const MAX_ITEMS: u32 = 10_000;
const DEFAULT_PAGE_SIZE: u32 = 100;
const MAX_PAGE_SIZE: u32 = 200;
const MAX_QUERY_PAGE: u32 = 200;

static SESSION_COUNTER: AtomicU64 = AtomicU64::new(0);
static PROCESSES: Lazy<Mutex<HashMap<String, u32>>> = Lazy::new(|| Mutex::new(HashMap::new()));

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionSession {
    pub id: String,
    pub source_url: String,
    pub source_type: String,
    pub title: String,
    pub status: String,
    pub total_known: u32,
    pub loaded_count: u32,
    pub page_size: u32,
    pub next_index: u32,
    pub profile_id: String,
    pub error: String,
    pub enqueue_status: String,
    pub enqueued_count: u32,
    pub failed_count: u32,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionItem {
    pub index: u32,
    pub media_id: String,
    pub extractor: String,
    pub url: String,
    pub title: String,
    pub uploader: String,
    pub duration_sec: u64,
    pub upload_date: String,
    pub thumbnail: String,
    pub live_state: String,
    pub estimated_size: u64,
    pub availability: String,
    pub selected: bool,
    pub enqueue_status: String,
    pub archived: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionPage {
    pub session: CollectionSession,
    pub items: Vec<CollectionItem>,
    pub filtered_count: u32,
    pub selected_count: u32,
    pub offset: u32,
    pub limit: u32,
}

#[derive(Clone)]
pub struct ExtractorConfig {
    pub binary: String,
    pub path: String,
    pub js_runtime: Option<String>,
    pub cookies_browser: Option<String>,
}

pub fn start(
    state_dir: PathBuf,
    source_url: String,
    profile_id: String,
    page_size: Option<u32>,
    extractor: ExtractorConfig,
) -> Result<CollectionSession, String> {
    validate_source(&source_url)?;
    let page_size = page_size
        .unwrap_or(DEFAULT_PAGE_SIZE)
        .clamp(1, MAX_PAGE_SIZE);
    let now = now_ms();
    let id = format!(
        "collection-{now}-{}",
        SESSION_COUNTER.fetch_add(1, Ordering::Relaxed)
    );
    let session = CollectionSession {
        id: id.clone(),
        source_url: source_url.clone(),
        source_type: source_type(&source_url).into(),
        title: String::new(),
        status: "loading".into(),
        total_known: 0,
        loaded_count: 0,
        page_size,
        next_index: 1,
        profile_id,
        error: String::new(),
        enqueue_status: String::new(),
        enqueued_count: 0,
        failed_count: 0,
        created_at: now,
        updated_at: now,
    };
    insert_session(&state_dir, &session)?;
    let worker_id = id.clone();
    std::thread::spawn(move || run_extraction(&state_dir, &worker_id, extractor));
    Ok(session)
}

pub fn page(
    state_dir: &Path,
    id: &str,
    offset: u32,
    limit: u32,
    query: Option<&str>,
    filter: Option<&str>,
) -> Result<CollectionPage, String> {
    let connection = state_db::open(state_dir)?;
    let session = get_session_with_connection(&connection, id)?
        .ok_or_else(|| "collection session does not exist".to_string())?;
    let query = query.unwrap_or("").trim();
    let filter = match filter.unwrap_or("all") {
        "selected" | "live" | "unavailable" | "archived" => filter.unwrap_or("all"),
        _ => "all",
    };
    let limit = limit.clamp(1, MAX_QUERY_PAGE);
    let pattern = format!("%{query}%");
    let where_sql = "session_id=?1
        AND (?2='' OR title LIKE ?3 COLLATE NOCASE OR uploader LIKE ?3 COLLATE NOCASE)
        AND (?4='all'
          OR (?4='selected' AND selected=1)
          OR (?4='live' AND live_state NOT IN ('', 'not_live', 'was_live'))
          OR (?4='unavailable' AND availability NOT IN ('', 'public'))
          OR (?4='archived' AND archived=1))";
    let filtered_count = connection
        .query_row(
            &format!("SELECT COUNT(*) FROM collection_items WHERE {where_sql}"),
            params![id, query, pattern, filter],
            |row| row.get::<_, u32>(0),
        )
        .map_err(|error| format!("could not count collection items: {error}"))?;
    let selected_count = connection
        .query_row(
            "SELECT COUNT(*) FROM collection_items WHERE session_id=?1 AND selected=1",
            [id],
            |row| row.get::<_, u32>(0),
        )
        .map_err(|error| format!("could not count selected collection items: {error}"))?;
    let mut statement = connection
        .prepare(&format!(
            "SELECT item_index, media_id, extractor, source_url, title, uploader,
                    duration_sec, upload_date, thumbnail, live_state, estimated_size,
                    availability, selected, enqueue_status, archived
             FROM collection_items WHERE {where_sql}
             ORDER BY item_index LIMIT ?5 OFFSET ?6"
        ))
        .map_err(|error| format!("could not query collection page: {error}"))?;
    let rows = statement
        .query_map(
            params![id, query, pattern, filter, limit, offset],
            row_to_item,
        )
        .map_err(|error| format!("could not read collection page: {error}"))?;
    let items = rows
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("could not decode collection item: {error}"))?;
    Ok(CollectionPage {
        session,
        items,
        filtered_count,
        selected_count,
        offset,
        limit,
    })
}

pub fn select(state_dir: &Path, id: &str, indices: &[u32], selected: bool) -> Result<u32, String> {
    let mut connection = state_db::open(state_dir)?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("could not update collection selection: {error}"))?;
    let changed = if indices.is_empty() {
        transaction
            .execute(
                "UPDATE collection_items SET selected=?2
                 WHERE session_id=?1 AND (?2=0 OR archived=0)",
                params![id, selected],
            )
            .map_err(|error| format!("could not select collection items: {error}"))?
    } else {
        let mut statement = transaction
            .prepare(
                "UPDATE collection_items SET selected=?3
                 WHERE session_id=?1 AND item_index=?2 AND (?3=0 OR archived=0)",
            )
            .map_err(|error| format!("could not prepare collection selection: {error}"))?;
        let mut changed = 0;
        for index in indices {
            changed += statement
                .execute(params![id, index, selected])
                .map_err(|error| format!("could not select collection item: {error}"))?;
        }
        changed
    };
    transaction
        .commit()
        .map_err(|error| format!("could not commit collection selection: {error}"))?;
    Ok(changed as u32)
}

pub fn selected_items(state_dir: &Path, id: &str) -> Result<Vec<CollectionItem>, String> {
    let connection = state_db::open(state_dir)?;
    let mut statement = connection
        .prepare(
            "SELECT item_index, media_id, extractor, source_url, title, uploader,
                    duration_sec, upload_date, thumbnail, live_state, estimated_size,
                          availability, selected, enqueue_status, archived
                      FROM collection_items
                      WHERE session_id=?1 AND selected=1 AND archived=0 ORDER BY item_index",
        )
        .map_err(|error| format!("could not query selected collection items: {error}"))?;
    statement
        .query_map([id], row_to_item)
        .map_err(|error| format!("could not read selected collection items: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("could not decode selected collection item: {error}"))
}

pub fn cancel(state_dir: &Path, id: &str) -> Result<(), String> {
    let connection = state_db::open(state_dir)?;
    let changed = connection
        .execute(
            "UPDATE collection_sessions
             SET cancel_requested=1,
                 status=CASE WHEN status='loading' THEN 'cancelled' ELSE status END,
                 enqueue_status=CASE WHEN enqueue_status='running' THEN 'cancelled' ELSE enqueue_status END,
                 updated_at=?2 WHERE id=?1",
            params![id, now_ms()],
        )
        .map_err(|error| format!("could not cancel collection inspection: {error}"))?;
    if changed == 0 {
        return Err("collection session does not exist".into());
    }
    if let Some(pid) = PROCESSES
        .lock()
        .ok()
        .and_then(|processes| processes.get(id).copied())
    {
        let _ = Command::new("kill")
            .args(["-TERM", "--", &format!("-{pid}")])
            .status();
    }
    Ok(())
}

pub fn begin_enqueue(state_dir: &Path, id: &str, profile_id: &str) -> Result<(), String> {
    let mut connection = state_db::open(state_dir)?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("could not start collection enqueue: {error}"))?;
    let state: Option<(String, String)> = transaction
        .query_row(
            "SELECT status, enqueue_status FROM collection_sessions WHERE id=?1",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|error| format!("could not read collection status: {error}"))?;
    match state.as_ref().map(|state| state.0.as_str()) {
        Some("ready") => {}
        Some("loading") => return Err("wait for collection inspection to finish".into()),
        Some("cancelled") => return Err("collection inspection was cancelled".into()),
        Some("error") => return Err("collection inspection failed".into()),
        Some(_) => return Err("collection is not ready".into()),
        None => return Err("collection session does not exist".into()),
    }
    if state.as_ref().is_some_and(|state| state.1 == "running") {
        return Err("collection downloads are already running".into());
    }
    let selected_count: u32 = transaction
        .query_row(
            "SELECT COUNT(*) FROM collection_items
             WHERE session_id=?1 AND selected=1 AND archived=0",
            [id],
            |row| row.get(0),
        )
        .map_err(|error| format!("could not count selected collection items: {error}"))?;
    if selected_count == 0 {
        return Err("select at least one collection item".into());
    }
    transaction
        .execute(
            "UPDATE collection_items
             SET enqueue_status=CASE WHEN selected=1 AND archived=0 THEN 'queued' ELSE '' END
             WHERE session_id=?1",
            [id],
        )
        .map_err(|error| format!("could not queue collection items: {error}"))?;
    transaction
        .execute(
            "UPDATE collection_sessions SET profile_id=?2, cancel_requested=0,
                enqueue_status='running', enqueued_count=0, failed_count=0,
                updated_at=?3 WHERE id=?1",
            params![id, profile_id, now_ms()],
        )
        .map_err(|error| format!("could not update collection enqueue: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("could not commit collection enqueue: {error}"))
}

pub fn mark_enqueue_item(
    state_dir: &Path,
    id: &str,
    index: u32,
    status: &str,
) -> Result<(), String> {
    let status = match status {
        "active" | "complete" | "error" | "cancelled" => status,
        _ => return Err("invalid collection enqueue status".into()),
    };
    let mut connection = state_db::open(state_dir)?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("could not update collection enqueue item: {error}"))?;
    transaction
        .execute(
            "UPDATE collection_items SET enqueue_status=?3
             WHERE session_id=?1 AND item_index=?2",
            params![id, index, status],
        )
        .map_err(|error| format!("could not update collection item status: {error}"))?;
    transaction
        .execute(
            "UPDATE collection_sessions SET
                enqueued_count=(SELECT COUNT(*) FROM collection_items
                    WHERE session_id=?1 AND enqueue_status='complete'),
                failed_count=(SELECT COUNT(*) FROM collection_items
                    WHERE session_id=?1 AND enqueue_status='error'),
                updated_at=?2 WHERE id=?1",
            params![id, now_ms()],
        )
        .map_err(|error| format!("could not update collection enqueue counts: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("could not commit collection item status: {error}"))
}

pub fn mark_archived(state_dir: &Path, id: &str, index: u32) -> Result<(), String> {
    let connection = state_db::open(state_dir)?;
    connection
        .execute(
            "UPDATE collection_items SET archived=1, selected=0, enqueue_status='complete'
             WHERE session_id=?1 AND item_index=?2",
            params![id, index],
        )
        .map_err(|error| format!("could not mark collection item archived: {error}"))?;
    Ok(())
}

pub fn finish_enqueue(state_dir: &Path, id: &str, cancelled: bool) -> Result<(), String> {
    let connection = state_db::open(state_dir)?;
    connection
        .execute(
            "UPDATE collection_sessions SET enqueue_status=?2, updated_at=?3 WHERE id=?1",
            params![
                id,
                if cancelled { "cancelled" } else { "complete" },
                now_ms()
            ],
        )
        .map_err(|error| format!("could not finish collection enqueue: {error}"))?;
    Ok(())
}

pub fn cancelled(state_dir: &Path, id: &str) -> Result<bool, String> {
    is_cancelled(state_dir, id)
}

pub fn process_ids() -> Vec<u32> {
    PROCESSES
        .lock()
        .map(|processes| processes.values().copied().collect())
        .unwrap_or_default()
}

pub fn cancel_process(id: &str) {
    if let Some(pid) = PROCESSES
        .lock()
        .ok()
        .and_then(|processes| processes.get(id).copied())
    {
        let _ = Command::new("kill")
            .args(["-TERM", "--", &format!("-{pid}")])
            .status();
    }
}

fn run_extraction(state_dir: &Path, id: &str, extractor: ExtractorConfig) {
    let result = extract_pages(state_dir, id, &extractor);
    if let Err(error) = result {
        let cancelled = is_cancelled(state_dir, id).unwrap_or(false);
        let _ = set_session_status(
            state_dir,
            id,
            if cancelled { "cancelled" } else { "error" },
            if cancelled { "" } else { &error },
        );
    }
}

fn extract_pages(state_dir: &Path, id: &str, extractor: &ExtractorConfig) -> Result<(), String> {
    loop {
        let session = get_session(state_dir, id)?
            .ok_or_else(|| "collection session disappeared".to_string())?;
        if is_cancelled(state_dir, id)? {
            set_session_status(state_dir, id, "cancelled", "")?;
            return Ok(());
        }
        if session.next_index > MAX_ITEMS {
            set_session_status(state_dir, id, "ready", "")?;
            return Ok(());
        }
        let start = session.next_index;
        let end = (start + session.page_size - 1).min(MAX_ITEMS);
        let parsed = extract_flat_page(&session.source_url, start, end, id, extractor)?;
        if is_cancelled(state_dir, id)? {
            set_session_status(state_dir, id, "cancelled", "")?;
            return Ok(());
        }
        let consumed = parsed.consumed_count;
        store_page(state_dir, id, &parsed)?;
        if consumed == 0 || consumed < session.page_size || end == MAX_ITEMS {
            set_session_status(state_dir, id, "ready", "")?;
            return Ok(());
        }
    }
}

pub fn extract_flat_page(
    source: &str,
    start: u32,
    end: u32,
    process_id: &str,
    extractor: &ExtractorConfig,
) -> Result<FlatPage, String> {
    if start == 0 || end < start || end - start + 1 > MAX_PAGE_SIZE {
        return Err("extractor page must contain 1 to 200 items".into());
    }
    let mut command = Command::new(&extractor.binary);
    command
        .env("PATH", &extractor.path)
        .arg("--flat-playlist")
        .arg("--dump-single-json")
        .arg("--no-warnings")
        .arg("--ignore-errors")
        .arg("--playlist-items")
        .arg(format!("{start}:{end}"));
    if let Some(runtime) = extractor.js_runtime.as_deref() {
        command.arg("--js-runtimes").arg(runtime);
    }
    if let Some(browser) = extractor
        .cookies_browser
        .as_deref()
        .filter(|browser| !browser.is_empty() && *browser != "none")
    {
        command.arg("--cookies-from-browser").arg(browser);
    }
    command
        .arg(source)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .process_group(0);
    let child = command
        .spawn()
        .map_err(|error| format!("could not start yt-dlp collection inspection: {error}"))?;
    let pid = child.id();
    if let Ok(mut processes) = PROCESSES.lock() {
        processes.insert(process_id.to_string(), pid);
    }
    let output = child.wait_with_output();
    if let Ok(mut processes) = PROCESSES.lock() {
        processes.remove(process_id);
    }
    let output =
        output.map_err(|error| format!("could not wait for collection inspection: {error}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(stderr_tail(&stderr));
    }
    let value: Value = serde_json::from_slice(&output.stdout)
        .map_err(|error| format!("yt-dlp returned invalid collection data: {error}"))?;
    Ok(parse_page(&value, start))
}

#[derive(Default)]
pub struct FlatPage {
    pub title: String,
    pub total_known: u32,
    pub next_index: u32,
    pub consumed_count: u32,
    pub items: Vec<CollectionItem>,
}

fn parse_page(value: &Value, start: u32) -> FlatPage {
    let title = value
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let total_known = ["playlist_count", "n_entries", "playlist_mincount"]
        .iter()
        .find_map(|key| value.get(*key).and_then(Value::as_u64))
        .unwrap_or(0)
        .min(MAX_ITEMS as u64) as u32;
    let entries: Vec<&Value> = value
        .get("entries")
        .and_then(Value::as_array)
        .map(|entries| entries.iter().collect())
        .unwrap_or_else(|| vec![value]);
    let consumed_count = entries.len() as u32;
    let items = entries
        .into_iter()
        .enumerate()
        .filter(|(_, entry)| !entry.is_null())
        .filter_map(|(offset, entry)| item_from_value(entry, start + offset as u32))
        .collect::<Vec<_>>();
    FlatPage {
        title,
        total_known,
        next_index: start + consumed_count,
        consumed_count,
        items,
    }
}

fn item_from_value(value: &Value, index: u32) -> Option<CollectionItem> {
    let media_id = text(value, "id");
    let extractor = text(value, "extractor_key").to_lowercase();
    let raw_url = ["webpage_url", "original_url", "url"]
        .iter()
        .find_map(|key| value.get(*key).and_then(Value::as_str))
        .unwrap_or("");
    let url = canonical_item_url(raw_url, &extractor, &media_id);
    if url.is_empty() {
        return None;
    }
    Some(CollectionItem {
        index,
        media_id,
        extractor,
        url,
        title: text(value, "title"),
        uploader: value
            .get("uploader")
            .or_else(|| value.get("channel"))
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
        duration_sec: value.get("duration").and_then(Value::as_f64).unwrap_or(0.0) as u64,
        upload_date: text(value, "upload_date"),
        thumbnail: text(value, "thumbnail"),
        live_state: value
            .get("live_status")
            .and_then(Value::as_str)
            .map(String::from)
            .unwrap_or_else(|| {
                if value.get("is_live").and_then(Value::as_bool) == Some(true) {
                    "is_live".into()
                } else {
                    "not_live".into()
                }
            }),
        estimated_size: value
            .get("filesize_approx")
            .or_else(|| value.get("filesize"))
            .and_then(Value::as_u64)
            .unwrap_or(0),
        availability: text(value, "availability"),
        selected: true,
        enqueue_status: String::new(),
        archived: false,
    })
}

fn canonical_item_url(raw_url: &str, extractor: &str, media_id: &str) -> String {
    if raw_url.starts_with("http://") || raw_url.starts_with("https://") {
        return raw_url.to_string();
    }
    if extractor.contains("youtube") && !media_id.is_empty() {
        return format!("https://www.youtube.com/watch?v={media_id}");
    }
    String::new()
}

fn store_page(state_dir: &Path, id: &str, page: &FlatPage) -> Result<(), String> {
    let mut connection = state_db::open(state_dir)?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("could not store collection page: {error}"))?;
    {
        let mut statement = transaction
            .prepare(
                "INSERT INTO collection_items(
                    session_id, item_index, media_id, extractor, source_url, title, uploader,
                    duration_sec, upload_date, thumbnail, live_state, estimated_size,
                          availability, selected, enqueue_status
                      ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, 1, '')
                 ON CONFLICT(session_id, item_index) DO UPDATE SET
                    media_id=excluded.media_id, extractor=excluded.extractor,
                    source_url=excluded.source_url, title=excluded.title,
                    uploader=excluded.uploader, duration_sec=excluded.duration_sec,
                    upload_date=excluded.upload_date, thumbnail=excluded.thumbnail,
                    live_state=excluded.live_state, estimated_size=excluded.estimated_size,
                    availability=excluded.availability",
            )
            .map_err(|error| format!("could not prepare collection page: {error}"))?;
        for item in &page.items {
            statement
                .execute(params![
                    id,
                    item.index,
                    item.media_id,
                    item.extractor,
                    item.url,
                    item.title,
                    item.uploader,
                    item.duration_sec,
                    item.upload_date,
                    item.thumbnail,
                    item.live_state,
                    item.estimated_size,
                    item.availability,
                ])
                .map_err(|error| format!("could not store collection item: {error}"))?;
        }
        transaction
            .execute(
                "UPDATE collection_items AS item
                 SET archived=1, selected=0
                 WHERE item.session_id=?1 AND EXISTS(
                    SELECT 1 FROM media_archive AS archive
                    WHERE ((item.extractor<>'' AND item.media_id<>''
                            AND archive.extractor=item.extractor AND archive.media_id=item.media_id)
                       OR (item.source_url<>'' AND archive.canonical_url=item.source_url))
                 )",
                [id],
            )
            .map_err(|error| format!("could not apply media archive to collection: {error}"))?;
    }
    let loaded_count: u32 = transaction
        .query_row(
            "SELECT COUNT(*) FROM collection_items WHERE session_id=?1",
            [id],
            |row| row.get(0),
        )
        .map_err(|error| format!("could not count stored collection items: {error}"))?;
    transaction
        .execute(
            "UPDATE collection_sessions SET
                title=CASE WHEN ?2='' THEN title ELSE ?2 END,
                total_known=MAX(total_known, ?3), loaded_count=?4, next_index=?5,
                updated_at=?6 WHERE id=?1",
            params![
                id,
                page.title,
                page.total_known,
                loaded_count,
                page.next_index,
                now_ms(),
            ],
        )
        .map_err(|error| format!("could not update collection progress: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("could not commit collection page: {error}"))
}

fn insert_session(state_dir: &Path, session: &CollectionSession) -> Result<(), String> {
    let connection = state_db::open(state_dir)?;
    connection
        .execute(
            "INSERT INTO collection_sessions(
                     id, source_url, source_type, title, status, total_known, loaded_count,
                     page_size, next_index, profile_id, error, cancel_requested,
                     enqueue_status, enqueued_count, failed_count, created_at, updated_at
                 ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 0, ?12, ?13, ?14, ?15, ?16)",
            params![
                session.id,
                session.source_url,
                session.source_type,
                session.title,
                session.status,
                session.total_known,
                session.loaded_count,
                session.page_size,
                session.next_index,
                session.profile_id,
                session.error,
                session.enqueue_status,
                session.enqueued_count,
                session.failed_count,
                session.created_at,
                session.updated_at,
            ],
        )
        .map_err(|error| format!("could not create collection session: {error}"))?;
    Ok(())
}

fn get_session(state_dir: &Path, id: &str) -> Result<Option<CollectionSession>, String> {
    let connection = state_db::open(state_dir)?;
    get_session_with_connection(&connection, id)
}

fn get_session_with_connection(
    connection: &rusqlite::Connection,
    id: &str,
) -> Result<Option<CollectionSession>, String> {
    connection
        .query_row(
            "SELECT id, source_url, source_type, title, status, total_known, loaded_count,
                    page_size, next_index, profile_id, error, enqueue_status,
                    enqueued_count, failed_count, created_at, updated_at
             FROM collection_sessions WHERE id=?1",
            [id],
            |row| {
                Ok(CollectionSession {
                    id: row.get(0)?,
                    source_url: row.get(1)?,
                    source_type: row.get(2)?,
                    title: row.get(3)?,
                    status: row.get(4)?,
                    total_known: row.get(5)?,
                    loaded_count: row.get(6)?,
                    page_size: row.get(7)?,
                    next_index: row.get(8)?,
                    profile_id: row.get(9)?,
                    error: row.get(10)?,
                    enqueue_status: row.get(11)?,
                    enqueued_count: row.get(12)?,
                    failed_count: row.get(13)?,
                    created_at: row.get(14)?,
                    updated_at: row.get(15)?,
                })
            },
        )
        .optional()
        .map_err(|error| format!("could not read collection session: {error}"))
}

fn set_session_status(state_dir: &Path, id: &str, status: &str, error: &str) -> Result<(), String> {
    let connection = state_db::open(state_dir)?;
    connection
        .execute(
            "UPDATE collection_sessions SET status=?2, error=?3, updated_at=?4 WHERE id=?1",
            params![id, status, error, now_ms()],
        )
        .map_err(|db_error| format!("could not update collection status: {db_error}"))?;
    Ok(())
}

fn is_cancelled(state_dir: &Path, id: &str) -> Result<bool, String> {
    let connection = state_db::open(state_dir)?;
    connection
        .query_row(
            "SELECT cancel_requested FROM collection_sessions WHERE id=?1",
            [id],
            |row| row.get::<_, bool>(0),
        )
        .map_err(|error| format!("could not read collection cancellation state: {error}"))
}

fn row_to_item(row: &rusqlite::Row<'_>) -> rusqlite::Result<CollectionItem> {
    Ok(CollectionItem {
        index: row.get(0)?,
        media_id: row.get(1)?,
        extractor: row.get(2)?,
        url: row.get(3)?,
        title: row.get(4)?,
        uploader: row.get(5)?,
        duration_sec: row.get(6)?,
        upload_date: row.get(7)?,
        thumbnail: row.get(8)?,
        live_state: row.get(9)?,
        estimated_size: row.get(10)?,
        availability: row.get(11)?,
        selected: row.get(12)?,
        enqueue_status: row.get(13)?,
        archived: row.get(14)?,
    })
}

fn validate_source(url: &str) -> Result<(), String> {
    let parsed = reqwest::Url::parse(url.trim())
        .map_err(|_| "Enter a valid http(s) playlist or channel URL.".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("Enter a valid http(s) playlist or channel URL.".into());
    }
    Ok(())
}

fn source_type(url: &str) -> &'static str {
    let lower = url.to_ascii_lowercase();
    if lower.contains("playlist") || lower.contains("list=") {
        "playlist"
    } else if lower.contains("/channel/")
        || lower.contains("/@")
        || lower.contains("/user/")
        || lower.contains("/c/")
    {
        "channel"
    } else {
        "collection"
    }
}

fn text(value: &Value, key: &str) -> String {
    value
        .get(key)
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string()
}

fn stderr_tail(stderr: &str) -> String {
    let message = stderr
        .lines()
        .rev()
        .find(|line| line.contains("ERROR"))
        .or_else(|| stderr.lines().rev().find(|line| !line.trim().is_empty()))
        .unwrap_or("yt-dlp could not inspect this collection")
        .trim()
        .trim_start_matches("ERROR: ");
    message.chars().take(400).collect()
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_root(name: &str) -> PathBuf {
        std::env::temp_dir().join(format!(
            "downman-collections-{name}-{}-{}",
            std::process::id(),
            SESSION_COUNTER.fetch_add(1, Ordering::Relaxed)
        ))
    }

    fn seed_session(root: &Path, id: &str) {
        insert_session(
            root,
            &CollectionSession {
                id: id.into(),
                source_url: "https://www.youtube.com/playlist?list=test".into(),
                source_type: "playlist".into(),
                title: String::new(),
                status: "loading".into(),
                total_known: 0,
                loaded_count: 0,
                page_size: 100,
                next_index: 1,
                profile_id: "best".into(),
                error: String::new(),
                enqueue_status: String::new(),
                enqueued_count: 0,
                failed_count: 0,
                created_at: now_ms(),
                updated_at: now_ms(),
            },
        )
        .unwrap();
    }

    #[test]
    fn flat_playlist_page_preserves_identity_and_semantic_fields() {
        let parsed = parse_page(
            &serde_json::json!({
                "title": "Course",
                "playlist_count": 250,
                "entries": [{
                    "id": "abc123", "extractor_key": "Youtube",
                    "url": "abc123", "title": "Lesson one", "channel": "Teacher",
                    "duration": 91.8, "upload_date": "20260717",
                    "thumbnail": "https://img.test/abc.jpg", "live_status": "not_live"
                }]
            }),
            101,
        );
        assert_eq!(parsed.title, "Course");
        assert_eq!(parsed.total_known, 250);
        assert_eq!(parsed.next_index, 102);
        assert_eq!(parsed.items[0].index, 101);
        assert_eq!(
            parsed.items[0].url,
            "https://www.youtube.com/watch?v=abc123"
        );
        assert_eq!(parsed.items[0].duration_sec, 91);
    }

    #[test]
    fn sqlite_pages_filter_and_persist_selection_without_loading_all_items() {
        let root = test_root("paging");
        seed_session(&root, "session");
        let parsed = FlatPage {
            title: "Large list".into(),
            total_known: 10_000,
            next_index: 4,
            consumed_count: 3,
            items: vec![
                item_from_value(
                    &serde_json::json!({"id":"a", "extractor_key":"Youtube", "title":"Rust basics", "channel":"Ada"}),
                    1,
                )
                .unwrap(),
                item_from_value(
                    &serde_json::json!({"id":"b", "extractor_key":"Youtube", "title":"Rust async", "channel":"Ada", "is_live":true}),
                    2,
                )
                .unwrap(),
                item_from_value(
                    &serde_json::json!({"id":"c", "extractor_key":"Youtube", "title":"Python", "channel":"Grace"}),
                    3,
                )
                .unwrap(),
            ],
        };
        store_page(&root, "session", &parsed).unwrap();
        let rust = page(&root, "session", 0, 1, Some("rust"), Some("all")).unwrap();
        assert_eq!(rust.filtered_count, 2);
        assert_eq!(rust.items.len(), 1);
        select(&root, "session", &[1], false).unwrap();
        let selected = page(&root, "session", 0, 20, None, Some("selected")).unwrap();
        assert_eq!(selected.selected_count, 2);
        assert_eq!(selected.items.len(), 2);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn selection_update_with_no_indices_targets_the_whole_collection() {
        let root = test_root("selection");
        seed_session(&root, "session");
        let parsed = parse_page(
            &serde_json::json!({
                "entries": [
                    {"id":"a", "extractor_key":"Youtube", "title":"A"},
                    {"id":"b", "extractor_key":"Youtube", "title":"B"}
                ]
            }),
            1,
        );
        store_page(&root, "session", &parsed).unwrap();
        assert_eq!(select(&root, "session", &[], false).unwrap(), 2);
        assert!(selected_items(&root, "session").unwrap().is_empty());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn ten_thousand_item_collection_returns_only_the_requested_page() {
        let root = test_root("ten-thousand");
        seed_session(&root, "session");
        let mut connection = state_db::open(&root).unwrap();
        let transaction = connection.transaction().unwrap();
        {
            let mut statement = transaction
                .prepare(
                    "INSERT INTO collection_items(
                        session_id, item_index, media_id, extractor, source_url, title,
                        uploader, duration_sec, upload_date, thumbnail, live_state,
                        estimated_size, availability, selected, enqueue_status
                     ) VALUES('session', ?1, ?2, 'youtube', ?3, ?4, 'Uploader',
                              60, '20260717', '', 'not_live', 0, 'public', 1, '')",
                )
                .unwrap();
            for index in 1..=10_000u32 {
                let media_id = format!("video-{index}");
                let url = format!("https://www.youtube.com/watch?v={media_id}");
                let title = if index % 100 == 0 {
                    format!("Needle lesson {index}")
                } else {
                    format!("Lesson {index}")
                };
                statement
                    .execute(params![index, media_id, url, title])
                    .unwrap();
            }
        }
        transaction.commit().unwrap();
        let result = page(&root, "session", 25, 50, Some("needle"), Some("all")).unwrap();
        assert_eq!(result.filtered_count, 100);
        assert_eq!(result.items.len(), 50);
        assert_eq!(result.items[0].index, 2600);
        std::fs::remove_dir_all(root).unwrap();
    }
}
