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
  dmTitle?: string;
  dmElapsedSeconds?: number;
  dmDurationSeconds?: number;
  dmProcessingSpeed?: string;
  dmTotalEstimated?: boolean;
  dmChecksum?: string;   // expected checksum stored in DL_META
  dmVerify?: string;    // "" | "pending" | "ok" | "fail"
  dmOnComplete?: string;
  dmProfileId?: string;
  dmProfile?: DownloadProfile;
  dmSchedule?: JobSchedule;
  dmNetworkOverride?: NetworkOverride;
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

export interface SourceEditPreview {
  oldUrl: string;
  newUrl: string;
  completedBytes: number;
  canReuse: boolean;
  requiresRestart: boolean;
  reason: string;
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

export interface DownloadProfile {
  id: string;
  name: string;
  description: string;
  builtin: boolean;
  mediaMode: "video-audio" | "audio-only" | "subtitles-only";
  quality: string;
  container: string;
  videoCodec: string;
  preferredFps: string;
  audioFormat: string;
  audioBitrate: string;
  subtitleMode: "off" | "sidecar" | "embed";
  subtitleLanguages: string[];
  subtitleFormat: string;
  sponsorblockMode: "off" | "mark" | "remove";
  sponsorblockCategories: string[];
  embedMetadata: boolean;
  embedThumbnail: boolean;
  embedChapters: boolean;
  writeDescription: boolean;
  outputDir: string;
  subfolder: string;
  filenameTemplate: string;
  queueId: string;
  maxDownloadLimit: string;
  connections: number;
  split: number;
  proxy: string;
  userAgent: string;
  headers: string[];
  retries: number;
  clipStart: string;
  clipEnd: string;
  livePolicy: "skip" | "from-start" | "from-now";
  createdAt: number;
  updatedAt: number;
}

export interface CollectionSession {
  id: string;
  sourceUrl: string;
  sourceType: "playlist" | "channel" | "collection";
  title: string;
  status: "loading" | "ready" | "cancelled" | "error";
  totalKnown: number;
  loadedCount: number;
  pageSize: number;
  nextIndex: number;
  profileId: string;
  error: string;
  enqueueStatus: "" | "running" | "complete" | "cancelled";
  enqueuedCount: number;
  failedCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface CollectionItem {
  index: number;
  mediaId: string;
  extractor: string;
  url: string;
  title: string;
  uploader: string;
  durationSec: number;
  uploadDate: string;
  thumbnail: string;
  liveState: string;
  estimatedSize: number;
  availability: string;
  selected: boolean;
  enqueueStatus: "" | "queued" | "active" | "complete" | "error" | "cancelled";
  archived: boolean;
}

export interface CollectionPage {
  session: CollectionSession;
  items: CollectionItem[];
  filteredCount: number;
  selectedCount: number;
  offset: number;
  limit: number;
}

export interface PolicyValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface ArchiveStatus {
  count: number;
  latestCompletedAt: number;
}

export interface TimeWindow {
  start: string;
  stop: string;
  /** Monday = 0, Sunday = 6; empty means every day. */
  days: number[];
}

export interface GlobalSchedule {
  enabled: boolean;
  timezone: string;
  windows: TimeWindow[];
}

export interface JobSchedule {
  mode: "inherit" | "always" | "paused" | "window";
  window: TimeWindow | null;
}

export interface NetworkOverride {
  maxDownloadLimit: string;
  connections: number;
  split: number;
  proxy: string;
  userAgent: string;
  headers: string[];
  cookiesBrowser: string;
  httpUsername: string;
  hasPassword: boolean;
  meteredBehavior: "" | "inherit" | "pause" | "ignore";
}

export interface JobPolicyMeta {
  checksum: string;
  verify: string;
  oncomplete_action: string;
  oncomplete_cmd: string;
  added_at: number;
  profile_id: string;
  profile_snapshot?: DownloadProfile | null;
  schedule: JobSchedule;
  network_override: NetworkOverride;
}

export interface PreflightSummary {
  id: string;
  status: "ready" | "committed";
  profileId: string;
  totalCount: number;
  acceptedCount: number;
  rejectedCount: number;
  estimateSizes: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface PreflightItem {
  index: number;
  original: string;
  url: string;
  kind: string;
  status: string;
  reason: string;
  filename: string;
  conflictPath: string;
  estimatedSize: number;
  estimatedSeconds: number;
  contentType: string;
  selected: boolean;
  commitStatus: "" | "complete" | "error" | "skipped";
}

export interface PreflightPage {
  summary: PreflightSummary;
  items: PreflightItem[];
  filteredCount: number;
  offset: number;
  limit: number;
}

export interface Subscription {
  id: string;
  name: string;
  kind: "channel" | "playlist";
  sourceUrl: string;
  profileId: string;
  pollIntervalMin: number;
  enabled: boolean;
  action: "review" | "auto";
  notify: boolean;
  includeKeywords: string[];
  excludeKeywords: string[];
  minDurationSec: number;
  maxDurationSec: number;
  contentType: "all" | "video" | "live" | "upcoming";
  maxItemsPerPoll: number;
  livePolicyOverride: "" | "skip" | "from-start" | "from-now";
  cookiesBrowser: string;
  m3uTarget: string;
  running: boolean;
  lastRunAt: number;
  lastSuccessAt: number;
  nextRunAt: number;
  lastError: string;
  createdAt: number;
  updatedAt: number;
}

export interface ReviewItem {
  id: string;
  subscriptionId: string;
  subscriptionName: string;
  extractor: string;
  mediaId: string;
  url: string;
  title: string;
  uploader: string;
  durationSec: number;
  uploadDate: string;
  thumbnail: string;
  liveState: string;
  profileId: string;
  status: "new" | "downloaded" | "dismissed" | "error";
  selected: boolean;
  discoveredAt: number;
}

export interface ReviewPage {
  items: ReviewItem[];
  total: number;
  selectedCount: number;
  offset: number;
  limit: number;
}

export interface SearchSession {
  id: string;
  query: string;
  status: "loading" | "ready" | "cancelled" | "error";
  loadedCount: number;
  totalLimit: number;
  pageSize: number;
  error: string;
  createdAt: number;
  updatedAt: number;
}

export interface SearchItem {
  index: number;
  extractor: string;
  mediaId: string;
  url: string;
  title: string;
  uploader: string;
  durationSec: number;
  uploadDate: string;
  thumbnail: string;
  liveState: string;
  selected: boolean;
  archived: boolean;
}

export interface SearchPage {
  session: SearchSession;
  items: SearchItem[];
  offset: number;
  limit: number;
}

export const api = {
  add: (uris: string[], options: Record<string, unknown> = {}) =>
    invoke<string>("add_download", { uris, options }),
  pause: (gid: string) => invoke("pause", { gid }),
  resume: (gid: string) => invoke("resume", { gid }),
  sourceEditPreview: (gid: string, newUrl: string) => invoke<SourceEditPreview>("source_edit_preview", { gid, newUrl }),
  sourceEditApply: (gid: string, newUrl: string, restartFromZero: boolean) => invoke<{ gid: string; reused: boolean; changed: boolean }>("source_edit_apply", { gid, newUrl, restartFromZero }),
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
  grabSite: (url: string, format = "", referer?: string, cookies?: string, subs?: boolean, sponsorblock?: boolean, profileId?: string, clipStart?: string, clipEnd?: string, livePolicy?: DownloadProfile["livePolicy"]) =>
    invoke<string>("grab_site", { url, format, referer, cookies, subs, sponsorblock, policy: { profileId, clipStart, clipEnd, livePolicy } }),
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
  bridgeInfo: () => invoke<{ port: number; url: string; running: boolean; authRequired: boolean; protocolVersion: number; pairingUntilMs: number; extensionFolder: string; lastPingMs: number }>("bridge_info"),
  bridgePairingBegin: () => invoke<{ pairingUntilMs: number; protocolVersion: number }>("bridge_pairing_begin"),
  bridgePairingCancel: () => invoke("bridge_pairing_cancel"),
  bridgeTokenRotate: () => invoke<{ rotated: boolean }>("bridge_token_rotate"),
  extensionPaths: () => invoke<{ dir: string; dirExists: boolean; crx: string; crxExists: boolean; xpi: string; xpiExists: boolean; xpiSigned: boolean }>("extension_paths"),
  ytdlpVersion: () => invoke<string>("ytdlp_version"),
  updateYtdlp: () => invoke<string>("update_ytdlp"),
  jsRuntimeStatus: () => invoke<string>("js_runtime_status"),
  ytdlpAutoUpdate: () => invoke<boolean>("ytdlp_auto_update"),
  setYtdlpAutoUpdate: (enable: boolean) => invoke("set_ytdlp_auto_update", { enable }),
  appUpdateCheck: () => invoke<{ current: string; latest: string; available: boolean; url: string }>("app_update_check"),
  setClipboardWatch: (enable: boolean) => invoke("set_clipboard_watch", { enable }),
  setMeteredPause: (enable: boolean) => invoke("set_metered_pause", { enable }),
  setPowerBlock: (enable: boolean) => invoke("set_power_block", { enable }),
  setSpeedLimitState: (on: boolean, value: string) => invoke("set_speed_limit_state", { on, value }),
  retryDownload: (gid: string, cookies?: string) => invoke<string>("retry_download", { gid, cookies }),
  redownload: (url: string, path: string) => invoke<string>("redownload", { url, path }),
  clearGone: () => invoke<number>("clear_gone"),
  clearCache: () => invoke<{ bytes: number; files: number }>("clear_cache"),
  importUrls: (urls: string[], options?: Record<string, unknown>) => invoke<{ added: number; skipped: number; failed: number }>("import_urls", { urls, options: options || {} }),

  // Reusable download profiles
  listDownloadProfiles: () => invoke<DownloadProfile[]>("list_download_profiles"),
  activeDownloadProfile: () => invoke<DownloadProfile>("active_download_profile"),
  saveDownloadProfile: (profile: DownloadProfile) => invoke<DownloadProfile>("save_download_profile", { profile }),
  setActiveDownloadProfile: (id: string) => invoke<DownloadProfile>("set_active_download_profile", { id }),
  deleteDownloadProfile: (id: string) => invoke("delete_download_profile", { id }),
  validateMediaPolicy: (profile: DownloadProfile) => invoke<PolicyValidation>("media_policy_validate", { profile }),

  // Playlist and channel collection inspector
  collectionInspectStart: (sourceUrl: string, profileId?: string, pageSize = 100, cookiesBrowser?: string) =>
    invoke<CollectionSession>("collection_inspect_start", { sourceUrl, profileId, pageSize, cookiesBrowser }),
  collectionInspectPage: (id: string, offset = 0, limit = 50, query?: string, filter?: string) =>
    invoke<CollectionPage>("collection_inspect_page", { id, offset, limit, query, filter }),
  collectionSelectItems: (id: string, indices: number[], selected: boolean) =>
    invoke<number>("collection_select_items", { id, indices, selected }),
  collectionEnqueueSelected: (id: string, profileId?: string, queueId?: string) =>
    invoke<{ id: string; queued: number }>("collection_enqueue_selected", { id, profileId, queueId }),
  collectionCancel: (id: string) => invoke("collection_cancel", { id }),

  // Completed media archive and playlist exports
  extractorArchiveStatus: () => invoke<ArchiveStatus>("extractor_archive_status"),
  extractorArchiveExport: (path: string) => invoke<number>("extractor_archive_export", { path }),
  archiveExportM3u: (path: string) => invoke<number>("archive_export_m3u", { path }),

  // Bulk URL cleanup, classification, estimates, and explicit review
  preflightBatch: (urls: string[], profileId?: string, estimateSizes = false) =>
    invoke<PreflightPage>("preflight_batch", { urls, profileId, estimateSizes }),
  preflightGet: (id: string, offset = 0, limit = 100, filter?: string) =>
    invoke<PreflightPage>("preflight_get", { id, offset, limit, filter }),
  preflightSelect: (id: string, indices: number[], selected: boolean) =>
    invoke<number>("preflight_select", { id, indices, selected }),
  preflightCommit: (id: string) => invoke<{ added: number; failed: number }>("preflight_commit", { id }),

  // Backend-owned schedules and per-job network policy
  schedulerGet: () => invoke<GlobalSchedule>("scheduler_get"),
  schedulerSet: (schedule: GlobalSchedule) => invoke<GlobalSchedule>("scheduler_set", { schedule }),
  jobPolicyGet: (gid: string) => invoke<JobPolicyMeta>("job_policy_get", { gid }),
  jobPolicySet: (gid: string, schedule: JobSchedule, networkOverride: NetworkOverride, password?: string) =>
    invoke<JobPolicyMeta>("job_policy_set", { gid, schedule, networkOverride, password }),
  jobPolicyClear: (gid: string) => invoke<JobPolicyMeta>("job_policy_clear", { gid }),

  // Followed sources and review inbox
  subscriptionList: () => invoke<Subscription[]>("subscription_list"),
  subscriptionUpsert: (subscription: Subscription) => invoke<Subscription>("subscription_upsert", { subscription }),
  subscriptionDelete: (id: string) => invoke("subscription_delete", { id }),
  subscriptionRunNow: (id: string) => invoke<{ reviewed: number; autoQueued: number; archived: number }>("subscription_run_now", { id }),
  subscriptionExportM3u: (id: string, path: string) => invoke<number>("subscription_export_m3u", { id, path }),
  reviewInboxPage: (offset = 0, limit = 100, status = "new") => invoke<ReviewPage>("review_inbox_page", { offset, limit, status }),
  reviewInboxSelect: (ids: string[], selected: boolean) => invoke<number>("review_inbox_select", { ids, selected }),
  reviewInboxDismiss: (ids: string[]) => invoke<number>("review_inbox_dismiss", { ids }),
  reviewInboxDownload: (ids: string[]) => invoke<{ queued: number }>("review_inbox_download", { ids }),

  // Bounded YouTube keyword search via yt-dlp
  ytSearchStart: (query: string, pageSize = 50, totalLimit = 200, cookiesBrowser?: string) =>
    invoke<SearchSession>("yt_search_start", { query, pageSize, totalLimit, cookiesBrowser }),
  ytSearchPage: (id: string, offset = 0, limit = 50) => invoke<SearchPage>("yt_search_page", { id, offset, limit }),
  ytSearchSelect: (id: string, indices: number[], selected: boolean) => invoke<number>("yt_search_select", { id, indices, selected }),
  ytSearchCancel: (id: string) => invoke("yt_search_cancel", { id }),
  ytSearchDownload: (id: string, profileId?: string) => invoke<{ queued: number }>("yt_search_download", { id, profileId }),

  // Browser interception rules
  getRules: () => invoke<Rules>("get_rules"),
  setRules: (rules: Rules) => invoke("set_rules", { data: rules }),

  // Editable categories
  getCategories: () => invoke<CategoryDef[]>("get_categories"),
  setCategories: (cats: CategoryDef[]) => invoke<{ added: string[] }>("set_categories", { data: cats }),

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
  if (t.dmTitle?.trim()) return t.dmTitle.trim();
  const p = t.files?.[0]?.path || t.files?.[0]?.uris?.[0]?.uri || "";
  return p.split("/").pop() || "Unknown";
}
