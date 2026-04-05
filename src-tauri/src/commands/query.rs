use sqlx::{Pool, MySql, Row, Column, Arguments};
use sqlx::mysql::{MySqlArguments, MySqlConnection};
use tauri::State;
use crate::db::manager::ConnectionManager;
use crate::models::{QueryResult, TableEditRequest, TableEditOperation, ApplyEditsResult};

fn is_fetchable(sql: &str) -> bool {
    let first = sql.trim().split_whitespace().next().unwrap_or("").to_uppercase();
    matches!(
        first.as_str(),
        "SELECT" | "SHOW" | "DESCRIBE" | "DESC" | "EXPLAIN" | "WITH"
    )
}

fn cell_to_json(row: &sqlx::mysql::MySqlRow, i: usize) -> serde_json::Value {
    use sqlx::ValueRef;

    macro_rules! try_opt {
        ($ty:ty) => {
            match row.try_get::<Option<$ty>, _>(i) {
                Ok(Some(v)) => return serde_json::json!(v),
                Ok(None) => return serde_json::Value::Null,
                Err(_) => {}
            }
        };
    }
    macro_rules! try_opt_str {
        ($ty:ty) => {
            match row.try_get::<Option<$ty>, _>(i) {
                Ok(Some(v)) => return serde_json::json!(v.to_string()),
                Ok(None) => return serde_json::Value::Null,
                Err(_) => {}
            }
        };
    }

    // Numeric types
    try_opt!(i64);
    try_opt!(u64);
    // DECIMAL before f64 to preserve full precision
    try_opt_str!(sqlx::types::BigDecimal);
    try_opt!(f64);
    try_opt!(bool);

    // Date/time types (must go before String to get proper formatting)
    try_opt_str!(sqlx::types::chrono::NaiveDateTime);
    try_opt_str!(sqlx::types::chrono::NaiveDate);
    try_opt_str!(sqlx::types::chrono::NaiveTime);
    // TIMESTAMP columns that NaiveDateTime can't decode (timezone-aware).
    // Format explicitly to avoid the " UTC" suffix that to_string() appends.
    match row.try_get::<Option<sqlx::types::chrono::DateTime<sqlx::types::chrono::Utc>>, _>(i) {
        Ok(Some(v)) => return serde_json::json!(v.format("%Y-%m-%d %H:%M:%S").to_string()),
        Ok(None) => return serde_json::Value::Null,
        Err(_) => {}
    }

    // JSON columns (serialized as readable JSON string for display)
    try_opt_str!(serde_json::Value);

    // String fallback (covers VARCHAR, TEXT, ENUM, SET, etc.)
    try_opt!(String);

    // Binary data (BLOB, BINARY, VARBINARY)
    match row.try_get::<Option<Vec<u8>>, _>(i) {
        Ok(Some(v)) => return serde_json::json!(format!("<BLOB: {} bytes>", v.len())),
        Ok(None) => return serde_json::Value::Null,
        Err(_) => {}
    }

    // Last resort: check if raw value is null
    if let Ok(raw) = row.try_get_raw(i) {
        if raw.is_null() {
            return serde_json::Value::Null;
        }
    }

    // If we get here, log the column type for debugging
    let col_type = row.column(i).type_info().to_string();
    serde_json::json!(format!("<unsupported: {}>", col_type))
}

