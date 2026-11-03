import { sanitizeFileName, uniqueName } from '../utils/dedupe';

export interface CompanionNoteInput {
	readonly noteType: string;
	readonly descriptionProperty: string;
	readonly coverProperty: string;
	readonly description?: string;
	readonly cover?: string;
	readonly baseFileName: string;
}

export function createCompanionNoteContent(input: CompanionNoteInput): string {
	const lines = ['---', `type: ${JSON.stringify(input.noteType)}`];
	if (input.descriptionProperty && input.description !== undefined) {
		lines.push(`${JSON.stringify(input.descriptionProperty)}: ${JSON.stringify(input.description)}`);
	}
	if (input.coverProperty && input.cover !== undefined) {
		lines.push(`${JSON.stringify(input.coverProperty)}: ${JSON.stringify(input.cover)}`);
	}
	lines.push('---', '', `![[${input.baseFileName}]]`, '');
	return lines.join('\n');
}

export function playlistFilePaths(
	folder: string,
	name: string,
	exists: (path: string) => boolean,
): { readonly notePath: string; readonly basePath: string } {
	const prefix = folder.split('/').filter(Boolean).join('/');
	const path = (stem: string, extension: string) => `${prefix ? `${prefix}/` : ''}${stem}.${extension}`;
	const stem = uniqueName(sanitizeFileName(name) || 'New Playlist', (candidate) =>
		exists(path(candidate, 'md')) || exists(path(candidate, 'base')),
	);
	return { notePath: path(stem, 'md'), basePath: path(stem, 'base') };
}
