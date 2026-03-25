import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { AudioFormat } from '../src/types/audio';
import type { VaultAdapter } from '../src/types/view';

// Mock fs and child_process before importing the module under test
vi.mock('fs', () => ({
	existsSync: vi.fn(() => false),
	mkdirSync: vi.fn(),
	readdirSync: vi.fn(() => []),
	unlinkSync: vi.fn(),
}));

vi.mock('child_process', () => ({
	spawnSync: vi.fn(),
	spawn: vi.fn(),
}));

import * as cp from 'child_process';
import { AudioCacheService } from '../src/domain/audio-cache';

const BASE_PATH = '/vault';
const CACHE_DIR = '.obsidian/plugins/obsidian-note-player/audio-cache';
const MOCK_YTDLP = '/usr/local/bin/yt-dlp';

function makeAdapter(overrides: Partial<VaultAdapter> = {}): VaultAdapter {
	return {
		exists: vi.fn().mockResolvedValue(false),
		getResourcePath: vi.fn((path: string) => `app://local/${path}`),
		...overrides,
	};
}

function mockSpawnSync(status: number, stdout = '') {
	vi.mocked(cp.spawnSync).mockReturnValue({
		status,
		stdout,
		stderr: '',
		pid: 1,
		output: [],
		signal: null,
	} as ReturnType<typeof cp.spawnSync>);
}

describe('AudioCacheService', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// Default: which yt-dlp succeeds
		mockSpawnSync(0, `${MOCK_YTDLP}\n`);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe('path construction uses configured format extension', () => {
		it('uses mp3 extension by default', async () => {
			const adapter = makeAdapter({ exists: vi.fn().mockResolvedValue(true) });
			const service = new AudioCacheService(BASE_PATH, adapter, 'mp3', '.obsidian', MOCK_YTDLP);
			expect(await service.hasCached('abc123')).toBe(true);
			expect(vi.mocked(adapter.exists)).toHaveBeenCalledWith(`${CACHE_DIR}/abc123.mp3`);
		});

		it('uses wav extension when format is wav', async () => {
			const adapter = makeAdapter({ exists: vi.fn().mockResolvedValue(true) });
			const service = new AudioCacheService(BASE_PATH, adapter, 'wav', '.obsidian', MOCK_YTDLP);
			expect(await service.hasCached('abc123')).toBe(true);
			expect(vi.mocked(adapter.exists)).toHaveBeenCalledWith(`${CACHE_DIR}/abc123.wav`);
		});

		it('uses opus extension when format is opus', async () => {
			const adapter = makeAdapter({ exists: vi.fn().mockResolvedValue(true) });
			const service = new AudioCacheService(BASE_PATH, adapter, 'opus', '.obsidian', MOCK_YTDLP);
			await service.hasCached('abc123');
			expect(vi.mocked(adapter.exists)).toHaveBeenCalledWith(`${CACHE_DIR}/abc123.opus`);
		});

		it('uses aac extension when format is aac', async () => {
			const adapter = makeAdapter({ exists: vi.fn().mockResolvedValue(true) });
			const service = new AudioCacheService(BASE_PATH, adapter, 'aac', '.obsidian', MOCK_YTDLP);
			await service.hasCached('abc123');
			expect(vi.mocked(adapter.exists)).toHaveBeenCalledWith(`${CACHE_DIR}/abc123.aac`);
		});
	});

	describe('getFileUrl uses adapter.getResourcePath', () => {
		const formats: AudioFormat[] = ['mp3', 'wav', 'opus', 'aac'];

		it.each(formats)('getFileUrl returns app:// URL for %s', (format) => {
			const adapter = makeAdapter();
			const service = new AudioCacheService(BASE_PATH, adapter, format, '.obsidian', MOCK_YTDLP);
			const url = service.getFileUrl('abc123');
			expect(vi.mocked(adapter.getResourcePath)).toHaveBeenCalledWith(`${CACHE_DIR}/abc123.${format}`);
			expect(url).toMatch(/^app:\/\//);
		});
	});

	describe('discoverYtdlpPath fallback behavior', () => {
		it('uses discovered path when which yt-dlp succeeds', () => {
			mockSpawnSync(0, `${MOCK_YTDLP}\n`);
			const adapter = makeAdapter();
			expect(() => new AudioCacheService(BASE_PATH, adapter, 'mp3', '.obsidian')).not.toThrow();
			mockSpawnSync(0, '');
			expect(AudioCacheService.isAvailable(MOCK_YTDLP)).toBe(true);
		});

		it('falls back to /opt/homebrew/bin/yt-dlp when which fails', () => {
			vi.mocked(cp.spawnSync).mockReturnValue({
				status: 1,
				stdout: '',
				stderr: '',
				pid: 1,
				output: [],
				signal: null,
			} as ReturnType<typeof cp.spawnSync>);
			const adapter = makeAdapter();
			expect(() => new AudioCacheService(BASE_PATH, adapter, 'mp3', '.obsidian')).not.toThrow();
		});

		it('isAvailable returns true when yt-dlp responds to --version', () => {
			mockSpawnSync(0, '');
			expect(AudioCacheService.isAvailable(MOCK_YTDLP)).toBe(true);
		});

		it('isAvailable returns false when yt-dlp is not found', () => {
			mockSpawnSync(1, '');
			expect(AudioCacheService.isAvailable('/nonexistent/yt-dlp')).toBe(false);
		});
	});
});
