import { useEffect, useState, useRef } from "react";
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from "react-resizable-panels";
import { invoke } from "@tauri-apps/api/core";
import { useShallow } from "zustand/react/shallow";
import { useAppStore, getActiveSession } from "./store/useAppStore";
import { ConnectionDialog } from "./components/ConnectionManager/ConnectionDialog";
import { ObjectBrowser } from "./components/ObjectBrowser/ObjectBrowser";
import { SqlEditor } from "./components/SqlEditor/SqlEditor";
import { ResultsGrid } from "./components/ResultsGrid/ResultsGrid";
import { TableStructure } from "./components/TableStructure/TableStructure";
import { Toolbar } from "./components/Layout/Toolbar";
import { ConnectionTabs } from "./components/Layout/ConnectionTabs";
import { StatusBar } from "./components/Layout/StatusBar";
import { loadPersistedState, deserializeSession, startAutoSave, forceSave } from "./store/sessionPersistence";
import { useClipboardFix } from "./hooks/useClipboardFix";
import { ExportDialog } from "./components/ImportExport/ExportDialog";
import { ImportDialog } from "./components/ImportExport/ImportDialog";
import { ProgressDialog } from "./components/ImportExport/ProgressDialog";
import type { ConnectionConfig } from "./types";

function QueryTabs() {
  const { queryTabs, activeTabId, activeConnectionId, selectedDatabase } = useAppStore(useShallow(s => {
    const session = getActiveSession(s);
    return {
      queryTabs: session?.queryTabs ?? [],
      activeTabId: session?.activeTabId ?? null,
      activeConnectionId: session?.connectionId ?? null,
      selectedDatabase: session?.selectedDatabase ?? null,
    };
  }));
  const { setActiveTab, closeQueryTab, addQueryTab, setTabResult, setTabExecuting, setTabError, setActiveBottomTab } = useAppStore(useShallow(s => ({
    setActiveTab: s.setActiveTab,
    closeQueryTab: s.closeQueryTab,
    addQueryTab: s.addQueryTab,
    setTabResult: s.setTabResult,
    setTabExecuting: s.setTabExecuting,
    setTabError: s.setTabError,
    setActiveBottomTab: s.setActiveBottomTab,
  })));

  const activeTab = queryTabs.find((t) => t.id === activeTabId);
  const canExecute = activeTab?.type === "query" && !!activeTab.sql.trim();

  const execute = async () => {
    if (!activeTabId || !activeConnectionId || !canExecute) return;
    setTabExecuting(activeTabId, true);
    setTabError(activeTabId, null);
    setActiveBottomTab("results");
    try {
      const result = await (await import("@tauri-apps/api/core")).invoke("execute_query", {
        connectionId: activeConnectionId,
        sql: activeTab!.sql.trim(),
        database: selectedDatabase,
      });
      setTabResult(activeTabId, result as any);
    } catch (e) {
      setTabError(activeTabId, String(e));
      setActiveBottomTab("messages");
    } finally {
      setTabExecuting(activeTabId, false);
    }
  };

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      background: "var(--bg-panel)",
      borderBottom: "1px solid var(--border)",
      height: 34,
      flexShrink: 0,
    }}>
      <div style={{ display: "flex", alignItems: "center", flex: 1, overflowX: "auto", height: "100%" }}>
        {queryTabs.map((tab) => (
          <div
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "0 12px",
              height: "100%",
              cursor: "pointer",
              whiteSpace: "nowrap",
              fontSize: 12,
              background: activeTabId === tab.id ? "var(--bg-surface)" : "transparent",
              color: activeTabId === tab.id ? "var(--text-bright)" : "var(--text-muted)",
              borderBottom: activeTabId === tab.id ? "2px solid var(--accent)" : "2px solid transparent",
              borderRight: "1px solid var(--border)",
            }}
          >
            <span>{tab.isExecuting ? "⟳" : tab.type === "table" ? "▤" : "📄"}</span>
            <span>{tab.title}</span>
            {queryTabs.length > 1 && (
              <span
                onClick={(e) => { e.stopPropagation(); closeQueryTab(tab.id); }}
                style={{
                  marginLeft: 4,
                  opacity: 0.5,
                  fontSize: 10,
                  lineHeight: 1,
                  padding: "1px 3px",
                  borderRadius: 2,
                }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLSpanElement).style.opacity = "1")}
                onMouseLeave={(e) => ((e.currentTarget as HTMLSpanElement).style.opacity = "0.5")}
              >
                ✕
              </span>
            )}
          </div>
        ))}
        <button
          onClick={() => addQueryTab()}
          style={{
            background: "transparent",
            border: "none",
            color: "var(--text-muted)",
            padding: "0 10px",
            height: "100%",
            fontSize: 16,
            cursor: "pointer",
            flexShrink: 0,
          }}
          title="New Tab (Ctrl+T)"
        >
          +
        </button>
      </div>
      {/* Execute button */}
      <button
        onClick={execute}
        disabled={!canExecute}
        style={{
          background: "transparent",
          border: "none",
          color: canExecute ? "var(--success)" : "var(--text-muted)",
          padding: "0 10px",
          height: "100%",
          fontSize: 12,
          cursor: canExecute ? "pointer" : "default",
          opacity: canExecute ? 1 : 0.4,
          flexShrink: 0,
          borderLeft: "1px solid var(--border)",
        }}
        title="Execute (F9)"
      >
        ▶ Execute
      </button>
    </div>
  );
}

