/**
 * THE GLOW LAB — the day log and the split it makes possible (spec Part 22,
 * Part 27: nothing fabricated, everything she typed).
 *
 * The app's own advice keeps naming the same levers — sleep, alcohol, sodium,
 * water, stress, where she is in her cycle (see `engine/advisor.ts`, the
 * rapid-dehydration and restriction entries). Those were always prose: nothing
 * in the store held a dated number for them, so the app could never show her
 * her own pattern. This module is the store-shaped half of that answer.
 *
 * What it is: one row per calendar date, every field optional and
 * self-reported. Nothing here is measured. A phone cannot know how many hours
 * she slept, and this app does not pretend to.
 *
 * What the read does: split the days she has *already rated* (1–5 self-ratings
 * on progress entries, moods on routine logs) into her own high days and low
 * days, then compare the average of each logged covariate between the two
 * groups. The output is a gap, the scatter inside her own numbers, and the size
 * a gap would have to be before it stops looking like that scatter. It never
 * claims a cause, never claims a diagnosis, and refuses when the counts are
 * too small to divide by.
 */
import type { AnyRow } from '../db/schema';
import { dayIndex } from './trend';

export const COVARIATE_RULE_VERSION = 1;

/** Days on each side of the split before any comparison is printed. */
export const MIN_DAYS_PER_SIDE = 4;
/** The rated days must be spread over at least this long, or it is one weekend. */
export const MIN_SPLIT_SPAN_DAYS = 14;
/** A gap has to clear this many standard errors of the difference to be called worth a look. */
export const SE_THRESHOLD = 2;

/** Ratings at or above this are her own "good" days. */
export const HIGH_RATING = 4;
/** Ratings at or below this are her own "off" days. A 3 is neither and is set aside. */
export const LOW_RATING = 2;

export type CovariateKind = 'hours' | 'count' | 'volume' | 'scale' | 'day';

export interface CovariateField {
  key: string;
  label: string;
  short: string;
  unit: string;
  kind: CovariateKind;
  min: number;
  max: number;
  step: number;
  /** Printed under the input: what she is actually being asked to remember. */
  ask: string;
  /** Only filled by some people; never implied about anyone. */
  optional: boolean;
}

export const COVARIATE_FIELDS: CovariateField[] = [
  {
    key: 'sleepHours',
    label: 'Sleep',
    short: 'sleep',
    unit: 'h',
    kind: 'hours',
    min: 0,
    max: 14,
    step: 0.5,
    ask: 'Hours asleep as you remember them — not time in bed, not a tracker’s number.',
    optional: false
  },
  {
    key: 'alcoholUnits',
    label: 'Alcohol',
    short: 'alcohol',
    unit: 'units',
    kind: 'count',
    min: 0,
    max: 20,
    step: 0.5,
    ask: 'Units drunk that day. Zero is a real answer; a blank means you did not record it.',
    optional: false
  },
  {
    key: 'waterMl',
    label: 'Fluids',
    short: 'fluids',
    unit: 'ml',
    kind: 'volume',
    min: 0,
    max: 6000,
    step: 50,
    ask: 'Roughly how much you drank. An estimate is fine — say to yourself which days you under-wrote it.',
    optional: false
  },
  {
    key: 'saltyMeals',
    label: 'Salty meals',
    short: 'salty meals',
    unit: 'meals',
    kind: 'count',
    min: 0,
    max: 6,
    step: 1,
    ask: 'Meals that were noticeably salted or heavily processed. This is the one sodium number worth remembering.',
    optional: false
  },
  {
    key: 'stress',
    label: 'Stress',
    short: 'stress',
    unit: '1–5',
    kind: 'scale',
    min: 1,
    max: 5,
    step: 1,
    ask: 'How demanding the day felt, 1 quiet to 5 hard. Your own read, no scale but yours.',
    optional: false
  },
  {
    key: 'cycleDay',
    label: 'Cycle day',
    short: 'cycle day',
    unit: 'day',
    kind: 'day',
    min: 1,
    max: 45,
    step: 1,
    ask: 'Day of your cycle, if you track one. Blank if you do not — nothing here assumes you have one.',
    optional: true
  }
];

