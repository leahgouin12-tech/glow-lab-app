import { describe, expect, it } from 'vitest';
import {
  buildDigest,
  DIGEST_LIMITS,
  GAP_NOT_EXPLAINED,
  fmt,
  mondayOf,
  sessionVolume,
  shiftISO,
  WEEKLY_VOLUME_METRIC,
  type FitnessDigestInput
} from '../engine/fitness';
import { trend, type TrendRead } from '../engine/trend';
import type { AnyRow } from '../db/schema';

/**
 * The digest arithmetic, pinned without a DOM. Everything here is checked the
 * way the page will print it: a figure either comes from a logged row or it is
 * reported as missing, and no window of three weeks is allowed to speak as a
 * direction.
 *
 * Fixed dates, fixed anchor — 2026-11-09 is a Monday, so `2026-11-12` (a
 * Thursday) makes the current week partial on purpose.
 */

const ANCHOR = '2026-11-12';

const stamp = (iso: string): number => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d, 12).getTime();
};

const base = (over: Record<string, unknown>): AnyRow =>
  ({
    id: 'row',
    createdAt: stamp('2026-01-01'),
    updatedAt: stamp('2026-01-01'),
    deletedAt: null,
    rev: 1,
    deviceId: 'dev',
    tags: [],
    text: '',
    ...over
  }) as unknown as AnyRow;

const set = (reps: unknown, kg: unknown, done = true): Record<string, unknown> => ({ reps, kg, rpe: 7, done });

/** A session row: `days` is a single ISO date unless `entries` is passed. */
function session(id: string, doneOn: string, entries: Record<string, unknown>[] = [{ exerciseId: 'ex1', sets: [set(5, 100)] }], over: Record<string, unknown> = {}): AnyRow {
  return base({ id, doneOn, label: `Session ${id}`, durationMin: 60, rpe: 7, note: '', planDayId: null, entries, ...over });
}

function exercise(id: string, name: string, over: Record<string, unknown> = {}): AnyRow {
  return base({ id, name, pattern: 'squat', focus: [], equipment: [], difficulty: 2, cue: '', caution: '', mediaIds: [], ...over });
}

function plan(over: Record<string, unknown> = {}): AnyRow {
  return base({ id: 'p1', name: 'Three days, eight weeks', goal: 'get stronger', daysPerWeek: 3, weeks: 8, split: [], active: true, ...over });
}

const run = (input: FitnessDigestInput) => buildDigest({ today: ANCHOR, ...input });

/* ------------------------------------------------------------------ primitives */

describe('the shared primitives the page and the digest both use', () => {
  it('buckets a week from its Monday and shifts across a year boundary', () => {
    expect(mondayOf('2026-11-09')).toBe('2026-11-09');
    expect(mondayOf('2026-11-12')).toBe('2026-11-09');
    expect(mondayOf('2026-11-15')).toBe('2026-11-09');
    expect(mondayOf('2026-11-16')).toBe('2026-11-16');
    expect(mondayOf('2025-12-28')).toBe('2025-12-22');
    expect(mondayOf('2025-12-29')).toBe('2025-12-29');
    expect(shiftISO('2025-12-29', 7)).toBe('2026-01-05');
    expect(shiftISO('2026-01-01', -3)).toBe('2025-12-29');
  });

  it('adds only the sets marked done, in the page definition of volume', () => {
    expect(sessionVolume([{ exerciseId: 'ex1', sets: [set(5, 100), set(3, 60)] }])).toBe(680);
    expect(sessionVolume([{ exerciseId: 'ex1', sets: [set(5, 100, false), set(3, 60)] }])).toBe(180);
    expect(sessionVolume([{ exerciseId: 'ex1', sets: [] }])).toBe(0);
    expect(sessionVolume([])).toBe(0);
    expect(sessionVolume(null)).toBe(0);
  });

  it('formats every figure through one helper and never prints a unit it was not given', () => {
    expect(fmt(1234.567, { digits: 0 })).toBe('1,235');
    expect(fmt(1234.567, { digits: 1 })).toBe('1,234.6');
    expect(fmt(1234.567, { digits: 1, unit: 'kg' })).toBe('1,234.6 kg');
    expect(fmt(12, { digits: 0, unit: null })).toBe('12');
    expect(fmt(12, { digits: 0, unit: '' })).toBe('12');
    expect(fmt(-2.5, { digits: 2, unit: 'kg' })).toBe('-2.50 kg');
    expect(fmt(12345678)).toBe('12,345,678.0');
  });

  it('prints an em dash instead of NaN, Infinity or a division by zero', () => {
    expect(fmt(Number.NaN)).toBe('—');
    expect(fmt(Number.POSITIVE_INFINITY)).toBe('—');
    expect(fmt(null)).toBe('—');
    expect(fmt(undefined)).toBe('—');
    expect(fmt(Number.NaN, { unit: 'kg' })).toBe('—');
  });
});

