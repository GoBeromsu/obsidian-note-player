import { App, FuzzySuggestModal, type FuzzyMatch, normalizePath, renderResults, setIcon, setTooltip } from 'obsidian';
import {
	buildFolderOptions,
	collectPropertyKeys,
	collectPropertyValues,
	countNotesByFolder,
	createItemFor,
	isCreatableFolderPath,
	type PropertyOption,
} from '../../domain/settings-options';
import { plural } from '../../utils/plural';

interface PickerCopy {
	placeholder: string;
	empty: string;
	create: (value: string) => string;
	unused?: string;
}

const INSTRUCTIONS = [
	{ command: '↑↓', purpose: 'to navigate' },
	{ command: '↵', purpose: 'to choose' },
	{ command: 'shift ↵', purpose: 'to use typed text' },
	{ command: 'esc', purpose: 'to dismiss' },
];

function frontmatters(app: App): (Record<string, unknown> | undefined)[] {
	return app.vault.getMarkdownFiles().map((file) => app.metadataCache.getFileCache(file)?.frontmatter);
}

abstract class KeySuggestModal extends FuzzySuggestModal<string> {
	// Dropped on close so a reopened picker reflects properties added since.
	private options: Map<string, PropertyOption> | null = null;

	constructor(
		app: App,
		private readonly copy: PickerCopy,
		protected readonly current: string,
		private readonly onPick: (value: string) => void,
		protected readonly fallback?: string,
	) {
		super(app);
		this.setPlaceholder(copy.placeholder);
		this.emptyStateText = copy.empty;
		this.setInstructions(INSTRUCTIONS);
		// The default cap of 100 leaves later options unreachable, however far the list is scrolled.
		this.limit = Infinity;
		this.modalEl.addClass('onp-picker-modal');
		// Same chord as the quick switcher: the create row can sit below hundreds of fuzzy matches.
		this.scope.register(['Shift'], 'Enter', () => {
			const created = this.creatable(this.inputEl.value);
			if (created !== null) {
				this.close();
				this.onPick(created);
			}
			return false;
		});
	}

	protected abstract collect(): PropertyOption[];

	private getOptions(): Map<string, PropertyOption> {
		if (!this.options) {
			this.options = new Map(this.collect().map((option) => [option.value, option]));
			for (const value of [this.fallback, this.current]) {
				if (value !== undefined && !this.options.has(value)) this.options.set(value, { value, count: 0 });
			}
		}
		return this.options;
	}

	getItems(): string[] {
		return [...this.getOptions().keys()];
	}

	getItemText(item: string): string {
		return this.getOptions().get(item)?.label ?? item;
	}

	protected creatable(query: string): string | null {
		return createItemFor(query, this.getItems());
	}

	// Blank query: the current value first and selected, like a dropdown opening on its value, then the default.
	getSuggestions(query: string): FuzzyMatch<string>[] {
		const matches = super.getSuggestions(query);
		const plain = { score: 0, matches: [] };
		if (query.trim() === '') {
			const pinned = [...new Set([this.current, this.fallback ?? this.current])];
			return [...pinned.map((item) => ({ item, match: plain })), ...matches.filter((match) => !pinned.includes(match.item))];
		}
		const created = this.creatable(query);
		return created === null ? matches : [...matches, { item: created, match: plain }];
	}

	renderSuggestion(match: FuzzyMatch<string>, el: HTMLElement): void {
		const option = this.getOptions().get(match.item);
		const isCurrent = match.item === this.current;
		el.addClass('onp-picker-item');
		el.toggleClass('is-create', !option);
		el.toggleClass('is-current', isCurrent);
		const icon = el.createSpan({ cls: 'onp-picker-icon' });
		if (!option) setIcon(icon, 'plus');
		else if (isCurrent) setIcon(icon, 'check');
		const label = el.createSpan({ cls: 'onp-picker-label' });
		if (!option) {
			label.setText(this.copy.create(match.item));
			return;
		}
		const text = option.label ?? match.item;
		renderResults(label, text, match.match);
		setTooltip(label, text, { placement: 'top' });
		if (match.item === this.fallback) el.createSpan({ cls: 'onp-picker-default', text: 'Default' });
		if (option.sample) el.createSpan({ cls: 'onp-picker-sample', text: `e.g. ${option.sample}` });
		const meta = option.hint ?? (option.count > 0 ? plural(option.count, 'note') : this.copy.unused);
		if (meta) el.createSpan({ cls: 'onp-picker-count', text: meta });
	}

	onChooseItem(item: string): void {
		this.onPick(item);
	}

	onClose(): void {
		this.options = null;
		super.onClose();
	}
}

export class PropertySuggestModal extends KeySuggestModal {
	constructor(app: App, current: string, onPick: (value: string) => void, fallback?: string) {
		super(app, {
			placeholder: 'Search properties, or type a new one…',
			empty: 'No properties in this vault yet. Type a name to create one.',
			create: (value) => `Create property "${value}"`,
			unused: 'Not used yet',
		}, current, onPick, fallback);
	}

	protected collect(): PropertyOption[] {
		return collectPropertyKeys(frontmatters(this.app));
	}
}

export class ValueSuggestModal extends KeySuggestModal {
	constructor(app: App, private readonly key: string, current: string, onPick: (value: string) => void, fallback?: string) {
		super(app, {
			placeholder: `Search ${key} values, or type a new one…`,
			empty: `No ${key} values in this vault yet. Type one to use it.`,
			create: (value) => `Use "${value}"`,
			unused: 'Not used yet',
		}, current, onPick, fallback);
	}

	protected collect(): PropertyOption[] {
		return collectPropertyValues(frontmatters(this.app), this.key);
	}
}

export class FolderSuggestModal extends KeySuggestModal {
	constructor(app: App, current: string, onPick: (value: string) => void, fallback?: string) {
		super(app, {
			placeholder: 'Search folders, or type a new one…',
			empty: 'Folder names can\'t start with a dot or use symbols like : or #.',
			create: (value) => `Create folder "${value}"`,
		}, current, onPick, fallback);
		this.modalEl.addClass('onp-folder-picker');
	}

	protected collect(): PropertyOption[] {
		const counts = countNotesByFolder(this.app.vault.getMarkdownFiles().map((file) => file.path));
		const folders = this.app.vault.getAllFolders(false).map((folder) => folder.path);
		return buildFolderOptions(folders, counts, [this.current, this.fallback ?? this.current]);
	}

	protected creatable(query: string): string | null {
		const path = normalizePath(query.trim());
		return isCreatableFolderPath(path) ? createItemFor(path, this.getItems()) : null;
	}
}
