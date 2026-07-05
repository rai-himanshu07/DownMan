mod aria2;

use aria2::{Aria2, Snapshot};
use once_cell::sync::{Lazy, OnceCell};
use rand::Rng;
use regex::Regex;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet, VecDeque};
use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::Manager;

static ARIA2: OnceCell<Aria2> = OnceCell::new();
static SITE_JOBS: OnceCell<Mutex<Vec<Value>>> = OnceCell::new();
static APP: OnceCell<tauri::AppHandle> = OnceCell::new();
/// Downloads awaiting the user's confirmation dialog.
static PENDING: OnceCell<Mutex<Vec<Value>>> = OnceCell::new();
/// Persisted history of completed downloads (survives restart).
static HISTORY: OnceCell<Mutex<Vec<Value>>> = OnceCell::new();
/// gids the user gave an explicit save folder — skip auto-organize for them.
static NO_ORGANIZE: OnceCell<Mutex<HashSet<String>>> = OnceCell::new();
/// Full target paths reserved by in-flight downloads (collision avoidance).
static RESERVED: OnceCell<Mutex<HashSet<String>>> = OnceCell::new();
/// Show the confirmation dialog for browser downloads (default on).
static ASK_BEFORE: AtomicBool = AtomicBool::new(true);
/// Auto-sort finished files into category subfolders (synced from the UI).
static ORGANIZE: AtomicBool = AtomicBool::new(true);
/// Power off the machine once every download has finished.
static SHUTDOWN_WHEN_DONE: AtomicBool = AtomicBool::new(false);
/// Scan finished files with clamscan (if installed).
static AV_SCAN: AtomicBool = AtomicBool::new(false);
/// Auto-extract finished archives into a subfolder.
static AUTO_EXTRACT: AtomicBool = AtomicBool::new(false);
/// Remote web UI (LAN control surface) — token-protected, off by default.
static REMOTE_ENABLED: AtomicBool = AtomicBool::new(false);
static REMOTE_STARTED: AtomicBool = AtomicBool::new(false);
/// Auto-refresh yt-dlp on our own schedule (default on) + last check (unix secs).
static YTDLP_AUTO: AtomicBool = AtomicBool::new(true);
static YTDLP_LAST_CHECK: AtomicU64 = AtomicU64::new(0);
static LAST_BRIDGE_PING: AtomicU64 = AtomicU64::new(0);
static REMOTE_TOKEN: OnceCell<String> = OnceCell::new();
/// Custom download folder override (None = default).
static DLDIR: OnceCell<Mutex<Option<String>>> = OnceCell::new();
/// URLs whose downloads came from the Site Grabber (kept out of the main lists).
static GRABBED: OnceCell<Mutex<Value>> = OnceCell::new();
/// User-supplied and auto-fetched BitTorrent trackers.
static CUSTOM_TRACKERS: OnceCell<Mutex<Vec<String>>> = OnceCell::new();
static AUTO_TRACKERS: OnceCell<Mutex<Vec<String>>> = OnceCell::new();
/// Max completed downloads kept in history (0 = unlimited).
static HISTORY_LIMIT: AtomicUsize = AtomicUsize::new(500);
/// A pending "open the Site Grabber for this URL" request from the extension.
static GRAB_REQUEST: OnceCell<Mutex<Option<String>>> = OnceCell::new();
/// Browser interception rules (auto-download file types + site/address blocklists).
static RULES: OnceCell<Mutex<Value>> = OnceCell::new();
/// Editable categories: each { name, exts[], folder } drives sorting + folders.
static CATEGORIES: OnceCell<Mutex<Value>> = OnceCell::new();
/// Download queues (definitions) and per-URL membership map.
static QUEUES: OnceCell<Mutex<Value>> = OnceCell::new();
static QMEMBER: OnceCell<Mutex<Value>> = OnceCell::new();
/// Per-queue "had active members" latch so an on-complete action fires once.
static QHADACTIVE: OnceCell<Mutex<std::collections::HashMap<String, bool>>> = OnceCell::new();
/// Watch the clipboard for copied download links (opt-in from Settings).
static CLIPBOARD_WATCH: AtomicBool = AtomicBool::new(false);
/// Auto-pause downloads while on a metered connection (hotspot etc.).
static METERED_PAUSE: AtomicBool = AtomicBool::new(true);
static PAUSED_BY_METER: AtomicBool = AtomicBool::new(false);
/// Keep the machine awake (inhibit sleep) while anything is downloading.
static POWER_BLOCK: AtomicBool = AtomicBool::new(true);
/// Tray "Speed limit" toggle state + the limit it applies.
static LIMIT_ON: AtomicBool = AtomicBool::new(false);
static LIMIT_VAL: OnceCell<Mutex<String>> = OnceCell::new();
static TRAY_LIMIT: OnceCell<tauri::menu::CheckMenuItem<tauri::Wry>> = OnceCell::new();
/// Held systemd-inhibit child while downloads are active.
static INHIBITOR: OnceCell<Mutex<Option<Child>>> = OnceCell::new();
/// Auto-retry bookkeeping: source URL -> attempts made.
static RETRIES: OnceCell<Mutex<HashMap<String, u32>>> = OnceCell::new();

fn limit_val() -> &'static Mutex<String> {
    LIMIT_VAL.get_or_init(|| Mutex::new("1M".into()))
}

fn inhibitor() -> &'static Mutex<Option<Child>> {
    INHIBITOR.get_or_init(|| Mutex::new(None))
}

fn retries() -> &'static Mutex<HashMap<String, u32>> {
    RETRIES.get_or_init(|| Mutex::new(HashMap::new()))
}

fn history() -> &'static Mutex<Vec<Value>> {
    HISTORY.get_or_init(|| Mutex::new(Vec::new()))
}

fn no_organize() -> &'static Mutex<HashSet<String>> {
    NO_ORGANIZE.get_or_init(|| Mutex::new(HashSet::new()))
}

fn history_file() -> std::path::PathBuf {
    state_dir().join(".downman-history.json")
}

fn save_history() {
    if let Ok(h) = history().lock() {
        if let Ok(s) = serde_json::to_string(&*h) {
            let _ = std::fs::write(history_file(), s);
        }
    }
}

fn load_history() {
    if let Ok(s) = std::fs::read_to_string(history_file()) {
        if let Ok(Value::Array(mut arr)) = serde_json::from_str::<Value>(&s) {
            // Purge stale magnet-metadata / superseded placeholders saved by older builds.
            let before = arr.len();
            arr.retain(|t| !is_superseded(t));
            let changed = arr.len() != before;
            if let Ok(mut h) = history().lock() {
                *h = arr;
            }
            if changed {
                save_history();
            }
        }
    }
}

fn rules() -> &'static Mutex<Value> {
    RULES.get_or_init(|| Mutex::new(default_rules()))
}

/// Capture defaults: which file types to auto-grab, and which sites to ignore.
fn default_rules() -> Value {
    json!({
        "enabled": true,
        "autoExts": ["3GP","7Z","AAC","ACE","AIF","APK","ARJ","ASF","AVI","BIN","BZ2","EXE","GZ","GZIP","IMG","ISO","LZH","M4A","M4V","MKV","MOV","MP3","MP4","MPA","MPE","MPEG","MPG","MSI","MSU","OGG","OGV","PDF","PLJ","PPS","PPT","QT","RA","RAR","RM","RMVB","SEA","SIT","SITX","TAR","TIF","TIFF","WAV","WMA","WMV","Z","ZIP"],
        "blockSites": ["*.update.microsoft.com","download.windowsupdate.com","*.download.windowsupdate.com","siteseal.thawte.com","ecom.cimetz.com","*.voice2page.com"],
        "blockAddresses": []
    })
}

fn rules_file() -> std::path::PathBuf {
    state_dir().join(".downman-rules.json")
}

fn load_rules() {
    if let Ok(s) = std::fs::read_to_string(rules_file()) {
        if let Ok(v) = serde_json::from_str::<Value>(&s) {
            if let Ok(mut r) = rules().lock() {
                *r = v;
            }
        }
    }
}

fn save_rules() {
    if let Ok(r) = rules().lock() {
        if let Ok(s) = serde_json::to_string_pretty(&*r) {
            let _ = std::fs::write(rules_file(), s);
        }
    }
}

#[tauri::command]
fn get_rules() -> Value {
    rules().lock().map(|r| r.clone()).unwrap_or_else(|_| default_rules())
}

#[tauri::command]
fn set_rules(data: Value) -> Result<(), String> {
    if let Ok(mut r) = rules().lock() {
        *r = data;
    }
    save_rules();
    Ok(())
}

fn categories() -> &'static Mutex<Value> {
    CATEGORIES.get_or_init(|| Mutex::new(default_categories()))
}

/// Default categories. The first whose ext list contains a file's extension wins;
/// the category with an empty ext list is the catch-all.
fn default_categories() -> Value {
    json!([
        {"name":"Video","exts":["mp4","mkv","webm","avi","mov","ts","m4v","flv","wmv","mpg","mpeg","ogv","3gp"],"folder":"Video"},
        {"name":"Audio","exts":["mp3","flac","wav","aac","ogg","m4a","opus","wma"],"folder":"Audio"},
        {"name":"Images","exts":["jpg","jpeg","png","gif","webp","svg","bmp","tiff","ico","heic"],"folder":"Images"},
        {"name":"Documents","exts":["pdf","doc","docx","txt","epub","xls","xlsx","ppt","pptx","odt","rtf","csv"],"folder":"Documents"},
        {"name":"Programs","exts":["exe","msi","appimage","rpm","apk","dmg","pkg"],"folder":"Programs"},
        {"name":"Archives","exts":["zip","rar","7z","tar","gz","xz","bz2","deb","iso","img"],"folder":"Archives"},
        {"name":"Other","exts":[],"folder":"Other"}
    ])
}

fn categories_file() -> std::path::PathBuf {
    state_dir().join(".downman-categories.json")
}

fn load_categories() {
    if let Ok(s) = std::fs::read_to_string(categories_file()) {
        if let Ok(v @ Value::Array(_)) = serde_json::from_str::<Value>(&s) {
            if let Ok(mut c) = categories().lock() {
                *c = v;
            }
        }
    }
}

fn save_categories() {
    if let Ok(c) = categories().lock() {
        if let Ok(s) = serde_json::to_string_pretty(&*c) {
            let _ = std::fs::write(categories_file(), s);
        }
    }
}

/// Resolve a folder string to an absolute path (absolute as-is, else under the base dir).
fn resolve_folder(folder: &str) -> std::path::PathBuf {
    let p = std::path::Path::new(folder);
    if p.is_absolute() {
        p.to_path_buf()
    } else {
        download_dir().join(folder)
    }
}

/// Resolve a filename to (category name, absolute destination folder).
fn category_of(name: &str) -> (String, std::path::PathBuf) {
    let ext = name.rsplit('.').next().unwrap_or("").to_lowercase();
    if let Ok(guard) = categories().lock() {
        if let Value::Array(list) = &*guard {
            if !ext.is_empty() {
                for c in list {
                    if let Some(exts) = c.get("exts").and_then(|e| e.as_array()) {
                        if exts.iter().any(|e| e.as_str().map(|s| s.eq_ignore_ascii_case(&ext)).unwrap_or(false)) {
                            let folder = c.get("folder").and_then(|f| f.as_str()).unwrap_or("Other");
                            let nm = c.get("name").and_then(|n| n.as_str()).unwrap_or("Other");
                            return (nm.to_string(), resolve_folder(folder));
                        }
                    }
                }
            }
            for c in list {
                let empty = c.get("exts").and_then(|e| e.as_array()).map(|a| a.is_empty()).unwrap_or(true);
                if empty {
                    let folder = c.get("folder").and_then(|f| f.as_str()).unwrap_or("Other");
                    let nm = c.get("name").and_then(|n| n.as_str()).unwrap_or("Other");
                    return (nm.to_string(), resolve_folder(folder));
                }
            }
        }
    }
    ("Other".to_string(), download_dir().join("Other"))
}

#[tauri::command]
fn get_categories() -> Value {
    let cats = categories().lock().map(|c| c.clone()).unwrap_or_else(|_| default_categories());
    if let Value::Array(arr) = cats {
        let out: Vec<Value> = arr.into_iter().map(|mut c| {
            let folder = c.get("folder").and_then(|f| f.as_str()).unwrap_or("").to_string();
            if let Value::Object(m) = &mut c {
                m.insert("folderAbs".into(), json!(resolve_folder(&folder).display().to_string()));
            }
            c
        }).collect();
        return Value::Array(out);
    }
    default_categories()
}

#[tauri::command]
fn set_categories(data: Value) -> Result<(), String> {
    if let Ok(mut c) = categories().lock() {
        if let Value::Array(arr) = &data {
            // Keep only name/exts/folder; folderAbs is derived on read.
            let cleaned: Vec<Value> = arr.iter().map(|c| json!({
                "name": c.get("name").and_then(|n| n.as_str()).unwrap_or("").to_string(),
                "exts": c.get("exts").cloned().unwrap_or(json!([])),
                "folder": c.get("folder").and_then(|f| f.as_str()).unwrap_or("").to_string(),
            })).collect();
            *c = Value::Array(cleaned);
        } else {
            *c = data;
        }
    }
    save_categories();
    Ok(())
}

fn queues() -> &'static Mutex<Value> {
    QUEUES.get_or_init(|| Mutex::new(default_queues()))
}

fn default_queues() -> Value {
    json!([{ "id": "main", "name": "Main", "maxActive": 0, "speed": 0, "running": true, "schedule": null }])
}

fn queues_file() -> std::path::PathBuf {
    state_dir().join(".downman-queues.json")
}

fn load_queues() {
    if let Ok(s) = std::fs::read_to_string(queues_file()) {
        if let Ok(v @ Value::Array(_)) = serde_json::from_str::<Value>(&s) {
            if let Ok(mut q) = queues().lock() {
                *q = v;
            }
        }
    }
}

fn save_queues() {
    if let Ok(q) = queues().lock() {
        if let Ok(s) = serde_json::to_string_pretty(&*q) {
            let _ = std::fs::write(queues_file(), s);
        }
    }
}

fn qmember() -> &'static Mutex<Value> {
    QMEMBER.get_or_init(|| Mutex::new(json!({})))
}

fn qmember_file() -> std::path::PathBuf {
    state_dir().join(".downman-queue-map.json")
}

fn load_qmember() {
    if let Ok(s) = std::fs::read_to_string(qmember_file()) {
        if let Ok(v @ Value::Object(_)) = serde_json::from_str::<Value>(&s) {
            if let Ok(mut m) = qmember().lock() {
                *m = v;
            }
        }
    }
}

fn save_qmember() {
    if let Ok(m) = qmember().lock() {
        if let Ok(s) = serde_json::to_string_pretty(&*m) {
            let _ = std::fs::write(qmember_file(), s);
        }
    }
}

fn qhadactive() -> &'static Mutex<std::collections::HashMap<String, bool>> {
    QHADACTIVE.get_or_init(|| Mutex::new(std::collections::HashMap::new()))
}

fn url_of_task(t: &Value) -> String {
    t.get("files")
        .and_then(|f| f.get(0))
        .and_then(|f| f.get("uris"))
        .and_then(|u| u.get(0))
        .and_then(|u| u.get("uri"))
        .and_then(|u| u.as_str())
        .unwrap_or("")
        .to_string()
}

#[tauri::command]
fn get_queues() -> Value {
    queues().lock().map(|q| q.clone()).unwrap_or_else(|_| default_queues())
}

#[tauri::command]
fn set_queues(data: Value) -> Result<(), String> {
    if let Value::Array(_) = &data {
        if let Ok(mut q) = queues().lock() {
            *q = data;
        }
        save_queues();
        Ok(())
    } else {
        Err("expected array".into())
    }
}

#[tauri::command]
fn assign_queue(url: String, queue: String) -> Result<(), String> {
    if url.is_empty() {
        return Err("no url".into());
    }
    if let Ok(mut m) = qmember().lock() {
        if let Value::Object(map) = &mut *m {
            map.insert(url, json!(queue));
        }
    }
    save_qmember();
    Ok(())
}

#[tauri::command]
async fn set_queue_running(id: String, running: bool) -> Result<(), String> {
    if let Ok(mut q) = queues().lock() {
        if let Value::Array(arr) = &mut *q {
            for item in arr.iter_mut() {
                if item.get("id").and_then(|i| i.as_str()) == Some(id.as_str()) {
                    item["running"] = json!(running);
                }
            }
        }
    }
    save_queues();
    gate_queues().await;
    Ok(())
}

/// Apply each queue's rules: pause a stopped queue's members, cap concurrency and
/// speed for a running one, and fire the on-complete action when it drains.
async fn gate_queues() {
    let c = match ARIA2.get() {
        Some(c) => c,
        None => return,
    };
    let qs = queues().lock().map(|q| q.clone()).unwrap_or_else(|_| default_queues());
    let qarr = match qs.as_array() {
        Some(a) if !a.is_empty() => a.clone(),
        _ => return,
    };
    // Fast path: only the default, unlimited, running Main queue → nothing to do.
    if qarr.len() == 1 {
        let q = &qarr[0];
        let is_default = q.get("id").and_then(|i| i.as_str()) == Some("main")
            && q.get("maxActive").and_then(|m| m.as_i64()).unwrap_or(0) == 0
            && q.get("speed").and_then(|s| s.as_i64()).unwrap_or(0) == 0
            && q.get("running").and_then(|r| r.as_bool()).unwrap_or(true)
            && q.get("schedule").map(|s| s.is_null()).unwrap_or(true);
        if is_default {
            return;
        }
    }
    let map = qmember().lock().map(|m| m.clone()).unwrap_or(json!({}));
    let queue_of = |url: &str| -> String {
        map.get(url).and_then(|v| v.as_str()).unwrap_or("main").to_string()
    };
    let active = c.tell_active().await.unwrap_or(json!([]));
    let waiting = c.tell_waiting().await.unwrap_or(json!([]));
    let mut tasks: Vec<(String, String, String)> = Vec::new();
    for arr in [&active, &waiting] {
        if let Some(a) = arr.as_array() {
            for t in a {
                let gid = t.get("gid").and_then(|g| g.as_str()).unwrap_or("").to_string();
                if gid.is_empty() {
                    continue;
                }
                let status = t.get("status").and_then(|s| s.as_str()).unwrap_or("").to_string();
                tasks.push((gid, queue_of(&url_of_task(t)), status));
            }
        }
    }
    for q in &qarr {
        let qid = match q.get("id").and_then(|i| i.as_str()) {
            Some(s) if !s.is_empty() => s,
            _ => continue,
        };
        let running = q.get("running").and_then(|r| r.as_bool()).unwrap_or(true);
        let max_active = q.get("maxActive").and_then(|m| m.as_i64()).unwrap_or(0);
        let speed = q.get("speed").and_then(|s| s.as_i64()).unwrap_or(0);
        let on_done = q.get("schedule").and_then(|s| s.get("onDone")).and_then(|d| d.as_str()).unwrap_or("none").to_string();
        let members: Vec<(String, String)> = tasks.iter().filter(|(_, m, _)| m == qid).map(|(g, _, s)| (g.clone(), s.clone())).collect();

        if running && on_done != "none" {
            let live = members.iter().filter(|(_, s)| s == "active" || s == "waiting").count();
            let mut fire = false;
            if let Ok(mut had) = qhadactive().lock() {
                let prev = *had.get(qid).unwrap_or(&false);
                if live > 0 {
                    had.insert(qid.to_string(), true);
                } else if prev {
                    had.insert(qid.to_string(), false);
                    fire = true;
                }
            }
            if fire {
                run_on_done(&on_done);
                continue;
            }
        }

        if running && max_active == 0 {
            if speed > 0 {
                for (gid, status) in &members {
                    if status == "active" {
                        let _ = c.change_option(gid, json!({ "max-download-limit": format!("{}K", speed) })).await;
                    }
                }
            }
            continue;
        }
        if !running {
            for (gid, status) in &members {
                if status == "active" || status == "waiting" {
                    let _ = c.pause(gid).await;
                }
            }
            continue;
        }
        // Running with a concurrency cap.
        let n_active = members.iter().filter(|(_, s)| s == "active").count() as i64;
        if n_active > max_active {
            for (gid, _) in members.iter().filter(|(_, s)| s == "active").skip(max_active as usize) {
                let _ = c.pause(gid).await;
            }
        } else if n_active < max_active {
            let need = (max_active - n_active) as usize;
            for (gid, _) in members.iter().filter(|(_, s)| s == "paused").take(need) {
                let _ = c.unpause(gid).await;
            }
        }
        if speed > 0 {
            for (gid, status) in &members {
                if status == "active" {
                    let _ = c.change_option(gid, json!({ "max-download-limit": format!("{}K", speed) })).await;
                }
            }
        }
    }
}

fn run_on_done(action: &str) {
    match action {
        "shutdown" => {
            notify("Queue finished", "All downloads done — powering off.");
            std::thread::sleep(Duration::from_secs(3));
            let _ = Command::new("systemctl").arg("poweroff").status();
        }
        "sleep" => {
            notify("Queue finished", "All downloads done — suspending.");
            let _ = Command::new("systemctl").arg("suspend").status();
        }
        "quit" => {
            notify("Queue finished", "All downloads done — closing DownMan.");
            if let Some(app) = APP.get() {
                app.exit(0);
            }
        }
        _ => {}
    }
}

fn record_history(rec: Value) {
    if let Ok(mut h) = history().lock() {
        let gid = rec.get("gid").and_then(|g| g.as_str()).unwrap_or("").to_string();
        if !gid.is_empty() && !h.iter().any(|x| x.get("gid").and_then(|g| g.as_str()) == Some(gid.as_str())) {
            h.insert(0, rec);
            let limit = HISTORY_LIMIT.load(Ordering::Relaxed);
            if limit > 0 && h.len() > limit {
                h.truncate(limit);
            }
        }
    }
    save_history();
}

fn update_history<F: FnOnce(&mut Value)>(gid: &str, f: F) {
    if let Ok(mut h) = history().lock() {
        if let Some(j) = h.iter_mut().find(|x| x.get("gid").and_then(|g| g.as_str()) == Some(gid)) {
            f(j);
        }
    }
    save_history();
}

/// Remove a gid from history; returns its file path if it was present.
fn remove_from_history(gid: &str) -> Option<String> {
    let mut path = None;
    if let Ok(mut h) = history().lock() {
        if let Some(pos) = h.iter().position(|x| x.get("gid").and_then(|g| g.as_str()) == Some(gid)) {
            path = h[pos].get("files").and_then(|f| f.get(0)).and_then(|f| f.get("path")).and_then(|p| p.as_str()).map(String::from);
            h.remove(pos);
        }
    }
    save_history();
    path
}

/// Remove a gid from history, returning its full record (all files + torrent
/// metadata) if it was present.
fn take_history_value(gid: &str) -> Option<Value> {
    let mut out = None;
    if let Ok(mut h) = history().lock() {
        if let Some(pos) = h.iter().position(|x| x.get("gid").and_then(|g| g.as_str()) == Some(gid)) {
            out = Some(h.remove(pos));
        }
    }
    save_history();
    out
}

fn history_limit_file() -> std::path::PathBuf {
    state_dir().join(".downman-histlimit")
}

fn load_history_limit() {
    if let Ok(s) = std::fs::read_to_string(history_limit_file()) {
        if let Ok(n) = s.trim().parse::<usize>() {
            HISTORY_LIMIT.store(n, Ordering::Relaxed);
        }
    }
}

/// Set how many completed downloads to keep in history (0 = unlimited).
#[tauri::command]
fn set_history_limit(limit: usize) -> Result<(), String> {
    HISTORY_LIMIT.store(limit, Ordering::Relaxed);
    let _ = std::fs::write(history_limit_file(), limit.to_string());
    if limit > 0 {
        if let Ok(mut h) = history().lock() {
            if h.len() > limit {
                h.truncate(limit);
            }
        }
    }
    save_history();
    Ok(())
}

