import { useAppStore } from "../../store/useAppStore";

export function StatusBar() {
  const { activeConnectionId, activeConnectionName, selectedDatabase, queryTabs, activeTabId } = useAppStore();
  const activeTab = queryTabs.find((t) => t.id === activeTabId);

  return (
    <div style={{
      height: "var(--statusbar-height)",
      background: activeConnectionId ? "var(--accent)" : "#333",
      display: "flex",
      alignItems: "center",
      padding: "0 12px",
      gap: 16,
      fontSize: 11,
      color: "#fff",
    }}>
      {activeConnectionId ? (
        <>
          <span>⬤ {activeConnectionName}</span>
          {selectedDatabase && <span>│ {selectedDatabase}</span>}
          {activeTab?.result && (
            <span>│ {activeTab.result.rows.length} rows · {activeTab.result.execution_time_ms}ms</span>
          )}
        </>
      ) : (
        <span>Not connected</span>
      )}
      <div style={{ flex: 1 }} />
      <span>MySQL GUI</span>
    </div>
  );
}