/* ---------------------------------------------------------------------- window */

describe('the twelve-week window', () => {
  it('reports nothing at all when there are no rows, without inventing a figure', () => {
    const d = run({ sessions: [], exercises: [], plans: [] });
    expect(d.empty).toBe(true);
    expect(d.weeks).toHaveLength(12);
    expect(d.weeks.every((w) => !w.hasSession && w.sessions === 0 && w.perSession === null)).toBe(true);
    expect(d.totals.sessions).toBe(0);
    expect(d.totals.perSession).toBeNull();
    expect(d.totals.sessionsPerActiveWeek).toBeNull();
    expect(d.volumeUnit).toBeNull();
    expect(d.gaps.longest).toBeNull();
    expect(d.gaps.current).toBeNull();
    expect(d.gaps.averageDays).toBeNull();
    expect(d.adherence.status).toBe('no-active-plan');
    expect(d.coverage.loggedIds).toBe(0);
    expect(JSON.stringify(d)).not.toContain('NaN');
    expect(JSON.stringify(d)).not.toContain('Infinity');
  });

  it('holds one session in its Monday bucket and leaves the other eleven empty', () => {
    const d = run({ sessions: [session('s1', '2026-11-12')] });
    expect(d.empty).toBe(false);
    expect(d.weeks.filter((w) => w.hasSession)).toHaveLength(1);
    const bucket = d.weeks.find((w) => w.weekOf === '2026-11-09');
    expect(bucket).toMatchObject({ sessions: 1, days: 1, volume: 500, perSession: 500, complete: false });
    expect(d.totals.volume).toBe(500);
    expect(d.volumeUnit).toBe('kg');
  });

  it('splits a Sunday and the following Monday into different buckets', () => {
    const d = run({ sessions: [session('s1', '2026-11-08'), session('s2', '2026-11-09')] });
    expect(d.weeks.find((w) => w.weekOf === '2026-11-02')?.sessions).toBe(1);
    expect(d.weeks.find((w) => w.weekOf === '2026-11-09')?.sessions).toBe(1);
  });

  it('buckets across a year boundary and still counts twelve Mondays', () => {
    const d = buildDigest({
      today: '2026-01-02',
      sessions: [session('s1', '2025-12-28', [{ exerciseId: 'ex1', sets: [set(5, 100)] }]), session('s2', '2025-12-29', [{ exerciseId: 'ex1', sets: [set(2, 50)] }])]
    });
    expect(d.window.from).toBe('2025-10-13');
    expect(d.window.to).toBe('2026-01-04');
    expect(d.weeks.map((w) => w.weekOf)).toContain('2025-12-22');
    expect(d.weeks.map((w) => w.weekOf)).toContain('2025-12-29');
    expect(d.weeks.find((w) => w.weekOf === '2025-12-22')?.volume).toBe(500);
    expect(d.weeks.find((w) => w.weekOf === '2025-12-29')?.volume).toBe(100);
    expect(d.weeks).toHaveLength(12);
  });

  it('keeps rows outside the window out of the arithmetic and says how many', () => {
    const d = run({
      sessions: [
        session('old1', '2025-05-05'),
        session('old2', '2025-06-06'),
        session('future', '2027-02-02'),
        session('now', '2026-11-10')
      ]
    });
    expect(d.totals.sessions).toBe(1);
    expect(d.quality.olderThanWindow).toBe(2);
    expect(d.quality.afterWindow).toBe(1);
    expect(d.quality.rowsOutsideWindow).toBe(3);
    /* the full log is still visible as a range, window or not */
    expect(d.totals.firstLogged).toBe('2025-05-05');
    expect(d.totals.lastLogged).toBe('2027-02-02');
  });

  it('counts a row with no usable date instead of dropping it silently', () => {
    const d = run({ sessions: [session('bad1', ''), session('bad2', 'yesterday'), session('ok', '2026-11-10')] });
    expect(d.quality.rowsWithoutDate).toBe(2);
    expect(d.totals.sessions).toBe(1);
  });

  it('ignores a soft-deleted session row', () => {
    const d = run({ sessions: [session('s1', '2026-11-10'), session('s2', '2026-11-04', [{ exerciseId: 'ex1', sets: [set(5, 100)] }], { deletedAt: stamp('2026-11-05') })] });
    expect(d.totals.sessions).toBe(1);
    expect(d.quality.sessionsInWindow).toBe(1);
  });
});

