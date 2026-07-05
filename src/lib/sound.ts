let ctx: AudioContext | null = null;

/**
 * Short, pleasant "ding" via the Web Audio API — no audio asset to bundle.
 * Respects the `dm-sound` setting unless `force` is set (used by the test button).
 */
export function playDing(force = false) {
  if (!force && localStorage.getItem("dm-sound") === "off") return;
  try {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
    const now = ctx.currentTime;
    // A rising two-note chime (A5 → D6).
    [880, 1174.66].forEach((freq, i) => {
      const osc = ctx!.createOscillator();
      const gain = ctx!.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const t0 = now + i * 0.09;
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.linearRampToValueAtTime(0.16, t0 + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.3);
      osc.connect(gain).connect(ctx!.destination);
      osc.start(t0);
      osc.stop(t0 + 0.32);
    });
  } catch {
    /* audio unavailable — ignore */
  }
}
