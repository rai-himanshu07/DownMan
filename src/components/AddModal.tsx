import { useMemo, useState } from "react";
import { api, Fmt } from "../lib/api";
import { toast } from "../lib/toast";
import { useStore, taskUrl } from "../store";
import { I } from "./icons";
import PreDownloadSheet from "./PreDownloadSheet";

interface Link { url: string; host: string; type: string }

const URL_RE = /(?:https?|ftp):\/\/[^\s"'<>)\]}]+|magnet:\?[^\s"'<>)\]}]+|www\.[^\s"'<>)\]}]+/gi;

function hostOf(u: string): string {
  if (u.startsWith("magnet:")) return "magnet";
  try { return new URL(u).hostname || "?"; } catch { return "?"; }
}

function typeOf(u: string): string {
  if (u.startsWith("magnet:")) return "magnet";
  let path = u;
  try { path = new URL(u).pathname; } catch { /* keep raw */ }
  if (/\.torrent$/i.test(path)) return "torrent";
  const m = path.match(/\.([a-z0-9]{1,5})(?:$|\?)/i);
  return m ? m[1].toUpperCase() : "file";
}

function extractLinks(text: string): Link[] {
  const seen = new Set<string>();
  const out: Link[] = [];
  for (const m of text.matchAll(URL_RE)) {
    let url = m[0].replace(/[.,;]+$/, "");
    if (/^www\./i.test(url)) url = "https://" + url;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ url, host: hostOf(url), type: typeOf(url) });
  }
  return out.sort((a, b) => a.host.localeCompare(b.host) || a.url.localeCompare(b.url));
}

