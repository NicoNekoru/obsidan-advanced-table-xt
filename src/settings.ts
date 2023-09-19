import { PluginSettingTab, Setting, App, MarkdownView } from 'obsidian';
import { ObsidianSpreadsheet } from './main';

export class SheetSettingsTab extends PluginSettingTab 
{
	plugin: ObsidianSpreadsheet;

	constructor(app: App, plugin: ObsidianSpreadsheet) 
	{
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void 
	{
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Native table post processing')
			.setDesc('Enable this setting to use Obsidian Sheets\' renderer ')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.nativeProcessing)
					.onChange(async value => 
					{
						this.plugin.settings.nativeProcessing = value;
						await this.plugin.saveSettings();
						// @ts-expect-error workspace.activeLeaf is deprecated and the following 
						// line is prefered but the following line does not actually work on my 
						// machine so deprecated it is I guess
						this.app.workspace.activeLeaf?.rebuildView();
						this.app.workspace.getActiveViewOfType(MarkdownView)?.previewMode.rerender(true);
					})
			);

		new Setting(containerEl)
			.setName('Use paragraphs in cells')
			.setDesc('Enable this setting to use paragraphs for table cells ')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.paragraphs)
					.onChange(async value => 
					{
						this.plugin.settings.paragraphs = value;
						await this.plugin.saveSettings();
						// @ts-expect-error workspace.activeLeaf is deprecated and the following 
						// line is prefered but the following line does not actually work on my 
						// machine so deprecated it is I guess
						this.app.workspace.activeLeaf?.rebuildView();
						this.app.workspace.getActiveViewOfType(MarkdownView)?.previewMode.rerender(true);
					})
			);
	}
}
