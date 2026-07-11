export const SIGNAL_ACCENT = "#ccf43c";
export const SIGNAL_BG =
  "linear-gradient(rgba(204,244,60,0.026) 1px, transparent 1px), linear-gradient(90deg, rgba(204,244,60,0.026) 1px, transparent 1px), linear-gradient(180deg, #0b0d0c 0%, #101410 100%)";
export const PAPER_BG =
  "linear-gradient(rgba(72,88,61,0.055) 1px, transparent 1px), linear-gradient(90deg, rgba(72,88,61,0.055) 1px, transparent 1px), linear-gradient(180deg, #eff1eb 0%, #e7ebe3 100%)";
const TELEMETRY_BG =
  "linear-gradient(rgba(98,222,213,0.026) 1px, transparent 1px), linear-gradient(90deg, rgba(98,222,213,0.026) 1px, transparent 1px), linear-gradient(180deg, #0b0d0d 0%, #0d1616 100%)";
const FOUNDRY_BG =
  "repeating-linear-gradient(135deg, rgba(239,159,82,0.022) 0 1px, transparent 1px 14px), linear-gradient(180deg, #100e0c 0%, #17120e 100%)";
const RELAY_BG =
  "repeating-linear-gradient(90deg, rgba(141,203,214,0.024) 0 1px, transparent 1px 32px), linear-gradient(180deg, #0b0e0f 0%, #101719 100%)";

const UI_REVISION = "signal-console-1";

export function migrateTheme() {
  if (localStorage.getItem("dm-ui-revision") === UI_REVISION) return;
  const light = localStorage.getItem("dm-light") === "on";
  const currentTheme = localStorage.getItem("dm-theme") || "Aurora";
  const currentAccent = localStorage.getItem("dm-accent");
  const legacy: Record<string, { expected: string; name: string; accent: string; bg: string }> = {
    Aurora: { expected: "#0a74f0", name: "Signal", accent: SIGNAL_ACCENT, bg: SIGNAL_BG },
    Midnight: { expected: "#6366f1", name: "Telemetry", accent: "#62ded5", bg: TELEMETRY_BG },
    Sunset: { expected: "#f97316", name: "Foundry", accent: "#ef9f52", bg: FOUNDRY_BG },
    Grape: { expected: "#a855f7", name: "Relay", accent: "#8dcbd6", bg: RELAY_BG },
    Forest: { expected: "#10b981", name: "Signal", accent: SIGNAL_ACCENT, bg: SIGNAL_BG },
  };
  const mapped = legacy[currentTheme];
  localStorage.setItem("dm-ui-revision", UI_REVISION);
  if (mapped) {
    localStorage.setItem("dm-theme", mapped.name);
    if (!currentAccent || currentAccent.toLowerCase() === mapped.expected) {
      localStorage.setItem("dm-accent", mapped.accent);
    }
    localStorage.setItem("dm-bg", light ? PAPER_BG : mapped.bg);
  } else {
    if (!currentAccent) localStorage.setItem("dm-accent", SIGNAL_ACCENT);
    if (!localStorage.getItem("dm-bg")) localStorage.setItem("dm-bg", light ? PAPER_BG : SIGNAL_BG);
  }
}