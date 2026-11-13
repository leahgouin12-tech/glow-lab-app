import { describe, expect, it } from 'vitest';
import {
  COVERAGE_LIMIT_SENTENCE,
  DORMANT_DAYS,
  SEASONS,
  closetGlance,
  coverageHeadline,
  coverageOf,
  glanceLines,
  type CoveragePlan
} from '../engine/coverage';
import type { AnyRow } from '../db/schema';

/**
 * Coverage is the whole-closet count nothing else in the app made: per slot,
 * per season, per occasion. These tests hold the two promises that make the
 * number trustworthy — a piece with no season written is counted as reachable
 * *and* reported as unstated, and a hole is printed as a count, never as a
 * shopping list.
 */

const TODAY = '2026-11-13';

const row = (id: string, category: string, over: Partial<AnyRow> = {}): AnyRow =>
  ({
    id,
    name: over.name ?? id,
    category,
    wears: over.wears ?? 0,
    price: over.price ?? null,
    seasons: over.seasons ?? [],
    occasions: over.occasions ?? [],
    data: (over.data as never) ?? {}
  }) as unknown as AnyRow;

const cell = (c: CoveragePlan, slot: string, season: string) =>
  c.slots.find((s) => s.slot === slot)!.cells.find((x) => x.season === season)!;

const said = (c: CoveragePlan) => [...c.gaps, ...c.notes, c.rule, coverageHeadline(c)].join(' ');

