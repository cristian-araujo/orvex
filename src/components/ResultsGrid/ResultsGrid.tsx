import { useMemo, useCallback } from "react";
import { AgGridReact } from "ag-grid-react";
import type { ColDef } from "ag-grid-community";
import { themeAlpine, colorSchemeDark } from "ag-grid-community";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../../store/useAppStore";
import { EditableDataGrid } from "./EditableDataGrid";
import type { QueryResult } from "../../types";

const darkTheme = themeAlpine.withPart(colorSchemeDark);

function buildColDefs(result: QueryResult | null): ColDef[] {
  if (!result?.columns.length) return [];
  return result.columns.map((col) => ({
    field: col,
    headerName: col,
    sortable: true,
    filter: true,
    resizable: true,
    minWidth: 80,
    cellStyle: (params: { value: unknown }) => ({
      fontSize: "13px",
      ...(params.value === null || params.value === undefined
        ? { fontStyle: "italic", color: "var(--text-muted)" }
        : {}),
    }),
    valueFormatter: (params: { value: unknown }) =>
      params.value === null || params.value === undefined ? "NULL" : String(params.value),
  }));
}

function buildRowData(result: QueryResult | null): Record<string, unknown>[] {
  if (!result?.rows.length) return [];
  return result.rows.map((row) => {
    const obj: Record<string, unknown> = {};
    result.columns.forEach((col, i) => {
      obj[col] = row[i] ?? null;
    });
    return obj;
  });
}

function DataGrid({ result }: { result: QueryResult }) {
  const colDefs = useMemo(() => buildColDefs(result), [result?.columns]);
  const rowData = useMemo(() => buildRowData(result), [result]);

  return (
    <div style={{ height: "100%", width: "100%" }}>
      <AgGridReact
        theme={darkTheme}
        columnDefs={colDefs}
        rowData={rowData}
        defaultColDef={{ sortable: true, filter: true, resizable: true }}
        rowHeight={24}
        headerHeight={28}
        suppressCellFocus={false}
        enableCellTextSelection={true}
      />
    </div>
  );
}

export function ResultsGrid() {
  const {
    queryTabs, activeTabId, activeBottomTab, setActiveBottomTab,
    dataResult, dataTableName, dataDatabase, dataTable, dataColumns, dataPrimaryKeys,
    activeConnectionId, setDataResult, setColumns,
  } = useAppStore();

  const activeTab = queryTabs.find((t) => t.id === activeTabId);
  const queryResult = activeTab?.result ?? null;

  // Determine which result to show stats for in the tab bar
  const visibleResult = activeBottomTab === "data" ? dataResult : queryResult;

  // Reload data after apply
  const handleDataReload = useCallback(async () => {
    if (!activeConnectionId || !dataDatabase || !dataTable) return;
    try {
      const key = `${dataDatabase}.${dataTable}`;
      const [result, cols] = await Promise.all([
        invoke<QueryResult>("execute_query", {
          connectionId: activeConnectionId,
          sql: `SELECT * FROM \`${dataDatabase}\`.\`${dataTable}\` LIMIT 1000`,
        }),
        invoke<import("../../types").ColumnInfo[]>("get_columns", {
          connectionId: activeConnectionId,
          database: dataDatabase,
          table: dataTable,
        }),
      ]);
      setColumns(key, cols);
      setDataResult(result, key, dataDatabase, dataTable, cols);
    } catch (e) {
      console.error(e);
    }
  }, [activeConnectionId, dataDatabase, dataTable, setDataResult, setColumns]);

  const tabs = [
    { key: "data" as const, label: dataTableName ? `Data: ${dataTableName}` : "Data" },
    { key: "results" as const, label: "Results" },
    { key: "messages" as const, label: "Messages" },
  ];

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {/* Tab bar */}
      <div style={{
        display: "flex",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg-panel)",
      }}>
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveBottomTab(tab.key)}
            style={{
              padding: "4px 14px",
              background: activeBottomTab === tab.key ? "var(--bg-surface)" : "transparent",
              color: activeBottomTab === tab.key ? "var(--text-bright)" : "var(--text-muted)",
              borderBottom: activeBottomTab === tab.key ? "2px solid var(--accent)" : "2px solid transparent",
              borderLeft: "none",
              borderRight: "none",
              borderTop: "none",
              borderRadius: 0,
              fontSize: 12,
              whiteSpace: "nowrap",
            }}
          >
            {tab.label}
          </button>
        ))}
        {visibleResult && (
          <div style={{
            marginLeft: "auto",
            padding: "4px 12px",
            color: "var(--text-muted)",
            fontSize: 11,
            alignSelf: "center",
          }}>
            {visibleResult.rows.length} rows · {visibleResult.execution_time_ms}ms
          </div>
        )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: "hidden" }}>
        {activeBottomTab === "data" && (
          <>
            {dataResult && dataResult.columns.length > 0 && dataDatabase && dataTable && dataColumns && activeConnectionId ? (
              <EditableDataGrid
                result={dataResult}
                database={dataDatabase}
                table={dataTable}
                columns={dataColumns}
                primaryKeys={dataPrimaryKeys}
                connectionId={activeConnectionId}
                onDataReload={handleDataReload}
              />
            ) : dataResult ? (
              <div style={{ padding: 12, color: "var(--text-muted)", fontSize: 12 }}>
                {dataTableName ? `Table ${dataTableName} is empty` : "No data"}
              </div>
            ) : (
              <div style={{ padding: 12, color: "var(--text-muted)", fontSize: 12 }}>
                Click a table in the Object Browser to preview data
              </div>
            )}
          </>
        )}

        {activeBottomTab === "results" && (
          <>
            {activeTab?.isExecuting && (
              <div style={{ padding: 12, color: "var(--text-muted)" }}>Executing…</div>
            )}
            {!activeTab?.isExecuting && queryResult && queryResult.columns.length > 0 && (
              <DataGrid result={queryResult} />
            )}
            {!activeTab?.isExecuting && queryResult && queryResult.columns.length === 0 && (
              <div style={{ padding: 12, color: "var(--text-muted)" }}>
                Query OK · {queryResult.rows_affected} row(s) affected · {queryResult.execution_time_ms}ms
              </div>
            )}
            {!activeTab?.isExecuting && !queryResult && !activeTab?.error && (
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
            ) : queryResult ? (
              <span style={{ color: "var(--success)" }}>
                Query OK · {queryResult.rows_affected} row(s) · {queryResult.execution_time_ms}ms
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
