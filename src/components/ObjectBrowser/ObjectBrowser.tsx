import { useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { HexColorPicker, HexColorInput } from "react-colorful";
import { useAppStore } from "../../store/useAppStore";

interface ContextMenu {
  x: number;
  y: number;
  database: string;
  table: string;
}

export function ObjectBrowser() {
  const {
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
    showColorEditor,
    setDatabases,
    toggleDb,
    setTables,
    setExpandedTables,
    setColumns,
    setSelectedDatabase,
    setShowColorEditor,
    addQueryTab,
    addTableTab,
    updateActiveConnectionConfig,
    setDataResult,
    dataTableName,
  } = useAppStore();

  // Per-connection Object Browser colors
  const bgColor = activeConnectionConfig?.bg_color || "var(--bg-panel)";
  const fgColor = activeConnectionConfig?.fg_color || undefined;
  const selectedColor = activeConnectionConfig?.selected_color || "var(--bg-selected)";

  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [activeColorKey, setActiveColorKey] = useState<"bg_color" | "fg_color" | "selected_color" | null>(null);
  // Draft colors for live preview without persisting
  const [draftColors, setDraftColors] = useState<Record<string, string>>({});
  const [originalColors, setOriginalColors] = useState<Record<string, string>>({});
  // Filter state: persists independently for each level
  const [dbFilter, setDbFilter] = useState("");
  const [tableFilter, setTableFilter] = useState("");
  const filterInputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const connectionLabel = `${activeConnectionConfig?.user ?? "root"}@${activeConnectionConfig?.host ?? "localhost"}`;
  const isConnectionLevel = selectedDatabase === null;
  const filterValue = isConnectionLevel ? dbFilter : tableFilter;
  const setFilterValue = isConnectionLevel ? setDbFilter : setTableFilter;

  useEffect(() => {
    if (!activeConnectionId) return;
    invoke<string[]>("get_databases", { connectionId: activeConnectionId })
      .then(setDatabases)
      .catch(console.error);
  }, [activeConnectionId]);

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

  const handleDbToggle = async (db: string) => {
    toggleDb(db);
    if (!expandedDbs.has(db) && !tables[db]) {
      try {
        const t = await invoke<{ name: string; table_type: string }[]>("get_tables", {
          connectionId: activeConnectionId,
          database: db,
        });
        setTables(db, t);
      } catch (e) {
        console.error(e);
      }
    }
  };

  const handleDbDoubleClick = (db: string) => {
    const snippet = `\`${db}\``;
    const state = useAppStore.getState();
    const activeTab = state.queryTabs.find((t) => t.id === state.activeTabId);

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
        try {
          const cols = await invoke<import("../../types").ColumnInfo[]>("get_columns", {
            connectionId: activeConnectionId,
            database: db,
            table,
          });
          setColumns(key, cols);
        } catch (e) {
          console.error(e);
        }
      }
    }
    setExpandedTables(next);
  };

  const loadTablePreview = async (db: string, table: string) => {
    if (!activeConnectionId) return;
    try {
      const sql = `SELECT * FROM \`${db}\`.\`${table}\` LIMIT 1000`;
      const result = await invoke<import("../../types").QueryResult>("execute_query", {
        connectionId: activeConnectionId,
        sql,
      });
      setDataResult(result, `${db}.${table}`);
    } catch (e) {
      console.error(e);
    }
  };

  const openTableData = (db: string, table: string) => {
    addTableTab(db, table);
    setSelectedDatabase(db);
  };

  const openQuerySelect = (db: string, table: string) => {
    const snippet = `SELECT * FROM \`${db}\`.\`${table}\` LIMIT 1000;`;
    const state = useAppStore.getState();
    const activeTab = state.queryTabs.find((t) => t.id === state.activeTabId);

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

  const handleTableContextMenu = (e: React.MouseEvent, db: string, table: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, database: db, table });
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

      {/* Filter input */}
      <div style={{ padding: "4px 8px", borderBottom: "1px solid var(--border)" }}>
        <input
          ref={filterInputRef}
          value={filterValue}
          onChange={(e) => setFilterValue(e.target.value)}
          placeholder={isConnectionLevel ? "Filter databases..." : `Filter tables in ${selectedDatabase}...`}
          style={{
            width: "100%",
            fontSize: 11,
            padding: "3px 6px",
            background: "var(--bg-surface)",
            border: "1px solid var(--border)",
            borderRadius: 3,
            color: "var(--text)",
            outline: "none",
          }}
        />
      </div>

      {/* Tree */}
      <div style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}>
        {databases
          .filter((db) => !dbFilter || db.toLowerCase().includes(dbFilter.toLowerCase()))
          .map((db) => (
          <div key={db}>
            {/* Database row */}
            <div
              onClick={() => handleDbClick(db)}
              onDoubleClick={(e) => { e.preventDefault(); handleDbDoubleClick(db); }}
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
                style={{ fontSize: 10, color: "var(--text-muted)", width: 12, cursor: "pointer" }}
              >
                {expandedDbs.has(db) ? "▼" : "▶"}
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
                          style={{ fontSize: 9, color: "var(--text-muted)", width: 12, flexShrink: 0 }}
                        >
                          {isExpanded ? "▼" : "▶"}
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
                            <div style={{ padding: "2px 52px", color: "var(--text-muted)", fontSize: 11 }}>Loading…</div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
                {tables[db] === undefined && (
                  <div style={{ padding: "3px 30px", color: "var(--text-muted)", fontSize: 12 }}>Loading…</div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Table context menu */}
      {contextMenu && (
        <div
          style={{
            position: "fixed",
            top: contextMenu.y,
            left: contextMenu.x,
            background: "var(--bg-surface)",
            border: "1px solid var(--border)",
            borderRadius: 4,
            zIndex: 1000,
            minWidth: 180,
            boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {[
            {
              label: "▤  Open Table (Data + Structure)",
              action: () => { openTableData(contextMenu.database, contextMenu.table); setContextMenu(null); },
            },
            {
              label: "▶  Select 1000 rows (Query tab)",
              action: () => { openQuerySelect(contextMenu.database, contextMenu.table); setContextMenu(null); },
            },
          ].map((item) => (
            <div
              key={item.label}
              onClick={item.action}
              style={{ padding: "7px 14px", cursor: "pointer", fontSize: 12, whiteSpace: "nowrap" }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLDivElement).style.background = "var(--bg-hover)")}
              onMouseLeave={(e) => ((e.currentTarget as HTMLDivElement).style.background = "transparent")}
            >
              {item.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
