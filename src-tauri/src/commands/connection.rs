use tauri::{State, Manager};
use uuid::Uuid;
use std::fs;
use crate::db::manager::ConnectionManager;
use crate::models::{ConnectionConfig, ConnectionProfile};

fn connections_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e: tauri::Error| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("connections.json"))
}

#[tauri::command]
pub async fn test_connection(config: ConnectionConfig) -> Result<String, String> {
    let db_part = config.database.as_deref().unwrap_or("");
    let url = format!(
        "mysql://{}:{}@{}:{}/{}",
        config.user, config.password, config.host, config.port, db_part
    );
    sqlx::mysql::MySqlPoolOptions::new()
        .max_connections(1)
        .connect(&url)
        .await
        .map(|_| "Connection successful".to_string())
        .map_err(|e| format!("Connection failed: {}", e))
}

#[tauri::command]
pub async fn connect(
    state: State<'_, ConnectionManager>,
    config: ConnectionConfig,
) -> Result<String, String> {
    let id = Uuid::new_v4().to_string();
    state.connect(&id, &config).await?;
    Ok(id)
}

#[tauri::command]
pub fn disconnect(
    state: State<'_, ConnectionManager>,
    connection_id: String,
) -> Result<(), String> {
    state.disconnect(&connection_id)
}

#[tauri::command]
pub fn save_connection(
    app: tauri::AppHandle,
    profile: ConnectionProfile,
) -> Result<(), String> {
    let path = connections_path(&app)?;
    let mut profiles = load_connections_from_path(&path);
    profiles.retain(|p| p.id != profile.id);
    profiles.push(profile);
    let json = serde_json::to_string_pretty(&profiles).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_saved_connections(app: tauri::AppHandle) -> Result<Vec<ConnectionProfile>, String> {
    let path = connections_path(&app)?;
    Ok(load_connections_from_path(&path))
}

#[tauri::command]
pub fn delete_connection(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let path = connections_path(&app)?;
    let mut profiles = load_connections_from_path(&path);
    profiles.retain(|p| p.id != id);
    let json = serde_json::to_string_pretty(&profiles).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
}

fn load_connections_from_path(path: &std::path::Path) -> Vec<ConnectionProfile> {
    fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}
