import { useEffect, useState } from "react";
import { api, Queue } from "../lib/api";
import { save } from "@tauri-apps/plugin-dialog";
import { playDing } from "../lib/sound";
import { fmtBytes } from "../lib/format";
import { useStore } from "../store";
import { I } from "./icons";
import clsx from "clsx";
import ImportModal from "./ImportModal";

type CatRow = { name: string; extsText: string; folder: string };
type QRow = { id: string; name: string; maxActive: string; speed: string; start: string; stop: string; onDone: string; running: boolean };

const ACCENTS = [
  { name: "Aurora", v: "#0a74f0" },
  { name: "Violet", v: "#7c5cff" },
  { name: "Grape", v: "#a855f7" },
  { name: "Magenta", v: "#cf2ea0" },
  { name: "Rose", v: "#f43f5e" },
  { name: "Amber", v: "#f59e0b" },
  { name: "Emerald", v: "#10b981" },
  { name: "Cyan", v: "#06b6d4" },
  { name: "Lime", v: "#6ee63a" },
];

const AURORA_BG =
  "radial-gradient(1200px 600px at 10% -10%, rgba(31,147,255,0.18), transparent 60%), radial-gradient(900px 500px at 90% 0%, rgba(240,78,192,0.12), transparent 55%)";
const THEMES = [
  { name: "Aurora", accent: "#0a74f0", bg: AURORA_BG },
  { name: "Midnight", accent: "#6366f1", bg: "radial-gradient(1200px 600px at 10% -10%, rgba(99,102,241,0.20), transparent 60%), radial-gradient(900px 500px at 90% 0%, rgba(56,189,248,0.10), transparent 55%)" },
  { name: "Sunset", accent: "#f97316", bg: "radial-gradient(1200px 600px at 10% -10%, rgba(249,115,22,0.18), transparent 60%), radial-gradient(900px 500px at 90% 0%, rgba(244,63,94,0.12), transparent 55%)" },
  { name: "Forest", accent: "#10b981", bg: "radial-gradient(1200px 600px at 10% -10%, rgba(16,185,129,0.18), transparent 60%), radial-gradient(900px 500px at 90% 0%, rgba(34,197,94,0.10), transparent 55%)" },
  { name: "Grape", accent: "#a855f7", bg: "radial-gradient(1200px 600px at 10% -10%, rgba(168,85,247,0.20), transparent 60%), radial-gradient(900px 500px at 90% 0%, rgba(236,72,153,0.12), transparent 55%)" },
];

const TABS: [string, string][] = [
  ["general", "General"],
  ["categories", "Categories"],
  ["queues", "Queues"],
  ["network", "Performance"],
  ["automation", "Automation"],
  ["browser", "Browser"],
  ["bittorrent", "BitTorrent"],
  ["remote", "Remote"],
];

