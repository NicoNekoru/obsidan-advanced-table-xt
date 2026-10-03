import { PluginSettingTab, App, MarkdownView, type Editor, type SettingDefinitionItem } from 'obsidian';
import type { EditorView } from '@codemirror/view';
import { ObsidianSpreadsheet } from './main';

export class SheetSettingsTab extends PluginSettingTab {
	plugin: ObsidianSpreadsheet;

	constructor(app: App, plugin: ObsidianSpreadsheet) {
		super(app, plugin);
		this.plugin = plugin;
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		return [{
			name: 'Native table post processing',
			desc: 'Apply cell merging, vertical headers and custom CSS to ordinary Markdown tables in reading mode and live preview.',
			control: { type: 'toggle', key: 'nativeProcessing', defaultValue: true },
		}];
	}

	getControlValue(key: string): unknown {
		return key === 'nativeProcessing' ? this.plugin.settings.nativeProcessing : undefined;
	}

	async setControlValue(key: string, value: unknown) {
		if (key !== 'nativeProcessing' || typeof value !== 'boolean') return;
		this.plugin.settings.nativeProcessing = value;
		await this.plugin.saveSettings();
		this.refreshViews();
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
			const cm = (view.editor as Editor & { cm?: EditorView }).cm;
			cm?.dispatch?.({});
		});
	}
}
