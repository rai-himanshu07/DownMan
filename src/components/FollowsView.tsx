import { useEffect, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { api, DownloadProfile, ReviewPage, SearchPage, Subscription } from "../lib/api";
import { toast } from "../lib/toast";
import { I } from "./icons";

const PAGE_SIZE = 50;

function newSubscription(profileId: string): Subscription {
  const now = Date.now();
  return {
    id: `source-${now.toString(36)}`, name: "New followed source", kind: "channel", sourceUrl: "",
    profileId, pollIntervalMin: 60, enabled: true, action: "review", notify: true,
    includeKeywords: [], excludeKeywords: [], minDurationSec: 0, maxDurationSec: 0,
    contentType: "all", maxItemsPerPoll: 10, livePolicyOverride: "", cookiesBrowser: "", m3uTarget: "",
    running: false, lastRunAt: 0, lastSuccessAt: 0, nextRunAt: 0, lastError: "",
    createdAt: 0, updatedAt: 0,
  };
}

export default function FollowsView() {
  const [tab, setTab] = useState<"sources" | "inbox" | "search">("sources");
  const [profiles, setProfiles] = useState<DownloadProfile[]>([]);
  const [sources, setSources] = useState<Subscription[]>([]);
  const [draft, setDraft] = useState<Subscription | null>(null);
  const [message, setMessage] = useState("");

  function loadSources(preferId?: string) {
    Promise.all([api.subscriptionList(), api.activeDownloadProfile()]).then(([items, active]) => {
      setSources(items);
      const selected = items.find((item) => item.id === (preferId || draft?.id)) || items[0];
      setDraft(selected || newSubscription(active.id));
    }).catch((error) => setMessage(String(error)));
  }

  useEffect(() => {
    api.listDownloadProfiles().then(setProfiles).catch(() => {});
    loadSources();
  }, []);

  async function saveSource() {
    if (!draft) return;
    try {
      const saved = await api.subscriptionUpsert(draft);
      setMessage("Source saved");
      loadSources(saved.id);
    } catch (error) { setMessage(String(error)); }
  }

  async function deleteSource() {
    if (!draft || !sources.some((item) => item.id === draft.id)) return;
    try {
      await api.subscriptionDelete(draft.id);
      setMessage("Source deleted");
      loadSources();
    } catch (error) { setMessage(String(error)); }
  }

  async function runNow() {
    if (!draft) return;
    setMessage("Checking source...");
    try {
      const result = await api.subscriptionRunNow(draft.id);
      setMessage(`${result.reviewed} to review, ${result.autoQueued} auto-downloaded, ${result.archived} already archived`);
      loadSources(draft.id);
    } catch (error) { setMessage(String(error)); }
  }

  async function exportM3u() {
    if (!draft) return;
    const path = await save({ defaultPath: `${draft.id}.m3u8`, filters: [{ name: "M3U playlist", extensions: ["m3u8", "m3u"] }] });
    if (!path) return;
    try { const count = await api.subscriptionExportM3u(draft.id, path); setMessage(`Exported ${count} seen items`); }
    catch (error) { setMessage(String(error)); }
  }

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Follows sections" className="flex items-center border-b border-white/10">
        {(["sources", "inbox", "search"] as const).map((id) => <button key={id} id={`follows-tab-${id}`} role="tab" aria-selected={tab === id} aria-controls={`follows-panel-${id}`} onClick={() => setTab(id)} className={`px-4 py-2 text-xs font-mono uppercase border-b-2 -mb-px ${tab === id ? "border-aurora-400 text-white" : "border-transparent text-slate-500 hover:text-slate-300"}`}>{id === "inbox" ? "Review inbox" : id}</button>)}
      </div>
      <div id={`follows-panel-${tab}`} role="tabpanel" aria-labelledby={`follows-tab-${tab}`} className="space-y-4">
      {tab === "sources" && draft && <div className="grid grid-cols-1 xl:grid-cols-[260px_minmax(0,1fr)] gap-4">
        <div className="card p-3 self-start">
          <div className="flex items-center justify-between px-2 pb-2"><h3 className="font-semibold">Followed sources</h3><button className="btn-ghost !p-1.5" title="Add source" onClick={() => setDraft(newSubscription(profiles[0]?.id || "best"))}><I.Plus className="w-4 h-4" /></button></div>
          <div className="space-y-1">{sources.map((source) => <button key={source.id} onClick={() => setDraft({ ...source })} className={`w-full text-left border px-3 py-2 ${draft.id === source.id ? "border-aurora-400/50 bg-aurora-400/10" : "border-transparent hover:bg-white/5"}`}><div className="flex items-center gap-2 text-sm"><span className={`w-1.5 h-1.5 ${source.running ? "bg-amber-300" : source.enabled ? "bg-lime-400" : "bg-slate-700"}`} /><span className="truncate">{source.name}</span></div><div className="mt-1 text-[10px] font-mono uppercase text-slate-600">{source.kind} · {source.action}</div></button>)}</div>
        </div>
        <div className="space-y-4 min-w-0">
          <div className="card p-5 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="Name"><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} className="control" /></Field>
              <Select label="Source type" value={draft.kind} onChange={(kind) => setDraft({ ...draft, kind: kind as Subscription["kind"] })} options={[["channel", "Channel"], ["playlist", "Playlist"]]} />
              <Field label="Channel or playlist URL"><input value={draft.sourceUrl} onChange={(event) => setDraft({ ...draft, sourceUrl: event.target.value })} className="control font-mono" placeholder="https://www.youtube.com/@channel/videos" /></Field>
              <Select label="Download profile" value={draft.profileId} onChange={(profileId) => setDraft({ ...draft, profileId })} options={(profiles.length ? profiles : [{ id: "best", name: "Best available" } as DownloadProfile]).map((profile) => [profile.id, profile.name])} />
              <Field label="Poll every (minutes, minimum 15)"><input type="number" min="15" max="10080" value={draft.pollIntervalMin} onChange={(event) => setDraft({ ...draft, pollIntervalMin: Number(event.target.value) || 15 })} className="control" /></Field>
              <Select label="New matches" value={draft.action} onChange={(action) => setDraft({ ...draft, action: action as Subscription["action"] })} options={[["review", "Send to review inbox"], ["auto", "Auto-download"]]} />
              <Field label="Maximum matches per poll"><input type="number" min="1" max="25" value={draft.maxItemsPerPoll} onChange={(event) => setDraft({ ...draft, maxItemsPerPoll: Number(event.target.value) || 1 })} className="control" /></Field>
              <Select label="Content" value={draft.contentType} onChange={(contentType) => setDraft({ ...draft, contentType: contentType as Subscription["contentType"] })} options={[["all", "All media"], ["video", "Published videos"], ["live", "Live now"], ["upcoming", "Upcoming"]]} />
              <Field label="Include keywords"><input value={draft.includeKeywords.join(", ")} onChange={(event) => setDraft({ ...draft, includeKeywords: words(event.target.value) })} className="control" placeholder="rust, tutorial" /></Field>
              <Field label="Exclude keywords"><input value={draft.excludeKeywords.join(", ")} onChange={(event) => setDraft({ ...draft, excludeKeywords: words(event.target.value) })} className="control" placeholder="short, trailer" /></Field>
              <Field label="Minimum duration (seconds)"><input type="number" min="0" value={draft.minDurationSec} onChange={(event) => setDraft({ ...draft, minDurationSec: Number(event.target.value) || 0 })} className="control" /></Field>
              <Field label="Maximum duration (0 = any)"><input type="number" min="0" value={draft.maxDurationSec} onChange={(event) => setDraft({ ...draft, maxDurationSec: Number(event.target.value) || 0 })} className="control" /></Field>
              <Select label="Live override" value={draft.livePolicyOverride} onChange={(livePolicyOverride) => setDraft({ ...draft, livePolicyOverride: livePolicyOverride as Subscription["livePolicyOverride"] })} options={[["", "Use profile"], ["skip", "Skip live"], ["from-start", "From start"], ["from-now", "From now"]]} />
              <Select label="Cookies from browser" value={draft.cookiesBrowser} onChange={(cookiesBrowser) => setDraft({ ...draft, cookiesBrowser })} options={[["", "None"], ...["firefox", "chrome", "chromium", "brave", "edge", "vivaldi", "opera"].map((browser) => [browser, browser])]} />
              <Field label="Automatic M3U target"><input value={draft.m3uTarget} onChange={(event) => setDraft({ ...draft, m3uTarget: event.target.value })} className="control font-mono" placeholder="Optional file path" /></Field>
            </div>
            {draft.action === "auto" && <div className="border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">Auto-download bypasses the Review Inbox. Archive identity and the per-poll cap still prevent duplicate storms.</div>}
            <div className="flex flex-wrap gap-3"><label className="flex items-center gap-2 text-sm text-slate-400"><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} />Enabled</label><label className="flex items-center gap-2 text-sm text-slate-400"><input type="checkbox" checked={draft.notify} onChange={(event) => setDraft({ ...draft, notify: event.target.checked })} />Notify on new matches</label></div>
            <div className="flex flex-wrap items-center gap-2"><button className="btn-primary" onClick={saveSource}>Save source</button>{sources.some((item) => item.id === draft.id) && <button className="btn-ghost" disabled={draft.running} onClick={runNow}>Run now</button>}{sources.some((item) => item.id === draft.id) && <button className="btn-ghost" onClick={exportM3u}>Export M3U</button>}{sources.some((item) => item.id === draft.id) && <button className="btn-ghost text-rose-300" onClick={deleteSource}><I.Trash className="w-4 h-4" /> Delete</button>}</div>
            {draft.lastError && <div className="text-xs text-rose-300">{draft.lastError}</div>}{message && <div className="text-xs text-slate-500 break-words">{message}</div>}
          </div>
        </div>
      </div>}
      {tab === "inbox" && <ReviewInbox />}
      {tab === "search" && <MediaSearch profiles={profiles} />}
      </div>
    </div>
  );
}

