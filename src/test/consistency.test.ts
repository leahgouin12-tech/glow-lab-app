import { createElement } from 'react';
import { render as renderTree } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { digest, streaks, weekBounds, type ActionAdherence, type ConsistencyInput, type RoutineAdherence } from '../engine/consistency';
import { ConsistencyBody } from '../ui/consistency';
import type { AnyRow } from '../db/schema';

/**
 * The adherence layer is only worth shipping if its arithmetic is boring.
 * These tests pin the window, the denominators, the partial-step rule, the
 * streaks and the photo cadence — and assert that a zero denominator is
 * reported as zero denominator rather than as a percentage.
 */

const MON = '2026-11-09'; // a Monday
const TODAY = '2026-11-12'; // the Thursday of that week
const SUNDAY = '2026-11-15';

/** Local-noon stamps keep createdAt comparisons TZ-independent enough. */
const stamp = (iso: string): number => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d, 12).getTime();
};

const row = <T extends Record<string, unknown>>(over: T): AnyRow =>
  ({ id: 'x', createdAt: stamp('2026-01-01'), updatedAt: stamp('2026-01-01'), deletedAt: null, rev: 1, deviceId: 'dev', tags: [], text: '', ...over }) as unknown as AnyRow;

const routine = (over: Record<string, unknown> = {}): AnyRow =>
  row({
    id: 'r1',
    name: 'Morning skin',
    domain: 'skin',
    timeOfDay: 'am',
    active: true,
    steps: [],
    ...over
  });

const step = (id: string, label: string, order = 1): Record<string, unknown> => ({
  id,
  order,
  label,
  detail: '',
  productId: null,
  durationMin: 1,
  skipIf: ''
});

const log = (over: Record<string, unknown> = {}): AnyRow =>
  row({ routineId: 'r1', doneOn: MON, completedSteps: [], mood: 0, note: '', ...over });

const plan = (actions: Record<string, unknown>[], over: Record<string, unknown> = {}): AnyRow =>
  row({ id: 'p1', name: 'Barrier repair', days: 28, startOn: MON, reviewEveryDays: 7, actions, status: 'active', ...over });

const action = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'a1',
  label: 'SPF 50 every morning',
  category: 'skin',
  cadence: 'daily',
  dayOffset: 0,
  weeks: [],
  costBand: 'low',
  techniqueId: null,
  productId: null,
  goalId: null,
  doneOn: [],
  ...over
});

const media = (over: Record<string, unknown> = {}): AnyRow =>
  row({ id: 'm1', kind: 'progress', takenOn: MON, remoteUrl: '', blobId: 'b', ...over });

const session = (over: Record<string, unknown> = {}): AnyRow => row({ id: 'w1', doneOn: MON, label: 'Push', entries: [], ...over });

const empty: ConsistencyInput = { routines: [], routineLogs: [], plans: [], sessions: [], media: [] };
const at = (over: Partial<ConsistencyInput> = {}) => digest({ ...empty, ...over }, { today: TODAY });

/** Test-side date arithmetic, so the expected numbers are shown as sums. */
const daysBetween = (a: string, b: string): number => {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000);
};

const routinesById = (d: ReturnType<typeof digest>): Record<string, RoutineAdherence> =>
  Object.fromEntries(d.routines.map((r) => [r.id, r]));
const actionsById = (d: ReturnType<typeof digest>): Record<string, ActionAdherence> =>
  Object.fromEntries(d.actions.map((a) => [a.id, a]));

/* ------------------------------------------------------------------ window */

