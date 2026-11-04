import { setIcon } from 'obsidian';
import type { PlaylistViewHost } from '../../types/view';

export type RunAction = (
	successMessage: string,
	action: () => Promise<void>,
	showSuccess?: boolean,
) => Promise<void>;

export function buildClass(base: string, flags: Record<string, boolean>): string {
	return [base, ...Object.entries(flags).filter(([, enabled]) => enabled).map(([name]) => name)].join(' ');
}

/** Empty for unavailable tracks; otherwise the cached file, or the remote URL while it downloads. */
export function thumbnailSrc(host: PlaylistViewHost, videoId: string, remoteUrl: string): string {
	if (!remoteUrl) return '';
	return host.getThumbnailCache?.()?.resolve(videoId) ?? remoteUrl;
}

export function renderEmptyState(container: HTMLElement, title: string, copy: string): void {
	const state = container.createDiv({ cls: 'onp-empty-state' });
	setIcon(state.createDiv({ cls: 'onp-empty-icon' }), 'music-4');
	state.createDiv({ cls: 'onp-empty-title', text: title });
	state.createDiv({ cls: 'onp-empty-copy', text: copy });
}

export function createActionButton(
	label: string,
	icon: string,
	onClick: () => void,
	options: { active?: boolean; cta?: boolean; iconOnly?: boolean } = {},
): HTMLButtonElement {
	const button = createEl('button');
	button.type = 'button';
	button.className = buildClass('onp-button', {
		'is-active': Boolean(options.active),
		'is-icon-only': Boolean(options.iconOnly),
		'mod-cta': Boolean(options.cta),
	});
	button.setAttribute('aria-label', label);
	button.setAttribute('title', label);
	setIcon(button.createSpan({ cls: 'onp-button-icon' }), icon);
	if (!options.iconOnly) {
		button.createSpan({ cls: 'onp-button-label', text: label });
	}
	button.addEventListener('click', (event) => {
		event.preventDefault();
		event.stopPropagation();
		onClick();
	});
	return button;
}

export function createIconButton(
	label: string,
	icon: string,
	onClick: (event: MouseEvent) => void,
): HTMLButtonElement {
	const button = createEl('button');
	button.type = 'button';
	button.className = 'clickable-icon onp-icon-button';
	button.setAttribute('aria-label', label);
	button.setAttribute('title', label);
	setIcon(button, icon);
	button.addEventListener('click', (event) => {
		event.preventDefault();
		event.stopPropagation();
		onClick(event);
	});
	return button;
}
