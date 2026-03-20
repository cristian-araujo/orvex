import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { v4 as uuidv4 } from "uuid";
import { useAppStore } from "../../store/useAppStore";
import type { ConnectionProfile, ConnectionConfig } from "../../types";
import { MySQLTab } from "./tabs/MySQLTab";
import { SSHTab } from "./tabs/SSHTab";
import { SSLTab } from "./tabs/SSLTab";
import { AdvancedTab } from "./tabs/AdvancedTab";

type DialogTab = "mysql" | "ssh" | "ssl" | "advanced";

const DEFAULT_CONFIG: ConnectionConfig = {
  host: "localhost",
  port: 3306,
  user: "root",
  password: "",
  database: "",
  // SSH defaults
  ssh_enabled: false,
  ssh_port: 22,
  ssh_auth_method: "password",
  // SSL defaults
  ssl_enabled: false,
  ssl_mode: "Preferred",
  // MySQL tab options
  save_password: true,
  use_compression: false,
  read_only: false,
  session_timeout: 28800,
  keepalive_interval: 0,
  // Advanced defaults
  use_global_sql_mode: true,
};

const tabStyle = (active: boolean): React.CSSProperties => ({
  padding: "6px 14px",
  background: active ? "var(--bg-surface)" : "transparent",
  color: active ? "var(--text-bright)" : "var(--text-muted)",
  borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent",
  borderLeft: "none",
  borderRight: "none",
  borderTop: "none",
  borderRadius: 0,
  fontSize: 12,
  cursor: "pointer",
});

