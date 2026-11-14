// Sound effects and hype music.
//
// Every sound is generated in code with the Web Audio API, so there are no
// files to license. To swap in a real recording, put an .mp3 in
// public/sounds/ named after the sound (airhorn.mp3, siren.mp3, applause.mp3,
// ooh.mp3, letsgo.mp3, boo.mp3, fail.mp3, music.mp3) and list it in
// public/sounds/manifest.json. Real files always win over generated ones.

import { loadPrefs } from './prefs';

export type SoundName = 'airhorn' | 'siren' | 'applause' | 'ooh' | 'letsgo' | 'boo' | 'fail' | 'music';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let files: Set<string> | null = null;
const fileCache = new Map<string, HTMLAudioElement>();
let musicStop: (() => void) | null = null;

function audio(): AudioContext | null {
  if (ctx) return ctx;
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.8;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp).connect(ctx.destination);
  } catch {
    ctx = null;
  }
  return ctx;
}

// Phones only allow sound after a tap; unlock on the first one.
if (typeof window !== 'undefined') {
  const unlock = () => void audio()?.resume();
  window.addEventListener('pointerdown', unlock, { once: true, capture: true });
}

void fetch('sounds/manifest.json')
  .then((r) => (r.ok ? r.json() : []))
  .then((list: string[]) => (files = new Set(list)))
  .catch(() => (files = new Set()));

function playFile(name: string, volume = 1): boolean {
  if (!files?.has(name)) return false;
  let el = fileCache.get(name);
  if (!el) {
    el = new Audio(`sounds/${name}.mp3`);
    fileCache.set(name, el);
  }
  const clone = el.cloneNode() as HTMLAudioElement;
  clone.volume = volume;
  void clone.play().catch(() => {});
  return true;
}

// ---------------------------------------------------------------------------
// Synth building blocks
// ---------------------------------------------------------------------------

function noiseBuffer(c: AudioContext, seconds: number): AudioBuffer {
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * seconds), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return buf;
}

function env(c: AudioContext, t: number, attack: number, hold: number, release: number, peak = 1): GainNode {
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.setValueAtTime(peak, t + attack + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
  return g;
}

/** Stadium air horn: three blasts of detuned brass. */
function airhorn(c: AudioContext, out: AudioNode, t0: number, blasts = [0.16, 0.16, 0.7]) {
  let t = t0;
  for (const len of blasts) {
    const g = env(c, t, 0.01, len, 0.08, 0.35);
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2400;
    lp.connect(g).connect(out);
    for (const f of [349, 440, 523, 351.5]) {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f * 0.97, t);
      o.frequency.linearRampToValueAtTime(f, t + 0.04);
      o.connect(lp);
      o.start(t);
      o.stop(t + len + 0.12);
    }
    t += len + 0.07;
  }
}

/** Wailing siren. */
function siren(c: AudioContext, out: AudioNode, t0: number, seconds = 2.4) {
  const o = c.createOscillator();
  o.type = 'square';
  const lfo = c.createOscillator();
  lfo.frequency.value = 1.6;
  const depth = c.createGain();
  depth.gain.value = 330;
  o.frequency.value = 960;
  lfo.connect(depth).connect(o.frequency);
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1100;
  bp.Q.value = 0.8;
  const g = env(c, t0, 0.05, seconds - 0.4, 0.35, 0.18);
  o.connect(bp).connect(g).connect(out);
  o.start(t0);
  lfo.start(t0);
  o.stop(t0 + seconds);
  lfo.stop(t0 + seconds);
}

/** Crowd clapping: lots of short filtered noise bursts plus a roar underneath. */
function applause(c: AudioContext, out: AudioNode, t0: number, seconds = 3) {
  const noise = noiseBuffer(c, 0.05);
  const claps = Math.round(seconds * 45);
  for (let i = 0; i < claps; i++) {
    const t = t0 + Math.random() * seconds;
    const fade = 1 - Math.max(0, (t - t0) / seconds - 0.6) * 2;
    const s = c.createBufferSource();
    s.buffer = noise;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900 + Math.random() * 1600;
    bp.Q.value = 1.2;
    const g = env(c, t, 0.002, 0.004, 0.05, 0.25 * Math.max(0.1, fade) * (0.5 + Math.random() * 0.5));
    s.connect(bp).connect(g).connect(out);
    s.start(t);
  }
  roar(c, out, t0, seconds, 0.06);
}

function roar(c: AudioContext, out: AudioNode, t0: number, seconds: number, level: number) {
  const s = c.createBufferSource();
  s.buffer = noiseBuffer(c, seconds + 0.5);
  const bp = c.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 700;
  bp.Q.value = 0.6;
  const g = env(c, t0, 0.3, seconds - 0.9, 0.6, level);
  s.connect(bp).connect(g).connect(out);
  s.start(t0);
}

