import { isDeepStrictEqual } from 'node:util';

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function upgradePlaylistCards(
	content: string,
	imageProperty: string,
	yaml: { readonly parse: (content: string) => unknown; readonly stringify: (value: unknown) => string },
): string {
	const original = yaml.parse(content);
	if (!isRecord(original) || !Array.isArray(original.views)) return content;
	let changed = false;
	const intended = {
		...original,
		views: original.views.map((view: unknown) => {
			if (!isRecord(view) || view.type !== 'note-player') return view;
			changed = true;
			return { ...view, type: 'cards', image: `note.${imageProperty}` };
		}),
	};
	if (!changed) return content;
	const result = yaml.stringify(intended);
	if (!isDeepStrictEqual(yaml.parse(result), intended)) {
		throw new Error('Serialized playlist base did not preserve its data.');
	}
	return result;
}
