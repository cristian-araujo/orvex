import { useRef, useCallback, useEffect } from "react";
import MonacoEditor, { type OnMount } from "@monaco-editor/react";
import { invoke } from "@tauri-apps/api/core";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { useShallow } from "zustand/react/shallow";
import { useAppStore, getActiveSession } from "../../store/useAppStore";
import type { QueryTab } from "../../types";

const EMPTY_TABS: QueryTab[] = [];
import type { editor } from "monaco-editor";
import { KeyCode, KeyMod } from "monaco-editor";

export const sqlEditorBridge = {
  executeCurrentStatement: (() => {}) as () => void,
};

function extractStatementAtCursor(sql: string, offset: number): string {
  let start = 0;
  let end = sql.length;
  for (let i = offset - 1; i >= 0; i--) {
    if (sql[i] === ";") { start = i + 1; break; }
  }
  for (let i = offset; i < sql.length; i++) {
    if (sql[i] === ";") { end = i; break; }
  }
  return sql.slice(start, end).trim();
}

function ensureLimit(sql: string, defaultLimit = 1000): { sql: string; autoLimited: boolean } {
  const trimmed = sql.trim();
  const first = trimmed.split(/\s+/)[0]?.toUpperCase() ?? "";
  if (!["SELECT", "SHOW", "WITH", "DESCRIBE", "DESC", "EXPLAIN"].includes(first)) {
    return { sql: trimmed, autoLimited: false };
  }
  if (/\bLIMIT\s+\d+/i.test(trimmed)) {
    return { sql: trimmed, autoLimited: false };
  }
  const clean = trimmed.replace(/;\s*$/, "");
  return { sql: `${clean} LIMIT ${defaultLimit}`, autoLimited: true };
}

