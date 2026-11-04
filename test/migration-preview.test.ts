import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian';
import { DEFAULT_SETTINGS } from '../src/domain/config';
import { collectMigrationPlan } from '../src/services/playlist-migration-plan';
import { MigrationPreviewModal } from '../src/ui/views/MigrationPreviewModal';

const rendered = vi.hoisted(() => ({
	buttons: [] as { text: string; disabled: boolean }[],
	summaries: [] as { readonly textContent: string }[],
	preservation: [] as { readonly textContent: string }[],
}));

vi.mock('obsidian', async () => {
	type Options = { text?: string; cls?: string };
	class Element {
		private parts: (string | Element)[] = [];
		constructor(private readonly summary = false) {}
		get textContent(): string { return this.parts.map((part) => typeof part === 'string' ? part : part.textContent).join(''); }
		createDiv(options: Options = {}): Element {
			const child = new Element(options.cls === 'onp-migration-summary');
			if (options.text) child.appendText(options.text);
			if (options.cls === 'onp-migration-preservation') rendered.preservation.push(child);
			this.parts.push(child);
			return child;
		}
		createSpan(options: Options = {}): Element {
			const child = this.createDiv(options);
			if (this.summary) rendered.summaries.push(child);
			return child;
		}
		createEl(_tag: string, options: Options = {}): Element { return this.createDiv(options); }
		appendText(text: string): void { this.parts.push(text); }
		addClass(): void {}
		setAttr(): void {}
		empty(): void { this.parts = []; }
	}
	class Button {
		readonly buttonEl = new Element();
		readonly state = { text: '', disabled: false };
		constructor() { rendered.buttons.push(this.state); }
		setButtonText(text: string): this { this.state.text = text; return this; }
		setDisabled(disabled: boolean): this { this.state.disabled = disabled; return this; }
		setCta(): this { return this; }
		onClick(): this { return this; }
	}
	class Setting {
		readonly settingEl = new Element();
		readonly nameEl = new Element();
		readonly descEl = new Element();
		setClass(): this { return this; }
		addButton(callback: (button: Button) => void): this { callback(new Button()); return this; }
	}
	return {
		...await import('./helpers/migration-obsidian'),
		Modal: class {
			readonly contentEl = new Element();
			readonly modalEl = new Element();
			setTitle() {}
			close() {}
		},
		Setting,
		setIcon() {},
	};
});

beforeEach(() => { rendered.buttons.length = 0; rendered.summaries.length = 0; rendered.preservation.length = 0; });

describe('migration preview counts', () => {
	it.each([
		{ bases: 1, legacy: true, upgrade: false, button: 'Convert 1 playlist', counts: ['1 playlist will convert', '0 tracks will be linked'] },
		{ bases: 1, legacy: true, upgrade: true, button: 'Convert 1 playlist and switch 1 base to cards', counts: ['1 playlist will convert', '1 playlist base will switch to the cards view'] },
		{ bases: 2, legacy: true, upgrade: true, button: 'Convert 1 playlist and switch 2 bases to cards', counts: ['1 playlist will convert', '2 playlist bases will switch to the cards view'] },
		{ bases: 1, legacy: false, upgrade: true, button: 'Switch 1 playlist base to cards', counts: ['1 playlist base will switch to the cards view', '0 skipped'] },
		{ bases: 2, legacy: false, upgrade: true, button: 'Switch 2 playlist bases to cards', counts: ['2 playlist bases will switch to the cards view', '0 skipped'] },
	])('reports conversions separately with $bases bases, legacy=$legacy and upgrade=$upgrade', async ({ bases, legacy, upgrade, button, counts }) => {
		const app = new App();
		for (let index = 0; index < bases; index++) {
			const fm = { type: 'music-playlist', ...(legacy && index === 0 ? { tracks: [] } : {}) };
			await app.vault.create(`Bases/${index}.base`, `views:\n  - type: ${upgrade ? 'note-player' : 'cards'}\n    name: Player\n`);
			await app.vault.create(`Playlists/${index}.md`, `---\n${JSON.stringify(fm)}\n---\n![[Bases/${index}.base]]\n`);
		}
		const { plan } = await collectMigrationPlan(app, { ...DEFAULT_SETTINGS, playlistFolder: 'Playlists' });
		const modal = new MigrationPreviewModal(app, plan, vi.fn());

		modal.onOpen();

		expect(rendered.buttons).toEqual([
			{ text: 'Cancel', disabled: false },
			{ text: button, disabled: false },
		]);
		expect(rendered.summaries.slice(0, 2).map((element) => element.textContent)).toEqual(counts);
		expect(rendered.preservation).toHaveLength(legacy ? 1 : 0);
	});
});
