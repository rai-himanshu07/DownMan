use crate::state_db;
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

pub const DEFAULT_PROFILE_ID: &str = "best";
const ACTIVE_PROFILE_KEY: &str = "active_download_profile";

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct DownloadProfile {
    pub id: String,
    pub name: String,
    pub description: String,
    pub builtin: bool,
    pub media_mode: String,
    pub quality: String,
    pub container: String,
    pub video_codec: String,
    pub preferred_fps: String,
    pub audio_format: String,
    pub audio_bitrate: String,
    pub subtitle_mode: String,
    pub subtitle_languages: Vec<String>,
    pub subtitle_format: String,
    pub sponsorblock_mode: String,
    pub sponsorblock_categories: Vec<String>,
    pub embed_metadata: bool,
    pub embed_thumbnail: bool,
    pub embed_chapters: bool,
    pub write_description: bool,
    pub output_dir: String,
    pub subfolder: String,
    pub filename_template: String,
    pub queue_id: String,
    pub max_download_limit: String,
    pub connections: u32,
    pub split: u32,
    pub proxy: String,
    pub user_agent: String,
    pub headers: Vec<String>,
    pub retries: u32,
    pub clip_start: String,
    pub clip_end: String,
    pub live_policy: String,
    pub created_at: u64,
    pub updated_at: u64,
}

impl Default for DownloadProfile {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: "Download Profile".into(),
            description: String::new(),
            builtin: false,
            media_mode: "video-audio".into(),
            quality: "best".into(),
            container: "mp4".into(),
            video_codec: "best".into(),
            preferred_fps: "original".into(),
            audio_format: "best".into(),
            audio_bitrate: "best".into(),
            subtitle_mode: "off".into(),
            subtitle_languages: Vec::new(),
            subtitle_format: "srt".into(),
            sponsorblock_mode: "off".into(),
            sponsorblock_categories: vec!["sponsor".into()],
            embed_metadata: false,
            embed_thumbnail: false,
            embed_chapters: false,
            write_description: false,
            output_dir: String::new(),
            subfolder: String::new(),
            filename_template: String::new(),
            queue_id: "main".into(),
            max_download_limit: String::new(),
            connections: 0,
            split: 0,
            proxy: String::new(),
            user_agent: String::new(),
            headers: Vec::new(),
            retries: 3,
            clip_start: String::new(),
            clip_end: String::new(),
            live_policy: "from-now".into(),
            created_at: 0,
            updated_at: 0,
        }
    }
}

pub fn initialize(state_dir: &Path) -> Result<(), String> {
    let mut connection = state_db::open(state_dir)?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("could not initialize profiles: {error}"))?;
    for profile in builtin_profiles() {
        let json = serde_json::to_string(&profile)
            .map_err(|error| format!("could not serialize built-in profile: {error}"))?;
        transaction
            .execute(
                "INSERT INTO download_profiles(id, name, builtin, profile_json, created_at, updated_at)
                 VALUES(?1, ?2, 1, ?3, ?4, ?5)
                 ON CONFLICT(id) DO UPDATE SET
                   name=excluded.name,
                   builtin=1,
                   profile_json=excluded.profile_json,
                   updated_at=excluded.updated_at",
                params![profile.id, profile.name, json, profile.created_at, profile.updated_at],
            )
            .map_err(|error| format!("could not save built-in profile: {error}"))?;
    }
    transaction
        .execute(
            "INSERT OR IGNORE INTO app_settings(key, value, updated_at) VALUES(?1, ?2, ?3)",
            params![ACTIVE_PROFILE_KEY, DEFAULT_PROFILE_ID, now_ms()],
        )
        .map_err(|error| format!("could not set default profile: {error}"))?;
    transaction
        .commit()
        .map_err(|error| format!("could not commit profile initialization: {error}"))
}

pub fn list(state_dir: &Path) -> Result<Vec<DownloadProfile>, String> {
    let connection = state_db::open(state_dir)?;
    let mut statement = connection
        .prepare(
            "SELECT profile_json FROM download_profiles ORDER BY builtin DESC, name COLLATE NOCASE",
        )
        .map_err(|error| format!("could not query profiles: {error}"))?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| format!("could not read profiles: {error}"))?;
    rows.map(|row| {
        let json = row.map_err(|error| format!("could not read profile row: {error}"))?;
        serde_json::from_str(&json).map_err(|error| format!("could not decode profile: {error}"))
    })
    .collect()
}

