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

export function sanitizeFileName(input: string): string {
	const trimmed = input.trim();
	if (!trimmed) {
		return 'New Playlist';
	}

	return trimmed.replace(/[\\/:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();
}
