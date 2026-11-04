import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { upgradePlaylistCards } from '../src/domain/base-cards';

describe('playlist cards upgrade', () => {
	it.each([
		'views:\n  - type: "note-player"\n    name: Player\n    image: old\n',
		'views:\r\n  - name: Player\r\n    type: note-player # preserve\r\n',
		'views: [{name: Player, type: note-player}]',
		'{"views":[{"type":"note-player","name":"Player","image":"old"}]}',
	])('preserves valid YAML while binding the configured image: %s', (source) => {
		const result = upgradePlaylistCards(source, 'my "art"');
		expect(parse(result)).toEqual({
			views: [{ type: 'cards', name: 'Player', image: 'note.my "art"' }],
		});
		expect(upgradePlaylistCards(result, 'my "art"')).toBe(result);
	});

	it('keeps filters, comments, other views, and CRLF bytes intact', () => {
		const source = '# header\r\nfilters: \'type == "music"\'\r\nviews:\r\n  - type: note-player # keep\r\n    sort: [{property: file.mtime, direction: DESC}]\r\n  - type: cards\r\n    image: note.other\r\n';
		expect(upgradePlaylistCards(source, 'poster')).toBe(source.replace(
			'type: note-player # keep\r\n', 'type: cards # keep\r\n    image: "note.poster"\r\n'));
	});
});