function ReviewInbox() {
  const [page, setPage] = useState<ReviewPage | null>(null);
  const [status, setStatus] = useState("new");
  const [offset, setOffset] = useState(0);
  const [message, setMessage] = useState("");
  const load = (nextOffset = offset, nextStatus = status) => api.reviewInboxPage(nextOffset, PAGE_SIZE, nextStatus).then((result) => { setPage(result); setOffset(nextOffset); setStatus(nextStatus); }).catch((error) => setMessage(String(error)));
  useEffect(() => { load(0, "new"); }, []);
  async function select(id: string, selected: boolean) { if (!page) return; setPage({ ...page, items: page.items.map((item) => item.id === id ? { ...item, selected } : item) }); await api.reviewInboxSelect([id], selected).catch((error) => setMessage(String(error))); }
  async function download() { if (!page) return; try { const ids = page.items.filter((item) => item.selected).map((item) => item.id); const result = await api.reviewInboxDownload(ids); toast.success(`Queued ${result.queued} review item${result.queued === 1 ? "" : "s"}`); load(); } catch (error) { setMessage(String(error)); } }
  async function dismiss() { if (!page) return; const ids = page.items.filter((item) => item.selected).map((item) => item.id); try { await api.reviewInboxDismiss(ids); load(); } catch (error) { setMessage(String(error)); } }
  return <div className="card p-5 space-y-3"><div className="flex flex-wrap items-center gap-2"><div><h3 className="font-semibold">Review inbox</h3><p className="text-xs text-slate-500">New matches wait here unless a source explicitly enables auto-download.</p></div><select value={status} onChange={(event) => load(0, event.target.value)} className="control !w-auto ml-auto"><option value="new">New</option><option value="downloaded">Downloaded</option><option value="dismissed">Dismissed</option><option value="error">Failed</option><option value="all">All</option></select></div><div className="border border-white/10 max-h-[55vh] overflow-auto">{(page?.items || []).map((item) => <label key={item.id} className="grid grid-cols-[28px_64px_minmax(0,1fr)_120px] min-h-16 gap-2 items-center px-3 py-2 border-b border-white/5 hover:bg-white/[0.03]"><input type="checkbox" disabled={item.status !== "new"} checked={item.selected} onChange={(event) => select(item.id, event.target.checked)} /><div className="w-14 h-10 bg-ink-700 overflow-hidden">{item.thumbnail && <img src={item.thumbnail} alt="" className="w-full h-full object-cover" />}</div><div className="min-w-0"><div className="text-sm truncate">{item.title || item.mediaId}</div><div className="text-[11px] text-slate-600 truncate">{item.subscriptionName} · {item.uploader}</div></div><span className="text-[10px] font-mono uppercase text-slate-500">{item.status}</span></label>)}</div><div className="flex flex-wrap items-center gap-2"><button className="btn-primary" disabled={!page?.items.some((item) => item.selected)} onClick={download}>Download selected</button><button className="btn-ghost" disabled={!page?.items.some((item) => item.selected)} onClick={dismiss}>Dismiss selected</button><button className="btn-ghost" onClick={() => api.reviewInboxSelect([], true).then(() => load())}>Select all new</button><span className="ml-auto text-xs text-slate-500">{page?.total || 0} items</span></div>{message && <div className="text-xs text-slate-500">{message}</div>}</div>;
}

