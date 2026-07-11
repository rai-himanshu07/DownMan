import { useEffect, useMemo, useRef, useState } from "react";
import Sidebar from "./components/Sidebar";
import TopBar from "./components/TopBar";
import DownloadCard from "./components/DownloadCard";
import DownloadTable from "./components/DownloadTable";
import AddModal from "./components/AddModal";
import SettingsView from "./components/SettingsView";
import StatsView from "./components/StatsView";
import AboutView from "./components/AboutView";
import FirstRunPanel from "./components/FirstRunPanel";
import SignalBackground from "./components/SignalBackground";
import ConfirmDownload from "./components/ConfirmDownload";
import SiteGrabber from "./components/SiteGrabber";
import Toaster from "./components/Toaster";
import ErrorBoundary from "./components/ErrorBoundary";
import { useStore, metaOf, markOrganized, categoryNameOf, queueOf, taskUrl } from "./store";
import { api } from "./lib/api";
import { toast as pushToast } from "./lib/toast";
import { SIGNAL_ACCENT } from "./lib/theme";
import { I } from "./components/icons";

const DOWNLOADABLE =
  /\.(zip|rar|7z|tar|gz|xz|bz2|deb|rpm|exe|msi|dmg|iso|img|appimage|apk|pdf|epub|mobi|mp4|mkv|webm|avi|mov|mp3|flac|wav|m4a|aac|ogg|torrent|bin|pkg|jar)(\?|$)/i;

