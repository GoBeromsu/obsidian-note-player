import { describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian';
import { FolderSuggestModal, PropertySuggestModal, ValueSuggestModal } from '../src/ui/views/PropertySuggestModal';

vi.mock('obsidian', () => ({
  App: class {
    vault = {
      getMarkdownFiles: () => [{ path: 'Music/Track.md' }],
      getAllFolders: () => [{ path: 'Music' }],
    };
    metadataCache = { getFileCache: () => ({ frontmatter: { performer: 'performance', source: 'url' } }) };
  },
  normalizePath: (path: string) => path.trim().replace(/^\/+|\/+$/g, '') || '/',
  FuzzySuggestModal: class {
    modalEl = { addClass() {} };
    inputEl = { value: '' };
    scope = { register: (_: string[], key: string, handler: () => boolean) => { this.keys[key] = handler; } };
    keys: Record<string, () => boolean> = {};
    close() {}
    constructor(readonly app: App) {}
    setPlaceholder() {}
    setInstructions() {}
    getItems(): string[] { return []; }
    getItemText(item: string) { return item; }
    getSuggestions(query: string) {
      return this.getItems().filter((item) => this.getItemText(item).includes(query)).map((item) => ({
        item, match: { score: 0, matches: [] },
      }));
    }
  },
}));

describe('property picker selection', () => {
  it.each([
    { label: 'property', create: (app: App, pick: (value: string) => void) => new PropertySuggestModal(app, 'source', pick), existing: 'performer' },
    { label: 'value', create: (app: App, pick: (value: string) => void) => new ValueSuggestModal(app, 'performer', 'other', pick), existing: 'performance' },
  ])('selects existing $label matches before offering creation', ({ create, existing }) => {
    const chosen: string[] = [];
    const modal = create(new App(), (value) => chosen.push(value));

    const suggestions = modal.getSuggestions('perf');
    const first = suggestions[0];
    if (!first) throw new Error('Missing first suggestion');
    modal.onChooseItem(first.item);

    expect(chosen).toEqual([existing]);
    expect(suggestions.map(({ item }) => item)).toEqual([existing, 'perf']);
  });

  it('selects creation only when no existing property matches', () => {
    const modal = new PropertySuggestModal(new App(), 'source', () => {});

    expect(modal.getSuggestions('new-key').map(({ item }) => item)).toEqual(['new-key']);
    expect(modal.getSuggestions('performer').map(({ item }) => item)).toEqual(['performer']);
    expect(modal.getSuggestions('')[0]?.item).toBe('source');
  });

  it('does not cap the list, so every property stays reachable by scrolling', () => {
    expect(new PropertySuggestModal(new App(), 'source', () => {}).limit).toBe(Infinity);
  });

  it('keeps a saved value that no note uses yet selectable', () => {
    const modal = new PropertySuggestModal(new App(), 'gone', () => {});

    expect(modal.getItems()).toContain('gone');
    expect(modal.getSuggestions('')[0]?.item).toBe('gone');
  });

  it('pins the default right after the current value', () => {
    const modal = new PropertySuggestModal(new App(), 'performer', () => {}, 'fallback');
    expect(modal.getSuggestions('').slice(0, 2).map(({ item }) => item)).toEqual(['performer', 'fallback']);
  });

  it('creates the typed value on shift+enter, even when fuzzy matches rank above it', () => {
    const chosen: string[] = [];
    const modal = new PropertySuggestModal(new App(), 'source', (value) => chosen.push(value)) as PropertySuggestModal & { keys: Record<string, () => boolean> };
    const shiftEnter = (query: string) => { modal.inputEl.value = query; modal.keys.Enter?.(); };

    shiftEnter('perf');
    shiftEnter('performer');
    shiftEnter('');

    expect(chosen).toEqual(['perf']);
  });

  it('offers folders and creates only new valid paths', () => {
    const items = (query: string) => new FolderSuggestModal(new App(), 'Music', () => {}).getSuggestions(query).map(({ item }) => item);

    expect(items('')).toEqual(['Music', '/']);
    expect(new FolderSuggestModal(new App(), 'Music', () => {}, 'Later').getSuggestions('').map(({ item }) => item)).toEqual(['Music', 'Later', '/']);
    expect(items('/New/Sub/')).toEqual(['New/Sub']);
    expect(items('../outside')).toEqual([]);
  });
});
