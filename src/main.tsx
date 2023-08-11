import { MarkdownPostProcessorContext, Plugin, MarkdownPreviewRenderer, htmlToMarkdown } from 'obsidian';
// import { SheetSettingsTab } from './settings';
import { SheetElement } from './sheetElement';
// Remember to rename these classes and interfaces!

export class ObsidianSpreadsheet extends Plugin 
{
	async onload() 
	{
		console.log('loading spreadsheet plugin');
		this.registerMarkdownCodeBlockProcessor(
			'sheet',
			async (
				source: string,
				el: HTMLElement,
				ctx: MarkdownPostProcessorContext
			) => 
			{
				ctx.addChild(new SheetElement(el, source.trim(), ctx, this.app, this));
			}
		);

		MarkdownPreviewRenderer.registerPostProcessor(async (el, ctx) => 
		{
			if (!el.querySelector('table')) return;

			const source = htmlToMarkdown(el);			
			if (!source) return;

			el.empty();
			ctx.addChild(new SheetElement(el, source, ctx, this.app, this));
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		// this.addSettingTab(new SheetSettingsTab(this.app, this));
	}

	onunload() 
	{
		console.log('unloading spreadsheet plugin');
	}
}

export default ObsidianSpreadsheet;
