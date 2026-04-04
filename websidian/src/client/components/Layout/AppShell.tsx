import { Outlet } from "react-router-dom";

export default function AppShell() {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-header">
          <h2>Websidian</h2>
        </div>
        <nav className="sidebar-nav">
          <p className="sidebar-placeholder">File tree (coming soon)</p>
        </nav>
      </aside>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