function MediaSearch({ profiles }: { profiles: DownloadProfile[] }) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState<SearchPage | null>(null);
  const [offset, setOffset] = useState(0);
  const [profileId, setProfileId] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => { api.activeDownloadProfile().then((profile) => setProfileId(profile.id)).catch(() => {}); }, []);
  useEffect(() => { if (!page || page.session.status !== "loading") return; const timer = window.setTimeout(() => api.ytSearchPage(page.session.id, offset, PAGE_SIZE).then(setPage).catch((error) => setMessage(String(error))), 700); return () => window.clearTimeout(timer); }, [page, offset]);
  async function start() { setMessage(""); try { const session = await api.ytSearchStart(query, PAGE_SIZE, 200, localStorage.getItem("dm-cookies-browser") || undefined); setOffset(0); setPage({ session, items: [], offset: 0, limit: PAGE_SIZE }); } catch (error) { setMessage(String(error)); } }
  async function load(next: number) { if (!page) return; try { setOffset(next); setPage(await api.ytSearchPage(page.session.id, next, PAGE_SIZE)); } catch (error) { setMessage(String(error)); } }
  async function select(index: number, selected: boolean) { if (!page) return; setPage({ ...page, items: page.items.map((item) => item.index === index ? { ...item, selected } : item) }); await api.ytSearchSelect(page.session.id, [index], selected).catch((error) => setMessage(String(error))); }
  async function download() { if (!page) return; try { const result = await api.ytSearchDownload(page.session.id, profileId || undefined); toast.success(`Queued ${result.queued} search result${result.queued === 1 ? "" : "s"}`); } catch (error) { setMessage(String(error)); } }
  return <div className="card p-5 space-y-3"><div className="flex gap-2"><div className="relative flex-1"><I.Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-600" /><input value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => event.key === "Enter" && start()} placeholder="Search YouTube through yt-dlp" className="control pl-9" /></div><button className="btn-primary" disabled={query.trim().length < 2} onClick={start}>Search</button></div>{page && <><div className="text-xs text-slate-500">{page.session.status === "loading" ? `Searching... ${page.session.loadedCount} loaded` : `${page.session.loadedCount} results`}</div><div className="border border-white/10 max-h-[55vh] overflow-auto">{page.items.map((item) => <label key={item.index} className="grid grid-cols-[28px_64px_minmax(0,1fr)_90px] min-h-16 gap-2 items-center px-3 py-2 border-b border-white/5 hover:bg-white/[0.03]"><input type="checkbox" disabled={item.archived} checked={item.selected} onChange={(event) => select(item.index, event.target.checked)} /><div className="w-14 h-10 bg-ink-700 overflow-hidden">{item.thumbnail && <img src={item.thumbnail} alt="" className="w-full h-full object-cover" />}</div><div className="min-w-0"><div className="text-sm truncate">{item.title || item.mediaId}</div><div className="text-[11px] text-slate-600 truncate">{item.uploader} · {formatDuration(item.durationSec)}</div></div><span className={`text-[10px] font-mono uppercase ${item.archived ? "text-lime-400" : "text-slate-600"}`}>{item.archived ? "archived" : item.liveState === "is_live" ? "live" : "ready"}</span></label>)}</div><div className="flex flex-wrap gap-2 items-center"><button className="btn-ghost" disabled={offset === 0} onClick={() => load(Math.max(0, offset - PAGE_SIZE))}>Previous</button><button className="btn-ghost" disabled={offset + PAGE_SIZE >= page.session.loadedCount} onClick={() => load(offset + PAGE_SIZE)}>Next</button><select value={profileId} onChange={(event) => setProfileId(event.target.value)} className="control !w-auto ml-auto">{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select><button className="btn-primary" disabled={!page.items.some((item) => item.selected)} onClick={download}>Download selected</button></div></>}{message && <div className="text-xs text-rose-300 break-words">{message}</div>}</div>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block min-w-0"><span className="block text-xs text-slate-500 mb-1">{label}</span>{children}</label>; }
function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (value: string) => void; options: string[][] }) { return <Field label={label}><select value={value} onChange={(event) => onChange(event.target.value)} className="control">{options.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></Field>; }
function words(value: string): string[] { return value.split(/[,\n]+/).map((word) => word.trim()).filter(Boolean); }
function formatDuration(seconds: number): string { if (!seconds) return "-"; const minutes = Math.floor(seconds / 60); return `${minutes}:${String(seconds % 60).padStart(2, "0")}`; }
