// Settings remembered on this phone so posting a shot needs as few taps as possible.
import type { DistanceBucket, Spot, TargetSize } from './types';

export interface Prefs {
  lobbyId?: string;
  countdown: number;
  clipLen: number; // maximum clip length; recording usually stops on the landing
  ring: number;
  autoStop: boolean;
  distance?: DistanceBucket;
  targetSize?: TargetSize;
  spot: Spot;
  sfx: boolean;
  music: boolean;
}

const KEY = 'upped-prefs';
const DEFAULTS: Prefs = { countdown: 5, clipLen: 15, ring: 0.07, autoStop: true, spot: 'home', sfx: true, music: true };

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePrefs(patch: Partial<Prefs>) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...loadPrefs(), ...patch }));
  } catch {
    /* storage unavailable: settings just won't be remembered */
  }
}
