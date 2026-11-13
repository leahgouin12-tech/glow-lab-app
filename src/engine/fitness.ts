/**
 * THE GLOW LAB — training digest arithmetic (spec Part 17, read-only read).
 *
 * The Fitness page can already write a session and draw a weekly grid. This
 * module is the other half: one place that says what her own logged rows add
 * up to over a window, and where those rows are thin. Every figure below is
 * arithmetic over `workoutSessions` rows she saved herself, bucketed with the
 * same `mondayOf` the page's grid uses and fitted with the house trend engine.
 *
 * What this module deliberately does not do:
 *
 *   1. it never invents a volume. `sessionVolume` is the page's own function
 *      (Σ reps × load over sets marked done) and is the only definition here;
 *   2. it never prints a unit a row does not carry — `volumeUnit` is 'kg' only
 *      when a logged set actually holds a numeric load, otherwise null;
 *   3. it never explains a gap. A session row carries a date and numbers, not a
 *      reason, so `gaps` reports distances and says nothing about causes;
 *   4. it never invents a target. Adherence is only computed when the active
 *      plan row carries `daysPerWeek`; otherwise the read reports the field it
 *      looked for and returns cadence without a denominator;
 *   5. it never recommends. Coverage answers "which of your exercises appear in
 *      your records", not "what you should train".
 *
 * Pure module: no React, no database reads, and no clock dependency except the
 * documented local-today fallback when no valid anchor is passed.
 */

import type { AnyRow } from '../db/schema';
import { dayIndex, daySpan, isoFromDayIndex, trend, trendByMetric, type TrendRead } from './trend';

/* ------------------------------------------------------------------ constants */

export const FITNESS_DIGEST_RULE_VERSION = 1;

/** Weeks in the window, oldest first. The page's grid shows the same twelve. */
export const DEFAULT_WINDOW_WEEKS = 12;

/** How many exercises the "most volume logged" list is cut to. */
export const DEFAULT_TOP_EXERCISES = 5;

/** The weekly fit is printed per four weeks so it reads against a 7-day cycle. */
export const WEEK_TREND_PER_DAYS = 28;

/** The metric label the weekly series is fitted under. */
export const WEEKLY_VOLUME_METRIC = 'Weekly logged volume';

/** Printed verbatim in the section header. The limits are stated, not hidden. */
export const DIGEST_LIMITS =
  'Twelve weeks, Monday to Sunday, read only from the session rows you logged. It reports the arithmetic of those rows: how many sessions, how much volume, how far apart the dates sit, which exercises appear and where the logging is thin. It makes no claim about your body, your health, or what you should do next, and it prescribes nothing.';

/** Printed with the gap read: a gap is a gap. */
export const GAP_NOT_EXPLAINED =
  'A gap is a gap. A session row carries a date and numbers, not a reason — illness, travel, a deliberate deload and a bad week are identical here, and this section does not guess which one it was. Nothing here is advice about training through anything.';

/** Printed when a plan carries no readable weekly target. */
export const NO_TARGET_TEXT =
  'No weekly target is computed, because there is no target on the row to compute against.';

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86400000;

/* ---------------------------------------------------------------------- dates */

function isoOfLocal(dt: Date): string {
  const y = dt.getFullYear();
  const m = `${dt.getMonth() + 1}`.padStart(2, '0');
  const d = `${dt.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function localToday(): string {
  return isoOfLocal(new Date());
}

/**
 * The Monday that starts an ISO week, in local calendar terms. Copied from the
 * Fitness page so the digest buckets land exactly where her weekly grid does;
 * the page now imports this instead of keeping its own copy.
 */
export function mondayOf(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const day = (dt.getDay() + 6) % 7;
  dt.setDate(dt.getDate() - day);
  const yy = dt.getFullYear();
  const mm = `${dt.getMonth() + 1}`.padStart(2, '0');
  const dd = `${dt.getDate()}`.padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/** Pure calendar shift on a `YYYY-MM-DD` string, returned unchanged when bad. */
export function shiftISO(iso: string, days: number): string {
  const idx = dayIndex(iso);
  return idx === null ? iso : isoFromDayIndex(idx + days);
}

/** The Sunday that closes a week given its Monday. */
export function sundayOf(weekMonday: string): string {
  return shiftISO(weekMonday, 6);
}

/* -------------------------------------------------------------------- numbers */

/** A number, or null. `''`/null/undefined/non-numeric never become 0 here. */
function toNum(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function isBlank(raw: unknown): boolean {
  return raw === null || raw === undefined || raw === '';
}

function roundTo(value: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

/** Thousands separators without a locale lookup, so the string is stable. */
function group(integral: string): string {
  const negative = integral.startsWith('-');
  const bare = negative ? integral.slice(1) : integral;
  const out = bare.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${out}`;
}