export const COVARIATE_KEYS = COVARIATE_FIELDS.map((f) => f.key);

/* ------------------------------------------------------------------ shaping */

export interface DayEntry {
  on: string;
  /** Covariate key → number. Missing keys were never recorded. */
  values: Record<string, number>;
}

export interface SignalEntry {
  on: string;
  /** The 1–5 number she gave that day. */
  value: number;
  /** Which table it came from, printed as the source. */
  source: string;
}

const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/**
 * One row per date, newest row first when sync left duplicates: a field already
 * filled by the newer row is not overwritten by an older one, and a field the
 * newer row left blank is taken from the older one rather than lost.
 */
export function daysFromRows(rows: AnyRow[]): DayEntry[] {
  const merged = new Map<string, Record<string, number>>();
  const sorted = [...(rows ?? [])].sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')));
  for (const row of sorted) {
    const on = dayKey(row.on);
    if (!on) continue;
    const data = (row.data ?? {}) as Record<string, unknown>;
    const values = merged.get(on) ?? {};
    for (const f of COVARIATE_FIELDS) {
      const v = numOrNull(data[f.key]);
      if (v !== null && values[f.key] === undefined) values[f.key] = clampToField(f, v);
    }
    merged.set(on, values);
  }
  return [...merged.entries()]
    .filter(([, values]) => Object.keys(values).length > 0)
    .map(([on, values]) => ({ on, values }))
    .sort((a, b) => b.on.localeCompare(a.on));
}

function clampToField(f: CovariateField, v: number): number {
  return Math.min(f.max, Math.max(f.min, v));
}

/** Ratings and moods, 1–5, one value per date (a day with two is averaged). */
export function signalsFromRows(
  rows: AnyRow[],
  pick: { field: string; source: string; dateFields?: string[]; min?: number; max?: number }
): SignalEntry[] {
  const dates = pick.dateFields ?? ['on', 'doneOn', 'loggedOn', 'takenOn'];
  const acc = new Map<string, number[]>();
  for (const row of rows ?? []) {
    let on: string | null = null;
    for (const d of dates) {
      on = dayKey(row[d]);
      if (on) break;
    }
    if (!on) continue;
    const v = numOrNull(row[pick.field] ?? (row.data as Record<string, unknown> | undefined)?.[pick.field]);
    if (v === null) continue;
    if (pick.min !== undefined && v < pick.min) continue;
    if (pick.max !== undefined && v > pick.max) continue;
    acc.set(on, [...(acc.get(on) ?? []), v]);
  }
  return [...acc.entries()]
    .map(([on, list]) => ({ on, value: list.reduce((s, x) => s + x, 0) / list.length, source: pick.source }))
    .sort((a, b) => a.on.localeCompare(b.on));
}

/**
 * Two 1–5 sources for the same calendar day. The check-in rating wins and the
 * routine mood is the fallback, so one day contributes one number to the split
 * and the rule is printable rather than buried in a merge.
 */
export function mergeSignals(preferred: SignalEntry[], fallback: SignalEntry[]): SignalEntry[] {
  const byDate = new Map<string, SignalEntry>();
  for (const s of fallback ?? []) {
    if (s.value >= 1 && s.value <= 5) byDate.set(s.on, s);
  }
  for (const s of preferred ?? []) {
    if (s.value >= 1 && s.value <= 5) byDate.set(s.on, s);
  }
  return [...byDate.values()].sort((a, b) => a.on.localeCompare(b.on));
}

