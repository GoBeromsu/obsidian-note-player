import { describe, expect, it, vi } from 'vitest';
import { App } from 'obsidian';
import { PropertySuggestModal, ValueSuggestModal } from '../src/ui/views/PropertySuggestModal';

vi.mock('obsidian', () => ({
  App: class {
    vault = { getMarkdownFiles: () => [{ path: 'Track.md' }] };
    metadataCache = { getFileCache: () => ({ frontmatter: { performer: 'performance', source: 'url' } }) };
  },
  FuzzySuggestModal: class {
    modalEl = { addClass() {} };
    constructor(readonly app: App) {}
    setPlaceholder() {}
    setInstructions() {}
    getItems(): string[] { return []; }
    getSuggestions(query: string) {
      return this.getItems().filter((item) => item.includes(query)).map((item) => ({
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
});
