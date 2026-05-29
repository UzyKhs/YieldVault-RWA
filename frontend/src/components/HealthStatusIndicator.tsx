import { useRef, useState, useCallback, type FC } from "react";
import { useHealthStatus, type HealthState } from "../hooks/useHealthStatus";

const CONFIG = {
  healthy:   { dot: "#22c55e", glow: "#22c55e59", label: "Healthy",     icon: "✓" },
  degraded:  { dot: "#eab308", glow: "#eab30859", label: "Degraded",    icon: "⚠" },
  unhealthy: { dot: "#ef4444", glow: "#ef444459", label: "Unavailable", icon: "✕" },
} satisfies Record<HealthState, { dot: string; glow: string; label: string; icon: string }>;

function relativeTime(date: Date | null) {
  if (!date) return "Checking…";
  const s = Math.floor((Date.now() - date.getTime()) / 1000);
  if (s < 5)  return "just now";
  if (s < 60) return `${s}s ago`;
  return `${Math.floor(s / 60)}m ago`;
}

const HealthStatusIndicator: FC = () => {
  const { state, message, checks, lastChecked, refetch } = useHealthStatus();
  const [show, setShow] = useState(false);
  const [pos, setPos]   = useState<"top" | "bottom">("top");
  const ref = useRef<HTMLDivElement>(null);
  const { dot, glow, label, icon } = CONFIG[state];

  const onEnter = useCallback(() => {
    if (ref.current) {
      setPos(ref.current.getBoundingClientRect().top < window.innerHeight / 3 ? "bottom" : "top");
    }
    setShow(true);
  }, []);

  return (
    <>
      <style>{`
        @keyframes pulseHard { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:.55;transform:scale(.9)} }
        @keyframes pulseSoft { 0%,100%{opacity:1} 50%{opacity:.7} }
      `}</style>

      <div
        ref={ref}
        style={{ position: "relative", display: "inline-flex", alignItems: "center" }}
        onMouseEnter={onEnter}
        onMouseLeave={() => setShow(false)}
        onFocus={onEnter}
        onBlur={() => setShow(false)}
      >
        <button
          type="button"
          onClick={() => void refetch()}
          aria-label={`Vault health: ${label}. ${message}. Click to refresh.`}
          aria-describedby={show ? "hs-tooltip" : undefined}
          style={{
            all: "unset",
            cursor: "pointer",
            width: 10, height: 10,
            borderRadius: "50%",
            background: dot,
            boxShadow: `0 0 0 3px ${glow}`,
            outline: "revert",
            outlineOffset: 3,
            animation: state === "unhealthy" ? "pulseHard 1.8s ease-in-out infinite"
                     : state === "degraded"  ? "pulseSoft 2.5s ease-in-out infinite"
                     : "none",
          }}
        />

        {show && (
          <div
            id="hs-tooltip"
            role="tooltip"
            style={{
              position: "absolute",
              ...(pos === "top" ? { bottom: "calc(100% + 10px)" } : { top: "calc(100% + 10px)" }),
              left: "50%", transform: "translateX(-50%)",
              minWidth: 200, maxWidth: 260,
              background: "var(--bg-surface, #1a1a2e)",
              border: `1px solid ${dot}33`,
              borderRadius: 8,
              padding: "10px 14px",
              fontSize: "0.75rem",
              color: "var(--text-secondary, #94a3b8)",
              zIndex: 1000,
              pointerEvents: "none",
              whiteSpace: "nowrap",
            }}
          >
            <div style={{ fontWeight: 600, color: dot, marginBottom: 6, fontSize: "0.8rem" }}>
              <span aria-hidden="true">{icon}</span> {label}
            </div>

            <div style={{ marginBottom: checks ? 8 : 6, lineHeight: 1.4 }}>{message}</div>

            {checks && Object.keys(checks).length > 0 && (
              <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 8, marginBottom: 6 }}>
                <div style={{ fontWeight: 600, fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.06em", opacity: 0.6, marginBottom: 4 }}>
                  Services
                </div>
                {Object.entries(checks).map(([svc, s]) => (
                  <div key={svc} style={{ display: "flex", gap: 6, padding: "2px 0", fontSize: "0.72rem", color: s === "up" ? "#22c55e" : "#ef4444" }}>
                    <span aria-hidden="true">{s === "up" ? "✓" : "✕"}</span>
                    <span style={{ color: "var(--text-secondary, #94a3b8)" }}>{svc}</span>
                  </div>
                ))}
              </div>
            )}

            <div style={{ borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 6, fontSize: "0.68rem", opacity: 0.5 }}>
              Last checked {relativeTime(lastChecked)}
            </div>
          </div>
        )}
      </div>
    </>
  );
};

export default HealthStatusIndicator;