/**
 * A crowd of voices singing one vowel, made from many slightly different
 * buzzing tones shaped by vowel filters ("formants").
 */
function crowdVowel(
  c: AudioContext,
  out: AudioNode,
  t0: number,
  o: { seconds: number; pitch: [number, number]; glide: [number, number, number]; formants: [number, number]; level: number; voices?: number },
) {
  const voices = o.voices ?? 14;
  const f1 = c.createBiquadFilter();
  f1.type = 'bandpass';
  f1.frequency.value = o.formants[0];
  f1.Q.value = 5;
  const f2 = c.createBiquadFilter();
  f2.type = 'bandpass';
  f2.frequency.value = o.formants[1];
  f2.Q.value = 6;
  const g = env(c, t0, 0.18, o.seconds - 0.6, 0.45, o.level);
  f1.connect(g);
  f2.connect(g);
  g.connect(out);
  for (let i = 0; i < voices; i++) {
    const base = o.pitch[0] + Math.random() * (o.pitch[1] - o.pitch[0]);
    const osc = c.createOscillator();
    osc.type = 'sawtooth';
    const start = t0 + Math.random() * 0.12;
    osc.frequency.setValueAtTime(base * o.glide[0], start);
    osc.frequency.linearRampToValueAtTime(base * o.glide[1], start + o.seconds * 0.45);
    osc.frequency.linearRampToValueAtTime(base * o.glide[2], start + o.seconds);
    const vib = c.createOscillator();
    vib.frequency.value = 4 + Math.random() * 2;
    const vd = c.createGain();
    vd.gain.value = base * 0.015;
    vib.connect(vd).connect(osc.frequency);
    const vg = c.createGain();
    vg.gain.value = 1 / voices;
    osc.connect(vg);
    vg.connect(f1);
    vg.connect(f2);
    osc.start(start);
    vib.start(start);
    osc.stop(start + o.seconds + 0.1);
    vib.stop(start + o.seconds + 0.1);
  }
  roar(c, out, t0, o.seconds, o.level * 0.25);
}

const ooh = (c: AudioContext, out: AudioNode, t: number) =>
  crowdVowel(c, out, t, { seconds: 1.9, pitch: [150, 300], glide: [0.85, 1.2, 0.8], formants: [320, 800], level: 0.9 });

const boo = (c: AudioContext, out: AudioNode, t: number) =>
  crowdVowel(c, out, t, { seconds: 2.2, pitch: [95, 160], glide: [1.05, 1, 0.8], formants: [300, 700], level: 1 });

/** "Yeaaah!" crowd cheer with horns: the generated stand-in for a "LET'S GO!". */
function letsgo(c: AudioContext, out: AudioNode, t: number) {
  crowdVowel(c, out, t, { seconds: 2, pitch: [190, 360], glide: [0.9, 1.25, 1.1], formants: [750, 1250], level: 0.9, voices: 18 });
  airhorn(c, out, t + 0.1, [0.12, 0.12, 0.45]);
}

/** Sad trombone: wah, wah, wah, waaaah. */
function fail(c: AudioContext, out: AudioNode, t0: number) {
  const notes: Array<[number, number]> = [
    [233, 0.32],
    [220, 0.32],
    [208, 0.32],
    [196, 1.1],
  ];
  let t = t0;
  notes.forEach(([f, len], i) => {
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(f, t);
    const wah = c.createBiquadFilter();
    wah.type = 'lowpass';
    wah.Q.value = 6;
    wah.frequency.setValueAtTime(400, t);
    wah.frequency.linearRampToValueAtTime(1300, t + 0.12);
    wah.frequency.linearRampToValueAtTime(500, t + len);
    if (i === notes.length - 1) {
      const lfo = c.createOscillator();
      lfo.frequency.value = 6;
      const d = c.createGain();
      d.gain.value = 5;
      lfo.connect(d).connect(o.frequency);
      lfo.start(t);
      lfo.stop(t + len);
    }
    const g = env(c, t, 0.03, len - 0.12, 0.09, 0.28);
    o.connect(wah).connect(g).connect(out);
    o.start(t);
    o.stop(t + len + 0.05);
    t += len + 0.04;
  });
}

