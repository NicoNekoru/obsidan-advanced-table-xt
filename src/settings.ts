import { PluginSettingTab, Setting, App, MarkdownView } from 'obsidian';
import { ObsidianSpreadsheet } from './main';

export class SheetSettingsTab extends PluginSettingTab {
	plugin: ObsidianSpreadsheet;

	constructor(app: App, plugin: ObsidianSpreadsheet) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Native table post processing')
			.setDesc(
				'Apply Sheets Extended features (cell merging, vertical headers, custom CSS) to ordinary Markdown tables in both reading mode and Live Preview.'
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.nativeProcessing)
					.onChange(async (value) => {
						this.plugin.settings.nativeProcessing = value;
						await this.plugin.saveSettings();
						this.refreshViews();
					})
			);
	}

	/** Re-render open Markdown views so a setting change takes effect immediately. */
	private refreshViews(): void {
		// Refresh Live Preview editor extensions and nudge each editor so the
		// table widgets re-apply (or revert) without needing a manual reload.
		this.app.workspace.updateOptions();
		this.app.workspace.getLeavesOfType('markdown').forEach((leaf) => {
			const view = leaf.view;
			if (!(view instanceof MarkdownView)) return;
			view.previewMode?.rerender(true);
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const cm = (view.editor as any)?.cm;
			cm?.dispatch?.({});
		});
	}
}
