import { useState, useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useAppStore } from "../../store/useAppStore";
import type { ConnectionSession } from "../../types";

interface TabContextMenu {
  x: number;
  y: number;
  sessionId: string;
}

interface SortableTabProps {
  session: ConnectionSession;
  isActive: boolean;
  isSessionReconnecting: boolean;
  onSwitch: (id: string) => void;
  onReconnect: (id: string) => void;
  onClose: (id: string) => void;
  onContextMenu: (e: React.MouseEvent, id: string) => void;
}

function SortableTab({
  session,
  isActive,
  isSessionReconnecting,
  onSwitch,
  onReconnect,
  onClose,
  onContextMenu,
}: SortableTabProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: session.id,
  });

  const isConnected = !!session.connectionId;

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={() => onSwitch(session.id)}
      onDoubleClick={() => { if (!isConnected && !isSessionReconnecting) onReconnect(session.id); }}
      onContextMenu={(e) => onContextMenu(e, session.id)}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "0 12px",
        height: "100%",
        cursor: isDragging ? "grabbing" : "pointer",
        whiteSpace: "nowrap",
        fontSize: 12,
        background: isActive ? "var(--bg-surface)" : "transparent",
        color: isActive ? "var(--text-bright)" : "var(--text-muted)",
        borderBottom: isActive ? "2px solid var(--accent)" : "2px solid transparent",
        borderRight: "1px solid var(--border)",
        opacity: isDragging ? 0.5 : 1,
        transform: CSS.Transform.toString(transform),
        transition,
        userSelect: "none",
      }}
      onMouseEnter={(e) => {
        if (!isActive && !isDragging) (e.currentTarget as HTMLDivElement).style.background = "var(--bg-hover)";
      }}
      onMouseLeave={(e) => {
        if (!isActive) (e.currentTarget as HTMLDivElement).style.background = "transparent";
      }}
      title={!isConnected ? "Disconnected — double-click or right-click to reconnect" : `${session.connectionName} — right-click to reconnect`}
    >
      <span style={{ color: isSessionReconnecting ? "var(--warning)" : isConnected ? "var(--success)" : "var(--danger)", fontSize: 8 }}>
        {isSessionReconnecting ? "◌" : "⬤"}
      </span>
      <span>{session.connectionName}</span>
      <span
        onClick={(e) => { e.stopPropagation(); onClose(session.id); }}
        style={{
          marginLeft: 4,
          opacity: 0.5,
          fontSize: 10,
          lineHeight: 1,
          padding: "1px 3px",
          borderRadius: 2,
        }}
        onMouseEnter={(e) => ((e.currentTarget as HTMLSpanElement).style.opacity = "1")}
        onMouseLeave={(e) => ((e.currentTarget as HTMLSpanElement).style.opacity = "0.5")}
      >
        ✕
      </span>
    </div>
  );
}

export function ConnectionTabs() {
  const { sessions, activeSessionId } = useAppStore(useShallow(s => ({
    sessions: s.sessions,
    activeSessionId: s.activeSessionId,
  })));
  const { switchSession, closeSession, setShowConnectionDialog, setShowColorEditor, reorderSessions } = useAppStore(useShallow(s => ({
    switchSession: s.switchSession,
    closeSession: s.closeSession,
    setShowConnectionDialog: s.setShowConnectionDialog,
    setShowColorEditor: s.setShowColorEditor,
    reorderSessions: s.reorderSessions,
  })));
  const reconnectingSessionId = useAppStore(s => s.reconnectingSessionId);
  const reconnectSession = useAppStore(s => s.reconnectSession);
  const [contextMenu, setContextMenu] = useState<TabContextMenu | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } })
  );

  useEffect(() => {
    const handler = () => setContextMenu(null);
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
  }, []);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      reorderSessions(String(active.id), String(over.id));
    }
  };

  const handleTabContextMenu = (e: React.MouseEvent, sessionId: string) => {
    e.preventDefault();
    e.stopPropagation();
    switchSession(sessionId);
    setContextMenu({ x: e.clientX, y: e.clientY, sessionId });
  };

  if (sessions.length === 0) return null;

  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          background: "var(--bg-panel)",
          borderBottom: "1px solid var(--border)",
          height: 32,
          flexShrink: 0,
          overflowX: "auto",
        }}
      >
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={sessions.map(s => s.id)} strategy={horizontalListSortingStrategy}>
            {sessions.map((session) => (
              <SortableTab
                key={session.id}
                session={session}
                isActive={session.id === activeSessionId}
                isSessionReconnecting={reconnectingSessionId === session.id}
                onSwitch={switchSession}
                onReconnect={reconnectSession}
                onClose={closeSession}
                onContextMenu={handleTabContextMenu}
              />
            ))}
          </SortableContext>
        </DndContext>
        <button
          onClick={() => setShowConnectionDialog(true)}
          style={{
            background: "transparent",
            border: "none",
            color: "var(--text-muted)",
            padding: "0 10px",
            height: "100%",
            fontSize: 16,
            cursor: "pointer",
            flexShrink: 0,
          }}
          title="New Connection"
        >
          +
        </button>
      </div>

      {/* Connection tab context menu */}
      {contextMenu && (
        <div
          style={{
            position: "fixed",
            top: contextMenu.y,
            left: contextMenu.x,
            background: "var(--bg-surface)",
            border: "1px solid var(--border)",
            borderRadius: 4,
            zIndex: 1000,
            minWidth: 160,
            boxShadow: "0 4px 12px rgba(0,0,0,0.4)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {(() => {
            const ctxSession = sessions.find((s) => s.id === contextMenu.sessionId);
            const ctxConnected = !!ctxSession?.connectionId;
            return (
              <>
                <div
                  onClick={() => { reconnectSession(contextMenu.sessionId); setContextMenu(null); }}
                  style={{ padding: "7px 14px", cursor: "pointer", fontSize: 12, whiteSpace: "nowrap", color: "var(--success)" }}
                  onMouseEnter={(e) => ((e.currentTarget as HTMLDivElement).style.background = "var(--bg-hover)")}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLDivElement).style.background = "transparent")}
                >
                  Reconnect
                </div>
                <div
                  onClick={() => { setShowColorEditor(true); setContextMenu(null); }}
                  style={{ padding: "7px 14px", cursor: "pointer", fontSize: 12, whiteSpace: "nowrap" }}
                  onMouseEnter={(e) => ((e.currentTarget as HTMLDivElement).style.background = "var(--bg-hover)")}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLDivElement).style.background = "transparent")}
                >
                  Change Colors...
                </div>
                <div
                  onClick={() => { closeSession(contextMenu.sessionId); setContextMenu(null); }}
                  style={{ padding: "7px 14px", cursor: "pointer", fontSize: 12, whiteSpace: "nowrap", color: "var(--danger)" }}
                  onMouseEnter={(e) => ((e.currentTarget as HTMLDivElement).style.background = "var(--bg-hover)")}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLDivElement).style.background = "transparent")}
                >
                  {ctxConnected ? "Disconnect" : "Close"}
                </div>
              </>
            );
          })()}
        </div>
      )}
    </>
  );
}