export function SqlEditor() {
  const { queryTabs, activeTabId, editorTabSize } = useAppStore(useShallow(s => {
    const session = getActiveSession(s);
    return {
      queryTabs: session?.queryTabs ?? EMPTY_TABS,
      activeTabId: session?.activeTabId ?? null,
      editorTabSize: s.settings.editor_tab_size,
    };
  }));
  const updateTabSql = useAppStore(s => s.updateTabSql);

  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  // Ref siempre apunta a la versión actual de executeQuery — evita stale closure en Monaco commands
  const executeQueryRef = useRef<() => void>(() => {});
  const executeCurrentStatementRef = useRef<() => void>(() => {});
  // Cursor/selection snapshot actualizado en cada cambio — no depende del focus al momento del click
  const lastCursorStateRef = useRef<{ offset: number; selectionText: string | null }>({ offset: 0, selectionText: null });

  const activeTab = queryTabs.find((t) => t.id === activeTabId);

  const executeQuery = useCallback(async () => {
    const state = useAppStore.getState();
    const activeSession = getActiveSession(state);
    if (!activeSession) return;
    const { activeTabId, connectionId: activeConnectionId, selectedDatabase } = activeSession;
    if (!activeTabId || !activeConnectionId) return;

    const tab = activeSession.queryTabs.find((t) => t.id === activeTabId);
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

    const { sql: safeSql, autoLimited } = ensureLimit(sql);

    useAppStore.getState().setTabExecuting(activeTabId, true);
    useAppStore.getState().setTabError(activeTabId, null);
    useAppStore.getState().setActiveBottomTab("results");

    try {
      const result = await invoke("execute_query", { connectionId: activeConnectionId, sql: safeSql, database: selectedDatabase });
      useAppStore.getState().setTabResult(activeTabId, result as any);
      useAppStore.getState().setTabAutoLimited(activeTabId, autoLimited);
    } catch (e) {
      useAppStore.getState().setTabError(activeTabId, String(e));
      useAppStore.getState().setActiveBottomTab("messages");
    } finally {
      useAppStore.getState().setTabExecuting(activeTabId, false);
    }
  }, []); // sin deps — lee store directamente, nunca es stale

  const executeCurrentStatement = useCallback(async () => {
    const state = useAppStore.getState();
    const activeSession = getActiveSession(state);
    if (!activeSession) return;
    const { activeTabId, connectionId: activeConnectionId, selectedDatabase } = activeSession;
    if (!activeTabId || !activeConnectionId) return;

    const tab = activeSession.queryTabs.find((t) => t.id === activeTabId);
    if (!tab) return;

    // Usar lastCursorStateRef — poblado por onDidChangeCursorSelection, no depende del focus
    const { selectionText, offset } = lastCursorStateRef.current;
    const sql = selectionText ?? extractStatementAtCursor(tab.sql, offset);

    if (!sql) return;

    const { sql: safeSql, autoLimited } = ensureLimit(sql);

    useAppStore.getState().setTabExecuting(activeTabId, true);
    useAppStore.getState().setTabError(activeTabId, null);
    useAppStore.getState().setActiveBottomTab("results");

    try {
      const result = await invoke("execute_query", { connectionId: activeConnectionId, sql: safeSql, database: selectedDatabase });
      useAppStore.getState().setTabResult(activeTabId, result as any);
      useAppStore.getState().setTabAutoLimited(activeTabId, autoLimited);
    } catch (e) {
      useAppStore.getState().setTabError(activeTabId, String(e));
      useAppStore.getState().setActiveBottomTab("messages");
    } finally {
      useAppStore.getState().setTabExecuting(activeTabId, false);
    }
  }, []); // sin deps — lee store directamente, nunca es stale

  // Mantener refs actualizados
  useEffect(() => {
    executeQueryRef.current = executeQuery;
  }, [executeQuery]);

  useEffect(() => {
    executeCurrentStatementRef.current = executeCurrentStatement;
  }, [executeCurrentStatement]);

  const handleMount: OnMount = (editorInstance) => {
    editorRef.current = editorInstance;

    // Override clipboard for WebKitGTK — document.execCommand('cut'/'copy'/'paste') doesn't work.
    // 1. Register custom clipboard actions with context menu entries
    editorInstance.addAction({
      id: "tauri-paste",
      label: "Paste",
      keybindings: [KeyMod.CtrlCmd | KeyCode.KeyV],
      contextMenuGroupId: "9_cutcopypaste",
      contextMenuOrder: 3,
      run: async (ed) => {
        try {
          const text = await readText();
          ed.trigger("clipboard", "type", { text });
        } catch {
          // clipboard not available
        }
      },
    });

    editorInstance.addAction({
      id: "tauri-copy",
      label: "Copy",
      keybindings: [KeyMod.CtrlCmd | KeyCode.KeyC],
      contextMenuGroupId: "9_cutcopypaste",
      contextMenuOrder: 2,
      run: async (ed) => {
        const sel = ed.getSelection();
        if (sel && !sel.isEmpty()) {
          const text = ed.getModel()?.getValueInRange(sel) ?? "";
          writeText(text).catch(() => {});
        }
      },
    });

    editorInstance.addAction({
      id: "tauri-cut",
      label: "Cut",
      keybindings: [KeyMod.CtrlCmd | KeyCode.KeyX],
      contextMenuGroupId: "9_cutcopypaste",
      contextMenuOrder: 1,
      run: async (ed) => {
        const sel = ed.getSelection();
        if (sel && !sel.isEmpty()) {
          const text = ed.getModel()?.getValueInRange(sel) ?? "";
          writeText(text).catch(() => {});
          ed.executeEdits("cut", [{ range: sel, text: "" }]);
        }
      },
    });

    // 2. Remove built-in clipboard items from context menu by patching the contribution
    const clipboardIds = new Set([
      "editor.action.clipboardCutAction",
      "editor.action.clipboardCopyAction",
      "editor.action.clipboardPasteAction",
    ]);
    const contextMenuContrib = editorInstance.getContribution("editor.contrib.contextmenu") as any;
    if (contextMenuContrib?._getMenuActions) {
      const origGetMenuActions = contextMenuContrib._getMenuActions.bind(contextMenuContrib);
      contextMenuContrib._getMenuActions = (...args: unknown[]) => {
        const actions = origGetMenuActions(...args);
        return actions.filter((a: any) => !clipboardIds.has(a.id));
      };
    }

    // Mantener snapshot de cursor/selección independiente del focus
    editorInstance.onDidChangeCursorSelection((e) => {
      const model = editorInstance.getModel();
      if (!model) return;
      const sel = e.selection;
      if (sel.isEmpty()) {
        lastCursorStateRef.current = { offset: model.getOffsetAt(sel.getStartPosition()), selectionText: null };
      } else {
        lastCursorStateRef.current = { offset: 0, selectionText: model.getValueInRange(sel) };
      }
    });

    // Los comandos invocan el ref, que siempre apunta a la función actual
    editorInstance.addCommand(KeyCode.F9, () => executeQueryRef.current());
    editorInstance.addCommand(KeyCode.F5, () => executeQueryRef.current());
    editorInstance.addCommand(KeyMod.CtrlCmd | KeyCode.Enter, () => executeCurrentStatementRef.current());

    // Actualizar bridge para que App.tsx pueda invocar executeCurrentStatement
    sqlEditorBridge.executeCurrentStatement = () => executeCurrentStatementRef.current();
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
          tabSize: editorTabSize,
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
        F9/F5 · Ctrl+Enter current
      </div>
    </div>
  );
}
