use crate::state_db;
use chrono::{Datelike, Local, Timelike};
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

const GLOBAL_SCHEDULE_KEY: &str = "scheduler_global";

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct TimeWindow {
    pub start: String,
    pub stop: String,
    pub days: Vec<u8>,
}

impl Default for TimeWindow {
    fn default() -> Self {
        Self {
            start: "01:00".into(),
            stop: "08:00".into(),
            days: Vec::new(),
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct GlobalSchedule {
    pub enabled: bool,
    pub timezone: String,
    pub windows: Vec<TimeWindow>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct JobSchedule {
    pub mode: String,
    pub window: Option<TimeWindow>,
}

impl Default for JobSchedule {
    fn default() -> Self {
        Self {
            mode: "inherit".into(),
            window: None,
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(default, rename_all = "camelCase")]
pub struct NetworkOverride {
    pub max_download_limit: String,
    pub connections: u32,
    pub split: u32,
    pub proxy: String,
    pub user_agent: String,
    pub headers: Vec<String>,
    pub cookies_browser: String,
    pub http_username: String,
    #[serde(skip)]
    pub has_password: bool,
    pub metered_behavior: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Moment {
    /// Monday = 0, Sunday = 6.
    pub weekday: u8,
    pub minute: u16,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleDecision {
    pub allowed: bool,
    pub source: String,
}

pub fn current_moment() -> Moment {
    let now = Local::now();
    Moment {
        weekday: now.weekday().num_days_from_monday() as u8,
        minute: (now.hour() * 60 + now.minute()) as u16,
    }
}

pub fn load_global(state_dir: &Path) -> Result<GlobalSchedule, String> {
    let connection = state_db::open(state_dir)?;
    let value: Option<String> = connection
        .query_row(
            "SELECT value FROM app_settings WHERE key=?1",
            [GLOBAL_SCHEDULE_KEY],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| format!("could not read global schedule: {error}"))?;
    match value {
        Some(value) => serde_json::from_str(&value)
            .map_err(|error| format!("could not decode global schedule: {error}")),
        None => Ok(GlobalSchedule::default()),
    }
}

pub fn save_global(
    state_dir: &Path,
    mut schedule: GlobalSchedule,
) -> Result<GlobalSchedule, String> {
    normalize_global(&mut schedule)?;
    let value = serde_json::to_string(&schedule)
        .map_err(|error| format!("could not encode global schedule: {error}"))?;
    let connection = state_db::open(state_dir)?;
    connection
        .execute(
            "INSERT INTO app_settings(key, value, updated_at) VALUES(?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
            params![GLOBAL_SCHEDULE_KEY, value, now_ms()],
        )
        .map_err(|error| format!("could not save global schedule: {error}"))?;
    Ok(schedule)
}

pub fn normalize_job(schedule: &mut JobSchedule) -> Result<(), String> {
    schedule.mode = schedule.mode.trim().to_lowercase();
    if !matches!(
        schedule.mode.as_str(),
        "inherit" | "always" | "paused" | "window"
    ) {
        return Err("job schedule mode must be inherit, always, paused, or window".into());
    }
    if schedule.mode == "window" {
        let window = schedule
            .window
            .as_mut()
            .ok_or_else(|| "window schedule needs start and stop times".to_string())?;
        normalize_window(window)?;
    } else {
        schedule.window = None;
    }
    Ok(())
}

pub fn normalize_network(override_value: &mut NetworkOverride) -> Result<(), String> {
    override_value.connections = override_value.connections.min(16);
    override_value.split = override_value.split.min(64);
    override_value.max_download_limit = override_value.max_download_limit.trim().to_string();
    if !override_value.max_download_limit.is_empty()
        && !valid_rate(&override_value.max_download_limit)
    {
        return Err("job speed limit must be a number with an optional K, M, or G suffix".into());
    }
    override_value.proxy = override_value.proxy.trim().to_string();
    override_value.user_agent = override_value.user_agent.trim().to_string();
    override_value.cookies_browser = override_value.cookies_browser.trim().to_lowercase();
    override_value.http_username = override_value.http_username.trim().to_string();
    override_value.metered_behavior = override_value.metered_behavior.trim().to_lowercase();
    if !matches!(
        override_value.metered_behavior.as_str(),
        "" | "inherit" | "pause" | "ignore"
    ) {
        return Err("metered behavior must be inherit, pause, or ignore".into());
    }
    override_value.headers = normalize_headers(&override_value.headers)?;
    Ok(())
}

pub fn apply_aria2_options(
    override_value: &NetworkOverride,
    password: Option<&str>,
    options: &mut Map<String, Value>,
) {
    insert_string(
        options,
        "max-download-limit",
        &override_value.max_download_limit,
    );
    if override_value.connections > 0 {
        options.insert(
            "max-connection-per-server".into(),
            json!(override_value.connections.to_string()),
        );
    }
    if override_value.split > 0 {
        options.insert("split".into(), json!(override_value.split.to_string()));
    }
    insert_string(options, "all-proxy", &override_value.proxy);
    insert_string(options, "user-agent", &override_value.user_agent);
    if !override_value.headers.is_empty() {
        options.insert("header".into(), json!(override_value.headers));
    }
    insert_string(options, "http-user", &override_value.http_username);
    if let Some(password) = password.filter(|value| !value.is_empty()) {
        options.insert("http-passwd".into(), json!(password));
    }
}

pub fn queue_window(value: Option<&Value>) -> Option<TimeWindow> {
    let value = value?.as_object()?;
    let start = value.get("start")?.as_str()?.trim();
    let stop = value.get("stop")?.as_str()?.trim();
    if start.is_empty() || stop.is_empty() || start == stop {
        return None;
    }
    let days = value
        .get("days")
        .and_then(Value::as_array)
        .map(|days| {
            days.iter()
                .filter_map(Value::as_u64)
                .filter(|day| *day <= 6)
                .map(|day| day as u8)
                .collect()
        })
        .unwrap_or_default();
    let mut window = TimeWindow {
        start: start.into(),
        stop: stop.into(),
        days,
    };
    normalize_window(&mut window).ok()?;
    Some(window)
}

pub fn effective_decision(
    moment: Moment,
    job: Option<&JobSchedule>,
    queue: Option<&TimeWindow>,
    global: &GlobalSchedule,
) -> ScheduleDecision {
    if let Some(job) = job {
        match job.mode.as_str() {
            "always" => {
                return ScheduleDecision {
                    allowed: true,
                    source: "job".into(),
                };
            }
            "paused" => {
                return ScheduleDecision {
                    allowed: false,
                    source: "job".into(),
                };
            }
            "window" => {
                return ScheduleDecision {
                    allowed: job
                        .window
                        .as_ref()
                        .is_some_and(|window| window_contains(window, moment)),
                    source: "job".into(),
                };
            }
            _ => {}
        }
    }
    if let Some(queue) = queue {
        return ScheduleDecision {
            allowed: window_contains(queue, moment),
            source: "queue".into(),
        };
    }
    if global.enabled {
        return ScheduleDecision {
            allowed: global
                .windows
                .iter()
                .any(|window| window_contains(window, moment)),
            source: "global".into(),
        };
    }
    ScheduleDecision {
        allowed: true,
        source: "none".into(),
    }
}

pub fn window_contains(window: &TimeWindow, moment: Moment) -> bool {
    let Some(start) = parse_minute(&window.start) else {
        return false;
    };
    let Some(stop) = parse_minute(&window.stop) else {
        return false;
    };
    if start == stop || moment.weekday > 6 || moment.minute >= 24 * 60 {
        return false;
    }
    let day_enabled = |day: u8| window.days.is_empty() || window.days.contains(&day);
    if start < stop {
        day_enabled(moment.weekday) && moment.minute >= start && moment.minute < stop
    } else if moment.minute >= start {
        day_enabled(moment.weekday)
    } else if moment.minute < stop {
        day_enabled((moment.weekday + 6) % 7)
    } else {
        false
    }
}

fn normalize_global(schedule: &mut GlobalSchedule) -> Result<(), String> {
    schedule.timezone = "local".into();
    if schedule.windows.len() > 16 {
        return Err("global schedule supports at most 16 windows".into());
    }
    for window in &mut schedule.windows {
        normalize_window(window)?;
    }
    if schedule.enabled && schedule.windows.is_empty() {
        return Err("enabled global schedule needs at least one time window".into());
    }
    Ok(())
}

fn normalize_window(window: &mut TimeWindow) -> Result<(), String> {
    window.start = normalize_time(&window.start)?;
    window.stop = normalize_time(&window.stop)?;
    if window.start == window.stop {
        return Err("schedule start and stop times must differ".into());
    }
    window.days.retain(|day| *day <= 6);
    window.days.sort_unstable();
    window.days.dedup();
    Ok(())
}

fn normalize_time(value: &str) -> Result<String, String> {
    let minute = parse_minute(value)
        .ok_or_else(|| "schedule times must use 24-hour HH:MM format".to_string())?;
    Ok(format!("{:02}:{:02}", minute / 60, minute % 60))
}

fn parse_minute(value: &str) -> Option<u16> {
    let (hours, minutes) = value.trim().split_once(':')?;
    let hours = hours.parse::<u16>().ok()?;
    let minutes = minutes.parse::<u16>().ok()?;
    (hours <= 23 && minutes <= 59).then_some(hours * 60 + minutes)
}

fn valid_rate(value: &str) -> bool {
    let number = value.trim_end_matches(['k', 'K', 'm', 'M', 'g', 'G']);
    number
        .parse::<f64>()
        .ok()
        .is_some_and(|rate| rate.is_finite() && rate > 0.0)
}

fn normalize_headers(headers: &[String]) -> Result<Vec<String>, String> {
    let mut values = Vec::new();
    for header in headers {
        let header = header.trim();
        if header.is_empty() {
            continue;
        }
        if !header.contains(':') {
            return Err(format!("job header '{header}' must contain a colon"));
        }
        if !values.iter().any(|value| value == header) {
            values.push(header.to_string());
        }
        if values.len() == 32 {
            break;
        }
    }
    Ok(values)
}

fn insert_string(options: &mut Map<String, Value>, key: &str, value: &str) {
    if !value.trim().is_empty() {
        options.insert(key.into(), json!(value.trim()));
    }
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

    fn window(start: &str, stop: &str, days: &[u8]) -> TimeWindow {
        TimeWindow {
            start: start.into(),
            stop: stop.into(),
            days: days.to_vec(),
        }
    }

    #[test]
    fn normal_and_overnight_windows_use_start_day_semantics() {
        let daytime = window("09:00", "17:00", &[0]);
        assert!(window_contains(
            &daytime,
            Moment {
                weekday: 0,
                minute: 9 * 60
            }
        ));
        assert!(!window_contains(
            &daytime,
            Moment {
                weekday: 0,
                minute: 17 * 60
            }
        ));
        let overnight = window("22:00", "06:00", &[0]);
        assert!(window_contains(
            &overnight,
            Moment {
                weekday: 0,
                minute: 23 * 60
            }
        ));
        assert!(window_contains(
            &overnight,
            Moment {
                weekday: 1,
                minute: 2 * 60
            }
        ));
        assert!(!window_contains(
            &overnight,
            Moment {
                weekday: 2,
                minute: 2 * 60
            }
        ));
    }

    #[test]
    fn per_job_schedule_overrides_queue_and_global_windows() {
        let moment = Moment {
            weekday: 2,
            minute: 12 * 60,
        };
        let global = GlobalSchedule {
            enabled: true,
            timezone: "local".into(),
            windows: vec![window("01:00", "02:00", &[])],
        };
        let queue = window("03:00", "04:00", &[]);
        let job = JobSchedule {
            mode: "always".into(),
            window: None,
        };
        assert_eq!(
            effective_decision(moment, Some(&job), Some(&queue), &global),
            ScheduleDecision {
                allowed: true,
                source: "job".into()
            }
        );
        assert_eq!(
            effective_decision(moment, None, Some(&queue), &global).source,
            "queue"
        );
        assert!(!effective_decision(moment, None, None, &global).allowed);
    }

    #[test]
    fn global_schedule_round_trips_through_sqlite() {
        let root = std::env::temp_dir().join(format!(
            "downman-scheduler-{}-{}",
            std::process::id(),
            now_ms()
        ));
        let schedule = GlobalSchedule {
            enabled: true,
            timezone: "ignored".into(),
            windows: vec![window("1:05", "8:30", &[6, 0, 0])],
        };
        let saved = save_global(&root, schedule).unwrap();
        assert_eq!(saved.timezone, "local");
        assert_eq!(saved.windows[0].start, "01:05");
        assert_eq!(saved.windows[0].days, vec![0, 6]);
        assert_eq!(load_global(&root).unwrap(), saved);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn network_override_validates_and_maps_aria2_options_without_secrets_in_model() {
        let mut override_value = NetworkOverride {
            max_download_limit: "2M".into(),
            connections: 99,
            split: 8,
            proxy: " http://127.0.0.1:8080 ".into(),
            headers: vec!["Authorization: Bearer value".into()],
            http_username: " user ".into(),
            ..Default::default()
        };
        normalize_network(&mut override_value).unwrap();
        assert_eq!(override_value.connections, 16);
        let mut options = Map::new();
        apply_aria2_options(&override_value, Some("secret"), &mut options);
        assert_eq!(options["max-download-limit"], json!("2M"));
        assert_eq!(options["http-user"], json!("user"));
        assert_eq!(options["http-passwd"], json!("secret"));
        assert!(
            !serde_json::to_string(&override_value)
                .unwrap()
                .contains("secret")
        );
    }
}
