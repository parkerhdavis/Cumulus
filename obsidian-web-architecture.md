# Obsidian Web — Architecture Spec

A self-hosted web interface for reading (and eventually editing) an Obsidian vault, built on Bun and designed to integrate with the Cumulus self-hosting stack.

---

## Project Overview

**Goal:** A single-runtime Bun application that serves both a REST API and a React frontend, providing browser-based access to a local Obsidian vault with faithful rendering of Obsidian-flavored markdown.

**Phase 1 (this doc):** Read-only viewer with file navigation, rendered markdown (wikilinks, callouts, embeds), search, graph view, and backlinks.

**Phase 2 (future):** Read/write editing via CodeMirror 6 with `lezer-markdown-obsidian` parser, live preview mode, file creation/deletion/rename.

---

## Project Structure

```
obsidian-web/
├── Dockerfile
├── package.json
├── tsconfig.json
├── bunfig.toml
├── src/
│   ├── server/
│   │   ├── index.ts              # Entrypoint — Hono app, serves API + static frontend
│   │   ├── routes/
│   │   │   ├── files.ts          # File tree + file content endpoints
│   │   │   ├── search.ts         # Full-text search endpoint
│   │   │   └── graph.ts          # Link graph data endpoint
│   │   ├── services/
│   │   │   ├── vault.ts          # Filesystem operations on the vault
│   │   │   ├── parser.ts         # Markdown parsing — extract wikilinks, tags, frontmatter
│   │   │   ├── graph.ts          # Build + cache the link graph from parsed vault data
│   │   │   └── search.ts         # Search index (MiniSearch or simple grep)
│   │   └── middleware/
│   │       └── auth.ts           # Optional basic auth (Pangolin handles primary auth)
│   └── client/
│       ├── index.html            # SPA shell
│       ├── main.tsx              # React entrypoint
│       ├── App.tsx
│       ├── components/
│       │   ├── Sidebar/
│       │   │   ├── FileTree.tsx          # Recursive directory tree
│       │   │   ├── FileTreeNode.tsx      # Individual file/folder node
│       │   │   └── QuickSwitcher.tsx     # Cmd+O fuzzy file finder modal
│       │   ├── Viewer/
│       │   │   ├── NoteView.tsx          # Main note display area
│       │   │   ├── MarkdownRenderer.tsx  # markdown-it rendering pipeline
│       │   │   ├── Backlinks.tsx         # "Linked mentions" panel below note
│       │   │   └── Breadcrumb.tsx        # Current file path display
│       │   ├── Graph/
│       │   │   └── GraphView.tsx         # Force-directed graph visualization
│       │   └── Layout/
│       │       ├── AppShell.tsx          # Top-level layout (sidebar + content)
│       │       └── CommandPalette.tsx    # Keyboard-driven command system
│       ├── hooks/
│       │   ├── useVaultFiles.ts          # Fetch + cache file tree
│       │   ├── useNoteContent.ts         # Fetch individual note content
│       │   ├── useSearch.ts              # Search query state + results
│       │   ├── useGraph.ts              # Graph data fetching
│       │   └── useKeyboardShortcuts.ts   # Global keybinding registration
│       ├── lib/
│       │   ├── markdown.ts              # markdown-it instance + plugin config
│       │   ├── wikilinks.ts             # Wikilink resolution (name → path)
│       │   └── router.ts               # Client-side routing (note navigation)
│       └── styles/
│           ├── obsidian-theme.css       # Color palette + typography mirroring Obsidian
│           ├── callouts.css             # Callout block styling
│           └── global.css
└── build/                               # Vite/Bun build output (served statically)
```

---

## Tech Stack

### Runtime & Server
- **Bun** — Runtime, bundler, package manager
- **Hono** — HTTP framework (API routes + static file serving)
- **Zod** — Request/response validation

### Frontend
- **React 19** — UI framework
- **Vite** (with Bun) — Dev server + production build (Bun's bundler can also work here, but Vite's HMR is superior for dev)
- **TanStack Query** — Data fetching + caching for API calls
- **TanStack Router** or **Wouter** — Lightweight client-side routing (file path-based)