pub fn get(state_dir: &Path, id: &str) -> Result<Option<DownloadProfile>, String> {
    let connection = state_db::open(state_dir)?;
    get_with_connection(&connection, id)
}

pub fn active(state_dir: &Path) -> Result<DownloadProfile, String> {
    let connection = state_db::open(state_dir)?;
    let id: Option<String> = connection
        .query_row(
            "SELECT value FROM app_settings WHERE key=?1",
            [ACTIVE_PROFILE_KEY],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| format!("could not read active profile: {error}"))?;
    get_with_connection(&connection, id.as_deref().unwrap_or(DEFAULT_PROFILE_ID))?
        .or_else(|| {
            get_with_connection(&connection, DEFAULT_PROFILE_ID)
                .ok()
                .flatten()
        })
        .ok_or_else(|| "default download profile is unavailable".to_string())
}

pub fn set_active(state_dir: &Path, id: &str) -> Result<DownloadProfile, String> {
    let connection = state_db::open(state_dir)?;
    let profile = get_with_connection(&connection, id)?
        .ok_or_else(|| "download profile does not exist".to_string())?;
    connection
        .execute(
            "INSERT INTO app_settings(key, value, updated_at) VALUES(?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
            params![ACTIVE_PROFILE_KEY, profile.id, now_ms()],
        )
        .map_err(|error| format!("could not set active profile: {error}"))?;
    Ok(profile)
}

pub fn upsert(state_dir: &Path, mut profile: DownloadProfile) -> Result<DownloadProfile, String> {
    normalize(&mut profile)?;
    let connection = state_db::open(state_dir)?;
    let existing = get_with_connection(&connection, &profile.id)?;
    if existing.as_ref().is_some_and(|value| value.builtin) {
        return Err("built-in profiles cannot be overwritten; duplicate it instead".into());
    }
    let now = now_ms();
    profile.builtin = false;
    profile.created_at = existing
        .map(|value| value.created_at)
        .filter(|value| *value > 0)
        .unwrap_or(now);
    profile.updated_at = now;
    let json = serde_json::to_string(&profile)
        .map_err(|error| format!("could not serialize profile: {error}"))?;
    connection
        .execute(
            "INSERT INTO download_profiles(id, name, builtin, profile_json, created_at, updated_at)
             VALUES(?1, ?2, 0, ?3, ?4, ?5)
             ON CONFLICT(id) DO UPDATE SET
               name=excluded.name,
               profile_json=excluded.profile_json,
               created_at=excluded.created_at,
               updated_at=excluded.updated_at",
            params![
                profile.id,
                profile.name,
                json,
                profile.created_at,
                profile.updated_at
            ],
        )
        .map_err(|error| format!("could not save profile: {error}"))?;
    Ok(profile)
}

pub fn delete(state_dir: &Path, id: &str) -> Result<(), String> {
    let connection = state_db::open(state_dir)?;
    let profile = get_with_connection(&connection, id)?
        .ok_or_else(|| "download profile does not exist".to_string())?;
    if profile.builtin {
        return Err("built-in profiles cannot be deleted".into());
    }
    let active_id: Option<String> = connection
        .query_row(
            "SELECT value FROM app_settings WHERE key=?1",
            [ACTIVE_PROFILE_KEY],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| format!("could not read active profile: {error}"))?;
    connection
        .execute("DELETE FROM download_profiles WHERE id=?1", [id])
        .map_err(|error| format!("could not delete profile: {error}"))?;
    if active_id.as_deref() == Some(id) {
        set_active(state_dir, DEFAULT_PROFILE_ID)?;
    }
    Ok(())
}

fn get_with_connection(
    connection: &Connection,
    id: &str,
) -> Result<Option<DownloadProfile>, String> {
    let json: Option<String> = connection
        .query_row(
            "SELECT profile_json FROM download_profiles WHERE id=?1",
            [id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| format!("could not query profile: {error}"))?;
    json.map(|value| {
        serde_json::from_str(&value).map_err(|error| format!("could not decode profile: {error}"))
    })
    .transpose()
}

fn normalize(profile: &mut DownloadProfile) -> Result<(), String> {
    profile.id = profile.id.trim().to_ascii_lowercase();
    profile.name = profile.name.trim().to_string();
    if profile.id.is_empty()
        || profile.id.len() > 64
        || !profile
            .id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err("profile id must contain only letters, numbers, '-' or '_'".into());
    }
    if profile.name.is_empty() || profile.name.len() > 80 {
        return Err("profile name must contain 1 to 80 characters".into());
    }
    profile.connections = profile.connections.min(16);
    profile.split = profile.split.min(64);
    profile.retries = profile.retries.min(20);
    profile.subtitle_languages = normalize_list(&profile.subtitle_languages, 20);
    profile.sponsorblock_categories = normalize_list(&profile.sponsorblock_categories, 16);
    profile.headers = normalize_list(&profile.headers, 32);
    Ok(())
}

