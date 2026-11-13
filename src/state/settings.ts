import { useEffect, useState } from 'react';
import { TABLES, type SettingRow } from '../db/schema';
import { db } from '../db/db';
import { put, newId } from '../db/repo';
import { DEFAULT_THEME, THEME_OPTIONS, type ThemeId } from './themes';

export interface AppSettings {
  theme: ThemeId;
  density: 'comfortable' | 'compact';
  typeScale: 'normal' | 'large';
  accentLabel: string;
  units: 'metric' | 'imperial';
  currency: string;
  monthlyBudget: number;
  locationGranularity: 'none' | 'country' | 'region' | 'city';
  country: string;
  lifestyle: string;
  /** Part 1 #18 — image analysis is never mandatory. Off also stops the colour
   *  palette and colour tags being derived from a photograph at ingest. */
  imageAnalysis: boolean;
  /** Part 35 — nothing leaves the device unless the user flips this. */
  allowExternalProcessing: boolean;
  /**
   * Gates her own file reaching the ingest path and the capture controls. It
   * gates LOCAL ingest only: a remote image fetch is refused by
   * `allowExternalProcessing`, and nothing here is ever sent anywhere. It ships
   * on because logging a photograph is the app's first job, not an add-on.
   */
  allowUploads: boolean;
  privateMediaByDefault: boolean;
  /**
   * Part 9 boundary, made explicit: Pinterest-sourced cards are kept separate
   * from the taste arithmetic until she says otherwise. This is express
   * permission to learn from material that came from somewhere else, so it
   * ships off; the switch is there for her to give.
   */
  pinterestTeachesTaste: boolean;
  /**
   * Pull the archive sitting on this device into the feed whenever the app
   * opens. Ships off: an import she did not ask for is still an import.
   */
  pinterestAutoSync: boolean;
  /** Last completed pull, so Settings can state when the feed was last refreshed. */
  pinterestSyncAt: number | null;
  /** ETag or size of the last archive read, so an unchanged file is not re-decoded. */
  pinterestArchiveStamp: string;
  /**
   * The app's promise that a passcode stands in front of the lab. `App.tsx`
   * gates on it: if it is on and no passcode is armed on this device, the app
   * opens on a "choose your passcode" gate instead of her records, so the flag
   * can never claim a protection that is not there.
   */
  requireAppLock: boolean;
  measurementsTracking: boolean;
  weightTracking: boolean;
  advisorEngine: 'local' | 'local+provider';
  advisorBluntness: 'gentle' | 'balanced' | 'technical';
  providerBaseUrl: string;
  providerApiKeyRef: string;
  syncEnabled: boolean;
  syncEndpoint: string;
  syncIntervalMin: number;
  /**
   * The in-app "what is due" widget. Local derivation over her own routine
   * logs: this build requests no notification permission, schedules nothing
   * outside the app and makes no request. It ships on because the dashboard is
   * the point of the app; switch it off and nothing due is listed at all.
   */
  reminders: boolean;
  reducedMotion: boolean;
  dashboardCards: string[];
  /**
   * Her keep-list of departments. Empty means she has not narrowed anything,
   * so every department stays in the rail and answers its address. Once it is
   * not empty it is an allow-list: everything left out drops out of the rail
   * and its route refuses her. See `departmentEnabled`.
   */
  enabledDepartments: string[];
  /** Cells of the visual acceptance matrix you have personally signed off. */
  visualChecks: string[];
  onboardingDone: boolean;
  firstRunAt: number | null;
}

/**
 * The OS preference is a starting point, not a boss: it seeds a first-run profile and
 * is followed when it actually changes, but it never overwrites a choice made in Settings.
 */
