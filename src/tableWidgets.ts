/** Private Obsidian table fields, checked before use. */
export interface InternalCell {
	text?: string;
	el?: HTMLTableCellElement;
	contentEl?: HTMLElement;
}

export interface InternalTableWidget {
	rows?: InternalCell[][];
	tableEl?: HTMLTableElement;
	start?: number;
	end?: number;
	selectedCells?: unknown[];
}

interface WidgetDOM extends HTMLElement {
	// CodeMirror 6.39 replaced content views with tiles in Obsidian 1.13.
	cmTile?: { widget?: InternalTableWidget };
	cmView?: { widget?: InternalTableWidget };
}

/** Discover rendered tables without depending on CodeMirror's document tree. */
export function getTableWidgets(editorDOM: HTMLElement): InternalTableWidget[] {
	const widgets: InternalTableWidget[] = [];
	for (const dom of Array.from(editorDOM.querySelectorAll<WidgetDOM>('.cm-table-widget'))) {
		// Ignore widgets belonging to embedded/nested editors.
		if (dom.closest('.cm-editor') !== editorDOM) continue;
		const widget = dom.cmTile?.widget ?? dom.cmView?.widget;
		if (Array.isArray(widget?.rows) && widget?.tableEl?.tagName === 'TABLE') {
			widgets.push(widget);
		}
	}
	return widgets;
}
