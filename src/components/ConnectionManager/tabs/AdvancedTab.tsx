import type { ConnectionConfig } from "../../../types";

interface Props {
  form: ConnectionConfig;
  onFormChange: (key: keyof ConnectionConfig, value: string | number | boolean) => void;
}

const SQL_MODES = [
  "",
  "STRICT_TRANS_TABLES",
  "STRICT_ALL_TABLES",
  "TRADITIONAL",
  "ANSI",
  "NO_ENGINE_SUBSTITUTION",
  "ONLY_FULL_GROUP_BY",
  "NO_ZERO_IN_DATE",
  "NO_ZERO_DATE",
  "ERROR_FOR_DIVISION_BY_ZERO",
];

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <label style={{ width: 120, fontSize: 12 }}>{label}</label>
      <input
        type="color"
        value={value || "#252526"}
        onChange={(e) => onChange(e.target.value)}
        style={{ width: 32, height: 24, padding: 0, border: "1px solid var(--border)", cursor: "pointer" }}
      />
      <input
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        placeholder="(default)"
        style={{ width: 100 }}
      />
    </div>
  );
}

export function AdvancedTab({ form, onFormChange }: Props) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Object Browser Colors */}
      <div>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: "var(--text-bright)" }}>
          Object Browser Colors
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <ColorField
            label="Background Color"
            value={form.bg_color ?? ""}
            onChange={(v) => onFormChange("bg_color", v)}
          />
          <ColorField
            label="Foreground Color"
            value={form.fg_color ?? ""}
            onChange={(v) => onFormChange("fg_color", v)}
          />
          <ColorField
            label="Selected Color"
            value={form.selected_color ?? ""}
            onChange={(v) => onFormChange("selected_color", v)}
          />
        </div>
        <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4 }}>
          (These colors will be used in the Object Browser for this connection only)
        </div>
      </div>

      {/* SQL Mode */}
      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: "var(--text-bright)" }}>
          SQL Mode
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <select
            value={form.sql_mode ?? ""}
            onChange={(e) => onFormChange("sql_mode", e.target.value)}
            disabled={form.use_global_sql_mode ?? true}
            style={{ flex: 1 }}
          >
            {SQL_MODES.map((m) => (
              <option key={m} value={m}>{m || "(none)"}</option>
            ))}
          </select>
          <label style={{ display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap", fontSize: 12 }}>
            <input
              type="checkbox"
              checked={form.use_global_sql_mode ?? true}
              onChange={(e) => onFormChange("use_global_sql_mode", e.target.checked)}
              style={{ width: "auto" }}
            />
            Use global value
          </label>
        </div>
      </div>

      {/* Init Commands */}
      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8, color: "var(--text-bright)" }}>
          Init Command(s)
        </div>
        <textarea
          value={form.init_commands ?? ""}
          onChange={(e) => onFormChange("init_commands", e.target.value)}
          placeholder="e.g. USE sakila; SET NAMES utf8mb4"
          rows={3}
          style={{ width: "100%", resize: "vertical", fontFamily: "monospace", fontSize: 12 }}
        />
        <div style={{ fontSize: 10, color: "var(--text-muted)", marginTop: 4 }}>
          (Separate multiple commands with a semicolon ";")
        </div>
      </div>
    </div>
  );
}
