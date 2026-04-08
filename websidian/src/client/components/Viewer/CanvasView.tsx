import { useRef, useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { createMarkdownRenderer, renderMarkdown, type ResolveMap } from "../../lib/markdown";
import { API_BASE } from "../../lib/api";

// ── JSON Canvas types ──

interface CanvasNode {
	id: string;
	type: "text" | "file" | "link" | "group";
	x: number;
	y: number;
	width: number;
	height: number;
	color?: string;
	// text node
	text?: string;
	// file node
	file?: string;
	subpath?: string;
	// link node
	url?: string;
	// group node
	label?: string;
	background?: string;
	backgroundStyle?: "cover" | "ratio" | "repeat";
}

interface CanvasEdge {
	id: string;
	fromNode: string;
	fromSide?: "top" | "right" | "bottom" | "left";
	fromEnd?: "none" | "arrow";
	toNode: string;
	toSide?: "top" | "right" | "bottom" | "left";
	toEnd?: "none" | "arrow";
	color?: string;
	label?: string;
}

interface CanvasData {
	nodes?: CanvasNode[];
	edges?: CanvasEdge[];
}

interface CanvasViewProps {
	data: CanvasData;
	resolveMap: ResolveMap;
}

// ── Color mapping ──

const PRESET_COLORS: Record<string, string> = {
	"1": "#fb464c", // red
	"2": "#e9973f", // orange
	"3": "#e0de71", // yellow
	"4": "#44cf6e", // green
	"5": "#53dfdd", // cyan
	"6": "#a882ff", // purple
};

function resolveColor(color?: string): string | undefined {
	if (!color) return undefined;
	if (color.startsWith("#")) return color;
	return PRESET_COLORS[color];
}

// ── Edge path calculation ──

function getAnchorPoint(node: CanvasNode, side: "top" | "right" | "bottom" | "left"): { x: number; y: number } {
	const cx = node.x + node.width / 2;
	const cy = node.y + node.height / 2;
	switch (side) {
		case "top": return { x: cx, y: node.y };
		case "bottom": return { x: cx, y: node.y + node.height };
		case "left": return { x: node.x, y: cy };
		case "right": return { x: node.x + node.width, y: cy };
	}
}

function inferSide(from: CanvasNode, to: CanvasNode): "top" | "right" | "bottom" | "left" {
	const dx = (to.x + to.width / 2) - (from.x + from.width / 2);
	const dy = (to.y + to.height / 2) - (from.y + from.height / 2);
	if (Math.abs(dx) > Math.abs(dy)) {
		return dx > 0 ? "right" : "left";
	}
	return dy > 0 ? "bottom" : "top";
}

function getControlOffset(side: "top" | "right" | "bottom" | "left"): { dx: number; dy: number } {
	const d = 80;
	switch (side) {
		case "top": return { dx: 0, dy: -d };
		case "bottom": return { dx: 0, dy: d };
		case "left": return { dx: -d, dy: 0 };
		case "right": return { dx: d, dy: 0 };
	}
}

// ── Image detection ──

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp", "bmp"]);
function isImagePath(path: string): boolean {
	const ext = path.split(".").pop()?.toLowerCase() ?? "";
	return IMAGE_EXTS.has(ext);
}

// ── Component ──

export default function CanvasView({ data, resolveMap }: CanvasViewProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const navigate = useNavigate();

	const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
	const [dragging, setDragging] = useState(false);
	const dragStart = useRef({ x: 0, y: 0, tx: 0, ty: 0 });

	const nodes = data.nodes ?? [];
	const edges = data.edges ?? [];
	const nodeMap = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);

	// Auto-fit on mount
	useEffect(() => {
		if (!containerRef.current || nodes.length === 0) return;
		const rect = containerRef.current.getBoundingClientRect();

		let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
		for (const n of nodes) {
			minX = Math.min(minX, n.x);
			minY = Math.min(minY, n.y);
			maxX = Math.max(maxX, n.x + n.width);
			maxY = Math.max(maxY, n.y + n.height);
		}

		const contentW = maxX - minX;
		const contentH = maxY - minY;
		const pad = 80;
		const scale = Math.min(
			(rect.width - pad * 2) / contentW,
			(rect.height - pad * 2) / contentH,
			1.5, // don't zoom in too much
		);
		const cx = (minX + maxX) / 2;
		const cy = (minY + maxY) / 2;

		setTransform({
			x: rect.width / 2 - cx * scale,
			y: rect.height / 2 - cy * scale,
			scale,
		});
	}, [nodes]);

	// Pan handlers
	const onMouseDown = useCallback((e: React.MouseEvent) => {
		if (e.button !== 0) return;
		// Don't start drag on interactive elements
		const target = e.target as HTMLElement;
		if (target.closest("a, button, .canvas-node-content")) return;

		setDragging(true);
		dragStart.current = { x: e.clientX, y: e.clientY, tx: transform.x, ty: transform.y };
		e.preventDefault();
	}, [transform]);

	const onMouseMove = useCallback((e: React.MouseEvent) => {
		if (!dragging) return;
		const dx = e.clientX - dragStart.current.x;
		const dy = e.clientY - dragStart.current.y;
		setTransform((t) => ({ ...t, x: dragStart.current.tx + dx, y: dragStart.current.ty + dy }));
	}, [dragging]);

	const onMouseUp = useCallback(() => setDragging(false), []);

	// Zoom handler
	const onWheel = useCallback((e: React.WheelEvent) => {
		e.preventDefault();
		const rect = containerRef.current?.getBoundingClientRect();
		if (!rect) return;

		const mouseX = e.clientX - rect.left;
		const mouseY = e.clientY - rect.top;
		const delta = e.deltaY > 0 ? 0.9 : 1.1;

		setTransform((t) => {
			const newScale = Math.max(0.1, Math.min(5, t.scale * delta));
			const ratio = newScale / t.scale;
			return {
				scale: newScale,
				x: mouseX - (mouseX - t.x) * ratio,
				y: mouseY - (mouseY - t.y) * ratio,
			};
		});
	}, []);

	// Render markdown for text nodes
	const mdRenderer = useMemo(() => createMarkdownRenderer(resolveMap), [resolveMap]);

	function renderNodeContent(node: CanvasNode) {
		switch (node.type) {
			case "text":
				return (
					<div
						className="canvas-node-content canvas-text-content"
						dangerouslySetInnerHTML={{ __html: renderMarkdown(mdRenderer, node.text ?? "") }}
					/>
				);

			case "file": {
				const filePath = node.file ?? "";
				if (isImagePath(filePath)) {
					const encoded = filePath.split("/").map(encodeURIComponent).join("/");
					return (
						<div className="canvas-node-content canvas-file-content canvas-file-image">
							<img src={`${API_BASE}/api/files/${encoded}`} alt={filePath} />
						</div>
					);
				}
				const displayName = filePath.split("/").pop()?.replace(/\.md$/, "") ?? filePath;
				const encoded = filePath.split("/").map(encodeURIComponent).join("/");
				return (
					<div className="canvas-node-content canvas-file-content">
						<div className="canvas-file-header">
							<a
								href={`/note/${encoded}`}
								onClick={(e) => {
									e.preventDefault();
									e.stopPropagation();
									navigate(`/note/${encoded}`);
								}}
							>
								{displayName}
							</a>
						</div>
					</div>
				);
			}

			case "link":
				return (
					<div className="canvas-node-content canvas-link-content">
						<div className="canvas-link-header">
							<a href={node.url} target="_blank" rel="noopener noreferrer">
								{node.url}
							</a>
						</div>
					</div>
				);

			case "group":
				return node.label ? (
					<div className="canvas-group-label">{node.label}</div>
				) : null;

			default:
				return null;
		}
	}

	// Sort nodes: groups first (lower z-index), then others
	const sortedNodes = useMemo(() => {
		const groups = nodes.filter((n) => n.type === "group");
		const others = nodes.filter((n) => n.type !== "group");
		return [...groups, ...others];
	}, [nodes]);

	return (
		<div
			ref={containerRef}
			className={`canvas-view ${dragging ? "canvas-dragging" : ""}`}
			onMouseDown={onMouseDown}
			onMouseMove={onMouseMove}
			onMouseUp={onMouseUp}
			onMouseLeave={onMouseUp}
			onWheel={onWheel}
		>
			<div
				className="canvas-transform"
				style={{
					transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`,
				}}
			>
				{/* Edges (SVG layer) */}
				<svg className="canvas-edges">
					<defs>
						<marker
							id="canvas-arrowhead"
							markerWidth="10"
							markerHeight="7"
							refX="9"
							refY="3.5"
							orient="auto"
						>
							<polygon points="0 0, 10 3.5, 0 7" fill="var(--text-muted)" />
						</marker>
					</defs>
					{edges.map((edge) => {
						const fromNode = nodeMap.get(edge.fromNode);
						const toNode = nodeMap.get(edge.toNode);
						if (!fromNode || !toNode) return null;

						const fromSide = edge.fromSide ?? inferSide(fromNode, toNode);
						const toSide = edge.toSide ?? inferSide(toNode, fromNode);
						const from = getAnchorPoint(fromNode, fromSide);
						const to = getAnchorPoint(toNode, toSide);
						const cp1 = getControlOffset(fromSide);
						const cp2 = getControlOffset(toSide);

						const color = resolveColor(edge.color) ?? "var(--text-muted)";
						const hasFromArrow = edge.fromEnd === "arrow";
						const hasToArrow = edge.toEnd !== "none";

						const pathD = `M ${from.x} ${from.y} C ${from.x + cp1.dx} ${from.y + cp1.dy}, ${to.x + cp2.dx} ${to.y + cp2.dy}, ${to.x} ${to.y}`;

						return (
							<g key={edge.id}>
								<path
									d={pathD}
									fill="none"
									stroke={color}
									strokeWidth={2}
									markerEnd={hasToArrow ? "url(#canvas-arrowhead)" : undefined}
									markerStart={hasFromArrow ? "url(#canvas-arrowhead)" : undefined}
								/>
								{edge.label && (
									<text
										x={(from.x + to.x) / 2}
										y={(from.y + to.y) / 2 - 8}
										textAnchor="middle"
										className="canvas-edge-label"
										fill={color}
									>
										{edge.label}
									</text>
								)}
							</g>
						);
					})}
				</svg>

				{/* Nodes */}
				{sortedNodes.map((node) => {
					const color = resolveColor(node.color);
					const isGroup = node.type === "group";
					return (
						<div
							key={node.id}
							className={`canvas-node canvas-node-${node.type}`}
							style={{
								left: node.x,
								top: node.y,
								width: node.width,
								height: node.height,
								...(color ? {
									borderColor: color,
									...(isGroup ? {} : { "--node-accent": color } as React.CSSProperties),
								} : {}),
							}}
						>
							{renderNodeContent(node)}
						</div>
					);
				})}
			</div>
		</div>
	);
}
