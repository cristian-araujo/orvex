import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { v4 as uuidv4 } from "uuid";
import type {
  ConnectionConfig,
  ConnectionProfile,
  ConnectionSession,
  QueryTab,
  QueryResult,
  BottomTab,
  ColumnInfo,
} from "../types";

// --- Projection helpers ---

function projectSession(session: ConnectionSession | undefined) {
  if (!session) {
    return {
      activeConnectionId: null as string | null,
      activeConnectionName: null as string | null,
      activeConnectionConfig: null as ConnectionConfig | null,
      activeProfileId: null as string | null,
      selectedDatabase: null as string | null,
      databases: [] as string[],
      expandedDbs: new Set<string>(),
      tables: {} as Record<string, { name: string; table_type: string }[]>,
      expandedTables: new Set<string>(),
      columns: {} as Record<string, ColumnInfo[]>,
      queryTabs: [] as QueryTab[],
      activeTabId: null as string | null,
      activeBottomTab: "results" as BottomTab,
      dataResult: null as QueryResult | null,
      dataTableName: null as string | null,
    };
  }
  return {
    activeConnectionId: session.connectionId,
    activeConnectionName: session.connectionName,
    activeConnectionConfig: session.connectionConfig,
    activeProfileId: session.profileId,
    selectedDatabase: session.selectedDatabase,
    databases: session.databases,
    expandedDbs: session.expandedDbs,
    tables: session.tables,
    expandedTables: session.expandedTables,
    columns: session.columns,
    queryTabs: session.queryTabs,
    activeTabId: session.activeTabId,
    activeBottomTab: session.activeBottomTab,
    dataResult: session.dataResult,
    dataTableName: session.dataTableName,
  };
}

function withSessionUpdate(
  state: AppState,
  updater: (session: ConnectionSession) => Partial<ConnectionSession>,
) {
  const sessions = state.sessions.map((s) => {
    if (s.id !== state.activeSessionId) return s;
    return { ...s, ...updater(s) };
  });
  const active = sessions.find((s) => s.id === state.activeSessionId);
  return { sessions, ...projectSession(active) };
}

// --- State interface ---

interface AppState {
  // Global
  savedConnections: ConnectionProfile[];
  showConnectionDialog: boolean;
  showColorEditor: boolean;

  // Sessions
  sessions: ConnectionSession[];
  activeSessionId: string | null;

  // Projected from active session (backward compat for components)
  activeConnectionId: string | null;
  activeConnectionName: string | null;
  activeConnectionConfig: ConnectionConfig | null;
  activeProfileId: string | null;
  selectedDatabase: string | null;
  databases: string[];
  expandedDbs: Set<string>;
  tables: Record<string, { name: string; table_type: string }[]>;
  expandedTables: Set<string>;
  columns: Record<string, ColumnInfo[]>;
  queryTabs: QueryTab[];
  activeTabId: string | null;
  activeBottomTab: BottomTab;
  dataResult: QueryResult | null;
  dataTableName: string | null;

  // Session lifecycle
  createSession: (connectionId: string, name: string, config: ConnectionConfig, profileId?: string) => void;
  switchSession: (sessionId: string) => void;
  closeSession: (sessionId: string) => Promise<void>;

  // Global actions
  setSavedConnections: (connections: ConnectionProfile[]) => void;
  setShowConnectionDialog: (show: boolean) => void;
  setShowColorEditor: (show: boolean) => void;

  // Active session actions (operate on active session via projection)
  updateActiveConnectionConfig: (updates: Partial<ConnectionConfig>) => void;
  setSelectedDatabase: (db: string | null) => void;
  setDatabases: (dbs: string[]) => void;
  toggleDb: (db: string) => void;
  setTables: (db: string, tables: { name: string; table_type: string }[]) => void;
  setExpandedTables: (expandedTables: Set<string>) => void;
  setColumns: (key: string, cols: ColumnInfo[]) => void;
  addQueryTab: (title?: string, sql?: string) => string;
  addTableTab: (database: string, table: string) => string;
  closeQueryTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  updateTabSql: (id: string, sql: string) => void;
  setTabResult: (id: string, result: QueryResult | null) => void;
  setTabExecuting: (id: string, executing: boolean) => void;
  setTabError: (id: string, error: string | null) => void;
  setActiveBottomTab: (tab: BottomTab) => void;
  setDataResult: (result: QueryResult | null, tableName: string | null) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  // Global
  savedConnections: [],
  showConnectionDialog: true,
  showColorEditor: false,

  // Sessions
  sessions: [],
  activeSessionId: null,

  // Projected (initially empty)
  activeConnectionId: null,
  activeConnectionName: null,
  activeConnectionConfig: null,
  activeProfileId: null,
  selectedDatabase: null,
  databases: [],
  expandedDbs: new Set(),
  tables: {},
  expandedTables: new Set(),
  columns: {},
  queryTabs: [],
  activeTabId: null,
  activeBottomTab: "results",
  dataResult: null,
  dataTableName: null,

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
      queryTabs: [{ id: tabId, title: "Query 1", type: "query", sql: "", result: null, isExecuting: false, error: null }],
      activeTabId: tabId,
      activeBottomTab: "results",
      dataResult: null,
      dataTableName: null,
    };
    const sessions = [...get().sessions, session];
    set({
      sessions,
      activeSessionId: sessionId,
      showConnectionDialog: false,
      ...projectSession(session),
    });
  },

  switchSession: (sessionId) => {
    const session = get().sessions.find((s) => s.id === sessionId);
    if (!session) return;
    set({
      activeSessionId: sessionId,
      ...projectSession(session),
    });
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

    const nextSession = remaining.find((s) => s.id === nextSessionId);
    set({
      sessions: remaining,
      activeSessionId: nextSessionId,
      showConnectionDialog: remaining.length === 0,
      ...projectSession(nextSession),
    });
  },

  // --- Global actions ---

  setSavedConnections: (connections) => set({ savedConnections: connections }),
  setShowConnectionDialog: (show) => set({ showConnectionDialog: show }),
  setShowColorEditor: (show) => set({ showColorEditor: show }),

  // --- Active session actions ---

  updateActiveConnectionConfig: (updates) =>
    set((s) => {
      const sessions = s.sessions.map((sess) => {
        if (sess.id !== s.activeSessionId) return sess;
        return { ...sess, connectionConfig: { ...sess.connectionConfig, ...updates } };
      });
      const active = sessions.find((sess) => sess.id === s.activeSessionId);
      return { sessions, activeConnectionConfig: active?.connectionConfig ?? null };
    }),

  setSelectedDatabase: (db) =>
    set((s) => withSessionUpdate(s, () => ({ selectedDatabase: db }))),

  setDatabases: (dbs) =>
    set((s) => withSessionUpdate(s, () => ({ databases: dbs }))),

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

  setDataResult: (result, tableName) =>
    set((s) => withSessionUpdate(s, () => ({ dataResult: result, dataTableName: tableName, activeBottomTab: "data" as BottomTab }))),
}));
