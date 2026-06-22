export function SkeletonLoader() {
  return (
    <div className="glass-panel" style={{ animation: "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite" }}>
      <div style={{ height: "24px", background: "var(--border)", borderRadius: "4px", width: "50%", marginBottom: "16px" }} />
      <div style={{ height: "16px", background: "var(--border)", borderRadius: "4px", width: "80%", marginBottom: "8px" }} />
      <div style={{ height: "16px", background: "var(--border)", borderRadius: "4px", width: "60%" }} />
    </div>
  );
}

export function ErrorMessage({ message }: { message: string }) {
  return (
    <div className="glass-panel" style={{ borderColor: "#ef4444", backgroundColor: "rgba(239, 68, 68, 0.1)" }}>
      <h3 style={{ color: "#ef4444", margin: "0 0 8px 0" }}>Something went wrong</h3>
      <p style={{ margin: 0, color: "var(--text)" }}>{message}</p>
    </div>
  );
}
