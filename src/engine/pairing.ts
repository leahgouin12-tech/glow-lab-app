/**
 * THE GLOW LAB — closet pairing arithmetic (spec Part 14, second layer).
 *
 * The rotation sort answers "which piece has waited longest". It cannot answer
 * "which of these two could actually be worn together", so this file adds two
 * keys, both read off data she has already produced on this device:
 *
 *   1. co-worn history — how often two pieces appear in the same `outfits` row
 *      she assembled, and what she rated those rows;
 *   2. colour relationship — hue and depth measured from the swatch buckets the
 *      media pipeline already stores on every photograph (`mediaItems.data.palette`,
 *      eight hexes, most-populous bucket first), or the colour words and hexes
 *      she typed on the garment row.
 *
 * Neither key is a taste verdict. A relationship is *named* — tone-on-tone, a
 * value step, a neutral anchor, adjacent hues, opposite hues, the same colour
 * word — or it is not named, and the confidence number records only how
 * completely the arithmetic could read the two colours, never how good the
 * combination is. A piece whose colour cannot be read is not penalised: the
 * pairing keys simply say nothing about it, the idle order decides, and the
 * denominator of what could and could not be read is printed above the look.
 *
 * Nothing is recognised in a photograph, no model runs, nothing leaves the
 * device, and no garment is invented to complete a pairing.
 */
import type { AnyRow } from '../db/schema';
import { colourFamilies, hexToFamily } from './duplicates';

export const PAIRING_RULE_VERSION = 1;

/** Two hues this close on the wheel are called adjacent. */
export const ADJACENT_MAX_HUE_DELTA = 45;
/** Two hues at least this far apart are called opposite. */
export const OPPOSITE_MIN_HUE_DELTA = 150;
/** Below this lightness gap, two pieces in the same family are tone-on-tone rather than a value step. */
export const TONE_MAX_LIGHTNESS_DELTA = 0.15;
/** At or below this saturation a hue is not a hue — it is a neutral. */
export const ACHROMATIC_SATURATION = 0.12;

export type PairRelation =
  | 'tone-on-tone'
  | 'value-step'
  | 'neutral-anchor'
  | 'shared-family'
  | 'adjacent-hues'
  | 'opposite-hues'
  | 'two-strong-hues'
  | 'unread';

/**
 * How completely the arithmetic could read the pair. This is a confidence in the
 * *description*, not a score for the combination, and it is what makes a pair the
 * app can talk about outrank a pair it cannot.
 */
export const RELATION_CONFIDENCE: Record<PairRelation, number> = {
  'neutral-anchor': 0.85,
  'tone-on-tone': 0.8,
  'value-step': 0.75,
  'adjacent-hues': 0.7,
  'opposite-hues': 0.6,
  'shared-family': 0.5,
  'two-strong-hues': 0.25,
  unread: 0
};

/** The only relationship words this app is allowed to print. */
export const RELATION_LABEL: Record<PairRelation, string> = {
  'tone-on-tone': 'tone-on-tone',
  'value-step': 'same family, different depth',
  'neutral-anchor': 'neutral anchor',
  'shared-family': 'same colour word',
  'adjacent-hues': 'adjacent hues',
  'opposite-hues': 'opposite hues',
  'two-strong-hues': 'no named relationship',
  unread: 'colour not readable'
};

/** Families the arithmetic treats as a ground note rather than a hue. */
export const NEUTRAL_FAMILIES = ['black', 'white', 'grey', 'beige', 'brown', 'navy'];
/** Words that describe a surface or a print, so there is no single hue to compare. */
export const VARIED_FAMILIES = ['multi', 'metallic', 'clear'];

const isNeutralFamily = (f: string) => NEUTRAL_FAMILIES.includes(f);
const isVariedFamily = (f: string) => VARIED_FAMILIES.includes(f);

export type ColourSourceName = 'photograph' | 'typed-hex' | 'typed-word' | 'none';

export interface PieceColour {
  /** which kind of evidence produced this read, in that priority */
  read: ColourSourceName;
  /** measured values, most-populous bucket first — empty when nothing was measurable */
  hexes: string[];
  /** family labels from both sources, photograph order first */
  families: string[];
  /** the dominant label, '' when the colour could not be named */
  family: string;
  /** null for a neutral, for a word-only read, and for anything unreadable */
  hue: number | null;
  lightness: number | null;
  saturation: number | null;
  neutral: boolean;
  /** true when the only colour she gave is a print, a metal, or a sheer */
  varied: boolean;
  /** her own colour tags, verbatim — the words are hers, not the app's */
  words: string[];
}