export function ConnectionDialog() {
  const { savedConnections, setSavedConnections, createSession, sessions, setShowConnectionDialog } = useAppStore();
  const [selected, setSelected] = useState<ConnectionProfile | null>(null);
  const [form, setForm] = useState<ConnectionConfig>(DEFAULT_CONFIG);
  const [name, setName] = useState("");
  const [activeTab, setActiveTab] = useState<DialogTab>("mysql");
  const [status, setStatus] = useState<{ msg: string; ok: boolean } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    invoke<ConnectionProfile[]>("get_saved_connections").then(setSavedConnections).catch(() => {});
  }, []);

  const selectProfile = (p: ConnectionProfile) => {
    setSelected(p);
    setForm({ ...DEFAULT_CONFIG, ...p.config });
    setName(p.name);
    setStatus(null);
  };

  const newProfile = () => {
    setSelected(null);
    setForm(DEFAULT_CONFIG);
    setName("New Connection");
    setStatus(null);
  };

  const handleTest = async () => {
    setLoading(true);
    setStatus(null);
    try {
      const msg = await invoke<string>("test_connection", { config: { ...form, database: form.database || null } });
      setStatus({ msg, ok: true });
    } catch (e) {
      setStatus({ msg: String(e), ok: false });
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    const profile: ConnectionProfile = {
      id: selected?.id ?? uuidv4(),
      name: name || "Unnamed",
      config: { ...form, database: form.database || undefined },
    };
    await invoke("save_connection", { profile });
    const updated = await invoke<ConnectionProfile[]>("get_saved_connections");
    setSavedConnections(updated);
    setSelected(profile);
    setStatus({ msg: "Saved", ok: true });
  };

  const handleDelete = async () => {
    if (!selected) return;
    await invoke("delete_connection", { id: selected.id });
    const updated = await invoke<ConnectionProfile[]>("get_saved_connections");
    setSavedConnections(updated);
    newProfile();
  };

  const handleConnect = async () => {
    setLoading(true);
    setStatus(null);
    try {
      const config = { ...form, database: form.database || null };
      const connId = await invoke<string>("connect", { config });
      createSession(connId, name || `${form.user}@${form.host}`, form, selected?.id);
    } catch (e) {
      setStatus({ msg: String(e), ok: false });
    } finally {
      setLoading(false);
    }
  };

  const set = (k: keyof ConnectionConfig, v: string | number | boolean) =>
    setForm((f) => ({ ...f, [k]: v }));

  const tabs: { key: DialogTab; label: string }[] = [
    { key: "mysql", label: "MySQL" },
    { key: "ssh", label: "SSH" },
    { key: "ssl", label: "SSL" },
    { key: "advanced", label: "Advanced" },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.7)" }}>
      <div className="flex" style={{
        background: "var(--bg-panel)",
        border: "1px solid var(--border)",
        borderRadius: 6,
        width: 800,
        height: 520,
        overflow: "hidden",
      }}>
        {/* Left: saved connections */}
        <div style={{
          width: 220,
          borderRight: "1px solid var(--border)",
          display: "flex",
          flexDirection: "column",
        }}>
          <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)", color: "var(--text-muted)", fontSize: 11 }}>
            SAVED CONNECTIONS
          </div>
          <div style={{ flex: 1, overflowY: "auto" }}>
            {savedConnections.map((p) => (
              <div
                key={p.id}
                onClick={() => selectProfile(p)}
                style={{
                  padding: "7px 12px",
                  cursor: "pointer",
                  background: selected?.id === p.id ? "var(--bg-selected)" : "transparent",
                  color: selected?.id === p.id ? "#fff" : "var(--text)",
                }}
                onMouseEnter={(e) => {
                  if (selected?.id !== p.id)
                    (e.currentTarget as HTMLDivElement).style.background = "var(--bg-hover)";
                }}
                onMouseLeave={(e) => {
                  if (selected?.id !== p.id)
                    (e.currentTarget as HTMLDivElement).style.background = "transparent";
                }}
              >
                {p.name}
              </div>
            ))}
          </div>
          <div style={{ padding: 8, borderTop: "1px solid var(--border)" }}>
            <button className="btn-secondary" style={{ width: "100%" }} onClick={newProfile}>
              + New Connection
            </button>
          </div>
        </div>

        {/* Right: tabs + form */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          {/* Tab bar */}
          <div style={{ display: "flex", borderBottom: "1px solid var(--border)", background: "var(--bg-panel)", flexShrink: 0 }}>
            {tabs.map((t) => (
              <button key={t.key} onClick={() => setActiveTab(t.key)} style={tabStyle(activeTab === t.key)}>
                {t.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div style={{ flex: 1, overflow: "auto", padding: 20 }}>
            {activeTab === "mysql" && (
              <MySQLTab
                name={name}
                form={form}
                onNameChange={setName}
                onFormChange={set}
              />
            )}
            {activeTab === "ssh" && (
              <SSHTab form={form} onFormChange={set} />
            )}
            {activeTab === "ssl" && (
              <SSLTab form={form} onFormChange={set} />
            )}
            {activeTab === "advanced" && (
              <AdvancedTab form={form} onFormChange={set} />
            )}
          </div>

          {/* Status + buttons */}
          <div style={{ padding: "0 20px 16px 20px", flexShrink: 0 }}>
            {status && (
              <div style={{
                padding: "6px 10px",
                borderRadius: 4,
                marginBottom: 10,
                fontSize: 12,
                background: status.ok ? "rgba(106,153,85,0.15)" : "rgba(244,71,71,0.15)",
                color: status.ok ? "var(--success)" : "var(--danger)",
                border: `1px solid ${status.ok ? "var(--success)" : "var(--danger)"}`,
              }}>
                {status.msg}
              </div>
            )}

            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn-secondary" onClick={handleTest} disabled={loading}>
                Test
              </button>
              <button className="btn-secondary" onClick={handleSave} disabled={loading}>
                Save
              </button>
              {selected && (
                <button className="btn-danger" onClick={handleDelete} disabled={loading}>
                  Delete
                </button>
              )}
              <div style={{ flex: 1 }} />
              {sessions.length > 0 && (
                <button className="btn-secondary" onClick={() => setShowConnectionDialog(false)} disabled={loading}>
                  Cancel
                </button>
              )}
              <button className="btn-primary" onClick={handleConnect} disabled={loading}>
                {loading ? "Connecting..." : "Connect"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
