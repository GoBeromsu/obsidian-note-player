import { isMap, isNode, isScalar, isSeq, parseDocument } from 'yaml';

/** Edit scalar ranges rather than reserializing user filters, comments, and other views. */
export function upgradePlaylistCards(content: string, imageProperty: string): string {
	const document = parseDocument(content);
	const [error] = document.errors;
	if (error) throw error;
	if (!isMap(document.contents)) return content;
	const views: unknown = document.contents.get('views', true);
	if (!isSeq(views)) return content;
	const edits: { start: number; end: number; text: string }[] = [];
	const image = JSON.stringify(`note.${imageProperty}`);
	const newline = content.includes('\r\n') ? '\r\n' : '\n';
	for (const view of views.items) {
		if (!isMap(view)) continue;
		const type: unknown = view.get('type', true);
		if (!isScalar(type) || type.value !== 'note-player' || !type.range) continue;
		const existingImage: unknown = view.get('image', true);
		let replacement = 'cards';
		if (isNode(existingImage) && existingImage.range) {
			edits.push({ start: existingImage.range[0], end: existingImage.range[1], text: image });
		} else if (view.flow) {
			replacement += `, image: ${image}`;
		} else {
			const key = view.items.find((pair) => isScalar(pair.key) && pair.key.value === 'type')?.key;
			if (!isScalar(key) || !key.range) continue;
			const column = key.range[0] - content.lastIndexOf('\n', key.range[0]) - 1;
			const offset = type.range[2];
			const separator = content[offset - 1] === '\n' ? '' : newline;
			edits.push({ start: offset, end: offset, text: `${separator}${' '.repeat(column)}image: ${image}${newline}` });
		}
		edits.push({ start: type.range[0], end: type.range[1], text: replacement });
	}
	for (const edit of edits.sort((a, b) => b.start - a.start)) {
		content = content.slice(0, edit.start) + edit.text + content.slice(edit.end);
	}
	return content;
}
