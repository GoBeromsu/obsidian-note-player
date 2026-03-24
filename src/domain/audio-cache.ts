import { spawn, spawnSync, type ChildProcess } from 'child_process';
import { existsSync, mkdirSync, readdirSync, unlinkSync } from 'fs';
import { dirname, join } from 'path';
import type { AudioCachePort, VaultAdapter } from '../types/view';
import type { AudioFormat } from '../types/audio';

export class AudioCacheService implements AudioCachePort {
	private cacheDir: string;        // vault-relative
	private format: AudioFormat;
	private ytdlpPath: string;
	private activeDownloads = new Map<string, ChildProcess>();
	private downloadPromises = new Map<string, Promise<string>>();
	private adapter: VaultAdapter;
	private absBase: string;

	constructor(vaultBasePath: string, adapter: VaultAdapter, format: AudioFormat = 'mp3', ytdlpPath?: string) {
		this.adapter = adapter;
		this.format = format;
		this.ytdlpPath = ytdlpPath ?? AudioCacheService.discoverYtdlpPath();
		this.absBase = vaultBasePath;
		this.cacheDir = '.obsidian/plugins/obsidian-note-player/audio-cache';
		const absPath = join(vaultBasePath, this.cacheDir);
		if (!existsSync(absPath)) mkdirSync(absPath, { recursive: true });
	}

	private static discoverYtdlpPath(): string {
		const result = spawnSync('which', ['yt-dlp'], { encoding: 'utf-8' });
		if (result.status === 0 && result.stdout.trim()) {
			return result.stdout.trim();
		}
		return '/opt/homebrew/bin/yt-dlp'; // fallback for macOS
	}

	async hasCached(videoId: string): Promise<boolean> {
		return this.adapter.exists(this.vaultRelativePath(videoId));
	}

	getFileUrl(videoId: string): string {
		return this.adapter.getResourcePath(this.vaultRelativePath(videoId));
	}

	private vaultRelativePath(videoId: string): string {
		return `${this.cacheDir}/${videoId}.${this.format}`;
	}

	private absolutePath(videoId: string): string {
		return join(this.absBase, this.vaultRelativePath(videoId));
	}

	async download(videoId: string, onProgress: (percent: number) => void): Promise<string> {
		const output = this.absolutePath(videoId);
		if (existsSync(output)) return output;

		if (this.downloadPromises.has(videoId)) {
			return this.downloadPromises.get(videoId)!;
		}

		this.cleanIntermediate(videoId);

		const p = new Promise<string>((resolve, reject) => {
			let stderrOutput = '';
			const proc = spawn(this.ytdlpPath, [
				'-x', '--audio-format', this.format, '--audio-quality', '0',
				'--no-playlist',
				'-o', join(this.absBase, this.cacheDir, `${videoId}.%(ext)s`),
				`https://www.youtube.com/watch?v=${videoId}`,
			], { env: this.spawnEnv() });

			this.activeDownloads.set(videoId, proc);

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
				this.activeDownloads.delete(videoId);
				if (code === 0 && existsSync(output)) {
					this.cleanIntermediate(videoId);
					resolve(output);
				} else {
					reject(new Error(this.parseYtdlpError(stderrOutput)));
				}
			});

			proc.on('error', (err) => {
				this.activeDownloads.delete(videoId);
				reject(err);
			});
		}).finally(() => {
			this.downloadPromises.delete(videoId);
		});
		this.downloadPromises.set(videoId, p);
		return p;
	}

	cancel(videoId: string): void {
		this.downloadPromises.delete(videoId);
		const proc = this.activeDownloads.get(videoId);
		if (proc) {
			proc.kill('SIGTERM');
			this.activeDownloads.delete(videoId);
			this.cleanIntermediate(videoId);
		}
	}

	isAvailable(): boolean {
		return AudioCacheService.isAvailable(this.ytdlpPath);
	}

	/** Obsidian's process.env.PATH often excludes Homebrew/user paths.
	 *  Ensure the directory containing yt-dlp (and likely ffmpeg) is on PATH. */
	private spawnEnv(): NodeJS.ProcessEnv {
		const ytdlpDir = dirname(this.ytdlpPath);
		const currentPath = process.env.PATH ?? '';
		if (currentPath.split(':').includes(ytdlpDir)) return { ...process.env };
		return { ...process.env, PATH: `${ytdlpDir}:${currentPath}` };
	}

	private cleanIntermediate(videoId: string): void {
		const absDir = join(this.absBase, this.cacheDir);
		const targetExt = `.${this.format}`;
		for (const file of readdirSync(absDir)) {
			if (file.startsWith(videoId + '.') && !file.endsWith(targetExt)) {
				unlinkSync(join(absDir, file));
			}
		}
	}

	private parseYtdlpError(stderr: string): string {
		if (/Video unavailable/i.test(stderr)) return 'This video is unavailable or has been removed.';
		if (/Sign in|age/i.test(stderr)) return 'This video requires age verification.';
		if (/geo|country/i.test(stderr)) return 'This video is not available in your region.';
		if (/private/i.test(stderr)) return 'This video is private.';
		if (/Network|Unable to connect|Connection/i.test(stderr)) return 'Network error — check your connection.';
		return stderr.slice(-100) || 'Unknown error.';
	}

	static isAvailable(ytdlpPath?: string): boolean {
		const path = ytdlpPath ?? AudioCacheService.discoverYtdlpPath();
		const result = spawnSync(path, ['--version'], { stdio: 'ignore' });
		return result.status === 0;
	}
}
