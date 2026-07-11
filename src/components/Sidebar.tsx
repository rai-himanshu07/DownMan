import { type ReactElement, useState } from "react";
import clsx from "clsx";
import { useStore, View } from "../store";
import { api } from "../lib/api";
import { I } from "./icons";

const items: { id: View; label: string; Icon: (p: { className?: string }) => ReactElement }[] = [
  { id: "all", label: "All downloads", Icon: I.All },
  { id: "active", label: "Active", Icon: I.Active },
  { id: "unfinished", label: "Unfinished", Icon: I.Unfinished },
  { id: "completed", label: "Completed", Icon: I.Done },
  { id: "media", label: "Media", Icon: I.Media },
  { id: "stats", label: "Stats", Icon: I.Gauge },
];

export default function Sidebar() {
  const { view, setView, connected, categories, categoryFilter, selectCategory, queues, queueFilter, selectQueue } = useStore();
  const [catsOpen, setCatsOpen] = useState(() => localStorage.getItem("dm-cats-open") === "1");
  return (
    <aside className="relative z-10 w-60 shrink-0 h-full flex flex-col px-3 py-3 gap-1 border-r border-white/10 bg-ink-900/90 overflow-y-auto">
      <div className="mx-1 mb-3 pb-3 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="relative w-10 h-10 shrink-0 border border-white/15 bg-ink-800 p-1">
            <img src="/downman.png" alt="DownMan" className="w-full h-full object-cover" />
            <span className="absolute -right-px -bottom-px w-2.5 h-2.5 bg-aurora-400 border-2 border-ink-900" />
          </div>
          <div className="min-w-0">
            <div className="font-mono font-semibold text-[15px] leading-4 text-white">DOWN/MAN</div>
            <div className="mt-1 text-[9px] font-mono text-slate-500 uppercase">Transfer console</div>
          </div>
        </div>
        <div className="flex items-center gap-2 mt-3 text-[10px] font-mono uppercase">
          <span className={clsx("w-1.5 h-1.5", connected ? "bg-lime-400" : "bg-rose-500")} />
          <span className="text-slate-500">aria2 link</span>
          <span className={clsx("ml-auto", connected ? "text-lime-400" : "text-rose-400")}>{connected ? "online" : "syncing"}</span>
        </div>
      </div>
      {items.map(({ id, label, Icon }) => (
        <button type="button" key={id} className={clsx("nav-item w-full text-left", view === id && !categoryFilter && "active")} onClick={() => setView(id)}>
          <Icon className="w-[18px] h-[18px]" />
          {label}
        </button>
      ))}

      {categories.length > 0 && (
        <>
          <button
            className="w-full flex items-center gap-1.5 px-3 pt-4 pb-1 text-[10px] font-mono uppercase text-slate-600 hover:text-slate-400 transition-colors"
            onClick={() => setCatsOpen((o) => { const n = !o; localStorage.setItem("dm-cats-open", n ? "1" : "0"); return n; })}
          >
            <I.Down className={clsx("w-3 h-3 transition-transform", !catsOpen && "-rotate-90")} />
            <span className="flex-1 text-left">Categories</span>
          </button>
          {catsOpen && categories.map((c) => (
            <button type="button"
              key={c.name}
              className={clsx("nav-item !py-1.5 w-full text-left", categoryFilter === c.name && "active")}
              onClick={() => selectCategory(c.name)}
            >
              <I.Folder className="w-[16px] h-[16px]" />
              {c.name}
            </button>
          ))}
        </>
      )}

      {queues.length > 0 && (
        <>
          <div className="px-3 pt-4 pb-1 text-[10px] font-mono uppercase text-slate-600">Queues</div>
          {queues.map((q) => (
            <div
              key={q.id}
              className={clsx("nav-item !py-0 !pr-1", queueFilter === q.id && "active")}
            >
              <button type="button" className="flex flex-1 min-w-0 items-center gap-3 py-1.5 text-left" onClick={() => selectQueue(q.id)}>
                <I.Queue className="w-[16px] h-[16px]" />
                <span className="flex-1 truncate">{q.name}</span>
              </button>
              <button
                type="button"
                className={clsx("shrink-0", q.running ? "text-lime-400 hover:text-lime-300" : "text-slate-500 hover:text-slate-300")}
                aria-label={q.running ? `Stop ${q.name} queue` : `Start ${q.name} queue`}
                title={q.running ? "Stop queue" : "Start queue"}
                onClick={(e) => { e.stopPropagation(); api.setQueueRunning(q.id, !q.running).catch(() => {}); }}
              >
                {q.running ? <I.Pause className="w-3.5 h-3.5" /> : <I.Play className="w-3.5 h-3.5" />}
              </button>
            </div>
          ))}
        </>
      )}

      <div className="px-3 pt-4 pb-1 text-[10px] font-mono uppercase text-slate-600">Torrent</div>
      <button type="button" className={clsx("nav-item w-full text-left", view === "torrents" && "active")} onClick={() => setView("torrents")}>
        <I.Torrent className="w-[18px] h-[18px]" />
        Torrents
      </button>
      <div className="px-3 pt-4 pb-1 text-[10px] font-mono uppercase text-slate-600">SiteGrabs</div>
      <button type="button" className={clsx("nav-item w-full text-left", view === "sitegrab" && "active")} onClick={() => setView("sitegrab")}>
        <I.Globe className="w-[18px] h-[18px]" />
        Site Grabs
      </button>
      <div className="flex-1" />
      <div className="mx-2 mb-2 border-t border-white/10" />
      <button type="button" className={clsx("nav-item w-full text-left", view === "about" && "active")} onClick={() => setView("about" as typeof view)}>
        <I.Logo className="w-[18px] h-[18px]" />
        About &amp; diagnostics
      </button>
    </aside>
  );
}
