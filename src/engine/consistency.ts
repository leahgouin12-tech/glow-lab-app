/**
 * THE GLOW LAB — weekly adherence (src/engine/consistency.ts).
 *
 * The one honest question this app could not answer: did the user actually do
 * the thing this week, and which item is slipping. Every number below is
 * arithmetic over rows the user logged, and every denominator travels with the
 * number it divides. There is no score here that is not literally "occurrences
 * logged over occurrences scheduled", no smoothing, no projection and no
 * invented streak — where a denominator is zero the result is an explicit
 * `nothing-scheduled` shape, never 0% and never 100%.
 *
 * The optional `derailments` input (see `engine/derailment.ts`) is an
 * annotation only: it marks which misses she has written about, and it moves no
 * count, no ratio and no streak on this card — a note that a day was lost to
 * illness is not evidence the thing was done.
 *
 * Pure module: no React, no database reads, and no clock dependency except the
 * documented local-today fallback when an invalid anchor is passed.
 */

import type { AnyRow } from '../db/schema';
import {
  DERAILMENT_RULE,
  attach,
  readLineFromRecords,
  liveRecords,
  recordsAt,
  tallyRecords,
  followUpsFromRecords,
  type DerailmentRecord,
  type DerailmentLookup,
  type FollowUpItem,
  type SchedItem,
  type TriggerTally
} from './derailment';

/* ------------------------------------------------------------------ dates */

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86400000;
const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Whole UTC days for a `YYYY-MM-DD` string; NaN when it is not a plain date. */
function dayIndex(iso: unknown): number {
  if (typeof iso !== 'string' || !ISO_RE.test(iso)) return NaN;
  const [y, m, d] = iso.split('-').map(Number);
  const idx = Math.floor(Date.UTC(y, m - 1, d) / DAY_MS);
  return Number.isFinite(idx) ? idx : NaN;
}

