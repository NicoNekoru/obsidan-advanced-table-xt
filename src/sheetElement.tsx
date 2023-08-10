import {
	App,
	MarkdownPostProcessorContext,
	MarkdownRenderChild,
	// MarkdownView,
	MarkdownRenderer,
} from 'obsidian';

// TODO: Move these to settings
const MERGE_UP_SIGNIFIER = '^',
	MERGE_LEFT_SIGNIFIER = '<';

export class SheetElement extends MarkdownRenderChild 
{
	private cellMaxLength = 0;
	private rowMaxLength = 0;
	private headerRow: number;
	private headerCol: number;
	private contentGrid: string[][];
	private table: HTMLTableElement;
	private tableHead: HTMLTableSectionElement;
	private tableBody: HTMLTableSectionElement;
	private domGrid: HTMLTableCellElement[][] = [];

	constructor(
		private readonly el: HTMLElement,
		private readonly source: string,
		private readonly ctx: MarkdownPostProcessorContext,
		private readonly app: App
	) 
	{
		super(el);
		// console.log(this);
	}

	onload() 
	{
		// TODO: refactor into never nesting
		console.log('spreadsheets loaded');

		// Parse code block input
		this.parseInputToGrid();

		// Check if grid is valid (every line starts and ends with `|`)
		this.validateInput();

		// Find and fix grid dimensions
		this.normalizeGrid();

		// Start building DOM element
		this.table = this.el.createEl('table');
		this.tableHead = this.table.createEl('thead');
		this.tableBody = this.table.createEl('tbody');

		// Find header boundaries
		this.getHeaderBoundaries();

		// Build cells into DOM
		this.buildDomTable();
	}

	onunload() 
	{
		// TODO: format user code block on unload -> scrap all of this
		/*
		console.log('unloading');
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const queryProps = this.ctx.getSectionInfo(this.el);

		if (this.source.at(0) !== '|' || this.source.at(-1) !== '|') return;
		if (!queryProps) return;
		if (!view) return;

		console.log({
			contentGrid: this.contentGrid,
			start: queryProps.lineStart,
		});

		for (let index = 0; index < this.contentGrid.length; index++) 
		{
			const line = this.contentGrid[index];
			console.log(
				1 + index + queryProps.lineStart,
				line
					.map((cell) =>
						(' ' + cell.trim()).padEnd(this.cellMaxLength)
					)
					.join('|')
			);
			// try {
			// 	view.editor.setLine(
			// 		1 + index + queryProps.lineStart,
			// 		line
			// 			.map((cell) => (' ' + cell.trim()).padEnd(this.cellMaxLength))
			// 			.join('|')
			// 	);
			// }
			// catch (e) {
			// 	return this.displayError(e)
			// }
		}
		*/
	}

	displayError(error?: string) 
	{
		this.el.createDiv({
			text: `\nError: \`${error}\`\n\n`,
			cls: 'obs-sheets_error',
		});
		this.unload();
	}

	parseInputToGrid()
	{
		this.contentGrid = this.source
			.split('\n')
			.map((row) => row.split(/(?<!\\)\|/)
				.map(cell => cell.trim()));
	}

	validateInput()
	{
		if (
			!this.contentGrid.every(
				(row) => !row.pop()?.trim() && !row.shift()?.trim()
			)
		) return this.displayError('Malformed table');
	}

	normalizeGrid()
	{
		for (let rowIndex = 0; rowIndex < this.contentGrid.length; rowIndex++) 
		{
			const row = this.contentGrid[rowIndex];
			if (this.rowMaxLength < row.length) this.rowMaxLength = row.length;

			for (let colIndex = 0; colIndex < row.length; colIndex++)
				if (this.cellMaxLength < row[colIndex].trim().length)
					this.cellMaxLength = row[colIndex].trim().length;
		}

		this.contentGrid = this.contentGrid.map((line) =>
			Array.from(
				{ ...line, length: this.rowMaxLength },
				(cell) => cell || ''
			)
		);
	}

	getHeaderBoundaries()
	{
		this.headerRow = this.contentGrid.findIndex(
			(headerRow) =>
				headerRow.every((headerCol) => /^[-\s]+$/.test(headerCol))
		);

		// transpose grid
		this.headerCol = this.contentGrid[0].map((_, i) => 
			this.contentGrid.map(row => row[i])
		)
			.findIndex(
				(headerCol) =>
					headerCol.every((headerCol) => /^[-\s]+$/.test(headerCol))
			);
	}

	buildDomTable()
	{
		for (
			let rowIndex = 0; 
			rowIndex < this.contentGrid.length; 
			rowIndex++
		) this.buildDomRow(rowIndex);
	}

	buildDomRow(rowIndex: number)
	{
		const rowContents = this.contentGrid[rowIndex];
		let rowNode = this.tableBody.createEl('tr');

		if (rowIndex < this.headerRow) rowNode = this.tableHead.createEl('tr');
		else if (rowIndex === this.headerRow) return;

		this.domGrid[rowIndex] = [];

		for (
			let columnIndex = 0;
			columnIndex < rowContents.length;
			columnIndex++
		) this.buildDomCell(rowIndex, columnIndex, rowNode);
	}

	buildDomCell(rowIndex: number, columnIndex: number, rowNode: HTMLElement)
	{
		const cellContent = this.contentGrid[rowIndex][columnIndex];
		let cellTag: keyof HTMLElementTagNameMap = 'td';
		let cell: HTMLTableCellElement;

		if (columnIndex === this.headerCol || rowIndex == this.headerRow) return;
		else if (columnIndex < this.headerCol || rowIndex < this.headerRow) cellTag = 'th';

		if (cellContent == MERGE_LEFT_SIGNIFIER && columnIndex > 0) 
		{
			cell = this.domGrid[rowIndex][columnIndex - 1];
			cell?.colSpan || Object.assign(cell, { colSpan: 1 });
			cell.colSpan += 1;
		}
		else if (cellContent == MERGE_UP_SIGNIFIER && rowIndex > 0) 
		{
			cell = this.domGrid[rowIndex - 1][columnIndex];
			cell?.rowSpan || Object.assign(cell, { rowSpan: 1 });
			cell.rowSpan += 1;
		}
		else 
		{
			cell = rowNode.createEl(cellTag);
			MarkdownRenderer.render(
				this.app,
				cellContent,
				cell,
				'',
				this
			);
		}

		return this.domGrid[rowIndex][columnIndex] = cell;
	}
}