describe('closet coverage', () => {
  it('says what it counts and refuses to be a shopping list', () => {
    expect(COVERAGE_LIMIT_SENTENCE).toContain('counts the tags you wrote');
    expect(COVERAGE_LIMIT_SENTENCE).toContain('not a shopping list');
    expect(SEASONS).toEqual(['Spring', 'Summer', 'Autumn', 'Winter', 'All-season']);
  });

  it('counts a piece tagged for one season in that season only', () => {
    const c = coverageOf([row('coat-1', 'Outerwear', { seasons: ['Winter'] })], TODAY);
    expect(cell(c, 'Outer layer', 'Winter').tagged).toBe(1);
    expect(cell(c, 'Outer layer', 'Winter').wearable).toBe(1);
    expect(cell(c, 'Outer layer', 'Summer').tagged).toBe(0);
    expect(cell(c, 'Outer layer', 'Summer').wearable).toBe(0);
    expect(c.slots.find((s) => s.slot === 'Outer layer')!.emptySeasons).toEqual(['Spring', 'Summer', 'Autumn', 'All-season']);
  });

  it('counts All-season everywhere it is wearable but tags it in one column only', () => {
    const c = coverageOf([row('tee-1', 'Tops', { seasons: ['All-season'] })], TODAY);
    for (const season of ['Spring', 'Summer', 'Autumn', 'Winter']) {
      expect(cell(c, 'Top', season).tagged).toBe(0);
      expect(cell(c, 'Top', season).wearable).toBe(1);
    }
    expect(cell(c, 'Top', 'All-season').tagged).toBe(1);
    expect(c.slots.find((s) => s.slot === 'Top')!.emptySeasons).toEqual([]);
  });

  it('treats a blank season as unreachable-by-filter, and reports it as unstated', () => {
    const c = coverageOf([row('shirt-1', 'Tops'), row('shirt-2', 'Tops', { seasons: ['Summer'] })], TODAY);
    const top = c.slots.find((s) => s.slot === 'Top')!;
    expect(top.pieces).toBe(2);
    expect(top.unstated).toBe(1);
    expect(top.carriesSeason).toBe(1);
    expect(cell(c, 'Top', 'Winter').wearable).toBe(1);
    expect(cell(c, 'Top', 'Winter').tagged).toBe(0);
    expect(c.notes.join(' ')).toContain('1 piece carries no season at all');
    /* the same count appears in the rule text, so the two numbers cannot drift */
    expect(c.rule).toContain('a filter cannot exclude a blank');
  });

  it('reads season tags case-insensitively, the way the draw does', () => {
    const c = coverageOf([row('skirt-1', 'Bottoms', { seasons: ['winter'] })], TODAY);
    expect(cell(c, 'Bottom', 'Winter').tagged).toBe(1);
  });

  it('names a slot nothing can fill and a season nothing can dress', () => {
    const c = coverageOf([row('coat-1', 'Outerwear', { seasons: ['Winter'] })], TODAY);
    expect(c.gaps.join(' ')).toContain('Nothing in the closet is categorised as Bags');
    expect(c.gaps.join(' ')).toContain('Outerwear: 1 piece exists but none can dress Spring, Summer, Autumn');
    expect(c.gaps.join(' ')).toContain('none is All-season, so nothing in this slot is good for every season');
    expect(coverageHeadline(c)).toContain('1 of 6 slots have pieces');
    expect(coverageHeadline(c)).toContain('5 slots empty');
  });

  it('never dresses an empty closet', () => {
    const c = coverageOf([], TODAY);
    expect(c.gaps).toEqual(['The closet holds no pieces, so there is nothing to count.']);
    expect(coverageHeadline(c)).toBe('No pieces logged yet.');
    expect(c.totals.rows).toBe(0);
    expect(c.slots.every((s) => s.pieces === 0)).toBe(true);
  });

  it('splits never-worn from dormant and takes the idlest span per cell', () => {
    const rows = [
      row('a', 'Tops', { seasons: ['Summer'] }),
      row('b', 'Tops', { seasons: ['Summer'], wears: 4, data: { lastWornOn: '2026-11-10' } }),
      row('c', 'Tops', { seasons: ['Summer'], wears: 9, data: { lastWornOn: '2025-01-01' } })
    ];
    const c = coverageOf(rows, TODAY);
    const top = c.slots.find((s) => s.slot === 'Top')!;
    expect(top.neverWorn).toBe(1);
    expect(top.dormant).toBe(1);
    expect(cell(c, 'Top', 'Summer')).toMatchObject({ tagged: 3, wearable: 3, neverWorn: 1 });
    expect(cell(c, 'Top', 'Summer').idlestDays).toBeGreaterThan(DORMANT_DAYS);
    /* a slot whose every piece has a date has no null idle span hiding in it */
    expect(cell(c, 'Top', 'Winter').idlestDays).toBeNull();
  });

  it('groups occasions on her own spelling and says so', () => {
    const rows = [
      row('a', 'Dresses & Sets', { occasions: ['Interview'] }),
      row('b', 'Dresses & Sets', { occasions: ['interview'] }),
      row('c', 'Dresses & Sets', { occasions: ['job interview'] }),
      row('d', 'Dresses & Sets')
    ];
    const c = coverageOf(rows, TODAY);
    expect(c.occasions.find((o) => o.word === 'Interview')!.pieces).toBe(2);
    expect(c.occasions.find((o) => o.word === 'job interview')!.pieces).toBe(1);
    expect(c.totals.withOccasion).toBe(3);
    expect(c.totals.withoutOccasion).toBe(1);
    expect(c.notes.join(' ')).toContain('grouped only on spelling');
    expect(c.notes.join(' ')).toContain('“interview” and “job interview” would be two');
  });

  it('orders occasions by how many pieces carry them, not by alphabet', () => {
    const rows = [
      row('a', 'Tops', { occasions: ['Gym'] }),
      row('b', 'Tops', { occasions: ['Wedding'] }),
      row('c', 'Tops', { occasions: ['Wedding'] })
    ];
    expect(coverageOf(rows, TODAY).occasions.map((o) => o.word)).toEqual(['Wedding', 'Gym']);
  });

  it('counts a piece the draw cannot place instead of dropping it', () => {
    const rows = [row('a', 'Tops'), row('b', 'Accessories'), row('c', 'Accessories'), row('d', '')];
    const c = coverageOf(rows, TODAY);
    expect(c.totals).toMatchObject({ rows: 4, placeable: 1, unplacable: 3 });
    expect(c.unplacable).toEqual([
      { category: 'Accessories', pieces: 2 },
      { category: '(no category written)', pieces: 1 }
    ]);
    expect(c.notes.join(' ')).toContain('3 of 4 pieces sit in a category that fills no slot');
    expect(c.notes.join(' ')).toContain('left out of every slot row');
  });

  it('compares the category exactly, so a mistyped one shows up as a hole', () => {
    const c = coverageOf([row('a', 'Tops '), row('b', 'tops')], TODAY);
    expect(c.totals.placeable).toBe(0);
    expect(c.slots.find((s) => s.slot === 'Top')!.pieces).toBe(0);
  });

  it('keeps an unpriced piece out of any spend total and says it', () => {
    const c = coverageOf([row('a', 'Tops', { price: 40 }), row('b', 'Tops'), row('c', 'Tops', { price: 0 })], TODAY);
    expect(c.totals.priced).toBe(1);
    expect(c.totals.unpriced).toBe(2);
    expect(c.notes.join(' ')).toContain('2 pieces have no price');
    expect(c.notes.join(' ')).toContain('no total spend is printed here');
  });

  it('reports a closet that covers everything without inventing a gap', () => {
    const rows = [
      row('d', 'Dresses & Sets', { seasons: ['All-season'] }),
      row('t', 'Tops', { seasons: ['All-season'] }),
      row('b', 'Bottoms', { seasons: ['All-season'] }),
      row('o', 'Outerwear', { seasons: ['All-season'] }),
      row('s', 'Footwear', { seasons: ['All-season'] }),
      row('g', 'Bags', { seasons: ['All-season'] })
    ];
    const c = coverageOf(rows, TODAY);
    expect(c.gaps).toEqual([]);
    expect(coverageHeadline(c)).toContain('every slot can dress every season');
  });

  it('promises no product, no price, and no advice about what she needs', () => {
    const c = coverageOf(
      [
        row('a', 'Tops', { seasons: ['Summer'], price: 12 }),
        row('b', 'Accessories', { occasions: ['Gym'] })
      ],
      TODAY
    );
    const text = said(c);
    expect(text).not.toMatch(/\bbuy\b|\bshop for\b|\bpurchase\b|\brecommend\b|\badd to cart\b/i);
    /* "you need" appears exactly once in this file, and only inside the denial */
    expect(text.match(/you need/g) ?? []).toHaveLength(1);
    expect(text).toContain('not a shopping list');
    /* and it never reaches past her rows for a number */
    expect(c.totals.rows).toBe(2);
  });

  it('is a pure count, so the same closet always reads the same', () => {
    const rows = [row('a', 'Tops', { seasons: ['Winter'], occasions: ['Work'] }), row('b', 'Bags')];
    expect(coverageOf(rows, TODAY)).toEqual(coverageOf(rows, TODAY));
  });
});

