import { describe, expect, it } from 'vitest';
import { DEFAULT_PER_DAYS, MIN_POINTS, MIN_SPAN_DAYS, dayIndex, daySpan, isoFromDayIndex, trend, trendByMetric } from '../engine/trend';

/**
 * The trend read is arithmetic on dated numbers she typed, so it is tested as
 * arithmetic: dates in, a fitted line and a scatter figure out, and a refusal
 * when there is not enough of either to claim a direction.
 */

const shift = (iso: string, days: number) => {
  const i = (dayIndex(iso) as number) + days;
  return isoFromDayIndex(i);
};

/** Weekly points, `start` rising by `step` each week. */
const weekly = (start: number, step: number, count: number, from = '2026-01-05') =>
  Array.from({ length: count }, (_, i) => ({ on: shift(from, i * 7), value: start + step * i }));

describe('date parsing', () => {
  it('reads a real calendar date and nothing else', () => {
    expect(dayIndex('2026-03-01')).toBe((dayIndex('2026-02-28') as number) + 1);
    expect(dayIndex('2026-2-3')).toBeNull();
    expect(dayIndex('not a date')).toBeNull();
    expect(dayIndex(undefined)).toBeNull();
    /* Date.UTC would happily roll this forward into March */
    expect(dayIndex('2026-02-31')).toBeNull();
  });

  it('spans dates in whole days and refuses malformed ends', () => {
    expect(daySpan('2026-01-01', '2026-01-31')).toBe(30);
    expect(daySpan('2026-01-31', '2026-01-01')).toBe(-30);
    expect(daySpan('2026-01-01', '')).toBeNull();
  });
});

describe('the fit itself', () => {
  it('calls a clean weekly rise rising, and prints the slope per month', () => {
    const t = trend(weekly(96, -1, 9), { unit: 'cm' });
    expect(t.usable).toBe(true);
    expect(t.direction).toBe('falling');
    expect(t.n).toBe(9);
    expect(t.spanDays).toBe(56);
    /* one cm a week is 30/7 cm over the printed window */
    expect(t.slopePerSpan).toBeCloseTo(-30 / 7, 1);
    expect(t.fittedChange).toBeCloseTo(-8, 1);
    expect(t.r2).toBeGreaterThan(0.99);
    expect(t.rmse).toBeCloseTo(0, 2);
    expect(t.sentence).toContain('read as falling');
    expect(t.sentence).toContain('What you logged, nothing inferred from it.');
  });

  it('says flat when the fitted change is no bigger than the scatter', () => {
    const wobble = [70.4, 69.2, 70.9, 69.5, 70.1, 69.8, 70.6, 69.4, 70.2];
    const points = wobble.map((value, i) => ({ on: shift('2026-01-01', i * 4), value }));
    const t = trend(points, { unit: 'kg' });
    expect(t.usable).toBe(true);
    expect(t.direction).toBe('flat');
    expect(Math.abs(t.fittedChange as number)).toBeLessThan(t.rmse as number);
    expect(t.sentence).toContain('no bigger than the scatter');
    expect(t.sentence).toContain('reads as flat');
  });

  it('treats an unchanged number as measured, not missing', () => {
    const flat = Array.from({ length: 6 }, (_, i) => ({ on: shift('2026-02-01', i * 6), value: 12 }));
    const t = trend(flat, { unit: 'cm' });
    expect(t.direction).toBe('flat');
    expect(t.r2).toBeNull();
    expect(t.sentence).toContain('the same value');
    expect(t.sentence).not.toContain('scatter');
  });

  it('quotes both ends of the series when it does call a direction', () => {
    const t = trend(weekly(60, 2, 8), { unit: 'kg' });
    expect(t.first).toBe(60);
    expect(t.last).toBe(74);
    expect(t.rawChange).toBeCloseTo(14, 6);
    expect(t.sentence).toContain(`60 kg on ${t.from}`);
    expect(t.sentence).toContain(`74 kg on ${t.to}`);
  });
});

