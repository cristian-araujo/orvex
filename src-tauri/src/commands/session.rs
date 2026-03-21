use tauri::Manager;
use std::fs;

fn session_state_path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app.path().app_config_dir().map_err(|e: tauri::Error| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("session_state.json"))
}

#[tauri::command]
pub fn save_session_state(app: tauri::AppHandle, state: serde_json::Value) -> Result<(), String> {
    let path = session_state_path(&app)?;
    let json = serde_json::to_string_pretty(&state).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn load_session_state(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let path = session_state_path(&app)?;
    fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .ok_or_else(|| "No session state found".to_string())
}
