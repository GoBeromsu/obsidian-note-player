import { Modal, Setting, type App } from 'obsidian';
import type { PlaylistMigrationPlan } from '../../domain/playlist-migration';

export class MigrationPreviewModal extends Modal {
	private confirmed = false;

	constructor(app: App, private readonly plan: PlaylistMigrationPlan, private readonly finish: (confirmed: boolean) => void) {
		super(app);
	}

	onOpen(): void {
		this.modalEl.addClass('onp-modal', 'onp-migration-modal');
		this.setTitle('Convert playlist notes');
		this.contentEl.createEl('p', {
			text: 'Track lists are kept as tracks_legacy. No notes or existing files are deleted.',
			cls: 'onp-migration-summary',
		});
		for (const playlist of this.plan.playlists) {
			if (!playlist.createBase && !playlist.appendEmbed && !playlist.renameLegacyKey && !playlist.membershipAdds.length) continue;
			const row = new Setting(this.contentEl).setName(playlist.notePath.replace(/\.md$/, ''));
			const details = row.descEl;
			details.createDiv({ text: `Tracks to link: ${playlist.membershipAdds.length}` });
			if (playlist.membershipAdds.length) details.createDiv({ text: playlist.membershipAdds.join(', '), cls: 'onp-migration-paths' });
			details.createDiv({ text: `${playlist.createBase ? 'Base to create' : 'Existing base'}: ${playlist.basePath}` });
			details.createDiv({ text: `Missing refs: ${playlist.missing.length}${playlist.missing.length ? ` - ${playlist.missing.join(', ')}` : ''}` });
		}
		for (const path of this.plan.conflicts) {
			new Setting(this.contentEl).setName(path).setDesc('Conflict - tracks_legacy already exists. Skipped; both properties are kept.');
		}
		for (const path of this.plan.invalid) {
			new Setting(this.contentEl).setName(path).setDesc('Invalid - legacy tracks must be a list. Skipped; correct the property and run again.');
		}
		new Setting(this.contentEl).setClass('onp-migration-actions')
			.addButton((button) => button.setButtonText('Cancel').onClick(() => this.close()))
			.addButton((button) => button.setButtonText('Convert').setCta()
				.setDisabled(this.plan.totals.playlists === 0).onClick(() => {
					this.confirmed = true;
					this.close();
				}));
	}

	onClose(): void {
		this.contentEl.empty();
		this.finish(this.confirmed);
	}
}
