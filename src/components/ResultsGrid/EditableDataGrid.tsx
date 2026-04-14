import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { AgGridReact } from "ag-grid-react";
import type { ColDef, CellValueChangedEvent, CellClassParams, CellDoubleClickedEvent, CellKeyDownEvent, CellContextMenuEvent, GridApi } from "ag-grid-community";
import { themeAlpine, colorSchemeDark } from "ag-grid-community";
import { invoke } from "@tauri-apps/api/core";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "../../store/useAppStore";
import { ConfirmDialog } from "./ConfirmDialog";
import type { ColumnInfo, QueryResult, TableEditOperation, TableEditRequest, ApplyEditsResult, DatetimeDisplayFormat } from "../../types";

function formatDatetimeValue(value: unknown, colInfo: ColumnInfo | undefined, fmt: DatetimeDisplayFormat): string {
  const str = String(value);
  if (!colInfo) return str;
  const t = colInfo.column_type.toLowerCase();

  if (t.includes("datetime") || t.includes("timestamp")) {
    const match = str.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/);
    if (match) {
      const [, y, mo, d, h, mi, s] = match;
      if (fmt === "eu") return `${d}/${mo}/${y} ${h}:${mi}:${s}`;
      if (fmt === "us") return `${mo}/${d}/${y} ${h}:${mi}:${s}`;
      return str;
    }
  }

  if (t === "date") {
    const match = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      const [, y, mo, d] = match;
      if (fmt === "eu") return `${d}/${mo}/${y}`;
      if (fmt === "us") return `${mo}/${d}/${y}`;
      return str;
    }
  }

  return str;
}

const darkTheme = themeAlpine.withPart(colorSchemeDark);

interface CellEdit {
  rowIndex: number;
  column: string;
  originalValue: unknown;
  newValue: unknown;
}

interface JsonEditorState {
  rowIndex: number;
  column: string;
  text: string;
  parseError: string | null;
}

interface TextEditorState {
  rowIndex: number;
  column: string;
  text: string;
  nullable: boolean;
}

interface CellContextMenuState {
  x: number;
  y: number;
  rowIndex: number;
  column: string;
  isAlreadyNull: boolean;
  isInserted: boolean;
}

interface EditableDataGridProps {
  result: QueryResult;
  database: string;
  table: string;
  columns: ColumnInfo[];
  primaryKeys: string[];
  connectionId: string;
  onDataReload: () => void;
  onFilterChanged?: (api: GridApi) => void;
  quickFilterText?: string;
  onGridReady?: (api: GridApi) => void;
}

function isColumnEditable(col: ColumnInfo): boolean {
  if (col.column_type.toLowerCase().includes("blob") || col.column_type.toLowerCase().includes("binary")) {
    return false;
  }
  if (col.extra.toLowerCase().includes("generated")) {
    return false;
  }
  return true;
}

function isJsonColumn(col: ColumnInfo): boolean {
  return col.column_type.toLowerCase() === "json";
}

function isTextColumn(col: ColumnInfo): boolean {
  const t = col.column_type.toLowerCase();
  return t === "text" || t === "tinytext" || t === "mediumtext" || t === "longtext";
}

function parseEditedValue(raw: string | null | undefined, col: ColumnInfo): unknown {
  if (raw === null || raw === undefined || raw === "") {
    return col.nullable ? null : "";
  }
  return raw;
}

// Try to parse a cell value as JSON, handling escaped/double-escaped strings
function tryFormatJson(value: unknown): { text: string; valid: boolean } {
  if (value === null || value === undefined) {
    return { text: "null", valid: true };
  }

  const raw = String(value);

  // Try direct parse
  try {
    const parsed = JSON.parse(raw);
    return { text: JSON.stringify(parsed, null, 2), valid: true };
  } catch {
    // noop
  }

  // Try unwrapping double-escaped string: "[{\"name\":\"test\"}]"
  if (raw.startsWith('"') && raw.endsWith('"')) {
    try {
      const unwrapped = JSON.parse(raw);
      if (typeof unwrapped === "string") {
        try {
          const parsed = JSON.parse(unwrapped);
          return { text: JSON.stringify(parsed, null, 2), valid: true };
        } catch {
          // noop
        }
      }
    } catch {
      // noop
    }
  }

  // Not valid JSON — show raw, let user fix
  return { text: raw, valid: false };
}

