import { create } from "zustand";
import { api, Aria2Task, PendingItem, Snapshot, taskName, CategoryDef, Queue } from "./lib/api";
import { toast } from "./lib/toast";
import { playDing } from "./lib/sound";
import { migrateTheme } from "./lib/theme";

migrateTheme();

export type View = "all" | "active" | "unfinished" | "completed" | "media" | "sitegrab" | "torrents" | "settings" | "stats" | "about";
export type Category = "video" | "audio" | "image" | "doc" | "archive" | "torrent" | "other";

const organized = new Set<string>();
const statusOverrides = new Map<string, { status: Aria2Task["status"]; expiresAt: number }>();
const replacingGids = new Set<string>();

// Track which failed downloads we've already surfaced so each failure toasts once.
const toastedErrors = new Set<string>();
let errorsPrimed = false;
function surfaceErrors(tasks: Aria2Task[]) {
  const present = new Set(tasks.map((t) => t.gid));
  for (const g of [...toastedErrors]) if (!present.has(g)) toastedErrors.delete(g);
  // Failures the auto-retry loop is handling (dmRetry) aren't final — no toast yet.
  const errored = tasks.filter((t) => t.status === "error" && !t.dmRetry);
  if (!errorsPrimed) {
    // Don't announce failures that already existed when the app opened.
    errored.forEach((t) => toastedErrors.add(t.gid));
    errorsPrimed = true;
    return;
  }
  for (const t of errored) {
    if (toastedErrors.has(t.gid)) continue;
    toastedErrors.add(t.gid);
    const url = taskUrl(t);
    toast.error(
      `Download failed: ${taskName(t)}`,
      t.errorMessage || undefined,
      url ? { label: "Retry", run: () => { useStore.getState().retryTask(t.gid).catch(() => {}); } } : undefined,
    );
  }
}

// Ding + optional toast the first time each download reaches "complete".
const seenComplete = new Set<string>();
let completePrimed = false;
function surfaceCompletions(tasks: Aria2Task[]) {
  const present = new Set(tasks.map((t) => t.gid));
  for (const g of [...seenComplete]) if (!present.has(g)) seenComplete.delete(g);
  const done = tasks.filter((t) => t.status === "complete");
  if (!completePrimed) {
    done.forEach((t) => seenComplete.add(t.gid));
    completePrimed = true;
    return;
  }
  const fresh = done.filter((t) => !seenComplete.has(t.gid));
  fresh.forEach((t) => seenComplete.add(t.gid));
  if (fresh.length === 0) return;
  playDing();
  if (localStorage.getItem("dm-complete-toast") !== "off") {
    if (fresh.length === 1) {
      const t = fresh[0];
      const path = t.files?.[0]?.path || "";
      toast.done(`Downloaded: ${taskName(t)}`, undefined, path ? [
        { label: "Open", run: () => api.openPath(path).catch(() => {}) },
        { label: "Open folder", run: () => api.revealPath(path).catch(() => {}) },
      ] : undefined);
    } else {
      toast.success(`${fresh.length} downloads finished`);
    }
  }
}

/** Mark a gid as already-handled so auto-sort leaves its user-chosen folder alone. */
export function markOrganized(gid: string) {
  organized.add(gid);
}

export function categorize(name: string, isTorrent: boolean): Category {
  if (isTorrent) return "torrent";
  const e = name.split(".").pop()?.toLowerCase() || "";
  if (["mp4", "mkv", "webm", "avi", "mov", "m3u8", "ts"].includes(e)) return "video";
  if (["mp3", "flac", "wav", "aac", "ogg", "m4a"].includes(e)) return "audio";
  if (["jpg", "jpeg", "png", "gif", "webp", "svg"].includes(e)) return "image";
  if (["pdf", "doc", "docx", "txt", "epub", "xls", "xlsx"].includes(e)) return "doc";
  if (["zip", "rar", "7z", "tar", "gz", "xz", "deb"].includes(e)) return "archive";
  return "other";
}

