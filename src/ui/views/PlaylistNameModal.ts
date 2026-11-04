import { App, Modal, Notice, Setting, TextComponent } from 'obsidian';

export class PlaylistNameModal extends Modal {
	private input: TextComponent | null = null;

	constructor(
		app: App,
		private readonly onSubmit: (value: string) => void,
	) {
		super(app);
	}

	onOpen(): void {
		this.modalEl.addClass('onp-modal');
		const { contentEl } = this;
		contentEl.empty();
		this.setTitle('Create playlist');

		new Setting(contentEl)
			.setName('Playlist name')
			.setDesc('Saved as a note in your playlist folder.')
			.addText((text) => {
				this.input = text;
				text.setPlaceholder('Late-night queue');
				text.inputEl.addEventListener('keydown', (event) => {
					if (event.key !== 'Enter' || event.isComposing) return;
					event.preventDefault();
					this.submit();
				});
				window.setTimeout(() => text.inputEl.focus(), 0);
			});

		new Setting(contentEl)
			.addButton((button) =>
				button
					.setButtonText('Create')
					.setCta()
					.onClick(() => this.submit()),
			)
			.addButton((button) =>
				button
					.setButtonText('Cancel')
					.onClick(() => this.close()),
			);
	}

	private submit(): void {
		const value = this.input?.getValue().trim() ?? '';
		if (!value) {
			new Notice('Enter a playlist name.');
			return;
		}
		this.close();
		this.onSubmit(value);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