export function osPrefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: DEFAULT_THEME,
  density: 'comfortable',
  typeScale: 'normal',
  accentLabel: 'champagne',
  units: 'metric',
  currency: 'USD',
  monthlyBudget: 120,
  locationGranularity: 'none',
  country: '',
  lifestyle: '',
  imageAnalysis: false,
  allowExternalProcessing: false,
  allowUploads: true,
  privateMediaByDefault: true,
  pinterestTeachesTaste: false,
  pinterestAutoSync: false,
  pinterestSyncAt: null,
  pinterestArchiveStamp: '',
  requireAppLock: false,
  measurementsTracking: false,
  weightTracking: false,
  advisorEngine: 'local',
  advisorBluntness: 'balanced',
  providerBaseUrl: '',
  providerApiKeyRef: '',
  syncEnabled: false,
  syncEndpoint: '',
  syncIntervalMin: 60,
  reminders: true,
  reducedMotion: osPrefersReducedMotion(),
  dashboardCards: [
    'priorities',
    'goals',
    'advisor',
    'discover',
    'routines',
    'progress',
    'calendar',
    'wishlist'
  ],
  enabledDepartments: [],
  visualChecks: [],
  onboardingDone: false,
  firstRunAt: null
};

const KEY = 'app';

/**
 * Departments that are the app's own chrome: they stay in the rail and keep
 * answering their address whatever the keep-list says, so narrowing the list
 * can never hide the way back to Settings.
 */
export const CHROME_DEPARTMENTS = ['home', 'settings', 'search'];

/**
 * The one rule the department rail and the route table share, so neither can
 * disagree with the other: an empty keep-list narrows nothing; a non-empty one
 * is an allow-list, and everything left out is out.
 */
export function departmentEnabled(id: string, enabled: string[]): boolean {
  if (CHROME_DEPARTMENTS.includes(id)) return true;
  return enabled.length === 0 || enabled.includes(id);
}

let cache: AppSettings | null = null;
const listeners = new Set<(s: AppSettings) => void>();

export async function loadSettings(): Promise<AppSettings> {
  if (cache) return cache;
  const row = await db.settings.get(KEY);
  const merged = { ...DEFAULT_SETTINGS, ...((row?.value as Partial<AppSettings>) ?? {}) };
  if (!row || !row.value) await persist(merged);
  cache = merged;
  return merged;
}

async function persist(next: AppSettings) {
  cache = next;
  await put(TABLES.settings, { id: KEY, key: KEY, value: next } as Partial<SettingRow> as any);
  for (const l of listeners) l(next);
}

export async function updateSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const next = { ...(await loadSettings()), ...patch };
  await persist(next);
  return next;
}

/**
 * A `?theme=` in the address previews that theme for this document only. It is
 * never written to the settings row, so the contact sheet can show three themes
 * side by side without your saved choice moving.
 */
export function previewThemeFromUrl(): ThemeId | null {
  try {
    const raw = new URLSearchParams(window.location.search).get('theme');
    return THEME_OPTIONS.some((t) => t.id === raw) ? (raw as ThemeId) : null;
  } catch {
    return null;
  }
}

/**
 * The visual contact sheet renders live copies of the app inside iframes. Those
 * copies display your data and nothing else: they must not seed, recommend or
 * otherwise write, or three panes would be racing over one database.
 */
export function isEmbeddedFrame(): boolean {
  try {
    return new URLSearchParams(window.location.search).has('sheet');
  } catch {
    return false;
  }
}

export function applyDocumentSettings(s: AppSettings) {
  const root = document.documentElement;
  root.dataset.theme = previewThemeFromUrl() ?? s.theme;
  root.dataset.density = s.density;
  root.dataset.type = s.typeScale;
  root.dataset.motion = s.reducedMotion ? 'reduced' : 'full';
}

export function subscribeSettings(fn: (s: AppSettings) => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function settingsId() {
  return newId('set');
}

/** Reactive settings for components that enforce a preference rather than display it. */
export function useSettings(): AppSettings {
  const [s, setS] = useState<AppSettings>(cache ?? DEFAULT_SETTINGS);
  useEffect(() => {
    let alive = true;
    const off = subscribeSettings((v) => {
      if (alive) setS(v);
    });
    void loadSettings().then((v) => {
      if (alive) setS(v);
    });
    return () => {
      alive = false;
      off();
    };
  }, []);
  return s;
}
