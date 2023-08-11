import { PluginSettingTab, Setting, App } from 'obsidian';
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
			.setName('Setting #1')
			.setDesc('It\'s a secret')
			.addText((text) =>
				text
					.setPlaceholder('Enter your secret')
					.setValue('test'/* this.plugin.settings.mySetting */)
					// .onChange(async (value) => 
					// {
					// 	this.plugin.settings.mySetting = value;
					// 	await this.plugin.saveSettings();
					// })
			);
	}
}
