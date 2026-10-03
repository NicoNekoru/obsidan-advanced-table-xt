import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';

async function loadModule(entry, mockObsidian = false) {
	const result = await build({
		entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'node',
		plugins: mockObsidian ? [{
			name: 'mock-obsidian',
			setup(build) {
				build.onResolve({ filter: /^obsidian$/ }, () => ({ path: 'obsidian', namespace: 'mock' }));
				build.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: `
					export class MarkdownRenderChild { constructor(el) { this.containerEl = el; } }
					export class Plugin {}
					export class PluginSettingTab {}
					export class Setting {}
					export class MarkdownView {}
					export const htmlToMarkdown = el => el.textContent;
					export const editorInfoField = {kind: 'file'};
					export const editorLivePreviewField = {kind: 'livePreview'};
					export const MarkdownRenderer = { async render(app, source, el, path, child) {
						app.calls?.push({source, path, child});
						const p = el.ownerDocument.createElement('p');
						p.textContent = source; el.append(p);
					} };
				` }));
			},
		}] : [],
	});
	return import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'));
}

const model = await loadModule('src/tableModel.ts');
const augmenter = await loadModule('src/tableAugmenter.ts');
const widgets = await loadModule('src/tableWidgets.ts');
const sheet = await loadModule('src/sheetElement.ts', true);
const livePreview = await loadModule('src/livePreview.ts', true);
const pluginModule = await loadModule('src/main.ts', true);
const settingsModule = await loadModule('src/settings.ts', true);

function makeTable(rows, headers = 1) {
	const window = makeWindow();
	const table = window.document.createElement('table');
	window.document.body.append(table);
	const head = table.createTHead();
	const body = table.createTBody();
	const grid = rows.map((row, r) => {
		const tr = (r < headers ? head : body).insertRow();
		return row.map(text => {
			const el = window.document.createElement(r < headers ? 'th' : 'td');
			el.textContent = text; tr.append(el); return { text, el };
		});
	});
	return { window, table, grid };
}

function makeWindow() {
	const { window } = new JSDOM();
	window.HTMLElement.prototype.createEl = function(tag) {
		const el = this.ownerDocument.createElement(tag); this.append(el); return el;
	};
	window.HTMLElement.prototype.createDiv = function() { return this.createEl('div'); };
	return window;
}

const finishRender = () => new Promise(resolve => setImmediate(resolve));

const hidden = cell => cell.el.classList.contains(augmenter.SHEETS_HIDDEN_CLASS);

test('finds both Obsidian 1.13 tiles and previous CodeMirror views', () => {
	const { window } = new JSDOM('<div class="cm-editor"><div class="cm-table-widget"></div><div class="cm-table-widget"></div><div class="cm-editor"><div class="cm-table-widget"></div></div></div>');
	const editor = window.document.querySelector('.cm-editor');
	const doms = editor.querySelectorAll('.cm-table-widget');
	const table = window.document.createElement('table');
	const current = { rows: [], tableEl: table };
	const previous = { rows: [], tableEl: table };
	doms[0].cmTile = { widget: current };
	doms[1].cmView = { widget: previous };
	doms[2].cmTile = { widget: { rows: [], tableEl: table } };
	assert.deepEqual(widgets.getTableWidgets(editor), [current, previous]);
	doms[0].cmTile = { widget: {} };
	assert.deepEqual(widgets.getTableWidgets(editor), [previous]);
});

test('declarative settings validate values, save and refresh open views', async () => {
	let saves = 0;
	let refreshes = 0;
	const plugin = {settings: {nativeProcessing: true}, saveSettings: async () => { saves++; }};
	const tab = new settingsModule.SheetSettingsTab({}, plugin);
	tab.app = {workspace: {updateOptions: () => { refreshes++; }, getLeavesOfType: () => []}};
	assert.equal(tab.getSettingDefinitions()[0].control.key, 'nativeProcessing');
	assert.equal(tab.getControlValue('nativeProcessing'), true);
	assert.equal(tab.getControlValue('other'), undefined);
	await tab.setControlValue('other', false);
	await tab.setControlValue('nativeProcessing', 'false');
	assert.equal(saves, 0);
	assert.equal(refreshes, 0);
	await tab.setControlValue('nativeProcessing', false);
	assert.equal(tab.getControlValue('nativeProcessing'), false);
	assert.equal(saves, 1);
	assert.equal(refreshes, 1);
});

