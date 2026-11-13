import { describe, expect, it } from 'vitest';
import { digest, type ConsistencyInput } from '../engine/consistency';
import {
  DERAILMENT_RULE,
  DERAILMENT_TRIGGERS,
  attach,
  followUpsDue,
  isListedTrigger,
  kindLabel,
  liveRecords,
  recordFromRow,
  recordsAt,
  readLine,
  schedKeyOf,
  tallyByTrigger,
  triggerLabel,
  type SchedItem
} from '../engine/derailment';
import type { AnyRow } from '../db/schema';

/**
 * The derailment record, held to one promise: it explains a miss and never
 * removes one. These tests run the same digest twice — once with no records,
 * once with a record against the very day that was missed — and require every
 * scheduled/done/missed number, ratio and streak to be identical, while the
 * annotation fields are the only thing that moves.
 */

const MON = '2026-11-09'; // a Monday
const TUE = '2026-11-10';
const WED = '2026-11-11';
const TODAY = '2026-11-12'; // the Thursday of that week

const stamp = (iso: string): number => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d, 12).getTime();
};

const row = <T extends Record<string, unknown>>(over: T): AnyRow =>
  ({
    id: 'x',
    createdAt: stamp('2026-01-01'),
    updatedAt: stamp('2026-01-01'),
    deletedAt: null,
    rev: 1,
    deviceId: 'dev',
    tags: [],
    text: '',
    ...over
  }) as unknown as AnyRow;

const routine = (over: Record<string, unknown> = {}): AnyRow =>
  row({ id: 'r1', name: 'Morning skin', domain: 'skin', timeOfDay: 'am', active: true, steps: [], ...over });

/** A routine that began before the window, so all four elapsed days are due. */
const started = (over: Record<string, unknown> = {}): AnyRow =>
  routine({ createdAt: stamp('2026-10-01'), ...over });

const log = (over: Record<string, unknown> = {}): AnyRow =>
  row({ id: 'l1', routineId: 'r1', doneOn: MON, completedSteps: [], mood: 0, note: '', ...over });

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

const derail = (over: Record<string, unknown> = {}): AnyRow =>
  row({
    id: 'd1',
    on: TUE,
    kind: 'routine',
    refId: 'r1',
    refLabel: 'Morning skin',
    trigger: 'illness',
    reason: 'Fever from the morning.',
    fix: 'Went to bed instead.',
    followUpOn: null,
    status: 'open',
    resolvedOn: null,
    ...over
  });

const empty: ConsistencyInput = { routines: [], routineLogs: [], plans: [], sessions: [], media: [] };
const at = (over: Partial<ConsistencyInput> = {}) => digest({ ...empty, ...over }, { today: TODAY });

/** A week with one routine, logged Monday only: Tuesday is the miss. */
const missedWeek = (derailments: AnyRow[]): ConsistencyInput => ({
  routines: [started()],
  routineLogs: [log({ doneOn: MON })],
  plans: [plan([action({ doneOn: [MON] })])],
  sessions: [],
  media: [],
  derailments
});

/**
 * Only the arithmetic this card prints. `explained` and the derailment summary
 * are deliberately excluded: they are the annotation, and they are the only
 * thing a record is allowed to move.
 */
function fingerprint(d: ReturnType<typeof digest>) {
  return {
    week: d.week,
    cells: d.cells.map((c) => ({
      date: c.date,
      scheduled: c.scheduled,
      full: c.full,
      partial: c.partial,
      missed: c.missed,
      logged: c.logged,
      state: c.state,
      isToday: c.isToday,
      isFuture: c.isFuture
    })),
    routines: d.routines.map((r) => ({
      id: r.id,
      n: r.n,
      scheduled: r.scheduled,
      ratio: r.ratio,
      pct: r.pct,
      state: r.state,
      fullDays: r.fullDays,
      partialDays: r.partialDays,
      missedDays: r.missedDays,
      missedDates: r.missedDates,
      streak: r.streak
    })),
    actions: d.actions.map((a) => ({
      id: a.id,
      n: a.n,
      scheduled: a.scheduled,
      ratio: a.ratio,
      pct: a.pct,
      state: a.state,
      doneDates: a.doneDates,
      missedDates: a.missedDates
    })),
    totals: { n: d.totals.n, scheduled: d.totals.scheduled, ratio: d.totals.ratio, pct: d.totals.pct, missed: d.totals.missed },
    streaks: d.streaks,
    photos: d.photos,
    workouts: d.workouts,
    gaps: d.gaps,
    slipping: d.slipping,
    stepEvidence: d.stepEvidence,
    mostSkippedStep: d.mostSkippedStep,
    hasActivity: d.hasActivity,
    hasSchedule: d.hasSchedule
  };
}

