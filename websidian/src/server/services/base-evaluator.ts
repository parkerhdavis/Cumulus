/**
 * Evaluates Obsidian .base files against parsed vault notes.
 *
 * Supports:
 * - Filter expressions: file.inFolder(), file.hasTag(), file.hasLink(),
 *   file.hasProperty(), file.ext comparisons, note.property comparisons
 * - Composite filters: and, or, not
 * - Views: table, cards, list
 * - Sorting by property (ASC/DESC)
 * - Grouping by property
 * - Property display names
 * - Summaries (count only for now)
 */

import { parse as parseYaml } from "yaml";
import { basename, dirname, extname } from "node:path";
import type { ParsedNote } from "./parser.js";

// ── Types ──

interface BaseFile {
	filters?: FilterGroup | FilterExpr;
	formulas?: Record<string, string>;
	properties?: Record<string, { displayName?: string }>;
	summaries?: Record<string, string>;
	views?: ViewConfig[];
}

type FilterGroup = {
	and?: FilterEntry[];
	or?: FilterEntry[];
	not?: FilterEntry;
};

type FilterEntry = string | FilterGroup;
type FilterExpr = string;

interface ViewConfig {
	type?: "table" | "cards" | "list";
	name?: string;
	filters?: FilterGroup | FilterExpr;
	groupBy?: { property: string; direction?: "ASC" | "DESC" };
	order?: string[];
	sort?: SortConfig[];
	limit?: number;
	summaries?: Record<string, string>;
	columnSize?: Record<string, number>;
}

interface SortConfig {
	property: string;
	direction?: "ASC" | "DESC";
}

// ── Public output types ──

export interface BaseViewData {
	views: EvaluatedView[];
}

export interface EvaluatedView {
	name: string;
	type: "table" | "cards" | "list";
	columns: ColumnDef[];
	groups: GroupData[];
	totalCount: number;
}

export interface ColumnDef {
	key: string;
	displayName: string;
	width?: number;
}

export interface GroupData {
	label: string | null;
	rows: RowData[];
}

export interface RowData {
	path: string;
	fileName: string;
	values: Record<string, unknown>;
}

// ── Main entry point ──

export function evaluateBase(rawYaml: string, basePath: string, notes: ParsedNote[]): BaseViewData {
	let baseFile: BaseFile;
	try {
		baseFile = parseYaml(rawYaml) as BaseFile;
	} catch {
		return { views: [{ name: "Error", type: "table", columns: [], groups: [{ label: null, rows: [] }], totalCount: 0 }] };
	}

	if (!baseFile || typeof baseFile !== "object") {
		return { views: [{ name: "Default", type: "table", columns: [], groups: [{ label: null, rows: [] }], totalCount: 0 }] };
	}

	const views = baseFile.views ?? [{ type: "table" as const, name: "Table" }];
	const globalFilter = baseFile.filters;
	const propertyConfig = baseFile.properties ?? {};
	const formulas = baseFile.formulas ?? {};

	const evaluatedViews: EvaluatedView[] = views.map((view) => {
		// Apply global filters first, then view-specific filters
		let filtered = notes;
		if (globalFilter) {
			filtered = applyFilter(filtered, globalFilter);
		}
		if (view.filters) {
			filtered = applyFilter(filtered, view.filters);
		}

		// Apply sorting
		if (view.sort?.length) {
			filtered = applySort(filtered, view.sort);
		}

		// Apply limit
		if (view.limit && view.limit > 0) {
			filtered = filtered.slice(0, view.limit);
		}

		// Build rows with resolved property values
		const allPropertyKeys = collectPropertyKeys(filtered, view.order, formulas);
		const rows: RowData[] = filtered.map((note) => ({
			path: note.path,
			fileName: basename(note.path, extname(note.path)),
			values: resolveProperties(note, allPropertyKeys, formulas),
		}));

		// Apply grouping
		const groups = view.groupBy
			? applyGrouping(rows, view.groupBy)
			: [{ label: null, rows }];

		// Build column definitions
		const orderedKeys = view.order ?? allPropertyKeys;
		const columns: ColumnDef[] = orderedKeys.map((key) => ({
			key,
			displayName: propertyConfig[key]?.displayName ?? formatPropertyName(key),
			width: view.columnSize?.[key],
		}));

		return {
			name: view.name ?? "View",
			type: view.type ?? "table",
			columns,
			groups,
			totalCount: rows.length,
		};
	});

	return { views: evaluatedViews };
}

// ── Filter evaluation ──

