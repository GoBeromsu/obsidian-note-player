import { describe, expect, it } from 'vitest';
import { parse, stringify } from 'yaml';
import { upgradePlaylistCards } from '../src/domain/base-cards';

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
		const result = upgradePlaylistCards(source, 'my "art"', { parse, stringify });
		expect(parse(result)).toEqual({
			views: [{ type: 'cards', name: 'Player', image: 'note.my "art"' }],
		});
		expect(upgradePlaylistCards(result, 'my "art"', { parse, stringify })).toBe(result);
	});

	it('keeps parsed filters and other views intact while normalizing formatting', () => {
		const source = '# header\r\nfilters: \'type == "music"\'\r\nviews:\r\n  - type: note-player # keep\r\n    sort: [{property: file.mtime, direction: DESC}]\r\n  - type: cards\r\n    image: note.other\r\n';
		expect(parse(upgradePlaylistCards(source, 'poster', { parse, stringify }))).toEqual({
			filters: 'type == "music"',
			views: [
				{ type: 'cards', image: 'note.poster', sort: [{ property: 'file.mtime', direction: 'DESC' }] },
				{ type: 'cards', image: 'note.other' },
			],
		});
	});
});
