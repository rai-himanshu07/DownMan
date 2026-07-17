use crate::collections::{CollectionItem, ExtractorConfig, extract_flat_page};
use crate::state_db;
use rusqlite::{OptionalExtension, params};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

const DEFAULT_PAGE_SIZE: u32 = 50;
const MAX_PAGE_SIZE: u32 = 100;
const MAX_RESULTS: u32 = 500;
static SEARCH_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchSession {
    pub id: String,
    pub query: String,
    pub status: String,
    pub loaded_count: u32,
    pub total_limit: u32,
    pub page_size: u32,
    pub error: String,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchItem {
    pub index: u32,
    pub extractor: String,
    pub media_id: String,
    pub url: String,
    pub title: String,
    pub uploader: String,
    pub duration_sec: u64,
    pub upload_date: String,
    pub thumbnail: String,
    pub live_state: String,
    pub selected: bool,
    pub archived: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchPage {
    pub session: SearchSession,
    pub items: Vec<SearchItem>,
    pub offset: u32,
    pub limit: u32,
}

pub fn start(
    state_dir: PathBuf,
    query: String,
    page_size: Option<u32>,
    total_limit: Option<u32>,
    extractor: ExtractorConfig,
) -> Result<SearchSession, String> {
    let query = normalize_query(&query)?;
    let page_size = page_size
        .unwrap_or(DEFAULT_PAGE_SIZE)
        .clamp(1, MAX_PAGE_SIZE);
    let total_limit = total_limit.unwrap_or(MAX_RESULTS).clamp(1, MAX_RESULTS);
    let now = now_ms();
    let id = format!(
        "search-{now}-{}",
        SEARCH_COUNTER.fetch_add(1, Ordering::Relaxed)
    );
    let session = SearchSession {
        id: id.clone(),
        query: query.clone(),
        status: "loading".into(),
        loaded_count: 0,
        total_limit,
        page_size,
        error: String::new(),
        created_at: now,
        updated_at: now,
    };
    insert_session(state_dir.as_path(), &session)?;
    let worker_id = id.clone();
    std::thread::spawn(move || run_search(&state_dir, &worker_id, &query, extractor));
    Ok(session)
}

pub fn page(state_dir: &Path, id: &str, offset: u32, limit: u32) -> Result<SearchPage, String> {
    let connection = state_db::open(state_dir)?;
    let session = get_session_with_connection(&connection, id)?
        .ok_or_else(|| "search session does not exist".to_string())?;
    let limit = limit.clamp(1, MAX_PAGE_SIZE);
    let mut statement = connection
        .prepare(
            "SELECT item_index, extractor, media_id, canonical_url, title, uploader,
                    duration_sec, upload_date, thumbnail, live_state, selected, archived
                 FROM search_items WHERE session_id=?1 ORDER BY item_index LIMIT ?2 OFFSET ?3",
        )
        .map_err(|error| format!("could not query search page: {error}"))?;
    let items = statement
        .query_map(params![id, limit, offset], |row| {
            Ok(SearchItem {
                index: row.get(0)?,
                extractor: row.get(1)?,
                media_id: row.get(2)?,
                url: row.get(3)?,
                title: row.get(4)?,
                uploader: row.get(5)?,
                duration_sec: row.get(6)?,
                upload_date: row.get(7)?,
                thumbnail: row.get(8)?,
                live_state: row.get(9)?,
                selected: row.get(10)?,
                archived: row.get(11)?,
            })
        })
        .map_err(|error| format!("could not read search page: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("could not decode search item: {error}"))?;
    Ok(SearchPage {
        session,
        items,
        offset,
        limit,
    })
}

pub fn select(state_dir: &Path, id: &str, indices: &[u32], selected: bool) -> Result<u32, String> {
    let mut connection = state_db::open(state_dir)?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("could not update search selection: {error}"))?;
    let changed = if indices.is_empty() {
        transaction
            .execute(
                "UPDATE search_items SET selected=?2
                 WHERE session_id=?1 AND (?2=0 OR archived=0)",
                params![id, selected],
            )
            .map_err(|error| format!("could not select search results: {error}"))?
    } else {
        let mut statement = transaction
            .prepare(
                "UPDATE search_items SET selected=?3
                 WHERE session_id=?1 AND item_index=?2 AND (?3=0 OR archived=0)",
            )
            .map_err(|error| format!("could not prepare search selection: {error}"))?;
        let mut changed = 0;
        for index in indices {
            changed += statement
                .execute(params![id, index, selected])
                .map_err(|error| format!("could not select search result: {error}"))?;
        }
        changed
    };
    transaction
        .commit()
        .map_err(|error| format!("could not commit search selection: {error}"))?;
    Ok(changed as u32)
}

pub fn selected(state_dir: &Path, id: &str) -> Result<Vec<SearchItem>, String> {
    let connection = state_db::open(state_dir)?;
    let mut statement = connection
        .prepare(
            "SELECT item_index, extractor, media_id, canonical_url, title, uploader,
                    duration_sec, upload_date, thumbnail, live_state, selected, archived
                 FROM search_items
                 WHERE session_id=?1 AND selected=1 AND archived=0 ORDER BY item_index",
        )
        .map_err(|error| format!("could not query selected search items: {error}"))?;
    statement
        .query_map([id], |row| {
            Ok(SearchItem {
                index: row.get(0)?,
                extractor: row.get(1)?,
                media_id: row.get(2)?,
                url: row.get(3)?,
                title: row.get(4)?,
                uploader: row.get(5)?,
                duration_sec: row.get(6)?,
                upload_date: row.get(7)?,
                thumbnail: row.get(8)?,
                live_state: row.get(9)?,
                selected: row.get(10)?,
                archived: row.get(11)?,
            })
        })
        .map_err(|error| format!("could not read selected search items: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("could not decode selected search item: {error}"))
}

pub fn cancel(state_dir: &Path, id: &str) -> Result<(), String> {
    let connection = state_db::open(state_dir)?;
    let changed = connection
        .execute(
            "UPDATE search_sessions SET status='cancelled', updated_at=?2
             WHERE id=?1 AND status='loading'",
            params![id, now_ms()],
        )
        .map_err(|error| format!("could not cancel search: {error}"))?;
    crate::collections::cancel_process(id);
    if changed == 0 && get_session_with_connection(&connection, id)?.is_none() {
        return Err("search session does not exist".into());
    }
    Ok(())
}

fn run_search(state_dir: &Path, id: &str, query: &str, extractor: ExtractorConfig) {
    let result = run_search_inner(state_dir, id, query, &extractor);
    if let Err(error) = result {
        let connection = state_db::open(state_dir);
        let cancelled = connection
            .as_ref()
            .ok()
            .and_then(|connection| get_session_with_connection(connection, id).ok().flatten())
            .is_some_and(|session| session.status == "cancelled");
        if !cancelled {
            let _ = set_status(state_dir, id, "error", &error);
        }
    }
}

fn run_search_inner(
    state_dir: &Path,
    id: &str,
    query: &str,
    extractor: &ExtractorConfig,
) -> Result<(), String> {
    let session =
        get_session(state_dir, id)?.ok_or_else(|| "search session disappeared".to_string())?;
    let source = format!("ytsearch{}:{query}", session.total_limit);
    let mut start = 1;
    while start <= session.total_limit {
        let current =
            get_session(state_dir, id)?.ok_or_else(|| "search session disappeared".to_string())?;
        if current.status == "cancelled" {
            return Ok(());
        }
        let end = (start + session.page_size - 1).min(session.total_limit);
        let page = extract_flat_page(&source, start, end, id, extractor)?;
        let consumed = page.consumed_count;
        store_page(state_dir, id, &page.items)?;
        if consumed == 0 || consumed < session.page_size || end == session.total_limit {
            set_status(state_dir, id, "ready", "")?;
            return Ok(());
        }
        start += consumed;
    }
    set_status(state_dir, id, "ready", "")
}

fn store_page(state_dir: &Path, id: &str, items: &[CollectionItem]) -> Result<(), String> {
    let mut connection = state_db::open(state_dir)?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("could not store search page: {error}"))?;
    {
        let mut statement = transaction
            .prepare(
                "INSERT INTO search_items(
                    session_id, item_index, extractor, media_id, canonical_url, title,
                    uploader, duration_sec, upload_date, thumbnail, live_state, selected, archived
                 ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,0,0)
                 ON CONFLICT(session_id, item_index) DO UPDATE SET
                    extractor=excluded.extractor, media_id=excluded.media_id,
                    canonical_url=excluded.canonical_url, title=excluded.title,
                    uploader=excluded.uploader, duration_sec=excluded.duration_sec,
                    upload_date=excluded.upload_date, thumbnail=excluded.thumbnail,
                    live_state=excluded.live_state",
            )
            .map_err(|error| format!("could not prepare search results: {error}"))?;
        for item in items {
            statement
                .execute(params![
                    id,
                    item.index,
                    item.extractor,
                    item.media_id,
                    item.url,
                    item.title,
                    item.uploader,
                    item.duration_sec,
                    item.upload_date,
                    item.thumbnail,
                    item.live_state,
                ])
                .map_err(|error| format!("could not store search result: {error}"))?;
        }
    }
    transaction
        .execute(
            "UPDATE search_items AS item SET archived=1
                 WHERE item.session_id=?1 AND EXISTS(
                     SELECT 1 FROM media_archive AS archive
                     WHERE (archive.extractor=item.extractor AND archive.media_id=item.media_id)
                         OR (item.canonical_url<>'' AND archive.canonical_url=item.canonical_url)
                 )",
            [id],
        )
        .map_err(|error| format!("could not apply archive to search results: {error}"))?;
    let count: u32 = transaction
        .query_row(
            "SELECT COUNT(*) FROM search_items WHERE session_id=?1",
            [id],
            |row| row.get(0),
        )
        .map_err(|error| format!("could not count search results: {error}"))?;
    transaction
        .execute(
            "UPDATE search_sessions SET loaded_count=?2, updated_at=?3 WHERE id=?1",
            params![id, count, now_ms()],
        )
        .map_err(|error| format!("could not update search progress: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("could not commit search page: {error}"))
}

fn insert_session(state_dir: &Path, session: &SearchSession) -> Result<(), String> {
    let connection = state_db::open(state_dir)?;
    connection
        .execute(
            "INSERT INTO search_sessions(
                id, query, status, loaded_count, total_limit, page_size, error, created_at, updated_at
             ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            params![
                session.id,
                session.query,
                session.status,
                session.loaded_count,
                session.total_limit,
                session.page_size,
                session.error,
                session.created_at,
                session.updated_at,
            ],
        )
        .map_err(|error| format!("could not create search session: {error}"))?;
    Ok(())
}

fn get_session(state_dir: &Path, id: &str) -> Result<Option<SearchSession>, String> {
    let connection = state_db::open(state_dir)?;
    get_session_with_connection(&connection, id)
}

fn get_session_with_connection(
    connection: &rusqlite::Connection,
    id: &str,
) -> Result<Option<SearchSession>, String> {
    connection
        .query_row(
            "SELECT id, query, status, loaded_count, total_limit, page_size,
                    error, created_at, updated_at FROM search_sessions WHERE id=?1",
            [id],
            |row| {
                Ok(SearchSession {
                    id: row.get(0)?,
                    query: row.get(1)?,
                    status: row.get(2)?,
                    loaded_count: row.get(3)?,
                    total_limit: row.get(4)?,
                    page_size: row.get(5)?,
                    error: row.get(6)?,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                })
            },
        )
        .optional()
        .map_err(|error| format!("could not read search session: {error}"))
}

fn set_status(state_dir: &Path, id: &str, status: &str, error: &str) -> Result<(), String> {
    let connection = state_db::open(state_dir)?;
    connection
        .execute(
            "UPDATE search_sessions SET status=?2, error=?3, updated_at=?4 WHERE id=?1",
            params![id, status, error, now_ms()],
        )
        .map_err(|db_error| format!("could not update search status: {db_error}"))?;
    Ok(())
}

fn normalize_query(query: &str) -> Result<String, String> {
    let query = query.split_whitespace().collect::<Vec<_>>().join(" ");
    if query.len() < 2 || query.len() > 200 {
        return Err("search query must contain 2 to 200 characters".into());
    }
    if query.chars().any(|character| character.is_control()) {
        return Err("search query contains unsupported control characters".into());
    }
    Ok(query)
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

    fn root() -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "downman-search-{}-{}",
            std::process::id(),
            SEARCH_COUNTER.fetch_add(1, Ordering::Relaxed)
        ))
    }

    fn item(index: u32, id: &str) -> CollectionItem {
        CollectionItem {
            index,
            media_id: id.into(),
            extractor: "youtube".into(),
            url: format!("https://youtube.com/watch?v={id}"),
            title: format!("Result {index}"),
            uploader: "Uploader".into(),
            duration_sec: 60,
            upload_date: "20260717".into(),
            thumbnail: String::new(),
            live_state: "not_live".into(),
            estimated_size: 0,
            availability: "public".into(),
            selected: false,
            enqueue_status: String::new(),
            archived: false,
        }
    }

    #[test]
    fn search_cache_pages_and_selects_without_loading_all_results() {
        let root = root();
        let session = SearchSession {
            id: "search".into(),
            query: "rust language".into(),
            status: "ready".into(),
            loaded_count: 0,
            total_limit: 500,
            page_size: 50,
            error: String::new(),
            created_at: now_ms(),
            updated_at: now_ms(),
        };
        insert_session(&root, &session).unwrap();
        let items = (1..=120)
            .map(|index| item(index, &format!("id-{index}")))
            .collect::<Vec<_>>();
        store_page(&root, "search", &items).unwrap();
        let result = page(&root, "search", 50, 25).unwrap();
        assert_eq!(result.items.len(), 25);
        assert_eq!(result.items[0].index, 51);
        assert_eq!(select(&root, "search", &[51, 52], true).unwrap(), 2);
        assert_eq!(selected(&root, "search").unwrap().len(), 2);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn query_and_result_limits_are_bounded() {
        assert_eq!(
            normalize_query("  rust   ownership ").unwrap(),
            "rust ownership"
        );
        assert!(normalize_query("x").is_err());
        assert!(normalize_query(&"x".repeat(201)).is_err());
        assert_eq!(MAX_RESULTS, 500);
    }
}
