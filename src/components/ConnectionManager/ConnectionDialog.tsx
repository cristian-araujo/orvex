import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import { v4 as uuidv4 } from "uuid";
import { useShallow } from "zustand/react/shallow";
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
  const { savedConnections, sessions } = useAppStore(useShallow(s => ({
    savedConnections: s.savedConnections,
    sessions: s.sessions,
  })));
  const { setSavedConnections, createSession, setShowConnectionDialog } = useAppStore(useShallow(s => ({
    setSavedConnections: s.setSavedConnections,
    createSession: s.createSession,
    setShowConnectionDialog: s.setShowConnectionDialog,
  })));
  const [selected, setSelected] = useState<ConnectionProfile | null>(null);
  const [form, setForm] = useState<ConnectionConfig>(DEFAULT_CONFIG);
  const [name, setName] = useState("");
  const [activeTab, setActiveTab] = useState<DialogTab>("mysql");
  const [status, setStatus] = useState<{ msg: string; ok: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const testCancelledRef = useRef(false);
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [exportIncludePasswords, setExportIncludePasswords] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; profile: ConnectionProfile } | null>(null);

  useEffect(() => {
    invoke<ConnectionProfile[]>("get_saved_connections").then(setSavedConnections).catch(() => {});
  }, []);

  useEffect(() => {
    const handler = () => setContextMenu(null);
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
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
    setTesting(true);
    testCancelledRef.current = false;
    setStatus(null);
    try {
      const msg = await invoke<string>("test_connection", { config: { ...form, database: form.database || null } });
      if (!testCancelledRef.current) {
        setStatus({ msg, ok: true });
      }
    } catch (e) {
      if (!testCancelledRef.current) {
        setStatus({ msg: String(e), ok: false });
      }
    } finally {
      if (!testCancelledRef.current) {
        setTesting(false);
      }
    }
  };

  const handleCancelTest = () => {
    testCancelledRef.current = true;
    setTesting(false);
    setStatus({ msg: "Test cancelled", ok: false });
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

  const handleExport = async () => {
    if (savedConnections.length === 0) {
      setStatus({ msg: "No connections to export", ok: false });
      return;
    }
    const path = await save({
      defaultPath: "connections.json",
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (!path) return;
    const data = exportIncludePasswords
      ? savedConnections
      : savedConnections.map((p) => ({
          ...p,
          config: { ...p.config, password: "", ssh_password: "", ssh_passphrase: "" },
        }));
    try {
      await invoke("export_connections", { path, data: JSON.stringify(data, null, 2) });
      setStatus({ msg: `Exported ${savedConnections.length} connection(s)`, ok: true });
    } catch (e) {
      setStatus({ msg: String(e), ok: false });
    }
    setShowExportDialog(false);
    setExportIncludePasswords(false);
  };

  const handleDuplicate = async (profile: ConnectionProfile) => {
    const duplicate: ConnectionProfile = {
      id: uuidv4(),
      name: `${profile.name} (Copy)`,
      config: { ...profile.config },
    };
    await invoke("save_connection", { profile: duplicate });
    const updated = await invoke<ConnectionProfile[]>("get_saved_connections");
    setSavedConnections(updated);
    selectProfile(duplicate);
  };

  const handleImport = async () => {
    const path = await open({
      multiple: false,
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (!path) return;
    try {
      const imported = await invoke<ConnectionProfile[]>("import_connections", { path });
      let added = 0;
      for (const profile of imported) {
        // Assign new IDs to avoid collisions with existing connections
        const newProfile = { ...profile, id: uuidv4() };
        await invoke("save_connection", { profile: newProfile });
        added++;
      }
      const updated = await invoke<ConnectionProfile[]>("get_saved_connections");
      setSavedConnections(updated);
      setStatus({ msg: `Imported ${added} connection(s)`, ok: true });
    } catch (e) {
      setStatus({ msg: String(e), ok: false });
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
          ...(testing && { pointerEvents: "none" as const, opacity: 0.5 }),
        }}>
          <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--border)", color: "var(--text-muted)", fontSize: 11 }}>
            SAVED CONNECTIONS
          </div>
          <div style={{ flex: 1, overflowY: "auto" }}>
            {savedConnections.map((p) => (
              <div
                key={p.id}
                onClick={() => selectProfile(p)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  selectProfile(p);
                  setContextMenu({ x: e.clientX, y: e.clientY, profile: p });
                }}
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
          <div style={{ padding: 8, borderTop: "1px solid var(--border)", display: "flex", flexDirection: "column", gap: 4 }}>
            <button className="btn-secondary" style={{ width: "100%" }} onClick={newProfile}>
              + New Connection
            </button>
            <div style={{ display: "flex", gap: 4 }}>
              <button className="btn-secondary" style={{ flex: 1, fontSize: 11 }} onClick={handleImport}>
                Import
              </button>
              <button className="btn-secondary" style={{ flex: 1, fontSize: 11 }} onClick={() => setShowExportDialog(true)}>
                Export
              </button>
            </div>
          </div>
        </div>

        {/* Right: tabs + form */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          {/* Tab bar */}
          <div style={{ display: "flex", borderBottom: "1px solid var(--border)", background: "var(--bg-panel)", flexShrink: 0, ...(testing && { pointerEvents: "none" as const, opacity: 0.5 }) }}>
            {tabs.map((t) => (
              <button key={t.key} onClick={() => setActiveTab(t.key)} style={tabStyle(activeTab === t.key)}>
                {t.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div style={{ flex: 1, overflow: "auto", padding: 20, ...(testing && { pointerEvents: "none" as const, opacity: 0.5 }) }}>
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
              {testing ? (
                <>
                  <div style={{ flex: 1, fontSize: 12, color: "var(--text-muted)", alignSelf: "center" }}>
                    Testing connection...
                  </div>
                  <button className="btn-danger" onClick={handleCancelTest}>
                    Cancel Test
                  </button>
                </>
              ) : (
                <>
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
                </>
              )}
            </div>
          </div>
        </div>
      </div>
      {/* Connection context menu */}
      {contextMenu && (
        <div
          style={{
            position: "fixed",
            top: contextMenu.y,
            left: contextMenu.x,
            background: "var(--bg-panel)",
            border: "1px solid var(--border)",
            borderRadius: 4,
            padding: "4px 0",
            zIndex: 70,
            minWidth: 140,
            boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
          }}
        >
          <div
            style={{ padding: "6px 14px", fontSize: 12, cursor: "pointer", color: "var(--text)" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = "var(--bg-hover)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
            onClick={() => { handleDuplicate(contextMenu.profile); setContextMenu(null); }}
          >
            Duplicate
          </div>
          <div
            style={{ padding: "6px 14px", fontSize: 12, cursor: "pointer", color: "var(--danger)" }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = "var(--bg-hover)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = "transparent"; }}
            onClick={async () => {
              const id = contextMenu.profile.id;
              setContextMenu(null);
              await invoke("delete_connection", { id });
              const updated = await invoke<ConnectionProfile[]>("get_saved_connections");
              setSavedConnections(updated);
              if (selected?.id === id) newProfile();
            }}
          >
            Delete
          </div>
        </div>
      )}
      {/* Export dialog overlay */}
      {showExportDialog && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.5)",
            zIndex: 60,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          onClick={() => setShowExportDialog(false)}
          onKeyDown={(e) => { if (e.key === "Escape") setShowExportDialog(false); }}
        >
          <div
            style={{
              background: "var(--bg-panel)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              padding: 20,
              width: 340,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: "var(--text-bright)" }}>
              Export Connections
            </div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>
              {savedConnections.length} connection(s) will be exported.
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, cursor: "pointer", marginBottom: 16 }}>
              <input
                type="checkbox"
                checked={exportIncludePasswords}
                onChange={(e) => setExportIncludePasswords(e.target.checked)}
              />
              Include passwords
            </label>
            {!exportIncludePasswords && (
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 12, fontStyle: "italic" }}>
                Passwords, SSH passwords and passphrases will be cleared in the exported file.
              </div>
            )}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button className="btn-secondary" onClick={() => setShowExportDialog(false)}>Cancel</button>
              <button className="btn-primary" onClick={handleExport}>Export</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