fn csv_field(s: &str) -> String {
    if s.contains(',') || s.contains('"') || s.contains('\n') {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

/// Import a list of URLs, adding each as a new download. Returns counts.
#[tauri::command]
async fn import_urls(urls: Vec<String>, options: Value) -> Result<Value, String> {
    let mut added = 0u32;
    let mut skipped = 0u32;
    let mut failed = 0u32;
    // Check against current download URLs to skip obvious duplicates.
    let existing: std::collections::HashSet<String> = {
        let c = client()?;
        let active = c.tell_active().await.unwrap_or(json!([]));
        let waiting = c.tell_waiting().await.unwrap_or(json!([]));
        let hist = history().lock().map(|h| Value::Array(h.clone())).unwrap_or(json!([]));
        [active, waiting, hist].iter().flat_map(|arr| {
            arr.as_array().cloned().unwrap_or_default().into_iter().filter_map(|t| {
                t.get("files")?.get(0)?.get("uris")?.get(0)?.get("uri")?.as_str().map(|s| s.to_string())
            })
        }).collect()
    };
    for url in urls {
        let url = url.trim().to_string();
        if url.is_empty() || (!url.starts_with("http") && !url.starts_with("magnet:")) {
            skipped += 1;
            continue;
        }
        if existing.contains(&url) {
            skipped += 1;
            continue;
        }
        let mut opts = options.as_object().cloned().unwrap_or_default();
        let user_cs = opts.remove("dmChecksum").and_then(|v| v.as_str().map(|s| s.to_string())).unwrap_or_default();
        match client()?.add_uri(vec![url.clone()], Value::Object(opts)).await {
            Ok(gid) => {
                if !user_cs.is_empty() {
                    if let Ok(mut m) = dl_meta().lock() {
                        let e = m.entry(gid).or_default();
                        e.checksum = user_cs;
                        e.verify = "pending".into();
                    }
                    save_dl_meta();
                }
                added += 1;
            }
            Err(_) => { failed += 1; }
        }
    }
    Ok(json!({ "added": added, "skipped": skipped, "failed": failed }))
}

/// Write the completed-download history to `path` as CSV or JSON.
#[tauri::command]
fn export_history(path: String, format: String) -> Result<(), String> {
    let hist = history().lock().map(|h| h.clone()).unwrap_or_default();
    let content = if format == "csv" {
        let mut out = String::from("name,status,size_bytes,completed_at_ms,url\n");
        for t in &hist {
            let name = task_name(t);
            let status = t.get("status").and_then(|s| s.as_str()).unwrap_or("");
            let size = t.get("totalLength").and_then(|s| s.as_str()).unwrap_or("0");
            let ts = t.get("completedAt").and_then(|c| c.as_u64()).map(|n| n.to_string()).unwrap_or_default();
            let url = url_of_task(t);
            out.push_str(&format!(
                "{},{},{},{},{}\n",
                csv_field(&name), csv_field(status), csv_field(size), csv_field(&ts), csv_field(&url)
            ));
        }
        out
    } else {
        serde_json::to_string_pretty(&Value::Array(hist)).map_err(|e| e.to_string())?
    };
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

// ---- Run an action when a download finishes (none | reveal | open | run) ----
static ON_COMPLETE: OnceCell<Mutex<(String, String)>> = OnceCell::new();
fn on_complete() -> &'static Mutex<(String, String)> {
    ON_COMPLETE.get_or_init(|| Mutex::new(("none".to_string(), String::new())))
}
fn on_complete_file() -> std::path::PathBuf {
    state_dir().join(".downman-oncomplete.json")
}
fn load_on_complete() {
    if let Ok(s) = std::fs::read_to_string(on_complete_file()) {
        if let Ok(v) = serde_json::from_str::<Value>(&s) {
            let action = v.get("action").and_then(|a| a.as_str()).unwrap_or("none").to_string();
            let command = v.get("command").and_then(|c| c.as_str()).unwrap_or("").to_string();
            if let Ok(mut g) = on_complete().lock() {
                *g = (action, command);
            }
        }
    }
}

#[tauri::command]
fn set_on_complete(action: String, command: String) -> Result<(), String> {
    if let Ok(mut g) = on_complete().lock() {
        *g = (action.clone(), command.clone());
    }
    let _ = std::fs::write(on_complete_file(), json!({ "action": action, "command": command }).to_string());
    Ok(())
}

static DL_ON_COMPLETE: OnceCell<Mutex<HashMap<String, (String, String)>>> = OnceCell::new();
fn dl_on_complete() -> &'static Mutex<HashMap<String, (String, String)>> {
    DL_ON_COMPLETE.get_or_init(|| Mutex::new(HashMap::new()))
}

// ---- Per-download persistent metadata (checksum + on-complete) ----
// Stored in .downman-dlmeta.json as { gid: { "checksum": "sha256=...",
// "verify": "ok"|"fail"|"pending"|"", "oncomplete_action": "...", "oncomplete_cmd": "..." } }

#[derive(serde::Serialize, serde::Deserialize, Clone, Default)]
struct DlMeta {
    #[serde(default)] checksum: String,
    #[serde(default)] verify: String,      // ""=unchecked, "pending", "ok", "fail"
    #[serde(default)] oncomplete_action: String,
    #[serde(default)] oncomplete_cmd: String,
}

static DL_META: OnceCell<Mutex<HashMap<String, DlMeta>>> = OnceCell::new();
fn dl_meta() -> &'static Mutex<HashMap<String, DlMeta>> {
    DL_META.get_or_init(|| Mutex::new(HashMap::new()))
}
fn dl_meta_file() -> std::path::PathBuf { state_dir().join(".downman-dlmeta.json") }
fn save_dl_meta() {
    if let Ok(m) = dl_meta().lock() {
        if let Ok(s) = serde_json::to_string(&*m) { let _ = std::fs::write(dl_meta_file(), s); }
    }
}
fn load_dl_meta() {
    if let Ok(s) = std::fs::read_to_string(dl_meta_file()) {
        if let Ok(v) = serde_json::from_str::<HashMap<String, DlMeta>>(&s) {
            if let Ok(mut m) = dl_meta().lock() { *m = v; }
        }
    }
}

#[tauri::command]
fn set_dl_meta(gid: String, checksum: Option<String>, oncomplete_action: Option<String>, oncomplete_cmd: Option<String>) -> Result<(), String> {
    if let Ok(mut m) = dl_meta().lock() {
        let e = m.entry(gid).or_default();
        if let Some(c) = checksum { e.checksum = c; if !e.checksum.is_empty() && e.verify == "ok" { e.verify = "pending".into(); } }
        if let Some(a) = oncomplete_action { e.oncomplete_action = a; }
        if let Some(c) = oncomplete_cmd { e.oncomplete_cmd = c; }
    }
    save_dl_meta();
    Ok(())
}

#[tauri::command]
fn get_dl_meta(gid: String) -> DlMeta {
    dl_meta().lock().ok().and_then(|m| m.get(&gid).cloned()).unwrap_or_default()
}

/// Set a one-shot on-complete action for a single download (overrides the global default).
#[tauri::command]
fn set_download_on_complete(gid: String, action: String, command: String) -> Result<(), String> {
    // Keep the old in-memory map for backward compat, AND persist in DL_META.
    if let Ok(mut m) = dl_on_complete().lock() {
        if action.is_empty() || action == "default" { m.remove(&gid); }
        else { m.insert(gid.clone(), (action.clone(), command.clone())); }
    }
    if let Ok(mut m) = dl_meta().lock() {
        let e = m.entry(gid).or_default();
        e.oncomplete_action = if action == "default" { String::new() } else { action };
        e.oncomplete_cmd = command;
    }
    save_dl_meta();
    Ok(())
}

/// Core checksum logic — used both by the Tauri command and auto-verify on completion.
fn verify_checksum_inner(path: &str, expected: &str) -> Result<bool, String> {
    let exp = expected.trim().to_lowercase();
    let (algo, hash) = match exp.split_once('=') {
        Some((a, h)) => (Some(a.replace('-', "")), h.trim().to_string()),
        None => (None, exp),
    };
    let tool = match (algo.as_deref(), hash.len()) {
        (Some("md5"), _) | (None, 32) => "md5sum",
        (Some("sha1"), _) | (None, 40) => "sha1sum",
        (Some("sha256"), _) | (None, 64) => "sha256sum",
        (Some("sha512"), _) | (None, 128) => "sha512sum",
        _ => return Err("Unrecognized checksum (expect md5/sha1/sha256/sha512, or an algo= prefix)".into()),
    };
    let out = Command::new(tool).arg(path).output().map_err(|e| e.to_string())?;
    if !out.status.success() { return Err("Could not read the file to hash it.".into()); }
    let computed = String::from_utf8_lossy(&out.stdout).split_whitespace().next().unwrap_or("").to_lowercase();
    Ok(!hash.is_empty() && computed == hash)
}

/// Verify a file against an expected checksum (auto-detects md5/sha1/sha256/sha512
/// by length or an "algo=" prefix) using the system *sum tools.
#[tauri::command]
fn verify_checksum(path: String, expected: String) -> Result<bool, String> {
    verify_checksum_inner(&path, &expected)
}

fn shell_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

/// Fire the on-complete action for a finished file — a per-download override if
/// one was set (in DL_META or the legacy in-memory map), otherwise the global default.
/// Re-download bookkeeping: a re-download writes to a temp sibling and only
/// replaces the original after it validates, so a failed/expired link never
/// destroys the existing file.
static REDL_TARGET: OnceCell<Mutex<HashMap<String, (String, String)>>> = OnceCell::new(); // gid -> (final_path, expected_ext)
fn redl_target() -> &'static Mutex<HashMap<String, (String, String)>> { REDL_TARGET.get_or_init(|| Mutex::new(HashMap::new())) }

/// True if the file begins like an HTML document — an expired/auth-gated link
/// (e.g. a Gmail attachment) often returns a login/error web page, not the file.
fn file_looks_html(path: &str) -> bool {
    use std::io::Read;
    let mut f = match std::fs::File::open(path) { Ok(f) => f, Err(_) => return false };
    let mut buf = [0u8; 512];
    let n = f.read(&mut buf).unwrap_or(0);
    let head = String::from_utf8_lossy(&buf[..n]).trim_start().to_lowercase();
    head.starts_with("<!doctype html") || head.starts_with("<html") || head.starts_with("<head")
}

/// Finish a re-download: validate the freshly-downloaded temp file, then either
/// replace the original (success) or discard the temp and flag failure — the
/// original is never touched until we have a good file.
fn finish_redownload(temp_path: &str, final_path: &str, expected_ext: &str) {
    let name = std::path::Path::new(final_path).file_name().and_then(|s| s.to_str()).unwrap_or("file").to_string();
    let bad_html = file_looks_html(temp_path) && !expected_ext.is_empty() && expected_ext != "html" && expected_ext != "htm";
    if bad_html {
        let _ = std::fs::remove_file(temp_path);
        let _ = std::fs::remove_file(format!("{temp_path}.aria2"));
        notify(&format!("✗ Re-download failed: {name}"), "The link returned a web page, not the file — it may have expired or need sign-in.");
        return;
    }
    // Good file → replace the original (copy+remove fallback across filesystems).
    let moved = std::fs::rename(temp_path, final_path).is_ok()
        || (std::fs::copy(temp_path, final_path).is_ok() && { let _ = std::fs::remove_file(temp_path); true });
    if moved {
        notify(&format!("✓ Re-downloaded: {name}"), final_path);
    } else {
        notify(&format!("✗ Re-download failed: {name}"), "Could not replace the original file.");
    }
}

fn run_on_complete(gid: &str, path: &str, name: &str) {
    if path.is_empty() || !std::path::Path::new(path).is_absolute() {
        return;
    }
    // Auto-verify checksum from persisted metadata, update result, notify.
    let expected_cs = dl_meta().lock().ok().and_then(|m| {
        let cs = m.get(gid)?.checksum.clone();
        if cs.is_empty() { None } else { Some(cs) }
    });
    if let Some(exp) = expected_cs {
        // Run synchronously in the watcher thread — file is already fully written.
        let ok = verify_checksum_inner(path, &exp).unwrap_or(false);
        if let Ok(mut m) = dl_meta().lock() {
            if let Some(e) = m.get_mut(gid) {
                e.verify = if ok { "ok".into() } else { "fail".into() };
            }
        }
        save_dl_meta();
        if ok {
            notify(&format!("✓ Checksum verified: {name}"), "The file is intact.");
        } else {
            notify(&format!("✗ Checksum mismatch: {name}"), "The file may be corrupt.");
        }
    }
    // Resolve action: persisted DL_META → in-memory DL_ON_COMPLETE → global default.
    let per_meta = dl_meta().lock().ok().and_then(|mut m| {
        let e = m.get_mut(gid)?;
        if e.oncomplete_action.is_empty() { return None; }
        Some((std::mem::take(&mut e.oncomplete_action), std::mem::take(&mut e.oncomplete_cmd)))
    });
    let per_mem = dl_on_complete().lock().ok().and_then(|mut m| m.remove(gid));
    let (action, command) = per_meta.or(per_mem)
        .unwrap_or_else(|| on_complete().lock().map(|g| g.clone()).unwrap_or(("none".to_string(), String::new())));
    match action.as_str() {
        "reveal" => {
            if let Some(app) = APP.get() {
                use tauri_plugin_opener::OpenerExt;
                let _ = app.opener().reveal_item_in_dir(path);
            }
        }
        "open" => {
            if let Some(app) = APP.get() {
                use tauri_plugin_opener::OpenerExt;
                let _ = app.opener().open_path(path.to_string(), None::<&str>);
            }
        }
        "run" => {
            let cmd = command.trim();
            if cmd.is_empty() {
                return;
            }
            let full = cmd.replace("{path}", &shell_quote(path)).replace("{name}", &shell_quote(name));
            let _ = Command::new("sh").arg("-c").arg(full).spawn();
        }
        _ => {}
    }
}

fn history_path(gid: &str) -> Option<String> {
    history()
        .lock()
        .ok()
        .and_then(|h| h.iter().find(|x| x.get("gid").and_then(|g| g.as_str()) == Some(gid))
            .and_then(|x| x.get("files").and_then(|f| f.get(0)).and_then(|f| f.get("path")).and_then(|p| p.as_str()).map(String::from)))
}

/// Move a finished file into its category subfolder; returns the resulting path.
fn reserved() -> &'static Mutex<HashSet<String>> {
    RESERVED.get_or_init(|| Mutex::new(HashSet::new()))
}

/// Choose a save name in `dir` that collides with neither an existing file nor an
/// in-flight download, then reserve it. Returns just the file name (for aria2 `out`).
/// This is what stops batch downloads with the same name from overwriting each other.
fn unique_out(dir: &std::path::Path, filename: &str) -> String {
    std::fs::create_dir_all(dir).ok();
    let fallback = "download".to_string();
    let filename = if filename.trim().is_empty() { fallback.as_str() } else { filename };
    let (stem, ext) = match filename.rfind('.') {
        Some(i) if i > 0 => (filename[..i].to_string(), filename[i..].to_string()),
        _ => (filename.to_string(), String::new()),
    };
    let taken = |name: &str| -> bool {
        let full = dir.join(name).display().to_string();
        std::path::Path::new(&full).exists()
            || reserved().lock().map(|s| s.contains(&full)).unwrap_or(false)
    };
    let mut name = filename.to_string();
    let mut n = 1;
    while taken(&name) && n < 10000 {
        name = format!("{stem} ({n}){ext}");
        n += 1;
    }
    if let Ok(mut s) = reserved().lock() {
        s.insert(dir.join(&name).display().to_string());
    }
    name
}

fn unreserve(path: &str) {
    if let Ok(mut s) = reserved().lock() {
        s.remove(path);
    }
}

/// Move a finished file into its category subfolder (unique name); returns the path.
fn organize_path(path: &str) -> String {
    let src = std::path::PathBuf::from(path);
    let name = match src.file_name().and_then(|n| n.to_str()) {
        Some(n) => n.to_string(),
        None => return path.to_string(),
    };
    if !src.exists() {
        return path.to_string();
    }
    let dest_dir = category_of(&name).1;
    if src.parent() == Some(dest_dir.as_path()) {
        return path.to_string(); // already in its category folder
    }
    let out = unique_out(&dest_dir, &name);
    let dest = dest_dir.join(&out);
    if std::fs::rename(&src, &dest).is_err() {
        if std::fs::copy(&src, &dest).is_ok() {
            std::fs::remove_file(&src).ok();
        } else {
            unreserve(&dest.display().to_string());
            return path.to_string();
        }
    }
    dest.display().to_string()
}


fn pending() -> &'static Mutex<Vec<Value>> {
    PENDING.get_or_init(|| Mutex::new(Vec::new()))
}

fn update_pending<F: FnOnce(&mut Value)>(id: &str, f: F) {
    if let Ok(mut jobs) = pending().lock() {
        if let Some(j) = jobs.iter_mut().find(|j| j.get("id").and_then(|g| g.as_str()) == Some(id)) {
            f(j);
        }
    }
}

fn focus_main() {
    if let Some(app) = APP.get() {
        if let Some(w) = app.get_webview_window("main") {
            let was_hidden = !w.is_visible().unwrap_or(true);
            let _ = w.show();
            let _ = w.unminimize();
            let _ = w.set_focus();
            // GNOME/Wayland blocks programmatic focus-stealing, so also flag the
            // taskbar entry to demand attention when the window can't be raised.
            let _ = w.request_user_attention(Some(tauri::UserAttentionType::Critical));
            // Showing a previously-hidden window leaves its title-bar buttons inert
            // on GNOME/Wayland until the surface is reconfigured — re-arm them.
            if was_hidden {
                rearm_window_controls();
            }
        }
    }
}

/// Work around a GNOME/Wayland client-side-decoration quirk: a window that was
/// hidden and re-shown won't receive min/max/close button clicks until its surface
/// is reconfigured. Nudge the size by a couple pixels (once the show has been
/// realized) to re-register the decoration input regions.
fn rearm_window_controls() {
    std::thread::spawn(|| {
        std::thread::sleep(Duration::from_millis(80));
        let Some(app) = APP.get() else { return };
        let Some(w) = app.get_webview_window("main") else { return };
        if !w.is_visible().unwrap_or(false) || w.is_maximized().unwrap_or(false) {
            return;
        }
        if let Ok(sz) = w.inner_size() {
            let nudged = tauri::PhysicalSize::new(sz.width.saturating_sub(2).max(1), sz.height);
            let _ = w.set_size(nudged);
            std::thread::sleep(Duration::from_millis(40));
            let _ = w.set_size(sz);
        }
    });
}

static BG_NOTIFIED: AtomicBool = AtomicBool::new(false);
/// Tell the user (once per run) that closing the window keeps DownMan running.
fn notify_background_once() {
    if !BG_NOTIFIED.swap(true, Ordering::Relaxed) {
        notify(
            "DownMan is still running",
            "Downloads continue in the background. Reopen from the tray or by launching DownMan again; quit from the tray or Settings.",
        );
    }
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    app.exit(0);
}

fn hex(c: u8) -> Option<u8> {
    match c {
        b'0'..=b'9' => Some(c - b'0'),
        b'a'..=b'f' => Some(c - b'a' + 10),
        b'A'..=b'F' => Some(c - b'A' + 10),
        _ => None,
    }
}

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let (Some(h), Some(l)) = (hex(b[i + 1]), hex(b[i + 2])) {
                out.push(h * 16 + l);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Derive a file name from a URL's last path segment.
fn url_filename(url: &str) -> String {
    let no_q = url.split(['?', '#']).next().unwrap_or(url);
    let last = no_q.trim_end_matches('/').rsplit('/').next().unwrap_or("");
    let decoded = percent_decode(last);
    if decoded.trim().is_empty() { "download".into() } else { decoded }
}

/// Pull a filename out of a Content-Disposition header value.
fn cd_filename(cd: &str) -> Option<String> {
    // filename*=UTF-8''name  (RFC 5987) takes precedence over filename="name".
    if let Some(p) = cd.find("filename*=") {
        let v = &cd[p + 10..];
        let v = v.split(';').next().unwrap_or(v).trim();
        let v = v.splitn(2, "''").last().unwrap_or(v);
        let decoded = percent_decode(v.trim_matches('"'));
        if !decoded.trim().is_empty() {
            return Some(decoded);
        }
    }
    if let Some(p) = cd.find("filename=") {
        let v = &cd[p + 9..];
        let v = v.split(';').next().unwrap_or(v).trim().trim_matches('"');
        if !v.trim().is_empty() {
            return Some(percent_decode(v));
        }
    }
    None
}

/// HEAD the URL to learn the real filename and size for the confirmation dialog.
async fn probe_url(url: String, referer: Option<String>) -> (Option<String>, u64) {
    let client = match reqwest::Client::builder().timeout(Duration::from_secs(8)).build() {
        Ok(c) => c,
        Err(_) => return (None, 0),
    };
    let mut req = client.head(&url);
    if let Some(r) = referer.filter(|r| !r.is_empty()) {
        req = req.header(reqwest::header::REFERER, r);
    }
    let mut filename = None;
    let mut size = 0u64;
    if let Ok(resp) = req.send().await {
        if let Some(cl) = resp.headers().get(reqwest::header::CONTENT_LENGTH) {
            size = cl.to_str().ok().and_then(|s| s.parse().ok()).unwrap_or(0);
        }
        if let Some(cd) = resp.headers().get(reqwest::header::CONTENT_DISPOSITION) {
            if let Ok(s) = cd.to_str() {
                filename = cd_filename(s);
            }
        }
    }
    (filename, size)
}

/// HEAD the URL and report whether the server serves media/binary content. Used as a
/// content-type safety net for extensionless URLs (no file suffix to match on).
async fn url_is_media(url: &str, referer: Option<&str>) -> bool {
    let client = match reqwest::Client::builder().timeout(Duration::from_secs(6)).build() {
        Ok(c) => c,
        Err(_) => return false,
    };
    let mut req = client.head(url);
    if let Some(r) = referer.filter(|r| !r.is_empty()) {
        req = req.header(reqwest::header::REFERER, r);
    }
    if let Ok(resp) = req.send().await {
        let ct = resp.headers().get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok()).unwrap_or("").to_lowercase();
        return ct.starts_with("image/") || ct.starts_with("video/") || ct.starts_with("audio/")
            || ct.starts_with("application/octet-stream");
    }
    false
}

/// Which engine handles a URL: direct files → aria2 (fast, resumable, correct
/// naming); pages/streams → yt-dlp (1800+ extractors + muxing).
#[derive(PartialEq, Clone, Copy)]
enum Route { Aria2, Ytdlp }

/// A routing decision plus any content-type learned while probing (used to give an
/// extensionless direct file a proper name).
struct Routing { route: Route, ctype: Option<String> }
impl Routing {
    fn just(route: Route) -> Self { Routing { route, ctype: None } }
}

fn is_torrent_like(url: &str) -> bool {
    url.starts_with("magnet:")
        || url.split(['?', '#']).next().unwrap_or("").to_lowercase().ends_with(".torrent")
}

fn is_stream_manifest(url: &str) -> bool {
    let p = url.split(['?', '#']).next().unwrap_or(url).to_lowercase();
    p.ends_with(".m3u8") || p.ends_with(".mpd") || p.ends_with(".f4m") || p.ends_with(".ism")
}

/// Hosts we know are yt-dlp's domain — extract the page directly, skip the probe.
fn is_known_ytdlp_host(url: &str) -> bool {
    let host = host_of(url).to_lowercase();
    const SITES: &[&str] = &[
        "youtube.com", "youtu.be", "vimeo.com", "dailymotion.com", "tiktok.com",
        "instagram.com", "twitter.com", "x.com", "facebook.com", "fb.watch",
        "twitch.tv", "soundcloud.com", "bandcamp.com", "reddit.com", "streamable.com",
        "bilibili.com", "nicovideo.jp", "ok.ru", "rutube.ru", "vk.com", "odysee.com",
    ];
    SITES.iter().any(|s| host == *s || host.ends_with(&format!(".{s}")))
}

