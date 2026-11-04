import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { upgradePlaylistCards } from '../src/domain/base-cards';
import { DEFAULT_PROPERTY_MAPPING } from '../src/domain/config';

describe('playlist cards upgrade', () => {
	it.each([
		'views:\n  - type: "note-player"\n    name: Player\n    image: old\n',
		'views:\r\n  - name: Player\r\n    type: note-player # preserve\r\n',
		'views: [{name: Player, type: note-player}]',
		'{"views":[{"type":"note-player","name":"Player","image":"old"}]}',
		'views:\n  - type: >-\n      note-player\n    name: Player\n',
		'views:\n  - type: |-\n      note-player\n    name: Player\n',
		'views:\n  - type: note-player\n    image: >-\n      note.old\n    name: Player\n',
		'views:\n  - type: note-player\n    image: |\n      note.old\n    name: Player\n',
		'views:\n  - ? type\n    : note-player\n    name: Player\n',
	])('preserves valid YAML while binding the configured image: %s', (source) => {
		const mapping = { ...DEFAULT_PROPERTY_MAPPING, musicThumbnailProperty: 'my "art"', musicArtistProperty: 'performer' };
		const result = upgradePlaylistCards(source, mapping, { parse, stringify });
		expect(parse(result)).toEqual({
			properties: { 'file.name': { displayName: 'Title' }, 'note.performer': { displayName: 'Artist' } },
			views: [{ type: 'cards', name: 'Player', image: 'note.my "art"', imageFit: '', imageAspectRatio: 0.5625 }],
		});
		expect(upgradePlaylistCards(result, mapping, { parse, stringify })).toBe(result);
	});

	it('keeps parsed filters and other views intact while normalizing formatting', () => {
		const source = '# header\r\nfilters: \'type == "music"\'\r\nviews:\r\n  - type: note-player # keep\r\n    sort: [{property: file.mtime, direction: DESC}]\r\n  - type: cards\r\n    image: note.other\r\n';
		expect(parse(upgradePlaylistCards(source, { ...DEFAULT_PROPERTY_MAPPING, musicThumbnailProperty: 'poster' }, { parse, stringify }))).toEqual({
			filters: 'type == "music"',
			properties: { 'file.name': { displayName: 'Title' }, 'note.author': { displayName: 'Artist' } },
			views: [
				{ type: 'cards', image: 'note.poster', imageFit: '', imageAspectRatio: 0.5625, sort: [{ property: 'file.mtime', direction: 'DESC' }] },
				{ type: 'cards', image: 'note.other' },
			],
		});
	});

	it('keeps existing property labels and settings when adding mapped defaults', () => {
		const source = stringify({
			properties: { 'file.name': { displayName: 'Song' }, 'note.performer': { displayName: 'Band' }, 'note.rating': { displayName: 'Stars' } },
			views: [{ type: 'note-player', imageFit: 'contain', imageAspectRatio: 1 }],
		});

		const result = parse(upgradePlaylistCards(source,
			{ ...DEFAULT_PROPERTY_MAPPING, musicArtistProperty: 'performer' }, { parse, stringify }));

		expect(result).toMatchObject({
			properties: { 'file.name': { displayName: 'Song' }, 'note.performer': { displayName: 'Band' }, 'note.rating': { displayName: 'Stars' } },
			views: [{ imageFit: '', imageAspectRatio: 0.5625 }],
		});
	});
});
