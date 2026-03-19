import { useRef, useCallback } from "react";
import MonacoEditor, { type OnMount } from "@monaco-editor/react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../../store/useAppStore";
import type { editor } from "monaco-editor";

export function SqlEditor() {
  const {
    queryTabs,
    activeTabId,
    activeConnectionId,
    updateTabSql,
    setTabResult,
    setTabExecuting,
    setTabError,
    setActiveBottomTab,
  } = useAppStore();

  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);

  const activeTab = queryTabs.find((t) => t.id === activeTabId);

  const handleMount: OnMount = (editorInstance) => {
    editorRef.current = editorInstance;

    editorInstance.addCommand(
      // F9 key code = 120
      120,
      () => executeQuery()
    );
    editorInstance.addCommand(
      // F5 key code = 116
      116,
      () => executeQuery()
    );
  };

  const executeQuery = useCallback(async () => {
    if (!activeTabId || !activeConnectionId) return;

    const tab = useAppStore.getState().queryTabs.find((t) => t.id === activeTabId);
    if (!tab) return;

    // Get selected text or full content
    let sql = tab.sql.trim();
    const editor = editorRef.current;
    if (editor) {
      const selection = editor.getSelection();
      if (selection && !selection.isEmpty()) {
        sql = editor.getModel()?.getValueInRange(selection) ?? sql;
      }
    }

    if (!sql) return;

    setTabExecuting(activeTabId, true);
    setTabError(activeTabId, null);
    setActiveBottomTab("results");

    try {
      const result = await invoke("execute_query", {
        connectionId: activeConnectionId,
        sql,
      });
      setTabResult(activeTabId, result as any);
    } catch (e) {
      setTabError(activeTabId, String(e));
      setActiveBottomTab("messages");
    } finally {
      setTabExecuting(activeTabId, false);
    }
  }, [activeTabId, activeConnectionId]);

  if (!activeTab) {
    return (
      <div style={{
        flex: 1,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--text-muted)",
        fontSize: 14,
      }}>
        No query tab open
      </div>
    );
  }

  return (
    <div style={{ height: "100%", position: "relative" }}>
      <MonacoEditor
        height="100%"
        language="sql"
        theme="vs-dark"
        value={activeTab.sql}
        onChange={(v) => updateTabSql(activeTab.id, v ?? "")}
        onMount={handleMount}
        options={{
          fontSize: 14,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          wordWrap: "on",
          automaticLayout: true,
          renderLineHighlight: "line",
          suggestOnTriggerCharacters: true,
          quickSuggestions: true,
          padding: { top: 8, bottom: 8 },
        }}
      />
      {/* Execute button hint */}
      <div style={{
        position: "absolute",
        top: 6,
        right: 10,
        fontSize: 11,
        color: "var(--text-muted)",
        pointerEvents: "none",
      }}>
        F9 / F5 to execute
      </div>
    </div>
  );
}
