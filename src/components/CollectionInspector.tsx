import { useEffect, useState } from "react";
import { api, CollectionPage, DownloadProfile, Queue } from "../lib/api";
import { fmtBytes } from "../lib/format";
import { toast } from "../lib/toast";
import { I } from "./icons";
import { useDialogFocus } from "../lib/useDialogFocus";

const PAGE_SIZE = 50;

export default function CollectionInspector({ sourceUrl, initialProfileId, queues, onClose }: {
  sourceUrl: string;
  initialProfileId?: string;
  queues: Queue[];
  onClose: () => void;
}) {
  const dialogRef = useDialogFocus<HTMLDivElement>(onClose);
  const [sessionId, setSessionId] = useState("");
  const [page, setPage] = useState<CollectionPage | null>(null);
  const [offset, setOffset] = useState(0);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [profiles, setProfiles] = useState<DownloadProfile[]>([]);
  const [profileId, setProfileId] = useState(initialProfileId || "");
  const [queueId, setQueueId] = useState("main");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    Promise.all([api.listDownloadProfiles(), api.activeDownloadProfile()])
      .then(([items, active]) => {
        if (cancelled) return;
        setProfiles(items);
        const selectedProfile = initialProfileId || active.id;
        setProfileId(selectedProfile);
        const selected = items.find((item) => item.id === selectedProfile) || active;
        setQueueId(selected.queueId || "main");
        return api.collectionInspectStart(
          sourceUrl,
          selectedProfile,
          100,
          localStorage.getItem("dm-cookies-browser") || undefined,
        );
      })
      .then((session) => { if (!cancelled && session) setSessionId(session.id); })
      .catch((reason) => { if (!cancelled) setError(String(reason)); });
    return () => { cancelled = true; };
  }, [sourceUrl, initialProfileId]);

  useEffect(() => {
    if (!sessionId) return;
    let disposed = false;
    let timer = 0;
    const refresh = () => {
      api.collectionInspectPage(sessionId, offset, PAGE_SIZE, query || undefined, filter)
        .then((result) => {
          if (disposed) return;
          setPage(result);
          setError(result.session.error || "");
          if (result.session.status === "loading" || result.session.enqueueStatus === "running") {
            timer = window.setTimeout(refresh, 700);
          }
        })
        .catch((reason) => { if (!disposed) setError(String(reason)); });
    };
    refresh();
    return () => { disposed = true; window.clearTimeout(timer); };
  }, [sessionId, offset, query, filter]);

  async function setItem(index: number, selected: boolean) {
    if (!sessionId) return;
    setPage((current) => current ? {
      ...current,
      selectedCount: Math.max(0, current.selectedCount + (selected ? 1 : -1)),
      items: current.items.map((item) => item.index === index ? { ...item, selected } : item),
    } : current);
    try {
      await api.collectionSelectItems(sessionId, [index], selected);
    } catch (reason) {
      setError(String(reason));
      const next = await api.collectionInspectPage(sessionId, offset, PAGE_SIZE, query || undefined, filter);
      setPage(next);
    }
  }

  async function setAll(selected: boolean) {
    if (!sessionId) return;
    setBusy(true);
    try {
      await api.collectionSelectItems(sessionId, [], selected);
      const next = await api.collectionInspectPage(sessionId, offset, PAGE_SIZE, query || undefined, filter);
      setPage(next);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function enqueue() {
    if (!sessionId || !page?.selectedCount) return;
    setBusy(true);
    try {
      const result = await api.collectionEnqueueSelected(sessionId, profileId || undefined, queueId || undefined);
      toast.success(`Queued ${result.queued} collection item${result.queued === 1 ? "" : "s"}`);
      const next = await api.collectionInspectPage(sessionId, offset, PAGE_SIZE, query || undefined, filter);
      setPage(next);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setBusy(false);
    }
  }

  async function close() {
    if (sessionId && (page?.session.status === "loading" || page?.session.enqueueStatus === "running")) {
      await api.collectionCancel(sessionId).catch(() => {});
    }
    onClose();
  }

  const session = page?.session;
  const pageNumber = Math.floor(offset / PAGE_SIZE) + 1;
  const pageCount = Math.max(1, Math.ceil((page?.filteredCount || 0) / PAGE_SIZE));
  const progressTotal = session?.totalKnown || session?.loadedCount || 0;
  const downloading = session?.enqueueStatus === "running";

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/65 p-3 animate-fade-up" onClick={close}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="collection-title" tabIndex={-1} className="card w-[1120px] max-w-[98vw] h-[88vh] min-h-[580px] flex flex-col overflow-hidden" onClick={(event) => event.stopPropagation()}>
        <header className="flex items-start gap-3 px-5 py-4 border-b border-white/10">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="chip">{session?.sourceType || "collection"}</span>
              {session?.status === "loading" && <span className="text-xs text-aurora-300">Inspecting {session.loadedCount}{progressTotal ? ` / ${progressTotal}` : ""}</span>}
              {downloading && <span className="text-xs text-lime-400">Downloaded {session.enqueuedCount}{session.failedCount ? `, ${session.failedCount} failed` : ""}</span>}
            </div>
            <h2 id="collection-title" className="mt-1 text-lg font-semibold truncate">{session?.title || "Collection inspector"}</h2>
            <p className="mt-0.5 text-xs text-slate-500 truncate" title={sourceUrl}>{sourceUrl}</p>
          </div>
          <button className="btn-ghost !p-2 shrink-0" title="Close inspector" onClick={close}><I.Close className="w-4 h-4" /></button>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_auto] gap-2 px-4 py-3 border-b border-white/10 bg-ink-900/35">
          <div className="relative">
            <I.Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-600" />
            <input value={query} onChange={(event) => { setQuery(event.target.value); setOffset(0); }} placeholder="Search title or uploader" className="control pl-9" />
          </div>
          <div className="relative">
            <select value={filter} onChange={(event) => { setFilter(event.target.value); setOffset(0); }} className="control appearance-none pr-9 min-w-36">
              <option value="all">All items</option>
              <option value="selected">Selected</option>
              <option value="live">Live</option>
              <option value="unavailable">Unavailable</option>
              <option value="archived">Archived</option>
            </select>
            <I.Down className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          </div>
          <div className="flex gap-2">
            <button className="btn-ghost whitespace-nowrap" disabled={busy} onClick={() => setAll(true)}>Select all</button>
            <button className="btn-ghost whitespace-nowrap" disabled={busy} onClick={() => setAll(false)}>None</button>
          </div>
        </div>

        {error && <div className="mx-4 mt-3 px-3 py-2 border border-rose-500/30 bg-rose-500/10 text-xs text-rose-200 break-words">{error}</div>}

        <div className="flex-1 min-h-0 overflow-auto">
          <div className="hidden md:grid grid-cols-[34px_72px_minmax(220px,1fr)_150px_86px_92px_92px] sticky top-0 z-10 min-w-[840px] px-4 h-9 items-center text-[10px] font-mono uppercase text-slate-600 border-b border-white/10 bg-ink-850">
            <span /><span /><span>Title</span><span>Uploader</span><span>Duration</span><span>Date</span><span>Status</span>
          </div>
          <div className="min-w-0 md:min-w-[840px]">
            {(page?.items || []).map((item) => (
              <label key={item.index} className="grid grid-cols-[28px_64px_minmax(0,1fr)] md:grid-cols-[34px_72px_minmax(220px,1fr)_150px_86px_92px_92px] h-[72px] px-3 md:px-4 items-center border-b border-white/5 hover:bg-white/[0.03] cursor-pointer">
                <input type="checkbox" disabled={item.archived} checked={item.selected} onChange={(event) => setItem(item.index, event.target.checked)} />
                <div className="w-14 h-10 bg-ink-700 border border-white/5 overflow-hidden">
                  {item.thumbnail ? <img src={item.thumbnail} alt="" loading="lazy" className="w-full h-full object-cover" /> : <div className="w-full h-full grid place-items-center"><I.Media className="w-4 h-4 text-slate-600" /></div>}
                </div>
                <div className="min-w-0 pr-3">
                  <div className="text-sm text-slate-200 truncate" title={item.title}>{item.title || item.mediaId || "Untitled item"}</div>
                  <div className="md:hidden mt-1 text-[11px] text-slate-600 truncate">{item.uploader || "Unknown uploader"} · {formatDuration(item.durationSec)}</div>
                  {item.estimatedSize > 0 && <div className="text-[10px] text-slate-600">~{fmtBytes(item.estimatedSize)}</div>}
                </div>
                <span className="hidden md:block text-xs text-slate-500 truncate" title={item.uploader}>{item.uploader || "-"}</span>
                <span className="hidden md:block text-xs font-mono text-slate-500">{formatDuration(item.durationSec)}</span>
                <span className="hidden md:block text-xs font-mono text-slate-500">{formatDate(item.uploadDate)}</span>
                <span className={`hidden md:block text-[10px] font-mono uppercase ${item.enqueueStatus === "error" ? "text-rose-400" : item.enqueueStatus === "complete" || item.archived ? "text-lime-400" : item.liveState === "is_live" ? "text-amber-300" : "text-slate-600"}`}>{item.archived ? "archived" : item.enqueueStatus || (item.liveState === "is_live" ? "live" : item.availability || "ready")}</span>
              </label>
            ))}
          </div>
          {!page?.items.length && <div className="h-full min-h-44 grid place-items-center text-sm text-slate-500">{session?.status === "loading" ? "Fetching the first page..." : "No items match this view."}</div>}
        </div>

        <footer className="grid grid-cols-1 lg:grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-3 border-t border-white/10 bg-ink-900/45">
          <div className="flex items-center gap-2 text-xs text-slate-500">
            <button className="btn-ghost !p-2" title="Previous page" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}><I.Up className="w-4 h-4 -rotate-90" /></button>
            <span className="font-mono whitespace-nowrap">Page {pageNumber} / {pageCount}</span>
            <button className="btn-ghost !p-2" title="Next page" disabled={offset + PAGE_SIZE >= (page?.filteredCount || 0)} onClick={() => setOffset(offset + PAGE_SIZE)}><I.Up className="w-4 h-4 rotate-90" /></button>
            <span className="hidden sm:inline">{page?.selectedCount || 0} selected</span>
          </div>
          <div className="grid grid-cols-2 gap-2 min-w-0">
            <select value={profileId} onChange={(event) => {
              const next = event.target.value;
              setProfileId(next);
              const profile = profiles.find((item) => item.id === next);
              if (profile) setQueueId(profile.queueId || "main");
            }} className="control min-w-0">
              {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
            </select>
            <select value={queueId} onChange={(event) => setQueueId(event.target.value)} className="control min-w-0">
              {(queues.length ? queues : [{ id: "main", name: "Main" } as Queue]).map((queue) => <option key={queue.id} value={queue.id}>{queue.name}</option>)}
            </select>
          </div>
          <div className="flex justify-end gap-2">
            {(session?.status === "loading" || downloading) && <button className="btn-ghost" onClick={() => sessionId && api.collectionCancel(sessionId).catch(() => {})}>Cancel work</button>}
            <button className="btn-primary whitespace-nowrap" disabled={busy || !page?.selectedCount || session?.status !== "ready" || downloading} onClick={enqueue}>
              <I.Plus className="w-4 h-4" /> {downloading ? "Downloading..." : `Download ${page?.selectedCount || 0}`}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}

function formatDuration(seconds: number): string {
  if (!seconds) return "-";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}` : `${minutes}:${String(secs).padStart(2, "0")}`;
}

function formatDate(value: string): string {
  if (!/^\d{8}$/.test(value)) return "-";
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}
