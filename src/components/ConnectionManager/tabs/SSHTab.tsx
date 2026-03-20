import type { ConnectionConfig } from "../../../types";
import { FilePickerField } from "../FilePickerField";

interface Props {
  form: ConnectionConfig;
  onFormChange: (key: keyof ConnectionConfig, value: string | number | boolean) => void;
}

const SSH_KEY_FILTERS = [{ name: "Key Files", extensions: ["pem", "ppk", "key", "pub", "id_rsa", "id_ed25519"] }];

export function SSHTab({ form, onFormChange }: Props) {
  const enabled = form.ssh_enabled ?? false;
  const authMethod = form.ssh_auth_method ?? "password";

  return (
    <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: "10px 12px", alignItems: "center" }}>
      {/* Enable toggle */}
      <label>Enable SSH Tunnel</label>
      <div>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onFormChange("ssh_enabled", e.target.checked)}
          style={{ width: "auto" }}
        />
      </div>

      {/* SSH Host */}
      <label style={{ opacity: enabled ? 1 : 0.5 }}>SSH Host</label>
      <input
        value={form.ssh_host ?? ""}
        onChange={(e) => onFormChange("ssh_host", e.target.value)}
        disabled={!enabled}
        placeholder="ssh.example.com"
      />

      {/* SSH Port */}
      <label style={{ opacity: enabled ? 1 : 0.5 }}>SSH Port</label>
      <input
        type="number"
        value={form.ssh_port ?? 22}
        onChange={(e) => onFormChange("ssh_port", Number(e.target.value))}
        disabled={!enabled}
        style={{ width: 100 }}
      />

      {/* SSH Username */}
      <label style={{ opacity: enabled ? 1 : 0.5 }}>SSH Username</label>
      <input
        value={form.ssh_user ?? ""}
        onChange={(e) => onFormChange("ssh_user", e.target.value)}
        disabled={!enabled}
      />

      {/* Auth Method */}
      <label style={{ opacity: enabled ? 1 : 0.5 }}>Auth Method</label>
      <select
        value={authMethod}
        onChange={(e) => onFormChange("ssh_auth_method", e.target.value)}
        disabled={!enabled}
      >
        <option value="password">Password</option>
        <option value="key">Key File</option>
      </select>

      {/* Password auth */}
      {authMethod === "password" && (
        <>
          <label style={{ opacity: enabled ? 1 : 0.5 }}>SSH Password</label>
          <input
            type="password"
            value={form.ssh_password ?? ""}
            onChange={(e) => onFormChange("ssh_password", e.target.value)}
            disabled={!enabled}
          />
        </>
      )}

      {/* Key auth */}
      {authMethod === "key" && (
        <>
          <FilePickerField
            label="Private Key"
            value={form.ssh_key_path ?? ""}
            onChange={(v) => onFormChange("ssh_key_path", v)}
            filters={SSH_KEY_FILTERS}
            disabled={!enabled}
          />
          <label style={{ opacity: enabled ? 1 : 0.5 }}>Passphrase</label>
          <input
            type="password"
            value={form.ssh_passphrase ?? ""}
            onChange={(e) => onFormChange("ssh_passphrase", e.target.value)}
            disabled={!enabled}
            placeholder="(optional)"
          />
        </>
      )}
    </div>
  );
}
