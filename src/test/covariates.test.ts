import { describe, expect, it } from 'vitest';
import {
  COVARIATE_FIELDS,
  HIGH_RATING,
  LOW_RATING,
  MIN_DAYS_PER_SIDE,
  MIN_SPLIT_SPAN_DAYS,
  SE_THRESHOLD,
  coverage,
  daysFromRows,
  signalsFromRows,
  splitByRatings
} from '../engine/covariates';

/**
 * The day log is the only place in this app that groups her own rated days, so
 * the tests are about when it is allowed to speak: it compares what she wrote
 * against the scatter of what she wrote, and says nothing when the counts or
 * the spread will not carry a comparison.
 */

const day = (on: string, values: Record<string, number>) => ({ on, values });
const rate = (on: string, value: number, source = 'self-rating') => ({ on, value, source });

/** 2026-01-01 + n days as ISO. */
const at = (n: number) => new Date(Date.UTC(2026, 0, 1 + n)).toISOString().slice(0, 10);

const row = (on: string, data: Record<string, unknown>, updatedAt = 1000) =>
  ({ id: `d-${on}`, on, data, updatedAt, createdAt: updatedAt, deletedAt: null, tags: [], text: '' }) as never;

describe('the fields on offer', () => {
  it('asks for six self-reported numbers and never for a measurement it cannot take', () => {
    expect(COVARIATE_FIELDS.map((f) => f.key)).toEqual([
      'sleepHours',
      'alcoholUnits',
      'waterMl',
      'saltyMeals',
      'stress',
      'cycleDay'
    ]);
    /* every field states what she is being asked to remember, because none of
      them can be read off a device by this app */
    for (const f of COVARIATE_FIELDS) {
      expect(f.ask.length).toBeGreaterThan(20);
      expect(f.max).toBeGreaterThan(f.min);
    }
    const cycle = COVARIATE_FIELDS.find((f) => f.key === 'cycleDay');
    expect(cycle?.optional).toBe(true);
    expect(COVARIATE_FIELDS.filter((f) => f.optional)).toHaveLength(1);
  });
});

describe('shaping rows into days', () => {
  it('keeps one entry per date, with the newer row winning field by field', () => {
    const days = daysFromRows([
      row(at(4), { sleepHours: 6, stress: 4 }, 100),
      row(at(4), { sleepHours: 9, alcoholUnits: 3 }, 200)
    ]);
    expect(days).toHaveLength(1);
    /* the newer row filled sleep with 9; alcohol only exists on the older one */
    expect(days[0].values).toEqual({ sleepHours: 9, alcoholUnits: 3, stress: 4 });
  });

  it('drops a day whose fields are all blank rather than logging a zero', () => {
    const days = daysFromRows([row(at(1), {}), row(at(2), { sleepHours: null, stress: '' })]);
    expect(days).toHaveLength(0);
  });

  it('clamps a number typed outside the range instead of trusting it', () => {
    const days = daysFromRows([row(at(3), { sleepHours: 40, alcoholUnits: -5, stress: 3 })]);
    expect(days[0].values.sleepHours).toBe(14);
    expect(days[0].values.alcoholUnits).toBe(0);
    expect(days[0].values.stress).toBe(3);
  });

  it('ignores rows with no usable date and sorts newest first', () => {
    const days = daysFromRows([row('2026-02-30', { sleepHours: 8 }), row(at(9), { sleepHours: 7 }), row(at(2), { sleepHours: 9 })]);
    expect(days.map((d) => d.on)).toEqual([at(9), at(2)]);
  });

  it('reads a mood off a routine log and a rating off a progress entry', () => {
    const moods = signalsFromRows(
      [
        { id: 'l1', doneOn: at(1), mood: 4 },
        { id: 'l2', doneOn: at(1), mood: 2 },
        { id: 'l3', doneOn: at(2), mood: 0 },
        { id: 'l4', on: at(3), rating: 5 }
      ] as never,
      { field: 'mood', source: 'routine mood', min: 1, max: 5 }
    );
    /* two logs on the same day average to 3, and mood 0 means never filled */
    expect(moods).toEqual([rate(at(1), 3, 'routine mood')]);
  });

  it('averages several ratings written about the same day', () => {
    const signals = signalsFromRows(
      [
        { on: at(5), rating: 5 },
        { on: at(5), rating: 3 },
        { on: at(6), rating: 1 }
      ] as never,
      { field: 'rating', source: 'self-rating' }
    );
    expect(signals).toEqual([rate(at(5), 4), rate(at(6), 1)]);
  });
});

