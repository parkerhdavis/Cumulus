import MarkdownIt from "markdown-it";
import obsidianCallouts from "markdown-it-obsidian-callouts";
// @ts-ignore
import taskLists from "@hackmd/markdown-it-task-lists";
import footnote from "markdown-it-footnote";
// @ts-ignore
import mathjax3 from "markdown-it-mathjax3";
import { wikilinkPlugin, embedPlugin } from "./markdown-plugins";

export type ResolveMap = Record<string, string[]>;

/**
 * Create a configured markdown-it instance with all Obsidian plugins.
 */
export function createMarkdownRenderer(resolveMap: ResolveMap): MarkdownIt {
  const md = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: true,
  });

  // Custom wikilink and embed plugins (resolve [[links]] and ![[embeds]])
  wikilinkPlugin(md, resolveMap);
  embedPlugin(md, resolveMap);

  // Callouts: > [!note] → styled callout blocks
  md.use(obsidianCallouts);

  // Task lists: - [ ] and - [x]
  md.use(taskLists, { enabled: false, label: true });

  // Footnotes: [^1]
  md.use(footnote);

  // Math: $...$ and $$...$$
  md.use(mathjax3);

  return md;
}