/** `YYYY-MM-DD` out of anything date-shaped; null when it is not a real date. */
function dayKey(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  const text = typeof v === 'number' ? new Date(v).toISOString() : String(v);
  const iso = text.slice(0, 10);
  return dayIndex(iso) === null ? null : iso;
}

/* -------------------------------------------------------------------- stats */

function mean(list: number[]): number | null {
  return list.length ? list.reduce((s, x) => s + x, 0) / list.length : null;
}

/** Population standard deviation, null when there is nothing to spread. */
function sd(list: number[]): number | null {
  if (list.length < 2) return null;
  const m = mean(list) as number;
  return Math.sqrt(list.reduce((s, x) => s + (x - m) ** 2, 0) / list.length);
}

export type SplitVerdict = 'no-logs' | 'no-ratings' | 'too-short' | 'not-recorded' | 'noise-sized' | 'worth-a-look';

export interface SplitRead {
  key: string;
  label: string;
  short: string;
  unit: string;
  /** Rated days on each side of the split, whether or not the covariate was logged. */
  nHighDays: number;
  nLowDays: number;
  /** Of those, how many actually carry this covariate. */
  loggedHigh: number;
  loggedLow: number;
  meanHigh: number | null;
  meanLow: number | null;
  /** meanHigh − meanLow. */
  gap: number | null;
  /** Scatter inside her own numbers, pooled across both sides. */
  scatter: number | null;
  /** Standard error of the difference, from her own counts and scatter. */
  seDiff: number | null;
  /** Gap would have to clear this to be called worth a look. */
  threshold: number | null;
  verdict: SplitVerdict;
  sentence: string;
}

export interface SplitResult {
  rule: number;
  /** Rated days used at all, and the 3s set aside. */
  ratedDays: number;
  middleDays: number;
  nHigh: number;
  nLow: number;
  spanDays: number;
  /** `MIN_DAYS_PER_SIDE` and `MIN_SPLIT_SPAN_DAYS` are the gate; this says which one bit. */
  gate: string | null;
  reads: SplitRead[];
  headline: string;
  note: string;
}

const r2 = (v: number | null): number | null => (v === null ? null : Math.round(v * 100) / 100);

/**
 * Compare every logged covariate between her own high-rated and low-rated days.
 *
 * `signals` are 1–5 values she already gave; `days` are her own day rows. The
 * split is hers (≥4 against ≤2), the numbers are hers, and the only judgement
 * made here is whether a gap is bigger than the scatter of her own entries.
 */