/**
 * The one formatter every figure in the digest goes through. A number that is
 * not finite is printed as an em dash rather than as NaN, and a unit is only
 * ever appended when the caller knows the rows carry it — pass `unit: null`
 * and nothing but the digit is printed.
 */
export function fmt(
  value: number | null | undefined,
  opts: { digits?: number; unit?: string | null; dash?: string } = {}
): string {
  const dash = opts.dash ?? '—';
  const n = toNum(value);
  if (n === null) return dash;
  const digits = Math.max(0, Math.round(opts.digits ?? 1));
  const fixed = roundTo(n, digits).toFixed(digits);
  const [integral, fraction] = fixed.split('.');
  const body = `${group(integral)}${fraction ? `.${fraction}` : ''}`;
  const unit = opts.unit && opts.unit.trim() ? opts.unit.trim() : '';
  return unit ? `${body} ${unit}` : body;
}

/* --------------------------------------------------------------------- volume */

export interface SetLike {
  reps?: unknown;
  kg?: unknown;
  rpe?: unknown;
  done?: unknown;
}

export interface EntryLike {
  exerciseId?: unknown;
  sets?: SetLike[] | null;
}

/**
 * Volume = Σ reps × load over the sets you marked done. The Fitness page's own
 * function, moved here so the grid, the stats strip and this digest cannot
 * drift into two definitions. A set with a blank reps or a blank load adds 0,
 * and is counted separately by the data-quality read rather than hidden.
 */
export function sessionVolume(entries: EntryLike[] | null | undefined): number {
  let total = 0;
  for (const e of entries ?? []) {
    for (const s of e?.sets ?? []) {
      if (!s || !s.done) continue;
      const part = (Number(isBlank(s.reps) ? 0 : s.reps) || 0) * (Number(isBlank(s.kg) ? 0 : s.kg) || 0);
      if (Number.isFinite(part)) total += part;
    }
  }
  return total;
}

/* ---------------------------------------------------------------- entry types */

export interface DigestWeek {
  /** Monday starting the bucket, `YYYY-MM-DD`. */
  weekOf: string;
  /** Sunday closing it. */
  endsOn: string;
  /** False for a week with no session row — printed as a blank, never a zero. */
  hasSession: boolean;
  /** True when the bucket sits entirely before the anchor day. */
  complete: boolean;
  sessions: number;
  /** Distinct dates with a session — what a `daysPerWeek` target is measured in. */
  days: number;
  volume: number;
  /** volume / sessions, null when the bucket holds no session. */
  perSession: number | null;
}

export interface DigestGap {
  days: number;
  from: string;
  to: string;
}

export interface DigestGaps {
  /** Sessions in the window carrying a usable date. */
  datedSessions: number;
  /** Distinct logged days in the window. */
  distinctDays: number;
  /** Longest stretch between two consecutive logged days inside the window. */
  longest: DigestGap | null;
  /** Distance from the last logged day in the window to the anchor day. */
  current: DigestGap | null;
  /** Mean of the inside-window distances, null when there is only one day. */
  averageDays: number | null;
  /**
   * Distance from the last session before the window to the first inside it.
   * Reported separately because the window edge would otherwise hide it.
   */
  boundary: DigestGap | null;
  /** The oldest logged day before the window, when one exists. */
  beforeWindow: string | null;
}

export interface AdherenceWeek {
  weekOf: string;
  days: number;
  target: number;
  hit: boolean;
  /** A week with no session row at all: still a miss against a target, said plainly. */
  logged: boolean;
}

export type AdherenceStatus = 'scored' | 'no-active-plan' | 'no-target' | 'no-complete-week';

