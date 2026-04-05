use std::collections::HashMap;
use std::io::Write;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use futures::StreamExt;
use sqlx::mysql::MySqlRow;
use sqlx::{Column, Pool, MySql, Row, TypeInfo, ValueRef};
use tauri::{AppHandle, Emitter, State};

use crate::commands::query::sanitize_ident;
use crate::db::manager::ConnectionManager;
use crate::models::{ExportContent, ExportFormat, ExportOptions, ExportProgressPayload};

// Global registry for cancel flags
static CANCEL_REGISTRY: std::sync::LazyLock<Mutex<HashMap<String, Arc<AtomicBool>>>> =
    std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));

// Latest progress payload per operation — used by the frontend to recover from the race condition
// where events are emitted before ProgressDialog's listener has time to register.
static EXPORT_PROGRESS_CACHE: std::sync::LazyLock<Mutex<HashMap<String, ExportProgressPayload>>> =
    std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));

fn register_cancel(id: &str) -> Arc<AtomicBool> {
    let flag = Arc::new(AtomicBool::new(false));
    CANCEL_REGISTRY
        .lock()
        .unwrap()
        .insert(id.to_string(), flag.clone());
    flag
}

fn unregister_cancel(id: &str) {
    CANCEL_REGISTRY.lock().unwrap().remove(id);
    // Remove cached progress so completed operations don't occupy memory indefinitely
    if let Ok(mut cache) = EXPORT_PROGRESS_CACHE.lock() {
        cache.remove(id);
    }
}

// --- Hex lookup table (avoids format! per byte) ---

const HEX_CHARS: &[u8; 16] = b"0123456789ABCDEF";

fn hex_encode(bytes: &[u8], out: &mut String) {
    out.reserve(bytes.len() * 2);
    for &b in bytes {
        out.push(HEX_CHARS[(b >> 4) as usize] as char);
        out.push(HEX_CHARS[(b & 0x0F) as usize] as char);
    }
}

// --- Column type classification (resolved once per table, not per cell) ---

#[derive(Debug, Clone, Copy)]
enum ColKind {
    Binary,
    Int,
    UInt,
    Decimal,
    Float,
    Bool,
    DateTime,
    Date,
    Time,
    Json,
    Text,
    Bytes,
}

fn classify_column(type_name: &str) -> ColKind {
    let upper = type_name.to_uppercase();
    if upper.contains("BLOB") || upper.contains("BINARY") || upper.contains("BIT") {
        ColKind::Binary
    } else if upper.contains("BIGINT UNSIGNED") || upper == "BIGINT UNSIGNED" {
        ColKind::UInt
    } else if upper.contains("INT") {
        ColKind::Int
    } else if upper.contains("DECIMAL") || upper.contains("NUMERIC") {
        ColKind::Decimal
    } else if upper.contains("FLOAT") || upper.contains("DOUBLE") || upper.contains("REAL") {
        ColKind::Float
    } else if upper.contains("BOOL") || upper == "TINYINT(1)" {
        ColKind::Bool
    } else if upper.contains("DATETIME") || upper.contains("TIMESTAMP") {
        ColKind::DateTime
    } else if upper.contains("DATE") {
        ColKind::Date
    } else if upper.contains("TIME") {
        ColKind::Time
    } else if upper.contains("JSON") {
        ColKind::Json
    } else if upper.contains("VARBINARY") || upper.contains("BYTEA") {
        ColKind::Bytes
    } else {
        ColKind::Text
    }
}

// --- SQL value escaping (optimized: uses pre-classified column kind) ---

fn escape_sql_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 8);
    for ch in s.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            '\'' => out.push_str("\\'"),
            '\0' => out.push_str("\\0"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\x1a' => out.push_str("\\Z"),
            _ => out.push(ch),
        }
    }
    out
}

