import {
	CELL_STYLE_SEPARATOR,
	findHeaderColumn,
	parseCell,
	type ParsedCell,
} from './tableModel';

/**
 * A single cell handed to the augmenter. `el` is the rendered `<td>`/`<th>`,
 * `text` is its raw Markdown source, and `contentEl` (when provided) is the
 * inner wrapper that holds the rendered content – in the Live Preview table
 * widget this is `.table-cell-wrapper`.
 */
export interface GridCell {
	text: string;
	el: HTMLTableCellElement;
	contentEl?: HTMLElement;
}

/** Marker classes the augmenter owns. Kept in one place for cleanup/idempotency. */
export const SHEETS_HIDDEN_CLASS = 'sheets-hidden-cell';
export const SHEETS_ROW_HEADER_CLASS = 'sheets-row-header';
export const SHEETS_MERGED_CLASS = 'sheets-merged-anchor';

const ORIGIN = new WeakMap<HTMLTableCellElement, { row: number; col: number }>();

/**
 * Undo everything {@link augmentGrid} applied to a table's cells. Used when the
 * feature is switched off so an already-rendered table reverts to plain native
 * rendering. (Stripped `~` directive text only returns on the next re-render.)
 */
export function revertTable(tableEl: HTMLTableElement): void {
	tableEl.querySelectorAll<HTMLElement>('.' + SHEETS_HIDDEN_CLASS)
		.forEach(el => el.classList.remove(SHEETS_HIDDEN_CLASS));
	tableEl.querySelectorAll<HTMLElement>('.' + SHEETS_ROW_HEADER_CLASS)
		.forEach(el => el.classList.remove(SHEETS_ROW_HEADER_CLASS));
	tableEl.querySelectorAll<HTMLTableCellElement>('.' + SHEETS_MERGED_CLASS)
		.forEach(el => {
			el.classList.remove(SHEETS_MERGED_CLASS);
			el.colSpan = 1;
			el.rowSpan = 1;
		});
}

function hide(cell: GridCell) {
	cell.el.classList.add(SHEETS_HIDDEN_CLASS);
}

function contentRoot(cell: GridCell): HTMLElement {
	return cell.contentEl || cell.el;
}

/**
 * Remove a trailing `~ .class { "css": "value" }` directive from already
 * rendered cell content, preserving any markup that precedes it. We never
 * re-render the cell – we surgically delete the directive's text from the DOM.
 */
function stripTrailingStyleDirective(root: HTMLElement) {
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	let node: Node | null;
	let target: Text | null = null;
	// The directive is always the *last* un-escaped `~`, so keep the last match.
	while ((node = walker.nextNode())) {
		if (CELL_STYLE_SEPARATOR.test((node as Text).data)) target = node as Text;
	}
	if (!target) return;

	const idx = target.data.search(CELL_STYLE_SEPARATOR);
	if (idx < 0) return;

	// Delete everything from the `~` to the end of the content root.
	const range = document.createRange();
	range.setStart(target, idx);
	range.setEnd(root, root.childNodes.length);
	range.deleteContents();

	// Trim a dangling trailing space left before the (now removed) `~`.
	const last = root.lastChild;
	if (last && last.nodeType === Node.TEXT_NODE) {
		(last as Text).data = (last as Text).data.replace(/\s+$/, '');
	}
}

function applyCellStyle(cell: GridCell, parsed: ParsedCell) {
	if (!parsed.hasStyle) return;
	if (parsed.classes.length) cell.el.classList.add(...parsed.classes);
	Object.assign(cell.el.style, parsed.style);
	stripTrailingStyleDirective(contentRoot(cell));
}

/**
 * Apply all Sheets Extended features to an already-rendered table, expressed as
 * a grid of {@link GridCell}s. The grid must be the *visual* grid (header row
 * first, no delimiter row) so it lines up 1:1 with the rendered DOM.
 *
 * This is intentionally idempotent: it derives everything from the immutable
 * cell source text, so it can be re-run after Obsidian rebuilds the Live
 * Preview widget without compounding its own changes.
 */
export function augmentGrid(grid: GridCell[][]): void {
	if (!grid.length) return;

	// Reset any previous augmentation first so a re-run (after an Obsidian
	// rebuild, or on top of stale state from an older plugin version) always
	// recomputes from scratch rather than compounding spans.
	for (const row of grid) {
		for (const cell of row) {
			cell.el.colSpan = 1;
			cell.el.rowSpan = 1;
			cell.el.classList.remove(SHEETS_HIDDEN_CLASS, SHEETS_ROW_HEADER_CLASS, SHEETS_MERGED_CLASS);
			cell.el.style.removeProperty('display');
		}
	}

	const parsed = grid.map(row => row.map(cell => parseCell(cell.text)));
	const headerCol = findHeaderColumn(grid.map(row => row.map(c => c.text)));

	// anchor[r][c] holds the visible cell that (r, c) renders into (after merges).
	const anchor: (GridCell | null)[][] = grid.map(row => row.map(() => null));

	for (let r = 0; r < grid.length; r++) {
		for (let c = 0; c < grid[r].length; c++) {
			const cell = grid[r][c];
			const p = parsed[r][c];

			// The all-dashes vertical-header marker column is removed entirely.
			if (headerCol >= 0 && c === headerCol) {
				hide(cell);
				continue;
			}

			let cellAnchor: GridCell | null = null;

			if (p.mergeLeft && c > 0 && anchor[r][c - 1]) {
				cellAnchor = anchor[r][c - 1];
				hide(cell);
			} else if (p.mergeUp && r > 0 && anchor[r - 1][c]) {
				cellAnchor = anchor[r - 1][c];
				hide(cell);
			} else if (
				r > 0 && c > 0 &&
				anchor[r - 1][c] && anchor[r][c - 1] &&
				anchor[r - 1][c] === anchor[r][c - 1]
			) {
				// Interior of a rectangular merge block.
				cellAnchor = anchor[r - 1][c];
				hide(cell);
			} else {
				cellAnchor = cell;
				ORIGIN.set(cell.el, { row: r, col: c });
			}

			anchor[r][c] = cellAnchor;

			if (cellAnchor !== cell && cellAnchor) {
				const origin = ORIGIN.get(cellAnchor.el);
				if (origin) {
					cellAnchor.el.classList.add(SHEETS_MERGED_CLASS);
					cellAnchor.el.colSpan = Math.max(cellAnchor.el.colSpan || 1, c - origin.col + 1);
					cellAnchor.el.rowSpan = Math.max(cellAnchor.el.rowSpan || 1, r - origin.row + 1);
				}
			} else {
				// Visible own-anchor cell: row-header styling + inline cell styling.
				if (headerCol > 0 && c < headerCol) cell.el.classList.add(SHEETS_ROW_HEADER_CLASS);
				applyCellStyle(cell, p);
			}
		}
	}
}
