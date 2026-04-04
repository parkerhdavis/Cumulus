import { useQuery } from "@tanstack/react-query";
import { API_BASE } from "../lib/api";
import type { ResolveMap } from "../lib/markdown";

export function useResolveMap() {
  return useQuery<ResolveMap>({
    queryKey: ["resolve-map"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/files/resolve-map`);
      if (!res.ok) throw new Error("Failed to fetch resolve map");
      return res.json();
    },
    staleTime: Infinity,
  });
}
