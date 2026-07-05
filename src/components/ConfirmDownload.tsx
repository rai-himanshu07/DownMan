import { useEffect, useState } from "react";
import { PendingItem, api } from "../lib/api";
import { fmtBytes } from "../lib/format";
import { markOrganized, useStore } from "../store";
import { I } from "./icons";

const CATS = ["Video", "Audio", "Images", "Documents", "Archives", "Other"];

export default function ConfirmDownload({ item, onDone }: { item: PendingItem; onDone: () => void }) {
  const [base, setBase] = useState("");
  const [filename, setFilename] = useState(item.filename);
  const [touchedName, setTouchedName] = useState(false);
  const [category, setCategory] = useState(item.category || "Other");
  const [dir, setDir] = useState("");
  const [customDir, setCustomDir] = useState(false);
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  const cats = useStore((s) => s.categories);
  const isSite = item.kind === "site" || item.kind === "stream";

  useEffect(() => {
    api.info().then((i) => setBase(i.dir)).catch(() => {});
  }, []);

  // Adopt the better filename/category once the backend's async HEAD probe lands,
  // unless the user has already started editing.
  useEffect(() => {
    if (!touchedName && item.filename && item.filename !== "download") setFilename(item.filename);
    if (!customDir && item.category) setCategory(item.category);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.filename, item.category]);

  const size = +item.size || 0;
  const catNames = cats.length ? cats.map((c) => c.name) : CATS;
  const folderOf = (nm: string) => cats.find((c) => c.name === nm)?.folderAbs || (base ? `${base}/${nm}` : "");
  const effectiveDir = customDir ? dir : folderOf(category);

  async function go(paused: boolean) {
    setBusy(true);
    if (remember) {
      // Remember this category's folder so future downloads skip the dialog.
      try {
        const defs = JSON.parse(localStorage.getItem("dm-cat-defaults") || "{}");
        defs[category] = { dir: effectiveDir, auto: true };
        localStorage.setItem("dm-cat-defaults", JSON.stringify(defs));
      } catch {
        /* ignore */
      }
    }
    try {
      const gid = await api.confirmPending(item.id, filename.trim(), effectiveDir, paused);
      markOrganized(gid); // honour the chosen folder; don't let auto-sort move it
    } catch {
      /* ignore */
    }
    onDone();
  }

  async function browse() {
    const f = await api.pickFolder().catch(() => null);
    if (f) { setDir(f); setCustomDir(true); }
  }

  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/60 backdrop-blur-sm animate-fade-up">
      <div className="card w-[560px] max-w-[94vw] p-6">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-9 h-9 rounded-xl bg-aurora-600 grid place-items-center shadow-glow text-white"><I.Logo /></div>
          <div>
            <h2 className="text-lg font-semibold leading-5">{isSite ? "New video download" : "New download"}</h2>
            <div className="text-xs text-slate-500">{isSite ? "Caught a video from your browser" : "Caught a download from your browser"}</div>
          </div>
        </div>

        <label className="block mt-4 text-xs text-slate-500">File name</label>
        <input
          value={filename}
          onChange={(e) => { setFilename(e.target.value); setTouchedName(true); }}
          className="mt-1 w-full bg-ink-900/60 border border-white/5 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-aurora-500/50"
        />

        <div className="flex gap-3 mt-3">
          {isSite ? (
            <div className="flex-1">
              <label className="block text-xs text-slate-500">Quality</label>
              <div className="mt-1 px-3 py-2 text-sm rounded-lg bg-ink-900/60 border border-white/5 truncate" title={item.quality || ""}>
                {item.quality || "Best available"}
              </div>
            </div>
          ) : (
            <div className="flex-1">
              <label className="block text-xs text-slate-500">Category</label>
              <div className="relative mt-1">
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full appearance-none bg-ink-900/60 border border-white/5 rounded-lg pl-3 pr-9 py-2 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-aurora-500/50"
                >
                  {catNames.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
                <I.Down className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
              </div>
            </div>
          )}
          <div className="w-40">
            <label className="block text-xs text-slate-500">Size</label>
            <div className="mt-1 px-3 py-2 text-sm rounded-lg bg-ink-900/60 border border-white/5">
              {isSite ? "—" : item.status === "probing" ? "Detecting…" : size ? fmtBytes(size) : "Unknown"}
            </div>
          </div>
        </div>

        <label className="block mt-3 text-xs text-slate-500">Save to</label>
        <div className="flex gap-2 mt-1">
          <input
            value={effectiveDir}
            onChange={(e) => { setDir(e.target.value); setCustomDir(true); }}
            className="flex-1 bg-ink-900/60 border border-white/5 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-aurora-500/50"
          />
          <button className="btn-ghost" title="Browse" onClick={browse}><I.Folder className="w-4 h-4" /></button>
        </div>
        {customDir && (
          <button className="mt-1 text-[11px] text-aurora-300" onClick={() => setCustomDir(false)}>↺ Use category folder</button>
        )}

        <div className="mt-3 text-[11px] text-slate-600 truncate" title={item.url}>{item.url}</div>

        {!isSite && (
          <label className="flex items-center gap-2 mt-4 text-xs text-slate-400 cursor-pointer select-none">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            Always save <b className="text-slate-300">{category}</b> files here without asking
          </label>
        )}

        <div className="flex justify-end gap-2 mt-4">
          <button className="btn-ghost" disabled={busy} onClick={() => { api.cancelPending(item.id).catch(() => {}); onDone(); }}>Cancel</button>
          {!isSite && <button className="btn-ghost" disabled={busy} onClick={() => go(true)} title="Add but don't start yet">Download later</button>}
          <button className="btn-primary" disabled={busy} onClick={() => go(false)}><I.Play className="w-4 h-4" /> Download</button>
        </div>
      </div>
    </div>
  );
}
