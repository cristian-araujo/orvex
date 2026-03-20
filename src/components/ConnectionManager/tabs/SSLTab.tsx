import type { ConnectionConfig } from "../../../types";
import { FilePickerField } from "../FilePickerField";

interface Props {
  form: ConnectionConfig;
  onFormChange: (key: keyof ConnectionConfig, value: string | number | boolean) => void;
}

const CERT_FILTERS = [{ name: "Certificates", extensions: ["pem", "crt", "cer", "key"] }];

export function SSLTab({ form, onFormChange }: Props) {
  const enabled = form.ssl_enabled ?? false;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "140px 1fr", gap: "10px 12px", alignItems: "center" }}>
      {/* Enable toggle */}
      <label>Use SSL</label>
      <div>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onFormChange("ssl_enabled", e.target.checked)}
          style={{ width: "auto" }}
        />
      </div>

      {/* SSL Mode */}
      <label style={{ opacity: enabled ? 1 : 0.5 }}>SSL Mode</label>
      <select
        value={form.ssl_mode ?? "Preferred"}
        onChange={(e) => onFormChange("ssl_mode", e.target.value)}
        disabled={!enabled}
      >
        <option value="Disabled">Disabled</option>
        <option value="Preferred">Preferred</option>
        <option value="Required">Required</option>
        <option value="VerifyCa">Verify CA</option>
        <option value="VerifyIdentity">Verify Identity</option>
      </select>

      {/* CA Certificate */}
      <FilePickerField
        label="CA Certificate"
        value={form.ssl_ca_path ?? ""}
        onChange={(v) => onFormChange("ssl_ca_path", v)}
        filters={CERT_FILTERS}
        disabled={!enabled}
      />

      {/* Client Certificate */}
      <FilePickerField
        label="Client Certificate"
        value={form.ssl_cert_path ?? ""}
        onChange={(v) => onFormChange("ssl_cert_path", v)}
        filters={CERT_FILTERS}
        disabled={!enabled}
      />

      {/* Client Key */}
      <FilePickerField
        label="Client Key"
        value={form.ssl_key_path ?? ""}
        onChange={(v) => onFormChange("ssl_key_path", v)}
        filters={CERT_FILTERS}
        disabled={!enabled}
      />
    </div>
  );
}
