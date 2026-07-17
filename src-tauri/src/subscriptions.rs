use crate::collections::CollectionItem;
use crate::state_db;
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

const MIN_POLL_MINUTES: u32 = 15;
const MAX_POLL_MINUTES: u32 = 7 * 24 * 60;
const MAX_ITEMS_PER_POLL: u32 = 25;

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Subscription {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub source_url: String,
    pub profile_id: String,
    pub poll_interval_min: u32,
    pub enabled: bool,
    pub action: String,
    pub notify: bool,
    pub include_keywords: Vec<String>,
    pub exclude_keywords: Vec<String>,
    pub min_duration_sec: u64,
    pub max_duration_sec: u64,
    pub content_type: String,
    pub max_items_per_poll: u32,
    pub live_policy_override: String,
    pub cookies_browser: String,
    pub m3u_target: String,
    pub running: bool,
    pub last_run_at: u64,
    pub last_success_at: u64,
    pub next_run_at: u64,
    pub last_error: String,
    pub created_at: u64,
    pub updated_at: u64,
}

impl Default for Subscription {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: "Followed source".into(),
            kind: "channel".into(),
            source_url: String::new(),
            profile_id: "best".into(),
            poll_interval_min: 60,
            enabled: true,
            action: "review".into(),
            notify: true,
            include_keywords: Vec::new(),
            exclude_keywords: Vec::new(),
            min_duration_sec: 0,
            max_duration_sec: 0,
            content_type: "all".into(),
            max_items_per_poll: 10,
            live_policy_override: String::new(),
            cookies_browser: String::new(),
            m3u_target: String::new(),
            running: false,
            last_run_at: 0,
            last_success_at: 0,
            next_run_at: 0,
            last_error: String::new(),
            created_at: 0,
            updated_at: 0,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewItem {
    pub id: String,
    pub subscription_id: String,
    pub subscription_name: String,
    pub extractor: String,
    pub media_id: String,
    pub url: String,
    pub title: String,
    pub uploader: String,
    pub duration_sec: u64,
    pub upload_date: String,
    pub thumbnail: String,
    pub live_state: String,
    pub profile_id: String,
    pub status: String,
    pub selected: bool,
    pub discovered_at: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReviewPage {
    pub items: Vec<ReviewItem>,
    pub total: u32,
    pub selected_count: u32,
    pub offset: u32,
    pub limit: u32,
}

#[derive(Clone, Debug)]
pub struct PollIngest {
    pub new_items: Vec<CollectionItem>,
    pub review_count: u32,
    pub skipped_archived: u32,
}

pub fn list(state_dir: &Path) -> Result<Vec<Subscription>, String> {
    let connection = state_db::open(state_dir)?;
    let mut statement = connection
        .prepare(&format!(
            "{} ORDER BY enabled DESC, name COLLATE NOCASE",
            subscription_select()
        ))
        .map_err(|error| format!("could not query subscriptions: {error}"))?;
    statement
        .query_map([], row_to_subscription)
        .map_err(|error| format!("could not read subscriptions: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("could not decode subscription: {error}"))
}

pub fn get(state_dir: &Path, id: &str) -> Result<Option<Subscription>, String> {
    let connection = state_db::open(state_dir)?;
    get_with_connection(&connection, id)
}

pub fn upsert(state_dir: &Path, mut subscription: Subscription) -> Result<Subscription, String> {
    normalize(&mut subscription)?;
    let connection = state_db::open(state_dir)?;
    let existing = get_with_connection(&connection, &subscription.id)?;
    let now = now_ms();
    subscription.created_at = existing
        .as_ref()
        .map(|value| value.created_at)
        .filter(|value| *value > 0)
        .unwrap_or(now);
    subscription.updated_at = now;
    subscription.running = existing.as_ref().is_some_and(|value| value.running);
    subscription.last_run_at = existing
        .as_ref()
        .map(|value| value.last_run_at)
        .unwrap_or(0);
    subscription.last_success_at = existing
        .as_ref()
        .map(|value| value.last_success_at)
        .unwrap_or(0);
    subscription.last_error = existing
        .as_ref()
        .map(|value| value.last_error.clone())
        .unwrap_or_default();
    subscription.next_run_at = existing
        .as_ref()
        .map(|value| value.next_run_at)
        .filter(|value| *value > 0)
        .unwrap_or(now);
    connection
        .execute(
            "INSERT INTO subscriptions(
                id, name, kind, source_url, profile_id, poll_interval_min, enabled,
                action, notify, include_keywords, exclude_keywords, min_duration_sec,
                     max_duration_sec, content_type, max_items_per_poll, live_policy_override,
                     cookies_browser, m3u_target, running, last_run_at, last_success_at,
                     next_run_at, last_error, created_at, updated_at
                 ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?25)
             ON CONFLICT(id) DO UPDATE SET
                name=excluded.name, kind=excluded.kind, source_url=excluded.source_url,
                profile_id=excluded.profile_id, poll_interval_min=excluded.poll_interval_min,
                enabled=excluded.enabled, action=excluded.action, notify=excluded.notify,
                include_keywords=excluded.include_keywords,
                exclude_keywords=excluded.exclude_keywords,
                min_duration_sec=excluded.min_duration_sec,
                max_duration_sec=excluded.max_duration_sec,
                content_type=excluded.content_type,
                max_items_per_poll=excluded.max_items_per_poll,
                live_policy_override=excluded.live_policy_override,
                cookies_browser=excluded.cookies_browser,
                m3u_target=excluded.m3u_target, updated_at=excluded.updated_at",
            params![
                subscription.id,
                subscription.name,
                subscription.kind,
                subscription.source_url,
                subscription.profile_id,
                subscription.poll_interval_min,
                subscription.enabled,
                subscription.action,
                subscription.notify,
                serde_json::to_string(&subscription.include_keywords).unwrap_or_else(|_| "[]".into()),
                serde_json::to_string(&subscription.exclude_keywords).unwrap_or_else(|_| "[]".into()),
                subscription.min_duration_sec,
                subscription.max_duration_sec,
                subscription.content_type,
                subscription.max_items_per_poll,
                subscription.live_policy_override,
                subscription.cookies_browser,
                subscription.m3u_target,
                subscription.running,
                subscription.last_run_at,
                subscription.last_success_at,
                subscription.next_run_at,
                subscription.last_error,
                subscription.created_at,
                subscription.updated_at,
            ],
        )
        .map_err(|error| format!("could not save subscription: {error}"))?;
    Ok(subscription)
}

pub fn delete(state_dir: &Path, id: &str) -> Result<(), String> {
    let connection = state_db::open(state_dir)?;
    let changed = connection
        .execute("DELETE FROM subscriptions WHERE id=?1 AND running=0", [id])
        .map_err(|error| format!("could not delete subscription: {error}"))?;
    if changed == 0 {
        return Err("subscription does not exist or is currently polling".into());
    }
    Ok(())
}

pub fn due_ids(state_dir: &Path, now: u64) -> Result<Vec<String>, String> {
    let connection = state_db::open(state_dir)?;
    let mut statement = connection
        .prepare(
            "SELECT id FROM subscriptions
             WHERE enabled=1 AND running=0 AND next_run_at<=?1
             ORDER BY next_run_at LIMIT 8",
        )
        .map_err(|error| format!("could not query due subscriptions: {error}"))?;
    statement
        .query_map([now], |row| row.get::<_, String>(0))
        .map_err(|error| format!("could not read due subscriptions: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("could not decode due subscription: {error}"))
}

pub fn reset_running(state_dir: &Path) -> Result<u32, String> {
    let connection = state_db::open(state_dir)?;
    connection
        .execute(
            "UPDATE subscriptions SET running=0,
                last_error=CASE WHEN running=1 THEN 'Previous poll was interrupted.' ELSE last_error END
             WHERE running=1",
            [],
        )
        .map(|changed| changed as u32)
        .map_err(|error| format!("could not recover interrupted subscriptions: {error}"))
}

pub fn claim(state_dir: &Path, id: &str, force: bool) -> Result<Option<Subscription>, String> {
    let connection = state_db::open(state_dir)?;
    let now = now_ms();
    let changed = connection
        .execute(
            "UPDATE subscriptions SET running=1, last_run_at=?2, updated_at=?2
             WHERE id=?1 AND running=0 AND (?3=1 OR enabled=1)",
            params![id, now, force],
        )
        .map_err(|error| format!("could not claim subscription poll: {error}"))?;
    if changed == 0 {
        return Ok(None);
    }
    get(state_dir, id)
}

pub fn finish(
    state_dir: &Path,
    subscription: &Subscription,
    error: Option<&str>,
) -> Result<(), String> {
    let connection = state_db::open(state_dir)?;
    let now = now_ms();
    let next = now
        .saturating_add(subscription.poll_interval_min as u64 * 60_000)
        .saturating_add(jitter_ms(&subscription.id, subscription.poll_interval_min));
    connection
        .execute(
            "UPDATE subscriptions SET running=0, next_run_at=?2,
                last_success_at=CASE WHEN ?3='' THEN ?4 ELSE last_success_at END,
                last_error=?3, updated_at=?4 WHERE id=?1",
            params![id_ref(subscription), next, error.unwrap_or(""), now],
        )
        .map_err(|db_error| format!("could not finish subscription poll: {db_error}"))?;
    Ok(())
}

pub fn ingest(
    state_dir: &Path,
    subscription: &Subscription,
    items: &[CollectionItem],
) -> Result<PollIngest, String> {
    let mut connection = state_db::open(state_dir)?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("could not start subscription ingest: {error}"))?;
    let now = now_ms();
    let mut new_items = Vec::new();
    let mut review_count = 0;
    let mut skipped_archived = 0;
    for item in items
        .iter()
        .filter(|item| matches_filters(subscription, item))
        .take(subscription.max_items_per_poll as usize)
    {
        let (extractor, media_id) = identity(item);
        let archived: bool = transaction
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM media_archive
                 WHERE (extractor=?1 AND media_id=?2)
                    OR (?3<>'' AND canonical_url=?3))",
                params![extractor, media_id, item.url],
                |row| row.get(0),
            )
            .map_err(|error| format!("could not check subscription archive: {error}"))?;
        let inserted = transaction
            .execute(
                "INSERT OR IGNORE INTO subscription_seen(
                    subscription_id, extractor, media_id, canonical_url, first_seen_at, action
                 ) VALUES(?1,?2,?3,?4,?5,?6)",
                params![
                    subscription.id,
                    extractor,
                    media_id,
                    item.url,
                    now,
                    if archived {
                        "archived"
                    } else {
                        subscription.action.as_str()
                    },
                ],
            )
            .map_err(|error| format!("could not store subscription identity: {error}"))?;
        if inserted == 0 {
            continue;
        }
        if archived {
            skipped_archived += 1;
            continue;
        }
        if subscription.action == "auto" {
            new_items.push(item.clone());
            continue;
        }
        let review_id = format!(
            "review-{}-{}",
            subscription.id,
            stable_identity(&extractor, &media_id)
        );
        transaction
            .execute(
                "INSERT OR IGNORE INTO review_inbox(
                    id, subscription_id, extractor, media_id, canonical_url, title,
                    uploader, duration_sec, upload_date, thumbnail, live_state,
                    profile_id, status, selected, discovered_at, updated_at
                 ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,'new',1,?13,?13)",
                params![
                    review_id,
                    subscription.id,
                    extractor,
                    media_id,
                    item.url,
                    item.title,
                    item.uploader,
                    item.duration_sec,
                    item.upload_date,
                    item.thumbnail,
                    item.live_state,
                    subscription.profile_id,
                    now,
                ],
            )
            .map_err(|error| format!("could not create review inbox item: {error}"))?;
        review_count += 1;
    }
    transaction
        .commit()
        .map_err(|error| format!("could not commit subscription ingest: {error}"))?;
    Ok(PollIngest {
        new_items,
        review_count,
        skipped_archived,
    })
}