/* ------------------------------------------------------------------ the rule */

describe('the invariant, stated once', () => {
  it('is one plain line saying a record explains a miss and never removes it', () => {
    expect(DERAILMENT_RULE).toMatch(/^A derailment record explains a missed day; it never removes one\./);
    expect(DERAILMENT_RULE).toContain('scheduled, done and missed counts');
    expect(DERAILMENT_RULE).toContain('streaks');
    expect(DERAILMENT_RULE.split('.')).toHaveLength(3);
    const d = at(missedWeek([derail()]));
    const rule = d.rules.find((r) => r.label === 'Derailment record');
    expect(rule?.value).toBe(DERAILMENT_RULE);
  });

  it('is only added for callers that were given the table at all', () => {
    expect(at().rules.map((r) => r.label)).not.toContain('Derailment record');
    expect(at({ derailments: [] }).rules.map((r) => r.label)).toContain('Derailment record');
  });
});

/* ----------------------------------------------------------------- the list */

describe('the trigger list', () => {
  it('is fixed at ten values, each with a label and an ask', () => {
    expect(DERAILMENT_TRIGGERS).toHaveLength(10);
    expect(new Set(DERAILMENT_TRIGGERS.map((t) => t.value)).size).toBe(10);
    for (const t of DERAILMENT_TRIGGERS) {
      expect(t.label.trim().length).toBeGreaterThan(0);
      expect(t.ask.trim().length).toBeGreaterThan(0);
      expect(isListedTrigger(t.value)).toBe(true);
    }
    expect(DERAILMENT_TRIGGERS.map((t) => t.value)).toContain('appearance-priority');
  });

  it('prints an unlisted value as she saved it, never as a guess', () => {
    expect(triggerLabel('car_crash')).toBe('car_crash');
    expect(triggerLabel('')).toBe('no label chosen');
    expect(triggerLabel(undefined)).toBe('no label chosen');
    expect(isListedTrigger('car_crash')).toBe(false);
    expect(kindLabel('routine')).toBe('a routine');
    expect(kindLabel('nonsense')).toBe('that day, with nothing attached to it');
  });

  it('drops a row whose date cannot be read and coerces an unknown kind to general', () => {
    expect(recordFromRow(derail({ on: 'not a day' }))).toBeNull();
    expect(recordFromRow(derail({ on: '' }))).toBeNull();
    const coerced = recordFromRow(derail({ kind: 'mystery' }));
    expect(coerced?.kind).toBe('general');
    const blankRef = recordFromRow(derail({ refId: '' }));
    expect(blankRef?.refId).toBeNull();
    const unparsed = recordFromRow(derail({ status: 'done', followUpOn: '31 Nov 2026' }));
    expect(unparsed?.status).toBe('open');
    expect(unparsed?.followUpOn).toBeNull();
  });
});

/* -------------------------------------------------------- the headline proof */

describe('a record never moves a count', () => {
  it('leaves every number, ratio and streak byte-for-byte identical to no record', () => {
    const before = at(missedWeek([]));
    const after = at(missedWeek([derail({ on: TUE, kind: 'routine', refId: 'r1' })]));

    // sanity: the fixture really does have a miss on Tuesday
    const tue = before.cells.find((c) => c.date === TUE);
    expect(tue?.missed).toBeGreaterThan(0);
    expect(before.routines[0].missedDates).toContain(TUE);

    expect(fingerprint(after)).toEqual(fingerprint(before));

    // and the annotation is the only thing that changed
    expect(before.cells.find((c) => c.date === TUE)?.explained).toBe(false);
    expect(after.cells.find((c) => c.date === TUE)?.explained).toBe(true);
    expect(before.routines[0].explained).toBe(false);
    expect(after.routines[0].explained).toBe(true);
    expect(after.derailments.recorded).toBe(1);
    expect(before.derailments.recorded).toBe(0);
  });

  it('does not move them when the record is a whole-day one either', () => {
    const before = at(missedWeek([]));
    const after = at(missedWeek([derail({ on: WED, kind: 'general', refId: null, refLabel: '' })]));
    expect(fingerprint(after)).toEqual(fingerprint(before));
    expect(after.cells.find((c) => c.date === WED)?.explained).toBe(true);
    expect(after.derailments.explainedDays).toBe(1);
  });

  it('survives resolving, editing and a second record on the same day', () => {
    const base = missedWeek([]);
    const before = at(base);
    const many = at({
      ...base,
      derailments: [
        derail({ id: 'd1' }),
        derail({ id: 'd2', trigger: 'sleep', status: 'resolved', resolvedOn: TODAY }),
        derail({ id: 'd3', on: WED, kind: 'general', refId: null })
      ]
    });
    expect(fingerprint(many)).toEqual(fingerprint(before));
    expect(many.derailments.recorded).toBe(3);
    expect(many.derailments.openRecords).toBe(2);
    expect(many.derailments.resolvedRecords).toBe(1);
  });
});

