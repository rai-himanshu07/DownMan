use crate::profiles::DownloadProfile;
use serde_json::{Map, Value, json};
use std::path::{Component, Path, PathBuf};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PolicyValidation {
    pub valid: bool,
    pub errors: Vec<String>,
    pub warnings: Vec<String>,
}

use serde::Serialize;

pub fn validate(profile: &DownloadProfile) -> PolicyValidation {
    let mut errors = Vec::new();
    let mut warnings = Vec::new();
    if !matches!(
        profile.media_mode.as_str(),
        "video-audio" | "audio-only" | "subtitles-only"
    ) {
        errors.push("Media mode must be video + audio, audio only, or subtitles only.".into());
    }
    if profile.quality != "best"
        && profile
            .quality
            .strip_prefix("quality:")
            .and_then(|value| value.parse::<u32>().ok())
            .filter(|height| (1..=4320).contains(height))
            .is_none()
    {
        errors
            .push("Profile quality must be Best or a semantic height cap from 1p to 4320p.".into());
    }
    if !matches!(
        profile.container.as_str(),
        "avi" | "flv" | "mkv" | "mov" | "mp4" | "webm"
    ) {
        errors.push("Container must be AVI, FLV, MKV, MOV, MP4, or WebM.".into());
    }
    if !matches!(
        profile.video_codec.as_str(),
        "best" | "h264" | "h265" | "vp9" | "av1"
    ) {
        errors.push("Video codec must be Best, H.264, H.265, VP9, or AV1.".into());
    }
    if profile.preferred_fps != "original"
        && profile
            .preferred_fps
            .parse::<u32>()
            .ok()
            .filter(|fps| (1..=240).contains(fps))
            .is_none()
    {
        errors.push("Preferred FPS must be Original or a value from 1 to 240.".into());
    }
    if !matches!(
        profile.audio_format.as_str(),
        "best" | "aac" | "alac" | "flac" | "m4a" | "mp3" | "opus" | "vorbis" | "wav"
    ) {
        errors.push("Audio format is not supported by yt-dlp.".into());
    }
    if profile.audio_bitrate != "best"
        && profile
            .audio_bitrate
            .trim_end_matches(['k', 'K'])
            .parse::<u32>()
            .ok()
            .filter(|bitrate| (8..=1536).contains(bitrate))
            .is_none()
    {
        errors.push("Audio bitrate must be Best or a value from 8 to 1536 kbps.".into());
    }
    if !matches!(profile.subtitle_mode.as_str(), "off" | "sidecar" | "embed") {
        errors.push("Subtitle mode must be Off, Sidecar, or Embed.".into());
    }
    if !matches!(
        profile.subtitle_format.as_str(),
        "ass" | "lrc" | "srt" | "vtt"
    ) {
        errors.push("Subtitle format must be ASS, LRC, SRT, or VTT.".into());
    }
    if !matches!(
        profile.sponsorblock_mode.as_str(),
        "off" | "mark" | "remove"
    ) {
        errors.push("SponsorBlock mode must be Off, Mark, or Remove.".into());
    }
    if !matches!(
        profile.live_policy.as_str(),
        "skip" | "from-start" | "from-now"
    ) {
        errors.push("Live policy must be Skip, From start, or From now.".into());
    }
    if profile.media_mode == "subtitles-only" && profile.subtitle_mode != "sidecar" {
        errors.push("Subtitles-only profiles must write sidecar subtitle files.".into());
    }
    if profile.media_mode == "audio-only" && profile.subtitle_mode == "embed" {
        errors.push(
            "Audio-only profiles cannot embed subtitles; use sidecar subtitles instead.".into(),
        );
    }
    if profile.container == "webm" && matches!(profile.video_codec.as_str(), "h264" | "h265") {
        errors.push("WebM does not support H.264 or H.265; choose VP9, AV1, or Best.".into());
    }
    if matches!(profile.container.as_str(), "mp4" | "mov") && profile.video_codec == "vp9" {
        errors.push(
            "VP9 is not a reliable MP4/MOV target; choose WebM, MKV, or another codec.".into(),
        );
    }
    if !profile.clip_start.trim().is_empty() && parse_time(profile.clip_start.trim()).is_none() {
        errors.push("Clip start must be seconds or HH:MM:SS.".into());
    }
    if !profile.clip_end.trim().is_empty() && parse_time(profile.clip_end.trim()).is_none() {
        errors.push("Clip end must be seconds or HH:MM:SS.".into());
    }
    if let (Some(start), Some(end)) = (
        parse_time(profile.clip_start.trim()),
        parse_time(profile.clip_end.trim()),
    ) && end <= start
    {
        errors.push("Clip end must be later than clip start.".into());
    }
    if profile.media_mode == "subtitles-only"
        && (!profile.clip_start.trim().is_empty() || !profile.clip_end.trim().is_empty())
    {
        warnings.push("Clip ranges do not affect subtitles-only downloads.".into());
    }
    if profile.embed_thumbnail && !matches!(profile.container.as_str(), "mkv" | "mp4" | "mov") {
        warnings
            .push("Embedded thumbnails are most reliable in MKV, MP4, or MOV containers.".into());
    }
    if !profile.max_download_limit.trim().is_empty()
        && !valid_rate(profile.max_download_limit.trim())
    {
        errors.push("Speed limit must be a number with an optional K, M, or G suffix.".into());
    }
    for header in &profile.headers {
        if !header.contains(':') {
            errors.push(format!("Header '{header}' must contain a colon."));
        }
    }
    errors.sort();
    errors.dedup();
    PolicyValidation {
        valid: errors.is_empty(),
        errors,
        warnings,
    }
}

