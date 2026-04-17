import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { v4 as uuidv4 } from "uuid";
import type {
  ConnectionConfig,
  ConnectionProfile,
  ConnectionSession,
  QueryResult,
  BottomTab,
  ColumnInfo,
  AppSettings,
} from "../types";
import { DEFAULT_SETTINGS } from "../types";

// --- Helper to get active session ---

export function getActiveSession(state: AppState): ConnectionSession | undefined {
  return state.sessions.find(s => s.id === state.activeSessionId);
}

// --- Session update helper ---

function withSessionUpdate(
  state: AppState,
  updater: (session: ConnectionSession) => Partial<ConnectionSession>,
) {
  return {
    sessions: state.sessions.map((s) => {
      if (s.id !== state.activeSessionId) return s;
      return { ...s, ...updater(s) };
    }),
  };
}

// --- State interface ---

interface AppState {
  // Global
  savedConnections: ConnectionProfile[];
  showConnectionDialog: boolean;
  showColorEditor: boolean;
  showExportDialog: boolean;
  showImportDialog: boolean;
  showSettingsDialog: boolean;
  activeOperation: { type: "export" | "import"; operationId: string } | null;
  settings: AppSettings;

  // Sessions
  sessions: ConnectionSession[];
  activeSessionId: string | null;
  isRestoring: boolean;
  reconnectingSessionId: string | null;
  reconnectError: string | null;

  // Session lifecycle
  createSession: (connectionId: string, name: string, config: ConnectionConfig, profileId?: string) => void;
  switchSession: (sessionId: string) => void;
  closeSession: (sessionId: string) => Promise<void>;
  restoreSessions: (sessions: ConnectionSession[], activeSessionId: string | null) => void;
  updateSessionConnectionId: (sessionId: string, connectionId: string) => void;
  reconnectSession: (sessionId: string) => Promise<void>;
  setIsRestoring: (restoring: boolean) => void;

  // Global actions
  setSavedConnections: (connections: ConnectionProfile[]) => void;
  setShowConnectionDialog: (show: boolean) => void;
  setShowColorEditor: (show: boolean) => void;
  setShowExportDialog: (show: boolean) => void;
  setShowImportDialog: (show: boolean) => void;
  setShowSettingsDialog: (show: boolean) => void;
  setActiveOperation: (op: { type: "export" | "import"; operationId: string } | null) => void;
  setSettings: (settings: AppSettings) => void;

  // Active session actions
  updateActiveConnectionConfig: (updates: Partial<ConnectionConfig>) => void;
  setSelectedDatabase: (db: string | null) => void;
  setDatabases: (dbs: string[]) => void;
  setDatabasesForSession: (sessionId: string, dbs: string[]) => void;
  toggleDb: (db: string) => void;
  setTables: (db: string, tables: { name: string; table_type: string }[]) => void;
  setExpandedTables: (expandedTables: Set<string>) => void;
  setColumns: (key: string, cols: ColumnInfo[]) => void;
  setDbFilter: (filter: string) => void;
  setTableFilter: (filter: string) => void;
  addQueryTab: (title?: string, sql?: string) => string;
  addTableTab: (database: string, table: string) => string;
  closeQueryTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  updateTabSql: (id: string, sql: string) => void;
  setTabResult: (id: string, result: QueryResult | null) => void;
  setTabExecuting: (id: string, executing: boolean) => void;
  setTabError: (id: string, error: string | null) => void;
  setActiveBottomTab: (tab: BottomTab) => void;
  setDataResult: (result: QueryResult | null, tableName: string | null, database?: string | null, table?: string | null, columns?: ColumnInfo[] | null) => void;
  setLoadingData: (loading: boolean) => void;
  setDataPage: (page: number) => void;
  setDataTotalRows: (total: number | null) => void;
  setTabAutoLimited: (id: string, autoLimited: boolean) => void;
  setDataPageSize: (size: number) => void;
}

export type { AppState };