/// Map a media content-type to a file extension (to name an extensionless file).
fn ext_for_ctype(ct: &str) -> Option<&'static str> {
    Some(match ct.split(';').next().unwrap_or("").trim() {
        "image/png" => "png", "image/jpeg" => "jpg", "image/gif" => "gif",
        "image/webp" => "webp", "image/avif" => "avif", "image/bmp" => "bmp",
        "image/svg+xml" => "svg", "image/tiff" => "tiff",
        "video/mp4" => "mp4", "video/webm" => "webm", "video/x-matroska" => "mkv",
        "video/quicktime" => "mov", "video/mpeg" => "mpeg", "video/x-msvideo" => "avi",
        "video/x-flv" => "flv", "video/3gpp" => "3gp",
        "audio/mpeg" => "mp3", "audio/mp4" => "m4a", "audio/aac" => "aac",
        "audio/ogg" => "ogg", "audio/wav" | "audio/x-wav" => "wav",
        "audio/flac" | "audio/x-flac" => "flac", "audio/opus" => "opus", "audio/webm" => "weba",
        "application/pdf" => "pdf", "application/zip" => "zip",
        _ => return None,
    })
}

/// The URL's filename, giving an extensionless direct file the extension implied by
/// its content-type (so a CDN image saves as name.png, not a bare name).
fn filename_with_ext(url: &str, ctype: Option<&str>) -> String {
    let name = url_filename(url);
    if std::path::Path::new(&name).extension().is_none() {
        if let Some(ext) = ctype.and_then(ext_for_ctype) {
            return format!("{name}.{ext}");
        }
    }
    name
}

/// HEAD (or a ranged GET when HEAD is refused) the URL and classify it by
/// content-type. Returns (engine, content-type); None when there's nothing to go on.
async fn head_classify(url: &str, referer: Option<&str>) -> Option<(Route, String)> {
    let client = reqwest::Client::builder().timeout(Duration::from_secs(8)).build().ok()?;
    let mut hb = client.head(url);
    if let Some(rf) = referer.filter(|r| !r.is_empty()) { hb = hb.header(reqwest::header::REFERER, rf); }
    let mut resp = hb.send().await.ok()?;
    if matches!(resp.status().as_u16(), 403 | 405 | 501) {
        // Server refuses HEAD — peek with a 1-byte ranged GET.
        let mut gb = client.get(url).header(reqwest::header::RANGE, "bytes=0-0");
        if let Some(rf) = referer.filter(|r| !r.is_empty()) { gb = gb.header(reqwest::header::REFERER, rf); }
        if let Ok(r) = gb.send().await { resp = r; }
    }
    let ct = resp.headers().get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok()).unwrap_or("").to_lowercase();
    // An explicit attachment is a download whatever the type says.
    let attach = resp.headers().get(reqwest::header::CONTENT_DISPOSITION)
        .and_then(|v| v.to_str().ok()).map(|s| s.to_lowercase().contains("attachment")).unwrap_or(false);
    if attach { return Some((Route::Aria2, ct)); }
    if ct.contains("mpegurl") || ct.contains("dash+xml") { return Some((Route::Ytdlp, ct)); }
    if ct.starts_with("image/") || ct.starts_with("video/") || ct.starts_with("audio/")
        || ct.starts_with("application/octet-stream") { return Some((Route::Aria2, ct)); }
    if ct.starts_with("text/html") || ct.contains("xhtml") { return Some((Route::Ytdlp, ct)); }
    None
}

/// Pick the download engine by evidence: cheap URL/context signals first, then a
/// content-type probe for anything ambiguous — instead of defaulting to yt-dlp.
async fn decide_route(url: &str, kind: &str, elem: Option<&str>, has_stream: bool, referer: Option<&str>) -> Routing {
    if is_torrent_like(url) { return Routing::just(Route::Aria2); }
    if is_stream_manifest(url) { return Routing::just(Route::Ytdlp); }
    if is_direct_file_url(url) { return Routing::just(Route::Aria2); }
    match elem {
        Some("img") | Some("image") => return Routing::just(Route::Aria2),
        Some("video-mse") | Some("audio-mse") => return Routing::just(Route::Ytdlp),
        _ => {}
    }
    if has_stream || kind == "stream" { return Routing::just(Route::Ytdlp); }
    if is_known_ytdlp_host(url) { return Routing::just(Route::Ytdlp); }
    let default = if kind == "page" || kind == "site" { Route::Ytdlp } else { Route::Aria2 };
    if !url.starts_with("http") { return Routing::just(default); }
    match head_classify(url, referer).await {
        Some((route, ct)) => Routing { route, ctype: Some(ct) },
        None => Routing::just(default),
    }
}


fn site_jobs() -> &'static Mutex<Vec<Value>> {
    SITE_JOBS.get_or_init(|| Mutex::new(Vec::new()))
}

fn now_ms() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

fn update_site_job<F: FnOnce(&mut Value)>(id: &str, f: F) {
    if let Ok(mut jobs) = site_jobs().lock() {
        if let Some(j) = jobs
            .iter_mut()
            .find(|j| j.get("gid").and_then(|g| g.as_str()) == Some(id))
        {
            f(j);
        }
    }
}

/// User data dir where the in-app updater installs a fresh yt-dlp:
/// ~/.local/share/DownMan/bin/yt-dlp (writable, unlike the root-owned bundled one).
fn ytdlp_user_path() -> std::path::PathBuf {
    dirs::data_dir()
        .unwrap_or_else(|| dirs::home_dir().unwrap_or_default().join(".local/share"))
        .join("DownMan").join("bin").join("yt-dlp")
}

/// Resolve the yt-dlp binary: env override → user-updated copy → bundled sidecar
/// (installed as `downman-ytdlp` next to the app binary) → resource dir → dev tree → PATH.
fn ytdlp_bin() -> String {
    if let Ok(p) = std::env::var("DOWNMAN_YTDLP") { return p; }
    // A user-updated copy (via the in-app updater) wins so YouTube stays working.
    let up = ytdlp_user_path();
    if up.exists() { return up.display().to_string(); }
    // Installed .deb / AppImage: the sidecar sits next to the app binary as downman-ytdlp.
    if let Ok(exe) = std::env::current_exe() {
        if let Some(d) = exe.parent() {
            for rel in ["downman-ytdlp", "yt-dlp"] {
                let p = d.join(rel);
                if p.exists() { return p.display().to_string(); }
            }
        }
    }
    // Some Tauri layouts expose sidecars via the resource dir.
    if let Some(app) = APP.get() {
        if let Ok(res) = app.path().resource_dir() {
            for name in ["downman-ytdlp", "yt-dlp"] {
                let p = res.join(name);
                if p.exists() { return p.display().to_string(); }
            }
        }
    }
    // Dev tree.
    for c in ["src-tauri/binaries/yt-dlp", "binaries/yt-dlp"] {
        if std::path::Path::new(c).exists() { return c.to_string(); }
    }
    "yt-dlp".into()
}

/// PATH augmented with common user binary locations. GUI apps often launch with a
/// minimal PATH that omits ~/.local/bin, ~/.deno/bin, /usr/local/bin, etc.; passing
/// this to yt-dlp lets it find a user-installed node/deno JS runtime.
fn augmented_path() -> String {
    let mut parts: Vec<String> = Vec::new();
    if let Ok(p) = std::env::var("PATH") { parts.push(p); }
    let home = dirs::home_dir().unwrap_or_default();
    for extra in [
        home.join(".local/bin"),
        home.join(".deno/bin"),
        home.join("bin"),
        std::path::PathBuf::from("/usr/local/bin"),
        std::path::PathBuf::from("/snap/bin"),
    ] {
        let s = extra.display().to_string();
        if !parts.iter().any(|p| p.split(':').any(|seg| seg == s)) { parts.push(s); }
    }
    parts.join(":")
}

fn bin_in_path(name: &str) -> bool {
    augmented_path().split(':').any(|d| !d.is_empty() && std::path::Path::new(d).join(name).exists())
}

/// A JavaScript runtime yt-dlp can use to solve YouTube's signature (nsig)
/// challenge. Without one, yt-dlp falls back to limited player clients and many
/// videos fail or only offer 360p.
fn js_runtime() -> Option<&'static str> {
    for rt in ["deno", "node", "bun"] {
        if which(rt).is_some() || bin_in_path(rt) {
            return Some(rt);
        }
    }
    None
}

/// Which JS runtime yt-dlp will use for YouTube (or "none").
#[tauri::command]
fn js_runtime_status() -> String {
    js_runtime().map(|s| s.to_string()).unwrap_or_else(|| "none".into())
}

/// Version string of the yt-dlp the app currently resolves ("not found" if none).
#[tauri::command]
fn ytdlp_version() -> String {
    let v = installed_ytdlp_version();
    if v.is_empty() { "not found".into() } else { v }
}

/// Download the latest yt-dlp standalone binary into the user data dir, verified
/// against the release's published SHA-256, so YouTube keeps working between app
/// releases. Returns the new version string.
#[tauri::command]
async fn update_ytdlp() -> Result<String, String> {
    const BIN_URL: &str = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux";
    const SUM_URL: &str = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/SHA2-256SUMS";
    let bytes = reqwest::get(BIN_URL).await.map_err(|e| format!("download failed: {e}"))?
        .error_for_status().map_err(|e| e.to_string())?
        .bytes().await.map_err(|e| e.to_string())?;
    if bytes.len() < 1_000_000 { return Err("Download looked too small — aborted.".into()); }
    let sums = reqwest::get(SUM_URL).await.map_err(|e| e.to_string())?
        .text().await.map_err(|e| e.to_string())?;
    let expected = sums.lines()
        .find(|l| l.split_whitespace().nth(1) == Some("yt-dlp_linux"))
        .and_then(|l| l.split_whitespace().next())
        .map(|s| s.to_lowercase())
        .ok_or("Could not find yt-dlp_linux in the published checksums.")?;
    let dst = ytdlp_user_path();
    std::fs::create_dir_all(dst.parent().ok_or("bad path")?).map_err(|e| e.to_string())?;
    let tmp = dst.with_extension("download");
    std::fs::write(&tmp, &bytes).map_err(|e| e.to_string())?;
    let sum_out = Command::new("sha256sum").arg(&tmp).output().map_err(|e| e.to_string())?;
    let got = String::from_utf8_lossy(&sum_out.stdout).split_whitespace().next().unwrap_or("").to_lowercase();
    if got != expected {
        let _ = std::fs::remove_file(&tmp);
        return Err("Checksum mismatch — download discarded for safety.".into());
    }
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())?;
    let ver_out = Command::new(&tmp).arg("--version").output().map_err(|e| e.to_string())?;
    if !ver_out.status.success() {
        let _ = std::fs::remove_file(&tmp);
        return Err("The downloaded yt-dlp did not run.".into());
    }
    let ver = String::from_utf8_lossy(&ver_out.stdout).trim().to_string();
    std::fs::rename(&tmp, &dst).map_err(|e| e.to_string())?;
    Ok(ver)
}

/// Installed yt-dlp version (empty string if none is resolvable/runnable).
fn installed_ytdlp_version() -> String {
    Command::new(ytdlp_bin()).arg("--version").output().ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default()
}

fn ytdlp_cfg_file() -> std::path::PathBuf {
    state_dir().join(".downman-ytdlp.json")
}

fn load_ytdlp_cfg() {
    if let Ok(s) = std::fs::read_to_string(ytdlp_cfg_file()) {
        if let Ok(v) = serde_json::from_str::<Value>(&s) {
            if let Some(a) = v.get("auto").and_then(|x| x.as_bool()) {
                YTDLP_AUTO.store(a, Ordering::Relaxed);
            }
            if let Some(t) = v.get("last_check").and_then(|x| x.as_u64()) {
                YTDLP_LAST_CHECK.store(t, Ordering::Relaxed);
            }
        }
    }
}

fn save_ytdlp_cfg() {
    let v = serde_json::json!({
        "auto": YTDLP_AUTO.load(Ordering::Relaxed),
        "last_check": YTDLP_LAST_CHECK.load(Ordering::Relaxed),
    });
    let _ = std::fs::write(ytdlp_cfg_file(), v.to_string());
}

/// Cheaply resolve the latest published yt-dlp version by following the GitHub
/// "releases/latest" redirect (HEAD only — a few KB, no API rate limit).
async fn latest_ytdlp_tag() -> Result<String, String> {
    let client = reqwest::Client::builder()
        .user_agent("DownMan")
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .head("https://github.com/yt-dlp/yt-dlp/releases/latest")
        .send().await
        .map_err(|e| e.to_string())?;
    resp.url().path().rsplit('/').next()
        .filter(|s| !s.is_empty() && *s != "latest")
        .map(|s| s.to_string())
        .ok_or_else(|| "could not resolve latest yt-dlp tag".into())
}

/// Keep yt-dlp fresh on our own schedule, independent of the distro package:
/// a cheap tag check throttled to once a day that only downloads when a newer
/// release exists. On first run with nothing usable, fetches one immediately.
async fn ytdlp_autoupdate_tick() {
    if !YTDLP_AUTO.load(Ordering::Relaxed) { return; }
    let installed = installed_ytdlp_version();
    let first_time = installed.is_empty() && !ytdlp_user_path().exists();
    let now = (now_ms() / 1000) as u64;
    let due = now.saturating_sub(YTDLP_LAST_CHECK.load(Ordering::Relaxed)) >= 24 * 3600;
    if !first_time && !due { return; }
    if first_time {
        // Nothing runnable yet (no user copy, no system yt-dlp): grab one now.
        if let Ok(v) = update_ytdlp().await {
            eprintln!("DownMan: installed yt-dlp {v}");
            YTDLP_LAST_CHECK.store(now, Ordering::Relaxed);
            save_ytdlp_cfg();
        }
        return;
    }
    match latest_ytdlp_tag().await {
        Ok(tag) => {
            if !installed.is_empty() && installed != tag {
                match update_ytdlp().await {
                    Ok(v) => eprintln!("DownMan: updated yt-dlp {installed} -> {v}"),
                    Err(e) => eprintln!("DownMan: yt-dlp update failed ({e})"),
                }
            }
            YTDLP_LAST_CHECK.store(now, Ordering::Relaxed);
            save_ytdlp_cfg();
        }
        Err(e) => eprintln!("DownMan: yt-dlp version check skipped ({e})"),
    }
}

/// Whether DownMan auto-refreshes yt-dlp (default on).
#[tauri::command]
fn ytdlp_auto_update() -> bool {
    YTDLP_AUTO.load(Ordering::Relaxed)
}

/// Toggle the daily yt-dlp auto-refresh.
#[tauri::command]
fn set_ytdlp_auto_update(enable: bool) {
    YTDLP_AUTO.store(enable, Ordering::Relaxed);
    save_ytdlp_cfg();
}

fn ytdlp_format(q: &str) -> Vec<String> {
    let s = |v: &str| v.to_string();
    match q {
        "audio" => vec![s("-f"), s("ba/b"), s("-x"), s("--audio-format"), s("mp3")],
        "1080" => vec![s("-f"), s("bv*[height<=1080]+ba/b[height<=1080]/b"), s("--merge-output-format"), s("mp4")],
        "720" => vec![s("-f"), s("bv*[height<=720]+ba/b[height<=720]/b"), s("--merge-output-format"), s("mp4")],
        "best" | "" => vec![s("-f"), s("bv*+ba/b"), s("--merge-output-format"), s("mp4")],
        // Anything else is a raw yt-dlp -f selector (a specific format the user picked).
        raw => vec![s("-f"), raw.to_string(), s("--merge-output-format"), s("mp4")],
    }
}

fn human_size(b: u64) -> String {
    if b == 0 {
        return String::new();
    }
    let u = ["B", "KB", "MB", "GB", "TB"];
    let mut v = b as f64;
    let mut i = 0;
    while v >= 1024.0 && i < u.len() - 1 {
        v /= 1024.0;
        i += 1;
    }
    if i == 0 {
        format!("{b} B")
    } else {
        format!("{v:.1} {}", u[i])
    }
}

#[derive(Clone, serde::Serialize)]
struct Fmt {
    selector: String,
    label: String,
    kind: String, // "av" | "video" | "audio"
    height: u64,
    ext: String,
    size: u64,
}

/// Query yt-dlp for the real, per-video list of available qualities.
fn fetch_formats(url: String, referer: Option<String>, cookies: Option<String>) -> Result<Value, String> {
    if url.is_empty() {
        return Err("no url".into());
    }
    let mut cmd = Command::new(ytdlp_bin());
    cmd.env("PATH", augmented_path());
    cmd.arg("-J").arg("--no-playlist").arg("--no-warnings");
    if let Some(rt) = js_runtime() {
        cmd.arg("--js-runtimes").arg(rt);
    }
    if let Some(r) = referer.filter(|r| !r.is_empty()) {
        cmd.arg("--referer").arg(r);
    }
    if let Some(c) = cookies.filter(|c| !c.is_empty() && c != "none") {
        cmd.arg("--cookies-from-browser").arg(c);
    }
    cmd.arg(&url);
    let out = cmd.output().map_err(|e| format!("yt-dlp: {e}"))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(err.lines().last().unwrap_or("yt-dlp failed").to_string());
    }
    let v: Value = serde_json::from_slice(&out.stdout).map_err(|e| format!("parse: {e}"))?;
    let title = v.get("title").and_then(|t| t.as_str()).unwrap_or("video").to_string();

    use std::collections::BTreeMap;
    let mut by_height: BTreeMap<u64, (f64, Fmt)> = BTreeMap::new();
    let mut best_audio: Option<(f64, Fmt)> = None;

    if let Some(formats) = v.get("formats").and_then(|f| f.as_array()) {
        for f in formats {
            let ext = f.get("ext").and_then(|x| x.as_str()).unwrap_or("");
            if ext.is_empty() || ext == "mhtml" {
                continue;
            }
            let id = match f.get("format_id").and_then(|x| x.as_str()) {
                Some(i) => i.to_string(),
                None => continue,
            };
            let vcodec = f.get("vcodec").and_then(|x| x.as_str()).unwrap_or("none");
            let acodec = f.get("acodec").and_then(|x| x.as_str()).unwrap_or("none");
            let has_v = vcodec != "none" && !vcodec.is_empty();
            let has_a = acodec != "none" && !acodec.is_empty();
            let height = f.get("height").and_then(|x| x.as_u64()).unwrap_or(0);
            let fps = f.get("fps").and_then(|x| x.as_f64()).unwrap_or(0.0);
            let tbr = f.get("tbr").and_then(|x| x.as_f64()).unwrap_or(0.0);
            let abr = f.get("abr").and_then(|x| x.as_f64()).unwrap_or(0.0);
            let size = f
                .get("filesize")
                .and_then(|x| x.as_u64())
                .or_else(|| f.get("filesize_approx").and_then(|x| x.as_u64()))
                .unwrap_or(0);

            if has_v && height > 0 {
                let kind = if has_a { "av" } else { "video" };
                let selector = if has_a { id.clone() } else { format!("{id}+bestaudio/{id}") };
                let fpss = if fps >= 50.0 { format!("{}", fps.round() as u64) } else { String::new() };
                let sz = human_size(size);
                let label = format!("{height}p{fpss} · {ext}{}", if sz.is_empty() { String::new() } else { format!(" · {sz}") });
                let fmt = Fmt { selector, label, kind: kind.into(), height, ext: ext.into(), size };
                let better = match by_height.get(&height) {
                    Some((t, existing)) => tbr > *t || (existing.ext != "mp4" && ext == "mp4"),
                    None => true,
                };
                if better {
                    by_height.insert(height, (tbr, fmt));
                }
            } else if has_a {
                let sz = human_size(size);
                let label = format!("Audio · {ext}{}", if sz.is_empty() { String::new() } else { format!(" · {sz}") });
                let fmt = Fmt { selector: id.clone(), label, kind: "audio".into(), height: 0, ext: ext.into(), size };
                let better = match &best_audio {
                    Some((a, _)) => abr > *a,
                    None => true,
                };
                if better {
                    best_audio = Some((abr, fmt));
                }
            }
        }
    }

    let mut list: Vec<Fmt> = Vec::new();
    list.push(Fmt { selector: "bv*+ba/b".into(), label: "Best available".into(), kind: "av".into(), height: 99999, ext: "mp4".into(), size: 0 });
    for (_h, (_t, fmt)) in by_height.iter().rev() {
        list.push(fmt.clone());
    }
    if let Some((_a, fmt)) = best_audio {
        list.push(fmt);
    }

    Ok(json!({ "title": title, "formats": list }))
}

/// Download from a site/page/stream via yt-dlp, tracking progress as a pseudo-task.
/// Unwrap a Reddit-style media viewer link (reddit.com/media?url=<encoded file>)
/// to the real file URL.
fn unwrap_media_url(url: &str) -> String {
    if let Some(pos) = url.find("/media?url=") {
        let enc = url[pos + "/media?url=".len()..].split('&').next().unwrap_or("");
        let dec = percent_decode(enc);
        if dec.starts_with("http") { return dec; }
    }
    url.to_string()
}

/// True if the URL points straight at a downloadable file (video or image).
fn is_direct_file_url(url: &str) -> bool {
    let path = url.split(['?', '#']).next().unwrap_or(url).to_lowercase();
    [".mp4", ".m4v", ".webm", ".mkv", ".mov", ".m4a", ".mp3", ".aac", ".flac",
     ".ogg", ".wav", ".opus", ".ts", ".gif", ".jpg", ".jpeg", ".png", ".webp",
     ".avif", ".bmp", ".svg"]
        .iter().any(|e| path.ends_with(e))
}

/// Turn a user-chosen name into a yt-dlp output stem (no path separators or
/// %-templates; a trailing media extension is stripped since yt-dlp appends the
/// real one based on the chosen format).
fn ytdlp_out_stem(name: &str) -> String {
    let mut s: String = name.chars().filter(|c| *c != '/' && *c != '%').collect();
    s = s.trim().to_string();
    if let Some(dot) = s.rfind('.') {
        let ext = &s[dot + 1..];
        if !ext.is_empty() && ext.len() <= 5 && ext.chars().all(|c| c.is_ascii_alphanumeric()) {
            s.truncate(dot);
        }
    }
    if s.is_empty() { "video".into() } else { s }
}

