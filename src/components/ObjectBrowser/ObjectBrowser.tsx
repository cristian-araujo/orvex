import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "../../store/useAppStore";

export function ObjectBrowser() {
  const {
    activeConnectionId,
    activeConnectionName,
    databases,
    expandedDbs,
    tables,
    selectedDatabase,
    setDatabases,
    toggleDb,
    setTables,
    setSelectedDatabase,
    addQueryTab,
  } = useAppStore();

  useEffect(() => {
    if (!activeConnectionId) return;
    invoke<string[]>("get_databases", { connectionId: activeConnectionId })
      .then(setDatabases)
      .catch(console.error);
  }, [activeConnectionId]);

  const handleDbClick = async (db: string) => {
    setSelectedDatabase(db);
    toggleDb(db);
    if (!expandedDbs.has(db) && !tables[db]) {
      try {
        const t = await invoke<{ name: string; table_type: string }[]>("get_tables", {
          connectionId: activeConnectionId,
          database: db,
        });
        setTables(db, t);
      } catch (e) {
        console.error(e);
      }
    }
  };

  const handleTableContextMenu = (e: React.MouseEvent, db: string, table: string) => {
    e.preventDefault();
    // Open data tab on double-click equivalent (right-click menu placeholder)
    openTableData(db, table);
  };

  const openTableData = (db: string, table: string) => {
    const sql = `SELECT * FROM \`${db}\`.\`${table}\` LIMIT 1000;`;
    addQueryTab(`${table}`, sql);
    setSelectedDatabase(db);
  };

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      height: "100%",
      background: "var(--bg-panel)",
      overflow: "hidden",
    }}>
      {/* Header */}
      <div style={{
        padding: "6px 10px",
        borderBottom: "1px solid var(--border)",
        fontSize: 11,
        color: "var(--text-muted)",
        letterSpacing: "0.05em",
        textTransform: "uppercase",
      }}>
        Object Browser
      </div>

      {/* Connection node */}
      {activeConnectionName && (
        <div style={{
          padding: "6px 10px",
          display: "flex",
          alignItems: "center",
          gap: 6,
          color: "var(--success)",
          fontSize: 12,
          borderBottom: "1px solid var(--border)",
        }}>
          <span>⬤</span>
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {activeConnectionName}
          </span>
        </div>
      )}

      {/* Tree */}
      <div style={{ flex: 1, overflowY: "auto", padding: "4px 0" }}>
        {databases.map((db) => (
          <div key={db}>
            {/* Database row */}
            <div
              onClick={() => handleDbClick(db)}
              style={{
                padding: "3px 8px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 5,
                background: selectedDatabase === db ? "var(--bg-selected)" : "transparent",
              }}
              onMouseEnter={(e) => {
                if (selectedDatabase !== db)
                  (e.currentTarget as HTMLDivElement).style.background = "var(--bg-hover)";
              }}
              onMouseLeave={(e) => {
                if (selectedDatabase !== db)
                  (e.currentTarget as HTMLDivElement).style.background = "transparent";
              }}
            >
              <span style={{ fontSize: 10, color: "var(--text-muted)", width: 12 }}>
                {expandedDbs.has(db) ? "▼" : "▶"}
              </span>
              <span style={{ color: "#e8c08c" }}>🗄</span>
              <span style={{ fontSize: 13 }}>{db}</span>
            </div>

            {/* Tables */}
            {expandedDbs.has(db) && (
              <div>
                {(tables[db] ?? []).map((t) => (
                  <div
                    key={t.name}
                    onDoubleClick={() => openTableData(db, t.name)}
                    onContextMenu={(e) => handleTableContextMenu(e, db, t.name)}
                    style={{
                      padding: "3px 8px 3px 30px",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: 5,
                    }}
                    onMouseEnter={(e) =>
                      ((e.currentTarget as HTMLDivElement).style.background = "var(--bg-hover)")
                    }
                    onMouseLeave={(e) =>
                      ((e.currentTarget as HTMLDivElement).style.background = "transparent")
                    }
                  >
                    <span style={{ color: t.table_type === "VIEW" ? "#9cdcfe" : "#4fc1ff" }}>
                      {t.table_type === "VIEW" ? "◈" : "▤"}
                    </span>
                    <span style={{ fontSize: 13 }}>{t.name}</span>
                  </div>
                ))}
                {tables[db] === undefined && (
                  <div style={{ padding: "3px 30px", color: "var(--text-muted)", fontSize: 12 }}>
                    Loading…
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
