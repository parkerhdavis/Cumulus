import { Hono } from "hono";
import { logger } from "hono/logger";
import { serveStatic } from "hono/bun";
import { filesRoute } from "./routes/files.js";
import { searchRoute } from "./routes/search.js";
import { graphRoute } from "./routes/graph.js";

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

export default {
  port: Number(process.env.PORT ?? 3000),
  fetch: app.fetch,
};

export type AppType = typeof app;
