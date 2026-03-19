import { useMemo } from "react";
import { AgGridReact } from "ag-grid-react";
import type { ColDef } from "ag-grid-community";
import { useAppStore } from "../../store/useAppStore";

export function ResultsGrid() {
  const { queryTabs, activeTabId, activeBottomTab, setActiveBottomTab } = useAppStore();

  const activeTab = queryTabs.find((t) => t.id === activeTabId);
  const result = activeTab?.result ?? null;

  const colDefs = useMemo<ColDef[]>(() => {
    if (!result?.columns.length) return [];
    return result.columns.map((col) => ({
      field: col,
      headerName: col,
      sortable: true,
      filter: true,
      resizable: true,
      minWidth: 80,
      cellStyle: { fontSize: "13px" },
    }));
  }, [result?.columns]);

  const rowData = useMemo(() => {
    if (!result?.rows.length) return [];
    return result.rows.map((row) => {
      const obj: Record<string, unknown> = {};
      result.columns.forEach((col, i) => {
        obj[col] = row[i] ?? null;
      });
      return obj;
    });
  }, [result]);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {/* Tab bar */}
      <div style={{
        display: "flex",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg-panel)",
      }}>
        {(["results", "messages"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveBottomTab(tab)}
            style={{
              padding: "4px 14px",
              background: activeBottomTab === tab ? "var(--bg-surface)" : "transparent",
              color: activeBottomTab === tab ? "var(--text-bright)" : "var(--text-muted)",
              borderBottom: activeBottomTab === tab ? "2px solid var(--accent)" : "2px solid transparent",
              borderLeft: "none",
              borderRight: "none",
              borderTop: "none",
              borderRadius: 0,
              fontSize: 12,
              textTransform: "capitalize",
            }}
          >
            {tab}
          </button>
        ))}
        {result && (
          <div style={{
            marginLeft: "auto",
            padding: "4px 12px",
            color: "var(--text-muted)",
            fontSize: 11,
            alignSelf: "center",
          }}>
            {result.rows.length} rows · {result.execution_time_ms}ms
          </div>
        )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: "hidden" }}>
        {activeBottomTab === "results" && (
          <>
            {activeTab?.isExecuting && (
              <div style={{ padding: 12, color: "var(--text-muted)" }}>Executing…</div>
            )}
            {!activeTab?.isExecuting && result && colDefs.length > 0 && (
              <div className="ag-theme-alpine-dark" style={{ height: "100%", width: "100%" }}>
                <AgGridReact
                  columnDefs={colDefs}
                  rowData={rowData}
                  defaultColDef={{ sortable: true, filter: true, resizable: true }}
                  rowHeight={24}
                  headerHeight={28}
                  suppressCellFocus={false}
                  enableCellTextSelection={true}
                />
              </div>
            )}
            {!activeTab?.isExecuting && result && colDefs.length === 0 && (
              <div style={{ padding: 12, color: "var(--text-muted)" }}>
                Query OK · {result.rows_affected} row(s) affected · {result.execution_time_ms}ms
              </div>
            )}
            {!activeTab?.isExecuting && !result && !activeTab?.error && (
              <div style={{ padding: 12, color: "var(--text-muted)", fontSize: 12 }}>
                Execute a query with F9 or F5
              </div>
            )}
          </>
        )}

        {activeBottomTab === "messages" && (
          <div style={{ padding: 12, fontFamily: "monospace", fontSize: 12 }}>
            {activeTab?.error ? (
              <span style={{ color: "var(--danger)" }}>{activeTab.error}</span>
            ) : result ? (
              <span style={{ color: "var(--success)" }}>
                Query OK · {result.rows_affected} row(s) · {result.execution_time_ms}ms
              </span>
            ) : (
              <span style={{ color: "var(--text-muted)" }}>No messages</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
