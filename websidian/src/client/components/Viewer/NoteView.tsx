import { useLocation } from "react-router-dom";
import { useNoteContent } from "../../hooks/useNoteContent";
import { useResolveMap } from "../../hooks/useResolveMap";
import MarkdownRenderer from "./MarkdownRenderer";
import CanvasView from "./CanvasView";
import BaseView from "./BaseView";
import Breadcrumb from "./Breadcrumb";
import Backlinks from "./Backlinks";

function getFileType(path: string): "markdown" | "canvas" | "base" | "other" {
	if (path.endsWith(".canvas")) return "canvas";
	if (path.endsWith(".base")) return "base";
	if (path.endsWith(".md")) return "markdown";
	return "other";
}

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

	const fileType = getFileType(notePath);
	const ext = notePath.split(".").pop() ?? "";
	const title = notePath.split("/").pop()?.replace(/\.\w+$/, "") ?? "";

	if (fileType === "canvas") {
		return (
			<article className="note-view note-view-canvas">
				<Breadcrumb path={notePath} />
				<h1 className="note-title">{title}</h1>
				<CanvasView
					data={(note as any).data ?? {}}
					resolveMap={resolveMap ?? {}}
				/>
			</article>
		);
	}

	if (fileType === "base") {
		return (
			<article className="note-view note-view-base">
				<Breadcrumb path={notePath} />
				<h1 className="note-title">{title}</h1>
				<BaseView data={(note as any).data ?? { views: [] }} />
			</article>
		);
	}

	// Default: markdown
	return (
		<article className="note-view">
			<Breadcrumb path={notePath} />
			<h1 className="note-title">{title}</h1>
			<div className="note-content">
				<MarkdownRenderer
					content={(note as any).content ?? ""}
					resolveMap={resolveMap ?? {}}
				/>
			</div>
			<Backlinks path={notePath} />
		</article>
	);
}
