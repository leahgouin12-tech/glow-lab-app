import { describe, expect, it } from 'vitest';
import {
  ADJACENT_MAX_HUE_DELTA,
  NEUTRAL_FAMILIES,
  OPPOSITE_MIN_HUE_DELTA,
  RELATION_CONFIDENCE,
  coWearIndex,
  coWornSentence,
  colourCoverage,
  colourOf,
  hslOf,
  hueDistance,
  isHexColor,
  isReadable,
  pairKey,
  pairScore,
  pairingEvidence,
  readCoWorn,
  UNREAD_COLOUR,
  type PieceColour
} from '../engine/pairing';
import type { AnyRow } from '../db/schema';

/**
 * The pairing layer is the second sort under the rotation draw, so every claim
 * in this file is a claim about what the arithmetic is *allowed to say*: it may
 * name a relationship between two colours she owns, it may count what she has
 * already worn together, and it may not — in either direction — dress that up as
 * taste, invent a hue for a word, or penalise a piece it cannot read.
 */

const NAVY = '#1f2a44';
const NAVY_LIGHT = '#22314f';
const BLACK = '#141414';
const GREY = '#8c8c8c';
const RED = '#a8262b';
const ORANGE = '#d1782f';
const BLUE = '#4a7ab5';
const GREEN = '#3d7a4a';

const photo = (...hexes: string[]): PieceColour => colourOf({ photograph: hexes });
const typed = (...tags: string[]): PieceColour => colourOf({ typed: tags });

const row = (over: Record<string, unknown>) => over as unknown as AnyRow;

describe('reading a colour', () => {
  it('measures hue, lightness and saturation out of a hex', () => {
    expect(hslOf(BLACK)?.lightness).toBeCloseTo(0.078, 3);
    expect(hslOf(BLACK)?.saturation).toBe(0);
    expect(hslOf('#fff')).toMatchObject({ lightness: 1, saturation: 0 });
    expect(hslOf(NAVY)?.hue).toBeGreaterThan(200);
    expect(hslOf('navy')).toBeNull();
    expect(hslOf('#12345')).toBeNull();
    expect(hslOf(undefined)).toBeNull();
  });

  it('knows a colour code from a colour word', () => {
    expect(isHexColor('#2d3b4a')).toBe(true);
    expect(isHexColor('2d3b4a')).toBe(true);
    expect(isHexColor('#abc')).toBe(true);
    expect(isHexColor('charcoal')).toBe(false);
    expect(isHexColor('')).toBe(false);
  });

  it('takes the shortest way round the wheel', () => {
    expect(hueDistance(350, 10)).toBeCloseTo(20, 6);
    expect(hueDistance(0, 180)).toBeCloseTo(180, 6);
    expect(hueDistance(212, 28)).toBeCloseTo(176, 6);
  });

  it('prefers the photograph the app already sampled', () => {
    const c = colourOf({ photograph: [NAVY, GREY, NAVY_LIGHT], typed: ['black', '#d1782f'] });
    expect(c.read).toBe('photograph');
    expect(c.family).toBe('navy');
    expect(c.hexes[0]).toBe(NAVY);
    /* three buckets is what the comparison is allowed to lean on, not all eight */
    expect(c.hexes).toHaveLength(3);
    expect(c.families).toContain('orange');
    expect(c.words).toEqual(['black']);
    expect(c.hue).toBeGreaterThan(200);
  });

  it('keeps a typed hex measurable and a typed word not', () => {
    const hex = typed('#2d3b4a');
    expect(hex.read).toBe('typed-hex');
    expect(hex.lightness).not.toBeNull();
    const word = typed('charcoal');
    expect(word.read).toBe('typed-word');
    expect(word.family).toBe('grey');
    expect(word.hue).toBeNull();
    expect(word.lightness).toBeNull();
    expect(word.neutral).toBe(true);
  });

  it('puts a colour word in its family and measures nothing more than that', () => {
    const word = typed('oxblood');
    expect(word.family).toBe('brown');
    expect(word.hue).toBeNull();
    expect(word.lightness).toBeNull();
    /* brown is one of the six families this app states as a ground note — the
       sentence on screen says so, rather than leaving it to be assumed. */
    expect(NEUTRAL_FAMILIES).toContain('brown');
    expect(word.neutral).toBe(true);
    const camel = typed('camel');
    expect(camel.family).toBe('beige');
    expect(camel.neutral).toBe(true);
    expect(camel.hue).toBeNull();
  });

  it('calls a print, a metal and a sheer unreadable rather than guessing one', () => {
    for (const tag of ['floral', 'gold', 'sheer']) {
      const c = typed(tag);
      expect(c.varied, tag).toBe(true);
      expect(isReadable(c), tag).toBe(false);
    }
  });

  it('reads a colour outside its vocabulary as nothing, not as a guess', () => {
    const c = typed('muted thing');
    expect(c.read).toBe('typed-word');
    expect(c.family).toBe('');
    expect(isReadable(c)).toBe(false);
    expect(UNREAD_COLOUR.read).toBe('none');
  });

  it('treats an achromatic swatch as a neutral with no hue', () => {
    const c = photo(GREY);
    expect(c.hue).toBeNull();
    expect(c.neutral).toBe(true);
    expect(isReadable(c)).toBe(true);
  });
});

