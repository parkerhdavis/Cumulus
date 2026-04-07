/**
 * Expression evaluator for Obsidian Bases formulas.
 *
 * Supports:
 * - Property access: file.folder, note.prop, note["prop-name"]
 * - Method calls: .split(), .slice(), .contains(), .startsWith(), .endsWith(),
 *   .lower(), .upper(), .trim(), .replace(), .join(), .length, .abs(), .round(),
 *   .ceil(), .floor(), .toFixed(), .isEmpty(), .toString(), .toNumber()
 * - Array indexing: [n]
 * - Arithmetic: +, -, *, /, %
 * - Comparisons: ==, !=, >, <, >=, <=
 * - Boolean: &&, ||, !
 * - String concatenation with +
 * - Built-in functions: if(), number(), min(), max(), now(), today()
 * - Literals: numbers, strings (double/single quoted), true, false, null
 */

import { basename, dirname, extname } from "node:path";
import type { ParsedNote } from "./parser.js";

// ── Context ──

export interface FormulaContext {
	note: Record<string, unknown>;
	file: {
		name: string;
		path: string;
		folder: string;
		ext: string;
		tags: string[];
		links: string[];
	};
}

export function buildFormulaContext(note: ParsedNote): FormulaContext {
	return {
		note: note.frontmatter,
		file: {
			name: basename(note.path, extname(note.path)),
			path: note.path,
			folder: dirname(note.path),
			ext: extname(note.path).replace(/^\./, ""),
			tags: note.tags,
			links: note.wikilinks,
		},
	};
}

// ── Tokenizer ──

type TokenType =
	| "number" | "string" | "ident" | "op" | "lparen" | "rparen"
	| "lbracket" | "rbracket" | "dot" | "comma" | "eof";

interface Token {
	type: TokenType;
	value: string | number;
}

function tokenize(expr: string): Token[] {
	const tokens: Token[] = [];
	let i = 0;

	while (i < expr.length) {
		const ch = expr[i];

		// Skip whitespace
		if (/\s/.test(ch)) { i++; continue; }

		// Number
		if (/\d/.test(ch) || (ch === "-" && i + 1 < expr.length && /\d/.test(expr[i + 1]) && (tokens.length === 0 || ["op", "lparen", "lbracket", "comma"].includes(tokens[tokens.length - 1].type)))) {
			let num = "";
			if (ch === "-") { num += "-"; i++; }
			while (i < expr.length && /[\d.]/.test(expr[i])) { num += expr[i]; i++; }
			tokens.push({ type: "number", value: parseFloat(num) });
			continue;
		}

		// String (double or single quoted)
		if (ch === '"' || ch === "'") {
			const quote = ch;
			i++;
			let str = "";
			while (i < expr.length && expr[i] !== quote) {
				if (expr[i] === "\\" && i + 1 < expr.length) {
					i++;
					str += expr[i];
				} else {
					str += expr[i];
				}
				i++;
			}
			i++; // skip closing quote
			tokens.push({ type: "string", value: str });
			continue;
		}

		// Two-char operators
		if (i + 1 < expr.length) {
			const two = expr.slice(i, i + 2);
			if (["==", "!=", ">=", "<=", "&&", "||"].includes(two)) {
				tokens.push({ type: "op", value: two });
				i += 2;
				continue;
			}
		}

		// Single-char operators and punctuation
		if ("+-*/%><!".includes(ch)) {
			tokens.push({ type: "op", value: ch });
			i++;
			continue;
		}

		if (ch === "(") { tokens.push({ type: "lparen", value: "(" }); i++; continue; }
		if (ch === ")") { tokens.push({ type: "rparen", value: ")" }); i++; continue; }
		if (ch === "[") { tokens.push({ type: "lbracket", value: "[" }); i++; continue; }
		if (ch === "]") { tokens.push({ type: "rbracket", value: "]" }); i++; continue; }
		if (ch === ".") { tokens.push({ type: "dot", value: "." }); i++; continue; }
		if (ch === ",") { tokens.push({ type: "comma", value: "," }); i++; continue; }

		// Identifier (letters, digits, underscore, hyphen)
		if (/[a-zA-Z_]/.test(ch)) {
			let id = "";
			while (i < expr.length && /[\w-]/.test(expr[i])) { id += expr[i]; i++; }
			tokens.push({ type: "ident", value: id });
			continue;
		}

		// Skip unknown characters
		i++;
	}

	tokens.push({ type: "eof", value: "" });
	return tokens;
}

// ── Parser / Evaluator ──

