/**
 * Opt-in animated aurora background — pure CSS compositing (no WebGL). It can
 * never take the app down and reliably sits behind the content. Slowly drifting
 * blurred blobs tinted by the current accent. Heavier than the static gradient
 * (continuous GPU compositing), which is why it's gated behind an explicit opt-in.
 */
export default function AuroraBackground() {
  return (
    <div className="dm-aurora fixed inset-0 overflow-hidden pointer-events-none" style={{ zIndex: 0 }} aria-hidden>
      <span className="dm-aurora-blob dm-aurora-1" />
      <span className="dm-aurora-blob dm-aurora-2" />
      <span className="dm-aurora-blob dm-aurora-3" />
    </div>
  );
}
