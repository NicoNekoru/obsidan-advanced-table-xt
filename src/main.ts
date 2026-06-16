import {
	MarkdownPostProcessorContext,
	Plugin,
	htmlToMarkdown,
} from 'obsidian';
import { SheetSettingsTab } from './settings';
import { SheetElement } from './sheetElement';
import { augmentGrid, type GridCell } from './tableAugmenter';
import { findDelimiterRow, splitTableSource } from './tableModel';
import { sheetsLivePreviewExtension } from './livePreview';

interface PluginSettings {
	nativeProcessing: boolean;
}

const DEFAULT_SETTINGS: PluginSettings = {
	nativeProcessing: true,
};

const PROCESSED_FLAG = 'obsidian-sheets-parsed';

export class ObsidianSpreadsheet extends Plugin {
	settings: PluginSettings;

	async onload() {
		await this.loadSettings();

		// The custom `sheet` code block keeps its own dedicated renderer.
		this.registerMarkdownCodeBlockProcessor(
			'sheet',
			async (
				source: string,
				el: HTMLTableElement,
				ctx: MarkdownPostProcessorContext
			) => {
				ctx.addChild(new SheetElement(el, source.trim(), ctx, this.app, this));
			}
		);

		// Reading mode: augment Obsidian's natively-rendered tables in place.
		this.registerMarkdownPostProcessor((el, ctx) => {
			if (!this.settings.nativeProcessing) return;
			if (ctx.frontmatter?.['disable-sheet'] === true) return;

			for (const tableEl of Array.from(el.querySelectorAll('table'))) {
				this.processReadingTable(tableEl, ctx);
			}
		});

		// Live Preview: re-apply features to the interactive table widget.
		this.registerEditorExtension(
			sheetsLivePreviewExtension({
				app: this.app,
				isEnabled: () => this.settings.nativeProcessing,
			})
		);

		this.addSettingTab(new SheetSettingsTab(this.app, this));
	}

	/** Augment a single natively-rendered table in reading mode. */
	private processReadingTable(
		tableEl: HTMLTableElement,
		ctx: MarkdownPostProcessorContext
	) {
		// Live Preview tables are handled by the editor extension, not here.
		if (tableEl.closest('.cm-editor')) return;
		if (tableEl.dataset.sheetsProcessed === 'true') return;

		const source = this.getTableSource(tableEl, ctx);
		if (!source) return;

		const grid = buildGridFromRenderedTable(tableEl, source);
		if (!grid) return;

		tableEl.dataset.sheetsProcessed = 'true';
		tableEl.classList.add(PROCESSED_FLAG);
		try {
			augmentGrid(grid);
		} catch (e) {
			console.error('[Sheets] reading mode augmentation failed', e);
		}
	}

	/** Recover the Markdown source for a rendered table. */
	private getTableSource(
		tableEl: HTMLTableElement,
		ctx: MarkdownPostProcessorContext
	): string | null {
		const sec = ctx.getSectionInfo(tableEl);
		if (sec) {
			return sec.text
				.split('\n')
				.slice(sec.lineStart, sec.lineEnd + 1)
				.join('\n');
		}
		// Fallback (e.g. some embeds): reconstruct from the rendered DOM.
		const md = htmlToMarkdown(tableEl).trim();
		return md || null;
	}

	onunload() {}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

/**
 * Pair a rendered table's DOM cells with their Markdown source text, dropping
 * the delimiter row so the grid lines up 1:1 with `<thead>`/`<tbody>` rows.
 */
function buildGridFromRenderedTable(
	tableEl: HTMLTableElement,
	source: string
): GridCell[][] | null {
	const srcGrid = splitTableSource(source);
	if (srcGrid.length < 2) return null;

	const delimiter = findDelimiterRow(srcGrid);
	const visualSrc =
		delimiter >= 0 ? srcGrid.filter((_, i) => i !== delimiter) : srcGrid;

	const headRows = Array.from(tableEl.tHead?.rows ?? []);
	const bodyRows: HTMLTableRowElement[] = [];
	for (const body of Array.from(tableEl.tBodies)) {
		bodyRows.push(...Array.from(body.rows));
	}
	const domRows = [...headRows, ...bodyRows];
	if (!domRows.length) return null;

	const rowCount = Math.min(visualSrc.length, domRows.length);
	const grid: GridCell[][] = [];
	for (let r = 0; r < rowCount; r++) {
		const domCells = Array.from(domRows[r].cells);
		const srcRow = visualSrc[r];
		const colCount = Math.min(domCells.length, srcRow.length);
		const row: GridCell[] = [];
		for (let c = 0; c < colCount; c++) {
			row.push({ text: srcRow[c], el: domCells[c] });
		}
		grid.push(row);
	}
	return grid;
}

export default ObsidianSpreadsheet;
