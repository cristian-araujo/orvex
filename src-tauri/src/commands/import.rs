use std::collections::HashMap;
use std::io::BufRead;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Emitter, State};

use crate::db::manager::ConnectionManager;
use crate::models::{ImportOptions, ImportProgressPayload};

// Cancel context per operation. Holds the cancel flag AND the MySQL thread ID
// so that cancel_import can issue KILL QUERY to interrupt any in-flight statement
// immediately, without waiting for it to complete on its own.
struct CancelContext {
    flag: Arc<AtomicBool>,
    pool: sqlx::Pool<sqlx::MySql>,
    // Set by do_import after the connection is acquired; None until then.
    mysql_conn_id: Arc<Mutex<Option<u64>>>,
}

// Global registry for cancel contexts (separate from export)
static IMPORT_CANCEL_REGISTRY: std::sync::LazyLock<Mutex<HashMap<String, CancelContext>>> =
    std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));

// Latest progress payload per operation — used by the frontend to recover from the race condition
// where events are emitted before ProgressDialog's listener has time to register.
static IMPORT_PROGRESS_CACHE: std::sync::LazyLock<Mutex<HashMap<String, ImportProgressPayload>>> =
    std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));

fn register_cancel(id: &str, pool: sqlx::Pool<sqlx::MySql>) -> (Arc<AtomicBool>, Arc<Mutex<Option<u64>>>) {
    let flag = Arc::new(AtomicBool::new(false));
    let mysql_conn_id = Arc::new(Mutex::new(None::<u64>));
    IMPORT_CANCEL_REGISTRY.lock().unwrap().insert(id.to_string(), CancelContext {
        flag: flag.clone(),
        pool,
        mysql_conn_id: mysql_conn_id.clone(),
    });
    (flag, mysql_conn_id)
}

fn unregister_cancel(id: &str) {
    IMPORT_CANCEL_REGISTRY.lock().unwrap().remove(id);
    // Remove cached progress so completed operations don't occupy memory indefinitely
    if let Ok(mut cache) = IMPORT_PROGRESS_CACHE.lock() {
        cache.remove(id);
    }
}

fn emit_progress(app: &AppHandle, payload: &ImportProgressPayload) {
    if let Ok(mut cache) = IMPORT_PROGRESS_CACHE.lock() {
        cache.insert(payload.operation_id.clone(), payload.clone());
    }
    let _ = app.emit("import-progress", payload);
}

// --- SQL Parser State Machine ---
//
// Operates on bytes rather than chars to avoid the O(n) Vec<char> allocation
// that would otherwise occur for every line. All SQL structural tokens
// (delimiters, quotes, comment markers) are ASCII, so byte-level scanning is
// semantically equivalent to char-level scanning. UTF-8 continuation bytes
// (0x80-0xBF) are never equal to any ASCII byte, so they are safely skipped
// inside string literals without any special handling.

struct SqlParser {
    delimiter: String,
    buffer: String,
    in_single_quote: bool,
    in_double_quote: bool,
    in_backtick: bool,
    in_block_comment: bool,
    escape_next: bool,
}

impl SqlParser {
    fn new() -> Self {
        Self {
            delimiter: ";".to_string(),
            buffer: String::new(),
            in_single_quote: false,
            in_double_quote: false,
            in_backtick: false,
            in_block_comment: false,
            escape_next: false,
        }
    }

