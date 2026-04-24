mod models;
mod db;
mod commands;
mod ssh;
mod utils;

use db::manager::ConnectionManager;
use commands::connection::*;
use commands::export::*;
use commands::import::*;
use commands::query::*;
use commands::schema::*;
use commands::session::*;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init());

    #[cfg(debug_assertions)]
    {
        builder = builder.plugin(tauri_plugin_mcp_bridge::init());
    }

    builder
        .manage(ConnectionManager::new())
        .invoke_handler(tauri::generate_handler![
            // Connection
            test_connection,
            connect,
            disconnect,
            save_connection,
            get_saved_connections,
            delete_connection,
            export_connections,
            import_connections,
            // Query
            execute_query,
            get_table_data,
            get_table_count,
            apply_table_edits,
            // Schema
            get_charsets,
            get_collations,
            create_database,
            get_databases,
            get_tables,
            get_columns,
            get_table_structure,
            drop_table,
            truncate_table,
            drop_database,
            drop_all_tables,
            get_foreign_keys,
            get_table_auto_increment,
            set_table_auto_increment,
            // Session
            save_session_state,
            load_session_state,
            save_settings,
            load_settings,
            // Export/Import
            start_export,
            cancel_export,
            get_export_progress,
            start_import,
            cancel_import,
            get_import_progress,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
