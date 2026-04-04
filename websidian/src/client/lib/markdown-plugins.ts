import type MarkdownIt from "markdown-it";
import type StateInline from "markdown-it/lib/rules_inline/state_inline.mjs";
import { API_BASE } from "./api";
import type { ResolveMap } from "./markdown";

/**
 * Resolve a wikilink name to a vault path.
 */
function resolveLink(name: string, resolveMap: ResolveMap): string | null {
  const key = name.toLowerCase();
  const paths = resolveMap[key];
  if (!paths || paths.length === 0) return null;
  return paths[0];
}

function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

/**
 * markdown-it plugin for Obsidian [[wikilinks]].
 * Handles: [[Page]], [[Page|Label]], [[Page#Section]], [[Page#Section|Label]]
 */
export function wikilinkPlugin(md: MarkdownIt, resolveMap: ResolveMap) {
  md.inline.ruler.push("wikilink", (state: StateInline, silent: boolean) => {
    const src = state.src;
    const pos = state.pos;

    // Must start with [[
    if (src.charCodeAt(pos) !== 0x5b || src.charCodeAt(pos + 1) !== 0x5b) return false;

    // Find closing ]]
    const closeIdx = src.indexOf("]]", pos + 2);
    if (closeIdx === -1) return false;

    // Check this isn't an embed (![[...]])
    if (pos > 0 && src.charCodeAt(pos - 1) === 0x21) return false;

    if (silent) return true;

    const inner = src.slice(pos + 2, closeIdx);

    // Parse pipe: [[target|label]]
    const pipeIdx = inner.indexOf("|");
    const raw = pipeIdx !== -1 ? inner.substring(0, pipeIdx) : inner;
    const label = pipeIdx !== -1 ? inner.substring(pipeIdx + 1) : inner;

    // Parse hash: target#section
    const hashIdx = raw.indexOf("#");
    const target = hashIdx !== -1 ? raw.substring(0, hashIdx).trim() : raw.trim();
    const section = hashIdx !== -1 ? raw.substring(hashIdx) : "";

    // Resolve to a path
    const resolved = target ? resolveLink(target, resolveMap) : null;
    let href: string;
    if (resolved) {
      href = `/note/${encodePath(resolved)}${section ? encodeURIComponent(section) : ""}`;
    } else {
      href = `/note/${encodeURIComponent(target)}`;
    }

    const tokenOpen = state.push("link_open", "a", 1);
    tokenOpen.attrSet("href", href);
    tokenOpen.attrSet("class", resolved ? "wikilink" : "wikilink wikilink-unresolved");
    tokenOpen.markup = "wikilink";

    const tokenText = state.push("text", "", 0);
    tokenText.content = label;

    state.push("link_close", "a", -1);
    state.pos = closeIdx + 2;
    return true;
  });
}

/**
 * markdown-it plugin for Obsidian image/note embeds: ![[image.png]], ![[Note]]
 * Renders images as <img> and note embeds as placeholder divs.
 */
export function embedPlugin(md: MarkdownIt, resolveMap: ResolveMap) {
  md.inline.ruler.push("obsidian_embed", (state: StateInline, silent: boolean) => {
    const src = state.src;
    const pos = state.pos;

    // Must start with ![[
    if (
      src.charCodeAt(pos) !== 0x21 ||
      src.charCodeAt(pos + 1) !== 0x5b ||
      src.charCodeAt(pos + 2) !== 0x5b
    ) return false;

    // Find closing ]]
    const closeIdx = src.indexOf("]]", pos + 3);
    if (closeIdx === -1) return false;

    if (silent) return true;

    const inner = src.slice(pos + 3, closeIdx);
    const pipeIdx = inner.indexOf("|");
    const target = (pipeIdx !== -1 ? inner.substring(0, pipeIdx) : inner).trim();
    const alt = pipeIdx !== -1 ? inner.substring(pipeIdx + 1).trim() : target;

    // Check if it's an image
    const imageExts = [".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp", ".bmp"];
    const isImage = imageExts.some((ext) => target.toLowerCase().endsWith(ext));

    if (isImage) {
      const resolved = resolveLink(target, resolveMap);
      const imgPath = resolved ? encodePath(resolved) : encodeURIComponent(target);
      const token = state.push("image", "img", 0);
      token.attrSet("src", `${API_BASE}/api/files/${imgPath}`);
      token.attrSet("alt", alt);
      token.children = [];
    } else {
      // Note embed — render as a placeholder for potential future processing
      const token = state.push("html_inline", "", 0);
      token.content = `<div class="embed-note" data-embed="${target}">[Embedded: ${target}]</div>`;
    }

    state.pos = closeIdx + 2;
    return true;
  });
}
