export default function SignalBackground() {
  return (
    <div className="dm-signal-field fixed inset-0 overflow-hidden pointer-events-none" style={{ zIndex: 0 }} aria-hidden>
      <span className="dm-scan-line" />
      <span className="dm-data-lane dm-data-lane-1" />
      <span className="dm-data-lane dm-data-lane-2" />
    </div>
  );
}