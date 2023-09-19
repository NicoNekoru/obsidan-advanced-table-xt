import { MetaParser } from 'metaParser';
import { MarkdownPostProcessorContext, Plugin, htmlToMarkdown } from 'obsidian';
import { SheetSettingsTab } from './settings';
import { SheetElement } from './sheetElement';

interface PluginSettings {
	nativeProcessing: boolean;
}

const DEFAULT_SETTINGS: PluginSettings = {
	nativeProcessing: true,
};

export class ObsidianSpreadsheet extends Plugin 
{
	settings: PluginSettings;

	async onload() 
	{
		this.loadSettings();
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
			console.log(this.settings.nativeProcessing);
			if (!this.settings.nativeProcessing) return;

			const tableEls = el.querySelectorAll('table');
			for (const tableEl of Array.from(tableEls))
			{
				if (!tableEl) return;
				if (tableEl?.id === 'obsidian-sheets-parsed') return;

				const sec = ctx.getSectionInfo(tableEl);
				let source: string = '';
				if (!sec)
				{
					tableEl.querySelectorAll(':scope td').forEach(({ childNodes }) => childNodes.forEach(node => 
					{
						if (node.nodeType == 3) // Text node type
							node.textContent = node.textContent?.replace(/[*_`[\]$()]|[~=]{2}/g, '\\$&') || '';
							// See https://help.obsidian.md/Editing+and+formatting/Basic+formatting+syntax#Styling+text
					}));
					tableEl.querySelectorAll(':scope a.internal-link').forEach((link: HTMLAnchorElement) => 
					{ 
						const parsedLink = document.createElement('span');
						parsedLink.innerText = `[[${link.getAttr('href')}|${link.innerText}]]`;
						link.replaceWith(parsedLink);
					});
					tableEl.querySelectorAll(':scope span.math').forEach((link: HTMLSpanElement) =>
						link.textContent?.trim().length ? link.textContent = `$${link.textContent || ''}$` : null
					);

					source = htmlToMarkdown(tableEl).trim().replace(/\\\\/g, '$&$&');
					if (!source) return;
				}
				else
				{
					const {text, lineStart, lineEnd} = sec;
					source = text.split('\n').slice(lineStart, 1 + lineEnd).join('\n');
				}
							
				tableEl.empty();
				ctx.addChild(new SheetElement(tableEl, source.trim(), ctx, this.app, this));
			}
		});

		// This adds a settings tab so the user can configure various aspects of the plugin
		this.addSettingTab(new SheetSettingsTab(this.app, this));
	}

	onunload() 
	{
		// console.log('unloading spreadsheet plugin');
	}

	async loadSettings() 
	{
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() 
	{
		await this.saveData(this.settings);
	}
}

export default ObsidianSpreadsheet;
