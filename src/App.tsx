import { useEffect } from "react";
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from "react-resizable-panels";
import { useAppStore } from "./store/useAppStore";
import { ConnectionDialog } from "./components/ConnectionManager/ConnectionDialog";
import { ObjectBrowser } from "./components/ObjectBrowser/ObjectBrowser";
import { SqlEditor } from "./components/SqlEditor/SqlEditor";
import { ResultsGrid } from "./components/ResultsGrid/ResultsGrid";
import { Toolbar } from "./components/Layout/Toolbar";
import { StatusBar } from "./components/Layout/StatusBar";

function QueryTabs() {
  const { queryTabs, activeTabId, setActiveTab, closeQueryTab, addQueryTab } = useAppStore();

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      background: "var(--bg-panel)",
      borderBottom: "1px solid var(--border)",
      overflowX: "auto",
      height: 34,
      flexShrink: 0,
    }}>
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
          <span>{tab.isExecuting ? "⟳" : "📄"}</span>
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
  );
}

export default function App() {
  const { showConnectionDialog, activeConnectionId, setShowConnectionDialog } = useAppStore();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "t") {
        e.preventDefault();
        useAppStore.getState().addQueryTab();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      {showConnectionDialog && <ConnectionDialog />}

      <Toolbar />

      <div style={{ flex: 1, overflow: "hidden", display: "flex" }}>
        {activeConnectionId ? (
          <PanelGroup orientation="horizontal" style={{ height: "100%" }}>
            <Panel defaultSize="18%" minSize="150px" maxSize="50%">
              <ObjectBrowser />
            </Panel>
            <PanelResizeHandle style={{ width: 4, cursor: "col-resize" }} />
            <Panel minSize="25%">
              <PanelGroup orientation="vertical" style={{ height: "100%" }}>
                <Panel defaultSize="55%" minSize="80px">
                  <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
                    <QueryTabs />
                    <div style={{ flex: 1, overflow: "hidden" }}>
                      <SqlEditor />
                    </div>
                  </div>
                </Panel>
                <PanelResizeHandle style={{ height: 4, cursor: "row-resize" }} />
                <Panel defaultSize="45%" minSize="60px">
                  <ResultsGrid />
                </Panel>
              </PanelGroup>
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