/* ----------------------------------------------------------------- the volume */

describe('volume over the rows she logged', () => {
  it('excludes a set stored as not done and counts it as excluded', () => {
    const d = run({
      sessions: [
        session('s1', '2026-11-10', [
          { exerciseId: 'ex1', sets: [set(5, 100, false), set(3, 60, true), set(2, 40, false)] }
        ])
      ]
    });
    expect(d.totals.volume).toBe(180);
    expect(d.quality.sets).toBe(3);
    expect(d.quality.doneSets).toBe(1);
    expect(d.quality.skippedSets).toBe(2);
  });

  it('carries no unit when no set holds a load, and prints no NaN for a blank one', () => {
    const d = run({
      sessions: [
        session('s1', '2026-11-10', [
          { exerciseId: 'ex1', sets: [set(5, null), set(8, '')] },
          { exerciseId: 'ex2', sets: [set(null, null)] }
        ])
      ]
    });
    expect(d.volumeUnit).toBeNull();
    expect(d.totals.volume).toBe(0);
    expect(d.totals.perSession).toBe(0);
    expect(d.quality.doneSetsMissingLoad).toBe(3);
    expect(d.quality.doneSetsMissingReps).toBe(1);
    expect(d.quality.doneSetsMissingBoth).toBe(1);
    expect(d.quality.zeroVolumeSessions).toBe(1);
    expect(JSON.stringify(d)).not.toContain('NaN');
  });

  it('treats a non-numeric stored value as missing rather than as a number', () => {
    const d = run({ sessions: [session('s1', '2026-11-10', [{ exerciseId: 'ex1', sets: [set('bodyweight', 'barbell'), set(5, 20)] }])] });
    expect(d.totals.volume).toBe(100);
    expect(d.quality.unusableSetValues).toBe(1);
    expect(d.quality.doneSetsMissingReps).toBe(1);
    expect(d.quality.doneSetsMissingLoad).toBe(1);
    expect(d.volumeUnit).toBe('kg');
  });

  it('calls a session with entries but no completed set too sparse to compute from', () => {
    const d = run({
      sessions: [
        session('empty-entries', '2026-11-03', []),
        session('no-done', '2026-11-04', [{ exerciseId: 'ex1', sets: [set(5, 100, false)] }]),
        session('fine', '2026-11-05', [{ exerciseId: 'ex1', sets: [set(5, 100)] }])
      ]
    });
    expect(d.quality.sparseSessions).toBe(2);
    expect(d.quality.zeroVolumeSessions).toBe(2);
    expect(d.totals.sessions).toBe(3);
    expect(d.totals.volume).toBe(500);
  });
});

/* ----------------------------------------------------------------- the weekly fit */