/** Hype beat: 808 kick and bass, claps, rolling hi-hats and a stab chord. */
function hypeBeat(c: AudioContext, out: AudioNode, seconds: number): () => void {
  const bpm = 140;
  const step = 60 / bpm / 4; // 16th notes
  const bus = c.createGain();
  bus.gain.value = 0.55;
  bus.connect(out);
  const t0 = c.currentTime + 0.05;
  const steps = Math.floor(seconds / step);
  const hat = noiseBuffer(c, 0.05);
  const bassNotes = [43.65, 43.65, 51.91, 38.89]; // F1, F1, G#1, D#1 per bar
  for (let i = 0; i < steps; i++) {
    const t = t0 + i * step;
    const s = i % 16;
    const bar = Math.floor(i / 16) % 4;
    if (s === 0 || s === 10) {
      // 808: sine with a pitch drop and a long tail
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(bassNotes[bar] * 3, t);
      o.frequency.exponentialRampToValueAtTime(bassNotes[bar], t + 0.08);
      const g = env(c, t, 0.005, 0.15, 0.5, 0.9);
      o.connect(g).connect(bus);
      o.start(t);
      o.stop(t + 0.7);
    }
    if (s === 4 || s === 12) {
      const n = c.createBufferSource();
      n.buffer = noiseBuffer(c, 0.2);
      const bp = c.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1500;
      const g = env(c, t, 0.002, 0.02, 0.15, 0.5);
      n.connect(bp).connect(g).connect(bus);
      n.start(t);
    }
    const roll = bar === 3 && s >= 12;
    if (s % 2 === 0 || roll) {
      const n = c.createBufferSource();
      n.buffer = hat;
      const hp = c.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 7000;
      const g = env(c, t, 0.001, 0.005, 0.03, roll ? 0.12 : 0.18);
      n.connect(hp).connect(g).connect(bus);
      n.start(t);
      if (roll) {
        const n2 = c.createBufferSource();
        n2.buffer = hat;
        const hp2 = c.createBiquadFilter();
        hp2.type = 'highpass';
        hp2.frequency.value = 7000;
        const g2 = env(c, t + step / 2, 0.001, 0.005, 0.03, 0.1);
        n2.connect(hp2).connect(g2).connect(bus);
        n2.start(t + step / 2);
      }
    }
    if (s === 0 && bar % 2 === 0) {
      for (const f of [349.2, 415.3, 523.3]) {
        const o = c.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        const lp = c.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = 1800;
        const g = env(c, t, 0.01, 0.12, 0.25, 0.06);
        o.connect(lp).connect(g).connect(bus);
        o.start(t);
        o.stop(t + 0.5);
      }
    }
  }
  const end = t0 + seconds;
  bus.gain.setValueAtTime(0.55, end - 1);
  bus.gain.linearRampToValueAtTime(0.0001, end);
  return () => {
    const now = c.currentTime;
    bus.gain.cancelScheduledValues(now);
    bus.gain.setValueAtTime(bus.gain.value, now);
    bus.gain.linearRampToValueAtTime(0.0001, now + 0.4);
    window.setTimeout(() => bus.disconnect(), 600);
  };
}

const SYNTH: Record<Exclude<SoundName, 'music'>, (c: AudioContext, out: AudioNode, t: number) => void> = {
  airhorn: (c, o, t) => airhorn(c, o, t),
  siren: (c, o, t) => siren(c, o, t),
  applause: (c, o, t) => applause(c, o, t),
  ooh,
  letsgo,
  boo,
  fail,
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Play one sound after `delay` seconds, if sound effects are on. */
export function play(name: Exclude<SoundName, 'music'>, delay = 0) {
  if (!loadPrefs().sfx) return;
  if (delay > 0) {
    window.setTimeout(() => play(name), delay * 1000);
    return;
  }
  if (playFile(name)) return;
  const c = audio();
  if (!c || !master) return;
  void c.resume();
  SYNTH[name](c, master, c.currentTime + 0.02);
}

/** Hype music for `seconds`. Returns a function that fades it out early. */
export function music(seconds = 12): () => void {
  stopMusic();
  if (!loadPrefs().music) return () => {};
  if (files?.has('music')) {
    const el = new Audio('sounds/music.mp3');
    el.volume = 0.6;
    void el.play().catch(() => {});
    const timer = window.setTimeout(() => el.pause(), seconds * 1000);
    musicStop = () => {
      window.clearTimeout(timer);
      el.pause();
    };
    return stopMusic;
  }
  const c = audio();
  if (!c || !master) return () => {};
  void c.resume();
  musicStop = hypeBeat(c, master, seconds);
  return stopMusic;
}

export function stopMusic() {
  musicStop?.();
  musicStop = null;
}

/** The moments in the app that make noise. */
export const sfx = {
  /** The CALLED IT moment in a replay. */
  make: () => {
    play('airhorn');
    play('ooh', 0.5);
    play('applause', 1.1);
  },
  /** Tapped "Made it!" after recording. */
  madeIt: () => {
    play('siren');
    play('applause', 0.4);
  },
  missed: () => play('fail'),
  /** A reply the lobby voted up. */
  win: () => {
    play('letsgo');
    play('applause', 0.6);
  },
  lose: () => play('boo'),
  bloopers: () => play('fail'),
  reaction: (emoji: string) => {
    if (emoji === '🔥') play('airhorn');
    else if (emoji === '😱') play('ooh');
    else if (emoji === '😂') play('fail');
    else if (emoji === '🐐') play('letsgo');
  },
};
