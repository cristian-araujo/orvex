import { useShallow } from "zustand/react/shallow";
import { useAppStore, getActiveSession } from "../../store/useAppStore";
import { APP_NAME } from "../../appConfig";
import type { QueryTab } from "../../types";

// Stable fallback — avoids creating new array references on every render when
// there is no active session, which would cause an infinite re-render loop
// with React 19's stricter useSyncExternalStore snapshot caching.
const EMPTY_TABS: QueryTab[] = [];

export function StatusBar() {
  const {
    activeConnectionId, activeConnectionName, selectedDatabase,
    queryTabs, activeTabId, isLoadingData, dataResult, dataTableName,
    dataPage, dataTotalRows,
  } = useAppStore(useShallow(s => {
    const session = getActiveSession(s);
    return {
      activeConnectionId: session?.connectionId ?? null,
      activeConnectionName: session?.connectionName ?? null,
      selectedDatabase: session?.selectedDatabase ?? null,
      queryTabs: session?.queryTabs ?? EMPTY_TABS,
      activeTabId: session?.activeTabId ?? null,
      isLoadingData: session?.isLoadingData ?? false,
      dataResult: session?.dataResult ?? null,
      dataTableName: session?.dataTableName ?? null,
      dataPage: session?.dataPage ?? 0,
      dataTotalRows: session?.dataTotalRows ?? null,
    };
  }));
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
          {isLoadingData && <span>│ <span className="spinner spinner-sm" style={{ borderTopColor: "#fff", borderColor: "rgba(255,255,255,0.4)" }} /> Loading...</span>}
          {dataResult && dataTableName && !isLoadingData && (
            <span>│ {dataTableName} · Page {dataPage + 1} · {dataResult.rows.length} rows{dataTotalRows !== null ? ` / ${dataTotalRows.toLocaleString()} total` : ""}</span>
          )}
          {activeTab?.result && (
            <span>│ {activeTab.result.rows.length} rows · {activeTab.result.execution_time_ms}ms</span>
          )}
        </>
      ) : (
        <span>Not connected</span>
      )}
      <div style={{ flex: 1 }} />
      <span>{APP_NAME}</span>
    </div>
  );
}
