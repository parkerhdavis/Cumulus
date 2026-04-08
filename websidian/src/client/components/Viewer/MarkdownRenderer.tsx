import { useRef, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { createMarkdownRenderer, renderMarkdown, type ResolveMap } from "../../lib/markdown";

interface MarkdownRendererProps {
  content: string;
  resolveMap: ResolveMap;
}

export default function MarkdownRenderer({
  content,
  resolveMap,
}: MarkdownRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const html = useMemo(() => {
    const md = createMarkdownRenderer(resolveMap);
    return renderMarkdown(md, content);
  }, [content, resolveMap]);

  // Intercept clicks on internal links for client-side navigation
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    function handleClick(e: MouseEvent) {
      const target = (e.target as HTMLElement).closest("a");
      if (!target) return;

      const href = target.getAttribute("href");
      if (!href) return;

      // Only intercept internal /note/ links
      if (href.startsWith("/note/")) {
        e.preventDefault();
        navigate(href);
      }
    }

    container.addEventListener("click", handleClick);
    return () => container.removeEventListener("click", handleClick);
  }, [navigate]);

  return (
    <div
      ref={containerRef}
      className="markdown-rendered"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