class Parser {
	private tokens: Token[];
	private pos: number;
	private ctx: FormulaContext;
	private formulaResolver?: (name: string) => unknown;

	constructor(tokens: Token[], ctx: FormulaContext, formulaResolver?: (name: string) => unknown) {
		this.tokens = tokens;
		this.pos = 0;
		this.ctx = ctx;
		this.formulaResolver = formulaResolver;
	}

	private peek(): Token {
		return this.tokens[this.pos] ?? { type: "eof", value: "" };
	}

	private advance(): Token {
		const t = this.tokens[this.pos];
		this.pos++;
		return t ?? { type: "eof", value: "" };
	}

	private expect(type: TokenType): Token {
		const t = this.peek();
		if (t.type !== type) return t; // graceful: don't crash
		return this.advance();
	}

	private match(type: TokenType, value?: string | number): boolean {
		const t = this.peek();
		if (t.type === type && (value === undefined || t.value === value)) {
			this.advance();
			return true;
		}
		return false;
	}

	// ── Grammar ──

	parse(): unknown {
		const result = this.expression();
		return result;
	}

	private expression(): unknown {
		return this.or();
	}

	private or(): unknown {
		let left = this.and();
		while (this.match("op", "||")) {
			const right = this.and();
			left = isTruthy(left) || isTruthy(right);
		}
		return left;
	}

	private and(): unknown {
		let left = this.comparison();
		while (this.match("op", "&&")) {
			const right = this.comparison();
			left = isTruthy(left) && isTruthy(right);
		}
		return left;
	}

	private comparison(): unknown {
		let left = this.addition();
		const t = this.peek();
		if (t.type === "op" && ["==", "!=", ">", "<", ">=", "<="].includes(t.value as string)) {
			const op = this.advance().value as string;
			const right = this.addition();
			return evalComparison(left, op, right);
		}
		return left;
	}

	private addition(): unknown {
		let left = this.multiplication();
		while (true) {
			const t = this.peek();
			if (t.type === "op" && (t.value === "+" || t.value === "-")) {
				const op = this.advance().value as string;
				const right = this.multiplication();
				if (op === "+") {
					// String concatenation if either side is a string (and not both numbers)
					const nL = Number(left), nR = Number(right);
					if (typeof left === "string" || typeof right === "string") {
						left = String(left ?? "") + String(right ?? "");
					} else if (!isNaN(nL) && !isNaN(nR)) {
						left = nL + nR;
					} else {
						left = String(left ?? "") + String(right ?? "");
					}
				} else {
					left = toNum(left) - toNum(right);
				}
			} else {
				break;
			}
		}
		return left;
	}

	private multiplication(): unknown {
		let left = this.unary();
		while (true) {
			const t = this.peek();
			if (t.type === "op" && (t.value === "*" || t.value === "/" || t.value === "%")) {
				const op = this.advance().value as string;
				const right = this.unary();
				if (op === "*") left = toNum(left) * toNum(right);
				else if (op === "/") { const d = toNum(right); left = d === 0 ? null : toNum(left) / d; }
				else left = toNum(left) % toNum(right);
			} else {
				break;
			}
		}
		return left;
	}

	private unary(): unknown {
		if (this.match("op", "!")) {
			return !isTruthy(this.unary());
		}
		if (this.peek().type === "op" && this.peek().value === "-") {
			// Check if this is a unary minus (not handled by number tokenization)
			this.advance();
			return -toNum(this.unary());
		}
		return this.postfix();
	}

	private postfix(): unknown {
		let value = this.primary();

		while (true) {
			// Property access: .identifier
			if (this.peek().type === "dot") {
				this.advance();
				const ident = this.peek();
				if (ident.type !== "ident") break;
				const name = this.advance().value as string;

				// Check if it's a method call: .method(args)
				if (this.peek().type === "lparen") {
					this.advance(); // consume (
					const args = this.parseArgs();
					this.match("rparen"); // consume )
					value = evalMethod(value, name, args);
				} else {
					// Property access or field
					value = evalPropertyAccess(value, name);
				}
				continue;
			}

			// Array indexing: [expr]
			if (this.peek().type === "lbracket") {
				this.advance(); // consume [
				const index = this.expression();
				this.match("rbracket"); // consume ]
				value = evalIndex(value, index);
				continue;
			}

			break;
		}

		return value;
	}

