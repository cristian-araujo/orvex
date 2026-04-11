use sqlx::{MySql, Pool, mysql::{MySqlConnectOptions, MySqlPoolOptions, MySqlSslMode}};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;
use crate::models::ConnectionConfig;
use crate::ssh::tunnel::SshTunnel;
use crate::utils::expand_tilde;

struct ManagedConnection {
    pool: Pool<MySql>,
    ssh_tunnel: Option<SshTunnel>,
}

pub struct ConnectionManager {
    connections: Mutex<HashMap<String, ManagedConnection>>,
}

impl ConnectionManager {
    pub fn new() -> Self {
        Self {
            connections: Mutex::new(HashMap::new()),
        }
    }

    pub async fn connect(&self, id: &str, config: &ConnectionConfig) -> Result<(), String> {
        // Start SSH tunnel if enabled
        let ssh_tunnel = if config.ssh_enabled.unwrap_or(false) {
            Some(SshTunnel::start(config).await?)
        } else {
            None
        };

        // Determine effective host/port (tunnel or direct)
        let (effective_host, effective_port) = if let Some(ref tunnel) = ssh_tunnel {
            ("127.0.0.1".to_string(), tunnel.local_port())
        } else {
            (config.host.clone(), config.port)
        };

        // Build MySqlConnectOptions
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
                if !ca.is_empty() {
                    opts = opts.ssl_ca(expand_tilde(ca));
                }
            }
            if let Some(ref cert) = config.ssl_cert_path {
                if !cert.is_empty() {
                    opts = opts.ssl_client_cert(expand_tilde(cert));
                }
            }
            if let Some(ref key) = config.ssl_key_path {
                if !key.is_empty() {
                    opts = opts.ssl_client_key(expand_tilde(key));
                }
            }
        }

        // Capture the session settings that must apply to every connection in the pool.
        // after_connect runs on each new physical connection, so session-level SET
        // statements reach every connection — including the dedicated one acquired by
        // do_import — rather than just one arbitrary connection in the pool.
        let use_global = config.use_global_sql_mode.unwrap_or(true);
        let sql_mode = config.sql_mode.clone();
        let read_only = config.read_only.unwrap_or(false);
        let session_timeout = config.session_timeout;
        let init_commands = config.init_commands.clone();

        let pool = match MySqlPoolOptions::new()
            .min_connections(2)
            .max_connections(5)
            .acquire_timeout(Duration::from_secs(10))
            .idle_timeout(Duration::from_secs(300))
            .max_lifetime(Duration::from_secs(1800))
            .after_connect(move |conn, _meta| {
                let sql_mode = sql_mode.clone();
                let init_commands = init_commands.clone();
                Box::pin(async move {
                    if let Some(timeout) = session_timeout {
                        let sql = format!("SET SESSION wait_timeout = {}", timeout);
                        let _ = sqlx::query(&sql).execute(&mut *conn).await;
                    }
                    if read_only {
                        let _ = sqlx::query("SET SESSION TRANSACTION READ ONLY")
                            .execute(&mut *conn)
                            .await;
                    }
                    if !use_global {
                        if let Some(ref mode) = sql_mode {
                            if !mode.is_empty() {
                                let sql = format!("SET SESSION sql_mode = '{}'", mode);
                                let _ = sqlx::query(&sql).execute(&mut *conn).await;
                            }
                        }
                    }
                    if let Some(ref cmds) = init_commands {
                        for cmd in cmds.split(';') {
                            let cmd = cmd.trim();
                            if !cmd.is_empty() {
                                let _ = sqlx::query(cmd).execute(&mut *conn).await;
                            }
                        }
                    }
                    Ok(())
                })
            })
            .connect_with(opts)
            .await
        {
            Ok(pool) => pool,
            Err(e) => {
                // Clean up tunnel on connection failure
                if let Some(tunnel) = ssh_tunnel {
                    tunnel.stop();
                }
                return Err(format!("Connection failed: {}", e));
            }
        };

        let managed = ManagedConnection { pool, ssh_tunnel };
        let mut conns = self.connections.lock().map_err(|e| e.to_string())?;
        conns.insert(id.to_string(), managed);
        Ok(())
    }

    pub fn disconnect(&self, id: &str) -> Result<(), String> {
        let mut conns = self.connections.lock().map_err(|e| e.to_string())?;
        if let Some(managed) = conns.remove(id) {
            // Stop SSH tunnel if present
            if let Some(tunnel) = managed.ssh_tunnel {
                tunnel.stop();
            }
            // Pool is dropped here, closing all connections
        }
        Ok(())
    }

    pub fn get_pool(&self, id: &str) -> Result<Pool<MySql>, String> {
        let conns = self.connections.lock().map_err(|e| e.to_string())?;
        conns
            .get(id)
            .map(|c| c.pool.clone())
            .ok_or_else(|| format!("No active connection: {}", id))
    }
}
