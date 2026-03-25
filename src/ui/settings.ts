import { AbstractInputSuggest, App, Plugin, PluginSettingTab, Setting } from 'obsidian';
import { DEFAULT_PROPERTY_MAPPING } from '../domain/config';
import type { AudioFormat } from '../types/audio';
import type { NotePlayerSettings } from '../types/settings';

interface SettingsHost extends Plugin {
	settings: NotePlayerSettings;
	saveSettings(): Promise<void>;
	refresh(showNotice?: boolean): Promise<void>;
	refreshCompanionBases(): Promise<void>;
}

function collectVaultProperties(app: App): string[] {
	const properties = new Set<string>();
	for (const file of app.vault.getMarkdownFiles()) {
		const cache = app.metadataCache.getFileCache(file);
		if (cache?.frontmatter) {
			for (const key of Object.keys(cache.frontmatter)) {
				if (key !== 'position') properties.add(key);
			}
		}
	}
	return [...properties].sort();
}

class PropertySuggest extends AbstractInputSuggest<string> {
	private readonly inputEl: HTMLInputElement;

	constructor(
		app: App,
		inputEl: HTMLInputElement,
		private getProperties: () => string[],
	) {
		super(app, inputEl);
		this.inputEl = inputEl;
	}

	getSuggestions(query: string): string[] {
		return this.getProperties().filter((p) =>
			p.toLowerCase().includes(query.toLowerCase()),
		);
	}

	renderSuggestion(value: string, el: HTMLElement): void {
		el.setText(value);
	}

	selectSuggestion(value: string): void {
		this.inputEl.value = value;
		this.inputEl.dispatchEvent(new Event('input'));
		this.close();
	}
}

class CommaPropertySuggest extends AbstractInputSuggest<string> {
	private readonly inputEl: HTMLInputElement;

	constructor(
		app: App,
		inputEl: HTMLInputElement,
		private getProperties: () => string[],
	) {
		super(app, inputEl);
		this.inputEl = inputEl;
	}

	getSuggestions(query: string): string[] {
		const lastToken = query.split(',').pop()?.trim() ?? '';
		return this.getProperties().filter((p) =>
			p.toLowerCase().includes(lastToken.toLowerCase()),
		);
	}

	renderSuggestion(value: string, el: HTMLElement): void {
		el.setText(value);
	}

	selectSuggestion(value: string): void {
		const current = this.inputEl.value;
		const parts = current.split(',');
		parts[parts.length - 1] = ' ' + value;
		this.inputEl.value = parts.join(',').replace(/^,\s*/, '');
		this.inputEl.dispatchEvent(new Event('input'));
		this.close();
	}
}

