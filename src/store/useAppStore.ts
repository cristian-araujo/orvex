import { create } from "zustand";
import { v4 as uuidv4 } from "uuid";
import type {
  ConnectionProfile,
  QueryTab,
  QueryResult,
  BottomTab,
} from "../types";

interface AppState {
  // Connection
  savedConnections: ConnectionProfile[];
  activeConnectionId: string | null;
  activeConnectionName: string | null;
  selectedDatabase: string | null;
  showConnectionDialog: boolean;

  // Object browser
  databases: string[];
  expandedDbs: Set<string>;
  tables: Record<string, { name: string; table_type: string }[]>;

  // Query tabs
  queryTabs: QueryTab[];
  activeTabId: string | null;

  // Bottom panel
  activeBottomTab: BottomTab;

  // Actions
  setSavedConnections: (connections: ConnectionProfile[]) => void;
  setActiveConnection: (id: string, name: string) => void;
  clearConnection: () => void;
  setSelectedDatabase: (db: string | null) => void;
  setShowConnectionDialog: (show: boolean) => void;
  setDatabases: (dbs: string[]) => void;
  toggleDb: (db: string) => void;
  setTables: (db: string, tables: { name: string; table_type: string }[]) => void;
  addQueryTab: (title?: string, sql?: string) => string;
  closeQueryTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  updateTabSql: (id: string, sql: string) => void;
  setTabResult: (id: string, result: QueryResult | null) => void;
  setTabExecuting: (id: string, executing: boolean) => void;
  setTabError: (id: string, error: string | null) => void;
  setActiveBottomTab: (tab: BottomTab) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  savedConnections: [],
  activeConnectionId: null,
  activeConnectionName: null,
  selectedDatabase: null,
  showConnectionDialog: true,
  databases: [],
  expandedDbs: new Set(),
  tables: {},
  queryTabs: [],
  activeTabId: null,
  activeBottomTab: "results",

  setSavedConnections: (connections) => set({ savedConnections: connections }),

  setActiveConnection: (id, name) => {
    const tabId = uuidv4();
    set({
      activeConnectionId: id,
      activeConnectionName: name,
      showConnectionDialog: false,
      selectedDatabase: null,
      databases: [],
      expandedDbs: new Set(),
      tables: {},
      queryTabs: [{ id: tabId, title: "Query 1", sql: "", result: null, isExecuting: false, error: null }],
      activeTabId: tabId,
    });
  },

  clearConnection: () =>
    set({
      activeConnectionId: null,
      activeConnectionName: null,
      selectedDatabase: null,
      databases: [],
      expandedDbs: new Set(),
      tables: {},
      queryTabs: [],
      activeTabId: null,
      showConnectionDialog: true,
    }),

  setSelectedDatabase: (db) => set({ selectedDatabase: db }),
  setShowConnectionDialog: (show) => set({ showConnectionDialog: show }),
  setDatabases: (dbs) => set({ databases: dbs }),

  toggleDb: (db) => {
    const expanded = new Set(get().expandedDbs);
    if (expanded.has(db)) expanded.delete(db);
    else expanded.add(db);
    set({ expandedDbs: expanded });
  },

  setTables: (db, tables) =>
    set((s) => ({ tables: { ...s.tables, [db]: tables } })),

  addQueryTab: (title, sql = "") => {
    const id = uuidv4();
    const count = get().queryTabs.length + 1;
    set((s) => ({
      queryTabs: [
        ...s.queryTabs,
        { id, title: title || `Query ${count}`, sql, result: null, isExecuting: false, error: null },
      ],
      activeTabId: id,
    }));
    return id;
  },

  closeQueryTab: (id) => {
    const tabs = get().queryTabs.filter((t) => t.id !== id);
    const activeTabId =
      get().activeTabId === id ? (tabs[tabs.length - 1]?.id ?? null) : get().activeTabId;
    set({ queryTabs: tabs, activeTabId });
  },

  setActiveTab: (id) => set({ activeTabId: id }),

  updateTabSql: (id, sql) =>
    set((s) => ({
      queryTabs: s.queryTabs.map((t) => (t.id === id ? { ...t, sql } : t)),
    })),

  setTabResult: (id, result) =>
    set((s) => ({
      queryTabs: s.queryTabs.map((t) => (t.id === id ? { ...t, result, error: null } : t)),
    })),

  setTabExecuting: (id, isExecuting) =>
    set((s) => ({
      queryTabs: s.queryTabs.map((t) => (t.id === id ? { ...t, isExecuting } : t)),
    })),

  setTabError: (id, error) =>
    set((s) => ({
      queryTabs: s.queryTabs.map((t) => (t.id === id ? { ...t, error, result: null } : t)),
    })),

  setActiveBottomTab: (tab) => set({ activeBottomTab: tab }),
}));
