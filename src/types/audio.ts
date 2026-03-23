export type AudioFormat = 'mp3' | 'wav' | 'opus' | 'aac';

export const AUDIO_MIME_TYPES: Record<AudioFormat, string> = {
	mp3: 'audio/mpeg',
	wav: 'audio/wav',
	opus: 'audio/ogg',
	aac: 'audio/aac',
};
