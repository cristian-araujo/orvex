use std::collections::HashMap;
use std::io::BufRead;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use tauri::{AppHandle, Emitter, State};

use crate::db::manager::ConnectionManager;
use crate::models::{ImportOptions, ImportProgressPayload};

// Global registry for cancel flags (separate from export)
static IMPORT_CANCEL_REGISTRY: std::sync::LazyLock<Mutex<HashMap<String, Arc<AtomicBool>>>> =
    std::sync::LazyLock::new(|| Mutex::new(HashMap::new()));

fn register_cancel(id: &str) -> Arc<AtomicBool> {
    let flag = Arc::new(AtomicBool::new(false));
    IMPORT_CANCEL_REGISTRY
        .lock()
        .unwrap()
        .insert(id.to_string(), flag.clone());
    flag
}

fn unregister_cancel(id: &str) {
    IMPORT_CANCEL_REGISTRY.lock().unwrap().remove(id);
}

fn emit_progress(app: &AppHandle, payload: &ImportProgressPayload) {
    let _ = app.emit("import-progress", payload);
}

// --- SQL Parser State Machine ---

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

        // Process character by character to find delimiter outside of literals/comments
        let mut i = 0;
        let chars: Vec<char> = self.buffer.chars().collect();
        let len = chars.len();

        while i < len {
            if self.escape_next {
                self.escape_next = false;
                i += 1;
                continue;
            }

            let ch = chars[i];

            // Block comment handling
            if self.in_block_comment {
                if ch == '*' && i + 1 < len && chars[i + 1] == '/' {
                    self.in_block_comment = false;
                    i += 2;
                    continue;
                }
                i += 1;
                continue;
            }

            // String/backtick literal handling
            if self.in_single_quote {
                if ch == '\\' {
                    self.escape_next = true;
                } else if ch == '\'' {
                    // Check for escaped quote ''
                    if i + 1 < len && chars[i + 1] == '\'' {
                        i += 2;
                        continue;
                    }
                    self.in_single_quote = false;
                }
                i += 1;
                continue;
            }

            if self.in_double_quote {
                if ch == '\\' {
                    self.escape_next = true;
                } else if ch == '"' {
                    if i + 1 < len && chars[i + 1] == '"' {
                        i += 2;
                        continue;
                    }
                    self.in_double_quote = false;
                }
                i += 1;
                continue;
            }

            if self.in_backtick {
                if ch == '`' {
                    if i + 1 < len && chars[i + 1] == '`' {
                        i += 2;
                        continue;
                    }
                    self.in_backtick = false;
                }
                i += 1;
                continue;
            }

            // Not inside any literal
            match ch {
                '\'' => {
                    self.in_single_quote = true;
                    i += 1;
                }
                '"' => {
                    self.in_double_quote = true;
                    i += 1;
                }
                '`' => {
                    self.in_backtick = true;
                    i += 1;
                }
                '/' if i + 1 < len && chars[i + 1] == '*' => {
                    // MySQL conditional comments /*!...*/ should be executed
                    // But we still need to track block comments for /* not followed by !
                    if i + 2 < len && chars[i + 2] == '!' {
                        // Conditional comment: skip the /*! marker, content will be parsed normally
                        i += 3;
                        // Skip optional version number
                        while i < len && chars[i].is_ascii_digit() {
                            i += 1;
                        }
                    } else {
                        self.in_block_comment = true;
                        i += 2;
                    }
                }
                '-' if i + 1 < len && chars[i + 1] == '-' && (i + 2 >= len || chars[i + 2] == ' ' || chars[i + 2] == '\t' || chars[i + 2] == '\n') => {
                    // Single-line comment: skip rest of this logical line within buffer
                    // Find next newline in buffer from current position
                    while i < len && chars[i] != '\n' {
                        i += 1;
                    }
                }
                '#' => {
                    // Single-line comment
                    while i < len && chars[i] != '\n' {
                        i += 1;
                    }
                }
                _ => {
                    // Check if delimiter starts at current position
                    let delim_chars: Vec<char> = self.delimiter.chars().collect();
                    let delim_len = delim_chars.len();
                    if i + delim_len <= len
                        && chars[i..i + delim_len] == delim_chars[..]
                    {
                        // Found delimiter — emit statement
                        let stmt: String = chars[..i].iter().collect();
                        let stmt = stmt.trim().to_string();
                        if !stmt.is_empty() {
                            statements.push(stmt);
                        }
                        // Remove consumed part + delimiter from buffer
                        let remaining: String = chars[i + delim_len..].iter().collect();
                        self.buffer = remaining;
                        return {
                            // Recursively process remaining buffer
                            let mut more = self.process_remaining();
                            statements.append(&mut more);
                            statements
                        };
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

// --- Import logic ---

async fn do_import(
    pool: sqlx::Pool<sqlx::MySql>,
    options: ImportOptions,
    app: AppHandle,
    operation_id: String,
    cancel: Arc<AtomicBool>,
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

    // USE database if specified
    if !options.database.is_empty() {
        let use_sql = format!("USE `{}`", options.database.replace('`', "``"));
        if let Err(e) = sqlx::query(&use_sql).execute(&pool).await {
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

    let mut parser = SqlParser::new();
    let mut bytes_read: u64 = 0;
    let mut statements_executed: u64 = 0;
    let mut errors_count: u64 = 0;
    let mut last_progress = std::time::Instant::now();

    for line_result in reader.lines() {
        if cancel.load(Ordering::Relaxed) {
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
                    if cancel.load(Ordering::Relaxed) {
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

                    // Skip pure comment/conditional wrappers
                    let trimmed = stmt.trim();
                    if trimmed.is_empty() {
                        continue;
                    }

                    let preview: String = if trimmed.len() > 100 {
                        format!("{}...", &trimmed[..100])
                    } else {
                        trimmed.to_string()
                    };

                    match sqlx::query(trimmed).execute(&pool).await {
                        Ok(_) => {
                            statements_executed += 1;
                        }
                        Err(e) => {
                            errors_count += 1;
                            if options.stop_on_error {
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

                    // Throttled progress
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

            match sqlx::query(trimmed).execute(&pool).await {
                Ok(_) => {
                    statements_executed += 1;
                }
                Err(e) => {
                    errors_count += 1;
                    if options.stop_on_error {
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
    let cancel = register_cancel(&operation_id);
    let op_id = operation_id.clone();

    tokio::spawn(async move {
        do_import(pool, options, app, op_id, cancel).await;
    });

    Ok(operation_id)
}

#[tauri::command]
pub async fn cancel_import(operation_id: String) -> Result<(), String> {
    if let Ok(registry) = IMPORT_CANCEL_REGISTRY.lock() {
        if let Some(flag) = registry.get(&operation_id) {
            flag.store(true, Ordering::Relaxed);
        }
    }
    Ok(())
}
