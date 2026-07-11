import { useEffect, useState } from "react";
import { LifetimeStats, api } from "../lib/api";
import { useStore } from "../store";
import { fmtBytes, fmtSpeed } from "../lib/format";
import { useDialogFocus } from "../lib/useDialogFocus";

const CAT_LABEL: Record<string, string> = {
  video: "Video", audio: "Audio", image: "Images", doc: "Documents",
  archive: "Archives", torrent: "Torrents", other: "Other",
};
const CAT_COLOR: Record<string, string> = {
  video: "bg-magenta-500", audio: "bg-aurora-500", image: "bg-lime-500", doc: "bg-amber-500",
  archive: "bg-orange-500", torrent: "bg-violet-500", other: "bg-slate-500",
};

function categoryKey(category: string): string {
  const key = category.toLowerCase();
  return ({ images: "image", documents: "doc", archives: "archive", torrents: "torrent" } as Record<string, string>)[key] || key;
}

export default function StatsView() {
  const tasks = useStore((s) => s.tasks);
  const stat = useStore((s) => s.stat);
  const [lifetime, setLifetime] = useState<LifetimeStats | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const resetDialogRef = useDialogFocus<HTMLDivElement>(() => setConfirmReset(false), confirmReset);

  const active = tasks.filter((t) => t.status === "active");

  useEffect(() => {
    let live = true;
    const load = () => api.lifetimeStats().then((value) => { if (live) setLifetime(value); }).catch(() => {});
    load();
    const timer = window.setInterval(load, 2000);
    return () => { live = false; window.clearInterval(timer); };
  }, []);

  const cats = lifetime?.byCategory || [];
  const maxBytes = Math.max(1, ...cats.map((v) => v.bytes));

  const cards = [
    { label: "Completed", value: (lifetime?.completedCount || 0).toLocaleString(), sub: "all time" },
    { label: "Data downloaded", value: fmtBytes(lifetime?.completedBytes || 0), sub: "all time" },
    { label: "Active now", value: active.length.toLocaleString(), sub: fmtSpeed(stat?.downloadSpeed) },
    { label: "Last 7 days", value: (lifetime?.last7Count || 0).toLocaleString(), sub: fmtBytes(lifetime?.last7Bytes || 0) },
  ];

  async function resetStats() {
    setResetting(true);
    try {
      setLifetime(await api.resetLifetimeStats());
      setConfirmReset(false);
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="max-w-3xl space-y-4">
      <div className="flex items-end gap-4 border-b border-white/10 pb-3">
        <div>
          <div className="text-[10px] font-mono uppercase text-slate-600">Transfer record</div>
          <h2 className="mt-1 text-lg font-semibold text-white">Lifetime statistics</h2>
        </div>
        <button className="btn-ghost !py-1.5 ml-auto text-xs" onClick={() => setConfirmReset(true)}>Reset stats…</button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {cards.map((c) => (
          <div key={c.label} className="card p-4">
            <div className="text-xs text-slate-500">{c.label}</div>
            <div className="text-2xl font-semibold text-white mt-1 tabular-nums">{c.value}</div>
            <div className="text-[11px] text-slate-500 mt-0.5">{c.sub}</div>
          </div>
        ))}
      </div>

      <div className="card p-5">
        <h3 className="font-semibold mb-3">By category</h3>
        {cats.length === 0 ? (
          <div className="text-sm text-slate-500">No completed downloads yet.</div>
        ) : (
          <div className="space-y-2.5">
            {cats.map((v) => {
              const key = categoryKey(v.category);
              return <div key={v.category}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-slate-300">{CAT_LABEL[key] || v.category}</span>
                  <span className="text-slate-500 tabular-nums">{v.count} · {fmtBytes(v.bytes)}</span>
                </div>
                <div className="dm-progress-track h-2 overflow-hidden">
                  <div className={`h-full ${CAT_COLOR[key] || "bg-slate-500"}`} style={{ width: `${(v.bytes / maxBytes) * 100}%` }} />
                </div>
              </div>;
            })}
          </div>
        )}
      </div>

      <p className="text-[11px] text-slate-600">Lifetime totals remain when download rows or kept history are cleared.</p>

      {confirmReset && (
        <div className="fixed inset-0 z-[80] grid place-items-center bg-black/60" role="dialog" aria-modal="true" aria-labelledby="reset-stats-title" onClick={() => setConfirmReset(false)}>
          <div ref={resetDialogRef} tabIndex={-1} className="card w-[440px] max-w-[92vw] p-6" onClick={(e) => e.stopPropagation()}>
            <h2 id="reset-stats-title" className="text-lg font-semibold">Reset lifetime statistics?</h2>
            <p className="mt-2 text-sm text-slate-400">This resets the counters and category totals only. It does not remove downloads, files, or history.</p>
            <div className="flex justify-end gap-2 mt-5">
              <button className="btn-ghost" disabled={resetting} onClick={() => setConfirmReset(false)}>Cancel</button>
              <button data-dialog-autofocus className="btn-danger" disabled={resetting} onClick={resetStats}>{resetting ? "Resetting…" : "Reset stats"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
