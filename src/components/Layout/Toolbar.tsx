import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../../store/useAppStore";

export function Toolbar() {
  const {
    activeConnectionId,
    activeTabId,
    queryTabs,
    setTabResult,
    setTabExecuting,
    setTabError,
    setShowConnectionDialog,
    clearConnection,
    addQueryTab,
  } = useAppStore();

  const activeTab = queryTabs.find((t) => t.id === activeTabId);

  const execute = async () => {
    if (!activeTabId || !activeConnectionId || !activeTab?.sql.trim()) return;
    setTabExecuting(activeTabId, true);
    setTabError(activeTabId, null);
    try {
      const result = await invoke("execute_query", {
        connectionId: activeConnectionId,
        sql: activeTab.sql.trim(),
      });
      setTabResult(activeTabId, result as any);
    } catch (e) {
      setTabError(activeTabId, String(e));
    } finally {
      setTabExecuting(activeTabId, false);
    }
  };

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
          <div style={{ width: 1, height: 20, background: "var(--border)", margin: "0 4px" }} />
          <button style={btnStyle(!activeTab?.sql.trim())} onClick={execute} title="Execute (F9)">
            ▶ Execute
          </button>
          <button style={btnStyle()} onClick={() => addQueryTab()} title="New Query Tab (Ctrl+T)">
            + New Tab
          </button>
          <div style={{ flex: 1 }} />
          <button
            style={{ ...btnStyle(), color: "var(--danger)" }}
            onClick={clearConnection}
            title="Disconnect"
          >
            ✕ Disconnect
          </button>
        </>
      )}
    </div>
  );
}
