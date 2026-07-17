import { useEffect, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { api, ArchiveStatus } from "../lib/api";

export default function LibrarySettings() {
  const [status, setStatus] = useState<ArchiveStatus | null>(null);
  const [message, setMessage] = useState("");

  function refresh() {
    api.extractorArchiveStatus().then(setStatus).catch((error) => setMessage(String(error)));
  }

  useEffect(refresh, []);

  async function exportArchive() {
    const path = await save({
      defaultPath: "downman-archive.txt",
      filters: [{ name: "yt-dlp archive", extensions: ["txt"] }],
    });
    if (!path) return;
    try {
      const count = await api.extractorArchiveExport(path);
      setMessage(`Exported ${count} archive ${count === 1 ? "entry" : "entries"}`);
    } catch (error) {
      setMessage(String(error));
    }
  }

  async function exportM3u() {
    const path = await save({
      defaultPath: "downman-library.m3u8",
      filters: [{ name: "M3U playlist", extensions: ["m3u8", "m3u"] }],
    });
    if (!path) return;
    try {
      const count = await api.archiveExportM3u(path);
      setMessage(`Exported ${count} media ${count === 1 ? "item" : "items"}`);
    } catch (error) {
      setMessage(String(error));
    }
  }

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4 items-start">
          <div>
            <h3 className="font-semibold">Media archive</h3>
            <p className="mt-1 text-sm text-slate-500">Completed collection downloads are identified by extractor and media ID. Re-inspecting the same playlist marks them archived and leaves them unselected.</p>
          </div>
          <div className="min-w-40 border-l border-white/10 pl-4">
            <div className="text-2xl font-mono text-white">{status?.count ?? "-"}</div>
            <div className="text-[10px] font-mono uppercase text-slate-600">completed identities</div>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button className="btn-primary" onClick={exportArchive}>Export yt-dlp archive</button>
          <button className="btn-ghost" onClick={exportM3u}>Export M3U</button>
          <button className="btn-ghost" onClick={refresh}>Refresh</button>
        </div>
        {status?.latestCompletedAt ? <div className="mt-3 text-xs text-slate-600">Latest archived completion: {new Date(status.latestCompletedAt).toLocaleString()}</div> : null}
        {message && <div className="mt-2 text-xs text-slate-500 break-words">{message}</div>}
      </div>
    </div>
  );
}
