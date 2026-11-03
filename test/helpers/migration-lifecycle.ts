import type { App, EventRef } from 'obsidian';
import { observeMigrationMetadata } from '../../src/services/migration-metadata';

export function observeTestMetadata(app: App): () => void {
	const cleanup: (() => void)[] = [];
	observeMigrationMetadata(app, {
		registerEvent(ref: EventRef) { cleanup.push(() => app.metadataCache.offref(ref)); },
		register(callback: () => void) { cleanup.push(callback); },
	});
	return () => { for (const dispose of cleanup.splice(0).reverse()) dispose(); };
}
