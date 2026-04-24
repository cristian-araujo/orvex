import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useAppStore } from "../../store/useAppStore";
import type { ExportProgressPayload, ImportProgressPayload } from "../../types";



function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatNumber(n: number): string {
  return n.toLocaleString();
}

function formatEta(elapsedMs: number, progressPercent: number): string {
  if (progressPercent <= 0 || progressPercent >= 100) return "—";
  const etaMs = (elapsedMs / progressPercent) * (100 - progressPercent);
  return formatDuration(etaMs);
}

interface StatProps {
  label: string;
  value: string;
  accent?: boolean;
}

function Stat({ label, value, accent }: StatProps) {
  return (
    <div style={{
      background: "var(--bg-base)",
      border: "1px solid var(--border)",
      borderRadius: 3,
      padding: "8px 10px",
    }}>
      <div style={{
        fontSize: 9,
        letterSpacing: "0.1em",
        fontWeight: 700,
        color: "var(--text-muted)",
        textTransform: "uppercase",
        marginBottom: 4,
      }}>
        {label}
      </div>
      <div style={{
        fontSize: 14,
        
        fontWeight: 600,
        color: accent ? "var(--accent)" : "var(--text-bright)",
        lineHeight: 1,
      }}>
        {value}
      </div>
    </div>
  );
}

interface ProgressDialogProps {
  type: "export" | "import";
  operationId: string;
}

