mod models;
mod db;
mod commands;

use db::manager::ConnectionManager;
use commands::connection::*;
use commands::query::*;
use commands::schema::*;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(ConnectionManager::new())
        .invoke_handler(tauri::generate_handler![
            // Connection
            test_connection,
            connect,
            disconnect,
            save_connection,
            get_saved_connections,
            delete_connection,
            // Query
            execute_query,
            get_table_data,
            // Schema
            get_databases,
            get_tables,
            get_columns,
            get_table_structure,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
