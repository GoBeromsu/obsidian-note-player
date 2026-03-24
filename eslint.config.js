import { baseConfig } from './eslint.base.js'

export default [
	{ ignores: ['dist/**', 'obsidian-note-player/**'] },
	...baseConfig,
]