pub fn ensure_valid(profile: &DownloadProfile) -> Result<(), String> {
    let validation = validate(profile);
    if validation.valid {
        Ok(())
    } else {
        Err(validation.errors.join(" "))
    }
}

pub fn apply_aria2_options(
    profile: &DownloadProfile,
    options: &mut Map<String, Value>,
    default_dir: &Path,
) {
    if !options.contains_key("dir")
        && (!profile.output_dir.trim().is_empty() || !profile.subfolder.trim().is_empty())
    {
        options.insert(
            "dir".into(),
            json!(output_dir(profile, default_dir).display().to_string()),
        );
    }
    insert_string(options, "max-download-limit", &profile.max_download_limit);
    if profile.connections > 0 {
        options
            .entry("max-connection-per-server")
            .or_insert_with(|| json!(profile.connections.to_string()));
    }
    if profile.split > 0 {
        options
            .entry("split")
            .or_insert_with(|| json!(profile.split.to_string()));
    }
    insert_string(options, "all-proxy", &profile.proxy);
    insert_string(options, "user-agent", &profile.user_agent);
    if !profile.headers.is_empty() {
        options
            .entry("header")
            .or_insert_with(|| json!(profile.headers));
    }
    if profile.retries > 0 {
        options
            .entry("max-tries")
            .or_insert_with(|| json!(profile.retries.to_string()));
    }
}

pub fn output_dir(profile: &DownloadProfile, default_dir: &Path) -> PathBuf {
    let mut output = if profile.output_dir.trim().is_empty() {
        default_dir.to_path_buf()
    } else {
        PathBuf::from(profile.output_dir.trim())
    };
    for component in Path::new(profile.subfolder.trim()).components() {
        if let Component::Normal(part) = component {
            output.push(part);
        }
    }
    output
}

pub fn command_args(
    profile: &DownloadProfile,
    format_override: Option<&str>,
    force_subtitles: bool,
    force_sponsorblock: bool,
) -> Vec<String> {
    let mut args = match profile.media_mode.as_str() {
        "audio-only" => audio_args(profile),
        "subtitles-only" => vec!["--skip-download".into()],
        _ => format_args(
            format_override
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .unwrap_or(&profile.quality),
            &profile.container,
            &profile.video_codec,
            &profile.preferred_fps,
        ),
    };

    let subtitles = force_subtitles || profile.subtitle_mode != "off";
    if subtitles || profile.media_mode == "subtitles-only" {
        args.push("--write-subs".into());
        args.push("--write-auto-subs".into());
        args.push("--sub-langs".into());
        args.push(if profile.subtitle_languages.is_empty() {
            "en.*,en".into()
        } else {
            profile.subtitle_languages.join(",")
        });
        args.push("--sub-format".into());
        args.push(valid_subtitle_format(&profile.subtitle_format).into());
        if force_subtitles || profile.subtitle_mode == "embed" {
            args.push("--embed-subs".into());
        }
    }

    let sponsorblock_mode = if force_sponsorblock {
        "remove"
    } else {
        profile.sponsorblock_mode.as_str()
    };
    if matches!(sponsorblock_mode, "mark" | "remove") {
        args.push(format!("--sponsorblock-{sponsorblock_mode}"));
        args.push(if profile.sponsorblock_categories.is_empty() {
            "default".into()
        } else {
            profile.sponsorblock_categories.join(",")
        });
    }
    if profile.embed_metadata {
        args.push("--embed-metadata".into());
    }
    if profile.embed_thumbnail {
        args.push("--embed-thumbnail".into());
    }
    if profile.embed_chapters {
        args.push("--embed-chapters".into());
    }
    if profile.write_description {
        args.push("--write-description".into());
    }
    if !profile.clip_start.trim().is_empty() || !profile.clip_end.trim().is_empty() {
        let start = match profile.clip_start.trim() {
            "" => "0",
            value => value,
        };
        let end = profile.clip_end.trim();
        args.push("--download-sections".into());
        args.push(format!("*{start}-{end}"));
        args.push("--force-keyframes-at-cuts".into());
    }
    match profile.live_policy.as_str() {
        "skip" => {
            args.push("--match-filter".into());
            args.push("!is_live".into());
        }
        "from-start" => args.push("--live-from-start".into()),
        _ => {}
    }
    args
}

