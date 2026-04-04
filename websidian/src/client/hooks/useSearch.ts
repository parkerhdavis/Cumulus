import { useQuery } from "@tanstack/react-query";
import { API_BASE } from "../lib/api";

export interface SearchResult {
  path: string;
  title: string;
  score: number;
  match: string;
}

export function useSearch(query: string) {
  return useQuery<{ results: SearchResult[] }>({
    queryKey: ["search", query],
    queryFn: async () => {
      const res = await fetch(
        `${API_BASE}/api/search?q=${encodeURIComponent(query)}`,
      );
      if (!res.ok) throw new Error("Search failed");
      return res.json();
    },
    enabled: query.length >= 2,
    staleTime: 30 * 1000,
  });
}
