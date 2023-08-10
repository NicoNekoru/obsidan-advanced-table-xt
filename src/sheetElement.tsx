import {
	App,
	MarkdownPostProcessorContext,
	MarkdownRenderChild,
	// MarkdownView,
	MarkdownRenderer,
} from 'obsidian';

export class SheetElement extends MarkdownRenderChild 
{
	private cellMaxLength = 0;
	private rowMaxLength = 0;
	private headerRow: number;
	private headerCol: number;
	private contentGrid: string[][];

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
		this.contentGrid = this.source
			.split('\n')
			.map((row) => row.split(/(?<!\\)\|/)
				.map(cell => cell.trim()));

		// Check if grid is valid (every line starts and ends with `|`)
		if (
			!this.contentGrid.every(
				(row) => !row.pop()?.trim() && !row.shift()?.trim()
			)
		) return this.displayError('Malformed table');


		// Find grid dimensions
		for (let rowIndex = 0; rowIndex < this.contentGrid.length; rowIndex++) 
		{
			const row = this.contentGrid[rowIndex];
			if (this.rowMaxLength < row.length) this.rowMaxLength = row.length;

			for (let colIndex = 0; colIndex < row.length; colIndex++)
				if (this.cellMaxLength < row[colIndex].trim().length)
					this.cellMaxLength = row[colIndex].trim().length;
		}

		// Fix grid dimensions
		this.contentGrid = this.contentGrid.map((line) =>
			Array.from(
				{ ...line, length: this.rowMaxLength },
				(cell) => cell || ''
			)
		);

		// Start building DOM element
		const table = this.el.createEl('table');
		const tableHead = table.createEl('thead');
		const tableBody = table.createEl('tbody');

		// Find header boundaries
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

		// console.log({col: this.headerCol , row: this.headerRow, grid: this.contentGrid});
		
		// Find merged cells
		// this.contentGrid.map((row) => row.map(cell => cell == '<' ? '<' : undefined));

		// Build cells into DOM
		const domGrid: HTMLTableCellElement[][] = [];
		for (let index = 0; index < this.contentGrid.length; index++) 
		{
			const line = this.contentGrid[index];
			let row = tableBody.createEl('tr'),
				cellNodeR: keyof HTMLElementTagNameMap | null = null;

			if (index < this.headerRow) 
			{
				row = tableHead.createEl('tr');
				cellNodeR = 'th';
			} 
			else if (index === this.headerRow) continue;

			domGrid[index] = [];

			for (
				let columnIndex = 0;
				columnIndex < line.length;
				columnIndex++
			) 
			{
				let cellNodeC: keyof HTMLElementTagNameMap | null = null;
				if (columnIndex < this.headerCol) 
				{
					cellNodeC = 'th';
				}
				else if (columnIndex === this.headerCol) continue;

				let cell: HTMLTableCellElement;

				if (line[columnIndex] == '<' && columnIndex > 0) 
				{
					cell = domGrid[index][columnIndex - 1];
					cell?.colSpan || Object.assign(cell, { colSpan: 1 });
					cell.colSpan += 1;
				}
				else if (line[columnIndex] == '^' && index > 0) 
				{
					cell = domGrid[index - 1][columnIndex];
					cell?.rowSpan || Object.assign(cell, { rowSpan: 1 });
					cell.rowSpan += 1;
				}
				else 
				{
					cell = row.createEl(cellNodeR || cellNodeC || 'td');
					MarkdownRenderer.render(
						this.app,
						line[columnIndex],
						cell,
						'',
						this
					);
				}

				domGrid[index][columnIndex] = cell;
			}
		}
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
}