export interface DigestAdherence {
  status: AdherenceStatus;
  /** True only when a target existed and complete weeks existed to score. */
  available: boolean;
  planId: string | null;
  planName: string | null;
  /** The row field the target was read from, so the UI can name it. */
  targetField: 'daysPerWeek' | null;
  target: number | null;
  activePlans: number;
  /** `split.length` on the plan row: days built, not days per week. Informational. */
  splitDays: number | null;
  /** `weeks` on the plan row: a length with no start date attached to it. */
  planWeeks: number | null;
  weeksScored: number;
  hitWeeks: number;
  missedWeeks: number;
  detail: AdherenceWeek[];
  /** Why a read is absent, or what it had to assume. Printed, never hidden. */
  note: string;
}

export interface LoggedExercise {
  id: string;
  name: string | null;
  pattern: string | null;
  sessions: number;
  sets: number;
  doneSets: number;
  volume: number;
}

export interface DigestCoverage {
  /** Library rows that are not soft-deleted. */
  libraryRows: number;
  /** Distinct exercise ids appearing in the window's sessions. */
  loggedIds: number;
  /** Of those, how many resolve to a library row. */
  resolvedIds: number;
  /** Sessions in the window with no exercise id on an entry. */
  entriesWithoutExercise: number;
  neverLogged: number;
  neverLoggedRows: { id: string; name: string; pattern: string | null }[];
  /** Logged ids with no library row behind them (deleted or hand-typed). */
  untracked: { id: string; sessions: number; volume: number }[];
  top: LoggedExercise[];
}

export interface DigestQuality {
  sessionsInWindow: number;
  /** Rows whose `doneOn` is missing or not a real date, dropped from the window. */
  rowsWithoutDate: number;
  /** Dated sessions older than the window. */
  olderThanWindow: number;
  /** Dated sessions after the window closes. */
  afterWindow: number;
  /** `rowsWithoutDate + olderThanWindow + afterWindow` — rows the read does not see. */
  rowsOutsideWindow: number;
  entries: number;
  /** Entries carrying no set rows at all. */
  entriesWithoutSets: number;
  sets: number;
  doneSets: number;
  /** Sets stored with `done: false` — planned, not performed, excluded from volume. */
  skippedSets: number;
  doneSetsMissingReps: number;
  doneSetsMissingLoad: number;
  doneSetsMissingBoth: number;
  /** Done sets whose product was not a finite number. */
  unusableSetValues: number;
  /** Sessions in the window whose volume is 0, whatever the reason. */
  zeroVolumeSessions: number;
  /** Sessions with no entry or no completed set — nothing to compute from. */
  sparseSessions: number;
  /** Sessions carrying a note, since a note is the only place a reason can live. */
  sessionsWithNote: number;
}

export interface FitnessDigest {
  rule: number;
  anchor: string;
  window: { weeks: number; from: string; to: string; lastCompleteWeek: string | null };
  /** True when the window holds no session row at all. */
  empty: boolean;
  /** 'kg' only when a logged set in the window actually carries a load. */
  volumeUnit: 'kg' | null;
  weeks: DigestWeek[];
  totals: {
    sessions: number;
    weeksWithSessions: number;
    volume: number;
    perSession: number | null;
    sessionsPerActiveWeek: number | null;
    /** First and last logged session dates across every dated row, window or not. */
    firstLogged: string | null;
    lastLogged: string | null;
  };
  trend: TrendRead;
  /** Weeks the weekly fit actually used (a week with no session is not a zero). */
  trendPoints: number;
  /** Complete weeks in the window, i.e. the ones the fit may use. */
  completeWeeks: number;
  gaps: DigestGaps;
  adherence: DigestAdherence;
  coverage: DigestCoverage;
  quality: DigestQuality;
}

export interface FitnessDigestInput {
  /** `workoutSessions` rows. */
  sessions?: AnyRow[];
  /** `exercises` rows — the catalogue the log is compared against. */
  exercises?: AnyRow[];
  /** `workoutPlans` rows. */
  plans?: AnyRow[];
  /** ISO day the window is anchored to. Defaults to local today. */
  today?: string;
  weeks?: number;
  topExercises?: number;
}

