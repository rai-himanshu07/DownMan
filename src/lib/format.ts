export function fmtBytes(n: number | string | undefined): string {
  const b = typeof n === "string" ? parseInt(n, 10) : n ?? 0;
  if (!b || b < 0) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(b) / Math.log(1024)), u.length - 1);
  return `${(b / Math.pow(1024, i)).toFixed(i ? 1 : 0)} ${u[i]}`;
}

export function fmtSpeed(n: number | string | undefined): string {
  return `${fmtBytes(n)}/s`;
}

export function fmtEta(seconds: number): string {
  if (!isFinite(seconds) || seconds <= 0) return "—";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

export function eta(total: number, done: number, speed: number): string {
  if (speed <= 0) return "—";
  return fmtEta((total - done) / speed);
}
