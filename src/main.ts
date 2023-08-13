import { MetaParser } from 'metaParser';
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
				source = (new DOMParser)
					.parseFromString(source.trim(), 'text/html')
					.documentElement
					.textContent || source.trim();
					
				ctx.addChild(new SheetElement(
					el, 
					source, 
					ctx, 
					this.app, 
					this
				));
			}
		);

		this.registerMarkdownCodeBlockProcessor(
			'sheet_meta',
			async (
				source: string,
				el,
				ctx
			) => 
			{
				ctx.addChild(new MetaParser(el, source, ctx, this.app, this));
			}
		);

		MarkdownPreviewRenderer.registerPostProcessor(async (el, ctx) => 
		{
			// if (el.querySelector('#sheet-metadata'))
			// {
			// 	console.log(el.doc);
			// }
			if (!el.querySelector('table')) return;
			if (el.querySelector('table')?.id === 'obsidian-sheets-parsed') return;

			const source = htmlToMarkdown(el);
			if (!source) return;
			
			el.empty();
			ctx.addChild(new SheetElement(el, source.trim(), ctx, this.app, this));
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
