interface MenuItem {
  icon: React.ReactNode;
  label: string;
  action: () => void;
  variant?: "default" | "warning" | "danger";
}

interface ContextMenuGroup {
  items: MenuItem[];
}

interface ContextMenuProps {
  x: number;
  y: number;
  entityType: "database" | "table" | "connection";
  entityName: string;
  groups: ContextMenuGroup[];
}

export type { MenuItem, ContextMenuGroup };

export function ContextMenu({ x, y, entityType, entityName, groups }: ContextMenuProps) {
  const entityColor =
    entityType === "database" ? "#e8c08c" :
    entityType === "table" ? "#4fc1ff" :
    "var(--success)";

  return (
    <>
      <style>{`
        @keyframes _cm_appear {
          from { opacity: 0; transform: translateY(-5px) scale(0.975); }
          to   { opacity: 1; transform: translateY(0)    scale(1);     }
        }
        ._cm_item {
          display: flex;
          align-items: center;
          gap: 9px;
          padding: 5px 14px 5px 10px;
          cursor: pointer;
          font-size: 12.5px;
          color: var(--text);
          white-space: nowrap;
          transition: background 70ms, color 70ms;
          border-left: 2px solid transparent;
          min-height: 27px;
          user-select: none;
        }
        ._cm_item:hover {
          background: rgba(255,255,255,0.055);
          border-left-color: var(--accent);
        }
        ._cm_item[data-v="warning"]:hover {
          color: #e8a030;
          background: rgba(232,160,48,0.07);
          border-left-color: #e8a030;
        }
        ._cm_item[data-v="danger"]:hover {
          color: #f04848;
          background: rgba(240,72,72,0.07);
          border-left-color: #f04848;
        }
        ._cm_item svg { flex-shrink: 0; opacity: 0.55; transition: opacity 70ms; }
        ._cm_item:hover svg { opacity: 0.9; }
      `}</style>

      <div
        style={{
          position: "fixed",
          top: y,
          left: x,
          zIndex: 1000,
          background: "#1b1b1b",
          border: "1px solid rgba(255,255,255,0.09)",
          borderRadius: 6,
          minWidth: 220,
          overflow: "hidden",
          boxShadow: "0 8px 30px rgba(0,0,0,0.7), 0 2px 6px rgba(0,0,0,0.35)",
          animation: "_cm_appear 0.11s cubic-bezier(0.2, 0, 0.13, 1)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Entity header */}
        <div
          style={{
            padding: "6px 10px",
            borderBottom: "1px solid rgba(255,255,255,0.07)",
            background: "rgba(255,255,255,0.025)",
            display: "flex",
            alignItems: "center",
            gap: 7,
          }}
        >
          <span style={{ fontSize: 12, lineHeight: 1, opacity: 0.8 }}>
            {entityType === "database" ? "🗄" : entityType === "table" ? "▤" : "⚡"}
          </span>
          <span
            style={{
              fontFamily: "'Consolas', 'SF Mono', 'Menlo', monospace",
              fontSize: 11,
              color: entityColor,
              letterSpacing: "0.02em",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: 185,
              lineHeight: 1,
            }}
          >
            {entityName}
          </span>
        </div>

        {/* Item groups */}
        <div style={{ padding: "3px 0" }}>
          {groups.map((group, gi) => (
            <div key={gi}>
              {gi > 0 && (
                <div style={{ height: 1, background: "rgba(255,255,255,0.07)", margin: "3px 0" }} />
              )}
              {group.items.map((item) => (
                <div
                  key={item.label}
                  className="_cm_item"
                  data-v={item.variant ?? "default"}
                  onClick={item.action}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

// ─── SVG Icons ───────────────────────────────────────────────────────────────

export function IconRefresh() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <path d="M11.5 6.5a5 5 0 1 1-1.46-3.54" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      <path d="M10.5 1.5v2.5H8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

export function IconQuery() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <path d="M2.5 4.5L5.5 6.5L2.5 8.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
      <line x1="7" y1="8.5" x2="10.5" y2="8.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  );
}

export function IconExport() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <path d="M6.5 8V2M4.5 4L6.5 2L8.5 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M2.5 9.5V11H10.5V9.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

export function IconImport() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <path d="M6.5 2v6M8.5 6L6.5 8L4.5 6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M2.5 9.5V11H10.5V9.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

export function IconCopy() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <path d="M1.5 5.5V11.5H7.5V5.5H1.5Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
      <path d="M5.5 5.5V1.5H11.5V7.5H7.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

export function IconOpenTable() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <rect x="1.5" y="1.5" width="10" height="10" rx="1" stroke="currentColor" strokeWidth="1.2"/>
      <line x1="1.5" y1="4.8" x2="11.5" y2="4.8" stroke="currentColor" strokeWidth="1.2"/>
      <line x1="5" y1="4.8" x2="5" y2="11.5" stroke="currentColor" strokeWidth="1.2"/>
    </svg>
  );
}

export function IconSelectRows() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <line x1="2" y1="3.5" x2="9" y2="3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      <line x1="2" y1="6.5" x2="9" y2="6.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      <line x1="2" y1="9.5" x2="5.5" y2="9.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      <path d="M8.5 8l2.5 1.5L8.5 11" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

export function IconTruncate() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <line x1="2" y1="4" x2="11" y2="4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      <line x1="2" y1="7" x2="7" y2="7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      <line x1="2" y1="10" x2="5" y2="10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      <line x1="8.5" y1="7.5" x2="11.5" y2="10.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      <line x1="11.5" y1="7.5" x2="8.5" y2="10.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
    </svg>
  );
}

export function IconTrash() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <line x1="2" y1="3.5" x2="11" y2="3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
      <path d="M4.5 3.5V2H8.5V3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
      <path d="M3.5 3.5L4.2 11H8.8L9.5 3.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
      <line x1="6.5" y1="5.5" x2="6.5" y2="9" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round"/>
    </svg>
  );
}

export function IconDatabase() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
      <ellipse cx="6.5" cy="3.5" rx="4" ry="1.5" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M2.5 3.5v6c0 .83 1.79 1.5 4 1.5s4-.67 4-1.5v-6" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M2.5 6.5c0 .83 1.79 1.5 4 1.5s4-.67 4-1.5" stroke="currentColor" strokeWidth="1.2"/>
    </svg>
  );
}
