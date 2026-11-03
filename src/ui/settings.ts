import {
	App,
	debounce,
	Plugin,
	PluginSettingTab,
	type ButtonComponent,
	type ExtraButtonComponent,
	type Setting,
	type SettingDefinitionItem,
	type SettingDefinitionRender,
} from 'obsidian';
import { DEFAULT_PROPERTY_MAPPING, normalizeSettingValue } from '../domain/config';
import { buildFolderOptions } from '../domain/settings-options';
import { convertPlaylistNotes } from '../services/playlist-migration-service';
import type { AudioFormat } from '../types/audio';
import type { NotePlayerSettings, TurntableStyle } from '../types/settings';
import type { ThumbnailCachePort } from '../types/view';
import { showNotice } from './notices';
import { PropertySuggestModal, ValueSuggestModal } from './views/PropertySuggestModal';

interface SettingsHost extends Plugin {
	settings: NotePlayerSettings;
	saveSettings(): Promise<void>;
	refresh(showNotice?: boolean): Promise<void>;
	refreshCompanionBases(): Promise<void>;
	getThumbnailCache(): ThumbnailCachePort | null;
}

type MappingKey = keyof typeof DEFAULT_PROPERTY_MAPPING;
type FolderKey = 'playlistFolder' | 'musicFolder';

interface Picker {
	tooltip: string;
	open: (current: string, onPick: (value: string) => void) => void;
}

const NO_REFRESH_KEYS: readonly string[] = ['audioFormat', 'autoOpenOnStartup', 'turntableSounds'];
const TURNTABLE_STYLE_OPTIONS: Record<TurntableStyle, string> = { realistic: 'Realistic', minimal: 'Minimal' };
const AUDIO_FORMAT_OPTIONS: Record<AudioFormat, string> = { mp3: 'MP3', wav: 'WAV', opus: 'OPUS', aac: 'AAC' };
// Must match the key hasType (utils/frontmatter) reads.
const TYPE_PROPERTY = 'type';

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
		const property: Picker = {
			tooltip: 'Choose a property',
			open: (current, onPick) => new PropertySuggestModal(this.app, current, onPick).open(),
		};
		const typeValue: Picker = {
			tooltip: 'Choose a type value',
			open: (current, onPick) => new ValueSuggestModal(this.app, TYPE_PROPERTY, current, onPick).open(),
		};
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
					{
						name: 'Thumbnail cache',
						desc: 'Track thumbnails are saved in the plugin folder so they show instantly, even offline. Cleared thumbnails download again the next time they appear.',
						render: (setting) => {
							setting.addButton((button) => button.setButtonText('Clear').onClick(() => { void this.clearThumbnails(button); }));
						},
					},
				],
			},
			{
				type: 'group',
				heading: 'Library',
				items: [
					this.folderRow('Playlist folder', 'Playlists are read from this folder and its subfolders, and new playlists are created here.', 'playlistFolder'),
					this.folderRow(
						'Music folder',
						'Vault folder for notes created from pasted YouTube URLs. The library reads track notes in this folder and its subfolders, plus tracks linked from playlists. Vault root includes all folders in the vault.',
						'musicFolder',
					),
				],
			},
			{
				type: 'group',
				heading: 'Track properties',
				items: [
					this.pickerRow('URL property', 'Frontmatter key used for the YouTube URL.', 'musicUrlProperty', property),
					this.pickerRow('Thumbnail property', 'Frontmatter key that receives the video thumbnail when a track is imported.', 'musicThumbnailProperty', property),
					this.pickerRow('Artist property', 'Frontmatter key used for artist or author metadata.', 'musicArtistProperty', property),
				],
			},
			{
				type: 'group',
				heading: 'Playlist properties',
				items: [
					this.pickerRow('Membership property', 'Frontmatter key on a track that links the playlists it belongs to.', 'playlistMembershipProperty', property),
					this.pickerRow('Description property', 'Frontmatter key used for playlist description text.', 'playlistDescriptionProperty', property),
					this.pickerRow('Cover property', 'Frontmatter key used for playlist cover artwork.', 'playlistCoverProperty', property),
					this.pickerRow('Music note type', 'The type value that marks a note as a music track.', 'musicNoteType', typeValue),
					this.pickerRow('Playlist note type', 'The type value that marks a note as a playlist.', 'playlistNoteType', typeValue),
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
					{
						name: 'Legacy playlist notes',
						desc: 'Preview conversion to Bases. Original track lists are preserved.',
						render: (setting) => {
							setting.addButton((button) =>
								button.setButtonText('Convert playlist notes').onClick(() => {
									void convertPlaylistNotes(this.host);
								}),
							);
						},
					},
				],
			},
		];
	}

	private async clearThumbnails(button: ButtonComponent): Promise<void> {
		const cache = this.host.getThumbnailCache();
		if (!cache) return;
		button.setDisabled(true).setButtonText('Clearing…');
		button.buttonEl.addClass('onp-is-busy');
		try {
			await cache.clear();
			showNotice('thumbnail_cache_cleared');
		} catch (error) {
			console.error('[Note Player] Could not clear the thumbnail cache', error);
			showNotice('thumbnail_cache_clear_failed');
		} finally {
			button.buttonEl.removeClass('onp-is-busy');
			button.setDisabled(false).setButtonText('Clear');
		}
	}

	// Rendered imperatively so the options are read from the vault on every display (Obsidian caches declarative
	// definitions) and inserted in order (an options object would reorder integer-like folder names).
	private folderRow(name: string, desc: string, key: FolderKey): SettingDefinitionRender {
		return {
			name,
			desc,
			render: (setting: Setting) => {
				setting.addDropdown((dropdown) => {
					const folders = this.app.vault.getAllFolders(false).map((folder) => folder.path);
					for (const [value, label] of buildFolderOptions(folders, this.host.settings[key])) dropdown.addOption(value, label);
					dropdown.setValue(this.host.settings[key]).onChange((value) => { this.setControlValue(key, value); });
				});
			},
		};
	}

	private pickerRow(name: string, desc: string, key: MappingKey, picker: Picker): SettingDefinitionRender {
		const fallback = DEFAULT_PROPERTY_MAPPING[key];
		return {
			name,
			desc: `${desc} Default: ${fallback}.`,
			render: (setting: Setting) => {
				const current = () => String(this.getControlValue(key));
				let reset: ExtraButtonComponent | null = null;
				let button: ButtonComponent | null = null;
				const sync = () => {
					const value = current();
					button?.setButtonText(value);
					reset?.setDisabled(value === fallback);
				};
				const apply = (value: string) => {
					this.setControlValue(key, value);
					sync();
					if (button) settle(this.host, button.buttonEl);
				};
				setting.setClass('onp-picker-setting');
				setting.addExtraButton((extra) => {
					reset = extra.setIcon('rotate-ccw').setTooltip('Reset to default').onClick(() => {
						if (current() !== fallback) apply(fallback);
					});
				});
				setting.addButton((control) => {
					button = control.setTooltip(picker.tooltip).onClick(() => picker.open(current(), apply));
					// Obsidian styles `.dropdown` by class, so the button inherits the native select look, chevrons included.
					control.buttonEl.addClass('dropdown', 'onp-picker-button');
					control.buttonEl.setAttr('aria-haspopup', 'dialog');
				});
				sync();
			},
		};
	}
}

function settle(owner: SettingsHost, el: HTMLElement): void {
	owner.registerDomEvent(el, 'animationend', () => el.removeClass('is-changed'), { once: true });
	el.addClass('is-changed');
}
