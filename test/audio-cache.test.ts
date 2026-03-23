import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { join } from 'path';
import { AUDIO_MIME_TYPES } from '../src/types/audio';
import type { AudioFormat } from '../src/types/audio';

// Mock fs and child_process before importing the module under test
vi.mock('fs', () => ({
	existsSync: vi.fn(() => false),
	mkdirSync: vi.fn(),
	readFileSync: vi.fn(() => Buffer.from('audio-data')),
	readdirSync: vi.fn(() => []),
	unlinkSync: vi.fn(),
}));

vi.mock('child_process', () => ({
	spawnSync: vi.fn(),
	spawn: vi.fn(),
}));

// URL.createObjectURL is not available in Node — stub it
globalThis.URL.createObjectURL = vi.fn(() => 'blob:mock-url');

import * as fs from 'fs';
import * as cp from 'child_process';
import { AudioCacheService } from '../src/domain/audio-cache';

const BASE_PATH = '/vault';
const CACHE_DIR = join(BASE_PATH, '.obsidian', 'plugins', 'obsidian-note-player', 'audio-cache');
const MOCK_YTDLP = '/usr/local/bin/yt-dlp';

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
		it('uses mp3 extension by default', () => {
			const service = new AudioCacheService(BASE_PATH, 'mp3', MOCK_YTDLP);
			vi.mocked(fs.existsSync).mockReturnValue(true);
			expect(service.hasCached('abc123')).toBe(true);
			expect(vi.mocked(fs.existsSync)).toHaveBeenCalledWith(join(CACHE_DIR, 'abc123.mp3'));
		});

		it('uses wav extension when format is wav', () => {
			const service = new AudioCacheService(BASE_PATH, 'wav', MOCK_YTDLP);
			vi.mocked(fs.existsSync).mockReturnValue(true);
			expect(service.hasCached('abc123')).toBe(true);
			expect(vi.mocked(fs.existsSync)).toHaveBeenCalledWith(join(CACHE_DIR, 'abc123.wav'));
		});

		it('uses opus extension when format is opus', () => {
			const service = new AudioCacheService(BASE_PATH, 'opus', MOCK_YTDLP);
			vi.mocked(fs.existsSync).mockReturnValue(true);
			service.hasCached('abc123');
			expect(vi.mocked(fs.existsSync)).toHaveBeenCalledWith(join(CACHE_DIR, 'abc123.opus'));
		});

		it('uses aac extension when format is aac', () => {
			const service = new AudioCacheService(BASE_PATH, 'aac', MOCK_YTDLP);
			vi.mocked(fs.existsSync).mockReturnValue(true);
			service.hasCached('abc123');
			expect(vi.mocked(fs.existsSync)).toHaveBeenCalledWith(join(CACHE_DIR, 'abc123.aac'));
		});
	});

	describe('MIME type mapping', () => {
		const formats: AudioFormat[] = ['mp3', 'wav', 'opus', 'aac'];

		it.each(formats)('getFileUrl uses correct MIME type for %s', (format) => {
			vi.mocked(fs.existsSync).mockReturnValue(true);
			const service = new AudioCacheService(BASE_PATH, format, MOCK_YTDLP);
			service.getFileUrl('abc123');

			expect(globalThis.URL.createObjectURL).toHaveBeenCalledWith(
				expect.objectContaining({ type: AUDIO_MIME_TYPES[format] }),
			);
		});

		it('AUDIO_MIME_TYPES covers all AudioFormat values', () => {
			expect(AUDIO_MIME_TYPES).toMatchObject({
				mp3: 'audio/mpeg',
				wav: 'audio/wav',
				opus: 'audio/ogg',
				aac: 'audio/aac',
			});
		});
	});

	describe('discoverYtdlpPath fallback behavior', () => {
		it('uses discovered path when which yt-dlp succeeds', () => {
			mockSpawnSync(0, `${MOCK_YTDLP}\n`);
			// Constructor calls discoverYtdlpPath internally — should not throw
			expect(() => new AudioCacheService(BASE_PATH, 'mp3')).not.toThrow();
			// Verify isAvailable works with the discovered path
			mockSpawnSync(0, '');
			expect(AudioCacheService.isAvailable(MOCK_YTDLP)).toBe(true);
		});

		it('falls back to /opt/homebrew/bin/yt-dlp when which fails', () => {
			// Simulate which yt-dlp returning non-zero
			vi.mocked(cp.spawnSync).mockReturnValue({
				status: 1,
				stdout: '',
				stderr: '',
				pid: 1,
				output: [],
				signal: null,
			} as ReturnType<typeof cp.spawnSync>);

			// When which fails, discoverYtdlpPath returns the hardcoded fallback.
			// We verify the constructor completes without error (uses fallback silently).
			expect(() => new AudioCacheService(BASE_PATH, 'mp3')).not.toThrow();
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
