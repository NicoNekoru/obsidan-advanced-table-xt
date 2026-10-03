import * as JSON5 from 'json5';
import type { Properties } from 'csstype';

/**
 * Pure, DOM-free parsing of Sheets Extended directives.
 *
 * Sheets Extended overlays a small directive language on top of ordinary
 * Markdown table cells. None of this requires re-rendering the cell content –
 * everything here works from the raw source text of a cell so that the result
 * can be applied on top of Obsidian's *native* table rendering (both reading
 * mode and the Live Preview table widget).
 */

export const MERGE_LEFT = '<';
export const MERGE_UP = '^';

export function isSheetDisabled(frontmatter: unknown): boolean {
	return !!frontmatter && typeof frontmatter === 'object' &&
		(frontmatter as Record<string, unknown>)['disable-sheet'] === true;
}

/**
 * Matches the start of a class/JSON style suffix. Escape and code-span checks
 * are handled by findStyleSeparator rather than regex lookbehind.
 */
export const CELL_STYLE_SEPARATOR = /~(?=\s*[.{])/;

/** Find a style suffix, ignoring escapes, code spans and other plugins' tildes. */
export function findStyleSeparator(text: string): number {
	let codeTicks = 0;
	for (let i = 0; i < text.length; i++) {
		if (text[i] === '\\') { i++; continue; }
		if (text[i] === '`') {
			let ticks = 1;
			while (text[i + ticks] === '`') ticks++;
			if (codeTicks === ticks) codeTicks = 0;
			else if (!codeTicks && text.indexOf('`'.repeat(ticks), i + ticks) >= 0) codeTicks = ticks;
			i += ticks - 1;
			continue;
		}
		if (!codeTicks && text[i] === '~' && !/[~=]/.test(text[i - 1] || '') &&
			text.slice(i).search(CELL_STYLE_SEPARATOR) === 0) {
			return i;
		}
	}
	return -1;
}

/** A cell that contains only dashes (with optional alignment colons). */
const DASH_ONLY = /^\s*:?-+:?\s*$/;

export interface ParsedCell {
	/** The original, untrimmed source text of the cell. */
	raw: string;
	/** The trimmed source text. */
	trimmed: string;
	/** The portion before the `~` style separator (what should remain visible). */
	visible: string;
	/** `true` when the cell is exactly `<` (merge into the cell on the left). */
	mergeLeft: boolean;
	/** `true` when the cell is exactly `^` (merge into the cell above). */
	mergeUp: boolean;
	/** `true` when the cell is dashes only (a header delimiter / vertical-header marker). */
	dashOnly: boolean;
	/** `true` when the cell carries a `~ ...` style directive. */
	hasStyle: boolean;
	/** CSS class names declared after `~` (without the leading dot). */
	classes: string[];
	/** Inline style object declared after `~` as a `{ ... }` JSON5 literal. */
	style: Properties;
	/** Text alignment derived from delimiter colons, if any. */
	align?: 'left' | 'right' | 'center';
}

/**
 * Parse the inline `~ .class { "css": "value" }` style directive that may
 * trail any cell. Returns the declared classes and inline style object.
 */
export function parseStyleDirective(directive: string): { classes: string[]; style: Properties } {
	// Pull the inline `{ ... }` literal out first so that decimal points inside
	// it (e.g. `0.5em`) are never mistaken for class selectors.
	const inlineMatch = directive.match(/\{[\s\S]*\}/);
	const inline = inlineMatch?.[0];
	const classPart = inlineMatch ? directive.replace(inlineMatch[0], '') : directive;

	const classes = Array.from(classPart.matchAll(/\.([^\s.{}]+)/g), match => match[1]);

	let style: Properties = {};
	if (inline) {
		try {
			const value: unknown = JSON5.parse(inline);
			if (value && typeof value === 'object' && !Array.isArray(value)) {
				style = Object.fromEntries(Object.entries(value).filter(([, v]) =>
					typeof v === 'string' || typeof v === 'number'));
			}
		} catch {
			console.error(`[Sheets] Invalid cell style \`${inline}\``);
		}
	}
	return { classes, style };
}

/** Parse a single raw cell into a structured {@link ParsedCell}. */
export function parseCell(raw: string): ParsedCell {
	const trimmed = raw.trim();

	const separator = findStyleSeparator(raw);
	const hasStyle = separator >= 0;
	const visible = hasStyle ? raw.slice(0, separator) : raw;
	const directive = hasStyle ? raw.slice(separator + 1) : '';

	const { classes, style } = hasStyle
		? parseStyleDirective(directive)
		: { classes: [], style: {} as Properties };

	// Alignment is derived from the (style-stripped) visible text for dash cells.
	const dashCandidate = visible.trim();
	let align: ParsedCell['align'];
	if (DASH_ONLY.test(dashCandidate)) {
		const left = dashCandidate.startsWith(':');
		const right = dashCandidate.endsWith(':');
		if (left && right) align = 'center';
		else if (right) align = 'right';
		else if (left) align = 'left';
	}

	return {
		raw,
		trimmed,
		visible,
		mergeLeft: visible.trim() === MERGE_LEFT,
		mergeUp: visible.trim() === MERGE_UP,
		dashOnly: DASH_ONLY.test(visible.trim()),
		hasStyle,
		classes,
		style,
		align,
	};
}

/**
 * Split raw Markdown table source into a trimmed grid of cell strings,
 * dropping the leading/trailing empty cells produced by the outer pipes.
 * Lines without a pipe are ignored.
 */
export function splitTableSource(source: string): string[][] {
	return source
		.split('\n')
		.map(line => {
			const cells: string[] = [];
			let start = 0;
			for (let i = 0; i < line.length; i++) {
				if (line[i] === '\\') { i++; continue; }
				if (line[i] === '|') {
					cells.push(line.slice(start, i).trim());
					start = i + 1;
				}
			}
			if (!cells.length) return [];
			cells.push(line.slice(start).trim());
			// Drop the empty cell before the first pipe and after the last pipe.
			if (cells.length && cells[0] === '') cells.shift();
			if (cells.length && cells[cells.length - 1] === '') cells.pop();
			return cells;
		})
		.filter(row => row.length > 0);
}

/** Index of the all-dashes delimiter row (the `| --- | --- |` line), or -1. */
export function findDelimiterRow(grid: string[][]): number {
	return grid.findIndex(row => row.length > 0 && row.every(cell => parseCell(cell).dashOnly));
}

/**
 * Index of an all-dashes column (a vertical-header marker), evaluated against a
 * grid that has the delimiter row removed. Returns -1 when there is none.
 */
export function findHeaderColumn(gridWithoutDelimiter: string[][]): number {
	if (!gridWithoutDelimiter.length) return -1;
	const width = Math.max(...gridWithoutDelimiter.map(r => r.length));
	for (let col = 0; col < width; col++) {
		let sawDash = false;
		const allDash = gridWithoutDelimiter.every(row => {
			if (col >= row.length) return true; // ragged row – treat as non-blocking
			const parsed = parseCell(row[col]);
			if (parsed.dashOnly) sawDash = true;
			return parsed.dashOnly || (col > 0 && parsed.mergeLeft);
		});
		if (sawDash && allDash) return col;
	}
	return -1;
}
