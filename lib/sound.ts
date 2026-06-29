/**
 * lib/sound.ts — dependency-free sound + haptics utility for in-game moment cues.
 *
 * Synthesizes short audio cues with the Web Audio API (no asset files) and fires
 * matching haptic patterns via navigator.vibrate. Everything is SSR-guarded and
 * wrapped in try/catch so a failure can never throw to the caller. Mute state is
 * persisted in localStorage under 'jl_sound_muted' ('1' = muted).
 *
 * Typical use: from a useEffect that runs when a "moment" appears, call
 *   playCue('alert')  // or 'good' | 'bad' | 'win'
 */

type CueKind = 'good' | 'bad' | 'alert' | 'win';

const MUTE_KEY = 'jl_sound_muted';
const PEAK_GAIN = 0.12;

const HAPTICS: Record<CueKind, number[]> = {
  good: [40],
  bad: [80, 40, 80],
  alert: [30, 30, 30],
  win: [50, 30, 50, 30, 120],
};

let audioCtx: AudioContext | null = null;

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };

/** Lazily create (and resume) a single shared AudioContext. Returns null on failure. */
function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  try {
    if (!audioCtx) {
      const Ctor =
        window.AudioContext ?? (window as WebkitWindow).webkitAudioContext;
      if (!Ctor) return null;
      audioCtx = new Ctor();
    }
    // Unlock after a user gesture (the app's buttons satisfy this requirement).
    if (audioCtx.state === 'suspended') {
      void audioCtx.resume();
    }
    return audioCtx;
  } catch {
    return null;
  }
}

/**
 * Schedule a single tone on the given context.
 * Uses gentle linear attack/decay ramps on the gain node to avoid clicks/pops.
 */
function scheduleTone(
  ctx: AudioContext,
  opts: {
    startAt: number;
    duration: number;
    type: OscillatorType;
    freqStart: number;
    freqEnd?: number;
    peak?: number;
  },
): void {
  const { startAt, duration, type, freqStart } = opts;
  const freqEnd = opts.freqEnd ?? freqStart;
  const peak = opts.peak ?? PEAK_GAIN;

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = type;
  osc.frequency.setValueAtTime(freqStart, startAt);
  if (freqEnd !== freqStart) {
    osc.frequency.linearRampToValueAtTime(freqEnd, startAt + duration);
  }

  const attack = Math.min(0.02, duration * 0.25);
  const release = Math.min(0.06, duration * 0.5);

  // Start silent, ramp up (attack), hold, ramp down to ~0 (release) — no pops.
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.linearRampToValueAtTime(peak, startAt + attack);
  gain.gain.setValueAtTime(peak, startAt + duration - release);
  gain.gain.linearRampToValueAtTime(0.0001, startAt + duration);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(startAt);
  osc.stop(startAt + duration + 0.02);
}

function playSound(kind: CueKind): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  const t = ctx.currentTime;

  switch (kind) {
    case 'good': {
      // Pleasant ascending two-note chime (~660Hz -> ~880Hz), ~300ms total.
      scheduleTone(ctx, { startAt: t, duration: 0.14, type: 'sine', freqStart: 660 });
      scheduleTone(ctx, { startAt: t + 0.15, duration: 0.15, type: 'sine', freqStart: 880 });
      break;
    }
    case 'bad': {
      // Descending sawtooth buzz/thud (~300Hz -> ~150Hz), ~350ms.
      scheduleTone(ctx, {
        startAt: t,
        duration: 0.35,
        type: 'sawtooth',
        freqStart: 300,
        freqEnd: 150,
      });
      break;
    }
    case 'alert': {
      // Urgent double blip (~880Hz twice), ~250ms.
      scheduleTone(ctx, { startAt: t, duration: 0.08, type: 'square', freqStart: 880 });
      scheduleTone(ctx, { startAt: t + 0.13, duration: 0.08, type: 'square', freqStart: 880 });
      break;
    }
    case 'win': {
      // Triumphant ascending arpeggio (~520/660/784/1046Hz), ~600ms.
      const notes = [523, 659, 784, 1046];
      notes.forEach((freq, i) => {
        scheduleTone(ctx, {
          startAt: t + i * 0.14,
          duration: 0.16,
          type: 'triangle',
          freqStart: freq,
        });
      });
      break;
    }
  }
}

function playHaptics(kind: CueKind): void {
  if (typeof navigator === 'undefined') return;
  try {
    if (typeof navigator.vibrate !== 'function') return;
    navigator.vibrate(HAPTICS[kind]);
  } catch {
    // Ignore — vibration is best-effort.
  }
}

/** Returns true if cues are currently muted (persisted in localStorage). */
export function isMuted(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Persist the mute preference. When muted, playCue skips both sound and vibration. */
export function setMuted(muted: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (muted) {
      window.localStorage.setItem(MUTE_KEY, '1');
    } else {
      window.localStorage.removeItem(MUTE_KEY);
    }
  } catch {
    // Ignore — persistence is best-effort.
  }
}

/**
 * Play a moment cue: synthesized audio + matching haptics.
 * No-op on the server, when muted, or on any internal failure.
 */
export function playCue(kind: CueKind): void {
  if (typeof window === 'undefined') return;
  try {
    if (isMuted()) return;
    playSound(kind);
    playHaptics(kind);
  } catch {
    // Never throw to the caller.
  }
}
