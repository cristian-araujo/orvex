import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import { useShallow } from "zustand/react/shallow";
import { useAppStore, getActiveSession } from "../../store/useAppStore";
import type { ExportFormat, ExportContent, ExportOptions } from "../../types";



// Thin custom checkbox that matches the tool's aesthetic
function Tick({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <div
      onClick={onChange}
      style={{
        width: 13,
        height: 13,
        border: `1px solid ${checked ? "var(--accent)" : "var(--border)"}`,
        background: checked ? "var(--accent)" : "transparent",
        borderRadius: 2,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        cursor: "pointer",
        transition: "border-color 0.1s, background 0.1s",
      }}
    >
      {checked && (
        <svg width="8" height="6" viewBox="0 0 8 6" fill="none">
          <path d="M1 3L3 5L7 1" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </div>
  );
}

const FORMAT_META: { id: ExportFormat; label: string; ext: string; desc: string }[] = [
  { id: "Sql", label: "SQL", ext: "sql", desc: "MySQL dump, re-importable" },
  { id: "Csv", label: "CSV", ext: "csv", desc: "Spreadsheet compatible" },
  { id: "Json", label: "JSON", ext: "json", desc: "Structured data array" },
];

const CONTENT_META: { id: ExportContent; label: string }[] = [
  { id: "StructureAndData", label: "Structure + Data" },
  { id: "StructureOnly", label: "Structure only" },
  { id: "DataOnly", label: "Data only" },
];

const SQL_OPTIONS: { key: string; label: string }[] = [
  { key: "dropTable", label: "DROP TABLE IF EXISTS" },
  { key: "dropDatabase", label: "DROP DATABASE IF EXISTS" },
  { key: "createDatabase", label: "CREATE DATABASE" },
  { key: "lockTables", label: "LOCK TABLES" },
  { key: "disableForeignKeys", label: "Disable FK Checks" },
  { key: "setNames", label: "SET NAMES utf8mb4" },
  { key: "addTimestamps", label: "Add timestamps header" },
  { key: "hexBinary", label: "Hex-encode BINARY/BLOB" },
  { key: "extendedInserts", label: "Extended INSERTs" },
];

export function ExportDialog() {
  const { connectionId, selectedDatabase, setShowExportDialog, setActiveOperation } =
    useAppStore(useShallow((s) => {
      const session = getActiveSession(s);
      return {
        connectionId: session?.connectionId ?? null,
        selectedDatabase: session?.selectedDatabase ?? null,
        setShowExportDialog: s.setShowExportDialog,
        setActiveOperation: s.setActiveOperation,
      };
    }));

  const [format, setFormat] = useState<ExportFormat>("Sql");
  const [content, setContent] = useState<ExportContent>("StructureAndData");
  const [database, setDatabase] = useState(selectedDatabase ?? "");
  const [tableFilter, setTableFilter] = useState("");
  const [availableTables, setAvailableTables] = useState<string[]>([]);
  const [selectedTables, setSelectedTables] = useState<Set<string>>(new Set());
  const [loadingTables, setLoadingTables] = useState(false);
  const [showOptions, setShowOptions] = useState(false);
  const [starting, setStarting] = useState(false);

  const [sqlOpts, setSqlOpts] = useState({
    dropTable: true,
    dropDatabase: false,
    createDatabase: false,
    lockTables: true,
    disableForeignKeys: true,
    setNames: true,
    addTimestamps: true,
    hexBinary: true,
    extendedInserts: true,
  });
  const [extendedInsertRows, setExtendedInsertRows] = useState(1000);

  const dbDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!database || !connectionId) return;
    if (dbDebounce.current) clearTimeout(dbDebounce.current);
    dbDebounce.current = setTimeout(() => {
      setLoadingTables(true);
      invoke<{ name: string; table_type: string }[]>("get_tables", { connectionId, database })
        .then((tables) => {
          const names = tables.map((t) => t.name);
          setAvailableTables(names);
          setSelectedTables(new Set(names));
        })
        .catch(() => setAvailableTables([]))
        .finally(() => setLoadingTables(false));
    }, 400);
  }, [database, connectionId]);

  const filteredTables = tableFilter
    ? availableTables.filter((t) => t.toLowerCase().includes(tableFilter.toLowerCase()))
    : availableTables;

  const toggleTable = (t: string) => {
    setSelectedTables((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  };

  const handleExport = async () => {
    if (!connectionId || !database || selectedTables.size === 0) return;
    const meta = FORMAT_META.find((f) => f.id === format)!;
    const filePath = await save({
      defaultPath: `${database}.${meta.ext}`,
      filters: [{ name: meta.label, extensions: [meta.ext] }],
    });
    if (!filePath) return;

    setStarting(true);
    try {
      const options: ExportOptions = {
        format,
        content,
        database,
        tables: [...selectedTables],
        file_path: filePath,
        drop_table: sqlOpts.dropTable,
        drop_database: sqlOpts.dropDatabase,
        create_database: sqlOpts.createDatabase,
        lock_tables: sqlOpts.lockTables,
        disable_foreign_keys: sqlOpts.disableForeignKeys,
        extended_inserts: sqlOpts.extendedInserts,
        extended_insert_rows: extendedInsertRows,
        set_names: sqlOpts.setNames,
        add_timestamps: sqlOpts.addTimestamps,
        hex_binary: sqlOpts.hexBinary,
      };
      const operationId = await invoke<string>("start_export", { connectionId, options });
      setShowExportDialog(false);
      setActiveOperation({ type: "export", operationId });
    } catch (e) {
      alert(String(e));
    } finally {
      setStarting(false);
    }
  };

  const isSql = format === "Sql";
  const canExport = !!database && selectedTables.size > 0 && !starting;

  const label: React.CSSProperties = {
    fontSize: 10,
    letterSpacing: "0.08em",
    fontWeight: 700,
    color: "var(--text-muted)",
    textTransform: "uppercase",
    marginBottom: 6,
  };

  return (
    <>
      <style>{`
        @keyframes dlg-in {
          from { opacity: 0; transform: scale(0.975) translateY(10px); }
          to   { opacity: 1; transform: scale(1)     translateY(0);    }
        }
        .export-dlg { animation: dlg-in 0.18s cubic-bezier(0.16,1,0.3,1); }
        .tbl-row:hover { background: var(--bg-hover) !important; }
        .fmt-card:hover { border-color: var(--accent) !important; }
        .opt-row:hover { background: rgba(255,255,255,0.03) !important; }
      `}</style>
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 100,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(0,0,0,0.55)",
          backdropFilter: "blur(2px)",
        }}
        onClick={() => setShowExportDialog(false)}
      >
        <div
          className="export-dlg"
          style={{
            background: "var(--bg-panel)",
            border: "1px solid var(--border)",
            borderRadius: 5,
            width: 700,
            maxHeight: "88vh",
            display: "flex",
            flexDirection: "column",
            boxShadow: "0 24px 64px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.04)",
            overflow: "hidden",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div style={{
            padding: "14px 20px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexShrink: 0,
          }}>
            <div>
              <div style={{ fontSize: 10, letterSpacing: "0.12em", color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", marginBottom: 2 }}>
                Database Export
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-bright)" }}>
                Configure export settings
              </div>
            </div>
            <button
              onClick={() => setShowExportDialog(false)}
              style={{
                background: "transparent",
                border: "none",
                color: "var(--text-muted)",
                fontSize: 16,
                padding: "4px 6px",
                cursor: "pointer",
                lineHeight: 1,
                borderRadius: 3,
              }}
            >
              ✕
            </button>
          </div>

          {/* Body — two columns */}
          <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

            {/* LEFT: config */}
            <div style={{
              width: 260,
              flexShrink: 0,
              borderRight: "1px solid var(--border)",
              padding: "16px 16px",
              display: "flex",
              flexDirection: "column",
              gap: 18,
              overflowY: "auto",
            }}>

              {/* Format */}
              <div>
                <div style={label}>Format</div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {FORMAT_META.map((f) => (
                    <div
                      key={f.id}
                      className="fmt-card"
                      onClick={() => setFormat(f.id)}
                      style={{
                        padding: "8px 10px",
                        border: `1px solid ${format === f.id ? "var(--accent)" : "var(--border)"}`,
                        borderLeft: `3px solid ${format === f.id ? "var(--accent)" : "transparent"}`,
                        background: format === f.id ? "rgba(0,120,212,0.08)" : "var(--bg-surface)",
                        borderRadius: 3,
                        cursor: "pointer",
                        transition: "all 0.1s",
                      }}
                    >
                      <div style={{
                        fontSize: 11,
                        fontWeight: 700,
                        letterSpacing: "0.06em",
                        color: format === f.id ? "var(--accent)" : "var(--text-bright)",
                        
                      }}>
                        .{f.ext.toUpperCase()}
                        <span style={{ fontWeight: 400, marginLeft: 6, letterSpacing: 0 }}>
                          {f.label}
                        </span>
                      </div>
                      <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>
                        {f.desc}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Content (SQL only) */}
              {isSql && (
                <div>
                  <div style={label}>Content</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    {CONTENT_META.map((c) => (
                      <div
                        key={c.id}
                        onClick={() => setContent(c.id)}
                        style={{
                          padding: "7px 10px",
                          border: `1px solid ${content === c.id ? "var(--accent)" : "var(--border)"}`,
                          borderLeft: `3px solid ${content === c.id ? "var(--accent)" : "transparent"}`,
                          background: content === c.id ? "rgba(0,120,212,0.08)" : "var(--bg-surface)",
                          borderRadius: 3,
                          cursor: "pointer",
                          transition: "all 0.1s",
                          fontSize: 12,
                          color: content === c.id ? "var(--text-bright)" : "var(--text)",
                        }}
                      >
                        {c.label}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* SQL Options */}
              {isSql && (
                <div>
                  <button
                    onClick={() => setShowOptions((v) => !v)}
                    style={{
                      background: "transparent",
                      border: "1px solid var(--border)",
                      color: "var(--text-muted)",
                      borderRadius: 3,
                      padding: "5px 10px",
                      width: "100%",
                      textAlign: "left",
                      fontSize: 10,
                      letterSpacing: "0.08em",
                      fontWeight: 700,
                      textTransform: "uppercase",
                      display: "flex",
                      justifyContent: "space-between",
                      cursor: "pointer",
                    }}
                  >
                    SQL Options
                    <span>{showOptions ? "▴" : "▾"}</span>
                  </button>
                  {showOptions && (
                    <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 0 }}>
                      {SQL_OPTIONS.map((opt) => (
                        <div
                          key={opt.key}
                          className="opt-row"
                          onClick={() =>
                            opt.key === "extendedInserts"
                              ? setSqlOpts((s) => ({ ...s, extendedInserts: !s.extendedInserts }))
                              : setSqlOpts((s) => ({ ...s, [opt.key]: !(s as Record<string, boolean>)[opt.key] }))
                          }
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            padding: "5px 4px",
                            cursor: "pointer",
                            borderRadius: 2,
                            userSelect: "none",
                          }}
                        >
                          <Tick
                            checked={(sqlOpts as Record<string, boolean>)[opt.key]}
                            onChange={() =>
                              setSqlOpts((s) => ({ ...s, [opt.key]: !(s as Record<string, boolean>)[opt.key] }))
                            }
                          />
                          <span style={{ fontSize: 11, color: "var(--text)" }}>
                            {opt.label}
                          </span>
                        </div>
                      ))}
                      {sqlOpts.extendedInserts && (
                        <div style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          padding: "4px 4px 4px 24px",
                        }}>
                          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Rows/INSERT:</span>
                          <input
                            type="number"
                            min={1}
                            max={50000}
                            value={extendedInsertRows}
                            onChange={(e) => setExtendedInsertRows(Number(e.target.value) || 1000)}
                            onClick={(e) => e.stopPropagation()}
                            style={{ width: 64,  fontSize: 11 }}
                          />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* RIGHT: database + tables */}
            <div style={{
              flex: 1,
              padding: "16px 16px",
              display: "flex",
              flexDirection: "column",
              gap: 14,
              overflow: "hidden",
            }}>

              {/* Database */}
              <div>
                <div style={label}>Database</div>
                <input
                  type="text"
                  value={database}
                  onChange={(e) => setDatabase(e.target.value)}
                  placeholder="database name"
                  style={{ width: "100%",  fontSize: 12 }}
                />
              </div>

              {/* Tables */}
              <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
                <div style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 6,
                }}>
                  <div style={label}>
                    Tables —{" "}
                    <span style={{ color: "var(--accent)" }}>
                      {selectedTables.size}
                    </span>
                    <span style={{ color: "var(--text-muted)" }}>/{availableTables.length}</span>
                  </div>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button
                      onClick={() => setSelectedTables(new Set(availableTables))}
                      style={{
                        background: "transparent",
                        border: "1px solid var(--border)",
                        color: "var(--text-muted)",
                        padding: "1px 7px",
                        borderRadius: 2,
                        fontSize: 10,
                        cursor: "pointer",
                        letterSpacing: "0.06em",
                      }}
                    >
                      ALL
                    </button>
                    <button
                      onClick={() => setSelectedTables(new Set())}
                      style={{
                        background: "transparent",
                        border: "1px solid var(--border)",
                        color: "var(--text-muted)",
                        padding: "1px 7px",
                        borderRadius: 2,
                        fontSize: 10,
                        cursor: "pointer",
                        letterSpacing: "0.06em",
                      }}
                    >
                      NONE
                    </button>
                  </div>
                </div>

                {/* Search */}
                <input
                  type="text"
                  value={tableFilter}
                  onChange={(e) => setTableFilter(e.target.value)}
                  placeholder="Filter tables..."
                  style={{ width: "100%", marginBottom: 6, fontSize: 12 }}
                />

                {/* Table list */}
                <div style={{
                  flex: 1,
                  overflowY: "auto",
                  border: "1px solid var(--border)",
                  borderRadius: 3,
                  background: "var(--bg-base)",
                }}>
                  {loadingTables ? (
                    <div style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      padding: "12px 10px",
                      fontSize: 12,
                      color: "var(--text-muted)",
                    }}>
                      <span className="spinner spinner-sm" />
                      Loading tables...
                    </div>
                  ) : filteredTables.length === 0 ? (
                    <div style={{ padding: "12px 10px", fontSize: 12, color: "var(--text-muted)" }}>
                      {availableTables.length === 0 ? "No tables found" : "No matches"}
                    </div>
                  ) : (
                    filteredTables.map((t, idx) => {
                      const isSelected = selectedTables.has(t);
                      return (
                        <div
                          key={t}
                          className="tbl-row"
                          onClick={() => toggleTable(t)}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 9,
                            padding: "5px 10px",
                            background: idx % 2 === 0 ? "transparent" : "rgba(255,255,255,0.015)",
                            cursor: "pointer",
                            userSelect: "none",
                            borderLeft: `2px solid ${isSelected ? "var(--accent)" : "transparent"}`,
                            transition: "background 0.08s",
                          }}
                        >
                          <Tick checked={isSelected} onChange={() => toggleTable(t)} />
                          <span style={{
                            fontSize: 12,
                            
                            color: isSelected ? "var(--text-bright)" : "var(--text-muted)",
                          }}>
                            {t}
                          </span>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div style={{
            padding: "12px 20px",
            borderTop: "1px solid var(--border)",
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            flexShrink: 0,
            background: "rgba(0,0,0,0.15)",
          }}>
            <button
              className="btn-secondary"
              onClick={() => setShowExportDialog(false)}
            >
              Cancel
            </button>
            <button
              className="btn-primary"
              onClick={handleExport}
              disabled={!canExport}
              style={{ opacity: canExport ? 1 : 0.4, minWidth: 100 }}
            >
              {starting ? (
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span className="spinner spinner-sm" />
                  Starting...
                </span>
              ) : (
                "Export →"
              )}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
