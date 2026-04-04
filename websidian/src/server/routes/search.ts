import { Hono } from "hono";

export const searchRoute = new Hono().get("/", (c) => {
  return c.json({ results: [] });
});