#[cfg(test)]
pub fn legacy_format_args(quality: &str) -> Vec<String> {
    format_args(quality, "mp4", "best", "original")
}

fn format_args(quality: &str, container: &str, codec: &str, fps: &str) -> Vec<String> {
    let container = valid_container(container);
    let selector = if let Some(height) = quality
        .strip_prefix("quality:")
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|height| (1..=4320).contains(height))
    {
        video_selector(Some(height), codec, fps)
    } else {
        match quality {
            "1080" => video_selector(Some(1080), codec, fps),
            "720" => video_selector(Some(720), codec, fps),
            "best" | "" => video_selector(None, codec, fps),
            "audio" => {
                return vec![
                    "-f".into(),
                    "ba/b".into(),
                    "-x".into(),
                    "--audio-format".into(),
                    "mp3".into(),
                ];
            }
            raw => raw.to_string(),
        }
    };
    vec![
        "-f".into(),
        selector,
        "--merge-output-format".into(),
        container.into(),
    ]
}

fn video_selector(height: Option<u64>, codec: &str, fps: &str) -> String {
    let mut filters = String::new();
    if let Some(height) = height {
        filters.push_str(&format!("[height<={height}]"));
    }
    if let Ok(fps) = fps.parse::<u32>()
        && (1..=240).contains(&fps)
    {
        filters.push_str(&format!("[fps<={fps}]"));
    }
    let codec_filter = match codec {
        "h264" => "[vcodec^=avc1]",
        "h265" => "[vcodec^=hev1]",
        "vp9" => "[vcodec^=vp9]",
        "av1" => "[vcodec^=av01]",
        _ => "",
    };
    let fallback = if let Some(height) = height {
        format!("bv*[height<={height}]+ba/b[height<={height}]/b")
    } else {
        "bv*+ba/b".into()
    };
    if codec_filter.is_empty()
        && filters
            == height
                .map(|value| format!("[height<={value}]"))
                .unwrap_or_default()
    {
        fallback
    } else {
        format!("bv*{filters}{codec_filter}+ba/{fallback}")
    }
}

fn audio_args(profile: &DownloadProfile) -> Vec<String> {
    let format = match profile.audio_format.as_str() {
        "aac" | "alac" | "flac" | "m4a" | "mp3" | "opus" | "vorbis" | "wav" => {
            profile.audio_format.as_str()
        }
        _ => "best",
    };
    let mut args = vec![
        "-f".into(),
        "ba/b".into(),
        "-x".into(),
        "--audio-format".into(),
        format.into(),
    ];
    if profile.audio_bitrate != "best" && !profile.audio_bitrate.trim().is_empty() {
        args.push("--audio-quality".into());
        args.push(format!(
            "{}K",
            profile.audio_bitrate.trim_end_matches(['k', 'K'])
        ));
    }
    args
}

fn insert_string(options: &mut Map<String, Value>, key: &str, value: &str) {
    if !value.trim().is_empty() {
        options.entry(key).or_insert_with(|| json!(value.trim()));
    }
}

fn valid_container(value: &str) -> &str {
    match value {
        "avi" | "flv" | "mkv" | "mov" | "mp4" | "webm" => value,
        _ => "mp4",
    }
}

fn valid_subtitle_format(value: &str) -> &str {
    match value {
        "ass" | "lrc" | "srt" | "vtt" => value,
        _ => "srt",
    }
}

fn parse_time(value: &str) -> Option<f64> {
    if value.is_empty() {
        return None;
    }
    let parts: Vec<&str> = value.split(':').collect();
    if parts.len() > 3 || parts.iter().any(|part| part.is_empty()) {
        return None;
    }
    let mut seconds = 0.0;
    for (index, part) in parts.iter().enumerate() {
        let value = part.parse::<f64>().ok()?;
        if !value.is_finite() || value < 0.0 || (index > 0 && value >= 60.0) {
            return None;
        }
        seconds = seconds * 60.0 + value;
    }
    Some(seconds)
}

