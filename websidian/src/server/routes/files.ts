import { Hono } from "hono";
import {
  getTree,
  getMarkdownContent,
  getBinaryFile,
  resolveVaultPath,
  isMarkdown,
} from "../services/vault.js";
import type { ResolveMap } from "../services/parser.js";

let resolveMap: ResolveMap = {};

export function setResolveMap(map: ResolveMap) {
  resolveMap = map;
}

export const filesRoute = new Hono()
  .get("/tree", async (c) => {
    const tree = await getTree();
    return c.json(tree);
  })
  .get("/resolve-map", (c) => {
    return c.json(resolveMap);
  })
  .get("/*", async (c) => {
    const relativePath = c.req.path.replace(/^\/api\/files\//, "");
    const decoded = decodeURIComponent(relativePath);

    if (!decoded) {
      return c.json({ error: "No file path provided" }, 400);
    }

    try {
      // Validate the path doesn't escape the vault
      resolveVaultPath(decoded);

      if (isMarkdown(decoded)) {
        const content = await getMarkdownContent(decoded);
        return c.json(content);
      } else {
        const { data, mimeType } = await getBinaryFile(decoded);
        return new Response(data, {
          headers: { "Content-Type": mimeType },
        });
      }
    } catch (err: any) {
      if (err.message === "Path traversal detected") {
        return c.json({ error: "Invalid path" }, 403);
      }
      if (err.code === "ENOENT") {
        return c.json({ error: "File not found" }, 404);
      }
      throw err;
    }
  });
