export function collectScopedFiles<File extends { readonly path: string }>(
	files: readonly File[],
	folders: readonly string[],
	linked: (file: File) => readonly File[],
): File[] {
	const scoped = new Set(files.filter((file) => folders.some((folder) =>
		folder === '/' || folder === '' || file.path.startsWith(`${folder}/`))));
	for (const file of [...scoped]) for (const target of linked(file)) scoped.add(target);
	return [...scoped];
}