fn valid_rate(value: &str) -> bool {
    let number = value.trim_end_matches(['k', 'K', 'm', 'M', 'g', 'G']);
    number
        .parse::<f64>()
        .ok()
        .is_some_and(|rate| rate.is_finite() && rate > 0.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn aria_profile_fills_missing_options_without_overriding_explicit_values() {
        let profile = DownloadProfile {
            output_dir: "/tmp/profile".into(),
            subfolder: "nested/../safe".into(),
            max_download_limit: "2M".into(),
            connections: 8,
            proxy: "http://127.0.0.1:8080".into(),
            ..Default::default()
        };
        let mut options = serde_json::Map::from_iter([
            ("max-download-limit".into(), json!("5M")),
            ("max-connection-per-server".into(), json!("2")),
        ]);
        apply_aria2_options(&profile, &mut options, Path::new("/tmp/default"));
        assert_eq!(options["max-download-limit"], json!("5M"));
        assert_eq!(options["max-connection-per-server"], json!("2"));
        assert_eq!(options["all-proxy"], json!("http://127.0.0.1:8080"));
        assert_eq!(options["dir"], json!("/tmp/profile/nested/safe"));
    }

    #[test]
    fn semantic_quality_keeps_stable_height_fallback() {
        assert_eq!(
            legacy_format_args("quality:480"),
            vec![
                "-f",
                "bv*[height<=480]+ba/b[height<=480]/b",
                "--merge-output-format",
                "mp4"
            ]
        );
        assert_eq!(
            legacy_format_args("135+bestaudio/135")[1],
            "135+bestaudio/135"
        );
    }

    #[test]
    fn rich_media_policy_builds_audio_subtitle_and_sponsorblock_arguments() {
        let profile = DownloadProfile {
            media_mode: "audio-only".into(),
            audio_format: "opus".into(),
            audio_bitrate: "160".into(),
            subtitle_mode: "sidecar".into(),
            subtitle_languages: vec!["en".into(), "fr".into()],
            sponsorblock_mode: "mark".into(),
            sponsorblock_categories: vec!["sponsor".into(), "intro".into()],
            embed_metadata: true,
            ..Default::default()
        };
        let args = command_args(&profile, None, false, false);
        assert!(
            args.windows(2)
                .any(|pair| pair == ["--audio-format", "opus"])
        );
        assert!(args.windows(2).any(|pair| pair == ["--sub-langs", "en,fr"]));
        assert!(
            args.windows(2)
                .any(|pair| pair == ["--sponsorblock-mark", "sponsor,intro"])
        );
        assert!(args.iter().any(|arg| arg == "--embed-metadata"));
    }

    #[test]
    fn clip_end_only_uses_an_absolute_section() {
        let profile = DownloadProfile {
            clip_end: "90".into(),
            ..Default::default()
        };
        let args = command_args(&profile, None, false, false);
        let section = args
            .windows(2)
            .find(|pair| pair[0] == "--download-sections")
            .map(|pair| pair[1].as_str());
        assert_eq!(section, Some("*0-90"));
    }

    #[test]
    fn validation_rejects_incompatible_and_nonsemantic_profile_values() {
        let profile = DownloadProfile {
            media_mode: "audio-only".into(),
            quality: "137+bestaudio".into(),
            container: "webm".into(),
            video_codec: "h264".into(),
            subtitle_mode: "embed".into(),
            clip_start: "01:30".into(),
            clip_end: "1:20".into(),
            ..Default::default()
        };
        let result = validate(&profile);
        assert!(!result.valid);
        assert!(
            result
                .errors
                .iter()
                .any(|error| error.contains("semantic height"))
        );
        assert!(
            result
                .errors
                .iter()
                .any(|error| error.contains("cannot embed subtitles"))
        );
        assert!(result.errors.iter().any(|error| error.contains("Clip end")));
    }

    #[test]
    fn validation_accepts_supported_rich_media_matrix() {
        let profile = DownloadProfile {
            quality: "quality:1080".into(),
            container: "mkv".into(),
            video_codec: "av1".into(),
            preferred_fps: "60".into(),
            subtitle_mode: "embed".into(),
            subtitle_languages: vec!["en".into(), "hi".into()],
            sponsorblock_mode: "remove".into(),
            embed_metadata: true,
            clip_start: "00:01:30.5".into(),
            clip_end: "125".into(),
            max_download_limit: "2.5M".into(),
            headers: vec!["Authorization: Bearer test".into()],
            ..Default::default()
        };
        let result = validate(&profile);
        assert!(result.valid, "{:?}", result.errors);
    }
}
