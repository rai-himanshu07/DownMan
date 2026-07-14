import { invoke } from "@tauri-apps/api/core";

export interface Aria2Task {
  gid: string;
  status: "active" | "waiting" | "paused" | "complete" | "error" | "removed";
  totalLength: string;
  completedLength: string;
  downloadSpeed: string;
  uploadSpeed: string;
  connections: string;
  bitfield?: string;
  numPieces?: string;
  pieceLength?: string;
  dir: string;
  files: { index?: string; path: string; length: string; completedLength?: string; selected?: string; uris: { uri: string }[] }[];
  bittorrent?: { info?: { name?: string }; announceList?: string[][] };
  infoHash?: string;
  numSeeders?: string;
  followedBy?: string[];
  following?: string;
  addedAt?: number;
  completedAt?: number;
  errorMessage?: string;
  dmKind?: string;
  dmChecksum?: string;   // expected checksum stored in DL_META
  dmVerify?: string;    // "" | "pending" | "ok" | "fail"
  dmOnComplete?: string;
  dmMissing?: boolean;   // completed file deleted/moved on disk
  dmRetry?: number;      // auto-retry attempt (1..3) while a failure is being retried
}

export interface Snapshot {
  active: Aria2Task[];
  waiting: Aria2Task[];
  stopped: Aria2Task[];
  site: Aria2Task[];
  pending: PendingItem[];
  history: Aria2Task[];
  queues: Queue[];
  queueMap: Record<string, string>;
  grabbed: Record<string, boolean>;
  grabRequest: string | null;
  stat: {
    downloadSpeed: string;
    uploadSpeed: string;
    numActive: string;
    numWaiting: string;
    numStopped: string;
  };
}

export interface PendingItem {
  id: string;
  url: string;
  filename: string;
  size: string;
  category: string;
  referer?: string | null;
  status: string;
  kind?: string;
  quality?: string;
}

export interface Rules {
  enabled: boolean;
  autoExts: string[];
  blockSites: string[];
  blockAddresses: string[];
}

export interface CategoryDef {
  name: string;
  exts: string[];
  folder: string;
  folderAbs?: string;
}

export interface Queue {
  id: string;
  name: string;
  maxActive: number;
  speed: number;
  running: boolean;
  schedule: { start: string; stop: string; onDone: string } | null;
}

export interface GrabFile {
  url: string;
  name: string;
  type: string;
  size: number;
  linkText: string;
  source: string;
  host: string;
}

export interface GrabState {
  status: string;
  error?: string;
  failedPages?: number;
  pages: number;
  total: number;
  files: GrabFile[];
}

export interface Fmt {
  selector: string;
  label: string;
  kind: string;
  height: number;
  ext: string;
  size: number;
}

export interface LifetimeStats {
  completedCount: number;
  completedBytes: number;
  last7Count: number;
  last7Bytes: number;
  byCategory: { category: string; count: number; bytes: number }[];
}

