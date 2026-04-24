export interface ConnectionConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database?: string;

  // SSH Tunnel
  ssh_enabled?: boolean;
  ssh_host?: string;
  ssh_port?: number;
  ssh_user?: string;
  ssh_auth_method?: "password" | "key";
  ssh_password?: string;
  ssh_key_path?: string;
  ssh_passphrase?: string;

  // SSL/TLS
  ssl_enabled?: boolean;
  ssl_mode?: "Disabled" | "Preferred" | "Required" | "VerifyCa" | "VerifyIdentity";
  ssl_ca_path?: string;
  ssl_cert_path?: string;
  ssl_key_path?: string;

  // MySQL tab options
  save_password?: boolean;
  use_compression?: boolean;
  read_only?: boolean;
  session_timeout?: number;
  keepalive_interval?: number;

  // Advanced
  bg_color?: string;
  fg_color?: string;
  selected_color?: string;
  sql_mode?: string;
  use_global_sql_mode?: boolean;
  init_commands?: string;
}

export interface ConnectionProfile {
  id: string;
  name: string;
  config: ConnectionConfig;
}

export interface QueryResult {
  columns: string[];
  rows: unknown[][];
  rows_affected: number;
  execution_time_ms: number;
}

export interface ColumnInfo {
  field: string;
  column_type: string;
  nullable: boolean;
  key: string;
  default_value: string | null;
  extra: string;
}

export interface TableInfo {
  name: string;
  table_type: string;
}

export interface IndexInfo {
  key_name: string;
  column_name: string;
  non_unique: boolean;
  index_type: string;
}

export interface ForeignKeyInfo {
  constraint_name: string;
  column_name: string;
  referenced_table: string;
  referenced_column: string;
}

export interface TableStructure {
  columns: ColumnInfo[];
  indexes: IndexInfo[];
  foreign_keys: ForeignKeyInfo[];
  create_sql: string;
}

export interface SortEntry {
  column: string;
  direction: "asc" | "desc";
}

export type TabType = "query" | "table";

export interface QueryTab {
  id: string;
  title: string;
  type: TabType;
  // query tab fields
  sql: string;
  result: QueryResult | null;
  isExecuting: boolean;
  error: string | null;
  // table tab fields
  database?: string;
  table?: string;
  // auto-limit flag
  autoLimited?: boolean;
}

export type BottomTab = "data" | "results" | "messages";
export type TableViewTab = "data" | "columns" | "indexes" | "foreign_keys" | "create_sql";

export interface ConnectionSession {
  id: string;
  connectionId: string;
  connectionName: string;
  connectionConfig: ConnectionConfig;
  profileId: string | null;
  selectedDatabase: string | null;
  // Object browser
  databases: string[];
  expandedDbs: Set<string>;
  tables: Record<string, { name: string; table_type: string }[]>;
  expandedTables: Set<string>;
  columns: Record<string, ColumnInfo[]>;
  dbFilter: string;
  tableFilter: string;
  // Query tabs
  queryTabs: QueryTab[];
  activeTabId: string | null;
  activeBottomTab: BottomTab;
  // Data preview (single click on table)
  dataResult: QueryResult | null;
  dataTableName: string | null;
  dataDatabase: string | null;
  dataTable: string | null;
  dataColumns: ColumnInfo[] | null;
  dataForeignKeys: ForeignKeyInfo[] | null;
  dataPrimaryKeys: string[];
  // Loading & pagination
  isLoadingData: boolean;
  dataPage: number;
  dataPageSize: number;
  dataTotalRows: number | null;
  // Server-side filters & sort
  dataFilterModel: Record<string, unknown> | null;
  dataSort: SortEntry[] | null;
}

// --- Data editing ---

export interface TableEditOperation {
  type: "Update" | "Insert" | "Delete";
  where_values?: [string, unknown][];
  set_values?: [string, unknown][];
  values?: [string, unknown][];
}

export interface TableEditRequest {
  database: string;
  table: string;
  primary_keys: string[];
  operations: TableEditOperation[];
}

export interface ApplyEditsResult {
  success: boolean;
  rows_affected: number;
  message: string;
}

// --- Export/Import ---

export type ExportFormat = "Sql" | "Csv" | "Json";
export type ExportContent = "StructureOnly" | "DataOnly" | "StructureAndData";

