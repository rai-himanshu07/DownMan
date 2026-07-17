use crate::state_db;
use reqwest::header::{CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE, RANGE};
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::sync::Semaphore;
use tokio::task::JoinSet;

const MAX_ITEMS: usize = 10_000;
const MAX_PAGE_SIZE: u32 = 200;
const MAX_ESTIMATE_WORKERS: usize = 8;
static SESSION_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Default)]
pub struct PreflightContext {
    pub profile_id: String,
    pub existing_urls: HashSet<String>,
    pub archived_urls: HashSet<String>,
    pub conflict_paths: HashMap<String, String>,
    pub estimate_sizes: bool,
    pub speed_bytes_per_second: u64,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreflightSummary {
    pub id: String,
    pub status: String,
    pub profile_id: String,
    pub total_count: u32,
    pub accepted_count: u32,
    pub rejected_count: u32,
    pub estimate_sizes: bool,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreflightItem {
    pub index: u32,
    pub original: String,
    pub url: String,
    pub kind: String,
    pub status: String,
    pub reason: String,
    pub filename: String,
    pub conflict_path: String,
    pub estimated_size: u64,
    pub estimated_seconds: u64,
    pub content_type: String,
    pub selected: bool,
    pub commit_status: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreflightPage {
    pub summary: PreflightSummary,
    pub items: Vec<PreflightItem>,
    pub filtered_count: u32,
    pub offset: u32,
    pub limit: u32,
}

pub async fn create(
    state_dir: &Path,
    raw_urls: Vec<String>,
    context: PreflightContext,
) -> Result<PreflightPage, String> {
    let now = now_ms();
    let id = format!(
        "preflight-{now}-{}",
        SESSION_COUNTER.fetch_add(1, Ordering::Relaxed)
    );
    let mut seen = HashSet::new();
    let mut items = Vec::new();
    for (offset, original) in raw_urls.into_iter().take(MAX_ITEMS).enumerate() {
        let index = offset as u32 + 1;
        let mut item = match normalize_url(&original) {
            Ok(url) => {
                let kind = classify(&url).to_string();
                let filename = filename_from_url(&url);
                PreflightItem {
                    index,
                    original,
                    url,
                    kind,
                    status: "accepted".into(),
                    reason: String::new(),
                    filename,
                    conflict_path: String::new(),
                    estimated_size: 0,
                    estimated_seconds: 0,
                    content_type: String::new(),
                    selected: true,
                    commit_status: String::new(),
                }
            }
            Err(reason) => PreflightItem {
                index,
                original,
                url: String::new(),
                kind: "invalid".into(),
                status: "invalid".into(),
                reason,
                filename: String::new(),
                conflict_path: String::new(),
                estimated_size: 0,
                estimated_seconds: 0,
                content_type: String::new(),
                selected: false,
                commit_status: String::new(),
            },
        };
        if item.status == "accepted" {
            if !seen.insert(item.url.clone()) {
                reject(&mut item, "duplicate", "Duplicate within this batch.");
            } else if context.existing_urls.contains(&item.url) {
                reject(&mut item, "duplicate", "Already present in DownMan.");
            } else if context.archived_urls.contains(&item.url) {
                reject(
                    &mut item,
                    "archived",
                    "Already completed in the media archive.",
                );
            } else if let Some(path) = context.conflict_paths.get(&item.url) {
                item.conflict_path = path.clone();
                reject(
                    &mut item,
                    "conflict",
                    "A file with this name already exists.",
                );
            } else if item.kind == "collection" {
                reject(
                    &mut item,
                    "collection",
                    "Review playlists and channels in the Collection Inspector.",
                );
            }
        }
        items.push(item);
    }
    if context.estimate_sizes {
        estimate_items(&mut items, context.speed_bytes_per_second).await;
    }
    store(state_dir, &id, &context, now, &items)?;
    page(state_dir, &id, 0, MAX_PAGE_SIZE, Some("all"))
}

pub fn page(
    state_dir: &Path,
    id: &str,
    offset: u32,
    limit: u32,
    filter: Option<&str>,
) -> Result<PreflightPage, String> {
    let connection = state_db::open(state_dir)?;
    let summary = summary_with_connection(&connection, id)?
        .ok_or_else(|| "preflight session does not exist".to_string())?;
    let filter = match filter.unwrap_or("all") {
        "accepted" | "rejected" | "committed" => filter.unwrap_or("all"),
        _ => "all",
    };
    let limit = limit.clamp(1, MAX_PAGE_SIZE);
    let where_sql = "session_id=?1 AND (
        ?2='all'
        OR (?2='accepted' AND status='accepted')
        OR (?2='rejected' AND status<>'accepted')
        OR (?2='committed' AND commit_status<>''))";
    let filtered_count = connection
        .query_row(
            &format!("SELECT COUNT(*) FROM preflight_items WHERE {where_sql}"),
            params![id, filter],
            |row| row.get::<_, u32>(0),
        )
        .map_err(|error| format!("could not count preflight items: {error}"))?;
    let mut statement = connection
        .prepare(&format!(
            "SELECT item_index, original, normalized_url, kind, status, reason,
                    filename, conflict_path, estimated_size, estimated_seconds,
                    content_type, selected, commit_status
             FROM preflight_items WHERE {where_sql}
             ORDER BY item_index LIMIT ?3 OFFSET ?4"
        ))
        .map_err(|error| format!("could not query preflight page: {error}"))?;
    let items = statement
        .query_map(params![id, filter, limit, offset], row_to_item)
        .map_err(|error| format!("could not read preflight page: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("could not decode preflight item: {error}"))?;
    Ok(PreflightPage {
        summary,
        items,
        filtered_count,
        offset,
        limit,
    })
}

pub fn set_selected(
    state_dir: &Path,
    id: &str,
    indices: &[u32],
    selected: bool,
) -> Result<u32, String> {
    let mut connection = state_db::open(state_dir)?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("could not update preflight selection: {error}"))?;
    let changed = if indices.is_empty() {
        transaction
            .execute(
                "UPDATE preflight_items SET selected=?2
                 WHERE session_id=?1 AND status='accepted' AND commit_status=''",
                params![id, selected],
            )
            .map_err(|error| format!("could not select preflight items: {error}"))?
    } else {
        let mut statement = transaction
            .prepare(
                "UPDATE preflight_items SET selected=?3
                 WHERE session_id=?1 AND item_index=?2
                   AND status='accepted' AND commit_status=''",
            )
            .map_err(|error| format!("could not prepare preflight selection: {error}"))?;
        let mut changed = 0;
        for index in indices {
            changed += statement
                .execute(params![id, index, selected])
                .map_err(|error| format!("could not select preflight item: {error}"))?;
        }
        changed
    };
    transaction
        .commit()
        .map_err(|error| format!("could not commit preflight selection: {error}"))?;
    Ok(changed as u32)
}

pub fn selected_items(state_dir: &Path, id: &str) -> Result<Vec<PreflightItem>, String> {
    let connection = state_db::open(state_dir)?;
    let mut statement = connection
        .prepare(
            "SELECT item_index, original, normalized_url, kind, status, reason,
                    filename, conflict_path, estimated_size, estimated_seconds,
                    content_type, selected, commit_status
             FROM preflight_items
             WHERE session_id=?1 AND status='accepted' AND selected=1 AND commit_status=''
             ORDER BY item_index",
        )
        .map_err(|error| format!("could not query selected preflight items: {error}"))?;
    statement
        .query_map([id], row_to_item)
        .map_err(|error| format!("could not read selected preflight items: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("could not decode selected preflight item: {error}"))
}

pub fn profile_id(state_dir: &Path, id: &str) -> Result<String, String> {
    let connection = state_db::open(state_dir)?;
    connection
        .query_row(
            "SELECT profile_id FROM preflight_sessions WHERE id=?1",
            [id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| format!("could not read preflight profile: {error}"))?
        .ok_or_else(|| "preflight session does not exist".to_string())
}

pub fn mark_commit(
    state_dir: &Path,
    id: &str,
    index: u32,
    status: &str,
    reason: &str,
) -> Result<(), String> {
    let status = match status {
        "complete" | "error" | "skipped" => status,
        _ => return Err("invalid preflight commit status".into()),
    };
    let connection = state_db::open(state_dir)?;
    connection
        .execute(
            "UPDATE preflight_items SET commit_status=?3,
                 reason=CASE WHEN ?4='' THEN reason ELSE ?4 END,
                 selected=0 WHERE session_id=?1 AND item_index=?2",
            params![id, index, status, reason],
        )
        .map_err(|error| format!("could not update preflight commit: {error}"))?;
    let pending: u32 = connection
        .query_row(
            "SELECT COUNT(*) FROM preflight_items
             WHERE session_id=?1 AND status='accepted' AND selected=1 AND commit_status=''",
            [id],
            |row| row.get(0),
        )
        .map_err(|error| format!("could not count pending preflight items: {error}"))?;
    if pending == 0 {
        connection
            .execute(
                "UPDATE preflight_sessions SET status='committed', updated_at=?2 WHERE id=?1",
                params![id, now_ms()],
            )
            .map_err(|error| format!("could not finish preflight session: {error}"))?;
    }
    Ok(())
}

pub fn normalize_url(value: &str) -> Result<String, String> {
    let mut value = value
        .trim()
        .trim_matches(['"', '\'', '<', '>', '[', ']', '(', ')'])
        .trim_end_matches([',', ';'])
        .to_string();
    if value.len() > 8192 {
        return Err("URL exceeds the 8 KiB safety limit.".into());
    }
    if value.starts_with("www.") {
        value = format!("https://{value}");
    }
    if value.starts_with("magnet:?") {
        return if value.contains("xt=urn:btih:") {
            Ok(value)
        } else {
            Err("Magnet link is missing a BitTorrent info hash.".into())
        };
    }
    let mut parsed = reqwest::Url::parse(&value).map_err(|_| "Not a valid URL.".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https" | "ftp") {
        return Err("Only HTTP, HTTPS, FTP, and magnet links are supported.".into());
    }
    if parsed.host_str().is_none() {
        return Err("URL is missing a host.".into());
    }
    parsed.set_fragment(None);
    Ok(parsed.to_string())
}

pub fn classify(url: &str) -> &'static str {
    if url.starts_with("magnet:") || path_lower(url).ends_with(".torrent") {
        return "torrent";
    }
    let lower = url.to_ascii_lowercase();
    if lower.contains("list=")
        || lower.contains("/playlist")
        || lower.contains("/channel/")
        || lower.contains("/@")
        || lower.contains("/user/")
    {
        return "collection";
    }
    if path_lower(url).ends_with(".m3u8") || path_lower(url).ends_with(".mpd") {
        return "media";
    }
    if [
        "youtube.com",
        "youtu.be",
        "vimeo.com",
        "instagram.com",
        "tiktok.com",
        "soundcloud.com",
    ]
    .iter()
    .any(|host| {
        host_of(url)
            .as_deref()
            .is_some_and(|value| value == *host || value.ends_with(&format!(".{host}")))
    }) {
        return "media";
    }
    if path_lower(url)
        .rsplit('/')
        .next()
        .is_some_and(|name| name.contains('.'))
    {
        "direct"
    } else {
        "web"
    }
}

fn reject(item: &mut PreflightItem, status: &str, reason: &str) {
    item.status = status.into();
    item.reason = reason.into();
    item.selected = false;
}

async fn estimate_items(items: &mut [PreflightItem], speed_bytes_per_second: u64) {
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_secs(8))
        .redirect(reqwest::redirect::Policy::limited(5))
        .user_agent("DownMan/1.1 preflight")
        .build()
    {
        Ok(client) => client,
        Err(_) => return,
    };
    let semaphore = Arc::new(Semaphore::new(MAX_ESTIMATE_WORKERS));
    let mut workers = JoinSet::new();
    for item in items.iter().filter(|item| {
        item.status == "accepted"
            && item.kind != "torrent"
            && (item.url.starts_with("http://") || item.url.starts_with("https://"))
    }) {
        let client = client.clone();
        let semaphore = semaphore.clone();
        let url = item.url.clone();
        let index = item.index;
        workers.spawn(async move {
            let _permit = semaphore.acquire_owned().await.ok()?;
            let estimate = estimate_url(&client, &url).await;
            Some((index, estimate))
        });
    }
    while let Some(result) = workers.join_next().await {
        let Ok(Some((index, Some((size, content_type))))) = result else {
            continue;
        };
        if let Some(item) = items.iter_mut().find(|item| item.index == index) {
            item.estimated_size = size;
            item.content_type = content_type;
            if speed_bytes_per_second > 0 && size > 0 {
                item.estimated_seconds = size.div_ceil(speed_bytes_per_second);
            }
        }
    }
}

async fn estimate_url(client: &reqwest::Client, url: &str) -> Option<(u64, String)> {
    let response = client.head(url).send().await.ok();
    if let Some(response) = response
        && response.status().is_success()
    {
        return Some((
            response
                .headers()
                .get(CONTENT_LENGTH)
                .and_then(|value| value.to_str().ok())
                .and_then(|value| value.parse().ok())
                .unwrap_or(0),
            response
                .headers()
                .get(CONTENT_TYPE)
                .and_then(|value| value.to_str().ok())
                .unwrap_or("")
                .to_string(),
        ));
    }
    let response = client
        .get(url)
        .header(RANGE, "bytes=0-0")
        .send()
        .await
        .ok()?;
    let size = response
        .headers()
        .get(CONTENT_RANGE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.rsplit('/').next())
        .and_then(|value| value.parse().ok())
        .or_else(|| {
            response
                .headers()
                .get(CONTENT_LENGTH)
                .and_then(|value| value.to_str().ok())
                .and_then(|value| value.parse().ok())
        })
        .unwrap_or(0);
    let content_type = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_string();
    Some((size, content_type))
}

fn store(
    state_dir: &Path,
    id: &str,
    context: &PreflightContext,
    now: u64,
    items: &[PreflightItem],
) -> Result<(), String> {
    let mut connection = state_db::open(state_dir)?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("could not store preflight session: {error}"))?;
    let accepted = items
        .iter()
        .filter(|item| item.status == "accepted")
        .count() as u32;
    transaction
        .execute(
            "INSERT INTO preflight_sessions(
                id, status, profile_id, total_count, accepted_count, rejected_count,
                estimate_sizes, created_at, updated_at
             ) VALUES(?1, 'ready', ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
            params![
                id,
                context.profile_id,
                items.len() as u32,
                accepted,
                items.len() as u32 - accepted,
                context.estimate_sizes,
                now,
            ],
        )
        .map_err(|error| format!("could not create preflight session: {error}"))?;
    {
        let mut statement = transaction
            .prepare(
                "INSERT INTO preflight_items(
                    session_id, item_index, original, normalized_url, kind, status,
                    reason, filename, conflict_path, estimated_size, estimated_seconds,
                    content_type, selected, commit_status
                 ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            )
            .map_err(|error| format!("could not prepare preflight items: {error}"))?;
        for item in items {
            statement
                .execute(params![
                    id,
                    item.index,
                    item.original,
                    item.url,
                    item.kind,
                    item.status,
                    item.reason,
                    item.filename,
                    item.conflict_path,
                    item.estimated_size,
                    item.estimated_seconds,
                    item.content_type,
                    item.selected,
                    item.commit_status,
                ])
                .map_err(|error| format!("could not store preflight item: {error}"))?;
        }
    }
    transaction
        .commit()
        .map_err(|error| format!("could not commit preflight session: {error}"))
}

fn summary_with_connection(
    connection: &rusqlite::Connection,
    id: &str,
) -> Result<Option<PreflightSummary>, String> {
    connection
        .query_row(
            "SELECT id, status, profile_id, total_count, accepted_count, rejected_count,
                    estimate_sizes, created_at, updated_at
             FROM preflight_sessions WHERE id=?1",
            [id],
            |row| {
                Ok(PreflightSummary {
                    id: row.get(0)?,
                    status: row.get(1)?,
                    profile_id: row.get(2)?,
                    total_count: row.get(3)?,
                    accepted_count: row.get(4)?,
                    rejected_count: row.get(5)?,
                    estimate_sizes: row.get(6)?,
                    created_at: row.get(7)?,
                    updated_at: row.get(8)?,
                })
            },
        )
        .optional()
        .map_err(|error| format!("could not read preflight session: {error}"))
}

fn row_to_item(row: &rusqlite::Row<'_>) -> rusqlite::Result<PreflightItem> {
    Ok(PreflightItem {
        index: row.get(0)?,
        original: row.get(1)?,
        url: row.get(2)?,
        kind: row.get(3)?,
        status: row.get(4)?,
        reason: row.get(5)?,
        filename: row.get(6)?,
        conflict_path: row.get(7)?,
        estimated_size: row.get(8)?,
        estimated_seconds: row.get(9)?,
        content_type: row.get(10)?,
        selected: row.get(11)?,
        commit_status: row.get(12)?,
    })
}

fn filename_from_url(url: &str) -> String {
    if url.starts_with("magnet:") {
        return "magnet".into();
    }
    reqwest::Url::parse(url)
        .ok()
        .and_then(|url| {
            url.path_segments()
                .and_then(|mut segments| segments.next_back())
                .filter(|value| !value.is_empty())
                .map(String::from)
        })
        .unwrap_or_else(|| host_of(url).unwrap_or_else(|| "download".into()))
}

fn path_lower(url: &str) -> String {
    reqwest::Url::parse(url)
        .map(|url| url.path().to_ascii_lowercase())
        .unwrap_or_else(|_| {
            url.split(['?', '#'])
                .next()
                .unwrap_or(url)
                .to_ascii_lowercase()
        })
}

fn host_of(url: &str) -> Option<String> {
    reqwest::Url::parse(url)
        .ok()
        .and_then(|url| url.host_str().map(str::to_string))
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
            "downman-preflight-{}-{}",
            std::process::id(),
            SESSION_COUNTER.fetch_add(1, Ordering::Relaxed)
        ))
    }

