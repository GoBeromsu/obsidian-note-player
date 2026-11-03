import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian';
import { DEFAULT_SETTINGS } from '../src/domain/config';
import { inspectMigrationEmbeds, migrationEmbedBlock } from '../src/domain/migration-embeds';
import { alreadyConverted, convertMigrationContent } from '../src/services/migration-content';

vi.mock('obsidian', () => import('./helpers/migration-obsidian'));
const base = 'Bases/Mix.base';
const frontmatter = { type: 'music-playlist', songs: ['[[A]]'] };
const header = `---\n${JSON.stringify(frontmatter)}\n---\n`;
const edit = {
	playlist: {
		notePath: 'Mix.md', basePath: base, createBase: true, appendEmbed: true,
		membershipAdds: [], renameLegacyKey: true, missing: [],
	},
	settings: { ...DEFAULT_SETTINGS, legacyPlaylistTrackProperty: 'songs' },
	app: new App(),
	frontmatter,
};
const source = { app: edit.app, notePath: edit.playlist.notePath };
beforeEach(async () => {
	if (!edit.app.vault.getFileByPath(base)) await edit.app.vault.create(base, 'views: []\n');
});

describe('migration content decisions', () => {
	it.each([
		'![[Bases/Mix.base]]',
		'![[Bases/Mix]]',
		'Some text ![[Bases/Mix.base|Mix]] after',
		'> ![[Bases/Mix|Mix]]',
		'`example\n\n![[Bases/Mix.base]]\n\n`end',
	])('preserves a user embed without adding another: %s', (body) => {
		const converted = convertMigrationContent(header + body, edit);

		expect(converted).toBe(`---\n{"type":"music-playlist","tracks_legacy":["[[A]]"]}\n---\n${body}`);
	});

	it.each([
		'```md\n![[Bases/Mix.base]]\n```',
		'~~~md\n![[Bases/Mix.base]]\n~~~',
		'> ~~~md\n> ![[Bases/Mix.base]]\n> ~~~',
		'> > ````md\n> > ![[Bases/Mix.base]]\n> > ```\n> > ````',
	])('B7 appends outside a closed fenced example: %s', (body) => {
		const converted = convertMigrationContent(header + body + '\n', edit);

		expect(converted).toBe(`---\n{"type":"music-playlist","tracks_legacy":["[[A]]"]}\n---\n${body}\n\n%% note-player:playlist-base %%\n![[Bases/Mix.base]]\n`);
	});

	it.each([
		'```md\n![[Bases/Mix.base]]',
		'~~~\n![[Bases/Mix.base]]\n```',
		'> ~~~\n> ![[Bases/Mix.base]]\n~~~',
		'`![[Bases/Mix.base]]`',
		'`example\n![[Bases/Mix.base]]\nend`',
		'```md`\n![[Bases/Mix.base]]\n```',
		'<!-- ![[Bases/Mix.base]] -->',
		'\\![[Bases/Mix.base]]',
		'    ![[Bases/Mix.base]]',
		'![[Bases/Mix.base]]\n![[Bases/Mix]]',
		'%% note-player:playlist-base %%\nMissing',
	])('fails closed for ambiguous content: %s', (body) => {
		expect(() => convertMigrationContent(header + body, edit)).toThrow('Needs review');
	});

	it('pairs an exact owned block even before the base exists', () => {
		expect(inspectMigrationEmbeds(migrationEmbedBlock(base), () => null)).toEqual({
			ownedBases: [base], embeddedBases: [base], needsReview: false,
		});
	});

	it('keeps the exact owned block across atomic archive conversion retries', () => {
		const first = convertMigrationContent(header + 'Body\n', edit);
		const archive = { type: 'music-playlist', tracks_legacy: ['[[A]]'] };

		const second = convertMigrationContent(first, { ...edit, frontmatter: archive });

		expect(second).toBe(first);
		expect(alreadyConverted(second, source, edit.settings)).toBe(true);
	});

	it.each([
		{ body: '![[Bases/Mix.base]]', converted: true },
		{ body: '%% note-player:playlist-base %%\n\n![[Bases/Mix.base]]', converted: false },
		{ body: '%% note-player:playlist-base %%\n![[Bases/Mix.base|Alias]]', converted: false },
	])('classifies archived user embeds and malformed owned blocks: $body', ({ body, converted }) => {
		expect(alreadyConverted(`---\n{"type":"music-playlist","tracks_legacy":[]}\n---\n${body}`, source, edit.settings)).toBe(converted);
	});
});
