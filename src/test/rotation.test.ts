import { beforeEach, describe, expect, it } from 'vitest';
import {
  CANDIDATES_PER_SLOT,
  PAIRING_RULE_SENTENCE,
  REPEAT_WINDOW_DAYS,
  RULE_SENTENCE,
  chosenIds,
  daysBetween,
  planLook,
  suggestedName,
  type RotationOptions
} from '../engine/rotation';
import { colourOf, type PieceColour } from '../engine/pairing';
import { TABLES, type AnyRow } from '../db/schema';
import { put } from '../db/repo';
import { db } from '../db/db';

/**
 * The rotation draw is arithmetic over rows she typed, so this file is the
 * contract: what gets picked, what gets set aside, what is admitted out loud
 * when the closet cannot fill a slot — and the promise that nothing she does
 * not own is ever put on her back.
 */

const TODAY = '2026-11-12';

const opts = (over: Partial<RotationOptions> = {}): RotationOptions => ({
  season: '',
  occasion: '',
  today: TODAY,
  useOuterwear: true,
  ...over
});

async function piece(id: string, category: string, over: Partial<{ name: string; wears: number; price: number | null; seasons: string[]; occasions: string[]; lastWornOn: string | null }> = {}) {
  await put(TABLES.clothingItems, {
    id,
    name: over.name ?? id,
    category,
    wears: over.wears ?? 0,
    price: over.price ?? null,
    seasons: over.seasons ?? [],
    occasions: over.occasions ?? [],
    data: { lastWornOn: over.lastWornOn ?? null }
  } as never);
}

async function outfit(id: string, name: string, itemIds: string[], over: Record<string, unknown> = {}) {
  await put(TABLES.outfits, { id, name, itemIds, ...over } as never);
}

async function look(o = opts()) {
  return planLook((await db.clothingItems.toArray()) as AnyRow[], (await db.outfits.toArray()) as AnyRow[], o);
}

const slot = (plan: Awaited<ReturnType<typeof look>>, name: string) => plan.slots.find((s) => s.name === name)!;

beforeEach(async () => {
  await Promise.all(Object.values(TABLES).map((t) => db.table(t).clear()));
});

