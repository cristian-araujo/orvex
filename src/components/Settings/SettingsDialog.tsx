import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useShallow } from "zustand/react/shallow";
import { useAppStore } from "../../store/useAppStore";
import type { AppSettings, ExportFormat, ExportContent, DatetimeDisplayFormat } from "../../types";
import { resolveFilenameTemplate, Tick } from "../ImportExport/ExportDialog";

type SettingsCategory = "export_import" | "grid_display" | "query" | "general";

const CATEGORIES: { id: SettingsCategory; label: string }[] = [
  { id: "export_import", label: "Export / Import" },
  { id: "grid_display", label: "Grid & Display" },
  { id: "query", label: "Query" },
  { id: "general", label: "General" },
];

const EXPORT_FORMATS: { id: ExportFormat; label: string }[] = [
  { id: "Sql", label: "SQL" },
  { id: "Csv", label: "CSV" },
  { id: "Json", label: "JSON" },
];

const EXPORT_CONTENTS: { id: ExportContent; label: string }[] = [
  { id: "StructureAndData", label: "Structure + Data" },
  { id: "StructureOnly", label: "Structure only" },
  { id: "DataOnly", label: "Data only" },
];

const DATETIME_FORMATS: { id: DatetimeDisplayFormat; label: string; preview: string }[] = [
  { id: "iso", label: "ISO", preview: "2024-12-31 23:59:59" },
  { id: "eu",  label: "EU",  preview: "31/12/2024 23:59:59" },
  { id: "us",  label: "US",  preview: "12/31/2024 23:59:59" },
];


function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginBottom: 14 }}>
      <div style={{
        width: 160,
        flexShrink: 0,
        fontSize: 12,
        color: "var(--text-muted)",
        paddingTop: 5,
        textAlign: "right",
      }}>
        {label}
      </div>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 10,
      letterSpacing: "0.08em",
      fontWeight: 700,
      color: "var(--text-muted)",
      textTransform: "uppercase",
      marginBottom: 12,
      marginTop: 4,
      paddingBottom: 6,
      borderBottom: "1px solid var(--border)",
    }}>
      {children}
    </div>
  );
}

function DirField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const handleBrowse = useCallback(async () => {
    const dir = await open({ directory: true, multiple: false });
    if (dir) onChange(dir as string);
  }, [onChange]);

  return (
    <div style={{ display: "flex", gap: 6 }}>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? "Leave empty for default"}
        style={{ flex: 1, fontSize: 12 }}
      />
      <button
        className="btn-secondary"
        onClick={handleBrowse}
        style={{ padding: "3px 10px", fontSize: 11, whiteSpace: "nowrap" }}
      >
        Browse…
      </button>
    </div>
  );
}

