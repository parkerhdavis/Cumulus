import { useState } from "react";
import { Link } from "react-router-dom";
import { useBacklinks } from "../../hooks/useBacklinks";

interface BacklinksProps {
  path: string;
}

export default function Backlinks({ path }: BacklinksProps) {
  const { data } = useBacklinks(path);
  const [expanded, setExpanded] = useState(true);

  const backlinks = data?.backlinks ?? [];
  if (backlinks.length === 0) return null;

  return (
    <section className="backlinks">
      <button
        className="backlinks-header"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="backlinks-chevron">{expanded ? "▾" : "▸"}</span>
        <span>Backlinks ({backlinks.length})</span>
      </button>
      {expanded && (
        <ul className="backlinks-list">
          {backlinks.map((bl) => {
            const encoded = bl.source
              .split("/")
              .map(encodeURIComponent)
              .join("/");
            return (
              <li key={bl.source} className="backlink-item">
                <Link to={`/note/${encoded}`} className="backlink-source">
                  {bl.sourceName}
                </Link>
                {bl.context && (
                  <span className="backlink-context">{bl.context}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