describe('weekBounds', () => {
  it('starts on Monday and returns exactly seven ascending days', () => {
    const week = weekBounds('2026-11-12');
    expect(week).toHaveLength(7);
    expect(week[0]).toBe(MON);
    expect(week[6]).toBe(SUNDAY);
    expect(new Set(week).size).toBe(7);
    expect([...week].sort()).toEqual(week);
  });

  it('rolls a Sunday anchor back to the Monday that owns it', () => {
    expect(weekBounds(SUNDAY)[0]).toBe(MON);
  });

  it('crosses a month boundary backwards without drifting', () => {
    // 2026-03-01 is a Sunday: its week belongs to February.
    expect(weekBounds('2026-03-01')).toEqual([
      '2026-02-23',
      '2026-02-24',
      '2026-02-25',
      '2026-02-26',
      '2026-02-27',
      '2026-02-28',
      '2026-03-01'
    ]);
  });

  it('crosses a year boundary', () => {
    // 2026-01-01 is a Thursday, so the week opens in 2025.
    expect(weekBounds('2026-01-01')).toEqual(['2025-12-29', '2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04']);
  });

  it('falls back to the current week when handed junk', () => {
    expect(weekBounds('not-a-date')).toHaveLength(7);
  });
});

/* -------------------------------------------------------------- zero rows */

describe('nothing logged yet', () => {
  it('returns seven real cells and no invented numbers', () => {
    const d = at();
    expect(d.cells).toHaveLength(7);
    expect(d.cells.every((c) => c.state === 'unscheduled')).toBe(true);
    expect(d.cells.every((c) => c.scheduled === 0 && c.logged === 0 && c.missed === 0)).toBe(true);
    expect(d.routines).toEqual([]);
    expect(d.actions).toEqual([]);
    expect(d.gaps).toEqual([]);
    expect(d.slipping).toBeNull();
    expect(d.mostSkippedStep).toBeNull();
    expect(d.totals.pct).toBeNull();
    expect(d.totals.state).toBe('nothing-scheduled');
    expect(d.totals.ratio).toBe('0/0');
    expect(d.hasActivity).toBe(false);
    expect(d.streaks.anyRoutine).toMatchObject({ current: 0, best: 0, loggedDates: 0 });
  });

  it('reports photo cadence as no cadence, never a guessed interval', () => {
    const d = at();
    expect(d.photos.state).toBe('nothing-scheduled');
    expect(d.photos.everyDays).toBeNull();
    expect(d.photos.gapsMeasured).toBe(0);
    expect(d.photos.reason).toMatch(/two points/);
  });

  it('counts sessions without scoring them against a target it was not given', () => {
    const d = at({ sessions: [session({ doneOn: MON }), session({ id: 'w2', doneOn: SUNDAY })] });
    expect(d.workouts.sessions).toBe(2);
    expect(d.workouts.dates).toEqual([MON]); // 2026-11-15 is inside the week but still ahead of today
    expect(d.workouts.sinceLastDays).toBe(3);
    expect(d.workouts.state).toBe('nothing-scheduled');
    expect(d.hasActivity).toBe(true);
  });
});

/* ------------------------------------------------------------- denominators */

