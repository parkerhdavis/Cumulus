import { basename } from "node:path";
import type { ParsedNote, ResolveMap } from "./parser.js";

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

export interface Backlink {
  source: string;
  sourceName: string;
  context: string;
}

let graphData: GraphData = { nodes: [], edges: [] };
let backlinkIndex: Map<string, Backlink[]> = new Map();

/**
 * Build the link graph and backlink index from parsed notes.
 */
export function buildGraph(notes: ParsedNote[], resolveMap: ResolveMap): void {
  console.time("Graph");

  const notePaths = new Set(notes.map((n) => n.path));
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const backlinks = new Map<string, Backlink[]>();

  for (const note of notes) {
    nodes.push({
      id: note.path,
      name: note.title,
      tags: note.tags,
    });

    for (const link of note.wikilinks) {
      const key = link.toLowerCase();
      const targets = resolveMap[key];
      if (!targets) continue;

      // Use first matching target that is an actual note
      const target = targets.find((t) => notePaths.has(t));
      if (!target || target === note.path) continue;

      edges.push({ source: note.path, target });

      // Build backlink entry with context
      if (!backlinks.has(target)) backlinks.set(target, []);
      const context = extractLinkContext(note.content, link);
      backlinks.get(target)!.push({
        source: note.path,
        sourceName: basename(note.path, ".md"),
        context,
      });
    }
  }

  graphData = { nodes, edges };
  backlinkIndex = backlinks;

  console.timeEnd("Graph");
  console.log(`Graph: ${nodes.length} nodes, ${edges.length} edges`);
}

/**
 * Extract the line containing a wikilink for backlink context.
 */
function extractLinkContext(content: string, linkName: string): string {
  const lines = content.split("\n");
  for (const line of lines) {
    if (line.includes(`[[${linkName}`) || line.toLowerCase().includes(`[[${linkName.toLowerCase()}`)) {
      const trimmed = line.trim();
      if (trimmed.length > 150) return trimmed.slice(0, 150) + "...";
      return trimmed;
    }
  }
  return "";
}

export function getGraph(): GraphData {
  return graphData;
}

export function getBacklinks(path: string): Backlink[] {
  return backlinkIndex.get(path) ?? [];
}
