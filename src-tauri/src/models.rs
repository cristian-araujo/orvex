use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct ConnectionConfig {
    pub host: String,
    pub port: u16,
    pub user: String,
    pub password: String,
    pub database: Option<String>,

    // SSH Tunnel
    pub ssh_enabled: Option<bool>,
    pub ssh_host: Option<String>,
    pub ssh_port: Option<u16>,
    pub ssh_user: Option<String>,
    pub ssh_auth_method: Option<String>,
    pub ssh_password: Option<String>,
    pub ssh_key_path: Option<String>,
    pub ssh_passphrase: Option<String>,

    // SSL/TLS
    pub ssl_enabled: Option<bool>,
    pub ssl_mode: Option<String>,
    pub ssl_ca_path: Option<String>,
    pub ssl_cert_path: Option<String>,
    pub ssl_key_path: Option<String>,

    // MySQL tab options
    pub save_password: Option<bool>,
    pub use_compression: Option<bool>,
    pub read_only: Option<bool>,
    pub session_timeout: Option<u32>,
    pub keepalive_interval: Option<u32>,

    // Advanced
    pub bg_color: Option<String>,
    pub fg_color: Option<String>,
    pub selected_color: Option<String>,
    pub sql_mode: Option<String>,
    pub use_global_sql_mode: Option<bool>,
    pub init_commands: Option<String>,
}

impl Default for ConnectionConfig {
    fn default() -> Self {
        Self {
            host: "localhost".to_string(),
            port: 3306,
            user: "root".to_string(),
            password: String::new(),
            database: None,
            ssh_enabled: None,
            ssh_host: None,
            ssh_port: None,
            ssh_user: None,
            ssh_auth_method: None,
            ssh_password: None,
            ssh_key_path: None,
            ssh_passphrase: None,
            ssl_enabled: None,
            ssl_mode: None,
            ssl_ca_path: None,
            ssl_cert_path: None,
            ssl_key_path: None,
            save_password: None,
            use_compression: None,
            read_only: None,
            session_timeout: None,
            keepalive_interval: None,
            bg_color: None,
            fg_color: None,
            selected_color: None,
            sql_mode: None,
            use_global_sql_mode: None,
            init_commands: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionProfile {
    pub id: String,
    pub name: String,
    pub config: ConnectionConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<serde_json::Value>>,
    pub rows_affected: u64,
    pub execution_time_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnInfo {
    pub field: String,
    pub column_type: String,
    pub nullable: bool,
    pub key: String,
    pub default_value: Option<String>,
    pub extra: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableInfo {
    pub name: String,
    pub table_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexInfo {
    pub key_name: String,
    pub column_name: String,
    pub non_unique: bool,
    pub index_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ForeignKeyInfo {
    pub constraint_name: String,
    pub column_name: String,
    pub referenced_table: String,
    pub referenced_column: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableStructure {
    pub columns: Vec<ColumnInfo>,
    pub indexes: Vec<IndexInfo>,
    pub foreign_keys: Vec<ForeignKeyInfo>,
    pub create_sql: String,
}

// --- Export/Import ---

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ExportFormat {
    Sql,
    Csv,
    Json,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum ExportContent {
    StructureOnly,
    DataOnly,
    StructureAndData,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportOptions {
    pub format: ExportFormat,
    pub content: ExportContent,
    pub database: String,
    pub tables: Vec<String>,
    pub file_path: String,
    // SQL options
    pub drop_table: bool,
    pub drop_database: bool,
    pub create_database: bool,
    pub lock_tables: bool,
    pub disable_foreign_keys: bool,
    pub extended_inserts: bool,
    pub extended_insert_rows: u32,
    pub set_names: bool,
    pub add_timestamps: bool,
    pub hex_binary: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportOptions {
    pub file_path: String,
    pub database: String,
    pub stop_on_error: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExportProgressPayload {
    pub operation_id: String,
    pub phase: String,
    pub current_table: String,
    pub tables_done: u32,
    pub tables_total: u32,
    pub rows_exported: u64,
    pub bytes_written: u64,
    pub elapsed_ms: u64,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImportProgressPayload {
    pub operation_id: String,
    pub phase: String,
    pub bytes_read: u64,
    pub bytes_total: u64,
    pub statements_executed: u64,
    pub errors_count: u64,
    pub current_statement_preview: String,
    pub elapsed_ms: u64,
    pub error: Option<String>,
}

// --- Data editing ---

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum TableEditOperation {
    Update {
        where_values: Vec<(String, serde_json::Value)>,
        set_values: Vec<(String, serde_json::Value)>,
    },
    Insert {
        values: Vec<(String, serde_json::Value)>,
    },
    Delete {
        where_values: Vec<(String, serde_json::Value)>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TableEditRequest {
    pub database: String,
    pub table: String,
    pub primary_keys: Vec<String>,
    pub operations: Vec<TableEditOperation>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApplyEditsResult {
    pub success: bool,
    pub rows_affected: u64,
    pub message: String,
}
