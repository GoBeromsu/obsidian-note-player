export function dedupe(values: string[]): string[] {
	const seen = new Set<string>();
	const deduped: string[] = [];

	for (const value of values) {
		if (seen.has(value)) continue;
		seen.add(value);
		deduped.push(value);
	}

	return deduped;
}

/** `base`, or `base 2`, `base 3`... until `taken` stops matching. */
export function uniqueName(base: string, taken: (name: string) => boolean): string {
	let name = base;
	for (let index = 2; taken(name); index += 1) name = `${base} ${index}`;
	return name;
}

// `#` and `^` would turn the note's wikilink into a heading or block reference.
export const UNSAFE_NAME_CHARS = /[\\/:*?"<>|#^]/;

export function sanitizeFileName(input: string, fallback = 'New Playlist'): string {
	const trimmed = input.trim();
	if (!trimmed) {
		return fallback;
	}

	return trimmed.replace(new RegExp(UNSAFE_NAME_CHARS, 'g'), ' ').replace(/\s+/g, ' ').trim();
}