export function splitByRatings(
  days: DayEntry[],
  signals: SignalEntry[],
  opts: { minPerSide?: number; minSpanDays?: number; fields?: CovariateField[] } = {}
): SplitResult {
  const minPerSide = opts.minPerSide ?? MIN_DAYS_PER_SIDE;
  const minSpan = opts.minSpanDays ?? MIN_SPLIT_SPAN_DAYS;
  const fields = opts.fields ?? COVARIATE_FIELDS;

  const dayMap = new Map(days.map((d) => [d.on, d.values]));
  const usable = signals.filter((s) => {
    const idx = dayIndex(s.on);
    return idx !== null && Number.isFinite(s.value);
  });
  const high = usable.filter((s) => s.value >= HIGH_RATING);
  const low = usable.filter((s) => s.value <= LOW_RATING);
  const middle = usable.length - high.length - low.length;

  const allDates = usable.map((s) => dayIndex(s.on) as number).sort((a, b) => a - b);
  const spanDays = allDates.length > 1 ? allDates[allDates.length - 1] - allDates[0] : 0;

  const base: SplitResult = {
    rule: COVARIATE_RULE_VERSION,
    ratedDays: usable.length,
    middleDays: middle,
    nHigh: high.length,
    nLow: low.length,
    spanDays,
    gate: null,
    reads: [],
    headline: '',
    note: ''
  };

  if (days.length === 0) {
    return {
      ...base,
      reads: fields.map((f) => emptyRead(f, 'no-logs', `No day logged yet, so ${f.short} has nothing to compare.`)),
      headline: 'Nothing logged in the day strip yet.',
      note: `${usable.length} rated day(s) on record, and no day rows. Until the strip holds sleep, alcohol, fluids, salty meals or stress there is no answer from your own data here — only the advice, which stays advice.`
    };
  }
  if (usable.length === 0) {
    return {
      ...base,
      reads: fields.map((f) => emptyRead(f, 'no-ratings', `You have logged ${days.length} day(s) but rated none, so there is no split to make.`)),
      headline: `${days.length} day(s) logged, no ratings to split them by.`,
      note: 'The split needs days you have already scored 1–5 — a self-rating on a progress entry, or a mood on a routine log. Nothing is scored for you.'
    };
  }

  const gate: string[] = [];
  if (high.length < minPerSide) gate.push(`${high.length} day(s) rated ${HIGH_RATING}–5 where ${minPerSide} are wanted`);
  if (low.length < minPerSide) gate.push(`${low.length} day(s) rated 1–${LOW_RATING} where ${minPerSide} are wanted`);
  if (spanDays < minSpan) gate.push(`${spanDays} days of spread where ${minSpan} are wanted`);

  const reads = fields.map((f) => (gate.length ? heldRead(f, dayMap, high, low, gate) : compareField(f, dayMap, high, low)));
  const anyVerdict = reads.some((x) => x.verdict === 'worth-a-look' || x.verdict === 'noise-sized');

  const best = reads
    .filter((x) => x.verdict === 'worth-a-look')
    .sort((a, b) => Math.abs(b.gap ?? 0) - Math.abs(a.gap ?? 0))[0];

  return {
    ...base,
    gate: gate.length ? gate.join('; ') : null,
    reads,
    headline: gate.length
      ? `Split on hold: ${gate.join('; ')}.`
      : best
        ? `${best.label} is the widest gap between your ${base.nHigh} good days and your ${base.nLow} off days.`
        : anyVerdict
          ? `No gap in the day log is bigger than the scatter of your own entries.`
          : `Nothing here has been recorded on enough of the rated days to compare.`,
    note: gate.length
      ? `The arithmetic waits for ${minPerSide} rated days on each side spread over ${minSpan} days. Keep logging; this is not a verdict about you.`
      : `Groups are your own ratings, not the app’s: ≥${HIGH_RATING} against ≤${LOW_RATING}${middle ? `, with ${middle} day(s) rated 3 set aside` : ''}. A gap larger than ±${SE_THRESHOLD}× the standard error of the difference is called worth a look, which is a statement about your numbers — not about causes, and not about anybody but you.`
  };
}

function blankRead(f: CovariateField): SplitRead {
  return {
    key: f.key,
    label: f.label,
    short: f.short,
    unit: f.unit,
    nHighDays: 0,
    nLowDays: 0,
    loggedHigh: 0,
    loggedLow: 0,
    meanHigh: null,
    meanLow: null,
    gap: null,
    scatter: null,
    seDiff: null,
    threshold: null,
    verdict: 'not-recorded',
    sentence: ''
  };
}

function emptyRead(f: CovariateField, verdict: SplitVerdict, sentence: string): SplitRead {
  return { ...blankRead(f), verdict, sentence };
}

/**
 * The counts do not clear the gate, so no comparison is printed for this field
 * even though the numbers exist — only how many days each side holds.
 */
function heldRead(
  f: CovariateField,
  dayMap: Map<string, Record<string, number>>,
  high: SignalEntry[],
  low: SignalEntry[],
  gate: string[]
): SplitRead {
  const logged = (list: SignalEntry[]) =>
    list.filter((s) => typeof dayMap.get(s.on)?.[f.key] === 'number').length;
  return {
    ...blankRead(f),
    nHighDays: high.length,
    nLowDays: low.length,
    loggedHigh: logged(high),
    loggedLow: logged(low),
    verdict: 'too-short',
    sentence: `${f.label}: recorded on ${logged(high)} good day(s) and ${logged(low)} off day(s). Held back — ${gate.join('; ')}.`
  };
}

