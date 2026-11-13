import { describe, expect, it } from 'vitest';
import { PAIRING_RULE_SENTENCE, WEEK_RULE_SENTENCE, planWeek, weekDates, type WeekOptions } from '../engine/rotation';
import { colourOf, type PieceColour } from '../engine/pairing';
import type { AnyRow } from '../db/schema';

/**
 * A week is the single-day draw run against a shrinking pile. These tests hold
 * the two things that make that trustworthy: no piece is committed twice, and a
 * day the closet cannot dress is reported as undressed rather than padded with
 * a repeat or a garment she does not own.
 */

const START = '2026-11-16';

const p = (id: string, category: string, over: Partial<AnyRow> = {}): AnyRow =>
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

const wopts = (over: Partial<WeekOptions> = {}): WeekOptions => ({
  startDate: START,
  days: 7,
  season: '',
  occasion: '',
  useOuterwear: false,
  ...over
});

/** One full set of `n` pieces in each of the four slots the draw always wants. */
function wardrobe(n: number): AnyRow[] {
  const out: AnyRow[] = [];
  for (let i = 1; i <= n; i += 1) {
    out.push(p(`t${i}`, 'Tops'), p(`b${i}`, 'Bottoms'), p(`s${i}`, 'Footwear'), p(`g${i}`, 'Bags'));
  }
  return out;
}

const wornOn = (w: ReturnType<typeof planWeek>, id: string) => w.usedOn[id];
const piecesOn = (w: ReturnType<typeof planWeek>, date: string) =>
  (w.days.find((d) => d.date === date)?.taken ?? []).map((t) => t.id);

describe('weekDates', () => {
  it('walks the calendar forward, including across a month and a year', () => {
    expect(weekDates('2026-11-16', 3)).toEqual(['2026-11-16', '2026-11-17', '2026-11-18']);
    expect(weekDates('2026-11-30', 2)).toEqual(['2026-11-30', '2026-12-01']);
    expect(weekDates('2026-12-31', 2)).toEqual(['2026-12-31', '2027-01-01']);
    expect(weekDates('2024-02-28', 3)).toEqual(['2024-02-28', '2024-02-29', '2024-03-01']);
  });

  it('produces nothing for a date it cannot read or a span it was not given', () => {
    expect(weekDates('', 7)).toEqual([]);
    expect(weekDates('next tuesday', 7)).toEqual([]);
    expect(weekDates(START, 0)).toEqual([]);
    expect(weekDates(START, -3)).toEqual([]);
  });
});

