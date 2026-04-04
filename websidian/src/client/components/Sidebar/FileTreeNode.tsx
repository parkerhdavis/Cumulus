import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import type { TreeNode } from "../../hooks/useVaultFiles";

interface FileTreeNodeProps {
  node: TreeNode;
  depth: number;
}

export default function FileTreeNode({ node, depth }: FileTreeNodeProps) {
  const [expanded, setExpanded] = useState(depth === 0);
  const location = useLocation();

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
          onClick={() => setExpanded(!expanded)}
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
      <span className="tree-icon">📄</span>
      <span className="tree-name">{displayName}</span>
    </Link>
  );
}
