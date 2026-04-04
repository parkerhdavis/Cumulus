import { Hono } from "hono";

export const filesRoute = new Hono()
  .get("/tree", (c) => {
    return c.json({ name: "vault", type: "directory", children: [] });
  })
  .get("/*", (c) => {
    return c.json({ path: "", content: "", frontmatter: {}, modified: "" });
  });