export const UNREAD_COLOUR: PieceColour = {
  read: 'none',
  hexes: [],
  families: [],
  family: '',
  hue: null,
  lightness: null,
  saturation: null,
  neutral: false,
  varied: false,
  words: []
};

const HEX_RE = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function isHexColor(tag: unknown): boolean {
  return HEX_RE.test(String(tag ?? '').trim());
}

function list(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v ?? '').trim()).filter((v) => v !== '');
  const s = String(value ?? '').trim();
  return s ? [s] : [];
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)];
}

/** HSL over one hex, continuous rather than bucketed — the buckets stay in duplicates.ts. */
export function hslOf(hex: unknown): { hue: number; lightness: number; saturation: number } | null {
  let h = String(hex ?? '').trim().replace('#', '').toLowerCase();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/.test(h)) return null;
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const d = max - min;
  const saturation = d === 0 ? 0 : d / (1 - Math.abs(2 * lightness - 1));
  let hue = 0;
  if (d !== 0) {
    if (max === r) hue = 60 * (((g - b) / d) % 6);
    else if (max === g) hue = 60 * ((b - r) / d + 2);
    else hue = 60 * ((r - g) / d + 4);
    if (hue < 0) hue += 360;
  }
  return { hue, lightness, saturation };
}

/** Shortest way round the wheel, so 10° and 350° are 20° apart rather than 340°. */
export function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

/**
 * Read one piece. `photograph` is the stored palette — the media pipeline wrote
 * it when the image was ingested; `typed` is the garment's own `colors` field,
 * which only she writes, as words, hex codes, or both. Personal Colour does not
 * touch `colors`: its *apply palette to pieces* action writes a `palette:<name>`
 * word into the row's `tags`, which this engine deliberately does not read,
 * because a palette *name* is not a colour measurement.
 */
export function colourOf(input: { photograph?: unknown; typed?: unknown }): PieceColour {
  const palette = list(input.photograph).filter(isHexColor).map((h) => h.toLowerCase());
  const tags = list(input.typed);
  const typedHexes = tags.filter(isHexColor).map((h) => h.toLowerCase());
  const words = tags.filter((t) => !isHexColor(t));
  const photoFamilies = dedupe(palette.slice(0, 3).map((h) => hexToFamily(h) ?? '').filter(Boolean));
  const tagFamilies = colourFamilies(tags);
  const families = dedupe([...photoFamilies, ...tagFamilies]);
  const hexes = dedupe([...palette.slice(0, 3), ...typedHexes]).slice(0, 3);
  const measured = hslOf(hexes[0]);
  const family = families[0] ?? '';
  const read: ColourSourceName = palette.length ? 'photograph' : typedHexes.length ? 'typed-hex' : words.length ? 'typed-word' : 'none';
  const achromatic = measured !== null && measured.saturation <= ACHROMATIC_SATURATION;
  const hue = measured !== null && !achromatic ? measured.hue : null;
  const neutral = isNeutralFamily(family) || achromatic;
  const varied = read === 'typed-word' && families.length > 0 && families.every(isVariedFamily);
  return {
    read,
    hexes,
    families,
    family,
    hue,
    lightness: measured?.lightness ?? null,
    saturation: measured?.saturation ?? null,
    neutral,
    varied,
    words
  };
}

/** Can this colour take part in a pairing at all? */
export function isReadable(colour: PieceColour | null | undefined): colour is PieceColour {
  if (!colour) return false;
  if (colour.read === 'none' || colour.varied) return false;
  return colour.hue !== null || colour.neutral || colour.family !== '';
}

export interface PairRead {
  relation: PairRelation;
  /** confidence in the description, 0–1 — never a verdict on the combination */
  confidence: number;
  hueDelta: number | null;
  lightnessDelta: number | null;
  /** the sentence the screen prints; '' when nothing could be said */
  reason: string;
  readable: boolean;
}

const UNPAIRABLE: PairRead = { relation: 'unread', confidence: 0, hueDelta: null, lightnessDelta: null, reason: '', readable: false };

function familyLabel(colour: PieceColour): string {
  return colour.family ? colour.family : 'a colour the app cannot name';
}

/** Whose evidence this is, in the words she would use. */
export function colourOrigin(colour: PieceColour): string {
  if (colour.read === 'photograph') return 'read from the photograph you stored';
  if (colour.read === 'typed-hex') return 'read from the colour code you typed';
  if (colour.read === 'typed-word') return 'the colour word you typed';
  return 'nothing readable stored';
}

