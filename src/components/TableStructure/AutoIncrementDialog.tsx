import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface AutoIncrementDialogProps {
  connectionId: string;
  database: string;
  table: string;
  onClose: () => void;
}

export function AutoIncrementDialog({ connectionId, database, table, onClose }: AutoIncrementDialogProps) {
  const [currentValue, setCurrentValue] = useState<number | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [hasAutoIncrement, setHasAutoIncrement] = useState(true);
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    invoke<number | null>("get_table_auto_increment", { connectionId, database, table })
      .then((val) => {
        if (cancelled) return;
        if (val === null) {
          setHasAutoIncrement(false);
        } else {
          setHasAutoIncrement(true);
          setCurrentValue(val);
          setInputValue(String(val));
        }
      })
      .catch((e) => { if (!cancelled) setError(String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [connectionId, database, table]);

  const parsedValue = parseInt(inputValue, 10);
  const isValid = !isNaN(parsedValue) && parsedValue >= 1;
  const sqlPreview = isValid
    ? `ALTER TABLE \`${database}\`.\`${table}\` AUTO_INCREMENT = ${parsedValue};`
    : `ALTER TABLE \`${database}\`.\`${table}\` AUTO_INCREMENT = …;`;

  const handleApply = async () => {
    if (!isValid) return;
    setApplying(true);
    setError(null);
    try {
      await invoke("set_table_auto_increment", { connectionId, database, table, value: parsedValue });
      onClose();
    } catch (e) {
      setError(String(e));
      setApplying(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && isValid && !applying && hasAutoIncrement) handleApply();
    if (e.key === "Escape") onClose();
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.55)",
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: "var(--bg-panel)",
          border: "1px solid var(--border)",
          borderRadius: 7,
          padding: "20px 22px",
          width: 480,
          display: "flex",
          flexDirection: "column",
          gap: 14,
          boxShadow: "0 12px 40px rgba(0,0,0,0.65)",
        }}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Title */}
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-bright)" }}>
          Auto-Increment —{" "}
          <span style={{ fontFamily: "'Consolas', 'SF Mono', 'Menlo', monospace", color: "#4fc1ff" }}>
            {table}
          </span>
        </div>

        {loading ? (
          <div style={{ fontSize: 12, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 6 }}>
            <span className="spinner spinner-sm" />
            Loading…
          </div>
        ) : !hasAutoIncrement ? (
          <div
            style={{
              fontSize: 12,
              padding: "8px 10px",
              background: "rgba(255,255,255,0.04)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              color: "var(--text-muted)",
            }}
          >
            Esta tabla no tiene columna AUTO_INCREMENT.
          </div>
        ) : (
          <>
            {/* Current value input */}
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <label style={{ fontSize: 11, color: "var(--text-muted)" }}>
                Current value
                {currentValue !== null && (
                  <span style={{ marginLeft: 6, color: "var(--text-muted)", opacity: 0.6 }}>
                    (currently {currentValue})
                  </span>
                )}
              </label>
              <input
                autoFocus
                type="number"
                min={1}
                value={inputValue}
                onChange={(e) => { setInputValue(e.target.value); setError(null); }}
                style={{
                  fontSize: 13,
                  padding: "5px 8px",
                  background: "var(--bg-surface)",
                  border: "1px solid var(--border)",
                  borderRadius: 4,
                  color: "var(--text)",
                  outline: "none",
                  fontFamily: "'Consolas', 'SF Mono', 'Menlo', monospace",
                }}
              />
            </div>

            {/* SQL Preview */}
            <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
              <label style={{ fontSize: 11, color: "var(--text-muted)" }}>SQL Preview</label>
              <div
                style={{
                  fontSize: 11,
                  padding: "7px 10px",
                  background: "var(--bg-surface)",
                  border: "1px solid var(--border)",
                  borderRadius: 4,
                  color: "var(--text-muted)",
                  fontFamily: "'Consolas', 'SF Mono', 'Menlo', monospace",
                  userSelect: "text",
                  wordBreak: "break-all",
                }}
              >
                {sqlPreview}
              </div>
            </div>

            {/* Note */}
            <div style={{ fontSize: 11, color: "var(--text-muted)", opacity: 0.7 }}>
              MySQL ajusta automáticamente el valor si es menor que el ID máximo existente.
            </div>

            {/* Error */}
            {error && (
              <div
                style={{
                  fontSize: 11,
                  padding: "6px 10px",
                  background: "rgba(240,72,72,0.1)",
                  border: "1px solid rgba(240,72,72,0.3)",
                  borderRadius: 4,
                  color: "#f04848",
                }}
              >
                {error}
              </div>
            )}
          </>
        )}

        {/* Actions */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button className="btn-secondary" onClick={onClose} disabled={applying}>
            Cancel
          </button>
          {hasAutoIncrement && !loading && (
            <button
              className="btn-primary"
              onClick={handleApply}
              disabled={!isValid || applying}
            >
              {applying ? "Applying…" : "Apply"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
