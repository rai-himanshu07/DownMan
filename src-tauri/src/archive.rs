use crate::state_db;
use rusqlite::{OptionalExtension, params};
use serde::Serialize;
use std::collections::HashSet;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Clone, Debug)]
pub struct ArchiveRecord {
    pub extractor: String,
    pub media_id: String,
    pub canonical_url: String,
    pub title: String,
    pub source_url: String,
    pub file_path: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveStatus {
    pub count: u64,
    pub latest_completed_at: u64,
}

pub fn contains(
    state_dir: &Path,
    extractor: &str,
    media_id: &str,
    canonical_url: &str,
) -> Result<bool, String> {
    let connection = state_db::open(state_dir)?;
    connection
        .query_row(
            "SELECT 1 FROM media_archive
             WHERE ((?1<>'' AND ?2<>'' AND extractor=?1 AND media_id=?2)
                OR (?3<>'' AND canonical_url=?3)) LIMIT 1",
            params![extractor, media_id, canonical_url],
            |_| Ok(true),
        )
        .optional()
        .map(|value| value.unwrap_or(false))
        .map_err(|error| format!("could not query media archive: {error}"))
}

pub fn record(state_dir: &Path, record: &ArchiveRecord) -> Result<(), String> {
    if record.extractor.trim().is_empty() && record.canonical_url.trim().is_empty() {
        return Err("archive record needs an extractor identity or canonical URL".into());
    }
    if !record.extractor.trim().is_empty() && record.media_id.trim().is_empty() {
        return Err("archive extractor identity is missing its media ID".into());
    }
    let mut extractor = record.extractor.trim().to_lowercase();
    let mut media_id = record.media_id.trim().to_string();
    if extractor.is_empty() {
        extractor = "url".into();
        media_id = record.canonical_url.trim().to_string();
    }
    let mut connection = state_db::open(state_dir)?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("could not start media archive update: {error}"))?;
    transaction
        .execute(
            "INSERT INTO media_archive(
                extractor, media_id, canonical_url, title, source_url, file_path, completed_at
             ) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7)
             ON CONFLICT(extractor, media_id) DO UPDATE SET
                canonical_url=CASE WHEN excluded.canonical_url='' THEN media_archive.canonical_url ELSE excluded.canonical_url END,
                title=CASE WHEN excluded.title='' THEN media_archive.title ELSE excluded.title END,
                source_url=CASE WHEN excluded.source_url='' THEN media_archive.source_url ELSE excluded.source_url END,
                file_path=CASE WHEN excluded.file_path='' THEN media_archive.file_path ELSE excluded.file_path END,
                completed_at=excluded.completed_at
             ON CONFLICT(canonical_url) WHERE canonical_url<>'' DO UPDATE SET
                title=CASE WHEN excluded.title='' THEN media_archive.title ELSE excluded.title END,
                source_url=CASE WHEN excluded.source_url='' THEN media_archive.source_url ELSE excluded.source_url END,
                file_path=CASE WHEN excluded.file_path='' THEN media_archive.file_path ELSE excluded.file_path END,
                completed_at=excluded.completed_at",
            params![
                extractor,
                media_id,
                record.canonical_url.trim(),
                record.title.trim(),
                record.source_url.trim(),
                record.file_path.trim(),
                now_ms(),
            ],
        )
        .map_err(|error| format!("could not record media archive entry: {error}"))?;
    transaction
        .execute(
            "UPDATE collection_items SET archived=1, selected=0
             WHERE ((?1<>'' AND ?2<>'' AND extractor=?1 AND media_id=?2)
                OR (?3<>'' AND source_url=?3))",
            params![
                record.extractor.trim().to_lowercase(),
                record.media_id.trim(),
                record.canonical_url.trim(),
            ],
        )
        .map_err(|error| format!("could not synchronize archived collection items: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("could not commit media archive update: {error}"))
}

pub fn status(state_dir: &Path) -> Result<ArchiveStatus, String> {
    let connection = state_db::open(state_dir)?;
    connection
        .query_row(
            "SELECT COUNT(*), COALESCE(MAX(completed_at), 0) FROM media_archive",
            [],
            |row| {
                Ok(ArchiveStatus {
                    count: row.get(0)?,
                    latest_completed_at: row.get(1)?,
                })
            },
        )
        .map_err(|error| format!("could not read media archive status: {error}"))
}

pub fn canonical_urls(state_dir: &Path) -> Result<HashSet<String>, String> {
    let connection = state_db::open(state_dir)?;
    let mut statement = connection
        .prepare("SELECT canonical_url FROM media_archive WHERE canonical_url<>''")
        .map_err(|error| format!("could not query archived URLs: {error}"))?;
    statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| format!("could not read archived URLs: {error}"))?
        .collect::<Result<HashSet<_>, _>>()
        .map_err(|error| format!("could not decode archived URL: {error}"))
}