describe('the rotation draw', () => {
  it('reads a date difference rather than guessing one', () => {
    expect(daysBetween('2026-11-01', TODAY)).toBe(11);
    expect(daysBetween(null, TODAY)).toBeNull();
    expect(daysBetween('not a date', TODAY)).toBeNull();
  });

  it('draws the idlest piece first, and never worn before that', async () => {
    /* "a" is worn yesterday, so the 7-day set-aside would drop it from the slot
      entirely — here every piece must stay in the pile to show the ordering. */
    await piece('a', 'Tops', { name: 'Washed-out grey tee', wears: 40, lastWornOn: '2026-09-01' });
    await piece('b', 'Tops', { name: 'White shirt', wears: 2, lastWornOn: '2026-08-02' });
    await piece('c', 'Tops', { name: 'Second-hand blouse', wears: 0, lastWornOn: null });
    await piece('d', 'Bottoms', { name: 'Jeans', wears: 30, lastWornOn: '2026-06-01' });
    const plan = await look();
    const top = slot(plan, 'Top');
    expect(top.pieces.map((p) => p.id)).toEqual(['c', 'b', 'a']);
    expect(top.pieces[0].reasons.join(' ')).toContain('never worn');
    expect(chosenIds(plan)).toContain('c');
  });

  it('breaks a tie on name, then row id, so the same closet draws the same look twice', async () => {
    await piece('z', 'Tops', { name: 'Same date', wears: 1, lastWornOn: '2026-05-01' });
    await piece('y', 'Tops', { name: 'Same date', wears: 1, lastWornOn: '2026-05-01' });
    await piece('k', 'Bottoms', { name: 'Skirt', wears: 1, lastWornOn: '2026-05-01' });
    const first = await look();
    const second = await look();
    expect(chosenIds(first)).toEqual(chosenIds(second));
    expect(slot(first, 'Top').pieces.map((p) => p.id)).toEqual(['y', 'z']);
  });

  it('uses cost per wear only between equally idle, equally unworn priced pieces', async () => {
    await piece('cheap', 'Tops', { name: 'A', wears: 5, price: 20, lastWornOn: '2026-04-01' });
    await piece('dear', 'Tops', { name: 'B', wears: 5, price: 400, lastWornOn: '2026-04-01' });
    await piece('blank', 'Tops', { name: 'C', wears: 5, price: null, lastWornOn: '2026-04-01' });
    await piece('k', 'Bottoms', { name: 'Trousers', wears: 1, lastWornOn: '2026-01-01' });
    const tops = slot(await look(), 'Top');
    expect(tops.pieces.map((p) => p.id)).toEqual(['dear', 'cheap', 'blank']);
    expect(tops.pieces[2].reasons.join(' ')).toContain('unverified');
  });

  it('sets a recently worn piece aside, and says so when there was nowhere else to go', async () => {
    await piece('fresh', 'Tops', { name: 'Just worn', wears: 3, lastWornOn: '2026-11-11' });
    await piece('idle', 'Tops', { name: 'Waiting', wears: 1, lastWornOn: '2026-02-01' });
    await piece('k', 'Bottoms', { name: 'Trousers', wears: 1, lastWornOn: '2026-02-01' });
    const plan = await look();
    expect(slot(plan, 'Top').pieces.map((p) => p.id)).toEqual(['idle']);
    expect(plan.notes.join(' ')).toContain(`top option was set aside for having been worn in the last ${REPEAT_WINDOW_DAYS} days`);

    await db.clothingItems.delete('idle');
    const alone = await look();
    expect(slot(alone, 'Top').pieces.map((p) => p.id)).toEqual(['fresh']);
    expect(alone.notes.join(' ')).toContain('so the set-aside rule was dropped');
  });

  it('excludes a piece marked for another season but cannot exclude one that carries none', async () => {
    await piece('summer', 'Tops', { name: 'Linen shirt', seasons: ['Summer'] });
    await piece('winter', 'Tops', { name: 'Wool knit', seasons: ['Winter'] });
    await piece('blank', 'Tops', { name: 'Mystery top' });
    await piece('k', 'Bottoms', { name: 'Jeans', seasons: ['All-season'] });
    const plan = await look(opts({ season: 'Winter' }));
    expect(slot(plan, 'Top').pieces.map((p) => p.name).sort()).toEqual(['Mystery top', 'Wool knit']);
    expect(plan.notes.join(' ')).toContain('carry no season, so the season filter could not exclude them either');
  });

  it('reports a slot it cannot fill with the count that produced the gap, and invents nothing', async () => {
    await piece('a', 'Tops', { name: 'Top one' });
    await piece('b', 'Bottoms', { name: 'Bottom one', seasons: ['Summer'] });
    const plan = await look(opts({ season: 'Winter' }));
    expect(plan.slots.map((s) => s.name)).toEqual(['Top']);
    expect(plan.gaps.join(' ')).toContain('No bottom available: 1 in that category exist');
    expect(plan.gaps.join(' ')).toContain('none carry Winter or All-season');
    expect(plan.gaps.join(' ')).toContain('Nothing in the pieces this look was drawn from is categorised as Footwear');
  });

  it('draws a dress instead of a top and a bottom, and admits it did', async () => {
    await piece('dress', 'Dresses & Sets', { name: 'Black dress' });
    await piece('top', 'Tops', { name: 'Top' });
    await piece('bottom', 'Bottoms', { name: 'Bottom' });
    const plan = await look();
    expect(plan.slots.map((s) => s.name)).toEqual(['Dress or set']);
    expect(plan.notes.join(' ')).toContain('A dress or set was available');
  });

  it('only draws an outer layer for the cold, or when no season was picked', async () => {
    await piece('coat', 'Outerwear', { name: 'Coat', seasons: ['Winter'] });
    await piece('top', 'Tops', { name: 'Top' });
    await piece('bottom', 'Bottoms', { name: 'Bottom' });
    expect((await look(opts({ season: 'Winter' }))).slots.map((s) => s.name)).toContain('Outer layer');
    expect((await look(opts({ season: 'Summer' }))).slots.map((s) => s.name)).not.toContain('Outer layer');
    expect((await look(opts({ useOuterwear: false }))).notes.join(' ')).toContain('the switch for it is off');
  });

  it('keeps five alternatives per slot so a swap has somewhere to go', async () => {
    for (let n = 0; n < 8; n += 1) await piece(`t${n}`, 'Tops', { name: `Top ${n}`, lastWornOn: `2026-0${n + 1}-01` });
    await piece('k', 'Bottoms', { name: 'Skirt' });
    const top = slot(await look(), 'Top');
    expect(top.pieces).toHaveLength(CANDIDATES_PER_SLOT);
    /* idlest = longest since it was last worn, so the January piece leads and
      the five kept ones are the five oldest dates, in order. */
    expect(top.pieces.map((p) => p.id)).toEqual(['t0', 't1', 't2', 't3', 't4']);
    expect(top.pieces[0].reasons.join(' ')).toContain('last worn 315 days ago');
  });

  it('offers an idle outfit she already assembled before any new combination', async () => {
    await piece('a', 'Tops', { name: 'Blouse', wears: 3, lastWornOn: '2026-03-03' });
    await piece('b', 'Bottoms', { name: 'Trousers', wears: 3, lastWornOn: '2026-03-03' });
    await outfit('o1', 'Monday uniform', ['a', 'b'], { wornCount: 9, lastWornOn: '2026-03-03' });
    const plan = await look();
    expect(plan.kind).toBe('existing-outfit');
    expect(plan.outfitId).toBe('o1');
    expect(plan.notes.join(' ')).toContain('Monday uniform');
    expect(plan.notes.join(' ')).toContain('9 wears logged');
    expect(chosenIds(plan).sort()).toEqual(['a', 'b']);
  });

  it('leaves a freshly worn outfit alone and builds from the closet instead', async () => {
    await piece('a', 'Tops', { name: 'Blouse', lastWornOn: '2026-11-11' });
    await piece('b', 'Bottoms', { name: 'Trousers', lastWornOn: '2026-11-11' });
    await outfit('o1', 'Monday uniform', ['a', 'b'], { wornCount: 9, lastWornOn: '2026-11-11' });
    const plan = await look();
    expect(plan.kind).toBe('built');
    expect(plan.outfitId).toBeNull();
  });

  it('will not offer an outfit whose season or occasion contradicts the ask', async () => {
    await piece('a', 'Tops', { name: 'Blouse', lastWornOn: '2026-01-01' });
    await piece('b', 'Bottoms', { name: 'Trousers', lastWornOn: '2026-01-01' });
    await outfit('summer', 'Hot-weather set', ['a', 'b'], { season: 'Summer', lastWornOn: '2026-01-01' });
    expect((await look(opts({ season: 'Winter' }))).kind).not.toBe('existing-outfit');
    /* Both rows now declare an occasion, so an ask that reads as neither of them
      must fall back to a new combination, and a matching ask must pick the one
      that declares it rather than the alphabetical winner. */
    await put(TABLES.outfits, { id: 'summer', name: 'Hot-weather set', itemIds: ['a', 'b'], season: 'Summer', occasion: 'Holiday', lastWornOn: '2026-01-01' } as never);
    await outfit('formal', 'Black tie', ['a', 'b'], { occasion: 'Wedding', lastWornOn: '2026-01-01' });
    expect((await look(opts({ occasion: 'Interview' }))).kind).not.toBe('existing-outfit');
    const wedding = await look(opts({ occasion: 'Wedding' }));
    expect(wedding.kind).toBe('existing-outfit');
    expect(wedding.outfitId).toBe('formal');
  });

  it('draws occasion-marked pieces first and says when the word matched nothing', async () => {
    await piece('work', 'Tops', { name: 'Blazer-style top', occasions: ['job interview'], lastWornOn: '2026-02-01' });
    await piece('home', 'Tops', { name: 'Hoodie', occasions: ['Sunday'], lastWornOn: '2026-01-01' });
    await piece('k', 'Bottoms', { name: 'Trousers', lastWornOn: '2026-01-01' });
    const plan = await look(opts({ occasion: 'Interview' }));
    expect(slot(plan, 'Top').pieces[0].id).toBe('work');
    expect(slot(plan, 'Top').pieces[0].reasons.join(' ')).toContain('you marked it “job interview”');

    const none = await look(opts({ occasion: 'funeral' }));
    expect(none.notes.join(' ')).toContain('Nothing in the pile reads as “funeral”');
    expect(slot(none, 'Top').pieces[0].id).toBe('home');
  });

  it('counts pieces in categories it cannot place instead of dropping them silently', async () => {
    await piece('a', 'Knitwear', { name: 'Cardigan' });
    await piece('b', 'Accessories', { name: 'Scarf' });
    await piece('c', 'Tops', { name: 'Tee' });
    await piece('d', 'Bottoms', { name: 'Jeans' });
    const plan = await look();
    expect(plan.notes.join(' ')).toContain('2 of 4 pieces sit in a category this draw does not place');
  });

  it('says plainly that an empty closet has nothing to order', async () => {
    const plan = await look();
    expect(plan.kind).toBe('empty');
    expect(plan.slots).toEqual([]);
    expect(plan.gaps[0]).toContain('No clothing items in the closet');
    expect(plan.poolSize).toBe(0);
  });

  it('names the look from what was actually picked, and prints the rule with it', async () => {
    await piece('a', 'Tops', { name: 'Silk blouse' });
    await piece('b', 'Bottoms', { name: 'Wool trousers' });
    const o = opts({ occasion: 'Work', season: 'Winter' });
    const plan = await look(o);
    expect(chosenIds(plan)).toEqual(['a', 'b']);
    expect(suggestedName(plan, o)).toBe('Silk blouse + Wool trousers — Work, Winter');
    expect(plan.rule).toBe(RULE_SENTENCE);
  });
});