function isoFromDayIndex(idx: number): string {
  const dt = new Date(idx * DAY_MS);
  const y = dt.getUTCFullYear();
  const m = `${dt.getUTCMonth() + 1}`.padStart(2, '0');
  const d = `${dt.getUTCDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function isoOfLocal(dt: Date): string {
  const y = dt.getFullYear();
  const m = `${dt.getMonth() + 1}`.padStart(2, '0');
  const d = `${dt.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Calendar shift — never a millisecond multiplication on a local Date. */
export function shiftISO(iso: string, days: number): string {
  const idx = dayIndex(iso);
  return Number.isNaN(idx) ? iso : isoFromDayIndex(idx + days);
}

/** 0 = Sunday, the same reading recommendations.ts uses for weekday matching. */
function weekdayIndex(iso: string): number {
  const idx = dayIndex(iso);
  return Number.isNaN(idx) ? -1 : new Date(idx * DAY_MS).getUTCDay();
}

function localToday(): string {
  return isoOfLocal(new Date());
}

/** Local calendar date of an epoch-ms stamp such as a row's `createdAt`. */
function epochToISO(ms: unknown): string {
  const n = Number(ms);
  return Number.isFinite(n) && n > 0 ? isoOfLocal(new Date(n)) : '';
}

/**
 * The seven `YYYY-MM-DD` strings of the Monday-start week holding `anchorISO`.
 * A Sunday anchor rolls back to the Monday six days earlier, so month and year
 * boundaries shift cleanly.
 */
export function weekBounds(anchorISO: string): string[] {
  const anchor = Number.isNaN(dayIndex(anchorISO)) ? localToday() : anchorISO;
  const start = shiftISO(anchor, -((weekdayIndex(anchor) + 6) % 7));
  return [0, 1, 2, 3, 4, 5, 6].map((i) => shiftISO(start, i));
}

/* ------------------------------------------------------------------- types */

export interface ConsistencyInput {
  routines: AnyRow[];
  routineLogs: AnyRow[];
  plans: AnyRow[];
  sessions: AnyRow[];
  media: AnyRow[];
  /**
   * Optional derailment records. They annotate the digest and never feed it:
   * no count, ratio or streak is read from this field. Pass it (even empty) and
   * the digest gains the one-line statement of that rule in `rules`; leave it
   * out and the digest is exactly what this module produced before the table
   * existed.
   */
  derailments?: AnyRow[];
}

export type DayState = 'done' | 'partial' | 'nothing' | 'unscheduled';
export type RatioState = 'scored' | 'nothing-scheduled';
export type Cadence = 'daily' | 'weekly' | 'monthly' | 'once';

/**
 * The pair the UI prints. `pct` is null exactly when `scheduled` is 0, so a
 * window with no schedule can never read as 0% or as 100%.
 */
export interface Ratio {
  n: number;
  scheduled: number;
  pct: number | null;
  ratio: string;
  state: RatioState;
  /** The denominator rule, in words, travelling with the number. */
  rule: string;
  /** Only set on `nothing-scheduled` — why nothing was due. */
  reason?: string;
}

export interface DayCell {
  date: string;
  weekday: string;
  dayNum: number;
  scheduled: number;
  full: number;
  partial: number;
  missed: number;
  logged: number;
  state: DayState;
  isToday: boolean;
  isFuture: boolean;
  /**
   * A live derailment record names this date. Annotation only — `scheduled`,
   * `logged` and `missed` above are computed before it is read and do not move
   * when it is present.
   */
  explained: boolean;
}

export interface Streak {
  current: number;
  best: number;
  currentEnd: string | null;
  bestFrom: string | null;
  bestTo: string | null;
  loggedDates: number;
}

export interface RoutineAdherence extends Ratio {
  kind: 'routine';
  id: string;
  label: string;
  domain: string;
  fullDays: number;
  partialDays: number;
  missedDays: number;
  /** The window dates this item was scheduled and not logged — where a record can be attached. */
  missedDates: string[];
  streak: Streak;
  /** Logs in the window that itemised steps, vs logs that left `completedSteps` empty. */
  stepsRecorded: number;
  stepsBlank: number;
  /** One of this routine's missed dates carries a derailment record. */
  explained: boolean;
}

export interface ActionAdherence extends Ratio {
  kind: 'plan-action';
  id: string;
  label: string;
  planId: string;
  planName: string;
  cadence: Cadence;
  doneDates: string[];
  /** Scheduled occurrences in the window with no date in `doneDates`. */
  missedDates: string[];
  /** One of this action's missed occurrences carries a derailment record. */
  explained: boolean;
}

export interface SkippedStep {
  stepId: string;
  label: string;
  routineId: string;
  routineLabel: string;
  skipped: number;
  opportunities: number;
  ratio: string;
  pct: number;
}

export interface PhotoCadence {
  state: RatioState;
  shots: number;
  baselines: number;
  firstOn: string | null;
  lastOn: string | null;
  spanDays: number | null;
  gapsMeasured: number;
  everyDays: number | null;
  sinceLastDays: number | null;
  rule: string;
  reason: string;
}

export interface WorkoutCount {
  sessions: number;
  dates: string[];
  lastOn: string | null;
  sinceLastDays: number | null;
  state: RatioState;
  reason: string;
}

export interface Gap {
  kind: 'routine' | 'plan-action';
  id: string;
  label: string;
  scheduled: number;
  detail: string;
}

export interface Slipping extends Ratio {
  kind: 'routine' | 'plan-action';
  id: string;
  label: string;
  missed: number;
}

/**
 * The derailment annotation carried beside the counts. Every field here is a
 * count *of records*, never a restatement of a count of logs: adding, editing
 * or resolving a record moves nothing in `cells`, `routines`, `actions`,
 * `streaks`, `gaps`, `slipping` or `totals`.
 */
export interface ConsistencyDerailments {
  /** Live records on this device, whatever date they name. */
  recorded: number;
  /** Live records whose `on` falls inside this window. */
  windowRecords: number;
  openRecords: number;
  resolvedRecords: number;
  /** Window days that had a miss and carry a record. */
  explainedDays: number;
  /** Routine and plan-action rows in this window whose misses carry a record. */
  explainedMisses: number;
  /** In-window records that line up with nothing this digest counted — a name, a date, or both. */
  unmatchedRecords: number;
  /** Records whose `refId` names a routine, plan or action not in the rows this digest was given. */
  danglingRefs: number;
  /** Every live record, most recent date first, as the card lists them. */
  items: DerailmentRecord[];
  byTrigger: TriggerTally[];
  followUps: FollowUpItem[];
  readLine: string;
  rule: string;
}

export interface ConsistencyDigest {
  week: {
    days: string[];
    start: string;
    end: string;
    today: string;
    elapsedDays: number;
    futureDays: number;
  };
  cells: DayCell[];
  routines: RoutineAdherence[];
  actions: ActionAdherence[];
  mostSkippedStep: SkippedStep | null;
  stepEvidence: { itemisedLogs: number; blankLogs: number; routinesWithSteps: number };
  streaks: { anyRoutine: Streak; longestCurrent: { label: string; streak: Streak } | null };
  photos: PhotoCadence;
  workouts: WorkoutCount;
  gaps: Gap[];
  slipping: Slipping | null;
  totals: Ratio & { missed: number };
  /** Counts of the derailment records beside those totals — never a change to them. */
  derailments: ConsistencyDerailments;
  /** Anything logged or photographed at all — drives the honest empty state. */
  hasActivity: boolean;
  hasSchedule: boolean;
  rules: { label: string; value: string }[];
}

/* ----------------------------------------------------------------- helpers */

const asRows = (v: unknown): AnyRow[] => (Array.isArray(v) ? (v as AnyRow[]) : []);
const asStr = (v: unknown): string => (typeof v === 'string' ? v : '');
const asNum = (v: unknown, fallback = 0): number => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const round1 = (v: number): number => Math.round(v * 10) / 10;

function ratio(n: number, scheduled: number, rule: string, reason?: string): Ratio {
  if (scheduled <= 0) {
    return { n, scheduled: 0, pct: null, ratio: `${n}/0`, state: 'nothing-scheduled', rule, reason };
  }
  return { n, scheduled, pct: Math.round((n / scheduled) * 100), ratio: `${n}/${scheduled}`, state: 'scored', rule };
}

/** Consecutive-date streaks from a set of logged dates. */
export function streaks(dates: (string | null | undefined)[], today: string): Streak {
  const idx = Array.from(new Set(dates.map((d) => dayIndex(d)).filter((i): i is number => Number.isFinite(i)))).sort(
    (a, b) => a - b
  );
  if (idx.length === 0) {
    return { current: 0, best: 0, currentEnd: null, bestFrom: null, bestTo: null, loggedDates: 0 };
  }
  let best = 1;
  let bestFrom = idx[0];
  let bestTo = idx[0];
  let runStart = idx[0];
  let run = 1;
  for (let i = 1; i < idx.length; i += 1) {
    if (idx[i] === idx[i - 1] + 1) {
      run += 1;
    } else {
      run = 1;
      runStart = idx[i];
    }
    if (run > best) {
      best = run;
      bestFrom = runStart;
      bestTo = idx[i];
    }
  }
  const last = idx[idx.length - 1];
  const todayIdx = dayIndex(today);
  let current = 0;
  if (Number.isFinite(todayIdx) && (last === todayIdx || last === todayIdx - 1)) {
    current = 1;
    for (let i = idx.length - 1; i > 0; i -= 1) {
      if (idx[i - 1] === idx[i] - 1) current += 1;
      else break;
    }
  }
  return {
    current,
    best,
    currentEnd: current > 0 ? isoFromDayIndex(last) : null,
    bestFrom: isoFromDayIndex(bestFrom),
    bestTo: isoFromDayIndex(bestTo),
    loggedDates: idx.length
  };
}

/**
 * A log is partial only when the user itemised steps and left some out. A log
 * with an empty `completedSteps` is the day check on the dashboard, which
 * records the routine rather than its steps, so it counts as done.
 */
function logCompleteness(log: AnyRow, stepCount: number): 'full' | 'partial' {
  if (stepCount <= 0) return 'full';
  const done = asRows(log.completedSteps).map((s) => asStr(s));
  if (done.length === 0) return 'full';
  return done.length >= stepCount ? 'full' : 'partial';
}

function stepsOf(routine: AnyRow): { id: string; label: string }[] {
  return asRows(routine.steps)
    .map((s, i) => ({ id: asStr(s.id) || `step-${i}`, label: asStr(s.label) || `Step ${i + 1}` }))
    .filter((s, i, all) => all.findIndex((x) => x.id === s.id) === i);
}

const WEEKLY_FALLBACK_WEEKDAY = 1;

/** Is this action scheduled on this date? Same cadence reading as todayFocus. */
function actionDueOn(action: AnyRow, plan: AnyRow, day: string, today: string): boolean {
  const dayIdx = dayIndex(day);
  const todayIdx = dayIndex(today);
  if (Number.isNaN(dayIdx) || Number.isNaN(todayIdx)) return false;
  if (dayIdx > todayIdx) return false;

  const startIdx = dayIndex(asStr(plan.startOn));
  if (Number.isFinite(startIdx)) {
    if (dayIdx < startIdx) return false;
    const weeks = asRows(action.weeks)
      .map((w) => Number(w))
      .filter((w) => Number.isFinite(w));
    if (weeks.length > 0 && !weeks.includes(Math.floor((dayIdx - startIdx) / 7) + 1)) return false;
  }

  const cadence = asStr(action.cadence) as Cadence;
  if (cadence === 'daily') return true;
  if (cadence === 'weekly') {
    const wanted = asNum((action.data as Record<string, unknown> | undefined)?.weekday ?? action.weekday, WEEKLY_FALLBACK_WEEKDAY);
    return weekdayIndex(day) === wanted;
  }
  if (cadence === 'monthly') return day.slice(8, 10) === '01';
  if (cadence === 'once') {
    const anchor = Number.isFinite(startIdx) ? asStr(plan.startOn) : '';
    return day !== '' && day === shiftISO(anchor, asNum(action.dayOffset, 0));
  }
  return false;
}

const ROUTINE_RULE =
  'Denominator: elapsed days of this Monday-to-Sunday window on which the routine was active and already created. Future days are not scheduled.';
const ACTION_RULE =
  'Denominator: occurrences the plan schedules in this window from its own cadence — daily is every elapsed day, weekly is the matching weekday, monthly is the 1st, once is its due date. Numerator: dates in that action’s doneOn list inside the window.';
const PHOTO_RULE =
  'Every N days = (last shot date − first shot date) ÷ (dated progress shots − 1). The denominator is the number of gaps measured, so two shots give one gap.';

/* ------------------------------------------------------------------ digest */

export function digest(input: ConsistencyInput, opts: { today?: string } = {}): ConsistencyDigest {
  const today = Number.isNaN(dayIndex(opts.today ?? '')) ? localToday() : String(opts.today);
  const days = weekBounds(today);
  const todayIdx = dayIndex(today);
  const windowDates = new Set(days);

  const activeRoutines = asRows(input.routines).filter((r) => r.active !== false);
  const logs = asRows(input.routineLogs).filter((l) => Number.isFinite(dayIndex(l.doneOn)));
  const plans = asRows(input.plans).filter((p) => asStr(p.status) === 'active');
  const sessions = asRows(input.sessions);
  const media = asRows(input.media);

  /* ------------------------------------------------------ derailment input */
  /**
   * Read once, and used only as an annotation. Nothing below takes a number
   * from it: cells, ratios, streaks and totals are computed from logs and
   * actions exactly as they were before this field existed, and `explained` is
   * a flag printed beside them.
   */
  const derailmentRows = asRows(input.derailments);
  const derailments = liveRecords(derailmentRows);
  const derailmentDays = new Set(derailments.map((r) => r.on));

  const stepCount = new Map<string, number>();
  const stepList = new Map<string, { id: string; label: string }[]>();
  for (const r of activeRoutines) {
    const id = asStr(r.id);
    const steps = stepsOf(r);
    stepCount.set(id, steps.length);
    stepList.set(id, steps);
  }

  /** `routineId|date` -> completeness; the fullest log wins when a day is logged twice. */
  const logByDay = new Map<string, 'full' | 'partial'>();
  const logsByRoutine = new Map<string, AnyRow[]>();
  for (const log of logs) {
    const rid = asStr(log.routineId);
    if (!stepCount.has(rid)) continue;
    const key = `${rid}|${asStr(log.doneOn)}`;
    const state = logCompleteness(log, stepCount.get(rid) ?? 0);
    const prev = logByDay.get(key);
    if (prev !== 'full' && state === 'full') logByDay.set(key, 'full');
    else if (prev === undefined) logByDay.set(key, state);
    const list = logsByRoutine.get(rid) ?? [];
    list.push(log);
    logsByRoutine.set(rid, list);
  }

  const actionList = plans.flatMap((p) => asRows(p.actions).map((a) => ({ action: a, plan: p })));

  /** A routine is scheduled on a window day only from its own creation date on. */
  const routineDue = (routine: AnyRow, day: string): boolean => {
    const idx = dayIndex(day);
    if (idx > todayIdx) return false;
    const createdIdx = dayIndex(epochToISO(routine.createdAt));
    return !(Number.isFinite(createdIdx) && createdIdx > idx);
  };

  /* ------------------------------------------------------------- day cells */
  const cells: DayCell[] = days.map((date) => {
    const isFuture = dayIndex(date) > todayIdx;
    let scheduled = 0;
    if (!isFuture) for (const r of activeRoutines) if (routineDue(r, date)) scheduled += 1;
    for (const { action, plan } of actionList) if (actionDueOn(action, plan, date, today)) scheduled += 1;

    let logged = 0;
    let partial = 0;
    for (const r of activeRoutines) {
      const state = logByDay.get(`${asStr(r.id)}|${date}`);
      if (!state) continue;
      logged += 1;
      if (state === 'partial') partial += 1;
    }
    for (const { action } of actionList) {
      if (asRows(action.doneOn).map((d) => asStr(d)).includes(date)) logged += 1;
    }

    const full = Math.max(0, logged - partial);
    const missed = isFuture ? 0 : Math.max(0, scheduled - logged);
    const state: DayState =
      isFuture || (scheduled === 0 && logged === 0)
        ? 'unscheduled'
        : logged === 0
          ? 'nothing'
          : partial > 0 || full < scheduled
            ? 'partial'
            : 'done';

    return {
      date,
      weekday: WEEKDAY_LABELS[weekdayIndex(date)],
      dayNum: Number(date.slice(8, 10)),
      scheduled,
      full,
      partial,
      missed,
      logged,
      state,
      isToday: date === today,
      isFuture,
      explained: derailmentDays.has(date)
    };
  });

  /* ------------------------------------------------------- routine rates */
  const routinesOut: RoutineAdherence[] = activeRoutines.map((r) => {
    const id = asStr(r.id);
    const dueDates = days.filter((d) => routineDue(r, d));
    const scheduled = dueDates.length;

    let fullDays = 0;
    let partialDays = 0;
    const missedDates: string[] = [];
    for (const date of dueDates) {
      const state = logByDay.get(`${id}|${date}`);
      if (!state) {
        missedDates.push(date);
        continue;
      }
      if (state === 'full') fullDays += 1;
      else partialDays += 1;
    }

    let stepsRecorded = 0;
    let stepsBlank = 0;
    for (const log of logsByRoutine.get(id) ?? []) {
      if (!windowDates.has(asStr(log.doneOn))) continue;
      if (asRows(log.completedSteps).length > 0) stepsRecorded += 1;
      else stepsBlank += 1;
    }

    const n = fullDays + partialDays;
    return {
      ...ratio(n, scheduled, ROUTINE_RULE, 'Created after this window closed, or every day of it is still ahead of today.'),
      kind: 'routine',
      id,
      label: asStr(r.name) || 'Untitled routine',
      domain: asStr(r.domain) || 'routine',
      fullDays,
      partialDays,
      missedDays: Math.max(0, scheduled - n),
      missedDates,
      streak: streaks((logsByRoutine.get(id) ?? []).map((l) => asStr(l.doneOn)), today),
      stepsRecorded,
      stepsBlank,
      explained: recordsAt(derailments, { kind: 'routine', refId: id, dates: missedDates }).length > 0
    };
  });

  /* --------------------------------------------------------- action rates */
  const actionsOut: ActionAdherence[] = actionList.map(({ action, plan }) => {
    const dueDates = days.filter((d) => actionDueOn(action, plan, d, today));
    const scheduled = dueDates.length;
    const doneDates = Array.from(
      new Set(
        asRows(action.doneOn)
          .map((d) => asStr(d))
          .filter((d) => Number.isFinite(dayIndex(d)) && windowDates.has(d))
      )
    ).sort();
    const doneSet = new Set(doneDates);
    const missedDates = dueDates.filter((d) => !doneSet.has(d));
    const cadence = (asStr(action.cadence) || 'daily') as Cadence;
    return {
      ...ratio(
        doneDates.length,
        scheduled,
        ACTION_RULE,
        `Cadence “${cadence}” puts no occurrence in these seven days, or the plan has not started yet.`
      ),
      kind: 'plan-action',
      id: asStr(action.id),
      label: asStr(action.label) || 'Untitled action',
      planId: asStr(plan.id),
      planName: asStr(plan.name) || 'Untitled plan',
      cadence,
      doneDates,
      missedDates,
      explained: recordsAt(derailments, { kind: 'action', refId: asStr(action.id), dates: missedDates }).length > 0
    };
  });

  /* ------------------------------------------------------- skipped steps */
  let mostSkippedStep: SkippedStep | null = null;
  let itemisedLogs = 0;
  let blankLogs = 0;
  let routinesWithSteps = 0;
  for (const r of activeRoutines) {
    const id = asStr(r.id);
    const steps = stepList.get(id) ?? [];
    if (steps.length === 0) continue;
    routinesWithSteps += 1;
    const inWindow = (logsByRoutine.get(id) ?? []).filter((l) => windowDates.has(asStr(l.doneOn)));
    const itemised = inWindow.filter((l) => asRows(l.completedSteps).length > 0);
    itemisedLogs += itemised.length;
    blankLogs += inWindow.length - itemised.length;
    for (const step of steps) {
      let skipped = 0;
      for (const log of itemised) {
        if (!asRows(log.completedSteps).map((s) => asStr(s)).includes(step.id)) skipped += 1;
      }
      if (itemised.length === 0 || skipped === 0) continue;
      const candidate: SkippedStep = {
        stepId: step.id,
        label: step.label,
        routineId: id,
        routineLabel: asStr(r.name) || 'Untitled routine',
        skipped,
        opportunities: itemised.length,
        ratio: `${skipped}/${itemised.length}`,
        pct: Math.round((skipped / itemised.length) * 100)
      };
      if (
        !mostSkippedStep ||
        candidate.skipped > mostSkippedStep.skipped ||
        (candidate.skipped === mostSkippedStep.skipped && candidate.pct > mostSkippedStep.pct)
      ) {
        mostSkippedStep = candidate;
      }
    }
  }

  /* -------------------------------------------------------------- streaks */
  const anyRoutine = streaks(logs.map((l) => asStr(l.doneOn)), today);
  const longestCurrent = routinesOut
    .filter((r) => r.streak.current > 0)
    .sort((a, b) => b.streak.current - a.streak.current || a.label.localeCompare(b.label))[0];
  const streaksOut: ConsistencyDigest['streaks'] = {
    anyRoutine,
    longestCurrent: longestCurrent ? { label: longestCurrent.label, streak: longestCurrent.streak } : null
  };

  /* --------------------------------------------------------------- photos */
  const shotDates = Array.from(
    new Set(
      media
        .filter((m) => asStr(m.kind) === 'progress')
        .map((m) => asStr(m.takenOn))
        .filter((d) => Number.isFinite(dayIndex(d)))
    )
  ).sort();
  const baselines = media.filter((m) => asStr(m.kind) === 'baseline' && Number.isFinite(dayIndex(m.takenOn)));
  const lastOn = shotDates.length ? shotDates[shotDates.length - 1] : null;
  const sinceLastDays = lastOn ? todayIdx - dayIndex(lastOn) : null;
  const firstIdx = shotDates.length ? dayIndex(shotDates[0]) : NaN;
  const lastIdx = shotDates.length ? dayIndex(shotDates[shotDates.length - 1]) : NaN;
  const spanDays = shotDates.length >= 2 ? lastIdx - firstIdx : null;
  const gapsMeasured = Math.max(0, shotDates.length - 1);

  const photos: PhotoCadence =
    shotDates.length >= 2
      ? {
          state: 'scored',
          shots: shotDates.length,
          baselines: baselines.length,
          firstOn: shotDates[0],
          lastOn,
          spanDays,
          gapsMeasured,
          everyDays: round1((spanDays ?? 0) / gapsMeasured),
          sinceLastDays,
          rule: PHOTO_RULE,
          reason: ''
        }
      : {
          state: 'nothing-scheduled',
          shots: shotDates.length,
          baselines: baselines.length,
          firstOn: shotDates[0] ?? null,
          lastOn,
          spanDays: null,
          gapsMeasured,
          everyDays: null,
          sinceLastDays,
          rule: PHOTO_RULE,
          reason:
            shotDates.length === 0
              ? 'No dated progress shots. A cadence needs two points and this module will not invent one.'
              : 'One dated progress shot so far — a gap needs a second point.'
        };

  /* ------------------------------------------------------------- workouts */
  const sessionDates = Array.from(
    new Set(sessions.map((s) => asStr(s.doneOn)).filter((d) => Number.isFinite(dayIndex(d))))
  ).sort();
  const elapsedSessions = sessionDates.filter((d) => dayIndex(d) <= todayIdx);
  const lastSession = elapsedSessions.length ? elapsedSessions[elapsedSessions.length - 1] : null;
  const workouts: WorkoutCount = {
    sessions: sessionDates.length,
    dates: elapsedSessions.filter((d) => windowDates.has(d)),
    lastOn: lastSession,
    sinceLastDays: lastSession ? todayIdx - dayIndex(lastSession) : null,
    state: 'nothing-scheduled',
    reason: 'Sessions are counted, not scored: a weekly workout target is not part of what this digest is given, so none is printed.'
  };

  /* ---------------------------------------------------------- gaps & slips */
  const gaps: Gap[] = [
    ...routinesOut
      .filter((r) => r.state === 'scored' && r.n === 0)
      .map((r) => ({
        kind: 'routine' as const,
        id: r.id,
        label: r.label,
        scheduled: r.scheduled,
        detail: `${r.label} (${r.domain}) — scheduled ${r.scheduled} day${r.scheduled === 1 ? '' : 's'} in this window, logged 0.`
      })),
    ...actionsOut
      .filter((a) => a.state === 'scored' && a.n === 0)
      .map((a) => ({
        kind: 'plan-action' as const,
        id: a.id,
        label: a.label,
        scheduled: a.scheduled,
        detail: `${a.label} — scheduled ${a.scheduled}× in this window under “${a.cadence}”, logged 0.`
      }))
  ].sort((a, b) => b.scheduled - a.scheduled || a.label.localeCompare(b.label));

  const scored = [...routinesOut, ...actionsOut].filter((i): i is RoutineAdherence | ActionAdherence => i.state === 'scored');
  const slipping: Slipping | null = scored.length
    ? scored
        .map((i) => ({
          kind: i.kind,
          id: i.id,
          label: i.label,
          n: i.n,
          scheduled: i.scheduled,
          pct: i.pct,
          ratio: i.ratio,
          state: i.state,
          rule: i.rule,
          missed: i.kind === 'routine' ? i.missedDays : i.scheduled - i.n
        }))
        .sort((a, b) => (a.pct ?? 0) - (b.pct ?? 0) || b.missed - a.missed || a.label.localeCompare(b.label))[0]
    : null;

  const scheduledTotal = cells.reduce((sum, c) => sum + c.scheduled, 0);
  const loggedTotal = cells.reduce((sum, c) => sum + c.logged, 0);
  const missedTotal = cells.reduce((sum, c) => sum + c.missed, 0);
  const totals = {
    ...ratio(
      loggedTotal,
      scheduledTotal,
      'Denominator: occurrences your own rows schedule in this window — active-routine days plus plan-action occurrences, future days excluded. Numerator: occurrences logged.',
      'Nothing is scheduled in this window: no active routine and no plan action falls in these seven days.'
    ),
    missed: missedTotal
  };

  const hasActivity =
    loggedTotal > 0 || logs.length > 0 || sessionDates.length > 0 || shotDates.length > 0 || baselines.length > 0;

  /* ------------------------------------------------------- derailment read */
  /**
   * The scheduled keys a record could attach to: every window day (a `general`
   * record explains a whole day), every missed routine date, every missed
   * action occurrence, and every plan that has a missed occurrence in it.
   */
  const planMisses = new Map<string, string[]>();
  for (const a of actionsOut) {
    if (a.missedDates.length === 0) continue;
    const list = planMisses.get(a.planId) ?? [];
    for (const date of a.missedDates) if (!list.includes(date)) list.push(date);
    planMisses.set(a.planId, list);
  }
  const derailKeys: SchedItem[] = [
    ...days.map((date): SchedItem => ({ on: date, kind: 'general', refId: null })),
    ...routinesOut.flatMap((r) => r.missedDates.map((date): SchedItem => ({ on: date, kind: 'routine', refId: r.id }))),
    ...actionsOut.flatMap((a) => a.missedDates.map((date): SchedItem => ({ on: date, kind: 'action', refId: a.id }))),
    ...Array.from(planMisses.entries()).flatMap(([planId, dates]): SchedItem[] =>
      dates.map((date) => ({ on: date, kind: 'plan', refId: planId }))
    )
  ];
  const derailLookup: DerailmentLookup = attach(derailmentRows, derailKeys);

  /** Ids actually present in the rows this digest was given — deleted rows are not. */
  const knownRefIds = new Set<string>([
    ...asRows(input.routines).map((r) => asStr(r.id)),
    ...asRows(input.plans).map((p) => asStr(p.id)),
    ...asRows(input.plans).flatMap((p) => asRows(p.actions).map((a) => asStr(a.id)))
  ]);

  const derailmentsOut: ConsistencyDerailments = {
    recorded: derailments.length,
    windowRecords: derailments.filter((r) => windowDates.has(r.on)).length,
    openRecords: derailments.filter((r) => r.status === 'open').length,
    resolvedRecords: derailments.filter((r) => r.status === 'resolved').length,
    explainedDays: cells.filter((c) => c.explained && c.missed > 0).length,
    explainedMisses: routinesOut.filter((r) => r.explained).length + actionsOut.filter((a) => a.explained).length,
    unmatchedRecords: derailLookup.unmatched.filter((r) => windowDates.has(r.on)).length,
    danglingRefs: derailments.filter((r) => r.refId !== null && !knownRefIds.has(r.refId)).length,
    items: [...derailments].reverse(),
    byTrigger: tallyRecords(derailments),
    followUps: followUpsFromRecords(derailments, today),
    readLine: readLineFromRecords(derailments, today),
    rule: DERAILMENT_RULE
  };

  const rules: { label: string; value: string }[] = [
    { label: 'Window', value: `${days[0]} to ${days[6]} — Monday start, seven cells, from weekBounds(“${today}”).` },
    { label: 'Routine denominator', value: ROUTINE_RULE },
    { label: 'Action denominator', value: ACTION_RULE },
    {
      label: 'Partial day',
      value:
        'A log is partial when completedSteps is non-empty and shorter than the routine’s own step count. A log with no itemised steps is the dashboard day check: it records the routine, not the steps, so it counts as done and is excluded from the skipped-step counts.'
    },
    {
      label: 'Streak',
      value:
        'Distinct logged dates in a row. Current counts back from today, or from yesterday if today is not logged yet, and any skipped date ends it. Best-ever is the longest run in every dated log on file, not only this week.'
    },
    { label: 'Photo cadence', value: PHOTO_RULE },
    { label: 'Zero denominators', value: 'Nothing scheduled is reported as nothing scheduled — no 0%, no 100%, no rounding, no estimate.' }
  ];
  /**
   * The invariant is stated only to callers that were given the table at all.
   * A caller that passes no `derailments` key gets the digest this module
   * produced before the table existed, byte for byte, rules included.
   */
  if (input.derailments !== undefined) rules.push({ label: 'Derailment record', value: DERAILMENT_RULE });

  return {
    week: {
      days,
      start: days[0],
      end: days[6],
      today,
      elapsedDays: cells.filter((c) => !c.isFuture).length,
      futureDays: cells.filter((c) => c.isFuture).length
    },
    cells,
    routines: routinesOut,
    actions: actionsOut,
    mostSkippedStep,
    stepEvidence: { itemisedLogs, blankLogs, routinesWithSteps },
    streaks: streaksOut,
    photos,
    workouts,
    gaps,
    slipping,
    totals,
    derailments: derailmentsOut,
    hasActivity,
    hasSchedule: routinesOut.length > 0 || actionsOut.length > 0,
    rules
  };
}
