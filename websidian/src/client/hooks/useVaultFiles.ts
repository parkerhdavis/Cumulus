import { useQuery } from "@tanstack/react-query";
import { API_BASE } from "../lib/api";

export interface TreeNode {
  name: string;
  type: "file" | "directory";
  path: string;
  modified?: string;
  size?: number;
  children?: TreeNode[];
}

export function useVaultFiles() {
  return useQuery<TreeNode>({
    queryKey: ["vault-tree"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/files/tree`);
      if (!res.ok) throw new Error("Failed to fetch vault tree");
      return res.json();
    },
    staleTime: 5 * 60 * 1000,
  });
}
