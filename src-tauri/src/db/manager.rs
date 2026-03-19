use sqlx::{MySql, Pool, mysql::MySqlPoolOptions};
use std::collections::HashMap;
use std::sync::Mutex;
use crate::models::ConnectionConfig;

pub struct ConnectionManager {
    pools: Mutex<HashMap<String, Pool<MySql>>>,
}

impl ConnectionManager {
    pub fn new() -> Self {
        Self {
            pools: Mutex::new(HashMap::new()),
        }
    }

    pub async fn connect(&self, id: &str, config: &ConnectionConfig) -> Result<(), String> {
        let db_part = config.database.as_deref().unwrap_or("");
        let url = format!(
            "mysql://{}:{}@{}:{}/{}",
            config.user, config.password, config.host, config.port, db_part
        );

        let pool = MySqlPoolOptions::new()
            .max_connections(5)
            .connect(&url)
            .await
            .map_err(|e| format!("Connection failed: {}", e))?;

        let mut pools = self.pools.lock().map_err(|e| e.to_string())?;
        pools.insert(id.to_string(), pool);
        Ok(())
    }

    pub fn disconnect(&self, id: &str) -> Result<(), String> {
        let mut pools = self.pools.lock().map_err(|e| e.to_string())?;
        pools.remove(id);
        Ok(())
    }

    pub fn get_pool(&self, id: &str) -> Result<Pool<MySql>, String> {
        let pools = self.pools.lock().map_err(|e| e.to_string())?;
        pools
            .get(id)
            .cloned()
            .ok_or_else(|| format!("No active connection: {}", id))
    }
}
