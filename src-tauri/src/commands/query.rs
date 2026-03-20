use sqlx::{Pool, MySql, Row, Column};
use tauri::State;
use crate::db::manager::ConnectionManager;
use crate::models::QueryResult;

fn is_fetchable(sql: &str) -> bool {
    let first = sql.trim().split_whitespace().next().unwrap_or("").to_uppercase();
    matches!(
        first.as_str(),
        "SELECT" | "SHOW" | "DESCRIBE" | "DESC" | "EXPLAIN" | "WITH"
    )
}

fn cell_to_json(row: &sqlx::mysql::MySqlRow, i: usize) -> serde_json::Value {
    macro_rules! try_opt {
        ($ty:ty) => {
            match row.try_get::<Option<$ty>, _>(i) {
                Ok(Some(v)) => return serde_json::json!(v),
                Ok(None) => return serde_json::Value::Null,
                Err(_) => {}
            }
        };
    }
    // Stringified types (dates/times must go before String to get proper formatting)
    macro_rules! try_opt_str {
        ($ty:ty) => {
            match row.try_get::<Option<$ty>, _>(i) {
                Ok(Some(v)) => return serde_json::json!(v.to_string()),
                Ok(None) => return serde_json::Value::Null,
                Err(_) => {}
            }
        };
    }
    try_opt!(i64);
    try_opt!(u64);
    try_opt!(f64);
    try_opt!(bool);
    try_opt_str!(sqlx::types::chrono::NaiveDateTime);
    try_opt_str!(sqlx::types::chrono::NaiveDate);
    try_opt_str!(sqlx::types::chrono::NaiveTime);
    try_opt!(String);
    match row.try_get::<Option<Vec<u8>>, _>(i) {
        Ok(Some(v)) => serde_json::json!(format!("<BLOB: {} bytes>", v.len())),
        Ok(None) => serde_json::Value::Null,
        Err(_) => serde_json::json!("<unknown>"),
    }
}

pub async fn run_query(pool: &Pool<MySql>, sql: &str) -> Result<QueryResult, String> {
    let start = std::time::Instant::now();

    if is_fetchable(sql) {
        let rows = sqlx::query(sql)
            .fetch_all(pool)
            .await
            .map_err(|e| e.to_string())?;

        let columns: Vec<String> = if rows.is_empty() {
            vec![]
        } else {
            rows[0].columns().iter().map(|c| c.name().to_string()).collect()
        };

        let data: Vec<Vec<serde_json::Value>> = rows
            .iter()
            .map(|row| (0..row.columns().len()).map(|i| cell_to_json(row, i)).collect())
            .collect();

        Ok(QueryResult {
            columns,
            rows_affected: data.len() as u64,
            rows: data,
            execution_time_ms: start.elapsed().as_millis() as u64,
        })
    } else {
        let result = sqlx::query(sql)
            .execute(pool)
            .await
            .map_err(|e| e.to_string())?;

        Ok(QueryResult {
            columns: vec![],
            rows: vec![],
            rows_affected: result.rows_affected(),
            execution_time_ms: start.elapsed().as_millis() as u64,
        })
    }
}

#[tauri::command]
pub async fn execute_query(
    state: State<'_, ConnectionManager>,
    connection_id: String,
    sql: String,
) -> Result<QueryResult, String> {
    let pool = state.get_pool(&connection_id)?;
    run_query(&pool, &sql).await
}

#[tauri::command]
pub async fn get_table_data(
    state: State<'_, ConnectionManager>,
    connection_id: String,
    database: String,
    table: String,
    page: u32,
    limit: u32,
) -> Result<QueryResult, String> {
    let pool = state.get_pool(&connection_id)?;
    let offset = page * limit;
    let sql = format!(
        "SELECT * FROM `{}`.`{}` LIMIT {} OFFSET {}",
        database, table, limit, offset
    );
    run_query(&pool, &sql).await
}
