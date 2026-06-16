import { ViewPlugin, type PluginValue, type ViewUpdate, type EditorView } from '@codemirror/view';
import { type App, editorInfoField } from 'obsidian';
import { augmentGrid, revertTable, type GridCell } from './tableAugmenter';

/** Minimal surface the Live Preview extension needs from the plugin. */
export interface SheetsLivePreviewHost {
	app: App;
	/** Mirrors the "Native table post processing" setting. */
	isEnabled(): boolean;
}

/**
 * Obsidian renders each Markdown table in Live Preview as an interactive
 * CodeMirror block widget (`.cm-table-widget`) that rebuilds its own DOM. The
 * reading-mode post-processor never runs here, and any DOM we change is wiped on
 * the next rebuild – so we re-apply our table features from a ViewPlugin,
 * deferred to the next frame so it lands *after* Obsidian rebuilds the widget.
 *
 * Crucially, while the user is interacting with a table we must leave Obsidian's
 * native grid alone: its internal model still has every cell, so a merged
 * (colspan/rowspan + hidden) layout desyncs from the model and breaks selection
 * and cell editing. We detect "this table is active" (focus inside it, the doc
 * selection overlaps it, or it has selected cells) and revert just that table,
 * and additionally un-merge synchronously on `mousedown` so a click lands on the
 * real native cell rather than a merged placeholder.
 *
 * These widgets are private API: we read `child.widget.{rows,tableEl,start,end,
 * selectedCells}` and each cell's `{text, el, contentEl}`, all defensively.
 */

interface InternalCell {
	text?: string;
	el?: HTMLTableCellElement;
	contentEl?: HTMLElement;
}
interface InternalTableWidget {
	rows?: InternalCell[][];
	tableEl?: HTMLTableElement;
	start?: number;
	end?: number;
	selectedCells?: unknown[];
}

function getTableWidgets(view: EditorView): InternalTableWidget[] {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	const docView = (view as any).docView;
	const children = docView?.children;
	if (!Array.isArray(children)) return [];
	const widgets: InternalTableWidget[] = [];
	for (const child of children) {
		const dom: HTMLElement | undefined = child?.dom;
		if (!dom?.classList?.contains('cm-table-widget')) continue;
		const widget: InternalTableWidget | undefined = child.widget;
		if (widget?.rows) widgets.push(widget);
	}
	return widgets;
}

/**
 * Is the user currently interacting with this table? Obsidian edits a cell in a
 * nested editor, so the outer `view.hasFocus` is unreliable – we instead check
 * whether the active element lives inside the table, the document selection
 * overlaps the table's source range, or the widget has a cell selection.
 */
function isTableActive(widget: InternalTableWidget, view: EditorView): boolean {
	const start = widget.start ?? -1;
	const end = widget.end ?? -1;
	if (start >= 0 && end >= 0) {
		const sel = view.state.selection.main;
		if (sel.to >= start && sel.from <= end) return true;
	}
	const active = (view.root as Document | ShadowRoot).activeElement;
	if (active && widget.tableEl?.contains(active)) return true;
	if (Array.isArray(widget.selectedCells) && widget.selectedCells.length > 0) return true;
	return false;
}

function augmentEditor(view: EditorView, host: SheetsLivePreviewHost) {
	const widgets = getTableWidgets(view);
	if (!widgets.length) return;

	// Honour the global setting and the per-file `disable-sheet: true` frontmatter.
	const file = view.state.field(editorInfoField, false)?.file;
	const frontmatterDisabled =
		!!file && host.app.metadataCache.getFileCache(file)?.frontmatter?.['disable-sheet'] === true;
	const enabled = host.isEnabled() && !frontmatterDisabled;

	for (const widget of widgets) {
		// Disabled, or being edited/selected → show Obsidian's plain native grid.
		if (!enabled || isTableActive(widget, view)) {
			if (widget.tableEl) revertTable(widget.tableEl);
			continue;
		}

		const grid: GridCell[][] = (widget.rows || []).map(row =>
			row
				.filter(cell => cell?.el)
				.map(cell => ({
					text: String(cell.text ?? ''),
					el: cell.el as HTMLTableCellElement,
					contentEl: cell.contentEl,
				}))
		);
		if (grid.length) augmentGrid(grid);
	}
}

export function sheetsLivePreviewExtension(host: SheetsLivePreviewHost) {
	return ViewPlugin.fromClass(
		class implements PluginValue {
			private frame = 0;

			constructor(private view: EditorView) {
				this.view.dom.addEventListener('mousedown', this.onMouseDown, true);
				this.view.dom.addEventListener('focusin', this.onInteract);
				this.view.dom.addEventListener('focusout', this.onInteract);
				this.view.dom.addEventListener('mouseup', this.onInteract);
				this.schedule();
			}

			update(_update: ViewUpdate) {
				// Re-run on any update (coalesced to one pass per frame). Cheap and
				// idempotent; guarantees we re-apply after Obsidian rebuilds a widget
				// and revert promptly when interaction or the setting changes.
				this.schedule();
			}

			/**
			 * Un-merge the table under the pointer *synchronously* in the capture
			 * phase, before Obsidian positions the cursor, so the click targets the
			 * real native cell instead of a merged placeholder.
			 */
			private onMouseDown = (event: MouseEvent) => {
				const target = event.target as Node | null;
				if (target) {
					for (const widget of getTableWidgets(this.view)) {
						if (widget.tableEl?.contains(target)) {
							revertTable(widget.tableEl);
							break;
						}
					}
				}
				this.schedule();
			};

			private onInteract = () => this.schedule();

			private schedule() {
				if (this.frame) cancelAnimationFrame(this.frame);
				this.frame = requestAnimationFrame(() => {
					this.frame = 0;
					try {
						augmentEditor(this.view, host);
					} catch (e) {
						console.error('[Sheets] live preview augmentation failed', e);
					}
				});
			}

			destroy() {
				if (this.frame) cancelAnimationFrame(this.frame);
				this.view.dom.removeEventListener('mousedown', this.onMouseDown, true);
				this.view.dom.removeEventListener('focusin', this.onInteract);
				this.view.dom.removeEventListener('focusout', this.onInteract);
				this.view.dom.removeEventListener('mouseup', this.onInteract);
			}
		}
	);
}
