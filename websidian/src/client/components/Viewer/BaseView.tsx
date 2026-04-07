import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";

// ── Types matching server output ──

interface ColumnDef {
	key: string;
	displayName: string;
	width?: number;
}

interface RowData {
	path: string;
	fileName: string;
	values: Record<string, unknown>;
}

interface GroupData {
	label: string | null;
	rows: RowData[];
}

interface EvaluatedView {
	name: string;
	type: "table" | "cards" | "list";
	columns: ColumnDef[];
	groups: GroupData[];
	totalCount: number;
}

interface BaseViewData {
	views: EvaluatedView[];
}

interface BaseViewProps {
	data: BaseViewData;
}

// ── Cell rendering ──

function renderCellValue(value: unknown): string {
	if (value === undefined || value === null) return "";
	if (Array.isArray(value)) return value.map(String).join(", ");
	if (typeof value === "boolean") return value ? "Yes" : "No";
	if (typeof value === "object") return JSON.stringify(value);
	return String(value);
}

// ── Components ──

function TableLayout({ view }: { view: EvaluatedView }) {
	const navigate = useNavigate();

	const handleRowClick = useCallback((path: string) => {
		const encoded = path.split("/").map(encodeURIComponent).join("/");
		navigate(`/note/${encoded}`);
	}, [navigate]);

	return (
		<div className="base-table-wrapper">
			{view.groups.map((group, gi) => (
				<div key={gi} className="base-group">
					{group.label && (
						<div className="base-group-header">{group.label}</div>
					)}
					<table className="base-table">
						<thead>
							<tr>
								{view.columns.map((col) => (
									<th
										key={col.key}
										style={col.width ? { width: col.width } : undefined}
									>
										{col.displayName}
									</th>
								))}
							</tr>
						</thead>
						<tbody>
							{group.rows.map((row) => (
								<tr
									key={row.path}
									className="base-table-row"
									onClick={() => handleRowClick(row.path)}
								>
									{view.columns.map((col) => (
										<td key={col.key}>
											{col.key === "file.name" ? (
												<span className="base-file-link">{row.fileName}</span>
											) : (
												renderCellValue(row.values[col.key])
											)}
										</td>
									))}
								</tr>
							))}
						</tbody>
					</table>
				</div>
			))}
		</div>
	);
}

function CardsLayout({ view }: { view: EvaluatedView }) {
	const navigate = useNavigate();

	const handleCardClick = useCallback((path: string) => {
		const encoded = path.split("/").map(encodeURIComponent).join("/");
		navigate(`/note/${encoded}`);
	}, [navigate]);

	// Skip file.name from card properties since it's the title
	const cardColumns = view.columns.filter((c) => c.key !== "file.name");

	return (
		<div className="base-cards-wrapper">
			{view.groups.map((group, gi) => (
				<div key={gi} className="base-group">
					{group.label && (
						<div className="base-group-header">{group.label}</div>
					)}
					<div className="base-cards-grid">
						{group.rows.map((row) => (
							<div
								key={row.path}
								className="base-card"
								onClick={() => handleCardClick(row.path)}
							>
								<div className="base-card-title">{row.fileName}</div>
								<div className="base-card-properties">
									{cardColumns.map((col) => {
										const val = renderCellValue(row.values[col.key]);
										if (!val) return null;
										return (
											<div key={col.key} className="base-card-prop">
												<span className="base-card-prop-label">{col.displayName}</span>
												<span className="base-card-prop-value">{val}</span>
											</div>
										);
									})}
								</div>
							</div>
						))}
					</div>
				</div>
			))}
		</div>
	);
}

function ListLayout({ view }: { view: EvaluatedView }) {
	const navigate = useNavigate();

	const handleItemClick = useCallback((path: string) => {
		const encoded = path.split("/").map(encodeURIComponent).join("/");
		navigate(`/note/${encoded}`);
	}, [navigate]);

	// Show a few key properties inline
	const inlineColumns = view.columns.filter((c) => c.key !== "file.name").slice(0, 3);

	return (
		<div className="base-list-wrapper">
			{view.groups.map((group, gi) => (
				<div key={gi} className="base-group">
					{group.label && (
						<div className="base-group-header">{group.label}</div>
					)}
					<ul className="base-list">
						{group.rows.map((row) => (
							<li
								key={row.path}
								className="base-list-item"
								onClick={() => handleItemClick(row.path)}
							>
								<span className="base-file-link">{row.fileName}</span>
								{inlineColumns.map((col) => {
									const val = renderCellValue(row.values[col.key]);
									if (!val) return null;
									return (
										<span key={col.key} className="base-list-meta">
											{val}
										</span>
									);
								})}
							</li>
						))}
					</ul>
				</div>
			))}
		</div>
	);
}

// ── Main component ──

export default function BaseView({ data }: BaseViewProps) {
	const [activeViewIndex, setActiveViewIndex] = useState(0);
	const views = data.views ?? [];

	if (views.length === 0) {
		return <div className="base-empty">No views defined in this base.</div>;
	}

	const activeView = views[activeViewIndex];

	return (
		<div className="base-view">
			{/* View tabs */}
			{views.length > 1 && (
				<div className="base-view-tabs">
					{views.map((view, i) => (
						<button
							key={i}
							className={`base-view-tab ${i === activeViewIndex ? "base-view-tab-active" : ""}`}
							onClick={() => setActiveViewIndex(i)}
						>
							{view.name}
						</button>
					))}
				</div>
			)}

			{/* Count */}
			<div className="base-count">
				{activeView.totalCount} {activeView.totalCount === 1 ? "item" : "items"}
			</div>

			{/* Render based on view type */}
			{activeView.type === "cards" ? (
				<CardsLayout view={activeView} />
			) : activeView.type === "list" ? (
				<ListLayout view={activeView} />
			) : (
				<TableLayout view={activeView} />
			)}
		</div>
	);
}
