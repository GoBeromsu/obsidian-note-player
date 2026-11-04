import {
	App,
	debounce,
	Plugin,
	PluginSettingTab,
	type ButtonComponent,
	type Setting,
	type SettingDefinitionItem,
	type SettingDefinitionRender,
} from 'obsidian';
import { DEFAULT_PROPERTY_MAPPING, DEFAULT_SETTINGS, normalizeSettingValue, VAULT_ROOT } from '../domain/config';
import type { NoticeId } from '../domain/notices';
import { folderLabel } from '../domain/settings-options';
import { convertPlaylistNotes } from '../services/playlist-migration-service';
import { ensureFolder } from '../services/vault-io';
import type { AudioFormat } from '../types/audio';
import type { NotePlayerSettings, TurntableStyle } from '../types/settings';
import type { ThumbnailCachePort } from '../types/view';
import { showNotice } from './notices';
import { FolderSuggestModal, PropertySuggestModal, ValueSuggestModal } from './views/PropertySuggestModal';

interface SettingsHost extends Plugin {
	settings: NotePlayerSettings;
	saveSettings(): Promise<void>;
	refresh(showNotice?: boolean): Promise<void>;
	refreshCompanionBases(): Promise<void>;
	getThumbnailCache(): ThumbnailCachePort | null;
}

type PickerKey = keyof typeof DEFAULT_PROPERTY_MAPPING | 'playlistFolder' | 'musicFolder';

interface Picker {
	tooltip: string;
	label?: (value: string) => string;
	open: (current: string, onPick: (value: string) => void, fallback: string) => void;
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
			open: (current, onPick, fallback) => new PropertySuggestModal(this.app, current, onPick, fallback).open(),
		};
		const typeValue: Picker = {
			tooltip: 'Choose a type value',
			open: (current, onPick, fallback) => new ValueSuggestModal(this.app, TYPE_PROPERTY, current, onPick, fallback).open(),
		};
		const folder: Picker = {
			tooltip: 'Choose a folder',
			label: folderLabel,
			open: (current, onPick, fallback) => new FolderSuggestModal(this.app, current, (value) => { void this.pickFolder(value, onPick); }, fallback).open(),
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
				],
			},
			{
				type: 'group',
				heading: 'Library',
				items: [
					this.pickerRow('Playlist folder', 'Playlists are read from this folder and its subfolders, and new playlists are created here.', 'playlistFolder', folder),
					this.pickerRow(
						'Music folder',
						'Notes from pasted YouTube URLs are created here. The library reads track notes in this folder and its subfolders, plus tracks linked from playlists.',
						'musicFolder',
						folder,
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
					this.pickerRow('Music note type', 'The type value that marks a note as a music track.', 'musicNoteType', typeValue),
				],
			},
			{
				type: 'group',
				heading: 'Playlist properties',
				items: [
					this.pickerRow('Membership property', 'Frontmatter key on a track that links the playlists it belongs to.', 'playlistMembershipProperty', property),
					this.pickerRow('Description property', 'Frontmatter key used for playlist description text.', 'playlistDescriptionProperty', property),
					this.pickerRow('Cover property', 'Frontmatter key used for playlist cover artwork.', 'playlistCoverProperty', property),
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
									void runBusy(button, 'Refreshing…', 'bases_refresh_failed', () => this.host.refreshCompanionBases());
								}),
							);
						},
					},
					{
						name: 'Legacy playlist notes',
						desc: 'Preview playlist conversion and cards-view upgrades. Original track lists are preserved.',
						render: (setting) => {
							setting.addButton((button) =>
								button.setButtonText('Convert playlists and switch bases to cards').onClick(() => {
									void convertPlaylistNotes(this.host);
								}),
							);
						},
					},
				],
			},
			{
				type: 'group',
				heading: 'Cache',
				items: [
					{
						name: 'Thumbnail cache',
						desc: 'Track thumbnails are saved in the plugin folder so they show instantly, even offline. Cleared thumbnails download again the next time they appear.',
						render: (setting) => {
							setting.addButton((button) => button.setButtonText('Clear').onClick(() => { void this.clearThumbnails(button); }));
						},
					},
				],
			},
		];
	}

	private async clearThumbnails(button: ButtonComponent): Promise<void> {
		const cache = this.host.getThumbnailCache();
		if (!cache) return;
		await runBusy(button, 'Clearing…', 'thumbnail_cache_clear_failed', async () => {
			await cache.clear();
			showNotice('thumbnail_cache_cleared');
		});
	}

	// The setting only moves once the folder exists, so a failed create leaves the previous choice intact.
	private async pickFolder(value: string, onPick: (value: string) => void): Promise<void> {
		try {
			await ensureFolder(this.app, value);
			onPick(value);
		} catch (error) {
			console.error('[Note Player] Could not create folder', value, error);
			showNotice('folder_create_failed', { path: value });
		}
	}

	private pickerRow(name: string, desc: string, key: PickerKey, picker: Picker): SettingDefinitionRender {
		// An empty saved folder is migrated on load, so its default is not a selectable value.
		const fallback = DEFAULT_SETTINGS[key] || VAULT_ROOT;
		const shown = picker.label?.(fallback) ?? fallback;
		return { name, desc: `${desc} Default: ${shown}.`, render: (setting: Setting) => { this.renderPicker(setting, key, picker, fallback); } };
	}

	private renderPicker(setting: Setting, key: PickerKey, picker: Picker, fallback: string): void {
		setting.setClass('onp-picker-setting');
		setting.addButton((button) => {
			const current = () => String(this.getControlValue(key));
			const sync = () => {
				const value = current();
				const text = picker.label?.(value) ?? value;
				button.setButtonText(text).setTooltip(`${picker.tooltip}: ${text}`);
				button.buttonEl.toggleClass('is-custom', value !== fallback);
			};
			button.onClick(() => picker.open(current(), (value) => {
				this.setControlValue(key, value);
				sync();
				settle(this.host, button.buttonEl);
			}, fallback));
			// Obsidian styles `.dropdown` by class, so the button inherits the native select look, chevrons included.
			button.buttonEl.addClass('dropdown', 'onp-picker-button');
			button.buttonEl.setAttr('aria-haspopup', 'dialog');
			sync();
		});
	}
}

async function runBusy(button: ButtonComponent, busyText: string, failure: NoticeId, task: () => Promise<void>): Promise<void> {
	const idleText = button.buttonEl.getText();
	button.setDisabled(true).setButtonText(busyText);
	try {
		await task();
	} catch (error) {
		console.error('[Note Player]', failure, error);
		showNotice(failure);
	} finally {
		button.setDisabled(false).setButtonText(idleText);
	}
}

function settle(owner: SettingsHost, el: HTMLElement): void {
	owner.registerDomEvent(el, 'animationend', () => el.removeClass('is-changed'), { once: true });
	el.addClass('is-changed');
}
