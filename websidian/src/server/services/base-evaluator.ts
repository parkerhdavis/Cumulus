/**
 * Evaluates Obsidian .base files against parsed vault notes.
 *
 * Supports:
 * - Filter expressions with file.* and note.* subjects
 * - Bracket notation: note["property-name"]
 * - Negation: !expression
 * - Method calls: .contains(), .isEmpty(), .startsWith(), .endsWith(),
 *   .inFolder(), .hasTag(), .hasLink(), .hasProperty()
 * - Comparisons: ==, !=, >, <, >=, <=
 * - Composite filters: and, or, not
 * - Views: table, cards, list
 * - Sorting by property (ASC/DESC)
 * - Grouping by property
 * - Property display names
 */

import { parse as parseYaml } from "yaml";
import { basename, dirname, extname } from "node:path";
import type { ParsedNote } from "./parser.js";
import { evaluateFormula, buildFormulaContext } from "./formula-evaluator.js";

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
	type?: string;
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

	const evaluatedViews: EvaluatedView[] = views
		.filter((view) => {
			const t = view.type ?? "table";
			return t === "table" || t === "cards" || t === "list";
		})
		.map((view) => {
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
				filtered = applySort(filtered, view.sort, formulas);
			}

			// Apply limit
			if (view.limit && view.limit > 0) {
				filtered = filtered.slice(0, view.limit);
			}

			// Build rows with resolved property values
			const extraKeys: string[] = [];
			if (view.groupBy?.property) extraKeys.push(view.groupBy.property);
			if (view.sort) for (const s of view.sort) extraKeys.push(s.property);
			const allPropertyKeys = collectPropertyKeys(filtered, view.order, formulas, extraKeys);
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

			const viewType = (view.type ?? "table") as "table" | "cards" | "list";

			return {
				name: view.name ?? "View",
				type: viewType,
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

/**
 * Parse and evaluate a single filter expression string.
 *
 * Supported patterns:
 *   file.inFolder("path")
 *   file.hasTag("tag")
 *   file.hasLink("link")
 *   file.hasProperty("prop")
 *   file.path.contains("str")
 *   file.name.startsWith("str")
 *   note["prop-name"].isEmpty()
 *   note["prop-name"] == "value"
 *   property == "value"
 *   !<any of the above>
 */
function evaluateFilterExpr(note: ParsedNote, expr: string): boolean {
	let trimmed = expr.trim();

	// Handle negation prefix: !expression
	let negated = false;
	if (trimmed.startsWith("!")) {
		negated = true;
		trimmed = trimmed.substring(1).trim();
	}

	const result = evaluateExprInner(note, trimmed);
	return negated ? !result : result;
}

function evaluateExprInner(note: ParsedNote, expr: string): boolean {
	// ── file-level method calls: file.inFolder(), file.hasTag(), etc. ──

	const fileMethodMatch = expr.match(/^file\.(inFolder|hasTag|hasLink|hasProperty)\(["'](.+?)["']\)$/);
	if (fileMethodMatch) {
		const [, method, arg] = fileMethodMatch;
		switch (method) {
			case "inFolder": {
				const noteDir = dirname(note.path);
				return noteDir === arg || noteDir.startsWith(arg + "/");
			}
			case "hasTag": {
				const tag = arg.replace(/^#/, "");
				return note.tags.some((t) => t.replace(/^#/, "") === tag);
			}
			case "hasLink":
				return note.wikilinks.some((l) => l.toLowerCase() === arg.toLowerCase());
			case "hasProperty":
				return arg in note.frontmatter;
		}
	}

	// ── file property method calls: file.path.contains(), file.name.startsWith(), etc. ──

	const filePropMethodMatch = expr.match(/^file\.(path|name|folder|ext)\.(contains|startsWith|endsWith|isEmpty)\((?:["'](.+?)["'])?\)$/);
	if (filePropMethodMatch) {
		const [, prop, method, arg] = filePropMethodMatch;
		const val = getFileProperty(note, prop);
		return evalStringMethod(val, method, arg);
	}

	// ── file property comparisons: file.path == "...", file.ext != "md", etc. ──

	const filePropCmpMatch = expr.match(/^file\.(path|name|folder|ext)\s*(==|!=|>|<|>=|<=)\s*["'](.+?)["']$/);
	if (filePropCmpMatch) {
		const [, prop, op, val] = filePropCmpMatch;
		const fileVal = getFileProperty(note, prop);
		return compareValues(fileVal, op, val);
	}

	// ── note["bracket-notation"] method calls: note["prop"].isEmpty(), note["prop"].contains("x") ──

	const bracketMethodMatch = expr.match(/^(?:note)?\["(.+?)"\]\.(contains|startsWith|endsWith|isEmpty)\((?:["'](.+?)["'])?\)$/);
	if (bracketMethodMatch) {
		const [, prop, method, arg] = bracketMethodMatch;
		const val = note.frontmatter[prop];
		return evalPropertyMethod(val, method, arg);
	}

	// ── note["bracket-notation"] comparisons: note["prop"] == "value" ──

	const bracketCmpMatch = expr.match(/^(?:note)?\["(.+?)"\]\s*(==|!=|>|<|>=|<=)\s*["'](.+?)["']$/);
	if (bracketCmpMatch) {
		const [, prop, op, rawVal] = bracketCmpMatch;
		const noteVal = note.frontmatter[prop];
		return compareValues(noteVal, op, rawVal);
	}

	// ── dot-notation method calls: note.prop.contains("x"), prop.isEmpty() ──

	const dotMethodMatch = expr.match(/^(?:note\.)?(\w[\w-]*)\.(contains|startsWith|endsWith|isEmpty)\((?:["'](.+?)["'])?\)$/);
	if (dotMethodMatch) {
		const [, prop, method, arg] = dotMethodMatch;
		const val = note.frontmatter[prop];
		return evalPropertyMethod(val, method, arg);
	}

	// ── dot-notation comparisons: note.status == "done", Qty > 5, etc. ──

	const dotCmpMatch = expr.match(/^(?:note\.)?(\w[\w-]*)\s*(==|!=|>|<|>=|<=)\s*["']?(.+?)["']?$/);
	if (dotCmpMatch) {
		const [, prop, op, rawVal] = dotCmpMatch;
		// Guard: don't match file.* here (already handled above)
		if (prop === "file") return true;
		const noteVal = note.frontmatter[prop];
		return compareValues(noteVal, op, rawVal);
	}

	// Fallback: unrecognized expression passes through
	return true;
}

// ── Property helpers ──

function getFileProperty(note: ParsedNote, prop: string): string {
	switch (prop) {
		case "path": return note.path;
		case "name": return basename(note.path, extname(note.path));
		case "folder": return dirname(note.path);
		case "ext": return extname(note.path).replace(/^\./, "");
		default: return "";
	}
}

function evalStringMethod(val: string, method: string, arg?: string): boolean {
	switch (method) {
		case "contains": return arg ? val.toLowerCase().includes(arg.toLowerCase()) : false;
		case "startsWith": return arg ? val.startsWith(arg) : false;
		case "endsWith": return arg ? val.endsWith(arg) : false;
		case "isEmpty": return !val || val.length === 0;
		default: return false;
	}
}

function evalPropertyMethod(val: unknown, method: string, arg?: string): boolean {
	switch (method) {
		case "isEmpty":
			return val === undefined || val === null || val === "" || (Array.isArray(val) && val.length === 0);
		case "contains":
			if (!arg) return false;
			if (Array.isArray(val)) return val.some((v) => String(v) === arg);
			if (typeof val === "string") return val.includes(arg);
			return false;
		case "startsWith":
			return typeof val === "string" && arg ? val.startsWith(arg) : false;
		case "endsWith":
			return typeof val === "string" && arg ? val.endsWith(arg) : false;
		default:
			return false;
	}
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
	switch (op) {
		case "==": return strNote === rawVal;
		case "!=": return strNote !== rawVal;
		case ">": return strNote > rawVal;
		case "<": return strNote < rawVal;
		case ">=": return strNote >= rawVal;
		case "<=": return strNote <= rawVal;
	}

	return false;
}

// ── Sorting ──

function applySort(notes: ParsedNote[], sorts: SortConfig[], formulas?: Record<string, string>): ParsedNote[] {
	return [...notes].sort((a, b) => {
		for (const sort of sorts) {
			const aVal = getPropertyValue(a, sort.property, formulas);
			const bVal = getPropertyValue(b, sort.property, formulas);
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

function getPropertyValue(note: ParsedNote, key: string, formulas?: Record<string, string>): unknown {
	// File properties
	if (key === "file.name") return basename(note.path, extname(note.path));
	if (key === "file.path") return note.path;
	if (key === "file.folder") return dirname(note.path);
	if (key === "file.ext") return extname(note.path).replace(/^\./, "");
	if (key === "file.tags") return note.tags;
	if (key === "file.links") return note.wikilinks;

	// Formula properties
	if (key.startsWith("formula.") && formulas) {
		const formulaName = key.slice(8); // strip "formula."
		const expr = formulas[formulaName];
		if (expr) {
			return evalFormulaForNote(note, expr, formulas);
		}
		return null;
	}

	// Frontmatter property (with or without note. prefix)
	const propName = key.startsWith("note.") ? key.slice(5) : key;
	return note.frontmatter[propName];
}

/** Evaluate a single formula expression for a given note, with cross-formula resolution. */
function evalFormulaForNote(note: ParsedNote, expr: string, formulas: Record<string, string>, depth = 0): unknown {
	if (depth > 10) return null; // guard against circular refs
	const ctx = buildFormulaContext(note);
	return evaluateFormula(expr, ctx, (refName) => {
		const refExpr = formulas[refName];
		if (!refExpr) return null;
		return evalFormulaForNote(note, refExpr, formulas, depth + 1);
	});
}

function resolveProperties(note: ParsedNote, keys: string[], formulas: Record<string, string>): Record<string, unknown> {
	const values: Record<string, unknown> = {};
	for (const key of keys) {
		values[key] = getPropertyValue(note, key, formulas);
	}
	return values;
}

function collectPropertyKeys(
	notes: ParsedNote[],
	order: string[] | undefined,
	formulas: Record<string, string>,
	extraKeys?: string[],
): string[] {
	const keys = new Set<string>();

	// Always include file.name first
	keys.add("file.name");

	// Add ordered keys
	if (order) {
		for (const k of order) keys.add(k);
	}

	// Add formula keys (with formula. prefix for proper resolution)
	for (const k of Object.keys(formulas)) {
		keys.add(`formula.${k}`);
	}

	// Add any extra keys (e.g. groupBy property, sort properties)
	if (extraKeys) {
		for (const k of extraKeys) keys.add(k);
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
