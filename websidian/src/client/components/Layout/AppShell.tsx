import { useState, useMemo, useCallback } from "react";
import { Link, Outlet } from "react-router-dom";
import FileTree, { type SortMode } from "../Sidebar/FileTree";
import SidebarToolbar from "../Sidebar/SidebarToolbar";
import QuickSwitcher from "../Sidebar/QuickSwitcher";
import { useKeyboardShortcuts } from "../../hooks/useKeyboardShortcuts";

export default function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [quickSwitcherOpen, setQuickSwitcherOpen] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>("name-asc");
  const [autoReveal, setAutoReveal] = useState(false);
  // expandGeneration: even = collapsed, odd = expanded. Incrementing toggles.
  const [expandGeneration, setExpandGeneration] = useState(0);
  const allExpanded = expandGeneration % 2 === 1;

  const handleToggleExpandAll = useCallback(() => {
    setExpandGeneration((g) => g + 1);
  }, []);

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
          <div className="sidebar-actions">
            <button
              className="sidebar-action-btn"
              onClick={() => setQuickSwitcherOpen(true)}
              title="Search notes (Cmd+K)"
            >
              Search...
            </button>
            <Link to="/graph" className="sidebar-action-btn">
              Graph
            </Link>
          </div>
          <SidebarToolbar
            sortMode={sortMode}
            onSortChange={setSortMode}
            autoReveal={autoReveal}
            onAutoRevealToggle={() => setAutoReveal((v) => !v)}
            allExpanded={allExpanded}
            onToggleExpandAll={handleToggleExpandAll}
          />
          <nav className="sidebar-nav">
            <FileTree
              sortMode={sortMode}
              autoReveal={autoReveal}
              expandGeneration={expandGeneration}
            />
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
