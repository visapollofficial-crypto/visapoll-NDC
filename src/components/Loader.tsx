export function Loader({ label = "Loading" }: { label?: string }) {
  return (
    <div className="center-screen" role="status" aria-live="polite">
      <div className="skeleton-bar" />
      <span className="sr-only">{label}</span>
    </div>
  );
}
