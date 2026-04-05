import { useEffect } from "react";

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "warning";
  onConfirm: () => void;
  onCancel: () => void;
}

const VARIANT = {
  warning: {
    color: "#e8a030",
    bgTint: "rgba(232, 160, 48, 0.09)",
    borderTint: "rgba(232, 160, 48, 0.25)",
    label: "Irreversible action",
    confirmBg: "transparent",
    confirmHoverBg: "rgba(232, 160, 48, 0.12)",
  },
  danger: {
    color: "#f04848",
    bgTint: "rgba(240, 72, 72, 0.09)",
    borderTint: "rgba(240, 72, 72, 0.25)",
    label: "Destructive action",
    confirmBg: "#f04848",
    confirmHoverBg: "#d43c3c",
  },
};

function WarningIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 20 20" fill="none">
      <path d="M10 2.5L18.5 17H1.5L10 2.5Z" stroke="currentColor" strokeWidth="1.45" strokeLinejoin="round" />
      <line x1="10" y1="8.5" x2="10" y2="12.2" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" />
      <circle cx="10" cy="14.8" r="0.85" fill="currentColor" />
    </svg>
  );
}

function DangerIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.45" />
      <line x1="7" y1="7" x2="13" y2="13" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" />
      <line x1="13" y1="7" x2="7" y2="13" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" />
    </svg>
  );
}

// Renders quoted entity names (e.g. "phases") as inline monospace code
function formatMessage(message: string) {
  const parts = message.split(/("(?:[^"\\]|\\.)*")/);
  return parts.map((part, i) =>
    /^".*"$/.test(part) ? (
      <code
        key={i}
        style={{
          fontFamily: "'Consolas', 'SF Mono', 'Menlo', monospace",
          fontSize: 11,
          background: "rgba(255,255,255,0.07)",
          border: "1px solid rgba(255,255,255,0.1)",
          padding: "1px 5px",
          borderRadius: 3,
          color: "#e0e0e0",
          letterSpacing: "0.01em",
        }}
      >
        {part.slice(1, -1)}
      </code>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "warning",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const vs = VARIANT[variant];

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onCancel]);

  return (
    <>
      <style>{`
        @keyframes _cd_overlay {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes _cd_dialog {
          from { opacity: 0; transform: scale(0.96) translateY(-8px); }
          to   { opacity: 1; transform: scale(1)    translateY(0);    }
        }
        ._cd_cancel:hover  { color: var(--text) !important; border-color: #666 !important; }
        ._cd_confirm:hover { filter: brightness(0.88); }
      `}</style>

      {/* Overlay */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 100,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(0,0,0,0.6)",
          backdropFilter: "blur(4px)",
          WebkitBackdropFilter: "blur(4px)",
          animation: "_cd_overlay 0.15s ease",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Dialog */}
        <div
          style={{
            background: "var(--bg-panel)",
            borderRadius: 8,
            width: 400,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            boxShadow: "0 24px 64px rgba(0,0,0,0.75), 0 0 0 1px rgba(255,255,255,0.06)",
            animation: "_cd_dialog 0.2s cubic-bezier(0.34, 1.1, 0.64, 1)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Colored top accent bar */}
          <div style={{ height: 3, background: vs.color, flexShrink: 0 }} />

          {/* Body */}
          <div style={{ padding: "18px 20px 16px" }}>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              {/* Icon */}
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 7,
                  background: vs.bgTint,
                  border: `1px solid ${vs.borderTint}`,
                  color: vs.color,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                {variant === "danger" ? <DangerIcon /> : <WarningIcon />}
              </div>

              {/* Title + message */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 15,
                    fontWeight: 600,
                    color: "var(--text-bright)",
                    lineHeight: 1.3,
                    marginBottom: 4,
                  }}
                >
                  {title}
                </div>
                <div
                  style={{
                    fontSize: 10,
                    fontWeight: 500,
                    color: vs.color,
                    textTransform: "uppercase",
                    letterSpacing: "0.07em",
                    marginBottom: 12,
                    opacity: 0.85,
                  }}
                >
                  {vs.label}
                </div>
                <p
                  style={{
                    fontSize: 13,
                    color: "var(--text)",
                    lineHeight: 1.65,
                    margin: 0,
                  }}
                >
                  {formatMessage(message)}
                </p>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: 8,
              padding: "10px 20px 14px",
              borderTop: "1px solid var(--border)",
              background: "rgba(0,0,0,0.18)",
            }}
          >
            <button
              className="_cd_cancel"
              onClick={onCancel}
              style={{
                background: "transparent",
                color: "var(--text-muted)",
                border: "1px solid var(--border)",
                borderRadius: 5,
                padding: "5px 14px",
                fontSize: 12,
                cursor: "pointer",
                transition: "color 0.1s, border-color 0.1s",
              }}
            >
              {cancelLabel}
            </button>
            <button
              className="_cd_confirm"
              onClick={onConfirm}
              style={{
                background: vs.confirmBg,
                color: variant === "danger" ? "#fff" : vs.color,
                border: `1px solid ${vs.color}`,
                borderRadius: 5,
                padding: "5px 14px",
                fontSize: 12,
                fontWeight: 500,
                cursor: "pointer",
                transition: "filter 0.1s",
              }}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