/// Write escaped SQL value directly into `out` buffer. Avoids per-cell String allocation.
fn write_sql_value(out: &mut String, row: &MySqlRow, idx: usize, kind: ColKind, hex_binary: bool) {
    // NULL check
    if let Ok(raw) = row.try_get_raw(idx) {
        if raw.is_null() {
            out.push_str("NULL");
            return;
        }
    }

    match kind {
        ColKind::Binary => {
            if hex_binary {
                if let Ok(Some(bytes)) = row.try_get::<Option<Vec<u8>>, _>(idx) {
                    out.push_str("X'");
                    hex_encode(&bytes, out);
                    out.push('\'');
                    return;
                }
            }
            // fallback to string
            if let Ok(Some(v)) = row.try_get::<Option<String>, _>(idx) {
                out.push('\'');
                out.push_str(&escape_sql_string(&v));
                out.push('\'');
                return;
            }
            out.push_str("NULL");
        }
        ColKind::Int => {
            if let Ok(Some(v)) = row.try_get::<Option<i64>, _>(idx) {
                out.push_str(&v.to_string());
            } else if let Ok(Some(v)) = row.try_get::<Option<u64>, _>(idx) {
                out.push_str(&v.to_string());
            } else {
                out.push_str("NULL");
            }
        }
        ColKind::UInt => {
            if let Ok(Some(v)) = row.try_get::<Option<u64>, _>(idx) {
                out.push_str(&v.to_string());
            } else if let Ok(Some(v)) = row.try_get::<Option<i64>, _>(idx) {
                out.push_str(&v.to_string());
            } else {
                out.push_str("NULL");
            }
        }
        ColKind::Decimal => {
            if let Ok(Some(v)) = row.try_get::<Option<sqlx::types::BigDecimal>, _>(idx) {
                out.push_str(&v.to_string());
            } else if let Ok(Some(v)) = row.try_get::<Option<f64>, _>(idx) {
                out.push_str(&v.to_string());
            } else {
                out.push_str("NULL");
            }
        }
        ColKind::Float => {
            if let Ok(Some(v)) = row.try_get::<Option<f64>, _>(idx) {
                out.push_str(&v.to_string());
            } else {
                out.push_str("NULL");
            }
        }
        ColKind::Bool => {
            if let Ok(Some(v)) = row.try_get::<Option<bool>, _>(idx) {
                out.push(if v { '1' } else { '0' });
            } else if let Ok(Some(v)) = row.try_get::<Option<i64>, _>(idx) {
                out.push_str(&v.to_string());
            } else {
                out.push_str("NULL");
            }
        }
        ColKind::DateTime => {
            if let Ok(Some(v)) = row.try_get::<Option<sqlx::types::chrono::NaiveDateTime>, _>(idx) {
                out.push('\'');
                out.push_str(&v.format("%Y-%m-%d %H:%M:%S").to_string());
                out.push('\'');
            } else if let Ok(Some(v)) = row.try_get::<Option<sqlx::types::chrono::DateTime<sqlx::types::chrono::Utc>>, _>(idx) {
                // TIMESTAMP columns decode as DateTime<Utc> in sqlx — format without timezone suffix
                out.push('\'');
                out.push_str(&v.format("%Y-%m-%d %H:%M:%S").to_string());
                out.push('\'');
            } else {
                out.push_str("NULL");
            }
        }
        ColKind::Date => {
            if let Ok(Some(v)) = row.try_get::<Option<sqlx::types::chrono::NaiveDate>, _>(idx) {
                out.push('\'');
                out.push_str(&v.format("%Y-%m-%d").to_string());
                out.push('\'');
            } else {
                out.push_str("NULL");
            }
        }
        ColKind::Time => {
            if let Ok(Some(v)) = row.try_get::<Option<sqlx::types::chrono::NaiveTime>, _>(idx) {
                out.push('\'');
                out.push_str(&v.format("%H:%M:%S").to_string());
                out.push('\'');
            } else {
                out.push_str("NULL");
            }
        }
        ColKind::Json => {
            if let Ok(Some(v)) = row.try_get::<Option<serde_json::Value>, _>(idx) {
                out.push('\'');
                out.push_str(&escape_sql_string(&v.to_string()));
                out.push('\'');
            } else {
                out.push_str("NULL");
            }
        }
        ColKind::Text => {
            if let Ok(Some(v)) = row.try_get::<Option<String>, _>(idx) {
                out.push('\'');
                out.push_str(&escape_sql_string(&v));
                out.push('\'');
            } else if let Ok(Some(bytes)) = row.try_get::<Option<Vec<u8>>, _>(idx) {
                out.push_str("X'");
                hex_encode(&bytes, out);
                out.push('\'');
            } else {
                out.push_str("NULL");
            }
        }
        ColKind::Bytes => {
            if let Ok(Some(bytes)) = row.try_get::<Option<Vec<u8>>, _>(idx) {
                out.push_str("X'");
                hex_encode(&bytes, out);
                out.push('\'');
            } else {
                out.push_str("NULL");
            }
        }
    }
}

