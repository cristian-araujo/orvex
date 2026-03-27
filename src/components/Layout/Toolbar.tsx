import { useShallow } from "zustand/react/shallow";
import { useAppStore, getActiveSession } from "../../store/useAppStore";

export function Toolbar() {
  const { activeConnectionId, activeSessionId } = useAppStore(useShallow(s => {
    const session = getActiveSession(s);
    return {
      activeConnectionId: session?.connectionId ?? null,
      activeSessionId: s.activeSessionId,
    };
  }));
  const setShowConnectionDialog = useAppStore(s => s.setShowConnectionDialog);
  const setShowExportDialog = useAppStore(s => s.setShowExportDialog);
  const setShowImportDialog = useAppStore(s => s.setShowImportDialog);
  const closeSession = useAppStore(s => s.closeSession);

  const btnStyle = (disabled = false): React.CSSProperties => ({
    background: "var(--bg-surface)",
    border: "1px solid var(--border)",
    color: disabled ? "var(--text-muted)" : "var(--text)",
    padding: "3px 10px",
    borderRadius: 3,
    fontSize: 12,
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.5 : 1,
  });

  return (
    <div style={{
      height: "var(--toolbar-height)",
      background: "var(--bg-panel)",
      borderBottom: "1px solid var(--border)",
      display: "flex",
      alignItems: "center",
      gap: 4,
      padding: "0 8px",
    }}>
      <button
        style={btnStyle()}
        onClick={() => setShowConnectionDialog(true)}
        title="Manage Connections"
      >
        🔌 Connect
      </button>

      {activeConnectionId && (
        <>
          <button
            style={btnStyle()}
            onClick={() => setShowExportDialog(true)}
            title="Export Database"
          >
            Export
          </button>
          <button
            style={btnStyle()}
            onClick={() => setShowImportDialog(true)}
            title="Import SQL File"
          >
            Import
          </button>
          <div style={{ flex: 1 }} />
          <button
            style={{ ...btnStyle(), color: "var(--danger)" }}
            onClick={() => {
              if (activeSessionId) closeSession(activeSessionId);
            }}
            title="Disconnect"
          >
            ✕ Disconnect
          </button>
        </>
      )}
    </div>
  );
}
