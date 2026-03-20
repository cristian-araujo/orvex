import { useState, useEffect } from "react";
import { useAppStore } from "../../store/useAppStore";

interface TabContextMenu {
  x: number;
  y: number;
  sessionId: string;
}

export function ConnectionTabs() {
  const { sessions, activeSessionId, switchSession, closeSession, setShowConnectionDialog, setShowColorEditor } = useAppStore();
  const [contextMenu, setContextMenu] = useState<TabContextMenu | null>(null);

  useEffect(() => {
    const handler = () => setContextMenu(null);
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
  }, []);

  if (sessions.length === 0) return null;

  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          background: "var(--bg-panel)",
          borderBottom: "1px solid var(--border)",
          height: 32,
          flexShrink: 0,
          overflowX: "auto",
        }}
      >
        {sessions.map((session) => {
          const isActive = session.id === activeSessionId;
          return (
            <div
              key={session.id}
              onClick={() => switchSession(session.id)}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                switchSession(session.id);
                setContextMenu({ x: e.clientX, y: e.clientY, sessionId: session.id });
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "0 12px",
                height: "100%",
                cursor: "pointer",
                whiteSpace: "nowrap",
                fontSize: 12,
                background: isActive ? "var(--bg-surface)" : "transparent",
                color: isActive ? "var(--text-bright)" : "var(--text-muted)",
                borderBottom: isActive ? "2px solid var(--accent)" : "2px solid transparent",
                borderRight: "1px solid var(--border)",
              }}
              onMouseEnter={(e) => {
                if (!isActive) (e.currentTarget as HTMLDivElement).style.background = "var(--bg-hover)";
              }}
              onMouseLeave={(e) => {
                if (!isActive) (e.currentTarget as HTMLDivElement).style.background = "transparent";
              }}
            >
              <span style={{ color: "var(--success)", fontSize: 8 }}>⬤</span>
              <span>{session.connectionName}</span>
              <span
                onClick={(e) => { e.stopPropagation(); closeSession(session.id); }}
                style={{
                  marginLeft: 4,
                  opacity: 0.5,
                  fontSize: 10,
                  lineHeight: 1,
                  padding: "1px 3px",
                  borderRadius: 2,
                }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLSpanElement).style.opacity = "1")}
                onMouseLeave={(e) => ((e.currentTarget as HTMLSpanElement).style.opacity = "0.5")}
              >
                ✕
              </span>
            </div>
          );
        })}
        <button
          onClick={() => setShowConnectionDialog(true)}
          style={{
            background: "transparent",
            border: "none",
            color: "var(--text-muted)",
            padding: "0 10px",
            height: "100%",
            fontSize: 16,
            cursor: "pointer",
            flexShrink: 0,
          }}
          title="New Connection"
        >
          +
        </button>
      </div>

      {/* Connection tab context menu */}
      {contextMenu && (
        <div
          style={{
            position: "fixed",
            top: contextMenu.y,
            left: contextMenu.x,
            background: "var(--bg-surface)",
            border: "1px solid var(--border)",
            borderRadius: 4,
            zIndex: 1000,
            minWidth: 160,
            boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            onClick={() => { setShowColorEditor(true); setContextMenu(null); }}
            style={{ padding: "7px 14px", cursor: "pointer", fontSize: 12, whiteSpace: "nowrap" }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLDivElement).style.background = "var(--bg-hover)")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLDivElement).style.background = "transparent")}
          >
            Change Colors...
          </div>
          <div
            onClick={() => { closeSession(contextMenu.sessionId); setContextMenu(null); }}
            style={{ padding: "7px 14px", cursor: "pointer", fontSize: 12, whiteSpace: "nowrap", color: "var(--danger)" }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLDivElement).style.background = "var(--bg-hover)")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLDivElement).style.background = "transparent")}
          >
            Disconnect
          </div>
        </div>
      )}
    </>
  );
}
