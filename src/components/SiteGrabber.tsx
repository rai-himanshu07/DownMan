import { useEffect, useMemo, useRef, useState } from "react";
import { api, GrabFile, GrabState } from "../lib/api";
import { I } from "./icons";

const IMG_RE = /\.(jpe?g|png|gif|webp|svg|bmp|ico|avif)$/i;

function splitExts(s: string): string[] {
  return s.split(/[\s,]+/).map((x) => x.trim().replace(/^\*\./, "").replace(/^\./, "")).filter(Boolean);
}

function dirOf(u: string): string {
  try {
    const url = new URL(u);
    const p = url.pathname.split("/").slice(0, -1).join("/");
    return url.host + (p || "/");
  } catch {
    return "?";
  }
}

function groupBy(arr: GrabFile[], key: (f: GrabFile) => string): [string, GrabFile[]][] {
  const map = new Map<string, GrabFile[]>();
  for (const f of arr) {
    const k = key(f);
    const list = map.get(k);
    if (list) list.push(f);
    else map.set(k, [f]);
  }
  return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

export default function SiteGrabber({ onClose, initialUrl }: { onClose: () => void; initialUrl?: string }) {
  const [phase, setPhase] = useState<"setup" | "results">("setup");
  const [showResourceWarn, setShowResourceWarn] = useState(false);
  const [pendingExplore, setPendingExplore] = useState(false);

  const [url, setUrl] = useState(initialUrl || localStorage.getItem("dm-grab-url") || "");
  const [levels, setLevels] = useState("2");
  const [otherLevels, setOtherLevels] = useState("0");
  const [wholeDomain, setWholeDomain] = useState(true);
  const [sameSiteOnly, setSameSiteOnly] = useState(true);
  const [processJs, setProcessJs] = useState(true);
  const [layout, setLayout] = useState("site");
  const [include, setInclude] = useState("");
  const [exclude, setExclude] = useState("");
  const [referer, setReferer] = useState("");
  const [cookies, setCookies] = useState("");
  const [showAdv, setShowAdv] = useState(false);

  const [grabId, setGrabId] = useState("");
  const [state, setState] = useState<GrabState>({ status: "exploring", pages: 0, total: 0, files: [] });
  const [view, setView] = useState<"all" | "folder" | "link" | "thumbs">("all");
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [typeFilter, setTypeFilter] = useState("");
  const pollRef = useRef<number | null>(null);

  function explore() {
    if (!url.trim()) return;
    // First-use resource warning: site grabs invoke yt-dlp/ffmpeg and may use significant network/CPU.
    if (localStorage.getItem("dm-site-grab-ok") !== "1") {
      setPendingExplore(true);
      setShowResourceWarn(true);
      return;
    }
    doExplore();
  }

  function doExplore() {
    if (!url.trim()) return;
    localStorage.setItem("dm-grab-url", url.trim());
    setPendingExplore(false);
    const project = {
      url: url.trim(),
      levels: parseInt(levels) || 0,
      otherLevels: parseInt(otherLevels) || 0,
      wholeDomain,
      sameSiteOnly,
      processJs,
      layout,
      include: splitExts(include),
      exclude: splitExts(exclude),
      referer: referer.trim(),
      cookies: cookies.trim(),
    };
    api.grabberStart(project).then((id) => { setGrabId(id); setPhase("results"); }).catch(() => {});
  }

  useEffect(() => {
    if (phase !== "results" || !grabId) return;
    let stop = false;
    const tick = () => {
      api.grabberGet(grabId).then((s) => {
        if (stop) return;
        setState(s);
        if (s.status === "exploring") pollRef.current = window.setTimeout(tick, 800);
      }).catch(() => {});
    };
    tick();
    return () => { stop = true; if (pollRef.current) clearTimeout(pollRef.current); };
  }, [phase, grabId]);

  const files = state.files;
  const types = useMemo(() => Array.from(new Set(files.map((f) => f.type).filter(Boolean))).sort(), [files]);
  const shown = useMemo(() => (typeFilter ? files.filter((f) => f.type === typeFilter) : files), [files, typeFilter]);
  const display = shown.slice(0, 1500);

  function toggle(u: string) {
    setChecked((s) => { const n = new Set(s); if (n.has(u)) n.delete(u); else n.add(u); return n; });
  }
  function download() {
    const urls = [...checked];
    if (!urls.length) return;
    api.grabberDownload(grabId, urls).then(() => onClose()).catch(() => {});
  }

  const statusLabel = state.status === "exploring" ? "Exploring…" : state.status === "done" ? "Done" : state.status === "cancelled" ? "Stopped" : state.status === "error" ? "Error" : state.status;

  if (phase === "setup") {
    return (
      <div className="fixed inset-0 z-[60] grid place-items-center bg-black/60 backdrop-blur-sm animate-fade-up">
        <div className="card w-[680px] max-w-[94vw] max-h-[90vh] overflow-auto p-6">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-9 h-9 rounded-xl bg-aurora-600 grid place-items-center shadow-glow text-white"><I.Globe className="w-5 h-5" /></div>
            <div>
              <h2 className="text-lg font-semibold leading-5">Site Grabber</h2>
              <div className="text-xs text-slate-500">Crawl a website and collect every matching file</div>
            </div>
          </div>

          <label className="block mt-4 text-xs text-slate-500">Start page</label>
          <input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/gallery"
            onKeyDown={(e) => { if (e.key === "Enter") explore(); }}
            className="mt-1 w-full bg-ink-900/60 border border-white/5 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-aurora-500/50" />

          <div className="grid grid-cols-2 gap-3 mt-3">
            <label className="text-xs text-slate-500">Link levels to follow (this site)
              <input value={levels} onChange={(e) => setLevels(e.target.value)} className="mt-1 w-full bg-ink-900/60 border border-white/5 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-aurora-500/50" />
            </label>
            <label className="text-xs text-slate-500">Levels on other sites
              <input value={otherLevels} onChange={(e) => setOtherLevels(e.target.value)} className="mt-1 w-full bg-ink-900/60 border border-white/5 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-aurora-500/50" />
            </label>
          </div>

          <div className="grid grid-cols-2 gap-3 mt-3">
            <label className="text-xs text-slate-500">Download file types (blank = all)
              <input value={include} onChange={(e) => setInclude(e.target.value)} placeholder="jpg png pdf mp4"
                className="mt-1 w-full bg-ink-900/60 border border-white/5 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-aurora-500/50" />
            </label>
            <label className="text-xs text-slate-500">Exclude file types
              <input value={exclude} onChange={(e) => setExclude(e.target.value)} placeholder="gif svg"
                className="mt-1 w-full bg-ink-900/60 border border-white/5 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-aurora-500/50" />
            </label>
          </div>

          <div className="mt-3 space-y-1.5">
            <Toggle label="Explore all subdomains of the main domain" checked={wholeDomain} onChange={setWholeDomain} />
            <Toggle label="Only collect files hosted on this site" checked={sameSiteOnly} onChange={setSameSiteOnly} />
            <Toggle label="Scan page scripts for extra links (JavaScript URLs)" checked={processJs} onChange={setProcessJs} />
          </div>

          <div className="mt-3">
            <label className="text-xs text-slate-500">Save layout</label>
            <div className="relative mt-1">
              <select value={layout} onChange={(e) => setLayout(e.target.value)}
                className="w-full appearance-none bg-ink-900/60 border border-white/5 rounded-lg pl-3 pr-9 py-2 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-aurora-500/50">
                <option value="site">By site folders — keep the site&rsquo;s structure</option>
                <option value="type">By file type — Images, Video, Documents…</option>
                <option value="flat">Flat — everything in the site folder</option>
              </select>
              <I.Down className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
            </div>
            <div className="text-[11px] text-slate-600 mt-1">Saved under SiteGrab/&lt;site&gt;/ so you always know where it came from.</div>
          </div>

          <button className="mt-3 flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200" onClick={() => setShowAdv((v) => !v)}>
            <I.Down className={`w-3.5 h-3.5 transition-transform ${showAdv ? "rotate-180" : ""}`} /> Advanced (referer, cookies)
          </button>
          {showAdv && (
            <div className="mt-2 space-y-2">
              <input value={referer} onChange={(e) => setReferer(e.target.value)} placeholder="Referer (optional)"
                className="w-full bg-ink-900/60 border border-white/5 rounded-lg px-3 py-1.5 text-sm font-mono placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-aurora-500/50" />
              <input value={cookies} onChange={(e) => setCookies(e.target.value)} placeholder="Cookies (name=value; …)"
                className="w-full bg-ink-900/60 border border-white/5 rounded-lg px-3 py-1.5 text-sm font-mono placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-aurora-500/50" />
            </div>
          )}

          <div className="flex justify-end gap-2 mt-5">
            <button className="btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn-primary" disabled={!url.trim()} onClick={explore}><I.Globe className="w-4 h-4" /> Explore</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
    {showResourceWarn && (
      <div className="fixed inset-0 z-[80] grid place-items-center bg-black/60 backdrop-blur-sm" onClick={() => { setShowResourceWarn(false); setPendingExplore(false); }}>
        <div className="card w-[440px] max-w-[92vw] p-6 animate-fade-up" onClick={(e) => e.stopPropagation()}>
          <h2 className="text-lg font-semibold mb-1">Site grab may use extra resources</h2>
          <p className="text-sm text-slate-400 mb-3">This will crawl the target website and may invoke <b className="text-slate-200">yt-dlp</b> / <b className="text-slate-200">ffmpeg</b>, using significant <b className="text-amber-300">CPU, network, and disk space</b>.</p>
          <label className="flex items-center gap-2 text-sm text-slate-400 mb-4">
            <input type="checkbox" onChange={(e) => { if (e.target.checked) localStorage.setItem("dm-site-grab-ok","1"); else localStorage.removeItem("dm-site-grab-ok"); }} />
            Don&apos;t show this again
          </label>
          <div className="flex justify-end gap-2">
            <button className="btn-ghost" onClick={() => { setShowResourceWarn(false); setPendingExplore(false); }}>Cancel</button>
            <button className="btn-primary" onClick={() => { setShowResourceWarn(false); if (pendingExplore) doExplore(); }}>Continue</button>
          </div>
        </div>
      </div>
    )}
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/60 backdrop-blur-sm animate-fade-up">
      <div className="card w-[940px] max-w-[96vw] h-[82vh] flex flex-col p-0 overflow-hidden">
        <header className="flex items-center gap-3 px-5 py-3 border-b border-white/5">
          <I.Globe className="w-5 h-5 text-aurora-300" />
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm truncate">{url}</div>
            <div className="text-xs text-slate-500">
              {statusLabel} · {state.pages} pages · {state.total} files{state.total >= 3000 ? "+ (capped)" : ""}
            </div>
          </div>
          {state.status === "exploring" && (
            <button className="btn-ghost text-xs" onClick={() => api.grabberCancel(grabId).catch(() => {})}>Stop</button>
          )}
          <button className="btn-ghost !p-2" title="Close" onClick={onClose}><I.Close className="w-4 h-4" /></button>
        </header>

        <div className="flex items-center gap-2 px-5 py-2 border-b border-white/5 text-xs flex-wrap">
          <div className="flex items-center rounded-lg border border-white/5 overflow-hidden">
            {(["all", "folder", "link", "thumbs"] as const).map((v) => (
              <button key={v} className={`px-2.5 py-1 ${view === v ? "bg-white/10 text-aurora-300" : "text-slate-500 hover:text-slate-300"}`} onClick={() => setView(v)}>
                {v === "all" ? "All files" : v === "folder" ? "Folders" : v === "link" ? "By page" : "Thumbnails"}
              </button>
            ))}
          </div>
          {types.length > 0 && (
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}
              className="appearance-none bg-ink-900/60 border border-white/5 rounded-lg px-2 py-1 text-slate-300 focus:outline-none focus:ring-1 focus:ring-aurora-500/50">
              <option value="">All types</option>
              {types.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          )}
          <button className="text-aurora-300 hover:underline" onClick={() => setChecked(new Set(shown.map((f) => f.url)))}>Select all</button>
          <button className="text-aurora-300 hover:underline" onClick={() => setChecked(new Set())}>Clear</button>
          <span className="text-slate-500">{checked.size} selected</span>
          <button className="btn-primary !py-1 ml-auto" disabled={!checked.size} onClick={download}>
            <I.Plus className="w-4 h-4" /> Download {checked.size || ""}
          </button>
        </div>

        <div className="flex-1 overflow-auto">
          {view === "thumbs" ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2 p-3">
              {display.filter((f) => IMG_RE.test(f.url)).map((f) => (
                <button key={f.url} onClick={() => toggle(f.url)}
                  className={`relative rounded-lg overflow-hidden border ${checked.has(f.url) ? "border-aurora-400 ring-2 ring-aurora-500/40" : "border-white/5"}`}>
                  <img src={f.url} loading="lazy" className="w-full h-24 object-cover bg-ink-900" />
                  <div className="absolute top-1 left-1 w-4 h-4 rounded bg-black/60 grid place-items-center text-[10px]">{checked.has(f.url) ? "✓" : ""}</div>
                  <div className="px-1.5 py-1 text-[10px] truncate text-slate-400" title={f.name}>{f.name}</div>
                </button>
              ))}
            </div>
          ) : view === "all" ? (
            <table className="w-full text-sm">
              <thead className="text-xs text-slate-500 border-b border-white/5 sticky top-0 bg-ink-800/80 backdrop-blur">
                <tr><th className="px-3 py-1.5 w-8"></th><th className="px-3 py-1.5 text-left font-medium">Name</th><th className="px-3 py-1.5 text-left font-medium">Type</th><th className="px-3 py-1.5 text-left font-medium">Link text</th><th className="px-3 py-1.5 text-left font-medium">Host</th></tr>
              </thead>
              <tbody>
                {display.map((f) => <FileRow key={f.url} f={f} on={checked.has(f.url)} toggle={toggle} />)}
              </tbody>
            </table>
          ) : (
            <div className="p-2">
              {groupBy(display, view === "folder" ? (f) => dirOf(f.url) : (f) => f.source).map(([k, list]) => (
                <div key={k} className="mb-2">
                  <div className="flex items-center gap-2 px-2 py-1 text-xs text-slate-400 bg-white/[0.03] rounded">
                    <button className="text-aurora-300" onClick={() => setChecked((s) => { const n = new Set(s); list.forEach((f) => n.add(f.url)); return n; })}>＋</button>
                    <span className="truncate flex-1" title={k}>{k}</span>
                    <span className="text-slate-600">{list.length}</span>
                  </div>
                  <table className="w-full text-sm">
                    <tbody>
                      {list.map((f) => <FileRow key={f.url} f={f} on={checked.has(f.url)} toggle={toggle} />)}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}
          {shown.length > display.length && (
            <div className="px-3 py-2 text-xs text-slate-500">Showing first {display.length} of {shown.length} — refine filters to narrow.</div>
          )}
          {state.status !== "exploring" && shown.length === 0 && (
            <div className="h-full grid place-items-center text-slate-500 text-sm">No matching files found.</div>
          )}
        </div>
      </div>
    </div>
    </>
  );
}

function FileRow({ f, on, toggle }: { f: GrabFile; on: boolean; toggle: (u: string) => void }) {
  return (
    <tr className="border-b border-white/5 hover:bg-white/[0.03]">
      <td className="px-3 py-1.5"><input type="checkbox" checked={on} onChange={() => toggle(f.url)} /></td>
      <td className="px-3 py-1.5"><span className="truncate block max-w-[280px] text-slate-300" title={f.url}>{f.name}</span></td>
      <td className="px-3 py-1.5 text-[11px] uppercase text-slate-500">{f.type}</td>
      <td className="px-3 py-1.5"><span className="truncate block max-w-[220px] text-slate-500" title={f.linkText}>{f.linkText}</span></td>
      <td className="px-3 py-1.5 text-xs text-slate-500">{f.host}</td>
    </tr>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (c: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm text-slate-400 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> {label}
    </label>
  );
}