export class NotePlayerSettingsTab extends PluginSettingTab {
	constructor(app: App, private readonly plugin: SettingsHost) {
		super(app, plugin);
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		const getProperties = () => collectVaultProperties(this.app);

		new Setting(containerEl).setHeading().setName('Obsidian Note Player');

		new Setting(containerEl)
			.setName('Playlist folder')
			.setDesc('New playlist notes are created in this vault folder.')
			.addText((text) => {
				text
					.setPlaceholder('90. System/Playlists')
					.setValue(this.plugin.settings.playlistFolder)
					.onChange(async (value) => {
						this.plugin.settings.playlistFolder = value.trim();
						await this.plugin.saveSettings();
						await this.plugin.refresh();
					});
				text.inputEl.addClass('onp-setting-input-full');
			});

		new Setting(containerEl).setHeading().setName('Music note mapping');

		new Setting(containerEl)
			.setName('URL properties')
			.setDesc('Comma-separated priority order for the YouTube URL property.')
			.addText((text) => {
				text
					.setPlaceholder(DEFAULT_PROPERTY_MAPPING.musicUrlProperties.join(', '))
					.setValue(this.plugin.settings.musicUrlProperties.join(', '))
					.onChange(async (value) => {
						this.plugin.settings.musicUrlProperties = parsePropertyList(value);
						await this.plugin.saveSettings();
						await this.plugin.refresh();
					});
				text.inputEl.addClass('onp-setting-input-full');
				new CommaPropertySuggest(this.app, text.inputEl, getProperties);
			});

		new Setting(containerEl)
			.setName('Thumbnail properties')
			.setDesc('Comma-separated priority order for music-note artwork lookup.')
			.addText((text) => {
				text
					.setPlaceholder(DEFAULT_PROPERTY_MAPPING.musicThumbnailProperties.join(', '))
					.setValue(this.plugin.settings.musicThumbnailProperties.join(', '))
					.onChange(async (value) => {
						this.plugin.settings.musicThumbnailProperties = parsePropertyList(value);
						await this.plugin.saveSettings();
						await this.plugin.refresh();
					});
				text.inputEl.addClass('onp-setting-input-full');
				new CommaPropertySuggest(this.app, text.inputEl, getProperties);
			});

		new Setting(containerEl)
			.setName('Artist properties')
			.setDesc('Comma-separated priority order for artist or author metadata.')
			.addText((text) => {
				text
					.setPlaceholder(DEFAULT_PROPERTY_MAPPING.musicArtistProperties.join(', '))
					.setValue(this.plugin.settings.musicArtistProperties.join(', '))
					.onChange(async (value) => {
						this.plugin.settings.musicArtistProperties = parsePropertyList(value);
						await this.plugin.saveSettings();
						await this.plugin.refresh();
					});
				text.inputEl.addClass('onp-setting-input-full');
				new CommaPropertySuggest(this.app, text.inputEl, getProperties);
			});

		new Setting(containerEl).setHeading().setName('Playlist note schema');

		new Setting(containerEl)
			.setName('Track list property')
			.setDesc('Frontmatter key that stores the ordered track refs for each playlist note.')
			.addText((text) => {
				text
					.setPlaceholder(DEFAULT_PROPERTY_MAPPING.playlistTrackProperty)
					.setValue(this.plugin.settings.playlistTrackProperty)
					.onChange(async (value) => {
						this.plugin.settings.playlistTrackProperty = value.trim();
						await this.plugin.saveSettings();
						await this.plugin.refresh();
					});
				new PropertySuggest(this.app, text.inputEl, getProperties);
			});

		new Setting(containerEl)
			.setName('Description property')
			.setDesc('Frontmatter key used for playlist description text.')
			.addText((text) => {
				text
					.setPlaceholder(DEFAULT_PROPERTY_MAPPING.playlistDescriptionProperty)
					.setValue(this.plugin.settings.playlistDescriptionProperty)
					.onChange(async (value) => {
						this.plugin.settings.playlistDescriptionProperty = value.trim();
						await this.plugin.saveSettings();
						await this.plugin.refresh();
					});
				new PropertySuggest(this.app, text.inputEl, getProperties);
			});

		new Setting(containerEl)
			.setName('Cover property')
			.setDesc('Frontmatter key used for playlist cover artwork.')
			.addText((text) => {
				text
					.setPlaceholder(DEFAULT_PROPERTY_MAPPING.playlistCoverProperty)
					.setValue(this.plugin.settings.playlistCoverProperty)
					.onChange(async (value) => {
						this.plugin.settings.playlistCoverProperty = value.trim();
						await this.plugin.saveSettings();
						await this.plugin.refresh();
					});
				new PropertySuggest(this.app, text.inputEl, getProperties);
			});

		new Setting(containerEl)
			.setName('Music note type')
			.setDesc('The frontmatter type value used to identify music notes.')
			.addText((text) => {
				text
					.setPlaceholder(DEFAULT_PROPERTY_MAPPING.musicNoteType)
					.setValue(this.plugin.settings.musicNoteType)
					.onChange(async (value) => {
						this.plugin.settings.musicNoteType = value.trim();
						await this.plugin.saveSettings();
						await this.plugin.refresh();
					});
				new PropertySuggest(this.app, text.inputEl, getProperties);
			});

		new Setting(containerEl)
			.setName('Playlist note type')
			.setDesc('The frontmatter type value used to identify playlist notes.')
			.addText((text) => {
				text
					.setPlaceholder(DEFAULT_PROPERTY_MAPPING.playlistNoteType)
					.setValue(this.plugin.settings.playlistNoteType)
					.onChange(async (value) => {
						this.plugin.settings.playlistNoteType = value.trim();
						await this.plugin.saveSettings();
						await this.plugin.refresh();
					});
				new PropertySuggest(this.app, text.inputEl, getProperties);
			});

		new Setting(containerEl).setHeading().setName('Companion bases');
		containerEl.createEl('p', {
			text: 'The plugin can generate Music.base and Playlists.base beside your playlist folder. For music-note mapping lists, the first property becomes the bases column.',
			cls: 'setting-item-description',
		});

		new Setting(containerEl)
			.setName('Refresh companion bases files')
			.setDesc('Rewrite the companion bases files to match the current mapping.')
			.addButton((button) =>
				button
					.setButtonText('Refresh bases')
					.onClick(async () => {
						await this.plugin.refreshCompanionBases();
					}),
			);

		new Setting(containerEl).setHeading().setName('Audio fallback');
		containerEl.createEl('p', {
			text: 'When YouTube embed playback is unavailable, the plugin downloads audio via yt-dlp.',
			cls: 'setting-item-description',
		});

		new Setting(containerEl)
			.setName('Audio format')
			.setDesc('The format used when downloading audio via yt-dlp.')
			.addDropdown((dropdown) => {
				const formats: AudioFormat[] = ['mp3', 'wav', 'opus', 'aac'];
				for (const fmt of formats) {
					dropdown.addOption(fmt, fmt.toUpperCase());
				}
				dropdown.setValue(this.plugin.settings.audioFormat);
				dropdown.onChange(async (value) => {
					this.plugin.settings.audioFormat = value as AudioFormat;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName('Autoplay next track')
			.setDesc('Advance to the next queued track when the player reports the current track ended.')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoplayEnabled)
					.onChange(async (value) => {
						this.plugin.settings.autoplayEnabled = value;
						await this.plugin.saveSettings();
						await this.plugin.refresh();
					}),
			);

		new Setting(containerEl)
			.setName('Open on startup')
			.setDesc('Open the playlist view automatically when Obsidian finishes loading.')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.autoOpenOnStartup)
					.onChange(async (value) => {
						this.plugin.settings.autoOpenOnStartup = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Debug logging')
			.setDesc('Emit verbose console logs for indexing and playback state.')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.debug)
					.onChange(async (value) => {
						this.plugin.settings.debug = value;
						await this.plugin.saveSettings();
					}),
			);
	}
}

function parsePropertyList(value: string): string[] {
	return value
		.split(',')
		.map((entry) => entry.trim())
		.filter(Boolean);
}