fn write_csv_value(out: &mut String, row: &MySqlRow, idx: usize, kind: ColKind) {
    if let Ok(raw) = row.try_get_raw(idx) {
        if raw.is_null() {
            return;
        }
    }
    let val = match kind {
        ColKind::Text | ColKind::Json => {
            if let Ok(Some(v)) = row.try_get::<Option<String>, _>(idx) { v }
            else { return; }
        }
        ColKind::Int => {
            if let Ok(Some(v)) = row.try_get::<Option<i64>, _>(idx) { v.to_string() }
            else { return; }
        }
        ColKind::UInt => {
            if let Ok(Some(v)) = row.try_get::<Option<u64>, _>(idx) { v.to_string() }
            else { return; }
        }
        ColKind::Decimal => {
            if let Ok(Some(v)) = row.try_get::<Option<sqlx::types::BigDecimal>, _>(idx) { v.to_string() }
            else { return; }
        }
        ColKind::Float => {
            if let Ok(Some(v)) = row.try_get::<Option<f64>, _>(idx) { v.to_string() }
            else { return; }
        }
        ColKind::Bool => {
            if let Ok(Some(v)) = row.try_get::<Option<bool>, _>(idx) { if v { "1".to_string() } else { "0".to_string() } }
            else { return; }
        }
        ColKind::DateTime => {
            if let Ok(Some(v)) = row.try_get::<Option<sqlx::types::chrono::NaiveDateTime>, _>(idx) { v.format("%Y-%m-%d %H:%M:%S").to_string() }
            // TIMESTAMP columns decode as DateTime<Utc> in sqlx — format without timezone suffix
            else if let Ok(Some(v)) = row.try_get::<Option<sqlx::types::chrono::DateTime<sqlx::types::chrono::Utc>>, _>(idx) { v.format("%Y-%m-%d %H:%M:%S").to_string() }
            else { return; }
        }
        ColKind::Date => {
            if let Ok(Some(v)) = row.try_get::<Option<sqlx::types::chrono::NaiveDate>, _>(idx) { v.format("%Y-%m-%d").to_string() }
            else { return; }
        }
        ColKind::Time => {
            if let Ok(Some(v)) = row.try_get::<Option<sqlx::types::chrono::NaiveTime>, _>(idx) { v.format("%H:%M:%S").to_string() }
            else { return; }
        }
        ColKind::Binary | ColKind::Bytes => {
            if let Ok(Some(bytes)) = row.try_get::<Option<Vec<u8>>, _>(idx) {
                let mut hex = String::with_capacity(bytes.len() * 2 + 2);
                hex.push_str("0x");
                hex_encode(&bytes, &mut hex);
                hex
            } else { return; }
        }
    };
    // CSV quoting
    if val.contains(',') || val.contains('"') || val.contains('\n') || val.contains('\r') {
        out.push('"');
        for ch in val.chars() {
            if ch == '"' { out.push_str("\"\""); } else { out.push(ch); }
        }
        out.push('"');
    } else {
        out.push_str(&val);
    }
}

fn write_json_value(out: &mut String, row: &MySqlRow, idx: usize, kind: ColKind) {
    if let Ok(raw) = row.try_get_raw(idx) {
        if raw.is_null() {
            out.push_str("null");
            return;
        }
    }
    match kind {
        ColKind::Int => {
            if let Ok(Some(v)) = row.try_get::<Option<i64>, _>(idx) { out.push_str(&v.to_string()); return; }
        }
        ColKind::UInt => {
            if let Ok(Some(v)) = row.try_get::<Option<u64>, _>(idx) { out.push_str(&v.to_string()); return; }
        }
        ColKind::Float => {
            if let Ok(Some(v)) = row.try_get::<Option<f64>, _>(idx) { out.push_str(&v.to_string()); return; }
        }
        ColKind::Bool => {
            if let Ok(Some(v)) = row.try_get::<Option<bool>, _>(idx) { out.push_str(if v { "true" } else { "false" }); return; }
        }
        ColKind::Json => {
            if let Ok(Some(v)) = row.try_get::<Option<serde_json::Value>, _>(idx) {
                out.push_str(&serde_json::to_string(&v).unwrap_or("null".into()));
                return;
            }
        }
        _ => {}
    }
    // Everything else: as JSON string
    if let Ok(Some(v)) = row.try_get::<Option<String>, _>(idx) {
        out.push_str(&serde_json::to_string(&v).unwrap_or("null".into()));
    } else if let Ok(Some(v)) = row.try_get::<Option<sqlx::types::BigDecimal>, _>(idx) {
        out.push('"');
        out.push_str(&v.to_string());
        out.push('"');
    } else if let Ok(Some(v)) = row.try_get::<Option<sqlx::types::chrono::NaiveDateTime>, _>(idx) {
        out.push('"');
        out.push_str(&v.format("%Y-%m-%d %H:%M:%S").to_string());
        out.push('"');
    } else if let Ok(Some(v)) = row.try_get::<Option<sqlx::types::chrono::DateTime<sqlx::types::chrono::Utc>>, _>(idx) {
        // TIMESTAMP columns decode as DateTime<Utc> in sqlx — format without timezone suffix
        out.push('"');
        out.push_str(&v.format("%Y-%m-%d %H:%M:%S").to_string());
        out.push('"');
    } else if let Ok(Some(v)) = row.try_get::<Option<sqlx::types::chrono::NaiveDate>, _>(idx) {
        out.push('"');
        out.push_str(&v.format("%Y-%m-%d").to_string());
        out.push('"');
    } else if let Ok(Some(v)) = row.try_get::<Option<sqlx::types::chrono::NaiveTime>, _>(idx) {
        out.push('"');
        out.push_str(&v.format("%H:%M:%S").to_string());
        out.push('"');
    } else if let Ok(Some(bytes)) = row.try_get::<Option<Vec<u8>>, _>(idx) {
        out.push_str("\"0x");
        hex_encode(&bytes, out);
        out.push('"');
    } else {
        out.push_str("null");
    }
}