### Markdown Rendering (Phase 1 — Read View)
- **markdown-it** — Core markdown parser
- **markdown-it-obsidian-callouts** (`ebullient/markdown-it-obsidian-callouts`) — Callout rendering with Obsidian's exact DOM structure + Lucide icons
- **markdown-it-obsidian** (`alexjv89/markdown-it-obsidian`) — Wikilink parsing
- **markdown-it-obsidian-images** (`glitchassassin/markdown-it-obsidian-images`) — Image wikilink embeds
- Custom plugin for note embeds (`![[note]]` → inline rendered content)

### Markdown Editing (Phase 2 — Future)
- **CodeMirror 6** — Editor foundation
- **lezer-markdown-obsidian** (`erykwalder/lezer-markdown-obsidian`) — Obsidian-flavored markdown parser for CM6
- **@codemirror/lang-markdown** — Base markdown language support

### Graph Visualization
- **D3 force layout** or **Sigma.js** (`@react-sigma/core`) — Interactive node-link graph

### Search
- **MiniSearch** — Lightweight in-memory full-text search (loaded server-side, queried via API)

### Styling
- **Tailwind CSS** or **vanilla CSS custom properties** — Your call; Obsidian itself uses CSS custom properties extensively, so mirroring that approach makes theme extraction easier

---

## API Design

All endpoints are prefixed with `/api`. The Hono app also serves the built React frontend from `/` as static files.

### `GET /api/tree`

Returns the vault's directory structure as a nested tree.

```json
{
  "name": "vault",
  "type": "directory",
  "children": [
    {
      "name": "Projects",
      "type": "directory",
      "children": [
        { "name": "Soul Pilot.md", "type": "file", "path": "Projects/Soul Pilot.md" }
      ]
    },
    { "name": "Daily Notes", "type": "directory", "children": [...] },
    { "name": "README.md", "type": "file", "path": "README.md" }
  ]
}
```