function withOrigin(base: string, a: PieceColour, b: PieceColour): string {
  if (a.read === 'photograph' && b.read === 'photograph') return `${base} — both read from your photographs`;
  if (a.read === 'typed-word' && b.read === 'typed-word') return `${base} — both from colour words you typed`;
  return `${base} — one from ${colourOrigin(a).replace('read from ', '')}, one from ${colourOrigin(b).replace('read from ', '')}`;
}

/**
 * Name the relationship between two pieces. The tree is stated, not learned:
 * same family (or two neutrals) → tone or depth; one neutral → anchor; two hues
 * → adjacent, opposite, or unnamed; anything else → the words match or nothing
 * can be said.
 */
export function pairScore(a: PieceColour, b: PieceColour, otherName = 'the other piece'): PairRead {
  if (!isReadable(a) || !isReadable(b)) return UNPAIRABLE;
  const lightnessDelta = a.lightness !== null && b.lightness !== null ? Math.abs(a.lightness - b.lightness) : null;
  const hueDelta = a.hue !== null && b.hue !== null ? hueDistance(a.hue, b.hue) : null;
  const sameFamily = a.family !== '' && a.family === b.family;
  const bothNeutral = a.neutral && b.neutral;
  const oneNeutral = a.neutral !== b.neutral;
  const wordMatch = a.families.some((f) => b.families.includes(f));
  const rounded = (n: number | null) => (n === null ? null : Math.round(n * 100) / 100);

  let relation: PairRelation;
  let reason: string;

  if (sameFamily || bothNeutral) {
    if (lightnessDelta === null) {
      relation = 'shared-family';
      reason = `the same colour word as “${otherName}” (${familyLabel(a)})`;
    } else if (lightnessDelta < TONE_MAX_LIGHTNESS_DELTA) {
      relation = 'tone-on-tone';
      reason = withOrigin(`tone-on-tone with “${otherName}” — both read ${familyLabel(a)}`, a, b);
    } else {
      relation = 'value-step';
      reason = withOrigin(
        `the same ${familyLabel(a)} as “${otherName}” but ${rounded(lightnessDelta)} apart in depth`,
        a,
        b
      );
    }
  } else if (oneNeutral) {
    relation = 'neutral-anchor';
    reason = a.neutral
      ? `a neutral ${familyLabel(a)} under “${otherName}”, which carries the colour (${familyLabel(b)})`
      : `${familyLabel(a)} carried against the neutral ${familyLabel(b)} “${otherName}”`;
  } else if (hueDelta !== null) {
    if (hueDelta <= ADJACENT_MAX_HUE_DELTA) {
      relation = 'adjacent-hues';
      reason = withOrigin(
        `adjacent hues with “${otherName}” — ${familyLabel(a)} next to ${familyLabel(b)}, ${Math.round(hueDelta)}° apart on the wheel`,
        a,
        b
      );
    } else if (hueDelta >= OPPOSITE_MIN_HUE_DELTA) {
      relation = 'opposite-hues';
      reason = withOrigin(
        `opposite hues with “${otherName}” — ${familyLabel(a)} against ${familyLabel(b)}, ${Math.round(hueDelta)}° apart`,
        a,
        b
      );
    } else {
      relation = 'two-strong-hues';
      reason = `no relationship the arithmetic can name with “${otherName}” — ${familyLabel(a)} and ${familyLabel(b)} sit ${Math.round(
        hueDelta
      )}° apart`;
    }
  } else if (wordMatch) {
    relation = 'shared-family';
    reason = `shares the colour word “${a.families.find((f) => b.families.includes(f))}” with “${otherName}”`;
  } else {
    return UNPAIRABLE;
  }

  /* A word is weaker evidence than a measured swatch, so the confidence in the
     description drops — the relationship named is still the same relationship. */
  const estimated = a.read === 'typed-word' || b.read === 'typed-word';
  const confidence = Math.round(RELATION_CONFIDENCE[relation] * (estimated ? 0.7 : 1) * 100) / 100;
  return { relation, confidence, hueDelta: rounded(hueDelta), lightnessDelta: rounded(lightnessDelta), reason, readable: true };
}

/* ------------------------------------------------------------------ co-worn */

export interface CoWornRead {
  /** outfit rows she assembled that contain both pieces */
  looks: number;
  /** mean of the ratings she gave those rows; null when she rated none of them */
  meanRating: number | null;
  /** newest `lastWornOn` among those rows */
  lastOn: string | null;
}

