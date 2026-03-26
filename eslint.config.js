import globals from 'globals'
import { baseConfig } from './eslint.base.js'

export default [
	{ ignores: ['dist/**', 'obsidian-note-player/**'] },
	...baseConfig,
	// audio-cache.ts spawns child processes and uses Node.js Buffer/process globals.
	{
		files: ['src/domain/audio-cache.ts'],
		languageOptions: {
			globals: { ...globals.node },
		},
	},
]