pub fn review_page(
    state_dir: &Path,
    offset: u32,
    limit: u32,
    status: Option<&str>,
) -> Result<ReviewPage, String> {
    let connection = state_db::open(state_dir)?;
    let status = match status.unwrap_or("new") {
        "all" | "new" | "downloaded" | "dismissed" | "error" => status.unwrap_or("new"),
        _ => "new",
    };
    let limit = limit.clamp(1, 200);
    let total = connection
        .query_row(
            "SELECT COUNT(*) FROM review_inbox WHERE ?1='all' OR status=?1",
            [status],
            |row| row.get::<_, u32>(0),
        )
        .map_err(|error| format!("could not count review inbox: {error}"))?;
    let selected_count = connection
        .query_row(
            "SELECT COUNT(*) FROM review_inbox WHERE status='new' AND selected=1",
            [],
            |row| row.get::<_, u32>(0),
        )
        .map_err(|error| format!("could not count selected review items: {error}"))?;
    let mut statement = connection
        .prepare(
            "SELECT item.id, item.subscription_id, subscription.name, item.extractor,
                    item.media_id, item.canonical_url, item.title, item.uploader,
                    item.duration_sec, item.upload_date, item.thumbnail, item.live_state,
                    item.profile_id, item.status, item.selected, item.discovered_at
             FROM review_inbox AS item
             JOIN subscriptions AS subscription ON subscription.id=item.subscription_id
             WHERE ?1='all' OR item.status=?1
             ORDER BY item.discovered_at DESC LIMIT ?2 OFFSET ?3",
        )
        .map_err(|error| format!("could not query review inbox: {error}"))?;
    let items = statement
        .query_map(params![status, limit, offset], |row| {
            Ok(ReviewItem {
                id: row.get(0)?,
                subscription_id: row.get(1)?,
                subscription_name: row.get(2)?,
                extractor: row.get(3)?,
                media_id: row.get(4)?,
                url: row.get(5)?,
                title: row.get(6)?,
                uploader: row.get(7)?,
                duration_sec: row.get(8)?,
                upload_date: row.get(9)?,
                thumbnail: row.get(10)?,
                live_state: row.get(11)?,
                profile_id: row.get(12)?,
                status: row.get(13)?,
                selected: row.get(14)?,
                discovered_at: row.get(15)?,
            })
        })
        .map_err(|error| format!("could not read review inbox: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("could not decode review item: {error}"))?;
    Ok(ReviewPage {
        items,
        total,
        selected_count,
        offset,
        limit,
    })
}

pub fn review_select(state_dir: &Path, ids: &[String], selected: bool) -> Result<u32, String> {
    let mut connection = state_db::open(state_dir)?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("could not update review selection: {error}"))?;
    let changed = if ids.is_empty() {
        transaction
            .execute(
                "UPDATE review_inbox SET selected=?1 WHERE status='new'",
                [selected],
            )
            .map_err(|error| format!("could not select review inbox: {error}"))?
    } else {
        let mut statement = transaction
            .prepare("UPDATE review_inbox SET selected=?2 WHERE id=?1 AND status='new'")
            .map_err(|error| format!("could not prepare review selection: {error}"))?;
        let mut changed = 0;
        for id in ids {
            changed += statement
                .execute(params![id, selected])
                .map_err(|error| format!("could not select review item: {error}"))?;
        }
        changed
    };
    transaction
        .commit()
        .map_err(|error| format!("could not commit review selection: {error}"))?;
    Ok(changed as u32)
}

pub fn selected_review(state_dir: &Path) -> Result<Vec<ReviewItem>, String> {
    let page = review_page(state_dir, 0, 200, Some("new"))?;
    Ok(page
        .items
        .into_iter()
        .filter(|item| item.selected)
        .collect())
}

pub fn review_items(state_dir: &Path, ids: &[String]) -> Result<Vec<ReviewItem>, String> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let wanted: std::collections::HashSet<&str> = ids.iter().map(String::as_str).collect();
    let connection = state_db::open(state_dir)?;
    let mut statement = connection
        .prepare(
            "SELECT item.id, item.subscription_id, subscription.name, item.extractor,
                    item.media_id, item.canonical_url, item.title, item.uploader,
                    item.duration_sec, item.upload_date, item.thumbnail, item.live_state,
                    item.profile_id, item.status, item.selected, item.discovered_at
             FROM review_inbox AS item
             JOIN subscriptions AS subscription ON subscription.id=item.subscription_id
             WHERE item.status='new' ORDER BY item.discovered_at",
        )
        .map_err(|error| format!("could not query requested review items: {error}"))?;
    statement
        .query_map([], |row| {
            Ok(ReviewItem {
                id: row.get(0)?,
                subscription_id: row.get(1)?,
                subscription_name: row.get(2)?,
                extractor: row.get(3)?,
                media_id: row.get(4)?,
                url: row.get(5)?,
                title: row.get(6)?,
                uploader: row.get(7)?,
                duration_sec: row.get(8)?,
                upload_date: row.get(9)?,
                thumbnail: row.get(10)?,
                live_state: row.get(11)?,
                profile_id: row.get(12)?,
                status: row.get(13)?,
                selected: row.get(14)?,
                discovered_at: row.get(15)?,
            })
        })
        .map_err(|error| format!("could not read requested review items: {error}"))?
        .filter_map(|row| match row {
            Ok(item) if wanted.contains(item.id.as_str()) => Some(Ok(item)),
            Ok(_) => None,
            Err(error) => Some(Err(error)),
        })
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("could not decode requested review item: {error}"))
}

