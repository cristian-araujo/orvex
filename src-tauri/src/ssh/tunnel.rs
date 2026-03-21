use std::sync::Arc;
use async_trait::async_trait;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::watch;
use russh::keys::key;

use crate::models::ConnectionConfig;

/// Load a private key, trying russh-keys first and falling back to manual
/// PEM decryption for formats that russh-keys doesn't support (e.g. keys
/// encrypted with DES-EDE3-CBC or AES-256-CBC).
fn load_private_key(path: &str, passphrase: Option<&str>) -> Result<key::KeyPair, String> {
    // Try russh-keys first (handles OpenSSH format, unencrypted PEM, AES-128-CBC PEM)
    match russh_keys::load_secret_key(path, passphrase) {
        Ok(kp) => return Ok(kp),
        Err(_) => {}
    }

    // Fallback: manually decrypt PEM-encrypted legacy keys
    let pem_data = std::fs::read_to_string(path)
        .map_err(|e| format!("Failed to read key file: {}", e))?;

    decrypt_pem_legacy(&pem_data, passphrase)
}

/// Decrypt a PEM legacy encrypted private key (Proc-Type: 4,ENCRYPTED)
/// Supports DES-EDE3-CBC and AES-128-CBC/AES-256-CBC
fn decrypt_pem_legacy(pem: &str, passphrase: Option<&str>) -> Result<key::KeyPair, String> {
    use data_encoding::HEXLOWER_PERMISSIVE;

    let password = passphrase.ok_or("Key is encrypted but no passphrase provided")?;

    let mut cipher_name = None;
    let mut iv_hex = None;
    let mut base64_data = String::new();
    let mut in_body = false;
    let mut header_type = None;

    for line in pem.lines() {
        if line.starts_with("-----BEGIN ") {
            header_type = Some(line.to_string());
            in_body = true;
            continue;
        }
        if line.starts_with("-----END ") {
            break;
        }
        if !in_body { continue; }

        if line.starts_with("Proc-Type:") {
            continue;
        }
        if line.starts_with("DEK-Info:") {
            // DEK-Info: DES-EDE3-CBC,63E1151EF8A0C05B
            let info = line.trim_start_matches("DEK-Info:").trim();
            let parts: Vec<&str> = info.splitn(2, ',').collect();
            if parts.len() == 2 {
                cipher_name = Some(parts[0].to_string());
                iv_hex = Some(parts[1].to_string());
            }
            continue;
        }
        if line.is_empty() { continue; }
        base64_data.push_str(line);
    }

    let cipher = cipher_name.ok_or("Missing DEK-Info cipher in encrypted PEM key")?;
    let iv_hex = iv_hex.ok_or("Missing IV in DEK-Info header")?;
    let iv = HEXLOWER_PERMISSIVE.decode(iv_hex.as_bytes())
        .map_err(|e| format!("Invalid IV hex: {}", e))?;

    let encrypted = data_encoding::BASE64.decode(base64_data.as_bytes())
        .map_err(|e| format!("Invalid base64 in PEM key: {}", e))?;

    // Derive key using OpenSSL EVP_BytesToKey (MD5-based)
    let decrypted = match cipher.as_str() {
        "DES-EDE3-CBC" => {
            let key = evp_bytes_to_key::<24>(password.as_bytes(), &iv[..8]);
            decrypt_3des_cbc(&key, &iv, &encrypted)?
        }
        "AES-128-CBC" => {
            let key = evp_bytes_to_key::<16>(password.as_bytes(), &iv[..8]);
            decrypt_aes_cbc(&key, &iv, &encrypted)?
        }
        "AES-256-CBC" => {
            let key = evp_bytes_to_key::<32>(password.as_bytes(), &iv[..8]);
            decrypt_aes_cbc(&key, &iv, &encrypted)?
        }
        _ => return Err(format!("Unsupported PEM cipher: {}", cipher)),
    };

    // Re-encode as unencrypted PEM and let russh-keys parse the PKCS#1 DER
    let b64 = data_encoding::BASE64.encode(&decrypted);
    let pem_type = if header_type.as_deref() == Some("-----BEGIN RSA PRIVATE KEY-----") {
        "RSA PRIVATE KEY"
    } else if header_type.as_deref() == Some("-----BEGIN DSA PRIVATE KEY-----") {
        "DSA PRIVATE KEY"
    } else {
        "PRIVATE KEY"
    };

    let mut unencrypted_pem = format!("-----BEGIN {}-----\n", pem_type);
    for chunk in b64.as_bytes().chunks(64) {
        unencrypted_pem.push_str(std::str::from_utf8(chunk).unwrap());
        unencrypted_pem.push('\n');
    }
    unencrypted_pem.push_str(&format!("-----END {}-----\n", pem_type));

    russh_keys::decode_secret_key(&unencrypted_pem, None)
        .map_err(|e| format!("Failed to parse decrypted key: {}", e))
}

