/**
 * THE GLOW LAB — where a goal's "current" value can honestly come from.
 *
 * The goal row has always held two numbers she types: `targetValue` and
 * `data.current`. Half the goals in a real install show "—" because nobody
 * typed the second one, while the same figure was already sitting in another
 * table — a waist measured with a tape, a weigh-in, a hair length, sessions on
 * the calendar. The Progress page already knew this and offered the newest
 * matching *progress entry*, labelled as an offer and never applied.
 *
 * This module widens that one step: it looks at every table that can hold the
 * metric a goal names and returns what it finds, with the rule that produced
 * each number attached to it. Nothing here writes. Nothing here decides that a
 * goal is met. The card still needs her to commit an offer before it becomes
 * the goal's current value, and the app still cannot take a measurement.
 *
 * Two things it will not do:
 *   · match loosely enough to hand a lash-length goal the number from a loc
 *     appointment, which is why the name tests below are keyword sets rather
 *     than a similarity score nobody could argue with;
 *   · pass a number across units silently. A goal in inches and a record in cm
 *     come back flagged, side by side, for her to read.
 */
import type { AnyRow } from '../db/schema';
import { dayIndex } from './trend';

export const GOAL_SOURCE_RULE_VERSION = 1;

/** A week, then a month: the two windows a count can be taken over without pretending precision. */
export const SESSION_WINDOW_DAYS = 7;
export const ADHERENCE_WINDOW_DAYS = 28;

export type GoalSourceKey =
  | 'progressEntries'
  | 'measurements'
  | 'weightEntries'
  | 'hairRecords'
  | 'workoutSessions'
  | 'routineLogs';

export interface GoalOffer {
  source: GoalSourceKey;
  /** what is being offered, in the words the card prints */
  label: string;
  value: number;
  unit: string;
  /** the date the number came from; null for a count over a window */
  on: string | null;
  /** days in that window, for the counts */
  windowDays: number | null;
  /** how this number was obtained, in one sentence, travelling with it */
  rule: string;
  /** true when the goal's own unit and this record's unit are both filled and differ */
  unitDiffers: boolean;
  /** the row it came from, so she can go and look at it */
  rowId: string;
}

export interface GoalTables {
  progressEntries?: AnyRow[];
  measurements?: AnyRow[];
  weightEntries?: AnyRow[];
  hairRecords?: AnyRow[];
  workoutSessions?: AnyRow[];
  routineLogs?: AnyRow[];
}

export interface GoalOffers {
  /** the metric as this module read it */
  metric: string;
  offers: GoalOffer[];
  /** why nothing was offered, or what was seen and refused — printed, not swallowed */
  notes: string[];
}

const WEIGHT_WORDS = ['weight', 'kg', 'kilo', 'kilos', 'mass'];
const SESSION_WORDS = ['session', 'sessions', 'workout', 'workouts', 'gym', 'training', 'lift', 'lifts'];
const ADHERENCE_WORDS = ['adherence', 'consistency', 'streak', 'completion', 'habit', 'routine'];
const HAIR_WORDS = ['hair', 'strand', 'loc', 'locs', 'locks', 'protective', 'style length'];
const LENGTH_WORDS = ['length', 'cm', 'grow', 'growth', 'retention'];

