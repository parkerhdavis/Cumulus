import { readdir, stat } from "node:fs/promises";
import { join, resolve, relative, extname } from "node:path";
import matter from "gray-matter";

export interface TreeNode {
  name: string;
  type: "file" | "directory";
  path: string;
  modified?: string;
  size?: number;
  children?: TreeNode[];
}

export interface FileContent {
  path: string;
  content: string;
  frontmatter: Record<string, unknown>;
  modified: string;
}

const VAULT_PATH = resolve(process.env.VAULT_PATH ?? "./vault");
const HIDE_FOLDERS = new Set(
  (process.env.HIDE_FOLDERS ?? ".obsidian,.git,.trash,.stversions,.stfolder,.claude,.venv")
    .split(",")
    .map((s) => s.trim()),
);

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".pdf": "application/pdf",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

/** File extensions that are structured data (not markdown, not binary). */
const STRUCTURED_EXTENSIONS = new Set([".base", ".canvas"]);

let cachedTree: TreeNode | null = null;

/**
 * Resolve a vault-relative path and verify it doesn't escape the vault root.
 */
export function resolveVaultPath(relativePath: string): string {
  const resolved = resolve(VAULT_PATH, relativePath);
  if (!resolved.startsWith(VAULT_PATH)) {
    throw new Error("Path traversal detected");
  }
  return resolved;
}

/**
 * Recursively build the directory tree for the vault.
 */
async function buildTree(dirPath: string, relDir: string): Promise<TreeNode[]> {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const nodes: TreeNode[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".") && HIDE_FOLDERS.has(entry.name)) continue;
    if (HIDE_FOLDERS.has(entry.name)) continue;

    const fullPath = join(dirPath, entry.name);
    const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      const children = await buildTree(fullPath, relPath);
      nodes.push({
        name: entry.name,
        type: "directory",
        path: relPath,
        children,
      });
    } else {
      try {
        const fileStat = await stat(fullPath);
        nodes.push({
          name: entry.name,
          type: "file",
          path: relPath,
          modified: fileStat.mtime.toISOString(),
          size: fileStat.size,
        });
      } catch {
        // Skip broken symlinks or unreadable files
      }
    }
  }

  // Sort: directories first, then alphabetically
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  });

  return nodes;
}

/**
 * Get the full vault directory tree. Cached after first call.
 */
export async function getTree(): Promise<TreeNode> {
  if (cachedTree) return cachedTree;

  const children = await buildTree(VAULT_PATH, "");
  cachedTree = {
    name: "vault",
    type: "directory",
    path: "",
    children,
  };
  return cachedTree;
}

/**
 * Invalidate the cached tree (call when files change).
 */
export function invalidateTreeCache(): void {
  cachedTree = null;
}

/**
 * Read a markdown file, parsing frontmatter and returning structured content.
 */
export async function getMarkdownContent(relativePath: string): Promise<FileContent> {
  const fullPath = resolveVaultPath(relativePath);
  const fileStat = await stat(fullPath);
  const raw = await Bun.file(fullPath).text();
  const { data, content } = matter(raw);

  return {
    path: relativePath,
    content,
    frontmatter: data,
    modified: fileStat.mtime.toISOString(),
  };
}

/**
 * Read a binary file and return it with the appropriate MIME type.
 */
export async function getBinaryFile(relativePath: string): Promise<{ data: ArrayBuffer; mimeType: string }> {
  const fullPath = resolveVaultPath(relativePath);
  const ext = extname(fullPath).toLowerCase();
  const mimeType = MIME_TYPES[ext] ?? "application/octet-stream";
  const data = await Bun.file(fullPath).arrayBuffer();
  return { data, mimeType };
}

/**
 * Get a flat list of all markdown file paths in the vault.
 */
export async function listAllMarkdownFiles(): Promise<string[]> {
  const files: string[] = [];

  async function walk(dirPath: string, relDir: string) {
    const entries = await readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (HIDE_FOLDERS.has(entry.name)) continue;
      const fullPath = join(dirPath, entry.name);
      const relPath = relDir ? `${relDir}/${entry.name}` : entry.name;

      if (entry.isDirectory()) {
        await walk(fullPath, relPath);
      } else if (entry.name.endsWith(".md")) {
        files.push(relPath);
      }
    }
  }

  await walk(VAULT_PATH, "");
  return files;
}

/**
 * Check if the vault path exists and is accessible.
 */
export async function validateVault(): Promise<void> {
  try {
    const s = await stat(VAULT_PATH);
    if (!s.isDirectory()) {
      throw new Error(`VAULT_PATH is not a directory: ${VAULT_PATH}`);
    }
  } catch (err: any) {
    if (err.code === "ENOENT") {
      throw new Error(`VAULT_PATH does not exist: ${VAULT_PATH}`);
    }
    throw err;
  }
  console.log(`Vault path: ${VAULT_PATH}`);
}

export function getVaultPath(): string {
  return VAULT_PATH;
}

/**
 * Check whether a vault-relative path points to a markdown file.
 */
export function isMarkdown(relativePath: string): boolean {
  return relativePath.endsWith(".md");
}

/**
 * Check whether a vault-relative path points to a structured data file (.base, .canvas).
 */
export function isStructured(relativePath: string): boolean {
  const ext = extname(relativePath).toLowerCase();
  return STRUCTURED_EXTENSIONS.has(ext);
}

/**
 * Read a structured file (.base or .canvas) and return its raw text content.
 */
export async function getStructuredContent(relativePath: string): Promise<{ path: string; raw: string; modified: string }> {
  const fullPath = resolveVaultPath(relativePath);
  const fileStat = await stat(fullPath);
  const raw = await Bun.file(fullPath).text();
  return {
    path: relativePath,
    raw,
    modified: fileStat.mtime.toISOString(),
  };
}
