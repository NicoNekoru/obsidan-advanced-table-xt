import {
	findStyleSeparator,
	findHeaderColumn,
	parseCell,
	type ParsedCell,
} from './tableModel';
import type { Properties } from 'csstype';

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

export interface AugmentOptions {
	classes?: Record<string, Properties>;
	tableStyle?: { classes: string[]; style: Properties };
	rows?: ParsedCell[];
	columns?: ParsedCell[];
}

interface CellChanges {
	classes: string[];
	styles: Map<string, { value: string; priority: string; applied: string }>;
	content?: {
		root: HTMLElement;
		children: Map<Node, Node[]>;
		text: Map<Text, string>;
		stripped: string;
	};
}
const CHANGES = new WeakMap<HTMLTableCellElement, CellChanges>();

function revertCell(el: HTMLTableCellElement) {
	el.classList.remove(SHEETS_HIDDEN_CLASS, SHEETS_ROW_HEADER_CLASS);
	if (el.classList.contains(SHEETS_MERGED_CLASS)) {
		el.classList.remove(SHEETS_MERGED_CLASS);
		el.colSpan = 1;
		el.rowSpan = 1;
	}
	const changes = CHANGES.get(el);
	if (!changes) return;
	el.classList.remove(...changes.classes);
	for (const [name, style] of changes.styles) {
		if (el.style.getPropertyValue(name) !== style.applied) continue;
		if (style.value) el.style.setProperty(name, style.value, style.priority);
		else el.style.removeProperty(name);
	}
	const content = changes.content;
	if (content && content.root.innerHTML === content.stripped) {
		// Keep the original nodes and their link/embed event handlers.
		for (const [node, children] of content.children) (node as Node & ParentNode).replaceChildren?.(...children);
		for (const [node, text] of content.text) node.data = text;
	}
	CHANGES.delete(el);
}

/**
 * Undo everything {@link augmentGrid} applied to a table's cells. Used when the
 * feature is switched off so an already-rendered table reverts to plain native
 * rendering, including directive text.
 */
