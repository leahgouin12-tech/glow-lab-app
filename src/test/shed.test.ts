import { describe, expect, it } from 'vitest';
import { CUT_KINDS, SHED_BASES, SHED_LIMIT_NOTE, SHED_RULE_VERSION, basisFor, lengthRead, perDay, shedRead } from '../engine/shed';

/**
 * Shed counts and lengths, from the hair record table she already fills in.
 *
 * The arithmetic worth testing is the ordinary kind — divide by the days the
 * count covers, fit the shared line, and refuse to call one counted wash a
 * pattern. The rest is what the sentences are allowed to say: a cut explains a
 * drop only when a cut is dated inside it, and nothing here explains anything
 * else.
 *
 * Length and kind are columns on the hair record; the counts are new, so they
 * live in `data`, which is what the schema says department extras go in.
 */

function at(daysAgo: number): string {
  const d = new Date(Date.UTC(2026, 10, 12));
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

const hr = (id: string, daysAgo: number, cols: Record<string, unknown> = {}, payload: Record<string, unknown> = {}) =>
  ({ id, kind: 'note', doneOn: at(daysAgo), label: '', lengthCm: null, deletedAt: null, data: payload, ...cols }) as never;

const counted = (id: string, daysAgo: number, count: number, basis: string, variable = '') =>
  hr(id, daysAgo, {}, variable ? { shedCount: count, shedBasis: basis, variableChanged: variable } : { shedCount: count, shedBasis: basis });

describe('the window a count was taken over', () => {
  it('offers five named windows and divides by their days', () => {
    expect(SHED_BASES.map((b) => b.days)).toEqual([1, 1, 1, 3, 7]);
    expect(perDay(120, 'three-days')?.value).toBe(40);
    expect(perDay(120, 'three-days')?.basis.label).toBe('Three days');
    expect(perDay(14, 'week')?.value).toBe(2);
    expect(perDay(96, 'wash')?.value).toBe(96);
  });

  it('reads a label as well as a key, and refuses anything it cannot name', () => {
    expect(basisFor('ONE WASH')?.key).toBe('wash');
    expect(basisFor('fingertips')).toBeNull();
    expect(basisFor(undefined)).toBeNull();
    expect(perDay(50, '')).toBeNull();
    expect(perDay('', 'wash')).toBeNull();
  });

  it('keeps zero as an answer and throws out a negative count', () => {
    expect(perDay(0, 'day')?.value).toBe(0);
    expect(perDay(-3, 'day')).toBeNull();
    expect(perDay('40', 'day')?.value).toBe(40);
  });
});

describe('the shed line', () => {
  it('normalises each count to a day and fits the shared line through them', () => {
    const read = shedRead([
      counted('h1', 56, 120, 'wash'),
      counted('h2', 42, 300, 'three-days'),
      counted('h3', 28, 560, 'week'),
      counted('h4', 14, 84, 'wash'),
      counted('h5', 0, 150, 'three-days')
    ]);
    expect(read.counted).toBe(5);
    expect(read.shed.n).toBe(5);
    expect(read.shed.usable).toBe(true);
    /* 120 after one wash and 150 across three days are the same size of day */
    expect(read.pairs[0]).toMatchObject({ on: at(0), count: 150, perDay: 50 });
    expect(read.pairs[1]).toMatchObject({ on: at(14), perDay: 84 });
    expect(read.sentence).toContain('hairs/day');
  });

  it('will not draw a direction through one counted wash', () => {
    const read = shedRead([counted('h1', 10, 90, 'wash')]);
    expect(read.counted).toBe(1);
    expect(read.shed.usable).toBe(false);
    expect(read.sentence).toContain('not a pattern');
    expect(read.sentence).toContain('no line is drawn');
  });

  it('counts the records that hold no number as not counted, not as zero', () => {
    const read = shedRead([
      counted('h1', 20, 80, 'wash'),
      hr('h2', 14),
      hr('h3', 7, { lengthCm: 12 }),
      hr('h4', 1, {}, { shedCount: '', shedBasis: 'wash' })
    ]);
    expect(read.records).toBe(4);
    expect(read.counted).toBe(1);
    expect(read.noCount).toBe(3);
    expect(read.sentence).toContain('One counted day is not a pattern');
  });

  it('says when a count has no window rather than assuming a day', () => {
    const read = shedRead([hr('h1', 5, {}, { shedCount: 60 })]);
    expect(read.missingWindow).toBe(1);
    expect(read.counted).toBe(0);
    expect(read.sentence).toContain('the window it was counted over');
  });

  it('reads breakage on its own line and says the shed half is empty', () => {
    const read = shedRead([
      hr('h1', 28, {}, { breakageCount: 12, shedBasis: 'wash' }),
      hr('h2', 14, {}, { breakageCount: 9, shedBasis: 'wash' }),
      hr('h3', 0, {}, { breakageCount: 15, shedBasis: 'wash' })
    ]);
    expect(read.counted).toBe(0);
    expect(read.breakage.n).toBe(3);
    expect(read.sentence).toContain('count hairs broken, but none counts hairs shed');
  });

  it('pairs each count with the one variable written beside it', () => {
    const read = shedRead([
      counted('h1', 3, 70, 'wash', 'dropped the new shampoo'),
      counted('h2', 10, 130, 'wash', 'started the new shampoo')
    ]);
    expect(read.pairs[0].variable).toBe('dropped the new shampoo');
    expect(read.pairs[1].variable).toBe('started the new shampoo');
    expect(read.pairs[0].basisLabel).toBe('One wash');
  });

  it('ignores a soft-deleted record and an undated one', () => {
    const deleted = counted('h1', 4, 200, 'wash');
    (deleted as never as { deletedAt: number }).deletedAt = 1;
    const read = shedRead([deleted, { id: 'h2', kind: 'note', doneOn: '', data: { shedCount: 200, shedBasis: 'wash' } } as never]);
    expect(read.records).toBe(0);
    expect(read.sentence).toContain('No dated hair records');
  });
});

describe('length, read against the cuts in the same table', () => {
  it('fits the rise across six readings and keeps the two ends', () => {
    const read = lengthRead([
      hr('a', 60, { lengthCm: 8 }),
      hr('b', 48, { lengthCm: 9 }),
      hr('c', 36, { lengthCm: 10 }),
      hr('d', 24, { lengthCm: 11 }),
      hr('e', 12, { lengthCm: 12.5 }),
      hr('f', 0, { lengthCm: 14, kind: 'trim', label: 'dusting only' })
    ]);
    expect(read.n).toBe(6);
    expect(read.change).toBe(6);
    expect(read.first).toEqual({ on: at(60), cm: 8 });
    expect(read.latest).toEqual({ on: at(0), cm: 14 });
    expect(read.fitted.usable).toBe(true);
    expect(read.sentence).toContain('read as rising');
  });

  it('credits a dated trim for the part of a drop it explains', () => {
    const read = lengthRead([
      hr('a', 60, { lengthCm: 20 }),
      hr('cut', 30, { kind: 'cut', label: 'removed the split ends' }),
      hr('b', 10, { lengthCm: 12 })
    ]);
    expect(read.change).toBe(-8);
    expect(read.cuts).toHaveLength(1);
    expect(read.cuts[0].kind).toBe('cut');
    expect(read.sentence).toContain('a decision you recorded');
    expect(read.sentence).not.toContain('no cut, trim or take-down dated between them');
  });

  it('says plainly when a drop has no cut to attribute it to', () => {
    const read = lengthRead([hr('a', 60, { lengthCm: 20 }), hr('b', 10, { lengthCm: 12 })]);
    expect(read.cuts).toHaveLength(0);
    expect(read.sentence).toContain('no cut, trim or take-down dated between them');
    expect(read.sentence).toContain('cannot tell those apart');
  });

  it('leaves a cut outside the span out of the explanation', () => {
    const read = lengthRead([hr('cut', 90, { kind: 'trim' }), hr('a', 60, { lengthCm: 20 }), hr('b', 10, { lengthCm: 12 })]);
    expect(read.cuts).toHaveLength(0);
    expect(read.sentence).toContain('cannot tell those apart');
  });

  it('has nothing to say when no record holds a length', () => {
    const read = lengthRead([counted('a', 4, 40, 'wash'), hr('b', 20)]);
    expect(read.n).toBe(0);
    expect(read.change).toBeNull();
    expect(read.sentence).toContain('holds a length in cm');
  });

  it('holds one reading as a stored number, not a direction', () => {
    const read = lengthRead([hr('a', 4, { lengthCm: 18 })]);
    expect(read.n).toBe(1);
    expect(read.change).toBe(0);
    expect(read.fitted.usable).toBe(false);
    expect(read.sentence).toContain('not a direction');
  });

  it('uses the same cut kinds the form offers', () => {
    expect(CUT_KINDS).toEqual(expect.arrayContaining(['cut', 'trim', 'take-down']));
  });
});

describe('the limit that travels with the figure', () => {
  it('names what a shed count is not', () => {
    expect(SHED_RULE_VERSION).toBe(1);
    expect(SHED_LIMIT_NOTE).toContain('not a diagnosis');
    expect(SHED_LIMIT_NOTE).toContain('clinician');
  });
});
