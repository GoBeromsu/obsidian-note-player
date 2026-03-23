import { spawn, spawnSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import type { AudioCachePort } from '../types/view';
import type { AudioFormat } from '../types/audio';
import { AUDIO_MIME_TYPES } from '../types/audio';

export class AudioCacheService implements AudioCachePort {
	private cacheDir: string;
	private format: AudioFormat;
	private ytdlpPath: string;

	constructor(basePath: string, format: AudioFormat = 'mp3', ytdlpPath?: string) {
		this.format = format;
		this.ytdlpPath = ytdlpPath ?? AudioCacheService.discoverYtdlpPath();
		this.cacheDir = join(basePath, '.obsidian', 'plugins', 'obsidian-note-player', 'audio-cache');
		if (!existsSync(this.cacheDir)) {
			mkdirSync(this.cacheDir, { recursive: true });
		}
	}

	private static discoverYtdlpPath(): string {
		const result = spawnSync('which', ['yt-dlp'], { encoding: 'utf-8' });
		if (result.status === 0 && result.stdout.trim()) {
			return result.stdout.trim();
		}
		return '/opt/homebrew/bin/yt-dlp'; // fallback for macOS
	}

	hasCached(videoId: string): boolean {
		return existsSync(this.getFilePath(videoId));
	}

	getFileUrl(videoId: string): string {
		const buffer = readFileSync(this.getFilePath(videoId));
		const blob = new Blob([buffer], { type: AUDIO_MIME_TYPES[this.format] });
		return URL.createObjectURL(blob);
	}

	private getFilePath(videoId: string): string {
		return join(this.cacheDir, `${videoId}.${this.format}`);
	}

	async download(videoId: string, onProgress: (percent: number) => void): Promise<string> {
		const output = this.getFilePath(videoId);
		if (existsSync(output)) return output;

		this.cleanIntermediate(videoId);

		return new Promise((resolve, reject) => {
			let stderrOutput = '';
			const proc = spawn(this.ytdlpPath, [
				'-x', '--audio-format', this.format, '--audio-quality', '0',
				'--no-playlist',
				'-o', join(this.cacheDir, `${videoId}.%(ext)s`),
				`https://www.youtube.com/watch?v=${videoId}`,
			]);

			proc.stderr.on('data', (data: Buffer) => {
				const line = data.toString();
				stderrOutput += line;
				const match = line.match(/\[download\]\s+([\d.]+)%/);
				if (match) {
					onProgress(parseFloat(match[1]));
				}
			});

			proc.stdout.on('data', (data: Buffer) => {
				stderrOutput += data.toString();
			});

			proc.on('close', (code) => {
				if (code === 0 && existsSync(output)) {
					this.cleanIntermediate(videoId);
					resolve(output);
				} else {
					reject(new Error(`yt-dlp exited with code ${code}: ${stderrOutput.slice(-200)}`));
				}
			});

			proc.on('error', (err) => reject(err));
		});
	}

	private cleanIntermediate(videoId: string): void {
		const targetExt = `.${this.format}`;
		for (const file of readdirSync(this.cacheDir)) {
			if (file.startsWith(videoId) && !file.endsWith(targetExt)) {
				unlinkSync(join(this.cacheDir, file));
			}
		}
	}

	static isAvailable(ytdlpPath?: string): boolean {
		const path = ytdlpPath ?? AudioCacheService.discoverYtdlpPath();
		const result = spawnSync(path, ['--version'], { stdio: 'ignore' });
		return result.status === 0;
	}
}
