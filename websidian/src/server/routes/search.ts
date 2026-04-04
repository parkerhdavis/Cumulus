import { Hono } from "hono";
import { search } from "../services/search.js";

export const searchRoute = new Hono().get("/", (c) => {
  const q = c.req.query("q");
  if (!q || q.length < 1) {
    return c.json({ results: [] });
  }

  const limit = Math.min(Number(c.req.query("limit")) || 20, 50);
  const results = search(q, limit);
  return c.json({ results });
});
