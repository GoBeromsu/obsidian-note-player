import { parseLinktext, type App, type TFile } from 'obsidian';

export function resolveEmbeddedFile(app: App, linktext: string, sourcePath: string): TFile | null {
	const { path } = parseLinktext(linktext.split('|')[0] ?? '');
	return app.metadataCache.getFirstLinkpathDest(path, sourcePath);
}
