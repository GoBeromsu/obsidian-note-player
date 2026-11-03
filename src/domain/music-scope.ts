export interface ScopeRoot<Folder> {
	folder: Folder;
	isVaultRoot: boolean;
}

export interface ScopeTree<Folder, File> {
	children(folder: Folder): { folders: Folder[]; files: File[] };
	/** Notes a collected note links to, e.g. the tracks of a playlist. */
	linked(file: File): File[];
}

export function collectScopedFiles<Folder, File>(roots: ScopeRoot<Folder>[], tree: ScopeTree<Folder, File>): File[] {
	const files = new Set<File>();
	const visit = (folder: Folder): void => {
		const { folders, files: own } = tree.children(folder);
		for (const file of own) files.add(file);
		for (const child of folders) visit(child);
	};
	for (const { folder } of roots) visit(folder);
	for (const file of [...files]) for (const target of tree.linked(file)) files.add(target);
	return [...files];
}