describe('the weekly volume trend', () => {
  /** Five logged weeks at 500 volume each, rising by 100 a week. */
  const fiveWeeks = [
    session('s1', '2026-10-06', [{ exerciseId: 'ex1', sets: [set(1, 100)] }]),
    session('s2', '2026-10-13', [{ exerciseId: 'ex1', sets: [set(2, 100)] }]),
    session('s3', '2026-10-20', [{ exerciseId: 'ex1', sets: [set(3, 100)] }]),
    session('s4', '2026-10-27', [{ exerciseId: 'ex1', sets: [set(4, 100)] }]),
    session('s5', '2026-11-03', [{ exerciseId: 'ex1', sets: [set(5, 100)] }])
  ];

  it('accepts the fit at five logged weeks spanning 28 days', () => {
    const d = run({ sessions: fiveWeeks });
    expect(d.trendPoints).toBe(5);
    expect(d.trend.n).toBe(5);
    expect(d.trend.usable).toBe(true);
    expect(d.trend.metric).toBe(WEEKLY_VOLUME_METRIC);
    expect(d.trend.direction).toBe('rising');
    expect(d.trend.sentence).toContain('kg');
  });

  it('refuses one week short and passes the engine refusal through untouched', () => {
    const four = fiveWeeks.slice(1);
    const d = run({ sessions: four });
    expect(d.trendPoints).toBe(4);
    expect(d.trend.usable).toBe(false);
    expect(d.trend.direction).toBe('unknown');
    expect(d.trend.needs.join(' ')).toContain('4 dated points where this read wants 5');
    expect(d.trend.sentence).toContain('no direction is claimed here');

    /* byte-identical to what the trend engine itself returns for those points */
    const direct: TrendRead = trend(
      [
        { on: '2026-10-12', value: 200 },
        { on: '2026-10-19', value: 300 },
        { on: '2026-10-26', value: 400 },
        { on: '2026-11-02', value: 500 }
      ],
      { unit: 'kg', perDays: 28 }
    );
    expect(d.trend.sentence).toBe(direct.sentence);
    expect(d.trend.direction).toBe(direct.direction);
    expect(d.trend.needs).toEqual(direct.needs);
  });

  it('does not treat a week with no session as a logged zero', () => {
    const d = run({ sessions: [session('s1', '2026-11-10'), session('s2', '2026-10-20')] });
    expect(d.weeks.filter((w) => !w.hasSession).length).toBe(10);
    expect(d.trendPoints).toBe(2);
    expect(d.trend.n).toBe(2);
    expect(d.trend.usable).toBe(false);
  });

  it('hands the empty window to the engine and reports the engine answer', () => {
    const d = run({ sessions: [] });
    expect(d.trendPoints).toBe(0);
    expect(d.trend.n).toBe(0);
    expect(d.trend.usable).toBe(false);
    expect(d.trend.direction).toBe('unknown');
    expect(d.trend.needs).toEqual(['no dated numbers to fit']);
    expect(d.trend.sentence).toBe('Nothing dated to read.');
    expect(d.trend.sentence).not.toMatch(/rising|falling/);
  });
});

/* --------------------------------------------------------------------- the gaps */

describe('rest gaps', () => {
  it('separates the longest gap inside the window from the one running now', () => {
    const d = run({ sessions: [session('s1', '2026-09-01'), session('s2', '2026-11-01')] });
    expect(d.gaps.longest).toEqual({ days: 61, from: '2026-09-01', to: '2026-11-01' });
    expect(d.gaps.current).toEqual({ days: 11, from: '2026-11-01', to: ANCHOR });
    expect(d.gaps.averageDays).toBe(61);
  });

  it('reads consecutive days as a one-day gap and a today entry as no gap at all', () => {
    const ran = run({ sessions: [session('s1', '2026-11-05'), session('s2', '2026-11-06'), session('s3', '2026-11-07')] });
    expect(ran.gaps.distinctDays).toBe(3);
    expect(ran.gaps.longest?.days).toBe(1);
    expect(ran.gaps.averageDays).toBe(1);
    expect(ran.gaps.current).toEqual({ days: 5, from: '2026-11-07', to: ANCHOR });

    const today = run({ sessions: [session('s1', '2026-11-05'), session('s2', ANCHOR)] });
    expect(today.gaps.current).toEqual({ days: 0, from: ANCHOR, to: ANCHOR });
    expect(today.gaps.longest).toEqual({ days: 7, from: '2026-11-05', to: ANCHOR });
  });

  it('counts two sessions on one day as one day and no gap', () => {
    const d = run({ sessions: [session('s1', '2026-11-07'), session('s2', '2026-11-07')] });
    expect(d.gaps.distinctDays).toBe(1);
    expect(d.gaps.longest).toBeNull();
    expect(d.totals.sessions).toBe(2);
  });

  it('leaves the longest gap unreported when one session is all there is', () => {
    const d = run({ sessions: [session('s1', '2026-10-30')] });
    expect(d.gaps.longest).toBeNull();
    expect(d.gaps.averageDays).toBeNull();
    expect(d.gaps.current).toEqual({ days: 13, from: '2026-10-30', to: ANCHOR });
  });

  it('names the gap crossing the window edge instead of hiding it', () => {
    const d = run({ sessions: [session('s1', '2026-08-01'), session('s2', '2026-09-01')] });
    expect(d.gaps.beforeWindow).toBe('2026-08-01');
    expect(d.gaps.boundary).toEqual({ days: 31, from: '2026-08-01', to: '2026-09-01' });
    expect(d.gaps.longest).toBeNull();
  });

  it('states that a gap carries no reason, in the digest text itself', () => {
    expect(GAP_NOT_EXPLAINED).toContain('A gap is a gap');
    expect(GAP_NOT_EXPLAINED).toContain('does not guess');
    expect(DIGEST_LIMITS).toContain('no claim about your body');
    expect(DIGEST_LIMITS).toContain('prescribes nothing');
  });
});