test('Live Preview restores native cells before interaction and cleans up on destroy', () => {
	const { window, table, grid } = makeTable([['A', 'B'], ['^', 'Value'], ['Wide', '<']]);
	const editor = window.document.createElement('div');
	editor.className = 'cm-editor';
	const dom = window.document.createElement('div');
	dom.className = 'cm-table-widget';
	editor.append(dom); dom.append(table); window.document.body.append(editor);
	const widget = {rows: grid, tableEl: table, start: 10, end: 100, selectedCells: []};
	dom.cmTile = {widget};
	const frames = new Map();
	let nextFrame = 0;
	window.requestAnimationFrame = callback => { frames.set(++nextFrame, callback); return nextFrame; };
	window.cancelAnimationFrame = id => frames.delete(id);
	const flush = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(cb => cb()); };
	let enabled = true;
	let frontmatter = {};
	let preview = true;
	const selection = {from: 0, to: 0};
	const view = {dom: editor, root: window.document, state: {
		selection: {main: selection},
		field: field => field.kind === 'file' ? {file: {path: 'test.md'}} : preview,
	}};
	const extension = livePreview.sheetsLivePreviewExtension({
		app: {metadataCache: {getFileCache: () => ({frontmatter})}}, isEnabled: () => enabled,
	});
	const instance = extension.create(view);
	flush(); assert.equal(grid[2][0].el.colSpan, 2);
	assert.equal(grid[0][0].el.rowSpan, 1);
	assert.equal(hidden(grid[1][0]), false);
	grid[2][0].el.dispatchEvent(new window.MouseEvent('pointerdown', {bubbles: true}));
	assert.equal(grid[2][0].el.colSpan, 1);
	assert.equal(hidden(grid[2][1]), false);
	selection.from = selection.to = 20;
	flush(); assert.equal(grid[2][0].el.colSpan, 1);
	selection.from = selection.to = 0;
	instance.update({}); flush(); assert.equal(grid[2][0].el.colSpan, 2);
	for (const disable of [() => enabled = false, () => frontmatter = {'disable-sheet': true}, () => preview = false, () => widget.selectedCells = [{}]]) {
		disable(); instance.update({}); flush(); assert.equal(grid[2][0].el.colSpan, 1);
		enabled = true; frontmatter = {}; preview = true; widget.selectedCells = [];
		instance.update({}); flush(); assert.equal(grid[2][0].el.colSpan, 2);
		assert.equal(grid[0][0].el.rowSpan, 1);
		assert.equal(hidden(grid[1][0]), false);
	}
	instance.update({}); instance.destroy();
	assert.equal(frames.size, 0);
	assert.equal(grid[2][0].el.colSpan, 1);
	assert.equal(hidden(grid[2][1]), false);
});

test('Reading view unload removes spans and processing flags from existing tables', () => {
	const {grid, table} = makeTable([['Head', 'B'], ['^', 'Value'], ['^', 'Bottom']]);
	const plugin = new pluginModule.ObsidianSpreadsheet();
	const children = [];
	plugin.processReadingTable(table, {
		getSectionInfo: () => ({text: '| Head | B |\n| --- | --- |\n| ^ | Value |\n| ^ | Bottom |', lineStart: 0, lineEnd: 3}),
		addChild: child => children.push(child),
	});
	assert.equal(grid[0][0].el.rowSpan, 1);
	assert.equal(hidden(grid[1][0]), false);
	assert.equal(grid[1][0].el.rowSpan, 2);
	assert.equal(table.dataset.sheetsProcessed, 'true');
	plugin.onunload();
	assert.equal(grid[1][0].el.rowSpan, 1);
	assert.equal(hidden(grid[2][0]), false);
	assert.equal(table.dataset.sheetsProcessed, undefined);
	children[0].onunload();
	assert.equal(table.tBodies.length, 1);
});

test('preserves Fast Text Color, strike, escaped tildes and code spans', () => {
	for (const text of ['~={red}td red=~', 'td ~={green}green=~', '~~strike~~', String.raw`escaped \~ .class`, '`code ~ .class`', 'ordinary ~ text']) {
		const parsed = model.parseCell(text);
		assert.equal(parsed.hasStyle, false, text);
		assert.equal(parsed.visible, text);
	}
	const parsed = model.parseCell('text ~ approx ~ .class {opacity: 0.5}');
	assert.equal(parsed.visible, 'text ~ approx ');
	assert.deepEqual(parsed.classes, ['class']);
	assert.equal(parsed.style.opacity, 0.5);
	assert.equal(model.parseCell('< ~ .class').mergeLeft, true);
});

