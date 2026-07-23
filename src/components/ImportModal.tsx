import { useEffect, useState } from "react";
import { api, DownloadProfile, PreflightPage } from "../lib/api";
import { toast } from "../lib/toast";
import { fmtBytes } from "../lib/format";

const PAGE_SIZE = 100;

export default function ImportModal({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<PreflightPage | null>(null);
  const [profiles, setProfiles] = useState<DownloadProfile[]>([]);
  const [profileId, setProfileId] = useState("");
  const [estimateSizes, setEstimateSizes] = useState(false);
  const [filter, setFilter] = useState("all");
  const [offset, setOffset] = useState(0);
  const [message, setMessage] = useState("");

  useEffect(() => {
    Promise.all([api.listDownloadProfiles(), api.activeDownloadProfile()])
      .then(([items, active]) => { setProfiles(items); setProfileId(active.id); })
      .catch(() => {});
  }, []);

  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const selectedCount = review?.items.filter((item) => item.selected && !item.commitStatus).length || 0;

  async function doReview() {
    const urls = lines;
    if (!urls.length) {
      toast.error("No URLs found", "Paste one URL per line.");
      return;
    }
    setBusy(true);
    setMessage(estimateSizes ? "Checking URLs and server sizes..." : "Checking URLs...");
    try {
      const result = await api.preflightBatch(urls, profileId || undefined, estimateSizes);
      setReview(result);
      setOffset(0);
      setFilter("all");
      setMessage("");
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function loadPage(nextOffset: number, nextFilter = filter) {
    if (!review) return;
    try {
      const result = await api.preflightGet(review.summary.id, nextOffset, PAGE_SIZE, nextFilter);
      setReview(result);
      setOffset(nextOffset);
      setFilter(nextFilter);
    } catch (error) {
      setMessage(String(error));
    }
  }

  async function select(index: number, selected: boolean) {
    if (!review) return;
    setReview({ ...review, items: review.items.map((item) => item.index === index ? { ...item, selected } : item) });
    try {
      await api.preflightSelect(review.summary.id, [index], selected);
    } catch (error) {
      setMessage(String(error));
      await loadPage(offset);
    }
  }

  async function selectAll(selected: boolean) {
    if (!review) return;
    setBusy(true);
    try {
      await api.preflightSelect(review.summary.id, [], selected);
      await loadPage(offset);
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!review) return;
    setBusy(true);
    try {
      const result = await api.preflightCommit(review.summary.id);
      if (result.added) toast.success(`Added ${result.added} download${result.added === 1 ? "" : "s"}`);
      setMessage(result.failed ? `${result.failed} URL${result.failed === 1 ? "" : "s"} failed during commit` : "Import committed");
      await loadPage(offset);
    } catch (error) {
      setMessage(String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-black/60 backdrop-blur-sm animate-fade-up" onClick={onClose}>
      <div className="card w-[900px] max-w-[96vw] max-h-[88vh] flex flex-col p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold mb-1">Import URL list</h3>
        <p className="text-xs text-slate-500 mb-3">Clean, expand patterns, classify, deduplicate, and review every URL before anything starts.</p>
        {!review ? <>
          <textarea autoFocus value={text} onChange={(event) => setText(event.target.value)}
            placeholder={"https://example.com/file-[001-050].zip\nhttps://example.com/video.{mp4,webm}\nmagnet:?xt=urn:btih:..."}
            className="w-full h-40 bg-ink-900/60 border border-white/5 rounded-md p-3 text-sm font-mono placeholder:text-slate-600 focus:outline-none resize-none" />
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-end mt-3">
            {profiles.length > 0 && <label className="block"><span className="block text-xs text-slate-500 mb-1">Download profile</span><select value={profileId} onChange={(event) => setProfileId(event.target.value)} className="control">{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}</select></label>}
            <label className="flex items-center gap-2 text-sm text-slate-400 pb-2"><input type="checkbox" checked={estimateSizes} onChange={(event) => setEstimateSizes(event.target.checked)} />Estimate server sizes and ETA</label>
          </div>
          <div className="text-xs text-slate-500 mt-2">{lines.length} non-empty {lines.length === 1 ? "line" : "lines"} · patterns: [1-100], [001-050], [1-10:2], [a-z], {'{mp4,mkv}'}</div>
        </> : <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3 text-xs font-mono">
            <Metric label="Total" value={review.summary.totalCount} />
            <Metric label="Accepted" value={review.summary.acceptedCount} tone="text-lime-400" />
            <Metric label="Rejected" value={review.summary.rejectedCount} tone="text-amber-300" />
            <Metric label="Selected page" value={selectedCount} />
          </div>
          <div className="flex flex-wrap gap-2 mb-2">
            <select value={filter} onChange={(event) => loadPage(0, event.target.value)} className="control !w-auto min-w-36"><option value="all">All rows</option><option value="accepted">Accepted</option><option value="rejected">Rejected</option><option value="committed">Committed</option></select>
            <button className="btn-ghost" disabled={busy} onClick={() => selectAll(true)}>Select accepted</button>
            <button className="btn-ghost" disabled={busy} onClick={() => selectAll(false)}>Select none</button>
          </div>
          <div className="flex-1 min-h-0 overflow-auto border border-white/10">
            {review.items.map((item) => <label key={item.index} className="grid grid-cols-[28px_74px_minmax(0,1fr)_100px] min-h-14 px-3 py-2 items-center gap-2 border-b border-white/5 hover:bg-white/[0.03]">
              <input type="checkbox" disabled={item.status !== "accepted" || !!item.commitStatus} checked={item.selected} onChange={(event) => select(item.index, event.target.checked)} />
              <span className={`text-[10px] font-mono uppercase ${item.status === "accepted" ? "text-lime-400" : item.status === "invalid" || item.status === "conflict" ? "text-rose-400" : "text-amber-300"}`}>{item.commitStatus || item.status}</span>
              <span className="min-w-0"><span className="block text-xs font-mono text-slate-300 truncate" title={item.url || item.original}>{item.url || item.original}</span>{item.reason && <span className="block text-[11px] text-slate-600 truncate" title={item.reason}>{item.reason}</span>}</span>
              <span className="text-right text-[11px] font-mono text-slate-500">{item.estimatedSize ? `~${fmtBytes(item.estimatedSize)}` : item.kind}</span>
            </label>)}
          </div>
          <div className="flex items-center gap-2 mt-2 text-xs text-slate-500"><button className="btn-ghost !py-1" disabled={offset === 0} onClick={() => loadPage(Math.max(0, offset - PAGE_SIZE))}>Previous</button><span>Rows {review.filteredCount ? offset + 1 : 0}-{Math.min(offset + review.items.length, review.filteredCount)} of {review.filteredCount}</span><button className="btn-ghost !py-1" disabled={offset + PAGE_SIZE >= review.filteredCount} onClick={() => loadPage(offset + PAGE_SIZE)}>Next</button></div>
        </>}
        {message && <div className="mt-2 text-xs text-slate-500 break-words">{message}</div>}
        <div className="flex justify-end gap-2 mt-4">
          <button className="btn-ghost" onClick={onClose}>Close</button>
          {review ? <button className="btn-primary" disabled={busy || review.summary.status === "committed"} onClick={commit}>{busy ? "Committing..." : "Commit selected"}</button> : <button className="btn-primary" disabled={busy || !lines.length} onClick={doReview}>{busy ? "Reviewing..." : "Review URLs"}</button>}
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, tone = "text-white" }: { label: string; value: number; tone?: string }) {
  return <div className="border border-white/10 px-3 py-2"><div className={`text-lg ${tone}`}>{value}</div><div className="text-[9px] uppercase text-slate-600">{label}</div></div>;
}