**Notes:**
- Filter out `.obsidian/`, `.trash/`, `.git/` directories
- Consider making exclusions configurable via env var (like Perlite's `HIDE_FOLDERS`)
- Include file metadata (modified time, size) for sorting options

### `GET /api/files/:path`

Returns the content of a single file.

For `.md` files:
```json
{
  "path": "Projects/Soul Pilot.md",
  "content": "# Soul Pilot\n\nProject notes...",
  "frontmatter": { "tags": ["project", "archived"], "aliases": ["SP"] },
  "modified": "2025-03-15T10:30:00Z"
}
```

For binary files (images, PDFs): serve the raw file with appropriate `Content-Type`.

**Notes:**
- Parse frontmatter server-side (use `gray-matter` or a simple YAML parser) so the client has structured access to tags, aliases, etc.
- The `content` field should be the raw markdown (frontmatter stripped) so the client renders it

### `GET /api/search?q=<query>`

Full-text search across all vault files.

```json
{
  "results": [
    {
      "path": "Projects/Soul Pilot.md",
      "matches": [
        { "line": 14, "text": "...the **narrative** design was misaligned with..." }
      ],
      "score": 0.85
    }
  ]
}
```

**Implementation options:**
- **Simple:** Use Bun's file APIs to `grep` through all `.md` files on each request. Fast enough for vaults under ~5000 notes.
- **Better:** Build a MiniSearch index on startup, update it on file changes. Provides fuzzy matching + relevance scoring.
- **Future:** If the vault grows very large, consider SQLite FTS5 (Bun has native SQLite support).

### `GET /api/graph`

Returns the link graph as nodes + edges.

```json
{
  "nodes": [
    { "id": "Projects/Soul Pilot.md", "name": "Soul Pilot", "tags": ["project"] },
    { "id": "People/Some Person.md", "name": "Some Person", "tags": ["person"] }
  ],
  "edges": [
    { "source": "Projects/Soul Pilot.md", "target": "People/Some Person.md" }
  ]
}
```

**Implementation:**
- On startup (and on file changes), scan all `.md` files for `[[wikilinks]]`
- Resolve wikilinks to file paths (handle aliases, shortest-path matching like Obsidian does)
- Cache the graph in memory; invalidate on file writes
- For backlinks: this is just the reverse lookup — given a node, find all edges where it's the target

### `GET /api/backlinks/:path`

Returns all notes that link to the given note. (Can also be derived client-side from graph data, but a dedicated endpoint is cleaner.)

```json
{
  "path": "People/Some Person.md",
  "backlinks": [
    {
      "source": "Projects/Soul Pilot.md",
      "context": "Worked with [[Some Person]] on the narrative design"
    }
  ]
}
```

### Phase 2 Endpoints (stubbed, not implemented yet)

```
PUT    /api/files/:path     — Create or update file content
DELETE /api/files/:path     — Delete a file
POST   /api/files/move      — Rename/move a file (body: { from, to })
```

---

## Wikilink Resolution

This is the trickiest piece of logic to get right. Obsidian's wikilink resolution is surprisingly nuanced:

1. **Exact match** — `[[Some Note]]` matches `Some Note.md` anywhere in the vault
2. **Shortest path** — If multiple files share a name, Obsidian prefers the shortest path from the linking note
3. **Case-insensitive** — `[[some note]]` matches `Some Note.md`
4. **Aliases** — If a note has `aliases: ["SN"]` in frontmatter, `[[SN]]` resolves to it
5. **Heading links** — `[[Note#Heading]]` links to a specific heading within a note
6. **Block links** — `[[Note#^block-id]]` links to a specific block

**Recommended approach:**

Build a resolution index on startup:
```
Map<string (lowercase name/alias), string[] (matching file paths)>
```

When resolving a wikilink, look up the lowercase name in the map. If multiple matches, use shortest-path-from-source logic. This index should be rebuilt whenever files change.

Both the server (for graph building) and the client (for rendering clickable links) need access to this resolution logic. Consider:
- Server builds the index and exposes it via `GET /api/resolve-map` (a flat JSON map)
- Client fetches this once and uses it for link rendering in markdown-it

---

## Markdown Rendering Pipeline

The client-side rendering pipeline for Phase 1:

```
Raw markdown (from API)
  → markdown-it parse
    → Plugin: wikilinks (resolve [[links]] to <a> with client-side navigation)
    → Plugin: callouts (> [!type] blocks → styled callout divs)
    → Plugin: image embeds (![[image.png]] → <img> with /api/files/ src)
    → Plugin: note embeds (![[Note]] → fetch + inline render referenced note)
    → Plugin: frontmatter (strip or render as metadata)
  → HTML output
  → React dangerouslySetInnerHTML (or use markdown-it's token stream for a React renderer)
```

**Callout rendering detail:**

`markdown-it-obsidian-callouts` produces DOM that matches Obsidian's structure:
```html
<div class="callout" data-callout="warning">
  <div class="callout-title">
    <div class="callout-title-icon"><svg>...</svg></div>
    <div class="callout-title-inner">Warning Title</div>
  </div>
  <div class="callout-content">
    <p>Content here</p>
  </div>
</div>
```

This means you can lift Obsidian's callout CSS almost directly. The package uses Lucide icons, same as Obsidian.

**Note embed rendering:**

`![[Some Note]]` is the most complex rendering feature. The approach:
1. markdown-it plugin detects `![[...]]` syntax
2. Plugin emits a placeholder: `<div class="embed" data-embed-path="Some Note"></div>`
3. A React post-processing step finds these placeholders, fetches the embedded note content from the API, renders it through the same markdown pipeline (with recursion depth limiting to avoid infinite embed loops), and injects it

---

## Serving Strategy

Bun serves everything from a single process:

```typescript
// src/server/index.ts
import { Hono } from 'hono'
import { serveStatic } from 'hono/bun'

const app = new Hono()

// API routes
app.route('/api/tree', treeRoute)
app.route('/api/files', filesRoute)
app.route('/api/search', searchRoute)
app.route('/api/graph', graphRoute)
app.route('/api/backlinks', backlinksRoute)

// Serve built React frontend
app.use('/*', serveStatic({ root: './build' }))

// SPA fallback — all non-API, non-static routes serve index.html
app.get('/*', (c) => c.redirect('/'))

export default {
  port: 3000,
  fetch: app.fetch
}
```

**Dev workflow:**

During development, use Vite's dev server for the frontend (with HMR) and proxy API requests to the Hono backend:

```typescript
// vite.config.ts
export default defineConfig({
  server: {
    proxy: {
      '/api': 'http://localhost:3000'
    }
  },
  build: {
    outDir: '../build'  // Hono serves this in production
  }
})
```

For production, `bun run build` (Vite) produces static assets into `build/`, and the Hono server serves them. Single process, single container.

---

## Docker + Cumulus Integration

### Dockerfile

```dockerfile
FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile

# Build frontend
COPY . .
RUN bun run build

# Production
FROM oven/bun:1-slim
WORKDIR /app
COPY --from=base /app/build ./build
COPY --from=base /app/src/server ./src/server
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/package.json ./

EXPOSE 3000
CMD ["bun", "run", "src/server/index.ts"]
```

### docker-compose.phd-server.yml addition

```yaml
obsidian-web:
  build: ./obsidian-web
  container_name: obsidian-web
  restart: unless-stopped
  volumes:
    - ${VAULT_PATH}:/vault:rw    # :rw for Phase 2; :ro works for Phase 1
  environment:
    - VAULT_PATH=/vault
    - HIDE_FOLDERS=.obsidian,.git,.trash
  ports:
    - "3000:3000"
  networks:
    - default
```

### .env addition

```bash
VAULT_PATH=/path/to/your/obsidian-vault   # Sibling to Cumulus directory
```

### Pangolin registration

Register a new site in Pangolin's UI (e.g., `notes.yourdomain.com`) pointing to `obsidian-web:3000` on the home server's Newt tunnel. Enable auth — this should not be publicly readable.

---

## File Watching (Phase 1.5)

Even in read-only mode, it's useful for the web UI to reflect changes made in native Obsidian without a manual page refresh.

**Approach:**
- Server uses `fs.watch` (or `chokidar` for robustness) on the vault directory
- On file change: invalidate affected entries in the search index and graph cache
- Push change notifications to connected clients via WebSocket (or Server-Sent Events for simplicity)
- Client invalidates relevant TanStack Query cache entries on receiving a change event

This can be deferred to after the core read-only viewer works, but the architecture should accommodate it (i.e., don't hard-cache things in ways that make invalidation painful).

---

## Theming

Obsidian's default theme uses CSS custom properties extensively. The key variables to replicate:

```css
:root {
  /* Background hierarchy */
  --background-primary: #1e1e1e;
  --background-secondary: #262626;
  --background-modifier-border: #333;

  /* Text hierarchy */
  --text-normal: #dcddde;
  --text-muted: #999;
  --text-faint: #666;

  /* Accent */
  --interactive-accent: #7f6df2;
  --text-accent: #7f6df2;

  /* Typography */
  --font-text: 'Inter', -apple-system, sans-serif;
  --font-monospace: 'JetBrains Mono', monospace;
  --line-height: 1.6;
}
```

Using the same variable names means that if you ever want to support loading Obsidian community themes (which override these variables), you'd have a head start.

---

## Phase 2 Notes (for future reference)

When adding editing:

- **CodeMirror 6** replaces the markdown-it rendered view (or sits beside it in split mode)
- **`lezer-markdown-obsidian`** provides the parser for syntax highlighting + structure
- The `PUT /api/files/:path` endpoint accepts raw markdown and writes to disk
- **Autosave** with debounce (e.g., 1s after last keystroke) rather than explicit save
- **Conflict detection** — if file watching detects an external change to a file you're editing, show a notification rather than silently overwriting
- **Rename refactoring** — when renaming a file via `POST /api/files/move`, scan all other files for wikilinks referencing the old name and update them (this is what Obsidian does automatically)
- The `simple-markdown-editor` project (CTRL-Neo-Studios) is worth watching — if it matures, it could be a drop-in CM6 configuration for Obsidian-style live preview

---

## Key Dependencies Summary

```json
{
  "dependencies": {
    "hono": "^4.x",
    "zod": "^3.x",
    "react": "^19.x",
    "react-dom": "^19.x",
    "@tanstack/react-query": "^5.x",
    "markdown-it": "^14.x",
    "markdown-it-obsidian-callouts": "latest",
    "gray-matter": "^4.x",
    "minisearch": "^7.x",
    "fuse.js": "^7.x",
    "d3": "^7.x"
  },
  "devDependencies": {
    "vite": "^6.x",
    "@vitejs/plugin-react": "latest",
    "typescript": "^5.x",
    "@types/react": "latest",
    "@types/react-dom": "latest",
    "tailwindcss": "^4.x"
  }
}
```

**Note:** Verify `markdown-it-obsidian` and `markdown-it-obsidian-images` npm availability — these are smaller packages that may need to be installed from GitHub directly or vendored. If they're unmaintained or insufficient, writing custom markdown-it plugins for wikilink and embed parsing is straightforward (wikilinks are a simple regex rule; embeds are similar with the `!` prefix).
