import { useState } from "react";
import clsx from "clsx";
import { useStore, View } from "../store";
import { api } from "../lib/api";
import { I } from "./icons";

const items: { id: View; label: string; Icon: (p: { className?: string }) => JSX.Element }[] = [
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
    <aside className="relative z-10 w-60 shrink-0 h-full flex flex-col p-4 gap-1.5 border-r border-white/5 overflow-y-auto">
      <div className="flex items-center gap-2.5 px-2 py-3 mb-2">
        <img src="/downman.png" alt="DownMan" className="w-10 h-10 rounded-xl shadow-glow" />
        <div>
          <div className="font-semibold tracking-tight leading-4 shiny-text">DownMan</div>
          <div className="text-[11px] text-slate-500">aria2 engine</div>
        </div>
      </div>
      <div className="flex items-center gap-2 px-3 pb-2 -mt-1 text-xs text-slate-500">
        <span className={clsx("w-2 h-2 rounded-full", connected ? "bg-lime-400" : "bg-rose-500")} />
        {connected ? "Engine online" : "Connecting…"}
      </div>
      {items.map(({ id, label, Icon }) => (
        <div key={id} className={clsx("nav-item", view === id && !categoryFilter && "active")} onClick={() => setView(id)}>
          <Icon className="w-[18px] h-[18px]" />
          {label}
        </div>
      ))}

      {categories.length > 0 && (
        <>
          <button
            className="w-full flex items-center gap-1.5 px-3 pt-4 pb-1 text-[11px] uppercase tracking-wide text-slate-600 hover:text-slate-400 transition-colors"
            onClick={() => setCatsOpen((o) => { const n = !o; localStorage.setItem("dm-cats-open", n ? "1" : "0"); return n; })}
          >
            <I.Down className={clsx("w-3 h-3 transition-transform", !catsOpen && "-rotate-90")} />
            <span className="flex-1 text-left">Categories</span>
          </button>
          {catsOpen && categories.map((c) => (
            <div
              key={c.name}
              className={clsx("nav-item !py-1.5", categoryFilter === c.name && "active")}
              onClick={() => selectCategory(c.name)}
            >
              <I.Folder className="w-[16px] h-[16px]" />
              {c.name}
            </div>
          ))}
        </>
      )}

      {queues.length > 0 && (
        <>
          <div className="px-3 pt-4 pb-1 text-[11px] uppercase tracking-wide text-slate-600">Queues</div>
          {queues.map((q) => (
            <div
              key={q.id}
              className={clsx("nav-item !py-1.5", queueFilter === q.id && "active")}
              onClick={() => selectQueue(q.id)}
            >
              <I.Queue className="w-[16px] h-[16px]" />
              <span className="flex-1 truncate">{q.name}</span>
              <button
                className={clsx("shrink-0", q.running ? "text-lime-400 hover:text-lime-300" : "text-slate-500 hover:text-slate-300")}
                title={q.running ? "Stop queue" : "Start queue"}
                onClick={(e) => { e.stopPropagation(); api.setQueueRunning(q.id, !q.running).catch(() => {}); }}
              >
                {q.running ? <I.Pause className="w-3.5 h-3.5" /> : <I.Play className="w-3.5 h-3.5" />}
              </button>
            </div>
          ))}
        </>
      )}

      <div className="px-3 pt-4 pb-1 text-[11px] uppercase tracking-wide text-slate-600">Torrent</div>
      <div className={clsx("nav-item", view === "torrents" && "active")} onClick={() => setView("torrents")}>
        <I.Torrent className="w-[18px] h-[18px]" />
        Torrents
      </div>
      <div className="px-3 pt-4 pb-1 text-[11px] uppercase tracking-wide text-slate-600">SiteGrabs</div>
      <div className={clsx("nav-item", view === "sitegrab" && "active")} onClick={() => setView("sitegrab")}>
        <I.Globe className="w-[18px] h-[18px]" />
        Site Grabs
      </div>
      <div className="flex-1" />
      <div className={clsx("nav-item", view === "about" && "active")} onClick={() => setView("about" as typeof view)}>
        <I.Logo className="w-[18px] h-[18px]" />
        About &amp; diagnostics
      </div>
    </aside>
  );
}