/* -------------------------------------------------------------------- scanning */

interface Scan {
  id: string;
  date: string;
  volume: number;
  entryCount: number;
  entriesWithoutSets: number;
  sets: number;
  doneSets: number;
  skippedSets: number;
  missingReps: number;
  missingLoad: number;
  missingBoth: number;
  unusable: number;
  loadSeen: boolean;
  perExercise: { id: string; volume: number; sets: number; doneSets: number }[];
  note: boolean;
}

function entriesOf(row: AnyRow): EntryLike[] {
  const raw = (row as Record<string, unknown>).entries;
  return Array.isArray(raw) ? (raw as EntryLike[]) : [];
}

function scanSession(row: AnyRow, index: number): Scan {
  const entries = entriesOf(row);
  const out: Scan = {
    id: String((row as Record<string, unknown>).id ?? `row-${index}`),
    date: String((row as Record<string, unknown>).doneOn ?? ''),
    volume: sessionVolume(entries),
    entryCount: entries.length,
    entriesWithoutSets: 0,
    sets: 0,
    doneSets: 0,
    skippedSets: 0,
    missingReps: 0,
    missingLoad: 0,
    missingBoth: 0,
    unusable: 0,
    loadSeen: false,
    perExercise: [],
    note: String((row as Record<string, unknown>).note ?? '').trim().length > 0
  };

  for (const entry of entries) {
    const rawSets = Array.isArray(entry?.sets) ? (entry.sets as SetLike[]) : [];
    if (!rawSets.length) out.entriesWithoutSets += 1;
    let exerciseVolume = 0;
    let exerciseSets = 0;
    let exerciseDone = 0;

    for (const set of rawSets) {
      out.sets += 1;
      exerciseSets += 1;
      if (!set || !set.done) {
        out.skippedSets += 1;
        continue;
      }
      out.doneSets += 1;
      exerciseDone += 1;

      const reps = toNum(set.reps);
      const kg = toNum(set.kg);
      if (reps === null) out.missingReps += 1;
      if (kg === null) out.missingLoad += 1;
      if (reps === null && kg === null) out.missingBoth += 1;
      if (kg !== null) out.loadSeen = true;
      if ((!isBlank(set.reps) && reps === null) || (!isBlank(set.kg) && kg === null)) out.unusable += 1;
      if (reps !== null && kg !== null) exerciseVolume += reps * kg;
    }

    const id = String(entry?.exerciseId ?? '').trim();
    out.perExercise.push({ id, volume: exerciseVolume, sets: exerciseSets, doneSets: exerciseDone });
  }

  return out;
}

/* --------------------------------------------------------------------- digest */

