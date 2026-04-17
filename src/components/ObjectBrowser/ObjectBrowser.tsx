import { useEffect, useState, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { HexColorPicker, HexColorInput } from "react-colorful";
import { useShallow } from "zustand/react/shallow";
import { useAppStore, getActiveSession } from "../../store/useAppStore";
import { UNLIMITED_PAGE_SIZE, type ColumnInfo } from "../../types";
import { ConfirmDialog } from "../ResultsGrid/ConfirmDialog";
import {
  ContextMenu,
  IconRefresh, IconQuery, IconExport, IconImport, IconCopy,
  IconOpenTable, IconSelectRows, IconTruncate, IconTrash, IconDatabase,
} from "./ContextMenu";
import { CreateDatabaseDialog } from "./CreateDatabaseDialog";

const EMPTY_ARR: string[] = [];
const EMPTY_SET = new Set<string>();
const EMPTY_TABLES_MAP: Record<string, { name: string; table_type: string }[]> = {};
const EMPTY_COLS_MAP: Record<string, ColumnInfo[]> = {};

type ContextMenuState =
  | { type: "database"; x: number; y: number; database: string }
  | { type: "table"; x: number; y: number; database: string; table: string }
  | { type: "connection"; x: number; y: number };

export function ObjectBrowser() {
  const {
    activeSessionId,
    activeConnectionId,
    activeConnectionName,
    activeConnectionConfig,
    activeProfileId,
    databases,
    expandedDbs,
    tables,
    expandedTables,
    columns,
    selectedDatabase,
    dataTableName,
    dbFilter,
    tableFilter,
  } = useAppStore(useShallow(s => {
    const session = getActiveSession(s);
    return {
      activeSessionId: s.activeSessionId,
      activeConnectionId: session?.connectionId ?? null,
      activeConnectionName: session?.connectionName ?? null,
      activeConnectionConfig: session?.connectionConfig ?? null,
      activeProfileId: session?.profileId ?? null,
      databases: session?.databases ?? EMPTY_ARR,
      expandedDbs: session?.expandedDbs ?? EMPTY_SET,
      tables: session?.tables ?? EMPTY_TABLES_MAP,
      expandedTables: session?.expandedTables ?? EMPTY_SET,
      columns: session?.columns ?? EMPTY_COLS_MAP,
      selectedDatabase: session?.selectedDatabase ?? null,
      dataTableName: session?.dataTableName ?? null,
      dbFilter: session?.dbFilter ?? "",
      tableFilter: session?.tableFilter ?? "",
    };
  }));
  const showColorEditor = useAppStore(s => s.showColorEditor);
  const reconnectSession = useAppStore(s => s.reconnectSession);
  const reconnectingSessionId = useAppStore(s => s.reconnectingSessionId);
  const {
    setDatabases, setDatabasesForSession, toggleDb, setTables, setExpandedTables, setColumns,
    setSelectedDatabase, setShowColorEditor, setShowExportDialog, setShowImportDialog, addQueryTab, addTableTab,
    updateActiveConnectionConfig, setDataResult, setDbFilter, setTableFilter,
    setLoadingData, setDataPage, setDataTotalRows, setDataPageSize,
  } = useAppStore(useShallow(s => ({
    setDatabases: s.setDatabases,
    setDatabasesForSession: s.setDatabasesForSession,
    toggleDb: s.toggleDb,
    setTables: s.setTables,
    setExpandedTables: s.setExpandedTables,
    setColumns: s.setColumns,
    setSelectedDatabase: s.setSelectedDatabase,
    setShowColorEditor: s.setShowColorEditor,
    setShowExportDialog: s.setShowExportDialog,
    setShowImportDialog: s.setShowImportDialog,
    addQueryTab: s.addQueryTab,
    addTableTab: s.addTableTab,
    updateActiveConnectionConfig: s.updateActiveConnectionConfig,
    setDataResult: s.setDataResult,
    setDbFilter: s.setDbFilter,
    setTableFilter: s.setTableFilter,
    setLoadingData: s.setLoadingData,
    setDataPage: s.setDataPage,
    setDataTotalRows: s.setDataTotalRows,
    setDataPageSize: s.setDataPageSize,
  })));

  // Per-connection Object Browser colors
  const bgColor = activeConnectionConfig?.bg_color || "var(--bg-panel)";
  const fgColor = activeConnectionConfig?.fg_color || undefined;
  const selectedColor = activeConnectionConfig?.selected_color || "var(--bg-selected)";

  const previewRequestId = useRef(0);
  const [loadingNodes, setLoadingNodes] = useState<Set<string>>(new Set());
  const [errorNodes, setErrorNodes] = useState<Set<string>>(new Set());
  const [dbLoadError, setDbLoadError] = useState<string | null>(null);
  const startLoading = useCallback((key: string) => {
    setErrorNodes(prev => { const next = new Set(prev); next.delete(key); return next; });
    setLoadingNodes(prev => new Set(prev).add(key));
  }, []);
  const stopLoading = useCallback((key: string) => setLoadingNodes(prev => { const next = new Set(prev); next.delete(key); return next; }), []);
  const setError = useCallback((key: string) => setErrorNodes(prev => new Set(prev).add(key)), []);

  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [showCreateDbDialog, setShowCreateDbDialog] = useState(false);
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    variant: "danger" | "warning";
    onConfirm: () => void;
  } | null>(null);
  const [activeColorKey, setActiveColorKey] = useState<"bg_color" | "fg_color" | "selected_color" | null>(null);
  // Draft colors for live preview without persisting
  const [draftColors, setDraftColors] = useState<Record<string, string>>({});
  const [originalColors, setOriginalColors] = useState<Record<string, string>>({});
  const filterInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const connectionLabel = `${activeConnectionConfig?.user ?? "root"}@${activeConnectionConfig?.host ?? "localhost"}`;
  const isConnectionLevel = selectedDatabase === null;
  const filterValue = isConnectionLevel ? dbFilter : tableFilter;
  const setFilterValue = isConnectionLevel ? setDbFilter : setTableFilter;

  useEffect(() => {
    if (!activeConnectionId || !activeSessionId) return;
    const sessionId = activeSessionId;
    const connId = activeConnectionId;
    setDbLoadError(null);
    startLoading("refresh:databases");
    invoke<string[]>("get_databases", { connectionId: connId })
      .then((dbs) => setDatabasesForSession(sessionId, dbs))
      .catch((e) => {
        console.error(e);
        setDbLoadError(String(e));
      })
      .finally(() => stopLoading("refresh:databases"));
  }, [activeConnectionId]);

  // Auto-fetch tables/columns for restored expanded nodes
  const restoredRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeConnectionId || databases.length === 0) return;
    if (restoredRef.current === activeConnectionId) return;
    restoredRef.current = activeConnectionId;

    const fetchExpandedData = async () => {
      for (const db of expandedDbs) {
        if (!databases.includes(db) || tables[db]) continue;
        try {
          const t = await invoke<{ name: string; table_type: string }[]>("get_tables", {
            connectionId: activeConnectionId,
            database: db,
          });
          setTables(db, t);
          for (const entry of t) {
            const key = `${db}.${entry.name}`;
            if (expandedTables.has(key) && !columns[key]) {
              try {
                const cols = await invoke<import("../../types").ColumnInfo[]>("get_columns", {
                  connectionId: activeConnectionId,
                  database: db,
                  table: entry.name,
                });
                setColumns(key, cols);
              } catch (e) {
                console.error(`Failed to load columns for ${key}:`, e);
              }
            }
          }
        } catch (e) {
          console.error(`Failed to load tables for ${db}:`, e);
        }
      }
    };
    fetchExpandedData();
  }, [activeConnectionId, databases]);

  // Initialize draft colors when editor opens
  useEffect(() => {
    if (showColorEditor) {
      const initial = {
        bg_color: activeConnectionConfig?.bg_color || "",
        fg_color: activeConnectionConfig?.fg_color || "",
        selected_color: activeConnectionConfig?.selected_color || "",
      };
      setDraftColors(initial);
      setOriginalColors(initial);
    }
  }, [showColorEditor]);

  // Close context menus on outside click
  useEffect(() => {
    const handler = () => { setContextMenu(null); };
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
  }, []);

  const updateDraft = (key: string, value: string) => {
    setDraftColors((prev) => ({ ...prev, [key]: value }));
    // Live preview: apply to store without persisting
    updateActiveConnectionConfig({ [key]: value || undefined });
  };

  const handleSaveColors = async () => {
    // Persist to profile if connected from a saved profile
    if (activeProfileId && activeConnectionConfig) {
      const profile = { id: activeProfileId, name: activeConnectionName ?? "", config: activeConnectionConfig };
      await invoke("save_connection", { profile }).catch(console.error);
    }
    setShowColorEditor(false);
    setActiveColorKey(null);
  };

  const handleCancelColors = () => {
    // Restore original colors
    updateActiveConnectionConfig({
      bg_color: originalColors.bg_color || undefined,
      fg_color: originalColors.fg_color || undefined,
      selected_color: originalColors.selected_color || undefined,
    });
    setShowColorEditor(false);
    setActiveColorKey(null);
  };

  const handleDbClick = (db: string) => {
    setSelectedDatabase(db);
  };

  const handleRefresh = () => {
    if (isConnectionLevel) {
      const key = "refresh:databases";
      const capturedSessionId = activeSessionId;
      const capturedConnId = activeConnectionId;
      setDbLoadError(null);
      startLoading(key);
      invoke<string[]>("get_databases", { connectionId: capturedConnId })
        .then((dbs) => setDatabasesForSession(capturedSessionId!, dbs))
        .catch((e) => {
          console.error(e);
          setDbLoadError(String(e));
        })
        .finally(() => stopLoading(key));
    } else if (selectedDatabase) {
      const nodeKey = `db:${selectedDatabase}`;
      startLoading(nodeKey);
      invoke<{ name: string; table_type: string }[]>("get_tables", {
        connectionId: activeConnectionId,
        database: selectedDatabase,
      })
        .then(t => setTables(selectedDatabase, t))
        .catch(console.error)
        .finally(() => stopLoading(nodeKey));
    }
  };

  const isRefreshing = isConnectionLevel
    ? loadingNodes.has("refresh:databases")
    : loadingNodes.has(`db:${selectedDatabase}`);

  const handleDbToggle = async (db: string) => {
    toggleDb(db);
    if (!expandedDbs.has(db) && !tables[db]) {
      const nodeKey = `db:${db}`;
      startLoading(nodeKey);
      try {
        const t = await invoke<{ name: string; table_type: string }[]>("get_tables", {
          connectionId: activeConnectionId,
          database: db,
        });
        setTables(db, t);
      } catch (e) {
        console.error(e);
        setError(nodeKey);
      } finally {
        stopLoading(nodeKey);
      }
    }
  };

  const handleDbDoubleClick = (db: string) => {
    const snippet = `\`${db}\``;
    const state = useAppStore.getState();
    const session = getActiveSession(state);
    const activeTab = session?.queryTabs.find((t) => t.id === session.activeTabId);

    if (activeTab && activeTab.type === "query") {
      state.updateTabSql(activeTab.id, activeTab.sql + snippet);
    } else {
      addQueryTab(undefined, snippet);
    }
  };

  const tableKey = (db: string, table: string) => `${db}.${table}`;

  const toggleTable = async (db: string, table: string) => {
    const key = tableKey(db, table);
    const next = new Set(expandedTables);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
      if (!columns[key]) {
        const nodeKey = `col:${key}`;
        startLoading(nodeKey);
        try {
          const cols = await invoke<import("../../types").ColumnInfo[]>("get_columns", {
            connectionId: activeConnectionId,
            database: db,
            table,
          });
          setColumns(key, cols);
        } catch (e) {
          console.error(e);
          setError(nodeKey);
        } finally {
          stopLoading(nodeKey);
        }
      }
    }
    setExpandedTables(next);
  };

  const loadTablePreview = async (db: string, table: string, page = 0) => {
    if (!activeConnectionId) return;
    setSelectedDatabase(db);
    const key = tableKey(db, table);
    // Skip si la misma tabla ya está cargada en la misma página
    if (dataTableName === key && page === 0) return;
    const requestId = ++previewRequestId.current;
    setLoadingData(true);
    try {
      const { table_data_limit } = useAppStore.getState().settings;
      const pageSize = table_data_limit !== null ? table_data_limit : UNLIMITED_PAGE_SIZE;
      // Fase 1: cargar datos + columnas en paralelo — mostrar data sin esperar COUNT(*)
      const [result, cols] = await Promise.all([
        invoke<import("../../types").QueryResult>("get_table_data", {
          connectionId: activeConnectionId,
          database: db,
          table,
          page,
          limit: pageSize,
        }),
        columns[key]
          ? Promise.resolve(columns[key])
          : invoke<import("../../types").ColumnInfo[]>("get_columns", {
              connectionId: activeConnectionId,
              database: db,
              table,
            }),
      ]);
      if (requestId !== previewRequestId.current) return;
      if (!columns[key]) {
        setColumns(key, cols);
      }
      setDataResult(result, `${db}.${table}`, db, table, cols);
      setDataPage(page);
      setDataPageSize(pageSize);
      setLoadingData(false);
      // Fase 2: COUNT(*) asíncrono — actualiza totalRows sin bloquear el UI
      const offset = page * pageSize;
      if (result.rows.length < pageSize) {
        // Página incompleta: sabemos el total exacto sin query adicional
        setDataTotalRows(offset + result.rows.length);
      } else {
        invoke<import("../../types").QueryResult>("execute_query", {
          connectionId: activeConnectionId,
          sql: `SELECT COUNT(*) AS cnt FROM \`${db}\`.\`${table}\``,
        }).then((countResult) => {
          if (requestId !== previewRequestId.current) return;
          const totalRows = countResult.rows[0]?.[0];
          setDataTotalRows(typeof totalRows === "number" ? totalRows : Number(totalRows));
        }).catch(console.error);
      }
    } catch (e) {
      console.error(e);
      if (requestId === previewRequestId.current) {
        setLoadingData(false);
      }
    }
  };

  const openTableData = (db: string, table: string) => {
    addTableTab(db, table);
    setSelectedDatabase(db);
  };

  const openQuerySelect = (db: string, table: string) => {
    const snippet = `SELECT * FROM \`${db}\`.\`${table}\` LIMIT 1000;`;
    const state = useAppStore.getState();
    const session = getActiveSession(state);
    const activeTab = session?.queryTabs.find((t) => t.id === session.activeTabId);

    if (activeTab && activeTab.type === "query") {
      // Append to the active query tab (with newline if there's existing content)
      const newSql = activeTab.sql.trim() ? `${activeTab.sql}\n${snippet}` : snippet;
      state.updateTabSql(activeTab.id, newSql);
    } else {
      // No active query tab — create a new one
      addQueryTab(undefined, snippet);
    }
    setSelectedDatabase(db);
  };

  const handleDbContextMenu = (e: React.MouseEvent, db: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ type: "database", x: e.clientX, y: e.clientY, database: db });
  };

  const handleTableContextMenu = (e: React.MouseEvent, db: string, table: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ type: "table", x: e.clientX, y: e.clientY, database: db, table });
  };

  const rowHover = {
    onMouseEnter: (e: React.MouseEvent<HTMLDivElement>) =>
      ((e.currentTarget as HTMLDivElement).style.background = "var(--bg-hover)"),
    onMouseLeave: (e: React.MouseEvent<HTMLDivElement>) =>
      ((e.currentTarget as HTMLDivElement).style.background = "transparent"),
  };

  return (
    <div
      ref={containerRef}
      style={{ display: "flex", flexDirection: "column", height: "100%", background: bgColor, color: fgColor, overflow: "hidden" }}
    >
      {/* Header */}
      <div style={{ padding: "6px 10px", borderBottom: "1px solid var(--border)", fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
        Object Browser
      </div>

      {/* Color editor modal */}
      {showColorEditor && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 50,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "transparent",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div
            style={{
              background: "var(--bg-panel)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: 20,
              width: 320,
              display: "flex",
              flexDirection: "column",
              gap: 12,
              boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-bright)" }}>Connection Colors</span>
            {([
              ["Background", "bg_color", "#252526"],
              ["Foreground", "fg_color", "#cccccc"],
              ["Selected", "selected_color", "#094771"],
            ] as const).map(([label, key, defaultColor]) => {
              const current = draftColors[key] || "";
              return (
                <div key={key}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div
                      onClick={() => setActiveColorKey(activeColorKey === key ? null : key)}
                      style={{
                        width: 24, height: 20, borderRadius: 3, cursor: "pointer",
                        border: activeColorKey === key ? "2px solid var(--accent)" : "1px solid var(--border)",
                        background: current || defaultColor,
                        flexShrink: 0,
                      }}
                      title="Click to pick color"
                    />
                    <label style={{ fontSize: 12, width: 80, color: "var(--text-muted)" }}>{label}</label>
                    <HexColorInput
                      color={current || defaultColor}
                      onChange={(c) => updateDraft(key, c)}
                      prefixed
                      style={{ width: 80, fontSize: 12, fontFamily: "monospace" }}
                    />
                    {current && (
                      <button
                        className="btn-secondary"
                        style={{ padding: "2px 8px", fontSize: 10 }}
                        onClick={() => updateDraft(key, "")}
                      >
                        Reset
                      </button>
                    )}
                  </div>
                  {activeColorKey === key && (
                    <div style={{ marginTop: 6 }}>
                      <HexColorPicker
                        color={current || defaultColor}
                        onChange={(c) => updateDraft(key, c)}
                        style={{ width: "100%", height: 140 }}
                      />
                    </div>
                  )}
                </div>
              );
            })}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
              <button className="btn-secondary" onClick={handleCancelColors}>
                Cancel
              </button>
              <button className="btn-primary" onClick={handleSaveColors}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Connection row (user@ip) */}
      <div
        onClick={() => setSelectedDatabase(null)}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setContextMenu({ type: "connection", x: e.clientX, y: e.clientY }); }}
        style={{
          padding: "4px 8px",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: 5,
          background: isConnectionLevel ? selectedColor : "transparent",
          borderBottom: "1px solid var(--border)",
        }}
        onMouseEnter={(e) => { if (!isConnectionLevel) (e.currentTarget as HTMLDivElement).style.background = "var(--bg-hover)"; }}
        onMouseLeave={(e) => { if (!isConnectionLevel) (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
      >
        <span style={{ color: "var(--success)", fontSize: 8 }}>⬤</span>
        <span style={{ fontSize: 12 }}>{connectionLabel}</span>
      </div>

      {/* Filter input + refresh button */}
      <div style={{ padding: "4px 8px", borderBottom: "1px solid var(--border)", display: "flex", gap: 4, alignItems: "center" }}>
        <input
          ref={filterInputRef}
          value={filterValue}
          onChange={(e) => setFilterValue(e.target.value)}
          placeholder={isConnectionLevel ? "Filter databases..." : `Filter tables in ${selectedDatabase}...`}
          style={{
            flex: 1,
            fontSize: 11,
            padding: "3px 6px",
            background: "var(--bg-surface)",
            border: "1px solid var(--border)",
            borderRadius: 3,
            color: "var(--text)",
            outline: "none",
          }}
        />
        <button
          onClick={handleRefresh}
          disabled={isRefreshing || !activeConnectionId}
          title={isConnectionLevel ? "Refresh databases" : `Refresh tables in ${selectedDatabase}`}
          style={{
            flexShrink: 0,
            width: 24,
            height: 24,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "var(--bg-surface)",
            border: "1px solid var(--border)",
            borderRadius: 3,
            color: "var(--text-muted)",
            cursor: isRefreshing ? "default" : "pointer",
            opacity: isRefreshing ? 0.6 : 1,
            fontSize: 13,
            lineHeight: 1,
            padding: 0,
          }}
        >
          {isRefreshing ? <span className="spinner spinner-sm" /> : "⟳"}
        </button>
      </div>

      {/* Tree */}
      <div
        style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}
        onContextMenu={(e) => { e.preventDefault(); setContextMenu({ type: "connection", x: e.clientX, y: e.clientY }); }}
      >
        {isRefreshing && databases.length === 0 ? (
          <div style={{ padding: "8px 14px", fontSize: 12, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 6 }}>
            <span className="spinner spinner-sm" />
            {reconnectingSessionId === activeSessionId ? "Reconnecting..." : "Loading databases..."}
          </div>
        ) : dbLoadError && databases.length === 0 ? (
          <div style={{ padding: "12px 14px", fontSize: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={{ color: "var(--danger)" }}>Connection lost.</span>
            <button
              className="btn-primary"
              style={{ fontSize: 11, padding: "4px 10px", alignSelf: "flex-start" }}
              disabled={reconnectingSessionId === activeSessionId}
              onClick={() => reconnectSession(activeSessionId!)}
            >
              {reconnectingSessionId === activeSessionId ? "Reconnecting..." : "Reconnect"}
            </button>
          </div>
        ) : databases
          .filter((db) => !dbFilter || db.toLowerCase().includes(dbFilter.toLowerCase()))
          .map((db) => (
          <div key={db}>
            {/* Database row */}
            <div
              onClick={() => handleDbClick(db)}
              onDoubleClick={(e) => { e.preventDefault(); handleDbDoubleClick(db); }}
              onContextMenu={(e) => handleDbContextMenu(e, db)}
              style={{
                padding: "3px 8px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 5,
                userSelect: "none",
                background: selectedDatabase === db ? selectedColor : "transparent",
              }}
              onMouseEnter={(e) => { if (selectedDatabase !== db) (e.currentTarget as HTMLDivElement).style.background = "var(--bg-hover)"; }}
              onMouseLeave={(e) => { if (selectedDatabase !== db) (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
            >
              <span
                onClick={(e) => { e.stopPropagation(); handleDbToggle(db); }}
                style={{ fontSize: 10, color: "var(--text-muted)", width: 12, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
              >
                {loadingNodes.has(`db:${db}`) ? <span className="spinner spinner-sm" /> : expandedDbs.has(db) ? "▼" : "▶"}
              </span>
              <span style={{ color: "#e8c08c" }}>🗄</span>
              <span style={{ fontSize: 13 }}>{db}</span>
            </div>

            {/* Tables */}
            {expandedDbs.has(db) && (
              <div>
                {(tables[db] ?? [])
                  .filter((t) => !tableFilter || selectedDatabase !== db || t.name.toLowerCase().includes(tableFilter.toLowerCase()))
                  .map((t) => {
                  const key = tableKey(db, t.name);
                  const isExpanded = expandedTables.has(key);
                  const isSelected = dataTableName === key;
                  return (
                    <div key={t.name}>
                      {/* Table row */}
                      <div
                        style={{
                          padding: "3px 8px 3px 26px",
                          cursor: "pointer",
                          display: "flex",
                          alignItems: "center",
                          gap: 5,
                          background: isSelected ? selectedColor : "transparent",
                        }}
                        onClick={() => loadTablePreview(db, t.name)}
                        onDoubleClick={() => openTableData(db, t.name)}
                        onContextMenu={(e) => handleTableContextMenu(e, db, t.name)}
                        onMouseEnter={(e) => { if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = "var(--bg-hover)"; }}
                        onMouseLeave={(e) => { if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
                      >
                        <span
                          onClick={(e) => { e.stopPropagation(); toggleTable(db, t.name); }}
                          style={{ fontSize: 9, color: "var(--text-muted)", width: 12, flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center" }}
                        >
                          {loadingNodes.has(`col:${key}`) ? <span className="spinner spinner-sm" /> : isExpanded ? "▼" : "▶"}
                        </span>
                        <span style={{ color: t.table_type === "VIEW" ? "#9cdcfe" : "#4fc1ff" }}>
                          {t.table_type === "VIEW" ? "◈" : "▤"}
                        </span>
                        <span style={{ fontSize: 13 }}>{t.name}</span>
                      </div>

                      {/* Columns */}
                      {isExpanded && (
                        <div>
                          {(columns[key] ?? []).map((col) => (
                            <div
                              key={col.field}
                              style={{ padding: "2px 8px 2px 52px", display: "flex", alignItems: "center", gap: 5, cursor: "default" }}
                              {...rowHover}
                            >
                              <span style={{ fontSize: 10, color: col.key === "PRI" ? "#f9c74f" : col.key === "MUL" ? "#9cdcfe" : "var(--text-muted)" }}>
                                {col.key === "PRI" ? "🔑" : col.key === "MUL" ? "🔗" : "○"}
                              </span>
                              <span style={{ fontSize: 12, color: "var(--text)" }}>{col.field}</span>
                              <span style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "monospace" }}>
                                {col.column_type}
                              </span>
                            </div>
                          ))}
                          {!columns[key] && (
                            <div style={{ padding: "2px 52px", fontSize: 11, color: errorNodes.has(`col:${key}`) ? "var(--danger)" : "var(--text-muted)" }}>
                              {errorNodes.has(`col:${key}`) ? "Failed to load columns" : "Loading…"}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                {tables[db] === undefined && (
                  <div style={{ padding: "3px 30px", fontSize: 12, color: errorNodes.has(`db:${db}`) ? "var(--danger)" : "var(--text-muted)" }}>
                    {errorNodes.has(`db:${db}`) ? "Failed to load tables" : "Loading…"}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Database context menu */}
      {contextMenu?.type === "database" && (() => {
        const { database, x, y } = contextMenu;
        return (
          <ContextMenu
            x={x} y={y}
            entityType="database"
            entityName={database}
            groups={[
              {
                items: [
                  {
                    icon: <IconRefresh />,
                    label: "Refresh",
                    action: () => {
                      setContextMenu(null);
                      const nodeKey = `db:${database}`;
                      startLoading(nodeKey);
                      invoke<{ name: string; table_type: string }[]>("get_tables", { connectionId: activeConnectionId, database })
                        .then(t => setTables(database, t))
                        .catch(console.error)
                        .finally(() => stopLoading(nodeKey));
                    },
                  },
                  {
                    icon: <IconQuery />,
                    label: "New Query",
                    action: () => { setContextMenu(null); setSelectedDatabase(database); addQueryTab(); },
                  },
                ],
              },
              {
                items: [
                  {
                    icon: <IconExport />,
                    label: "Export Database",
                    action: () => { setContextMenu(null); setSelectedDatabase(database); setShowExportDialog(true); },
                  },
                  {
                    icon: <IconImport />,
                    label: "Import Database",
                    action: () => { setContextMenu(null); setSelectedDatabase(database); setShowImportDialog(true); },
                  },
                  {
                    icon: <IconCopy />,
                    label: "Copy Name",
                    action: () => { setContextMenu(null); writeText(database).catch(console.error); },
                  },
                ],
              },
              {
                items: [
                  {
                    icon: <IconTruncate />,
                    label: "Drop All Tables",
                    variant: "warning",
                    action: () => {
                      setContextMenu(null);
                      setConfirmDialog({
                        title: "Drop All Tables",
                        message: `Are you sure you want to drop all tables in "${database}"? This action cannot be undone.`,
                        variant: "warning",
                        onConfirm: () => {
                          invoke("drop_all_tables", { connectionId: activeConnectionId, database })
                            .then(() => setTables(database, []))
                            .catch(console.error);
                        },
                      });
                    },
                  },
                  {
                    icon: <IconTrash />,
                    label: "Drop Database",
                    variant: "danger",
                    action: () => {
                      setContextMenu(null);
                      setConfirmDialog({
                        title: "Drop Database",
                        message: `Are you sure you want to drop the database "${database}"? All data will be permanently lost.`,
                        variant: "danger",
                        onConfirm: () => {
                          invoke("drop_database", { connectionId: activeConnectionId, database })
                            .then(() => {
                              const currentDbs = getActiveSession(useAppStore.getState())?.databases ?? [];
                              setDatabases(currentDbs.filter(d => d !== database));
                              setSelectedDatabase(null);
                              setDataResult(null, null);
                            })
                            .catch(console.error);
                        },
                      });
                    },
                  },
                ],
              },
            ]}
          />
        );
      })()}

      {/* Table context menu */}
      {contextMenu?.type === "table" && (() => {
        const { database, table, x, y } = contextMenu;
        const colKey = tableKey(database, table);
        return (
          <ContextMenu
            x={x} y={y}
            entityType="table"
            entityName={table}
            groups={[
              {
                items: [
                  {
                    icon: <IconOpenTable />,
                    label: "Open Table (Data + Structure)",
                    action: () => { openTableData(database, table); setContextMenu(null); },
                  },
                  {
                    icon: <IconSelectRows />,
                    label: "Select 1000 rows",
                    action: () => { openQuerySelect(database, table); setContextMenu(null); },
                  },
                ],
              },
              {
                items: [
                  {
                    icon: <IconCopy />,
                    label: "Copy Table Name",
                    action: () => { setContextMenu(null); writeText(table).catch(console.error); },
                  },
                  {
                    icon: <IconRefresh />,
                    label: "Refresh Columns",
                    action: () => {
                      setContextMenu(null);
                      const nodeKey = `col:${colKey}`;
                      startLoading(nodeKey);
                      invoke<import("../../types").ColumnInfo[]>("get_columns", { connectionId: activeConnectionId, database, table })
                        .then(cols => setColumns(colKey, cols))
                        .catch(console.error)
                        .finally(() => stopLoading(nodeKey));
                    },
                  },
                ],
              },
              {
                items: [
                  {
                    icon: <IconTruncate />,
                    label: "Truncate Table",
                    variant: "warning",
                    action: () => {
                      setContextMenu(null);
                      setConfirmDialog({
                        title: "Truncate Table",
                        message: `Are you sure you want to truncate "${table}"? All data will be deleted but the table structure will remain.`,
                        variant: "warning",
                        onConfirm: () => {
                          invoke("truncate_table", { connectionId: activeConnectionId, database, table })
                            .catch(console.error);
                        },
                      });
                    },
                  },
                  {
                    icon: <IconTrash />,
                    label: "Drop Table",
                    variant: "danger",
                    action: () => {
                      setContextMenu(null);
                      setConfirmDialog({
                        title: "Drop Table",
                        message: `Are you sure you want to drop the table "${table}"? This action cannot be undone.`,
                        variant: "danger",
                        onConfirm: () => {
                          invoke("drop_table", { connectionId: activeConnectionId, database, table })
                            .then(() => {
                              const currentTables = getActiveSession(useAppStore.getState())?.tables[database] ?? [];
                              setTables(database, currentTables.filter(tbl => tbl.name !== table));
                            })
                            .catch(console.error);
                        },
                      });
                    },
                  },
                ],
              },
            ]}
          />
        );
      })()}

      {/* Connection context menu */}
      {contextMenu?.type === "connection" && (
        <ContextMenu
          x={contextMenu.x} y={contextMenu.y}
          entityType="connection"
          entityName={connectionLabel}
          groups={[{
            items: [{
              icon: <IconDatabase />,
              label: "Create Database",
              action: () => { setContextMenu(null); setShowCreateDbDialog(true); },
            }],
          }]}
        />
      )}

      {/* Create Database dialog */}
      {showCreateDbDialog && activeConnectionId && (
        <CreateDatabaseDialog
          connectionId={activeConnectionId}
          onCreated={(dbName) => {
            setShowCreateDbDialog(false);
            const capturedSessionId = activeSessionId;
            const capturedConnId = activeConnectionId;
            invoke<string[]>("get_databases", { connectionId: capturedConnId })
              .then((dbs) => { setDatabasesForSession(capturedSessionId!, dbs); setSelectedDatabase(dbName); })
              .catch(console.error);
          }}
          onClose={() => setShowCreateDbDialog(false)}
        />
      )}

      {/* Confirm dialog */}
      {confirmDialog && (
        <ConfirmDialog
          title={confirmDialog.title}
          message={confirmDialog.message}
          variant={confirmDialog.variant}
          confirmLabel="Yes, proceed"
          onConfirm={() => { confirmDialog.onConfirm(); setConfirmDialog(null); }}
          onCancel={() => setConfirmDialog(null)}
        />
      )}
    </div>
  );
}