describe('denominators', () => {
  it('scheduled-but-never-logged is 0%, not 100%', () => {
    const d = at({ routines: [routine()] });
    const r = routinesById(d).r1;
    // Mon–Thu are elapsed; Fri–Sun are still ahead of today.
    expect(r.scheduled).toBe(4);
    expect(r.n).toBe(0);
    expect(r.pct).toBe(0);
    expect(r.ratio).toBe('0/4');
    expect(r.missedDays).toBe(4);
    expect(d.gaps).toHaveLength(1);
    expect(d.gaps[0].detail).toContain('logged 0');
    expect(d.slipping?.label).toBe('Morning skin');
  });

  it('does not schedule days before the routine existed', () => {
    const d = at({ routines: [routine({ createdAt: stamp('2026-11-11') })] });
    expect(routinesById(d).r1.scheduled).toBe(2); // 11 and 12 Nov only
  });

  it('calls an inactive routine nothing-scheduled instead of a miss', () => {
    const d = at({ routines: [routine({ active: false })] });
    expect(d.routines).toHaveLength(0);
    expect(d.totals.scheduled).toBe(0);
    expect(d.totals.pct).toBeNull();
  });

  it('gives a plan action zero scheduled occurrences a null percentage, not 0%', () => {
    const d = at({ plans: [plan([action({ cadence: 'monthly', doneOn: [] })])] });
    const a = actionsById(d).a1;
    // The 1st is not inside 9–15 Nov, so there is no denominator to divide by.
    expect(a.scheduled).toBe(0);
    expect(a.pct).toBeNull();
    expect(a.state).toBe('nothing-scheduled');
    expect(a.ratio).toBe('0/0');
    expect(a.reason).toContain('monthly');
  });

  it('prints the denominator rule beside every scored number', () => {
    const d = at({ routines: [routine()], plans: [plan([action()])] });
    for (const item of [...d.routines, ...d.actions, d.totals]) {
      expect(item.rule.length).toBeGreaterThan(20);
      expect(item.rule).toMatch(/[Dd]enominator/);
    }
  });

  it('adds up: the day cells and the item rows are the same arithmetic', () => {
    const d = at({
      routines: [routine(), routine({ id: 'r2', name: 'Evening hair' })],
      routineLogs: [log({ doneOn: MON }), log({ id: 'l2', routineId: 'r2', doneOn: MON })],
      plans: [plan([action(), action({ id: 'a2', label: 'Weekly exfoliate', cadence: 'weekly' })])]
    });
    const cellSum = d.cells.reduce((s, c) => s + c.scheduled, 0);
    expect(d.totals.scheduled).toBe(cellSum);
    expect(d.totals.scheduled).toBe(d.routines.reduce((s, r) => s + r.scheduled, 0) + d.actions.reduce((s, a) => s + a.scheduled, 0));
    expect(d.cells.reduce((s, c) => s + c.logged, 0)).toBe(d.totals.n);
    expect(d.totals.n).toBe(2);
  });

  it('never emits a fabricated number: no NaN, no Infinity, no percent on a zero denominator', () => {
    const d = at({
      routines: [routine({ steps: [step('s1', 'Cleanser'), step('s2', 'Serum')] })],
      routineLogs: [log({ completedSteps: ['s1'] })],
      plans: [plan([action({ cadence: 'once', dayOffset: 40 })])]
    });
    const json = JSON.stringify(d);
    expect(json).not.toMatch(/NaN|Infinity/);
    for (const item of [...d.routines, ...d.actions]) {
      expect(item.pct === null).toBe(item.scheduled === 0);
      expect(item.ratio).toBe(`${item.n}/${item.scheduled}`);
    }
  });
});

/* ---------------------------------------------------------------- partials */

describe('partial steps', () => {
  it('a log with fewer itemised steps than the routine has is partial, not done', () => {
    const d = at({
      routines: [routine({ steps: [step('s1', 'Cleanser'), step('s2', 'Serum'), step('s3', 'Moisturiser'), step('s4', 'SPF')] })],
      routineLogs: [log({ doneOn: MON, completedSteps: ['s1', 's2'] })]
    });
    const r = routinesById(d).r1;
    expect(r.partialDays).toBe(1);
    expect(r.fullDays).toBe(0);
    expect(r.n).toBe(1);
    expect(d.cells[0].state).toBe('partial');
    expect(d.cells[0].partial).toBe(1);
    expect(d.cells[0].logged).toBe(1);
    expect(d.cells[0].missed).toBe(0); // the day itself: 1 scheduled, 1 logged, but only part of it itemised
    expect(d.cells[1].state).toBe('nothing');
    expect(d.cells[1].missed).toBe(1);
    expect(r.missedDays).toBe(3);
  });

  it('all steps present is a full day', () => {
    const d = at({
      routines: [routine({ steps: [step('s1', 'Cleanser'), step('s2', 'Serum')] })],
      routineLogs: [log({ doneOn: MON, completedSteps: ['s1', 's2'] })]
    });
    expect(routinesById(d).r1.fullDays).toBe(1);
    expect(routinesById(d).r1.partialDays).toBe(0);
    expect(d.cells[0]).toMatchObject({ state: 'done', full: 1, partial: 0, missed: 0 });
    expect(d.cells[1]).toMatchObject({ state: 'nothing', missed: 1 });
  });

  it('a day-check log with no itemised steps counts as done and names nothing skipped', () => {
    const d = at({
      routines: [routine({ steps: [step('s1', 'Cleanser'), step('s2', 'Serum')] })],
      routineLogs: [log({ doneOn: MON, completedSteps: [] })]
    });
    const r = routinesById(d).r1;
    expect(r.fullDays).toBe(1);
    expect(r.partialDays).toBe(0);
    expect(r.stepsBlank).toBe(1);
    expect(r.stepsRecorded).toBe(0);
    expect(d.mostSkippedStep).toBeNull();
    expect(d.stepEvidence).toMatchObject({ itemisedLogs: 0, blankLogs: 1 });
  });

  it('names the most-skipped step with its own counts', () => {
    const d = at({
      routines: [routine({ steps: [step('s1', 'Cleanser'), step('s2', 'Retinoid'), step('s3', 'SPF')] })],
      routineLogs: [
        log({ id: 'l1', doneOn: MON, completedSteps: ['s1', 's2', 's3'] }),
        log({ id: 'l2', doneOn: '2026-11-10', completedSteps: ['s1', 's2'] }),
        log({ id: 'l3', doneOn: '2026-11-11', completedSteps: ['s1', 's2'] })
      ]
    });
    expect(d.mostSkippedStep).toMatchObject({ label: 'SPF', skipped: 2, opportunities: 3, pct: 67 });
    expect(d.mostSkippedStep?.ratio).toBe('2/3');
  });

  it('ignores logs for routines that are not in the record', () => {
    const d = at({ routines: [routine()], routineLogs: [log({ routineId: 'ghost', doneOn: MON })] });
    expect(routinesById(d).r1.n).toBe(0);
    expect(d.cells[0].logged).toBe(0);
  });
});