fn start_site_download(
    url: String,
    format: String,
    referer: Option<String>,
    cookies_browser: Option<String>,
    subs: bool,
    sponsorblock: bool,
    out_dir: Option<String>,
    out_name: Option<String>,
) -> Result<String, String> {
    let url = unwrap_media_url(&url);
    // A direct file behind a viewer wrapper (e.g. reddit.com/media?url=…gif) isn't a
    // page yt-dlp can extract — hand it straight to aria2 (in a worker thread so we
    // never nest block_on inside an async caller).
    if is_direct_file_url(&url) {
        let dir = out_dir.as_deref().map(str::trim).filter(|d| !d.is_empty()).map(String::from);
        let ref2 = referer.clone();
        let u = url.clone();
        let (tx, rx) = std::sync::mpsc::channel();
        std::thread::spawn(move || {
            let res = tauri::async_runtime::block_on(async move {
                let c = ARIA2.get().ok_or_else(|| "aria2 not started".to_string())?;
                let mut opts = serde_json::Map::new();
                if let Some(d) = dir { opts.insert("dir".into(), json!(d)); }
                if let Some(r) = ref2.filter(|r| !r.is_empty()) { opts.insert("referer".into(), json!(r)); }
                c.add_uri(vec![u], Value::Object(opts)).await.map_err(|e| e.to_string())
            });
            let _ = tx.send(res);
        });
        return rx.recv().unwrap_or_else(|_| Err("aria2 add failed".into()));
    }
    let out = out_dir
        .as_deref()
        .map(str::trim)
        .filter(|d| !d.is_empty())
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| download_dir().join("Video"));
    std::fs::create_dir_all(&out).ok();
    let out_template = match out_name.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(name) => out.join(format!("{}.%(ext)s", ytdlp_out_stem(name))),
        None => out.join("%(title).80s_[%(resolution)s].%(ext)s"),
    };
    let id = format!("site-{}", now_ms());

    site_jobs().lock().unwrap().push(json!({
        "gid": id, "status": "active",
        "totalLength": "0", "completedLength": "0", "downloadSpeed": "0",
        "connections": "1", "dir": out.display().to_string(),
        "files": [{ "path": url.clone(), "uris": [{ "uri": url.clone() }] }], "dmKind": "site"
    }));

    let mut cmd = Command::new(ytdlp_bin());
    // PYTHONUNBUFFERED forces yt-dlp (a frozen Python binary) to flush stdout per line,
    // and --progress forces it to emit progress at all: yt-dlp suppresses the progress
    // display when neither stdout nor stderr is a TTY (which is the case here, both piped),
    // so without it the UI only sees the final line and jumps 0% -> 100%.
    cmd.env("PYTHONUNBUFFERED", "1")
        .env("PATH", augmented_path())
        .arg("--newline")
        .arg("--progress")
        .arg("--no-playlist")
        .arg("--no-mtime")
        .arg("--restrict-filenames")
        .arg("-o")
        .arg(&out_template)
        .arg("--progress-template")
        .arg("download:DM\u{a7}%(progress.downloaded_bytes)s\u{a7}%(progress.total_bytes)s\u{a7}%(progress.total_bytes_estimate)s\u{a7}%(progress.speed)s\u{a7}%(info.title)s")
        .arg("--no-simulate")
        .arg("--print")
        .arg("after_move:DMFILE\u{a7}%(filepath)s");
    if let Some(rt) = js_runtime() {
        cmd.arg("--js-runtimes").arg(rt);
    }
    for a in ytdlp_format(&format) {
        cmd.arg(a);
    }
    if subs {
        cmd.arg("--embed-subs").arg("--sub-langs").arg("en.*,en");
    }
    if sponsorblock {
        cmd.arg("--sponsorblock-remove").arg("default");
    }
    let referer_fb = referer.clone();
    if let Some(r) = referer.filter(|r| !r.is_empty()) {
        cmd.arg("--referer").arg(r);
    }
    if let Some(b) = cookies_browser.filter(|b| !b.is_empty() && b != "none") {
        cmd.arg("--cookies-from-browser").arg(b);
    }
    cmd.arg(&url).stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = match cmd.spawn() {
        Ok(c) => c,
        Err(e) => {
            update_site_job(&id, |j| {
                j["status"] = json!("error");
                j["errorMessage"] = json!(format!("yt-dlp failed to start: {e}"));
            });
            return Err(format!("yt-dlp: {e}"));
        }
    };
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let id2 = id.clone();
    let url_log = url.clone();
    let fmt_log = format.clone();

    // Capture yt-dlp's stderr so a failed download reports *why* instead of vanishing.
    let errbuf = std::sync::Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
    let errbuf_w = errbuf.clone();
    std::thread::spawn(move || {
        if let Some(err) = stderr {
            for line in BufReader::new(err).lines().map_while(Result::ok) {
                if let Ok(mut b) = errbuf_w.lock() {
                    b.push(line);
                    if b.len() > 60 {
                        let n = b.len() - 60;
                        b.drain(0..n);
                    }
                }
            }
        }
    });

    std::thread::spawn(move || {
        if let Some(out) = stdout {
            let mut phase_base: u64 = 0;
            let mut last_dl: u64 = 0;
            let mut last_total: u64 = 0;
            for line in BufReader::new(out).lines().map_while(Result::ok) {
                // Final merged file path (printed after move) -> use its real size.
                if let Some(path) = line.strip_prefix("DMFILE\u{a7}") {
                    if let Ok(meta) = std::fs::metadata(path) {
                        let size = meta.len();
                        let full = path.to_string();
                        update_site_job(&id2, |j| {
                            j["totalLength"] = json!(size.to_string());
                            j["completedLength"] = json!(size.to_string());
                            j["files"] = json!([{ "path": full, "uris": [{ "uri": url_log.clone() }] }]);
                        });
                    }
                    continue;
                }
                if let Some(rest) = line.strip_prefix("DM\u{a7}") {
                    let p: Vec<&str> = rest.split('\u{a7}').collect();
                    if p.len() >= 5 {
                        let downloaded = p[0].parse::<f64>().unwrap_or(0.0) as u64;
                        let total = p[1]
                            .parse::<f64>()
                            .ok()
                            .filter(|v| *v > 0.0)
                            .or_else(|| p[2].parse::<f64>().ok())
                            .unwrap_or(0.0) as u64;
                        let speed = p[3].parse::<f64>().unwrap_or(0.0) as u64;
                        let title = p[4..].join("\u{a7}");
                        // A new stream (e.g. audio after video) restarts the byte counter.
                        if downloaded + 1 < last_dl {
                            phase_base += last_total.max(last_dl);
                        }
                        last_dl = downloaded;
                        last_total = total;
                        let cum_done = phase_base + downloaded;
                        let cum_total = phase_base + total;
                        update_site_job(&id2, |j| {
                            j["completedLength"] = json!(cum_done.to_string());
                            let prev = j["totalLength"].as_str().and_then(|s| s.parse::<u64>().ok()).unwrap_or(0);
                            j["totalLength"] = json!(cum_total.max(prev).to_string());
                            j["downloadSpeed"] = json!(speed.to_string());
                            if !title.is_empty() && title != "NA" {
                                j["files"] = json!([{ "path": title }]);
                            }
                        });
                    }
                    continue;
                }
            }
        }
        let success = child.wait().map(|s| s.success()).unwrap_or(false);
        let errlines = errbuf.lock().map(|b| b.clone()).unwrap_or_default();
        if !success {
            // yt-dlp rejected the page's resolved media as an "Unsupported URL". If that
            // URL is really a direct file — a known media extension, or (extensionless CDN
            // links) the server reports a media/binary content-type — hand it to aria2,
            // which downloads files yt-dlp refuses, instead of a dead-end error.
            let bad = errlines.iter().rev().find_map(|l| {
                l.split("Unsupported URL:").nth(1)
                    .map(|s| s.trim().split_whitespace().next().unwrap_or("").to_string())
            }).map(|u| unwrap_media_url(&u)).filter(|u| u.starts_with("http"));
            let direct = bad.filter(|u| {
                is_direct_file_url(u) || {
                    let (u2, r2) = (u.clone(), referer_fb.clone());
                    tauri::async_runtime::block_on(async move { url_is_media(&u2, r2.as_deref()).await })
                }
            });
            if let Some(furl) = direct {
                if let Some(c) = ARIA2.get() {
                    let mut opts = serde_json::Map::new();
                    if let Some(r) = referer_fb.as_deref().filter(|r| !r.is_empty()) {
                        opts.insert("referer".into(), json!(r));
                    }
                    if tauri::async_runtime::block_on(c.add_uri(vec![furl.clone()], Value::Object(opts))).is_ok() {
                        // The aria2 task now represents this download; drop the pseudo-task.
                        if let Ok(mut jobs) = site_jobs().lock() {
                            jobs.retain(|j| j.get("gid").and_then(|g| g.as_str()) != Some(id2.as_str()));
                        }
                        return;
                    }
                }
            }
            // Persist the stderr tail so the user can troubleshoot a failed capture.
            let logp = download_dir().join("downman-ytdlp.log");
            if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&logp) {
                use std::io::Write;
                let _ = writeln!(f, "\n=== {id2} | -f {fmt_log} | {url_log} ===");
                for l in &errlines {
                    let _ = writeln!(f, "{l}");
                }
            }
        }
        // Surface the most relevant error line (yt-dlp prefixes hard errors with "ERROR").
        let reason = errlines
            .iter()
            .rev()
            .find(|l| l.contains("ERROR"))
            .or_else(|| errlines.last())
            .cloned()
            .unwrap_or_default();
        let mut done_path = String::new();
        update_site_job(&id2, |j| {
            j["status"] = json!(if success { "complete" } else { "error" });
            j["downloadSpeed"] = json!("0");
            if success {
                let t = j["totalLength"].clone();
                j["completedLength"] = t;
                done_path = j["files"][0]["path"].as_str().unwrap_or("").to_string();
            } else if !reason.is_empty() {
                let mut msg: String = reason.trim().trim_start_matches("ERROR: ").chars().take(200).collect();
                let low = msg.to_lowercase();
                // The #1 YouTube failure: media fetch is bot-gated. Cookies fix it.
                if low.contains("sign in to confirm") || low.contains("not a bot") || low.contains(" 403") || low.contains("http error 403") {
                    msg.push_str("  — tip: enable “cookies from browser” in the DownMan extension options.");
                }
                j["errorMessage"] = json!(msg);
            }
        });
        if success && !done_path.is_empty() {
            let dname = std::path::Path::new(&done_path).file_name().and_then(|s| s.to_str()).unwrap_or("video").to_string();
            notify(&format!("✓ Downloaded: {dname}"), &done_path);
        }
    });
    Ok(id)
}

struct EngineProc(#[allow(dead_code)] Mutex<Option<Child>>);

fn client() -> Result<&'static Aria2, String> {
    ARIA2.get().ok_or_else(|| "aria2 not started".into())
}

fn random_secret() -> String {
    let mut rng = rand::thread_rng();
    (0..32)
        .map(|_| char::from(rng.gen_range(b'a'..=b'z')))
        .collect()
}

fn default_dl_dir() -> std::path::PathBuf {
    let base = dirs::download_dir().unwrap_or_else(|| dirs::home_dir().unwrap_or_default());
    base.join("DownMan")
}

/// Stable location for DownMan's own state (history, rules, session, …). Always the
/// default folder, so changing the download folder never strands existing state.
fn state_dir() -> std::path::PathBuf {
    default_dl_dir()
}

fn dldir() -> &'static Mutex<Option<String>> {
    DLDIR.get_or_init(|| Mutex::new(None))
}

/// Where downloads are saved (user override, else the default).
fn download_dir() -> std::path::PathBuf {
    if let Ok(g) = dldir().lock() {
        if let Some(p) = g.as_ref() {
            if !p.trim().is_empty() {
                return std::path::PathBuf::from(p);
            }
        }
    }
    default_dl_dir()
}

fn dl_dir_file() -> std::path::PathBuf {
    state_dir().join(".downman-dir.txt")
}

fn load_dl_dir() {
    if let Ok(s) = std::fs::read_to_string(dl_dir_file()) {
        let s = s.trim().to_string();
        if !s.is_empty() {
            if let Ok(mut g) = dldir().lock() {
                *g = Some(s);
            }
        }
    }
}

#[tauri::command]
fn set_download_dir(path: String) -> Result<(), String> {
    let p = path.trim().to_string();
    std::fs::create_dir_all(state_dir()).ok();
    if p.is_empty() {
        let _ = std::fs::remove_file(dl_dir_file());
        if let Ok(mut g) = dldir().lock() {
            *g = None;
        }
    } else {
        std::fs::create_dir_all(&p).map_err(|e| e.to_string())?;
        let _ = std::fs::write(dl_dir_file(), &p);
        if let Ok(mut g) = dldir().lock() {
            *g = Some(p);
        }
    }
    Ok(())
}

fn grabbed() -> &'static Mutex<Value> {
    GRABBED.get_or_init(|| Mutex::new(json!({})))
}
fn grabbed_file() -> std::path::PathBuf {
    state_dir().join(".downman-grabbed.json")
}
fn load_grabbed() {
    if let Ok(s) = std::fs::read_to_string(grabbed_file()) {
        if let Ok(v @ Value::Object(_)) = serde_json::from_str::<Value>(&s) {
            if let Ok(mut g) = grabbed().lock() {
                *g = v;
            }
        }
    }
}
fn save_grabbed() {
    if let Ok(g) = grabbed().lock() {
        if let Ok(s) = serde_json::to_string(&*g) {
            let _ = std::fs::write(grabbed_file(), s);
        }
    }
}
fn mark_grabbed(url: &str) {
    if let Ok(mut g) = grabbed().lock() {
        if let Value::Object(m) = &mut *g {
            m.insert(url.to_string(), json!(true));
        }
    }
    save_grabbed();
}

fn custom_trackers() -> &'static Mutex<Vec<String>> {
    CUSTOM_TRACKERS.get_or_init(|| Mutex::new(Vec::new()))
}
fn auto_trackers() -> &'static Mutex<Vec<String>> {
    AUTO_TRACKERS.get_or_init(|| Mutex::new(Vec::new()))
}
fn trackers_file() -> std::path::PathBuf {
    state_dir().join(".downman-trackers.txt")
}
fn load_trackers() {
    if let Ok(s) = std::fs::read_to_string(trackers_file()) {
        let list: Vec<String> = s.lines().map(|l| l.trim().to_string()).filter(|l| !l.is_empty()).collect();
        if let Ok(mut c) = custom_trackers().lock() {
            *c = list;
        }
    }
}
async fn apply_trackers() {
    let mut all: Vec<String> = Vec::new();
    if let Ok(a) = auto_trackers().lock() {
        all.extend(a.iter().cloned());
    }
    if let Ok(c) = custom_trackers().lock() {
        all.extend(c.iter().cloned());
    }
    all.sort();
    all.dedup();
    if let Some(client) = ARIA2.get() {
        let _ = client.change_global_option(json!({ "bt-tracker": all.join(",") })).await;
    }
}

#[tauri::command]
fn get_trackers() -> String {
    custom_trackers().lock().map(|c| c.join("\n")).unwrap_or_default()
}

#[tauri::command]
async fn set_trackers(text: String) -> Result<(), String> {
    let list: Vec<String> = text.split(['\n', ',']).map(|l| l.trim().to_string()).filter(|l| !l.is_empty()).collect();
    if let Ok(mut c) = custom_trackers().lock() {
        *c = list.clone();
    }
    let _ = std::fs::write(trackers_file(), list.join("\n"));
    apply_trackers().await;
    Ok(())
}

#[tauri::command]
async fn add_trackers(gid: String, text: String) -> Result<(), String> {
    let list: Vec<String> = text.split(['\n', ',', ' ']).map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();
    if list.is_empty() {
        return Ok(());
    }
    // Persist into the global custom list (applies to this torrent on restart + all future ones).
    if let Ok(mut c) = custom_trackers().lock() {
        for tr in &list {
            if !c.contains(tr) {
                c.push(tr.clone());
            }
        }
        let _ = std::fs::write(trackers_file(), c.join("\n"));
    }
    apply_trackers().await;
    // Best-effort: also try to attach to the live torrent (works for paused/waiting ones).
    if let Some(client) = ARIA2.get() {
        let _ = client.change_option(&gid, json!({ "bt-tracker": list.join(",") })).await;
    }
    Ok(())
}

fn grab_request() -> &'static Mutex<Option<String>> {
    GRAB_REQUEST.get_or_init(|| Mutex::new(None))
}

#[tauri::command]
fn clear_grab_request() {
    if let Ok(mut g) = grab_request().lock() {
        *g = None;
    }
}

fn start_engine() -> Result<Child, String> {
    let secret = random_secret();
    let port: u16 = 6810;
    let dir = download_dir();
    std::fs::create_dir_all(&dir).ok();

    // Best-effort: clear any stale aria2c bound to our RPC port (dev hot-reload).
    let _ = Command::new("pkill").arg("-f").arg(format!("rpc-listen-port={port}")).status();
    // Wait until the port is actually free before spawning (avoids bind races).
    for _ in 0..40 {
        match std::net::TcpListener::bind(("127.0.0.1", port)) {
            Ok(l) => {
                drop(l);
                break;
            }
            Err(_) => std::thread::sleep(std::time::Duration::from_millis(50)),
        }
    }

    // aria2c comes from the system `aria2` package (a declared dependency); we do NOT
    // bundle it, because that would collide with /usr/bin/aria2c owned by that package.
    let aria_bin = std::env::var("DOWNMAN_ARIA2").unwrap_or_else(|_| "aria2c".into());
    std::fs::create_dir_all(state_dir()).ok();
    let session = state_dir().join(".downman-session");
    let mut cmd = Command::new(aria_bin);
    cmd.arg("--enable-rpc")
        .arg("--rpc-listen-all=false")
        .arg(format!("--rpc-listen-port={port}"))
        .arg(format!("--rpc-secret={secret}"))
        .arg(format!("--dir={}", dir.display()))
        .arg("--continue=true")
        .arg("--max-concurrent-downloads=5")
        .arg("--max-connection-per-server=16")
        .arg("--split=16")
        .arg("--min-split-size=1M")
        .arg("--seed-time=0")
        .arg("--bt-enable-lpd=true")
        .arg("--follow-torrent=true")
        .arg("--rpc-save-upload-metadata=true")
        .arg("--disable-ipv6=false")
        // Persist the task list so downloads survive an app restart.
        .arg(format!("--save-session={}", session.display()))
        .arg("--save-session-interval=15")
        .arg("--auto-save-interval=10");
    // Reload the previous session if one exists.
    if session.exists() {
        cmd.arg(format!("--input-file={}", session.display()));
    }
    let child = cmd
        .spawn()
        .map_err(|e| format!("failed to start aria2c: {e}"))?;

    ARIA2.set(Aria2::new(port, secret)).ok();
    Ok(child)
}

/// Local HTTP bridge so browser extensions can POST downloads to DownMan.
fn start_bridge() {
    std::thread::spawn(|| {
        let server = match tiny_http::Server::http("127.0.0.1:6802") {
            Ok(s) => s,
            Err(_) => return,
        };
        for mut req in server.incoming_requests() {
            // Local-security gate: a web page must not be able to drive the bridge.
            // Browser fetches carry an Origin header — allow extension origins and
            // header-less native callers; refuse anything http(s) or sandboxed.
            let from_web = req.headers().iter()
                .find(|h| h.field.equiv("Origin"))
                .map(|h| {
                    let o = h.value.as_str().to_lowercase();
                    o.starts_with("http://") || o.starts_with("https://") || o == "null"
                })
                .unwrap_or(false);
            if from_web {
                let _ = req.respond(tiny_http::Response::from_string("{\"ok\":false,\"error\":\"forbidden\"}").with_status_code(403));
                continue;
            }
            // Stamp ping time on every incoming request so the Settings card can show "last seen".
            LAST_BRIDGE_PING.store(now_ms() as u64, Ordering::Relaxed);
            let cors = tiny_http::Header::from_bytes(&b"Access-Control-Allow-Origin"[..], &b"*"[..]).unwrap();
            let ctype = tiny_http::Header::from_bytes(&b"Access-Control-Allow-Headers"[..], &b"Content-Type"[..]).unwrap();
            if req.method() == &tiny_http::Method::Options {
                let _ = req.respond(tiny_http::Response::empty(204).with_header(cors).with_header(ctype));
                continue;
            }
            let path = req.url().to_string();
            // GET /rules -> interception rules the browser extension applies.
            if path.starts_with("/rules") {
                let out = rules().lock().map(|r| r.to_string()).unwrap_or_else(|_| "{}".into());
                let json_ct = tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap();
                let _ = req.respond(tiny_http::Response::from_string(out).with_header(cors).with_header(json_ct));
                continue;
            }
            // GET /list -> current downloads (extension popup; localhost bridge only).
            if path.starts_with("/list") {
                let out = remote_list_json().to_string();
                let json_ct = tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap();
                let _ = req.respond(tiny_http::Response::from_string(out).with_header(cors).with_header(json_ct));
                continue;
            }
            let mut body = String::new();
            let _ = req.as_reader().read_to_string(&mut body);
            let v: Value = serde_json::from_str(&body).unwrap_or(json!({}));
            let json_ct = tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap();

            // POST /grab { url } -> open the Site Grabber in the app for this page.
            if path.starts_with("/grab") {
                let g = v.get("url").and_then(|u| u.as_str())
                    .or_else(|| v.get("uris").and_then(|a| a.as_array()).and_then(|a| a.first()).and_then(|x| x.as_str()))
                    .unwrap_or("").to_string();
                if !g.is_empty() {
                    if let Ok(mut gr) = grab_request().lock() {
                        *gr = Some(g);
                    }
                    focus_main();
                }
                let _ = req.respond(tiny_http::Response::from_string("{\"ok\":true}").with_header(cors));
                continue;
            }
            // POST /formats { url, referer?, cookies? } -> real per-video quality list.
            if path.starts_with("/formats") {
                let url0 = v.get("url").and_then(|u| u.as_str())
                    .or_else(|| v.get("uris").and_then(|a| a.as_array()).and_then(|a| a.first()).and_then(|x| x.as_str()))
                    .unwrap_or("").to_string();
                let opts = v.get("options").cloned().unwrap_or(json!({}));
                let referer = opts.get("referer").and_then(|r| r.as_str()).map(String::from)
                    .or_else(|| v.get("referer").and_then(|r| r.as_str()).map(String::from));
                let cookies = opts.get("cookies").and_then(|r| r.as_str()).map(String::from)
                    .or_else(|| v.get("cookies").and_then(|r| r.as_str()).map(String::from));
                let out = match fetch_formats(url0, referer, cookies) {
                    Ok(val) => val.to_string(),
                    Err(e) => json!({ "error": e }).to_string(),
                };
                let _ = req.respond(tiny_http::Response::from_string(out).with_header(cors).with_header(json_ct));
                continue;
            }

            let mut ok = false;
            {
                let kind = v.get("kind").and_then(|k| k.as_str()).unwrap_or("");
                // Unwrap viewer wrappers (e.g. reddit.com/media?url=<file>) at the door so
                // no downstream path can hand an unsupported wrapper to yt-dlp or aria2,
                // regardless of which (possibly stale) caller sent it.
                let uris: Vec<String> = v.get("uris").and_then(|u| u.as_array())
                    .map(|a| a.iter().filter_map(|x| x.as_str().map(|s| unwrap_media_url(s))).collect())
                    .unwrap_or_default();
                let opts = v.get("options").cloned().unwrap_or(json!({}));
                let url0 = uris.first().cloned().unwrap_or_default();
                let format = opts.get("format").and_then(|f| f.as_str()).unwrap_or("best").to_string();
                let referer = opts.get("referer").and_then(|r| r.as_str()).map(String::from);
                let cookies = opts.get("cookies").and_then(|r| r.as_str()).map(String::from);
                let elem = opts.get("elem").and_then(|e| e.as_str());
                let has_stream = opts.get("hasStream").and_then(|b| b.as_bool()).unwrap_or(false);
                // Smart routing: choose the engine by evidence (URL shape, DOM context,
                // then a content-type probe) instead of defaulting unknowns to yt-dlp.
                let routing = tauri::async_runtime::block_on(
                    decide_route(&url0, kind, elem, has_stream, referer.as_deref())
                );

                if routing.route == Route::Ytdlp && !url0.is_empty() {
                    // Page/stream captures via yt-dlp. Pop a confirmation dialog first
                    // (unless the caller opted out or confirmations are disabled).
                    let subs = opts.get("subs").and_then(|s| s.as_bool()).unwrap_or(false);
                    let sponsorblock = opts.get("sponsorblock").and_then(|s| s.as_bool()).unwrap_or(false);
                    let prompt = v.get("prompt").and_then(|p| p.as_bool()).unwrap_or(true);
                    if prompt && ASK_BEFORE.load(Ordering::Relaxed) {
                        let id = format!("pend-{}", now_ms());
                        let title = opts.get("title").and_then(|t| t.as_str()).filter(|s| !s.is_empty()).map(String::from);
                        let quality = opts.get("quality").and_then(|q| q.as_str()).unwrap_or(format.as_str()).to_string();
                        let name = title.unwrap_or_else(|| url_filename(&url0));
                        notify("DownMan — confirm video", &name);
                        if let Ok(mut p) = pending().lock() {
                            p.push(json!({
                                "id": id, "url": url0, "kind": "site",
                                "filename": name, "size": "0", "category": "Video",
                                "quality": quality, "format": format,
                                "referer": referer, "cookies": cookies,
                                "subs": subs, "sponsorblock": sponsorblock,
                                "status": "ready"
                            }));
                        }
                        focus_main();
                    } else {
                        let _ = start_site_download(url0, format, referer, cookies, subs, sponsorblock, None, None);
                    }
                    ok = true;
                } else {
                    // Direct files / torrents / magnets go to aria2. For ordinary http(s)
                    // files from the browser we first pop a confirmation dialog
                    // (unless the caller opted out, e.g. the batch image grabber).
                    let prompt = v.get("prompt").and_then(|p| p.as_bool()).unwrap_or(true);
                    let is_magnet = url0.starts_with("magnet:");
                    let is_torrent_url = url0.split(['?', '#']).next().unwrap_or("").ends_with(".torrent");
                    let promptable = prompt
                        && ASK_BEFORE.load(Ordering::Relaxed)
                        && uris.len() == 1
                        && url0.starts_with("http")
                        && !is_magnet
                        && !is_torrent_url;
                    if promptable {
                        let id = format!("pend-{}", now_ms());
                        let fname = filename_with_ext(&url0, routing.ctype.as_deref());
                        let cat = category_of(&fname).0;
                        // Browser-initiated: the window often can't raise over the
                        // browser (Wayland), so notify so it never feels like nothing happened.
                        notify("DownMan — confirm download", &fname);
                        if let Ok(mut p) = pending().lock() {
                            p.push(json!({
                                "id": id, "url": url0, "filename": fname,
                                "size": "0", "category": cat,
                                "referer": referer, "status": "probing"
                            }));
                        }
                        focus_main();
                        let id2 = id.clone();
                        let url2 = url0.clone();
                        let ref2 = referer.clone();
                        tauri::async_runtime::spawn(async move {
                            let (fname_opt, size) = probe_url(url2, ref2).await;
                            update_pending(&id2, |p| {
                                p["size"] = json!(size.to_string());
                                if let Some(f) = fname_opt {
                                    if !f.trim().is_empty() {
                                        p["category"] = json!(category_of(&f).0);
                                        p["filename"] = json!(f);
                                    }
                                }
                                p["status"] = json!("ready");
                            });
                        });
                        ok = true;
                    } else if let Some(c) = ARIA2.get() {
                        let mut a2 = serde_json::Map::new();
                        if let Some(r) = opts.get("referer") { a2.insert("referer".into(), r.clone()); }
                        // Ordinary http file: place it in its final folder under a unique
                        // name so concurrent same-name downloads never clobber each other.
                        let direct_file = url0.starts_with("http") && !is_magnet && !is_torrent_url;
                        if direct_file {
                            let fname = filename_with_ext(&url0, routing.ctype.as_deref());
                            let tdir = if ORGANIZE.load(Ordering::Relaxed) { category_of(&fname).1 } else { download_dir() };
                            let out = unique_out(&tdir, &fname);
                            a2.insert("dir".into(), json!(tdir.display().to_string()));
                            a2.insert("out".into(), json!(out));
                        }
                        let res = tauri::async_runtime::block_on(c.add_uri(uris, Value::Object(a2)));
                        if direct_file {
                            if let Ok(gid) = &res {
                                if let Ok(mut s) = no_organize().lock() { s.insert(gid.clone()); }
                            }
                        }
                        ok = res.is_ok();
                    }
                }
            }
            let _ = req.respond(tiny_http::Response::from_string(if ok { "{\"ok\":true}" } else { "{\"ok\":false}" }).with_header(cors));
        }
    });
}