export default function AddModal({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState("");
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());
  const [showAdv, setShowAdv] = useState(false);
  const [referer, setReferer] = useState("");
  const [cookies, setCookies] = useState("");
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [header, setHeader] = useState("");
  const [checksum, setChecksum] = useState("");
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState<{ url: string; path: string; size: number } | null>(null);
  const [vid, setVid] = useState(false);
  const [fmts, setFmts] = useState<{ title: string; formats: Fmt[] } | null>(null);
  const [fsel, setFsel] = useState("");
  const [subs, setSubs] = useState(false);
  const [sb, setSb] = useState(false);
  const [vbusy, setVbusy] = useState(false);
  const [mirrors, setMirrors] = useState(false);
  const [dupInfo, setDupInfo] = useState<{ urls: Set<string> } | null>(null);
  const [preSheet, setPreSheet] = useState<{ url: string; name: string } | null>(null);
  const tasks = useStore((s) => s.tasks);

  const links = useMemo(() => extractLinks(text), [text]);
  const selected = links.filter((l) => !unchecked.has(l.url));
  const valid = selected.filter((l) => /^(https?|ftp|magnet):/i.test(l.url) || /\.torrent$/i.test(l.url));
  const single = links.length === 1 && /^https?:/i.test(links[0]?.url || "") ? links[0].url : "";

  function loadFormats() {
    if (!single) return;
    setVid(true);
    setFmts(null);
    api.listFormats(single, referer.trim() || undefined, localStorage.getItem("dm-cookies-browser") || undefined)
      .then((r) => { setFmts(r); setFsel(r.formats?.[0]?.selector || "best"); })
      .catch(() => setFmts({ title: "", formats: [] }));
  }
  function downloadVideo() {
    if (!single) return;
    setVbusy(true);
    const cb = localStorage.getItem("dm-cookies-browser") || undefined;
    api.grabSite(single, fsel || "best", referer.trim() || undefined, cb, subs, sb)
      .then(() => onClose())
      .catch(() => {})
      .finally(() => setVbusy(false));
  }

  function toggle(url: string) {
    setUnchecked((s) => {
      const n = new Set(s);
      if (n.has(url)) n.delete(url); else n.add(url);
      return n;
    });
  }

  function buildOpts(): Record<string, unknown> {
    const opts: Record<string, unknown> = {};
    if (checksum.trim()) opts.dmChecksum = checksum.trim();
    if (referer.trim()) opts.referer = referer.trim();
    if (user.trim()) opts["http-user"] = user.trim();
    if (pass) opts["http-passwd"] = pass;
    const headers: string[] = [];
    if (cookies.trim()) headers.push(`Cookie: ${cookies.trim()}`);
    if (header.trim()) headers.push(header.trim());
    if (headers.length) opts.header = headers;
    return opts;
  }

  async function doAdd(items: Link[], forceOverwrite = false) {
    setDupInfo(null);
    setConflict(null);
    if (!items.length) return;
    setBusy(true);
    const opts = buildOpts();
    if (forceOverwrite) opts.dmForce = "1";
    // Mirror mode: every URL is a source for one file → a single download.
    if (mirrors && items.length > 1) {
      try {
        await api.add(items.map((l) => l.url), opts);
        toast.success(`Added 1 download from ${items.length} mirrors`);
        onClose();
      } catch {
        toast.error("Failed to add", "The engine rejected the request.");
      } finally {
        setBusy(false);
      }
      return;
    }
    let ok = 0;
    let failed = 0;
    for (const l of items) {
      try {
        await api.add([l.url], opts);
        ok += 1;
      } catch (e: unknown) {
        const msg = String(e);
        if (msg.startsWith("conflict:")) {
          const parts = msg.split(":");
          const path = parts.slice(1, -1).join(":");
          const size = parseInt(parts[parts.length - 1], 10) || 0;
          setBusy(false);
          setConflict({ url: l.url, path, size });
          return;
        }
        failed += 1;
      }
    }
    setBusy(false);
    if (ok) toast.success(`Added ${ok} download${ok > 1 ? "s" : ""}`);
    if (failed) toast.error(`${failed} download${failed > 1 ? "s" : ""} failed to add`, "The engine rejected the request.");
    if (ok) onClose();
  }

  function submit() {
    if (!valid.length) {
      toast.error("Nothing to add", "None of the selected links look like valid URLs or magnets.");
      return;
    }
    // Extended duplicate detection: URL match + filename match in history/active
    const existingUrls = new Set(tasks.map((t) => taskUrl(t)).filter(Boolean));
    const existingNames = new Set(tasks.map((t) => {
      const p = t.files?.[0]?.path || ""; return p.split("/").pop() || "";
    }).filter(Boolean));
    const dups = valid.filter((l) => {
      if (existingUrls.has(l.url)) return true;
      const fname = l.url.split("/").pop()?.split("?")[0] || "";
      return fname.length > 4 && existingNames.has(fname);
    });
    if (dups.length && !dupInfo) {
      setDupInfo({ urls: new Set(dups.map((d) => d.url)) });
      return;
    }
    // Pre-download sheet: show for a single direct HTTP file so user can adjust name/folder/etc.
    const isDirectHttp = valid.length === 1 && /^https?:\/\//i.test(valid[0].url)
      && !/\.(torrent|m3u8|mpd)$/i.test(valid[0].url) && !valid[0].url.startsWith("magnet:");
    const advancedSet = referer || cookies || user || pass || header || checksum;
    if (isDirectHttp && !advancedSet && localStorage.getItem("dm-skip-presheet") !== "1") {
      const fname = valid[0].url.split("/").pop()?.split("?")[0] || "file";
      setPreSheet({ url: valid[0].url, name: decodeURIComponent(fname) });
      return;
    }
    doAdd(valid);
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 backdrop-blur-sm animate-fade-up" onClick={onClose}>
      <div className="card w-[640px] max-w-[94vw] max-h-[88vh] overflow-auto p-6" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold mb-1">Add downloads</h2>
        <p className="text-sm text-slate-500 mb-4">Paste links or any text — DownMan finds every HTTP/FTP link, magnet, and torrent, and removes duplicates.</p>
        <textarea
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste URLs or a whole page of text…"
          className="w-full h-28 bg-ink-900/60 border border-white/5 rounded-lg p-3 text-sm font-mono
            placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-aurora-500/50 resize-none"
        />

        {links.length > 0 && (
          <div className="mt-3">
            <div className="flex items-center justify-between text-xs text-slate-500 mb-1.5">
              <span>{links.length} link{links.length > 1 ? "s" : ""} · {selected.length} selected</span>
              <div className="flex gap-3">
                <button className="text-aurora-300 hover:underline" onClick={() => setUnchecked(new Set())}>Select all</button>
                <button className="text-aurora-300 hover:underline" onClick={() => setUnchecked(new Set(links.map((l) => l.url)))}>Clear</button>
              </div>
            </div>
            <div className="max-h-44 overflow-auto rounded-lg border border-white/5 divide-y divide-white/5">
              {links.map((l) => (
                <label key={l.url} className="flex items-center gap-2 px-2.5 py-1.5 hover:bg-white/5 cursor-pointer">
                  <input type="checkbox" checked={!unchecked.has(l.url)} onChange={() => toggle(l.url)} />
                  <span className="shrink-0 w-14 text-[10px] uppercase tracking-wide text-slate-500 text-center">{l.type}</span>
                  <span className="flex-1 min-w-0 truncate text-xs font-mono text-slate-300" title={l.url}>{l.url}</span>
                  <span className="shrink-0 text-[11px] text-slate-600 max-w-[140px] truncate" title={l.host}>{l.host}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {valid.length >= 2 && valid.every((l) => /^(https?|ftp):/i.test(l.url)) && (
          <label className="mt-2 flex items-center gap-2 text-xs text-slate-400">
            <input type="checkbox" checked={mirrors} onChange={(e) => setMirrors(e.target.checked)} />
            These {valid.length} links are <b className="text-slate-300">mirrors of one file</b> (download from all at once)
          </label>
        )}

        {single && (
          <div className="mt-3">
            {!vid ? (
              <button className="btn-ghost text-xs" onClick={loadFormats}><I.Media className="w-4 h-4" /> Video &amp; subtitles…</button>
            ) : (
              <div className="rounded-lg border border-white/5 p-3 space-y-2">
                <div className="text-xs text-slate-400 truncate">{fmts ? (fmts.title || "Choose a quality") : "Fetching available formats…"}</div>
                {fmts && fmts.formats.length > 0 && (
                  <div className="relative">
                    <select value={fsel} onChange={(e) => setFsel(e.target.value)}
                      className="w-full appearance-none bg-ink-900/60 border border-white/5 rounded-lg pl-3 pr-9 py-2 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-aurora-500/50">
                      {fmts.formats.map((f) => <option key={f.selector} value={f.selector}>{f.label}</option>)}
                    </select>
                    <I.Down className="absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500 pointer-events-none" />
                  </div>
                )}
                <div className="flex items-center gap-4 text-xs text-slate-400">
                  <label className="flex items-center gap-1.5"><input type="checkbox" checked={subs} onChange={(e) => setSubs(e.target.checked)} /> Subtitles</label>
                  <label className="flex items-center gap-1.5"><input type="checkbox" checked={sb} onChange={(e) => setSb(e.target.checked)} /> Remove sponsors (SponsorBlock)</label>
                </div>
                <div className="flex justify-end gap-2">
                  <button className="btn-ghost" onClick={() => setVid(false)}>Back</button>
                  <button className="btn-primary" disabled={vbusy || !fmts} onClick={downloadVideo}><I.Play className="w-4 h-4" /> {vbusy ? "Starting…" : "Download video"}</button>
                </div>
              </div>
            )}
          </div>
        )}

        <button className="mt-3 flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-200" onClick={() => setShowAdv((v) => !v)}>
          <I.Down className={`w-3.5 h-3.5 transition-transform ${showAdv ? "rotate-180" : ""}`} /> Advanced (auth, cookies, referer, checksum)
        </button>
        {showAdv && (
          <div className="mt-2 space-y-2">
            <Field label="Referer" v={referer} set={setReferer} ph="https://page-that-linked-this/" />
            <Field label="Cookies" v={cookies} set={setCookies} ph="name=value; name2=value2" />
            <div className="grid grid-cols-2 gap-2">
              <Field label="HTTP username" v={user} set={setUser} />
              <Field label="HTTP password" v={pass} set={setPass} type="password" />
            </div>
            <Field label="Custom header" v={header} set={setHeader} ph="Authorization: Bearer …" />
            <Field label="Checksum (verified after download)" v={checksum} set={setChecksum} ph="sha-256=e3b0c44298fc1c14…" />
          </div>
        )}

        {dupInfo && (
          <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
            <div className="text-sm text-amber-100 mb-2">{dupInfo.urls.size} of these {dupInfo.urls.size > 1 ? "are" : "is"} already in DownMan.</div>
            <div className="flex gap-2">
              <button className="btn-primary !py-1 !px-2.5 text-xs" onClick={() => doAdd(valid.filter((l) => !dupInfo.urls.has(l.url)))}>Skip duplicates</button>
              <button className="btn-ghost !py-1 !px-2.5 text-xs" onClick={() => doAdd(valid)}>Add anyway</button>
              <button className="btn-ghost !py-1 !px-2.5 text-xs ml-auto" onClick={() => setDupInfo(null)}>Cancel</button>
            </div>
          </div>
        )}

        {conflict && (
          <div className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/10 p-3">
            <div className="text-sm font-medium text-rose-100 mb-1">File already exists</div>
            <div className="text-xs text-rose-200/80 font-mono break-all mb-1">{conflict.path}</div>
            {conflict.size > 0 && <div className="text-xs text-slate-400 mb-2">Existing size: {(conflict.size / 1024).toFixed(1)} KB</div>}
            <div className="flex flex-wrap gap-2">
              <button className="btn-primary !py-1 !px-2.5 text-xs"
                onClick={() => { const items = valid.filter(l => l.url !== conflict.url); if (items.length) doAdd(items); else { setConflict(null); onClose(); } }}>
                Skip this file
              </button>
              <button className="btn-ghost !py-1 !px-2.5 text-xs" onClick={() => doAdd(valid, true)}>Overwrite</button>
              <button className="btn-ghost !py-1 !px-2.5 text-xs" onClick={() => { setConflict(null); }}>Cancel</button>
            </div>
          </div>
        )}

        {preSheet && (
          <PreDownloadSheet
            url={preSheet.url}
            suggestedName={preSheet.name}
            onCancel={() => setPreSheet(null)}
            onConfirm={({ name, dir, checksum: cs, queueId, paused }) => {
              setPreSheet(null);
              const opts = buildOpts();
              if (name) opts.out = name;
              if (dir) opts.dir = dir;
              if (cs) opts.dmChecksum = cs;
              if (paused) opts["pause"] = "true";
              setBusy(true);
              api.add([preSheet.url], opts)
                .then(() => { toast.success("Download added"); onClose(); })
                .catch((e: unknown) => {
                  const msg = String(e);
                  if (msg.startsWith("conflict:")) {
                    const parts = msg.split(":");
                    setConflict({ url: preSheet.url, path: parts.slice(1, -1).join(":"), size: parseInt(parts[parts.length - 1], 10) || 0 });
                  } else {
                    toast.error("Failed to add", msg);
                  }
                })
                .finally(() => setBusy(false));
              void queueId; // assigned to queue by name if needed — future hook
            }}
          />
        )}

        <div className="flex justify-end gap-2 mt-5">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={busy || !selected.length} onClick={submit}>
            <I.Plus className="w-4 h-4" /> {busy ? "Adding…" : selected.length > 1 ? `Add ${selected.length}` : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, v, set, ph, type }: { label: string; v: string; set: (s: string) => void; ph?: string; type?: string }) {
  return (
    <div>
      <label className="text-xs text-slate-500">{label}</label>
      <input
        type={type || "text"}
        value={v}
        onChange={(e) => set(e.target.value)}
        placeholder={ph}
        className="mt-0.5 w-full bg-ink-900/60 border border-white/5 rounded-lg px-3 py-1.5 text-sm font-mono placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-aurora-500/50"
      />
    </div>
  );
}