export function buildDigest(input: FitnessDigestInput = {}): FitnessDigest {
  const windowWeeks = Math.max(1, Math.round(input.weeks ?? DEFAULT_WINDOW_WEEKS));
  const topN = Math.max(1, Math.round(input.topExercises ?? DEFAULT_TOP_EXERCISES));
  const rawAnchor = typeof input.today === 'string' && ISO_RE.test(input.today) ? input.today : localToday();
  const anchor = rawAnchor;

  const startMonday = mondayOf(anchor);
  const from = shiftISO(startMonday, -(windowWeeks - 1) * 7);
  const to = shiftISO(from, windowWeeks * 7 - 1);

  const sessions = (input.sessions ?? []).filter((r) => r && !(r as Record<string, unknown>).deletedAt);

  /* ---- one pass over the rows: keep what is in the window, count what is not */
  const inWindow: Scan[] = [];
  let rowsWithoutDate = 0;
  let olderThanWindow = 0;
  let afterWindow = 0;
  let firstLogged: string | null = null;
  let lastLogged: string | null = null;
  let beforeWindow: string | null = null;

  const scans: Scan[] = [];
  for (const row of sessions) {
    const scan = scanSession(row as AnyRow, scans.length);
    const day = dayIndex(scan.date);
    if (day === null) {
      rowsWithoutDate += 1;
      continue;
    }
    scans.push(scan);
    if (!firstLogged || scan.date < firstLogged) firstLogged = scan.date;
    if (!lastLogged || scan.date > lastLogged) lastLogged = scan.date;
    if (scan.date < from) {
      olderThanWindow += 1;
      if (!beforeWindow || scan.date > beforeWindow) beforeWindow = scan.date;
      continue;
    }
    if (scan.date > to) {
      afterWindow += 1;
      continue;
    }
    inWindow.push(scan);
  }

  /* ---- week buckets: every week in the window exists, session or not */
  type Bucket = { sessions: number; volume: number; days: Set<string> };
  const buckets = new Map<string, Bucket>();
  for (let i = 0; i < windowWeeks; i += 1) {
    buckets.set(shiftISO(from, i * 7), { sessions: 0, volume: 0, days: new Set<string>() });
  }
  for (const scan of inWindow) {
    const key = mondayOf(scan.date);
    const bucket = buckets.get(key);
    if (!bucket) continue;
    bucket.sessions += 1;
    bucket.volume += scan.volume;
    bucket.days.add(scan.date);
  }

  let volumeUnit: 'kg' | null = null;
  for (const scan of inWindow) if (scan.loadSeen) volumeUnit = 'kg';

  const weeks: DigestWeek[] = [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([weekOf, b]) => {
      const endsOn = sundayOf(weekOf);
      return {
        weekOf,
        endsOn,
        hasSession: b.sessions > 0,
        complete: endsOn < anchor,
        sessions: b.sessions,
        days: b.days.size,
        volume: b.volume,
        perSession: b.sessions ? b.volume / b.sessions : null
      };
    });

  const totalVolume = weeks.reduce((s, w) => s + w.volume, 0);
  const totalSessions = weeks.reduce((s, w) => s + w.sessions, 0);
  const weeksWithSessions = weeks.filter((w) => w.hasSession).length;
  const completeWeeks = weeks.filter((w) => w.complete).length;

  /* ---- trend: only weeks that carry a session become points */
  const points = weeks
    .filter((w) => w.hasSession)
    .map((w) => ({
      on: w.weekOf,
      metric: WEEKLY_VOLUME_METRIC,
      value: w.volume,
      unit: volumeUnit ?? ''
    }));
  const reads = trendByMetric(points, { perDays: WEEK_TREND_PER_DAYS });
  const trendRead: TrendRead = {
    ...(reads[0] ?? trend([], { unit: volumeUnit ?? '', perDays: WEEK_TREND_PER_DAYS })),
    metric: WEEKLY_VOLUME_METRIC
  };

  /* ---- rest gaps over distinct logged days in the window */
  const days = [...new Set(inWindow.map((s) => s.date))].sort((a, b) => a.localeCompare(b));
  let longest: DigestGap | null = null;
  let gapSum = 0;
  let gapCount = 0;
  for (let i = 1; i < days.length; i += 1) {
    const between = daySpan(days[i - 1], days[i]);
    if (between === null) continue;
    gapSum += between;
    gapCount += 1;
    if (!longest || between > longest.days) longest = { days: between, from: days[i - 1], to: days[i] };
  }
  /** Clamped at 0: a row dated later in the current week leaves nothing "since". */
  const current: DigestGap | null = days.length
    ? { days: Math.max(0, daySpan(days[days.length - 1], anchor) ?? 0), from: days[days.length - 1], to: anchor }
    : null;
  let boundary: DigestGap | null = null;
  if (beforeWindow && days.length) {
    const across = daySpan(beforeWindow, days[0]);
    if (across !== null) boundary = { days: across, from: beforeWindow, to: days[0] };
  }
  const gaps: DigestGaps = {
    datedSessions: inWindow.length,
    distinctDays: days.length,
    longest,
    current,
    averageDays: gapCount ? gapSum / gapCount : null,
    boundary,
    beforeWindow
  };

  /* ---- adherence: only against a target the plan row actually carries */
  const plans = (input.plans ?? []).filter((p) => p && !(p as Record<string, unknown>).deletedAt);
  const activePlans = plans.filter((p) => Boolean((p as Record<string, unknown>).active));
  const scored = scoreAdherence(activePlans, weeks, anchor);

  /* ---- coverage: what appears in these rows vs. what the library holds */
  const coverage = scanCoverage(inWindow, input.exercises ?? [], topN);

  /* ---- data quality over the same rows */
  const quality: DigestQuality = {
    sessionsInWindow: inWindow.length,
    rowsWithoutDate,
    olderThanWindow,
    afterWindow,
    rowsOutsideWindow: rowsWithoutDate + olderThanWindow + afterWindow,
    entries: inWindow.reduce((s, x) => s + x.entryCount, 0),
    entriesWithoutSets: inWindow.reduce((s, x) => s + x.entriesWithoutSets, 0),
    sets: inWindow.reduce((s, x) => s + x.sets, 0),
    doneSets: inWindow.reduce((s, x) => s + x.doneSets, 0),
    skippedSets: inWindow.reduce((s, x) => s + x.skippedSets, 0),
    doneSetsMissingReps: inWindow.reduce((s, x) => s + x.missingReps, 0),
    doneSetsMissingLoad: inWindow.reduce((s, x) => s + x.missingLoad, 0),
    doneSetsMissingBoth: inWindow.reduce((s, x) => s + x.missingBoth, 0),
    unusableSetValues: inWindow.reduce((s, x) => s + x.unusable, 0),
    zeroVolumeSessions: inWindow.filter((x) => x.volume === 0).length,
    sparseSessions: inWindow.filter((x) => x.entryCount === 0 || x.doneSets === 0).length,
    sessionsWithNote: inWindow.filter((x) => x.note).length
  };

  return {
    rule: FITNESS_DIGEST_RULE_VERSION,
    anchor,
    window: {
      weeks: windowWeeks,
      from,
      to,
      lastCompleteWeek: weeks.filter((w) => w.complete).map((w) => w.weekOf).pop() ?? null
    },
    empty: inWindow.length === 0,
    volumeUnit,
    weeks,
    totals: {
      sessions: totalSessions,
      weeksWithSessions,
      volume: totalVolume,
      perSession: totalSessions ? totalVolume / totalSessions : null,
      sessionsPerActiveWeek: weeksWithSessions ? totalSessions / weeksWithSessions : null,
      firstLogged,
      lastLogged
    },
    trend: trendRead,
    trendPoints: points.length,
    completeWeeks,
    gaps,
    adherence: scored,
    coverage,
    quality
  };
}

