import { useMemo, useCallback, useState, useRef, useEffect, forwardRef } from "react";
import { AgGridReact } from "ag-grid-react";
import type { ColDef, GridApi } from "ag-grid-community";
import { themeAlpine, colorSchemeDark } from "ag-grid-community";
import { invoke } from "@tauri-apps/api/core";
import { useShallow } from "zustand/react/shallow";
import { useAppStore, getActiveSession } from "../../store/useAppStore";
import { EditableDataGrid } from "./EditableDataGrid";
import { FilterBar } from "./FilterBar";
import type { ActiveColumnFilter } from "./FilterBar";
import type { QueryResult, QueryTab } from "../../types";

const darkTheme = themeAlpine.withPart(colorSchemeDark);
const EMPTY_TABS: QueryTab[] = [];
const EMPTY_PKS: string[] = [];

function buildColDefs(result: QueryResult | null, nullDisplayText: string): ColDef[] {
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
      params.value === null || params.value === undefined ? nullDisplayText : String(params.value),
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

interface DataGridProps {
  result: QueryResult;
  quickFilterText?: string;
  onFilterChanged?: (api: GridApi) => void;
}

const DataGrid = forwardRef<AgGridReact, DataGridProps>(
  function DataGrid({ result, quickFilterText, onFilterChanged }, ref) {
    const { nullDisplayText, gridRowHeight } = useAppStore(useShallow((s) => ({
      nullDisplayText: s.settings.null_display_text,
      gridRowHeight: s.settings.grid_row_height,
    })));
    const colDefs = useMemo(() => buildColDefs(result, nullDisplayText), [result?.columns, nullDisplayText]);
    const rowData = useMemo(() => buildRowData(result), [result]);

    return (
      <div style={{ height: "100%", width: "100%" }}>
        <AgGridReact
          ref={ref}
          theme={darkTheme}
          columnDefs={colDefs}
          rowData={rowData}
          defaultColDef={{
            sortable: true,
            filter: true,
            resizable: true,
            filterParams: { buttons: ["apply", "reset"], closeOnApply: true },
          }}
          rowHeight={gridRowHeight}
          headerHeight={28}
          suppressCellFocus={false}
          enableCellTextSelection={true}
          quickFilterText={quickFilterText}
          onFilterChanged={(e) => onFilterChanged?.(e.api)}
        />
      </div>
    );
  }
);

// Translate ag-grid filter model entry to human-readable summary
function summarizeFilterModel(model: Record<string, unknown>): string {
  const entry = model as Record<string, unknown>;

  // Combined filter (conditions joined by AND/OR)
  if (entry.conditions && Array.isArray(entry.conditions)) {
    const operator = (entry.operator as string) || "AND";
    const parts = (entry.conditions as Record<string, unknown>[]).map((c) => summarizeFilterModel(c));
    return parts.join(` ${operator} `);
  }

  const filterType = entry.filterType as string | undefined;
  const type = entry.type as string | undefined;
  const filter = entry.filter;

  if (filterType === "text" || typeof filter === "string") {
    const val = filter !== undefined ? `"${filter}"` : "";
    switch (type) {
      case "contains": return `contains ${val}`;
      case "notContains": return `not contains ${val}`;
      case "equals": return `= ${val}`;
      case "notEqual": return `!= ${val}`;
      case "startsWith": return `starts with ${val}`;
      case "endsWith": return `ends with ${val}`;
      case "blank": return "is blank";
      case "notBlank": return "is not blank";
      default: return val ? `${type} ${val}` : "active";
    }
  }

  if (filterType === "number" || typeof filter === "number") {
    const filterTo = entry.filterTo as number | undefined;
    switch (type) {
      case "equals": return `= ${filter}`;
      case "notEqual": return `!= ${filter}`;
      case "greaterThan": return `> ${filter}`;
      case "greaterThanOrEqual": return `>= ${filter}`;
      case "lessThan": return `< ${filter}`;
      case "lessThanOrEqual": return `<= ${filter}`;
      case "inRange": return `${filter} - ${filterTo}`;
      case "blank": return "is blank";
      case "notBlank": return "is not blank";
      default: return filter !== undefined ? `${type} ${filter}` : "active";
    }
  }

  return "active";
}

export function ResultsGrid() {
  const {
    queryTabs, activeTabId, activeBottomTab,
    dataResult, dataTableName, dataDatabase, dataTable, dataColumns, dataPrimaryKeys,
    activeConnectionId, activeSessionId,
    isLoadingData, dataPage, dataPageSize,
    dataTotalRows,
  } = useAppStore(useShallow(s => {
    const session = getActiveSession(s);
    return {
      queryTabs: session?.queryTabs ?? EMPTY_TABS,
      activeTabId: session?.activeTabId ?? null,
      activeBottomTab: session?.activeBottomTab ?? ("results" as const),
      dataResult: session?.dataResult ?? null,
      dataTableName: session?.dataTableName ?? null,
      dataDatabase: session?.dataDatabase ?? null,
      dataTable: session?.dataTable ?? null,
      dataColumns: session?.dataColumns ?? null,
      dataPrimaryKeys: session?.dataPrimaryKeys ?? EMPTY_PKS,
      activeConnectionId: session?.connectionId ?? null,
      activeSessionId: s.activeSessionId,
      isLoadingData: session?.isLoadingData ?? false,
      dataPage: session?.dataPage ?? 0,
      dataPageSize: session?.dataPageSize ?? 1000,
      dataTotalRows: session?.dataTotalRows ?? null,
    };
  }));
  const { setActiveBottomTab, setDataResult, setColumns, setLoadingData, setDataPage, setDataTotalRows } = useAppStore(useShallow(s => ({
    setActiveBottomTab: s.setActiveBottomTab,
    setDataResult: s.setDataResult,
    setColumns: s.setColumns,
    setLoadingData: s.setLoadingData,
    setDataPage: s.setDataPage,
    setDataTotalRows: s.setDataTotalRows,
  })));

  const activeTab = queryTabs.find((t) => t.id === activeTabId);
  const queryResult = activeTab?.result ?? null;

  // --- Filter state per tab ---
  const [dataQuickFilter, setDataQuickFilter] = useState("");
  const [resultsQuickFilter, setResultsQuickFilter] = useState("");
  const [activeColumnFilters, setActiveColumnFilters] = useState<ActiveColumnFilter[]>([]);
  const [filteredRowCount, setFilteredRowCount] = useState<number | null>(null);

  // Total row count derived from the active result's row data
  const totalRowCount = activeBottomTab === "data"
    ? (dataResult?.rows.length ?? 0)
    : (queryResult?.rows.length ?? 0);

  // Refs to grids
  const resultsGridRef = useRef<AgGridReact>(null);
  const editableGridApiRef = useRef<GridApi | null>(null);
  const filterInputRef = useRef<HTMLInputElement>(null);

  // Derived values based on active tab
  const currentQuickFilter = activeBottomTab === "data" ? dataQuickFilter : resultsQuickFilter;
  const setCurrentQuickFilter = activeBottomTab === "data" ? setDataQuickFilter : setResultsQuickFilter;

  const getCurrentGridApi = useCallback((): GridApi | null => {
    if (activeBottomTab === "data") {
      return editableGridApiRef.current;
    }
    return resultsGridRef.current?.api ?? null;
  }, [activeBottomTab]);

  // Centralized filter change handler — extracts filter state from grid API
  const extractFilterState = useCallback((api: GridApi) => {
    setFilteredRowCount(api.getDisplayedRowCount());

    const filterModel = api.getFilterModel();
    const filters: ActiveColumnFilter[] = [];
    if (filterModel) {
      for (const [column, model] of Object.entries(filterModel)) {
        filters.push({
          column,
          summary: summarizeFilterModel(model as Record<string, unknown>),
        });
      }
    }
    setActiveColumnFilters(filters);
  }, []);

  const handleGridFilterChanged = useCallback((api: GridApi) => {
    extractFilterState(api);
  }, [extractFilterState]);

  // EditableDataGrid notifies us when its grid is ready
  const handleEditableGridReady = useCallback((api: GridApi) => {
    editableGridApiRef.current = api;
    setFilteredRowCount(null);
  }, []);

  // Clear a specific column filter
  const handleClearColumnFilter = useCallback((column: string) => {
    const api = getCurrentGridApi();
    if (!api) return;
    const model = api.getFilterModel();
    if (model) {
      delete model[column];
      api.setFilterModel(model);
    }
  }, [getCurrentGridApi]);

  // Clear all filters (quick filter + column filters)
  const handleClearAllFilters = useCallback(() => {
    setCurrentQuickFilter("");
    const api = getCurrentGridApi();
    if (api) {
      api.setFilterModel(null);
    }
    setActiveColumnFilters([]);
    setFilteredRowCount(null);
  }, [setCurrentQuickFilter, getCurrentGridApi]);

  // Reset data filters when table changes
  const prevDataKeyRef = useRef<string>("");
  useEffect(() => {
    const key = dataResult ? `${dataDatabase}.${dataTable}` : "";
    if (key !== prevDataKeyRef.current) {
      prevDataKeyRef.current = key;
      setDataQuickFilter("");
      if (activeBottomTab === "data") {
        setActiveColumnFilters([]);
        setFilteredRowCount(null);
      }
    }
  }, [dataResult, dataDatabase, dataTable, activeBottomTab]);

  // Reset results filters when query result changes
  const prevQueryResultRef = useRef<QueryResult | null>(null);
  useEffect(() => {
    if (queryResult !== prevQueryResultRef.current) {
      prevQueryResultRef.current = queryResult;
      setResultsQuickFilter("");
      if (activeBottomTab === "results") {
        setActiveColumnFilters([]);
        setFilteredRowCount(null);
      }
    }
  }, [queryResult, activeBottomTab]);

  // Re-read filter state when switching tabs
  useEffect(() => {
    const api = getCurrentGridApi();
    if (api) {
      extractFilterState(api);
    } else {
      setActiveColumnFilters([]);
      setFilteredRowCount(null);
    }
  }, [activeBottomTab, getCurrentGridApi, extractFilterState]);

  // Reload data after apply — mantiene la página actual
  const handleDataReload = useCallback(async () => {
    if (!activeConnectionId || !dataDatabase || !dataTable) return;
    const activeSession = getActiveSession(useAppStore.getState());
    const currentPage = activeSession?.dataPage ?? 0;
    const pageSize = activeSession?.dataPageSize ?? 1000;
    setLoadingData(true);
    setFilteredRowCount(null);
    try {
      const key = `${dataDatabase}.${dataTable}`;
      const [result, cols, countResult] = await Promise.all([
        invoke<QueryResult>("get_table_data", {
          connectionId: activeConnectionId,
          database: dataDatabase,
          table: dataTable,
          page: currentPage,
          limit: pageSize,
        }),
        invoke<import("../../types").ColumnInfo[]>("get_columns", {
          connectionId: activeConnectionId,
          database: dataDatabase,
          table: dataTable,
        }),
        invoke<QueryResult>("execute_query", {
          connectionId: activeConnectionId,
          sql: `SELECT COUNT(*) AS cnt FROM \`${dataDatabase}\`.\`${dataTable}\``,
        }),
      ]);
      setColumns(key, cols);
      setDataResult(result, key, dataDatabase, dataTable, cols);
      const totalRows = countResult.rows[0]?.[0];
      setDataTotalRows(typeof totalRows === "number" ? totalRows : Number(totalRows));
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingData(false);
    }
  }, [activeConnectionId, dataDatabase, dataTable, setDataResult, setColumns, setLoadingData, setDataTotalRows]);

  // Ctrl+F → focus filter input; F5 → reload data tab
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        if (activeBottomTab === "data" || activeBottomTab === "results") {
          e.preventDefault();
          filterInputRef.current?.focus();
          filterInputRef.current?.select();
        }
      }
      if (e.key === "F5" && activeBottomTab === "data" && dataResult
          && !document.activeElement?.closest(".monaco-editor")) {
        e.preventDefault();
        handleDataReload();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeBottomTab, dataResult, handleDataReload]);

  // Determine which result to show stats for in the tab bar
  const visibleResult = activeBottomTab === "data" ? dataResult : queryResult;

  // Navegar páginas del data preview
  const loadDataPage = useCallback(async (page: number) => {
    if (!activeConnectionId || !dataDatabase || !dataTable) return;
    const pageSize = getActiveSession(useAppStore.getState())?.dataPageSize ?? 1000;
    setLoadingData(true);
    setFilteredRowCount(null);
    try {
      const key = `${dataDatabase}.${dataTable}`;
      const result = await invoke<QueryResult>("get_table_data", {
        connectionId: activeConnectionId,
        database: dataDatabase,
        table: dataTable,
        page,
        limit: pageSize,
      });
      setDataResult(result, key, dataDatabase, dataTable, dataColumns);
      setDataPage(page);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingData(false);
    }
  }, [activeConnectionId, dataDatabase, dataTable, dataColumns, setDataResult, setLoadingData, setDataPage]);

  const tabs = [
    { key: "data" as const, label: dataTableName ? `Data: ${dataTableName}` : "Data" },
    { key: "results" as const, label: "Results" },
    { key: "messages" as const, label: "Messages" },
  ];

  // When the table is empty, the backend returns columns:[] — synthesize columns from dataColumns metadata
  const displayResult = useMemo(() => {
    if (!dataResult || dataResult.columns.length > 0) return dataResult;
    if (!dataColumns || dataColumns.length === 0) return dataResult;
    return { ...dataResult, columns: dataColumns.map((c) => c.field) };
  }, [dataResult, dataColumns]);

  // Should FilterBar be visible?
  const showFilterBar =
    (activeBottomTab === "data" && displayResult && displayResult.columns.length > 0) ||
    (activeBottomTab === "results" && !activeTab?.isExecuting && queryResult && queryResult.columns.length > 0);

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
        {/* Paginación para tab Data */}
        {activeBottomTab === "data" && dataResult && (
          <div style={{
            marginLeft: "auto",
            padding: "4px 12px",
            color: "var(--text-muted)",
            fontSize: 11,
            alignSelf: "center",
            display: "flex",
            alignItems: "center",
            gap: 6,
          }}>
            <button
              className="btn-secondary"
              onClick={handleDataReload}
              disabled={isLoadingData}
              title="Refresh data (F5)"
              style={{ padding: "1px 6px", fontSize: 11 }}
            >
              {isLoadingData ? <span className="spinner spinner-sm" /> : "⟳"}
            </button>
            <button
              className="btn-secondary"
              disabled={dataPage === 0 || isLoadingData}
              onClick={() => loadDataPage(dataPage - 1)}
              style={{ padding: "1px 6px", fontSize: 11 }}
            >
              ← Prev
            </button>
            <span>
              Page {dataPage + 1}
              {filteredRowCount !== null && filteredRowCount !== dataResult.rows.length
                ? ` · ${filteredRowCount} filtered`
                : ""
              }
              {" · "}{dataResult.rows.length} rows
              {dataTotalRows !== null ? ` / ${dataTotalRows.toLocaleString()} total` : ""}
            </span>
            <button
              className="btn-secondary"
              disabled={dataResult.rows.length < dataPageSize || isLoadingData}
              onClick={() => loadDataPage(dataPage + 1)}
              style={{ padding: "1px 6px", fontSize: 11 }}
            >
              Next →
            </button>
          </div>
        )}
        {/* Stats para tabs Results/Messages */}
        {activeBottomTab !== "data" && visibleResult && (
          <div style={{
            marginLeft: "auto",
            padding: "4px 12px",
            color: "var(--text-muted)",
            fontSize: 11,
            alignSelf: "center",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}>
            {activeTab?.autoLimited && (
              <span style={{ color: "#e8c08c" }}>⚠ Auto-limited to {dataPageSize} rows</span>
            )}
            {visibleResult.rows.length} rows · {visibleResult.execution_time_ms}ms
          </div>
        )}
      </div>

      {/* FilterBar */}
      {showFilterBar && (
        <FilterBar
          quickFilterText={currentQuickFilter}
          onQuickFilterChange={setCurrentQuickFilter}
          activeColumnFilters={activeColumnFilters}
          onClearColumnFilter={handleClearColumnFilter}
          onClearAllFilters={handleClearAllFilters}
          filteredRowCount={filteredRowCount}
          totalRowCount={totalRowCount}
          inputRef={filterInputRef}
        />
      )}

      {/* Content */}
      <div style={{ flex: 1, overflow: "hidden", position: "relative" }}>
        {/* Loading overlay para tab Data */}
        {activeBottomTab === "data" && isLoadingData && (
          <div style={{
            position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
            background: "rgba(0,0,0,0.3)", zIndex: 10,
          }}>
            <span className="spinner" style={{ width: 24, height: 24, borderWidth: 3 }} />
          </div>
        )}

        {activeBottomTab === "data" && (
          <>
            {displayResult && displayResult.columns.length > 0 && dataDatabase && dataTable && dataColumns && activeConnectionId ? (
              <EditableDataGrid
                key={`${activeSessionId}-${dataDatabase}-${dataTable}`}
                result={displayResult}
                database={dataDatabase}
                table={dataTable}
                columns={dataColumns}
                primaryKeys={dataPrimaryKeys}
                connectionId={activeConnectionId}
                onDataReload={handleDataReload}
                onFilterChanged={handleGridFilterChanged}
                quickFilterText={dataQuickFilter}
                onGridReady={handleEditableGridReady}
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
              <DataGrid
                ref={resultsGridRef}
                key={`${activeSessionId}-${activeTabId}`}
                result={queryResult}
                quickFilterText={resultsQuickFilter}
                onFilterChanged={handleGridFilterChanged}
              />
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