function ExportImportCategory({ draft, setDraft }: { draft: AppSettings; setDraft: React.Dispatch<React.SetStateAction<AppSettings>> }) {
  const templatePreview = resolveFilenameTemplate(draft.export_filename_template, {
    database: "mydb",
    tables: ["users"],
    format: "Sql",
  });

  return (
    <div>
      <SectionTitle>File Paths</SectionTitle>

      <FieldRow label="Export directory">
        <DirField
          value={draft.export_default_directory}
          onChange={(v) => setDraft((d) => ({ ...d, export_default_directory: v }))}
        />
        <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4 }}>
          Default directory for the save dialog
        </div>
      </FieldRow>

      <FieldRow label="Import directory">
        <DirField
          value={draft.import_default_directory}
          onChange={(v) => setDraft((d) => ({ ...d, import_default_directory: v }))}
        />
        <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4 }}>
          Default directory for the open dialog
        </div>
      </FieldRow>

      <FieldRow label="Filename template">
        <input
          type="text"
          value={draft.export_filename_template}
          onChange={(e) => setDraft((d) => ({ ...d, export_filename_template: e.target.value }))}
          style={{ width: "100%", fontSize: 12 }}
        />
        <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4 }}>
          Tokens: <code style={{ color: "var(--accent)" }}>{"{database}"}</code>{" "}
          <code style={{ color: "var(--accent)" }}>{"{table}"}</code>{" "}
          <code style={{ color: "var(--accent)" }}>{"{date}"}</code>{" "}
          <code style={{ color: "var(--accent)" }}>{"{datetime}"}</code>{" "}
          <code style={{ color: "var(--accent)" }}>{"{format}"}</code>
        </div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
          Preview: <span style={{ color: "var(--text)" }}>{templatePreview}.sql</span>
        </div>
      </FieldRow>

      <SectionTitle>Export Defaults</SectionTitle>

      <FieldRow label="Default format">
        <div style={{ display: "flex", gap: 4 }}>
          {EXPORT_FORMATS.map((f) => (
            <button
              key={f.id}
              onClick={() => setDraft((d) => ({ ...d, export_default_format: f.id }))}
              style={{
                padding: "4px 12px",
                fontSize: 11,
                border: `1px solid ${draft.export_default_format === f.id ? "var(--accent)" : "var(--border)"}`,
                background: draft.export_default_format === f.id ? "rgba(0,120,212,0.12)" : "var(--bg-surface)",
                color: draft.export_default_format === f.id ? "var(--accent)" : "var(--text)",
                borderRadius: 3,
                cursor: "pointer",
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
      </FieldRow>

      <FieldRow label="Default content">
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          {EXPORT_CONTENTS.map((c) => (
            <label
              key={c.id}
              style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 12 }}
            >
              <input
                type="radio"
                checked={draft.export_default_content === c.id}
                onChange={() => setDraft((d) => ({ ...d, export_default_content: c.id }))}
                style={{ accentColor: "var(--accent)" }}
              />
              {c.label}
            </label>
          ))}
        </div>
      </FieldRow>

      <SectionTitle>SQL Export Options</SectionTitle>

      <FieldRow label="Default options">
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {([
            ["drop_table",         "DROP TABLE IF EXISTS"],
            ["drop_database",      "DROP DATABASE IF EXISTS"],
            ["create_database",    "CREATE DATABASE"],
            ["lock_tables",        "LOCK TABLES"],
            ["disable_foreign_keys","Disable FK Checks"],
            ["set_names",          "SET NAMES utf8mb4"],
            ["add_timestamps",     "Add timestamps header"],
            ["hex_binary",         "Hex-encode BINARY/BLOB"],
            ["extended_inserts",   "Extended INSERTs"],
          ] as [keyof typeof draft.export_default_sql_options, string][]).map(([key, label]) => (
            <label key={key} style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
              <Tick
                checked={draft.export_default_sql_options[key] as boolean}
                onChange={() => setDraft((d) => ({
                  ...d,
                  export_default_sql_options: {
                    ...d.export_default_sql_options,
                    [key]: !d.export_default_sql_options[key],
                  },
                }))}
              />
              <span style={{ fontSize: 12, color: "var(--text)" }}>{label}</span>
            </label>
          ))}
          {draft.export_default_sql_options.extended_inserts && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, paddingLeft: 22 }}>
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Rows/INSERT:</span>
              <input
                type="number"
                min={1}
                max={50000}
                value={draft.export_default_sql_options.extended_insert_rows}
                onChange={(e) => setDraft((d) => ({
                  ...d,
                  export_default_sql_options: {
                    ...d.export_default_sql_options,
                    extended_insert_rows: Number(e.target.value) || 1000,
                  },
                }))}
                style={{ width: 64, fontSize: 11 }}
              />
            </div>
          )}
        </div>
      </FieldRow>
    </div>
  );
}