/* ------------------------------------------------------------------- attach */

describe('attach()', () => {
  const keys = (over: Partial<SchedItem> = {}): SchedItem[] => [
    { on: TUE, kind: 'routine', refId: 'r1', ...over }
  ];

  it('matches on on + kind + refId', () => {
    const hit = attach([derail()], keys());
    expect(hit.explains({ on: TUE, kind: 'routine', refId: 'r1' })).toBe(true);
    expect(hit.explainedItems).toBe(1);
    expect(hit.unmatched).toHaveLength(0);
    expect(schedKeyOf(TUE, 'routine', 'r1')).toBe('2026-11-10|routine|r1');
    expect(schedKeyOf(TUE, 'general', null)).toBe('2026-11-10|general|');
  });

  it('will not lend one routine’s record to a different routine', () => {
    const other = attach([derail({ refId: 'r2' })], keys());
    expect(other.explains({ on: TUE, kind: 'routine', refId: 'r1' })).toBe(false);
    expect(other.explainedItems).toBe(0);
    expect(other.unmatched).toHaveLength(1);
  });

  it('tolerates a day-level record against any item scheduled that day', () => {
    const recs = liveRecords([derail({ kind: 'general', refId: null })]);
    expect(recordsAt(recs, { kind: 'routine', refId: 'r1', dates: [TUE] })).toHaveLength(1);
    expect(recordsAt(recs, { kind: 'action', refId: 'a1', dates: [TUE, WED] })).toHaveLength(1);
    expect(recordsAt(recs, { kind: 'routine', refId: 'r1', dates: [WED] })).toHaveLength(0);
    // …but only when it carries no refId: a "general" record about a thing is about that thing
    expect(recordsAt(liveRecords([derail({ kind: 'general', refId: 'r9' })]), { kind: 'routine', refId: 'r1', dates: [TUE] })).toHaveLength(0);
  });

  it('ignores a soft-deleted record and keeps the rest readable', () => {
    const lookup = attach([derail(), derail({ id: 'd2', on: WED, deletedAt: Date.now() })], [
      { on: TUE, kind: 'routine', refId: 'r1' },
      { on: WED, kind: 'routine', refId: 'r1' }
    ]);
    expect(lookup.records).toHaveLength(1);
    expect(lookup.explains({ on: TUE, kind: 'routine', refId: 'r1' })).toBe(true);
    expect(lookup.explains({ on: WED, kind: 'routine', refId: 'r1' })).toBe(false);
    expect(lookup.dayRecords(WED)).toHaveLength(0);
    const d = at(missedWeek([derail({ deletedAt: Date.now() })]));
    expect(d.derailments.recorded).toBe(0);
    expect(d.cells.find((c) => c.date === TUE)?.explained).toBe(false);
  });

  it('still reads a record whose refId points at a row that no longer exists', () => {
    const d = at(missedWeek([derail({ refId: 'r_gone', refLabel: 'Evening retinoid (deleted)' })]));
    expect(d.derailments.recorded).toBe(1);
    expect(d.derailments.danglingRefs).toBe(1);
    expect(d.derailments.items[0].refLabel).toBe('Evening retinoid (deleted)');
    // nothing this week was scheduled for a routine called r_gone, so it matches no miss
    expect(d.derailments.unmatchedRecords).toBe(1);
    expect(fingerprint(d)).toEqual(fingerprint(at(missedWeek([]))));
  });
});

/* -------------------------------------------------------------- tally + due */

describe('tallyByTrigger()', () => {
  it('counts most frequent first, with the dates behind each count', () => {
    const tally = tallyByTrigger([
      derail({ id: 'd1', trigger: 'sleep', on: MON }),
      derail({ id: 'd2', trigger: 'sleep', on: TUE }),
      derail({ id: 'd3', trigger: 'sleep', on: MON }),
      derail({ id: 'd4', trigger: 'illness', on: WED }),
      derail({ id: 'd5', trigger: 'travel', on: TODAY })
    ]);
    expect(tally.map((t) => t.label)).toEqual(['not enough sleep', 'illness', 'travel']);
    expect(tally[0]).toMatchObject({ trigger: 'sleep', count: 3, listed: true });
    expect(tally[0].dates).toEqual([MON, TUE]);
    expect(tally[1].dates).toEqual([WED]);
    expect(tally.reduce((n, t) => n + t.count, 0)).toBe(5);
  });

  it('sorts equal counts by label then by earliest date, and keeps unlisted values visible', () => {
    const tally = tallyByTrigger([
      derail({ id: 'd1', trigger: 'travel', on: WED }),
      derail({ id: 'd2', trigger: 'illness', on: MON }),
      derail({ id: 'd3', trigger: 'zzz_crash', on: TODAY })
    ]);
    expect(tally.map((t) => t.label)).toEqual(['illness', 'travel', 'zzz_crash']);
    expect(tally[2].listed).toBe(false);
    expect(tally[2].label).toBe('zzz_crash');
  });

  it('counts live rows only', () => {
    expect(tallyByTrigger([derail(), derail({ id: 'd2', deletedAt: 1 })]).reduce((n, t) => n + t.count, 0)).toBe(1);
    expect(tallyByTrigger([])).toEqual([]);
  });
});

