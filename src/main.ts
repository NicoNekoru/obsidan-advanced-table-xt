import { MetaParser } from 'metaParser';
import { MarkdownPostProcessorContext, Plugin, htmlToMarkdown } from 'obsidian';
// import { SheetSettingsTab } from './settings';
import { SheetElement } from './sheetElement';
// Remember to rename these classes and interfaces!

export class ObsidianSpreadsheet extends Plugin 
{
	async onload() 
	{
		// console.log('loading spreadsheet plugin');
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

		this.registerMarkdownPostProcessor(async (el, ctx) => 
		{
			const tableEls = el.querySelectorAll('table');
			for (const tableEl of Array.from(tableEls))
			{
				if (!tableEl) return;
				if (tableEl?.id === 'obsidian-sheets-parsed') return;
	
				const source = htmlToMarkdown(tableEl);
				if (!source) return;
							
				tableEl.empty();
				ctx.addChild(new SheetElement(tableEl, source.trim(), ctx, this.app, this));
			}
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		// this.addSettingTab(new SheetSettingsTab(this.app, this));
	}

	onunload() 
	{
		// console.log('unloading spreadsheet plugin');
	}

}

export default ObsidianSpreadsheet;
