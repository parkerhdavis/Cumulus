import { Hono } from "hono";
import { compress } from "hono/compress";
import { getGraph, getBacklinks } from "../services/graph.js";

export const graphRoute = new Hono()
  .use(compress())
  .get("/", (c) => {
    return c.json(getGraph());
  })
  .get("/backlinks/*", (c) => {
    const path = decodeURIComponent(
      c.req.path.replace(/^\/api\/graph\/backlinks\//, ""),
    );
    if (!path) return c.json({ path: "", backlinks: [] });
    return c.json({ path, backlinks: getBacklinks(path) });
  });