pub fn mark_review(state_dir: &Path, id: &str, status: &str) -> Result<(), String> {
    if !matches!(status, "downloaded" | "dismissed" | "error") {
        return Err("invalid review item status".into());
    }
    let connection = state_db::open(state_dir)?;
    let changed = connection
        .execute(
            "UPDATE review_inbox SET status=?2, selected=0, updated_at=?3 WHERE id=?1",
            params![id, status, now_ms()],
        )
        .map_err(|error| format!("could not update review item: {error}"))?;
    if changed == 0 {
        return Err("review item does not exist".into());
    }
    Ok(())
}

pub fn export_m3u(state_dir: &Path, subscription_id: &str, path: &Path) -> Result<u64, String> {
    let connection = state_db::open(state_dir)?;
    let mut statement = connection
        .prepare(
            "SELECT canonical_url FROM subscription_seen
             WHERE subscription_id=?1 AND canonical_url<>'' ORDER BY first_seen_at",
        )
        .map_err(|error| format!("could not query subscription M3U: {error}"))?;
    let urls = statement
        .query_map([subscription_id], |row| row.get::<_, String>(0))
        .map_err(|error| format!("could not read subscription M3U: {error}"))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("could not decode subscription M3U URL: {error}"))?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("could not create subscription M3U folder: {error}"))?;
    }
    let mut output = "#EXTM3U\n".to_string();
    for url in &urls {
        output.push_str("#EXTINF:-1,\n");
        output.push_str(url);
        output.push('\n');
    }
    std::fs::write(path, output)
        .map_err(|error| format!("could not write subscription M3U: {error}"))?;
    Ok(urls.len() as u64)
}

