import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian';
import { DEFAULT_SETTINGS } from '../src/domain/config';
import { inspectMigrationEmbeds, MIGRATION_EMBED_MARKER } from '../src/domain/migration-embeds';
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
		'![[Bases/Mix.base#ViewName]]',
		'Some text ![[Bases/Mix.base|Mix]] after',
		'> ![[Bases/Mix.base|Mix]]',
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

		expect(converted).toBe(`---\n{"type":"music-playlist","tracks_legacy":["[[A]]"]}\n---\n${body}\n\n![[Bases/Mix.base]]\n`);
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
		'![[Bases/Mix.base]]\n![[Bases/Mix.base|Again]]',
		'%% note-player:playlist-base %%\nMissing',
	])('fails closed for ambiguous content: %s', (body) => {
		expect(() => convertMigrationContent(header + body, edit)).toThrow('Needs review');
	});

	it('pairs an exact owned block even before the base exists', () => {
		expect(inspectMigrationEmbeds(`${MIGRATION_EMBED_MARKER}\n![[${base}]]`, () => null)).toEqual({
			ownedBases: [base], embeddedBases: [base], needsReview: false, unresolvedEmbeds: [],
		});
	});

	it('writes only an embed and leaves fresh conversion bytes identical on rerun', () => {
		const first = convertMigrationContent(header + 'Body\n', edit);
		const archive = { type: 'music-playlist', tracks_legacy: ['[[A]]'] };

		const second = convertMigrationContent(first, { ...edit, frontmatter: archive });

		expect(first).toBe('---\n{"type":"music-playlist","tracks_legacy":["[[A]]"]}\n---\nBody\n\n![[Bases/Mix.base]]\n');
		expect(second).toBe(first);
		expect(alreadyConverted(second, source, edit.settings)).toBe(true);
	});

	it.each([
		{ fm: { type: 'music-playlist' }, converted: true },
		{ fm: { type: 'music-playlist', songs: [] }, converted: false },
		{ fm: { type: 'music-playlist', tracks_legacy: 'invalid' }, converted: false },
		{ fm: { type: 'music-playlist', tracks_legacy: [] }, converted: true },
	])('recognizes native companions without accepting incomplete legacy lists: $fm', ({ fm, converted }) => {
		expect(alreadyConverted(`---\n${JSON.stringify(fm)}\n---\n![[${base}]]`, source, edit.settings)).toBe(converted);
	});

	it.each([
		{ body: '![[Bases/Mix.base]]', converted: true },
		{ body: '%% note-player:playlist-base %%\n![[Bases/Mix.base]]', converted: true },
		{ body: '%% note-player:playlist-base %%\n\n![[Bases/Mix.base]]', converted: false },
		{ body: '%% note-player:playlist-base %%\n![[Bases/Mix.base|Alias]]', converted: false },
	])('classifies archived user embeds and malformed owned blocks: $body', ({ body, converted }) => {
		expect(alreadyConverted(`---\n{"type":"music-playlist","tracks_legacy":[]}\n---\n${body}`, source, edit.settings)).toBe(converted);
	});
});
