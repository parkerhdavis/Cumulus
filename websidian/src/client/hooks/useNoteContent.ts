import { useQuery } from "@tanstack/react-query";
import { API_BASE } from "../lib/api";

export interface NoteContent {
  path: string;
  content: string;
  frontmatter: Record<string, unknown>;
  modified: string;
}

export function useNoteContent(path: string | undefined) {
  return useQuery<NoteContent>({
    queryKey: ["note", path],
    queryFn: async () => {
      // Encode each segment individually to preserve slashes
      const encoded = path!.split("/").map(encodeURIComponent).join("/");
      const res = await fetch(`${API_BASE}/api/files/${encoded}`);
      if (!res.ok) throw new Error("Failed to fetch note");
      return res.json();
    },
    enabled: !!path,
  });
}
