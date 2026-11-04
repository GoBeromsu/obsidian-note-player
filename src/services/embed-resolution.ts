import { parseLinktext, type App, type TFile } from 'obsidian';

export function resolveEmbeddedFile(app: App, linktext: string, sourcePath: string): TFile | null {
	const { path } = parseLinktext(linktext.split('|')[0] ?? '');
	return app.metadataCache.getFirstLinkpathDest(path, sourcePath);
}

export function resolvePlaylistBase(
	app: App, note: TFile,
	links: readonly string[] = (app.metadataCache.getFileCache(note)?.embeds ?? []).map((embed) => embed.link),
): TFile | undefined {
	return links.map((link) => resolveEmbeddedFile(app, link, note.path))
		.find((file): file is TFile => file !== null && file.extension === 'base');
}
