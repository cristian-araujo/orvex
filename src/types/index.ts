export interface ConnectionConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database?: string;
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

export interface QueryTab {
  id: string;
  title: string;
  sql: string;
  result: QueryResult | null;
  isExecuting: boolean;
  error: string | null;
}

export type BottomTab = "results" | "messages";
export type StructureTab = "columns" | "indexes" | "foreign_keys" | "create_sql";
