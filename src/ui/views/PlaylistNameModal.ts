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

		this.scope.register([], 'Enter', (event) => {
			if (event.isComposing) return true;
			if (
				!this.input ||
				(event.target !== this.input.inputEl &&
					this.input.inputEl.ownerDocument.activeElement !== this.input.inputEl)
			) {
				return true;
			}
			this.submit();
			return false;
		});
		this.input?.inputEl.focus();
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
