import type {
	Setting, SettingDefinitionControl, SettingDefinitionItem, SettingDefinitionRender, SettingGroup, SettingGroupItem,
} from 'obsidian';

type Row = SettingDefinitionItem | SettingGroupItem;

export function flattenDefinitions(items: SettingDefinitionItem[]): Row[] {
	return items.flatMap((item): Row[] => ('items' in item ? item.items ?? [] : [item]));
}

export const isControlRow = (row: Row): row is SettingDefinitionControl => 'control' in row && row.control !== undefined;
export const isRenderRow = (row: Row): row is SettingDefinitionRender => 'render' in row && typeof row.render === 'function';

/** Capture native control callbacks without a DOM; visual rendering still requires real-app QA. */
export function renderRow(rows: Row[], name: string) {
	const row = rows.filter(isRenderRow).find((candidate) => candidate.name === name);
	if (!row) throw new Error(`no render row named ${name}`);
	const added: [string, string][] = [];
	let value = '';
	let change: ((next: string) => unknown) | null = null;
	let click: (() => unknown) | null = null;
	let buttonText = '';
	const dropdown = {
		addOption: (optionValue: string, label: string) => { added.push([optionValue, label]); return dropdown; },
		setValue: (next: string) => { value = next; return dropdown; },
		onChange: (cb: (next: string) => unknown) => { change = cb; return dropdown; },
	};
	const button = {
		setButtonText: (text: string) => { buttonText = text; return button; },
		onClick: (cb: () => unknown) => { click = cb; return button; },
	};
	const setting = {
		addDropdown: (cb: (component: typeof dropdown) => unknown) => { cb(dropdown); return setting; },
		addButton: (cb: (component: typeof button) => unknown) => { cb(button); return setting; },
	};
	row.render(setting as unknown as Setting, {} as SettingGroup);
	return { added, value, buttonText, change: (next: string) => change?.(next), click: () => click?.() };
}