export function revertTable(tableEl: HTMLTableElement): void {
	for (const row of Array.from(tableEl.rows)) {
		for (const cell of Array.from(row.cells)) revertCell(cell);
	}
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
function stripTrailingStyleDirective(root: HTMLElement, changes: CellChanges) {
	const doc = root.ownerDocument;
	const walker = doc.createTreeWalker(root, 4 /* SHOW_TEXT */);
	let node: Node | null;
	let target: Text | null = null;
	// The directive is always the *last* un-escaped `~`, so keep the last match.
	while ((node = walker.nextNode())) {
		if (!node.parentElement?.closest('code, pre') && findStyleSeparator((node as Text).data) >= 0) {
			target = node as Text;
		}
	}
	if (!target) return;

	const idx = findStyleSeparator(target.data);
	if (idx < 0) return;
	const children = new Map<Node, Node[]>();
	const text = new Map<Text, string>();
	const save = (node: Node) => {
		if (node.nodeType === 3) text.set(node as Text, (node as Text).data);
		else {
			children.set(node, Array.from(node.childNodes));
			for (const child of Array.from(node.childNodes)) save(child);
		}
	};
	save(root);

	// Delete everything from the `~` to the end of the content root.
	const range = doc.createRange();
	range.setStart(target, idx);
	range.setEnd(root, root.childNodes.length);
	range.deleteContents();

	// Trim a dangling trailing space left before the (now removed) `~`.
	const last = root.lastChild;
	if (last && last.nodeType === 3) {
		(last as Text).data = (last as Text).data.replace(/\s+$/, '');
	}
	changes.content = { root, children, text, stripped: root.innerHTML };
}

function applyCellStyle(cell: GridCell, parsed: ParsedCell, groups: { classes: string[]; style: Properties }[], options: AugmentOptions) {
	const changes: CellChanges = { classes: [], styles: new Map() };
	for (const group of [...groups, parsed]) {
		const styles: Properties[] = [];
		const alignment = (group as ParsedCell).align;
		if (alignment) styles.push({ textAlign: alignment });
		for (const name of group.classes) {
			if (!cell.el.classList.contains(name)) {
				cell.el.classList.add(name);
				changes.classes.push(name);
			}
			if (options.classes?.[name]) styles.push(options.classes[name]);
		}
		styles.push(group.style);
		for (const style of styles) {
			for (const [key, value] of Object.entries(style)) {
				if (typeof value !== 'string' && typeof value !== 'number') continue;
				const name = key.startsWith('--') ? key : key.replace(/[A-Z]/g, char => '-' + char.toLowerCase());
				const previous = changes.styles.get(name) ?? {
					value: cell.el.style.getPropertyValue(name),
					priority: cell.el.style.getPropertyPriority(name), applied: '',
				};
				cell.el.style.setProperty(name, String(value));
				previous.applied = cell.el.style.getPropertyValue(name);
				changes.styles.set(name, previous);
			}
		}
	}
	if (parsed.hasStyle) stripTrailingStyleDirective(contentRoot(cell), changes);
	if (changes.classes.length || changes.styles.size || changes.content) CHANGES.set(cell.el, changes);
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
export function augmentGrid(grid: GridCell[][], options: AugmentOptions = {}): void {
	if (!grid.length) return;

	// Reset any previous augmentation first so a re-run (after an Obsidian
	// rebuild, or on top of stale state from an older plugin version) always
	// recomputes from scratch rather than compounding spans.
	for (const row of grid) {
		for (const cell of row) {
			revertCell(cell.el);
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

			// The all-dashes vertical-header marker column is removed entirely, but
			// stays "transparent" to merge chaining: pointing its anchor at the cell
			// to its left lets a `<` merge across the header boundary into that cell,
			// which then keeps its own (header) identity – the merged cell inherits
			// the source cell's header-ness.
			if (headerCol >= 0 && c === headerCol) {
				hide(cell);
				anchor[r][c] = c > 0 ? anchor[r][c - 1] : null;
				continue;
			}

			let cellAnchor: GridCell | null = null;
			const above = r > 0 ? anchor[r - 1][c] : null;
			const rowGroup = cell.el.parentElement?.parentElement;
			// Upward merges must stay within one body section. Keep header rows
			// separate, including for implicit rectangular merges.
			const canMergeUp = above && rowGroup?.tagName === 'TBODY' &&
				above.el.parentElement?.parentElement === rowGroup && above.el.tagName !== 'TH';

			if (p.mergeLeft && c > 0 && anchor[r][c - 1]) {
				cellAnchor = anchor[r][c - 1];
				hide(cell);
			} else if (p.mergeUp && canMergeUp) {
				cellAnchor = above;
				hide(cell);
			} else if (
				canMergeUp && c > 0 &&
				anchor[r][c - 1] && above === anchor[r][c - 1]
			) {
				// Interior of a rectangular merge block.
				cellAnchor = above;
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
					// The vertical-header dash column is fully hidden, so the browser
					// drops it from the column grid entirely – don't count it in the
					// colspan, or the merged cell would be one column too wide.
					const crossesDash = headerCol > origin.col && headerCol < c;
					cellAnchor.el.colSpan = Math.max(
						cellAnchor.el.colSpan || 1,
						c - origin.col + 1 - (crossesDash ? 1 : 0)
					);
					cellAnchor.el.rowSpan = Math.max(cellAnchor.el.rowSpan || 1, r - origin.row + 1);
				}
			} else {
				// Visible own-anchor cell: row-header styling + inline cell styling.
				if (headerCol > 0 && c < headerCol) cell.el.classList.add(SHEETS_ROW_HEADER_CLASS);
				const groups = [options.tableStyle, options.rows?.[r], options.columns?.[c]]
					.filter((group): group is { classes: string[]; style: Properties } => !!group);
				applyCellStyle(cell, p, groups, options);
			}
		}
	}
}
