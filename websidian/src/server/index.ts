import { Hono } from "hono";
import { logger } from "hono/logger";
import { serveStatic } from "hono/bun";
import { filesRoute, setResolveMap, setParsedNotes } from "./routes/files.js";
import { searchRoute } from "./routes/search.js";
import { graphRoute } from "./routes/graph.js";
import { validateVault } from "./services/vault.js";
import { parseAllNotes, buildFullResolveMap } from "./services/parser.js";
import { buildSearchIndex } from "./services/search.js";
import { buildGraph } from "./services/graph.js";

const app = new Hono()
  .use(logger())
  .get("/health", (c) => c.json({ status: "ok" }))
  .route("/api/files", filesRoute)
  .route("/api/search", searchRoute)
  .route("/api/graph", graphRoute)
  // Serve built React frontend in production
  .use("/*", serveStatic({ root: "./build" }))
  // SPA fallback — serve index.html for client-side routes
  .get("/*", async (c) => {
    const html = await Bun.file("./build/index.html").text();
    return c.html(html);
  });

// Startup: validate vault and build indexes
if (import.meta.main) {
  console.time("Startup");
  await validateVault();

  const notes = await parseAllNotes();
  const resolveMap = await buildFullResolveMap(notes);
  setResolveMap(resolveMap);
  setParsedNotes(notes);
  console.log(`Resolve map: ${Object.keys(resolveMap).length} entries`);

  buildSearchIndex(notes);
  buildGraph(notes, resolveMap);

  console.timeEnd("Startup");
}

export default {
  port: Number(process.env.PORT ?? 3000),
  fetch: app.fetch,
};

export type AppType = typeof app;