	private primary(): unknown {
		const t = this.peek();

		// Number literal
		if (t.type === "number") {
			this.advance();
			return t.value;
		}

		// String literal
		if (t.type === "string") {
			this.advance();
			return t.value;
		}

		// Parenthesized expression
		if (t.type === "lparen") {
			this.advance();
			const val = this.expression();
			this.match("rparen");
			return val;
		}

		// Identifier
		if (t.type === "ident") {
			const name = this.advance().value as string;

			// Keywords
			if (name === "true") return true;
			if (name === "false") return false;
			if (name === "null") return null;

			// Built-in functions
			if (this.peek().type === "lparen") {
				this.advance(); // consume (
				const args = this.parseArgs();
				this.match("rparen"); // consume )
				return this.evalFunction(name, args);
			}

			// Named references: note, file, formula, this
			if (name === "note") return this.ctx.note;
			if (name === "file") return this.ctx.file;
			if (name === "formula") {
				// formula.name — resolved via postfix dot access
				return { __type: "formula_ref" };
			}

			// Bare identifier — treat as note property shorthand
			return this.ctx.note[name];
		}

		// Fallback: consume and return null
		this.advance();
		return null;
	}

	private parseArgs(): unknown[] {
		const args: unknown[] = [];
		if (this.peek().type === "rparen") return args;

		args.push(this.expression());
		while (this.match("comma")) {
			args.push(this.expression());
		}
		return args;
	}

