import { useMemo } from "react";
import { useVaultFiles, type TreeNode } from "../../hooks/useVaultFiles";
import FileTreeNode from "./FileTreeNode";

export type SortMode =
  | "name-asc"
  | "name-desc"
  | "modified-asc"
  | "modified-desc"
  | "created-asc"
  | "created-desc";

interface FileTreeProps {
  sortMode: SortMode;
  autoReveal: boolean;
  expandGeneration: number;
}

function sortTree(node: TreeNode, mode: SortMode): TreeNode {
  if (!node.children) return node;

  const sorted = [...node.children].map((child) => sortTree(child, mode));

  sorted.sort((a, b) => {
    // Directories always first
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;

    switch (mode) {
      case "name-asc":
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      case "name-desc":
        return b.name.localeCompare(a.name, undefined, { sensitivity: "base" });
      case "modified-asc":
        return (a.modified ?? "").localeCompare(b.modified ?? "");
      case "modified-desc":
        return (b.modified ?? "").localeCompare(a.modified ?? "");
      case "created-asc":
        return (a.modified ?? "").localeCompare(b.modified ?? "");
      case "created-desc":
        return (b.modified ?? "").localeCompare(a.modified ?? "");
      default:
        return 0;
    }
  });

  return { ...node, children: sorted };
}

export default function FileTree({ sortMode, autoReveal, expandGeneration }: FileTreeProps) {
  const { data: tree, isLoading, error } = useVaultFiles();

  const sortedTree = useMemo(() => {
    if (!tree) return null;
    return sortTree(tree, sortMode);
  }, [tree, sortMode]);

  if (isLoading) {
    return <div className="sidebar-placeholder">Loading vault...</div>;
  }

  if (error) {
    return (
      <div className="sidebar-placeholder sidebar-error">
        Failed to load vault
      </div>
    );
  }

  if (!sortedTree?.children?.length) {
    return <div className="sidebar-placeholder">Vault is empty</div>;
  }

  return (
    <div className="file-tree">
      {sortedTree.children.map((node) => (
        <FileTreeNode
          key={node.path}
          node={node}
          depth={0}
          autoReveal={autoReveal}
          expandGeneration={expandGeneration}
        />
      ))}
    </div>
  );
}