function norm(v: unknown): string {
  return String(v ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** live rows only, newest date first — soft-deleted rows never speak for her */
function byDateDesc(rows: AnyRow[] | undefined, dateField: string, extra?: (r: AnyRow) => boolean): AnyRow[] {
  return (rows ?? [])
    .filter((r) => r && !r.deletedAt && (!extra || extra(r)))
    .map((r) => ({ row: r, on: String(r[dateField] ?? (r.data ? r.data[dateField] : '') ?? '') }))
    .filter((e) => dayIndex(e.on) !== null)
    .sort((a, b) => String(b.on).localeCompare(String(a.on)))
    .map((e) => e.row);
}

function mentions(metric: string, words: string[]): string | null {
  for (const w of words) {
    if (metric === w) return w;
    if (metric.includes(w)) return w;
  }
  return null;
}

function unitClash(goalUnit: string, offerUnit: string): boolean {
  const a = norm(goalUnit);
  const b = norm(offerUnit);
  return Boolean(a) && Boolean(b) && a !== b;
}

function withinDays(on: string, today: string, days: number): boolean {
  const a = dayIndex(on);
  const t = dayIndex(today);
  if (a === null || t === null) return false;
  const diff = t - a;
  return diff >= 0 && diff < days;
}

/**
 * Every table that can hold the metric this goal names.
 *
 * `today` is the only clock a windowed count uses, and it is a parameter so the
 * rule is testable rather than tied to the machine running it.
 */
export function offersForGoal(goal: AnyRow, tables: GoalTables, opts: { today?: string } = {}): GoalOffers {
  const metric = norm(goal?.metric ?? goal?.data?.metric ?? '');
  const goalUnit = norm(goal?.unit ?? goal?.data?.unit ?? '');
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const offers: GoalOffer[] = [];
  const notes: string[] = [];

  if (!metric) {
    return {
      metric,
      offers,
      notes: ['No metric is named on this goal row, so there is nothing to look for. Write the metric and the tables that hold it will be read.']
    };
  }

  /* ---- the newest dated number that matches by name, table by table ---- */

  const entries = byDateDesc(tables.progressEntries, 'on', (r) => num(r.value) !== null);
  const entryHit = entries.find((e) => norm(e.metric) === metric);
  if (entryHit) {
    const unit = norm(entryHit.unit);
    offers.push({
      source: 'progressEntries',
      label: 'Newest check-in naming this metric',
      value: num(entryHit.value) as number,
      unit: entryHit.unit ? String(entryHit.unit) : '',
      on: String(entryHit.on),
      windowDays: null,
      rule: 'The most recent progress entry whose metric matches, exactly the value you typed into it.',
      unitDiffers: unitClash(goalUnit, unit),
      rowId: String(entryHit.id)
    });
  }

  const measurements = byDateDesc(tables.measurements, 'takenOn', (r) => num(r.value) !== null);
  const sites = new Set<string>();
  for (const m of measurements) {
    const site = norm(m.site);
    if (!site || sites.has(site)) continue;
    /* metric ⊂ site or site ⊂ metric, but only for a name long enough to mean
       something — a two-letter metric would match half the body */
    if (metric.length >= 3 && (site === metric || site.includes(metric) || (metric.includes(site) && site.length >= 3))) {
      sites.add(site);
      const unit = norm(m.unit);
      offers.push({
        source: 'measurements',
        label: `Newest ${String(m.site)} measurement`,
        value: num(m.value) as number,
        unit: m.unit ? String(m.unit) : '',
        on: String(m.takenOn),
        windowDays: null,
        rule: `The most recent measurement recorded at “${String(m.site)}” (${String(m.kind || 'kind not set')}${m.method ? `, ${String(m.method)}` : ', method not recorded'}). A tape number you typed; this app cannot take one.`,
        unitDiffers: unitClash(goalUnit, unit),
        rowId: String(m.id)
      });
      break;
    }
  }

  if (mentions(metric, WEIGHT_WORDS)) {
    const weights = byDateDesc(tables.weightEntries, 'loggedOn', (r) => num(r.kg ?? r.data?.kg) !== null);
    const w = weights[0];
    if (w) {
      const value = num(w.kg ?? w.data?.kg) as number;
      offers.push({
        source: 'weightEntries',
        label: 'Newest weigh-in',
        value,
        unit: 'kg',
        on: String(w.loggedOn),
        windowDays: null,
        rule: `The most recent weight row${w.context ? ` (logged as “${String(w.context)}”)` : ''}. Single weigh-ins bounce by more than most goals; the trend read on Body & Fitness is the one that smooths them.`,
        unitDiffers: unitClash(goalUnit, 'kg'),
        rowId: String(w.id)
      });
    } else if (tables.weightEntries?.length) {
      notes.push('Weight rows exist but none carries a usable date and number.');
    }
  }

  if (mentions(metric, HAIR_WORDS) && mentions(metric, LENGTH_WORDS)) {
    const hairs = byDateDesc(tables.hairRecords, 'doneOn', (r) => num(r.lengthCm) !== null);
    const h = hairs[0];
    if (h) {
      offers.push({
        source: 'hairRecords',
        label: 'Newest hair length',
        value: num(h.lengthCm) as number,
        unit: 'cm',
        on: String(h.doneOn),
        windowDays: null,
        rule: `The most recent hair record with a length in cm${h.label ? ` (${String(h.label)})` : ''}. Someone typed this number — you or your stylist — and the app did not measure it.`,
        unitDiffers: unitClash(goalUnit, 'cm'),
        rowId: String(h.id)
      });
    } else {
      notes.push('The metric names hair length, but no hair record on this device holds a length in cm.');
    }
  }

  /* ---- counts over a window: a different kind of number, printed as one ---- */

  if (mentions(metric, SESSION_WORDS)) {
    const sessions = byDateDesc(tables.workoutSessions, 'doneOn');
    const inWindow = sessions.filter((s) => withinDays(String(s.doneOn), today, SESSION_WINDOW_DAYS));
    offers.push({
      source: 'workoutSessions',
      label: `Sessions in the last ${SESSION_WINDOW_DAYS} days`,
      value: inWindow.length,
      unit: 'sessions/wk',
      on: inWindow.length ? String(inWindow[0].doneOn) : null,
      windowDays: SESSION_WINDOW_DAYS,
      rule: `${inWindow.length} workout session row(s) dated in the ${SESSION_WINDOW_DAYS} days ending ${today}. A session is whatever you logged as one; none was inferred.`,
      unitDiffers: unitClash(goalUnit, 'sessions'),
      rowId: String(inWindow[0]?.id ?? '')
    });
  }

  if (mentions(metric, ADHERENCE_WORDS)) {
    const logs = byDateDesc(tables.routineLogs, 'doneOn');
    const days = new Set(
      logs.filter((l) => withinDays(String(l.doneOn), today, ADHERENCE_WINDOW_DAYS)).map((l) => String(l.doneOn))
    );
    const pct = Math.round((days.size / ADHERENCE_WINDOW_DAYS) * 100);
    offers.push({
      source: 'routineLogs',
      label: `Days logged in the last ${ADHERENCE_WINDOW_DAYS}`,
      value: pct,
      unit: '%',
      on: days.size ? String(logs[0].doneOn) : null,
      windowDays: ADHERENCE_WINDOW_DAYS,
      rule: `${days.size} separate date(s) with at least one routine log, out of ${ADHERENCE_WINDOW_DAYS} days. Any routine counts toward the numerator — the app does not know which ones this goal meant — and a day with no log row is read as no log, never as a zero to be divided by.`,
      unitDiffers: unitClash(goalUnit, '%'),
      rowId: String(logs[0]?.id ?? '')
    });
  }

  if (!offers.length && !notes.length) {
    notes.push(
      `Nothing on this device names “${String(goal?.metric ?? metric)}” in a table this app reads. The number exists only if you type it — a check-in, a measurement, a weigh-in, a hair record, a session or a routine log.`
    );
  }

  return { metric, offers, notes };
}

/**
 * The note written to the audit trail when she commits an offer. It names the
 * table and the date, so a future reader of the log can tell a committed offer
 * apart from a number typed from nothing.
 */
export function commitNote(offer: GoalOffer): string {
  const where = offer.on ? `dated ${offer.on}` : `counted over ${offer.windowDays} days`;
  return `Current value set to ${offer.value}${offer.unit ? ` ${offer.unit}` : ''} from ${offer.source} (${where}), committed by hand — the app applied nothing on its own.`;
}
