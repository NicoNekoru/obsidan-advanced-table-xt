import { ObsidianSpreadsheet } from 'main';
import {
	App,
	MarkdownPostProcessorContext,
	MarkdownRenderChild,
	MarkdownRenderer,
} from 'obsidian';
import type { Properties } from 'csstype';
import * as JSON5 from 'json5';

// TODO: Move these to settings
const MERGE_UP_SIGNIFIER = '^',
	MERGE_LEFT_SIGNIFIER = '<',
	HEADER_DELIMETER = '-',
	META_DELIMETER = '---';

export interface ISheetMetaData
{
	classes: { [key: string]: Properties };
	log: boolean;
}

export class SheetElement extends MarkdownRenderChild 
{
	private newLineRE: RegExp;
	private cellBorderRE: RegExp;
	private metaRE: RegExp;
	private headerRE: RegExp;
	private contentGrid: string[][];
	private metadata: Partial<ISheetMetaData>;
	private styles: Record<string, Properties>;
	private globalStyle: Properties = {};
	private cellMaxLength = 0;
	private rowMaxLength = 0;
	private headerRow: number;
	private headerCol: number;
	private rowStyles: Properties[] = [];
	private colStyles: Properties[] = [];
	private table: HTMLTableElement;
	private tableHead: HTMLTableSectionElement;
	private tableBody: HTMLTableSectionElement;
	private domGrid: HTMLTableCellElement[][] = [];

	constructor(
		private readonly el: HTMLElement,
		private readonly source: string,
		private readonly ctx: MarkdownPostProcessorContext,
		private readonly app: App,
		private readonly plugin: ObsidianSpreadsheet,
	) 
	{
		super(el);
		// TODO: Handle settings here -> move :11-12
		// console.log(this);
	}

	async onload() 
	{
		this.initRegex();

		// Parse code block input
		this.parseInputToGrid();

		// Check if grid is valid (every line starts and ends with `|`)
		this.validateInput();

		// Find and fix grid dimensions
		this.normalizeGrid();

		// Start building DOM element
		this.table = this.el.createEl('table');
		this.table.id = 'obsidian-sheets-parsed';
		this.tableHead = this.table.createEl('thead');
		this.tableBody = this.table.createEl('tbody');

		// Find header boundaries
		this.getHeaderBoundaries();

		// Find header styles
		this.getHeaderStyles();

		// Build cells into DOM
		this.buildDomTable();

		// console.log(thisGrid);
	}

	onunload() 
	{}

	initRegex()
	{
		this.metaRE = new RegExp(String.raw`^${META_DELIMETER}\s*?(?:~(.*?))?\s*?\n+`, 'mg');
		this.newLineRE = new RegExp(String.raw`\n`);
		this.cellBorderRE = new RegExp(String.raw`(?<!\\)\|`);
		this.headerRE = new RegExp(String.raw`^\s*?(:)?(?:${HEADER_DELIMETER})+?(:)?\s*?(?:(?<!\\)~(.*?))?$`);
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
		if (!this.metaRE.test(this.source)) return this.contentGrid = 
			this.source.split(this.newLineRE)
				.filter((row) => this.cellBorderRE.test(row))
				.map((row) => row.split(this.cellBorderRE)
					.map(cell => cell.trim()));
		
		const [meta, unparsedStyle, source] = this.source.split(this.metaRE);
		
		this.parseMetadata(meta);
		
		if (unparsedStyle)
		{
			let cellStyle: Properties = {};
			const cls = unparsedStyle.match(/\.\S+/g) || [];
			cls.forEach(cssClass => 
			{
				cellStyle = { ...cellStyle, ...(this.styles?.[cssClass.slice(1)] || {}) };
			});

			const inlineStyle = unparsedStyle.match(/\{.*\}/)?.[0] || '{}';
			try 
			{
				cellStyle = { ...cellStyle, ...JSON5.parse(inlineStyle) };
			} 
			catch 
			{
				console.error(`Invalid cell style \`${inlineStyle}\``);
			}

			this.globalStyle = cellStyle;
		}

		return this.contentGrid = source.split(this.newLineRE)
			.map((row) => row.split(this.cellBorderRE)
				.map(cell => cell.trim()));
	}

	parseMetadata(meta: string)
	{
		let metadata: Partial<ISheetMetaData>;

		try 
		{
			metadata = JSON5.parse(meta);
		} 
		catch (error) 
		{
			return this.displayError('Metadata is not proper JSON');
		}

		this.metadata = metadata;

		// Separate this out when more metadata is introduced
		if (metadata.classes) 
		{
			this.styles = metadata.classes;
		}
		// TODO: Add logging and debugging in metadata
		// if (metadata.log) this.logging = true
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
				headerRow.every((headerCol) => this.headerRE.test(headerCol))
		);