describe('the refusal, which is the point of the read', () => {
  it('will not name a direction on four points however long they span', () => {
    const t = trend(weekly(80, -2, MIN_POINTS - 1, '2026-01-01'), { unit: 'cm' });
    expect(t.n).toBe(MIN_POINTS - 1);
    expect(t.usable).toBe(false);
    expect(t.direction).toBe('unknown');
    expect(t.needs.join(' ')).toContain(`${MIN_POINTS - 1} dated points where this read wants ${MIN_POINTS}`);
    expect(t.sentence).toContain('no direction is claimed here');
  });

  it('will not name a direction when the points are dense but the window is short', () => {
    const dense = Array.from({ length: 6 }, (_, i) => ({ on: shift('2026-05-01', i * 3), value: 50 + i }));
    const t = trend(dense, { unit: 'kg' });
    expect(t.n).toBe(6);
    /* 3 days apart, six of them: 15 days of span, under the 21 the read wants */
    expect(t.spanDays).toBe(15);
    expect(t.usable).toBe(false);
    expect(t.direction).toBe('unknown');
    expect(t.needs.join(' ')).toContain(`15 days of span where this read wants ${MIN_SPAN_DAYS}`);
    expect(t.sentence).toContain('no direction is claimed here');
    /* and the same numbers spread weekly do clear the gate */
    expect(trend(dense.map((d, i) => ({ on: shift('2026-05-01', i * 7), value: d.value })), { unit: 'kg' }).usable).toBe(true);
  });

  it('asks for a second point rather than inventing a slope from one', () => {
    const t = trend([{ on: '2026-04-04', value: 71 }], { unit: 'kg' });
    expect(t.direction).toBe('unknown');
    expect(t.sentence).toContain('One reading is a fact, not a direction');
  });

  it('says so plainly when there is nothing dated at all', () => {
    expect(trend([], { unit: 'kg' }).sentence).toContain('Nothing dated to read');
    expect(trend([{ on: '2026-04-0', value: 3 }], { unit: 'kg' }).skipped).toBe(1);
  });

  it('refuses when every point carries the same date, instead of dividing by zero', () => {
    const same = Array.from({ length: 6 }, () => ({ on: '2026-06-06', value: 10 }));
    const t = trend(same, { unit: 'cm' });
    expect(t.sentence).toContain('dated the same day');
    expect(t.usable).toBe(false);
  });

  it('counts what it threw away so a short read is not a mystery', () => {
    const mixed = weekly(70, -1, 6).concat([
      { on: 'garbage', value: 60 },
      { on: '2026-03-03', value: Number.NaN },
      { on: '2026-03-10', value: 61 }
    ]);
    const t = trend(mixed, { unit: 'kg' });
    expect(t.n).toBe(7);
    expect(t.skipped).toBe(2);
    expect(t.sentence).toContain('2 row(s) were skipped');
  });
});

describe('printing windows', () => {
  it('scales the slope to whatever window is asked for', () => {
    const t = trend(weekly(10, 1, 9), { unit: 'kg', perDays: 7 });
    expect(t.perDays).toBe(7);
    expect(DEFAULT_PER_DAYS).toBe(30);
    /* +1 kg a week is +1 kg over a 7-day window */
    expect(t.slopePerSpan).toBeCloseTo(1, 1);
    expect(t.sentence).toContain('per 7 days');
  });
});

describe('grouping the series she already keeps', () => {
  it('keeps metrics and units apart instead of drawing one line through the lot', () => {
    const rows = [
      ...weekly(96, -1, 8).map((p) => ({ ...p, metric: 'Waist', unit: 'cm' })),
      ...weekly(70, -0.5, 8).map((p) => ({ ...p, metric: 'Body weight', unit: 'kg' })),
      { on: '2026-03-03', value: 4, metric: '', unit: 'kg' },
      { on: '2026-03-04', value: null as unknown as number, metric: 'Neck', unit: 'cm' }
    ];
    const reads = trendByMetric(rows as never);
    expect(reads).toHaveLength(2);
    expect(reads.map((r) => r.unit).sort()).toEqual(['cm', 'kg']);
    const waist = reads.find((r) => r.unit === 'cm');
    expect(waist?.n).toBe(8);
    expect(waist?.direction).toBe('falling');
  });

  it('holds a metric with one point, but reports it as unreadable', () => {
    const reads = trendByMetric([{ on: '2026-07-01', value: 91, metric: 'Chest', unit: 'cm' }] as never);
    expect(reads).toHaveLength(1);
    expect(reads[0].usable).toBe(false);
  });

  it('treats a blank measurement as not recorded, never as zero', () => {
    /* a real series around 90 cm with one row whose value was left empty:
      reading the blank as 0 would drop the line to the floor and call it falling */
    const rows = [
      { on: '2026-01-05', value: 92, metric: 'Waist', unit: 'cm' },
      { on: '2026-01-19', value: 91.6, metric: 'Waist', unit: 'cm' },
      { on: '2026-02-02', value: null, metric: 'Waist', unit: 'cm' },
      { on: '2026-02-16', value: '', metric: 'Waist', unit: 'cm' },
      { on: '2026-03-02', value: 91.1, metric: 'Waist', unit: 'cm' },
      { on: '2026-03-16', value: 90.7, metric: 'Waist', unit: 'cm' },
      { on: '2026-03-30', value: 90.2, metric: 'Waist', unit: 'cm' }
    ];
    const reads = trendByMetric(rows as never);
    expect(reads).toHaveLength(1);
    expect(reads[0].n).toBe(5);
    expect(reads[0].skipped).toBe(2);
    /* the real series does fall, gently: about 1.8 cm across the window. Two
      blanks read as 0 would have made it a ~40 cm collapse and a different story */
    expect(reads[0].direction).toBe('falling');
    expect(Math.abs(reads[0].fittedChange as number)).toBeLessThan(3);
    expect(Math.min(reads[0].first as number, reads[0].last as number)).toBeGreaterThan(80);
  });
});
