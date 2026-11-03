import { App, FuzzySuggestModal, type FuzzyMatch, renderResults, setIcon } from 'obsidian';
import { collectPropertyKeys, collectPropertyValues, createItemFor } from '../../domain/settings-options';

interface PickerCopy {
	placeholder: string;
	empty: string;
	create: (value: string) => string;
}

const INSTRUCTIONS = [
	{ command: '↑↓', purpose: 'to navigate' },
	{ command: '↵', purpose: 'to choose' },
	{ command: 'esc', purpose: 'to dismiss' },
];

function frontmatters(app: App): (Record<string, unknown> | undefined)[] {
	return app.vault.getMarkdownFiles().map((file) => app.metadataCache.getFileCache(file)?.frontmatter);
}

abstract class KeySuggestModal extends FuzzySuggestModal<string> {
	// Dropped on close so a reopened picker reflects properties added since.
	private items: string[] | null = null;

	constructor(
		app: App,
		private readonly copy: PickerCopy,
		private readonly current: string,
		private readonly onPick: (value: string) => void,
	) {
		super(app);
		this.setPlaceholder(copy.placeholder);
		this.emptyStateText = copy.empty;
		this.setInstructions(INSTRUCTIONS);
		this.modalEl.addClass('onp-picker-modal');
	}

	protected abstract collect(): string[];

	getItems(): string[] {
		this.items ??= this.withCurrent(this.collect());
		return this.items;
	}

	private withCurrent(items: string[]): string[] {
		return items.includes(this.current) ? items : [...items, this.current].sort((a, b) => a.localeCompare(b));
	}

	getItemText(item: string): string {
		return item;
	}

	// Blank query: every option with the current one first and selected, like a dropdown opening on its value.
	getSuggestions(query: string): FuzzyMatch<string>[] {
		const matches = super.getSuggestions(query);
		const plain = { score: 0, matches: [] };
		if (query.trim() === '') {
			return [{ item: this.current, match: plain }, ...matches.filter((match) => match.item !== this.current)];
		}
		const created = createItemFor(query, this.getItems());
		return created === null ? matches : [...matches, { item: created, match: plain }];
	}

	renderSuggestion(match: FuzzyMatch<string>, el: HTMLElement): void {
		const isNew = !this.getItems().includes(match.item);
		const isCurrent = match.item === this.current;
		el.addClass('onp-picker-item');
		el.toggleClass('is-create', isNew);
		el.toggleClass('is-current', isCurrent);
		const icon = el.createSpan({ cls: 'onp-picker-icon' });
		if (isNew) setIcon(icon, 'plus');
		else if (isCurrent) setIcon(icon, 'check');
		const label = el.createSpan({ cls: 'onp-picker-label' });
		if (isNew) label.setText(this.copy.create(match.item));
		else renderResults(label, match.item, match.match);
	}

	onChooseItem(item: string): void {
		this.onPick(item);
	}

	onClose(): void {
		this.items = null;
		super.onClose();
	}
}

export class PropertySuggestModal extends KeySuggestModal {
	constructor(app: App, current: string, onPick: (value: string) => void) {
		super(app, {
			placeholder: 'Search properties…',
			empty: 'No properties in this vault yet. Type a name to create one.',
			create: (value) => `Create property "${value}"`,
		}, current, onPick);
	}

	protected collect(): string[] {
		return collectPropertyKeys(frontmatters(this.app));
	}
}

export class ValueSuggestModal extends KeySuggestModal {
	constructor(app: App, private readonly key: string, current: string, onPick: (value: string) => void) {
		super(app, {
			placeholder: `Search ${key} values…`,
			empty: `No ${key} values in this vault yet. Type one to use it.`,
			create: (value) => `Use "${value}"`,
		}, current, onPick);
	}

	protected collect(): string[] {
		return collectPropertyValues(frontmatters(this.app), this.key);
	}
}
