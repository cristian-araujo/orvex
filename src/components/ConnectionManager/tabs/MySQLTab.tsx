import type { ConnectionConfig } from "../../../types";

interface Props {
  name: string;
  form: ConnectionConfig;
  onNameChange: (name: string) => void;
  onFormChange: (key: keyof ConnectionConfig, value: string | number | boolean) => void;
}

export function MySQLTab({ name, form, onNameChange, onFormChange }: Props) {
  const useCustomTimeout = form.session_timeout !== undefined && form.session_timeout !== 28800;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Connection fields */}
      <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: "10px 12px", alignItems: "center" }}>
        <label>Connection Name</label>
        <input value={name} onChange={(e) => onNameChange(e.target.value)} placeholder="My Connection" />

        <label>Host</label>
        <input value={form.host} onChange={(e) => onFormChange("host", e.target.value)} />

        <label>Port</label>
        <input type="number" value={form.port} onChange={(e) => onFormChange("port", Number(e.target.value))} style={{ width: 100 }} />

        <label>User</label>
        <input value={form.user} onChange={(e) => onFormChange("user", e.target.value)} />

        <label>Password</label>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="password"
            value={form.password}
            onChange={(e) => onFormChange("password", e.target.value)}
            style={{ flex: 1 }}
          />
          <label style={{ display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap", fontSize: 11 }}>
            <input
              type="checkbox"
              checked={form.save_password ?? true}
              onChange={(e) => onFormChange("save_password", e.target.checked)}
              style={{ width: "auto" }}
            />
            Save Password
          </label>
        </div>

        <label>Database(s)</label>
        <input value={form.database ?? ""} onChange={(e) => onFormChange("database", e.target.value)} placeholder="(optional)" />
      </div>

      {/* Options */}
      <div style={{ borderTop: "1px solid var(--border)", paddingTop: 12, display: "flex", gap: 20 }}>
        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}>
          <input
            type="checkbox"
            checked={form.use_compression ?? false}
            onChange={(e) => onFormChange("use_compression", e.target.checked)}
            style={{ width: "auto" }}
          />
          Use Compressed Protocol
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12 }}>
          <input
            type="checkbox"
            checked={form.read_only ?? false}
            onChange={(e) => onFormChange("read_only", e.target.checked)}
            style={{ width: "auto" }}
          />
          Read-Only Connection
        </label>
      </div>

      {/* Timeout & Keep-Alive */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 6, color: "var(--text-muted)" }}>
            Session Idle Timeout
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}>
              <input
                type="radio"
                name="timeout"
                checked={!useCustomTimeout}
                onChange={() => onFormChange("session_timeout", 28800)}
                style={{ width: "auto" }}
              />
              Default
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11 }}>
              <input
                type="radio"
                name="timeout"
                checked={useCustomTimeout}
                onChange={() => onFormChange("session_timeout", form.session_timeout ?? 28800)}
                style={{ width: "auto" }}
              />
              Custom
            </label>
            <input
              type="number"
              value={form.session_timeout ?? 28800}
              onChange={(e) => onFormChange("session_timeout", Number(e.target.value))}
              disabled={!useCustomTimeout}
              style={{ width: 80 }}
            />
            <span style={{ fontSize: 10, color: "var(--text-muted)" }}>(s)</span>
          </div>
        </div>

        <div>
          <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 6, color: "var(--text-muted)" }}>
            Keep-Alive Interval
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="number"
              value={form.keepalive_interval ?? 0}
              onChange={(e) => onFormChange("keepalive_interval", Number(e.target.value))}
              style={{ width: 80 }}
            />
            <span style={{ fontSize: 10, color: "var(--text-muted)" }}>(seconds, 0 = disabled)</span>
          </div>
        </div>
      </div>
    </div>
  );
}
