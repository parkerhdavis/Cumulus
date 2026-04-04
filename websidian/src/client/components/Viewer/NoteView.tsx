import { useLocation } from "react-router-dom";
import { useNoteContent } from "../../hooks/useNoteContent";
import { useResolveMap } from "../../hooks/useResolveMap";
import MarkdownRenderer from "./MarkdownRenderer";
import Breadcrumb from "./Breadcrumb";
import Backlinks from "./Backlinks";

export default function NoteView() {
  const location = useLocation();
  const notePath = decodeURIComponent(
    location.pathname.replace(/^\/note\//, ""),
  );

  const { data: note, isLoading, error } = useNoteContent(notePath);
  const { data: resolveMap } = useResolveMap();

  if (isLoading) {
    return (
      <div className="note-loading">
        <div className="loading-skeleton" />
        <div className="loading-skeleton loading-skeleton-short" />
        <div className="loading-skeleton" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="note-error">
        <h2>Failed to load note</h2>
        <p>{notePath}</p>
      </div>
    );
  }

  if (!note) return null;

  return (
    <article className="note-view">
      <Breadcrumb path={note.path} />
      <div className="note-content">
        <MarkdownRenderer
          content={note.content}
          resolveMap={resolveMap ?? {}}
        />
      </div>
      <Backlinks path={note.path} />
    </article>
  );
}
