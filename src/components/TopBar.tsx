import clsx from "clsx";
import { useStore } from "../store";
import { fmtSpeed } from "../lib/format";
import { api } from "../lib/api";
import { I } from "./icons";

export default function TopBar({ onAdd, onGrab }: { onAdd: () => void; onGrab: () => void }) {
  const { query, setQuery, stat, listMode, setListMode, view, setView } = useStore();
  const viewLabel = view === "sitegrab" ? "Site grabs" : view === "torrents" ? "Torrents" : view === "about" ? "Diagnostics" : view[0].toUpperCase() + view.slice(1);
  return (
    <header className="h-16 shrink-0 flex items-center gap-3 px-4 border-b border-white/10 bg-ink-900/85">
      <div className="hidden xl:block w-24 shrink-0">
        <div className="text-[9px] font-mono uppercase text-slate-600">Queue view</div>
        <div className="text-xs font-mono text-slate-300 truncate">{viewLabel}</div>
      </div>
      <div className="relative flex-1 min-w-[150px] max-w-md">
        <I.Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
        <input
          id="dm-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name or URL…  ( / )"
          className="w-full bg-ink-800 border border-white/10 rounded-sm pl-9 pr-3 py-2 text-sm
            placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-aurora-500/50"
        />
      </div>
      <div className="ml-auto flex items-center gap-2 text-sm">
        <div className="hidden lg:flex items-stretch h-9 border border-white/10 bg-ink-800">
          <div className="flex flex-col justify-center px-2.5 border-r border-white/10 min-w-[76px]">
            <span className="text-[8px] font-mono text-slate-600 uppercase">down</span>
            <span className="text-[11px] font-mono text-aurora-300 tabular-nums">{fmtSpeed(stat?.downloadSpeed)}</span>
          </div>
          <div className="flex flex-col justify-center px-2.5 min-w-[76px]">
            <span className="text-[8px] font-mono text-slate-600 uppercase">up</span>
            <span className="text-[11px] font-mono text-magenta-400 tabular-nums">{fmtSpeed(stat?.uploadSpeed)}</span>
          </div>
        </div>
        <div className="flex items-center border border-white/10 overflow-hidden">
          <button className={clsx("p-2", listMode === "table" ? "bg-white/10 text-aurora-300" : "text-slate-500 hover:text-slate-300")} title="Table view" onClick={() => setListMode("table")}>
            <I.Table className="w-4 h-4" />
          </button>
          <button className={clsx("p-2", listMode === "cards" ? "bg-white/10 text-aurora-300" : "text-slate-500 hover:text-slate-300")} title="Card view" onClick={() => setListMode("cards")}>
            <I.Grid className="w-4 h-4" />
          </button>
        </div>
        <button className="btn-ghost !p-2" title="Pause all" onClick={() => api.pauseAll()}>
          <I.Pause className="w-4 h-4" />
        </button>
        <button className="btn-ghost !p-2" title="Resume all" onClick={() => api.resumeAll()}>
          <I.Play className="w-4 h-4" />
        </button>
        <button className="btn-ghost !p-2" title="Grab site" onClick={onGrab}>
          <I.Globe className="w-4 h-4" />
        </button>
        <button className="btn-primary" onClick={onAdd}>
          <I.Plus className="w-4 h-4" /> New
        </button>
        <button className={clsx("btn-ghost !p-2", view === "settings" && "text-aurora-300")} title="Settings" onClick={() => setView(view === "settings" ? "all" : "settings")}>
          <I.Gear className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
}