export interface ExportOptions {
  format: ExportFormat;
  content: ExportContent;
  database: string;
  tables: string[];
  file_path: string;
  // SQL options
  drop_table: boolean;
  drop_database: boolean;
  create_database: boolean;
  lock_tables: boolean;
  disable_foreign_keys: boolean;
  extended_inserts: boolean;
  extended_insert_rows: number;
  set_names: boolean;
  add_timestamps: boolean;
  hex_binary: boolean;
}

export interface ImportOptions {
  file_path: string;
  database: string;
  stop_on_error: boolean;
  /** Disables strict SQL modes (NO_ZERO_DATE, etc.) for legacy dump compatibility. */
  disable_strict_mode: boolean;
  /** Defers FULLTEXT index creation to after data load — bulk rebuild is 5–20x faster. */
  defer_fulltext: boolean;
}

export interface ExportProgressPayload {
  operation_id: string;
  phase: "structure" | "data" | "complete" | "error" | "cancelled";
  current_table: string;
  tables_done: number;
  tables_total: number;
  rows_exported: number;
  bytes_written: number;
  elapsed_ms: number;
  error: string | null;
}

export interface ImportProgressPayload {
  operation_id: string;
  phase: "executing" | "indexing" | "complete" | "error" | "cancelled";
  bytes_read: number;
  bytes_total: number;
  statements_executed: number;
  errors_count: number;
  current_statement_preview: string;
  elapsed_ms: number;
  error: string | null;
  last_error: string | null;
}

// --- Charset / Collation ---

export interface CharsetInfo {
  charset: string;
  description: string;
  default_collation: string;
}

// Sentinel page size used when table_data_limit is null (unlimited mode).
// The backend accepts this as a LIMIT value; 999_999_999 exceeds any realistic
// table size while staying well within MySQL's integer range.
export const UNLIMITED_PAGE_SIZE = 999_999_999;

// --- App Settings ---

export interface ExportSqlDefaults {
  drop_table: boolean;
  drop_database: boolean;
  create_database: boolean;
  lock_tables: boolean;
  disable_foreign_keys: boolean;
  extended_inserts: boolean;
  extended_insert_rows: number;
  set_names: boolean;
  add_timestamps: boolean;
  hex_binary: boolean;
}

export type DatetimeDisplayFormat = "iso" | "eu" | "us";

export interface AppSettings {
  // Export / Import
  export_filename_template: string;
  export_default_directory: string;
  import_default_directory: string;
  export_default_format: ExportFormat;
  export_default_content: ExportContent;
  export_default_sql_options: ExportSqlDefaults;
  // Grid & Display
  null_display_text: string;
  grid_row_height: number;
  datetime_display_format: DatetimeDisplayFormat;
  // Query
  table_data_limit: number | null;
  editor_tab_size: number;
  // General
  confirm_on_disconnect: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  export_filename_template: "{database}_{date}",
  export_default_directory: "",
  import_default_directory: "",
  export_default_format: "Sql",
  export_default_content: "StructureAndData",
  export_default_sql_options: {
    drop_table: true,
    drop_database: false,
    create_database: false,
    lock_tables: true,
    disable_foreign_keys: true,
    extended_inserts: true,
    extended_insert_rows: 1000,
    set_names: true,
    add_timestamps: true,
    hex_binary: true,
  },
  null_display_text: "NULL",
  grid_row_height: 24,
  datetime_display_format: "iso",
  table_data_limit: 1000,
  editor_tab_size: 2,
  confirm_on_disconnect: true,
};

// --- Session persistence ---

export interface PersistedQueryTab {
  id: string;
  title: string;
  type: TabType;
  sql: string;
  database?: string;
  table?: string;
}

export interface PersistedSession {
  id: string;
  connectionName: string;
  connectionConfig: ConnectionConfig;
  profileId: string | null;
  selectedDatabase: string | null;
  expandedDbs: string[];
  expandedTables: string[];
  queryTabs: PersistedQueryTab[];
  activeTabId: string | null;
  activeBottomTab: BottomTab;
}

export interface PersistedSessionState {
  version: 1;
  activeSessionId: string | null;
  sessions: PersistedSession[];
}
