import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

describe('native Bases architecture', () => {
	it('has no custom Bases renderer or registration in plugin sources', async () => {
		const source = fileURLToPath(new URL('../src/', import.meta.url));
		const files = (await readdir(source, { recursive: true })).filter((path) => path.endsWith('.ts'));
		const violations: string[] = [];
		for (const path of files) {
			if (/\b(?:BasesView|registerBasesView)\b/.test(await readFile(`${source}/${path}`, 'utf8'))) violations.push(path);
		}
		expect(violations).toEqual([]);
	});
});
