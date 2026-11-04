import { isDeepStrictEqual } from 'node:util';
import type { YoutubePlaylistPropertyMapping } from '../types/settings';

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function upgradePlaylistCards(
	content: string,
	mapping: Pick<YoutubePlaylistPropertyMapping, 'musicThumbnailProperty' | 'musicArtistProperty'>,
	yaml: { readonly parse: (content: string) => unknown; readonly stringify: (value: unknown) => string },
): string {
	const original = yaml.parse(content);
	if (!isRecord(original) || !Array.isArray(original.views)) return content;
	let changed = false;
	const intended = {
		...original,
		properties: {
			'file.name': { displayName: 'Title' },
			...(mapping.musicArtistProperty ? { [`note.${mapping.musicArtistProperty}`]: { displayName: 'Artist' } } : {}),
			...(isRecord(original.properties) ? original.properties : {}),
		},
		views: original.views.map((view: unknown) => {
			if (!isRecord(view) || view.type !== 'note-player') return view;
			changed = true;
			return { ...view, type: 'cards', image: `note.${mapping.musicThumbnailProperty}`, imageFit: '', imageAspectRatio: 0.5625 };
		}),
	};
	if (!changed) return content;
	const result = yaml.stringify(intended);
	if (!isDeepStrictEqual(yaml.parse(result), intended)) {
		throw new Error('Serialized playlist base did not preserve its data.');
	}
	return result;
}
