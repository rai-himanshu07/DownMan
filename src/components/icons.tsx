type P = { className?: string };
const s = { width: 18, height: 18, fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round", strokeLinejoin: "round" } as const;

export const I = {
  Logo: (p: P) => (
    <svg viewBox="0 0 24 24" width={22} height={22} className={p.className} fill="none">
      <path d="M12 3v10m0 0l4-4m-4 4l-4-4" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" stroke="currentColor" strokeWidth={2} strokeLinecap="round" />
    </svg>
  ),
  All: (p: P) => <svg viewBox="0 0 24 24" {...s} className={p.className}><rect x="3" y="4" width="18" height="4" rx="1" /><rect x="3" y="10" width="18" height="4" rx="1" /><rect x="3" y="16" width="18" height="4" rx="1" /></svg>,
  Active: (p: P) => <svg viewBox="0 0 24 24" {...s} className={p.className}><path d="M5 12h4l2-6 2 12 2-6h4" /></svg>,
  Done: (p: P) => <svg viewBox="0 0 24 24" {...s} className={p.className}><path d="M4 12l5 5L20 6" /></svg>,
  Media: (p: P) => <svg viewBox="0 0 24 24" {...s} className={p.className}><rect x="3" y="5" width="18" height="14" rx="2" /><path d="M10 9l5 3-5 3z" /></svg>,
  Gear: (p: P) => <svg viewBox="0 0 24 24" {...s} className={p.className}><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 00-.1-1l2-1.5-2-3.4-2.3 1a7 7 0 00-1.7-1L14.5 2h-5l-.4 2.6a7 7 0 00-1.7 1l-2.3-1-2 3.4L5 11a7 7 0 000 2l-2 1.5 2 3.4 2.3-1a7 7 0 001.7 1l.4 2.6h5l.4-2.6a7 7 0 001.7-1l2.3 1 2-3.4-2-1.5a7 7 0 00.1-1z" /></svg>,
  Plus: (p: P) => <svg viewBox="0 0 24 24" {...s} className={p.className}><path d="M12 5v14M5 12h14" /></svg>,
  Pause: (p: P) => <svg viewBox="0 0 24 24" {...s} className={p.className}><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>,
  Play: (p: P) => <svg viewBox="0 0 24 24" {...s} className={p.className}><path d="M7 5l12 7-12 7z" /></svg>,
  Trash: (p: P) => <svg viewBox="0 0 24 24" {...s} className={p.className}><path d="M4 7h16M9 7V4h6v3m-7 0v13h8V7" /></svg>,
  Search: (p: P) => <svg viewBox="0 0 24 24" {...s} className={p.className}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg>,
  Folder: (p: P) => <svg viewBox="0 0 24 24" {...s} className={p.className}><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" /></svg>,
  File: (p: P) => <svg viewBox="0 0 24 24" {...s} className={p.className}><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" /><path d="M14 3v5h5" /></svg>,
  Up: (p: P) => <svg viewBox="0 0 24 24" {...s} className={p.className}><path d="M12 19V5M5 12l7-7 7 7" /></svg>,
  Down: (p: P) => <svg viewBox="0 0 24 24" {...s} className={p.className}><path d="M12 5v14M5 12l7 7 7-7" /></svg>,
  Gauge: (p: P) => <svg viewBox="0 0 24 24" {...s} className={p.className}><path d="M12 13l4-4M5 19a9 9 0 1114 0" /><circle cx="12" cy="13" r="1.4" fill="currentColor" stroke="none" /></svg>,
  More: (p: P) => <svg viewBox="0 0 24 24" {...s} className={p.className}><circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" /></svg>,
  Kebab: (p: P) => <svg viewBox="0 0 24 24" {...s} className={p.className}><circle cx="12" cy="5" r="1.4" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" /><circle cx="12" cy="19" r="1.4" fill="currentColor" stroke="none" /></svg>,
  Open: (p: P) => <svg viewBox="0 0 24 24" {...s} className={p.className}><path d="M14 4h6v6M20 4l-8 8M18 13v5a2 2 0 01-2 2H6a2 2 0 01-2-2V8a2 2 0 012-2h5" /></svg>,
  Grid: (p: P) => <svg viewBox="0 0 24 24" {...s} className={p.className}><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></svg>,
  Table: (p: P) => <svg viewBox="0 0 24 24" {...s} className={p.className}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M3 14h18M10 9v11" /></svg>,
  Queue: (p: P) => <svg viewBox="0 0 24 24" {...s} className={p.className}><path d="M12 3l9 5-9 5-9-5 9-5zM3 12l9 5 9-5M3 16l9 5 9-5" /></svg>,
  Torrent: (p: P) => <svg viewBox="0 0 24 24" {...s} className={p.className}><path d="M6 3v8a6 6 0 0012 0V3M6 3H3v8a9 9 0 0018 0V3h-3" /></svg>,
  Globe: (p: P) => <svg viewBox="0 0 24 24" {...s} className={p.className}><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.6 2.7 2.6 15.3 0 18M12 3c-2.6 2.7-2.6 15.3 0 18" /></svg>,
  Close: (p: P) => <svg viewBox="0 0 24 24" {...s} className={p.className}><path d="M6 6l12 12M18 6L6 18" /></svg>,
  Unfinished: (p: P) => <svg viewBox="0 0 24 24" {...s} className={p.className}><circle cx="12" cy="12" r="9" strokeDasharray="2.5 3" /><path d="M12 7.5v5l3 2" /></svg>,
};