pub fn export_ytdlp(state_dir: &Path, path: &Path) -> Result<u64, String> {
    let connection = state_db::open(state_dir)?;
    let mut statement = connection
        .prepare(
            "SELECT extractor, media_id FROM media_archive
             WHERE extractor NOT IN ('', 'url') AND media_id<>'' ORDER BY extractor, media_id",
        )
        .map_err(|error| format!("could not query media archive export: {error}"))?;
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|error| format!("could not read media archive export: {error}"))?;
    let mut output = String::new();
    let mut count = 0;
    for row in rows {
        let (extractor, media_id) =
            row.map_err(|error| format!("could not decode media archive row: {error}"))?;
        output.push_str(&extractor);
        output.push(' ');
        output.push_str(&media_id);
        output.push('\n');
        count += 1;
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("could not create archive export folder: {error}"))?;
    }
    std::fs::write(path, output)
        .map_err(|error| format!("could not write yt-dlp archive: {error}"))?;
    Ok(count)
}

pub fn export_m3u(state_dir: &Path, path: &Path) -> Result<u64, String> {
    let connection = state_db::open(state_dir)?;
    let mut statement = connection
        .prepare(
            "SELECT title, canonical_url FROM media_archive
             WHERE canonical_url<>'' ORDER BY completed_at, extractor, media_id",
        )
        .map_err(|error| format!("could not query M3U export: {error}"))?;
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|error| format!("could not read M3U export: {error}"))?;
    let mut output = "#EXTM3U\n".to_string();
    let mut count = 0;
    for row in rows {
        let (title, url) = row.map_err(|error| format!("could not decode M3U row: {error}"))?;
        output.push_str("#EXTINF:-1,");
        output.push_str(&title.replace(['\r', '\n'], " "));
        output.push('\n');
        output.push_str(&url);
        output.push('\n');
        count += 1;
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("could not create M3U export folder: {error}"))?;
    }
    std::fs::write(path, output).map_err(|error| format!("could not write M3U: {error}"))?;
    Ok(count)
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
            "downman-archive-{}-{}",
            std::process::id(),
            TEST_COUNTER.fetch_add(1, Ordering::Relaxed)
        ))
    }

    #[test]
    fn extractor_identity_and_canonical_url_both_deduplicate() {
        let root = root();
        record(
            &root,
            &ArchiveRecord {
                extractor: "YouTube".into(),
                media_id: "abc123".into(),
                canonical_url: "https://www.youtube.com/watch?v=abc123".into(),
                title: "Example".into(),
                source_url: "https://www.youtube.com/playlist?list=test".into(),
                file_path: "/tmp/example.mp4".into(),
            },
        )
        .unwrap();
        assert!(contains(&root, "youtube", "abc123", "").unwrap());
        assert!(contains(&root, "", "", "https://www.youtube.com/watch?v=abc123").unwrap());
        assert!(!contains(&root, "youtube", "other", "").unwrap());
        assert_eq!(status(&root).unwrap().count, 1);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn yt_dlp_export_uses_stable_extractor_id_lines() {
        let root = root();
        record(
            &root,
            &ArchiveRecord {
                extractor: "youtube".into(),
                media_id: "one".into(),
                canonical_url: "https://youtube.test/one".into(),
                title: String::new(),
                source_url: String::new(),
                file_path: String::new(),
            },
        )
        .unwrap();
        let path = root.join("archive.txt");
        assert_eq!(export_ytdlp(&root, &path).unwrap(), 1);
        assert_eq!(std::fs::read_to_string(path).unwrap(), "youtube one\n");
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn m3u_export_contains_archived_canonical_urls() {
        let root = root();
        record(
            &root,
            &ArchiveRecord {
                extractor: "youtube".into(),
                media_id: "one".into(),
                canonical_url: "https://youtube.test/one".into(),
                title: "Track one".into(),
                source_url: String::new(),
                file_path: String::new(),
            },
        )
        .unwrap();
        let path = root.join("playlist.m3u8");
        assert_eq!(export_m3u(&root, &path).unwrap(), 1);
        let output = std::fs::read_to_string(path).unwrap();
        assert!(output.starts_with("#EXTM3U\n#EXTINF:-1,Track one\n"));
        assert!(output.contains("https://youtube.test/one"));
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn url_only_fallbacks_keep_distinct_archive_rows() {
        let root = root();
        for url in ["https://example.test/one", "https://example.test/two"] {
            record(
                &root,
                &ArchiveRecord {
                    extractor: String::new(),
                    media_id: String::new(),
                    canonical_url: url.into(),
                    title: String::new(),
                    source_url: String::new(),
                    file_path: String::new(),
                },
            )
            .unwrap();
        }
        assert_eq!(status(&root).unwrap().count, 2);
        assert!(contains(&root, "", "", "https://example.test/two").unwrap());
        std::fs::remove_dir_all(root).unwrap();
    }
}
