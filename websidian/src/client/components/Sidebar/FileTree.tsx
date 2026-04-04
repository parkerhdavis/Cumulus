import { useVaultFiles } from "../../hooks/useVaultFiles";
import FileTreeNode from "./FileTreeNode";

export default function FileTree() {
  const { data: tree, isLoading, error } = useVaultFiles();

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

  if (!tree?.children?.length) {
    return <div className="sidebar-placeholder">Vault is empty</div>;
  }

  return (
    <div className="file-tree">
      {tree.children.map((node) => (
        <FileTreeNode key={node.path} node={node} depth={0} />
      ))}
    </div>
  );
}
