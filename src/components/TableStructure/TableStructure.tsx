import { useState, useEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AgGridReact } from "ag-grid-react";
import type { ColDef } from "ag-grid-community";
import { themeAlpine, colorSchemeDark } from "ag-grid-community";
import MonacoEditor from "@monaco-editor/react";

const darkTheme = themeAlpine.withPart(colorSchemeDark);
import { useShallow } from "zustand/react/shallow";
import { useAppStore, getActiveSession } from "../../store/useAppStore";
import type { TableStructure as TableStructureType, QueryResult, TableViewTab } from "../../types";

const PAGE_SIZE = 500;

const tabStyle = (active: boolean): React.CSSProperties => ({
  padding: "6px 16px",
  background: active ? "var(--bg-surface)" : "transparent",
  color: active ? "var(--text-bright)" : "var(--text-muted)",
  borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent",
  borderLeft: "none",
  borderRight: "none",
  borderTop: "none",
  borderRadius: 0,
  fontSize: 12,
  cursor: "pointer",
});

const thStyle: React.CSSProperties = {
  padding: "4px 12px",
  textAlign: "left",
  borderBottom: "1px solid var(--border)",
  color: "var(--text-muted)",
  fontSize: 11,
  fontWeight: 600,
  background: "var(--bg-panel)",
  position: "sticky",
  top: 0,
};

const tdStyle: React.CSSProperties = {
  padding: "4px 12px",
  borderBottom: "1px solid var(--border)",
  fontSize: 12,
};

interface Props {
  database: string;
  table: string;
}