// --- Resolve column kinds once per table from first row ---

fn resolve_col_kinds(row: &MySqlRow) -> Vec<ColKind> {
    row.columns()
        .iter()
        .map(|c| classify_column(&c.type_info().to_string()))
        .collect()
}

// --- Main export logic ---

async fn get_table_list(pool: &Pool<MySql>, database: &str) -> Result<Vec<String>, String> {
    let sql = format!(
        "SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = '{}' AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME",
        escape_sql_string(database)
    );
    let rows = sqlx::query(&sql)
        .fetch_all(pool)
        .await
        .map_err(|e| e.to_string())?;

    Ok(rows
        .iter()
        .filter_map(|r| r.try_get::<String, _>(0).ok())
        .collect())
}

fn emit_progress(app: &AppHandle, payload: &ExportProgressPayload) {
    if let Ok(mut cache) = EXPORT_PROGRESS_CACHE.lock() {
        cache.insert(payload.operation_id.clone(), payload.clone());
    }
    let _ = app.emit("export-progress", payload);
}

fn emit_cancel(app: &AppHandle, operation_id: &str, table: &str, tables_done: u32, tables_total: u32, total_rows: u64, bytes_written: u64, start: std::time::Instant) {
    emit_progress(app, &ExportProgressPayload {
        operation_id: operation_id.to_string(),
        phase: "cancelled".to_string(),
        current_table: table.to_string(),
        tables_done,
        tables_total,
        rows_exported: total_rows,
        bytes_written,
        elapsed_ms: start.elapsed().as_millis() as u64,
        error: None,
    });
}

async fn do_export(
    pool: Pool<MySql>,
    options: ExportOptions,
    app: AppHandle,
    operation_id: String,
    cancel: Arc<AtomicBool>,
) {
    let start = std::time::Instant::now();

    let tables = if options.tables.is_empty() {
        match get_table_list(&pool, &options.database).await {
            Ok(t) => t,
            Err(e) => {
                emit_progress(&app, &ExportProgressPayload {
                    operation_id: operation_id.clone(),
                    phase: "error".to_string(),
                    current_table: String::new(),
                    tables_done: 0,
                    tables_total: 0,
                    rows_exported: 0,
                    bytes_written: 0,
                    elapsed_ms: start.elapsed().as_millis() as u64,
                    error: Some(e),
                });
                return;
            }
        }
    } else {
        options.tables.clone()
    };

    let tables_total = tables.len() as u32;

    match options.format {
        ExportFormat::Sql => {
            do_export_sql(&pool, &options, &tables, &app, &operation_id, &cancel, start, tables_total).await;
        }
        ExportFormat::Csv => {
            do_export_csv(&pool, &options, &tables, &app, &operation_id, &cancel, start, tables_total).await;
        }
        ExportFormat::Json => {
            do_export_json(&pool, &options, &tables, &app, &operation_id, &cancel, start, tables_total).await;
        }
    }

    unregister_cancel(&operation_id);
}

// --- Macro for cancellable stream loop (DRY across SQL/CSV/JSON) ---

macro_rules! stream_loop {
    ($stream:expr, $cancel:expr, $cancel_body:expr, $row_body:expr, $err_body:expr) => {
        loop {
            if $cancel.load(Ordering::Relaxed) {
                $cancel_body;
                return;
            }
            let result = match tokio::time::timeout(
                std::time::Duration::from_millis(100),
                $stream.next(),
            ).await {
                Ok(None) => break,
                Ok(Some(r)) => r,
                Err(_) => continue,
            };
            match result {
                Ok(row) => { $row_body(row); }
                Err(e) => { $err_body(e); break; }
            }
        }
    };
}

