import clsx from "clsx";
import { useStore } from "../store";
import { fmtSpeed } from "../lib/format";
import { api } from "../lib/api";
import { I } from "./icons";

export default function TopBar({ onAdd, onGrab }: { onAdd: () => void; onGrab: () => void }) {
  const { query, setQuery, stat, listMode, setListMode, view, setView } = useStore();
  return (
    <header className="h-16 shrink-0 flex items-center gap-4 px-6 border-b border-white/5">
      <div className="relative flex-1 max-w-md">
        <I.Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
        <input
          id="dm-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name or URL…  ( / )"
          className="w-full bg-ink-800/60 border border-white/5 rounded-lg pl-9 pr-3 py-2 text-sm
            placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-aurora-500/50"
        />
      </div>
      <div className="ml-auto flex items-center gap-4 text-sm">
        <div className="flex items-center gap-1.5 text-aurora-300">
          <span className="text-slate-500">↓</span>
          {fmtSpeed(stat?.downloadSpeed)}
        </div>
        <div className="flex items-center gap-1.5 text-magenta-400">
          <span className="text-slate-500">↑</span>
          {fmtSpeed(stat?.uploadSpeed)}
        </div>
        <div className="flex items-center rounded-lg border border-white/5 overflow-hidden">
          <button className={clsx("p-2", listMode === "table" ? "bg-white/10 text-aurora-300" : "text-slate-500 hover:text-slate-300")} title="Table view" onClick={() => setListMode("table")}>
            <I.Table className="w-4 h-4" />
          </button>
          <button className={clsx("p-2", listMode === "cards" ? "bg-white/10 text-aurora-300" : "text-slate-500 hover:text-slate-300")} title="Card view" onClick={() => setListMode("cards")}>
            <I.Grid className="w-4 h-4" />
          </button>
        </div>
        <button className="btn-ghost" title="Pause all" onClick={() => api.pauseAll()}>
          <I.Pause className="w-4 h-4" />
        </button>
        <button className="btn-ghost" title="Resume all" onClick={() => api.resumeAll()}>
          <I.Play className="w-4 h-4" />
        </button>
        <button className="btn-ghost" title="Grab site" onClick={onGrab}>
          <I.Globe className="w-4 h-4" />
        </button>
        <button className="btn-primary" onClick={onAdd}>
          <I.Plus className="w-4 h-4" /> New
        </button>
        <button className={clsx("btn-ghost", view === "settings" && "text-aurora-300")} title="Settings" onClick={() => setView(view === "settings" ? "all" : "settings")}>
          <I.Gear className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
}