test('splits escaped pipes, even backslashes and empty cells', () => {
	assert.deepEqual(model.splitTableSource(String.raw`| a\|b | c |`), [[String.raw`a\|b`, 'c']]);
	assert.deepEqual(model.splitTableSource(String.raw`| a\\| b |`), [[String.raw`a\\`, 'b']]);
	assert.deepEqual(model.splitTableSource('| | a | |'), [['', 'a', '']]);
	assert.equal(model.findDelimiterRow([['head', 'head'], ['--- ~ .a', ':---:']]), 1);
});

test('applies horizontal, vertical and rectangular merges idempotently', () => {
	const { grid, table } = makeTable([['A', 'B', 'C'], ['Wide', '<', 'Tail'], ['^', '^', 'End']]);
	for (let pass = 0; pass < 3; pass++) {
		augmenter.augmentGrid(grid);
		assert.equal(grid[1][0].el.colSpan, 2);
		assert.equal(grid[1][0].el.rowSpan, 2);
		assert.ok(hidden(grid[1][1]));
		assert.ok(hidden(grid[2][0]));
		assert.ok(hidden(grid[2][1]));
		assert.equal(hidden(grid[2][2]), false);
	}
	augmenter.revertTable(table);
	for (const cell of grid.flat()) {
		assert.equal(hidden(cell), false); assert.equal(cell.el.colSpan, 1); assert.equal(cell.el.rowSpan, 1);
	}
});

test('rejects upward merges into the header and keeps native row groups unchanged', () => {
	const { table, grid } = makeTable([
		['Date', 'Gain', 'Nóri', '<', '<', '<', 'Ákos', '<', '<', '<'],
		['^', '^', 'spending', 'gain', 'profit', 'balance', 'spending', 'gain', 'profit', 'balance'],
	]);
	const headerRow = grid[0][0].el.parentElement;
	const bodyRow = grid[1][0].el.parentElement;
	const head = headerRow.parentElement;
	const body = bodyRow.parentElement;
	for (let pass = 0; pass < 3; pass++) {
		augmenter.augmentGrid(grid);
		assert.equal(grid[0][0].el.rowSpan, 1);
		assert.equal(grid[0][1].el.rowSpan, 1);
		assert.equal(grid[0][2].el.colSpan, 4);
		assert.equal(grid[0][6].el.colSpan, 4);
		assert.equal(hidden(grid[1][0]), false);
		assert.equal(hidden(grid[1][1]), false);
		assert.equal(grid[1][0].el.textContent, '^');
		assert.equal(headerRow.parentElement, head);
		assert.equal(bodyRow.parentElement, body);
		assert.equal(table.tBodies.length, 1);
	}
	augmenter.revertTable(table);
	assert.equal(headerRow.parentElement, head);
	assert.equal(bodyRow.parentElement, body);
	assert.equal(table.tBodies.length, 1);
	assert.equal(grid[0][0].el.rowSpan, 1);
});

test('rejects vertical merging within header rows and across body sections', () => {
	const { table, grid } = makeTable([['Head', 'B'], ['^', 'Subhead'], ['Body', 'Value'], ['^', 'Bottom']], 2);
	const body = table.createTBody();
	body.append(grid[3][0].el.parentElement);
	augmenter.augmentGrid(grid);
	assert.equal(grid[0][0].el.rowSpan, 1);
	assert.equal(grid[2][0].el.rowSpan, 1);
	assert.equal(hidden(grid[1][0]), false);
	assert.equal(hidden(grid[3][0]), false);
	assert.equal(table.tHead.rows.length, 2);
	assert.equal(table.tBodies.length, 2);
});

test('vertical headers survive merged rows and do not inflate colspans', () => {
	const { grid } = makeTable([['Label', '-', 'A', 'B'], ['Group', '-', 'Wide', '<'], ['Section', '<', '<', '<'], ['Other', '-', 'C', 'D']]);
	augmenter.augmentGrid(grid);
	assert.equal(model.findHeaderColumn(grid.map(row => row.map(c => c.text))), 1);
	for (const row of grid) assert.ok(hidden(row[1]));
	assert.ok(grid[1][0].el.classList.contains(augmenter.SHEETS_ROW_HEADER_CLASS));
	assert.equal(grid[2][0].el.colSpan, 3);
	assert.equal(model.findHeaderColumn([['A', '<'], ['B', '<']]), -1);
});

