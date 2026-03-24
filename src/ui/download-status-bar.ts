import { setIcon } from 'obsidian';
import type { Plugin } from 'obsidian';

const COMPLETION_VISIBLE_MS = 1500;

export class DownloadStatusBar {
	private readonly iconEl: HTMLElement;
	private readonly msgEl: HTMLSpanElement;
	private isDownloading = false;
	private completionTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(plugin: Plugin, onCancel: () => void) {
		const item = plugin.addStatusBarItem();
		const container = item.createEl('a', { cls: 'onp-status' });
		this.iconEl = container.createDiv({ cls: 'onp-status-icon' });
		this.msgEl = container.createSpan({ cls: 'onp-status-msg', text: ' ONP' });
		setIcon(this.iconEl, 'music');

		plugin.registerDomEvent(container, 'click', () => {
			if (this.isDownloading) onCancel();
		});
	}

	update(percent: number): void {
		if (this.completionTimer !== null) {
			clearTimeout(this.completionTimer);
			this.completionTimer = null;
		}

		if (percent >= 0 && percent < 100) {
			this.isDownloading = true;
			setIcon(this.iconEl, 'loader');
			this.msgEl.setText(` Downloading ${Math.round(percent)}%`);
		} else if (percent === 100) {
			this.isDownloading = false;
			setIcon(this.iconEl, 'check');
			this.msgEl.setText(' Downloaded ✓');
			this.completionTimer = setTimeout(() => this.reset(), COMPLETION_VISIBLE_MS);
		} else {
			// percent === -1 (error) or cancel — Notice toast in main.ts handles messaging
			this.reset();
		}
	}

	destroy(): void {
		if (this.completionTimer !== null) {
			clearTimeout(this.completionTimer);
			this.completionTimer = null;
		}
	}

	private reset(): void {
		this.completionTimer = null;
		this.isDownloading = false;
		setIcon(this.iconEl, 'music');
		this.msgEl.setText(' ONP');
	}
}