fn normalize(subscription: &mut Subscription) -> Result<(), String> {
    subscription.id = subscription.id.trim().to_ascii_lowercase();
    subscription.name = subscription.name.trim().to_string();
    subscription.source_url = subscription.source_url.trim().to_string();
    subscription.profile_id = subscription.profile_id.trim().to_string();
    if subscription.id.is_empty()
        || subscription.id.len() > 64
        || !subscription
            .id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err("subscription id must contain only letters, numbers, '-' or '_'".into());
    }
    if subscription.name.is_empty() || subscription.name.len() > 100 {
        return Err("subscription name must contain 1 to 100 characters".into());
    }
    let parsed = reqwest::Url::parse(&subscription.source_url)
        .map_err(|_| "subscription needs a valid HTTP(S) channel or playlist URL".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("subscription needs a valid HTTP(S) channel or playlist URL".into());
    }
    if !matches!(subscription.kind.as_str(), "channel" | "playlist") {
        return Err("subscription kind must be channel or playlist".into());
    }
    if !matches!(subscription.action.as_str(), "review" | "auto") {
        return Err("subscription action must be review or auto".into());
    }
    subscription.poll_interval_min = subscription
        .poll_interval_min
        .clamp(MIN_POLL_MINUTES, MAX_POLL_MINUTES);
    subscription.max_items_per_poll = subscription.max_items_per_poll.clamp(1, MAX_ITEMS_PER_POLL);
    if subscription.max_duration_sec > 0
        && subscription.max_duration_sec < subscription.min_duration_sec
    {
        return Err("maximum duration must be greater than minimum duration".into());
    }
    if !matches!(
        subscription.content_type.as_str(),
        "all" | "video" | "live" | "upcoming"
    ) {
        return Err("content type must be all, video, live, or upcoming".into());
    }
    if !matches!(
        subscription.live_policy_override.as_str(),
        "" | "skip" | "from-start" | "from-now"
    ) {
        return Err("live override must be blank, skip, from-start, or from-now".into());
    }
    subscription.include_keywords = normalize_words(&subscription.include_keywords);
    subscription.exclude_keywords = normalize_words(&subscription.exclude_keywords);
    subscription.cookies_browser = subscription.cookies_browser.trim().to_lowercase();
    if !matches!(
        subscription.cookies_browser.as_str(),
        "" | "firefox" | "chrome" | "chromium" | "brave" | "edge" | "vivaldi" | "opera"
    ) {
        return Err("cookies browser is not supported".into());
    }
    Ok(())
}

