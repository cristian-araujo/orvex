use sqlx::Row;
use tauri::State;
use crate::db::manager::ConnectionManager;
use crate::models::{CharsetInfo, ColumnInfo, ForeignKeyInfo, IndexInfo, TableInfo, TableStructure};

#[tauri::command]
pub async fn get_charsets(
    state: State<'_, ConnectionManager>,
    connection_id: String,
) -> Result<Vec<CharsetInfo>, String> {
    let pool = state.get_pool(&connection_id)?;
    let rows = sqlx::query(
        "SELECT CHARACTER_SET_NAME, DESCRIPTION, DEFAULT_COLLATE_NAME \
         FROM information_schema.CHARACTER_SETS \
         ORDER BY CHARACTER_SET_NAME"
    )
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(rows
        .iter()
        .map(|r| CharsetInfo {
            charset: r.get::<String, _>(0),
            description: r.get::<String, _>(1),
            default_collation: r.get::<String, _>(2),
        })
        .collect())
}

#[tauri::command]
pub async fn get_collations(
    state: State<'_, ConnectionManager>,
    connection_id: String,
    charset: String,
) -> Result<Vec<String>, String> {
    // Whitelist charset: only alphanumeric and underscores allowed
    if !charset.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        return Err(format!("Invalid charset name: {}", charset));
    }
    let pool = state.get_pool(&connection_id)?;
    let rows = sqlx::query("SHOW COLLATION WHERE Charset = ?")
        .bind(&charset)
        .fetch_all(&pool)
        .await
        .map_err(|e| e.to_string())?;
    // SHOW COLLATION columns: 0=Collation, 1=Charset, 2=Id, ...
    let mut collations: Vec<String> = rows
        .iter()
        .map(|r| r.get::<String, _>(0))
        .collect();
    collations.sort();
    Ok(collations)
}