function GridDisplayCategory({ draft, setDraft }: { draft: AppSettings; setDraft: React.Dispatch<React.SetStateAction<AppSettings>> }) {
  return (
    <div>
      <SectionTitle>Display</SectionTitle>

      <FieldRow label="NULL display text">
        <input
          type="text"
          value={draft.null_display_text}
          onChange={(e) => setDraft((d) => ({ ...d, null_display_text: e.target.value }))}
          style={{ width: 120, fontSize: 12 }}
        />
        <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4 }}>
          Text shown in cells with NULL values
        </div>
      </FieldRow>

      <FieldRow label="Row height (px)">
        <input
          type="number"
          min={18}
          max={64}
          value={draft.grid_row_height}
          onChange={(e) => setDraft((d) => ({ ...d, grid_row_height: Number(e.target.value) || 24 }))}
          style={{ width: 80, fontSize: 12 }}
        />
      </FieldRow>

      <FieldRow label="Date/time format">
        <div style={{ display: "flex", gap: 4 }}>
          {DATETIME_FORMATS.map((f) => (
            <button
              key={f.id}
              onClick={() => setDraft((d) => ({ ...d, datetime_display_format: f.id }))}
              style={{
                padding: "4px 10px",
                fontSize: 11,
                border: `1px solid ${draft.datetime_display_format === f.id ? "var(--accent)" : "var(--border)"}`,
                background: draft.datetime_display_format === f.id ? "rgba(0,120,212,0.12)" : "var(--bg-surface)",
                color: draft.datetime_display_format === f.id ? "var(--accent)" : "var(--text)",
                borderRadius: 3,
                cursor: "pointer",
              }}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 6 }}>
          Preview: <span style={{ color: "var(--text)" }}>
            {DATETIME_FORMATS.find((f) => f.id === draft.datetime_display_format)?.preview}
          </span>
        </div>
      </FieldRow>
    </div>
  );
}

function QueryCategory({ draft, setDraft }: { draft: AppSettings; setDraft: React.Dispatch<React.SetStateAction<AppSettings>> }) {
  const isUnlimited = draft.table_data_limit === null;

  return (
    <div>
      <SectionTitle>Table Preview</SectionTitle>

      <FieldRow label="Row limit">
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <Tick
              checked={isUnlimited}
              onChange={() => setDraft((d) => ({ ...d, table_data_limit: isUnlimited ? 1000 : null }))}
            />
            <span style={{ fontSize: 12, color: "var(--text)" }}>Unlimited (load all rows)</span>
          </label>
          {!isUnlimited && (
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="number"
                min={1}
                max={1000000}
                value={draft.table_data_limit ?? 1000}
                onChange={(e) => setDraft((d) => ({ ...d, table_data_limit: Number(e.target.value) || 1000 }))}
                style={{ width: 100, fontSize: 12 }}
              />
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>rows per page</span>
            </div>
          )}
          <div style={{ fontSize: 10, color: "var(--text-muted)" }}>
            Applied when clicking a table in the object browser
          </div>
        </div>
      </FieldRow>

      <SectionTitle>Editor</SectionTitle>

      <FieldRow label="Tab size">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="number"
            min={1}
            max={8}
            value={draft.editor_tab_size}
            onChange={(e) => setDraft((d) => ({ ...d, editor_tab_size: Number(e.target.value) || 2 }))}
            style={{ width: 60, fontSize: 12 }}
          />
          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>spaces</span>
        </div>
      </FieldRow>
    </div>
  );
}

function GeneralCategory({ draft, setDraft }: { draft: AppSettings; setDraft: React.Dispatch<React.SetStateAction<AppSettings>> }) {
  return (
    <div>
      <SectionTitle>Connections</SectionTitle>

      <FieldRow label="Disconnect">
        <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
          <Tick
            checked={draft.confirm_on_disconnect}
            onChange={() => setDraft((d) => ({ ...d, confirm_on_disconnect: !d.confirm_on_disconnect }))}
          />
          <span style={{ fontSize: 12, color: "var(--text)" }}>Ask for confirmation before disconnecting</span>
        </label>
      </FieldRow>
    </div>
  );
}