export function EditableDataGrid({
  result,
  database,
  table,
  columns: columnInfos,
  primaryKeys,
  connectionId,
  onDataReload,
  onFilterChanged,
  quickFilterText,
  onGridReady,
}: EditableDataGridProps) {
  const { nullDisplayText, gridRowHeight, datetimeFormat } = useAppStore(useShallow((s) => ({
    nullDisplayText: s.settings.null_display_text,
    gridRowHeight: s.settings.grid_row_height,
    datetimeFormat: s.settings.datetime_display_format,
  })));

  const gridRef = useRef<AgGridReact>(null);
  const originalRowCount = result.rows.length;

  const [editedCells, setEditedCells] = useState<Map<string, CellEdit>>(new Map());
  const [insertedRows, setInsertedRows] = useState<Record<string, unknown>[]>([]);
  const [deletedIndices, setDeletedIndices] = useState<Set<number>>(new Set());
  const [isApplying, setIsApplying] = useState(false);
  const [showNoPkWarning, setShowNoPkWarning] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [jsonEditor, setJsonEditor] = useState<JsonEditorState | null>(null);
  const [textEditor, setTextEditor] = useState<TextEditorState | null>(null);
  const [cellContextMenu, setCellContextMenu] = useState<CellContextMenuState | null>(null);

  // Reset edit state when the underlying data changes (user clicked a different table)
  useEffect(() => {
    setEditedCells(new Map());
    setInsertedRows([]);
    setDeletedIndices(new Set());
    setApplyError(null);
    setJsonEditor(null);
    setTextEditor(null);
    setCellContextMenu(null);
  }, [result]);

  const hasPk = primaryKeys.length > 0;
  const hasChanges = editedCells.size > 0 || insertedRows.length > 0 || deletedIndices.size > 0;

  const originalData = useMemo(() => {
    return result.rows.map((row) => {
      const obj: Record<string, unknown> = {};
      result.columns.forEach((col, i) => {
        obj[col] = row[i] ?? null;
      });
      return obj;
    });
  }, [result]);

  const rowData = useMemo(() => {
    const rows = originalData.map((row, idx) => {
      const edited: Record<string, unknown> = { ...row, __rowIndex: idx };
      editedCells.forEach((edit) => {
        if (edit.rowIndex === idx) {
          edited[edit.column] = edit.newValue;
        }
      });
      return edited;
    });
    insertedRows.forEach((row, i) => {
      rows.push({ ...row, __rowIndex: originalRowCount + i });
    });
    return rows;
  }, [originalData, editedCells, insertedRows, originalRowCount]);

  const colDefs: ColDef[] = useMemo(() => {
    const dataCols: ColDef[] = result.columns.map((colName) => {
      const colInfo = columnInfos.find((c) => c.field === colName);
      const isJson = colInfo ? isJsonColumn(colInfo) : false;
      const isText = colInfo ? isTextColumn(colInfo) : false;
      const usesModal = isJson || isText;
      return {
        field: colName,
        headerName: colName,
        sortable: true,
        filter: true,
        resizable: true,
        minWidth: 80,
        // JSON and TEXT columns open modal on double-click instead of inline edit
        editable: usesModal ? false : (params: { node: { data: Record<string, unknown> } }) => {
          if (!colInfo) return true;
          const rowIdx = params.node.data.__rowIndex as number;
          const isDeleted = deletedIndices.has(rowIdx);
          if (isDeleted) return false;
          return isColumnEditable(colInfo);
        },
        cellStyle: (params: CellClassParams) => {
          const rowIdx = params.data?.__rowIndex as number;
          const base: Record<string, string> = { fontSize: "13px" };

          if (deletedIndices.has(rowIdx)) {
            return { ...base, textDecoration: "line-through", opacity: "0.4", background: "rgba(244, 71, 71, 0.1)" };
          }
          if (rowIdx >= originalRowCount) {
            return { ...base, background: "rgba(106, 153, 85, 0.15)" };
          }
          const key = `${rowIdx}:${colName}`;
          if (editedCells.has(key)) {
            return { ...base, background: "rgba(0, 120, 212, 0.2)" };
          }
          if (params.value === null || params.value === undefined) {
            return { ...base, fontStyle: "italic", color: "var(--text-muted)" };
          }
          // JSON and TEXT columns get a subtle indicator (opens modal on double-click)
          if (usesModal) {
            return { ...base, cursor: "pointer", color: "var(--accent, #4fc1ff)" };
          }
          return base;
        },
        valueFormatter: (params: { value: unknown }) => {
          if (params.value === null || params.value === undefined) return nullDisplayText;
          return formatDatetimeValue(params.value, colInfo, datetimeFormat);
        },
      };
    });

    return dataCols;
  }, [result.columns, columnInfos, originalRowCount, deletedIndices, editedCells, nullDisplayText, datetimeFormat]);

  // Double-click handler for JSON and TEXT columns — opens modal editor
  const onCellDoubleClicked = useCallback((event: CellDoubleClickedEvent) => {
    const col = event.colDef.field;
    if (!col) return;
    const colInfo = columnInfos.find((c) => c.field === col);
    if (!colInfo) return;

    const rowIdx = event.data.__rowIndex as number;
    if (deletedIndices.has(rowIdx)) return;
    if (!isColumnEditable(colInfo)) return;

    const currentValue = event.data[col];

    if (isJsonColumn(colInfo)) {
      const { text } = tryFormatJson(currentValue);
      setJsonEditor({ rowIndex: rowIdx, column: col, text, parseError: null });
    } else if (isTextColumn(colInfo)) {
      const text = currentValue === null || currentValue === undefined ? "" : String(currentValue);
      setTextEditor({ rowIndex: rowIdx, column: col, text, nullable: colInfo.nullable });
    }
  }, [columnInfos, deletedIndices, originalRowCount]);

  // Save JSON from modal
  const handleJsonSave = useCallback(() => {
    if (!jsonEditor) return;

    const { rowIndex, column, text } = jsonEditor;

    // Validate JSON
    let serialized: string;
    try {
      const parsed = JSON.parse(text);
      serialized = JSON.stringify(parsed);
    } catch (e) {
      setJsonEditor({ ...jsonEditor, parseError: String(e) });
      return;
    }

    // Apply as edit
    if (rowIndex >= originalRowCount) {
      const insertIdx = rowIndex - originalRowCount;
      setInsertedRows((prev) => {
        const next = [...prev];
        next[insertIdx] = { ...next[insertIdx], [column]: serialized };
        return next;
      });
    } else {
      const key = `${rowIndex}:${column}`;
      const originalValue = originalData[rowIndex][column];

      setEditedCells((prev) => {
        const next = new Map(prev);
        if (serialized === originalValue || (serialized === String(originalValue))) {
          next.delete(key);
        } else {
          next.set(key, {
            rowIndex,
            column,
            originalValue,
            newValue: serialized,
          });
        }
        return next;
      });
    }

    setJsonEditor(null);
  }, [jsonEditor, originalRowCount, originalData]);

  // Save text from modal
  const handleTextSave = useCallback(() => {
    if (!textEditor) return;

    const { rowIndex, column, text, nullable } = textEditor;
    const newValue = text === "" && nullable ? null : text;

    if (rowIndex >= originalRowCount) {
      const insertIdx = rowIndex - originalRowCount;
      setInsertedRows((prev) => {
        const next = [...prev];
        next[insertIdx] = { ...next[insertIdx], [column]: newValue };
        return next;
      });
    } else {
      const key = `${rowIndex}:${column}`;
      const originalValue = originalData[rowIndex][column];

      setEditedCells((prev) => {
        const next = new Map(prev);
        if (newValue === originalValue || (newValue !== null && newValue === String(originalValue))) {
          next.delete(key);
        } else {
          next.set(key, { rowIndex, column, originalValue, newValue });
        }
        return next;
      });
    }

    setTextEditor(null);
  }, [textEditor, originalRowCount, originalData]);

  // Ctrl+C / Cmd+C copies focused cell value when not in edit mode
  const onCellKeyDown = useCallback((event: CellKeyDownEvent) => {
    const keyEvent = event.event as KeyboardEvent | null;
    if (!keyEvent) return;
    if ((keyEvent.ctrlKey || keyEvent.metaKey) && keyEvent.key === "c") {
      // Don't interfere with native copy when editing a cell
      if (event.api.getEditingCells().length > 0) return;
      keyEvent.preventDefault();
      const value = event.value;
      const text = value === null || value === undefined ? "" : String(value);
      navigator.clipboard.writeText(text).catch(console.error);
    }
  }, []);

  const onCellContextMenu = useCallback((event: CellContextMenuEvent) => {
    event.event?.preventDefault();
    const col = event.colDef.field;
    if (!col) return;
    const colInfo = columnInfos.find((c) => c.field === col);
    // Only show the menu for nullable, editable columns
    if (!colInfo || !colInfo.nullable) return;
    const rowIdx = event.data.__rowIndex as number;
    if (deletedIndices.has(rowIdx)) return;
    if (!isColumnEditable(colInfo)) return;
    const isInserted = rowIdx >= originalRowCount;

    const mouseEvent = event.event as MouseEvent;
    const x = Math.min(mouseEvent.clientX, window.innerWidth - 170);
    const y = Math.min(mouseEvent.clientY, window.innerHeight - 70);
    setCellContextMenu({
      x,
      y,
      rowIndex: rowIdx,
      column: col,
      isAlreadyNull: event.value === null || event.value === undefined,
      isInserted,
    });
  }, [columnInfos, deletedIndices, originalRowCount]);

  const handleSetNull = useCallback(() => {
    if (!cellContextMenu) return;
    const { rowIndex, column, isInserted } = cellContextMenu;
    if (isInserted) {
      const insertIdx = rowIndex - originalRowCount;
      setInsertedRows((prev) => {
        const next = [...prev];
        next[insertIdx] = { ...next[insertIdx], [column]: null };
        return next;
      });
    } else {
      const key = `${rowIndex}:${column}`;
      const originalValue = originalData[rowIndex][column];
      setEditedCells((prev) => {
        const next = new Map(prev);
        if (originalValue === null) {
          next.delete(key);
        } else {
          next.set(key, { rowIndex, column, originalValue, newValue: null });
        }
        return next;
      });
    }
    setCellContextMenu(null);
  }, [cellContextMenu, originalRowCount, originalData]);

  const onCellValueChanged = useCallback((event: CellValueChangedEvent) => {
    const rowIdx = event.data.__rowIndex as number;
    const col = event.colDef.field!;
    const colInfo = columnInfos.find((c) => c.field === col);

    if (rowIdx >= originalRowCount) {
      const insertIdx = rowIdx - originalRowCount;
      setInsertedRows((prev) => {
        const next = [...prev];
        const newVal = parseEditedValue(event.newValue, colInfo!);
        next[insertIdx] = { ...next[insertIdx], [col]: newVal };
        return next;
      });
      return;
    }

    const key = `${rowIdx}:${col}`;
    const originalValue = originalData[rowIdx][col];
    const newVal = parseEditedValue(event.newValue, colInfo!);

    setEditedCells((prev) => {
      const next = new Map(prev);
      if (newVal === originalValue || (newVal === null && originalValue === null)) {
        next.delete(key);
      } else {
        next.set(key, { rowIndex: rowIdx, column: col, originalValue, newValue: newVal });
      }
      return next;
    });
  }, [originalData, originalRowCount, columnInfos]);

  const handleInsertRow = useCallback(() => {
    const newRow: Record<string, unknown> = {};
    columnInfos.forEach((col) => {
      if (col.extra.toLowerCase().includes("auto_increment")) {
        newRow[col.field] = null;
      } else if (col.default_value !== null) {
        newRow[col.field] = col.default_value;
      } else if (col.nullable) {
        newRow[col.field] = null;
      } else {
        newRow[col.field] = "";
      }
    });
    setInsertedRows((prev) => [...prev, newRow]);
  }, [columnInfos]);

  const handleDeleteRows = useCallback(() => {
    const api: GridApi | undefined = gridRef.current?.api;
    if (!api) return;
    const selected = api.getSelectedNodes();
    if (selected.length === 0) return;

    const newDeleted = new Set(deletedIndices);
    const remainingInserts = [...insertedRows];
    const insertIndicesToRemove = new Set<number>();

    selected.forEach((node) => {
      const rowIdx = node.data.__rowIndex as number;
      if (rowIdx >= originalRowCount) {
        insertIndicesToRemove.add(rowIdx - originalRowCount);
      } else {
        newDeleted.add(rowIdx);
      }
    });

    if (insertIndicesToRemove.size > 0) {
      setInsertedRows(remainingInserts.filter((_, i) => !insertIndicesToRemove.has(i)));
    }
    setDeletedIndices(newDeleted);
    api.deselectAll();
  }, [deletedIndices, originalRowCount, insertedRows]);

  const handleCancel = useCallback(() => {
    setEditedCells(new Map());
    setInsertedRows([]);
    setDeletedIndices(new Set());
    setApplyError(null);
  }, []);

  const buildOperations = useCallback((): TableEditOperation[] => {
    const ops: TableEditOperation[] = [];

    const editsByRow = new Map<number, CellEdit[]>();
    editedCells.forEach((edit) => {
      if (deletedIndices.has(edit.rowIndex)) return;
      const existing = editsByRow.get(edit.rowIndex) || [];
      existing.push(edit);
      editsByRow.set(edit.rowIndex, existing);
    });

    const buildWhereValues = (rowIdx: number): [string, unknown][] => {
      const originalRow = originalData[rowIdx];
      if (hasPk) {
        return primaryKeys.map((pk) => [pk, originalRow[pk]]);
      }
      return result.columns
        .filter((col) => {
          const info = columnInfos.find((c) => c.field === col);
          if (info && (info.column_type.toLowerCase().includes("blob") || info.column_type.toLowerCase().includes("binary"))) return false;
          return true;
        })
        .map((col) => [col, originalRow[col]]);
    };

    editsByRow.forEach((edits, rowIdx) => {
      const whereValues = buildWhereValues(rowIdx);
      const setValues: [string, unknown][] = edits.map((e) => [e.column, e.newValue]);
      ops.push({ type: "Update", where_values: whereValues, set_values: setValues });
    });

    insertedRows.forEach((row) => {
      const values: [string, unknown][] = columnInfos
        .filter((col) => {
          if (col.extra.toLowerCase().includes("auto_increment") && (row[col.field] === null || row[col.field] === undefined)) return false;
          if (col.extra.toLowerCase().includes("generated")) return false;
          return true;
        })
        .map((col) => [col.field, row[col.field] ?? null]);
      ops.push({ type: "Insert", values });
    });

    deletedIndices.forEach((rowIdx) => {
      const whereValues = buildWhereValues(rowIdx);
      ops.push({ type: "Delete", where_values: whereValues });
    });

    return ops;
  }, [editedCells, insertedRows, deletedIndices, originalData, hasPk, primaryKeys, result.columns, columnInfos]);

  const doApply = useCallback(async () => {
    setShowNoPkWarning(false);
    setIsApplying(true);
    setApplyError(null);

    try {
      const operations = buildOperations();
      if (operations.length === 0) return;

      const request: TableEditRequest = {
        database,
        table,
        primary_keys: primaryKeys,
        operations,
      };

      await invoke<ApplyEditsResult>("apply_table_edits", {
        connectionId,
        request,
      });

      setEditedCells(new Map());
      setInsertedRows([]);
      setDeletedIndices(new Set());
      onDataReload();
    } catch (e) {
      setApplyError(String(e));
    } finally {
      setIsApplying(false);
    }
  }, [buildOperations, database, table, primaryKeys, connectionId, onDataReload]);

  const handleApply = useCallback(async () => {
    if (!hasPk) {
      setShowNoPkWarning(true);
      return;
    }
    await doApply();
  }, [hasPk, doApply]);

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 8px",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg-panel)",
          flexShrink: 0,
        }}
      >
        <button
          className="btn-secondary"
          style={{ fontSize: 11, padding: "2px 8px" }}
          onClick={handleInsertRow}
          disabled={isApplying}
        >
          + Insert Row
        </button>
        <button
          className="btn-secondary"
          style={{ fontSize: 11, padding: "2px 8px", color: "var(--danger)" }}
          onClick={handleDeleteRows}
          disabled={isApplying}
        >
          ✕ Delete Row
        </button>
        {!hasPk && (
          <span style={{ fontSize: 10, color: "var(--warning, #e8c08c)", marginLeft: 4 }}>
            ⚠ No primary key
          </span>
        )}
        <div style={{ flex: 1 }} />
        {applyError && (
          <span style={{ fontSize: 10, color: "var(--danger)", maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={applyError}>
            {applyError}
          </span>
        )}
        {hasChanges && (
          <>
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
              {editedCells.size > 0 && `${editedCells.size} edit${editedCells.size !== 1 ? "s" : ""}`}
              {editedCells.size > 0 && (insertedRows.length > 0 || deletedIndices.size > 0) && ", "}
              {insertedRows.length > 0 && `${insertedRows.length} insert${insertedRows.length !== 1 ? "s" : ""}`}
              {insertedRows.length > 0 && deletedIndices.size > 0 && ", "}
              {deletedIndices.size > 0 && `${deletedIndices.size} delete${deletedIndices.size !== 1 ? "s" : ""}`}
            </span>
            <button
              className="btn-secondary"
              style={{ fontSize: 11, padding: "2px 10px" }}
              onClick={handleCancel}
              disabled={isApplying}
            >
              Cancel
            </button>
            <button
              className="btn-primary"
              style={{ fontSize: 11, padding: "2px 10px" }}
              onClick={handleApply}
              disabled={isApplying}
            >
              {isApplying ? "Applying…" : "Apply"}
            </button>
          </>
        )}
      </div>

      {/* Grid */}
      <div style={{ flex: 1 }} onContextMenu={(e) => e.preventDefault()}>
        <AgGridReact
          ref={gridRef}
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
          stopEditingWhenCellsLoseFocus={true}
          onCellValueChanged={onCellValueChanged}
          onCellKeyDown={onCellKeyDown}
          onCellDoubleClicked={onCellDoubleClicked}
          onCellContextMenu={onCellContextMenu}
          onFilterChanged={(e) => onFilterChanged?.(e.api)}
          onGridReady={(e) => onGridReady?.(e.api)}
          quickFilterText={quickFilterText}
          rowSelection={{ mode: "multiRow", checkboxes: true, headerCheckbox: true }}
          suppressCellFocus={false}
          enableCellTextSelection={false}
          getRowId={(params) => String(params.data.__rowIndex)}
        />
      </div>

      {/* JSON Editor Modal */}
      {jsonEditor && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 100,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.4)",
          }}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => { if (e.key === "Escape") setJsonEditor(null); }}
        >
          <div
            style={{
              background: "var(--bg-panel)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: 16,
              width: 560,
              maxHeight: "80vh",
              display: "flex",
              flexDirection: "column",
              gap: 10,
              boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-bright)" }}>
                Edit JSON — {jsonEditor.column}
              </span>
              <button
                className="btn-secondary"
                style={{ fontSize: 10, padding: "2px 8px" }}
                onClick={() => {
                  try {
                    const parsed = JSON.parse(jsonEditor.text);
                    setJsonEditor({ ...jsonEditor, text: JSON.stringify(parsed, null, 2), parseError: null });
                  } catch (e) {
                    setJsonEditor({ ...jsonEditor, parseError: String(e) });
                  }
                }}
              >
                Format
              </button>
            </div>
            <textarea
              value={jsonEditor.text}
              onChange={(e) => setJsonEditor({ ...jsonEditor, text: e.target.value, parseError: null })}
              spellCheck={false}
              style={{
                width: "100%",
                minHeight: 260,
                maxHeight: "60vh",
                resize: "vertical",
                fontFamily: "monospace",
                fontSize: 12,
                lineHeight: 1.5,
                padding: 10,
                background: "var(--bg-surface)",
                color: "var(--text)",
                border: jsonEditor.parseError ? "1px solid var(--danger)" : "1px solid var(--border)",
                borderRadius: 4,
                outline: "none",
                tabSize: 2,
              }}
              onKeyDown={(e) => {
                // Tab inserts 2 spaces instead of changing focus
                if (e.key === "Tab") {
                  e.preventDefault();
                  const ta = e.currentTarget;
                  const start = ta.selectionStart;
                  const end = ta.selectionEnd;
                  const newText = jsonEditor.text.substring(0, start) + "  " + jsonEditor.text.substring(end);
                  setJsonEditor({ ...jsonEditor, text: newText, parseError: null });
                  requestAnimationFrame(() => {
                    ta.selectionStart = ta.selectionEnd = start + 2;
                  });
                }
              }}
            />
            {jsonEditor.parseError && (
              <span style={{ fontSize: 11, color: "var(--danger)", wordBreak: "break-word" }}>
                {jsonEditor.parseError}
              </span>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button className="btn-secondary" onClick={() => setJsonEditor(null)}>
                Cancel
              </button>
              <button className="btn-primary" onClick={handleJsonSave}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Text Editor Modal */}
      {textEditor && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 100,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.4)",
          }}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => { if (e.key === "Escape") setTextEditor(null); }}
        >
          <div
            style={{
              background: "var(--bg-panel)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: 16,
              width: 560,
              maxHeight: "80vh",
              display: "flex",
              flexDirection: "column",
              gap: 10,
              boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-bright)" }}>
                Edit Text — {textEditor.column}
              </span>
              <button
                className="btn-secondary"
                style={{ fontSize: 10, padding: "2px 8px" }}
                onClick={() => setTextEditor({ ...textEditor, text: "" })}
              >
                Clear
              </button>
            </div>
            <textarea
              value={textEditor.text}
              onChange={(e) => setTextEditor({ ...textEditor, text: e.target.value })}
              spellCheck={false}
              style={{
                width: "100%",
                minHeight: 260,
                maxHeight: "60vh",
                resize: "vertical",
                fontFamily: "monospace",
                fontSize: 12,
                lineHeight: 1.5,
                padding: 10,
                background: "var(--bg-surface)",
                color: "var(--text)",
                border: "1px solid var(--border)",
                borderRadius: 4,
                outline: "none",
                tabSize: 2,
              }}
            />
            {textEditor.nullable && textEditor.text === "" && (
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                Empty text will be saved as NULL
              </span>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
              <button className="btn-secondary" onClick={() => setTextEditor(null)}>
                Cancel
              </button>
              <button className="btn-primary" onClick={handleTextSave}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cell context menu */}
      {cellContextMenu && (
        <>
          {/* Backdrop: closes menu when clicking outside */}
          <div
            style={{ position: "fixed", inset: 0, zIndex: 199 }}
            onMouseDown={() => setCellContextMenu(null)}
            onContextMenu={(e) => { e.preventDefault(); setCellContextMenu(null); }}
          />
          <div
            style={{
              position: "fixed",
              left: cellContextMenu.x,
              top: cellContextMenu.y,
              zIndex: 200,
              background: "var(--bg-panel)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              boxShadow: "0 4px 16px rgba(0,0,0,0.45)",
              padding: "2px 0",
              minWidth: 160,
              fontSize: 12,
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div
              style={{
                padding: "4px 10px 4px",
                color: "var(--text-muted)",
                fontSize: 11,
                borderBottom: "1px solid var(--border)",
                marginBottom: 2,
                fontFamily: "monospace",
              }}
            >
              {cellContextMenu.column}
            </div>
            <button
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                width: "100%",
                padding: "5px 10px",
                background: "none",
                border: "none",
                cursor: cellContextMenu.isAlreadyNull ? "default" : "pointer",
                color: cellContextMenu.isAlreadyNull ? "var(--text-muted)" : "var(--text)",
                fontSize: 12,
                textAlign: "left",
                opacity: cellContextMenu.isAlreadyNull ? 0.5 : 1,
              }}
              onClick={cellContextMenu.isAlreadyNull ? undefined : handleSetNull}
              disabled={cellContextMenu.isAlreadyNull}
            >
              <span
                style={{
                  fontFamily: "monospace",
                  fontSize: 10,
                  background: "var(--bg-surface)",
                  padding: "1px 5px",
                  borderRadius: 3,
                  color: "var(--text-muted)",
                  border: "1px solid var(--border)",
                  letterSpacing: "0.03em",
                }}
              >
                NULL
              </span>
              Set to NULL
              {cellContextMenu.isAlreadyNull && (
                <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--text-muted)", paddingLeft: 8 }}>
                  already null
                </span>
              )}
            </button>
          </div>
        </>
      )}

      {/* No PK warning dialog */}
      {showNoPkWarning && (
        <ConfirmDialog
          title="⚠ Table has no Primary Key"
          message="This table has no primary key. All column values will be used to identify rows, and LIMIT 1 will be applied. Other rows with identical values may be affected. Do you want to proceed?"
          confirmLabel="Apply Changes"
          cancelLabel="Cancel"
          variant="warning"
          onConfirm={doApply}
          onCancel={() => setShowNoPkWarning(false)}
        />
      )}
    </div>
  );
}
