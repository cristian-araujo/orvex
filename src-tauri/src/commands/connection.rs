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
    use sqlx::mysql::{MySqlConnectOptions, MySqlPoolOptions, MySqlSslMode};
    use crate::ssh::tunnel::SshTunnel;

    // Start temporary SSH tunnel if enabled
    let ssh_tunnel = if config.ssh_enabled.unwrap_or(false) {
        Some(SshTunnel::start(&config).await?)
    } else {
        None
    };

    let (effective_host, effective_port) = if let Some(ref tunnel) = ssh_tunnel {
        ("127.0.0.1".to_string(), tunnel.local_port())
    } else {
        (config.host.clone(), config.port)
    };

    let mut opts = MySqlConnectOptions::new()
        .host(&effective_host)
        .port(effective_port)
        .username(&config.user)
        .password(&config.password);

    if let Some(ref db) = config.database {
        if !db.is_empty() {
            opts = opts.database(db);
        }
    }

    // SSL configuration
    if config.ssl_enabled.unwrap_or(false) {
        let ssl_mode = match config.ssl_mode.as_deref() {
            Some("Disabled") => MySqlSslMode::Disabled,
            Some("Required") => MySqlSslMode::Required,
            Some("VerifyCa") => MySqlSslMode::VerifyCa,
            Some("VerifyIdentity") => MySqlSslMode::VerifyIdentity,
            _ => MySqlSslMode::Preferred,
        };
        opts = opts.ssl_mode(ssl_mode);

        if let Some(ref ca) = config.ssl_ca_path {
            if !ca.is_empty() { opts = opts.ssl_ca(ca); }
        }
        if let Some(ref cert) = config.ssl_cert_path {
            if !cert.is_empty() { opts = opts.ssl_client_cert(cert); }
        }
        if let Some(ref key) = config.ssl_key_path {
            if !key.is_empty() { opts = opts.ssl_client_key(key); }
        }
    }

    let result = MySqlPoolOptions::new()
        .max_connections(1)
        .connect_with(opts)
        .await
        .map(|_| "Connection successful".to_string())
        .map_err(|e| format!("Connection failed: {}", e));

    // Clean up temporary tunnel
    if let Some(tunnel) = ssh_tunnel {
        tunnel.stop();
    }

    result
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

#[tauri::command]
pub fn export_connections(path: String, data: String) -> Result<(), String> {
    fs::write(&path, data).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn import_connections(path: String) -> Result<Vec<ConnectionProfile>, String> {
    let json = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&json).map_err(|e| format!("Invalid connection file: {}", e))
}
