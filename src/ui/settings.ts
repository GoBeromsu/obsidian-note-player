import {
	AbstractInputSuggest,
	App,
	debounce,
	Plugin,
	PluginSettingTab,
	type Setting,
	type SettingDefinitionItem,
} from 'obsidian';
import { DEFAULT_PROPERTY_MAPPING, normalizeSettingValue } from '../domain/config';
import { collectMusicFiles } from '../services/vault-io';
import type { AudioFormat } from '../types/audio';
import type { NotePlayerSettings, TurntableStyle } from '../types/settings';

interface SettingsHost extends Plugin {
	settings: NotePlayerSettings;
	saveSettings(): Promise<void>;
	refresh(showNotice?: boolean): Promise<void>;
	refreshCompanionBases(): Promise<void>;
}

const NO_REFRESH_KEYS: readonly string[] = ['audioFormat', 'autoOpenOnStartup', 'musicFolder', 'turntableSounds'];
const TURNTABLE_STYLE_OPTIONS: Record<TurntableStyle, string> = { realistic: 'Realistic', minimal: 'Minimal' };
const AUDIO_FORMAT_OPTIONS: Record<AudioFormat, string> = { mp3: 'MP3', wav: 'WAV', opus: 'OPUS', aac: 'AAC' };

function collectVaultProperties(app: App, musicFolder: string): string[] {
	const properties = new Set<string>();
	for (const file of collectMusicFiles(app, [musicFolder])) {
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
	constructor(
		app: App,
		private readonly inputEl: HTMLInputElement,
		private readonly getMusicFolder: () => string,
	) {
		super(app, inputEl);
	}

	getSuggestions(query: string): string[] {
		const token = query.trim().toLowerCase();
		return collectVaultProperties(this.app, this.getMusicFolder()).filter((p) => p.toLowerCase().includes(token));
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

export class NotePlayerSettingsTab extends PluginSettingTab {
	private refreshPending = false;
	// Text inputs report every keystroke; saving and re-rendering the view each time stutters typing.
	private readonly persist = debounce(() => { void this.flush(); }, 500, true);

	constructor(app: App, private readonly host: SettingsHost) {
		super(app, host);
	}

	getControlValue(key: string): unknown {
		return this.host.settings[key as keyof NotePlayerSettings];
	}

	setControlValue(key: string, value: unknown): void {
		const next = normalizeSettingValue(key, value);
		Object.assign(this.host.settings, { [key]: next });
		this.refreshPending ||= !NO_REFRESH_KEYS.includes(key);
		this.persist();
		if (typeof value !== 'string') this.persist.run();
	}

	hide(): void {
		this.persist.run();
		super.hide();
	}

	private async flush(): Promise<void> {
		const refresh = this.refreshPending;
		this.refreshPending = false;
		await this.host.saveSettings();
		if (refresh) await this.host.refresh();
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				type: 'group',
				heading: 'Playback',
				items: [
					{
						name: 'Audio format',
						desc: 'Format for audio downloaded with yt-dlp.',
						control: { type: 'dropdown', key: 'audioFormat', options: AUDIO_FORMAT_OPTIONS },
					},
					{
						name: 'Autoplay next track',
						desc: 'Play the next track in the queue when one ends.',
						control: { type: 'toggle', key: 'autoplayEnabled' },
					},
					{
						name: 'Turntable style',
						desc: 'Realistic is a 3D deck with a lid and a volume knob. Minimal is a flat record and arm.',
						control: { type: 'dropdown', key: 'turntableStyle', options: TURNTABLE_STYLE_OPTIONS },
					},
					{
						name: 'Turntable sounds',
						desc: 'Play a synthesized needle drop, lift, and vinyl crackle with the turntable animation.',
						control: { type: 'toggle', key: 'turntableSounds' },
					},
					{
						name: 'Open on startup',
						desc: 'Open the playlist view automatically when Obsidian finishes loading.',
						control: { type: 'toggle', key: 'autoOpenOnStartup' },
					},
				],
			},
			{
				type: 'group',
				heading: 'Library',
				items: [
				{
					name: 'Playlist folder',
					desc: 'Vault folder where new playlist notes are created.',
					control: { type: 'folder', key: 'playlistFolder', placeholder: '90. System/playlists' },
				},
				{
					name: 'Music folder',
					desc: 'Vault folder for notes created from pasted YouTube URLs. The library reads track notes in this folder and its subfolders, plus playlists in the playlist folder. With no folder set, only notes at the vault root and tracks linked from playlists are listed.',
					control: { type: 'folder', key: 'musicFolder', placeholder: 'Default location' },
				},
				],
			},
			{
				type: 'group',
				heading: 'Music note mapping',
				items: [
					this.propertyRow('URL property', 'Frontmatter key used for the YouTube URL.', 'musicUrlProperty'),
					this.propertyRow('Thumbnail property', 'Frontmatter key used for music-note artwork.', 'musicThumbnailProperty'),
					this.propertyRow('Artist property', 'Frontmatter key used for artist or author metadata.', 'musicArtistProperty'),
				],
			},
			{
				type: 'group',
				heading: 'Playlist note schema',
				items: [
					this.propertyRow('Membership property', 'Frontmatter key for playlist membership links.', 'playlistMembershipProperty'),
					this.propertyRow('Description property', 'Frontmatter key used for playlist description text.', 'playlistDescriptionProperty'),
					this.propertyRow('Cover property', 'Frontmatter key used for playlist cover artwork.', 'playlistCoverProperty'),
					{
						name: 'Music note type',
						desc: 'The frontmatter type value used to identify music notes.',
						control: { type: 'text', key: 'musicNoteType', placeholder: DEFAULT_PROPERTY_MAPPING.musicNoteType },
					},
					{
						name: 'Playlist note type',
						desc: 'The frontmatter type value used to identify playlist notes.',
						control: { type: 'text', key: 'playlistNoteType', placeholder: DEFAULT_PROPERTY_MAPPING.playlistNoteType },
					},
				],
			},
			{
				type: 'group',
				heading: 'Companion Bases',
				items: [
					{
						name: 'Companion Bases files',
						desc: 'Rewrite music.base and playlists.base beside your playlist folder to match the current mapping.',
						render: (setting) => {
							setting.addButton((button) =>
								button.setButtonText('Refresh').onClick(() => {
									void this.host.refreshCompanionBases();
								}),
							);
						},
					},
				],
			},
		];
	}

	private propertyRow(name: string, desc: string, key: keyof typeof DEFAULT_PROPERTY_MAPPING) {
		const placeholder = DEFAULT_PROPERTY_MAPPING[key];
		return {
			name,
			desc,
			render: (setting: Setting) => {
				setting.addText((text) => {
					text
						.setPlaceholder(String(placeholder))
						.setValue(String(this.getControlValue(key)))
						.onChange((value) => { void this.setControlValue(key, value); });
					new PropertySuggest(this.app, text.inputEl, () => this.host.settings.musicFolder);
				});
			},
		};
	}
}
