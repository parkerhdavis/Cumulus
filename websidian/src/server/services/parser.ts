import { extname, basename } from "node:path";
import matter from "gray-matter";
import { listAllMarkdownFiles, resolveVaultPath } from "./vault.js";

export interface ParsedNote {
  path: string;
  title: string;
  content: string;
  frontmatter: Record<string, unknown>;
  wikilinks: string[];
  tags: string[];
}

export interface ResolveMap {
  [lowerName: string]: string[];
}

const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;

/**
 * Extract wikilink targets from markdown content.
 * Handles [[Page]], [[Page|Label]], [[Page#Section]], ![[Embed]].
 */
function extractWikilinks(content: string): string[] {
  const links: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = WIKILINK_RE.exec(content)) !== null) {
    let target = match[1];
    // Remove display text: [[Page|Label]] → Page
    const pipeIndex = target.indexOf("|");
    if (pipeIndex !== -1) target = target.substring(0, pipeIndex);
    // Remove section: [[Page#Section]] → Page
    const hashIndex = target.indexOf("#");
    if (hashIndex !== -1) target = target.substring(0, hashIndex);
    // Remove embed prefix: ![[Page]] → Page (the ! is before [[)
    target = target.trim();
    if (target) links.push(target);
  }
  return [...new Set(links)];
}

/**
 * Extract tags from frontmatter.
 */
function extractTags(frontmatter: Record<string, unknown>): string[] {
  const tags = frontmatter.tags;
  if (Array.isArray(tags)) return tags.map(String);
  if (typeof tags === "string") return tags.split(",").map((t) => t.trim()).filter(Boolean);
  return [];
}

/**
 * Scan all markdown files and return parsed metadata.
 */
export async function parseAllNotes(): Promise<ParsedNote[]> {
  const files = await listAllMarkdownFiles();
  console.log(`Parsing ${files.length} markdown files...`);
  const startTime = performance.now();

  const CONCURRENCY = 50;
  const results: ParsedNote[] = [];

  for (let i = 0; i < files.length; i += CONCURRENCY) {
    const batch = files.slice(i, i + CONCURRENCY);
    const parsed = await Promise.all(
      batch.map(async (filePath) => {
        try {
          const fullPath = resolveVaultPath(filePath);
          const raw = await Bun.file(fullPath).text();
          const { data, content } = matter(raw);
          const name = basename(filePath, ".md");

          return {
            path: filePath,
            title: name,
            content,
            frontmatter: data,
            wikilinks: extractWikilinks(content),
            tags: extractTags(data),
          };
        } catch {
          return null;
        }
      }),
    );
    for (const p of parsed) {
      if (p) results.push(p);
    }
  }

  const elapsed = (performance.now() - startTime).toFixed(0);
  console.log(`Parsed ${results.length} notes in ${elapsed}ms`);
  return results;
}

/**
 * Build a resolve map from parsed notes.
 * Maps lowercase filename (without .md) → array of full paths.
 * Also maps aliases from frontmatter.
 */
export function buildResolveMap(notes: ParsedNote[]): ResolveMap {
  const map: ResolveMap = {};

  for (const note of notes) {
    const name = basename(note.path, ".md").toLowerCase();
    if (!map[name]) map[name] = [];
    map[name].push(note.path);

    // Index aliases
    const aliases = note.frontmatter.aliases;
    if (Array.isArray(aliases)) {
      for (const alias of aliases) {
        const key = String(alias).toLowerCase();
        if (!map[key]) map[key] = [];
        map[key].push(note.path);
      }
    }
  }

  // Also index all files (including non-markdown) for image resolution
  return map;
}

/**
 * Build a resolve map that also includes binary files (images, etc.)
 * so ![[image.png]] can resolve correctly.
 */
export async function buildFullResolveMap(notes: ParsedNote[]): Promise<ResolveMap> {
  const map = buildResolveMap(notes);

  // Walk the vault to find all non-markdown files too
  const { readdir } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { getVaultPath } = await import("./vault.js");
  const vaultPath = getVaultPath();

  const HIDE = new Set(
    (process.env.HIDE_FOLDERS ?? ".obsidian,.git,.trash,.stversions,.stfolder,.claude")
      .split(",")
      .map((s) => s.trim()),
  );

  async function walkBinaries(dirPath: string, relDir: string) {
    const entries = await readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (HIDE.has(entry.name)) continue;
      const fullPath = join(dirPath, entry.name);
      const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walkBinaries(fullPath, relPath);
      } else if (!entry.name.endsWith(".md")) {
        const key = entry.name.toLowerCase();
        if (!map[key]) map[key] = [];
        map[key].push(relPath);
      }
    }
  }

  await walkBinaries(vaultPath, "");
  return map;
}