export function TableStructure({ database, table }: Props) {
  const { connectionId: activeConnectionId, activeSessionId } = useAppStore(useShallow(s => {
    const session = getActiveSession(s);
    return {
      connectionId: session?.connectionId ?? null,
      activeSessionId: s.activeSessionId,
    };
  }));
  const [activeTab, setActiveTab] = useState<TableViewTab>("data");
  const [structure, setStructure] = useState<TableStructureType | null>(null);
  const [dataResult, setDataResult] = useState<QueryResult | null>(null);
  const [page, setPage] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    setStructure(null);
    setDataResult(null);
    setPage(0);
    setError(null);

    if (!activeConnectionId) return;

    // Cargar datos de la tabla
    setIsLoading(true);
    invoke<QueryResult>("get_table_data", {
      connectionId: activeConnectionId,
      database,
      table,
      page: 0,
      limit: PAGE_SIZE,
    })
      .then((result) => { if (!cancelled) { setDataResult(result); setPage(0); } })
      .catch((e) => { if (!cancelled) setError(String(e)); })
      .finally(() => { if (!cancelled) setIsLoading(false); });

    // Cargar estructura (columns, indexes, FK, create SQL)
    invoke<TableStructureType>("get_table_structure", {
      connectionId: activeConnectionId,
      database,
      table,
    })
      .then((s) => { if (!cancelled) setStructure(s); })
      .catch((e) => console.error("get_table_structure:", e));

    return () => { cancelled = true; };
  }, [database, table, activeConnectionId]);

  const loadData = async (p: number) => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await invoke<QueryResult>("get_table_data", {
        connectionId: activeConnectionId,
        database,
        table,
        page: p,
        limit: PAGE_SIZE,
      });
      setDataResult(result);
      setPage(p);
    } catch (e) {
      setError(String(e));
    } finally {
      setIsLoading(false);
    }
  };

  const colDefs = useMemo<ColDef[]>(() => {
    if (!dataResult?.columns.length) return [];
    return dataResult.columns.map((col) => ({
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
  }, [dataResult?.columns]);

  const rowData = useMemo(() => {
    if (!dataResult?.rows.length) return [];
    return dataResult.rows.map((row) => {
      const obj: Record<string, unknown> = {};
      dataResult.columns.forEach((col, i) => { obj[col] = row[i] ?? null; });
      return obj;
    });
  }, [dataResult]);

  const tabs: { key: TableViewTab; label: string }[] = [
    { key: "data", label: "Data" },
    { key: "columns", label: "Columns" },
    { key: "indexes", label: "Indexes" },
    { key: "foreign_keys", label: "Foreign Keys" },
    { key: "create_sql", label: "Create SQL" },
  ];

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {/* Tab bar */}
      <div style={{ display: "flex", borderBottom: "1px solid var(--border)", background: "var(--bg-panel)", flexShrink: 0 }}>
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setActiveTab(t.key)} style={tabStyle(activeTab === t.key)}>
            {t.label}
          </button>
        ))}

        {activeTab === "data" && (
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8, padding: "0 12px" }}>
            {dataResult && (
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                {dataResult.rows.length} rows · page {page + 1}
              </span>
            )}
            <button className="btn-secondary" style={{ padding: "2px 8px", fontSize: 11 }}
              onClick={() => loadData(Math.max(0, page - 1))} disabled={page === 0 || isLoading}>
              ← Prev
            </button>
            <button className="btn-secondary" style={{ padding: "2px 8px", fontSize: 11 }}
              onClick={() => loadData(page + 1)} disabled={(dataResult?.rows.length ?? 0) < PAGE_SIZE || isLoading}>
              Next →
            </button>
          </div>
        )}
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: "hidden" }}>

        {/* DATA TAB */}
        {activeTab === "data" && (
          <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
            {/* Debug badge */}
            <div style={{ padding: "2px 8px", fontSize: 10, color: "#888", background: "var(--bg-panel)", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
              {isLoading
                ? "⏳ loading..."
                : error
                ? `❌ ${error}`
                : dataResult
                ? `✓ ${dataResult.rows.length} rows · ${dataResult.columns.length} columns`
                : "⚪ no data yet"}
            </div>

            <div style={{ flex: 1, position: "relative" }}>
              {isLoading && (
                <div style={{ padding: 12, color: "var(--text-muted)" }}>Loading…</div>
              )}
              {!isLoading && error && (
                <div style={{ padding: 12, color: "var(--danger)", fontFamily: "monospace", fontSize: 12 }}>{error}</div>
              )}
              {!isLoading && !error && dataResult && colDefs.length > 0 && (
                <div style={{ position: "absolute", inset: 0 }}>
                  <AgGridReact
                    key={`${activeSessionId}-${database}-${table}`}
                    theme={darkTheme}
                    columnDefs={colDefs}
                    rowData={rowData}
                    defaultColDef={{ sortable: true, filter: true, resizable: true }}
                    rowHeight={24}
                    headerHeight={28}
                    enableCellTextSelection={true}
                  />
                </div>
              )}
              {!isLoading && !error && dataResult && colDefs.length === 0 && (
                <div style={{ padding: 12, color: "var(--text-muted)" }}>Table is empty (0 rows)</div>
              )}
            </div>
          </div>
        )}

        {/* COLUMNS TAB */}
        {activeTab === "columns" && (
          <div style={{ overflow: "auto", height: "100%" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Field", "Type", "Nullable", "Key", "Default", "Extra"].map((h) => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {structure?.columns.map((col, i) => (
                  <tr key={col.field} style={{ background: i % 2 === 0 ? "var(--bg-panel)" : "var(--bg-surface)" }}>
                    <td style={{ ...tdStyle, fontWeight: 600, color: col.key === "PRI" ? "#f9c74f" : "var(--text)" }}>
                      {col.key === "PRI" ? "🔑 " : ""}{col.field}
                    </td>
                    <td style={{ ...tdStyle, color: "#9cdcfe", fontFamily: "monospace" }}>{col.column_type}</td>
                    <td style={{ ...tdStyle, color: col.nullable ? "var(--text-muted)" : "var(--success)" }}>
                      {col.nullable ? "YES" : "NO"}
                    </td>
                    <td style={{ ...tdStyle, color: "#f9c74f" }}>{col.key}</td>
                    <td style={{ ...tdStyle, color: "var(--text-muted)", fontFamily: "monospace" }}>
                      {col.default_value ?? <span style={{ opacity: 0.4 }}>NULL</span>}
                    </td>
                    <td style={{ ...tdStyle, color: "var(--text-muted)" }}>{col.extra}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* INDEXES TAB */}
        {activeTab === "indexes" && (
          <div style={{ overflow: "auto", height: "100%" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Key Name", "Column", "Type", "Unique"].map((h) => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {structure?.indexes.map((idx, i) => (
                  <tr key={`${idx.key_name}-${idx.column_name}`} style={{ background: i % 2 === 0 ? "var(--bg-panel)" : "var(--bg-surface)" }}>
                    <td style={{ ...tdStyle, color: "#f9c74f" }}>{idx.key_name}</td>
                    <td style={tdStyle}>{idx.column_name}</td>
                    <td style={{ ...tdStyle, fontFamily: "monospace", color: "#9cdcfe" }}>{idx.index_type}</td>
                    <td style={{ ...tdStyle, color: idx.non_unique ? "var(--text-muted)" : "var(--success)" }}>
                      {idx.non_unique ? "NO" : "YES"}
                    </td>
                  </tr>
                ))}
                {!structure?.indexes.length && (
                  <tr><td colSpan={4} style={{ ...tdStyle, color: "var(--text-muted)" }}>No indexes</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* FOREIGN KEYS TAB */}
        {activeTab === "foreign_keys" && (
          <div style={{ overflow: "auto", height: "100%" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  {["Constraint", "Column", "References Table", "References Column"].map((h) => (
                    <th key={h} style={thStyle}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {structure?.foreign_keys.map((fk, i) => (
                  <tr key={fk.constraint_name} style={{ background: i % 2 === 0 ? "var(--bg-panel)" : "var(--bg-surface)" }}>
                    <td style={{ ...tdStyle, color: "#f9c74f" }}>{fk.constraint_name}</td>
                    <td style={tdStyle}>{fk.column_name}</td>
                    <td style={{ ...tdStyle, color: "#4fc1ff" }}>{fk.referenced_table}</td>
                    <td style={tdStyle}>{fk.referenced_column}</td>
                  </tr>
                ))}
                {!structure?.foreign_keys.length && (
                  <tr><td colSpan={4} style={{ ...tdStyle, color: "var(--text-muted)" }}>No foreign keys</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* CREATE SQL TAB */}
        {activeTab === "create_sql" && (
          <MonacoEditor
            height="100%"
            language="sql"
            theme="vs-dark"
            value={structure?.create_sql ?? "-- Loading..."}
            options={{
              readOnly: true,
              fontSize: 13,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              automaticLayout: true,
              wordWrap: "on",
            }}
          />
        )}
      </div>
    </div>
  );
}
