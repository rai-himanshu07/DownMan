import { Fragment, useMemo, useState } from "react";
import clsx from "clsx";
import { Aria2Task, CategoryDef, api } from "../lib/api";
import { fmtBytes, fmtSpeed, eta } from "../lib/format";
import { useStore, metaOf, categoryNameOf, queueOf, taskUrl } from "../store";
import { I } from "./icons";
import { RowMenu, DetailsPanel, VerifyBadge, MissingBadge, RetryBadge } from "./downloadShared";

type SortKey = "name" | "size" | "status" | "speed" | "eta" | "category";

function sortVal(t: Aria2Task, key: SortKey, cats: CategoryDef[]): string | number {
  const { name } = metaOf(t);
  const total = +t.totalLength || 0;
  const done = +t.completedLength || 0;
  const speed = +t.downloadSpeed || 0;
  switch (key) {
    case "name": return name.toLowerCase();
    case "size": return total;
    case "status": return total ? done / total : 0;
    case "speed": return speed;
    case "eta": return speed > 0 ? (total - done) / speed : t.status === "complete" ? -1 : Infinity;
    case "category": return categoryNameOf(name, cats).toLowerCase();
    default: return 0;
  }
}

function statusLabel(t: Aria2Task, pct: number): string {
  switch (t.status) {
    case "active": return `${pct.toFixed(0)}%`;
    case "complete": return "Done";
    case "paused": return "Paused";
    case "waiting": return "Queued";
    case "error": return "Error";
    default: return t.status;
  }
}