fn matches_filters(subscription: &Subscription, item: &CollectionItem) -> bool {
    let haystack = format!("{} {}", item.title, item.uploader).to_lowercase();
    if !subscription.include_keywords.is_empty()
        && !subscription
            .include_keywords
            .iter()
            .any(|word| haystack.contains(word))
    {
        return false;
    }
    if subscription
        .exclude_keywords
        .iter()
        .any(|word| haystack.contains(word))
    {
        return false;
    }
    if subscription.min_duration_sec > 0 && item.duration_sec < subscription.min_duration_sec {
        return false;
    }
    if subscription.max_duration_sec > 0 && item.duration_sec > subscription.max_duration_sec {
        return false;
    }
    match subscription.content_type.as_str() {
        "live" => item.live_state == "is_live",
        "upcoming" => item.live_state == "is_upcoming",
        "video" => !matches!(item.live_state.as_str(), "is_live" | "is_upcoming"),
        _ => true,
    }
}

fn identity(item: &CollectionItem) -> (String, String) {
    if !item.extractor.is_empty() && !item.media_id.is_empty() {
        (item.extractor.to_lowercase(), item.media_id.clone())
    } else {
        ("url".into(), item.url.clone())
    }
}

fn normalize_words(words: &[String]) -> Vec<String> {
    let mut values = Vec::new();
    for word in words {
        let word = word.trim().to_lowercase();
        if !word.is_empty() && !values.contains(&word) {
            values.push(word);
        }
        if values.len() == 32 {
            break;
        }
    }
    values
}

