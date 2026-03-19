use sqlx::Row;
use tauri::State;
use crate::db::manager::ConnectionManager;
use crate::models::{ColumnInfo, ForeignKeyInfo, IndexInfo, TableInfo, TableStructure};

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
    let sql = format!(
        "SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES \
         WHERE TABLE_SCHEMA = '{}' ORDER BY TABLE_NAME",
        database
    );
    let rows = sqlx::query(&sql)
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
    let sql = format!(
        "SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_KEY, COLUMN_DEFAULT, EXTRA \
         FROM information_schema.COLUMNS \
         WHERE TABLE_SCHEMA = '{}' AND TABLE_NAME = '{}' \
         ORDER BY ORDINAL_POSITION",
        database, table
    );
    let rows = sqlx::query(&sql)
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