	private evalFunction(name: string, args: unknown[]): unknown {
		switch (name) {
			case "if":
				return isTruthy(args[0]) ? args[1] : (args[2] ?? null);
			case "number":
				return args[0] != null ? Number(args[0]) : null;
			case "min":
				return Math.min(...args.filter((a) => a != null).map(toNum));
			case "max":
				return Math.max(...args.filter((a) => a != null).map(toNum));
			case "now":
			case "today":
				return new Date().toISOString().slice(0, 10);
			case "list":
				return args;
			case "link":
				return args[0] != null ? String(args[0]) : null;
			case "escapeHTML":
				return args[0] != null ? String(args[0]).replace(/[&<>"']/g, (c) =>
					({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] ?? c)) : null;
			default:
				return null;
		}
	}
}

// ── Value operations ──

function isTruthy(v: unknown): boolean {
	if (v === null || v === undefined || v === false || v === "" || v === 0) return false;
	if (Array.isArray(v) && v.length === 0) return false;
	return true;
}

function toNum(v: unknown): number {
	if (v === null || v === undefined) return 0;
	const n = Number(v);
	return isNaN(n) ? 0 : n;
}

function evalComparison(left: unknown, op: string, right: unknown): boolean {
	// Null handling
	if (left === null || left === undefined) {
		if (right === null || right === undefined) return op === "==" || op === ">=" || op === "<=";
		return op === "!=";
	}
	if (right === null || right === undefined) return op === "!=";

	// Numeric comparison if both sides are numeric
	const nL = Number(left), nR = Number(right);
	if (!isNaN(nL) && !isNaN(nR) && left !== "" && right !== "") {
		switch (op) {
			case "==": return nL === nR;
			case "!=": return nL !== nR;
			case ">": return nL > nR;
			case "<": return nL < nR;
			case ">=": return nL >= nR;
			case "<=": return nL <= nR;
		}
	}

	// String comparison
	const sL = String(left), sR = String(right);
	switch (op) {
		case "==": return sL === sR;
		case "!=": return sL !== sR;
		case ">": return sL > sR;
		case "<": return sL < sR;
		case ">=": return sL >= sR;
		case "<=": return sL <= sR;
	}
	return false;
}

function evalPropertyAccess(obj: unknown, prop: string): unknown {
	if (obj === null || obj === undefined) return null;

	// Formula reference: formula.name resolves to a marker
	if (obj && typeof obj === "object" && "__type" in obj && (obj as any).__type === "formula_ref") {
		// This returns a marker that the formula resolver in base-evaluator handles
		return { __type: "formula_value", name: prop };
	}

	// .length field
	if (prop === "length") {
		if (typeof obj === "string") return obj.length;
		if (Array.isArray(obj)) return obj.length;
		return 0;
	}

	// Object property access
	if (typeof obj === "object" && obj !== null) {
		return (obj as Record<string, unknown>)[prop] ?? null;
	}

	return null;
}

function evalIndex(obj: unknown, index: unknown): unknown {
	if (obj === null || obj === undefined) return null;

	// String bracket access (note["prop-name"])
	if (typeof obj === "object" && !Array.isArray(obj) && typeof index === "string") {
		return (obj as Record<string, unknown>)[index] ?? null;
	}

	// Array index
	if (Array.isArray(obj) && typeof index === "number") {
		const i = index < 0 ? obj.length + index : index;
		return obj[i] ?? null;
	}

	return null;
}

function evalMethod(obj: unknown, method: string, args: unknown[]): unknown {
	// ── String methods ──
	if (typeof obj === "string") {
		switch (method) {
			case "contains":
				return args[0] != null ? obj.includes(String(args[0])) : false;
			case "startsWith":
				return args[0] != null ? obj.startsWith(String(args[0])) : false;
			case "endsWith":
				return args[0] != null ? obj.endsWith(String(args[0])) : false;
			case "lower":
			case "toLowerCase":
				return obj.toLowerCase();
			case "upper":
			case "toUpperCase":
				return obj.toUpperCase();
			case "title":
				return obj.replace(/\b\w/g, (c) => c.toUpperCase());
			case "trim":
				return obj.trim();
			case "replace": {
				if (args.length >= 2) return obj.replaceAll(String(args[0]), String(args[1]));
				return obj;
			}
			case "split": {
				const sep = args[0] != null ? String(args[0]) : "";
				const limit = args[1] != null ? Number(args[1]) : undefined;
				return obj.split(sep, limit);
			}
			case "slice": {
				const start = args[0] != null ? Number(args[0]) : 0;
				const end = args[1] != null ? Number(args[1]) : undefined;
				return obj.slice(start, end);
			}
			case "repeat":
				return args[0] != null ? obj.repeat(Math.max(0, Number(args[0]))) : obj;
			case "reverse":
				return [...obj].reverse().join("");
			case "isEmpty":
				return obj.length === 0;
			case "toString":
				return obj;
			case "toNumber":
				return Number(obj) || null;
		}
	}

	// ── Number methods ──
	if (typeof obj === "number") {
		switch (method) {
			case "abs": return Math.abs(obj);
			case "ceil": return Math.ceil(obj);
			case "floor": return Math.floor(obj);
			case "round": return Math.round(obj);
			case "toFixed": return obj.toFixed(args[0] != null ? Number(args[0]) : 0);
			case "isEmpty": return false;
			case "toString": return String(obj);
		}
	}

	// ── Array/List methods ──
	if (Array.isArray(obj)) {
		switch (method) {
			case "contains":
				return obj.some((v) => String(v) === String(args[0]));
			case "containsAll":
				if (Array.isArray(args[0])) return (args[0] as unknown[]).every((a) => obj.some((v) => String(v) === String(a)));
				return false;
			case "containsAny":
				if (Array.isArray(args[0])) return (args[0] as unknown[]).some((a) => obj.some((v) => String(v) === String(a)));
				return false;
			case "join":
				return obj.join(args[0] != null ? String(args[0]) : ", ");
			case "flat":
				return obj.flat();
			case "reverse":
				return [...obj].reverse();
			case "slice": {
				const start = args[0] != null ? Number(args[0]) : 0;
				const end = args[1] != null ? Number(args[1]) : undefined;
				return obj.slice(start, end);
			}
			case "sort":
				return [...obj].sort();
			case "unique":
				return [...new Set(obj)];
			case "isEmpty":
				return obj.length === 0;
			case "toString":
				return obj.join(", ");
		}
	}

	// ── Null-safe ──
	if (obj === null || obj === undefined) {
		if (method === "isEmpty") return true;
		if (method === "toString") return "";
		return null;
	}

	// ── Object methods ──
	if (typeof obj === "object") {
		switch (method) {
			case "isEmpty":
				return Object.keys(obj).length === 0;
			case "keys":
				return Object.keys(obj);
			case "values":
				return Object.values(obj);
			case "toString":
				return JSON.stringify(obj);
		}
	}

	// ── Universal methods ──
	switch (method) {
		case "isEmpty":
			return obj === null || obj === undefined || obj === "";
		case "toString":
			return String(obj);
		case "isTruthy":
			return isTruthy(obj);
	}

	return null;
}

// ── Public API ──

/**
 * Evaluate a formula expression against a note context.
 *
 * @param expr The formula expression string
 * @param ctx The evaluation context (note properties, file properties)
 * @param formulaResolver Optional callback to resolve formula.X references
 * @returns The computed value, or null on error
 */
export function evaluateFormula(
	expr: string,
	ctx: FormulaContext,
	formulaResolver?: (name: string) => unknown,
): unknown {
	try {
		const tokens = tokenize(expr);
		const parser = new Parser(tokens, ctx, formulaResolver);
		let result = parser.parse();

		// Resolve formula_value markers
		if (result && typeof result === "object" && "__type" in result) {
			if ((result as any).__type === "formula_value" && formulaResolver) {
				result = formulaResolver((result as any).name);
			}
		}

		return result;
	} catch {
		return null;
	}
}
