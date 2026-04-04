import { useQuery } from "@tanstack/react-query";
import { API_BASE } from "../lib/api";

export interface Backlink {
  source: string;
  sourceName: string;
  context: string;
}

export function useBacklinks(path: string | undefined) {
  return useQuery<{ path: string; backlinks: Backlink[] }>({
    queryKey: ["backlinks", path],
    queryFn: async () => {
      const encoded = path!.split("/").map(encodeURIComponent).join("/");
      const res = await fetch(`${API_BASE}/api/graph/backlinks/${encoded}`);
      if (!res.ok) throw new Error("Failed to fetch backlinks");
      return res.json();
    },
    enabled: !!path,
  });
}