describe('the split when it has enough to divide by', () => {
  /* 6 good days sleeping 8, 5 off days sleeping 5 — spread over two months */
  const goodDays = [0, 10, 20, 30, 40, 50];
  const offDays = [5, 15, 25, 35, 45];
  const days = [
    ...goodDays.map((n) => day(at(n), { sleepHours: 8, alcoholUnits: 0, stress: 2 })),
    ...offDays.map((n) => day(at(n), { sleepHours: 5, alcoholUnits: 3, stress: 4 }))
  ];
  const signals = [...goodDays.map((n) => rate(at(n), 5)), ...offDays.map((n) => rate(at(n), 1))];
  const result = splitByRatings(days, signals);

  it('splits on her own ratings, sets the middles aside and keeps the counts', () => {
    expect(result.nHigh).toBe(6);
    expect(result.nLow).toBe(5);
    expect(result.middleDays).toBe(0);
    expect(result.spanDays).toBe(50);
    expect(result.gate).toBeNull();
    expect(HIGH_RATING).toBe(4);
    expect(LOW_RATING).toBe(2);
  });

  it('calls a gap wider than her own scatter worth a look, and says it is not an explanation', () => {
    const sleep = result.reads.find((r) => r.key === 'sleepHours');
    expect(sleep?.verdict).toBe('worth-a-look');
    expect(sleep?.meanHigh).toBe(8);
    expect(sleep?.meanLow).toBe(5);
    expect(sleep?.gap).toBe(3);
    /* both sides are constant here, so the scatter is 0 and the threshold is 0 */
    expect(sleep?.scatter).toBe(0);
    expect(sleep?.threshold).toBe(0);
    expect(sleep?.sentence).toContain('Worth a look, not an explanation');
    expect(sleep?.sentence).toContain('nothing here says which way it runs');
  });

  it('names the widest gap in the headline without ranking her days for her', () => {
    expect(result.headline).toContain('widest gap');
    expect(result.headline).toContain('6 good days');
    expect(result.note).toContain('Groups are your own ratings, not the app’s');
    expect(result.note).toContain(String(SE_THRESHOLD));
  });

  it('reports a field recorded on one side only as short of days, not as a difference', () => {
    const oneSided = splitByRatings(
      [
        ...goodDays.map((n) => day(at(n), { waterMl: 2000 })),
        ...offDays.map((n) => day(at(n), { sleepHours: 5 }))
      ],
      signals
    );
    const water = oneSided.reads.find((r) => r.key === 'waterMl');
    expect(water?.verdict).toBe('not-recorded');
    expect(water?.loggedLow).toBe(0);
    expect(water?.gap).toBeNull();
    expect(water?.sentence).toContain('Two or more on each side are needed');
  });

  it('says never written when a field is absent from every rated day', () => {
    const fluid = result.reads.find((r) => r.key === 'waterMl');
    expect(fluid?.verdict).toBe('not-recorded');
    expect(fluid?.sentence).toContain('never written on any rated day');
  });

  it('keeps a gap inside her own bounce classed as the size of noise', () => {
    /* sleep wobbles ±1 h on both sides around means 0.4 h apart: the threshold
      from her own scatter is far wider than that */
    const wobbly = [
      ...goodDays.map((n, i) => day(at(n), { sleepHours: 7.5 + (i % 2) })),
      ...offDays.map((n, i) => day(at(n), { sleepHours: 7.1 + (i % 2) }))
    ];
    const read = splitByRatings(wobbly, signals).reads.find((r) => r.key === 'sleepHours');
    expect(read?.verdict).toBe('noise-sized');
    expect((read?.threshold as number)).toBeGreaterThan(Math.abs(read?.gap as number));
    expect(read?.sentence).toContain('size of noise');
    expect(read?.sentence).toContain('calling it anything more would be invention');
  });
});

