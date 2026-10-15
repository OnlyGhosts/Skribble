/** Renders a sound into mono samples at `sampleRate`; `random` is [0, 1) noise for the texture. */
export type Render = (sampleRate: number, random: () => number) => Float32Array;

interface SoundBase {
  /** Its level before the master volume, 0 to 1. */
  volume: number;
  /** A repeat within this long is dropped, so a burst of events does not stack into noise. */
  cooldownMs?: number;
  /** Plays at its own pitch every time (musical cues); otherwise the rate wanders a little. */
  steady?: boolean;
}

/** A recorded sound under /sounds/, without the extension; with several, one is picked at random each time. */
export interface SampleSound extends SoundBase {
  file: string | readonly string[];
}

/** A sound made in code, for the few moments no recording fits (a whoosh, a drumroll). */
export interface RenderedSound extends SoundBase {
  render: Render;
}

export type SoundDef = SampleSound | RenderedSound;

export interface PlayOptions {
  /** Scales the sound's own level: 1 as declared, lower for someone else's moment. */
  volume?: number;
}

export function isSample(def: SoundDef): def is SampleSound {
  return 'file' in def;
}

/** The files a sound may play, as URL paths. */
export function soundUrls(def: SoundDef): string[] {
  if (!isSample(def)) return [];
  const files = typeof def.file === 'string' ? [def.file] : def.file;
  return files.map(soundUrl);
}

export function soundUrl(file: string): string {
  return `/sounds/${file}.mp3`;
}