fn get_with_connection(
    connection: &rusqlite::Connection,
    id: &str,
) -> Result<Option<Subscription>, String> {
    connection
        .query_row(
            &format!("{} WHERE id=?1", subscription_select()),
            [id],
            row_to_subscription,
        )
        .optional()
        .map_err(|error| format!("could not read subscription: {error}"))
}

fn subscription_select() -> &'static str {
    "SELECT id, name, kind, source_url, profile_id, poll_interval_min, enabled,
            action, notify, include_keywords, exclude_keywords, min_duration_sec,
            max_duration_sec, content_type, max_items_per_poll, live_policy_override,
            cookies_browser, m3u_target, running, last_run_at, last_success_at,
            next_run_at, last_error, created_at, updated_at FROM subscriptions"
}

fn row_to_subscription(row: &rusqlite::Row<'_>) -> rusqlite::Result<Subscription> {
    let includes: String = row.get(9)?;
    let excludes: String = row.get(10)?;
    Ok(Subscription {
        id: row.get(0)?,
        name: row.get(1)?,
        kind: row.get(2)?,
        source_url: row.get(3)?,
        profile_id: row.get(4)?,
        poll_interval_min: row.get(5)?,
        enabled: row.get(6)?,
        action: row.get(7)?,
        notify: row.get(8)?,
        include_keywords: serde_json::from_str(&includes).unwrap_or_default(),
        exclude_keywords: serde_json::from_str(&excludes).unwrap_or_default(),
        min_duration_sec: row.get(11)?,
        max_duration_sec: row.get(12)?,
        content_type: row.get(13)?,
        max_items_per_poll: row.get(14)?,
        live_policy_override: row.get(15)?,
        cookies_browser: row.get(16)?,
        m3u_target: row.get(17)?,
        running: row.get(18)?,
        last_run_at: row.get(19)?,
        last_success_at: row.get(20)?,
        next_run_at: row.get(21)?,
        last_error: row.get(22)?,
        created_at: row.get(23)?,
        updated_at: row.get(24)?,
    })
}