#[tauri::command]
async fn add_download(uris: Vec<String>, options: Value) -> Result<String, String> {
    let mut opts = options.as_object().cloned().unwrap_or_default();
    let url0 = uris.first().cloned().unwrap_or_default();
    // Magnets / .torrent links land in a dedicated Torrents folder.
    let is_torrent = url0.starts_with("magnet:") || url0.split(['?', '#']).next().unwrap_or("").ends_with(".torrent");
    if is_torrent && !opts.contains_key("dir") {
        let tdir = download_dir().join("Torrents");
        std::fs::create_dir_all(&tdir).ok();
        opts.insert("dir".into(), json!(tdir.display().to_string()));
    }
    // Single ordinary http file: assign a unique name in its final folder.
    let direct_file = uris.len() == 1 && url0.starts_with("http") && !opts.contains_key("out");
    if direct_file {
        let fname = url_filename(&url0);
        let tdir = if ORGANIZE.load(Ordering::Relaxed) { category_of(&fname).1 } else { download_dir() };
        let existing = tdir.join(&fname);
        // File-exists conflict — return a typed error so the frontend can prompt.
        if existing.exists() && !opts.contains_key("dmForce") {
            let size = std::fs::metadata(&existing).map(|m| m.len()).unwrap_or(0);
            return Err(format!("conflict:{}:{}", existing.display(), size));
        }
        let out = unique_out(&tdir, &fname);
        opts.insert("dir".into(), json!(tdir.display().to_string()));
        opts.insert("out".into(), json!(out));
    }
    // Extract caller-supplied expected checksum (not sent to aria2 directly here;
    // we store it in DL_META and aria2 uses its own --checksum flag format).
    let user_checksum = opts.remove("dmChecksum").and_then(|v| v.as_str().map(|s| s.to_string())).unwrap_or_default();
    let _force_flag = opts.remove("dmForce"); // already consumed above in the conflict check
    let gid = client()?.add_uri(uris, Value::Object(opts)).await.map_err(|e| e.to_string())?;
    if direct_file {
        if let Ok(mut s) = no_organize().lock() { s.insert(gid.clone()); }
    }
    // Persist metadata for this download.
    if !user_checksum.is_empty() {
        if let Ok(mut m) = dl_meta().lock() {
            let e = m.entry(gid.clone()).or_default();
            e.checksum = user_checksum;
            e.verify = "pending".into();
        }
        save_dl_meta();
    }
    Ok(gid)
}

