import { useState } from "react";
import { Outlet } from "react-router-dom";
import FileTree from "../Sidebar/FileTree";

export default function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(true);

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
    </div>
  );
}