/* ------------------------------------------------------------------- adherence */

describe('adherence to the active plan', () => {
  it('scores complete weeks against the daysPerWeek the plan row carries', () => {
    const d = run({
      plans: [plan({ daysPerWeek: 3 })],
      sessions: [
        /* current, partial week: three days and still not scored */
        session('a1', '2026-11-09'),
        session('a2', '2026-11-10'),
        session('a3', '2026-11-11'),
        /* a complete week that hits it: three distinct days */
        session('b1', '2026-11-02'),
        session('b2', '2026-11-03'),
        session('b3', '2026-11-04'),
        /* a complete week that misses it: two days, one of them twice */
        session('c1', '2026-10-26'),
        session('c2', '2026-10-27'),
        session('c3', '2026-10-27')
      ]
    });
    expect(d.adherence.status).toBe('scored');
    expect(d.adherence.available).toBe(true);
    expect(d.adherence.targetField).toBe('daysPerWeek');
    expect(d.adherence.target).toBe(3);
    expect(d.adherence.weeksScored).toBe(11);
    expect(d.adherence.hitWeeks).toBe(1);
    expect(d.adherence.missedWeeks).toBe(10);
    expect(d.adherence.detail.find((w) => w.weekOf === '2026-10-26')).toMatchObject({ days: 2, hit: false, logged: true });
    expect(d.adherence.detail.find((w) => w.weekOf === '2026-11-02')).toMatchObject({ days: 3, hit: true });
    expect(d.adherence.detail.map((w) => w.weekOf)).not.toContain('2026-11-09');
    expect(d.adherence.note).toContain('no start date');
  });

  it('reports the plan row length without a target instead of inventing one', () => {
    const d = run({
      plans: [plan({ daysPerWeek: 0, split: [{ id: 'd1', label: 'Monday', focus: '', blocks: [] }] })],
      sessions: [session('s1', '2026-11-02'), session('s2', '2026-11-04')]
    });
    expect(d.adherence.status).toBe('no-target');
    expect(d.adherence.available).toBe(false);
    expect(d.adherence.target).toBeNull();
    expect(d.adherence.targetField).toBeNull();
    expect(d.adherence.hitWeeks).toBe(0);
    expect(d.adherence.splitDays).toBe(1);
    expect(d.adherence.note).toContain('daysPerWeek');
    expect(d.adherence.note).toContain('split is the shape of a cycle');
    expect(d.totals.sessionsPerActiveWeek).toBe(2);
  });

  it('says so when no plan is active at all', () => {
    const d = run({ plans: [plan({ active: false, daysPerWeek: 4 })], sessions: [session('s1', '2026-11-02')] });
    expect(d.adherence.status).toBe('no-active-plan');
    expect(d.adherence.available).toBe(false);
    expect(d.adherence.planName).toBeNull();
    expect(d.adherence.note).toContain('No plan row is marked active');
  });

  it('uses a target-carrying active plan and reports how many were marked active', () => {
    const d = run({ plans: [plan({ id: 'p0', name: 'No target here', daysPerWeek: 0 }), plan({ id: 'p1', name: 'Real plan', daysPerWeek: 2 })], sessions: [session('s1', '2026-11-02'), session('s2', '2026-11-04')] });
    expect(d.adherence.planId).toBe('p1');
    expect(d.adherence.planName).toBe('Real plan');
    expect(d.adherence.activePlans).toBe(2);
    expect(d.adherence.target).toBe(2);
    expect(d.adherence.hitWeeks).toBe(1);
  });
});

/* -------------------------------------------------------------------- coverage */