#[tauri::command]
async fn pause(gid: String) -> Result<(), String> {
    client()?.pause(&gid).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn resume(gid: String) -> Result<(), String> {
    client()?.unpause(&gid).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn pause_all() -> Result<(), String> {
    client()?.pause_all().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn resume_all() -> Result<(), String> {
    client()?.unpause_all().await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn organize(gid: String) -> Result<String, String> {
    let st = client()?.tell_status(&gid).await.map_err(|e| e.to_string())?;
    let path = st.get("files").and_then(|f| f.get(0)).and_then(|f| f.get("path"))
        .and_then(|p| p.as_str()).unwrap_or("").to_string();
    if path.is_empty() { return Err("no path".into()); }
    let src = std::path::PathBuf::from(&path);
    let name = src.file_name().and_then(|n| n.to_str()).unwrap_or("file").to_string();
    let dest_dir = category_of(&name).1;
    std::fs::create_dir_all(&dest_dir).ok();
    let dest = dest_dir.join(&name);
    if src != dest && src.exists() {
        if std::fs::rename(&src, &dest).is_err() {
            std::fs::copy(&src, &dest).map_err(|e| e.to_string())?;
            std::fs::remove_file(&src).ok();
        }
    }
    Ok(dest.display().to_string())
}

#[tauri::command]
fn grab_hls(url: String, name: String) -> Result<(), String> {
    let out = download_dir().join("Video");
    std::fs::create_dir_all(&out).ok();
    let safe = if name.ends_with(".mp4") { name } else { format!("{name}.mp4") };
    Command::new("ffmpeg").arg("-y").arg("-i").arg(&url)
        .arg("-c").arg("copy").arg(out.join(safe))
        .spawn().map_err(|e| format!("ffmpeg: {e}"))?;
    Ok(())
}

#[tauri::command]
async fn remove(gid: String) -> Result<(), String> {
    remove_from_history(&gid);
    if gid.starts_with("site-") {
        if let Ok(mut jobs) = site_jobs().lock() {
            jobs.retain(|j| j.get("gid").and_then(|g| g.as_str()) != Some(gid.as_str()));
        }
        return Ok(());
    }
    if gid.starts_with("pend-") {
        return Ok(());
    }
    client()?.remove(&gid).await.map_err(|e| e.to_string())
}

/// Re-download a completed/failed item's source to a temp sibling, validate it,
/// then replace the original only on success (so a dead/expired link never wipes
/// the existing file). `path` is the original file's full path.
#[tauri::command]
async fn redownload(url: String, path: String) -> Result<String, String> {
    if url.trim().is_empty() { return Err("no source url".into()); }
    let (dir, fname) = if !path.trim().is_empty() {
        let p = std::path::PathBuf::from(&path);
        let d = p.parent().map(|x| x.to_path_buf()).filter(|d| !d.as_os_str().is_empty()).unwrap_or_else(download_dir);
        let f = p.file_name().and_then(|s| s.to_str()).unwrap_or("download").to_string();
        (d, f)
    } else {
        (download_dir(), url_filename(&url))
    };
    let fname = if fname.trim().is_empty() { "download".to_string() } else { fname };
    let ext = std::path::Path::new(&fname).extension().and_then(|s| s.to_str()).unwrap_or("").to_lowercase();
    std::fs::create_dir_all(&dir).ok();
    let temp = format!("{fname}.dm-new");
    let _ = std::fs::remove_file(dir.join(&temp));
    let _ = std::fs::remove_file(dir.join(format!("{temp}.aria2")));
    let mut opts = serde_json::Map::new();
    opts.insert("dir".into(), json!(dir.display().to_string()));
    opts.insert("out".into(), json!(temp));
    opts.insert("allow-overwrite".into(), json!("true"));
    let gid = client()?.add_uri(vec![url], Value::Object(opts)).await.map_err(|e| e.to_string())?;
    if let Ok(mut s) = no_organize().lock() { s.insert(gid.clone()); }
    if let Ok(mut m) = redl_target().lock() {
        m.insert(gid.clone(), (dir.join(&fname).display().to_string(), ext));
    }
    Ok(gid)
}

/// Remove list entries whose file is gone (deleted/moved) or that failed, from
/// both aria2's result list and our history. Returns how many were cleared.
#[tauri::command]
async fn clear_gone() -> Result<u64, String> {
    let c = client()?;
    let is_gone = |t: &Value| -> bool {
        let status = t.get("status").and_then(|s| s.as_str()).unwrap_or("");
        if status == "error" || status == "removed" { return true; }
        let path = t.get("files").and_then(|f| f.get(0)).and_then(|f| f.get("path")).and_then(|p| p.as_str()).unwrap_or("");
        status == "complete" && !path.is_empty()
            && std::path::Path::new(path).is_absolute() && !std::path::Path::new(path).exists()
    };
    let mut cleared: HashSet<String> = HashSet::new();
    if let Ok(stopped) = c.tell_stopped().await {
        if let Some(arr) = stopped.as_array() {
            for t in arr {
                if is_gone(t) {
                    if let Some(gid) = t.get("gid").and_then(|g| g.as_str()) {
                        let _ = c.remove(gid).await;
                        cleared.insert(gid.to_string());
                    }
                }
            }
        }
    }
    if let Ok(mut h) = history().lock() {
        h.retain(|t| {
            if is_gone(t) {
                if let Some(gid) = t.get("gid").and_then(|g| g.as_str()) { cleared.insert(gid.to_string()); }
                false
            } else { true }
        });
    }
    save_history();
    Ok(cleared.len() as u64)
}

/// Delete leftover partial-download artifacts (aria2 control files + their stalled
/// partials, and re-download temps) that aren't part of any in-progress download.
/// Returns { bytes, files } reclaimed.
#[tauri::command]
async fn clear_cache() -> Result<Value, String> {
    let c = client()?;
    // Paths of downloads still in progress (active/waiting/paused) — never touch these.
    let mut keep: HashSet<String> = HashSet::new();
    for res in [c.tell_active().await, c.tell_waiting().await] {
        if let Ok(v) = res {
            if let Some(arr) = v.as_array() {
                for t in arr {
                    if let Some(files) = t.get("files").and_then(|f| f.as_array()) {
                        for f in files {
                            if let Some(p) = f.get("path").and_then(|p| p.as_str()) {
                                if !p.is_empty() { keep.insert(p.to_string()); }
                            }
                        }
                    }
                }
            }
        }
    }
    let mut freed = 0u64;
    let mut removed = 0u64;
    let base = download_dir();
    let mut dirs = vec![base.clone()];
    if let Ok(rd) = std::fs::read_dir(&base) {
        for e in rd.flatten() { if e.path().is_dir() { dirs.push(e.path()); } }
    }
    for d in dirs {
        let rd = match std::fs::read_dir(&d) { Ok(r) => r, Err(_) => continue };
        for entry in rd.flatten() {
            let path = entry.path();
            if path.is_dir() { continue; }
            let full = path.display().to_string();
            let name = path.file_name().and_then(|s| s.to_str()).unwrap_or("");
            let is_temp = name.ends_with(".dm-new") || name.ends_with(".dm-new.aria2");
            let is_ctrl = name.ends_with(".aria2");
            if !is_temp && !is_ctrl { continue; }
            let controlled = full.strip_suffix(".aria2").unwrap_or(&full).to_string();
            if keep.contains(&full) || keep.contains(&controlled) { continue; }
            let sz = entry.metadata().map(|m| m.len()).unwrap_or(0);
            if std::fs::remove_file(&path).is_ok() { freed += sz; removed += 1; }
            // For an orphaned .aria2, also drop its stalled partial file.
            if is_ctrl {
                let partial = std::path::PathBuf::from(&controlled);
                if partial.exists() && !keep.contains(&controlled) {
                    let psz = std::fs::metadata(&partial).map(|m| m.len()).unwrap_or(0);
                    if std::fs::remove_file(&partial).is_ok() { freed += psz; removed += 1; }
                }
            }
        }
    }
    Ok(json!({ "bytes": freed, "files": removed }))
}

#[tauri::command]
fn grab_site(url: String, format: Option<String>, referer: Option<String>, cookies: Option<String>, subs: Option<bool>, sponsorblock: Option<bool>) -> Result<String, String> {
    start_site_download(url, format.unwrap_or_else(|| "best".into()), referer, cookies, subs.unwrap_or(false), sponsorblock.unwrap_or(false), None, None)
}

#[tauri::command]
fn list_formats(url: String, referer: Option<String>, cookies: Option<String>) -> Result<Value, String> {
    fetch_formats(url, referer, cookies)
}

/// Re-attach aria2's full file list to completed torrents in history. Older
/// builds collapsed multi-file torrents to a single entry; match the live
/// torrent (active/waiting/stopped) by info hash and restore the real list.
fn enrich_torrent_history(history: &mut Value, live: &[&Value]) {
    use std::collections::HashMap;
    let mut by_hash: HashMap<String, Value> = HashMap::new();
    for group in live {
        if let Some(arr) = group.as_array() {
            for t in arr {
                if t.get("bittorrent").is_none() {
                    continue;
                }
                let n = t.get("files").and_then(|f| f.as_array()).map(|a| a.len()).unwrap_or(0);
                if n <= 1 {
                    continue;
                }
                if let Some(h) = t.get("infoHash").and_then(|h| h.as_str()) {
                    if let Some(files) = t.get("files").cloned() {
                        by_hash.entry(h.to_string()).or_insert(files);
                    }
                }
            }
        }
    }
    if by_hash.is_empty() {
        return;
    }
    if let Some(arr) = history.as_array_mut() {
        for h in arr.iter_mut() {
            if h.get("bittorrent").is_none() {
                continue;
            }
            let cur = h.get("files").and_then(|f| f.as_array()).map(|a| a.len()).unwrap_or(0);
            if cur > 1 {
                continue;
            }
            if let Some(hash) = h.get("infoHash").and_then(|s| s.as_str()).map(String::from) {
                if let Some(files) = by_hash.get(&hash) {
                    h["files"] = files.clone();
                }
            }
        }
    }
}

/// Flag completed downloads whose file has been deleted or moved on disk, so the
/// UI can show them as missing instead of pretending they're still there.
fn mark_missing(arr: &mut Value) {
    if let Some(a) = arr.as_array_mut() {
        for t in a.iter_mut() {
            if t.get("status").and_then(|s| s.as_str()) != Some("complete") { continue; }
            let path = t.get("files").and_then(|f| f.as_array()).and_then(|f| f.first())
                .and_then(|f| f.get("path")).and_then(|p| p.as_str()).unwrap_or("");
            if path.len() > 1 && std::path::Path::new(path).is_absolute() && !std::path::Path::new(path).exists() {
                t["dmMissing"] = json!(true);
            }
        }
    }
}

/// Apply re-download overlays to a task array: while a re-download runs, show the
/// real filename instead of the `.dm-new` temp.
fn overlay_redl(arr: &mut Value, targets: &HashMap<String, (String, String)>) {
    if let Some(a) = arr.as_array_mut() {
        for task in a.iter_mut() {
            let gid = match task.get("gid").and_then(|g| g.as_str()) { Some(g) => g.to_string(), None => continue };
            if let Some((final_path, _)) = targets.get(&gid) {
                if let Some(f0) = task.get_mut("files").and_then(|f| f.as_array_mut()).and_then(|f| f.get_mut(0)) {
                    f0["path"] = json!(final_path);
                }
            }
        }
    }
}

#[tauri::command]
async fn snapshot() -> Result<Snapshot, String> {
    let c = client()?;
    let active = c.tell_active().await.map_err(|e| e.to_string())?;
    let waiting = c.tell_waiting().await.map_err(|e| e.to_string())?;
    let stopped = c.tell_stopped().await.map_err(|e| e.to_string())?;
    let stat = c.global_stat().await.map_err(|e| e.to_string())?;
    let site = Value::Array(site_jobs().lock().map(|j| j.clone()).unwrap_or_default());
    let pending = Value::Array(pending().lock().map(|j| j.clone()).unwrap_or_default());
    let history = history().lock().map(|j| j.clone()).unwrap_or_default();
    let mut history = Value::Array(history);
    enrich_torrent_history(&mut history, &[&active, &waiting, &stopped]);
    // Inject DL_META fields (checksum, verify status) into each task so the
    // frontend can show verification badges without a separate API call.
    let meta_map = dl_meta().lock().ok().map(|m| m.clone()).unwrap_or_default();
    fn inject_meta(arr: &mut Value, meta: &HashMap<String, DlMeta>) {
        if let Some(a) = arr.as_array_mut() {
            for t in a.iter_mut() {
                if let Some(gid) = t.get("gid").and_then(|g| g.as_str()).map(|s| s.to_string()) {
                    if let Some(m) = meta.get(&gid) {
                        t["dmChecksum"] = json!(m.checksum);
                        t["dmVerify"] = json!(m.verify);
                        t["dmOnComplete"] = json!(m.oncomplete_action);
                    }
                }
            }
        }
    }
    let mut active = active; let mut waiting = waiting; let mut stopped = stopped;
    inject_meta(&mut active, &meta_map);
    inject_meta(&mut waiting, &meta_map);
    inject_meta(&mut stopped, &meta_map);
    inject_meta(&mut history, &meta_map);
    // While a re-download runs, show the real filename instead of the .dm-new temp.
    let redl_t = redl_target().lock().ok().map(|m| m.clone()).unwrap_or_default();
    overlay_redl(&mut active, &redl_t);
    overlay_redl(&mut waiting, &redl_t);
    // Badge tasks the auto-retry loop is nursing ("retry n/3" in the UI); the map
    // entry disappears on success, and counts past 3 mean we gave up (no badge).
    let rmap = retries().lock().ok().map(|m| m.clone()).unwrap_or_default();
    if !rmap.is_empty() {
        fn inject_retry(arr: &mut Value, rmap: &HashMap<String, u32>) {
            if let Some(a) = arr.as_array_mut() {
                for t in a.iter_mut() {
                    let url = url_of_task(t);
                    if let Some(n) = rmap.get(&url).filter(|n| **n <= 3) {
                        t["dmRetry"] = json!(n);
                    }
                }
            }
        }
        inject_retry(&mut active, &rmap);
        inject_retry(&mut waiting, &rmap);
        inject_retry(&mut stopped, &rmap);
    }
    // Flag completed downloads whose file was deleted/moved so they don't look live.
    let mut site = site;
    mark_missing(&mut stopped);
    mark_missing(&mut site);
    mark_missing(&mut history);
    let queues = queues().lock().map(|q| q.clone()).unwrap_or_else(|_| default_queues());
    let queue_map = qmember().lock().map(|m| m.clone()).unwrap_or(json!({}));
    let grabbed = grabbed().lock().map(|g| g.clone()).unwrap_or(json!({}));
    let grab_request = grab_request().lock().map(|g| g.clone().map(Value::String).unwrap_or(Value::Null)).unwrap_or(Value::Null);
    Ok(Snapshot { active, waiting, stopped, stat, site, pending, history, queues, queue_map, grabbed, grab_request })
}

#[tauri::command]
async fn set_global_option(options: Value) -> Result<(), String> {
    client()?.change_global_option(options).await.map_err(|e| e.to_string())
}

#[tauri::command]
fn engine_info() -> Value {
    json!({ "dir": download_dir().display().to_string() })
}

// ---- Per-download control (P3) ----

#[tauri::command]
async fn set_download_limit(gid: String, limit: String) -> Result<(), String> {
    client()?
        .change_option(&gid, json!({ "max-download-limit": limit }))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn reorder(gid: String, how: String) -> Result<(), String> {
    let (pos, h) = match how.as_str() {
        "top" => (0, "POS_SET"),
        "bottom" => (1 << 30, "POS_SET"),
        "up" => (-1, "POS_CUR"),
        _ => (1, "POS_CUR"),
    };
    client()?
        .change_position(&gid, pos, h)
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn set_selected_files(gid: String, indices: String) -> Result<(), String> {
    // `indices` is a 1-based aria2 list, e.g. "1,3,5"; empty means all.
    let sel = if indices.trim().is_empty() { "1-1024".to_string() } else { indices };
    client()?
        .change_option(&gid, json!({ "select-file": sel }))
        .await
        .map_err(|e| e.to_string())
}

/// Tracks the `.torrent` copy aria2 saves for each uploaded torrent
/// (rpc-save-upload-metadata) so it can be removed once the download finishes.
static TORRENT_META: OnceCell<Mutex<HashMap<String, String>>> = OnceCell::new();
fn torrent_meta() -> &'static Mutex<HashMap<String, String>> {
    TORRENT_META.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Full paths of every `*.torrent` file aria2 may have saved in our dirs.
fn scan_torrent_files() -> HashSet<String> {
    let mut out = HashSet::new();
    for d in [download_dir(), download_dir().join("Torrents")] {
        if let Ok(rd) = std::fs::read_dir(&d) {
            for e in rd.flatten() {
                let p = e.path();
                if p.extension().and_then(|x| x.to_str()) == Some("torrent") {
                    out.insert(p.display().to_string());
                }
            }
        }
    }
    out
}

#[tauri::command]
async fn add_torrent(data: String, options: Value) -> Result<String, String> {
    let mut opts = options.as_object().cloned().unwrap_or_default();
    if !opts.contains_key("dir") {
        let tdir = download_dir().join("Torrents");
        std::fs::create_dir_all(&tdir).ok();
        opts.insert("dir".into(), json!(tdir.display().to_string()));
    }
    // Snapshot existing .torrent files so we can find — and auto-delete on
    // completion — the copy aria2 saves for this upload.
    let before = scan_torrent_files();
    let gid = client()?.add_torrent(data, Value::Object(opts)).await.map_err(|e| e.to_string())?;
    if let Some(f) = scan_torrent_files().difference(&before).next().cloned() {
        if let Ok(mut m) = torrent_meta().lock() {
            m.insert(gid.clone(), f);
        }
    }
    Ok(gid)
}

#[tauri::command]
async fn add_metalink(data: String, options: Value) -> Result<Value, String> {
    let mut opts = options.as_object().cloned().unwrap_or_default();
    if !opts.contains_key("dir") {
        opts.insert("dir".into(), json!(download_dir().display().to_string()));
    }
    client()?.add_metalink(data, Value::Object(opts)).await.map_err(|e| e.to_string())
}

// ---- Scheduler / power / antivirus (P3, P6) ----

#[tauri::command]
fn set_shutdown_when_done(enable: bool) {
    SHUTDOWN_WHEN_DONE.store(enable, Ordering::Relaxed);
}

#[tauri::command]
fn set_av_scan(enable: bool) {
    AV_SCAN.store(enable, Ordering::Relaxed);
}

// ---- Download confirmation (P1 polish) ----

#[tauri::command]
fn set_confirm_downloads(enable: bool) {
    ASK_BEFORE.store(enable, Ordering::Relaxed);
}

#[tauri::command]
fn set_clipboard_watch(enable: bool) {
    CLIPBOARD_WATCH.store(enable, Ordering::Relaxed);
}

#[tauri::command]
fn set_metered_pause(enable: bool) {
    METERED_PAUSE.store(enable, Ordering::Relaxed);
}

#[tauri::command]
fn set_power_block(enable: bool) {
    POWER_BLOCK.store(enable, Ordering::Relaxed);
}

/// Sync the tray "Speed limit" toggle with the limit configured in Settings.
#[tauri::command]
fn set_speed_limit_state(on: bool, value: String) {
    LIMIT_ON.store(on, Ordering::Relaxed);
    if !value.trim().is_empty() {
        if let Ok(mut v) = limit_val().lock() {
            *v = value.trim().to_string();
        }
    }
    if let Some(item) = TRAY_LIMIT.get() {
        let _ = item.set_checked(on);
    }
}

/// Approve a queued download with the user's chosen name, folder, and timing.
#[tauri::command]
async fn confirm_pending(id: String, filename: String, dir: String, paused: bool) -> Result<String, String> {
    let item = {
        let mut p = pending().lock().map_err(|_| "lock")?;
        let idx = p
            .iter()
            .position(|x| x.get("id").and_then(|i| i.as_str()) == Some(id.as_str()))
            .ok_or("not found")?;
        p.remove(idx)
    };
    let url = item.get("url").and_then(|u| u.as_str()).unwrap_or("").to_string();
    if url.is_empty() {
        return Err("no url".into());
    }
    let referer = item.get("referer").and_then(|r| r.as_str()).map(String::from);

    // Site/stream captures run through yt-dlp, honouring the chosen folder + name.
    let kind = item.get("kind").and_then(|k| k.as_str()).unwrap_or("");
    if kind == "site" || kind == "stream" {
        let format = item.get("format").and_then(|f| f.as_str()).unwrap_or("best").to_string();
        let cookies = item.get("cookies").and_then(|c| c.as_str()).map(String::from);
        let subs = item.get("subs").and_then(|s| s.as_bool()).unwrap_or(false);
        let sponsorblock = item.get("sponsorblock").and_then(|s| s.as_bool()).unwrap_or(false);
        let out_dir = if dir.trim().is_empty() { None } else { Some(dir) };
        let out_name = if filename.trim().is_empty() { None } else { Some(filename) };
        return start_site_download(url, format, referer, cookies, subs, sponsorblock, out_dir, out_name);
    }

    let mut opts = serde_json::Map::new();
    // Resolve the destination folder, then pick a non-colliding name within it.
    let tdir = if dir.trim().is_empty() { download_dir() } else { std::path::PathBuf::from(dir.trim()) };
    let base_name = if filename.trim().is_empty() { url_filename(&url) } else { filename.trim().to_string() };
    let out = unique_out(&tdir, &base_name);
    opts.insert("dir".into(), json!(tdir.display().to_string()));
    opts.insert("out".into(), json!(out));
    if let Some(r) = referer.filter(|r| !r.is_empty()) {
        opts.insert("referer".into(), json!(r));
    }
    if paused {
        opts.insert("pause".into(), json!("true"));
    }
    let gid = client()?
        .add_uri(vec![url], Value::Object(opts))
        .await
        .map_err(|e| e.to_string())?;
    // The user chose a folder for this one — don't auto-organize it later.
    if let Ok(mut s) = no_organize().lock() {
        s.insert(gid.clone());
    }
    Ok(gid)
}

#[tauri::command]
fn cancel_pending(id: String) {
    if let Ok(mut p) = pending().lock() {
        p.retain(|x| x.get("id").and_then(|i| i.as_str()) != Some(id.as_str()));
    }
}

/// Native folder picker for choosing a custom save location.
#[tauri::command]
async fn pick_folder() -> Option<String> {
    use tauri_plugin_dialog::DialogExt;
    let app = APP.get()?;
    let (tx, rx) = std::sync::mpsc::channel();
    app.dialog().file().pick_folder(move |p| {
        let _ = tx.send(p);
    });
    rx.recv()
        .ok()
        .flatten()
        .and_then(|fp| fp.into_path().ok())
        .map(|pb| pb.display().to_string())
}

// ---- Completed-download actions (open / reveal / delete) ----

#[tauri::command]
fn open_path(path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    APP.get()
        .ok_or("no app")?
        .opener()
        .open_path(path, None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    APP.get()
        .ok_or("no app")?
        .opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn reveal_path(path: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    APP.get()
        .ok_or("no app")?
        .opener()
        .reveal_item_in_dir(&path)
        .map_err(|e| e.to_string())
}

/// Top-level on-disk path holding a torrent's data: the torrent folder for
/// multi-file torrents, or the single file otherwise. Derived from the file
/// paths + info name so it works regardless of the download directory.
fn torrent_root_path(v: &Value) -> Option<String> {
    let info_name = v
        .get("bittorrent")
        .and_then(|b| b.get("info"))
        .and_then(|i| i.get("name"))
        .and_then(|n| n.as_str())
        .filter(|s| !s.is_empty() && !s.starts_with("[METADATA]"))?;
    let files = v.get("files").and_then(|f| f.as_array())?;
    for f in files {
        if let Some(p) = f.get("path").and_then(|p| p.as_str()) {
            let path = std::path::Path::new(p);
            // The deepest ancestor named `info_name` is the torrent's root.
            for anc in path.ancestors() {
                if anc.is_absolute() && anc.file_name().and_then(|n| n.to_str()) == Some(info_name) {
                    return Some(anc.display().to_string());
                }
            }
        }
    }
    None
}

/// Delete every on-disk file for a finished/active task. Torrents remove the
/// whole folder (all files + sub-folders); other downloads remove the single
/// output file. Only ever touches absolute paths.
fn delete_task_files(v: &Value) {
    if v.get("bittorrent").is_some() {
        if let Some(root) = torrent_root_path(v) {
            let p = std::path::PathBuf::from(&root);
            if p.is_dir() {
                let _ = std::fs::remove_dir_all(&p);
            } else {
                let _ = std::fs::remove_file(&p);
            }
            let _ = std::fs::remove_file(format!("{root}.aria2"));
            return;
        }
        // Fall through: delete each listed file if the root couldn't be derived.
    }
    if let Some(files) = v.get("files").and_then(|f| f.as_array()) {
        for f in files {
            if let Some(p) = f.get("path").and_then(|p| p.as_str()) {
                if !p.is_empty() && std::path::Path::new(p).is_absolute() {
                    let _ = std::fs::remove_file(p);
                    let _ = std::fs::remove_file(format!("{p}.aria2"));
                }
            }
        }
    }
}

/// Remove a download from the list AND delete its file(s) from disk.
#[tauri::command]
async fn delete_file(gid: String) -> Result<(), String> {
    // Capture the full record (all files + torrent info) before removing it.
    let mut rec = take_history_value(&gid);
    if gid.starts_with("site-") {
        if let Ok(mut jobs) = site_jobs().lock() {
            if rec.is_none() {
                rec = jobs.iter().find(|j| j.get("gid").and_then(|g| g.as_str()) == Some(gid.as_str())).cloned();
            }
            jobs.retain(|j| j.get("gid").and_then(|g| g.as_str()) != Some(gid.as_str()));
        }
    } else if !gid.starts_with("pend-") {
        if rec.is_none() {
            if let Ok(st) = client()?.tell_status(&gid).await {
                rec = Some(st);
            }
        }
        let _ = client()?.remove(&gid).await;
    }
    if let Some(v) = rec {
        delete_task_files(&v);
    }
    Ok(())
}

/// Rename a completed file in place.
#[tauri::command]
fn rename_file(gid: String, new_name: String) -> Result<String, String> {
    let new_name = new_name.trim();
    if new_name.is_empty() || new_name.contains('/') {
        return Err("invalid name".into());
    }
    let old = history_path(&gid).ok_or("not found")?;
    let src = std::path::PathBuf::from(&old);
    let parent = src.parent().ok_or("no parent")?;
    let dest = parent.join(new_name);
    std::fs::rename(&src, &dest).map_err(|e| e.to_string())?;
    let new_path = dest.display().to_string();
    let np = new_path.clone();
    update_history(&gid, move |j| {
        let len = j.get("files").and_then(|f| f.get(0)).and_then(|f| f.get("length")).cloned().unwrap_or(json!("0"));
        let uris = j.get("files").and_then(|f| f.get(0)).and_then(|f| f.get("uris")).cloned().unwrap_or(json!([]));
        j["files"] = json!([{ "path": np, "length": len, "uris": uris }]);
    });
    Ok(new_path)
}

/// Move a completed file to another folder.
#[tauri::command]
fn move_file(gid: String, new_dir: String) -> Result<String, String> {
    let new_dir = new_dir.trim();
    if new_dir.is_empty() {
        return Err("no folder".into());
    }
    let old = history_path(&gid).ok_or("not found")?;
    let src = std::path::PathBuf::from(&old);
    let name = src.file_name().ok_or("no name")?;
    std::fs::create_dir_all(new_dir).ok();
    let dest = std::path::Path::new(new_dir).join(name);
    if std::fs::rename(&src, &dest).is_err() {
        std::fs::copy(&src, &dest).map_err(|e| e.to_string())?;
        std::fs::remove_file(&src).ok();
    }
    let new_path = dest.display().to_string();
    let np = new_path.clone();
    update_history(&gid, move |j| {
        let len = j.get("files").and_then(|f| f.get(0)).and_then(|f| f.get("length")).cloned().unwrap_or(json!("0"));
        let uris = j.get("files").and_then(|f| f.get(0)).and_then(|f| f.get("uris")).cloned().unwrap_or(json!([]));
        j["files"] = json!([{ "path": np, "length": len, "uris": uris }]);
    });
    Ok(new_path)
}

#[tauri::command]
fn set_organize(enable: bool) {
    ORGANIZE.store(enable, Ordering::Relaxed);
}

// ---- Autostart on login (P5) ----

#[tauri::command]
fn set_autostart(enable: bool) -> Result<(), String> {
    let dir = dirs::config_dir().ok_or("no config dir")?.join("autostart");
    let file = dir.join("downman.desktop");
    if enable {
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let content = format!(
            "[Desktop Entry]\nType=Application\nName=DownMan\nComment=Download manager\nExec={} --hidden\nIcon=downman\nTerminal=false\nX-GNOME-Autostart-enabled=true\n",
            exe.display()
        );
        std::fs::write(&file, content).map_err(|e| e.to_string())?;
    } else {
        let _ = std::fs::remove_file(&file);
    }
    Ok(())
}

#[tauri::command]
fn autostart_enabled() -> bool {
    dirs::config_dir()
        .map(|c| c.join("autostart").join("downman.desktop").exists())
        .unwrap_or(false)
}

// ---- BitTorrent tracker auto-update (P5) ----

async fn fetch_and_apply_trackers() -> Result<usize, String> {
    let url = "https://raw.githubusercontent.com/ngosang/trackerslist/master/trackers_best.txt";
    let txt = reqwest::get(url)
        .await
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())?;
    let list: Vec<&str> = txt.lines().map(|l| l.trim()).filter(|l| !l.is_empty()).collect();
    let count = list.len();
    if count == 0 {
        return Err("empty tracker list".into());
    }
    if let Ok(mut a) = auto_trackers().lock() {
        *a = list.iter().map(|s| s.to_string()).collect();
    }
    apply_trackers().await;
    Ok(count)
}

#[tauri::command]
async fn update_trackers() -> Result<usize, String> {
    fetch_and_apply_trackers().await
}

/// Resolve a human-friendly file name from an aria2 task value.
fn task_name(t: &Value) -> String {
    if let Some(n) = t.get("bittorrent").and_then(|b| b.get("info")).and_then(|i| i.get("name")).and_then(|n| n.as_str()) {
        return n.to_string();
    }
    let p = t
        .get("files")
        .and_then(|f| f.get(0))
        .and_then(|f| f.get("path"))
        .and_then(|p| p.as_str())
        .unwrap_or("download");
    std::path::Path::new(p)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or(p)
        .to_string()
}

/// True for a download that has been replaced by another and must never be
/// shown or recorded: a magnet's metadata fetch (which spawns the real torrent,
/// exposed via `followedBy`) or any `[METADATA]…` placeholder.
fn is_superseded(t: &Value) -> bool {
    if t.get("followedBy").and_then(|v| v.as_array()).map(|a| !a.is_empty()).unwrap_or(false) {
        return true;
    }
    if task_name(t).starts_with("[METADATA]") {
        return true;
    }
    t.get("files")
        .and_then(|f| f.get(0))
        .and_then(|f| f.get("path"))
        .and_then(|p| p.as_str())
        .and_then(|p| std::path::Path::new(p).file_name().and_then(|n| n.to_str()))
        .map(|b| b.starts_with("[METADATA]"))
        .unwrap_or(false)
}

fn notify(title: &str, body: &str) {
    if let Some(app) = APP.get() {
        use tauri_plugin_notification::NotificationExt;
        let _ = app.notification().builder().title(title).body(body).show();
    }
}

/// Best-effort virus scan of a finished file via clamscan.
fn av_scan_path(path: &str) {
    if !AV_SCAN.load(Ordering::Relaxed) || path.is_empty() {
        return;
    }
    if which("clamscan").is_none() {
        return;
    }
    let p = path.to_string();
    std::thread::spawn(move || {
        if let Ok(out) = Command::new("clamscan").arg("--no-summary").arg("-i").arg(&p).output() {
            // clamscan exits 1 when an infection is found.
            if out.status.code() == Some(1) {
                let name = std::path::Path::new(&p).file_name().and_then(|n| n.to_str()).unwrap_or(&p);
                notify("⚠ Threat detected", &format!("{name} was flagged by ClamAV"));
            }
        }
    });
}

fn which(bin: &str) -> Option<String> {
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        let cand = dir.join(bin);
        if cand.is_file() {
            return Some(cand.display().to_string());
        }
    }
    None
}

fn fmt_speed(b: u64) -> String {
    if b >= 1024 * 1024 {
        format!("{:.1} MiB", b as f64 / (1024.0 * 1024.0))
    } else if b >= 1024 {
        format!("{:.0} KiB", b as f64 / 1024.0)
    } else {
        format!("{b} B")
    }
}

/// Offer a copied link as a pending download (confirm sheet + probe).
fn offer_clipboard_download(url: String) {
    if let Ok(p) = pending().lock() {
        if p.iter().any(|x| x.get("url").and_then(|u| u.as_str()) == Some(url.as_str())) {
            return;
        }
    }
    let id = format!("pend-{}", now_ms());
    let is_magnet = url.starts_with("magnet:");
    let fname = if is_magnet { "Magnet link".to_string() } else { url_filename(&url) };
    let cat = if is_magnet { "Torrents".to_string() } else { category_of(&fname).0 };
    notify("DownMan — copied link", &fname);
    if let Ok(mut p) = pending().lock() {
        p.push(json!({
            "id": id, "url": url, "filename": fname, "size": "0", "category": cat,
            "status": if is_magnet { "ready" } else { "probing" }
        }));
    }
    focus_main();
    if !is_magnet {
        let id2 = id.clone();
        tauri::async_runtime::spawn(async move {
            let (fname_opt, size) = probe_url(url, None).await;
            update_pending(&id2, |p| {
                p["size"] = json!(size.to_string());
                if let Some(f) = fname_opt {
                    if !f.trim().is_empty() {
                        p["category"] = json!(category_of(&f).0);
                        p["filename"] = json!(f);
                    }
                }
                p["status"] = json!("ready");
            });
        });
    }
}

/// Background clipboard watcher: offer copied direct-file/magnet/torrent links
/// even while the window is hidden in the tray.
fn start_clipboard_watch() {
    std::thread::spawn(|| {
        let mut cb: Option<arboard::Clipboard> = None;
        let mut last = String::new();
        loop {
            std::thread::sleep(Duration::from_millis(1500));
            if !CLIPBOARD_WATCH.load(Ordering::Relaxed) {
                continue;
            }
            if cb.is_none() {
                cb = arboard::Clipboard::new().ok();
            }
            let Some(c) = cb.as_mut() else { continue };
            let txt = match c.get_text() {
                Ok(t) => t.trim().to_string(),
                Err(_) => continue,
            };
            if txt.is_empty() || txt == last {
                continue;
            }
            last = txt.clone();
            if txt.len() > 2000 {
                continue; // a copied document, not a link
            }
            let first = txt.split_whitespace().next().unwrap_or("");
            if !(first.starts_with("http://") || first.starts_with("https://") || first.starts_with("magnet:?")) {
                continue;
            }
            // Only offer clearly-downloadable links (files, magnets, torrents) —
            // not every page URL the user happens to copy.
            let u = unwrap_media_url(first);
            if u.starts_with("magnet:") || is_torrent_like(&u) || is_direct_file_url(&u) {
                offer_clipboard_download(u);
            }
        }
    });
}

/// True when NetworkManager says the active connection is (probably) metered.
fn metered_now() -> Option<bool> {
    let out = Command::new("busctl")
        .args(["get-property", "org.freedesktop.NetworkManager", "/org/freedesktop/NetworkManager",
               "org.freedesktop.NetworkManager", "Metered"])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let s = String::from_utf8_lossy(&out.stdout);
    let v = s.trim().rsplit(' ').next()?.parse::<u32>().ok()?;
    Some(v == 1 || v == 3) // yes | guess-yes (same reading GNOME uses)
}

/// Pause everything while on a metered connection; resume when it clears.
fn start_metered_watch() {
    std::thread::spawn(|| loop {
        std::thread::sleep(Duration::from_secs(15));
        if !METERED_PAUSE.load(Ordering::Relaxed) {
            if PAUSED_BY_METER.swap(false, Ordering::Relaxed) {
                if let Some(c) = ARIA2.get() {
                    let _ = tauri::async_runtime::block_on(c.unpause_all());
                }
            }
            continue;
        }
        let Some(metered) = metered_now() else { continue };
        let was = PAUSED_BY_METER.load(Ordering::Relaxed);
        if metered && !was {
            if let Some(c) = ARIA2.get() {
                let active = tauri::async_runtime::block_on(c.global_stat()).ok()
                    .and_then(|s| s.get("numActive").and_then(|v| v.as_str()).and_then(|x| x.parse::<u64>().ok()))
                    .unwrap_or(0);
                if active > 0 {
                    let _ = tauri::async_runtime::block_on(c.pause_all());
                    PAUSED_BY_METER.store(true, Ordering::Relaxed);
                    notify("⏸ Paused — metered connection", "Downloads resume automatically off the metered network.");
                }
            }
        } else if !metered && was {
            if let Some(c) = ARIA2.get() {
                let _ = tauri::async_runtime::block_on(c.unpause_all());
            }
            PAUSED_BY_METER.store(false, Ordering::Relaxed);
            notify("▶ Resumed", "Connection is no longer metered.");
        }
    });
}

/// Live telemetry loop: tray tooltip (speed + count), dock/launcher progress via
/// the Unity LauncherEntry DBus protocol, and a sleep inhibitor while busy.
fn start_telemetry() {
    std::thread::spawn(|| {
        let mut last_tip = String::new();
        let mut last_dock = (false, -1i64);
        let has_gdbus = which("gdbus").is_some();
        let has_inhibit = which("systemd-inhibit").is_some();
        loop {
            std::thread::sleep(Duration::from_secs(2));
            let Some(c) = ARIA2.get() else { continue };
            let Ok(stat) = tauri::async_runtime::block_on(c.global_stat()) else { continue };
            let num = |k: &str| stat.get(k).and_then(|v| v.as_str()).and_then(|s| s.parse::<u64>().ok()).unwrap_or(0);
            let speed = num("downloadSpeed");
            let site_active = site_jobs().lock()
                .map(|j| j.iter().filter(|x| x.get("status").and_then(|s| s.as_str()) == Some("active")).count() as u64)
                .unwrap_or(0);
            let busy = num("numActive") + site_active;

            // Tray tooltip: live speed at a glance.
            let tip = if busy > 0 {
                format!("DownMan — ↓ {}/s · {} active", fmt_speed(speed), busy)
            } else {
                "DownMan — idle".to_string()
            };
            if tip != last_tip {
                if let Some(app) = APP.get() {
                    if let Some(tray) = app.tray_by_id("downman-tray") {
                        let _ = tray.set_tooltip(Some(tip.as_str()));
                    }
                }
                last_tip = tip;
            }

            // Dock/launcher progress bar (GNOME/KDE honor the Unity protocol).
            if has_gdbus {
                let mut done = 0u64;
                let mut total = 0u64;
                if let Ok(act) = tauri::async_runtime::block_on(c.tell_active()) {
                    if let Some(arr) = act.as_array() {
                        for t in arr {
                            let g = |k: &str| t.get(k).and_then(|v| v.as_str()).and_then(|s| s.parse::<u64>().ok()).unwrap_or(0);
                            let tl = g("totalLength");
                            if tl > 0 {
                                total += tl;
                                done += g("completedLength");
                            }
                        }
                    }
                }
                let visible = busy > 0 && total > 0;
                let pct = if total > 0 { ((done as f64 / total as f64) * 100.0) as i64 } else { -1 };
                if (visible, pct) != last_dock {
                    last_dock = (visible, pct);
                    let frac = (pct.max(0) as f64) / 100.0;
                    let props = format!(
                        "{{'progress': <{frac:.4}>, 'progress-visible': <{visible}>, 'count': <int64 {busy}>, 'count-visible': <{}>}}",
                        busy > 0
                    );
                    let _ = Command::new("gdbus")
                        .args(["emit", "--session", "--object-path", "/app/downman/LauncherEntry",
                               "--signal", "com.canonical.Unity.LauncherEntry.Update",
                               "application://downman.desktop", &props])
                        .stdout(Stdio::null()).stderr(Stdio::null())
                        .status();
                }
            }

            // Sleep inhibitor: hold while busy, release when idle or disabled.
            let mut guard = inhibitor().lock().unwrap_or_else(|e| e.into_inner());
            if has_inhibit && POWER_BLOCK.load(Ordering::Relaxed) && busy > 0 {
                if guard.is_none() {
                    *guard = Command::new("systemd-inhibit")
                        .args(["--what=sleep:idle", "--who=DownMan", "--why=Downloads in progress", "--mode=block", "sleep", "infinity"])
                        .stdout(Stdio::null()).stderr(Stdio::null())
                        .spawn().ok();
                }
            } else if let Some(mut ch) = guard.take() {
                let _ = ch.kill();
                let _ = ch.wait();
            }
        }
    });
}

/// aria2 reports 0/0 for paused downloads reloaded from a saved session until
/// they are touched. Right after launch, briefly unpause then re-pause each one
/// so the real progress (read from the .aria2 control file) shows immediately.
fn restore_paused() {
    std::thread::spawn(|| {
        std::thread::sleep(Duration::from_secs(3));
        let c = match ARIA2.get() {
            Some(c) => c,
            None => return,
        };
        let waiting = match tauri::async_runtime::block_on(c.tell_waiting()) {
            Ok(w) => w,
            Err(_) => return,
        };
        let paused: Vec<String> = waiting
            .as_array()
            .map(|arr| {
                arr.iter()
                    .filter(|t| t.get("status").and_then(|s| s.as_str()) == Some("paused"))
                    .filter_map(|t| t.get("gid").and_then(|g| g.as_str()).map(String::from))
                    .collect()
            })
            .unwrap_or_default();
        if paused.is_empty() {
            return;
        }
        for gid in &paused {
            let _ = tauri::async_runtime::block_on(c.unpause(gid));
        }
        std::thread::sleep(Duration::from_millis(900));
        for gid in &paused {
            let _ = tauri::async_runtime::block_on(c.pause(gid));
        }
    });
}

/// Background watcher: fires completion notifications, runs AV scans, and
/// powers off the machine when "shutdown when done" is armed.
fn start_watcher() {
    std::thread::spawn(|| {
        let mut seen: HashSet<String> = HashSet::new();
        let mut retried: HashSet<String> = HashSet::new();
        let mut primed = false;
        let mut had_active = false;
        loop {
            std::thread::sleep(Duration::from_secs(2));
            let mut active_count = 0u64;

            // aria2 finished downloads.
            if let Some(c) = ARIA2.get() {
                if let Ok(stat) = tauri::async_runtime::block_on(c.global_stat()) {
                    let a = stat.get("numActive").and_then(|v| v.as_str()).and_then(|s| s.parse::<u64>().ok()).unwrap_or(0);
                    let w = stat.get("numWaiting").and_then(|v| v.as_str()).and_then(|s| s.parse::<u64>().ok()).unwrap_or(0);
                    active_count += a + w;
                }
                if let Ok(stopped) = tauri::async_runtime::block_on(c.tell_stopped()) {
                    if let Some(arr) = stopped.as_array() {
                        for t in arr {
                            if t.get("status").and_then(|s| s.as_str()) != Some("complete") {
                                continue;
                            }
                            let gid = t.get("gid").and_then(|g| g.as_str()).unwrap_or("").to_string();
                            if gid.is_empty() || seen.contains(&gid) {
                                continue;
                            }
                            seen.insert(gid.clone());
                            let name = task_name(t);
                            // A finished download clears its auto-retry history.
                            if let Ok(mut m) = retries().lock() {
                                m.remove(&url_of_task(t));
                            }
                            // A magnet's metadata fetch is superseded by the real torrent it
                            // spawns (via `followedBy`); never record the placeholder as a
                            // finished download.
                            if is_superseded(t) {
                                continue;
                            }
                            // A re-download landed in a temp file: validate + swap it, drop the
                            // ephemeral task, and skip history/notify — the original entry
                            // already represents this file (so no duplicate/junk row lingers).
                            if let Some((final_path, ext)) = redl_target().lock().ok().and_then(|mut m| m.remove(&gid)) {
                                let temp_path = t.get("files").and_then(|f| f.get(0)).and_then(|f| f.get("path")).and_then(|p| p.as_str()).unwrap_or("").to_string();
                                finish_redownload(&temp_path, &final_path, &ext);
                                let _ = tauri::async_runtime::block_on(c.remove(&gid));
                                continue;
                            }
                            let mut path = t.get("files").and_then(|f| f.get(0)).and_then(|f| f.get("path")).and_then(|p| p.as_str()).unwrap_or("").to_string();
                            let is_torrent = t.get("bittorrent").is_some();
                            let skip_org = no_organize().lock().map(|s| s.contains(&gid)).unwrap_or(false);
                            if ORGANIZE.load(Ordering::Relaxed) && !is_torrent && !skip_org && !path.is_empty() {
                                path = organize_path(&path);
                            }
                            // Snapshot the finished download into persistent history.
                            let mut rec = t.clone();
                            rec["status"] = json!("complete");
                            rec["completedAt"] = json!(now_ms() as u64);
                            if is_torrent {
                                // Keep aria2's full multi-file list (per-file path/size/progress)
                                // so the details view shows every file and sub-folder. Torrents
                                // aren't reorganized, so the original absolute paths stay valid.
                            } else {
                                // Single-file downloads may have been moved into a category folder;
                                // store one entry reflecting the final on-disk path.
                                let uris = t.get("files").and_then(|f| f.get(0)).and_then(|f| f.get("uris")).cloned().unwrap_or(json!([]));
                                let len = t.get("totalLength").cloned().unwrap_or(json!("0"));
                                rec["files"] = json!([{ "path": path, "length": len, "uris": uris }]);
                            }
                            record_history(rec);
                            unreserve(&path);
                            // Auto-remove aria2's saved upload-metadata .torrent now it's done.
                            if let Some(meta) = torrent_meta().lock().ok().and_then(|mut m| m.remove(&gid)) {
                                let _ = std::fs::remove_file(&meta);
                            }
                            if primed {
                                notify("✓ Download complete", &name);
                                av_scan_path(&path);
                                maybe_extract(&path);
                                run_on_complete(&gid, &path, &name);
                            }
                        }
                        // ---- Auto-retry transient failures ----
                        // Network-ish errors get re-added with backoff (max 3 tries);
                        // hard failures (404, disk full, duplicate) stay as errors.
                        for t in arr {
                            if t.get("status").and_then(|s| s.as_str()) != Some("error") {
                                continue;
                            }
                            let gid = t.get("gid").and_then(|g| g.as_str()).unwrap_or("").to_string();
                            if gid.is_empty() || retried.contains(&gid) {
                                continue;
                            }
                            retried.insert(gid.clone());
                            if !primed {
                                continue; // failures that pre-date this session aren't ours to retry
                            }
                            let code = t.get("errorCode").and_then(|x| x.as_str()).and_then(|s| s.parse::<u32>().ok()).unwrap_or(0);
                            if !matches!(code, 1 | 2 | 5 | 6 | 19 | 22 | 23) {
                                continue;
                            }
                            let url = url_of_task(t);
                            if !url.starts_with("http") {
                                continue;
                            }
                            let n = {
                                let mut m = retries().lock().unwrap_or_else(|e| e.into_inner());
                                let e = m.entry(url.clone()).or_insert(0);
                                *e += 1;
                                *e
                            };
                            if n > 3 {
                                continue;
                            }
                            let dir = t.get("dir").and_then(|d| d.as_str()).unwrap_or("").to_string();
                            let out = t.get("files").and_then(|f| f.get(0)).and_then(|f| f.get("path")).and_then(|p| p.as_str())
                                .and_then(|p| p.strip_prefix(&format!("{dir}/")).map(String::from))
                                .filter(|s| !s.is_empty() && !s.contains('/'));
                            let gid2 = gid.clone();
                            std::thread::spawn(move || {
                                std::thread::sleep(Duration::from_secs(5u64 << (n - 1).min(3)));
                                let Some(c) = ARIA2.get() else { return };
                                let mut opts = serde_json::Map::new();
                                if !dir.is_empty() {
                                    opts.insert("dir".into(), json!(dir));
                                }
                                if let Some(o) = out {
                                    opts.insert("out".into(), json!(o));
                                }
                                if tauri::async_runtime::block_on(c.add_uri(vec![url], Value::Object(opts))).is_ok() {
                                    let _ = tauri::async_runtime::block_on(c.remove(&gid2));
                                }
                            });
                        }
                    }
                }
            }

            // yt-dlp site jobs: count active, harvest completed into history.
            let mut newly_site: Vec<Value> = Vec::new();
            if let Ok(jobs) = site_jobs().lock() {
                for j in jobs.iter() {
                    let status = j.get("status").and_then(|s| s.as_str()).unwrap_or("");
                    if status == "active" {
                        active_count += 1;
                    }
                    if status != "complete" {
                        continue;
                    }
                    let gid = j.get("gid").and_then(|g| g.as_str()).unwrap_or("").to_string();
                    if gid.is_empty() || seen.contains(&gid) {
                        continue;
                    }
                    seen.insert(gid.clone());
                    newly_site.push(j.clone());
                }
            }
            for j in &newly_site {
                let path = j.get("files").and_then(|f| f.get(0)).and_then(|f| f.get("path")).and_then(|p| p.as_str()).unwrap_or("").to_string();
                let mut rec = j.clone();
                rec["completedAt"] = json!(now_ms() as u64);
                record_history(rec);
                if primed {
                    let name = std::path::Path::new(&path).file_name().and_then(|n| n.to_str()).unwrap_or("video").to_string();
                    notify("✓ Download complete", &name);
                }
            }
            if !newly_site.is_empty() {
                let gids: HashSet<String> = newly_site.iter().filter_map(|j| j.get("gid").and_then(|g| g.as_str()).map(String::from)).collect();
                if let Ok(mut jobs) = site_jobs().lock() {
                    jobs.retain(|j| !gids.contains(j.get("gid").and_then(|g| g.as_str()).unwrap_or("")));
                }
            }
            primed = true;

            // Enforce queue rules (pause/resume members, per-queue caps, on-complete).
            tauri::async_runtime::block_on(gate_queues());

            // Power off once everything that was running has drained.
            if SHUTDOWN_WHEN_DONE.load(Ordering::Relaxed) {
                if active_count > 0 {
                    had_active = true;
                } else if had_active {
                    notify("Shutting down", "All downloads finished — powering off.");
                    std::thread::sleep(Duration::from_secs(3));
                    let _ = Command::new("systemctl").arg("poweroff").status();
                    had_active = false;
                }
            } else {
                had_active = false;
            }
        }
    });
}

// ===================== Site Grabber (web crawler) =====================

struct GrabState {
    status: String,
    pages: u64,
    files: Vec<Value>,
    seen: HashSet<String>,
    cancel: Arc<AtomicBool>,
    project: Value,
}

static GRABS: OnceCell<Mutex<HashMap<String, GrabState>>> = OnceCell::new();
fn grabs() -> &'static Mutex<HashMap<String, GrabState>> {
    GRABS.get_or_init(|| Mutex::new(HashMap::new()))
}

static ANCHOR_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r#"(?is)<a\b[^>]*?href\s*=\s*["']([^"']+)["'][^>]*?>(.*?)</a>"#).unwrap());
static HREF_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r#"(?i)href\s*=\s*["']([^"']+)["']"#).unwrap());
static SRC_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r#"(?i)(?:src|data-src|data-original|poster)\s*=\s*["']([^"']+)["']"#).unwrap());
static SRCSET_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r#"(?i)srcset\s*=\s*["']([^"']+)["']"#).unwrap());
static JSURL_RE: Lazy<Regex> = Lazy::new(|| Regex::new(r#"(?i)["'](https?://[^"'\s]+\.[a-z0-9]{2,6}(?:\?[^"'\s]*)?)["']"#).unwrap());

fn strip_tags(s: &str) -> String {
    let mut out = String::new();
    let mut in_tag = false;
    for ch in s.chars() {
        match ch {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(ch),
            _ => {}
        }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(80).collect()
}

fn host_of(url: &str) -> String {
    reqwest::Url::parse(url).ok().and_then(|u| u.host_str().map(|h| h.to_string())).unwrap_or_default()
}

fn registrable(host: &str) -> String {
    let parts: Vec<&str> = host.split('.').collect();
    if parts.len() >= 2 {
        parts[parts.len() - 2..].join(".")
    } else {
        host.to_string()
    }
}

fn ext_of(url: &str) -> String {
    let path = reqwest::Url::parse(url).ok().map(|u| u.path().to_string()).unwrap_or_default();
    let seg = path.rsplit('/').next().unwrap_or("");
    if let Some(dot) = seg.rfind('.') {
        let e = &seg[dot + 1..];
        if !e.is_empty() && e.len() <= 6 && e.chars().all(|c| c.is_ascii_alphanumeric()) {
            return e.to_lowercase();
        }
    }
    String::new()
}

fn grab_file_name(url: &str) -> String {
    reqwest::Url::parse(url)
        .ok()
        .and_then(|u| u.path_segments().and_then(|s| s.last().map(|x| x.to_string())))
        .filter(|s| !s.is_empty())
        .map(|s| percent_decode(&s))
        .unwrap_or_else(|| url.to_string())
}

/// Make a single path segment safe to use as a folder name.
fn sanitize_seg(s: &str) -> String {
    let t: String = s
        .chars()
        .map(|c| if c == '/' || c == '\\' || c == ':' || c == '*' || c == '?' || c == '"' || c == '<' || c == '>' || c == '|' || c.is_control() { '_' } else { c })
        .collect();
    let t = t.trim().trim_matches('.').to_string();
    if t == "." || t == ".." {
        String::new()
    } else {
        t
    }
}

/// The directory part of a URL path (everything but the filename), sanitized.
fn url_path_dir(url: &str) -> String {
    if let Ok(u) = reqwest::Url::parse(url) {
        if let Some(segs) = u.path_segments() {
            let parts: Vec<String> = segs.map(percent_decode).collect();
            if parts.len() > 1 {
                return parts[..parts.len() - 1]
                    .iter()
                    .map(|s| sanitize_seg(s))
                    .filter(|s| !s.is_empty())
                    .collect::<Vec<_>>()
                    .join("/");
            }
        }
    }
    String::new()
}

fn grab_filters(v: Option<&Value>) -> Vec<String> {
    v.and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|x| x.as_str())
                .map(|s| s.trim().trim_start_matches("*.").trim_start_matches('.').to_lowercase())
                .filter(|s| !s.is_empty() && s != "*")
                .collect()
        })
        .unwrap_or_default()
}

fn grab_filter_match(ext: &str, include: &[String], exclude: &[String]) -> bool {
    if ext.is_empty() {
        return false;
    }
    if exclude.iter().any(|e| e == ext) {
        return false;
    }
    if include.is_empty() {
        return true;
    }
    include.iter().any(|e| e == ext)
}

fn is_page_ext(ext: &str) -> bool {
    ext.is_empty() || matches!(ext, "html" | "htm" | "php" | "asp" | "aspx" | "jsp" | "cgi" | "xhtml" | "shtml")
}

fn push_link(base: &reqwest::Url, raw: &str, text: String, out: &mut Vec<(String, String)>, seen: &mut HashSet<String>) {
    let raw = raw.trim();
    if raw.is_empty() || raw.starts_with('#') || raw.starts_with("mailto:") || raw.starts_with("javascript:") || raw.starts_with("data:") || raw.starts_with("tel:") {
        return;
    }
    if let Ok(mut abs) = base.join(raw) {
        if abs.scheme() != "http" && abs.scheme() != "https" {
            return;
        }
        abs.set_fragment(None);
        let s = abs.to_string();
        if seen.insert(s.clone()) {
            out.push((s, text));
        }
    }
}

fn extract_links(html: &str, base_url: &str, process_js: bool) -> Vec<(String, String)> {
    let base = match reqwest::Url::parse(base_url) {
        Ok(b) => b,
        Err(_) => return vec![],
    };
    let mut out: Vec<(String, String)> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    for cap in ANCHOR_RE.captures_iter(html) {
        let href = cap.get(1).map(|m| m.as_str()).unwrap_or("");
        let text = strip_tags(cap.get(2).map(|m| m.as_str()).unwrap_or(""));
        push_link(&base, href, text, &mut out, &mut seen);
    }
    for cap in HREF_RE.captures_iter(html) {
        push_link(&base, cap.get(1).map(|m| m.as_str()).unwrap_or(""), String::new(), &mut out, &mut seen);
    }
    for cap in SRC_RE.captures_iter(html) {
        push_link(&base, cap.get(1).map(|m| m.as_str()).unwrap_or(""), String::new(), &mut out, &mut seen);
    }
    for cap in SRCSET_RE.captures_iter(html) {
        for part in cap.get(1).map(|m| m.as_str()).unwrap_or("").split(',') {
            if let Some(u) = part.trim().split_whitespace().next() {
                push_link(&base, u, String::new(), &mut out, &mut seen);
            }
        }
    }
    if process_js {
        for cap in JSURL_RE.captures_iter(html) {
            push_link(&base, cap.get(1).map(|m| m.as_str()).unwrap_or(""), String::new(), &mut out, &mut seen);
        }
    }
    out
}

async fn fetch_text(client: &reqwest::Client, url: &str, referer: &Option<String>, cookies: &Option<String>) -> Option<String> {
    let mut req = client.get(url);
    if let Some(r) = referer {
        if !r.is_empty() {
            req = req.header(reqwest::header::REFERER, r.clone());
        }
    }
    if let Some(c) = cookies {
        if !c.is_empty() {
            req = req.header(reqwest::header::COOKIE, c.clone());
        }
    }
    let resp = req.send().await.ok()?;
    let ct = resp.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or("").to_lowercase();
    if !ct.is_empty() && !ct.contains("html") && !ct.contains("xml") && !ct.contains("text") {
        return None;
    }
    let body = resp.text().await.ok()?;
    if body.len() > 4_000_000 {
        let mut n = 4_000_000;
        while n > 0 && !body.is_char_boundary(n) {
            n -= 1;
        }
        return Some(body[..n].to_string());
    }
    Some(body)
}

async fn run_crawl(id: String, project: Value, cancel: Arc<AtomicBool>) {
    let start = project.get("url").and_then(|u| u.as_str()).unwrap_or("").to_string();
    if start.is_empty() {
        if let Ok(mut g) = grabs().lock() {
            if let Some(st) = g.get_mut(&id) {
                st.status = "error".into();
            }
        }
        return;
    }
    let levels = project.get("levels").and_then(|v| v.as_i64()).unwrap_or(1) as i32;
    let other_levels = project.get("otherLevels").and_then(|v| v.as_i64()).unwrap_or(0) as i32;
    let same_site_only = project.get("sameSiteOnly").and_then(|v| v.as_bool()).unwrap_or(false);
    let whole_domain = project.get("wholeDomain").and_then(|v| v.as_bool()).unwrap_or(true);
    let process_js = project.get("processJs").and_then(|v| v.as_bool()).unwrap_or(false);
    let include = grab_filters(project.get("include"));
    let exclude = grab_filters(project.get("exclude"));
    let referer = project.get("referer").and_then(|v| v.as_str()).map(String::from);
    let cookies = project.get("cookies").and_then(|v| v.as_str()).map(String::from);
    let base_host = host_of(&start);
    let reg_domain = registrable(&base_host);

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(12))
        .user_agent("Mozilla/5.0 (X11; Linux x86_64) DownMan-SiteGrabber")
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    let max_pages = 400usize;
    let max_files = 3000usize;
    let mut frontier: VecDeque<(String, i32)> = VecDeque::new();
    frontier.push_back((start.clone(), 0));
    let mut visited: HashSet<String> = HashSet::new();

    while let Some((url, depth)) = frontier.pop_front() {
        if cancel.load(Ordering::Relaxed) || visited.len() >= max_pages {
            break;
        }
        if visited.contains(&url) {
            continue;
        }
        visited.insert(url.clone());

        let html = fetch_text(&client, &url, &referer, &cookies).await;
        if let Ok(mut g) = grabs().lock() {
            if let Some(st) = g.get_mut(&id) {
                st.pages += 1;
            }
        }
        let html = match html {
            Some(h) => h,
            None => continue,
        };

        for (link, text) in extract_links(&html, &url, process_js) {
            let lh = host_of(&link);
            let same_domain = if whole_domain {
                lh == base_host || lh == reg_domain || lh.ends_with(&format!(".{}", reg_domain))
            } else {
                lh == base_host
            };
            let ext = ext_of(&link);

            if grab_filter_match(&ext, &include, &exclude) {
                if let Ok(mut g) = grabs().lock() {
                    if let Some(st) = g.get_mut(&id) {
                        if st.files.len() < max_files && st.seen.insert(link.clone()) {
                            st.files.push(json!({
                                "url": link.clone(), "name": grab_file_name(&link),
                                "type": ext.to_uppercase(), "size": -1,
                                "linkText": text, "source": url.clone(), "host": lh.clone()
                            }));
                        }
                    }
                }
            }

            if is_page_ext(&ext) {
                let allow = if same_domain {
                    depth + 1 <= levels
                } else {
                    !same_site_only && depth + 1 <= other_levels
                };
                if allow && !visited.contains(&link) && frontier.len() < 8000 {
                    frontier.push_back((link, depth + 1));
                }
            }
        }
    }

    if let Ok(mut g) = grabs().lock() {
        if let Some(st) = g.get_mut(&id) {
            if st.status == "exploring" {
                st.status = if cancel.load(Ordering::Relaxed) { "cancelled".into() } else { "done".into() };
            }
        }
    }
}

#[tauri::command]
fn grabber_start(project: Value) -> String {
    let id = format!("grab-{}", now_ms());
    let cancel = Arc::new(AtomicBool::new(false));
    if let Ok(mut g) = grabs().lock() {
        if g.len() > 8 {
            let done: Vec<String> = g.iter().filter(|(_, s)| s.status != "exploring").map(|(k, _)| k.clone()).collect();
            for k in done {
                g.remove(&k);
            }
        }
        g.insert(
            id.clone(),
            GrabState { status: "exploring".into(), pages: 0, files: vec![], seen: HashSet::new(), cancel: cancel.clone(), project: project.clone() },
        );
    }
    let id2 = id.clone();
    tauri::async_runtime::spawn(async move {
        run_crawl(id2, project, cancel).await;
    });
    id
}

#[tauri::command]
fn grabber_get(id: String) -> Value {
    if let Ok(g) = grabs().lock() {
        if let Some(st) = g.get(&id) {
            return json!({ "status": st.status, "pages": st.pages, "total": st.files.len(), "files": st.files });
        }
    }
    json!({ "status": "unknown", "pages": 0, "total": 0, "files": [] })
}

#[tauri::command]
fn grabber_cancel(id: String) {
    if let Ok(mut g) = grabs().lock() {
        if let Some(st) = g.get_mut(&id) {
            st.cancel.store(true, Ordering::Relaxed);
            if st.status == "exploring" {
                st.status = "cancelled".into();
            }
        }
    }
}

#[tauri::command]
async fn grabber_download(id: String, urls: Vec<String>) -> Result<(), String> {
    let (referer, cookies, layout) = {
        let g = grabs().lock().map_err(|_| "lock")?;
        let st = g.get(&id).ok_or("not found")?;
        (
            st.project.get("referer").and_then(|v| v.as_str()).map(String::from),
            st.project.get("cookies").and_then(|v| v.as_str()).map(String::from),
            st.project.get("layout").and_then(|v| v.as_str()).unwrap_or("site").to_string(),
        )
    };
    let c = client()?;
    for url in urls {
        let mut opts = serde_json::Map::new();
        if let Some(r) = &referer {
            if !r.is_empty() {
                opts.insert("referer".into(), json!(r));
            }
        }
        if let Some(ck) = &cookies {
            if !ck.is_empty() {
                opts.insert("header".into(), json!([format!("Cookie: {}", ck)]));
            }
        }
        let fname = url_filename(&url);
        let host = sanitize_seg(&host_of(&url));
        let base = download_dir().join("SiteGrab").join(if host.is_empty() { "site".to_string() } else { host });
        let tdir = match layout.as_str() {
            "type" => base.join(category_of(&fname).0),
            "flat" => base,
            _ => {
                let pd = url_path_dir(&url);
                if pd.is_empty() { base } else { base.join(pd) }
            }
        };
        let out = unique_out(&tdir, &fname);
        opts.insert("dir".into(), json!(tdir.display().to_string()));
        opts.insert("out".into(), json!(out));
        mark_grabbed(&url);
        if let Ok(gid) = c.add_uri(vec![url], Value::Object(opts)).await {
            if let Ok(mut s) = no_organize().lock() {
                s.insert(gid);
            }
        }
    }
    Ok(())
}

// ===================== Phase 7: archive extract + remote web UI =====================

fn unique_dir(parent: &std::path::Path, stem: &str) -> std::path::PathBuf {
    let mut d = parent.join(stem);
    let mut n = 1;
    while d.exists() {
        d = parent.join(format!("{stem} ({n})"));
        n += 1;
    }
    d
}

fn extract_archive(path: &str, lname: &str, dest: &std::path::Path) -> bool {
    std::fs::create_dir_all(dest).ok();
    let dest_s = dest.display().to_string();
    let run = |bin: &str, args: &[&str]| Command::new(bin).args(args).status().map(|s| s.success()).unwrap_or(false);
    if lname.ends_with(".zip") {
        if which("unzip").is_some() {
            return run("unzip", &["-o", path, "-d", &dest_s]);
        }
        if which("7z").is_some() {
            return run("7z", &["x", "-y", &format!("-o{dest_s}"), path]);
        }
    } else if lname.ends_with(".rar") {
        if which("unrar").is_some() {
            return run("unrar", &["x", "-o+", path, &format!("{dest_s}/")]);
        }
        if which("7z").is_some() {
            return run("7z", &["x", "-y", &format!("-o{dest_s}"), path]);
        }
    } else if lname.ends_with(".7z") {
        if which("7z").is_some() {
            return run("7z", &["x", "-y", &format!("-o{dest_s}"), path]);
        }
    } else if lname.ends_with(".tar.gz") || lname.ends_with(".tgz") || lname.ends_with(".tar.xz") || lname.ends_with(".tar.bz2") || lname.ends_with(".tar") {
        if which("tar").is_some() {
            return run("tar", &["xf", path, "-C", &dest_s]);
        }
    }
    false
}

fn maybe_extract(path: &str) {
    if !AUTO_EXTRACT.load(Ordering::Relaxed) {
        return;
    }
    let p = std::path::PathBuf::from(path);
    let lname = p.file_name().and_then(|n| n.to_str()).unwrap_or("").to_lowercase();
    let is_archive = [".zip", ".rar", ".7z", ".tar.gz", ".tgz", ".tar.xz", ".tar.bz2", ".tar"].iter().any(|e| lname.ends_with(e));
    if !is_archive {
        return;
    }
    let parent = match p.parent() {
        Some(d) => d.to_path_buf(),
        None => return,
    };
    let mut stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("archive").to_string();
    if let Some(s) = stem.strip_suffix(".tar") {
        stem = s.to_string();
    }
    let dest = unique_dir(&parent, &stem);
    let path_s = path.to_string();
    std::thread::spawn(move || {
        if extract_archive(&path_s, &lname, &dest) {
            let label = dest.file_name().and_then(|n| n.to_str()).unwrap_or("archive").to_string();
            notify("✓ Extracted", &label);
        }
    });
}

#[tauri::command]
fn set_auto_extract(enable: bool) {
    AUTO_EXTRACT.store(enable, Ordering::Relaxed);
}

fn remote_token() -> &'static str {
    REMOTE_TOKEN.get_or_init(|| {
        let mut rng = rand::thread_rng();
        (0..32)
            .map(|_| b"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"[rng.gen_range(0..62)] as char)
            .collect()
    })
}

fn local_ip() -> String {
    std::net::UdpSocket::bind("0.0.0.0:0")
        .ok()
        .and_then(|s| {
            s.connect("8.8.8.8:80").ok()?;
            s.local_addr().ok()
        })
        .map(|a| a.ip().to_string())
        .unwrap_or_else(|| "127.0.0.1".to_string())
}

#[tauri::command]
fn remote_info() -> Value {
    json!({
        "enabled": REMOTE_ENABLED.load(Ordering::Relaxed),
        "token": remote_token(),
        "url": format!("http://{}:6803/?t={}", local_ip(), remote_token())
    })
}

/// Info about the browser-extension bridge — port, running status, last ping timestamp.
#[tauri::command]
fn bridge_info() -> Value {
    json!({
        "port": 6802,
        "url": "http://127.0.0.1:6802",
        "running": true,
        "extensionFolder": "extensions",
        "lastPingMs": LAST_BRIDGE_PING.load(Ordering::Relaxed),
    })
}

/// Resolve the bundled extension folder path and the pre-built .zip/.xpi archives.
/// In dev mode falls back to the workspace `extensions/` folder.
#[tauri::command]
fn extension_paths() -> Value {
    let app = match APP.get() { Some(a) => a, None => return json!({}) };
    // In a dev (debug) build, always use the live source `extensions/` folder (from
    // the compile-time source tree) so edits are reflected without re-bundling — the
    // copy Tauri stages under target/ during a build goes stale between rebuilds. In
    // release, use the bundled resource copy, falling back to the dev tree.
    let bundled = app.path().resource_dir().unwrap_or_default().join("extensions");
    let ext_dir = if cfg!(debug_assertions) {
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../extensions")
            .canonicalize().unwrap_or_else(|_| bundled.clone())
    } else if bundled.exists() {
        bundled
    } else {
        std::env::current_dir().unwrap_or_default().join("extensions")
    };
    let crx = ext_dir.join("DownMan.zip");
    // Prefer the AMO-signed xpi (installs permanently); fall back to the unsigned build.
    let signed = ext_dir.join("DownMan-signed.xpi");
    let xpi_signed = signed.exists();
    let xpi = if xpi_signed { signed } else { ext_dir.join("DownMan.xpi") };
    json!({
        "dir": ext_dir.display().to_string(),
        "dirExists": ext_dir.exists(),
        "crx": crx.display().to_string(),
        "crxExists": crx.exists(),
        "xpi": xpi.display().to_string(),
        "xpiExists": xpi.exists(),
        "xpiSigned": xpi_signed,
    })
}

#[tauri::command]
fn set_remote(enable: bool) -> Value {
    REMOTE_ENABLED.store(enable, Ordering::Relaxed);
    if enable && !REMOTE_STARTED.swap(true, Ordering::Relaxed) {
        start_remote_server();
    }
    remote_info()
}

fn remote_list_json() -> Value {
    let c = match ARIA2.get() {
        Some(c) => c,
        None => return json!({ "downloads": [] }),
    };
    let mut items: Vec<Value> = Vec::new();
    let fetches = [
        tauri::async_runtime::block_on(c.tell_active()),
        tauri::async_runtime::block_on(c.tell_waiting()),
        tauri::async_runtime::block_on(c.tell_stopped()),
    ];
    for f in fetches {
        if let Ok(a) = f {
            if let Some(list) = a.as_array() {
                for t in list {
                    items.push(json!({
                        "gid": t.get("gid").and_then(|g| g.as_str()).unwrap_or(""),
                        "name": task_name(t),
                        "status": t.get("status").and_then(|s| s.as_str()).unwrap_or(""),
                        "total": t.get("totalLength").and_then(|s| s.as_str()).unwrap_or("0"),
                        "done": t.get("completedLength").and_then(|s| s.as_str()).unwrap_or("0"),
                        "speed": t.get("downloadSpeed").and_then(|s| s.as_str()).unwrap_or("0")
                    }));
                }
            }
        }
    }
    json!({ "downloads": items })
}

fn rq_param(url: &str, key: &str) -> Option<String> {
    let q = url.split('?').nth(1)?;
    for pair in q.split('&') {
        let mut it = pair.splitn(2, '=');
        if it.next() == Some(key) {
            return Some(percent_decode(it.next().unwrap_or("")));
        }
    }
    None
}

fn start_remote_server() {
    std::thread::spawn(|| {
        let server = match tiny_http::Server::http("0.0.0.0:6803") {
            Ok(s) => s,
            Err(_) => return,
        };
        for req in server.incoming_requests() {
            let url = req.url().to_string();
            let path = url.split('?').next().unwrap_or("/").to_string();
            let authed = REMOTE_ENABLED.load(Ordering::Relaxed) && rq_param(&url, "t").as_deref() == Some(remote_token());
            if !authed {
                let _ = req.respond(tiny_http::Response::from_string("Forbidden").with_status_code(403));
                continue;
            }
            let html_ct = tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"text/html; charset=utf-8"[..]).unwrap();
            let json_ct = tiny_http::Header::from_bytes(&b"Content-Type"[..], &b"application/json"[..]).unwrap();
            match path.as_str() {
                "/" => {
                    let _ = req.respond(tiny_http::Response::from_string(REMOTE_HTML).with_header(html_ct));
                }
                "/list" => {
                    let _ = req.respond(tiny_http::Response::from_string(remote_list_json().to_string()).with_header(json_ct));
                }
                "/pause" => {
                    if let (Some(c), Some(g)) = (ARIA2.get(), rq_param(&url, "gid")) {
                        let _ = tauri::async_runtime::block_on(c.pause(&g));
                    }
                    let _ = req.respond(tiny_http::Response::from_string("{}").with_header(json_ct));
                }
                "/resume" => {
                    if let (Some(c), Some(g)) = (ARIA2.get(), rq_param(&url, "gid")) {
                        let _ = tauri::async_runtime::block_on(c.unpause(&g));
                    }
                    let _ = req.respond(tiny_http::Response::from_string("{}").with_header(json_ct));
                }
                "/pauseall" => {
                    if let Some(c) = ARIA2.get() {
                        let _ = tauri::async_runtime::block_on(c.pause_all());
                    }
                    let _ = req.respond(tiny_http::Response::from_string("{}").with_header(json_ct));
                }
                "/resumeall" => {
                    if let Some(c) = ARIA2.get() {
                        let _ = tauri::async_runtime::block_on(c.unpause_all());
                    }
                    let _ = req.respond(tiny_http::Response::from_string("{}").with_header(json_ct));
                }
                "/add" => {
                    if let (Some(c), Some(u)) = (ARIA2.get(), rq_param(&url, "uri")) {
                        if u.starts_with("http") || u.starts_with("magnet:") {
                            let fname = url_filename(&u);
                            let tdir = if ORGANIZE.load(Ordering::Relaxed) { category_of(&fname).1 } else { download_dir() };
                            let out = unique_out(&tdir, &fname);
                            let opts = json!({ "dir": tdir.display().to_string(), "out": out });
                            if let Ok(gid) = tauri::async_runtime::block_on(c.add_uri(vec![u], opts)) {
                                if let Ok(mut s) = no_organize().lock() {
                                    s.insert(gid);
                                }
                            }
                        }
                    }
                    let _ = req.respond(tiny_http::Response::from_string("{}").with_header(json_ct));
                }
                _ => {
                    let _ = req.respond(tiny_http::Response::from_string("Not found").with_status_code(404));
                }
            }
        }
    });
}

const REMOTE_HTML: &str = r##"<!doctype html><html><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>DownMan Remote</title><style>body{font-family:system-ui,sans-serif;background:#0b0d17;color:#e2e8f0;margin:0;padding:12px}h1{font-size:18px;margin:0 0 12px}.row{background:#161a2b;border:1px solid #ffffff14;border-radius:10px;padding:10px;margin-bottom:8px}.bar{height:6px;background:#2a3050;border-radius:99px;overflow:hidden;margin-top:6px}.fill{height:100%;background:linear-gradient(90deg,#0a74f0,#cf2ea0)}.n{font-size:13px;word-break:break-all}.m{font-size:11px;color:#94a3b8;display:flex;justify-content:space-between;margin-top:4px}button{background:#0a74f0;color:#fff;border:0;border-radius:8px;padding:6px 10px;font-size:12px;margin-right:6px}input{background:#0b0d17;border:1px solid #ffffff22;color:#e2e8f0;border-radius:8px;padding:8px;width:100%;box-sizing:border-box;margin-bottom:8px}.top{display:flex;gap:6px;margin-bottom:10px}</style></head><body><h1>DownMan Remote</h1><input id=u placeholder="Paste a link to add…"><div class=top><button onclick=add()>Add</button><button onclick="api('/pauseall')">Pause all</button><button onclick="api('/resumeall')">Resume all</button></div><div id=list></div><script>var T=new URLSearchParams(location.search).get('t');function q(p){return p+(p.indexOf('?')<0?'?':'&')+'t='+encodeURIComponent(T)}function api(p){return fetch(q(p)).then(function(r){return r.json()}).catch(function(){})}function add(){var u=document.getElementById('u').value.trim();if(u){api('/add?uri='+encodeURIComponent(u));document.getElementById('u').value=''}}function esc(s){return (s||'').replace(/[&<>]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;'}[c]})}function hs(b){b=+b||0;if(!b)return'';var u=['B','KB','MB','GB','TB'],i=0;while(b>=1024&&i<4){b/=1024;i++}return b.toFixed(1)+u[i]}function load(){fetch(q('/list')).then(function(r){return r.json()}).then(function(d){var h='';(d.downloads||[]).forEach(function(t){var pct=+t.total>0?Math.min(100,100*t.done/t.total):0;var act=t.status=='active';h+='<div class=row><div class=n>'+esc(t.name)+'</div><div class=bar><div class=fill style="width:'+pct+'%"></div></div><div class=m><span>'+hs(t.done)+' / '+hs(t.total)+' · '+pct.toFixed(0)+'%</span><span>'+(act?hs(t.speed)+'/s':t.status)+'</span></div><div style=margin-top:6px>'+(act?'<button onclick="api(\'/pause?gid='+t.gid+'\').then(load)">Pause</button>':'<button onclick="api(\'/resume?gid='+t.gid+'\').then(load)">Resume</button>')+'</div></div>'});document.getElementById('list').innerHTML=h||'<p style=color:#94a3b8>No downloads.</p>'}).catch(function(){})}load();setInterval(load,1500);</script></body></html>"##;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|_app, _argv, _cwd| {
            // Second launch: reveal the already-running (possibly hidden) window
            // instead of starting a second copy. This is the reliable way back in
            // when the tray isn't visible (GNOME without an indicator extension).
            focus_main();
        }))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                // Keep DownMan running in the background; only an explicit Quit
                // (tray or Settings) actually exits.
                api.prevent_close();
                let _ = window.hide();
                notify_background_once();
            }
        })
        .setup(|app| {
            APP.set(app.handle().clone()).ok();
            load_dl_dir();
            load_history();
            load_rules();
            load_categories();
            load_queues();
            load_qmember();
            load_grabbed();
            load_trackers();
            load_history_limit();
            load_on_complete();
            load_dl_meta();
            load_ytdlp_cfg();
            match start_engine() {
                Ok(child) => {
                    app.manage(EngineProc(Mutex::new(Some(child))));
                }
                Err(e) => eprintln!("DownMan engine: {e}"),
            }
            start_bridge();
            start_watcher();
            restore_paused();

            // Refresh BitTorrent trackers on launch and once a day after.
            std::thread::spawn(|| loop {
                std::thread::sleep(Duration::from_secs(5));
                let _ = tauri::async_runtime::block_on(fetch_and_apply_trackers());
                std::thread::sleep(Duration::from_secs(24 * 3600));
            });

            // Keep yt-dlp current on our own schedule (independent of the distro
            // package): check on launch and once a day; only downloads when a newer
            // release exists. First run with nothing usable fetches one immediately.
            std::thread::spawn(|| loop {
                std::thread::sleep(Duration::from_secs(5));
                tauri::async_runtime::block_on(ytdlp_autoupdate_tick());
                std::thread::sleep(Duration::from_secs(24 * 3600));
            });

            // Explicitly set the live window icon. On Linux the bundle/config icon is
            // only applied to the installed .desktop entry, not the running window, so
            // the titlebar/taskbar would otherwise show a generic icon in dev.
            if let Some(win) = app.get_webview_window("main") {
                if let Ok(img) = tauri::image::Image::from_bytes(include_bytes!("../icons/icon.png")) {
                    let _ = win.set_icon(img);
                }
            }

            // The window is created visible so its title-bar decorations initialise
            // correctly on Linux/Wayland — a window that is hidden and later re-shown
            // leaves min/max/close inert until its surface is reconfigured. So we only
            // start hidden when the autostart entry launched us with `--hidden`; a manual
            // launch always shows the window, with working controls. (Reopening from the
            // tray re-arms the buttons via `rearm_window_controls`.)
            let start_hidden = std::env::args().any(|a| a == "--hidden");
            if start_hidden {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.hide();
                }
            }

            // System tray — best-effort (some Linux desktops need an indicator extension).
            // Tray gives quick Show/Pause/Resume/Quit while running. We deliberately do NOT
            // hide-on-close, because a tray icon can be invisible on GNOME without an
            // extension, which would strand the window with no way to restore it.
            let _ = build_tray(app);
            start_clipboard_watch();
            start_metered_watch();
            start_telemetry();
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            add_download,
            pause,
            resume,
            pause_all,
            resume_all,
            remove,
            snapshot,
            organize,
            grab_hls,
            grab_site,
            redownload,
            clear_gone,
            clear_cache,
            list_formats,
            set_global_option,
            engine_info,
            set_download_limit,
            reorder,
            set_selected_files,
            add_torrent,
            add_metalink,
            set_shutdown_when_done,
            set_av_scan,
            set_auto_extract,
            set_remote,
            remote_info,
            set_autostart,
            autostart_enabled,
            update_trackers,
            set_download_dir,
            get_trackers,
            set_trackers,
            add_trackers,
            clear_grab_request,
            get_rules,
            set_rules,
            get_categories,
            set_categories,
            get_queues,
            set_queues,
            set_queue_running,
            assign_queue,
            grabber_start,
            grabber_get,
            grabber_cancel,
            grabber_download,
            set_confirm_downloads,
            confirm_pending,
            cancel_pending,
            pick_folder,
            open_path,
            reveal_path,
            delete_file,
            rename_file,
            move_file,
            set_organize,
            quit_app,
            set_history_limit,
            export_history,
            set_on_complete,
            set_download_on_complete,
            verify_checksum,
            set_dl_meta,
            get_dl_meta,
            bridge_info,
            import_urls,
            extension_paths,
            update_ytdlp,
            ytdlp_version,
            js_runtime_status,
            ytdlp_auto_update,
            set_ytdlp_auto_update,
            set_clipboard_watch,
            set_metered_pause,
            set_power_block,
            set_speed_limit_state,
            open_url,
        ])
        .run(tauri::generate_context!())
        .expect("error while running DownMan");
}

