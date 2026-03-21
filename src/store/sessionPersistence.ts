import { invoke } from "@tauri-apps/api/core";
import type {
  PersistedSessionState,
  PersistedSession,
  PersistedQueryTab,
  ConnectionSession,
  QueryTab,
} from "../types";
import { useAppStore } from "./useAppStore";

// --- Serialization ---

function serializeQueryTab(tab: QueryTab): PersistedQueryTab {
  return {
    id: tab.id,
    title: tab.title,
    type: tab.type,
    sql: tab.sql,
    ...(tab.database !== undefined && { database: tab.database }),
    ...(tab.table !== undefined && { table: tab.table }),
  };
}

function serializeSession(session: ConnectionSession): PersistedSession {
  return {
    id: session.id,
    connectionName: session.connectionName,
    connectionConfig: session.connectionConfig,
    profileId: session.profileId,
    selectedDatabase: session.selectedDatabase,
    expandedDbs: Array.from(session.expandedDbs),
    expandedTables: Array.from(session.expandedTables),
    queryTabs: session.queryTabs.map(serializeQueryTab),
    activeTabId: session.activeTabId,
    activeBottomTab: session.activeBottomTab,
  };
}

function serializeState(): PersistedSessionState {
  const state = useAppStore.getState();
  return {
    version: 1,
    activeSessionId: state.activeSessionId,
    sessions: state.sessions.map(serializeSession),
  };
}

// --- Deserialization ---

function deserializeQueryTab(persisted: PersistedQueryTab): QueryTab {
  return {
    id: persisted.id,
    title: persisted.title,
    type: persisted.type,
    sql: persisted.sql,
    result: null,
    isExecuting: false,
    error: null,
    ...(persisted.database !== undefined && { database: persisted.database }),
    ...(persisted.table !== undefined && { table: persisted.table }),
  };
}

export function deserializeSession(
  persisted: PersistedSession,
): ConnectionSession {
  return {
    id: persisted.id,
    connectionId: "", // Assigned during reconnection
    connectionName: persisted.connectionName,
    connectionConfig: persisted.connectionConfig,
    profileId: persisted.profileId,
    selectedDatabase: persisted.selectedDatabase,
    databases: [],
    expandedDbs: new Set(persisted.expandedDbs),
    tables: {},
    expandedTables: new Set(persisted.expandedTables),
    columns: {},
    dbFilter: "",
    tableFilter: "",
    queryTabs: persisted.queryTabs.map(deserializeQueryTab),
    activeTabId: persisted.activeTabId,
    activeBottomTab: persisted.activeBottomTab,
    dataResult: null,
    dataTableName: null,
    dataDatabase: null,
    dataTable: null,
    dataColumns: null,
    dataPrimaryKeys: [],
  };
}

// --- Save (debounced) ---

let saveTimer: ReturnType<typeof setTimeout> | null = null;
const SAVE_DEBOUNCE_MS = 2000;

function doSave(): void {
  const state = useAppStore.getState();
  if (state.isRestoring) return;
  const serialized = serializeState();
  invoke("save_session_state", { state: serialized }).catch(console.error);
}

export function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(doSave, SAVE_DEBOUNCE_MS);
}

export function forceSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  doSave();
}

// --- Load ---

export async function loadPersistedState(): Promise<PersistedSessionState | null> {
  try {
    const raw = await invoke<PersistedSessionState>("load_session_state");
    if (raw && raw.version === 1 && Array.isArray(raw.sessions)) {
      return raw;
    }
    return null;
  } catch {
    return null; // First run or corrupted file
  }
}

// --- Subscribe to store changes ---

export function startAutoSave(): () => void {
  const unsubscribe = useAppStore.subscribe((state, prevState) => {
    if (state.isRestoring) return;
    if (
      state.sessions !== prevState.sessions ||
      state.activeSessionId !== prevState.activeSessionId
    ) {
      scheduleSave();
    }
  });
  return unsubscribe;
}