test('styles, CSS variables and rendered content are reversible without losing handlers', () => {
	const { grid, table, window } = makeTable([['Header'], ["Bold ~ .custom {color:'cyan', '--accent':'red'}"]]);
	const cell = grid[1][0];
	cell.el.style.color = 'green';
	cell.el.classList.add('native');
	cell.el.replaceChildren();
	const strong = window.document.createElement('strong');
	strong.textContent = 'Bold';
	let clicks = 0;
	strong.addEventListener('click', () => clicks++);
	cell.el.append(strong, " ~ .custom {color:'cyan', '--accent':'red'}");
	for (let pass = 0; pass < 3; pass++) {
		augmenter.augmentGrid(grid);
		assert.equal(cell.el.textContent, 'Bold');
		assert.equal(cell.el.style.color, 'cyan');
		assert.equal(cell.el.style.getPropertyValue('--accent'), 'red');
	}
	augmenter.revertTable(table);
	assert.equal(cell.el.firstChild, strong);
	strong.click(); assert.equal(clicks, 1);
	assert.equal(cell.el.textContent, cell.text);
	assert.equal(cell.el.style.color, 'green');
	assert.equal(cell.el.style.getPropertyValue('--accent'), '');
	assert.equal(cell.el.className, 'native');
});

test('does not replace content that Obsidian has rerendered', () => {
	const { grid, table } = makeTable([['Head'], ['Old ~ .class']]);
	augmenter.augmentGrid(grid);
	grid[1][0].el.textContent = 'New';
	augmenter.revertTable(table);
	assert.equal(grid[1][0].el.textContent, 'New');
});

test('sheet code blocks create real scrollable tables with metadata and source paths', async () => {
	const window = makeWindow();
	const el = window.document.createElement('div');
	const app = { calls: [] };
	const renderer = new sheet.SheetElement(el, `
{classes: {highlight: {color: 'cyan'}}}
--- ~ .whole {backgroundColor: 'black'}
| Label | - | A | B |
| --- | --- | :---: ~ .highlight | --- |
| Group | - | Wide | < |
| Other | - | ^ | ^ |
`, { sourcePath: 'folder/test.md' }, app);
	renderer.onload();
	await finishRender();
	const table = el.querySelector('table');
	assert.ok(table);
	assert.equal(table.parentElement.className, 'sheets-table-scroll');
	assert.ok(table.classList.contains('whole'));
	assert.equal(table.rows[1].cells[2].colSpan, 2);
	assert.equal(table.rows[1].cells[2].rowSpan, 2);
	assert.equal(table.rows[1].cells[2].style.color, 'cyan');
	assert.equal(table.rows[1].cells[2].style.textAlign, 'center');
	assert.equal(table.rows[1].cells[2].style.backgroundColor, 'black');
	assert.ok(app.calls.every(call => call.path === 'folder/test.md' && call.child === renderer));
});

test('malformed sheet metadata shows an error without a partial table', async () => {
	const window = makeWindow();
	const el = window.document.createElement('div');
	new sheet.SheetElement(el, '{broken\n---\n| A |', { sourcePath: '' }, {}).onload();
	await finishRender();
	assert.ok(el.querySelector('.obs-sheets_error'));
	assert.equal(el.querySelector('table'), null);
});

test('sheet code blocks keep upward header markers visible while merging body cells', async () => {
	const window = makeWindow();
	const el = window.document.createElement('div');
	new sheet.SheetElement(el, '| Head | B |\n| --- | --- |\n| ^ | Wide |\n| ^ | ^ |', { sourcePath: 'test.md' }, {}).onload();
	await finishRender();
	const table = el.querySelector('table');
	assert.equal(table.tHead.rows[0].cells[0].rowSpan, 1);
	assert.equal(table.tBodies.length, 1);
	assert.equal(table.tBodies[0].rows.length, 2);
	assert.equal(table.rows[1].cells[0].textContent, '^');
	assert.equal(hidden({el: table.rows[1].cells[0]}), false);
	assert.equal(table.rows[1].cells[0].rowSpan, 2);
	assert.equal(table.rows[1].cells[1].rowSpan, 2);
	assert.equal(hidden({el: table.rows[2].cells[0]}), true);
});
