import { Fragment, useMemo, useState } from "react";
import clsx from "clsx";
import { Aria2Task, CategoryDef } from "../lib/api";
import { fmtBytes, fmtSpeed, fmtEta, eta } from "../lib/format";
import { useStore, metaOf, categoryNameOf } from "../store";
import { I } from "./icons";
import { RowMenu, DetailsPanel, VerifyBadge, MissingBadge, RetryBadge } from "./downloadShared";

type SortKey = "name" | "size" | "status" | "datetime" | "category";

function sortVal(t: Aria2Task, key: SortKey, cats: CategoryDef[]): string | number {
  const { name } = metaOf(t);
  const total = +t.totalLength || 0;
  const done = +t.completedLength || 0;
  switch (key) {
    case "name": return name.toLowerCase();
    case "size": return total;
    case "status": return total ? done / total : 0;
    case "datetime": return t.completedAt || t.addedAt || 0;
    case "category": return categoryNameOf(name, cats).toLowerCase();
    default: return 0;
  }
}

function taskDate(t: Aria2Task): string {
  const timestamp = t.completedAt || t.addedAt;
  if (!timestamp) return "—";
  return new Date(timestamp).toLocaleString([], {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusLabel(t: Aria2Task, pct: number, determinate: boolean, estimated: boolean): string {
  switch (t.status) {
    case "active": return determinate ? `${estimated ? "~" : ""}${pct.toFixed(0)}%` : "Downloading";
    case "complete": return "Done";
    case "paused": return "Paused";
    case "waiting": return "Queued";
    case "error": return "Error";
    default: return t.status;
  }
}

export default function DownloadTable({ rows }: { rows: Aria2Task[] }) {
  const categories = useStore((s) => s.categories);
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
    { k: "datetime", label: "Date/time" },
    { k: "category", label: "Category" },
  ];

  return (
    <div className="card p-0 overflow-x-auto">
      <table className="w-full text-sm min-w-[700px] table-fixed">
        <colgroup>
          <col className="w-9" />
          <col />
          <col className="w-20" />
          <col className="w-36" />
          <col className="w-36" />
          <col className="w-24" />
          <col className="w-24" />
        </colgroup>
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
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((t) => {
            const { name } = metaOf(t);
            const total = +t.totalLength || 0;
            const done = +t.completedLength || 0;
            const speed = +t.downloadSpeed || 0;
            const mediaElapsed = +t.dmElapsedSeconds! || 0;
            const mediaDuration = +t.dmDurationSeconds! || 0;
            const completed = t.status === "complete";
            const totalEstimated = !!t.dmTotalEstimated && !completed;
            const determinate = total > 0 || mediaDuration > 0;
            const pct = total
              ? Math.min(100, (done / total) * 100)
              : mediaDuration
                ? Math.min(100, (mediaElapsed / mediaDuration) * 100)
                : 0;
            const active = t.status === "active";
            const canControl = !t.gid.startsWith("site-") && !completed && t.status !== "error";
            const isTorrent = !!t.bittorrent;
            const canExpand = canControl || isTorrent;
            const expanded = open === t.gid;
            const activeDetail = total
              ? `${fmtSpeed(speed)} · ${totalEstimated ? "~" : ""}${eta(total, done, speed)}`
              : [speed > 0 ? fmtSpeed(speed) : "", mediaElapsed > 0 ? fmtEta(mediaElapsed) : "", t.dmProcessingSpeed || ""]
                .filter(Boolean)
                .join(" · ") || "Starting…";
            return (
              <Fragment key={t.gid}>
                <tr
                  className={clsx("border-b border-white/5 hover:bg-white/[0.03] transition-colors", (expanded || selected.has(t.gid)) && "bg-white/[0.03]")}
                  onContextMenu={(e) => { if ((e.target as HTMLElement).closest("input, textarea, select, [contenteditable='true']")) return; e.preventDefault(); window.dispatchEvent(new CustomEvent("dm-context", { detail: { gid: t.gid, x: e.clientX, y: e.clientY } })); }}
                >
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(t.gid)} onChange={() => toggleSelected(t.gid)} />
                  </td>
                  <td className="px-3 py-2 min-w-0">
                    {canExpand ? (
                      <button className="flex items-center gap-2 w-full min-w-0 text-left" onClick={() => setOpen((o) => (o === t.gid ? null : t.gid))}>
                        <I.Down className={clsx("w-3.5 h-3.5 shrink-0 text-slate-500 transition-transform", expanded && "rotate-180")} />
                        <span className="truncate" title={name}>{name}</span>
                      </button>
                    ) : (
                      <span className="truncate block pl-[22px]" title={name}>{name}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-slate-400 tabular-nums">{total ? `${totalEstimated ? "~" : ""}${fmtBytes(total)}` : done ? `${fmtBytes(done)}+` : "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <div className="min-w-0">
                      <span className={clsx("text-xs tabular-nums", completed ? "text-lime-400" : t.status === "error" ? "text-rose-400" : t.status === "paused" ? "text-amber-300" : "text-slate-300")}>{statusLabel(t, pct, determinate, totalEstimated)}</span>
                      {active && <div className="mt-0.5 text-[10px] text-slate-500 tabular-nums truncate" title={activeDetail}>{activeDetail}</div>}
                      {completed && (t.dmMissing ? <MissingBadge /> : <VerifyBadge status={t.dmVerify} />)}
                      {!completed && t.dmRetry ? <RetryBadge n={t.dmRetry} /> : null}
                    </div>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-slate-400 tabular-nums" title={(t.completedAt || t.addedAt) ? new Date(t.completedAt || t.addedAt || 0).toLocaleString() : undefined}>
                    {taskDate(t)}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-slate-400">{categoryNameOf(name, categories)}</td>
                  <td className="px-3 py-2 w-px whitespace-nowrap">
                    <div className="flex justify-end">
                      <RowMenu t={t} name={name} category={categoryNameOf(name, categories)} total={total} detailsOpen={expanded} onToggleDetails={() => setOpen((o) => (o === t.gid ? null : t.gid))} />
                    </div>
                  </td>
                </tr>
                {expanded && (
                  <tr>
                    <td colSpan={7} className="p-3 bg-ink-900/40 border-b border-white/5">
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
