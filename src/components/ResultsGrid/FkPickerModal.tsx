import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { QueryResult } from "../../types";

interface FkPickerModalProps {
  columnName: string;
  referencedTable: string;
  referencedColumn: string;
  currentValue: unknown;
  nullable: boolean;
  connectionId: string;
  database: string;
  onSelect: (value: unknown) => void;
  onClose: () => void;
}

export function FkPickerModal({
  columnName,
  referencedTable,
  referencedColumn,
  currentValue,
  nullable,
  connectionId,
  database,
  onSelect,
  onClose,
}: FkPickerModalProps) {
  const [rows, setRows] = useState<unknown[][]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedValue, setSelectedValue] = useState<unknown>(currentValue);
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const columnsRef = useRef<string[]>([]);

  const fetchData = useCallback(async (quickFilter: string, cols: string[]) => {
    setIsLoading(true);
    try {
      const result = await invoke<QueryResult>("get_table_data", {
        connectionId,
        database,
        table: referencedTable,
        page: 0,
        limit: 200,
        quickFilter: quickFilter || undefined,
        quickFilterColumns: quickFilter && cols.length ? cols : undefined,
      });
      setColumns(result.columns);
      columnsRef.current = result.columns;
      setRows(result.rows);
    } catch (e) {
      console.error(e);
    } finally {
      setIsLoading(false);
    }
  }, [connectionId, database, referencedTable]);

  // Fetch on mount (immediate) and on search change (debounced 300ms)
  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    if (!search) {
      fetchData("", columnsRef.current);
    } else {
      searchDebounceRef.current = setTimeout(() => {
        fetchData(search, columnsRef.current);
      }, 300);
    }
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [search, fetchData]);

  // Keyboard: Escape closes
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const refColIndex = columns.indexOf(referencedColumn);

  const handleRowClick = useCallback((row: unknown[]) => {
    const val = refColIndex >= 0 ? row[refColIndex] : row[0];
    setSelectedValue(val);
  }, [refColIndex]);

  const handleRowDoubleClick = useCallback((row: unknown[]) => {
    const val = refColIndex >= 0 ? row[refColIndex] : row[0];
    onSelect(val);
  }, [refColIndex, onSelect]);

  const handleSelect = useCallback(() => {
    onSelect(selectedValue);
  }, [onSelect, selectedValue]);

  const isRowSelected = useCallback((row: unknown[]) => {
    const val = refColIndex >= 0 ? row[refColIndex] : row[0];
    return val === selectedValue || String(val) === String(selectedValue);
  }, [refColIndex, selectedValue]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.5)",
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "var(--bg-panel)",
          border: "1px solid var(--border)",
          borderRadius: 6,
          padding: 16,
          width: 680,
          maxWidth: "90vw",
          display: "flex",
          flexDirection: "column",
          gap: 10,
          boxShadow: "0 8px 32px rgba(0,0,0,0.55)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-bright)", fontFamily: "monospace" }}>
            {columnName} → {referencedTable}.{referencedColumn}
          </span>
          <button
            className="btn-secondary"
            style={{ fontSize: 10, padding: "2px 8px" }}
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        {/* Search */}
        <input
          autoFocus
          type="text"
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            width: "100%",
            padding: "5px 8px",
            background: "var(--bg-surface)",
            color: "var(--text)",
            border: "1px solid var(--border)",
            borderRadius: 4,
            fontSize: 12,
            outline: "none",
            boxSizing: "border-box",
          }}
        />

        {/* Table */}
        <div
          style={{
            overflowY: "auto",
            maxHeight: "55vh",
            border: "1px solid var(--border)",
            borderRadius: 4,
          }}
        >
          {isLoading ? (
            <div style={{ padding: 20, textAlign: "center" }}>
              <span className="spinner" style={{ width: 18, height: 18, borderWidth: 2 }} />
            </div>
          ) : (
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                fontSize: 12,
                tableLayout: "auto",
              }}
            >
              <thead>
                <tr style={{ background: "var(--bg-surface)", position: "sticky", top: 0, zIndex: 1 }}>
                  {columns.map((col) => (
                    <th
                      key={col}
                      style={{
                        padding: "4px 8px",
                        textAlign: "left",
                        fontWeight: 600,
                        color: col === referencedColumn ? "var(--accent, #4fc1ff)" : "var(--text-muted)",
                        borderBottom: "1px solid var(--border)",
                        whiteSpace: "nowrap",
                        fontSize: 11,
                      }}
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={columns.length || 1}
                      style={{ padding: "12px 8px", color: "var(--text-muted)", textAlign: "center" }}
                    >
                      No rows found
                    </td>
                  </tr>
                ) : (
                  rows.map((row, i) => {
                    const selected = isRowSelected(row);
                    return (
                      <tr
                        key={i}
                        onClick={() => handleRowClick(row)}
                        onDoubleClick={() => handleRowDoubleClick(row)}
                        style={{
                          cursor: "pointer",
                          background: selected ? "rgba(0, 120, 212, 0.25)" : i % 2 === 0 ? "transparent" : "rgba(255,255,255,0.02)",
                          borderBottom: "1px solid var(--border)",
                        }}
                      >
                        {row.map((cell, j) => (
                          <td
                            key={j}
                            style={{
                              padding: "3px 8px",
                              color: cell === null || cell === undefined
                                ? "var(--text-muted)"
                                : j === refColIndex
                                  ? "var(--text-bright)"
                                  : "var(--text)",
                              fontStyle: cell === null || cell === undefined ? "italic" : "normal",
                              whiteSpace: "nowrap",
                              maxWidth: 280,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                            }}
                          >
                            {cell === null || cell === undefined ? "NULL" : String(cell)}
                          </td>
                        ))}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          {nullable && (
            <button
              className="btn-secondary"
              style={{ fontSize: 11, padding: "3px 10px", color: "var(--text-muted)" }}
              onClick={() => onSelect(null)}
            >
              Set NULL
            </button>
          )}
          <button className="btn-secondary" style={{ fontSize: 11, padding: "3px 10px" }} onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn-primary"
            style={{ fontSize: 11, padding: "3px 10px" }}
            onClick={handleSelect}
            disabled={selectedValue === undefined}
          >
            Select
          </button>
        </div>
      </div>
    </div>
  );
}