function compareField(f: CovariateField, dayMap: Map<string, Record<string, number>>, high: SignalEntry[], low: SignalEntry[]): SplitRead {
  const pick = (list: SignalEntry[]) =>
    list.map((s) => dayMap.get(s.on)?.[f.key]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));

  const highs = pick(high);
  const lows = pick(low);

  const read: SplitRead = {
    key: f.key,
    label: f.label,
    short: f.short,
    unit: f.unit,
    nHighDays: high.length,
    nLowDays: low.length,
    loggedHigh: highs.length,
    loggedLow: lows.length,
    meanHigh: r2(mean(highs)),
    meanLow: r2(mean(lows)),
    gap: null,
    scatter: null,
    seDiff: null,
    threshold: null,
    verdict: 'not-recorded',
    sentence: ''
  };

  if (highs.length === 0 && lows.length === 0) {
    return { ...read, sentence: `${f.label}: never written on any rated day, so nothing is known.` };
  }
  if (highs.length < 2 || lows.length < 2) {
    return {
      ...read,
      sentence: `${f.label}: logged on ${highs.length} good day(s) and ${lows.length} off day(s). Two or more on each side are needed before a spread can be talked about.`
    };
  }

  const mh = mean(highs) as number;
  const ml = mean(lows) as number;
  const gap = mh - ml;
  // pooled standard deviation across both sides, from her own entries only
  const vh = (sd(highs) as number) ** 2;
  const vl = (sd(lows) as number) ** 2;
  const pooled = Math.sqrt(((vh * (highs.length - 1)) / (highs.length + lows.length - 2)) + ((vl * (lows.length - 1)) / (highs.length + lows.length - 2)));
  const seDiff = pooled * Math.sqrt(1 / highs.length + 1 / lows.length);
  const threshold = SE_THRESHOLD * seDiff;
  /* a day log that never moved gives a threshold of zero, and 0 ≥ 0 is not a
    finding — the two groups recorded the same figure, which is its own answer */
  const verdict: SplitVerdict = Math.abs(gap) < 1e-9 ? 'noise-sized' : Math.abs(gap) >= threshold ? 'worth-a-look' : 'noise-sized';

  const u = f.unit ? ` ${f.unit}` : '';
  const sentence =
    verdict === 'worth-a-look'
      ? `${f.label}: ${round(mh)}${u} on the ${highs.length} good day(s) you logged it, ${round(ml)}${u} on the ${lows.length} off day(s) — a gap of ${signed(round(gap))}${u}, wider than the ±${round(threshold)}${u} your own scatter allows. Worth a look, not an explanation: nothing here says which way it runs, or that it runs at all outside your entries.`
      : `${f.label}: ${round(mh)}${u} on ${highs.length} good day(s) against ${round(ml)}${u} on ${lows.length} off day(s). The ${signed(round(gap))}${u} gap sits inside the ±${round(threshold)}${u} band your entries already bounce around, so it is the size of noise, and calling it anything more would be invention.`;

  return {
    ...read,
    gap: round(gap),
    scatter: round(pooled),
    seDiff: round(seDiff),
    threshold: round(threshold),
    verdict,
    sentence
  };
}

const round = (v: number): number => Math.round(v * 100) / 100;
const signed = (v: number): string => (v > 0 ? `+${v}` : String(v));

/** Which fields she has actually filled at least once — drives the honest strip caption. */
export function coverage(days: DayEntry[]): { key: string; label: string; short: string; unit: string; days: number }[] {
  return COVARIATE_FIELDS.map((f) => ({
    key: f.key,
    label: f.label,
    short: f.short,
    unit: f.unit,
    days: days.filter((d) => d.values[f.key] !== undefined).length
  }));
}