		// transpose grid
		this.headerCol = this.contentGrid[0].map((_, i) => 
			this.contentGrid.map(row => row[i])
		)
			.findIndex(
				(headerCol) =>
					headerCol.every((headerCol) => this.headerRE.test(headerCol))
			);
	}

	getHeaderStyles()
	{
		// TODO: Add same syntax of custom styling as cells
		if (this.headerRow !== -1) this.colStyles = this.contentGrid[this.headerRow].map(rowHead => 
		{
			let styles: Properties = {};

			const alignment = rowHead.match(this.headerRE);
			if (!alignment) return styles;
			else if (alignment[1] && alignment[2]) styles['textAlign'] = 'center';
			else if (alignment[1]) styles['textAlign'] = 'left';
			else if (alignment[2]) styles['textAlign'] = 'right';

			// Parse ~
			if (alignment[3])
				(alignment[3].match(/\.\S+/g) || []).forEach(cssClass => 
					styles = 
						{ 
							...styles, 
							...(this.styles?.[cssClass.slice(1)] 
								|| {}
							) 
						}
				);

			return styles;
		});

		if (this.headerCol !== -1) this.rowStyles = this.contentGrid[0].map((_, i) => 
			this.contentGrid.map(row => row[i])
		)[this.headerCol].map(rowHead => 
		{
			let styles: Properties = {};

			const alignment = rowHead.match(this.headerRE);
			if (!alignment) return styles;
			else if (alignment[1] && alignment[2]) styles['textAlign'] = 'center';
			else if (alignment[1]) styles['textAlign'] = 'left';
			else if (alignment[2]) styles['textAlign'] = 'right';

			// Parse ~
			if (alignment[3])
				(alignment[3].match(/\.\S+/g) || []).forEach(cssClass => 
					styles = 
						{ 
							...styles, 
							...(this.styles?.[cssClass.slice(1)] 
								|| {}
							) 
						}
				);

			return styles;
		});
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

	async buildDomCell(rowIndex: number, columnIndex: number, rowNode: HTMLElement)
	{
		const [
			cellContent, 
			cellStyles
		] = this.contentGrid[rowIndex][columnIndex].split(/(?<![\\~])~(?!~)/);

		let cls: string[] = [];
		let cellStyle: Properties = this.globalStyle;

		if (this.rowStyles[rowIndex]) cellStyle = { ...cellStyle, ...this.rowStyles[rowIndex] };
		if (this.colStyles[columnIndex]) cellStyle = { ...cellStyle, ...this.colStyles[columnIndex] };

		if (cellStyles) 
		{
			cls = cellStyles.match(/(?<=\.)\S+/g) || [];
			cls.forEach(cssClass => 
			{
				cellStyle = { ...cellStyle, ...(this.styles?.[cssClass.slice(1)] || {}) };
			});

			const inlineStyle = cellStyles.match(/\{.*\}/)?.[0] || '{}';
			try 
			{
				cellStyle = { ...cellStyle, ...JSON5.parse(inlineStyle) };
			} 
			catch 
			{
				console.error(`Invalid cell style \`${inlineStyle}\``);
			}
		}

		let cellTag: keyof HTMLElementTagNameMap = 'td';
		let cell: HTMLTableCellElement;

		if (columnIndex === this.headerCol || rowIndex === this.headerRow) return;
		else if (columnIndex < this.headerCol || rowIndex < this.headerRow) cellTag = 'th';

		if (cellContent == MERGE_LEFT_SIGNIFIER && this.domGrid?.[rowIndex]?.[columnIndex - 1]) 
		{
			cell = this.domGrid[rowIndex][columnIndex - 1];
			cell?.colSpan || Object.assign(cell, { colSpan: 1 });
			cell.colSpan = columnIndex - parseInt(cell.getAttribute('col-index') || columnIndex.toString()) + 1;
		}
		else if (cellContent == MERGE_UP_SIGNIFIER && this.domGrid?.[rowIndex - 1]?.[columnIndex]) 
		{
			cell = this.domGrid[rowIndex - 1][columnIndex];
			cell?.rowSpan || Object.assign(cell, { rowSpan: 1 });
			cell.rowSpan = rowIndex - parseInt(cell.getAttribute('row-index') || '0') + 1;
		}
		else if (
			this.domGrid?.[rowIndex - 1]?.[columnIndex] && this.domGrid?.[rowIndex]?.[columnIndex - 1] &&
			this.domGrid[rowIndex][columnIndex - 1] === this.domGrid[rowIndex - 1][columnIndex] 
		) cell = this.domGrid[rowIndex][columnIndex - 1];
		else 
		{
			cell = rowNode.createEl(cellTag, { cls });
			cell.setAttribute('row-index', rowIndex.toString());
			cell.setAttribute('col-index', columnIndex.toString());
			// cell.innerHTML = (new Converter({ backslashEscapesHTMLTags: true, strikethrough: true, })).makeHtml(' ' + cellContent);
			// console.log((new Converter({ backslashEscapesHTMLTags: true, strikethrough: true, })).makeHtml(' ' + cellContent));
			
			MarkdownRenderer.render(
				this.app,
				'\u200B ' + cellContent, // Make sure markdown that requires to be at the start of a line is not rendered
				cell,
				'',
				this
			).then(() => 
			{
				cell.children[0].childNodes[0].textContent = cell.children[0].childNodes[0].textContent?.replace(/^\u200B/, '') || '';
				if (!this.plugin.settings.paragraphs) cell.innerHTML = cell.children[0].innerHTML;
			});
			Object.assign(cell.style, cellStyle);
		}

		return this.domGrid[rowIndex][columnIndex] = cell;
	}
}