    /// Feed a line into the parser. Returns completed statements (if any).
    fn feed_line(&mut self, line: &str) -> Vec<String> {
        let mut statements = Vec::new();
        let trimmed = line.trim();

        // Handle DELIMITER command (only when not inside a string/comment)
        if !self.in_single_quote
            && !self.in_double_quote
            && !self.in_backtick
            && !self.in_block_comment
            && self.buffer.is_empty()
        {
            let upper = trimmed.to_uppercase();
            if upper.starts_with("DELIMITER ") {
                let new_delim = trimmed[10..].trim().to_string();
                if !new_delim.is_empty() {
                    self.delimiter = new_delim;
                }
                return statements;
            }

            // Skip pure comment lines
            if trimmed.starts_with("--") || trimmed.starts_with('#') {
                return statements;
            }

            // Skip empty lines
            if trimmed.is_empty() {
                return statements;
            }
        }

        // Append line to buffer with newline
        if !self.buffer.is_empty() {
            self.buffer.push('\n');
        }
        self.buffer.push_str(line);

        // Byte-level scan. Splitting at `i` is always safe because we only
        // split at positions occupied by ASCII bytes (delimiter chars), and
        // UTF-8 guarantees no multi-byte sequence contains an ASCII byte.
        let delim_bytes = self.delimiter.as_bytes();
        let delim_len = delim_bytes.len();
        let bytes = self.buffer.as_bytes();
        let len = bytes.len();
        let mut i = 0;

        while i < len {
            if self.escape_next {
                self.escape_next = false;
                i += 1;
                continue;
            }

            let b = bytes[i];

            // Block comment handling
            if self.in_block_comment {
                if b == b'*' && i + 1 < len && bytes[i + 1] == b'/' {
                    self.in_block_comment = false;
                    i += 2;
                    continue;
                }
                i += 1;
                continue;
            }

            // String/backtick literal handling
            if self.in_single_quote {
                if b == b'\\' {
                    self.escape_next = true;
                } else if b == b'\'' {
                    // Check for escaped quote ''
                    if i + 1 < len && bytes[i + 1] == b'\'' {
                        i += 2;
                        continue;
                    }
                    self.in_single_quote = false;
                }
                i += 1;
                continue;
            }

            if self.in_double_quote {
                if b == b'\\' {
                    self.escape_next = true;
                } else if b == b'"' {
                    if i + 1 < len && bytes[i + 1] == b'"' {
                        i += 2;
                        continue;
                    }
                    self.in_double_quote = false;
                }
                i += 1;
                continue;
            }

            if self.in_backtick {
                if b == b'`' {
                    if i + 1 < len && bytes[i + 1] == b'`' {
                        i += 2;
                        continue;
                    }
                    self.in_backtick = false;
                }
                i += 1;
                continue;
            }

            // Not inside any literal
            match b {
                b'\'' => {
                    self.in_single_quote = true;
                    i += 1;
                }
                b'"' => {
                    self.in_double_quote = true;
                    i += 1;
                }
                b'`' => {
                    self.in_backtick = true;
                    i += 1;
                }
                b'/' if i + 1 < len && bytes[i + 1] == b'*' => {
                    // MySQL conditional comments /*!...*/ should be executed
                    // but regular /* ... */ block comments are skipped.
                    if i + 2 < len && bytes[i + 2] == b'!' {
                        // Conditional comment: skip /*! marker and optional version number
                        i += 3;
                        while i < len && bytes[i].is_ascii_digit() {
                            i += 1;
                        }
                    } else {
                        self.in_block_comment = true;
                        i += 2;
                    }
                }
                b'-' if i + 1 < len && bytes[i + 1] == b'-'
                    && (i + 2 >= len
                        || bytes[i + 2] == b' '
                        || bytes[i + 2] == b'\t'
                        || bytes[i + 2] == b'\n') =>
                {
                    // Single-line comment: skip to end of line
                    while i < len && bytes[i] != b'\n' {
                        i += 1;
                    }
                }
                b'#' => {
                    // Single-line comment
                    while i < len && bytes[i] != b'\n' {
                        i += 1;
                    }
                }
                _ => {
                    // Check if delimiter starts at current byte position
                    if i + delim_len <= len && bytes[i..i + delim_len] == *delim_bytes {
                        // Found delimiter — emit statement. Splitting at i is
                        // safe: i points at an ASCII byte (start of delimiter).
                        let stmt = self.buffer[..i].trim().to_string();
                        if !stmt.is_empty() {
                            statements.push(stmt);
                        }
                        // Keep everything after the delimiter for the next parse
                        self.buffer = self.buffer[i + delim_len..].to_string();
                        let mut more = self.process_remaining();
                        statements.append(&mut more);
                        return statements;
                    }
                    i += 1;
                }
            }
        }

        statements
    }