export function SettingsDialog() {
  const { settings, setSettings, setShowSettingsDialog } = useAppStore(useShallow((s) => ({
    settings: s.settings,
    setSettings: s.setSettings,
    setShowSettingsDialog: s.setShowSettingsDialog,
  })));

  const [activeCategory, setActiveCategory] = useState<SettingsCategory>("export_import");
  const [draft, setDraft] = useState<AppSettings>(() => ({ ...settings }));
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await invoke("save_settings", { settings: draft });
      setSettings(draft);
      setShowSettingsDialog(false);
    } catch (e) {
      console.error("Failed to save settings:", e);
      // Settings saved in-memory even if persistence fails
      setSettings(draft);
      setShowSettingsDialog(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <style>{`
        @keyframes dlg-in {
          from { opacity: 0; transform: scale(0.975) translateY(10px); }
          to   { opacity: 1; transform: scale(1)     translateY(0);    }
        }
        .settings-dlg { animation: dlg-in 0.18s cubic-bezier(0.16,1,0.3,1); }
        .settings-cat:hover { background: rgba(255,255,255,0.04) !important; }
      `}</style>
      <div
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 100,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(0,0,0,0.55)",
          backdropFilter: "blur(2px)",
        }}
      >
        <div
          className="settings-dlg"
          style={{
            background: "var(--bg-panel)",
            border: "1px solid var(--border)",
            borderRadius: 5,
            width: 680,
            height: 560,
            display: "flex",
            flexDirection: "column",
            boxShadow: "0 24px 64px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.04)",
            overflow: "hidden",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div style={{
            padding: "14px 20px",
            borderBottom: "1px solid var(--border)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexShrink: 0,
          }}>
            <div>
              <div style={{ fontSize: 10, letterSpacing: "0.12em", color: "var(--text-muted)", fontWeight: 700, textTransform: "uppercase", marginBottom: 2 }}>
                Configuration
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-bright)" }}>
                Settings
              </div>
            </div>
            <button
              onClick={() => setShowSettingsDialog(false)}
              style={{
                background: "transparent",
                border: "none",
                color: "var(--text-muted)",
                fontSize: 16,
                padding: "4px 6px",
                cursor: "pointer",
                lineHeight: 1,
                borderRadius: 3,
              }}
            >
              ✕
            </button>
          </div>

          {/* Body — sidebar + content */}
          <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

            {/* Sidebar */}
            <div style={{
              width: 160,
              flexShrink: 0,
              borderRight: "1px solid var(--border)",
              padding: "8px 0",
              display: "flex",
              flexDirection: "column",
            }}>
              {CATEGORIES.map((cat) => (
                <div
                  key={cat.id}
                  className="settings-cat"
                  onClick={() => setActiveCategory(cat.id)}
                  style={{
                    padding: "9px 16px",
                    fontSize: 12,
                    cursor: "pointer",
                    borderLeft: `3px solid ${activeCategory === cat.id ? "var(--accent)" : "transparent"}`,
                    background: activeCategory === cat.id ? "rgba(0,120,212,0.08)" : "transparent",
                    color: activeCategory === cat.id ? "var(--text-bright)" : "var(--text-muted)",
                    transition: "all 0.1s",
                    userSelect: "none",
                  }}
                >
                  {cat.label}
                </div>
              ))}
            </div>

            {/* Content */}
            <div style={{
              flex: 1,
              padding: "20px 24px",
              overflowY: "auto",
            }}>
              {activeCategory === "export_import" && (
                <ExportImportCategory draft={draft} setDraft={setDraft} />
              )}
              {activeCategory === "grid_display" && (
                <GridDisplayCategory draft={draft} setDraft={setDraft} />
              )}
              {activeCategory === "query" && (
                <QueryCategory draft={draft} setDraft={setDraft} />
              )}
              {activeCategory === "general" && (
                <GeneralCategory draft={draft} setDraft={setDraft} />
              )}
            </div>
          </div>

          {/* Footer */}
          <div style={{
            padding: "12px 20px",
            borderTop: "1px solid var(--border)",
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
            flexShrink: 0,
            background: "rgba(0,0,0,0.15)",
          }}>
            <button
              className="btn-secondary"
              onClick={() => setShowSettingsDialog(false)}
            >
              Cancel
            </button>
            <button
              className="btn-primary"
              onClick={handleSave}
              disabled={saving}
              style={{ opacity: saving ? 0.6 : 1, minWidth: 80 }}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
