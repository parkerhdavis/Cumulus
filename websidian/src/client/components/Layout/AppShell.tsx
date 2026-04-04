import { useState, useMemo } from "react";
import { Outlet } from "react-router-dom";
import FileTree from "../Sidebar/FileTree";
import QuickSwitcher from "../Sidebar/QuickSwitcher";
import { useKeyboardShortcuts } from "../../hooks/useKeyboardShortcuts";

export default function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [quickSwitcherOpen, setQuickSwitcherOpen] = useState(false);

  const shortcuts = useMemo(
    () => [
      { key: "k", meta: true, handler: () => setQuickSwitcherOpen(true) },
      { key: "o", meta: true, handler: () => setQuickSwitcherOpen(true) },
      { key: "\\", meta: true, handler: () => setSidebarOpen((v) => !v) },
    ],
    [],
  );
  useKeyboardShortcuts(shortcuts);

  return (
    <div className="app-shell">
      {sidebarOpen && (
        <aside className="sidebar">
          <div className="sidebar-header">
            <h2>Websidian</h2>
            <button
              className="sidebar-toggle"
              onClick={() => setSidebarOpen(false)}
              title="Close sidebar"
            >
              ✕
            </button>
          </div>
          <nav className="sidebar-nav">
            <FileTree />
          </nav>
        </aside>
      )}
      <div className="content-area">
        {!sidebarOpen && (
          <button
            className="sidebar-open-btn"
            onClick={() => setSidebarOpen(true)}
            title="Open sidebar"
          >
            ☰
          </button>
        )}
        <main className="content">
          <Outlet />
        </main>
      </div>
      <QuickSwitcher
        isOpen={quickSwitcherOpen}
        onClose={() => setQuickSwitcherOpen(false)}
      />
    </div>
  );
}