fn normalize_list(values: &[String], max: usize) -> Vec<String> {
    let mut normalized = Vec::new();
    for value in values {
        let value = value.trim();
        if !value.is_empty() && !normalized.iter().any(|item| item == value) {
            normalized.push(value.to_string());
        }
        if normalized.len() == max {
            break;
        }
    }
    normalized
}

fn builtin_profiles() -> Vec<DownloadProfile> {
    let now = now_ms();
    let build = |id: &str, name: &str, description: &str| DownloadProfile {
        id: id.into(),
        name: name.into(),
        description: description.into(),
        builtin: true,
        created_at: now,
        updated_at: now,
        ..Default::default()
    };
    vec![
        build(
            "best",
            "Best available",
            "Highest available quality with native audio.",
        ),
        DownloadProfile {
            quality: "quality:720".into(),
            container: "mp4".into(),
            video_codec: "h264".into(),
            ..build(
                "balanced-720",
                "Balanced 720p",
                "Up to 720p in a broadly compatible MP4 profile.",
            )
        },
        DownloadProfile {
            container: "mp4".into(),
            video_codec: "h264".into(),
            ..build(
                "mp4-h264",
                "MP4 / H.264",
                "Best available H.264 video in an MP4 container.",
            )
        },
        DownloadProfile {
            quality: "quality:480".into(),
            container: "mp4".into(),
            video_codec: "h264".into(),
            ..build(
                "small-file",
                "Small file",
                "Up to 480p for lower bandwidth and storage use.",
            )
        },
        DownloadProfile {
            media_mode: "audio-only".into(),
            audio_format: "mp3".into(),
            audio_bitrate: "192".into(),
            ..build(
                "audio-mp3",
                "Audio MP3",
                "Extract audio as a 192 kbps MP3 file.",
            )
        },
        DownloadProfile {
            media_mode: "audio-only".into(),
            audio_format: "opus".into(),
            audio_bitrate: "best".into(),
            ..build(
                "audio-opus",
                "Audio Opus",
                "Extract the best available Opus audio.",
            )
        },
        DownloadProfile {
            media_mode: "subtitles-only".into(),
            subtitle_mode: "sidecar".into(),
            subtitle_languages: vec!["en".into()],
            ..build(
                "subtitles",
                "Subtitles only",
                "Download English subtitles without media.",
            )
        },
    ]
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

    fn test_root() -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "downman-profiles-{}-{}",
            std::process::id(),
            TEST_COUNTER.fetch_add(1, Ordering::Relaxed)
        ))
    }

    #[test]
    fn profile_store_initializes_and_tracks_active_profile() {
        let root = test_root();
        initialize(&root).unwrap();
        let profiles = list(&root).unwrap();
        assert!(profiles.len() >= 6);
        assert_eq!(active(&root).unwrap().id, DEFAULT_PROFILE_ID);
        assert_eq!(
            set_active(&root, "balanced-720").unwrap().quality,
            "quality:720"
        );
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn custom_profiles_round_trip_and_builtin_profiles_are_protected() {
        let root = test_root();
        initialize(&root).unwrap();
        let profile = DownloadProfile {
            id: "Night_Mode".into(),
            name: "Night run".into(),
            connections: 99,
            subtitle_languages: vec!["en".into(), "en".into(), "fr".into()],
            ..Default::default()
        };
        let saved = upsert(&root, profile).unwrap();
        assert_eq!(saved.id, "night_mode");
        assert_eq!(saved.connections, 16);
        assert_eq!(saved.subtitle_languages, vec!["en", "fr"]);
        delete(&root, &saved.id).unwrap();
        assert!(get(&root, &saved.id).unwrap().is_none());
        assert!(delete(&root, DEFAULT_PROFILE_ID).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
}
