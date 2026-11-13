import { describe, expect, it } from 'vitest';
import { ADHERENCE_WINDOW_DAYS, GOAL_SOURCE_RULE_VERSION, SESSION_WINDOW_DAYS, commitNote, offersForGoal } from '../engine/goalSources';
import type { GoalTables } from '../engine/goalSources';

/**
 * The offers a goal can be filled from. What is being tested is not arithmetic
 * but restraint: a number is only offered when the metric on the goal row and
 * the table it comes from actually name the same thing, and the rule that made
 * it travels with it.
 */

const TODAY = '2026-11-12';

/** the engine reads these columns and no others, so the tests need no base fields */
function T(tables: Record<string, Record<string, unknown>[]>): GoalTables {
  return tables as unknown as GoalTables;
}

function at(daysAgo: number): string {
  const d = new Date(Date.UTC(2026, 10, 12));
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

const goal = (metric: string, unit = '', current?: number) =>
  ({ id: 'g1', metric, unit, targetValue: 1, title: 'a goal', status: 'active', data: current === undefined ? {} : { current } }) as never;

describe('naming the same thing', () => {
  it('says so when the goal row has no metric to look for', () => {
    const out = offersForGoal(goal('   '), T({}), { today: TODAY });
    expect(out.offers).toHaveLength(0);
    expect(out.notes[0]).toContain('No metric is named');
    expect(out.metric).toBe('');
  });

  it('offers the newest check-in whose metric matches, as typed', () => {
    const out = offersForGoal(
      goal('waist circumference'),
      T({
        progressEntries: [
          { id: 'e1', metric: 'Waist Circumference', value: 91, unit: 'cm', on: at(40) },
          { id: 'e2', metric: 'waist circumference', value: 88, unit: 'cm', on: at(6) },
          { id: 'e3', metric: 'hips', value: 100, unit: 'cm', on: at(1) }
        ]
      }),
      { today: TODAY }
    );
    const offer = out.offers.find((o) => o.source === 'progressEntries');
    expect(offer?.value).toBe(88);
    expect(offer?.on).toBe(at(6));
    expect(offer?.rule).toContain('most recent progress entry');
    expect(out.offers.find((o) => o.label.includes('hips'))).toBeUndefined();
  });

  it('skips a soft-deleted row and an unnumbered one rather than reaching past them', () => {
    const out = offersForGoal(
      goal('waist'),
      T({
        progressEntries: [
          { id: 'a', metric: 'waist', value: 70, unit: 'cm', on: at(1) },
          { id: 'b', metric: 'waist', value: 88, unit: 'cm', on: at(4), deletedAt: 1 },
          { id: 'c', metric: 'waist', value: '', unit: 'cm', on: at(2) }
        ]
      }),
      { today: TODAY }
    );
    expect(out.offers[0]?.value).toBe(70);
    expect(out.offers[0]?.rowId).toBe('a');
  });

  it('reads a measurement by site name, carrying the unit it was stored in', () => {
    const out = offersForGoal(
      goal('waist'),
      T({
        measurements: [
          { id: 'm1', site: 'Waist (navel)', kind: 'body', value: 92, unit: 'cm', takenOn: at(30), method: 'tape' },
          { id: 'm2', site: 'Neck', kind: 'body', value: 34, unit: 'cm', takenOn: at(2), method: 'tape' }
        ]
      }),
      { today: TODAY }
    );
    const offer = out.offers.find((o) => o.source === 'measurements');
    expect(offer?.label).toBe('Newest Waist (navel) measurement');
    expect(offer?.value).toBe(92);
    expect(offer?.unit).toBe('cm');
    expect(offer?.rule).toContain('tape');
    expect(offer?.rule).toContain('cannot take one');
  });

  it('does not let a two-letter metric match every site in the body', () => {
    const out = offersForGoal(
      goal('cm'),
      T({ measurements: [{ id: 'm1', site: 'Waist', kind: 'body', value: 92, unit: 'cm', takenOn: at(4), method: 'tape' }] }),
      { today: TODAY }
    );
    expect(out.offers.find((o) => o.source === 'measurements')).toBeUndefined();
  });

  it('flags a unit clash instead of quietly offering inches as centimetres', () => {
    const agree = offersForGoal(
      goal('waist', 'in'),
      T({ measurements: [{ id: 'm1', site: 'Waist', kind: 'body', value: 36, unit: 'in', takenOn: at(4), method: 'tape' }] }),
      { today: TODAY }
    );
    expect(agree.offers.find((o) => o.source === 'measurements')?.unitDiffers).toBe(false);
    const clash = offersForGoal(
      goal('waist', 'in'),
      T({ measurements: [{ id: 'm1', site: 'Waist', kind: 'body', value: 92, unit: 'cm', takenOn: at(4), method: 'tape' }] }),
      { today: TODAY }
    );
    expect(clash.offers.find((o) => o.source === 'measurements')?.unitDiffers).toBe(true);
  });
});

describe('the tables each metric actually belongs to', () => {
  it('takes a weight goal to the weigh-in rows and names the bounce', () => {
    const out = offersForGoal(
      goal('body weight'),
      T({
        weightEntries: [
          { id: 'w1', kg: 61.4, loggedOn: at(20), context: '' },
          { id: 'w2', kg: 60.2, loggedOn: at(3), context: 'morning, fasted' }
        ]
      }),
      { today: TODAY }
    );
    const offer = out.offers.find((o) => o.source === 'weightEntries');
    expect(offer?.value).toBe(60.2);
    expect(offer?.unit).toBe('kg');
    expect(offer?.rule).toContain('morning, fasted');
    expect(offer?.rule).toContain('bounce');
  });

  it('will not hand a lash-length goal the number from a loc appointment', () => {
    const out = offersForGoal(
      goal('lash length'),
      T({ hairRecords: [{ id: 'h1', kind: 'retwist', doneOn: at(5), label: 'retwist', lengthCm: 12 }] }),
      { today: TODAY }
    );
    expect(out.offers.find((o) => o.source === 'hairRecords')).toBeUndefined();
  });

  it('reads hair length only when both halves of the name are there', () => {
    const out = offersForGoal(
      goal('hair length'),
      T({
        hairRecords: [
          { id: 'h1', kind: 'cut', doneOn: at(60), label: 'trim', lengthCm: 8 },
          { id: 'h2', kind: 'note', doneOn: at(4), label: 'measured at the nape', lengthCm: 14 },
          { id: 'h3', kind: 'note', doneOn: at(1), label: 'no number that day' }
        ]
      }),
      { today: TODAY }
    );
    const offer = out.offers.find((o) => o.source === 'hairRecords');
    expect(offer?.value).toBe(14);
    expect(offer?.on).toBe(at(4));
    expect(offer?.rule).toContain('did not measure it');
  });

  it('says when the metric names hair length and nothing holds one', () => {
    const out = offersForGoal(goal('hair length'), T({ hairRecords: [{ id: 'h1', kind: 'cut', doneOn: at(4), label: 'cut', lengthCm: null }] }), {
      today: TODAY
    });
    expect(out.offers).toHaveLength(0);
    expect(out.notes[0]).toContain('no hair record');
  });
});

describe('counts over a window', () => {
  it('counts sessions inside the window and only inside it', () => {
    const out = offersForGoal(
      goal('weekly sessions'),
      T({
        workoutSessions: [{ id: 's1', doneOn: at(0) }, { id: 's2', doneOn: at(6) }, { id: 's3', doneOn: at(7) }, { id: 's4', doneOn: at(30) }, { id: 's5', doneOn: at(-3) }]
      }),
      { today: TODAY }
    );
    const offer = out.offers.find((o) => o.source === 'workoutSessions');
    expect(offer?.value).toBe(2);
    expect(offer?.windowDays).toBe(SESSION_WINDOW_DAYS);
    expect(offer?.rule).toContain('2 workout session row(s)');
    expect(offer?.rule).toContain('none was inferred');
  });

  it('divides adherence by the whole window and prints both numbers', () => {
    const logs = [0, 1, 2, 3, 3, 9].map((n, i) => ({ id: `l${i}`, doneOn: at(n) }));
    const out = offersForGoal(goal('routine adherence'), T({ routineLogs: logs }), { today: TODAY });
    const offer = out.offers.find((o) => o.source === 'routineLogs');
    expect(offer?.value).toBe(Math.round((5 / ADHERENCE_WINDOW_DAYS) * 100));
    expect(offer?.rule).toContain('5 separate date(s)');
    expect(offer?.rule).toContain(`out of ${ADHERENCE_WINDOW_DAYS} days`);
    expect(offer?.rule).toContain('never as a zero');
  });

  it('offers zero sessions as the number it is, without dressing it as a failure', () => {
    const out = offersForGoal(goal('sessions'), T({ workoutSessions: [{ id: 's1', doneOn: at(40) }] }), { today: TODAY });
    const offer = out.offers.find((o) => o.source === 'workoutSessions');
    expect(offer?.value).toBe(0);
    expect(offer?.on).toBeNull();
  });
});

describe('when there is nothing to offer', () => {
  it('names the tables it looked in instead of leaving a blank', () => {
    const out = offersForGoal(goal('jawline definition'), T({}), { today: TODAY });
    expect(out.offers).toHaveLength(0);
    expect(out.notes[0]).toContain('jawline definition');
    expect(out.notes[0]).toContain('only if you type it');
  });

  it('reports weight rows that hold no usable date rather than offering nothing at all', () => {
    const out = offersForGoal(goal('weight'), T({ weightEntries: [{ id: 'w1', kg: 60, loggedOn: 'not a date' }] }), { today: TODAY });
    expect(out.offers).toHaveLength(0);
    expect(out.notes.join(' ')).toContain('usable date and number');
  });
});

describe('writing it back', () => {
  it('carries the version, and the commit note says who applied it', () => {
    expect(GOAL_SOURCE_RULE_VERSION).toBe(1);
    const out = offersForGoal(
      goal('waist'),
      T({ measurements: [{ id: 'm1', site: 'Waist', kind: 'body', value: 92, unit: 'cm', takenOn: at(4), method: 'tape' }] }),
      { today: TODAY }
    );
    const offer = out.offers.find((o) => o.source === 'measurements');
    const note = commitNote(offer!);
    expect(note).toContain('92 cm');
    expect(note).toContain('measurements');
    expect(note).toContain('committed by hand');
    expect(note).toContain('the app applied nothing on its own');
  });
});
