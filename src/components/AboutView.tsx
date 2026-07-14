import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { toast } from "../lib/toast";
import { save } from "@tauri-apps/plugin-dialog";

interface DiagInfo {
  dir: string;
  bridgeRunning: boolean;
  bridgeUrl: string;
  bridgeLastPing: number;
}

export default function AboutView() {
  const [diag, setDiag] = useState<DiagInfo | null>(null);
  const [copying, setCopying] = useState(false);
  const [ytVer, setYtVer] = useState<string>("…");
  const [jsRt, setJsRt] = useState<string>("…");
  const [updating, setUpdating] = useState(false);
  const [autoUp, setAutoUp] = useState(true);

  useEffect(() => {
    Promise.all([api.info(), api.bridgeInfo()]).then(([info, bridge]) => {
      setDiag({
        dir: info.dir,
        bridgeRunning: bridge.running,
        bridgeUrl: bridge.url,
        bridgeLastPing: bridge.lastPingMs,
      });
    }).catch(() => {});
    api.ytdlpVersion().then(setYtVer).catch(() => setYtVer("not found"));
    api.jsRuntimeStatus().then(setJsRt).catch(() => setJsRt("none"));
    api.ytdlpAutoUpdate().then(setAutoUp).catch(() => {});
  }, []);

  async function updateYtdlp() {
    setUpdating(true);
    try {
      const v = await api.updateYtdlp();
      setYtVer(v);
      toast.success(`yt-dlp updated to ${v}`);
    } catch (e) {
      toast.error("yt-dlp update failed", String(e));
    } finally {
      setUpdating(false);
    }
  }

  async function toggleAuto(v: boolean) {
    setAutoUp(v);
    try {
      await api.setYtdlpAutoUpdate(v);
    } catch {
      setAutoUp(!v);
    }
  }

  async function copyDiagnostics() {
    if (!diag) return;
    setCopying(true);
    const text = [
      `DownMan v1.0.0`,
      `License: MIT (see LICENSE)`,
      `Engine: aria2`,
      `Download folder: ${diag.dir}`,
      `Bridge: ${diag.bridgeRunning ? "running" : "offline"} at ${diag.bridgeUrl}`,
      `Bridge last ping: ${diag.bridgeLastPing > 0 ? new Date(diag.bridgeLastPing).toISOString() : "never"}`,
      `UA: ${navigator.userAgent}`,
      `Platform: ${navigator.platform}`,
    ].join("\n");
    await navigator.clipboard.writeText(text).catch(() => {});
    toast.success("Diagnostics copied to clipboard");
    setCopying(false);
  }

  async function exportHistory() {
    const path = await save({
      defaultPath: "downman-history.json",
      filters: [{ name: "JSON", extensions: ["json"] }, { name: "CSV", extensions: ["csv"] }],
    }).catch(() => null);
    if (!path) return;
    const fmt = (path as string).endsWith(".csv") ? "csv" : "json";
    api.exportHistory(path as string, fmt)
      .then(() => toast.success("History exported"))
      .catch(() => toast.error("Export failed"));
  }

  return (
    <div className="flex-1 overflow-auto p-6 space-y-4 max-w-2xl mx-auto">
      <div className="flex items-center gap-4 mb-2">
        <img src="/downman.png" alt="DownMan" className="w-14 h-14 rounded-2xl" />
        <div>
          <div className="text-xl font-bold">DownMan</div>
          <div className="text-sm text-slate-500">v1.0.0 · aria2 engine · Linux</div>
        </div>
      </div>

      <div className="card p-5 space-y-3">
        <h3 className="font-semibold">Diagnostics</h3>
        {diag ? (
          <div className="space-y-1.5 text-sm text-slate-400 font-mono text-xs">
            <DiagRow label="Version" value="1.0.0 · Linux" />
            <DiagRow label="License" value="MIT" />
            <DiagRow label="Download folder" value={diag.dir} />
            <DiagRow label="Bridge" value={`${diag.bridgeRunning ? "running" : "offline"} — ${diag.bridgeUrl}`} />
            <DiagRow label="Bridge last seen"
              value={diag.bridgeLastPing > 0
                ? `${Math.round((Date.now() - diag.bridgeLastPing) / 1000)}s ago`
                : "not connected this session"} />
          </div>
        ) : (
          <div className="text-sm text-slate-500">Loading…</div>
        )}
        <div className="flex gap-2 pt-1">
          <button className="btn-ghost text-xs" onClick={copyDiagnostics} disabled={copying}>
            {copying ? "Copied!" : "Copy diagnostics"}
          </button>
          <button className="btn-ghost text-xs" onClick={exportHistory}>
            Export history…
          </button>
        </div>
      </div>

      <div className="card p-5 space-y-3">
        <h3 className="font-semibold">Media capture engine</h3>
        <div className="space-y-1.5 text-xs font-mono">
          <DiagRow label="yt-dlp" value={ytVer} />
          <DiagRow label="Site JS runtime" value={jsRt === "none" ? "none — install node or deno for full site support" : jsRt} />
        </div>
        <p className="text-sm text-slate-500">
          yt-dlp changes often — sites break older versions. DownMan keeps it current itself, so you don't have to wait on your distro shipping updates.
        </p>
        <label className="flex items-start gap-2.5 cursor-pointer select-none">
          <input type="checkbox" className="mt-1" checked={autoUp} onChange={(e) => toggleAuto(e.target.checked)} />
          <span className="text-sm">
            <span className="text-slate-200">Keep yt-dlp up to date automatically</span>
            <span className="block text-[11px] text-slate-500">Checks once a day and only downloads when a newer release exists.</span>
          </span>
        </label>
        <div className="flex items-center gap-2">
          <button className="btn-primary text-xs" onClick={updateYtdlp} disabled={updating}>
            {updating ? "Updating…" : "Update now"}
          </button>
          <span className="text-[11px] text-slate-600">Fetches the latest build (~40 MB) and verifies its checksum.</span>
        </div>
        {jsRt === "none" && (
          <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 p-3 text-xs text-amber-100/90">
            No JS runtime found. Site signature solving needs <b>node</b> or <b>deno</b>. Install one — e.g. <code className="bg-ink-700/60 px-1 rounded">sudo apt install nodejs</code> or <code className="bg-ink-700/60 px-1 rounded">curl -fsSL https://deno.land/install.sh | sh</code> — and DownMan will pick it up automatically.
          </div>
        )}
      </div>

      <div className="card p-5 space-y-2">
        <h3 className="font-semibold">License</h3>
        <p className="text-sm text-slate-400">
          DownMan is released under the <b className="text-slate-300">MIT License</b> —
          free to use, modify, and distribute, including commercially, provided
          <span className="text-slate-300"> “as is”</span> with no warranty.
          You alone remain responsible for the terms of service of the sites you access and the copyright
          of any content you download.
        </p>
        <p className="text-xs text-slate-600">
          Full text in <code className="bg-ink-700/60 px-1 rounded">LICENSE</code> at the project root.
        </p>
      </div>

      <div className="card p-5 space-y-2">
        <h3 className="font-semibold">Open source components</h3>
        <div className="text-sm text-slate-500 space-y-1">
          <p><b className="text-slate-300">aria2</b> — download engine (GPL-2.0-or-later)</p>
          <p><b className="text-slate-300">yt-dlp</b> — media capture (Unlicense)</p>
          <p><b className="text-slate-300">ffmpeg</b> — media merging (LGPL-2.1+/GPL)</p>
          <p><b className="text-slate-300">Tauri 2</b> — desktop shell (Apache-2.0 / MIT)</p>
          <p><b className="text-slate-300">React</b> — UI (MIT)</p>
          <p>Each third-party tool is governed by its own license; see <code className="bg-ink-700/60 px-1 rounded text-xs">LICENSE</code> for notices.</p>
        </div>
      </div>

      <div className="card p-5 space-y-2">
        <h3 className="font-semibold">Credits</h3>
        <p className="text-sm text-slate-400">
          Created and maintained by <b className="text-slate-300">Himanshu Rai</b>.
        </p>
        <button
          className="text-xs text-aurora-300 hover:underline w-fit"
          onClick={() => api.openUrl("https://github.com/rai-himanshu07").catch(() => {})}
        >
          github.com/rai-himanshu07 ↗
        </button>
      </div>
    </div>
  );
}

function DiagRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-3 items-start">
      <span className="text-slate-600 shrink-0 w-32 text-right">{label}</span>
      <span className="text-slate-300 break-all">{value}</span>
    </div>
  );
}