describe('naming a relationship', () => {
  it('names two of the same family at the same depth tone-on-tone', () => {
    const read = pairScore(photo(NAVY), photo(NAVY_LIGHT), 'Wide-leg navy trouser');
    expect(read.relation).toBe('tone-on-tone');
    expect(read.confidence).toBe(RELATION_CONFIDENCE['tone-on-tone']);
    expect(read.lightnessDelta).toBeLessThan(0.15);
    expect(read.reason).toContain('tone-on-tone with “Wide-leg navy trouser”');
    expect(read.reason).toContain('both read from your photographs');
  });

  it('names the same family further apart a value step', () => {
    const read = pairScore(photo(BLACK), photo(GREY), 'Charcoal blazer');
    expect(read.relation).toBe('value-step');
    expect(read.lightnessDelta).toBeGreaterThan(0.4);
    expect(read.reason).toContain('apart in depth');
  });

  it('names one neutral against one hue a neutral anchor', () => {
    const read = pairScore(photo(BLACK), photo(RED), 'Silk oxblood slip');
    expect(read.relation).toBe('neutral-anchor');
    expect(read.confidence).toBe(RELATION_CONFIDENCE['neutral-anchor']);
    expect(read.reason).toContain('a neutral black under “Silk oxblood slip”');
    const flipped = pairScore(photo(RED), photo(BLACK), 'Wool coat');
    expect(flipped.relation).toBe('neutral-anchor');
    expect(flipped.reason).toContain('carried against the neutral black “Wool coat”');
  });

  it('separates adjacent from opposite by the stated wheel distances', () => {
    const adjacent = pairScore(photo(BLUE), photo('#1f6f70'), 'Teal skirt');
    expect(adjacent.hueDelta).toBeLessThanOrEqual(ADJACENT_MAX_HUE_DELTA);
    expect(adjacent.relation).toBe('adjacent-hues');
    const opposite = pairScore(photo(BLUE), photo(ORANGE), 'Rust trouser');
    expect(opposite.hueDelta).toBeGreaterThanOrEqual(OPPOSITE_MIN_HUE_DELTA);
    expect(opposite.relation).toBe('opposite-hues');
    const unnamed = pairScore(photo(ORANGE), photo(GREEN), 'Moss trouser');
    expect(unnamed.relation).toBe('two-strong-hues');
    expect(unnamed.reason).toContain('no relationship the arithmetic can name');
    expect(unnamed.confidence).toBeLessThan(opposite.confidence);
  });

  it('still names the relationship two words share, and counts it with less confidence', () => {
    const read = pairScore(typed('black'), typed('jet'), 'Bonded cashmere wrap');
    expect(read.relation).toBe('shared-family');
    expect(read.confidence).toBeCloseTo(RELATION_CONFIDENCE['shared-family'] * 0.7, 4);
    expect(read.reason).toContain('colour word');
    expect(read.hueDelta).toBeNull();
  });

  it('says nothing rather than guessing when either colour is unreadable', () => {
    const cases: [PieceColour, PieceColour][] = [
      [photo(NAVY), UNREAD_COLOUR],
      [typed('floral'), photo(RED)],
      [UNREAD_COLOUR, UNREAD_COLOUR]
    ];
    for (const [a, b] of cases) {
      const read = pairScore(a, b, 'x');
      expect(read.relation).toBe('unread');
      expect(read.readable).toBe(false);
      expect(read.reason).toBe('');
      expect(read.confidence).toBe(0);
    }
  });

  it('never prints a taste verdict — the words it owns are relationships', () => {
    const sentences = [
      pairScore(photo(BLACK), photo(RED), 'a').reason,
      pairScore(photo(NAVY), photo(NAVY_LIGHT), 'a').reason,
      pairScore(photo(ORANGE), photo(GREEN), 'a').reason,
      pairScore(typed('camel'), typed('ivory'), 'a').reason
    ];
    for (const s of sentences) {
      expect(s.toLowerCase()).not.toMatch(/flattering|works|best|should|matches your|suitable|unflattering|avoid/);
    }
  });
});