describe('followUpsDue()', () => {
  it('splits yesterday, today and tomorrow at the date she chose', () => {
    const rows = [
      derail({ id: 'd-yesterday', followUpOn: WED }),
      derail({ id: 'd-today', followUpOn: TODAY, on: MON }),
      derail({ id: 'd-tomorrow', followUpOn: '2026-11-13' }),
      derail({ id: 'd-none', followUpOn: null, on: WED })
    ];
    const due = followUpsDue(rows, TODAY);
    expect(due.map((f) => f.record.id)).toEqual(['d-yesterday', 'd-today']);
    expect(due[0]).toMatchObject({ daysLate: 1, overdue: true, dueToday: false });
    expect(due[1]).toMatchObject({ daysLate: 0, overdue: false, dueToday: true });
  });

  it('oldest promise first, and nothing after it is resolved or unreadable', () => {
    const due = followUpsDue(
      [
        derail({ id: 'd-late', on: MON, followUpOn: '2026-11-02' }),
        derail({ id: 'd-mid', on: TUE, followUpOn: WED }),
        derail({ id: 'd-resolved', on: WED, followUpOn: MON, status: 'resolved', resolvedOn: TODAY }),
        derail({ id: 'd-bad', on: TODAY, followUpOn: 'tomorrow-ish' })
      ],
      TODAY
    );
    expect(due.map((f) => f.record.id)).toEqual(['d-late', 'd-mid']);
    expect(followUpsDue([derail({ followUpOn: WED })], 'not a day')).toEqual([]);
  });

  it('leaves a resolved record out of the open list but keeps it in the summary', () => {
    const d = at(missedWeek([derail({ followUpOn: WED, status: 'resolved', resolvedOn: TODAY })]));
    expect(d.derailments.followUps).toEqual([]);
    expect(d.derailments.openRecords).toBe(0);
    expect(d.derailments.items).toHaveLength(1);
  });
});

/* ---------------------------------------------------------------- read line */

describe('readLine()', () => {
  it('says the counts stand on their own when nothing is recorded', () => {
    const line = readLine([], TODAY);
    expect(line).toContain('Nothing has been recorded as a derailment on this device.');
    expect(line).toContain('the counts above already stand');
    expect(at({ derailments: [] }).derailments.readLine).toBe(line);
  });

  it('names the range, the label and its dates, then states its own limit', () => {
    const only = readLine([derail({ id: 'd1', trigger: 'sleep' }), derail({ id: 'd2', trigger: 'sleep', on: WED })], TODAY);
    expect(only).toContain(`You recorded 2 derailments (${TUE} to ${WED}).`);
    expect(only).toContain('The only label chosen is “not enough sleep” (2 of 2).');
    expect(only).toContain('No follow-up date is open.');
    expect(only).toContain('the most frequent label is you saying so, not a finding about cause');

    const leader = readLine(
      [
        derail({ id: 'd1', trigger: 'sleep' }),
        derail({ id: 'd2', trigger: 'sleep', on: WED }),
        derail({ id: 'd3', trigger: 'travel', on: MON })
      ],
      TODAY
    );
    expect(leader).toContain('Your most-chosen label is “not enough sleep” — 2 of 3, on ');
    expect(leader).toContain(`on ${TUE}, ${WED}`);
  });

  it('refuses to pick a leader when two labels tie, and counts an outstanding follow-up', () => {
    const line = readLine([derail({ id: 'd1', trigger: 'sleep' }), derail({ id: 'd2', trigger: 'illness', on: WED, followUpOn: TODAY })], TODAY);
    expect(line).toContain('No label leads:');
    expect(line).toContain('1 follow-up you set yourself is outstanding');
    expect(line).not.toContain('most-chosen');
  });

  it('keeps the digest’s own summary in step with it', () => {
    const rows = [derail({ id: 'd1' }), derail({ id: 'd2', on: WED, kind: 'general', refId: null })];
    expect(at(missedWeek(rows)).derailments.readLine).toBe(readLine(rows, TODAY));
  });
});