export function ProgressDialog({ type, operationId }: ProgressDialogProps) {
  const setActiveOperation = useAppStore((s) => s.setActiveOperation);

  const [exportProgress, setExportProgress] = useState<ExportProgressPayload | null>(null);
  const [importProgress, setImportProgress] = useState<ImportProgressPayload | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const cancelTimeoutRef = useRef<number | null>(null);

  // Local elapsed timer — advances every 250ms independently of backend events
  // so the clock keeps running even when MySQL is executing a long statement.
  const [localElapsedMs, setLocalElapsedMs] = useState(0);
  const localElapsedRef = useRef(0);

  useEffect(() => {
    const eventName = type === "export" ? "export-progress" : "import-progress";
    const unlisten = listen<ExportProgressPayload | ImportProgressPayload>(eventName, (event) => {
      const payload = event.payload;
      if ("operation_id" in payload && payload.operation_id !== operationId) return;

      if (type === "export") {
        setExportProgress(payload as ExportProgressPayload);
      } else {
        setImportProgress(payload as ImportProgressPayload);
      }
    });

    // The backend task starts immediately after the invoke returns, before React has time to mount
    // this component and register the listener above. Early events (e.g. a USE-database failure
    // that happens in <20ms) are therefore lost. We recover by fetching the latest cached payload
    // from the backend on mount, applying it only if no live event has already been received.
    const cacheCmd = type === "export" ? "get_export_progress" : "get_import_progress";
    invoke<ExportProgressPayload | ImportProgressPayload | null>(cacheCmd, { operationId })
      .then((cached) => {
        if (!cached) return;
        if (type === "export") {
          setExportProgress((prev) => prev ?? (cached as ExportProgressPayload));
        } else {
          setImportProgress((prev) => prev ?? (cached as ImportProgressPayload));
        }
      })
      .catch(() => { /* cache miss is benign */ });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [type, operationId, setActiveOperation]);

  // Sync local elapsed with backend value whenever an event arrives
  useEffect(() => {
    const backendMs = (type === "import" ? importProgress?.elapsed_ms : exportProgress?.elapsed_ms) ?? 0;
    if (backendMs > localElapsedRef.current) {
      localElapsedRef.current = backendMs;
      setLocalElapsedMs(backendMs);
    }
  }, [importProgress?.elapsed_ms, exportProgress?.elapsed_ms, type]);

  // Limpiar el timeout de cancel cuando llega evento terminal
  const isTerminalPhase = (() => {
    const phase = (type === "import" ? importProgress?.phase : exportProgress?.phase) ?? "starting";
    return phase === "complete" || phase === "error" || phase === "cancelled";
  })();
  useEffect(() => {
    if (isTerminalPhase && cancelTimeoutRef.current !== null) {
      clearTimeout(cancelTimeoutRef.current);
      cancelTimeoutRef.current = null;
    }
  }, [isTerminalPhase]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (cancelTimeoutRef.current !== null) {
        clearTimeout(cancelTimeoutRef.current);
      }
    };
  }, []);

  // Tick every 250ms while operation is running so the clock never freezes
  useEffect(() => {
    const phase = (type === "import" ? importProgress?.phase : exportProgress?.phase) ?? "starting";
    const terminal = phase === "complete" || phase === "error" || phase === "cancelled";
    if (terminal) return;
    const id = setInterval(() => {
      localElapsedRef.current += 250;
      setLocalElapsedMs(localElapsedRef.current);
    }, 250);
    return () => clearInterval(id);
  }, [
    type,
    importProgress?.phase,
    exportProgress?.phase,
  ]);

  const handleCancel = async () => {
    setCancelling(true);
    // Fallback: si el backend no confirma "cancelled" en 30s, liberar el botón.
    // En condiciones normales el evento terminal llega antes y limpia el timeout.
    cancelTimeoutRef.current = window.setTimeout(() => {
      setCancelling(false);
      cancelTimeoutRef.current = null;
    }, 30_000);
    try {
      const cmd = type === "export" ? "cancel_export" : "cancel_import";
      await invoke(cmd, { operationId });
      // No resetear cancelling aquí: el botón queda en "Cancelling..." hasta
      // que llegue el evento terminal (phase = cancelled/complete/error).
    } catch (_) {
      // Si el invoke falla, liberar inmediatamente.
      setCancelling(false);
      if (cancelTimeoutRef.current !== null) {
        clearTimeout(cancelTimeoutRef.current);
        cancelTimeoutRef.current = null;
      }
    }
  };

  const isExport = type === "export";
  const progress = isExport ? exportProgress : importProgress;
  const phase = progress?.phase ?? "starting";
  const isTerminal = isTerminalPhase;

  let progressPercent = 0;
  if (isExport && exportProgress && exportProgress.tables_total > 0) {
    progressPercent = (exportProgress.tables_done / exportProgress.tables_total) * 100;
  } else if (!isExport && importProgress && importProgress.bytes_total > 0) {
    progressPercent = (importProgress.bytes_read / importProgress.bytes_total) * 100;
  }

  const phaseColor =
    phase === "error"
      ? "#f44747"
      : phase === "cancelled"
        ? "var(--text-muted)"
        : phase === "complete"
          ? "#6a9955"
          : phase === "indexing"
            ? "#c9a227"
            : "var(--accent)";

  const phaseLabel =
    phase === "complete"
      ? "COMPLETE"
      : phase === "error"
        ? "ERROR"
        : phase === "cancelled"
          ? "CANCELLED"
          : phase === "starting"
            ? "STARTING"
            : phase === "indexing"
              ? "INDEXING"
              : isExport
                ? "EXPORTING"
                : "IMPORTING";

  const isActive = !isTerminal && phase !== "starting";

  return (
    <>
      <style>{`
        @keyframes dlg-in {
          from { opacity: 0; transform: scale(0.975) translateY(10px); }
          to   { opacity: 1; transform: scale(1)     translateY(0);    }
        }
        @keyframes bar-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }
        .progress-dlg { animation: dlg-in 0.18s cubic-bezier(0.16,1,0.3,1); }
        .bar-active { animation: bar-pulse 1.8s ease-in-out infinite; }
      `}</style>
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 100,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(0,0,0,0.6)",
          backdropFilter: "blur(2px)",
        }}
      >
        <div
          className="progress-dlg"
          style={{
            background: "var(--bg-panel)",
            border: "1px solid var(--border)",
            borderRadius: 5,
            width: 480,
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
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {/* Animated dot */}
              {!isTerminal && (
                <div style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: phaseColor,
                  boxShadow: `0 0 6px ${phaseColor}`,
                  animation: "bar-pulse 1.4s ease-in-out infinite",
                  flexShrink: 0,
                }} />
              )}
              <div>
                <div style={{
                  fontSize: 10,
                  letterSpacing: "0.12em",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  color: phaseColor,
                  marginBottom: 2,
                }}>
                  {phaseLabel}
                </div>
                <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-bright)" }}>
                  {isExport ? "Database Export" : "SQL Import"}
                </div>
              </div>
            </div>
          </div>

          {/* Progress track */}
          <div style={{
            height: 3,
            background: "var(--bg-surface)",
            position: "relative",
            overflow: "hidden",
          }}>
            <div
              className={isActive ? "bar-active" : ""}
              style={{
                height: "100%",
                width: `${Math.min(progressPercent, 100)}%`,
                background: phaseColor,
                transition: "width 0.35s cubic-bezier(0.4,0,0.2,1), background 0.3s",
              }}
            />
          </div>

          {/* Body */}
          <div style={{ padding: "18px 20px", display: "flex", flexDirection: "column", gap: 14 }}>

            {/* Progress percentage + current table */}
            <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12 }}>
              <div style={{
                fontSize: 28,
                fontWeight: 700,
                color: "var(--text-bright)",
                lineHeight: 1,
                flexShrink: 0,
              }}>
                {Math.floor(progressPercent)}<span style={{ fontSize: 14, color: "var(--text-muted)", marginLeft: 2 }}>%</span>
              </div>
              {isExport && exportProgress && exportProgress.current_table && (
                <div style={{
                  fontSize: 16,
                  fontWeight: 600,
                  color: "var(--text-bright)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  textAlign: "right",
                  flex: 1,
                  paddingBottom: 2,
                }}>
                  {exportProgress.current_table}
                </div>
              )}
            </div>

            {/* Stats grid — export */}
            {isExport && exportProgress && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                <Stat
                  label="Tables"
                  value={`${exportProgress.tables_done} / ${exportProgress.tables_total}`}
                />
                <Stat
                  label="Rows exported"
                  value={formatNumber(exportProgress.rows_exported)}
                  accent
                />
                <Stat
                  label="File size"
                  value={formatBytes(exportProgress.bytes_written)}
                />
                <Stat
                  label="Elapsed / ETA"
                  value={
                    isTerminal
                      ? formatDuration(exportProgress.elapsed_ms)
                      : `${formatDuration(localElapsedMs)} / ${formatEta(localElapsedMs, progressPercent)}`
                  }
                />
              </div>
            )}

            {/* Stats grid — import */}
            {!isExport && importProgress && (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                  <Stat
                    label="Read"
                    value={formatBytes(importProgress.bytes_read)}
                  />
                  <Stat
                    label="Total"
                    value={formatBytes(importProgress.bytes_total)}
                  />
                  <Stat
                    label="Statements"
                    value={formatNumber(importProgress.statements_executed)}
                    accent
                  />
                  <Stat
                    label={importProgress.errors_count > 0 ? "Errors ⚠" : "Errors"}
                    value={formatNumber(importProgress.errors_count)}
                  />
                </div>
                <Stat
                  label="Elapsed / ETA"
                  value={
                    isTerminal
                      ? formatDuration(importProgress.elapsed_ms)
                      : `${formatDuration(localElapsedMs)} / ${formatEta(localElapsedMs, progressPercent)}`
                  }
                />
                {importProgress.current_statement_preview && (
                  <div style={{
                    background: "var(--bg-base)",
                    border: "1px solid var(--border)",
                    borderLeft: "2px solid var(--accent)",
                    borderRadius: 3,
                    padding: "6px 10px",
                    fontSize: 10,

                    color: "var(--text-muted)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                    title={importProgress.current_statement_preview}
                  >
                    {importProgress.current_statement_preview}
                  </div>
                )}
                {/* Last non-fatal error — visible even when stop_on_error = false */}
                {importProgress.errors_count > 0 && importProgress.last_error && phase !== "error" && (
                  <div style={{
                    background: "rgba(244,71,71,0.04)",
                    border: "1px solid rgba(244,71,71,0.25)",
                    borderLeft: "3px solid rgba(244,71,71,0.6)",
                    borderRadius: 3,
                    padding: "6px 10px",
                    fontSize: 10,
                    color: "rgba(244,71,71,0.85)",
                    wordBreak: "break-all",
                    maxHeight: 64,
                    overflowY: "auto",
                  }}
                    title={importProgress.last_error}
                  >
                    <span style={{ fontWeight: 700, marginRight: 4 }}>Last error:</span>
                    {importProgress.last_error}
                  </div>
                )}
              </>
            )}

            {/* Error block */}
            {phase === "error" && progress?.error && (
              <div style={{
                background: "rgba(244,71,71,0.06)",
                border: "1px solid rgba(244,71,71,0.3)",
                borderLeft: "3px solid #f44747",
                borderRadius: 3,
                padding: "10px 12px",
                fontSize: 11,
                
                color: "#f44747",
                wordBreak: "break-all",
                maxHeight: 100,
                overflowY: "auto",
              }}>
                {progress.error}
              </div>
            )}

            {/* Cancelled note */}
            {phase === "cancelled" && (
              <div style={{
                fontSize: 12,
                color: "var(--text-muted)",
                textAlign: "center",
                padding: "4px 0",
              }}>
                Operation cancelled by user
              </div>
            )}
          </div>

          {/* Footer */}
          <div style={{
            padding: "12px 20px",
            borderTop: "1px solid var(--border)",
            display: "flex",
            justifyContent: "flex-end",
            background: "rgba(0,0,0,0.15)",
          }}>
            {isTerminal ? (
              <button
                className="btn-primary"
                onClick={() => setActiveOperation(null)}
              >
                Close
              </button>
            ) : (
              <button
                className="btn-danger"
                onClick={handleCancel}
                disabled={cancelling}
                style={{ opacity: cancelling ? 0.5 : 1 }}
              >
                {cancelling ? (
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span className="spinner spinner-sm" />
                    Cancelling...
                  </span>
                ) : (
                  "Cancel operation"
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