async fn do_export_sql(
    pool: &Pool<MySql>,
    options: &ExportOptions,
    tables: &[String],
    app: &AppHandle,
    operation_id: &str,
    cancel: &Arc<AtomicBool>,
    start: std::time::Instant,
    tables_total: u32,
) {
    let file = match std::fs::File::create(&options.file_path) {
        Ok(f) => f,
        Err(e) => {
            emit_progress(app, &ExportProgressPayload {
                operation_id: operation_id.to_string(),
                phase: "error".to_string(),
                current_table: String::new(),
                tables_done: 0,
                tables_total,
                rows_exported: 0,
                bytes_written: 0,
                elapsed_ms: start.elapsed().as_millis() as u64,
                error: Some(format!("Cannot create file: {}", e)),
            });
            return;
        }
    };

    // 2MB buffer for large exports
    let mut writer = std::io::BufWriter::with_capacity(2 * 1024 * 1024, file);
    let mut bytes_written: u64 = 0;
    let mut total_rows: u64 = 0;

    macro_rules! w {
        ($s:expr) => {
            if let Err(e) = writer.write_all($s.as_bytes()) {
                emit_progress(app, &ExportProgressPayload {
                    operation_id: operation_id.to_string(),
                    phase: "error".to_string(),
                    current_table: String::new(),
                    tables_done: 0,
                    tables_total,
                    rows_exported: total_rows,
                    bytes_written,
                    elapsed_ms: start.elapsed().as_millis() as u64,
                    error: Some(format!("Write error: {}", e)),
                });
                return;
            }
            bytes_written += $s.len() as u64;
        };
    }

    // Header
    if options.add_timestamps {
        let app_name = app.config().product_name.as_deref().unwrap_or("Orvex");
        let now = sqlx::types::chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
        w!(format!("-- {} Database Export\n-- Database: {}\n-- Date: {}\n-- ------------------------------------------------------\n\n", app_name, options.database, now));
    }

    w!("/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;\n");
    w!("/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;\n");
    w!("/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;\n");

    if options.set_names {
        w!("SET NAMES utf8mb4;\n");
    }
    if options.disable_foreign_keys {
        w!("SET FOREIGN_KEY_CHECKS = 0;\n");
    }
    w!("\n");

    if options.drop_database {
        w!(format!("DROP DATABASE IF EXISTS `{}`;\n", sanitize_ident(&options.database)));
    }
    if options.create_database {
        w!(format!("CREATE DATABASE IF NOT EXISTS `{}`;\n", sanitize_ident(&options.database)));
        w!(format!("USE `{}`;\n\n", sanitize_ident(&options.database)));
    }

    let include_structure = !matches!(options.content, ExportContent::DataOnly);
    let include_data = !matches!(options.content, ExportContent::StructureOnly);

    // Reusable buffer for building value tuples — avoids per-row allocation
    let mut val_buf = String::with_capacity(4096);
    // Reusable buffer for INSERT statement assembly
    let mut insert_buf = String::with_capacity(64 * 1024);

    for (i, table) in tables.iter().enumerate() {
        if cancel.load(Ordering::Relaxed) {
            let _ = writer.flush();
            emit_cancel(app, operation_id, table, i as u32, tables_total, total_rows, bytes_written, start);
            return;
        }

        // Structure
        if include_structure {
            w!(format!("-- ----------------------------\n-- Table structure for `{}`\n-- ----------------------------\n", table));

            if options.drop_table {
                w!(format!("DROP TABLE IF EXISTS `{}`;\n", sanitize_ident(table)));
            }

            let create_sql = format!("SHOW CREATE TABLE `{}`.`{}`", sanitize_ident(&options.database), sanitize_ident(table));
            match sqlx::query(&create_sql).fetch_one(pool).await {
                Ok(row) => {
                    if let Ok(ddl) = row.try_get::<String, _>(1) {
                        w!(format!("{};\n\n", ddl));
                    }
                }
                Err(e) => {
                    w!(format!("-- Error getting structure for `{}`: {}\n\n", table, e));
                }
            }
        }

        // Data
        if include_data {
            w!(format!("-- ----------------------------\n-- Records of `{}`\n-- ----------------------------\n", table));

            if options.lock_tables {
                w!(format!("LOCK TABLES `{}` WRITE;\n", sanitize_ident(table)));
            }

            let select_sql = format!("SELECT * FROM `{}`.`{}`", sanitize_ident(&options.database), sanitize_ident(table));
            let mut stream = sqlx::query(&select_sql).fetch(pool);
            let mut col_kinds: Option<Vec<ColKind>> = None;
            let mut col_list_cached: Option<String> = None;
            let mut batch_count: u32 = 0;
            let mut row_count: u64 = 0;
            let mut last_progress = std::time::Instant::now();

            stream_loop!(stream, cancel, {
                let _ = writer.flush();
                emit_cancel(app, operation_id, table, i as u32, tables_total, total_rows, bytes_written, start);
            }, |row: MySqlRow| {
                // Resolve column kinds + col_list once from first row
                if col_kinds.is_none() {
                    col_kinds = Some(resolve_col_kinds(&row));
                    let cols = row.columns();
                    let mut cl = String::with_capacity(cols.len() * 20);
                    for (ci, c) in cols.iter().enumerate() {
                        if ci > 0 { cl.push(','); }
                        cl.push('`');
                        cl.push_str(&sanitize_ident(c.name()));
                        cl.push('`');
                    }
                    col_list_cached = Some(cl);
                }
                let kinds = col_kinds.as_ref().unwrap();

                // Start new INSERT if batch is empty
                if batch_count == 0 {
                    insert_buf.clear();
                    insert_buf.push_str("INSERT INTO `");
                    insert_buf.push_str(&sanitize_ident(table));
                    insert_buf.push_str("` (");
                    insert_buf.push_str(col_list_cached.as_ref().unwrap());
                    insert_buf.push_str(") VALUES\n");
                } else {
                    insert_buf.push_str(",\n");
                }

                // Build value tuple directly into insert_buf
                insert_buf.push('(');
                for ci in 0..kinds.len() {
                    if ci > 0 { insert_buf.push(','); }
                    write_sql_value(&mut insert_buf, &row, ci, kinds[ci], options.hex_binary);
                }
                insert_buf.push(')');
                batch_count += 1;
                row_count += 1;
                total_rows += 1;

                // Flush batch
                let flush_batch = if options.extended_inserts {
                    batch_count >= options.extended_insert_rows
                } else {
                    true
                };

                if flush_batch {
                    insert_buf.push_str(";\n");
                    w!(insert_buf);
                    batch_count = 0;
                }

                // Throttled progress
                if row_count % 10_000 == 0 || last_progress.elapsed().as_millis() >= 500 {
                    emit_progress(app, &ExportProgressPayload {
                        operation_id: operation_id.to_string(),
                        phase: "data".to_string(),
                        current_table: table.clone(),
                        tables_done: i as u32,
                        tables_total,
                        rows_exported: total_rows,
                        bytes_written,
                        elapsed_ms: start.elapsed().as_millis() as u64,
                        error: None,
                    });
                    last_progress = std::time::Instant::now();
                }
            }, |e: sqlx::Error| {
                w!(format!("-- Error reading data from `{}`: {}\n", table, e));
            });

            // Flush remaining batch
            if batch_count > 0 {
                insert_buf.push_str(";\n");
                w!(insert_buf);
            }

            if options.lock_tables {
                w!("UNLOCK TABLES;\n");
            }
            w!("\n");
        }

        // Per-table progress
        emit_progress(app, &ExportProgressPayload {
            operation_id: operation_id.to_string(),
            phase: "structure".to_string(),
            current_table: table.clone(),
            tables_done: (i + 1) as u32,
            tables_total,
            rows_exported: total_rows,
            bytes_written,
            elapsed_ms: start.elapsed().as_millis() as u64,
            error: None,
        });
    }

    // Footer
    if options.disable_foreign_keys {
        w!("SET FOREIGN_KEY_CHECKS = 1;\n");
    }
    w!("/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;\n");
    w!("/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;\n");
    w!("/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;\n");

    let _ = writer.flush();

    emit_progress(app, &ExportProgressPayload {
        operation_id: operation_id.to_string(),
        phase: "complete".to_string(),
        current_table: String::new(),
        tables_done: tables_total,
        tables_total,
        rows_exported: total_rows,
        bytes_written,
        elapsed_ms: start.elapsed().as_millis() as u64,
        error: None,
    });
}

