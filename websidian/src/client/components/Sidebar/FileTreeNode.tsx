import { useState, useEffect, useRef, useCallback } from "react";
import { Link, useLocation } from "react-router-dom";
import type { TreeNode } from "../../hooks/useVaultFiles";

interface FileTreeNodeProps {
  node: TreeNode;
  depth: number;
  autoReveal: boolean;
  expandGeneration: number;
}

// Persist folder expand/collapse state in localStorage
function getStoredExpanded(path: string, defaultValue: boolean): boolean {
  try {
    const stored = localStorage.getItem(`tree:${path}`);
    if (stored !== null) return stored === "1";
  } catch {}
  return defaultValue;
}

function setStoredExpanded(path: string, value: boolean) {
  try {
    localStorage.setItem(`tree:${path}`, value ? "1" : "0");
  } catch {}
}

export default function FileTreeNode({
  node,
  depth,
  autoReveal,
  expandGeneration,
}: FileTreeNodeProps) {
  const [expanded, setExpanded] = useState(() =>
    getStoredExpanded(node.path, depth === 0),
  );
  const location = useLocation();
  const nodeRef = useRef<HTMLAnchorElement>(null);

  const currentNotePath = decodeURIComponent(
    location.pathname.replace(/^\/note\//, ""),
  );

  const isActive = node.type === "file" && currentNotePath === node.path;

  // Check if this directory is an ancestor of the current note
  const isAncestorOfActive =
    node.type === "directory" && currentNotePath.startsWith(node.path + "/");

  // Respond to expand/collapse all (expandGeneration changes)
  // Even values = collapse all, odd values = expand all
  const lastGenRef = useRef(expandGeneration);
  useEffect(() => {
    if (expandGeneration === lastGenRef.current) return;
    lastGenRef.current = expandGeneration;

    if (node.type === "directory") {
      const shouldExpand = expandGeneration % 2 === 1;
      setExpanded(shouldExpand);
      setStoredExpanded(node.path, shouldExpand);
    }
  }, [expandGeneration, node.type, node.path]);

  // Auto-reveal: expand parent folders and scroll active file into view
  useEffect(() => {
    if (!autoReveal) return;

    if (isAncestorOfActive && !expanded) {
      setExpanded(true);
      setStoredExpanded(node.path, true);
    }

    if (isActive && nodeRef.current) {
      nodeRef.current.scrollIntoView({ block: "nearest" });
    }
  }, [autoReveal, isActive, isAncestorOfActive, expanded, currentNotePath]);

  const toggle = useCallback(() => {
    setExpanded((prev) => {
      const next = !prev;
      setStoredExpanded(node.path, next);
      return next;
    });
  }, [node.path]);

  // Encode each path segment individually to preserve slashes in the URL
  const notePath = `/note/${node.path.split("/").map(encodeURIComponent).join("/")}`;

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
              <FileTreeNode
                key={child.path}
                node={child}
                depth={depth + 1}
                autoReveal={autoReveal}
                expandGeneration={expandGeneration}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // Strip known extensions for display
  const displayName = node.name.replace(/\.(md|base|canvas)$/, "");

  return (
    <Link
      ref={nodeRef}
      to={notePath}
      className={`tree-node tree-file ${isActive ? "tree-file-active" : ""}`}
      style={{ paddingLeft: `${depth * 16 + 8}px` }}
    >
      <span className="tree-name">{displayName}</span>
    </Link>
  );
}