describe('the dashboard glance', () => {
  const worn = (id: string, category: string, daysAgo: number | null, wears = 1) =>
    row(id, category, {
      wears,
      data: daysAgo === null ? {} : { lastWornOn: iso(daysAgo) }
    });

  /** a date `n` days before TODAY, built the way the engine reads it */
  const iso = (n: number) => {
    const [y, m, d] = TODAY.split('-').map(Number);
    const dt = new Date(y, m - 1, d - n);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  };

  it('has no wait to name before a single piece is logged', () => {
    const g = closetGlance([], TODAY);
    expect(g.headline).toBe('No pieces logged yet.');
    expect(g.sitting).toBeNull();
    expect(glanceLines(g).sitting).toContain('Nothing logged yet');
  });

  it('puts a never-worn piece ahead of one with a recent date', () => {
    const g = closetGlance([worn('b', 'Tops', 1, 3), worn('a', 'Tops', null, 0)], TODAY);
    expect(g.sitting?.name).toBe('a');
    expect(g.sitting?.days).toBeNull();
    expect(glanceLines(g).sitting).toContain('has never been worn and carries no wear date');
  });

  it('takes the longest date when every piece has been worn', () => {
    const g = closetGlance([worn('old', 'Tops', 43, 1), worn('new', 'Bottoms', 5, 9)], TODAY);
    expect(g.sitting?.name).toBe('old');
    expect(g.sitting?.days).toBe(43);
    expect(g.sitting?.slot).toBe('Top');
    expect(glanceLines(g).sitting).toContain('last worn 43 days ago, with 1 wear logged');
  });

  it('uses one day when the arithmetic says one day', () => {
    const g = closetGlance([worn('a', 'Tops', 1, 4)], TODAY);
    expect(g.sitting?.days).toBe(1);
    expect(glanceLines(g).sitting).toContain('1 day ago');
  });

  it('refuses to name a wait when nothing carries a date', () => {
    const g = closetGlance([worn('a', 'Tops', null, 4), worn('b', 'Bottoms', null, 2)], TODAY);
    expect(g.sitting).toBeNull();
    expect(g.undated).toBe(2);
    expect(glanceLines(g).sitting).toContain('no last-worn date');
    /* the denial has to be true: a count with no date is exactly this case */
    expect(glanceLines(g).sitting).toContain('2 pieces without one');
  });

  it('reports the wear count that disagrees with a bare date', () => {
    const g = closetGlance([row('a', 'Tops', { wears: 0, data: { lastWornOn: iso(20) } })], TODAY);
    expect(g.sitting?.wears).toBe(0);
    expect(glanceLines(g).sitting).toContain('no wears are logged');
    expect(glanceLines(g).sitting).toContain('the number comes from the date alone');
  });

  it('ignores a category the closet cannot place', () => {
    const g = closetGlance([worn('hat', 'Accessories', null, 0), worn('tee', 'Tops', 2, 1)], TODAY);
    expect(g.sitting?.name).toBe('tee');
    expect(g.placeable).toBe(1);
    expect(g.rows).toBe(2);
  });

  it('breaks a tie on the name, then the row id, so the card cannot flicker', () => {
    const a = closetGlance([worn('zzz', 'Tops', 30, 1), worn('aaa', 'Tops', 30, 1)], TODAY);
    const b = closetGlance([worn('aaa', 'Tops', 30, 1), worn('zzz', 'Tops', 30, 1)], TODAY);
    expect(a.sitting?.name).toBe('aaa');
    expect(b.sitting?.name).toBe('aaa');
  });

  it('carries the season-hole count the matrix makes, slot by slot', () => {
    const g = closetGlance([row('a', 'Tops', { seasons: ['Winter'] })], TODAY);
    expect(g.seasonHoles).toBe(29);

    const full = closetGlance(
      ['Dresses & Sets|d', 'Tops|t', 'Bottoms|b', 'Outerwear|o', 'Footwear|s', 'Bags|g'].map((spec) => {
        const [category, name] = spec.split('|');
        return row(name, category, { seasons: ['All-season'] });
      }),
      TODAY
    );
    expect(full.seasonHoles).toBe(0);
    expect(full.headline).toContain('every slot can dress every season');
  });

  it('stays arithmetic, so it never becomes advice', () => {
    const g = closetGlance([worn('a', 'Tops', 40, 1), worn('b', 'Bottoms', null, 0)], TODAY);
    const text = [g.headline, glanceLines(g).sitting, glanceLines(g).note].join(' ');
    expect(text).not.toMatch(/\bbuy one\b|\bshop for\b|\bpurchase\b|\brecommend\b|\byou need\b|\byou should\b/i);
    /* the card reports a wait, not the draw's pick — the draw also ranks on
       occasion, cost per wear and pairing evidence it cannot see here */
    expect(text).not.toMatch(/\bwould wear\b|\bthe draw picked\b/i);
    expect(text).toContain('runs on the closet page, not here');
  });

  it('reads the same rows the matrix reads, so the card cannot disagree with the page', () => {
    const rows = [worn('a', 'Tops', 12, 3), worn('b', 'Bags', null, 0), worn('c', 'Stuff', 5, 2)];
    const g = closetGlance(rows, TODAY);
    const c = coverageOf(rows, TODAY);
    expect(g.rows).toBe(c.totals.rows);
    expect(g.placeable).toBe(c.totals.placeable);
    expect(closetGlance(rows, TODAY)).toEqual(g);
  });
});
