import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { v4 as uuidv4 } from "uuid";
import { useAppStore } from "../../store/useAppStore";
import type { ConnectionProfile, ConnectionConfig } from "../../types";

const DEFAULT_CONFIG: ConnectionConfig = {
  host: "localhost",
  port: 3306,
  user: "root",
  password: "",
  database: "",
};

export function ConnectionDialog() {
  const { savedConnections, setSavedConnections, setActiveConnection } = useAppStore();
  const [selected, setSelected] = useState<ConnectionProfile | null>(null);
  const [form, setForm] = useState<ConnectionConfig>(DEFAULT_CONFIG);
  const [name, setName] = useState("");
  const [status, setStatus] = useState<{ msg: string; ok: boolean } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    invoke<ConnectionProfile[]>("get_saved_connections").then(setSavedConnections).catch(() => {});
  }, []);

  const selectProfile = (p: ConnectionProfile) => {
    setSelected(p);
    setForm(p.config);
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
      setActiveConnection(connId, name || `${form.user}@${form.host}`);
    } catch (e) {
      setStatus({ msg: String(e), ok: false });
    } finally {
      setLoading(false);
    }
  };

  const set = (k: keyof ConnectionConfig, v: string | number) =>
    setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.7)" }}>
      <div className="flex" style={{
        background: "var(--bg-panel)",
        border: "1px solid var(--border)",
        borderRadius: 6,
        width: 760,
        height: 480,
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
                🔌 {p.name}
              </div>
            ))}
          </div>
          <div style={{ padding: 8, borderTop: "1px solid var(--border)" }}>
            <button className="btn-secondary" style={{ width: "100%" }} onClick={newProfile}>
              + New Connection
            </button>
          </div>
        </div>

        {/* Right: form */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: 20 }}>
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 16, color: "var(--text-bright)" }}>
            Connection Settings
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: "10px 12px", alignItems: "center" }}>
            <label>Connection Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="My Connection" style={{ width: "100%" }} />

            <label>Host</label>
            <input value={form.host} onChange={(e) => set("host", e.target.value)} />

            <label>Port</label>
            <input type="number" value={form.port} onChange={(e) => set("port", Number(e.target.value))} style={{ width: 100 }} />

            <label>User</label>
            <input value={form.user} onChange={(e) => set("user", e.target.value)} />

            <label>Password</label>
            <input type="password" value={form.password} onChange={(e) => set("password", e.target.value)} />

            <label>Database</label>
            <input value={form.database ?? ""} onChange={(e) => set("database", e.target.value)} placeholder="(optional)" />
          </div>

          <div style={{ flex: 1 }} />

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
            <button className="btn-primary" onClick={handleConnect} disabled={loading}>
              {loading ? "Connecting…" : "Connect"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
