import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { CharsetInfo } from "../../types";

interface CreateDatabaseDialogProps {
  connectionId: string;
  onCreated: (dbName: string) => void;
  onClose: () => void;
}

export function CreateDatabaseDialog({ connectionId, onCreated, onClose }: CreateDatabaseDialogProps) {
  const [name, setName] = useState("");
  const [charsets, setCharsets] = useState<CharsetInfo[]>([]);
  const [charset, setCharset] = useState("utf8mb4");
  const [collations, setCollations] = useState<string[]>([]);
  const [collation, setCollation] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load charsets on mount
  useEffect(() => {
    invoke<CharsetInfo[]>("get_charsets", { connectionId })
      .then((list) => {
        setCharsets(list);
        const preferred = list.find((c) => c.charset === "utf8mb4") ?? list[0];
        if (preferred) {
          setCharset(preferred.charset);
          // Load collations for the initial charset
          invoke<string[]>("get_collations", { connectionId, charset: preferred.charset })
            .then((cols) => {
              setCollations(cols);
              setCollation(preferred.default_collation);
            })
            .catch(console.error);
        }
      })
      .catch(console.error);
  }, [connectionId]);

  // Reload collations when charset changes
  const handleCharsetChange = (newCharset: string) => {
    setCharset(newCharset);
    const info = charsets.find((c) => c.charset === newCharset);
    invoke<string[]>("get_collations", { connectionId, charset: newCharset })
      .then((cols) => {
        setCollations(cols);
        setCollation(info?.default_collation ?? cols[0] ?? "");
      })
      .catch(console.error);
  };

  const sqlPreview = `CREATE DATABASE \`${name}\` CHARACTER SET ${charset} COLLATE ${collation};`;

  const handleCreate = async () => {
    if (!name.trim()) return;
    setLoading(true);
    setError(null);
    try {
      await invoke("create_database", { connectionId, name: name.trim(), charset, collation });
      onCreated(name.trim());
    } catch (e) {
      setError(String(e));
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && name.trim() && !loading) handleCreate();
    if (e.key === "Escape") onClose();
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 200,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0,0,0,0.55)",
      }}
    >
      <div
        style={{
          background: "var(--bg-panel)",
          border: "1px solid var(--border)",
          borderRadius: 7,
          padding: "20px 22px",
          width: 480,
          display: "flex",
          flexDirection: "column",
          gap: 14,
          boxShadow: "0 12px 40px rgba(0,0,0,0.65)",
        }}
        onKeyDown={handleKeyDown}
      >
        {/* Title */}
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-bright)" }}>
          Create Database
        </div>

        {/* Database name */}
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <label style={{ fontSize: 11, color: "var(--text-muted)" }}>Database name</label>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="my_database"
            style={{
              fontSize: 13,
              padding: "5px 8px",
              background: "var(--bg-surface)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              color: "var(--text)",
              outline: "none",
              fontFamily: "'Consolas', 'SF Mono', 'Menlo', monospace",
            }}
          />
        </div>

        {/* Charset + Collation row */}
        <div style={{ display: "flex", gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 5 }}>
            <label style={{ fontSize: 11, color: "var(--text-muted)" }}>Character Set</label>
            <select
              value={charset}
              onChange={(e) => handleCharsetChange(e.target.value)}
              style={{
                width: "100%",
                fontSize: 12,
                padding: "5px 8px",
                background: "var(--bg-surface)",
                border: "1px solid var(--border)",
                borderRadius: 4,
                color: "var(--text)",
                outline: "none",
                appearance: "none",
                WebkitAppearance: "none",
                boxSizing: "border-box",
              }}
            >
              {charsets.map((c) => (
                <option key={c.charset} value={c.charset} style={{ background: "var(--bg-surface)", color: "var(--text)" }}>
                  {c.charset} — {c.description}
                </option>
              ))}
            </select>
          </div>

          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 5 }}>
            <label style={{ fontSize: 11, color: "var(--text-muted)" }}>Collation</label>
            <select
              value={collation}
              onChange={(e) => setCollation(e.target.value)}
              style={{
                width: "100%",
                fontSize: 12,
                padding: "5px 8px",
                background: "var(--bg-surface)",
                border: "1px solid var(--border)",
                borderRadius: 4,
                color: "var(--text)",
                outline: "none",
                appearance: "none",
                WebkitAppearance: "none",
                boxSizing: "border-box",
              }}
            >
              {collations.map((col) => (
                <option key={col} value={col} style={{ background: "var(--bg-surface)", color: "var(--text)" }}>
                  {col}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* SQL Preview */}
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <label style={{ fontSize: 11, color: "var(--text-muted)" }}>SQL Preview</label>
          <div
            style={{
              fontSize: 11,
              padding: "7px 10px",
              background: "var(--bg-surface)",
              border: "1px solid var(--border)",
              borderRadius: 4,
              color: "var(--text-muted)",
              fontFamily: "'Consolas', 'SF Mono', 'Menlo', monospace",
              userSelect: "text",
              wordBreak: "break-all",
            }}
          >
            {sqlPreview}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div
            style={{
              fontSize: 11,
              padding: "6px 10px",
              background: "rgba(240,72,72,0.1)",
              border: "1px solid rgba(240,72,72,0.3)",
              borderRadius: 4,
              color: "#f04848",
            }}
          >
            {error}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button className="btn-secondary" onClick={onClose} disabled={loading}>
            Cancel
          </button>
          <button
            className="btn-primary"
            onClick={handleCreate}
            disabled={!name.trim() || loading}
          >
            {loading ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}