export const api = {
  add: (uris: string[], options: Record<string, unknown> = {}) =>
    invoke<string>("add_download", { uris, options }),
  pause: (gid: string) => invoke("pause", { gid }),
  resume: (gid: string) => invoke("resume", { gid }),
  pauseAll: () => invoke("pause_all"),
  resumeAll: () => invoke("resume_all"),
  remove: (gid: string) => invoke("remove", { gid }),
  organize: (gid: string) => invoke<string>("organize", { gid }),
  grabHls: (url: string, name: string) => invoke("grab_hls", { url, name }),
  snapshot: () => invoke<Snapshot>("snapshot"),
  lifetimeStats: () => invoke<LifetimeStats>("lifetime_stats"),
  resetLifetimeStats: () => invoke<LifetimeStats>("reset_lifetime_stats"),
  setGlobal: (options: Record<string, string>) =>
    invoke("set_global_option", { options }),
  grabSite: (url: string, format = "best", referer?: string, cookies?: string, subs?: boolean, sponsorblock?: boolean) =>
    invoke<string>("grab_site", { url, format, referer, cookies, subs, sponsorblock }),
  listFormats: (url: string, referer?: string, cookies?: string) =>
    invoke<{ title: string; formats: Fmt[] }>("list_formats", { url, referer, cookies }),
  info: () => invoke<{ dir: string }>("engine_info"),

  // Per-download control
  setDownloadLimit: (gid: string, limit: string) =>
    invoke("set_download_limit", { gid, limit }),
  reorder: (gid: string, how: "up" | "down" | "top" | "bottom") =>
    invoke("reorder", { gid, how }),
  setSelectedFiles: (gid: string, indices: string) =>
    invoke("set_selected_files", { gid, indices }),
  addTrackers: (gid: string, text: string) => invoke("add_trackers", { gid, text }),  addTorrent: (data: string, options: Record<string, string> = {}) =>
    invoke<string>("add_torrent", { data, options }),
  addMetalink: (data: string, options: Record<string, string> = {}) =>
    invoke<string[]>("add_metalink", { data, options }),

  // Power / antivirus / autostart / trackers
  setShutdownWhenDone: (enable: boolean) =>
    invoke("set_shutdown_when_done", { enable }),
  setAvScan: (enable: boolean) => invoke("set_av_scan", { enable }),
  setAutostart: (enable: boolean) => invoke("set_autostart", { enable }),
  autostartEnabled: () => invoke<boolean>("autostart_enabled"),
  updateTrackers: () => invoke<number>("update_trackers"),

  // Confirmation dialog
  setConfirmDownloads: (enable: boolean) => invoke("set_confirm_downloads", { enable }),
  confirmPending: (id: string, filename: string, dir: string, paused: boolean) =>
    invoke<string>("confirm_pending", { id, filename, dir, paused }),
  cancelPending: (id: string) => invoke("cancel_pending", { id }),
  pickFolder: () => invoke<string | null>("pick_folder"),

  // Completed-download actions
  openPath: (path: string) => invoke("open_path", { path }),
  openUrl: (url: string) => invoke("open_url", { url }),
  revealPath: (path: string) => invoke("reveal_path", { path }),
  deleteFile: (gid: string) => invoke("delete_file", { gid }),
  renameFile: (gid: string, newName: string) => invoke<string>("rename_file", { gid, newName }),
  moveFile: (gid: string, newDir: string) => invoke<string>("move_file", { gid, newDir }),
  setOrganize: (enable: boolean) => invoke("set_organize", { enable }),
  quitApp: () => invoke("quit_app"),
  setHistoryLimit: (limit: number) => invoke("set_history_limit", { limit }),
  exportHistory: (path: string, format: string) => invoke("export_history", { path, format }),
  setOnComplete: (action: string, command: string) => invoke("set_on_complete", { action, command }),
  setDownloadOnComplete: (gid: string, action: string, command: string) => invoke("set_download_on_complete", { gid, action, command }),
  verifyChecksum: (path: string, expected: string) => invoke<boolean>("verify_checksum", { path, expected }),
  setDlMeta: (gid: string, opts: { checksum?: string; oncomplete_action?: string; oncomplete_cmd?: string }) =>
    invoke("set_dl_meta", { gid, checksum: opts.checksum, onCompleteAction: opts.oncomplete_action, onCompleteCmd: opts.oncomplete_cmd }),
  getDlMeta: (gid: string) => invoke<{ checksum: string; verify: string; oncomplete_action: string; oncomplete_cmd: string }>("get_dl_meta", { gid }),
  bridgeInfo: () => invoke<{ port: number; url: string; running: boolean; extensionFolder: string; lastPingMs: number }>("bridge_info"),
  extensionPaths: () => invoke<{ dir: string; dirExists: boolean; crx: string; crxExists: boolean; xpi: string; xpiExists: boolean; xpiSigned: boolean }>("extension_paths"),
  ytdlpVersion: () => invoke<string>("ytdlp_version"),
  updateYtdlp: () => invoke<string>("update_ytdlp"),
  jsRuntimeStatus: () => invoke<string>("js_runtime_status"),
  ytdlpAutoUpdate: () => invoke<boolean>("ytdlp_auto_update"),
  setYtdlpAutoUpdate: (enable: boolean) => invoke("set_ytdlp_auto_update", { enable }),
  setClipboardWatch: (enable: boolean) => invoke("set_clipboard_watch", { enable }),
  setMeteredPause: (enable: boolean) => invoke("set_metered_pause", { enable }),
  setPowerBlock: (enable: boolean) => invoke("set_power_block", { enable }),
  setSpeedLimitState: (on: boolean, value: string) => invoke("set_speed_limit_state", { on, value }),
  retryDownload: (gid: string, cookies?: string) => invoke<string>("retry_download", { gid, cookies }),
  redownload: (url: string, path: string) => invoke<string>("redownload", { url, path }),
  clearGone: () => invoke<number>("clear_gone"),
  clearCache: () => invoke<{ bytes: number; files: number }>("clear_cache"),
  importUrls: (urls: string[], options?: Record<string, unknown>) => invoke<{ added: number; skipped: number; failed: number }>("import_urls", { urls, options: options || {} }),

  // Browser interception rules
  getRules: () => invoke<Rules>("get_rules"),
  setRules: (rules: Rules) => invoke("set_rules", { data: rules }),

  // Editable categories
  getCategories: () => invoke<CategoryDef[]>("get_categories"),
  setCategories: (cats: CategoryDef[]) => invoke("set_categories", { data: cats }),

  // Download queues
  getQueues: () => invoke<Queue[]>("get_queues"),
  setQueues: (queues: Queue[]) => invoke("set_queues", { data: queues }),
  setQueueRunning: (id: string, running: boolean) => invoke("set_queue_running", { id, running }),
  assignQueue: (url: string, queue: string) => invoke("assign_queue", { url, queue }),

  // Site grabber
  grabberStart: (project: Record<string, unknown>) => invoke<string>("grabber_start", { project }),
  grabberGet: (id: string) => invoke<GrabState>("grabber_get", { id }),
  grabberCancel: (id: string) => invoke("grabber_cancel", { id }),
  grabberDownload: (id: string, urls: string[]) => invoke<{ added: number; failed: number; failedUrls: string[] }>("grabber_download", { id, urls }),

  // Archive extract / remote web UI
  setAutoExtract: (enable: boolean) => invoke("set_auto_extract", { enable }),
  setRemote: (enable: boolean) => invoke<{ enabled: boolean; token: string; url: string }>("set_remote", { enable }),
  remoteInfo: () => invoke<{ enabled: boolean; token: string; url: string }>("remote_info"),

  // Download folder, trackers, grab requests
  setDownloadDir: (path: string) => invoke("set_download_dir", { path }),
  getTrackers: () => invoke<string>("get_trackers"),
  setTrackers: (text: string) => invoke("set_trackers", { text }),
  clearGrabRequest: () => invoke("clear_grab_request"),
};

export function taskName(t: Aria2Task): string {
  if (t.bittorrent?.info?.name) return t.bittorrent.info.name;
  const p = t.files?.[0]?.path || t.files?.[0]?.uris?.[0]?.uri || "";
  return p.split("/").pop() || "Unknown";
}
