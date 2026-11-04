import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayerSurface } from '../src/ui/views/PlayerSurface';
import type { PlaybackState } from '../src/types/playback';
import type { AudioCachePort, PlaylistTrack } from '../src/types/view';

class TestAudio extends EventTarget {
	static instances: TestAudio[] = [];
	paused = true;
	volume = 1;
	currentTime = 0;
	duration = 180;
	playResult: () => Promise<void> = () => Promise.resolve();

	constructor(readonly src: string) {
		super();
		TestAudio.instances.push(this);
	}

	play(): Promise<void> {
		this.paused = false;
		this.dispatchEvent(new Event('play'));
		return this.playResult();
	}

	pause(): void {
		if (this.paused) return;
		this.paused = true;
		this.dispatchEvent(new Event('pause'));
	}

	remove(): void {}
}

const track: PlaylistTrack = {
	path: 'Music/Song.md', title: 'Song', artist: 'Artist', videoId: 'GwGfHjOnwsI',
	sourceUrl: 'https://www.youtube.com/watch?v=GwGfHjOnwsI', thumbnailUrl: '', tags: [],
};

function cache(): AudioCachePort {
	return {
		hasCached: async () => true,
		getFileUrl: () => 'app://local/cache/GwGfHjOnwsI.wav',
		download: async () => '/cache/GwGfHjOnwsI.wav',
		cancel: vi.fn(),
		isAvailable: () => true,
		checkAvailable: async () => true,
	};
}

function setup(service = cache()) {
	const states: PlaybackState[] = [];
	// Only the owning window is used by PlayerSurface; no document or app is needed.
	const host = { win: window };
	const surface = new PlayerSurface(host, async () => {}, (state) => states.push(state));
	surface.trackLanding(true);
	surface.setAudioCacheService(service);
	return { surface, states };
}

function audio(): TestAudio {
	const element = TestAudio.instances.at(-1);
	if (!element) throw new Error('Expected a mounted audio element');
	return element;
}

describe('PlayerSurface playback truth', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.stubGlobal('window', { setTimeout, clearTimeout });
		vi.stubGlobal('Audio', TestAudio);
		TestAudio.instances = [];
	});

	afterEach(() => {
		vi.clearAllTimers();
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it('does not report playing while a stream URL is unresolved', async () => {
		let finish = (_url: string) => {};
		let started = () => {};
		const resolving = new Promise<void>((resolve) => { started = resolve; });
		const pending = new Promise<string>((resolve) => { finish = resolve; });
		const service = cache();
		service.hasCached = async () => false;
		service.resolveStreamUrl = () => { started(); return pending; };
		const { surface, states } = setup(service);

		const rendering = surface.render(track, true);
		await resolving;
		expect(states.at(-1)).toBe('loading');
		expect(surface.phase).toBe('connecting');
		expect(TestAudio.instances).toHaveLength(0);
		finish('https://example.com/audio.m4a');
		await rendering;
	});

	it('reports playing only when the media reports playing, not on play intent', async () => {
		const { surface, states } = setup();
		await surface.render(track, true);
		expect(states.at(-1)).toBe('loading');

		surface.needleLanded();
		await vi.runOnlyPendingTimersAsync();
		expect(states.at(-1)).toBe('loading');
		audio().dispatchEvent(new Event('playing'));
		expect(states.at(-1)).toBe('playing');
	});

	it('surfaces a rejected play request and allows another attempt', async () => {
		const { surface, states } = setup();
		await surface.render(track, true);
		audio().playResult = () => Promise.reject(new DOMException('Autoplay blocked', 'NotAllowedError'));

		surface.needleLanded();
		await vi.runOnlyPendingTimersAsync();
		expect(surface.phase).toBe('failed');
		expect(states.at(-1)).toBe('paused');

		audio().playResult = () => Promise.resolve();
		expect(surface.play()).toBe(true);
		surface.needleLanded();
		await vi.runOnlyPendingTimersAsync();
		audio().dispatchEvent(new Event('playing'));
		expect(states.at(-1)).toBe('playing');
		expect(surface.phase).toBe('idle');
	});

	it('surfaces a cached media decoding error instead of leaving playing active', async () => {
		const { surface, states } = setup();
		await surface.render(track, true);

		audio().dispatchEvent(new Event('error'));
		expect(surface.phase).toBe('failed');
		expect(states.at(-1)).toBe('paused');
	});

	it('stops a pending needle drop without reporting a playback failure', async () => {
		const { surface, states } = setup();
		await surface.render(track, true);

		expect(surface.pause()).toBe(true);
		surface.needleLanded();
		await vi.runOnlyPendingTimersAsync();
		expect(audio().paused).toBe(true);
		expect(states.at(-1)).toBe('paused');
		expect(surface.phase).toBe('idle');
	});
});
