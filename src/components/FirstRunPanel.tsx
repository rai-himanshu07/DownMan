import { useState } from "react";
import { api } from "../lib/api";

/** First-run onboarding panel — shown once after install.
 *  Covers the essentials: download folder, extension setup, theme.
 *  Dismissed permanently by setting localStorage["dm-onboarded"] = "1". */
export default function FirstRunPanel({ onDismiss }: { onDismiss: () => void }) {
  const [step, setStep] = useState(0);
  const [dir, setDir] = useState("");

  async function pickDir() {
    const d = await api.pickFolder().catch(() => null);
    if (d) { setDir(d); api.setDownloadDir(d).catch(() => {}); }
  }

  function dismiss() {
    localStorage.setItem("dm-onboarded", "1");
    onDismiss();
  }

  const steps = [
    {
      title: "Welcome to DownMan",
      body: (
        <div className="space-y-3 text-sm text-slate-400">
          <p>DownMan is an aria2-powered download manager for Linux. It handles HTTP/FTP files, torrents, magnets, and video pages — all from a single window.</p>
          <p>This quick setup takes 30 seconds.</p>
        </div>
      ),
    },
    {
      title: "Download folder",
      body: (
        <div className="space-y-3">
          <p className="text-sm text-slate-400">Where should DownMan save your files? The default is <code className="bg-ink-700/60 px-1 rounded text-xs">~/Downloads/DownMan</code>.</p>
          <div className="flex gap-2">
            <input readOnly value={dir || "Default (~⁄Downloads/DownMan)"} className="flex-1 bg-ink-900/60 border border-white/5 rounded-lg px-3 py-1.5 text-sm text-slate-400" />
            <button className="btn-ghost text-sm" onClick={pickDir}>Change…</button>
          </div>
          <p className="text-xs text-slate-600">You can change this anytime in Settings → General.</p>
        </div>
      ),
    },
    {
      title: "Browser extension",
      body: (
        <div className="space-y-3 text-sm text-slate-400">
          <p>Install the browser extension to intercept downloads and grab videos from any page.</p>
          <div className="rounded-lg border border-white/5 bg-ink-900/40 p-3 space-y-2 text-xs">
            <p className="font-medium text-slate-300">Chromium (Chrome/Brave/Edge)</p>
            <p>Go to <code className="bg-ink-700/60 px-1 rounded">chrome://extensions</code> → enable Developer mode → Load unpacked → select the <code className="bg-ink-700/60 px-1 rounded">extensions/</code> folder.</p>
            <p className="font-medium text-slate-300 mt-2">Firefox</p>
            <p>Go to <code className="bg-ink-700/60 px-1 rounded">about:debugging#/runtime/this-firefox</code> → Load Temporary Add-on → select <code className="bg-ink-700/60 px-1 rounded">extensions/manifest.json</code>.</p>
          </div>
          <p className="text-xs text-slate-600">You can skip this and install later via Settings → Browser.</p>
        </div>
      ),
    },
    {
      title: "Resource-heavy features",
      body: (
        <div className="space-y-3 text-sm text-slate-400">
          <p>Some features use more CPU or network. DownMan always asks before enabling them:</p>
          <ul className="list-disc ml-5 space-y-1 text-xs text-slate-500">
            <li><b className="text-slate-300">Animated background</b> — renders on the GPU; looks great, uses more power.</li>
            <li><b className="text-slate-300">Site video capture</b> (yt-dlp) — invokes ffmpeg and may download large media.</li>
            <li><b className="text-slate-300">Browser cookies for media</b> — lets yt-dlp access age-gated or logged-in content.</li>
          </ul>
          <p className="text-xs text-slate-600">All of these are disabled by default and require your explicit action.</p>
        </div>
      ),
    },
  ];

  const current = steps[step];
  const isLast = step === steps.length - 1;

  return (
    <div className="fixed inset-0 z-[90] grid place-items-center bg-black/70 backdrop-blur-sm animate-fade-up">
      <div className="card w-[520px] max-w-[95vw] p-6">
        <div className="flex items-center gap-2 mb-5">
          {steps.map((_, i) => (
            <div key={i} className={`h-1 flex-1 rounded-full ${i <= step ? "bg-aurora-500" : "bg-ink-500"}`} />
          ))}
        </div>
        <h2 className="text-lg font-semibold mb-3">{current.title}</h2>
        <div className="min-h-[120px]">{current.body}</div>
        <div className="flex justify-between items-center mt-6">
          <button className="btn-ghost text-xs" onClick={dismiss}>Skip setup</button>
          <div className="flex gap-2">
            {step > 0 && <button className="btn-ghost" onClick={() => setStep((s) => s - 1)}>Back</button>}
            {isLast ? (
              <button className="btn-primary" onClick={dismiss}>Get started</button>
            ) : (
              <button className="btn-primary" onClick={() => setStep((s) => s + 1)}>Next</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
