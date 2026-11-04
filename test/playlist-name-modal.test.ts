import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian';
import { PlaylistNameModal } from '../src/ui/views/PlaylistNameModal';

interface Rendered {
	input: (EventTarget & { value: string; ownerDocument: { activeElement: unknown } }) | undefined;
	buttons: Map<string, () => void>;
	enterHandler: ((event: { isComposing: boolean; target: unknown }) => boolean) | undefined;
	inputKeydownListeners: number;
	closes: number;
	notices: number;
}
const rendered = vi.hoisted((): Rendered => ({
	input: undefined, buttons: new Map(), enterHandler: undefined,
	inputKeydownListeners: 0, closes: 0, notices: 0,
}));

vi.mock('obsidian', () => {
	class Input extends EventTarget {
		value = '';
		ownerDocument = { activeElement: this };
		focus() {}
		addEventListener(
			type: string,
			callback: EventListenerOrEventListenerObject | null,
			options?: boolean | AddEventListenerOptions,
		) {
			if (type === 'keydown') rendered.inputKeydownListeners++;
			super.addEventListener(type, callback, options);
		}
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
			readonly scope = {
				register: (_modifiers: string[], key: string, callback: (event: { isComposing: boolean; target: unknown }) => boolean) => {
					if (key === 'Enter') rendered.enterHandler = callback;
				},
			};
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
	rendered.enterHandler = undefined;
	rendered.inputKeydownListeners = 0;
	rendered.closes = 0;
	rendered.notices = 0;
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

		if (action === 'Enter') {
			const handler = rendered.enterHandler;
			if (!handler) throw new Error('Missing modal Enter handler');
			handler({ isComposing: false, target: input });
		}
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
	])('does not submit Enter while composing=$isComposing', ({ isComposing }) => {
		const submit = vi.fn();
		new PlaylistNameModal(new App(), submit).onOpen();
		const input = rendered.input;
		if (!input) throw new Error('Missing name input');
		input.value = 'Night mix';

		const handler = rendered.enterHandler;
		if (!handler) throw new Error('Missing modal Enter handler');
		expect(handler({ isComposing, target: input })).toBe(true);

		expect(submit).not.toHaveBeenCalled();
		expect(rendered.closes).toBe(0);
	});

	it('does not submit Enter when focus is outside the name input', () => {
		const submit = vi.fn();
		new PlaylistNameModal(new App(), submit).onOpen();
		const input = rendered.input;
		if (!input) throw new Error('Missing name input');
		input.value = 'Night mix';
		input.ownerDocument.activeElement = {};
		const handler = rendered.enterHandler;
		if (!handler) throw new Error('Missing modal Enter handler');

		expect(handler({ isComposing: false, target: {} })).toBe(true);
		expect(submit).not.toHaveBeenCalled();
		expect(rendered.closes).toBe(0);
	});

	it('does not attach a keydown listener directly to the input', () => {
		new PlaylistNameModal(new App(), vi.fn()).onOpen();

		expect(rendered.inputKeydownListeners).toBe(0);
	});
});