fn jitter_ms(id: &str, interval_min: u32) -> u64 {
    let mut hasher = DefaultHasher::new();
    id.hash(&mut hasher);
    let max = (interval_min as u64 * 60_000 / 10).max(1);
    hasher.finish() % max
}

fn stable_identity(extractor: &str, media_id: &str) -> u64 {
    let mut hasher = DefaultHasher::new();
    extractor.hash(&mut hasher);
    media_id.hash(&mut hasher);
    hasher.finish()
}

fn id_ref(subscription: &Subscription) -> &str {
    &subscription.id
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
    use std::sync::atomic::{AtomicU64, Ordering};

    static TEST_COUNTER: AtomicU64 = AtomicU64::new(0);

    fn root() -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "downman-subscriptions-{}-{}",
            std::process::id(),
            TEST_COUNTER.fetch_add(1, Ordering::Relaxed)
        ))
    }

    fn sample() -> Subscription {
        Subscription {
            id: "channel-one".into(),
            name: "Channel one".into(),
            kind: "channel".into(),
            source_url: "https://www.youtube.com/@example/videos".into(),
            profile_id: "best".into(),
            include_keywords: vec!["Rust".into()],
            exclude_keywords: vec!["short".into()],
            ..Default::default()
        }
    }

    fn item(id: &str, title: &str) -> CollectionItem {
        CollectionItem {
            index: 1,
            media_id: id.into(),
            extractor: "youtube".into(),
            url: format!("https://youtube.com/watch?v={id}"),
            title: title.into(),
            uploader: "Teacher".into(),
            duration_sec: 600,
            upload_date: "20260717".into(),
            thumbnail: String::new(),
            live_state: "not_live".into(),
            estimated_size: 0,
            availability: "public".into(),
            selected: true,
            enqueue_status: String::new(),
            archived: false,
        }
    }

    #[test]
    fn overlapping_poll_claims_are_rejected() {
        let root = root();
        let saved = upsert(&root, sample()).unwrap();
        assert!(claim(&root, &saved.id, true).unwrap().is_some());
        assert!(claim(&root, &saved.id, true).unwrap().is_none());
        finish(&root, &saved, None).unwrap();
        assert!(!get(&root, &saved.id).unwrap().unwrap().running);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn duplicate_poll_results_create_one_review_item() {
        let root = root();
        let subscription = upsert(&root, sample()).unwrap();
        let items = vec![item("one", "Rust ownership"), item("two", "Short Rust tip")];
        let first = ingest(&root, &subscription, &items).unwrap();
        let second = ingest(&root, &subscription, &items).unwrap();
        assert_eq!(first.review_count, 1);
        assert_eq!(second.review_count, 0);
        let inbox = review_page(&root, 0, 50, Some("new")).unwrap();
        assert_eq!(inbox.total, 1);
        assert_eq!(inbox.items[0].media_id, "one");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn minimum_interval_and_match_cap_are_enforced() {
        let root = root();
        let mut subscription = sample();
        subscription.poll_interval_min = 1;
        subscription.max_items_per_poll = 500;
        let saved = upsert(&root, subscription).unwrap();
        assert_eq!(saved.poll_interval_min, MIN_POLL_MINUTES);
        assert_eq!(saved.max_items_per_poll, MAX_ITEMS_PER_POLL);
        std::fs::remove_dir_all(root).unwrap();
    }
}