export const NO_CO_WORN: CoWornRead = { looks: 0, meanRating: null, lastOn: null };

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

interface Accumulator {
  looks: number;
  ratingSum: number;
  rated: number;
  lastOn: string | null;
}

/**
 * Every unordered pair of pieces that appears together in an outfit row she
 * stored. Ratings are hers; `rating` 0 means she never rated that row, so it is
 * left out of the mean rather than counted as a one.
 */
export function coWearIndex(outfitRows: AnyRow[]): Map<string, CoWornRead> {
  const acc = new Map<string, Accumulator>();
  for (const row of outfitRows) {
    const ids = dedupe(list(row.itemIds));
    if (ids.length < 2) continue;
    const rating = Number(row.rating ?? 0) || 0;
    const lastOn = row.lastWornOn ? String(row.lastWornOn) : null;
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const key = pairKey(ids[i], ids[j]);
        const cur = acc.get(key) ?? { looks: 0, ratingSum: 0, rated: 0, lastOn: null };
        cur.looks += 1;
        if (rating > 0) {
          cur.ratingSum += rating;
          cur.rated += 1;
        }
        if (lastOn && (!cur.lastOn || lastOn > cur.lastOn)) cur.lastOn = lastOn;
        acc.set(key, cur);
      }
    }
  }
  const out = new Map<string, CoWornRead>();
  for (const [key, v] of acc) out.set(key, { looks: v.looks, meanRating: v.rated ? Math.round((v.ratingSum / v.rated) * 10) / 10 : null, lastOn: v.lastOn });
  return out;
}

export function readCoWorn(index: Map<string, CoWornRead>, a: string, b: string): CoWornRead {
  return index.get(pairKey(a, b)) ?? NO_CO_WORN;
}

export function coWornSentence(read: CoWornRead, otherName: string): string {
  if (!read.looks) return '';
  const rated = read.meanRating === null ? '' : `, which you rated ${read.meanRating}/5`;
  return `worn with “${otherName}” in ${read.looks} outfit${read.looks === 1 ? '' : 's'} you stored${rated}`;
}

export interface PairingEvidence {
  /** outfit rows that put at least two pieces from the pile together */
  rows: number;
  /** distinct pairs available to the co-worn key */
  pairs: number;
  /** of those rows, how many carry a rating she gave */
  rated: number;
}

export function pairingEvidence(outfitRows: AnyRow[], ids: Set<string>): PairingEvidence {
  let rows = 0;
  let rated = 0;
  const pairs = new Set<string>();
  for (const row of outfitRows) {
    const inside = dedupe(list(row.itemIds)).filter((id) => ids.has(id));
    if (inside.length < 2) continue;
    rows += 1;
    if ((Number(row.rating ?? 0) || 0) > 0) rated += 1;
    for (let i = 0; i < inside.length; i += 1) {
      for (let j = i + 1; j < inside.length; j += 1) pairs.add(pairKey(inside[i], inside[j]));
    }
  }
  return { rows, pairs: pairs.size, rated };
}

/* ---------------------------------------------------------------- coverage */

export interface Coverage {
  total: number;
  readable: number;
  unreadable: number;
  fromPhotograph: number;
  fromTypedHex: number;
  fromTypedWord: number;
  /** readable only as a print, metal or sheer — the words are hers, the hue is not comparable */
  varied: number;
  /** she gave a colour at all, but it fell outside the vocabulary this app reads */
  unnamed: number;
}

export function colourCoverage(colours: Map<string, PieceColour>, ids: string[]): Coverage {
  const c: Coverage = { total: 0, readable: 0, unreadable: 0, fromPhotograph: 0, fromTypedHex: 0, fromTypedWord: 0, varied: 0, unnamed: 0 };
  for (const id of ids) {
    const colour = colours.get(id);
    c.total += 1;
    if (!colour || colour.read === 'none') {
      c.unreadable += 1;
      continue;
    }
    if (colour.read === 'photograph') c.fromPhotograph += 1;
    else if (colour.read === 'typed-hex') c.fromTypedHex += 1;
    else if (colour.read === 'typed-word') c.fromTypedWord += 1;
    if (colour.varied) c.varied += 1;
    else if (colour.family === '' && colour.hue === null && !colour.neutral) c.unnamed += 1;
    if (isReadable(colour)) c.readable += 1;
    else c.unreadable += 1;
  }
  return c;
}