export default function SettingsView() {
  const [dir, setDir] = useState("");
  const [conns, setConns] = useState("16");
  const [maxDl, setMaxDl] = useState("5");
  const [speed, setSpeed] = useState(localStorage.getItem("dm-speed") || "0");
  const [accent, setAccent] = useState(localStorage.getItem("dm-accent") || ACCENTS[0].v);
  const [theme, setTheme] = useState(localStorage.getItem("dm-theme") || "Aurora");
  const [light, setLight] = useState(localStorage.getItem("dm-light") === "on");
  const [organize, setOrganize] = useState(localStorage.getItem("dm-organize") !== "off");
  const [tab, setTab] = useState("general");
  const [density, setDensity] = useState(localStorage.getItem("dm-density") || "comfortable");
  const [trackers, setTrackers] = useState("");
  const [dirMsg, setDirMsg] = useState("");
  const [histLimit, setHistLimit] = useState(localStorage.getItem("dm-histlimit") || "500");
  const [histMsg, setHistMsg] = useState("");
  const [cleanMsg, setCleanMsg] = useState("");
  const [onCompleteAction, setOnCompleteAction] = useState(localStorage.getItem("dm-oncomplete") || "none");
  const [onCompleteCmd, setOnCompleteCmd] = useState(localStorage.getItem("dm-oncomplete-cmd") || "");
  const [sound, setSound] = useState(localStorage.getItem("dm-sound") !== "off");
  const [completeToast, setCompleteToast] = useState(localStorage.getItem("dm-complete-toast") !== "off");
  const liveBg = useStore((s) => s.liveBg);
  const setLiveBg = useStore((s) => s.setLiveBg);
  const [confirmBg, setConfirmBg] = useState(false);

  // Network
  const [proxy, setProxy] = useState(localStorage.getItem("dm-proxy") || "");
  const [ua, setUa] = useState(localStorage.getItem("dm-ua") || "");
  const [header, setHeader] = useState(localStorage.getItem("dm-header") || "");

  // Automation toggles
  const [confirmDl, setConfirmDl] = useState(localStorage.getItem("dm-confirm") !== "off");
  const [clip, setClip] = useState(localStorage.getItem("dm-clipboard") === "on");
  const [autostart, setAutostart] = useState(false);
  const [shutdown, setShutdown] = useState(false);
  const [av, setAv] = useState(localStorage.getItem("dm-av") === "on");
  const [metered, setMetered] = useState(localStorage.getItem("dm-metered") !== "off");
  const [awake, setAwake] = useState(localStorage.getItem("dm-awake") !== "off");
  const [extract, setExtract] = useState(localStorage.getItem("dm-extract") === "on");
  const [cookiesBrowser, setCookiesBrowser] = useState(localStorage.getItem("dm-cookies-browser") || "none");
  const [remote, setRemote] = useState(false);
  const [remoteUrl, setRemoteUrl] = useState("");
  const [bridgeStatus, setBridgeStatus] = useState<{ running: boolean; lastPingMs: number; url: string } | null>(null);
  const [extPaths, setExtPaths] = useState<{ dir: string; dirExists: boolean; crx: string; crxExists: boolean; xpi: string; xpiExists: boolean; xpiSigned: boolean } | null>(null);
  const [showImport, setShowImport] = useState(false);

  // Scheduler
  const sched = JSON.parse(localStorage.getItem("dm-sched") || "{}");
  const [schedOn, setSchedOn] = useState(!!sched.start && !!sched.stop);
  const [start, setStart] = useState(sched.start || "01:00");
  const [stop, setStop] = useState(sched.stop || "08:00");

  // Trackers
  const [trkMsg, setTrkMsg] = useState("");
  const [remMsg, setRemMsg] = useState("");

  // Browser interception rules
  const [rulesOn, setRulesOn] = useState(true);
  const [autoExts, setAutoExts] = useState("");
  const [blockSites, setBlockSites] = useState("");
  const [blockAddr, setBlockAddr] = useState("");
  const [rulesMsg, setRulesMsg] = useState("");

  // Categories
  const [cats, setCats] = useState<CatRow[]>([]);
  const [catMsg, setCatMsg] = useState("");

  // Queues
  const [qrows, setQrows] = useState<QRow[]>([]);
  const [qMsg, setQMsg] = useState("");

  useEffect(() => {
    api.info().then((i) => setDir(i.dir)).catch(() => {});
    api.autostartEnabled().then(setAutostart).catch(() => {});
    document.documentElement.style.setProperty("--dm-accent", accent);
    api.setAvScan(localStorage.getItem("dm-av") === "on").catch(() => {});
    api.remoteInfo().then((r) => { setRemote(r.enabled); setRemoteUrl(r.url); }).catch(() => {});
    api.bridgeInfo().then((b) => setBridgeStatus({ running: b.running, lastPingMs: b.lastPingMs, url: b.url })).catch(() => {});
    api.extensionPaths().then(setExtPaths).catch(() => {});
  }, [accent]);

  useEffect(() => {
    api.getRules().then((r) => {
      setRulesOn(r.enabled !== false);
      setAutoExts((r.autoExts || []).join(" "));
      setBlockSites((r.blockSites || []).join("\n"));
      setBlockAddr((r.blockAddresses || []).join("\n"));
    }).catch(() => {});
  }, []);

  useEffect(() => {
    api.getCategories().then((list) =>
      setCats(list.map((c) => ({ name: c.name, extsText: (c.exts || []).join(" "), folder: c.folder })))
    ).catch(() => {});
  }, []);

  useEffect(() => {
    api.getQueues().then((qs) =>
      setQrows(qs.map((q) => ({
        id: q.id, name: q.name, maxActive: String(q.maxActive || 0), speed: String(q.speed || 0),
        start: q.schedule?.start || "", stop: q.schedule?.stop || "", onDone: q.schedule?.onDone || "none", running: q.running !== false,
      })))
    ).catch(() => {});
  }, []);

  useEffect(() => { api.getTrackers().then(setTrackers).catch(() => {}); }, []);

  function applyAccent(v: string) {
    setAccent(v);
    localStorage.setItem("dm-accent", v);
    document.documentElement.style.setProperty("--dm-accent", v);
  }
  function applyTheme(t: { name: string; accent: string; bg: string }) {
    setTheme(t.name);
    setAccent(t.accent);
    localStorage.setItem("dm-theme", t.name);
    localStorage.setItem("dm-accent", t.accent);
    localStorage.setItem("dm-bg", t.bg);
    document.documentElement.style.setProperty("--dm-accent", t.accent);
    document.documentElement.style.setProperty("--dm-bg-image", t.bg);
  }
  function applyLight(on: boolean) {
    setLight(on);
    localStorage.setItem("dm-light", on ? "on" : "off");
    document.documentElement.classList.toggle("dm-light", on);
  }
  function applyDensity(d: string) {
    setDensity(d);
    localStorage.setItem("dm-density", d);
    document.documentElement.classList.toggle("dm-compact", d === "compact");
  }
  async function changeFolder() {
    const f = await api.pickFolder().catch(() => null);
    if (f) { await api.setDownloadDir(f).catch(() => {}); setDir(f); setDirMsg("Saved \u2014 new downloads go here"); }
  }
  function resetFolder() {
    api.setDownloadDir("").then(() => api.info().then((i) => setDir(i.dir))).catch(() => {});
    setDirMsg("Reset to the default folder");
  }
  function saveTrackers() {
    api.setTrackers(trackers).then(() => setTrkMsg("Your trackers applied")).catch(() => setTrkMsg("Failed"));
  }

  function apply() {
    localStorage.setItem("dm-speed", speed);
    localStorage.setItem("dm-organize", organize ? "on" : "off");
    localStorage.setItem("dm-proxy", proxy);
    localStorage.setItem("dm-ua", ua);
    localStorage.setItem("dm-header", header);
    const opts: Record<string, string> = {
      "max-concurrent-downloads": maxDl,
      "max-connection-per-server": conns,
      "max-overall-download-limit": speed === "0" ? "0" : `${speed}K`,
      "all-proxy": proxy,
    };
    if (ua.trim()) opts["user-agent"] = ua.trim();
    if (header.trim()) opts["header"] = header.trim();
    api.setGlobal(opts).catch(() => {});
    // Keep the tray "Speed limit" toggle in sync with the configured limit.
    api.setSpeedLimitState(speed !== "0", speed !== "0" ? `${speed}K` : "").catch(() => {});
  }

  function saveSchedule(on: boolean, a: string, b: string) {
    if (on) localStorage.setItem("dm-sched", JSON.stringify({ start: a, stop: b }));
    else localStorage.removeItem("dm-sched");
  }

  function saveRules() {
    const split = (s: string) => s.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean);
    api.setRules({
      enabled: rulesOn,
      autoExts: split(autoExts).map((s) => s.toUpperCase()),
      blockSites: split(blockSites),
      blockAddresses: split(blockAddr),
    }).then(() => setRulesMsg("Saved \u2014 the extension applies it within a minute")).catch(() => setRulesMsg("Save failed"));
  }

  function resetRules() {
    setRulesOn(true);
    setAutoExts("3GP 7Z AAC ACE AIF APK ARJ ASF AVI BIN BZ2 EXE GZ GZIP IMG ISO LZH M4A M4V MKV MOV MP3 MP4 MPA MPE MPEG MPG MSI MSU OGG OGV PDF PLJ PPS PPT QT RA RAR RM RMVB SEA SIT SITX TAR TIF TIFF WAV WMA WMV Z ZIP");
    setBlockSites("*.update.microsoft.com\ndownload.windowsupdate.com\n*.download.windowsupdate.com\nsiteseal.thawte.com\necom.cimetz.com\n*.voice2page.com");
    setBlockAddr("");
    setRulesMsg("Reset \u2014 click Save to apply");
  }

  function updateCat(i: number, patch: Partial<CatRow>) {
    setCats((cs) => cs.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  }
  function addCat() {
    setCats((cs) => [...cs, { name: "New", extsText: "", folder: "New" }]);
  }
  function delCat(i: number) {
    setCats((cs) => cs.filter((_, j) => j !== i));
  }
  async function browseCat(i: number) {
    const f = await api.pickFolder().catch(() => null);
    if (f) updateCat(i, { folder: f });
  }
  function saveCats() {
    const clean = cats.map((c) => ({
      name: c.name.trim() || "Unnamed",
      exts: c.extsText.split(/[\s,]+/).map((s) => s.trim().toLowerCase()).filter(Boolean),
      folder: c.folder.trim() || c.name.trim() || "Other",
    }));
    api.setCategories(clean).then(() => { setCatMsg("Saved"); useStore.getState().loadCategories(); }).catch(() => setCatMsg("Save failed"));
  }

  function updateQ(i: number, patch: Partial<QRow>) {
    setQrows((qs) => qs.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  }
  function addQueue() {
    setQrows((qs) => [...qs, { id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, name: "New queue", maxActive: "0", speed: "0", start: "", stop: "", onDone: "none", running: true }]);
  }
  function delQueue(i: number) {
    setQrows((qs) => qs.filter((q, j) => j !== i || q.id === "main"));
  }
  function saveQueues() {
    const clean: Queue[] = qrows.map((q) => ({
      id: q.id,
      name: q.name.trim() || "Queue",
      maxActive: Math.max(0, parseInt(q.maxActive) || 0),
      speed: Math.max(0, parseInt(q.speed) || 0),
      running: q.running,
      schedule: q.start && q.stop ? { start: q.start, stop: q.stop, onDone: q.onDone } : q.onDone !== "none" ? { start: "", stop: "", onDone: q.onDone } : null,
    }));
    api.setQueues(clean).then(() => setQMsg("Saved")).catch(() => setQMsg("Save failed"));
  }

  async function exportHist(fmt: "csv" | "json") {
    try {
      const path = await save({ defaultPath: `downman-history.${fmt}`, filters: [{ name: fmt.toUpperCase(), extensions: [fmt] }] });
      if (!path) return;
      await api.exportHistory(path, fmt);
      setHistMsg(`Exported to ${path}`);
    } catch {
      setHistMsg("Export failed.");
    }
  }
  async function doClearGone() {
    const n = await api.clearGone().catch(() => 0);
    setCleanMsg(n > 0 ? `Cleared ${n} missing/failed ${n === 1 ? "entry" : "entries"}.` : "No missing or failed entries to clear.");
  }
  async function doClearCache() {
    const r = await api.clearCache().catch(() => null);
    if (!r) { setCleanMsg("Could not clear cache."); return; }
    setCleanMsg(r.files > 0 ? `Freed ${fmtBytes(r.bytes)} from ${r.files} leftover ${r.files === 1 ? "file" : "files"}.` : "Cache is already clean — nothing to remove.");
  }
  function applyOnComplete(action: string, command: string) {
    setOnCompleteAction(action);
    localStorage.setItem("dm-oncomplete", action);
    localStorage.setItem("dm-oncomplete-cmd", command);
    api.setOnComplete(action, command).catch(() => {});
  }

  return (
    <div className="max-w-2xl">
      <div className="flex flex-wrap gap-1 mb-4 border-b border-white/5">
        {TABS.map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={clsx("px-3 py-2 text-sm whitespace-nowrap border-b-2 -mb-px", tab === id ? "border-aurora-400 text-white" : "border-transparent text-slate-500 hover:text-slate-300")}>
            {label}
          </button>
        ))}
      </div>
      <div className="space-y-4">

      {tab === "general" && (<>
      <div className="card p-5 space-y-3">
        <h3 className="font-semibold">Appearance</h3>
        <div>
          <label className="text-sm text-slate-400">Theme</label>
          <div className="flex flex-wrap gap-2 mt-1.5">
            {THEMES.map((t) => (
              <button key={t.name} onClick={() => applyTheme(t)}
                className={`px-3 py-1.5 rounded-lg text-sm border transition-colors ${theme === t.name ? "border-white/40 text-white" : "border-white/5 text-slate-400 hover:text-slate-200"}`}
                style={{ background: `${t.accent}22` }}>
                {t.name}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-sm text-slate-400">Accent color</label>
          <div className="flex gap-3 mt-1.5">
            {ACCENTS.map((a) => (
              <button key={a.v} title={a.name} onClick={() => applyAccent(a.v)}
                className={`w-9 h-9 rounded-full border-2 ${accent === a.v ? "border-white" : "border-transparent"}`} style={{ background: a.v }} />
            ))}
          </div>
        </div>
        <div>
          <label className="text-sm text-slate-400">Density</label>
          <div className="flex gap-2 mt-1.5">
            {(["comfortable", "compact"] as const).map((d) => (
              <button key={d} onClick={() => applyDensity(d)} className={clsx("px-3 py-1.5 rounded-lg text-sm capitalize", density === d ? "btn-primary" : "btn-ghost")}>{d}</button>
            ))}
          </div>
        </div>        <label className="flex items-center gap-2 text-sm text-slate-400">
          <input type="checkbox" checked={light} onChange={(e) => applyLight(e.target.checked)} /> Light mode
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-400">
          <input type="checkbox" checked={liveBg} onChange={(e) => { if (e.target.checked) setConfirmBg(true); else setLiveBg(false); }} />
          Animated background <span className="text-[11px] text-amber-400/80">· uses GPU</span>
        </label>      </div>

      <div className="card p-5">
        <h3 className="font-semibold mb-3">Storage</h3>
        <label className="text-sm text-slate-400">Download folder</label>
        <div className="flex gap-2 mt-1">
          <div className="flex-1 min-w-0 font-mono text-sm bg-ink-900/60 rounded-lg px-3 py-2 border border-white/5 truncate" title={dir}>{dir || "…"}</div>
          <button className="btn-ghost shrink-0" onClick={changeFolder}><I.Folder className="w-4 h-4" /> Change</button>
          <button className="btn-ghost shrink-0" onClick={resetFolder}>Default</button>
        </div>
        {dirMsg && <div className="text-[11px] text-slate-500 mt-1">{dirMsg}</div>}
        <label className="flex items-center gap-2 mt-3 text-sm text-slate-400">
          <input type="checkbox" checked={organize} onChange={(e) => { setOrganize(e.target.checked); localStorage.setItem("dm-organize", e.target.checked ? "on" : "off"); api.setOrganize(e.target.checked).catch(() => {}); }} /> Auto-sort completed files into category folders
        </label>
      </div>

      <div className="card p-5">
        <h3 className="font-semibold mb-1">Application</h3>
        <p className="text-sm text-slate-500 mb-3">Closing the window keeps DownMan running in the background so downloads continue. Reopen it from the tray or by launching DownMan again. Quit fully exits — downloads resume when you reopen.</p>
        <button className="btn-danger" onClick={() => api.quitApp().catch(() => {})}>Quit DownMan</button>
      </div>

      <div className="card p-5">
        <h3 className="font-semibold mb-3">History</h3>
        <label className="text-sm text-slate-400">Keep completed downloads</label>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <div className="relative">
            <select
              value={histLimit}
              onChange={(e) => { setHistLimit(e.target.value); localStorage.setItem("dm-histlimit", e.target.value); api.setHistoryLimit(+e.target.value).catch(() => {}); }}
              className="appearance-none bg-ink-900/60 border border-white/5 rounded-lg pl-3 pr-8 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-aurora-500/50"
            >
              <option value="200">Last 200</option>
              <option value="500">Last 500</option>
              <option value="2000">Last 2,000</option>
              <option value="10000">Last 10,000</option>
              <option value="0">Unlimited</option>
            </select>
            <I.Down className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          </div>
          <button className="btn-ghost" onClick={() => exportHist("csv")}>Export CSV</button>
          <button className="btn-ghost" onClick={() => exportHist("json")}>Export JSON</button>
        </div>
        {histMsg && <div className="text-[11px] text-slate-500 mt-1 break-words">{histMsg}</div>}
      </div>

      <div className="card p-5">
        <h3 className="font-semibold mb-1">Maintenance</h3>
        <p className="text-sm text-slate-500 mb-3">Tidy the list and reclaim disk space from leftover download files. In-progress downloads are never touched.</p>
        <div className="flex gap-2 flex-wrap">
          <button className="btn-ghost" onClick={doClearGone}>Clear missing &amp; failed</button>
          <button className="btn-ghost" onClick={doClearCache}>Clear cache</button>
        </div>
        {cleanMsg && <div className="text-[11px] text-slate-500 mt-2 break-words">{cleanMsg}</div>}
      </div>

      <div className="card p-5">
        <h3 className="font-semibold mb-1">When a download completes</h3>
        <p className="text-sm text-slate-500 mb-3">Automatically act on each finished file.</p>
        <div className="relative inline-block">
          <select
            value={onCompleteAction}
            onChange={(e) => applyOnComplete(e.target.value, onCompleteCmd)}
            className="appearance-none bg-ink-900/60 border border-white/5 rounded-lg pl-3 pr-8 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-aurora-500/50"
          >
            <option value="none">Do nothing</option>
            <option value="reveal">Open its folder</option>
            <option value="open">Open the file</option>
            <option value="run">Run a command…</option>
          </select>
          <I.Down className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
        </div>
        {onCompleteAction === "run" && (
          <div className="mt-3">
            <input
              value={onCompleteCmd}
              onChange={(e) => setOnCompleteCmd(e.target.value)}
              onBlur={() => applyOnComplete("run", onCompleteCmd)}
              placeholder="notify-send 'Done' {name}"
              className="w-full bg-ink-900/60 border border-white/5 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-aurora-500/50"
            />
            <div className="text-[11px] text-slate-600 mt-1">Runs via <code>sh -c</code> for each completed file. <code>{"{path}"}</code> and <code>{"{name}"}</code> are inserted (safely quoted).</div>
          </div>
        )}
      </div>

      <div className="card p-5">
        <h3 className="font-semibold mb-3">Notifications</h3>
        <label className="flex items-center gap-2 text-sm text-slate-400">
          <input type="checkbox" checked={sound} onChange={(e) => { setSound(e.target.checked); localStorage.setItem("dm-sound", e.target.checked ? "on" : "off"); }} /> Play a sound when downloads finish
        </label>
        <label className="flex items-center gap-2 mt-2 text-sm text-slate-400">
          <input type="checkbox" checked={completeToast} onChange={(e) => { setCompleteToast(e.target.checked); localStorage.setItem("dm-complete-toast", e.target.checked ? "on" : "off"); }} /> Show an in-app toast when downloads finish
        </label>
        <button className="btn-ghost mt-3 text-xs" onClick={() => playDing(true)}>Test sound</button>
      </div>
      </>)}

      {tab === "categories" && (<>
      <div className="card p-5 space-y-3">
        <h3 className="font-semibold">Categories</h3>
        <p className="text-sm text-slate-500">Files sort into the first category whose extensions match. The one with no extensions is the catch-all. Folder can be a name (under your download folder) or an absolute path.</p>
        <div className="space-y-2">
          {cats.map((c, i) => (
            <div key={i} className="grid grid-cols-[1fr_1.5fr_1.5fr_auto] gap-2 items-center">
              <input value={c.name} onChange={(e) => updateCat(i, { name: e.target.value })} placeholder="Name"
                className="bg-ink-900/60 border border-white/5 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-aurora-500/50" />
              <input value={c.extsText} onChange={(e) => updateCat(i, { extsText: e.target.value })} placeholder="mp4 mkv …"
                className="bg-ink-900/60 border border-white/5 rounded-lg px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-aurora-500/50" />
              <div className="flex gap-1 min-w-0">
                <input value={c.folder} onChange={(e) => updateCat(i, { folder: e.target.value })} placeholder="Folder"
                  className="flex-1 min-w-0 bg-ink-900/60 border border-white/5 rounded-lg px-2 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-aurora-500/50" />
                <button className="btn-ghost !px-2" title="Browse" onClick={() => browseCat(i)}><I.Folder className="w-4 h-4" /></button>
              </div>
              <button className="btn-ghost !px-2 text-rose-300" title="Delete category" onClick={() => delCat(i)}>✕</button>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <button className="btn-ghost" onClick={addCat}>+ Add category</button>
          <button className="btn-primary" onClick={saveCats}>Save categories</button>
          {catMsg && <span className="text-[11px] text-slate-500">{catMsg}</span>}
        </div>
      </div>
      </>)}

      {tab === "queues" && (<>
      <div className="card p-5 space-y-3">
        <h3 className="font-semibold">Queues</h3>
        <p className="text-sm text-slate-500">Group downloads into queues. Stop a queue to pause its downloads; set how many run at once, a speed cap, and a schedule with an action when it finishes. Assign downloads from the list&rsquo;s Queue column.</p>
        {qrows.map((q, i) => (
          <div key={q.id} className="rounded-lg border border-white/5 p-3 space-y-2">
            <div className="flex items-center gap-2">
              <input value={q.name} onChange={(e) => updateQ(i, { name: e.target.value })} placeholder="Queue name"
                className="flex-1 bg-ink-900/60 border border-white/5 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-aurora-500/50" />
              <label className="flex items-center gap-1 text-xs text-slate-500">max
                <input value={q.maxActive} onChange={(e) => updateQ(i, { maxActive: e.target.value })} className="w-12 bg-ink-900/60 border border-white/5 rounded-lg px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-1 focus:ring-aurora-500/50" />
              </label>
              <label className="flex items-center gap-1 text-xs text-slate-500">KB/s
                <input value={q.speed} onChange={(e) => updateQ(i, { speed: e.target.value })} className="w-16 bg-ink-900/60 border border-white/5 rounded-lg px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-1 focus:ring-aurora-500/50" />
              </label>
              {q.id !== "main" && <button className="btn-ghost !px-2 text-rose-300" title="Delete queue" onClick={() => delQueue(i)}>✕</button>}
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-500 flex-wrap">
              <span>Schedule</span>
              <input type="time" value={q.start} onChange={(e) => updateQ(i, { start: e.target.value })} className="bg-ink-900/60 border border-white/5 rounded-lg px-2 py-1 text-sm" />
              <span>to</span>
              <input type="time" value={q.stop} onChange={(e) => updateQ(i, { stop: e.target.value })} className="bg-ink-900/60 border border-white/5 rounded-lg px-2 py-1 text-sm" />
              <span>then</span>
              <div className="relative inline-flex">
                <select value={q.onDone} onChange={(e) => updateQ(i, { onDone: e.target.value })}
                  className="appearance-none bg-ink-900/60 border border-white/5 rounded-lg pl-2 pr-7 py-1 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-aurora-500/50">
                  <option value="none">do nothing</option>
                  <option value="quit">quit DownMan</option>
                  <option value="sleep">sleep PC</option>
                  <option value="shutdown">shut down PC</option>
                </select>
                <I.Down className="absolute right-1.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" />
              </div>
            </div>
          </div>
        ))}
        <div className="flex items-center gap-3">
          <button className="btn-ghost" onClick={addQueue}>+ Add queue</button>
          <button className="btn-primary" onClick={saveQueues}>Save queues</button>
          {qMsg && <span className="text-[11px] text-slate-500">{qMsg}</span>}
        </div>
      </div>
      </>)}

      {tab === "network" && (<>
      <div className="card p-5 space-y-3">
        <h3 className="font-semibold">Performance</h3>
        <Row label="Max concurrent downloads" v={maxDl} set={setMaxDl} />
        <Row label="Connections per server" v={conns} set={setConns} />
        <Row label="Speed cap (KB/s, 0 = unlimited)" v={speed} set={setSpeed} />
      </div>

      <div className="card p-5 space-y-3">
        <h3 className="font-semibold">Network</h3>
        <Field label="Proxy (http://host:port, blank = none)" v={proxy} set={setProxy} ph="http://127.0.0.1:8080" />
        <Field label="User-Agent" v={ua} set={setUa} ph="Mozilla/5.0 …" />
        <Field label="Custom header" v={header} set={setHeader} ph="Authorization: Bearer …" />
        <button className="btn-primary" onClick={apply}>Apply performance & network</button>
      </div>
      </>)}

      {tab === "automation" && (<>
      <div className="card p-5 space-y-3">
        <h3 className="font-semibold">Automation</h3>
        <Toggle label="Ask where to save browser downloads (confirmation dialog)" checked={confirmDl}
          onChange={(c) => { setConfirmDl(c); localStorage.setItem("dm-confirm", c ? "on" : "off"); api.setConfirmDownloads(c).catch(() => {}); }} />
        <button className="self-start text-[11px] text-aurora-300 hover:underline"
          onClick={() => { localStorage.removeItem("dm-cat-defaults"); setRemMsg("Cleared — the dialog will ask again"); }}>
          Reset remembered per-category folders
        </button>
        {remMsg && <span className="text-[11px] text-slate-500">{remMsg}</span>}
        <Toggle label="Monitor clipboard for download links" checked={clip}
          onChange={(c) => { setClip(c); localStorage.setItem("dm-clipboard", c ? "on" : "off"); api.setClipboardWatch(c).catch(() => {}); }} />
        <Toggle label="Pause downloads on metered connections (hotspots)" checked={metered}
          onChange={(c) => { setMetered(c); localStorage.setItem("dm-metered", c ? "on" : "off"); api.setMeteredPause(c).catch(() => {}); }} />
        <Toggle label="Keep the system awake while downloading" checked={awake}
          onChange={(c) => { setAwake(c); localStorage.setItem("dm-awake", c ? "on" : "off"); api.setPowerBlock(c).catch(() => {}); }} />
        <Toggle label="Start DownMan on login" checked={autostart}
          onChange={(c) => { setAutostart(c); api.setAutostart(c).catch(() => {}); }} />
        <Toggle label="Shut down PC when all downloads finish" checked={shutdown}
          onChange={(c) => { setShutdown(c); api.setShutdownWhenDone(c).catch(() => {}); }} />
        <Toggle label="Scan finished files with ClamAV (if installed)" checked={av}
          onChange={(c) => { setAv(c); localStorage.setItem("dm-av", c ? "on" : "off"); api.setAvScan(c).catch(() => {}); }} />
        <Toggle label="Auto-extract finished archives (zip, rar, 7z, tar)" checked={extract}
          onChange={(c) => { setExtract(c); localStorage.setItem("dm-extract", c ? "on" : "off"); api.setAutoExtract(c).catch(() => {}); }} />
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <span>Cookies from browser for video sites</span>
          <select value={cookiesBrowser} onChange={(e) => { setCookiesBrowser(e.target.value); localStorage.setItem("dm-cookies-browser", e.target.value); }}
            className="appearance-none bg-ink-900/60 border border-white/5 rounded-lg px-2 py-1 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-aurora-500/50">
            {["none", "firefox", "chrome", "chromium", "brave", "edge", "vivaldi", "opera"].map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
      </div>

      <div className="card p-5 space-y-3">
        <h3 className="font-semibold">Browser interception</h3>
        <p className="text-sm text-slate-500">Rules the DownMan browser extension uses to decide which downloads to grab automatically.</p>
        <Toggle label="Automatically capture matching downloads from the browser" checked={rulesOn} onChange={setRulesOn} />
        <div>
          <label className="text-sm text-slate-400">Auto-download these file types</label>
          <textarea value={autoExts} onChange={(e) => setAutoExts(e.target.value)} placeholder="ISO ZIP MP4 PDF …"
            className="mt-1 w-full h-20 bg-ink-900/60 border border-white/5 rounded-lg px-3 py-2 text-sm font-mono placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-aurora-500/50 resize-none" />
        </div>
        <div>
          <label className="text-sm text-slate-400">Don’t auto-capture from these sites (one per line, * allowed)</label>
          <textarea value={blockSites} onChange={(e) => setBlockSites(e.target.value)} placeholder="*.example.com"
            className="mt-1 w-full h-20 bg-ink-900/60 border border-white/5 rounded-lg px-3 py-2 text-sm font-mono placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-aurora-500/50 resize-none" />
        </div>
        <div>
          <label className="text-sm text-slate-400">Don’t auto-capture these addresses</label>
          <textarea value={blockAddr} onChange={(e) => setBlockAddr(e.target.value)} placeholder="https://example.com/path/*"
            className="mt-1 w-full h-16 bg-ink-900/60 border border-white/5 rounded-lg px-3 py-2 text-sm font-mono placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-aurora-500/50 resize-none" />
        </div>
        <div className="flex items-center gap-3">
          <button className="btn-primary" onClick={saveRules}>Save rules</button>
          <button className="btn-ghost" onClick={resetRules}>Reset to defaults</button>
          {rulesMsg && <span className="text-[11px] text-slate-500">{rulesMsg}</span>}
        </div>
      </div>

      <div className="card p-5 space-y-3">
        <h3 className="font-semibold">Scheduler</h3>
        <Toggle label="Only download during active hours" checked={schedOn}
          onChange={(c) => { setSchedOn(c); saveSchedule(c, start, stop); }} />
        {schedOn && (
          <div className="flex items-center gap-3 text-sm text-slate-400">
            <span>From</span>
            <input type="time" value={start} onChange={(e) => { setStart(e.target.value); saveSchedule(true, e.target.value, stop); }}
              className="bg-ink-900/60 border border-white/5 rounded-lg px-2 py-1 text-sm" />
            <span>to</span>
            <input type="time" value={stop} onChange={(e) => { setStop(e.target.value); saveSchedule(true, start, e.target.value); }}
              className="bg-ink-900/60 border border-white/5 rounded-lg px-2 py-1 text-sm" />
          </div>
        )}
      </div>
      </>)}

      {tab === "browser" && (<>
      <div className="card p-5 space-y-4">
        <h3 className="font-semibold">Browser extension bridge</h3>
        <p className="text-sm text-slate-500">The bridge lets your browser extension send downloads directly to DownMan. It listens on a local HTTP port — no external traffic.</p>
        <div className="flex items-center gap-3">
          <div className={`w-2 h-2 rounded-full ${bridgeStatus?.running ? "bg-lime-400" : "bg-rose-500"}`} />
          <span className="text-sm text-slate-300">{bridgeStatus?.running ? "Bridge running" : "Bridge offline"}</span>
          <span className="ml-auto text-xs font-mono text-slate-500">{bridgeStatus?.url || "http://127.0.0.1:6802"}</span>
        </div>
        {bridgeStatus && (
          <div className="text-xs text-slate-500">
            {bridgeStatus.lastPingMs > 0
              ? `Extension last seen ${Math.round((Date.now() - bridgeStatus.lastPingMs) / 1000)}s ago`
              : "Extension hasn't connected yet this session."}
          </div>
        )}
        <div className="rounded-lg border border-white/5 bg-ink-900/40 p-4 space-y-4">
          <p className="text-sm font-medium text-slate-300">Install the browser extension</p>

          {/* Resolved path */}
          {extPaths && (
            <div className="space-y-1">
              <p className="text-xs text-slate-500">Extension folder</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs font-mono text-slate-300 bg-ink-900/60 border border-white/5 rounded px-2 py-1 truncate">{extPaths.dir}</code>
                <button className="btn-ghost !py-1 !px-2 text-xs shrink-0"
                  onClick={() => api.revealPath(extPaths.dir).catch(() => {})}>Open</button>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            {/* Chrome — reveal folder, they load unpacked */}
            <div className="rounded-lg border border-white/5 bg-ink-800/40 p-3 space-y-2">
              <p className="text-xs font-medium text-slate-300">Chromium <span className="text-slate-500">(Chrome / Brave / Edge)</span></p>
              <ol className="list-decimal ml-4 text-xs text-slate-500 space-y-1">
                <li>Open <code className="bg-ink-700/60 px-1 rounded">chrome://extensions</code></li>
                <li>Enable <b className="text-slate-300">Developer mode</b> (top right toggle)</li>
                <li>Click <b className="text-slate-300">Load unpacked</b> and select the folder below</li>
              </ol>
              {extPaths && (
                <button className="btn-primary !py-1 !px-2.5 text-xs w-full mt-1"
                  onClick={() => api.revealPath(extPaths.dir).catch(() => {})}>
                  Show extension folder
                </button>
              )}
            </div>

            {/* Firefox — one-click when an AMO-signed .xpi is present, else about:debugging */}
            <div className="rounded-lg border border-white/5 bg-ink-800/40 p-3 space-y-2">
              <p className="text-xs font-medium text-slate-300">Firefox</p>
              {extPaths?.xpiSigned ? (
                <div className="space-y-1.5">
                  <p className="text-xs text-slate-500">Signed by Mozilla — installs permanently in one click.</p>
                  <button className="btn-primary !py-1 !px-2.5 text-xs w-full"
                    onClick={() => api.openPath(extPaths.xpi).catch(() => {})}>
                    Install for Firefox
                  </button>
                  <p className="text-[10px] text-slate-600">Opens the signed add-on; Firefox prompts to add it.</p>
                </div>
              ) : (
                <>
                  <ol className="list-decimal ml-4 text-xs text-slate-500 space-y-1">
                    <li>Open <code className="bg-ink-700/60 px-1 rounded">about:debugging#/runtime/this-firefox</code></li>
                    <li>Click <b className="text-slate-300">Load Temporary Add-on</b></li>
                    <li>Select <code className="bg-ink-700/60 px-1 rounded">manifest.json</code> inside the folder below</li>
                  </ol>
                  {extPaths && (
                    <button className="btn-ghost !py-1 !px-2.5 text-xs w-full mt-1"
                      onClick={() => { navigator.clipboard.writeText(extPaths.dir).catch(() => {}); }}>
                      Copy folder path
                    </button>
                  )}
                  <p className="text-[10px] text-slate-600">Unsigned build — temporary add-on only. Run <code className="bg-ink-700/60 px-1 rounded">npm run sign:ext</code> for a permanent install.</p>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="flex gap-2">
          <button className="btn-ghost text-xs" onClick={async () => {
            try { const r = await fetch("http://127.0.0.1:6802/list"); if (r.ok) setBridgeStatus((b) => b ? { ...b, lastPingMs: Date.now() } : b); } catch { /* offline */ }
          }}>Test connection</button>
          <button className="btn-ghost text-xs" onClick={() => setShowImport(true)}>
            <I.Plus className="w-3.5 h-3.5" /> Import URL list
          </button>
        </div>
      </div>

      <div className="card p-5 space-y-3">
        <h3 className="font-semibold">URL interception</h3>
        <p className="text-sm text-slate-500">The extension intercepts URLs matching these rules and routes them through DownMan instead of the browser&apos;s own download.</p>
        <Toggle label="Enable URL interception" checked={rulesOn}
          onChange={(c) => { setRulesOn(c); api.setRules({ enabled: c, autoExts: autoExts.trim().split(/\s+/).filter(Boolean), blockSites: blockSites.trim().split("\n").filter(Boolean), blockAddresses: blockAddr.trim().split("\n").filter(Boolean) }).catch(() => {}); }} />
        <div>
          <label className="text-sm text-slate-400">Auto-intercept file extensions (space-separated)</label>
          <input value={autoExts} onChange={(e) => setAutoExts(e.target.value)}
            placeholder="zip rar 7z iso pdf mp4 mkv"
            className="mt-1 w-full bg-ink-900/60 border border-white/5 rounded-lg px-3 py-1.5 text-sm font-mono placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-aurora-500/50" />
        </div>
      </div>
      </>)}

      {tab === "bittorrent" && (<>
      <div className="card p-5 space-y-3">
        <h3 className="font-semibold">BitTorrent</h3>
        <p className="text-sm text-slate-500"><b>Update trackers</b> downloads a curated public tracker list and applies it to every torrent so they connect to more peers. Add your own below to merge them in.</p>
        <div className="flex items-center gap-3">
          <button className="btn-ghost" onClick={() => { setTrkMsg("Updating…"); api.updateTrackers().then((n) => setTrkMsg(`${n} public trackers applied`)).catch(() => setTrkMsg("Update failed")); }}>
            Update public trackers
          </button>
          {trkMsg && <span className="text-sm text-slate-400">{trkMsg}</span>}
        </div>
        <div>
          <label className="text-sm text-slate-400">Your trackers (one per line — merged with the public list)</label>
          <textarea value={trackers} onChange={(e) => setTrackers(e.target.value)} placeholder={"udp://tracker.example:1337/announce\nhttps://tracker.example/announce"}
            className="mt-1 w-full h-24 bg-ink-900/60 border border-white/5 rounded-lg px-3 py-2 text-sm font-mono placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-aurora-500/50 resize-none" />
        </div>
        <button className="btn-primary self-start" onClick={saveTrackers}>Apply my trackers</button>
      </div>
      </>)}

      {tab === "remote" && (<>
      <div className="card p-5 space-y-3">
        <h3 className="font-semibold">Remote control (web UI)</h3>
        <p className="text-sm text-slate-500">Control DownMan from your phone or another device on the same Wi-Fi. Anyone with the link below can add and pause downloads, so keep it private.</p>
        <Toggle label="Enable remote web UI on this network" checked={remote}
          onChange={(c) => { setRemote(c); localStorage.setItem("dm-remote", c ? "on" : "off"); api.setRemote(c).then((r) => setRemoteUrl(r.url)).catch(() => {}); }} />
        {remote && remoteUrl && (
          <div className="flex items-center gap-2">
            <input readOnly value={remoteUrl} className="flex-1 bg-ink-900/60 border border-white/5 rounded-lg px-3 py-2 text-xs font-mono" />
            <button className="btn-ghost" onClick={() => navigator.clipboard.writeText(remoteUrl)}>Copy</button>
          </div>
        )}
      </div>
      </>)}

      </div>

      {confirmBg && (
        <div className="fixed inset-0 z-[80] grid place-items-center bg-black/60 backdrop-blur-sm animate-fade-up" onClick={() => setConfirmBg(false)}>
          <div className="card w-[440px] max-w-[92vw] p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold mb-1">Enable animated background?</h2>
            <p className="text-sm text-slate-400 mb-4">This renders a live background on your GPU. It looks great, but it <b className="text-amber-300">uses more CPU/GPU and battery</b> and keeps drawing while the app is open. You can turn it off anytime.</p>
            <div className="flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => setConfirmBg(false)}>Cancel</button>
              <button className="btn-primary" onClick={() => { setLiveBg(true); setConfirmBg(false); }}>Enable anyway</button>
            </div>
          </div>
        </div>
      )}
      {showImport && <ImportModal onClose={() => setShowImport(false)} />}
    </div>
  );
}

function Row({ label, v, set }: { label: string; v: string; set: (s: string) => void }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-slate-400">{label}</span>
      <input value={v} onChange={(e) => set(e.target.value)} className="w-20 bg-ink-900/60 border border-white/5 rounded-lg px-3 py-1.5 text-sm text-center focus:outline-none focus:ring-1 focus:ring-aurora-500/50" />
    </div>
  );
}

function Field({ label, v, set, ph }: { label: string; v: string; set: (s: string) => void; ph?: string }) {
  return (
    <div>
      <label className="text-sm text-slate-400">{label}</label>
      <input value={v} onChange={(e) => set(e.target.value)} placeholder={ph}
        className="mt-1 w-full bg-ink-900/60 border border-white/5 rounded-lg px-3 py-1.5 text-sm font-mono placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-aurora-500/50" />
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (c: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm text-slate-400 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} /> {label}
    </label>
  );
}

