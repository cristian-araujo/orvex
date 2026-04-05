import { useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAppStore, getActiveSession } from "../../store/useAppStore";
import { ConfirmDialog } from "../ResultsGrid/ConfirmDialog";

export function Toolbar() {
  const { activeConnectionId, activeSessionId, confirmOnDisconnect } = useAppStore(useShallow(s => {
    const session = getActiveSession(s);
    return {
      activeConnectionId: session?.connectionId ?? null,
      activeSessionId: s.activeSessionId,
      confirmOnDisconnect: s.settings.confirm_on_disconnect,
    };
  }));
  const setShowConnectionDialog = useAppStore(s => s.setShowConnectionDialog);
  const setShowExportDialog = useAppStore(s => s.setShowExportDialog);
  const setShowImportDialog = useAppStore(s => s.setShowImportDialog);
  const setShowSettingsDialog = useAppStore(s => s.setShowSettingsDialog);
  const closeSession = useAppStore(s => s.closeSession);

  const [pendingDisconnect, setPendingDisconnect] = useState(false);

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
        </>
      )}

      <div style={{ flex: 1 }} />

      <button
        style={btnStyle()}
        onClick={() => setShowSettingsDialog(true)}
        title="Settings"
      >
        ⚙ Settings
      </button>

      {activeConnectionId && (
        <button
          style={{ ...btnStyle(), color: "var(--danger)" }}
          onClick={() => {
            if (!activeSessionId) return;
            if (confirmOnDisconnect) {
              setPendingDisconnect(true);
            } else {
              closeSession(activeSessionId);
            }
          }}
          title="Disconnect"
        >
          ✕ Disconnect
        </button>
      )}

      {pendingDisconnect && (
        <ConfirmDialog
          title="Disconnect"
          message="Disconnect from this session?"
          variant="warning"
          confirmLabel="Disconnect"
          cancelLabel="Cancel"
          onConfirm={() => {
            setPendingDisconnect(false);
            if (activeSessionId) closeSession(activeSessionId);
          }}
          onCancel={() => setPendingDisconnect(false)}
        />
      )}
    </div>
  );
}
