import { useState, useRef, useEffect } from "react";
import type { SortMode } from "./FileTree";

interface SidebarToolbarProps {
  sortMode: SortMode;
  onSortChange: (mode: SortMode) => void;
  autoReveal: boolean;
  onAutoRevealToggle: () => void;
  allExpanded: boolean;
  onToggleExpandAll: () => void;
}

const SORT_OPTIONS: { label: string; value: SortMode | null }[] = [
  { label: "File name (A to Z)", value: "name-asc" },
  { label: "File name (Z to A)", value: "name-desc" },
  { label: "---", value: null },
  { label: "Modified time (new to old)", value: "modified-desc" },
  { label: "Modified time (old to new)", value: "modified-asc" },
  { label: "---", value: null },
  { label: "Created time (new to old)", value: "created-desc" },
  { label: "Created time (old to new)", value: "created-asc" },
];

export default function SidebarToolbar({
  sortMode,
  onSortChange,
  autoReveal,
  onAutoRevealToggle,
  allExpanded,
  onToggleExpandAll,
}: SidebarToolbarProps) {
  const [sortOpen, setSortOpen] = useState(false);
  const sortRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!sortOpen) return;
    function handleClick(e: MouseEvent) {
      if (sortRef.current && !sortRef.current.contains(e.target as Node)) {
        setSortOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [sortOpen]);

  return (
    <div className="sidebar-toolbar">
      <button
        className="toolbar-btn"
        title="New note (coming soon)"
        onClick={() => alert("Edit functionality coming in a future update.")}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="12" y1="18" x2="12" y2="12" />
          <line x1="9" y1="15" x2="15" y2="15" />
        </svg>
      </button>

      <button
        className="toolbar-btn"
        title="New folder (coming soon)"
        onClick={() => alert("Edit functionality coming in a future update.")}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          <line x1="12" y1="11" x2="12" y2="17" />
          <line x1="9" y1="14" x2="15" y2="14" />
        </svg>
      </button>

      <div className="toolbar-sort-wrapper" ref={sortRef}>
        <button
          className="toolbar-btn"
          title="Sort files"
          onClick={() => setSortOpen(!sortOpen)}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="4" y1="6" x2="16" y2="6" />
            <line x1="4" y1="12" x2="13" y2="12" />
            <line x1="4" y1="18" x2="10" y2="18" />
            <path d="M18 9l3 3-3 3" />
          </svg>
        </button>
        {sortOpen && (
          <div className="toolbar-sort-dropdown">
            {SORT_OPTIONS.map((opt, i) =>
              opt.value === null ? (
                <div key={i} className="toolbar-sort-divider" />
              ) : (
                <button
                  key={opt.value}
                  className={`toolbar-sort-option ${sortMode === opt.value ? "toolbar-sort-option-active" : ""}`}
                  onClick={() => {
                    onSortChange(opt.value!);
                    setSortOpen(false);
                  }}
                >
                  {opt.label}
                </button>
              ),
            )}
          </div>
        )}
      </div>

      <button
        className={`toolbar-btn ${autoReveal ? "toolbar-btn-active" : ""}`}
        title="Auto-reveal current file"
        onClick={onAutoRevealToggle}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="8" />
          <line x1="21" y1="21" x2="16.65" y2="16.65" />
          <line x1="11" y1="8" x2="11" y2="14" />
          <line x1="8" y1="11" x2="14" y2="11" />
        </svg>
      </button>

      <button
        className="toolbar-btn"
        title={allExpanded ? "Collapse all" : "Expand all"}
        onClick={onToggleExpandAll}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          {allExpanded ? (
            <>
              <polyline points="4 14 10 14 10 20" />
              <polyline points="20 10 14 10 14 4" />
              <line x1="14" y1="10" x2="21" y2="3" />
              <line x1="3" y1="21" x2="10" y2="14" />
            </>
          ) : (
            <>
              <polyline points="15 3 21 3 21 9" />
              <polyline points="9 21 3 21 3 15" />
              <line x1="21" y1="3" x2="14" y2="10" />
              <line x1="3" y1="21" x2="10" y2="14" />
            </>
          )}
        </svg>
      </button>
    </div>
  );
}