async fn do_export_csv(
    pool: &Pool<MySql>,
    options: &ExportOptions,
    tables: &[String],
    app: &AppHandle,
    operation_id: &str,
    cancel: &Arc<AtomicBool>,
    start: std::time::Instant,
    tables_total: u32,
) {
    let mut total_rows: u64 = 0;
    let mut total_bytes: u64 = 0;

    // Reusable line buffer
    let mut line_buf = String::with_capacity(4096);

    for (i, table) in tables.iter().enumerate() {
        if cancel.load(Ordering::Relaxed) {
            emit_cancel(app, operation_id, table, i as u32, tables_total, total_rows, total_bytes, start);
            return;
        }

        let file_path = if tables.len() == 1 {
            options.file_path.clone()
        } else {
            let base = options.file_path.trim_end_matches(".csv");
            format!("{}_{}.csv", base, table)
        };

        let file = match std::fs::File::create(&file_path) {
            Ok(f) => f,
            Err(e) => {
                emit_progress(app, &ExportProgressPayload {
                    operation_id: operation_id.to_string(),
                    phase: "error".to_string(),
                    current_table: table.clone(),
                    tables_done: i as u32,
                    tables_total,
                    rows_exported: total_rows,
                    bytes_written: total_bytes,
                    elapsed_ms: start.elapsed().as_millis() as u64,
                    error: Some(format!("Cannot create file: {}", e)),
                });
                return;
            }
        };

        let mut writer = std::io::BufWriter::with_capacity(2 * 1024 * 1024, file);
        let mut bytes_written: u64 = 0;

        macro_rules! w {
            ($s:expr) => {
                if let Err(e) = writer.write_all($s.as_bytes()) {
                    emit_progress(app, &ExportProgressPayload {
                        operation_id: operation_id.to_string(),
                        phase: "error".to_string(),
                        current_table: table.clone(),
                        tables_done: i as u32,
                        tables_total,
                        rows_exported: total_rows,
                        bytes_written: total_bytes,
                        elapsed_ms: start.elapsed().as_millis() as u64,
                        error: Some(format!("Write error: {}", e)),
                    });
                    return;
                }
                bytes_written += $s.len() as u64;
            };
        }

        let select_sql = format!(
            "SELECT * FROM `{}`.`{}`",
            sanitize_ident(&options.database),
            sanitize_ident(table)
        );
        let mut stream = sqlx::query(&select_sql).fetch(pool);
        let mut col_kinds: Option<Vec<ColKind>> = None;
        let mut header_written = false;
        let mut row_count: u64 = 0;
        let mut last_progress = std::time::Instant::now();

        stream_loop!(stream, cancel, {
            let _ = writer.flush();
            emit_cancel(app, operation_id, table, i as u32, tables_total, total_rows, total_bytes, start);
        }, |row: MySqlRow| {
            if !header_written {
                col_kinds = Some(resolve_col_kinds(&row));
                line_buf.clear();
                let cols = row.columns();
                for (ci, c) in cols.iter().enumerate() {
                    if ci > 0 { line_buf.push(','); }
                    let name = c.name();
                    if name.contains(',') || name.contains('"') || name.contains('\n') {
                        line_buf.push('"');
                        line_buf.push_str(&name.replace('"', "\"\""));
                        line_buf.push('"');
                    } else {
                        line_buf.push_str(name);
                    }
                }
                line_buf.push('\n');
                w!(line_buf);
                header_written = true;
            }

            let kinds = col_kinds.as_ref().unwrap();
            line_buf.clear();
            for ci in 0..kinds.len() {
                if ci > 0 { line_buf.push(','); }
                write_csv_value(&mut line_buf, &row, ci, kinds[ci]);
            }
            line_buf.push('\n');
            w!(line_buf);

            row_count += 1;
            total_rows += 1;

            if row_count % 10_000 == 0 || last_progress.elapsed().as_millis() >= 500 {
                emit_progress(app, &ExportProgressPayload {
                    operation_id: operation_id.to_string(),
                    phase: "data".to_string(),
                    current_table: table.clone(),
                    tables_done: i as u32,
                    tables_total,
                    rows_exported: total_rows,
                    bytes_written: total_bytes + bytes_written,
                    elapsed_ms: start.elapsed().as_millis() as u64,
                    error: None,
                });
                last_progress = std::time::Instant::now();
            }
        }, |e: sqlx::Error| {
            emit_progress(app, &ExportProgressPayload {
                operation_id: operation_id.to_string(),
                phase: "error".to_string(),
                current_table: table.clone(),
                tables_done: i as u32,
                tables_total,
                rows_exported: total_rows,
                bytes_written: total_bytes + bytes_written,
                elapsed_ms: start.elapsed().as_millis() as u64,
                error: Some(format!("Query error on `{}`: {}", table, e)),
            });
        });

        let _ = writer.flush();
        total_bytes += bytes_written;

        emit_progress(app, &ExportProgressPayload {
            operation_id: operation_id.to_string(),
            phase: "data".to_string(),
            current_table: table.clone(),
            tables_done: (i + 1) as u32,
            tables_total,
            rows_exported: total_rows,
            bytes_written: total_bytes,
            elapsed_ms: start.elapsed().as_millis() as u64,
            error: None,
        });
    }

    emit_progress(app, &ExportProgressPayload {
        operation_id: operation_id.to_string(),
        phase: "complete".to_string(),
        current_table: String::new(),
        tables_done: tables_total,
        tables_total,
        rows_exported: total_rows,
        bytes_written: total_bytes,
        elapsed_ms: start.elapsed().as_millis() as u64,
        error: None,
    });
}

