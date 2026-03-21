import { useState, useEffect, useRef, useCallback } from "react";

export interface ActiveColumnFilter {
  column: string;
  summary: string;
}

interface FilterBarProps {
  quickFilterText: string;
  onQuickFilterChange: (text: string) => void;
  activeColumnFilters: ActiveColumnFilter[];
  onClearColumnFilter: (column: string) => void;
  onClearAllFilters: () => void;
  filteredRowCount: number | null;
  totalRowCount: number;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}

export function FilterBar({
  quickFilterText,
  onQuickFilterChange,
  activeColumnFilters,
  onClearColumnFilter,
  onClearAllFilters,
  filteredRowCount,
  totalRowCount,
  inputRef: externalInputRef,
}: FilterBarProps) {
  const [localText, setLocalText] = useState(quickFilterText);
  const internalInputRef = useRef<HTMLInputElement>(null);
  const inputRef = externalInputRef ?? internalInputRef;

  // Sync local text when parent resets quickFilterText (e.g. on data change)
  useEffect(() => {
    setLocalText(quickFilterText);
  }, [quickFilterText]);

  const applyFilter = useCallback(() => {
    onQuickFilterChange(localText);
  }, [localText, onQuickFilterChange]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      applyFilter();
    }
  }, [applyFilter]);

  const hasFilters = activeColumnFilters.length > 0 || quickFilterText !== "";
  const showCount = filteredRowCount !== null && filteredRowCount !== totalRowCount;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 8px",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg-panel)",
        flexShrink: 0,
        minHeight: 28,
      }}
    >
      {/* Quick filter input */}
      <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
        <span
          style={{
            position: "absolute",
            left: 6,
            fontSize: 11,
            color: "var(--text-muted)",
            pointerEvents: "none",
          }}
        >
          &#x1F50D;
        </span>
        <input
          ref={inputRef}
          value={localText}
          onChange={(e) => setLocalText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Filter... (Enter to apply)"
          style={{
            width: 200,
            fontSize: 11,
            padding: "3px 6px 3px 24px",
            background: "var(--bg-surface)",
            border: "1px solid var(--border)",
            borderRadius: 3,
            color: "var(--text)",
            outline: "none",
          }}
        />
        {localText !== quickFilterText && (
          <button
            onClick={applyFilter}
            style={{
              marginLeft: 4,
              fontSize: 10,
              padding: "2px 8px",
              background: "var(--accent)",
              border: "none",
              borderRadius: 3,
              color: "var(--text-bright)",
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            Apply
          </button>
        )}
      </div>

      {/* Active column filter chips */}
      {activeColumnFilters.map((f) => (
        <span
          key={f.column}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "1px 6px",
            background: "rgba(0, 120, 212, 0.2)",
            border: "1px solid rgba(0, 120, 212, 0.4)",
            borderRadius: 3,
            fontSize: 10,
            color: "var(--text-bright)",
            whiteSpace: "nowrap",
            maxWidth: 200,
          }}
        >
          <span
            style={{ overflow: "hidden", textOverflow: "ellipsis" }}
            title={`${f.column}: ${f.summary}`}
          >
            {f.column}: {f.summary}
          </span>
          <span
            onClick={() => onClearColumnFilter(f.column)}
            style={{
              cursor: "pointer",
              fontSize: 11,
              lineHeight: 1,
              opacity: 0.7,
            }}
            title="Remove filter"
          >
            ✕
          </span>
        </span>
      ))}

      {/* Clear all */}
      {hasFilters && (
        <button
          onClick={onClearAllFilters}
          style={{
            fontSize: 10,
            padding: "1px 6px",
            background: "transparent",
            border: "1px solid var(--border)",
            borderRadius: 3,
            color: "var(--text-muted)",
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          Clear all
        </button>
      )}

      <div style={{ flex: 1 }} />

      {/* Row count */}
      {showCount && (
        <span style={{ fontSize: 10, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
          {filteredRowCount} of {totalRowCount} rows
        </span>
      )}
    </div>
  );
}
