import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Aria2Task, api } from "../lib/api";
import { fmtBytes, fmtSpeed, eta } from "../lib/format";
import { metaOf, useStore } from "../store";
import { toast } from "../lib/toast";
import { I } from "./icons";
import { DetailsPanel, VerifyBadge, MissingBadge, RetryBadge } from "./downloadShared";

const catColor: Record<string, string> = {
  video: "text-magenta-400", audio: "text-aurora-300", image: "text-lime-400",
  doc: "text-amber-300", archive: "text-orange-400", torrent: "text-violet-300", other: "text-slate-400",
};

export default function DownloadCard({ t }: { t: Aria2Task }) {
  const { name, category } = metaOf(t);
  const selected = useStore((s) => s.selected);
  const toggleSelected = useStore((s) => s.toggleSelected);
  const pauseTask = useStore((s) => s.pauseTask);
  const resumeTask = useStore((s) => s.resumeTask);
  const retryTask = useStore((s) => s.retryTask);
  const total = +t.totalLength || 0;
  const done = +t.completedLength || 0;
  const speed = +t.downloadSpeed || 0;
  const pct = total ? Math.min(100, (done / total) * 100) : 0;
  const active = t.status === "active";
  const paused = t.status === "paused" || t.status === "waiting";
  const isSite = t.gid.startsWith("site-");
  const canControl = !isSite && t.status !== "complete" && t.status !== "error";
  const isTorrent = !!t.bittorrent;

  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameVal, setRenameVal] = useState("");
  const [showProps, setShowProps] = useState(false);
  const kebabRef = useRef<HTMLButtonElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  function openMenu() {
    const r = kebabRef.current?.getBoundingClientRect();
    if (r) {
      const estH = 340;
      const top = r.bottom + 6 + estH > window.innerHeight ? Math.max(8, r.top - 6 - estH) : r.bottom + 6;
      setMenuPos({ top, left: Math.max(8, Math.min(r.right - 208, window.innerWidth - 216)) });
    }
    setMenuOpen(true);
  }

  const completed = t.status === "complete";
  const path = t.files?.[0]?.path || "";
  const hasPath = path.startsWith("/");
  const srcUrl = t.files?.[0]?.uris?.[0]?.uri || "";

  async function act(fn: () => unknown) {
    try { await fn(); } catch { /* ignore */ }
    setMenuOpen(false);
    setConfirmDel(false);
  }

  function doRename() {
    const n = renameVal.trim();
    if (n) api.renameFile(t.gid, n).catch(() => {});
    setRenaming(false);
  }

  async function doMove() {
    setMenuOpen(false);
    const d = await api.pickFolder().catch(() => null);
    if (d) api.moveFile(t.gid, d).catch(() => {});
  }

  function openAt(x: number, y: number) {
    const estH = 340;
    const top = y + estH > window.innerHeight ? Math.max(8, y - estH) : y;
    setMenuPos({ top, left: Math.max(8, Math.min(x, window.innerWidth - 216)) });
    setMenuOpen(true);
  }

  return (
    <div className={`card p-4 relative hover:border-white/10 transition-colors ${active ? "dm-glow" : ""}`} onContextMenu={(e) => { if ((e.target as HTMLElement).closest("input, textarea, select, [contenteditable='true']")) return; e.preventDefault(); openAt(e.clientX, e.clientY); }}>
      <div className="flex items-center gap-3">
        <input type="checkbox" className="shrink-0" checked={selected.has(t.gid)} onChange={() => toggleSelected(t.gid)} />
        <span className={`chip shrink-0 ${catColor[category]}`}>{category}</span>
        <div className="font-medium text-sm truncate flex-1 min-w-0" title={name}>{name}</div>
        <div className="flex items-center gap-1 shrink-0">
          {completed && hasPath && (
            <button className="btn-ghost !p-2 hover:text-aurora-300" title="Open file" onClick={() => api.openPath(path).catch(() => {})}><I.Open className="w-4 h-4" /></button>
          )}
          {canControl && (
            <button className={`btn-ghost !p-2 ${open ? "text-aurora-300" : ""}`} title="Details" onClick={() => setOpen((o) => !o)}>
              <I.More className="w-4 h-4" />
            </button>
          )}
          {active && <button className="btn-ghost !p-2" title="Pause" onClick={() => pauseTask(t.gid).catch(() => {})}><I.Pause className="w-4 h-4" /></button>}
          {paused && <button className="btn-ghost !p-2" title="Resume" onClick={() => resumeTask(t.gid).catch(() => {})}><I.Play className="w-4 h-4" /></button>}
          <button ref={kebabRef} className={`btn-ghost !p-2 ${menuOpen ? "text-aurora-300" : ""}`} title="More actions" onClick={() => (menuOpen ? setMenuOpen(false) : openMenu())}><I.Kebab className="w-4 h-4" /></button>
        </div>
      </div>

      {menuOpen &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[55]" onClick={() => { setMenuOpen(false); setConfirmDel(false); }} />
            <div
              className="fixed z-[56] w-52 max-h-[340px] overflow-auto rounded-xl border border-white/10 bg-ink-800/95 backdrop-blur-md p-1 text-sm shadow-glow"
              style={{ top: menuPos.top, left: menuPos.left }}
            >
              {completed && hasPath && <MenuItem onClick={() => act(() => api.openPath(path))}>Open file</MenuItem>}
              {hasPath && <MenuItem onClick={() => act(() => api.revealPath(path))}>Open folder</MenuItem>}
              {srcUrl && <MenuItem onClick={() => act(() => navigator.clipboard.writeText(srcUrl))}>Copy link</MenuItem>}
              {srcUrl && completed && <MenuItem onClick={() => act(() => api.redownload(srcUrl, path))}>Redownload</MenuItem>}
              {srcUrl && t.status === "error" && <MenuItem onClick={() => act(() => retryTask(t.gid))}>Retry</MenuItem>}
              {completed && hasPath && <MenuItem onClick={() => { setRenameVal(name); setRenaming(true); setMenuOpen(false); }}>Rename…</MenuItem>}
              {completed && hasPath && <MenuItem onClick={doMove}>Move to…</MenuItem>}
              <MenuItem onClick={() => { setShowProps(true); setMenuOpen(false); }}>Properties</MenuItem>
              {canControl && <MenuItem onClick={() => { setOpen((o) => !o); setMenuOpen(false); }}>{open ? "Hide details" : "Show details"}</MenuItem>}
              <div className="my-1 border-t border-white/5" />
              <MenuItem onClick={() => act(() => api.remove(t.gid))}>Remove from list</MenuItem>
              {!confirmDel ? (
                <MenuItem danger onClick={() => setConfirmDel(true)}>Delete from disk…</MenuItem>
              ) : (
                <MenuItem danger onClick={() => act(() => api.deleteFile(t.gid))}>⚠ Confirm delete file</MenuItem>
              )}
            </div>
          </>,
          document.body
        )}
      <div className="dm-progress-track relative mt-3 h-2 overflow-hidden">
        <div className={`absolute inset-y-0 left-0 ${t.status === "complete" ? "bg-lime-500" : "dm-progress-active"} ${active && "progress-shimmer"}`} style={{ width: `${pct}%` }} />
      </div>
      <div className="flex items-center justify-between mt-2 text-xs text-slate-500">
        <span>{fmtBytes(done)} / {fmtBytes(total)} · {pct.toFixed(0)}%</span>
        <span className="flex items-center gap-1">{active ? `${fmtSpeed(speed)} · ${eta(total, done, speed)}` : t.status}{completed && (t.dmMissing ? <MissingBadge /> : <VerifyBadge status={t.dmVerify} />)}{!completed && t.dmRetry ? <RetryBadge n={t.dmRetry} /> : null}</span>
      </div>
      {t.status === "error" && t.errorMessage && (
        <div className="mt-2 text-xs text-rose-400/90 break-words" title={t.errorMessage}>
          {t.errorMessage}
        </div>
      )}
      {t.status === "error" && t.dmKind === "site" && srcUrl && (
        <div className="mt-2 flex flex-wrap gap-2">
          <button className="btn-ghost !py-1 !px-2 text-xs" onClick={() => retryTask(t.gid).catch(() => {})}>
            Retry
          </button>
          {localStorage.getItem("dm-cookies-browser") && localStorage.getItem("dm-cookies-browser") !== "none" && (
            <button className="btn-ghost !py-1 !px-2 text-xs text-amber-300" onClick={() => {
              const cb = localStorage.getItem("dm-cookies-browser") || undefined;
              retryTask(t.gid, cb).catch(() => {});
            }}>
              Retry with cookies
            </button>
          )}
          <button className="btn-ghost !py-1 !px-2 text-xs" onClick={async () => {
            toast.info("Updating yt-dlp…", "Fetching the latest version, then retrying.");
            try { await api.updateYtdlp(); } catch { /* fall through to retry anyway */ }
            retryTask(t.gid, localStorage.getItem("dm-cookies-browser") || undefined).catch(() => {});
          }}>
            Update yt-dlp &amp; retry
          </button>
        </div>
      )}

      {open && (canControl || isTorrent) && (
        <div className="mt-3 pt-3 border-t border-white/5">
          <DetailsPanel t={t} />
        </div>
      )}

      {renaming &&
        createPortal(
          <div className="fixed inset-0 z-[70] grid place-items-center bg-black/50 backdrop-blur-sm" onClick={() => setRenaming(false)}>
            <div className="card w-[440px] max-w-[92vw] p-5" onClick={(e) => e.stopPropagation()}>
              <h3 className="font-semibold mb-3">Rename file</h3>
              <input autoFocus value={renameVal} onChange={(e) => setRenameVal(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") doRename(); }}
                className="w-full bg-ink-900/60 border border-white/5 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-aurora-500/50" />
              <div className="flex justify-end gap-2 mt-4">
                <button className="btn-ghost" onClick={() => setRenaming(false)}>Cancel</button>
                <button className="btn-primary" onClick={doRename}>Rename</button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {showProps &&
        createPortal(
          <div className="fixed inset-0 z-[70] grid place-items-center bg-black/50 backdrop-blur-sm" onClick={() => setShowProps(false)}>
            <div className="card w-[540px] max-w-[94vw] p-5" onClick={(e) => e.stopPropagation()}>
              <h3 className="font-semibold mb-3">Properties</h3>
              <PropRow label="Name" value={name} />
              <PropRow label="Size" value={fmtBytes(total)} />
              <PropRow label="Category" value={category} />
              <PropRow label="Status" value={t.status} />
              {hasPath && <PropRow label="Saved to" value={path} copy />}
              {srcUrl && <PropRow label="Source URL" value={srcUrl} copy />}
              <div className="flex justify-end mt-4"><button className="btn-primary" onClick={() => setShowProps(false)}>Close</button></div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

function PropRow({ label, value, copy }: { label: string; value: string; copy?: boolean }) {
  return (
    <div className="flex items-start gap-3 py-1.5 border-b border-white/5 last:border-0">
      <span className="text-xs text-slate-500 w-24 shrink-0 pt-0.5">{label}</span>
      <span className="text-sm text-slate-200 break-all flex-1">{value}</span>
      {copy && (
        <button className="text-[11px] text-aurora-300 hover:underline shrink-0 pt-0.5" onClick={() => navigator.clipboard.writeText(value)}>copy</button>
      )}
    </div>
  );
}

function MenuItem({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-3 py-1.5 rounded-lg hover:bg-white/5 transition-colors ${danger ? "text-rose-400" : "text-slate-200"}`}
    >
      {children}
    </button>
  );
}

