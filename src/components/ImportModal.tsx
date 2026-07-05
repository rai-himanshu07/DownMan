import { useState } from "react";
import { api } from "../lib/api";
import { toast } from "../lib/toast";

interface ImportResult { added: number; skipped: number; failed: number }

export default function ImportModal({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  async function doImport() {
    const urls = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.startsWith("http") || l.startsWith("magnet:"));
    if (!urls.length) {
      toast.error("No valid URLs found", "Paste one URL per line.");
      return;
    }
    setBusy(true);
    try {
      const r = await api.importUrls(urls);
      setResult(r as ImportResult);
      if ((r as ImportResult).added > 0) toast.success(`Imported ${(r as ImportResult).added} download${(r as ImportResult).added > 1 ? "s" : ""}`);
    } catch {
      toast.error("Import failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-black/60 backdrop-blur-sm animate-fade-up" onClick={onClose}>
      <div className="card w-[560px] max-w-[95vw] p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="font-semibold mb-1">Import URL list</h3>
        <p className="text-xs text-slate-500 mb-3">One URL per line — HTTP/FTP links and magnets. Duplicates are skipped automatically.</p>
        <textarea
          autoFocus value={text} onChange={(e) => setText(e.target.value)}
          placeholder={"https://example.com/file1.zip\nhttps://example.com/file2.iso\nmagnet:?xt=urn:btih:…"}
          className="w-full h-36 bg-ink-900/60 border border-white/5 rounded-lg p-3 text-sm font-mono placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-aurora-500/50 resize-none"
        />
        <div className="text-xs text-slate-500 mt-1 mb-3">
          {text.split(/\r?\n/).filter((l) => l.trim().startsWith("http") || l.trim().startsWith("magnet:")).length} valid URLs detected
        </div>
        {result && (
          <div className="text-sm mb-3">
            <span className="text-lime-400">{result.added} added</span>
            {result.skipped > 0 && <span className="text-slate-500 ml-3">{result.skipped} skipped (duplicates)</span>}
            {result.failed > 0 && <span className="text-rose-400 ml-3">{result.failed} failed</span>}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>{result ? "Close" : "Cancel"}</button>
          {!result && (
            <button className="btn-primary" disabled={busy || !text.trim()} onClick={doImport}>
              {busy ? "Importing…" : "Import"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
