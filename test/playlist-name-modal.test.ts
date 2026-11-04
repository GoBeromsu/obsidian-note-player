import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian';
import { PlaylistNameModal } from '../src/ui/views/PlaylistNameModal';

interface Rendered {
	input: (EventTarget & { value: string }) | undefined;
	buttons: Map<string, () => void>;
	closes: number;
	notices: number;
}
const rendered = vi.hoisted((): Rendered => ({
	input: undefined, buttons: new Map(), closes: 0, notices: 0,
}));

vi.mock('obsidian', () => {
	class Input extends EventTarget {
		value = '';
		focus() {}
	}
	class TextComponent {
		readonly inputEl = new Input();
		constructor() { rendered.input = this.inputEl; }
		setPlaceholder(): this { return this; }
		getValue(): string { return this.inputEl.value; }
	}
	class Button {
		private text = '';
		setButtonText(text: string): this { this.text = text; return this; }
		setCta(): this { return this; }
		onClick(callback: () => void): this { rendered.buttons.set(this.text, callback); return this; }
	}
	return {
		App: class {},
		Modal: class {
			readonly contentEl = { empty() {} };
			readonly modalEl = { addClass() {} };
			setTitle() {}
			close() { rendered.closes++; }
		},
		Setting: class {
			setName(): this { return this; }
			setDesc(): this { return this; }
			addText(callback: (text: TextComponent) => void): this { callback(new TextComponent()); return this; }
			addButton(callback: (button: Button) => void): this { callback(new Button()); return this; }
		},
		TextComponent,
		Notice: class { constructor() { rendered.notices++; } },
	};
});

beforeEach(() => {
	rendered.input = undefined;
	rendered.buttons.clear();
	rendered.closes = 0;
	rendered.notices = 0;
	vi.stubGlobal('window', { setTimeout: vi.fn() });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('create playlist name submission', () => {
	it.each([
		{ action: 'Enter', value: '  Night mix  ', expected: ['Night mix'] },
		{ action: 'Create', value: '  Night mix  ', expected: ['Night mix'] },
		{ action: 'Enter', value: '', expected: [] },
		{ action: 'Create', value: '', expected: [] },
		{ action: 'Enter', value: ' \t ', expected: [] },
		{ action: 'Create', value: ' \t ', expected: [] },
	])('submits $value through $action only with a name', ({ action, value, expected }) => {
		const submit = vi.fn();
		new PlaylistNameModal(new App(), submit).onOpen();
		const input = rendered.input;
		if (!input) throw new Error('Missing name input');
		input.value = value;

		if (action === 'Enter') input.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { key: 'Enter', isComposing: false }));
		else {
			const click = rendered.buttons.get(action);
			if (!click) throw new Error('Missing create button');
			click();
		}

		expect(submit.mock.calls).toEqual(expected.map((name) => [name]));
		expect(rendered.closes).toBe(expected.length);
		expect(rendered.notices).toBe(expected.length ? 0 : 1);
	});

	it.each([
		{ key: 'Enter', isComposing: true },
		{ key: 'ArrowDown', isComposing: false },
	])('does not submit $key while composing=$isComposing', ({ key, isComposing }) => {
		const submit = vi.fn();
		new PlaylistNameModal(new App(), submit).onOpen();
		const input = rendered.input;
		if (!input) throw new Error('Missing name input');
		input.value = 'Night mix';

		input.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { key, isComposing }));

		expect(submit).not.toHaveBeenCalled();
		expect(rendered.closes).toBe(0);
	});
});