/* ----------------------------------------------------------------- streaks */

describe('streaks', () => {
  it('a gap day breaks the current streak', () => {
    const s = streaks(['2026-11-09', '2026-11-10', '2026-11-12'], TODAY);
    expect(s.current).toBe(1);
    expect(s.best).toBe(2);
    expect(s.loggedDates).toBe(3);
    expect(s.bestFrom).toBe('2026-11-09');
    expect(s.bestTo).toBe('2026-11-10');
  });

  it('counts back from yesterday when today is not logged yet', () => {
    const s = streaks(['2026-11-09', '2026-11-10', '2026-11-11'], TODAY);
    expect(s.current).toBe(3);
    expect(s.currentEnd).toBe('2026-11-11');
  });

  it('is zero when the last log is older than yesterday', () => {
    const s = streaks(['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05'], TODAY);
    expect(s.current).toBe(0);
    expect(s.currentEnd).toBeNull();
    expect(s.best).toBe(5);
    expect(s.bestFrom).toBe('2026-10-01');
    expect(s.bestTo).toBe('2026-10-05');
  });

  it('keeps best-ever from an older run while the current one is shorter', () => {
    const d = at({
      routines: [routine()],
      routineLogs: [
        log({ id: 'l1', doneOn: '2026-09-01' }),
        log({ id: 'l2', doneOn: '2026-09-02' }),
        log({ id: 'l3', doneOn: '2026-09-03' }),
        log({ id: 'l4', doneOn: '2026-09-04' }),
        log({ id: 'l5', doneOn: MON }),
        log({ id: 'l6', doneOn: TODAY })
      ]
    });
    const r = routinesById(d).r1;
    expect(r.streak.current).toBe(1); // 09 and 12 Nov are not neighbours
    expect(r.streak.best).toBe(4);
    expect(d.streaks.longestCurrent?.label).toBe('Morning skin');
  });

  it('dedupes two logs on the same date', () => {
    const s = streaks(['2026-11-10', '2026-11-10', '2026-11-11'], TODAY);
    expect(s.loggedDates).toBe(2);
    expect(s.current).toBe(2);
  });

  it('ignores junk dates rather than coercing them', () => {
    expect(streaks(['', 'nonsense', null, undefined, MON], TODAY).loggedDates).toBe(1);
  });
});

/* ------------------------------------------------------------ photo cadence */