export const useAppStore = create<AppState>((set, get) => ({
  // Global
  savedConnections: [],
  showConnectionDialog: true,
  showColorEditor: false,
  showExportDialog: false,
  showImportDialog: false,
  showSettingsDialog: false,
  activeOperation: null,
  settings: DEFAULT_SETTINGS,

  // Sessions
  sessions: [],
  activeSessionId: null,
  isRestoring: false,
  reconnectingSessionId: null,
  reconnectError: null,

  // --- Session lifecycle ---

  createSession: (connectionId, name, config, profileId) => {
    const sessionId = uuidv4();
    const tabId = uuidv4();
    const session: ConnectionSession = {
      id: sessionId,
      connectionId,
      connectionName: name,
      connectionConfig: config,
      profileId: profileId ?? null,
      selectedDatabase: null,
      databases: [],
      expandedDbs: new Set(),
      tables: {},
      expandedTables: new Set(),
      columns: {},
      dbFilter: "",
      tableFilter: "",
      queryTabs: [{ id: tabId, title: "Query 1", type: "query", sql: "", result: null, isExecuting: false, error: null }],
      activeTabId: tabId,
      activeBottomTab: "results",
      dataResult: null,
      dataTableName: null,
      dataDatabase: null,
      dataTable: null,
      dataColumns: null,
      dataPrimaryKeys: [],
      isLoadingData: false,
      dataPage: 0,
      dataPageSize: 1000,
      dataTotalRows: null,
    };
    set({
      sessions: [...get().sessions, session],
      activeSessionId: sessionId,
      showConnectionDialog: false,
    });
  },

  switchSession: (sessionId) => {
    const session = get().sessions.find((s) => s.id === sessionId);
    if (!session) return;
    set({ activeSessionId: sessionId });
  },

  closeSession: async (sessionId) => {
    const session = get().sessions.find((s) => s.id === sessionId);
    if (!session) return;

    // Disconnect from backend
    try {
      await invoke("disconnect", { connectionId: session.connectionId });
    } catch (_) {}

    const remaining = get().sessions.filter((s) => s.id !== sessionId);
    const wasActive = get().activeSessionId === sessionId;
    let nextSessionId: string | null = get().activeSessionId;

    if (wasActive) {
      // Activate the last remaining session, or null
      nextSessionId = remaining.length > 0 ? remaining[remaining.length - 1].id : null;
    }

    set({
      sessions: remaining,
      activeSessionId: nextSessionId,
      showConnectionDialog: remaining.length === 0,
    });
  },

  restoreSessions: (sessions, activeSessionId) => {
    set({
      isRestoring: true,
      sessions,
      activeSessionId,
      showConnectionDialog: false,
    });
  },

  updateSessionConnectionId: (sessionId, connectionId) => {
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === sessionId ? { ...sess, connectionId } : sess,
      ),
    }));
  },

  reconnectSession: async (sessionId) => {
    const session = get().sessions.find((s) => s.id === sessionId);
    if (!session) return;
    set({ reconnectingSessionId: sessionId, reconnectError: null });
    try {
      // Clean up stale pool first (best-effort — ignore if already gone)
      if (session.connectionId) {
        await (invoke("disconnect", { connectionId: session.connectionId }) as Promise<void>).catch(() => {});
      }
      const connectionId = await invoke<string>("connect", {
        config: session.connectionConfig as ConnectionConfig,
      });
      get().updateSessionConnectionId(sessionId, connectionId);
    } catch (e) {
      set({ reconnectError: String(e) });
      // Mark as disconnected so the reconnect overlay appears
      get().updateSessionConnectionId(sessionId, "");
    } finally {
      set({ reconnectingSessionId: null });
    }
  },

  setIsRestoring: (restoring) => set({ isRestoring: restoring }),

  // --- Global actions ---

  setSavedConnections: (connections) => set({ savedConnections: connections }),
  setShowConnectionDialog: (show) => set({ showConnectionDialog: show }),
  setShowColorEditor: (show) => set({ showColorEditor: show }),
  setShowExportDialog: (show) => set({ showExportDialog: show }),
  setShowImportDialog: (show) => set({ showImportDialog: show }),
  setShowSettingsDialog: (show) => set({ showSettingsDialog: show }),
  setActiveOperation: (op) => set({ activeOperation: op }),
  setSettings: (settings) => set({ settings }),

  // --- Active session actions ---

  updateActiveConnectionConfig: (updates) =>
    set((s) => ({
      sessions: s.sessions.map((sess) => {
        if (sess.id !== s.activeSessionId) return sess;
        return { ...sess, connectionConfig: { ...sess.connectionConfig, ...updates } };
      }),
    })),

  setSelectedDatabase: (db) =>
    set((s) => withSessionUpdate(s, () => ({ selectedDatabase: db }))),

  setDatabases: (dbs) =>
    set((s) => withSessionUpdate(s, () => ({ databases: dbs }))),

  setDatabasesForSession: (sessionId, dbs) =>
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === sessionId ? { ...sess, databases: dbs } : sess
      ),
    })),

  toggleDb: (db) =>
    set((s) => withSessionUpdate(s, (sess) => {
      const expanded = new Set(sess.expandedDbs);
      if (expanded.has(db)) expanded.delete(db);
      else expanded.add(db);
      return { expandedDbs: expanded };
    })),

  setTables: (db, tables) =>
    set((s) => withSessionUpdate(s, (sess) => ({
      tables: { ...sess.tables, [db]: tables },
    }))),

  setExpandedTables: (expandedTables) =>
    set((s) => withSessionUpdate(s, () => ({ expandedTables }))),

  setColumns: (key, cols) =>
    set((s) => withSessionUpdate(s, (sess) => ({
      columns: { ...sess.columns, [key]: cols },
    }))),

  setDbFilter: (filter) =>
    set((s) => withSessionUpdate(s, () => ({ dbFilter: filter }))),

  setTableFilter: (filter) =>
    set((s) => withSessionUpdate(s, () => ({ tableFilter: filter }))),

  addQueryTab: (title, sql = "") => {
    const id = uuidv4();
    set((s) => {
      const activeSession = s.sessions.find((sess) => sess.id === s.activeSessionId);
      const count = (activeSession?.queryTabs.filter((t) => t.type === "query").length ?? 0) + 1;
      return withSessionUpdate(s, (sess) => ({
        queryTabs: [
          ...sess.queryTabs,
          { id, title: title || `Query ${count}`, type: "query" as const, sql, result: null, isExecuting: false, error: null },
        ],
        activeTabId: id,
      }));
    });
    return id;
  },

  addTableTab: (database, table) => {
    const activeSession = get().sessions.find((s) => s.id === get().activeSessionId);
    const existing = activeSession?.queryTabs.find(
      (t) => t.type === "table" && t.database === database && t.table === table,
    );
    if (existing) {
      set((s) => withSessionUpdate(s, () => ({ activeTabId: existing.id })));
      return existing.id;
    }
    const id = uuidv4();
    set((s) => withSessionUpdate(s, (sess) => ({
      queryTabs: [
        ...sess.queryTabs,
        { id, title: table, type: "table" as const, sql: "", result: null, isExecuting: false, error: null, database, table },
      ],
      activeTabId: id,
    })));
    return id;
  },

  closeQueryTab: (id) =>
    set((s) => withSessionUpdate(s, (sess) => {
      const tabs = sess.queryTabs.filter((t) => t.id !== id);
      const activeTabId =
        sess.activeTabId === id ? (tabs[tabs.length - 1]?.id ?? null) : sess.activeTabId;
      return { queryTabs: tabs, activeTabId };
    })),

  setActiveTab: (id) =>
    set((s) => withSessionUpdate(s, () => ({ activeTabId: id }))),

  updateTabSql: (id, sql) =>
    set((s) => withSessionUpdate(s, (sess) => ({
      queryTabs: sess.queryTabs.map((t) => (t.id === id ? { ...t, sql } : t)),
    }))),

  setTabResult: (id, result) =>
    set((s) => withSessionUpdate(s, (sess) => ({
      queryTabs: sess.queryTabs.map((t) => (t.id === id ? { ...t, result, error: null } : t)),
    }))),

  setTabExecuting: (id, isExecuting) =>
    set((s) => withSessionUpdate(s, (sess) => ({
      queryTabs: sess.queryTabs.map((t) => (t.id === id ? { ...t, isExecuting } : t)),
    }))),

  setTabError: (id, error) =>
    set((s) => withSessionUpdate(s, (sess) => ({
      queryTabs: sess.queryTabs.map((t) => (t.id === id ? { ...t, error, result: null } : t)),
    }))),

  setActiveBottomTab: (tab) =>
    set((s) => withSessionUpdate(s, () => ({ activeBottomTab: tab }))),

  setDataResult: (result, tableName, database, table, columns) => {
    const pks = (columns ?? []).filter((c) => c.key === "PRI").map((c) => c.field);
    set((s) => withSessionUpdate(s, () => ({
      dataResult: result,
      dataTableName: tableName,
      dataDatabase: database ?? null,
      dataTable: table ?? null,
      dataColumns: columns ?? null,
      dataPrimaryKeys: pks,
      activeBottomTab: "data" as BottomTab,
    })));
  },

  setLoadingData: (loading) =>
    set((s) => withSessionUpdate(s, () => ({ isLoadingData: loading }))),

  setDataPage: (page) =>
    set((s) => withSessionUpdate(s, () => ({ dataPage: page }))),

  setDataTotalRows: (total) =>
    set((s) => withSessionUpdate(s, () => ({ dataTotalRows: total }))),

  setTabAutoLimited: (id, autoLimited) =>
    set((s) => withSessionUpdate(s, (sess) => ({
      queryTabs: sess.queryTabs.map((t) => (t.id === id ? { ...t, autoLimited } : t)),
    }))),

  setDataPageSize: (size) =>
    set((s) => withSessionUpdate(s, () => ({ dataPageSize: size }))),
}));