describe('what is logged against what is catalogued', () => {
  it('splits the library from the log and ranks by logged volume', () => {
    const d = run({
      exercises: [exercise('ex1', 'Back squat'), exercise('ex2', 'Romanian deadlift'), exercise('ex3', 'Farmer carry')],
      sessions: [
        session('s1', '2026-11-10', [
          { exerciseId: 'ex1', sets: [set(5, 100)] },
          { exerciseId: 'ex2', sets: [set(8, 60)] }
        ]),
        session('s2', '2026-11-03', [{ exerciseId: 'ex1', sets: [set(5, 120)] }])
      ]
    });
    expect(d.coverage.libraryRows).toBe(3);
    expect(d.coverage.loggedIds).toBe(2);
    expect(d.coverage.resolvedIds).toBe(2);
    expect(d.coverage.neverLogged).toBe(1);
    expect(d.coverage.neverLoggedRows[0]).toMatchObject({ name: 'Farmer carry' });
    expect(d.coverage.top[0]).toMatchObject({ id: 'ex1', name: 'Back squat', sessions: 2, volume: 1100 });
    expect(d.coverage.untracked).toHaveLength(0);
  });

  it('still reports coverage when the library is empty', () => {
    const d = run({ exercises: [], sessions: [session('s1', '2026-11-10', [{ exerciseId: 'ex1', sets: [set(5, 100)] }])] });
    expect(d.coverage.libraryRows).toBe(0);
    expect(d.coverage.neverLogged).toBe(0);
    expect(d.coverage.resolvedIds).toBe(0);
    expect(d.coverage.top[0].name).toBeNull();
    expect(d.coverage.untracked).toEqual([{ id: 'ex1', sessions: 1, volume: 500 }]);
  });

  it('reports nothing catalogued as logged when no session matches the library', () => {
    const d = run({
      exercises: [exercise('ex1', 'Back squat'), exercise('ex2', 'Bench press')],
      sessions: [session('s1', '2026-11-10', [{ exerciseId: 'ghost', sets: [set(5, 100)] }])]
    });
    expect(d.coverage.loggedIds).toBe(1);
    expect(d.coverage.resolvedIds).toBe(0);
    expect(d.coverage.neverLogged).toBe(2);
    expect(d.coverage.neverLoggedRows.map((e) => e.name)).toEqual(['Back squat', 'Bench press']);
    expect(d.coverage.untracked.map((u) => u.id)).toEqual(['ghost']);
  });

  it('counts a session with no exercise id once, as an entry with nothing to attach to', () => {
    const d = run({ exercises: [exercise('ex1', 'Back squat')], sessions: [session('s1', '2026-11-10', [{ exerciseId: '', sets: [set(5, 100)] }])] });
    expect(d.coverage.entriesWithoutExercise).toBe(1);
    expect(d.coverage.loggedIds).toBe(0);
    expect(d.coverage.top).toHaveLength(0);
    expect(d.totals.volume).toBe(500);
  });

  it('does not count a soft-deleted library row as catalogued', () => {
    const d = run({ exercises: [exercise('ex1', 'Back squat', { deletedAt: stamp('2026-01-02') })], sessions: [] });
    expect(d.coverage.libraryRows).toBe(0);
    expect(d.coverage.neverLogged).toBe(0);
  });
});

/* ------------------------------------------------------------------ the limits */

describe('what the digest prints about itself', () => {
  it('names the window, the source of the rows and the limit of the claim', () => {
    expect(DIGEST_LIMITS).toContain('logged');
    expect(DIGEST_LIMITS).toContain('Monday to Sunday');
    expect(DIGEST_LIMITS).not.toMatch(/should train|prescribe a|calorie|body fat|BMI/i);
  });

  it('never emits a NaN or an Infinity for any shape of row', () => {
    const shapes = run({
      sessions: [
        session('s1', '2026-11-10', [{ exerciseId: 'ex1', sets: [{ reps: null, kg: null, rpe: null }] }]),
        session('s2', '2026-11-09', [{ exerciseId: 'ex1' }]),
        session('s3', '2026-11-08', []),
        session('s4', '2026-11-07', [{ exerciseId: 'ex1', sets: [set(0, 0)] }])
      ],
      exercises: [exercise('ex1', 'Back squat')],
      plans: [plan({ daysPerWeek: null })]
    });
    const printed = JSON.stringify(shapes);
    expect(printed).not.toContain('NaN');
    expect(printed).not.toContain('Infinity');
    expect(shapes.adherence.status).toBe('no-target');
    /* a window with no session has no average to print, so it prints a dash */
    const none = run({ sessions: [] });
    expect(fmt(none.totals.perSession, { digits: 1, unit: none.volumeUnit })).toBe('—');
    expect(fmt(none.gaps.averageDays, { digits: 1 })).toBe('—');
  });
});
