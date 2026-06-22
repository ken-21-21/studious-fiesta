import React from "react";

export function SkeletonLoader() {
  return (
    <div className="deck-item" style={{ animation: "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite", cursor: "default" }}>
      <div style={{ flex: 1 }}>
        <div style={{ height: "20px", background: "var(--border)", borderRadius: "4px", width: "40%", marginBottom: "8px" }} />
        <div style={{ height: "14px", background: "var(--border)", borderRadius: "4px", width: "60%" }} />
      </div>
      <div style={{ display: "flex", gap: "0.75rem" }}>
        <div style={{ height: "36px", width: "70px", background: "var(--border)", borderRadius: "8px" }} />
        <div style={{ height: "36px", width: "70px", background: "var(--border)", borderRadius: "8px" }} />
      </div>
    </div>
  );
}

export function CardSkeletonLoader() {
  return (
    <div className="card-surface" style={{ animation: "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite", cursor: "default", minHeight: "300px", justifyContent: "center" }}>
      <div style={{ height: "32px", background: "var(--border)", borderRadius: "8px", width: "60%", marginBottom: "32px" }} />
      <div style={{ height: "48px", background: "var(--border)", borderRadius: "8px", width: "100%", maxWidth: "420px" }} />
    </div>
  );
}

export function ErrorMessage({ message }: { message: string }) {
  return (
    <div className="glass-panel" style={{ borderColor: "var(--danger)", backgroundColor: "rgba(239, 68, 68, 0.1)" }}>
      <h3 style={{ color: "var(--danger)", margin: "0 0 8px 0" }}>Something went wrong</h3>
      <p style={{ margin: 0, color: "var(--text)" }}>{message}</p>
    </div>
  );
}