    /// Process any remaining content in the buffer (after delimiter extraction)
    fn process_remaining(&mut self) -> Vec<String> {
        if self.buffer.trim().is_empty() {
            self.buffer.clear();
            return Vec::new();
        }
        let buf = self.buffer.clone();
        self.buffer.clear();
        self.in_single_quote = false;
        self.in_double_quote = false;
        self.in_backtick = false;
        self.in_block_comment = false;
        self.escape_next = false;
        self.feed_line(&buf)
    }

    /// Flush any remaining content as a final statement
    fn flush(&mut self) -> Option<String> {
        let stmt = self.buffer.trim().to_string();
        self.buffer.clear();
        if stmt.is_empty() {
            None
        } else {
            Some(stmt)
        }
    }
}

// --- INSERT chunking ---
//
// mysqldump with --extended-inserts (default) produces a single INSERT per
// table that can be tens of megabytes. Executing that as one statement means
// the progress bar never advances during the entire table load.
//
// split_insert_chunks detects `INSERT INTO ... VALUES (row),(row),...`
// statements and splits them into chunks of `chunk_size` rows each. Smaller
// chunks give more frequent progress events and let InnoDB's group-commit
// mechanism work more efficiently. The function returns the original slice as
// the sole element when no chunking is needed.
//
// Safety: we only split at ASCII byte boundaries (`,` between row tuples at
// paren-depth 0, outside string literals), so UTF-8 data inside string values
// is never corrupted.

const INSERT_CHUNK_ROWS: usize = 5000;
const INSERT_CHUNK_BYTES: usize = 1_048_576;        // 1 MiB hard cap per statement
const TRANSACTION_BATCH_STATEMENTS: u64 = 500;      // COMMIT every N statements

