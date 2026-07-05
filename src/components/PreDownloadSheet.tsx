import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../lib/api";
import { useStore } from "../store";
import { I } from "./icons";

interface PreDownloadProps {
  url: string;
  suggestedName: string;
  onConfirm: (opts: { name: string; dir: string; checksum: string; queueId: string; paused: boolean }) => void;
  onCancel: () => void;
}

/** Pre-download properties sheet — shown before committing a single direct download.
 *  Lets the user review and adjust name, folder, queue, checksum before the file starts. */
export default function PreDownloadSheet({ url, suggestedName, onConfirm, onCancel }: PreDownloadProps) {
  const queues = useStore((s) => s.queues);
  const [name, setName] = useState(suggestedName);
  const [dir, setDir] = useState("");
  const [checksum, setChecksum] = useState("");
  const [queueId, setQueueId] = useState(queues[0]?.id || "");
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    api.info().then((i) => setDir(i.dir)).catch(() => {});
  }, []);

  async function pickDir() {
    const d = await api.pickFolder().catch(() => null);
    if (d) setDir(d);
  }

  function confirm() {
    onConfirm({ name: name.trim() || suggestedName, dir, checksum, queueId, paused });
  }

  return createPortal(
    <div className="fixed inset-0 z-[80] grid place-items-center bg-black/60 backdrop-blur-sm animate-fade-up" onClick={onCancel}>
      <div className="card w-[520px] max-w-[95vw] p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold mb-1">Download properties</h3>
        <p className="text-xs text-slate-500 mb-4 truncate" title={url}>{url}</p>

        <div className="space-y-3">
          <Row label="File name">
            <input value={name} onChange={(e) => setName(e.target.value)}
              className="flex-1 bg-ink-900/60 border border-white/5 rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-aurora-500/50" />
          </Row>

          <Row label="Save to">
            <input value={dir} readOnly
              className="flex-1 bg-ink-900/60 border border-white/5 rounded-lg px-3 py-1.5 text-sm text-slate-400 cursor-default" />
            <button className="btn-ghost !py-1 !px-2.5 text-xs shrink-0" onClick={pickDir}>
              <I.Folder className="w-4 h-4" />
            </button>
          </Row>

          {queues.length > 1 && (
            <Row label="Queue">
              <div className="relative flex-1">
                <select value={queueId} onChange={(e) => setQueueId(e.target.value)}
                  className="w-full appearance-none bg-ink-900/60 border border-white/5 rounded-lg pl-3 pr-8 py-1.5 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-aurora-500/50">
                  {queues.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
                </select>
                <I.Down className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              </div>
            </Row>
          )}

          <Row label="Checksum">
            <input value={checksum} onChange={(e) => setChecksum(e.target.value)}
              placeholder="sha-256=… (optional, verified after download)"
              className="flex-1 bg-ink-900/60 border border-white/5 rounded-lg px-3 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-aurora-500/50" />
          </Row>

          <label className="flex items-center gap-2 text-sm text-slate-400">
            <input type="checkbox" checked={paused} onChange={(e) => setPaused(e.target.checked)} />
            Add paused (start manually)
          </label>
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button className="btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn-primary" onClick={confirm}>
            <I.Plus className="w-4 h-4" /> Start download
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-slate-500 w-20 shrink-0 text-right">{label}</span>
      <div className="flex-1 flex items-center gap-2 min-w-0">{children}</div>
    </div>
  );
}