    #[test]
    fn normalization_removes_fragments_and_rejects_unsafe_schemes() {
        assert_eq!(
            normalize_url(" <https://example.test/file.zip#section> ").unwrap(),
            "https://example.test/file.zip"
        );
        assert!(normalize_url("file:///etc/passwd").is_err());
        assert!(normalize_url("magnet:?dn=missing-hash").is_err());
    }

    #[test]
    fn classification_separates_collections_media_torrents_and_files() {
        assert_eq!(classify("magnet:?xt=urn:btih:abc"), "torrent");
        assert_eq!(
            classify("https://youtube.com/playlist?list=abc"),
            "collection"
        );
        assert_eq!(classify("https://youtube.com/watch?v=abc"), "media");
        assert_eq!(classify("https://example.test/file.zip"), "direct");
    }

    #[test]
    fn mixed_batch_persists_review_reasons_and_selection() {
        let root = root();
        let existing = HashSet::from(["https://example.test/existing.zip".into()]);
        let archived = HashSet::from(["https://example.test/done.mp4".into()]);
        let conflicts = HashMap::from([(
            "https://example.test/conflict.iso".into(),
            "/downloads/conflict.iso".into(),
        )]);
        let result = tauri::async_runtime::block_on(create(
            &root,
            vec![
                "not a url".into(),
                "https://example.test/new.zip".into(),
                "https://example.test/new.zip#duplicate".into(),
                "https://example.test/existing.zip".into(),
                "https://example.test/done.mp4".into(),
                "https://example.test/conflict.iso".into(),
                "https://youtube.com/playlist?list=test".into(),
            ],
            PreflightContext {
                profile_id: "best".into(),
                existing_urls: existing,
                archived_urls: archived,
                conflict_paths: conflicts,
                ..Default::default()
            },
        ))
        .unwrap();
        assert_eq!(result.summary.total_count, 7);
        assert_eq!(result.summary.accepted_count, 1);
        assert_eq!(result.items.iter().filter(|item| item.selected).count(), 1);
        assert!(result.items.iter().any(|item| item.status == "invalid"));
        assert!(result.items.iter().any(|item| item.status == "archived"));
        assert!(result.items.iter().any(|item| item.status == "conflict"));
        assert!(result.items.iter().any(|item| item.status == "collection"));
        std::fs::remove_dir_all(root).unwrap();
    }
}