interface State {
  tasks: Aria2Task[];
  pending: PendingItem[];
  stat: Snapshot["stat"] | null;
  view: View;
  query: string;
  dir: string;
  connected: boolean;
  listMode: "table" | "cards";
  categories: CategoryDef[];
  categoryFilter: string | null;
  queues: Queue[];
  queueMap: Record<string, string>;
  queueFilter: string | null;
  statusFilter: string;
  typeFilter: string;
  liveBg: boolean;
  grabbed: Record<string, boolean>;
  grabRequest: string | null;
  selected: Set<string>;
  setView: (v: View) => void;
  setQuery: (q: string) => void;
  setListMode: (m: "table" | "cards") => void;
  setCategoryFilter: (name: string | null) => void;
  selectCategory: (name: string) => void;
  setQueueFilter: (id: string | null) => void;
  selectQueue: (id: string) => void;
  setStatusFilter: (v: string) => void;
  setTypeFilter: (v: string) => void;
  setLiveBg: (v: boolean) => void;
  loadCategories: () => Promise<void>;
  toggleSelected: (gid: string) => void;
  setSelected: (gids: string[]) => void;
  clearSelected: () => void;
  pauseTask: (gid: string) => Promise<void>;
  resumeTask: (gid: string) => Promise<void>;
  retryTask: (gid: string, cookies?: string) => Promise<void>;
  poll: () => Promise<void>;
}