function applyFilter(notes: ParsedNote[], filter: FilterGroup | FilterExpr): ParsedNote[] {
	if (typeof filter === "string") {
		return notes.filter((note) => evaluateFilterExpr(note, filter));
	}

	if (filter.and) {
		let result = notes;
		for (const entry of filter.and) {
			result = applyFilter(result, entry);
		}
		return result;
	}

	if (filter.or) {
		const sets = filter.or.map((entry) => new Set(applyFilter(notes, entry).map((n) => n.path)));
		return notes.filter((note) => sets.some((s) => s.has(note.path)));
	}

	if (filter.not) {
		const excluded = new Set(applyFilter(notes, filter.not).map((n) => n.path));
		return notes.filter((note) => !excluded.has(note.path));
	}

	return notes;
}

function evaluateFilterExpr(note: ParsedNote, expr: string): boolean {
	const trimmed = expr.trim();

	// file.inFolder("path")
	const inFolderMatch = trimmed.match(/^file\.inFolder\(["'](.+?)["']\)$/);
	if (inFolderMatch) {
		const folder = inFolderMatch[1];
		const noteDir = dirname(note.path);
		return noteDir === folder || noteDir.startsWith(folder + "/");
	}

	// file.hasTag("tag")
	const hasTagMatch = trimmed.match(/^file\.hasTag\(["'](.+?)["']\)$/);
	if (hasTagMatch) {
		const tag = hasTagMatch[1].replace(/^#/, "");
		return note.tags.some((t) => t.replace(/^#/, "") === tag);
	}

	// file.hasLink("link")
	const hasLinkMatch = trimmed.match(/^file\.hasLink\(["'](.+?)["']\)$/);
	if (hasLinkMatch) {
		const link = hasLinkMatch[1].toLowerCase();
		return note.wikilinks.some((l) => l.toLowerCase() === link);
	}

	// file.hasProperty("prop")
	const hasPropMatch = trimmed.match(/^file\.hasProperty\(["'](.+?)["']\)$/);
	if (hasPropMatch) {
		return hasPropMatch[1] in note.frontmatter;
	}

	// file.ext == "md" / file.ext != "md"
	const extMatch = trimmed.match(/^file\.ext\s*(==|!=)\s*["'](.+?)["']$/);
	if (extMatch) {
		const noteExt = extname(note.path).replace(/^\./, "");
		return extMatch[1] === "==" ? noteExt === extMatch[2] : noteExt !== extMatch[2];
	}

	// file.name comparisons
	const fileNameMatch = trimmed.match(/^file\.name\s*(==|!=|contains|startsWith|endsWith)\s*["'](.+?)["']$/);
	if (fileNameMatch) {
		const fileName = basename(note.path, extname(note.path));
		const [, op, val] = fileNameMatch;
		switch (op) {
			case "==": return fileName === val;
			case "!=": return fileName !== val;
			case "contains": return fileName.includes(val);
			case "startsWith": return fileName.startsWith(val);
			case "endsWith": return fileName.endsWith(val);
		}
	}

	// file.folder comparisons
	const fileFolderMatch = trimmed.match(/^file\.folder\s*(==|!=)\s*["'](.+?)["']$/);
	if (fileFolderMatch) {
		const noteDir = dirname(note.path);
		return fileFolderMatch[1] === "==" ? noteDir === fileFolderMatch[2] : noteDir !== fileFolderMatch[2];
	}

	// note.property comparisons: note.status == "done", note.count > 5, etc.
	const notePropMatch = trimmed.match(/^(?:note\.)?(\w[\w-]*)\s*(==|!=|>|<|>=|<=)\s*["']?(.+?)["']?$/);
	if (notePropMatch) {
		const [, prop, op, rawVal] = notePropMatch;
		// Skip file.* properties that weren't already matched
		if (prop === "file") return true;
		const noteVal = note.frontmatter[prop];
		return compareValues(noteVal, op, rawVal);
	}

	// note.property.contains("value")
	const propContainsMatch = trimmed.match(/^(?:note\.)?(\w[\w-]*)\.contains\(["'](.+?)["']\)$/);
	if (propContainsMatch) {
		const [, prop, val] = propContainsMatch;
		const noteVal = note.frontmatter[prop];
		if (Array.isArray(noteVal)) return noteVal.some((v) => String(v) === val);
		if (typeof noteVal === "string") return noteVal.includes(val);
		return false;
	}

	// note.property.isEmpty()
	const isEmptyMatch = trimmed.match(/^(?:note\.)?(\w[\w-]*)\.isEmpty\(\)$/);
	if (isEmptyMatch) {
		const val = note.frontmatter[isEmptyMatch[1]];
		return val === undefined || val === null || val === "" || (Array.isArray(val) && val.length === 0);
	}

	// Fallback: unrecognized expression passes through
	return true;
}

function compareValues(noteVal: unknown, op: string, rawVal: string): boolean {
	if (noteVal === undefined || noteVal === null) {
		return op === "!=" ? true : false;
	}

	// Try numeric comparison
	const numNote = Number(noteVal);
	const numRaw = Number(rawVal);
	if (!isNaN(numNote) && !isNaN(numRaw)) {
		switch (op) {
			case "==": return numNote === numRaw;
			case "!=": return numNote !== numRaw;
			case ">": return numNote > numRaw;
			case "<": return numNote < numRaw;
			case ">=": return numNote >= numRaw;
			case "<=": return numNote <= numRaw;
		}
	}

	// String comparison
	const strNote = String(noteVal);
	const strRaw = rawVal;
	switch (op) {
		case "==": return strNote === strRaw;
		case "!=": return strNote !== strRaw;
		case ">": return strNote > strRaw;
		case "<": return strNote < strRaw;
		case ">=": return strNote >= strRaw;
		case "<=": return strNote <= strRaw;
	}

	return false;
}

// ── Sorting ──

function applySort(notes: ParsedNote[], sorts: SortConfig[]): ParsedNote[] {
	return [...notes].sort((a, b) => {
		for (const sort of sorts) {
			const aVal = getPropertyValue(a, sort.property);
			const bVal = getPropertyValue(b, sort.property);
			const cmp = compareForSort(aVal, bVal);
			if (cmp !== 0) return sort.direction === "DESC" ? -cmp : cmp;
		}
		return 0;
	});
}

function compareForSort(a: unknown, b: unknown): number {
	if (a === undefined || a === null) return b === undefined || b === null ? 0 : 1;
	if (b === undefined || b === null) return -1;

	const numA = Number(a);
	const numB = Number(b);
	if (!isNaN(numA) && !isNaN(numB)) return numA - numB;

	return String(a).localeCompare(String(b), undefined, { sensitivity: "base" });
}

// ── Grouping ──

function applyGrouping(rows: RowData[], groupBy: { property: string; direction?: "ASC" | "DESC" }): GroupData[] {
	const groups = new Map<string, RowData[]>();

	for (const row of rows) {
		const val = row.values[groupBy.property];
		const label = val !== undefined && val !== null ? String(val) : "(empty)";
		if (!groups.has(label)) groups.set(label, []);
		groups.get(label)!.push(row);
	}

	const sorted = [...groups.entries()].sort(([a], [b]) => {
		const cmp = a.localeCompare(b, undefined, { sensitivity: "base" });
		return groupBy.direction === "DESC" ? -cmp : cmp;
	});

	return sorted.map(([label, rows]) => ({ label, rows }));
}

// ── Property resolution ──

function getPropertyValue(note: ParsedNote, key: string): unknown {
	// File properties
	if (key === "file.name") return basename(note.path, extname(note.path));
	if (key === "file.path") return note.path;
	if (key === "file.folder") return dirname(note.path);
	if (key === "file.ext") return extname(note.path).replace(/^\./, "");
	if (key === "file.tags") return note.tags;
	if (key === "file.links") return note.wikilinks;

	// Frontmatter property (with or without note. prefix)
	const propName = key.startsWith("note.") ? key.slice(5) : key;
	return note.frontmatter[propName];
}

function resolveProperties(note: ParsedNote, keys: string[], formulas: Record<string, string>): Record<string, unknown> {
	const values: Record<string, unknown> = {};
	for (const key of keys) {
		if (key in formulas) {
			// Formula evaluation is limited — just show the formula expression for now
			values[key] = getPropertyValue(note, key) ?? `=${formulas[key]}`;
		} else {
			values[key] = getPropertyValue(note, key);
		}
	}
	return values;
}

function collectPropertyKeys(notes: ParsedNote[], order: string[] | undefined, formulas: Record<string, string>): string[] {
	const keys = new Set<string>();

	// Always include file.name first
	keys.add("file.name");

	// Add ordered keys
	if (order) {
		for (const k of order) keys.add(k);
	}

	// Add formula keys
	for (const k of Object.keys(formulas)) {
		keys.add(k);
	}

	// Collect all frontmatter keys from matching notes
	for (const note of notes) {
		for (const k of Object.keys(note.frontmatter)) {
			keys.add(k);
		}
	}

	return [...keys];
}

// ── Helpers ──

function formatPropertyName(key: string): string {
	// "file.name" → "Name", "some-property" → "Some Property"
	const name = key.startsWith("file.") ? key.slice(5) : key.startsWith("note.") ? key.slice(5) : key;
	return name
		.replace(/[-_]/g, " ")
		.replace(/\b\w/g, (c) => c.toUpperCase());
}
