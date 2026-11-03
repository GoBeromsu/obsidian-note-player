import { Modal, Setting, setIcon, type App, type ButtonComponent } from 'obsidian';
import type { PlaylistMigrationPlan } from '../../domain/playlist-migration';
import { linkDisplayText } from '../../utils/wikilink';

export class MigrationPreviewModal extends Modal {
	private confirmed = false;
	private convertButton: ButtonComponent | undefined;
	private cancelButton: ButtonComponent | undefined;
	private readonly rows = new Map<string, HTMLElement>();
	private progressEl: HTMLElement | undefined;

	constructor(app: App, private readonly plan: PlaylistMigrationPlan, private readonly finish: (confirmed: boolean) => void) {
		super(app);
	}

	onOpen(): void {
		this.modalEl.addClass('onp-modal', 'onp-migration-modal');
		this.setTitle('Convert playlist notes');
		const { totals } = this.plan;
		const playlists = this.plan.playlists.filter((playlist) =>
			playlist.createBase || playlist.appendEmbed || playlist.renameLegacyKey || playlist.membershipAdds.length > 0);
		const missingCount = playlists.reduce((count, playlist) => count + playlist.missing.length, 0);
		const summary = this.contentEl.createDiv({ cls: 'onp-migration-summary' });
		const counts: [number, string][] = [
			[totals.playlists, totals.playlists === 1 ? 'playlist will convert' : 'playlists will convert'],
			[totals.membershipAdds, totals.membershipAdds === 1 ? 'track will be linked' : 'tracks will be linked'],
			[missingCount, missingCount === 1 ? 'missing reference' : 'missing references'],
			[this.plan.conflicts.length + this.plan.invalid.length, 'skipped'],
		];
		for (const [count, label] of counts) {
			const item = summary.createSpan();
			item.createEl('strong', { text: String(count) });
			item.appendText(` ${label}`);
		}
		this.contentEl.createEl('p', {
			text: 'Original track lists stay in tracks_legacy. Nothing is deleted.',
			cls: 'onp-migration-preservation',
		});
		for (const playlist of playlists) {
			const row = this.playlistRow(playlist.notePath, false);
			const status = row.nameEl.createSpan({ cls: 'onp-migration-status is-ready' });
			this.status(status, 'circle-check', 'Will convert');
			this.rows.set(playlist.notePath, status);
			const tracks = row.descEl.createDiv({ cls: 'onp-migration-tracks', attr: { 'aria-label': 'Tracks to link' } });
			tracks.createSpan({ text: `${playlist.membershipAdds.length} to link`, cls: 'onp-migration-track-count' });
			for (const path of playlist.membershipAdds.slice(0, 5)) {
				tracks.createSpan({ text: this.basename(path), cls: 'onp-migration-pill', attr: { title: path } });
			}
			if (playlist.membershipAdds.length > 5) {
				tracks.createSpan({
					text: `+${playlist.membershipAdds.length - 5} more`, cls: 'onp-migration-pill',
					attr: { title: playlist.membershipAdds.slice(5).join(', ') },
				});
			}
			const base = row.descEl.createDiv({ cls: 'onp-migration-detail' });
			this.icon(base, 'file-spreadsheet');
			base.createSpan({ text: `${playlist.createBase ? 'Create' : 'Use'} ${playlist.basePath}` });
			if (playlist.missing.length) {
				const missing = row.descEl.createDiv({ cls: 'onp-migration-detail onp-migration-missing' });
				this.icon(missing, 'triangle-alert');
				const references = missing.createSpan({ text: `${playlist.missing.length} missing: ${playlist.missing.map((reference) => linkDisplayText(reference, true)).join(', ')}` });
				references.setAttr('title', playlist.missing.join(', '));
				references.setAttr('aria-label', playlist.missing.join(', '));
			}
		}
		for (const path of this.plan.conflicts) {
			const row = this.playlistRow(path, true);
			this.status(row.nameEl.createSpan({ cls: 'onp-migration-status is-warning' }), 'triangle-alert', 'Conflict \u00b7 skipped');
			row.descEl.createDiv({ text: 'tracks_legacy already exists. Both properties will be kept.' });
		}
		for (const path of this.plan.invalid) {
			const row = this.playlistRow(path, true);
			this.status(row.nameEl.createSpan({ cls: 'onp-migration-status is-warning' }), 'circle-alert', 'Invalid \u00b7 skipped');
			row.descEl.createDiv({ text: 'The legacy track property is not a list. Correct it and run again.' });
		}
		this.progressEl = this.contentEl.createDiv({ cls: 'onp-migration-progress', attr: { role: 'status', 'aria-live': 'polite' } });
		new Setting(this.contentEl).setClass('onp-migration-actions')
			.addButton((button) => {
				this.cancelButton = button;
				button.setButtonText('Cancel').onClick(() => this.close());
			})
			.addButton((button) => {
				this.convertButton = button;
				button.setButtonText(`Convert ${totals.playlists} ${totals.playlists === 1 ? 'playlist' : 'playlists'}`).setCta()
				.setDisabled(totals.playlists === 0).onClick(() => {
					if (this.confirmed) return;
					this.confirmed = true;
					this.cancelButton?.setButtonText('Hide');
					button.setDisabled(true);
					this.finish(true);
				});
			});
	}

	showProgress(current: number, total: number, path: string, state: 'converting' | 'converted' | 'failed'): void {
		this.modalEl.addClass('is-converting');
		if (this.convertButton) {
			this.status(this.convertButton.buttonEl, 'loader-circle', `Converting ${current} of ${total}\u2026`);
			this.convertButton.buttonEl.addClass('onp-migration-convert-busy');
		}
		this.progressEl?.setText(`${state === 'failed' ? 'Could not convert' : 'Converting'} ${this.basename(path)}${state === 'failed' ? '. Other playlists will continue.' : '\u2026'}`);
		const status = this.rows.get(path);
		if (!status) return;
		status.removeClass('is-ready', 'is-warning', 'is-working');
		switch (state) {
			case 'converting':
				status.addClass('is-working');
				this.status(status, 'loader-circle', 'Converting');
				break;
			case 'converted':
				status.addClass('is-ready');
				this.status(status, 'circle-check', 'Converted');
				break;
			case 'failed':
				status.addClass('is-warning');
				this.status(status, 'circle-alert', 'Could not convert');
		}
	}

	private playlistRow(path: string, skipped: boolean): Setting {
		const row = new Setting(this.contentEl).setClass('onp-migration-row');
		if (skipped) row.settingEl.addClass('is-skipped');
		row.nameEl.createSpan({ text: this.basename(path), cls: 'onp-migration-name' });
		row.descEl.createDiv({ text: path, cls: 'onp-migration-path' });
		return row;
	}

	private basename(path: string): string {
		return (path.split('/').pop() ?? path).replace(/\.md$/, '');
	}

	private status(el: HTMLElement, icon: string, label: string): void {
		el.empty();
		this.icon(el, icon);
		el.createSpan({ text: label });
	}

	private icon(el: HTMLElement, name: string): void {
		const icon = el.createSpan({ cls: 'onp-migration-icon', attr: { 'aria-hidden': 'true' } });
		setIcon(icon, name);
	}

	onClose(): void {
		this.contentEl.empty();
		if (!this.confirmed) this.finish(false);
	}
}
