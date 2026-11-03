export const MIGRATION_EMBED_MARKER = '%% note-player:playlist-base %%';

export function migrationEmbedBlock(basePath: string): string {
	return `${MIGRATION_EMBED_MARKER}\n![[${basePath}]]`;
}

/** This is a conservative migration recognizer, not a Markdown parser. */
export function inspectMigrationEmbeds(content: string, basePaths: readonly string[]) {
	const lines = content.split(/\r?\n/);
	const ownedBases = lines.flatMap((line, index) => {
		const path = line === MIGRATION_EMBED_MARKER
			? /^!\[\[([^\]|]+\.base)\]\]$/.exec(lines[index + 1] ?? '')?.[1] : undefined;
		return path ? [path] : [];
	});
	const paths = [...new Set([...basePaths, ...ownedBases])];
	const embeddedBases: string[] = [];
	let needsReview = false;
	let fence: { readonly character: string; readonly length: number; readonly quotes: number } | undefined;
	let comment = false;
	let inlineDelimiter: number | undefined;
	for (const [index, line] of lines.entries()) {
		if (!line.trim()) inlineDelimiter = undefined;
		if (line === MIGRATION_EMBED_MARKER) {
			const owned = /^!\[\[([^\]|]+\.base)\]\]$/.exec(lines[index + 1] ?? '')?.[1];
			if (!owned) needsReview = true;
			if (fence || comment || inlineDelimiter) needsReview = true;
			continue;
		}
		const quoted = /^( {0,3}(?:> ?)*)(.*)$/.exec(line);
		const prefix = quoted?.[1] ?? '';
		const text = quoted?.[2] ?? line;
		const quotes = [...prefix.matchAll(/>/g)].length;
		const delimiter = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(text);
		if (fence) {
			if (quotes !== fence.quotes) needsReview = true;
			if (delimiter?.[1]?.[0] === fence.character && delimiter[1].length >= fence.length
				&& !delimiter[2]?.trim() && quotes === fence.quotes) fence = undefined;
			continue;
		}
		if (delimiter?.[1]) {
			if (delimiter[1][0] === '`' && delimiter[2]?.includes('`')) needsReview = true;
			fence = { character: delimiter[1][0] ?? '', length: delimiter[1].length, quotes };
			continue;
		}
		if (line.includes('<!--')) comment = true;
		for (const match of line.matchAll(/!\[\[([^\]\n]+)\]\]/g)) {
			const target = match[1]?.split('|')[0] ?? '';
			const matches = paths.filter((base) => target === base || target === base.replace(/\.base$/, ''));
			const path = matches[0];
			if (matches.length > 1) needsReview = true;
			if (!path) {
				if (target.endsWith('.base')) needsReview = true;
				continue;
			}
			// Inline code, escaped syntax, comments and indented blocks need human interpretation.
			if (comment || inlineDelimiter || line.includes('`') || /^(?: {4}|\t)/.test(line)
				|| line[match.index - 1] === '\\' || line.includes('%%')) needsReview = true;
			embeddedBases.push(path);
		}
		if (line.includes('![[') && !line.includes(']]')) needsReview = true;
		if (line.includes('-->')) comment = false;
		for (const run of line.matchAll(/`+/g)) {
			if (inlineDelimiter === undefined) inlineDelimiter = run[0].length;
			else if (inlineDelimiter === run[0].length) inlineDelimiter = undefined;
		}
	}
	if (fence || comment || embeddedBases.length > 1 || ownedBases.length > 1) needsReview = true;
	if (ownedBases.some((path) => embeddedBases.length && !embeddedBases.includes(path))) needsReview = true;
	return { ownedBases, embeddedBases, needsReview };
}
