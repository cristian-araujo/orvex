use std::sync::Arc;
use async_trait::async_trait;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::watch;
use russh::keys::key;

use crate::models::ConnectionConfig;

/// Minimal SSH client handler that accepts all host keys.
struct ClientHandler;

#[async_trait]
impl russh::client::Handler for ClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &key::PublicKey,
    ) -> Result<bool, Self::Error> {
        // Accept all host keys (same behavior as SQLyog, HeidiSQL, etc.)
        Ok(true)
    }
}

pub struct SshTunnel {
    task_handle: tokio::task::JoinHandle<()>,
    local_port: u16,
    shutdown_tx: watch::Sender<bool>,
}

impl SshTunnel {
    pub async fn start(config: &ConnectionConfig) -> Result<Self, String> {
        let ssh_host = config.ssh_host.as_deref().unwrap_or("localhost").to_string();
        let ssh_port = config.ssh_port.unwrap_or(22);
        let ssh_user = config.ssh_user.as_deref().unwrap_or("root").to_string();
        let auth_method = config.ssh_auth_method.as_deref().unwrap_or("password").to_string();
        let ssh_password = config.ssh_password.clone().unwrap_or_default();
        let ssh_key_path = config.ssh_key_path.clone();
        let ssh_passphrase = config.ssh_passphrase.clone();

        // MySQL target (what the SSH tunnel connects to on the remote side)
        let mysql_host = config.host.clone();
        let mysql_port = config.port;

        // Connect to SSH server
        let ssh_config = Arc::new(russh::client::Config::default());
        let handler = ClientHandler;
        let mut session = russh::client::connect(ssh_config, (ssh_host.as_str(), ssh_port), handler)
            .await
            .map_err(|e| format!("SSH connection failed: {}", e))?;

        // Authenticate
        let authenticated = match auth_method.as_str() {
            "key" => {
                let key_path = ssh_key_path
                    .as_deref()
                    .ok_or("SSH key path not provided")?;
                let passphrase = ssh_passphrase.as_deref();
                let key_pair = russh_keys::load_secret_key(key_path, passphrase)
                    .map_err(|e| format!("Failed to load SSH key: {}", e))?;
                session
                    .authenticate_publickey(&ssh_user, Arc::new(key_pair))
                    .await
                    .map_err(|e| format!("SSH key auth failed: {}", e))?
            }
            _ => {
                session
                    .authenticate_password(&ssh_user, &ssh_password)
                    .await
                    .map_err(|e| format!("SSH password auth failed: {}", e))?
            }
        };

        if !authenticated {
            return Err("SSH authentication failed: invalid credentials".to_string());
        }

        let session = Arc::new(session);

        // Bind local listener on random port
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .map_err(|e| format!("Failed to bind local tunnel port: {}", e))?;
        let local_port = listener.local_addr()
            .map_err(|e| format!("Failed to get local address: {}", e))?
            .port();

        let (shutdown_tx, shutdown_rx) = watch::channel(false);

        // Spawn tunnel relay task
        let task_handle = tokio::spawn(async move {
            let mut shutdown_rx = shutdown_rx;

            loop {
                tokio::select! {
                    accept_result = listener.accept() => {
                        match accept_result {
                            Ok((mut tcp_stream, _)) => {
                                let session = session.clone();
                                let mysql_host = mysql_host.clone();
                                let mut relay_shutdown = shutdown_rx.clone();

                                tokio::spawn(async move {
                                    // Open direct-tcpip channel to MySQL through SSH
                                    let channel = match session
                                        .channel_open_direct_tcpip(
                                            &mysql_host,
                                            mysql_port as u32,
                                            "127.0.0.1",
                                            0,
                                        )
                                        .await
                                    {
                                        Ok(ch) => ch,
                                        Err(e) => {
                                            eprintln!("SSH tunnel: failed to open channel: {}", e);
                                            return;
                                        }
                                    };

                                    let mut stream = channel.into_stream();

                                    // Bidirectional relay
                                    let (mut tcp_read, mut tcp_write) = tcp_stream.split();
                                    let (mut ssh_read, mut ssh_write) = tokio::io::split(&mut stream);

                                    tokio::select! {
                                        _ = async {
                                            let mut buf = [0u8; 8192];
                                            loop {
                                                let n = match tcp_read.read(&mut buf).await {
                                                    Ok(0) | Err(_) => break,
                                                    Ok(n) => n,
                                                };
                                                if ssh_write.write_all(&buf[..n]).await.is_err() {
                                                    break;
                                                }
                                            }
                                        } => {}
                                        _ = async {
                                            let mut buf = [0u8; 8192];
                                            loop {
                                                let n = match ssh_read.read(&mut buf).await {
                                                    Ok(0) | Err(_) => break,
                                                    Ok(n) => n,
                                                };
                                                if tcp_write.write_all(&buf[..n]).await.is_err() {
                                                    break;
                                                }
                                            }
                                        } => {}
                                        _ = relay_shutdown.changed() => {}
                                    }
                                });
                            }
                            Err(e) => {
                                eprintln!("SSH tunnel: accept error: {}", e);
                                break;
                            }
                        }
                    }
                    _ = shutdown_rx.changed() => {
                        break;
                    }
                }
            }
        });

        Ok(SshTunnel {
            task_handle,
            local_port,
            shutdown_tx,
        })
    }

    pub fn local_port(&self) -> u16 {
        self.local_port
    }

    pub fn stop(self) {
        let _ = self.shutdown_tx.send(true);
        self.task_handle.abort();
    }
}
