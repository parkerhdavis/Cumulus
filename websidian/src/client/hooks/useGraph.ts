import { useQuery } from "@tanstack/react-query";
import { API_BASE } from "../lib/api";

export interface GraphNode {
  id: string;
  name: string;
  tags: string[];
}

export interface GraphEdge {
  source: string;
  target: string;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export function useGraph() {
  return useQuery<GraphData>({
    queryKey: ["graph"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/graph`);
      if (!res.ok) throw new Error("Failed to fetch graph");
      return res.json();
    },
    staleTime: Infinity,
  });
}