export default function DownloadTable({ rows }: { rows: Aria2Task[] }) {
  const categories = useStore((s) => s.categories);
  const queues = useStore((s) => s.queues);
  const queueMap = useStore((s) => s.queueMap);
  const selected = useStore((s) => s.selected);
  const toggleSelected = useStore((s) => s.toggleSelected);
  const setSelected = useStore((s) => s.setSelected);
  const [sortKey, setSortKey] = useState<SortKey>(() => (localStorage.getItem("dm-sortkey") as SortKey) || "name");
  const [dir, setDir] = useState<1 | -1>(() => (localStorage.getItem("dm-sortdir") === "-1" ? -1 : 1));
  const [open, setOpen] = useState<string | null>(null);

  const sorted = useMemo(() => {
    const a = [...rows];
    a.sort((x, y) => {
      const vx = sortVal(x, sortKey, categories);
      const vy = sortVal(y, sortKey, categories);
      if (typeof vx === "string" && typeof vy === "string") return vx.localeCompare(vy) * dir;
      return ((vx as number) - (vy as number)) * dir;
    });
    return a;
  }, [rows, sortKey, dir, categories]);

  function sort(k: SortKey) {
    if (k === sortKey) {
      setDir((d) => { const nd: 1 | -1 = d === 1 ? -1 : 1; localStorage.setItem("dm-sortdir", String(nd)); return nd; });
    } else {
      setSortKey(k); setDir(1);
      localStorage.setItem("dm-sortkey", k);
      localStorage.setItem("dm-sortdir", "1");
    }
  }

  const allSelected = rows.length > 0 && rows.every((t) => selected.has(t.gid));

  const cols: { k: SortKey; label: string; cls?: string }[] = [
    { k: "name", label: "Name", cls: "w-full" },
    { k: "size", label: "Size" },
    { k: "status", label: "Status" },
    { k: "speed", label: "Speed" },
    { k: "eta", label: "Time left" },
    { k: "category", label: "Category" },
  ];

  return (
    <div className="card p-0 overflow-x-auto">
      <table className="w-full text-sm min-w-[680px]">
        <thead className="text-xs text-slate-500 border-b border-white/5">
          <tr>
            <th className="px-3 py-2 w-8">
              <input type="checkbox" checked={allSelected} onChange={() => setSelected(allSelected ? [] : rows.map((t) => t.gid))} />
            </th>
            {cols.map((c) => (
              <th
                key={c.k}
                onClick={() => sort(c.k)}
                className={clsx("px-3 py-2 text-left font-medium cursor-pointer select-none hover:text-slate-300 whitespace-nowrap", c.cls)}
              >
                {c.label}
                {sortKey === c.k && <span className="ml-1 text-aurora-300">{dir === 1 ? "▲" : "▼"}</span>}
              </th>
            ))}
            <th className="px-3 py-2 text-left font-medium whitespace-nowrap">Queue</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((t) => {
            const { name } = metaOf(t);
            const total = +t.totalLength || 0;
            const done = +t.completedLength || 0;
            const speed = +t.downloadSpeed || 0;
            const pct = total ? Math.min(100, (done / total) * 100) : 0;
            const active = t.status === "active";
            const completed = t.status === "complete";
            const canControl = !t.gid.startsWith("site-") && !completed && t.status !== "error";
            const isTorrent = !!t.bittorrent;
            const canExpand = canControl || isTorrent;
            const expanded = open === t.gid;
            return (
              <Fragment key={t.gid}>
                <tr
                  className={clsx("border-b border-white/5 hover:bg-white/[0.03] transition-colors", (expanded || selected.has(t.gid)) && "bg-white/[0.03]")}
                  onContextMenu={(e) => { if ((e.target as HTMLElement).closest("input, textarea, select, [contenteditable='true']")) return; e.preventDefault(); window.dispatchEvent(new CustomEvent("dm-context", { detail: { gid: t.gid, x: e.clientX, y: e.clientY } })); }}
                >
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(t.gid)} onChange={() => toggleSelected(t.gid)} />
                  </td>
                  <td className="px-3 py-2 max-w-0">
                    {canExpand ? (
                      <button className="flex items-center gap-2 w-full min-w-0 text-left" onClick={() => setOpen((o) => (o === t.gid ? null : t.gid))}>
                        <I.Down className={clsx("w-3.5 h-3.5 shrink-0 text-slate-500 transition-transform", expanded && "rotate-180")} />
                        <span className="truncate" title={name}>{name}</span>
                      </button>
                    ) : (
                      <span className="truncate block pl-[22px]" title={name}>{name}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-slate-400 tabular-nums">{total ? fmtBytes(total) : "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1.5 rounded-full bg-ink-600 overflow-hidden shrink-0">
                        <div
                          className={clsx("h-full rounded-full", completed ? "bg-lime-500" : t.status === "error" ? "bg-rose-500" : "bg-gradient-to-r from-aurora-500 to-magenta-500")}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-xs text-slate-400 tabular-nums w-12">{statusLabel(t, pct)}</span>
                      {completed && (t.dmMissing ? <MissingBadge /> : <VerifyBadge status={t.dmVerify} />)}
                      {!completed && t.dmRetry ? <RetryBadge n={t.dmRetry} /> : null}
                    </div>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-slate-400 tabular-nums">{active ? fmtSpeed(speed) : "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-slate-400 tabular-nums">{active ? eta(total, done, speed) : "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-slate-400">{categoryNameOf(name, categories)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <select
                      value={queueOf(t, queueMap)}
                      onChange={(e) => api.assignQueue(taskUrl(t), e.target.value).catch(() => {})}
                      onClick={(e) => e.stopPropagation()}
                      className="appearance-none bg-ink-900/60 border border-white/5 rounded px-2 py-1 text-xs text-slate-300 focus:outline-none focus:ring-1 focus:ring-aurora-500/50"
                    >
                      {queues.map((q) => <option key={q.id} value={q.id}>{q.name}</option>)}
                    </select>
                  </td>
                  <td className="px-3 py-2 w-px whitespace-nowrap">
                    <div className="flex justify-end">
                      <RowMenu t={t} name={name} category={categoryNameOf(name, categories)} total={total} detailsOpen={expanded} onToggleDetails={() => setOpen((o) => (o === t.gid ? null : t.gid))} />
                    </div>
                  </td>
                </tr>
                {expanded && (
                  <tr>
                    <td colSpan={9} className="p-3 bg-ink-900/40 border-b border-white/5">
                      <DetailsPanel t={t} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
