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
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h3', { text: 'Create playlist' });
		contentEl.createEl('p', {
			text: 'This creates a note-backed playlist note in your configured playlist folder.',
		});

		new Setting(contentEl)
			.setName('Playlist name')
			.addText((text) => {
				this.input = text;
				text.setPlaceholder('Late-night queue');
				window.setTimeout(() => text.inputEl.focus(), 0);
			});

		new Setting(contentEl)
			.addButton((button) =>
				button
					.setButtonText('Create')
					.setCta()
					.onClick(() => {
						const value = this.input?.getValue().trim() ?? '';
						if (!value) {
							new Notice('Playlist name is required.');
							return;
						}
						this.close();
						this.onSubmit(value);
					}),
			)
			.addButton((button) =>
				button
					.setButtonText('Cancel')
					.onClick(() => this.close()),
			);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
