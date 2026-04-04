import { useState, useCallback } from "react";
import { Link, useLocation } from "react-router-dom";
import type { TreeNode } from "../../hooks/useVaultFiles";

interface FileTreeNodeProps {
  node: TreeNode;
  depth: number;
}

// Persist folder expand/collapse state in localStorage
function getExpanded(path: string, defaultValue: boolean): boolean {
  try {
    const stored = localStorage.getItem(`tree:${path}`);
    if (stored !== null) return stored === "1";
  } catch {}
  return defaultValue;
}

function setExpanded(path: string, value: boolean) {
  try {
    localStorage.setItem(`tree:${path}`, value ? "1" : "0");
  } catch {}
}

export default function FileTreeNode({ node, depth }: FileTreeNodeProps) {
  const [expanded, setExpandedState] = useState(() =>
    getExpanded(node.path, depth === 0),
  );
  const location = useLocation();

  const toggle = useCallback(() => {
    setExpandedState((prev) => {
      const next = !prev;
      setExpanded(node.path, next);
      return next;
    });
  }, [node.path]);

  // Encode each path segment individually to preserve slashes in the URL
  const notePath = `/note/${node.path.split("/").map(encodeURIComponent).join("/")}`;
  const isActive =
    node.type === "file" &&
    decodeURIComponent(location.pathname.replace(/^\/note\//, "")) === node.path;

  if (node.type === "directory") {
    return (
      <div className="tree-directory">
        <button
          className="tree-node tree-folder"
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
          onClick={toggle}
        >
          <span className="tree-chevron">{expanded ? "▾" : "▸"}</span>
          <span className="tree-name">{node.name}</span>
        </button>
        {expanded && node.children && (
          <div className="tree-children">
            {node.children.map((child) => (
              <FileTreeNode key={child.path} node={child} depth={depth + 1} />
            ))}
          </div>
        )}
      </div>
    );
  }

  // Strip .md extension for display
  const displayName = node.name.endsWith(".md")
    ? node.name.slice(0, -3)
    : node.name;

  return (
    <Link
      to={notePath}
      className={`tree-node tree-file ${isActive ? "tree-file-active" : ""}`}
      style={{ paddingLeft: `${depth * 16 + 8}px` }}
    >
      <span className="tree-name">{displayName}</span>
    </Link>
  );
}