describe('what she has already worn together', () => {
  const outfits = [
    row({ id: 'o1', name: 'Office grey', itemIds: ['t1', 'b1'], rating: 5, lastWornOn: '2026-09-01' }),
    row({ id: 'o2', name: 'Sunday', itemIds: ['t1', 'b1'], rating: 0, lastWornOn: '2026-10-01' }),
    row({ id: 'o3', name: 'Dinner', itemIds: ['t1', 'b2'], rating: 3, lastWornOn: null }),
    row({ id: 'o4', name: 'One piece', itemIds: ['t1'], rating: 4, lastWornOn: '2026-08-01' }),
    row({ id: 'o5', name: 'Never rated', itemIds: ['b1', 'shoes'], rating: 0, lastWornOn: null })
  ];
  const index = coWearIndex(outfits);

  it('keys a pair the same way round whichever order it is asked in', () => {
    expect(pairKey('t1', 'b1')).toBe(pairKey('b1', 't1'));
    expect(readCoWorn(index, 'b1', 't1')).toEqual(readCoWorn(index, 't1', 'b1'));
  });

  it('counts the rows she assembled, not wears, and ignores a row holding one piece', () => {
    expect(readCoWorn(index, 't1', 'b1').looks).toBe(2);
    expect(readCoWorn(index, 't1', 'b2').looks).toBe(1);
    expect(readCoWorn(index, 'b1', 'b2')).toEqual({ looks: 0, meanRating: null, lastOn: null });
  });

  it('leaves an unrated row out of the mean instead of reading it as a one', () => {
    expect(readCoWorn(index, 't1', 'b1').meanRating).toBe(5);
    expect(readCoWorn(index, 't1', 'b2').meanRating).toBe(3);
  });

  it('keeps the newest date the rows carry', () => {
    expect(readCoWorn(index, 't1', 'b1').lastOn).toBe('2026-10-01');
    expect(readCoWorn(index, 't1', 'b2').lastOn).toBeNull();
  });

  it('says the count and the rating she gave, the rating only when she gave one', () => {
    expect(coWornSentence(readCoWorn(index, 't1', 'b1'), 'Wool trousers')).toBe(
      'worn with “Wool trousers” in 2 outfits you stored, which you rated 5/5'
    );
    expect(coWornSentence(readCoWorn(index, 't1', 'b2'), 'Slip skirt')).toContain('1 outfit you stored');
    expect(coWornSentence(readCoWorn(index, 't1', 'b2'), 'Slip skirt')).toContain('which you rated 3/5');
    expect(coWornSentence(readCoWorn(index, 'b1', 'shoes'), 'Suede ankle boot')).toBe('worn with “Suede ankle boot” in 1 outfit you stored');
    expect(coWornSentence(readCoWorn(index, 'b1', 'b2'), 'Anything')).toBe('');
  });

  it('reports the denominator the pairing is standing on', () => {
    const ids = new Set(['t1', 'b1', 'b2', 'shoes']);
    expect(pairingEvidence(outfits, ids)).toEqual({ rows: 4, pairs: 3, rated: 2 });
    expect(pairingEvidence(outfits, new Set(['t1']))).toEqual({ rows: 0, pairs: 0, rated: 0 });
  });

  it('separates pieces with no outfit row at all from the ones with history', () => {
    expect(coWearIndex([row({ id: 'x', itemIds: ['t1', 'b1'] })]).size).toBe(1);
    expect(coWearIndex([]).size).toBe(0);
  });
});

describe('coverage the screen has to print', () => {
  const colours = new Map<string, PieceColour>([
    ['photo', photo(NAVY, GREY)],
    ['hex', typed('#2d3b4a')],
    ['word', typed('charcoal')],
    ['print', typed('floral')],
    ['nothing', UNREAD_COLOUR]
  ]);

  it('counts each origin separately and totals what could be read', () => {
    const cov = colourCoverage(colours, [...colours.keys()]);
    expect(cov.total).toBe(5);
    expect(cov.fromPhotograph).toBe(1);
    expect(cov.fromTypedHex).toBe(1);
    /* origins are counted wherever the colour came from, readable or not:
       "floral" is a word she typed, and the note says so before it says it could not be used */
    expect(cov.fromTypedWord).toBe(2);
    expect(cov.readable).toBe(3);
    expect(cov.unreadable).toBe(2);
    expect(cov.varied).toBe(1);
  });

  it('names a tag outside the vocabulary as unnamed rather than as a family', () => {
    const withJunk = new Map(colours).set('junk', typed('muted thing'));
    const cov = colourCoverage(withJunk, [...withJunk.keys()]);
    expect(cov.unnamed).toBe(1);
    expect(cov.unreadable).toBe(3);
  });

  it('says zero rather than guessing when the closet has no colour anywhere', () => {
    const cov = colourCoverage(new Map([['a', UNREAD_COLOUR]]), ['a', 'missing']);
    expect(cov.total).toBe(2);
    expect(cov.readable).toBe(0);
  });
});