function looksDownloadable(s: string): boolean {
  const u = s.trim();
  if (/^magnet:\?xt=/i.test(u)) return true;
  if (!/^https?:\/\//i.test(u)) return false;
  try {
    return DOWNLOADABLE.test(new URL(u).pathname);
  } catch {
    return false;
  }
}

function hasDraggable(dt: DataTransfer | null): boolean {
  if (!dt || !dt.types) return false;
  return Array.from(dt.types).some((t) => t === "Files" || t === "text/uri-list");
}

function FilterSelect({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none bg-ink-900/60 border border-white/5 rounded-lg pl-2.5 pr-7 py-1 text-xs text-slate-300 focus:outline-none focus:ring-1 focus:ring-aurora-500/50"
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </select>
      <I.Down className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
    </div>
  );
}

export default function App() {
  const { tasks, pending, view, query, poll, connected, categories, categoryFilter, loadCategories, listMode, queueFilter, queueMap, queues, statusFilter, typeFilter, setStatusFilter, setTypeFilter, liveBg, grabbed, grabRequest, selected, setSelected, clearSelected } = useStore();  const [adding, setAdding] = useState(false);
  const [grabbing, setGrabbing] = useState(false);
  const [grabUrl, setGrabUrl] = useState("");
  const [dragging, setDragging] = useState(false);
  const [onboarded, setOnboarded] = useState(() => localStorage.getItem("dm-onboarded") === "1");
  const dragTimer = useRef<number | undefined>(undefined);
  const [confirmBulk, setConfirmBulk] = useState(false);
  const [bulkDisk, setBulkDisk] = useState(false);
  const [toast, setToast] = useState<{ msg: string; onYes?: () => void } | null>(null);

  useEffect(() => {
    poll();
    const id = setInterval(poll, 1000);
    return () => clearInterval(id);
  }, [poll]);

  // Use a native right-click menu everywhere instead of the WebKit web menu.
  // Rows/cards dispatch their own context menu; here we just suppress the
  // default web menu except inside editable fields (so copy/paste still works).
  useEffect(() => {
    const onCtx = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && el.closest("input, textarea, select, [contenteditable='true']")) return;
      e.preventDefault();
    };
    window.addEventListener("contextmenu", onCtx);
    return () => window.removeEventListener("contextmenu", onCtx);
  }, []);

  // Global keyboard shortcuts: "/" focus search, "n" new download, Delete removes
  // the current selection, Esc clears it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el?.closest("input, textarea, select, [contenteditable='true']");
      if (e.key === "Escape") {
        if (useStore.getState().selected.size > 0) clearSelected();
        return;
      }
      if (typing) return;
      const k = e.key.toLowerCase();
      if (e.key === "/" || ((e.ctrlKey || e.metaKey) && k === "f")) {
        e.preventDefault();
        document.getElementById("dm-search")?.focus();
      } else if (k === "n" && !e.altKey) {
        e.preventDefault();
        setAdding(true);
      } else if ((e.key === "Delete" || e.key === "Backspace") && useStore.getState().selected.size > 0) {
        e.preventDefault();
        setConfirmBulk(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [clearSelected]);

  // Re-apply preferences the engine forgets on restart (it relaunches fresh each run).
  useEffect(() => {
    api.setConfirmDownloads(localStorage.getItem("dm-confirm") !== "off").catch(() => {});
    api.setAvScan(localStorage.getItem("dm-av") === "on").catch(() => {});
    api.setOrganize(localStorage.getItem("dm-organize") !== "off").catch(() => {});
    const speed = localStorage.getItem("dm-speed") || "0";
    const opts: Record<string, string> = { "max-overall-download-limit": speed === "0" ? "0" : `${speed}K` };
    const proxy = localStorage.getItem("dm-proxy") || ""; if (proxy) opts["all-proxy"] = proxy;
    const ua = localStorage.getItem("dm-ua") || ""; if (ua) opts["user-agent"] = ua;
    const header = localStorage.getItem("dm-header") || ""; if (header) opts["header"] = header;
    api.setGlobal(opts).catch(() => {});
    loadCategories();
    api.setAutoExtract(localStorage.getItem("dm-extract") === "on").catch(() => {});
    api.setClipboardWatch(localStorage.getItem("dm-clipboard") === "on").catch(() => {});
    api.setMeteredPause(localStorage.getItem("dm-metered") !== "off").catch(() => {});
    api.setPowerBlock(localStorage.getItem("dm-awake") !== "off").catch(() => {});
    api.setSpeedLimitState(speed !== "0", speed !== "0" ? `${speed}K` : "").catch(() => {});
    if (localStorage.getItem("dm-remote") === "on") api.setRemote(true).catch(() => {});
    document.documentElement.style.setProperty("--dm-accent", localStorage.getItem("dm-accent") || SIGNAL_ACCENT);
    const dmBg = localStorage.getItem("dm-bg");
    if (dmBg) document.documentElement.style.setProperty("--dm-bg-image", dmBg);
    document.documentElement.classList.toggle("dm-compact", localStorage.getItem("dm-density") === "compact");
    document.documentElement.classList.toggle("dm-light", localStorage.getItem("dm-light") === "on");
  }, []);

  // Open the Site Grabber when the browser extension requests a page.
  useEffect(() => {
    if (grabRequest) { setGrabUrl(grabRequest); setGrabbing(true); api.clearGrabRequest().catch(() => {}); }
  }, [grabRequest]);

  // ---- Scheduler: global active-hours + per-queue start/stop windows ----
  const schedPaused = useRef(false);
  const qSched = useRef<Record<string, boolean>>({});
  useEffect(() => {
    const toMin = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
    const tick = () => {
      const now = new Date();
      const cur = now.getHours() * 60 + now.getMinutes();

      // Per-queue schedules: start/stop the queue when crossing its window edges.
      for (const q of useStore.getState().queues) {
        const sc = q.schedule;
        if (!sc || !sc.start || !sc.stop || sc.start === sc.stop) continue;
        const a = toMin(sc.start), b = toMin(sc.stop);
        const inWin = a < b ? cur >= a && cur < b : cur >= a || cur < b;
        const prev = qSched.current[q.id];
        if (prev === undefined) { qSched.current[q.id] = inWin; continue; }
        if (inWin !== prev) { qSched.current[q.id] = inWin; api.setQueueRunning(q.id, inWin).catch(() => {}); }
      }

      // Global active-hours window.
      const raw = localStorage.getItem("dm-sched");
      if (!raw) return;
      let s: { start?: string; stop?: string };
      try { s = JSON.parse(raw); } catch { return; }
      if (!s.start || !s.stop || s.start === s.stop) return;
      const a = toMin(s.start), b = toMin(s.stop);
      const inWindow = a < b ? cur >= a && cur < b : cur >= a || cur < b; // handles overnight windows
      if (!inWindow && !schedPaused.current) { schedPaused.current = true; api.pauseAll().catch(() => {}); }
      else if (inWindow && schedPaused.current) { schedPaused.current = false; api.resumeAll().catch(() => {}); }
    };
    tick();
    const id = setInterval(tick, 20000);
    return () => clearInterval(id);
  }, []);

  // ---- Clipboard monitor: when DownMan regains focus, offer a copied link ----
  useEffect(() => {
    let last = "";
    const onFocus = async () => {
      if (localStorage.getItem("dm-clipboard") !== "on") return;
      try {
        const txt = (await navigator.clipboard.readText()).trim();
        if (txt && txt !== last && looksDownloadable(txt)) {
          last = txt;
          const short = txt.length > 60 ? txt.slice(0, 57) + "…" : txt;
          setToast({ msg: `Download copied link?  ${short}`, onYes: () => addUris([txt]) });
        }
      } catch { /* clipboard not permitted */ }
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  async function addUris(uris: string[]) {
    for (const u of uris) await api.add([u]).catch(() => {});
    setToast(null);
    poll();
  }

  async function bulkDelete() {
    const gids = [...selected];
    for (const gid of gids) {
      if (bulkDisk) await api.deleteFile(gid).catch(() => {});
      else await api.remove(gid).catch(() => {});
    }
    clearSelected();
    setConfirmBulk(false);
    setBulkDisk(false);
    poll();
  }

  // ---- Drag & drop: links (text/uri-list) and local .torrent files ----
  async function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const dt = e.dataTransfer;
    const files = [...(dt.files || [])].filter((f) => /\.(torrent|metalink|meta4)$/i.test(f.name));
    for (const f of files) {
      const buf = await f.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let bin = "";
      for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      const isMeta = /\.(metalink|meta4)$/i.test(f.name);
      try {
        if (isMeta) {
          const gids = await api.addMetalink(btoa(bin));
          const n = gids.length || 1;
          pushToast.success(`Added ${n} download${n > 1 ? "s" : ""} from ${f.name}`);
        } else {
          await api.addTorrent(btoa(bin));
          pushToast.success(`Added torrent: ${f.name}`);
        }
      } catch {
        pushToast.error(`Couldn't add ${f.name}`, isMeta ? "The engine rejected the metalink." : "The engine rejected the torrent file.");
      }
    }
    const text = dt.getData("text/uri-list") || dt.getData("text/plain") || "";
    const uris = text.split(/\s+/).map((s) => s.trim()).filter((s) => /^(https?:\/\/|magnet:\?)/i.test(s));
    if (uris.length) await addUris(uris);
    else if (files.length) poll();
  }

  // ---- Per-category "always save here": auto-confirm without showing the dialog ----
  const head = pending[0];
  const catDef = (() => {
    if (!head) return null;
    try {
      return JSON.parse(localStorage.getItem("dm-cat-defaults") || "{}")[head.category] || null;
    } catch {
      return null;
    }
  })();
  const willAuto = !!(head && catDef && catDef.auto && catDef.dir);

  useEffect(() => {
    if (head && head.status === "ready" && willAuto && catDef) {
      api.confirmPending(head.id, head.filename, catDef.dir, false)
        .then((gid) => markOrganized(gid))
        .catch(() => {})
        .finally(() => poll());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [head?.id, head?.status, willAuto]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tasks.filter((t) => {
      const { name, category } = metaOf(t);
      // Hide aria2's magnet metadata placeholder once it's done (the real torrent takes over).
      if (name.startsWith("[METADATA]") && t.status !== "active" && t.status !== "waiting" && t.status !== "paused") return false;
      // A magnet's metadata download spawns the real torrent (followedBy); never show the parent.
      if (Array.isArray(t.followedBy) && t.followedBy.length > 0) return false;
      // Search matches the name and the source URL/host.
      if (q && !name.toLowerCase().includes(q) && !taskUrl(t).toLowerCase().includes(q)) return false;
      if (statusFilter !== "all" && t.status !== statusFilter) return false;
      if (typeFilter !== "all" && category !== typeFilter) return false;
      const isGrab = !!grabbed[taskUrl(t)];
      if (view === "sitegrab") return isGrab;
      if (isGrab) return false;
      const isTorrent = !!t.bittorrent;
      if (view === "torrents") return isTorrent;
      if (isTorrent) return false;
      if (categoryFilter && categoryNameOf(name, categories) !== categoryFilter) return false;
      if (queueFilter && queueOf(t, queueMap) !== queueFilter) return false;
      if (view === "active") return t.status === "active" || t.status === "waiting";
      if (view === "unfinished") return t.status !== "complete";
      if (view === "completed") return t.status === "complete";
      if (view === "media") return category === "video" || category === "audio" || category === "image";
      return true;
    });
  }, [tasks, view, query, statusFilter, typeFilter, categoryFilter, categories, queueFilter, queueMap, grabbed]);

  // Warn when downloads are sitting idle because the queue they're in is paused.
  const pausedAlert = useMemo(() => {
    const stopped = new Set(queues.filter((q) => !q.running).map((q) => q.id));
    if (stopped.size === 0) return null;
    const ids = new Set<string>();
    let count = 0;
    for (const t of tasks) {
      if (t.dmKind === "site") continue;
      if (t.status === "complete" || t.status === "error" || t.status === "removed") continue;
      if (Array.isArray(t.followedBy) && t.followedBy.length > 0) continue;
      const qid = queueOf(t, queueMap);
      if (stopped.has(qid)) { ids.add(qid); count++; }
    }
    if (count === 0) return null;
    const list = [...ids];
    return { count, ids: list, names: list.map((id) => queues.find((q) => q.id === id)?.name || id) };
  }, [tasks, queues, queueMap]);

  return (
    <div
      className="flex h-full"
      onDragOver={(e) => {
        if (!hasDraggable(e.dataTransfer)) return;
        e.preventDefault();
        if (!dragging) setDragging(true);
        if (dragTimer.current) window.clearTimeout(dragTimer.current);
        dragTimer.current = window.setTimeout(() => setDragging(false), 160);
      }}
      onDrop={(e) => { if (dragTimer.current) window.clearTimeout(dragTimer.current); onDrop(e); }}
    >
      {liveBg && <SignalBackground />}
      <Sidebar />
      <main className="relative z-10 flex-1 flex flex-col min-w-0">
        <TopBar onAdd={() => setAdding(true)} onGrab={() => { setGrabUrl(""); setGrabbing(true); }} />
        {selected.size > 0 && (
          <div className="flex items-center gap-2 px-6 py-2 border-b border-white/5 bg-ink-800/50 flex-wrap">
            <span className="text-sm text-slate-200">{selected.size} selected</span>
            <button className="btn-ghost !py-1.5" onClick={() => setSelected(filtered.map((t) => t.gid))}>All ({filtered.length})</button>
            <button className="btn-ghost !py-1.5" onClick={() => {
              [...selected].forEach((gid) => { const t = tasks.find((x) => x.gid === gid); if (t?.status === "error") api.add([t.files?.[0]?.uris?.[0]?.uri || ""].filter(Boolean)).catch(() => {}); });
              clearSelected();
            }}>Retry failed</button>
            <button className="btn-ghost !py-1.5" onClick={async () => {
              for (const gid of selected) {
                const t = tasks.find((x) => x.gid === gid);
                if (t?.status === "complete" && t.dmChecksum && t.files?.[0]?.path) {
                  await api.verifyChecksum(t.files[0].path, t.dmChecksum).then((ok) => {
                    api.setDlMeta(gid, {}).catch(() => {});
                    if (!ok) pushToast.error(`Mismatch: ${t.files[0].path.split("/").pop()}`);
                  }).catch(() => {});
                }
              }
            }}>Verify checksums</button>
            <button className="btn-ghost !py-1.5 !text-rose-300" onClick={() => setConfirmBulk(true)}>Delete…</button>
            <button className="btn-ghost !py-1.5 ml-auto" onClick={clearSelected}>✕ Clear</button>
          </div>
        )}
        {pausedAlert && (
          <div className="flex items-center gap-3 px-6 py-2.5 border-b border-amber-500/20 bg-amber-500/10 text-sm">
            <I.Pause className="w-4 h-4 text-amber-400 shrink-0" />
            <span className="text-amber-100">
              {pausedAlert.count} download{pausedAlert.count > 1 ? "s" : ""} won't start — the {pausedAlert.names.join(", ")} queue{pausedAlert.names.length > 1 ? "s are" : " is"} paused.
            </span>
            <button
              className="btn-ghost !py-1 !px-2.5 ml-auto !text-amber-100 hover:!text-white"
              onClick={() => pausedAlert.ids.forEach((id) => api.setQueueRunning(id, true).catch(() => {}))}
            >
              <I.Play className="w-3.5 h-3.5" /> Resume {pausedAlert.ids.length > 1 ? "queues" : "queue"}
            </button>
          </div>
        )}
        {view !== "settings" && view !== "stats" && tasks.length > 0 && (
          <div className="flex items-center gap-2 px-6 py-2 border-b border-white/5 text-xs">
            <span className="text-slate-500">Filter</span>
            <FilterSelect value={statusFilter} onChange={setStatusFilter} options={[["all", "Any status"], ["active", "Downloading"], ["waiting", "Queued"], ["paused", "Paused"], ["complete", "Completed"], ["error", "Failed"]]} />
            <FilterSelect value={typeFilter} onChange={setTypeFilter} options={[["all", "Any type"], ["video", "Video"], ["audio", "Audio"], ["image", "Image"], ["doc", "Document"], ["archive", "Archive"], ["other", "Other"]]} />
            {(statusFilter !== "all" || typeFilter !== "all") && (
              <button className="text-aurora-300 hover:text-aurora-200" onClick={() => { setStatusFilter("all"); setTypeFilter("all"); }}>Clear</button>
            )}
            <span className="ml-auto text-slate-600">{filtered.length} shown</span>
          </div>
        )}
        <section className="flex-1 overflow-y-auto p-6">
          <ErrorBoundary>
          {view === "settings" ? (
            <SettingsView />
          ) : view === "stats" ? (
            <StatsView />
          ) : view === "about" ? (
            <AboutView />
          ) : filtered.length ? (
            listMode === "table" ? (
              <DownloadTable rows={filtered} />
            ) : (
              <div className="grid gap-3 dm-stagger">
                {filtered.map((t) => <DownloadCard key={t.gid} t={t} />)}
              </div>
            )
          ) : (
            <div className="h-full grid place-items-center px-6">
              <div className="w-full max-w-2xl animate-fade-up">
                <div className="flex items-end gap-5 pb-4 border-b border-white/10">
                  <div className="text-[64px] leading-[0.8] font-mono font-semibold text-aurora-400">00</div>
                  <div className="pb-0.5">
                    <div className="text-[10px] font-mono uppercase text-slate-600">Transfer queue</div>
                    <h2 className="mt-1 text-xl font-semibold text-white">Ledger is clear</h2>
                    <p className="mt-1 text-sm text-slate-400">No active, queued, or archived transfers in this view.</p>
                  </div>
                  <div className="ml-auto hidden sm:block text-right font-mono text-[10px] text-slate-600">
                    <div>{connected ? "ARIA2 // READY" : "ARIA2 // SYNCING"}</div>
                    <div>{connected ? "RPC // 6810" : "WAIT // RETRY"}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-5">
                  <button className="btn-primary" onClick={() => setAdding(true)}><I.Plus className="w-4 h-4" /> New download</button>
                  <button className="btn-ghost" onClick={() => { setGrabUrl(""); setGrabbing(true); }}><I.Globe className="w-4 h-4" /> Grab a site</button>
                </div>
                <div className="mt-7 grid grid-cols-3 border border-white/10 text-xs text-slate-500">
                  <div className="p-3 border-r border-white/10"><span className="block mb-2 font-mono text-aurora-300">01 / ADD</span>Paste a URL, magnet link, or local torrent.</div>
                  <div className="p-3 border-r border-white/10"><span className="block mb-2 font-mono text-magenta-400">02 / ROUTE</span>The browser connector sends media here.</div>
                  <div className="p-3"><span className="block mb-2 font-mono text-amber-300">03 / FILE</span>Completed transfers sort by category.</div>
                </div>
              </div>
            </div>
          )}
          </ErrorBoundary>
        </section>
      </main>

      {adding && <AddModal onClose={() => setAdding(false)} />}

      {grabbing && <SiteGrabber initialUrl={grabUrl} onClose={() => { setGrabbing(false); setGrabUrl(""); }} />}

      {!onboarded && <FirstRunPanel onDismiss={() => { localStorage.setItem("dm-onboarded", "1"); setOnboarded(true); }} />}

      {head && !willAuto && <ConfirmDownload key={head.id} item={head} onDone={poll} />}

      {dragging && (
        <div className="fixed inset-3 z-40 grid place-items-center bg-aurora-600/10 backdrop-blur-sm border-4 border-dashed border-aurora-400/50 rounded-2xl pointer-events-none">
          <div className="text-aurora-200 text-lg font-semibold">Drop links, .torrent, or .metalink files to download</div>
        </div>
      )}

      {confirmBulk && (
        <div className="fixed inset-0 z-[70] grid place-items-center bg-black/60 backdrop-blur-sm animate-fade-up" onClick={() => setConfirmBulk(false)}>
          <div className="card w-[440px] max-w-[92vw] p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold mb-1">Delete {selected.size} download{selected.size > 1 ? "s" : ""}?</h2>
            <p className="text-sm text-slate-500 mb-4">They’ll be removed from the list. You can also delete the downloaded files from your disk — this can’t be undone.</p>
            <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer select-none">
              <input type="checkbox" checked={bulkDisk} onChange={(e) => setBulkDisk(e.target.checked)} /> Also delete the files from disk
            </label>
            <div className="flex justify-end gap-2 mt-5">
              <button className="btn-ghost" onClick={() => { setConfirmBulk(false); setBulkDisk(false); }}>Cancel</button>
              <button className={bulkDisk ? "btn-danger" : "btn-primary"} onClick={bulkDelete}>{bulkDisk ? "Delete files" : "Remove from list"}</button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 card px-4 py-3 flex items-center gap-3 animate-fade-up shadow-glow">
          <span className="text-sm text-slate-200 max-w-md truncate">{toast.msg}</span>
          {toast.onYes && <button className="btn-primary !py-1.5" onClick={toast.onYes}>Add</button>}
          <button className="btn-ghost !py-1.5" onClick={() => setToast(null)}>Dismiss</button>
        </div>
      )}
      <Toaster />
    </div>
  );
}