describe('progress-photo cadence', () => {
  it('divides the span by the gaps actually measured', () => {
    const d = at({
      media: [media({ id: 'm1', takenOn: '2026-01-01' }), media({ id: 'm2', takenOn: '2026-01-31' })]
    });
    expect(d.photos).toMatchObject({ state: 'scored', shots: 2, spanDays: 30, gapsMeasured: 1, everyDays: 30 });
    expect(d.photos.rule).toMatch(/last shot date/);
  });

  it('from sparse dates averages the real gaps, not a schedule', () => {
    const d = at({
      media: [
        media({ id: 'm1', takenOn: '2026-01-01' }),
        media({ id: 'm2', takenOn: '2026-01-16' }),
        media({ id: 'm3', takenOn: '2026-02-15' })
      ]
    });
    // 45 days across 2 measured gaps.
    expect(d.photos.gapsMeasured).toBe(2);
    expect(d.photos.spanDays).toBe(daysBetween('2026-01-01', '2026-02-15'));
    expect(d.photos.everyDays).toBe(22.5);
    expect(d.photos.sinceLastDays).toBe(daysBetween('2026-02-15', TODAY));
    expect(d.photos.firstOn).toBe('2026-01-01');
    expect(d.photos.lastOn).toBe('2026-02-15');
  });

  it('one shot gives no cadence and says so', () => {
    const d = at({ media: [media({ takenOn: '2026-11-02' })] });
    expect(d.photos.state).toBe('nothing-scheduled');
    expect(d.photos.shots).toBe(1);
    expect(d.photos.everyDays).toBeNull();
    expect(d.photos.sinceLastDays).toBe(10);
    expect(d.photos.reason).toMatch(/second point/);
  });

  it('counts baselines separately and skips undated rows', () => {
    const d = at({
      media: [media({ id: 'm1', takenOn: '' }), media({ id: 'm2', kind: 'baseline', takenOn: '2026-10-01' })]
    });
    expect(d.photos.shots).toBe(0);
    expect(d.photos.baselines).toBe(1);
  });
});

/* ----------------------------------------------------------- plan actions */

describe('plan-action adherence', () => {
  it('scores a daily action over the elapsed days of the window', () => {
    const d = at({ plans: [plan([action({ doneOn: [MON, '2026-11-10'] })])] });
    const a = actionsById(d).a1;
    expect(a).toMatchObject({ scheduled: 4, n: 2, pct: 50, cadence: 'daily' });
    expect(a.doneDates).toEqual([MON, '2026-11-10']);
  });

  it('schedules a weekly action only on its weekday', () => {
    const d = at({ plans: [plan([action({ cadence: 'weekly', weekday: 1, doneOn: [MON] })])] });
    expect(actionsById(d).a1).toMatchObject({ scheduled: 1, n: 1, pct: 100 });
  });

  it('schedules a once action on its due date only', () => {
    const due = at({ plans: [plan([action({ cadence: 'once', dayOffset: 2, doneOn: ['2026-11-11'] })])] });
    expect(actionsById(due).a1).toMatchObject({ scheduled: 1, n: 1, pct: 100 });
    const notYet = at({ plans: [plan([action({ cadence: 'once', dayOffset: 30, doneOn: [] })])] });
    expect(actionsById(notYet).a1.scheduled).toBe(0);
    expect(actionsById(notYet).a1.pct).toBeNull();
  });

  it('respects the plan weeks the action itself declares', () => {
    // weeks: [3] means this action only runs in plan week 3, which is not this window.
    const d = at({ plans: [plan([action({ weeks: [3], doneOn: [MON] })])] });
    expect(actionsById(d).a1.scheduled).toBe(0);
    expect(actionsById(d).a1.n).toBe(1); // the log is real, the schedule is not
    expect(actionsById(d).a1.state).toBe('nothing-scheduled');
  });

  it('does not schedule days before the plan started', () => {
    const d = at({ plans: [plan([action()], { startOn: '2026-11-11' })] });
    expect(actionsById(d).a1.scheduled).toBe(2);
  });

  it('lists a scheduled-but-zero action as a gap and as the thing slipping', () => {
    const d = at({
      routines: [routine()],
      routineLogs: [log({ doneOn: MON })],
      plans: [plan([action({ id: 'a2', label: 'Retinoid nights', cadence: 'weekly', weekday: 3, doneOn: [] })])]
    });
    expect(d.gaps.map((g) => g.label)).toEqual(['Retinoid nights']);
    expect(d.slipping?.label).toBe('Retinoid nights');
    expect(d.slipping).toMatchObject({ n: 0, scheduled: 1, pct: 0, missed: 1 });
    expect(routinesById(d).r1.n).toBe(1);
  });

  it('reads doneOn dates outside the window without moving the numerator', () => {
    const d = at({ plans: [plan([action({ doneOn: ['2026-10-01', '2026-10-02', MON] })])] });
    expect(actionsById(d).a1.n).toBe(1);
  });
});

