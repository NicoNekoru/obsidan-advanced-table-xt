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

/**
 * Matches a single, un-escaped `~` (the cell-style separator) that is not part
 * of a `~~strikethrough~~`. Used to split a cell into "visible content" and
 * "trailing style directive".
 */
export const CELL_STYLE_SEPARATOR = /(?<![\\~])~(?!~)/;

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

	const classes = (classPart.match(/(?<=\.)\S+/g) || []).map(String);

	let style: Properties = {};
	if (inline) {
		try {
			style = JSON5.parse(inline);
		} catch {
			console.error(`[Sheets] Invalid cell style \`${inline}\``);
		}
	}
	return { classes, style };
}

/** Parse a single raw cell into a structured {@link ParsedCell}. */
export function parseCell(raw: string): ParsedCell {
	const trimmed = raw.trim();

	const parts = raw.split(CELL_STYLE_SEPARATOR);
	const hasStyle = parts.length > 1;
	const visible = parts[0];
	const directive = hasStyle ? parts.slice(1).join('~') : '';

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
		mergeLeft: trimmed === MERGE_LEFT,
		mergeUp: trimmed === MERGE_UP,
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
		.filter(line => /(?<!\\)\|/.test(line))
		.map(line => {
			const cells = line.split(/(?<!\\)\|/).map(c => c.trim());
			// Drop the empty cell before the first pipe and after the last pipe.
			if (cells.length && cells[0] === '') cells.shift();
			if (cells.length && cells[cells.length - 1] === '') cells.pop();
			return cells;
		})
		.filter(row => row.length > 0);
}

/** Index of the all-dashes delimiter row (the `| --- | --- |` line), or -1. */
export function findDelimiterRow(grid: string[][]): number {
	return grid.findIndex(row => row.length > 0 && row.every(cell => DASH_ONLY.test(cell)));
}

/**
 * Index of an all-dashes column (a vertical-header marker), evaluated against a
 * grid that has the delimiter row removed. Returns -1 when there is none.
 */
export function findHeaderColumn(gridWithoutDelimiter: string[][]): number {
	if (!gridWithoutDelimiter.length) return -1;
	const width = Math.max(...gridWithoutDelimiter.map(r => r.length));
	for (let col = 0; col < width; col++) {
		let sawCell = false;
		const allDash = gridWithoutDelimiter.every(row => {
			if (col >= row.length) return true; // ragged row – treat as non-blocking
			sawCell = true;
			return DASH_ONLY.test(row[col]);
		});
		if (sawCell && allDash) return col;
	}
	return -1;
}