async fn run_query_on_conn(conn: &mut MySqlConnection, sql: &str) -> Result<QueryResult, String> {
    let start = std::time::Instant::now();

    if is_fetchable(sql) {
        let rows = sqlx::query(sql)
            .fetch_all(&mut *conn)
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
            .execute(&mut *conn)
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

pub async fn run_query(pool: &Pool<MySql>, sql: &str) -> Result<QueryResult, String> {
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    run_query_on_conn(&mut *conn, sql).await
}

#[tauri::command]
pub async fn execute_query(
    state: State<'_, ConnectionManager>,
    connection_id: String,
    sql: String,
    database: Option<String>,
) -> Result<QueryResult, String> {
    let pool = state.get_pool(&connection_id)?;
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;

    if let Some(ref db) = database {
        sqlx::query(&format!("USE `{}`", sanitize_ident(db)))
            .execute(&mut *conn)
            .await
            .map_err(|e| e.to_string())?;
    }

    run_query_on_conn(&mut *conn, &sql).await
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

// Sanitize identifier: escape backticks to prevent SQL injection
pub(crate) fn sanitize_ident(name: &str) -> String {
    name.replace('`', "``")
}

fn add_json_to_args(args: &mut MySqlArguments, val: &serde_json::Value) {
    match val {
        serde_json::Value::Null => args.add(Option::<String>::None),
        serde_json::Value::Bool(b) => args.add(*b),
        serde_json::Value::Number(n) => {
            if let Some(i) = n.as_i64() {
                args.add(i);
            } else if let Some(f) = n.as_f64() {
                args.add(f);
            } else {
                args.add(n.to_string());
            }
        }
        serde_json::Value::String(s) => args.add(s.clone()),
        _ => args.add(val.to_string()),
    }
}

fn build_update_sql(
    db: &str,
    table: &str,
    set_values: &[(String, serde_json::Value)],
    where_values: &[(String, serde_json::Value)],
    has_pk: bool,
) -> (String, MySqlArguments) {
    let set_clause: Vec<String> = set_values.iter().map(|(col, _)| format!("`{}` = ?", sanitize_ident(col))).collect();
    let where_clause: Vec<String> = where_values.iter().map(|(col, _)| format!("`{}` <=> ?", sanitize_ident(col))).collect();

    let mut sql = format!(
        "UPDATE `{}`.`{}` SET {} WHERE {}",
        sanitize_ident(db), sanitize_ident(table), set_clause.join(", "), where_clause.join(" AND ")
    );
    if !has_pk {
        sql.push_str(" LIMIT 1");
    }

    let mut args = MySqlArguments::default();
    for (_, val) in set_values {
        add_json_to_args(&mut args, val);
    }
    for (_, val) in where_values {
        add_json_to_args(&mut args, val);
    }
    (sql, args)
}

fn build_insert_sql(
    db: &str,
    table: &str,
    values: &[(String, serde_json::Value)],
) -> (String, MySqlArguments) {
    let columns: Vec<String> = values.iter().map(|(col, _)| format!("`{}`", sanitize_ident(col))).collect();
    let placeholders: Vec<&str> = values.iter().map(|_| "?").collect();

    let sql = format!(
        "INSERT INTO `{}`.`{}` ({}) VALUES ({})",
        sanitize_ident(db), sanitize_ident(table), columns.join(", "), placeholders.join(", ")
    );

    let mut args = MySqlArguments::default();
    for (_, val) in values {
        add_json_to_args(&mut args, val);
    }
    (sql, args)
}

fn build_delete_sql(
    db: &str,
    table: &str,
    where_values: &[(String, serde_json::Value)],
    has_pk: bool,
) -> (String, MySqlArguments) {
    let where_clause: Vec<String> = where_values.iter().map(|(col, _)| format!("`{}` <=> ?", sanitize_ident(col))).collect();

    let mut sql = format!(
        "DELETE FROM `{}`.`{}` WHERE {}",
        sanitize_ident(db), sanitize_ident(table), where_clause.join(" AND ")
    );
    if !has_pk {
        sql.push_str(" LIMIT 1");
    }

    let mut args = MySqlArguments::default();
    for (_, val) in where_values {
        add_json_to_args(&mut args, val);
    }
    (sql, args)
}

#[tauri::command]
pub async fn apply_table_edits(
    state: State<'_, ConnectionManager>,
    connection_id: String,
    request: TableEditRequest,
) -> Result<ApplyEditsResult, String> {
    let pool = state.get_pool(&connection_id)?;
    let has_pk = !request.primary_keys.is_empty();
    let mut tx = pool.begin().await.map_err(|e| e.to_string())?;
    let mut total_affected: u64 = 0;

    for op in &request.operations {
        let (sql, args) = match op {
            TableEditOperation::Update { where_values, set_values } => {
                build_update_sql(&request.database, &request.table, set_values, where_values, has_pk)
            }
            TableEditOperation::Insert { values } => {
                build_insert_sql(&request.database, &request.table, values)
            }
            TableEditOperation::Delete { where_values } => {
                build_delete_sql(&request.database, &request.table, where_values, has_pk)
            }
        };

        let result = sqlx::query_with(&sql, args)
            .execute(&mut *tx)
            .await
            .map_err(|e| e.to_string())?;

        total_affected += result.rows_affected();
    }

    tx.commit().await.map_err(|e| e.to_string())?;

    Ok(ApplyEditsResult {
        success: true,
        rows_affected: total_affected,
        message: format!("{} operation(s) applied, {} row(s) affected", request.operations.len(), total_affected),
    })
}
