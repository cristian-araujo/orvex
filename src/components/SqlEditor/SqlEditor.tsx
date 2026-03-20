import { useRef, useCallback, useEffect } from "react";
import MonacoEditor, { type OnMount } from "@monaco-editor/react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../../store/useAppStore";
import type { editor } from "monaco-editor";
import { KeyCode } from "monaco-editor";

export function SqlEditor() {
  const { queryTabs, activeTabId, updateTabSql } = useAppStore();

  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  // Ref siempre apunta a la versión actual de executeQuery — evita stale closure en Monaco commands
  const executeQueryRef = useRef<() => void>(() => {});

  const activeTab = queryTabs.find((t) => t.id === activeTabId);

  const executeQuery = useCallback(async () => {
    const { activeTabId, activeConnectionId } = useAppStore.getState();
    if (!activeTabId || !activeConnectionId) return;

    const tab = useAppStore.getState().queryTabs.find((t) => t.id === activeTabId);
    if (!tab) return;

    let sql = tab.sql.trim();
    const editor = editorRef.current;
    if (editor) {
      const selection = editor.getSelection();
      if (selection && !selection.isEmpty()) {
        sql = editor.getModel()?.getValueInRange(selection) ?? sql;
      }
    }

    if (!sql) return;

    useAppStore.getState().setTabExecuting(activeTabId, true);
    useAppStore.getState().setTabError(activeTabId, null);
    useAppStore.getState().setActiveBottomTab("results");

    try {
      const result = await invoke("execute_query", { connectionId: activeConnectionId, sql });
      useAppStore.getState().setTabResult(activeTabId, result as any);
    } catch (e) {
      useAppStore.getState().setTabError(activeTabId, String(e));
      useAppStore.getState().setActiveBottomTab("messages");
    } finally {
      useAppStore.getState().setTabExecuting(activeTabId, false);
    }
  }, []); // sin deps — lee store directamente, nunca es stale

  // Mantener el ref actualizado
  useEffect(() => {
    executeQueryRef.current = executeQuery;
  }, [executeQuery]);

  const handleMount: OnMount = (editorInstance) => {
    editorRef.current = editorInstance;
    // Los comandos invocan el ref, que siempre apunta a la función actual
    editorInstance.addCommand(KeyCode.F9, () => executeQueryRef.current());
    editorInstance.addCommand(KeyCode.F5, () => executeQueryRef.current());
  };

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
