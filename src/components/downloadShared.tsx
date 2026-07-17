import { type ReactElement, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Aria2Task, JobSchedule, NetworkOverride, api } from "../lib/api";
import { fmtBytes } from "../lib/format";
import { toast } from "../lib/toast";
import { queueOf, taskUrl, useStore } from "../store";
import { I } from "./icons";

export const catColor: Record<string, string> = {
  video: "text-magenta-400", audio: "text-aurora-300", image: "text-lime-400",
  doc: "text-amber-300", archive: "text-orange-400", torrent: "text-violet-300", other: "text-slate-400",
};

/** Inline verification status badge — shown next to "Done" in table/card. */
export function VerifyBadge({ status }: { status?: string }) {
  if (!status || status === "") return null;
  if (status === "pending") return <span className="ml-1 text-[10px] text-amber-400/90 border border-amber-400/30 rounded px-1">checksum…</span>;
  if (status === "ok") return <span className="ml-1 text-[10px] text-lime-400 border border-lime-500/30 rounded px-1">✓ verified</span>;
  if (status === "fail") return <span className="ml-1 text-[10px] text-rose-400 border border-rose-500/40 rounded px-1">✗ mismatch</span>;
  return null;
}

/** Shown when a completed download's file has been deleted or moved off disk. */
export function MissingBadge() {
  return <span className="ml-1 text-[10px] text-rose-400 border border-rose-500/40 rounded px-1" title="The file was deleted or moved">file missing</span>;
}

/** Shown while the auto-retry loop is re-attempting a transient failure. */
export function RetryBadge({ n }: { n: number }) {
  return <span className="ml-1 text-[10px] text-amber-400/90 border border-amber-400/30 rounded px-1" title="A transient failure is being retried automatically">retry {n}/3</span>;
}

export function taskFlags(t: Aria2Task) {
  const isSite = t.gid.startsWith("site-");
  const completed = t.status === "complete";
  const canControl = !isSite && !completed && t.status !== "error";
  const isTorrent = !!t.bittorrent && (t.files?.length || 0) > 1;
  const path = t.files?.[0]?.path || "";
  const hasPath = path.startsWith("/");
  const srcUrl = t.files?.[0]?.uris?.[0]?.uri || "";
  return { isSite, completed, canControl, isTorrent, path, hasPath, srcUrl };
}

// Turn aria2's piece bitfield (hex) into fixed fill fractions for a segmented progress bar.
function bitfieldBuckets(bitfield: string, numPieces: number, buckets = 80): number[] {
  if (!bitfield || numPieces <= 0) return [];
  const bits: number[] = [];
  for (let i = 0; i < bitfield.length && bits.length < numPieces; i++) {
    const nib = parseInt(bitfield[i], 16);
    if (Number.isNaN(nib)) continue;
    for (let b = 3; b >= 0; b--) bits.push((nib >> b) & 1);
  }
  const n = Math.min(buckets, numPieces);
  const per = numPieces / n;
  const out: number[] = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const start = Math.floor(i * per);
    const end = Math.max(start + 1, Math.floor((i + 1) * per));
    let done = 0, total = 0;
    for (let j = start; j < end && j < numPieces; j++) { total++; done += bits[j] || 0; }
    out[i] = total ? done / total : 0;
  }
  return out;
}

function cellStyle(f: number): React.CSSProperties {
  if (f <= 0) return { background: "rgba(255,255,255,0.06)" };
  const o = 0.35 + 0.65 * f;
  return { background: `rgba(31,147,255,${o})`, boxShadow: f >= 0.999 ? "0 0 5px rgba(31,147,255,.55)" : "none" };
}

/** The action cluster (open / details / pause / resume / kebab) + portaled menu and modals.
 *  Shared by the card and the table row so behaviour stays identical. */
