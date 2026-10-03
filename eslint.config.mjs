import { defineConfig } from 'eslint/config';
import obsidianmd from 'eslint-plugin-obsidianmd';

export default defineConfig([
	{ ignores: ['node_modules/**', 'dist/**', 'main.js', 'tests/**', '*.mjs', '.eslintrc.js'] },
	...obsidianmd.configs.recommended,
	{
		files: ['src/**/*.ts'],
		languageOptions: { parserOptions: { projectService: true } },
	},
]);
