import { asStringArray } from '../utils/frontmatter';
import { VAULT_ROOT } from './config';

export const VAULT_ROOT_LABEL = 'Vault root';
export const LEGACY_FOLDER_LABEL = 'Default location (legacy)';
const PENDING_FOLDER_SUFFIX = ' · will be created';

type FrontmatterLike = Record<string, unknown> | undefined;

const byLocale = (a: string, b: string): number => a.localeCompare(b);

// The saved value is always selectable so the control never shows blank: a not-yet-created folder is
// labelled as such, and the legacy '' (pre-migration "default location") appears only while it is saved.
export function buildFolderOptions(folderPaths: readonly string[], current: string): Record<string, string> {
	const existing = new Set(folderPaths.filter((path) => path !== '' && path !== VAULT_ROOT));
	const pending = current !== '' && current !== VAULT_ROOT && !existing.has(current) ? current : null;
	const paths = [...existing, ...(pending === null ? [] : [pending])].sort(byLocale);
	const options: Record<string, string> = { [VAULT_ROOT]: VAULT_ROOT_LABEL };
	if (current === '') options[''] = LEGACY_FOLDER_LABEL;
	for (const path of paths) options[path] = path === pending ? `${path}${PENDING_FOLDER_SUFFIX}` : path;
	return options;
}

export function collectPropertyKeys(frontmatters: Iterable<FrontmatterLike>): string[] {
	const keys = new Set<string>();
	for (const frontmatter of frontmatters) {
		for (const key of Object.keys(frontmatter ?? {})) if (key !== 'position') keys.add(key);
	}
	return [...keys].sort(byLocale);
}

export function collectPropertyValues(frontmatters: Iterable<FrontmatterLike>, key: string): string[] {
	const values = new Set<string>();
	for (const frontmatter of frontmatters) {
		for (const value of asStringArray(frontmatter?.[key])) values.add(value);
	}
	return [...values].sort(byLocale);
}

export function createItemFor(query: string, items: readonly string[]): string | null {
	const trimmed = query.trim();
	return trimmed !== '' && !items.includes(trimmed) ? trimmed : null;
}
