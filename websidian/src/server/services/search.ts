import MiniSearch from "minisearch";
import type { ParsedNote } from "./parser.js";

export interface SearchResult {
  path: string;
  title: string;
  score: number;
  match: string;
}

let searchIndex: MiniSearch | null = null;
let noteMap: Map<string, ParsedNote> = new Map();

/**
 * Build the MiniSearch index from parsed notes.
 */
export function buildSearchIndex(notes: ParsedNote[]): void {
  console.time("Search index");

  noteMap = new Map(notes.map((n) => [n.path, n]));

  searchIndex = new MiniSearch({
    fields: ["title", "content", "tags"],
    storeFields: ["path", "title"],
    searchOptions: {
      boost: { title: 3, tags: 2 },
      fuzzy: 0.2,
      prefix: true,
    },
  });

  searchIndex.addAll(
    notes.map((note) => ({
      id: note.path,
      path: note.path,
      title: note.title,
      content: note.content,
      tags: note.tags.join(" "),
    })),
  );

  console.timeEnd("Search index");
  console.log(`Search index: ${notes.length} documents`);
}

/**
 * Search the vault. Returns ranked results with context snippets.
 */
export function search(query: string, limit: number = 20): SearchResult[] {
  if (!searchIndex) return [];

  const results = searchIndex.search(query).slice(0, limit);

  return results.map((result) => {
    const note = noteMap.get(result.id);
    const snippet = note ? extractSnippet(note.content, query) : "";

    return {
      path: result.id,
      title: (result as any).title ?? result.id,
      score: result.score,
      match: snippet,
    };
  });
}

/**
 * Extract a context snippet around the first match of the query in content.
 */
function extractSnippet(content: string, query: string): string {
  const lower = content.toLowerCase();
  const queryLower = query.toLowerCase().split(/\s+/)[0]; // Use first word
  const idx = lower.indexOf(queryLower);

  if (idx === -1) {
    // No exact match — return start of content
    return content.slice(0, 120).trim() + (content.length > 120 ? "..." : "");
  }

  const start = Math.max(0, idx - 50);
  const end = Math.min(content.length, idx + queryLower.length + 70);
  let snippet = content.slice(start, end).trim();

  if (start > 0) snippet = "..." + snippet;
  if (end < content.length) snippet = snippet + "...";

  return snippet;
}
