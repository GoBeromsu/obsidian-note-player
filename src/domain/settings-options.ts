import { UNSAFE_NAME_CHARS } from '../utils/dedupe';
import { asStringArray } from '../utils/frontmatter';
import { VAULT_ROOT } from './config';

const PENDING_FOLDER_HINT = 'Will be created';

type FrontmatterLike = Record<string, unknown> | undefined;

export interface PropertyOption {
	value: string;
	count: number;
	label?: string;
	sample?: string;
	hint?: string;
}

const byLocale = (a: string, b: string): number => a.localeCompare(b);

export function folderLabel(path: string): string {
	return path === VAULT_ROOT ? 'Vault root' : path;
}

// `keep` (the saved value and the default) stays selectable even if the folder doesn't exist yet.
export function buildFolderOptions(folderPaths: readonly string[], counts: ReadonlyMap<string, number>, keep: readonly string[]): PropertyOption[] {
	const isFolder = (path: string) => path !== '' && path !== VAULT_ROOT;
	const existing = new Set(folderPaths.filter(isFolder));
	const pending = new Set(keep.filter((path) => isFolder(path) && !existing.has(path)));
	return [VAULT_ROOT, ...[...existing, ...pending].sort(byLocale)].map((value) => ({
		value,
		label: folderLabel(value),
		count: counts.get(value) ?? 0,
		...(pending.has(value) ? { hint: PENDING_FOLDER_HINT } : {}),
	}));
}

// Dot segments are hidden from the vault index (or escape the vault).
export function isCreatableFolderPath(path: string): boolean {
	return !path.split('/').some((segment) => segment.startsWith('.') || UNSAFE_NAME_CHARS.test(segment));
}

// Counts include subfolders, matching how the folder settings scope the library.
export function countNotesByFolder(filePaths: readonly string[]): Map<string, number> {
	const counts = new Map<string, number>([[VAULT_ROOT, filePaths.length]]);
	for (const path of filePaths) {
		for (let end = path.indexOf('/'); end !== -1; end = path.indexOf('/', end + 1)) {
			const folder = path.slice(0, end);
			counts.set(folder, (counts.get(folder) ?? 0) + 1);
		}
	}
	return counts;
}

function sampleOf(value: unknown): string | undefined {
	const text = asStringArray(value)[0];
	if (text) return text;
	const first: unknown = Array.isArray(value) ? value[0] : value;
	return typeof first === 'number' || typeof first === 'boolean' ? String(first) : undefined;
}

function bump(options: Map<string, PropertyOption>, value: string): PropertyOption {
	const option = options.get(value) ?? { value, count: 0 };
	option.count += 1;
	options.set(value, option);
	return option;
}

function byUsage(a: PropertyOption, b: PropertyOption): number {
	return b.count - a.count || byLocale(a.value, b.value);
}

// Most-used first: real candidates lead, one-off keys and typos sink.
export function collectPropertyKeys(frontmatters: Iterable<FrontmatterLike>): PropertyOption[] {
	const options = new Map<string, PropertyOption>();
	for (const frontmatter of frontmatters) {
		for (const [key, value] of Object.entries(frontmatter ?? {})) {
			if (key === 'position') continue;
			bump(options, key).sample ??= sampleOf(value);
		}
	}
	return [...options.values()].sort(byUsage);
}

export function collectPropertyValues(frontmatters: Iterable<FrontmatterLike>, key: string): PropertyOption[] {
	const options = new Map<string, PropertyOption>();
	for (const frontmatter of frontmatters) {
		for (const value of new Set(asStringArray(frontmatter?.[key]))) bump(options, value);
	}
	return [...options.values()].sort(byUsage);
}

export function createItemFor(query: string, items: readonly string[]): string | null {
	const trimmed = query.trim();
	return trimmed !== '' && !items.includes(trimmed) ? trimmed : null;
}