export function RowMenu({ t, name, category, total, detailsOpen, onToggleDetails }: {
  t: Aria2Task; name: string; category: string; total: number; detailsOpen: boolean; onToggleDetails: () => void;
}) {
  const { completed, canControl, path, hasPath, srcUrl } = taskFlags(t);
  const active = t.status === "active";
  const paused = t.status === "paused" || t.status === "waiting";
  const [menuOpen, setMenuOpen] = useState(false);
  const queues = useStore((s) => s.queues);
  const queueMap = useStore((s) => s.queueMap);
  const pauseTask = useStore((s) => s.pauseTask);
  const resumeTask = useStore((s) => s.resumeTask);
  const retryTask = useStore((s) => s.retryTask);
  const [confirmDel, setConfirmDel] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameVal, setRenameVal] = useState("");
  const [showProps, setShowProps] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyVal, setVerifyVal] = useState("");
  const [verifyMsg, setVerifyMsg] = useState("");
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

  // Open at the cursor when this row is right-clicked (dispatched from the row/card).
  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent<{ gid: string; x: number; y: number }>).detail;
      if (!d || d.gid !== t.gid) return;
      const estH = 340;
      const top = d.y + estH > window.innerHeight ? Math.max(8, d.y - estH) : d.y;
      setMenuPos({ top, left: Math.max(8, Math.min(d.x, window.innerWidth - 216)) });
      setMenuOpen(true);
    };
    window.addEventListener("dm-context", h as EventListener);
    return () => window.removeEventListener("dm-context", h as EventListener);
  }, [t.gid]);
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
  async function doVerify() {
    const exp = verifyVal.trim();
    if (!exp) return;
    setVerifyMsg("Hashing the file…");
    try {
      const ok = await api.verifyChecksum(path, exp);
      setVerifyMsg(ok ? "✓ Checksum matches — the file is intact." : "✗ Does NOT match — the file may be corrupt.");
      if (ok) toast.success(`Checksum verified: ${name}`);
      else toast.error(`Checksum mismatch: ${name}`, "The file does not match the expected hash.");
    } catch {
      setVerifyMsg("Couldn't verify — unrecognized hash type or unreadable file.");
    }
  }

  return (
    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      {completed && hasPath && (
        <button className="btn-ghost !p-2 hover:text-aurora-300" title="Open file" onClick={() => api.openPath(path).catch(() => {})}><I.Open className="w-4 h-4" /></button>
      )}
      {canControl && (
        <button className={`btn-ghost !p-2 ${detailsOpen ? "text-aurora-300" : ""}`} title="Details" onClick={onToggleDetails}><I.More className="w-4 h-4" /></button>
      )}
      {active && <button className="btn-ghost !p-2" title="Pause" onClick={() => pauseTask(t.gid).catch(() => {})}><I.Pause className="w-4 h-4" /></button>}
      {paused && <button className="btn-ghost !p-2" title="Resume" onClick={() => resumeTask(t.gid).catch(() => {})}><I.Play className="w-4 h-4" /></button>}
      <button ref={kebabRef} className={`btn-ghost !p-2 ${menuOpen ? "text-aurora-300" : ""}`} title="More actions" onClick={() => (menuOpen ? setMenuOpen(false) : openMenu())}><I.Kebab className="w-4 h-4" /></button>

      {menuOpen && createPortal(
        <>
          <div className="fixed inset-0 z-[55]" onClick={() => { setMenuOpen(false); setConfirmDel(false); }} />
          <div className="fixed z-[56] w-52 max-h-[340px] overflow-auto rounded-xl border border-white/10 bg-ink-800/95 backdrop-blur-md p-1 text-sm shadow-glow" style={{ top: menuPos.top, left: menuPos.left }}>
            {completed && hasPath && <MenuItem onClick={() => act(() => api.openPath(path))}>Open file</MenuItem>}
            {hasPath && <MenuItem onClick={() => act(() => api.revealPath(path))}>Open folder</MenuItem>}
            {srcUrl && <MenuItem onClick={() => act(() => navigator.clipboard.writeText(srcUrl))}>Copy link</MenuItem>}
            {srcUrl && completed && <MenuItem onClick={() => act(() => api.redownload(srcUrl, path))}>Redownload</MenuItem>}
            {srcUrl && t.status === "error" && <MenuItem onClick={() => act(() => retryTask(t.gid))}>Retry</MenuItem>}
            {completed && hasPath && <MenuItem onClick={() => { setRenameVal(name); setRenaming(true); setMenuOpen(false); }}>Rename…</MenuItem>}
            {completed && hasPath && <MenuItem onClick={doMove}>Move to…</MenuItem>}
            {completed && hasPath && <MenuItem onClick={() => { setVerifyVal(""); setVerifyMsg(""); setVerifying(true); setMenuOpen(false); }}>Verify checksum…</MenuItem>}
            <MenuItem onClick={() => { setShowProps(true); setMenuOpen(false); }}>Properties</MenuItem>
            {canControl && <MenuItem onClick={() => { onToggleDetails(); setMenuOpen(false); }}>{detailsOpen ? "Hide details" : "Show details"}</MenuItem>}
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

      {renaming && createPortal(
        <div className="fixed inset-0 z-[70] grid place-items-center bg-black/50 backdrop-blur-sm" onClick={() => setRenaming(false)}>
          <div className="card w-[440px] max-w-[92vw] p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold mb-3">Rename file</h3>
            <input autoFocus value={renameVal} onChange={(e) => setRenameVal(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") doRename(); }}
              className="w-full bg-ink-900/60 border border-white/5 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-aurora-500/50" />
            <div className="flex justify-end gap-2 mt-4">
              <button className="btn-ghost" onClick={() => setRenaming(false)}>Cancel</button>
              <button className="btn-primary" onClick={doRename}>Rename</button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {showProps && createPortal(
        <div className="fixed inset-0 z-[70] grid place-items-center bg-black/50 backdrop-blur-sm" onClick={() => setShowProps(false)}>
          <div className="card w-[560px] max-w-[94vw] p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold mb-3">Properties</h3>
            <PropRow label="Name" value={name} />
            <PropRow label="Size" value={total ? fmtBytes(total) : "—"} />
            <PropRow label="Category" value={category} />
            <PropRow label="Status" value={t.status} />
            {taskUrl(t) && (
              <div className="flex items-center gap-3 py-1.5 border-b border-white/5">
                <span className="text-xs text-slate-500 w-24 shrink-0">Queue</span>
                <select
                  value={queueOf(t, queueMap)}
                  onChange={(e) => api.assignQueue(taskUrl(t), e.target.value).catch(() => {})}
                  className="flex-1 appearance-none bg-ink-900/60 border border-white/5 rounded px-2 py-1.5 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-aurora-500/50"
                >
                  {queues.map((queue) => <option key={queue.id} value={queue.id}>{queue.name}</option>)}
                </select>
              </div>
            )}
            {hasPath && <PropRow label="Saved to" value={path} copy />}
            {srcUrl && <PropRow label="Source URL" value={srcUrl} copy />}
            {t.files?.length > 1 && <PropRow label="Files" value={`${t.files.length} files`} />}
            {t.connections && +t.connections > 0 && <PropRow label="Connections" value={t.connections} />}
            {t.numPieces && +t.numPieces > 0 && <PropRow label="Pieces" value={`${t.numPieces} × ${fmtBytes(+(t.pieceLength || 0))}`} />}
            {t.infoHash && <PropRow label="Info hash" value={t.infoHash} copy />}
            {t.dmChecksum && <PropRow label="Expected checksum" value={t.dmChecksum} copy />}
            {t.dmVerify && <PropRow label="Verification" value={t.dmVerify === "ok" ? "✓ Verified" : t.dmVerify === "fail" ? "✗ Mismatch" : "Pending"} />}
            {t.completedAt && <PropRow label="Completed" value={new Date(t.completedAt).toLocaleString()} />}
            <div className="flex justify-end mt-4"><button className="btn-primary" onClick={() => setShowProps(false)}>Close</button></div>
          </div>
        </div>,
        document.body
      )}

      {verifying && createPortal(
        <div className="fixed inset-0 z-[70] grid place-items-center bg-black/50 backdrop-blur-sm" onClick={() => setVerifying(false)}>
          <div className="card w-[460px] max-w-[92vw] p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold mb-1">Verify checksum</h3>
            <p className="text-xs text-slate-500 mb-3 break-words">{name}</p>
            <input autoFocus value={verifyVal} onChange={(e) => setVerifyVal(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") doVerify(); }}
              placeholder="Paste expected hash (md5 / sha1 / sha256 / sha512)"
              className="w-full bg-ink-900/60 border border-white/5 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-aurora-500/50" />
            {verifyMsg && <div className={`text-xs mt-2 ${verifyMsg.startsWith("✓") ? "text-lime-400" : verifyMsg.startsWith("✗") ? "text-rose-400" : "text-slate-500"}`}>{verifyMsg}</div>}
            <div className="flex justify-end gap-2 mt-4">
              <button className="btn-ghost" onClick={() => setVerifying(false)}>Close</button>
              <button className="btn-primary" onClick={doVerify}>Verify</button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

/** Expandable controls: segmented progress, speed cap, reorder, torrent file selection. */
type TorrentFile = Aria2Task["files"][number];
type FileTreeNode = { name: string; children: Map<string, FileTreeNode>; file?: TorrentFile };

// Build a folder tree from a torrent's file list. Paths are made relative to the
// torrent's root folder (its info name) so sub-folders are preserved.
function buildFileTree(files: TorrentFile[], rootName?: string): FileTreeNode {
  const root: FileTreeNode = { name: rootName || "", children: new Map() };
  for (const f of files) {
    const full = f.path || "";
    const segs = full.split("/").filter(Boolean);
    let rel: string[] = [];
    if (rootName) {
      let idx = -1;
      for (let i = 0; i < segs.length; i++) if (segs[i] === rootName) idx = i;
      rel = idx >= 0 ? segs.slice(idx + 1) : [];
    }
    if (rel.length === 0) rel = [segs[segs.length - 1] || full];
    let node = root;
    rel.forEach((seg, i) => {
      let child = node.children.get(seg);
      if (!child) {
        child = { name: seg, children: new Map() };
        node.children.set(seg, child);
      }
      if (i === rel.length - 1 && !child.file) child.file = f;
      node = child;
    });
  }
  return root;
}

function nodeTotals(node: FileTreeNode): { size: number; done: number } {
  let size = +(node.file?.length || 0);
  let done = +(node.file?.completedLength || 0);
  for (const c of node.children.values()) {
    const sub = nodeTotals(c);
    size += sub.size;
    done += sub.done;
  }
  return { size, done };
}

// Collapsible folder/file tree for a torrent's contents, with per-file progress.
function FileTree({ t }: { t: Aria2Task }) {
  const rootName = t.bittorrent?.info?.name;
  const tree = buildFileTree(t.files || [], rootName);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  function setSel(index: string, on: boolean) {
    const sel = new Set((t.files || []).filter((f) => f.selected === "true").map((f) => f.index || ""));
    if (on) sel.add(index); else sel.delete(index);
    const list = [...sel].filter(Boolean).sort((a, b) => +a - +b).join(",");
    api.setSelectedFiles(t.gid, list || index).catch(() => {});
  }

  function renderNode(node: FileTreeNode, depth: number, path: string): ReactElement {
    const kids = [...node.children.values()];
    const folders = kids.filter((c) => c.children.size > 0).sort((a, b) => a.name.localeCompare(b.name));
    const files = kids.filter((c) => c.children.size === 0).sort((a, b) => a.name.localeCompare(b.name));
    return (
      <>
        {folders.map((c) => {
          const cpath = `${path}/${c.name}`;
          const open = !collapsed.has(cpath);
          const tot = nodeTotals(c);
          const pct = tot.size ? Math.min(100, (tot.done / tot.size) * 100) : 0;
          return (
            <div key={cpath}>
              <button
                type="button"
                className="flex items-center gap-1.5 w-full text-left rounded hover:bg-white/5 py-0.5 text-xs"
                style={{ paddingLeft: depth * 16 }}
                onClick={() => setCollapsed((s) => { const n = new Set(s); if (n.has(cpath)) n.delete(cpath); else n.add(cpath); return n; })}
              >
                <I.Down className={`w-3 h-3 shrink-0 text-slate-500 transition-transform ${open ? "" : "-rotate-90"}`} />
                <I.Folder className="w-3.5 h-3.5 shrink-0 text-amber-300/80" />
                <span className="truncate flex-1 min-w-0 text-slate-200 font-medium" title={c.name}>{c.name}</span>
                <span className="text-slate-600 shrink-0 tabular-nums">{pct.toFixed(0)}%</span>
                <span className="text-slate-600 shrink-0">{fmtBytes(tot.size)}</span>
              </button>
              {open && renderNode(c, depth + 1, cpath)}
            </div>
          );
        })}
        {files.map((c) => {
          const f = c.file as TorrentFile;
          const flen = +f.length || 0;
          const fdone = +(f.completedLength || 0);
          const fpct = flen ? Math.min(100, (fdone / flen) * 100) : 0;
          const ready = flen > 0 && fdone >= flen && (f.path || "").startsWith("/");
          return (
            <div key={f.index ?? c.name} className="text-xs">
              <div className="flex items-center gap-2" style={{ paddingLeft: depth * 16 }}>
                <input type="checkbox" defaultChecked={f.selected === "true"} onChange={(e) => setSel(f.index || "", e.target.checked)} />
                <I.File className="w-3.5 h-3.5 shrink-0 text-slate-500" />
                <span className="truncate flex-1 min-w-0 text-slate-300" title={c.name}>{c.name}</span>
                <span className="text-slate-600 shrink-0 tabular-nums w-9 text-right">{fpct.toFixed(0)}%</span>
                <span className="text-slate-600 shrink-0">{fmtBytes(flen)}</span>
                <button className={`shrink-0 ${ready ? "text-aurora-300 hover:text-aurora-200" : "text-slate-700 cursor-default"}`} title={ready ? "Open file" : "Not finished yet"} disabled={!ready} onClick={() => ready && api.openPath(f.path).catch(() => {})}><I.Open className="w-3.5 h-3.5" /></button>
              </div>
              <div className="h-1 rounded-full bg-ink-600 overflow-hidden mt-0.5" style={{ marginLeft: depth * 16 + 26 }}>
                <div className={`h-full rounded-full ${fpct >= 100 ? "bg-lime-500" : "bg-aurora-500"}`} style={{ width: `${fpct}%` }} />
              </div>
            </div>
          );
        })}
      </>
    );
  }

  return <div className="space-y-1">{renderNode(tree, 0, "")}</div>;
}

export function DetailsPanel({ t }: { t: Aria2Task }) {
  const { canControl, hasPath, path } = taskFlags(t);
  const completed = t.status === "complete";
  const isTorrent = !!t.bittorrent;
  const [limit, setLimit] = useState("");
  const [onFin, setOnFin] = useState(() => t.dmOnComplete || "default");
  const [onFinCmd, setOnFinCmd] = useState("");
  const [csInput, setCsInput] = useState(() => t.dmChecksum || "");
  const [csSaved, setCsSaved] = useState(false);
  const [policyOpen, setPolicyOpen] = useState(false);
  const active = t.status === "active";
  const numPieces = +(t.numPieces || 0);
  const conns = +(t.connections || 0);
  const segs = t.bitfield && numPieces > 1 ? bitfieldBuckets(t.bitfield, numPieces) : [];

  // Keep local on-complete state in sync when task metadata arrives from snapshot
  useEffect(() => { if (t.dmOnComplete) setOnFin(t.dmOnComplete); }, [t.dmOnComplete]);
  useEffect(() => { if (t.dmChecksum) setCsInput(t.dmChecksum); }, [t.dmChecksum]);

  function applyLimit() {
    api.setDownloadLimit(t.gid, limit.trim() ? `${limit.trim()}K` : "0").catch(() => {});
  }

  function applyOnFin(action: string, command: string) {
    setOnFin(action);
    api.setDownloadOnComplete(t.gid, action, command).catch(() => {});
  }

  function saveChecksum() {
    const cs = csInput.trim();
    api.setDlMeta(t.gid, { checksum: cs }).catch(() => {});
    setCsSaved(true);
    setTimeout(() => setCsSaved(false), 1800);
    if (cs && completed && hasPath) {
      // Immediately re-verify if the file is already on disk.
      api.verifyChecksum(path, cs)
        .then((ok) => {
          api.setDlMeta(t.gid, {}).catch(() => {}); // touch to refresh
          if (ok) toast.success("Checksum verified — file is intact.");
          else toast.error("Checksum mismatch", "The file does not match the expected hash.");
        })
        .catch(() => {});
    }
  }

  return (
    <div className="space-y-3">
      {segs.length > 0 && (
        <div>
          <div className="flex items-center justify-between text-xs text-slate-500 mb-1.5">
            <span>Segments{active && conns > 0 && <span className="text-aurora-300"> · {conns} active</span>}</span>
            <span>{numPieces.toLocaleString()} pieces · {fmtBytes(+(t.pieceLength || 0))} each</span>
          </div>
          <div className="flex gap-[2px] h-6 items-stretch">
            {segs.map((f, i) => <div key={i} className="flex-1 rounded-[2px] transition-all duration-300" style={cellStyle(f)} />)}
          </div>
        </div>
      )}
      {canControl && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-slate-500 flex items-center gap-1.5"><I.Gauge className="w-4 h-4" /> Limit</span>
          <input value={limit} onChange={(e) => setLimit(e.target.value)} placeholder="KB/s"
            className="w-24 bg-ink-900/60 border border-white/5 rounded-lg px-2 py-1 text-xs text-center focus:outline-none focus:ring-1 focus:ring-aurora-500/50" />
          <button className="btn-ghost !py-1 !px-2 text-xs" onClick={applyLimit}>Set</button>
          <span className="text-[11px] text-slate-600">(0 = unlimited)</span>
          <div className="ml-auto flex items-center gap-1">
            <button className="btn-ghost !p-1.5" title="Move up" onClick={() => api.reorder(t.gid, "up")}><I.Up className="w-4 h-4" /></button>
            <button className="btn-ghost !p-1.5" title="Move down" onClick={() => api.reorder(t.gid, "down")}><I.Down className="w-4 h-4" /></button>
            <button className="btn-ghost !py-1 !px-2 text-xs" title="Move to top" onClick={() => api.reorder(t.gid, "top")}>Top</button>
          </div>
        </div>
      )}
      {canControl && (
        <div className="border-t border-white/5 pt-2">
          <button className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-300" onClick={() => setPolicyOpen((value) => !value)}>
            <I.Down className={`w-3.5 h-3.5 transition-transform ${policyOpen ? "rotate-180" : ""}`} /> Schedule &amp; network overrides
          </button>
          {policyOpen && <JobPolicyEditor t={t} />}
        </div>
      )}
      {canControl && (
        <div className="flex items-center gap-2 text-xs text-slate-500 flex-wrap">
          <span>When this finishes</span>
          <div className="relative">
            <select value={onFin} onChange={(e) => applyOnFin(e.target.value, onFinCmd)}
              className="appearance-none bg-ink-900/60 border border-white/5 rounded pl-2 pr-6 py-1 text-xs text-slate-300 focus:outline-none focus:ring-1 focus:ring-aurora-500/50">
              <option value="default">Default action</option>
              <option value="reveal">Open its folder</option>
              <option value="open">Open the file</option>
              <option value="run">Run command…</option>
            </select>
            <I.Down className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500" />
          </div>
          {onFin === "run" && (
            <input value={onFinCmd} onChange={(e) => setOnFinCmd(e.target.value)} onBlur={() => applyOnFin("run", onFinCmd)}
              placeholder="cmd {path}" className="flex-1 min-w-0 bg-ink-900/60 border border-white/5 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-aurora-500/50" />
          )}
        </div>
      )}
      {/* Checksum row — visible for active/waiting/completed downloads */}
      {!t.gid.startsWith("site-") && (
        <div className="flex items-center gap-2 text-xs text-slate-500 flex-wrap">
          <span className="shrink-0">Checksum</span>
          <input value={csInput} onChange={(e) => setCsInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && saveChecksum()}
            placeholder="sha-256=… or paste bare hash"
            className="flex-1 min-w-0 bg-ink-900/60 border border-white/5 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-aurora-500/50" />
          <button className="btn-ghost !py-1 !px-2 text-xs shrink-0" onClick={saveChecksum}>
            {csSaved ? "Saved ✓" : "Save"}
          </button>
          {t.dmVerify === "ok" && <span className="text-lime-400">✓ verified</span>}
          {t.dmVerify === "fail" && <span className="text-rose-400">✗ mismatch</span>}
          {t.dmVerify === "pending" && <span className="text-amber-400">pending…</span>}
        </div>
      )}
      {isTorrent && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
            <span>{t.files.length} file{t.files.length > 1 ? "s" : ""}</span>
            {t.numSeeders && <span className="text-lime-400/80">{t.numSeeders} seeders</span>}
            <span>{conns} peers</span>
            {numPieces > 0 && <span>{numPieces.toLocaleString()} pieces</span>}
            {t.infoHash && <span className="font-mono" title={t.infoHash}>hash {t.infoHash.slice(0, 12)}…</span>}
          </div>
          <div className="max-h-72 overflow-auto pr-1">
            <FileTree t={t} />
          </div>
          <TrackerEditor t={t} />
        </div>
      )}
    </div>
  );
}

const EMPTY_NETWORK: NetworkOverride = {
  maxDownloadLimit: "", connections: 0, split: 0, proxy: "", userAgent: "", headers: [],
  cookiesBrowser: "", httpUsername: "", hasPassword: false, meteredBehavior: "inherit",
};

function JobPolicyEditor({ t }: { t: Aria2Task }) {
  const [schedule, setSchedule] = useState<JobSchedule>(t.dmSchedule || { mode: "inherit", window: null });
  const [network, setNetwork] = useState<NetworkOverride>(t.dmNetworkOverride || EMPTY_NETWORK);
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    api.jobPolicyGet(t.gid).then((meta) => {
      setSchedule(meta.schedule || { mode: "inherit", window: null });
      setNetwork(meta.network_override || EMPTY_NETWORK);
    }).catch(() => {});
  }, [t.gid]);

  function setMode(mode: JobSchedule["mode"]) {
    setSchedule((current) => ({
      mode,
      window: mode === "window" ? current.window || { start: "01:00", stop: "08:00", days: [] } : null,
    }));
  }

  async function savePolicy() {
    try {
      const meta = await api.jobPolicySet(t.gid, schedule, network, password || undefined);
      setSchedule(meta.schedule);
      setNetwork(meta.network_override);
      setPassword("");
      setMessage("Saved — backend policy is active");
    } catch (error) {
      setMessage(String(error));
    }
  }

  async function clearPolicy() {
    try {
      const meta = await api.jobPolicyClear(t.gid);
      setSchedule(meta.schedule);
      setNetwork(meta.network_override);
      setPassword("");
      setMessage("Overrides cleared");
    } catch (error) {
      setMessage(String(error));
    }
  }

  return (
    <div className="mt-2 space-y-3 border border-white/5 p-3">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <PolicyField label="Schedule">
          <select value={schedule.mode} onChange={(event) => setMode(event.target.value as JobSchedule["mode"])} className="control !py-1.5 text-xs">
            <option value="inherit">Inherit queue / global</option><option value="always">Always allowed</option><option value="paused">Always paused</option><option value="window">Custom window</option>
          </select>
        </PolicyField>
        {schedule.mode === "window" && <PolicyField label="Start"><input type="time" value={schedule.window?.start || "01:00"} onChange={(event) => setSchedule({ ...schedule, window: { ...(schedule.window || { stop: "08:00", days: [] }), start: event.target.value } })} className="control !py-1.5 text-xs" /></PolicyField>}
        {schedule.mode === "window" && <PolicyField label="Stop"><input type="time" value={schedule.window?.stop || "08:00"} onChange={(event) => setSchedule({ ...schedule, window: { ...(schedule.window || { start: "01:00", days: [] }), stop: event.target.value } })} className="control !py-1.5 text-xs" /></PolicyField>}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <PolicyField label="Speed limit"><input value={network.maxDownloadLimit} onChange={(event) => setNetwork({ ...network, maxDownloadLimit: event.target.value })} placeholder="2M or blank" className="control !py-1.5 text-xs font-mono" /></PolicyField>
        <PolicyField label="Connections"><input type="number" min="0" max="16" value={network.connections} onChange={(event) => setNetwork({ ...network, connections: Number(event.target.value) || 0 })} className="control !py-1.5 text-xs" /></PolicyField>
        <PolicyField label="Split"><input type="number" min="0" max="64" value={network.split} onChange={(event) => setNetwork({ ...network, split: Number(event.target.value) || 0 })} className="control !py-1.5 text-xs" /></PolicyField>
        <PolicyField label="Proxy"><input value={network.proxy} onChange={(event) => setNetwork({ ...network, proxy: event.target.value })} placeholder="http://host:port" className="control !py-1.5 text-xs font-mono" /></PolicyField>
        <PolicyField label="User-Agent"><input value={network.userAgent} onChange={(event) => setNetwork({ ...network, userAgent: event.target.value })} className="control !py-1.5 text-xs font-mono" /></PolicyField>
        <PolicyField label="Cookies browser"><select value={network.cookiesBrowser} onChange={(event) => setNetwork({ ...network, cookiesBrowser: event.target.value })} className="control !py-1.5 text-xs"><option value="">Inherit</option>{["firefox", "chrome", "chromium", "brave", "edge", "vivaldi", "opera"].map((browser) => <option key={browser}>{browser}</option>)}</select></PolicyField>
        <PolicyField label="HTTP username"><input value={network.httpUsername} onChange={(event) => setNetwork({ ...network, httpUsername: event.target.value })} className="control !py-1.5 text-xs font-mono" /></PolicyField>
        <PolicyField label={network.hasPassword ? "Replace saved password" : "HTTP password"}><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder={network.hasPassword ? "Saved; enter to replace" : "Not stored"} className="control !py-1.5 text-xs" /></PolicyField>
        <PolicyField label="Metered network"><select value={network.meteredBehavior || "inherit"} onChange={(event) => setNetwork({ ...network, meteredBehavior: event.target.value as NetworkOverride["meteredBehavior"] })} className="control !py-1.5 text-xs"><option value="inherit">Inherit global</option><option value="pause">Always pause</option><option value="ignore">Ignore metered pause</option></select></PolicyField>
      </div>
      <PolicyField label="Headers"><textarea value={network.headers.join("\n")} onChange={(event) => setNetwork({ ...network, headers: event.target.value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean) })} placeholder="One header per line" className="control min-h-16 resize-y !py-1.5 text-xs font-mono" /></PolicyField>
      <div className="flex flex-wrap items-center gap-2"><button className="btn-primary !py-1.5 text-xs" onClick={savePolicy}>Apply overrides</button><button className="btn-ghost !py-1.5 text-xs" onClick={clearPolicy}>Clear overrides</button>{message && <span className="text-[11px] text-slate-500 break-words">{message}</span>}</div>
    </div>
  );
}

function PolicyField({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="block min-w-0"><span className="block text-[10px] font-mono uppercase text-slate-600 mb-1">{label}</span>{children}</label>;
}

function TrackerEditor({ t }: { t: Aria2Task }) {
  const [add, setAdd] = useState("");
  const [msg, setMsg] = useState("");
  const trackers = (t.bittorrent?.announceList || []).flat();
  return (
    <div className="pt-1 border-t border-white/5">
      <div className="text-[11px] text-slate-500 mb-1 mt-1">Trackers ({trackers.length})</div>
      {trackers.length > 0 && (
        <div className="max-h-20 overflow-auto text-[10px] text-slate-600 font-mono space-y-0.5 mb-1.5">
          {trackers.slice(0, 40).map((tr, i) => <div key={i} className="truncate" title={tr}>{tr}</div>)}
        </div>
      )}
      <div className="flex gap-1">
        <input value={add} onChange={(e) => setAdd(e.target.value)} placeholder="Add tracker URL(s)…"
          className="flex-1 min-w-0 bg-ink-900/60 border border-white/5 rounded px-2 py-1 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-aurora-500/50" />
        <button className="btn-ghost !py-1 !px-2 text-xs" onClick={() => { const v = add.trim(); if (v) { api.addTrackers(t.gid, v).then(() => setMsg("Added — applies now where supported, and on restart.")).catch(() => {}); setAdd(""); } }}>Add</button>
      </div>
      {msg && <div className="text-[10px] text-slate-500 mt-1">{msg}</div>}
    </div>
  );
}

function PropRow({ label, value, copy }: { label: string; value: string; copy?: boolean }) {
  return (
    <div className="flex items-start gap-3 py-1.5 border-b border-white/5 last:border-0">
      <span className="text-xs text-slate-500 w-24 shrink-0 pt-0.5">{label}</span>
      <span className="text-sm text-slate-200 break-all flex-1">{value}</span>
      {copy && <button className="text-[11px] text-aurora-300 hover:underline shrink-0 pt-0.5" onClick={() => navigator.clipboard.writeText(value)}>copy</button>}
    </div>
  );
}

function MenuItem({ children, onClick, danger }: { children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} className={`w-full text-left px-3 py-1.5 rounded-lg hover:bg-white/5 transition-colors ${danger ? "text-rose-400" : "text-slate-200"}`}>
      {children}
    </button>
  );
}