describe('the split when it does not have enough', () => {
  const days = [day(at(0), { sleepHours: 8 }), day(at(3), { sleepHours: 5 })];
  const few = [rate(at(0), 5), rate(at(3), 1)];

  it('holds the comparison rather than dividing by three days', () => {
    const result = splitByRatings(days, few);
    expect(result.gate).toContain(`${MIN_DAYS_PER_SIDE} are wanted`);
    expect(result.headline).toContain('Split on hold');
    for (const read of result.reads) {
      expect(read.verdict).toBe('too-short');
      expect(read.gap).toBeNull();
      expect(read.sentence).toContain('Held back');
    }
  });

  it('holds a dense but short window even when both sides are populated', () => {
    const dense = [
      ...[0, 1, 2, 3].map((n) => day(at(n), { sleepHours: 8 })),
      ...[4, 5, 6, 7].map((n) => day(at(n), { sleepHours: 6 }))
    ];
    const signals = [...[0, 1, 2, 3].map((n) => rate(at(n), 5)), ...[4, 5, 6, 7].map((n) => rate(at(n), 1))];
    const result = splitByRatings(dense, signals);
    expect(result.nHigh).toBe(MIN_DAYS_PER_SIDE);
    expect(result.spanDays).toBeLessThan(MIN_SPLIT_SPAN_DAYS);
    expect(result.gate).toContain(`${MIN_SPLIT_SPAN_DAYS} are wanted`);
    expect(result.reads.every((r) => r.verdict === 'too-short')).toBe(true);
    expect(result.note).toContain('this is not a verdict about you');
  });

  it('refuses outright when no day row exists yet', () => {
    const result = splitByRatings([], [rate(at(0), 5)]);
    expect(result.headline).toContain('Nothing logged in the day strip yet');
    expect(result.reads.every((r) => r.verdict === 'no-logs')).toBe(true);
    expect(result.note).toContain('only the advice, which stays advice');
  });

  it('refuses the other way when days exist but nothing has been rated', () => {
    const result = splitByRatings([day(at(0), { sleepHours: 7 })], []);
    expect(result.reads[0].verdict).toBe('no-ratings');
    expect(result.headline).toContain('no ratings to split them by');
    expect(result.note).toContain('Nothing is scored for you');
  });

  it('sets a day rated 3 aside instead of forcing it into either side', () => {
    const days = [
      ...[0, 10, 20, 30].map((n) => day(at(n), { sleepHours: 8 })),
      ...[5, 15, 25, 35].map((n) => day(at(n), { sleepHours: 6 }))
    ];
    const signals = [
      ...[0, 10, 20, 30].map((n) => rate(at(n), 5)),
      ...[5, 15, 25, 35].map((n) => rate(at(n), 1)),
      rate(at(12), 3),
      rate(at(22), 3)
    ];
    const result = splitByRatings(days, signals);
    expect(result.middleDays).toBe(2);
    /* all ten rated days are counted, and the two 3s are named as set aside */
    expect(result.ratedDays).toBe(10);
    expect(result.nHigh + result.nLow + result.middleDays).toBe(result.ratedDays);
    expect(result.note).toContain('2 day(s) rated 3 set aside');
  });
});

describe('coverage, which decides what the strip can honestly claim', () => {
  it('counts the days each field was actually recorded on', () => {
    const c = coverage([
      day(at(0), { sleepHours: 8, stress: 3 }),
      day(at(1), { sleepHours: 7 }),
      day(at(2), {})
    ]);
    const byKey = new Map(c.map((x) => [x.key, x.days]));
    expect(byKey.get('sleepHours')).toBe(2);
    expect(byKey.get('stress')).toBe(1);
    expect(byKey.get('cycleDay')).toBe(0);
  });
});
