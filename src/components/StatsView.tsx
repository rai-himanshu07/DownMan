import { useStore, metaOf } from "../store";
import { fmtBytes, fmtSpeed } from "../lib/format";

const CAT_LABEL: Record<string, string> = {
  video: "Video", audio: "Audio", image: "Images", doc: "Documents",
  archive: "Archives", torrent: "Torrents", other: "Other",
};
const CAT_COLOR: Record<string, string> = {
  video: "bg-magenta-500", audio: "bg-aurora-500", image: "bg-lime-500", doc: "bg-amber-500",
  archive: "bg-orange-500", torrent: "bg-violet-500", other: "bg-slate-500",
};

export default function StatsView() {
  const tasks = useStore((s) => s.tasks);
  const stat = useStore((s) => s.stat);

  const completed = tasks.filter((t) => t.status === "complete");
  const errored = tasks.filter((t) => t.status === "error");
  const active = tasks.filter((t) => t.status === "active");
  const totalBytes = completed.reduce((a, t) => a + (+t.totalLength || 0), 0);
  const finished = completed.length + errored.length;
  const successRate = finished ? Math.round((completed.length / finished) * 100) : 100;

  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
  const last7 = completed.filter((t) => +(t.completedAt || 0) >= weekAgo);
  const last7Bytes = last7.reduce((a, t) => a + (+t.totalLength || 0), 0);

  const byCat = new Map<string, { count: number; bytes: number }>();
  for (const t of completed) {
    const c = metaOf(t).category;
    const e = byCat.get(c) || { count: 0, bytes: 0 };
    e.count += 1;
    e.bytes += +t.totalLength || 0;
    byCat.set(c, e);
  }
  const cats = [...byCat.entries()].sort((a, b) => b[1].bytes - a[1].bytes);
  const maxBytes = Math.max(1, ...cats.map(([, v]) => v.bytes));

  const cards = [
    { label: "Completed", value: completed.length.toLocaleString(), sub: `${fmtBytes(totalBytes)} total` },
    { label: "Success rate", value: `${successRate}%`, sub: `${errored.length} failed` },
    { label: "Active now", value: active.length.toLocaleString(), sub: fmtSpeed(stat?.downloadSpeed) },
    { label: "Last 7 days", value: last7.length.toLocaleString(), sub: fmtBytes(last7Bytes) },
  ];

  return (
    <div className="max-w-3xl space-y-4">
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
            {cats.map(([c, v]) => (
              <div key={c}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-slate-300">{CAT_LABEL[c] || c}</span>
                  <span className="text-slate-500 tabular-nums">{v.count} · {fmtBytes(v.bytes)}</span>
                </div>
                <div className="h-2 rounded-full bg-ink-600 overflow-hidden">
                  <div className={`h-full rounded-full ${CAT_COLOR[c] || "bg-slate-500"}`} style={{ width: `${(v.bytes / maxBytes) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="text-[11px] text-slate-600">Based on your kept history (adjust retention in Settings → History).</p>
    </div>
  );
}
