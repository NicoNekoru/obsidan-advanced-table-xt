import {
	type App,
	type MarkdownPostProcessorContext,
	MarkdownRenderChild,
	MarkdownRenderer,
} from 'obsidian';
import type { Properties } from 'csstype';
import * as JSON5 from 'json5';
import { augmentGrid, type GridCell, type AugmentOptions } from './tableAugmenter';
import { findDelimiterRow, findHeaderColumn, parseCell, parseStyleDirective, splitTableSource } from './tableModel';

export interface ISheetMetaData {
	classes: Record<string, Properties>;
	log: boolean;
}

/** Render fenced sheets into a real table on desktop and mobile. */
export class SheetElement extends MarkdownRenderChild {
	private disposed = false;
	constructor(
		private readonly el: HTMLElement,
		private readonly source: string,
		private readonly ctx: MarkdownPostProcessorContext,
		private readonly app: App,
	) {
		super(el);
	}

	onload() {
		this.disposed = false;
		void this.renderTable().catch((error: unknown) => {
			if (this.disposed) return;
			this.el.replaceChildren();
			const message = this.el.createDiv();
			message.className = 'obs-sheets_error';
			message.textContent = `Sheets Extended: ${error instanceof Error ? error.message : String(error)}`;
		});
	}

	onunload() {
		this.disposed = true;
	}

	private async renderTable() {
		const lines = this.source.split('\n');
		const separator = lines.findIndex(line => /^---(?:\s*~.*)?\s*$/.test(line));
		let metadata: Partial<ISheetMetaData> = {};
		let tableStyle: AugmentOptions['tableStyle'];
		let source = this.source;
		if (separator >= 0) {
			const metaSource = lines.slice(0, separator).join('\n').trim();
			const parsed: unknown = metaSource ? JSON5.parse(metaSource) : {};
			if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
				throw new Error('Metadata must be a JSON object');
			}
			metadata = parsed;
			const styleSource = lines[separator].match(/^---\s*~(.*)$/)?.[1];
			if (styleSource) tableStyle = parseStyleDirective(styleSource);
			source = lines.slice(separator + 1).join('\n');
		}

		const sourceGrid = splitTableSource(source);
		if (!sourceGrid.length) throw new Error('No table rows found');
		const width = Math.max(...sourceGrid.map(row => row.length));
		const normalized = sourceGrid.map(row => Array.from({ length: width }, (_, col) => row[col] ?? ''));
		const delimiter = findDelimiterRow(normalized);
		const visual = normalized.filter((_, row) => row !== delimiter);
		const headerColumn = findHeaderColumn(visual);
		const options: AugmentOptions = {
			classes: metadata.classes,
			tableStyle,
			columns: delimiter >= 0 ? normalized[delimiter].map(parseCell) : undefined,
			rows: headerColumn >= 0 ? visual.map(row => parseCell(row[headerColumn])) : undefined,
		};

		const doc = this.el.ownerDocument;
		this.el.replaceChildren();
		const scroll = this.el.createDiv();
		scroll.className = 'sheets-table-scroll';
		scroll.tabIndex = 0;
		scroll.setAttribute('role', 'region');
		scroll.setAttribute('aria-label', 'Sheet table');
		const table = scroll.createEl('table');
		table.className = 'obsidian-sheets-parsed';
		table.dataset.sheetsProcessed = 'true';
		if (tableStyle?.classes.length) table.classList.add(...tableStyle.classes);
		const head = table.createTHead();
		const body = table.createTBody();

		const grid: GridCell[][] = [];
		const rendering: Promise<void>[] = [];
		for (let row = 0; row < visual.length; row++) {
			const isHeader = delimiter >= 0 && row < delimiter;
			const tr = (isHeader ? head : body).insertRow();
			const cells: GridCell[] = [];
			for (const text of visual[row]) {
				const cell = tr.createEl(isHeader ? 'th' : 'td');
				cell.dir = 'auto';
				cells.push({ text, el: cell });
				rendering.push(MarkdownRenderer.render(
					this.app, '\u200B ' + text, cell, this.ctx.sourcePath, this,
				).then(() => {
					// Keep the nodes and event handlers used by links and embeds.
					const paragraph = cell.firstElementChild;
					if (paragraph?.tagName === 'P') paragraph.replaceWith(...Array.from(paragraph.childNodes));
					const walker = doc.createTreeWalker(cell, 4 /* SHOW_TEXT */);
					const first = walker.nextNode() as Text | null;
					if (first) first.data = first.data.replace(/^\u200B /, '');
				}));
			}
			grid.push(cells);
		}
		await Promise.all(rendering);
		// Do not mutate a removed render child after the asynchronous render.
		if (!this.disposed && this.el.contains(table)) augmentGrid(grid, options);
	}
}