fn split_insert_chunks(stmt: &str) -> Vec<String> {
    // Quick checks: must start with INSERT and be large enough to bother
    let upper_prefix = stmt.trim_start().get(..7).unwrap_or("").to_uppercase();
    if upper_prefix != "INSERT " || stmt.len() < 1024 {
        return vec![stmt.to_string()];
    }

    // Locate the VALUES keyword outside of any literal. We scan bytes for the
    // ASCII sequence " VALUES " (with surrounding spaces/newlines).
    let bytes = stmt.as_bytes();
    let len = bytes.len();
    let values_start = {
        let mut found = None;
        let mut j = 0;
        let mut in_sq = false;
        let mut in_dq = false;
        let mut in_bt = false;
        let mut esc = false;
        while j < len {
            if esc { esc = false; j += 1; continue; }
            let b = bytes[j];
            if in_sq {
                if b == b'\\' { esc = true; }
                else if b == b'\'' {
                    if j + 1 < len && bytes[j + 1] == b'\'' { j += 2; continue; }
                    in_sq = false;
                }
                j += 1; continue;
            }
            if in_dq {
                if b == b'\\' { esc = true; }
                else if b == b'"' {
                    if j + 1 < len && bytes[j + 1] == b'"' { j += 2; continue; }
                    in_dq = false;
                }
                j += 1; continue;
            }
            if in_bt {
                if b == b'`' { in_bt = false; }
                j += 1; continue;
            }
            match b {
                b'\'' => { in_sq = true; j += 1; continue; }
                b'"'  => { in_dq = true; j += 1; continue; }
                b'`'  => { in_bt = true; j += 1; continue; }
                b'V' | b'v' => {
                    // Check for VALUES (case-insensitive) followed by whitespace or '('
                    if j + 6 < len {
                        let candidate = &bytes[j..j + 6];
                        if candidate.eq_ignore_ascii_case(b"VALUES") {
                            let after = bytes[j + 6];
                            if after == b' ' || after == b'\t' || after == b'\n' || after == b'(' {
                                found = Some(j);
                                break;
                            }
                        }
                    }
                    j += 1; continue;
                }
                _ => {}
            }
            j += 1;
        }
        match found {
            Some(pos) => pos,
            None => return vec![stmt.to_string()], // not a VALUES INSERT
        }
    };

    // Extract the header: everything up to and including "VALUES"
    let header_end = values_start + 6; // byte offset just past "VALUES"
    let header = &stmt[..header_end];

    // Find the first '(' of the first value row (skip whitespace after VALUES)
    let rows_start = {
        let mut k = header_end;
        while k < len && (bytes[k] == b' ' || bytes[k] == b'\t' || bytes[k] == b'\n') {
            k += 1;
        }
        if k >= len || bytes[k] != b'(' {
            return vec![stmt.to_string()]; // malformed or INSERT ... SELECT
        }
        k
    };

    // Split the values section into individual row tuples by tracking paren
    // depth and string state. Each row is the byte range of one `(...)` group.
    let values_section = &stmt[rows_start..];
    let vbytes = values_section.as_bytes();
    let vlen = vbytes.len();
    let mut rows: Vec<&str> = Vec::new();
    let mut j = 0;
    let mut depth: usize = 0;
    let mut row_start = 0;
    let mut in_sq = false;
    let mut in_dq = false;
    let mut in_bt = false;
    let mut esc = false;

    while j < vlen {
        if esc { esc = false; j += 1; continue; }
        let b = vbytes[j];
        if in_sq {
            if b == b'\\' { esc = true; }
            else if b == b'\'' {
                if j + 1 < vlen && vbytes[j + 1] == b'\'' { j += 2; continue; }
                in_sq = false;
            }
            j += 1; continue;
        }
        if in_dq {
            if b == b'\\' { esc = true; }
            else if b == b'"' {
                if j + 1 < vlen && vbytes[j + 1] == b'"' { j += 2; continue; }
                in_dq = false;
            }
            j += 1; continue;
        }
        if in_bt {
            if b == b'`' { in_bt = false; }
            j += 1; continue;
        }
        match b {
            b'\'' => { in_sq = true; }
            b'"'  => { in_dq = true; }
            b'`'  => { in_bt = true; }
            b'('  => {
                if depth == 0 { row_start = j; }
                depth += 1;
            }
            b')' => {
                depth -= 1;
                if depth == 0 {
                    // End of a row tuple — record the slice
                    rows.push(&values_section[row_start..=j]);
                    // Skip comma and whitespace between rows
                    let mut k = j + 1;
                    while k < vlen && (vbytes[k] == b',' || vbytes[k] == b' ' || vbytes[k] == b'\n' || vbytes[k] == b'\r') {
                        k += 1;
                    }
                    j = k;
                    continue;
                }
            }
            _ => {}
        }
        j += 1;
    }

    // Chunking dual: by row count (wide tables, many small rows) or by byte size
    // (tables with LONGTEXT/BLOB, few large rows). Both conditions must be false
    // to skip chunking — a statement that fits in rows but exceeds the byte cap
    // still needs to be split.
    if rows.len() <= INSERT_CHUNK_ROWS && stmt.len() <= INSERT_CHUNK_BYTES {
        return vec![stmt.to_string()];
    }
    let rows_per_chunk: usize = if stmt.len() > INSERT_CHUNK_BYTES {
        // Size-based: how many rows fit in INSERT_CHUNK_BYTES (linear proportion)
        (rows.len() * INSERT_CHUNK_BYTES / stmt.len()).max(1)
    } else {
        INSERT_CHUNK_ROWS
    };

    // Reconstruct as multiple INSERT statements
    rows.chunks(rows_per_chunk)
        .map(|chunk| format!("{} {}", header, chunk.join(",")))
        .collect()
}

// --- Import logic ---

