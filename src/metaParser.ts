import { ObsidianSpreadsheet } from 'main';
import {
	App,
	MarkdownPostProcessorContext,
	MarkdownRenderChild,
	MarkdownView,
} from 'obsidian';
import * as JSON5 from 'json5';
import { ISheetMetaData } from 'sheetElement';

export class MetaParser extends MarkdownRenderChild 
{
	constructor(
		private readonly el: HTMLElement,
		private readonly source: string,
		private readonly ctx: MarkdownPostProcessorContext,
		private readonly app: App,
		private readonly plugin: ObsidianSpreadsheet,
	) 
	{
		super(el);
	}

	onload(): void 
	{
		this.el.id = 'sheet-metadata';
		JSON5.parse(this.source) as ISheetMetaData;
	}
	
	onunload(): void 
	{
		
	}
}