async fn do_export_json(
    pool: &Pool<MySql>,
    options: &ExportOptions,
    tables: &[String],
    app: &AppHandle,
    operation_id: &str,
    cancel: &Arc<AtomicBool>,
    start: std::time::Instant,
    tables_total: u32,
) {
    let mut total_rows: u64 = 0;
    let mut total_bytes: u64 = 0;

    // Reusable row buffer
    let mut row_buf = String::with_capacity(4096);

    for (i, table) in tables.iter().enumerate() {
        if cancel.load(Ordering::Relaxed) {
            emit_cancel(app, operation_id, table, i as u32, tables_total, total_rows, total_bytes, start);
            return;
        }

        let file_path = if tables.len() == 1 {
            options.file_path.clone()
        } else {
            let base = options.file_path.trim_end_matches(".json");
            format!("{}_{}.json", base, table)
        };

        let file = match std::fs::File::create(&file_path) {
            Ok(f) => f,
            Err(e) => {
                emit_progress(app, &ExportProgressPayload {
                    operation_id: operation_id.to_string(),
                    phase: "error".to_string(),
                    current_table: table.clone(),
                    tables_done: i as u32,
                    tables_total,
                    rows_exported: total_rows,
                    bytes_written: total_bytes,
                    elapsed_ms: start.elapsed().as_millis() as u64,
                    error: Some(format!("Cannot create file: {}", e)),
                });
                return;
            }
        };

        let mut writer = std::io::BufWriter::with_capacity(2 * 1024 * 1024, file);
        let mut bytes_written: u64 = 0;

        macro_rules! w {
            ($s:expr) => {
                if let Err(e) = writer.write_all($s.as_bytes()) {
                    emit_progress(app, &ExportProgressPayload {
                        operation_id: operation_id.to_string(),
                        phase: "error".to_string(),
                        current_table: table.clone(),
                        tables_done: i as u32,
                        tables_total,
                        rows_exported: total_rows,
                        bytes_written: total_bytes,
                        elapsed_ms: start.elapsed().as_millis() as u64,
                        error: Some(format!("Write error: {}", e)),
                    });
                    return;
                }
                bytes_written += $s.len() as u64;
            };
        }

        w!("[\n");

        let select_sql = format!(
            "SELECT * FROM `{}`.`{}`",
            sanitize_ident(&options.database),
            sanitize_ident(table)
        );
        let mut stream = sqlx::query(&select_sql).fetch(pool);
        let mut col_names: Option<Vec<String>> = None;
        let mut col_kinds: Option<Vec<ColKind>> = None;
        let mut row_count: u64 = 0;
        let mut last_progress = std::time::Instant::now();

        stream_loop!(stream, cancel, {
            let _ = writer.flush();
            emit_cancel(app, operation_id, table, i as u32, tables_total, total_rows, total_bytes, start);
        }, |row: MySqlRow| {
            if col_names.is_none() {
                col_names = Some(row.columns().iter().map(|c| c.name().to_string()).collect());
                col_kinds = Some(resolve_col_kinds(&row));
            }

            // Comma before non-first rows
            if row_count > 0 {
                w!(",\n");
            }

            let names = col_names.as_ref().unwrap();
            let kinds = col_kinds.as_ref().unwrap();

            // Build JSON object manually (avoids serde_json::Map allocation per row)
            row_buf.clear();
            row_buf.push_str("  {");
            for (ci, name) in names.iter().enumerate() {
                if ci > 0 { row_buf.push(','); }
                row_buf.push('"');
                row_buf.push_str(name);
                row_buf.push_str("\":");
                write_json_value(&mut row_buf, &row, ci, kinds[ci]);
            }
            row_buf.push('}');
            w!(row_buf);

            row_count += 1;
            total_rows += 1;

            if row_count % 10_000 == 0 || last_progress.elapsed().as_millis() >= 500 {
                emit_progress(app, &ExportProgressPayload {
                    operation_id: operation_id.to_string(),
                    phase: "data".to_string(),
                    current_table: table.clone(),
                    tables_done: i as u32,
                    tables_total,
                    rows_exported: total_rows,
                    bytes_written: total_bytes + bytes_written,
                    elapsed_ms: start.elapsed().as_millis() as u64,
                    error: None,
                });
                last_progress = std::time::Instant::now();
            }
        }, |e: sqlx::Error| {
            emit_progress(app, &ExportProgressPayload {
                operation_id: operation_id.to_string(),
                phase: "error".to_string(),
                current_table: table.clone(),
                tables_done: i as u32,
                tables_total,
                rows_exported: total_rows,
                bytes_written: total_bytes + bytes_written,
                elapsed_ms: start.elapsed().as_millis() as u64,
                error: Some(format!("Query error on `{}`: {}", table, e)),
            });
        });

        w!("\n]\n");
        let _ = writer.flush();
        total_bytes += bytes_written;

        emit_progress(app, &ExportProgressPayload {
            operation_id: operation_id.to_string(),
            phase: "data".to_string(),
            current_table: table.clone(),
            tables_done: (i + 1) as u32,
            tables_total,
            rows_exported: total_rows,
            bytes_written: total_bytes,
            elapsed_ms: start.elapsed().as_millis() as u64,
            error: None,
        });
    }

    emit_progress(app, &ExportProgressPayload {
        operation_id: operation_id.to_string(),
        phase: "complete".to_string(),
        current_table: String::new(),
        tables_done: tables_total,
        tables_total,
        rows_exported: total_rows,
        bytes_written: total_bytes,
        elapsed_ms: start.elapsed().as_millis() as u64,
        error: None,
    });
}

// --- Tauri commands ---

#[tauri::command]
pub async fn start_export(
    state: State<'_, ConnectionManager>,
    app: AppHandle,
    connection_id: String,
    options: ExportOptions,
) -> Result<String, String> {
    let pool = state.get_pool(&connection_id)?;
    let operation_id = uuid::Uuid::new_v4().to_string();
    let cancel = register_cancel(&operation_id);
    let op_id = operation_id.clone();

    tokio::spawn(async move {
        do_export(pool, options, app, op_id, cancel).await;
    });

    Ok(operation_id)
}

#[tauri::command]
pub fn get_export_progress(operation_id: String) -> Option<ExportProgressPayload> {
    EXPORT_PROGRESS_CACHE
        .lock()
        .ok()
        .and_then(|cache| cache.get(&operation_id).cloned())
}

#[tauri::command]
pub async fn cancel_export(operation_id: String) -> Result<(), String> {
    if let Ok(registry) = CANCEL_REGISTRY.lock() {
        if let Some(flag) = registry.get(&operation_id) {
            flag.store(true, Ordering::Relaxed);
        }
    }
    Ok(())
}