/* ------------------------------------------------------------------ adherence */

function scoreAdherence(activePlans: AnyRow[], weeks: DigestWeek[], anchor: string): DigestAdherence {
  const blank: DigestAdherence = {
    status: 'no-active-plan',
    available: false,
    planId: null,
    planName: null,
    targetField: null,
    target: null,
    activePlans: activePlans.length,
    splitDays: null,
    planWeeks: null,
    weeksScored: 0,
    hitWeeks: 0,
    missedWeeks: 0,
    detail: [],
    note: 'No plan row is marked active, so there is no plan to measure against. Cadence without a target is shown above.'
  };
  if (!activePlans.length) return blank;

  /** The first active plan carrying a target wins; the count is reported either way. */
  const readTarget = (p: AnyRow): number | null => {
    const n = toNum((p as Record<string, unknown>).daysPerWeek);
    return n !== null && n > 0 ? Math.round(n) : null;
  };
  const plan = activePlans.find((p) => readTarget(p as AnyRow) !== null) ?? activePlans[0];
  const split = (plan as Record<string, unknown>).split;
  const meta = {
    planId: String((plan as Record<string, unknown>).id ?? '') || null,
    planName: String((plan as Record<string, unknown>).name ?? '').trim() || null,
    activePlans: activePlans.length,
    splitDays: Array.isArray(split) ? split.length : null,
    planWeeks: toNum((plan as Record<string, unknown>).weeks)
  };
  const target = readTarget(plan as AnyRow);

  if (target === null) {
    const raw = (plan as Record<string, unknown>).daysPerWeek;
    return {
      ...blank,
      ...meta,
      status: 'no-target',
      note:
        `The active plan row carries no weekly target: its daysPerWeek field is ${
          isBlank(raw) ? 'empty' : `stored as ${fmt(toNum(raw), { digits: 0 })}`
        }. ${NO_TARGET_TEXT}` +
        (meta.splitDays !== null
          ? ` The row also lists ${meta.splitDays} day(s) in its split — a split is the shape of a cycle, not a weekly target, so nothing is derived from it.`
          : '')
    };
  }

  const scorable = weeks.filter((w) => w.complete);
  if (!scorable.length) {
    return {
      ...blank,
      ...meta,
      target,
      targetField: 'daysPerWeek',
      status: 'no-complete-week',
      note: `The plan's daysPerWeek is ${target}, but this window holds no complete week to score${
        anchor ? ` (${anchor} falls inside the first week shown)` : ''
      }. Nothing is counted for or against.`
    };
  }

  const detail: AdherenceWeek[] = scorable.map((w) => ({
    weekOf: w.weekOf,
    days: w.days,
    target,
    hit: w.days >= target,
    logged: w.hasSession
  }));
  const hitWeeks = detail.filter((d) => d.hit).length;

  return {
    status: 'scored',
    available: true,
    targetField: 'daysPerWeek',
    target,
    ...meta,
    weeksScored: detail.length,
    hitWeeks,
    missedWeeks: detail.length - hitWeeks,
    detail,
    note:
      `Measured on the plan row's own daysPerWeek: ${target} — a week hits when ${target} distinct ` +
      `date(s) carry a session that week. The current week (${weeks[weeks.length - 1]?.weekOf ?? '—'}) is excluded as ` +
      `partial. The row carries weeks: ${fmt(meta.planWeeks, { digits: 0 })} as a length but no start date, so every ` +
      'complete week in the window is scored against the same target; if the plan was not running the whole window, the ' +
      'missed count includes weeks it never covered.'
  };
}