export const useStore = create<State>((set) => ({
  tasks: [],
  pending: [],
  stat: null,
  view: "all",
  query: "",
  dir: "",
  connected: false,
  listMode: (localStorage.getItem("dm-listview") as "table" | "cards") || "table",
  categories: [],
  categoryFilter: null,
  queues: [],
  queueMap: {},
  queueFilter: null,
  statusFilter: "all",
  typeFilter: "all",
  liveBg: localStorage.getItem("dm-live-bg") === "on",
  grabbed: {},
  grabRequest: null,
  selected: new Set<string>(),
  setView: (view) => set({ view, categoryFilter: null, queueFilter: null, selected: new Set<string>() }),
  setQuery: (query) => set({ query }),
  setListMode: (listMode) => { localStorage.setItem("dm-listview", listMode); set({ listMode }); },
  setCategoryFilter: (categoryFilter) => set({ categoryFilter }),
  selectCategory: (name) => set({ view: "all", categoryFilter: name, queueFilter: null }),
  setQueueFilter: (queueFilter) => set({ queueFilter }),
  selectQueue: (id) => set({ view: "all", categoryFilter: null, queueFilter: id }),
  setStatusFilter: (statusFilter) => set({ statusFilter }),
  setTypeFilter: (typeFilter) => set({ typeFilter }),
  setLiveBg: (liveBg) => { localStorage.setItem("dm-live-bg", liveBg ? "on" : "off"); set({ liveBg }); },
  loadCategories: async () => {
    try {
      const categories = await api.getCategories();
      set({ categories });
    } catch {
      /* ignore */
    }
  },
  toggleSelected: (gid) => set((s) => {
    const n = new Set(s.selected);
    if (n.has(gid)) n.delete(gid); else n.add(gid);
    return { selected: n };
  }),
  setSelected: (gids) => set({ selected: new Set(gids) }),
  clearSelected: () => set({ selected: new Set<string>() }),
  pauseTask: async (gid) => {
    let previous: Aria2Task["status"] | undefined;
    statusOverrides.set(gid, { status: "paused", expiresAt: Date.now() + 5000 });
    set((state) => ({
      tasks: state.tasks.map((task) => {
        if (task.gid !== gid) return task;
        previous = task.status;
        return { ...task, status: "paused", downloadSpeed: "0" };
      }),
    }));
    try {
      await api.pause(gid);
    } catch (error) {
      statusOverrides.delete(gid);
      if (previous) set((state) => ({ tasks: state.tasks.map((task) => task.gid === gid ? { ...task, status: previous as Aria2Task["status"] } : task) }));
      throw error;
    }
  },
  resumeTask: async (gid) => {
    let previous: Aria2Task["status"] | undefined;
    statusOverrides.set(gid, { status: "active", expiresAt: Date.now() + 5000 });
    set((state) => ({
      tasks: state.tasks.map((task) => {
        if (task.gid !== gid) return task;
        previous = task.status;
        return { ...task, status: "active" };
      }),
    }));
    try {
      await api.resume(gid);
    } catch (error) {
      statusOverrides.delete(gid);
      if (previous) set((state) => ({ tasks: state.tasks.map((task) => task.gid === gid ? { ...task, status: previous as Aria2Task["status"] } : task) }));
      throw error;
    }
  },
  retryTask: async (gid, cookies) => {
    const previous = useStore.getState().tasks.find((task) => task.gid === gid);
    if (!previous) return;
    replacingGids.add(gid);
    set((state) => ({ tasks: state.tasks.filter((task) => task.gid !== gid) }));
    try {
      await api.retryDownload(gid, cookies);
      await useStore.getState().poll();
    } catch (error) {
      replacingGids.delete(gid);
      set((state) => ({ tasks: state.tasks.some((task) => task.gid === gid) ? state.tasks : [...state.tasks, previous] }));
      throw error;
    }
  },
  poll: async () => {
    try {
      const s = await api.snapshot();
      const history = s.history ?? [];
      const histGids = new Set(history.map((h) => h.gid));
      // History is the source of truth for completed items; drop live duplicates.
      const live = [...s.active, ...s.waiting, ...(s.site ?? []), ...s.stopped].filter((t) => !histGids.has(t.gid));
      const now = Date.now();
      const allTasks = [...live, ...history].filter((task) => !replacingGids.has(task.gid)).map((task) => {
        const override = statusOverrides.get(task.gid);
        if (!override) return task;
        if (task.status === override.status || override.expiresAt <= now) {
          statusOverrides.delete(task.gid);
          return task;
        }
        return { ...task, status: override.status, downloadSpeed: override.status === "paused" ? "0" : task.downloadSpeed };
      });
      surfaceErrors(allTasks);
      surfaceCompletions(allTasks);
      const present = new Set(allTasks.map((task) => task.gid));
      for (const gid of [...replacingGids]) if (!present.has(gid)) replacingGids.delete(gid);
      set({
        tasks: allTasks,
        pending: s.pending ?? [],
        stat: s.stat,
        queues: s.queues ?? [],
        queueMap: s.queueMap ?? {},
        grabbed: s.grabbed ?? {},
        grabRequest: s.grabRequest ?? null,
        connected: true,
      });
    } catch {
      set({ connected: false });
    }
  },
}));

export function metaOf(t: Aria2Task) {
  const name = taskName(t);
  if (t.dmKind === "site") return { name, category: "video" as Category };
  return { name, category: categorize(name, !!t.bittorrent) };
}

/** Resolve a filename to a user category name using the editable table. */
export function categoryNameOf(name: string, cats: CategoryDef[]): string {
  const e = name.split(".").pop()?.toLowerCase() || "";
  for (const c of cats) {
    if (c.exts && c.exts.some((x) => x.toLowerCase() === e)) return c.name;
  }
  return cats.find((c) => !c.exts || c.exts.length === 0)?.name || "Other";
}

/** The primary source URL of a task (stable across restarts — used as queue key). */
export function taskUrl(t: Aria2Task): string {
  return t.files?.[0]?.uris?.[0]?.uri || "";
}

/** Resolve which queue a task belongs to (defaults to "main"). */
export function queueOf(t: Aria2Task, map: Record<string, string>): string {
  return map[taskUrl(t)] || "main";
}