/**
 * The second layer. These are the tests that hold the promise the rotation draw
 * made when it stopped being only a sort: the pairing keys may change which
 * candidate a slot takes, they must say which key did it, they must never move
 * anything when they have nothing to say, and the denominators of what could be
 * read have to be printed in the same plan that used them.
 */
const reads = (over: Record<string, { photo?: string[]; typed?: string[] }>) =>
  new Map<string, PieceColour>(Object.entries(over).map(([id, v]) => [id, colourOf({ photograph: v.photo, typed: v.typed })]));

async function lookWith(map: Map<string, PieceColour> | null, o = opts()) {
  return planLook((await db.clothingItems.toArray()) as AnyRow[], (await db.outfits.toArray()) as AnyRow[], o, map);
}

const BLUE = '#4a7ab5';
const RUST = '#d1782f';
const TEAL = '#1f6f70';

describe('the pairing layer under the rotation draw', () => {
  async function threePieces() {
    await piece('top', 'Tops', { name: 'Blue shirt', lastWornOn: '2026-01-05' });
    await piece('warm', 'Bottoms', { name: 'Rust trouser', lastWornOn: '2026-05-01' });
    await piece('cool', 'Bottoms', { name: 'Teal skirt', lastWornOn: '2026-01-01' });
  }

  it('is entirely absent when the caller passes no colour reads', async () => {
    await threePieces();
    const bare = await lookWith(null);
    const emptyMap = await lookWith(new Map());
    expect(bare.rule).toBe(RULE_SENTENCE);
    expect(bare.pairing).toBeNull();
    expect(chosenIds(bare)).toEqual(chosenIds(emptyMap));
  });

  it('takes a slot on a colour relationship it can name, and prints which one', async () => {
    await threePieces();
    const plan = await lookWith(reads({ top: { photo: [BLUE] }, warm: { photo: [RUST] }, cool: { photo: [TEAL] } }));
    /* Here the idlest bottom is also the one the colour supports, so nothing
       moves — what has to be true anyway is that the relationship the draw used
       is named on the piece it describes, and counted. */
    expect(slot(plan, 'Bottom').pieces[0].id).toBe('cool');
    expect(slot(plan, 'Bottom').pieces[0].reasons.join(' ')).toContain('adjacent hues with “Blue shirt”');
    expect(plan.pairing?.saidColour).toBe(1);
    expect(plan.rule).toContain(PAIRING_RULE_SENTENCE);
  });

  it('moves a slot over the idlest piece when the colour supports the other candidate', async () => {
    await piece('top', 'Tops', { name: 'Blue shirt', lastWornOn: '2026-01-05' });
    await piece('warm', 'Bottoms', { name: 'Rust trouser', lastWornOn: '2026-01-01' });
    await piece('cool', 'Bottoms', { name: 'Teal skirt', lastWornOn: '2026-02-01' });
    const idle = await lookWith(null);
    expect(slot(idle, 'Bottom').pieces[0].id).toBe('warm');
    const planned = await lookWith(reads({ top: { photo: [BLUE] }, warm: { photo: [RUST] }, cool: { photo: [TEAL] } }));
    expect(slot(planned, 'Bottom').pieces[0].id).toBe('cool');
    expect(planned.pairing?.moved).toBe(1);
    expect(planned.pairing?.slots).toBe(2);
    expect(planned.notes.join(' ')).toContain('took the first choice in 1 of 2 slots over the idlest piece');
  });

  it('puts what she has stored together above colour', async () => {
    await threePieces();
    /* worn 7 days ago, so the stale-outfit rule is not what puts this pair on
       her back — the only thing that can is the co-worn key. */
    await outfit('seen', 'Blue and rust', ['top', 'warm'], { rating: 5, lastWornOn: '2026-11-05' });
    const map = reads({ top: { photo: [BLUE] }, warm: { photo: [RUST] }, cool: { photo: [TEAL] } });
    const plan = await lookWith(map);
    expect(plan.kind).toBe('built');
    expect(slot(plan, 'Bottom').pieces[0].id).toBe('warm');
    const reason = slot(plan, 'Bottom').pieces[0].reasons.join(' ');
    expect(reason).toContain('worn with “Blue shirt” in 1 outfit you stored, which you rated 5/5');
    expect(plan.pairing?.saidCoWorn).toBe(1);
    expect(plan.pairing?.coWornPairs).toBe(1);
    expect(plan.pairing?.moved).toBe(1);

    /* take her history away and the same colour reads take the other bottom */
    await db.outfits.delete('seen');
    const noHistory = await lookWith(map);
    expect(slot(noHistory, 'Bottom').pieces[0].id).toBe('cool');
    expect(noHistory.notes.join(' ')).toContain('You have not stored an outfit yet');
  });

  it('does not let an unreadable colour cost a piece its history', async () => {
    await threePieces();
    await outfit('seen', 'Print and blue', ['top', 'warm'], { rating: 4, lastWornOn: '2026-11-05' });
    const plan = await lookWith(reads({ top: { photo: [BLUE] }, warm: { typed: ['floral'] }, cool: { photo: [TEAL] } }));
    expect(slot(plan, 'Bottom').pieces[0].id).toBe('warm');
    expect(plan.pairing?.saidCoWorn).toBe(1);
    expect(plan.pairing?.saidColour).toBe(0);
    expect(plan.notes.join(' ')).toContain('carry a colour word with no single hue');
    expect(slot(plan, 'Bottom').pieces[0].reasons.join(' ')).not.toContain('adjacent hues');
  });

  it('reproduces the idle order exactly when nothing has pairing evidence', async () => {
    await threePieces();
    const idle = await lookWith(null);
    const quiet = await lookWith(reads({ top: { typed: ['muted thing'] }, warm: { typed: ['muted thing'] }, cool: { typed: ['muted thing'] } }));
    expect(chosenIds(quiet)).toEqual(chosenIds(idle));
    expect(quiet.pairing?.readable).toBe(0);
    expect(quiet.pairing?.moved).toBe(0);
    expect(quiet.notes.join(' ')).toContain('the pairing keys were skipped entirely and only the idle order decided');
  });

  it('prints the denominator of what could be read, and from where', async () => {
    await threePieces();
    const plan = await lookWith(reads({ top: { photo: [BLUE] }, warm: { typed: ['charcoal'] } }));
    expect(plan.pairing).toMatchObject({ readable: 2, total: 3, coWornPairs: 0 });
    expect(plan.notes.join(' ')).toContain('Colour was read for 2 of 3 placeable pieces (1 from a photograph you stored, 1 from a colour word you typed)');
    expect(plan.notes.join(' ')).toContain('for the other 1, the pairing keys had nothing to say');
    expect(plan.notes.join(' ')).toContain('You have not stored an outfit yet, so the co-worn key had nothing of yours to rank');
  });

  it('says so when the two layers agree rather than quietly taking credit', async () => {
    await piece('top', 'Tops', { name: 'Blue shirt', lastWornOn: '2026-01-05' });
    await piece('cool', 'Bottoms', { name: 'Teal skirt', lastWornOn: '2026-01-01' });
    await piece('warm', 'Bottoms', { name: 'Rust trouser', lastWornOn: '2026-02-01' });
    const plan = await lookWith(reads({ top: { photo: [BLUE] }, cool: { photo: [TEAL] }, warm: { photo: [RUST] } }));
    expect(plan.pairing?.moved).toBe(0);
    expect(plan.pairing?.saidColour).toBe(1);
    expect(plan.notes.join(' ')).toContain('the idlest piece was also the best-supported one, so the two layers agree here');
  });

  it('says that an assembled outfit is offered whole, with nothing for pairing to reorder', async () => {
    await threePieces();
    await outfit('stored', 'Sunday pair', ['top', 'cool'], { lastWornOn: '2026-01-01' });
    const plan = await lookWith(reads({ top: { photo: [BLUE] }, warm: { photo: [RUST] }, cool: { photo: [TEAL] } }));
    expect(plan.kind).toBe('existing-outfit');
    expect(plan.pairing).toBeNull();
    expect(plan.notes.join(' ')).toContain('offered whole, so the pairing keys had nothing to re-order');
  });

  it('draws the same look twice from the same closet and the same reads', async () => {
    await threePieces();
    await outfit('seen', 'Blue and rust', ['top', 'warm'], { rating: 5 });
    const map = reads({ top: { photo: [BLUE] }, warm: { photo: [RUST] }, cool: { photo: [TEAL] } });
    const a = await lookWith(map);
    const b = await lookWith(map);
    expect(chosenIds(a)).toEqual(chosenIds(b));
    expect(a.slots.map((s) => s.pieces.map((p) => p.id))).toEqual(b.slots.map((s) => s.pieces.map((p) => p.id)));
  });
});