/* ------------------------------------------------------------------- coverage */

function scanCoverage(scans: Scan[], exercises: AnyRow[], topN: number): DigestCoverage {
  const library = new Map<string, { name: string; pattern: string | null }>();
  for (const e of exercises ?? []) {
    if (!e || (e as Record<string, unknown>).deletedAt) continue;
    const id = String((e as Record<string, unknown>).id ?? '').trim();
    if (!id) continue;
    const rawPattern = String((e as Record<string, unknown>).pattern ?? '').trim();
    library.set(id, {
      name: String((e as Record<string, unknown>).name ?? '').trim() || '(unnamed row)',
      pattern: rawPattern || null
    });
  }

  type Agg = { sessions: number; sets: number; doneSets: number; volume: number };
  const agg = new Map<string, Agg>();
  let entriesWithoutExercise = 0;

  for (const scan of scans) {
    const seenThisSession = new Set<string>();
    for (const entry of scan.perExercise) {
      if (!entry.id) {
        entriesWithoutExercise += 1;
        continue;
      }
      const cur = agg.get(entry.id) ?? { sessions: 0, sets: 0, doneSets: 0, volume: 0 };
      cur.sets += entry.sets;
      cur.doneSets += entry.doneSets;
      cur.volume += entry.volume;
      if (!seenThisSession.has(entry.id)) {
        cur.sessions += 1;
        seenThisSession.add(entry.id);
      }
      agg.set(entry.id, cur);
    }
  }

  const rows: LoggedExercise[] = [...agg.entries()]
    .map(([id, v]) => ({
      id,
      name: library.get(id)?.name ?? null,
      pattern: library.get(id)?.pattern ?? null,
      sessions: v.sessions,
      sets: v.sets,
      doneSets: v.doneSets,
      volume: v.volume
    }))
    .sort((a, b) => b.volume - a.volume || b.sessions - a.sessions || String(a.name ?? a.id).localeCompare(String(b.name ?? b.id)));

  const neverLoggedRows = [...library.entries()]
    .filter(([id]) => !agg.has(id))
    .map(([id, v]) => ({ id, name: v.name, pattern: v.pattern }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    libraryRows: library.size,
    loggedIds: agg.size,
    resolvedIds: rows.filter((r) => r.name !== null).length,
    entriesWithoutExercise,
    neverLogged: neverLoggedRows.length,
    neverLoggedRows,
    untracked: rows
      .filter((r) => r.name === null)
      .map((r) => ({ id: r.id, sessions: r.sessions, volume: r.volume }))
      .sort((a, b) => b.volume - a.volume),
    top: rows.slice(0, topN)
  };
}