async fn do_import(
    pool: sqlx::Pool<sqlx::MySql>,
    options: ImportOptions,
    app: AppHandle,
    operation_id: String,
    cancel: Arc<AtomicBool>,
    mysql_conn_id: Arc<Mutex<Option<u64>>>,
) {
    let start = std::time::Instant::now();

    // Get file size for progress calculation
    let bytes_total = match std::fs::metadata(&options.file_path) {
        Ok(m) => m.len(),
        Err(e) => {
            emit_progress(&app, &ImportProgressPayload {
                operation_id: operation_id.clone(),
                phase: "error".to_string(),
                bytes_read: 0,
                bytes_total: 0,
                statements_executed: 0,
                errors_count: 0,
                current_statement_preview: String::new(),
                elapsed_ms: 0,
                error: Some(format!("Cannot read file: {}", e)),
            });
            return;
        }
    };

    let file = match std::fs::File::open(&options.file_path) {
        Ok(f) => f,
        Err(e) => {
            emit_progress(&app, &ImportProgressPayload {
                operation_id: operation_id.clone(),
                phase: "error".to_string(),
                bytes_read: 0,
                bytes_total,
                statements_executed: 0,
                errors_count: 0,
                current_statement_preview: String::new(),
                elapsed_ms: 0,
                error: Some(format!("Cannot open file: {}", e)),
            });
            return;
        }
    };

    let reader = std::io::BufReader::with_capacity(1024 * 1024, file);

    // Acquire a dedicated connection for the entire import operation.
    // This ensures that USE `database` and all subsequent statements run on the
    // same physical connection — without this, each .execute() call could pick a
    // different connection from the pool and lose the session-level database selection.
    let mut conn = match pool.acquire().await {
        Ok(c) => c,
        Err(e) => {
            emit_progress(&app, &ImportProgressPayload {
                operation_id: operation_id.clone(),
                phase: "error".to_string(),
                bytes_read: 0,
                bytes_total,
                statements_executed: 0,
                errors_count: 0,
                current_statement_preview: String::new(),
                elapsed_ms: start.elapsed().as_millis() as u64,
                error: Some(format!("Cannot acquire connection: {}", e)),
            });
            unregister_cancel(&operation_id);
            return;
        }
    };

    // Store the MySQL thread ID so cancel_import can issue KILL QUERY to interrupt
    // any in-flight statement without waiting for it to complete naturally.
    match sqlx::query_scalar::<_, u64>("SELECT CONNECTION_ID()")
        .fetch_one(&mut *conn)
        .await
    {
        Ok(tid) => {
            if let Ok(mut guard) = mysql_conn_id.lock() {
                *guard = Some(tid);
            }
        }
        Err(_) => {} // Non-fatal: cancel falls back to flag-only mode
    }

    // Disable strict SQL mode for this import session when requested.
    // Dumps generated on MySQL 5.6 or servers without strict mode commonly contain
    // DEFAULT '0000-00-00 00:00:00' in CREATE TABLE statements, which MySQL 5.7.5+
    // rejects with error 1067 when NO_ZERO_DATE / NO_ZERO_IN_DATE are active.
    // Setting 'NO_AUTO_VALUE_ON_ZERO' matches what mysqldump itself writes at the
    // top of its output and strips all strict modes while keeping the one safe guard.
    if options.disable_strict_mode {
        let set_mode = "SET SESSION sql_mode = 'NO_AUTO_VALUE_ON_ZERO'";
        if let Err(e) = sqlx::raw_sql(set_mode).execute(&mut *conn).await {
            emit_progress(&app, &ImportProgressPayload {
                operation_id: operation_id.clone(),
                phase: "error".to_string(),
                bytes_read: 0,
                bytes_total,
                statements_executed: 0,
                errors_count: 0,
                current_statement_preview: set_mode.to_string(),
                elapsed_ms: start.elapsed().as_millis() as u64,
                error: Some(format!("Cannot set sql_mode: {}", e)),
            });
            unregister_cancel(&operation_id);
            return;
        }
    }

    // USE database if specified.
    // Must use raw_sql (simple query protocol) — USE is not supported in the prepared
    // statement protocol and would fail with error 1295 (HY000).
    if !options.database.is_empty() {
        let use_sql = format!("USE `{}`", options.database.replace('`', "``"));
        if let Err(e) = sqlx::raw_sql(&use_sql).execute(&mut *conn).await {
            emit_progress(&app, &ImportProgressPayload {
                operation_id: operation_id.clone(),
                phase: "error".to_string(),
                bytes_read: 0,
                bytes_total,
                statements_executed: 0,
                errors_count: 0,
                current_statement_preview: use_sql,
                elapsed_ms: start.elapsed().as_millis() as u64,
                error: Some(format!("Cannot switch database: {}", e)),
            });
            unregister_cancel(&operation_id);
            return;
        }
    }

    // Disable autocommit for the import session. DDL statements (CREATE TABLE,
    // ALTER TABLE) issue an implicit COMMIT — that is correct MySQL behavior.
    // Explicit COMMITs are issued every TRANSACTION_BATCH_STATEMENTS to bound
    // InnoDB's undo log. On cancel or stop_on_error, we issue ROLLBACK.
    if let Err(e) = sqlx::raw_sql("SET autocommit = 0").execute(&mut *conn).await {
        emit_progress(&app, &ImportProgressPayload {
            operation_id: operation_id.clone(),
            phase: "error".to_string(),
            bytes_read: 0,
            bytes_total,
            statements_executed: 0,
            errors_count: 0,
            current_statement_preview: "SET autocommit = 0".to_string(),
            elapsed_ms: start.elapsed().as_millis() as u64,
            error: Some(format!("Cannot set autocommit: {}", e)),
        });
        unregister_cancel(&operation_id);
        return;
    }

    let mut parser = SqlParser::new();
    let mut bytes_read: u64 = 0;
    let mut statements_executed: u64 = 0;
    let mut errors_count: u64 = 0;
    let mut last_progress = std::time::Instant::now();

    for line_result in reader.lines() {
        if cancel.load(Ordering::Relaxed) {
            let _ = sqlx::raw_sql("ROLLBACK").execute(&mut *conn).await;
            emit_progress(&app, &ImportProgressPayload {
                operation_id: operation_id.clone(),
                phase: "cancelled".to_string(),
                bytes_read,
                bytes_total,
                statements_executed,
                errors_count,
                current_statement_preview: String::new(),
                elapsed_ms: start.elapsed().as_millis() as u64,
                error: None,
            });
            unregister_cancel(&operation_id);
            return;
        }

        match line_result {
            Ok(line) => {
                bytes_read += line.len() as u64 + 1; // +1 for newline
                let stmts = parser.feed_line(&line);

                for stmt in stmts {
                    // Skip pure comment/conditional wrappers
                    let trimmed = stmt.trim();
                    if trimmed.is_empty() {
                        continue;
                    }

                    // Split large INSERT ... VALUES statements into chunks of
                    // INSERT_CHUNK_ROWS rows each. For all other statement types
                    // this returns a single-element vec with the original stmt.
                    let chunks = split_insert_chunks(trimmed);

                    for chunk in &chunks {
                        if cancel.load(Ordering::Relaxed) {
                            let _ = sqlx::raw_sql("ROLLBACK").execute(&mut *conn).await;
                            emit_progress(&app, &ImportProgressPayload {
                                operation_id: operation_id.clone(),
                                phase: "cancelled".to_string(),
                                bytes_read,
                                bytes_total,
                                statements_executed,
                                errors_count,
                                current_statement_preview: String::new(),
                                elapsed_ms: start.elapsed().as_millis() as u64,
                                error: None,
                            });
                            unregister_cancel(&operation_id);
                            return;
                        }

                        let chunk_trimmed = chunk.trim();
                        if chunk_trimmed.is_empty() {
                            continue;
                        }

                        let preview: String = if chunk_trimmed.len() > 100 {
                            format!("{}...", &chunk_trimmed[..100])
                        } else {
                            chunk_trimmed.to_string()
                        };

                        // Pre-execute emit — fires before MySQL starts processing
                        // so the UI reflects the current bytes_read and the
                        // statement about to run even during long executions.
                        if last_progress.elapsed().as_millis() >= 250 {
                            emit_progress(&app, &ImportProgressPayload {
                                operation_id: operation_id.clone(),
                                phase: "executing".to_string(),
                                bytes_read,
                                bytes_total,
                                statements_executed,
                                errors_count,
                                current_statement_preview: preview.clone(),
                                elapsed_ms: start.elapsed().as_millis() as u64,
                                error: None,
                            });
                            last_progress = std::time::Instant::now();
                        }

                        // raw_sql uses the simple query protocol, which supports all MySQL
                        // statements (DDL, SET, USE, etc.) — unlike prepared statements.
                        match sqlx::raw_sql(chunk_trimmed).execute(&mut *conn).await {
                            Ok(_) => {
                                statements_executed += 1;
                                if statements_executed % TRANSACTION_BATCH_STATEMENTS == 0 {
                                    let _ = sqlx::raw_sql("COMMIT").execute(&mut *conn).await;
                                }
                            }
                            Err(e) => {
                                // KILL QUERY from cancel_import may have interrupted this
                                // statement. Check the cancel flag before treating it as a
                                // regular error — emit "cancelled" instead of "error".
                                if cancel.load(Ordering::Relaxed) {
                                    let _ = sqlx::raw_sql("ROLLBACK").execute(&mut *conn).await;
                                    emit_progress(&app, &ImportProgressPayload {
                                        operation_id: operation_id.clone(),
                                        phase: "cancelled".to_string(),
                                        bytes_read,
                                        bytes_total,
                                        statements_executed,
                                        errors_count,
                                        current_statement_preview: String::new(),
                                        elapsed_ms: start.elapsed().as_millis() as u64,
                                        error: None,
                                    });
                                    unregister_cancel(&operation_id);
                                    return;
                                }
                                errors_count += 1;
                                if options.stop_on_error {
                                    let _ = sqlx::raw_sql("ROLLBACK").execute(&mut *conn).await;
                                    emit_progress(&app, &ImportProgressPayload {
                                        operation_id: operation_id.clone(),
                                        phase: "error".to_string(),
                                        bytes_read,
                                        bytes_total,
                                        statements_executed,
                                        errors_count,
                                        current_statement_preview: preview,
                                        elapsed_ms: start.elapsed().as_millis() as u64,
                                        error: Some(e.to_string()),
                                    });
                                    unregister_cancel(&operation_id);
                                    return;
                                }
                            }
                        }

                        // Post-execute emit — updates the statement counter in the UI.
                        if statements_executed % 100 == 0 || last_progress.elapsed().as_millis() >= 500 {
                            emit_progress(&app, &ImportProgressPayload {
                                operation_id: operation_id.clone(),
                                phase: "executing".to_string(),
                                bytes_read,
                                bytes_total,
                                statements_executed,
                                errors_count,
                                current_statement_preview: preview.clone(),
                                elapsed_ms: start.elapsed().as_millis() as u64,
                                error: None,
                            });
                            last_progress = std::time::Instant::now();
                        }
                    }
                }
            }
            Err(e) => {
                emit_progress(&app, &ImportProgressPayload {
                    operation_id: operation_id.clone(),
                    phase: "error".to_string(),
                    bytes_read,
                    bytes_total,
                    statements_executed,
                    errors_count,
                    current_statement_preview: String::new(),
                    elapsed_ms: start.elapsed().as_millis() as u64,
                    error: Some(format!("File read error: {}", e)),
                });
                unregister_cancel(&operation_id);
                return;
            }
        }
    }

    // Flush remaining statement (file may not end with delimiter)
    if let Some(stmt) = parser.flush() {
        let trimmed = stmt.trim();
        if !trimmed.is_empty() {
            let preview: String = if trimmed.len() > 100 {
                format!("{}...", &trimmed[..100])
            } else {
                trimmed.to_string()
            };

            match sqlx::raw_sql(trimmed).execute(&mut *conn).await {
                Ok(_) => {
                    statements_executed += 1;
                }
                Err(e) => {
                    errors_count += 1;
                    if options.stop_on_error {
                        let _ = sqlx::raw_sql("ROLLBACK").execute(&mut *conn).await;
                        emit_progress(&app, &ImportProgressPayload {
                            operation_id: operation_id.clone(),
                            phase: "error".to_string(),
                            bytes_read,
                            bytes_total,
                            statements_executed,
                            errors_count,
                            current_statement_preview: preview,
                            elapsed_ms: start.elapsed().as_millis() as u64,
                            error: Some(e.to_string()),
                        });
                        unregister_cancel(&operation_id);
                        return;
                    }
                }
            }
        }
    }

    let _ = sqlx::raw_sql("COMMIT").execute(&mut *conn).await;
    emit_progress(&app, &ImportProgressPayload {
        operation_id: operation_id.clone(),
        phase: "complete".to_string(),
        bytes_read,
        bytes_total,
        statements_executed,
        errors_count,
        current_statement_preview: String::new(),
        elapsed_ms: start.elapsed().as_millis() as u64,
        error: None,
    });

    unregister_cancel(&operation_id);
}