describe('planning a week', () => {
  it('never commits a piece to two days', () => {
    const w = planWeek(wardrobe(3), [], wopts());
    expect(w.days.map((d) => d.date)).toEqual(weekDates(START, 3));
    const ids = Object.keys(w.usedOn);
    expect(ids).toHaveLength(12);
    expect(new Set(ids).size).toBe(12);
    /* every day wears something different in every slot */
    for (const slot of ['Top', 'Bottom', 'Shoes', 'Bag'] as const) {
      const bySlot = w.days.map((d) => d.taken.find((t) => t.slot === slot)!.id);
      expect(new Set(bySlot).size).toBe(bySlot.length);
    }
  });

  it('stops with the reason when the pile runs out instead of repeating itself', () => {
    const w = planWeek(wardrobe(2), [], wopts());
    expect(w.days).toHaveLength(2);
    const stops = w.gaps.filter((g) => g.includes('nothing left to draw'));
    expect(stops).toHaveLength(5);
    expect(stops[0]).toContain(`${weekDates(START, 3)[2]}`);
    expect(w.notes[0]).toContain('2 of 7 days dressed from 8 pieces — 8 committed, 0 still untouched in the closet');
  });

  it('says which day could not be dressed and does not hide the half-look', () => {
    const rows = [
      p('t1', 'Tops'),
      p('b1', 'Bottoms'),
      p('b2', 'Bottoms'),
      p('s1', 'Footwear'),
      p('s2', 'Footwear'),
      p('g1', 'Bags'),
      p('g2', 'Bags')
    ];
    const w = planWeek(rows, [], wopts({ days: 2 }));
    expect(w.days).toHaveLength(2);
    expect(piecesOn(w, weekDates(START, 2)[1])).toEqual(['b2', 's2', 'g2']);
    expect(w.days[1].unfilled).toEqual(['Top']);
    expect(w.days[1].complete).toBe(false);
    /* the day keeps its own reason; the week list is for days that got nothing */
    expect(w.days[1].gaps.join(' ')).toContain('is categorised as Tops — the top slot stayed empty');
    expect(w.days[1].date).toBe(weekDates(START, 2)[1]);
    expect(w.gaps).toEqual([]);
  });

  it('reports what stayed in the closet, grouped by the slot it could have filled', () => {
    const rows = [...wardrobe(2), p('x1', 'Accessories'), p('x2', 'Knitwear')];
    const w = planWeek(rows, [], wopts({ days: 1 }));
    expect(w.days).toHaveLength(1);
    /* one set used, one set left, plus two pieces the draw can never place */
    expect(w.left.map((l) => `${l.slot}:${l.ids.length}`)).toEqual(['Top:1', 'Bottom:1', 'Shoes:1', 'Bag:1']);
    expect(w.leftUnplaced.map((l) => l.category)).toEqual(['Accessories', 'Knitwear']);
    expect(w.notes.join(' ')).toContain('Still uncommitted: 1 top, 1 bottom, 1 shoes, 1 bag');
  });

  it('offers an outfit she assembled once, not on every day it qualifies for', () => {
    const rows = wardrobe(2);
    const outfits = [{ id: 'o1', name: 'Blue on blue', itemIds: ['t1', 'b1'], lastWornOn: '2026-01-01' }] as unknown as AnyRow[];
    const w = planWeek(rows, outfits, wopts({ days: 2 }));
    expect(w.days[0].plan.kind).toBe('existing-outfit');
    expect(w.days[1].plan.kind).not.toBe('existing-outfit');
    expect(wornOn(w, 't1')).toBe(weekDates(START, 1)[0]);
    /* the second day is a fresh combination, and it cannot be the same outfit */
    expect(piecesOn(w, weekDates(START, 2)[1]).includes('b1')).toBe(false);
  });

  it('places a pinned piece and lets the rest of the week fall around it', () => {
    const w = planWeek(wardrobe(2), [], wopts({ days: 2 }), null, { [START]: { Top: 't2' } });
    expect(piecesOn(w, START)).toEqual(['t2', 'b1', 's1', 'g1']);
    expect(piecesOn(w, weekDates(START, 2)[1])).toEqual(['t1', 'b2', 's2', 'g2']);
  });

  it('drops a pin the pile cannot honour and says why', () => {
    const second = weekDates(START, 2)[1];
    const worn = planWeek(wardrobe(2), [], wopts({ days: 2 }), null, { [second]: { Top: 't1' } });
    expect(worn.notes.join(' ')).toContain('had already been taken by a day before it, so the pin was dropped');
    expect(piecesOn(worn, START)).toContain('t1');
    expect(piecesOn(worn, second)).toContain('t2');

    const wrong = planWeek(wardrobe(2), [], wopts({ days: 1 }), null, { [START]: { Bottom: 't1' } });
    expect(wrong.notes.join(' ')).toContain('is not one of the bottom options the draw produced for that day');
    expect(piecesOn(wrong, START)).toContain('t1');
  });

  it('gives nothing when there is nothing to give', () => {
    const empty = planWeek([], [], wopts());
    expect(empty.days).toEqual([]);
    expect(empty.gaps).toEqual(['The closet holds no clothing items, so there is no week to plan.']);

    const noDates = planWeek(wardrobe(1), [], wopts({ days: 0 }));
    expect(noDates.days).toEqual([]);
    expect(noDates.notes).toEqual(['No dates were asked for, so nothing was drawn.']);

    const badStart = planWeek(wardrobe(1), [], wopts({ startDate: '' }));
    expect(badStart.days).toEqual([]);
  });

  it('inherits the pairing keys rather than re-implementing them', () => {
    const colours = new Map<string, PieceColour>([
      ['t1', colourOf({ typed: ['#4a7ab5'] })],
      ['b1', colourOf({ typed: ['#2f2f2f'] })]
    ]);
    const w = planWeek(wardrobe(2), [], wopts({ days: 1 }), colours);
    expect(w.rule).toContain(PAIRING_RULE_SENTENCE);
    expect(w.days[0].plan.pairing).not.toBeNull();
    const plain = planWeek(wardrobe(2), [], wopts({ days: 1 }));
    expect(plain.days[0].plan.pairing).toBeNull();
    expect(plain.rule).toContain(WEEK_RULE_SENTENCE);
  });

  it('applies the season filter every day, on what is left, and refuses to dress a gap out of season', () => {
    const rows = [
      p('t1', 'Tops', { seasons: ['Winter'] }),
      p('t2', 'Tops', { seasons: ['Winter'] }),
      p('t3', 'Tops', { seasons: ['Summer'] }),
      p('b1', 'Bottoms'),
      p('s1', 'Footwear'),
      p('g1', 'Bags')
    ];
    const w = planWeek(rows, [], wopts({ days: 3, season: 'Winter' }));
    expect(piecesOn(w, weekDates(START, 1)[0])).toEqual(['t1', 'b1', 's1', 'g1']);
    /* day two has a top and nothing else — a half-look, said out loud */
    expect(piecesOn(w, weekDates(START, 2)[1])).toEqual(['t2']);
    expect(w.days[1].unfilled).toEqual(['Bottom']);
    /* day three could only reach the summer top, so it is not dressed at all */
    expect(w.days).toHaveLength(2);
    const third = weekDates(START, 3)[2];
    expect(w.gaps.join(' ')).toContain('No top available: 1 in that category exist, but none carry Winter or All-season');
    expect(w.gaps.join(' ')).toContain(`${third}: the draw could place nothing`);
    expect(wornOn(w, 't3')).toBeUndefined();
    expect(w.left.find((l) => l.slot === 'Top')!.ids).toEqual(['t3']);
    expect(w.notes.join(' ')).toContain('The week stopped early with 1 piece unused');
  });

  it('is arithmetic, not a forecast: the same closet gives the same week', () => {
    const rows = wardrobe(3);
    const outfits = [{ id: 'o1', name: 'Old', itemIds: ['t1', 'b1'], lastWornOn: '2026-02-02' }] as unknown as AnyRow[];
    const a = planWeek(rows, outfits, wopts());
    const b = planWeek(rows, outfits, wopts());
    expect(a.days.map((d) => d.date)).toEqual(b.days.map((d) => d.date));
    expect(a.days.map((d) => d.taken.map((t) => `${t.slot}=${t.id}`))).toEqual(b.days.map((d) => d.taken.map((t) => `${t.slot}=${t.id}`)));
  });

  it('only ever puts on pieces she owns and never claims re-wearing is wrong', () => {
    const rows = wardrobe(2);
    const owned = new Set(rows.map((r) => String(r.id)));
    const w = planWeek(rows, [], wopts());
    for (const d of w.days) for (const t of d.taken) expect(owned.has(t.id)).toBe(true);
    expect(w.notes.join(' ')).toContain('That is an arithmetic choice, not advice');
    expect(WEEK_RULE_SENTENCE).toContain('no piece is committed twice');
  });
});
