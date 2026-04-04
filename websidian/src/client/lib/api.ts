// In dev mode (Bun HTML dev server on :3001), API calls go to the Hono server on :3000.
// In production (single process), API calls go to the same origin.
export const API_BASE =
  typeof location !== "undefined" && location.port === "3001"
    ? "http://localhost:3000"
    : "";
