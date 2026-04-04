import { Hono } from "hono";

export const graphRoute = new Hono()
  .get("/", (c) => {
    return c.json({ nodes: [], edges: [] });
  })
  .get("/backlinks/*", (c) => {
    return c.json({ path: "", backlinks: [] });
  });
