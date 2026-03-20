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
  // Query tabs
  queryTabs: QueryTab[];
  activeTabId: string | null;
  activeBottomTab: BottomTab;
  // Data preview (single click on table)
  dataResult: QueryResult | null;
  dataTableName: string | null;
}
