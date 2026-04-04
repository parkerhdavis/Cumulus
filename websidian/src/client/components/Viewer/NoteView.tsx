import { useLocation } from "react-router-dom";
import { useNoteContent } from "../../hooks/useNoteContent";
import Breadcrumb from "./Breadcrumb";

export default function NoteView() {
  const location = useLocation();
  const notePath = decodeURIComponent(
    location.pathname.replace(/^\/note\//, ""),
  );

  const { data: note, isLoading, error } = useNoteContent(notePath);

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
      {/* Markdown rendering will replace this in Phase 2 */}
      <div className="note-content">
        <pre>{note.content}</pre>
      </div>
    </article>
  );
}