// --- Tauri commands ---

#[tauri::command]
pub async fn start_import(
    state: State<'_, ConnectionManager>,
    app: AppHandle,
    connection_id: String,
    options: ImportOptions,
) -> Result<String, String> {
    let pool = state.get_pool(&connection_id)?;
    let operation_id = uuid::Uuid::new_v4().to_string();
    let (cancel, mysql_conn_id) = register_cancel(&operation_id, pool.clone());
    let op_id = operation_id.clone();

    // do_import mixes sync file I/O with async MySQL I/O, and internally uses
    // `&mut *conn` (PoolConnection deref) as the sqlx Executor.  Using raw
    // `tokio::spawn` would require the future to be `Send`, which triggers an
    // unsatisfiable HRTB on `Executor<'_>` for `&mut MySqlConnection`.
    // `spawn_blocking` + `Handle::block_on` is the correct model for tasks that
    // combine blocking I/O (file reads) with async I/O (DB statements): the
    // future runs on a dedicated blocking thread with the Tokio runtime handle,
    // avoiding the `Send` requirement entirely.
    let handle = tokio::runtime::Handle::current();
    tokio::task::spawn_blocking(move || {
        handle.block_on(do_import(pool, options, app, op_id, cancel, mysql_conn_id));
    });

    Ok(operation_id)
}

