import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useShallow } from "zustand/react/shallow";
import { useAppStore, getActiveSession } from "../../store/useAppStore";
import type { ImportOptions } from "../../types";



function basename(path: string): string {
  return path.replace(/\\/g, "/").split("/").pop() ?? path;
}

export function ImportDialog() {
  const { connectionId, selectedDatabase, setShowImportDialog, setActiveOperation, importDefaultDirectory } =
    useAppStore(useShallow((s) => {
      const session = getActiveSession(s);
      return {
        connectionId: session?.connectionId ?? null,
        selectedDatabase: session?.selectedDatabase ?? null,
        setShowImportDialog: s.setShowImportDialog,
        setActiveOperation: s.setActiveOperation,
        importDefaultDirectory: s.settings.import_default_directory,
      };
    }));

  const [filePath, setFilePath] = useState("");
  const [database, setDatabase] = useState(selectedDatabase ?? "");
  const [stopOnError, setStopOnError] = useState(true);
  const [starting, setStarting] = useState(false);
  const [hovering, setHovering] = useState(false);

  const handleBrowse = async () => {
    const path = await open({
      multiple: false,
      filters: [{ name: "SQL / Dump", extensions: ["sql", "dump", "txt"] }],
      defaultPath: importDefaultDirectory || undefined,
    });
    if (path) setFilePath(path);
  };

  const handleImport = async () => {
    if (!connectionId || !filePath) return;
    setStarting(true);
    try {
      const options: ImportOptions = {
        file_path: filePath,
        database,
        stop_on_error: stopOnError,
      };
      const operationId = await invoke<string>("start_import", { connectionId, options });
      setShowImportDialog(false);
      setActiveOperation({ type: "import", operationId });
    } catch (e) {
      alert(String(e));
    } finally {
      setStarting(false);
    }
  };

  const canImport = !!filePath && !starting;

  const label: React.CSSProperties = {
    fontSize: 10,
    letterSpacing: "0.08em",
    fontWeight: 700,
    color: "var(--text-muted)",
    textTransform: "uppercase",
    marginBottom: 8,
  };

  return (
    <>
      <style>{`
        @keyframes dlg-in {
          from { opacity: 0; transform: scale(0.975) translateY(10px); }
          to   { opacity: 1; transform: scale(1)     translateY(0);    }
        }
        .import-dlg { animation: dlg-in 0.18s cubic-bezier(0.16,1,0.3,1); }
        .err-pill:hover { opacity: 0.9 !important; }
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
        onClick={() => setShowImportDialog(false)}
      >
        <div
          className="import-dlg"
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
            <div>
              <div style={{ fontSize: 10, letterSpacing: "0.12em", color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", marginBottom: 2 }}>
                SQL Import
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-bright)" }}>
                Execute SQL file
              </div>
            </div>
            <button
              onClick={() => setShowImportDialog(false)}
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

          {/* Body */}
          <div style={{ padding: "20px", display: "flex", flexDirection: "column", gap: 18 }}>

            {/* File drop zone */}
            <div>
              <div style={label}>Source File</div>
              <div
                onClick={handleBrowse}
                onMouseEnter={() => setHovering(true)}
                onMouseLeave={() => setHovering(false)}
                style={{
                  border: `1.5px dashed ${filePath ? "var(--accent)" : hovering ? "var(--text-muted)" : "var(--border)"}`,
                  borderRadius: 4,
                  padding: filePath ? "14px 16px" : "28px 20px",
                  background: filePath
                    ? "rgba(0,120,212,0.05)"
                    : hovering
                      ? "rgba(255,255,255,0.02)"
                      : "var(--bg-base)",
                  cursor: "pointer",
                  transition: "all 0.15s",
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  userSelect: "none",
                }}
              >
                {filePath ? (
                  <>
                    {/* File icon */}
                    <div style={{
                      width: 32,
                      height: 32,
                      background: "rgba(0,120,212,0.15)",
                      borderRadius: 3,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      flexShrink: 0,
                    }}>
                      <svg width="14" height="16" viewBox="0 0 14 16" fill="none">
                        <path d="M1 1h8l4 4v10H1V1z" stroke="var(--accent)" strokeWidth="1.2" fill="none" />
                        <path d="M9 1v4h4" stroke="var(--accent)" strokeWidth="1.2" fill="none" />
                        <path d="M3 8h8M3 11h5" stroke="var(--accent)" strokeWidth="1" />
                      </svg>
                    </div>
                    <div style={{ overflow: "hidden" }}>
                      <div style={{
                        fontSize: 12,
                        
                        color: "var(--text-bright)",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}>
                        {basename(filePath)}
                      </div>
                      <div style={{
                        fontSize: 10,
                        color: "var(--text-muted)",
                        marginTop: 2,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        
                      }}>
                        {filePath}
                      </div>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); setFilePath(""); }}
                      style={{
                        marginLeft: "auto",
                        background: "transparent",
                        border: "none",
                        color: "var(--text-muted)",
                        fontSize: 14,
                        cursor: "pointer",
                        padding: 4,
                        flexShrink: 0,
                      }}
                    >
                      ✕
                    </button>
                  </>
                ) : (
                  <div style={{ textAlign: "center", width: "100%" }}>
                    <div style={{ fontSize: 22, marginBottom: 8, opacity: 0.4 }}>
                      ↑
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text)", marginBottom: 4 }}>
                      Click to select a SQL file
                    </div>
                    <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
                      .sql · .dump · .txt
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Target database */}
            <div>
              <div style={label}>Target Database</div>
              <input
                type="text"
                value={database}
                onChange={(e) => setDatabase(e.target.value)}
                placeholder="Optional — overrides USE statements in file"
                style={{ width: "100%",  fontSize: 12 }}
              />
            </div>

            {/* Error handling */}
            <div>
              <div style={label}>On Error</div>
              <div style={{ display: "flex", gap: 6 }}>
                {[true, false].map((v) => (
                  <div
                    key={String(v)}
                    className="err-pill"
                    onClick={() => setStopOnError(v)}
                    style={{
                      flex: 1,
                      padding: "8px 12px",
                      border: `1px solid ${stopOnError === v ? "var(--accent)" : "var(--border)"}`,
                      borderLeft: `3px solid ${stopOnError === v ? "var(--accent)" : "transparent"}`,
                      background: stopOnError === v ? "rgba(0,120,212,0.08)" : "var(--bg-surface)",
                      borderRadius: 3,
                      cursor: "pointer",
                      transition: "all 0.1s",
                      userSelect: "none",
                    }}
                  >
                    <div style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: stopOnError === v ? "var(--text-bright)" : "var(--text)",
                    }}>
                      {v ? "Stop on first error" : "Continue on errors"}
                    </div>
                    <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 2 }}>
                      {v ? "Safe — rolls back on failure" : "Best-effort — counts errors"}
                    </div>
                  </div>
                ))}
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
            background: "rgba(0,0,0,0.15)",
          }}>
            <button
              className="btn-secondary"
              onClick={() => setShowImportDialog(false)}
            >
              Cancel
            </button>
            <button
              className="btn-primary"
              onClick={handleImport}
              disabled={!canImport}
              style={{ opacity: canImport ? 1 : 0.4, minWidth: 100 }}
            >
              {starting ? (
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span className="spinner spinner-sm" />
                  Starting...
                </span>
              ) : (
                "Import →"
              )}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