function ActiveTabContent() {
  const { queryTabs, activeTabId } = useAppStore(useShallow(s => {
    const session = getActiveSession(s);
    return {
      queryTabs: session?.queryTabs ?? [],
      activeTabId: session?.activeTabId ?? null,
    };
  }));
  const activeTab = queryTabs.find((t) => t.id === activeTabId);
  const isTableTab = activeTab?.type === "table" && !!activeTab.database && !!activeTab.table;

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <QueryTabs />

      {/* Editor + Results: siempre montado, oculto cuando el tab activo es de tabla.
          Evita destruir/recrear Monaco (20MB) en cada cambio de tab. */}
      <div style={{ flex: 1, overflow: "hidden", display: isTableTab ? "none" : "flex", flexDirection: "column" }}>
        <PanelGroup orientation="vertical" style={{ height: "100%" }}>
          <Panel defaultSize="55%" minSize="80px">
            <div style={{ height: "100%", overflow: "hidden" }}>
              <SqlEditor />
            </div>
          </Panel>
          <PanelResizeHandle style={{ height: 4, cursor: "row-resize" }} />
          <Panel defaultSize="45%" minSize="60px">
            <ResultsGrid />
          </Panel>
        </PanelGroup>
      </div>

      {/* TableStructure: solo montado cuando el tab activo es de tabla */}
      {isTableTab && (
        <div style={{ flex: 1, overflow: "hidden" }}>
          <TableStructure database={activeTab!.database!} table={activeTab!.table!} />
        </div>
      )}
    </div>
  );
}

export default function App() {
  const { showConnectionDialog, showExportDialog, showImportDialog, activeOperation, activeConnectionId, sessions } = useAppStore(useShallow(s => {
    const session = getActiveSession(s);
    return {
      showConnectionDialog: s.showConnectionDialog,
      showExportDialog: s.showExportDialog,
      showImportDialog: s.showImportDialog,
      activeOperation: s.activeOperation,
      activeConnectionId: session?.connectionId ?? null,
      sessions: s.sessions,
    };
  }));
  const setShowConnectionDialog = useAppStore(s => s.setShowConnectionDialog);
  const [appReady, setAppReady] = useState(false);
  const initRef = useRef(false);

  // Fix clipboard operations on Linux/WebKitGTK
  useClipboardFix();

  // Session restoration on mount
  useEffect(() => {
    if (initRef.current) return;
    initRef.current = true;

    async function init() {
      const persisted = await loadPersistedState();

      if (!persisted || persisted.sessions.length === 0) {
        setAppReady(true);
        startAutoSave();
        return;
      }

      // Deserialize and hydrate store
      const restoredSessions = persisted.sessions.map(deserializeSession);
      useAppStore.getState().restoreSessions(restoredSessions, persisted.activeSessionId);

      // Reconnect each session in parallel
      const results = await Promise.allSettled(
        restoredSessions.map(async (session) => {
          const connectionId = await invoke<string>("connect", {
            config: session.connectionConfig as ConnectionConfig,
          });
          useAppStore.getState().updateSessionConnectionId(session.id, connectionId);
          return session.id;
        }),
      );

      // Log failed reconnections — sessions stay with connectionId="" (disconnected)
      for (let i = 0; i < results.length; i++) {
        if (results[i].status === "rejected") {
          console.error(
            `Failed to reconnect session ${restoredSessions[i].connectionName}:`,
            (results[i] as PromiseRejectedResult).reason,
          );
        }
      }

      useAppStore.getState().setIsRestoring(false);
      startAutoSave();
      setAppReady(true);
    }

    init();
  }, []);

  // Force save on window close
  useEffect(() => {
    const handler = () => { forceSave(); };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "t") {
        e.preventDefault();
        useAppStore.getState().addQueryTab();
      }
      if (e.ctrlKey && e.key === "w") {
        e.preventDefault();
        const state = useAppStore.getState();
        const activeSession = getActiveSession(state);
        if (activeSession?.activeTabId) state.closeQueryTab(activeSession.activeTabId);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Loading screen while restoring sessions
  if (!appReady) {
    return (
      <div style={{
        height: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        gap: 16,
        color: "var(--text-muted)",
      }}>
        <div style={{ fontSize: 48 }}>🐬</div>
        <div style={{ fontSize: 14 }}>Reconnecting sessions...</div>
      </div>
    );
  }

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      {showConnectionDialog && <ConnectionDialog />}
      {showExportDialog && <ExportDialog />}
      {showImportDialog && <ImportDialog />}
      {activeOperation && (
        <ProgressDialog type={activeOperation.type} operationId={activeOperation.operationId} />
      )}

      <Toolbar />
      <ConnectionTabs />

      <div style={{ flex: 1, overflow: "hidden", display: "flex" }}>
        {sessions.length > 0 && activeConnectionId ? (
          <PanelGroup orientation="horizontal" style={{ height: "100%" }}>
            <Panel defaultSize="18%" minSize="150px" maxSize="50%">
              <ObjectBrowser />
            </Panel>
            <PanelResizeHandle style={{ width: 4, cursor: "col-resize" }} />
            <Panel minSize="25%">
              <ActiveTabContent />
            </Panel>
          </PanelGroup>
        ) : (
          <div style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexDirection: "column",
            gap: 16,
            color: "var(--text-muted)",
          }}>
            <div style={{ fontSize: 48 }}>🐬</div>
            <div style={{ fontSize: 18 }}>MySQL GUI</div>
            <button
              className="btn-primary"
              style={{ marginTop: 8 }}
              onClick={() => setShowConnectionDialog(true)}
            >
              Connect to Database
            </button>
          </div>
        )}
      </div>

      <StatusBar />
    </div>
  );
}