#[tauri::command]
pub async fn create_database(
    state: State<'_, ConnectionManager>,
    connection_id: String,
    name: String,
    charset: String,
    collation: String,
) -> Result<(), String> {
    // Whitelist charset and collation: only alphanumeric and underscores
    if !charset.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        return Err(format!("Invalid charset name: {}", charset));
    }
    if !collation.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') {
        return Err(format!("Invalid collation name: {}", collation));
    }
    let pool = state.get_pool(&connection_id)?;
    let sql = format!(
        "CREATE DATABASE `{}` CHARACTER SET {} COLLATE {}",
        crate::commands::query::sanitize_ident(&name),
        charset,
        collation,
    );
    // CREATE DATABASE is not supported in the prepared statement protocol (MySQL error 1295),
    // so we use raw_sql() which executes via the text/simple protocol instead.
    sqlx::raw_sql(&sql)
        .execute(&pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn get_databases(
    state: State<'_, ConnectionManager>,
    connection_id: String,
) -> Result<Vec<String>, String> {
    let pool = state.get_pool(&connection_id)?;
    let rows = sqlx::query("SHOW DATABASES")
        .fetch_all(&pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(rows.iter().map(|r| r.get::<String, _>(0)).collect())
}

#[tauri::command]
pub async fn get_tables(
    state: State<'_, ConnectionManager>,
    connection_id: String,
    database: String,
) -> Result<Vec<TableInfo>, String> {
    let pool = state.get_pool(&connection_id)?;
    let rows = sqlx::query(
        "SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES \
         WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME"
    )
    .bind(&database)
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(rows
        .iter()
        .map(|r| TableInfo {
            name: r.get::<String, _>(0),
            table_type: r.get::<String, _>(1),
        })
        .collect())
}

#[tauri::command]
pub async fn get_columns(
    state: State<'_, ConnectionManager>,
    connection_id: String,
    database: String,
    table: String,
) -> Result<Vec<ColumnInfo>, String> {
    let pool = state.get_pool(&connection_id)?;
    let rows = sqlx::query(
        "SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT, EXTRA \
         FROM information_schema.COLUMNS \
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? \
         ORDER BY ORDINAL_POSITION"
    )
    .bind(&database)
    .bind(&table)
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(rows
        .iter()
        .map(|r| ColumnInfo {
            field: r.get::<String, _>(0),
            column_type: r.get::<String, _>(1),
            nullable: r.get::<String, _>(2) == "YES",
            key: r.get::<String, _>(3),
            default_value: r.try_get::<Option<String>, _>(4).unwrap_or(None),
            extra: r.get::<String, _>(5),
        })
        .collect())
}

#[tauri::command]
pub async fn get_table_structure(
    state: State<'_, ConnectionManager>,
    connection_id: String,
    database: String,
    table: String,
) -> Result<TableStructure, String> {
    let pool = state.get_pool(&connection_id)?;

    // Columns
    let col_sql = format!(
        "SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT, EXTRA \
         FROM information_schema.COLUMNS \
         WHERE TABLE_SCHEMA = '{}' AND TABLE_NAME = '{}' \
         ORDER BY ORDINAL_POSITION",
        database, table
    );
    let col_rows = sqlx::query(&col_sql)
        .fetch_all(&pool)
        .await
        .map_err(|e| e.to_string())?;
    let columns: Vec<ColumnInfo> = col_rows
        .iter()
        .map(|r| ColumnInfo {
            field: r.get::<String, _>(0),
            column_type: r.get::<String, _>(1),
            nullable: r.get::<String, _>(2) == "YES",
            key: r.get::<String, _>(3),
            default_value: r.try_get::<Option<String>, _>(4).unwrap_or(None),
            extra: r.get::<String, _>(5),
        })
        .collect();

    // Indexes
    let idx_sql = format!("SHOW INDEX FROM `{}`.`{}`", database, table);
    let idx_rows = sqlx::query(&idx_sql)
        .fetch_all(&pool)
        .await
        .map_err(|e| e.to_string())?;
    let indexes: Vec<IndexInfo> = idx_rows
        .iter()
        .map(|r| IndexInfo {
            key_name: r.get::<String, _>("Key_name"),
            column_name: r.get::<String, _>("Column_name"),
            non_unique: r.get::<i64, _>("Non_unique") != 0,
            index_type: r.get::<String, _>("Index_type"),
        })
        .collect();

    // Foreign keys
    let fk_sql = format!(
        "SELECT CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME \
         FROM information_schema.KEY_COLUMN_USAGE \
         WHERE TABLE_SCHEMA = '{}' AND TABLE_NAME = '{}' \
         AND REFERENCED_TABLE_NAME IS NOT NULL",
        database, table
    );
    let fk_rows = sqlx::query(&fk_sql)
        .fetch_all(&pool)
        .await
        .map_err(|e| e.to_string())?;
    let foreign_keys: Vec<ForeignKeyInfo> = fk_rows
        .iter()
        .map(|r| ForeignKeyInfo {
            constraint_name: r.get::<String, _>(0),
            column_name: r.get::<String, _>(1),
            referenced_table: r.get::<String, _>(2),
            referenced_column: r.get::<String, _>(3),
        })
        .collect();

    // CREATE TABLE SQL
    let create_sql_query = format!("SHOW CREATE TABLE `{}`.`{}`", database, table);
    let create_row = sqlx::query(&create_sql_query)
        .fetch_one(&pool)
        .await
        .map_err(|e| e.to_string())?;
    let create_sql: String = create_row.try_get(1).unwrap_or_default();

    Ok(TableStructure {
        columns,
        indexes,
        foreign_keys,
        create_sql,
    })
}

#[tauri::command]
pub async fn drop_table(
    state: State<'_, ConnectionManager>,
    connection_id: String,
    database: String,
    table: String,
) -> Result<(), String> {
    let pool = state.get_pool(&connection_id)?;
    let sql = format!(
        "DROP TABLE `{}`.`{}`",
        crate::commands::query::sanitize_ident(&database),
        crate::commands::query::sanitize_ident(&table)
    );
    sqlx::query(&sql)
        .execute(&pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn truncate_table(
    state: State<'_, ConnectionManager>,
    connection_id: String,
    database: String,
    table: String,
) -> Result<(), String> {
    let pool = state.get_pool(&connection_id)?;
    let sql = format!(
        "TRUNCATE TABLE `{}`.`{}`",
        crate::commands::query::sanitize_ident(&database),
        crate::commands::query::sanitize_ident(&table)
    );
    sqlx::query(&sql)
        .execute(&pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn drop_database(
    state: State<'_, ConnectionManager>,
    connection_id: String,
    database: String,
) -> Result<(), String> {
    let pool = state.get_pool(&connection_id)?;
    let sql = format!(
        "DROP DATABASE `{}`",
        crate::commands::query::sanitize_ident(&database)
    );
    sqlx::query(&sql)
        .execute(&pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn get_table_auto_increment(
    state: State<'_, ConnectionManager>,
    connection_id: String,
    database: String,
    table: String,
) -> Result<Option<u64>, String> {
    let pool = state.get_pool(&connection_id)?;
    let row = sqlx::query(
        "SELECT AUTO_INCREMENT FROM information_schema.TABLES \
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?"
    )
    .bind(&database)
    .bind(&table)
    .fetch_one(&pool)
    .await
    .map_err(|e| e.to_string())?;
    Ok(row.try_get::<Option<u64>, _>(0).unwrap_or(None))
}

#[tauri::command]
pub async fn set_table_auto_increment(
    state: State<'_, ConnectionManager>,
    connection_id: String,
    database: String,
    table: String,
    value: u64,
) -> Result<(), String> {
    let pool = state.get_pool(&connection_id)?;
    let sql = format!(
        "ALTER TABLE `{}`.`{}` AUTO_INCREMENT = {}",
        crate::commands::query::sanitize_ident(&database),
        crate::commands::query::sanitize_ident(&table),
        value,  // u64 — no riesgo de inyección
    );
    sqlx::raw_sql(&sql)
        .execute(&pool)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn drop_all_tables(
    state: State<'_, ConnectionManager>,
    connection_id: String,
    database: String,
) -> Result<u32, String> {
    let pool = state.get_pool(&connection_id)?;
    let rows = sqlx::query(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = ? AND table_type = 'BASE TABLE'"
    )
    .bind(&database)
    .fetch_all(&pool)
    .await
    .map_err(|e| e.to_string())?;
    if rows.is_empty() {
        return Ok(0);
    }
    let table_names: Vec<String> = rows.iter().map(|r| r.get::<String, _>(0)).collect();
    let count = table_names.len() as u32;
    let db_ident = crate::commands::query::sanitize_ident(&database);
    let table_list: Vec<String> = table_names
        .iter()
        .map(|t| format!("`{}`.`{}`", db_ident, crate::commands::query::sanitize_ident(t)))
        .collect();
    let drop_sql = format!("DROP TABLE IF EXISTS {}", table_list.join(", "));
    let mut conn = pool.acquire().await.map_err(|e| e.to_string())?;
    sqlx::query("SET FOREIGN_KEY_CHECKS=0")
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string())?;
    let drop_result = sqlx::query(&drop_sql)
        .execute(&mut *conn)
        .await
        .map_err(|e| e.to_string());
    // Always restore FK checks, even if drop failed
    let _ = sqlx::query("SET FOREIGN_KEY_CHECKS=1")
        .execute(&mut *conn)
        .await;
    drop_result?;
    Ok(count)
}