/// OpenSSL EVP_BytesToKey key derivation (MD5-based, no iteration count)
fn evp_bytes_to_key<const N: usize>(password: &[u8], salt: &[u8]) -> [u8; N] {
    use md5::{Md5, Digest};
    let mut key = [0u8; N];
    let mut offset = 0;
    let mut prev_hash: Option<[u8; 16]> = None;

    while offset < N {
        let mut hasher = Md5::new();
        if let Some(ref h) = prev_hash {
            hasher.update(h);
        }
        hasher.update(password);
        hasher.update(salt);
        let hash: [u8; 16] = hasher.finalize().into();
        let copy_len = std::cmp::min(16, N - offset);
        key[offset..offset + copy_len].copy_from_slice(&hash[..copy_len]);
        offset += copy_len;
        prev_hash = Some(hash);
    }
    key
}

fn decrypt_3des_cbc(key: &[u8; 24], iv: &[u8], data: &[u8]) -> Result<Vec<u8>, String> {
    use des::TdesEde3;
    use cbc::cipher::{BlockDecryptMut, KeyIvInit, block_padding::Pkcs7};
    type Decryptor = cbc::Decryptor<TdesEde3>;

    let iv_arr: [u8; 8] = iv[..8].try_into().map_err(|_| "Invalid IV length for 3DES")?;
    let decryptor = Decryptor::new(key.into(), &iv_arr.into());
    let mut buf = data.to_vec();
    let decrypted = decryptor.decrypt_padded_mut::<Pkcs7>(&mut buf)
        .map_err(|_| "3DES decryption failed — wrong passphrase?".to_string())?;
    Ok(decrypted.to_vec())
}

fn decrypt_aes_cbc(key: &[u8], iv: &[u8], data: &[u8]) -> Result<Vec<u8>, String> {
    use aes::Aes128;
    use aes::Aes256;
    use cbc::cipher::{BlockDecryptMut, KeyIvInit, block_padding::Pkcs7};

    let iv_arr: [u8; 16] = iv[..16].try_into().map_err(|_| "Invalid IV length for AES")?;
    let mut buf = data.to_vec();

    match key.len() {
        16 => {
            type Decryptor = cbc::Decryptor<Aes128>;
            let decryptor = Decryptor::new(key.into(), &iv_arr.into());
            let decrypted = decryptor.decrypt_padded_mut::<Pkcs7>(&mut buf)
                .map_err(|_| "AES-128 decryption failed — wrong passphrase?".to_string())?;
            Ok(decrypted.to_vec())
        }
        32 => {
            type Decryptor = cbc::Decryptor<Aes256>;
            let decryptor = Decryptor::new(key.into(), &iv_arr.into());
            let decrypted = decryptor.decrypt_padded_mut::<Pkcs7>(&mut buf)
                .map_err(|_| "AES-256 decryption failed — wrong passphrase?".to_string())?;
            Ok(decrypted.to_vec())
        }
        _ => Err(format!("Unsupported AES key length: {}", key.len())),
    }
}

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
                let key_pair = load_private_key(key_path, passphrase)?;
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
