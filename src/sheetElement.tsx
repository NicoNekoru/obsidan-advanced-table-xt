import {
	App,
	MarkdownPostProcessorContext,
	MarkdownRenderChild,
	MarkdownView,
	MarkdownRenderer,
} from "obsidian";

export class SheetElement extends MarkdownRenderChild {
	private cellMaxLength = 0;
	private rowMaxLength = 0;
	private contentGrid: string[][];

	constructor(
		private readonly el: HTMLElement,
		private readonly source: string,
		private readonly ctx: MarkdownPostProcessorContext,
		private readonly app: App
	) {
		super(el);
		console.log(this);
	}

	onload() {
		console.log("loaded");
		this.contentGrid = this.source
			.split("\n")
			.map((row) => row.split(/(?<!\\)\|/));

		if (
			!this.contentGrid.every(
				(row) => !row.pop()?.trim() && !row.shift()?.trim()
			)
		)
			return this.displayError("Malformed table");

		console.log(this.contentGrid);

		const table = this.el.createEl("table");

		for (let rowIndex = 0; rowIndex < this.contentGrid.length; rowIndex++) {
			const row = this.contentGrid[rowIndex];
			if (this.rowMaxLength < row.length) this.rowMaxLength = row.length;

			for (let colIndex = 0; colIndex < row.length; colIndex++)
				if (this.cellMaxLength < row[colIndex].trim().length)
					this.cellMaxLength = row[colIndex].trim().length;
		}

		for (let index = 0; index < this.contentGrid.length; index++) {
			let line = this.contentGrid[index];
			line = Array.from({ ...line, length: this.rowMaxLength });
			const row = table.createEl("tr");
			for (
				let columnIndex = 0;
				columnIndex < line.length;
				columnIndex++
			) {
				const cell = row.createEl("td");
				MarkdownRenderer.render(
					this.app,
					line[columnIndex],
					cell,
					"",
					this
				);
			}
		}
	}

	onunload() {
		// TODO: format user code block on unload -> scrap all of this
		console.log("unloading");
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		const queryProps = this.ctx.getSectionInfo(this.el);

		if (this.source.at(0) !== "|" || this.source.at(-1) !== "|") return;
		if (!queryProps) return;
		if (!view) return;

		console.log({
			contentGrid: this.contentGrid,
			start: queryProps.lineStart,
		});

		for (let index = 0; index < this.contentGrid.length; index++) {
			const line = this.contentGrid[index];
			console.log(
				1 + index + queryProps.lineStart,
				line
					.map((cell) =>
						(" " + cell.trim()).padEnd(this.cellMaxLength)
					)
					.join("|")
			);
			// try {
			// 	view.editor.setLine(
			// 		1 + index + queryProps.lineStart,
			// 		line
			// 			.map((cell) => (" " + cell.trim()).padEnd(this.cellMaxLength))
			// 			.join("|")
			// 	);
			// }
			// catch (e) {
			// 	return this.displayError(e)
			// }
		}
	}

	displayError(error?: string) {
		this.el.createDiv({
			text: `\nError: \`${error}\`\n\n`,
			cls: `obs-sheets_error`,
		});
		this.unload();
	}
}