/* ------------------------------------------------------------------ totals */

describe('week totals', () => {
  it('are literally occurrences over scheduled occurrences', () => {
    const d = at({
      routines: [routine()],
      routineLogs: [log({ doneOn: MON }), log({ id: 'l2', doneOn: '2026-11-10' })],
      plans: [plan([action({ id: 'a1', doneOn: [MON, '2026-11-10', '2026-11-11', TODAY] })])]
    });
    expect(d.totals.n).toBe(6);
    expect(d.totals.scheduled).toBe(8);
    expect(d.totals.ratio).toBe('6/8');
    expect(d.totals.pct).toBe(75);
    expect(d.totals.missed).toBe(2);
    expect(d.week).toMatchObject({ start: MON, end: SUNDAY, today: TODAY, elapsedDays: 4, futureDays: 3 });
  });

  it('keeps future days out of the schedule', () => {
    const d = at({ routines: [routine()] });
    expect(d.cells.slice(4).every((c) => c.isFuture && c.scheduled === 0 && c.state === 'unscheduled')).toBe(true);
  });

  it('exposes the printed rules so the UI can quote them', () => {
    const d = at();
    expect(d.rules.map((r) => r.label)).toEqual([
      'Window',
      'Routine denominator',
      'Action denominator',
      'Partial day',
      'Streak',
      'Photo cadence',
      'Zero denominators'
    ]);
  });
});

/* ------------------------------------------------------------- the card UI */

describe('the dashboard card', () => {
  const render = (d: ReturnType<typeof digest>): string =>
    renderTree(createElement(MemoryRouter, null, createElement(ConsistencyBody, { d }))).container.innerHTML.replace(
      /<!--[^]*?-->/g,
      ''
    );

  it('renders the honest empty state, with seven real cells, when nothing is logged', () => {
    const html = render(at());
    expect(html).toContain('Log a routine for a week and this fills in. Nothing here is estimated.');
    expect(html.match(/class="gl-cons__day"/g)).toHaveLength(7);
    expect(html.match(/data-state="unscheduled"/g)!.length).toBeGreaterThanOrEqual(7);
    expect(html).not.toMatch(/NaN|undefined|\bnull%/);
  });

  it('shows counts, meters and the slipping line for a logged week', () => {
    const html = render(
      at({
        routines: [routine({ steps: [step('s1', 'Cleanser'), step('s2', 'Retinoid')] })],
        routineLogs: [
          log({ id: 'l1', doneOn: MON, completedSteps: ['s1', 's2'] }),
          log({ id: 'l2', doneOn: '2026-11-10', completedSteps: ['s1'] })
        ],
        plans: [plan([action({ id: 'a9', label: 'Retinoid nights', cadence: 'weekly', weekday: 5, doneOn: [] })])]
      })
    );
    expect(html).toContain('What is slipping');
    expect(html).toContain('2/4'); // the routine meter: two logged days over four scheduled
    expect(html).toContain('2 of 4 scheduled occurrences logged');
    expect(html).toContain('gl-meter__fill');
    expect(html).toContain('data-state="done"');
    expect(html).toContain('data-state="partial"');
    expect(html).toContain('data-state="nothing"');
    expect(html).toContain('Retinoid');
    expect(html).toContain('puts no occurrence in these seven days');
    expect(html).not.toMatch(/NaN|undefined|\bnull%/);
  });
});