#[tauri::command]
pub fn get_import_progress(operation_id: String) -> Option<ImportProgressPayload> {
    IMPORT_PROGRESS_CACHE
        .lock()
        .ok()
        .and_then(|cache| cache.get(&operation_id).cloned())
}

#[tauri::command]
pub async fn cancel_import(operation_id: String) -> Result<(), String> {
    // Set the cancel flag and, if the import is currently executing a statement,
    // issue KILL QUERY on a separate connection to interrupt it immediately.
    // Without KILL QUERY, the cancel flag is only checked between statements —
    // a long-running INSERT could block cancellation for seconds or minutes.
    let kill_task = {
        if let Ok(registry) = IMPORT_CANCEL_REGISTRY.lock() {
            if let Some(ctx) = registry.get(&operation_id) {
                ctx.flag.store(true, Ordering::Relaxed);
                let thread_id = ctx.mysql_conn_id.lock().ok().and_then(|g| *g);
                thread_id.map(|tid| (ctx.pool.clone(), tid))
            } else {
                None
            }
        } else {
            None
        }
    };

    if let Some((pool, tid)) = kill_task {
        // Fire-and-forget: acquire a second connection and kill the active query.
        // Uses spawn_blocking + block_on (same pattern as do_import) to avoid the
        // HRTB on Executor<'_> that prevents tokio::spawn from working with raw_sql.
        // If the import finishes before KILL reaches MySQL, it's a harmless no-op.
        let handle = tokio::runtime::Handle::current();
        tokio::task::spawn_blocking(move || {
            handle.block_on(async move {
                let kill_sql = format!("KILL QUERY {}", tid);
                if let Ok(mut conn) = pool.acquire().await {
                    let _ = sqlx::raw_sql(&kill_sql).execute(&mut *conn).await;
                }
            });
        });
    }

    Ok(())
}