fn build_tray(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    use tauri::menu::{CheckMenuItem, Menu, MenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

    let show = MenuItem::with_id(app, "show", "Show DownMan", true, None::<&str>)?;
    let pa = MenuItem::with_id(app, "pauseall", "Pause all", true, None::<&str>)?;
    let ra = MenuItem::with_id(app, "resumeall", "Resume all", true, None::<&str>)?;
    let limit = CheckMenuItem::with_id(app, "limit", "Speed limit", true, false, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit DownMan", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &pa, &ra, &limit, &quit])?;
    TRAY_LIMIT.set(limit).ok();

    let reveal = |_app: &tauri::AppHandle| {
        focus_main();
    };

    // Dedicated bright tray emblem (the chest "D + down arrow"). The full app icon is a
    // dark tile that's invisible on dark system trays, so we embed a high-contrast mark.
    const TRAY_RGBA: &[u8] = include_bytes!("../icons/tray_rgba.bin");
    let icon = tauri::image::Image::new(TRAY_RGBA, 64, 64);
    TrayIconBuilder::with_id("downman-tray")
        .icon(icon)
        .tooltip("DownMan")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, e| match e.id.as_ref() {
            "show" => {
                focus_main();
            }
            "pauseall" => {
                if let Some(c) = ARIA2.get() {
                    let c = c.clone();
                    tauri::async_runtime::spawn(async move { let _ = c.pause_all().await; });
                }
            }
            "resumeall" => {
                if let Some(c) = ARIA2.get() {
                    let c = c.clone();
                    tauri::async_runtime::spawn(async move { let _ = c.unpause_all().await; });
                }
            }
            "limit" => {
                // Toggle the global download cap between the configured limit and off.
                let on = !LIMIT_ON.load(Ordering::Relaxed);
                LIMIT_ON.store(on, Ordering::Relaxed);
                if let Some(item) = TRAY_LIMIT.get() {
                    let _ = item.set_checked(on);
                }
                let val = if on {
                    limit_val().lock().map(|v| v.clone()).unwrap_or_else(|_| "1M".into())
                } else {
                    "0".into()
                };
                if let Some(c) = ARIA2.get() {
                    let c = c.clone();
                    tauri::async_runtime::spawn(async move {
                        let _ = c.change_global_option(json!({ "max-overall-download-limit": val })).await;
                    });
                }
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(move |tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                reveal(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unwrap_media() {
        assert_eq!(
            unwrap_media_url("https://www.reddit.com/media?url=https%3A%2F%2Fi.redd.it%2Fabc.gif"),
            "https://i.redd.it/abc.gif"
        );
        assert_eq!(unwrap_media_url("https://example.com/page"), "https://example.com/page");
        // Extra query params after the wrapped URL are dropped with the &-split.
        assert_eq!(
            unwrap_media_url("https://www.reddit.com/media?url=https%3A%2F%2Fi.redd.it%2Fx.png&foo=1"),
            "https://i.redd.it/x.png"
        );
    }

    #[test]
    fn direct_file_detection() {
        assert!(is_direct_file_url("https://cdn.example.com/v.mp4"));
        assert!(is_direct_file_url("https://i.redd.it/a.gif?w=1"));
        assert!(is_direct_file_url("https://x.com/p.PNG"));
        assert!(!is_direct_file_url("https://youtube.com/watch?v=xyz"));
        assert!(!is_direct_file_url("https://cdn.example.com/master.m3u8"));
        assert!(!is_direct_file_url("https://example.com/file"));
    }

    #[test]
    fn stream_and_torrent_detection() {
        assert!(is_stream_manifest("https://x.com/live/master.m3u8?tok=1"));
        assert!(is_stream_manifest("https://x.com/vod.mpd"));
        assert!(!is_stream_manifest("https://x.com/v.mp4"));
        assert!(is_torrent_like("magnet:?xt=urn:btih:abc"));
        assert!(is_torrent_like("https://x.com/file.torrent?dl=1"));
        assert!(!is_torrent_like("https://x.com/file.zip"));
    }

    #[test]
    fn ctype_to_ext() {
        assert_eq!(ext_for_ctype("image/png"), Some("png"));
        assert_eq!(ext_for_ctype("image/png; charset=binary"), Some("png"));
        assert_eq!(ext_for_ctype("video/mp4"), Some("mp4"));
        assert_eq!(ext_for_ctype("audio/mpeg"), Some("mp3"));
        assert_eq!(ext_for_ctype("text/html"), None);
    }

    #[test]
    fn filename_ext_completion() {
        assert_eq!(filename_with_ext("https://dummyimage.com/200", Some("image/png")), "200.png");
        assert_eq!(filename_with_ext("https://x.com/photo.jpg", Some("image/png")), "photo.jpg");
        assert_eq!(filename_with_ext("https://x.com/file", None), "file");
        assert_eq!(filename_with_ext("https://x.com/file", Some("text/html")), "file");
    }

    #[test]
    fn content_disposition_names() {
        assert_eq!(cd_filename("attachment; filename=\"a.zip\""), Some("a.zip".into()));
        assert_eq!(cd_filename("attachment; filename*=UTF-8''x%20y.pdf"), Some("x y.pdf".into()));
        // RFC 5987 name wins over the plain one.
        assert_eq!(
            cd_filename("attachment; filename=\"plain.bin\"; filename*=UTF-8''real.iso"),
            Some("real.iso".into())
        );
        assert_eq!(cd_filename("inline"), None);
    }

    #[test]
    fn url_filenames() {
        assert_eq!(url_filename("https://x.com/a/b/video.mp4?dl=1"), "video.mp4");
        assert_eq!(url_filename("https://x.com/a%20b.zip"), "a b.zip");
        assert_eq!(url_filename("https://x.com/"), "x.com");
    }

    #[test]
    fn ytdlp_hosts() {
        assert!(is_known_ytdlp_host("https://www.youtube.com/watch?v=1"));
        assert!(is_known_ytdlp_host("https://youtu.be/1"));
        assert!(is_known_ytdlp_host("https://old.reddit.com/r/videos/1"));
        assert!(!is_known_ytdlp_host("https://example.com/watch"));
        assert!(!is_known_ytdlp_host("https://notyoutube.dev/"));
    }

    #[test]
    fn out_stem() {
        assert_eq!(ytdlp_out_stem("My Video.mp4"), "My Video");
        assert_eq!(ytdlp_out_stem("a/b%c.webm"), "abc");
        assert_eq!(ytdlp_out_stem(""), "video");
    }
}
