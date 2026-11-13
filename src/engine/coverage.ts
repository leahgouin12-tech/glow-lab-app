/**
 * THE GLOW LAB — whole-closet coverage arithmetic (spec Parts 14, 22, 27).
 *
 * `rotation.ts` answers "what should I wear next". This answers the question
 * that has to be answered first: *can the closet dress the season and the
 * occasions she says she has?* Every number here is a count over `clothingItems`
 * rows she wrote — `category`, `seasons`, `occasions`, `wears`, `data.lastWornOn`
 * and `price`. Nothing is recognised in a photograph, nothing is compared to a
 * trend, and no missing garment is turned into a product, a price or a
 * recommendation: a gap is printed as the count that produced it and stops there.
 *
 * The season reading follows the same rule the draw already uses — a piece with
 * no season written cannot be excluded by a season filter, so it is counted as
 * wearable *and* reported separately as unstated. Two different numbers, printed
 * beside each other, rather than one number that quietly guesses.
 */
import type { AnyRow } from '../db/schema';
import { SLOT_CATEGORY, SLOT_OF, SLOT_ORDER, daysBetween, REPEAT_WINDOW_DAYS, type SlotName } from './rotation';

export const COVERAGE_RULE_VERSION = 1;

/** The season vocabulary the closet form offers. One list, imported by the page. */
export const SEASONS = ['Spring', 'Summer', 'Autumn', 'Winter', 'All-season'];

/** A piece not worn for this long is called dormant — the threshold the closet card already used. */
export const DORMANT_DAYS = 180;

/**
 * What coverage cannot do, stated beside the matrix rather than in a footer:
 * it counts her own tags, so a piece she forgot to tag looks like a gap.
 */
export const COVERAGE_LIMIT_SENTENCE =
  'Coverage counts the tags you wrote. A piece carrying no season is counted as wearable everywhere and reported as unstated rather than as absent, and a piece in a category the closet does not place is listed, not dropped. A gap here is a hole in your own records — it is not a shopping list, a price, or a claim that you need anything.';

export interface SeasonCell {
  season: string;
  /** pieces whose `seasons` literally carry this word (or, for All-season, that word) */
  tagged: number;
  /** tagged, plus All-season, plus anything carrying no season at all — what the draw could actually reach */
  wearable: number;
  neverWorn: number;
  /** longest idle span among the wearable pieces in this cell, in days; null when none has a date */
  idlestDays: number | null;
}

export interface SlotCoverage {
  slot: SlotName;
  /** the `clothingItems` category that fills it */
  category: string;
  pieces: number;
  /** pieces with at least one season tag */
  carriesSeason: number;
  /** pieces with none — counted, never excluded */
  unstated: number;
  neverWorn: number;
  dormant: number;
  cells: SeasonCell[];
  /** seasons this slot cannot dress at all */
  emptySeasons: string[];
}

export interface OccasionCoverage {
  /** her own word, in the first spelling she typed it */
  word: string;
  pieces: number;
  neverWorn: number;
}

export interface CoverageTotals {
  rows: number;
  placeable: number;
  unplacable: number;
  withSeason: number;
  withoutSeason: number;
  withOccasion: number;
  withoutOccasion: number;
  priced: number;
  unpriced: number;
}

export interface CoveragePlan {
  slots: SlotCoverage[];
  /** categories that fill no slot, with how many pieces sit in each */
  unplacable: { category: string; pieces: number }[];
  occasions: OccasionCoverage[];
  totals: CoverageTotals;
  /** whole-closet holes, one sentence each */
  gaps: string[];
  /** denominators and limits — what the counts cannot say */
  notes: string[];
  rule: string;
}

interface Piece {
  id: string;
  name: string;
  category: string;
  seasons: string[];
  occasions: string[];
  wears: number;
  lastWornOn: string | null;
  price: number | null;
}

/* `category` is compared exactly, the same way the draw compares it: a row
   carrying "Tops " is a piece the draw cannot place, and coverage says so too. */
function toPiece(row: AnyRow): Piece {
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    category: String(row.category ?? ''),
    seasons: ((row.seasons as unknown[]) ?? []).map((s) => String(s).trim()).filter((s) => s !== ''),
    occasions: ((row.occasions as unknown[]) ?? []).map((s) => String(s).trim()).filter((s) => s !== ''),
    wears: Number(row.wears ?? 0) || 0,
    lastWornOn: (row.data?.lastWornOn as string | null) ?? null,
    price: typeof row.price === 'number' ? row.price : null
  };
}

const hasSeason = (piece: Piece, season: string) =>
  piece.seasons.some((s) => s.toLowerCase() === season.toLowerCase());

/** The draw's own exclusion rule, applied to a count: an unstated season cannot be excluded. */
const wearableFor = (piece: Piece, season: string) =>
  piece.seasons.length === 0 || hasSeason(piece, season) || hasSeason(piece, 'All-season');

const idleDays = (piece: Piece, today: string) => daysBetween(piece.lastWornOn, today);

/* One piece / two pieces, one piece exists / two pieces exist. The sentences
   below are built from her counts, so a closet of one has to read correctly. */
const np = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const is1 = (n: number, one: string, many: string) => (n === 1 ? one : many);

export const COVERAGE_RULE_SENTENCE =
  `Coverage reads four fields you wrote — category, seasons, occasions, and the wear log — and counts nothing else. For each slot the closet can place, every season gets two numbers: pieces literally tagged that season, and pieces the draw could actually reach, which adds All-season and every piece carrying no season at all, because a filter cannot exclude a blank. Occasions are grouped on your own words, spelled as you spelled them; a piece with no occasion is reported as unmarked rather than counted against any word. A piece not worn for ${DORMANT_DAYS} days is called dormant. The ${REPEAT_WINDOW_DAYS}-day set-aside the daily draw uses plays no part here: this is a count of what exists, not a suggestion.`;

/**
 * The whole-closet matrix. `rows` are live `clothingItems` rows; `today` is the
 * ISO date idle spans are measured against, passed in so the arithmetic is
 * testable and a re-render cannot shift a number.
 */
export function coverageOf(rows: AnyRow[], today: string): CoveragePlan {
  const pieces = rows.map(toPiece);
  const gaps: string[] = [];
  const notes: string[] = [];

  const placeable = pieces.filter((p) => SLOT_OF[p.category]);
  const unplacableCategories = new Map<string, number>();
  for (const p of pieces) {
    if (SLOT_OF[p.category]) continue;
    unplacableCategories.set(p.category === '' ? '(no category written)' : p.category, (unplacableCategories.get(p.category === '' ? '(no category written)' : p.category) ?? 0) + 1);
  }

  const slots: SlotCoverage[] = [];
  for (const slot of SLOT_ORDER) {
    const category = SLOT_CATEGORY[slot];
    const inSlot = pieces.filter((p) => SLOT_OF[p.category] === slot);
    const cells: SeasonCell[] = SEASONS.map((season) => {
      const tagged = inSlot.filter((p) => hasSeason(p, season));
      const reach = inSlot.filter((p) => wearableFor(p, season));
      const idles = reach.map((p) => idleDays(p, today)).filter((d): d is number => d !== null);
      return {
        season,
        tagged: tagged.length,
        wearable: reach.length,
        neverWorn: reach.filter((p) => p.wears === 0).length,
        idlestDays: idles.length ? Math.max(...idles) : null
      };
    });
    const emptySeasons = cells.filter((c) => c.wearable === 0).map((c) => c.season);
    slots.push({
      slot,
      category,
      pieces: inSlot.length,
      carriesSeason: inSlot.filter((p) => p.seasons.length > 0).length,
      unstated: inSlot.filter((p) => p.seasons.length === 0).length,
      neverWorn: inSlot.filter((p) => p.wears === 0).length,
      dormant: inSlot.filter((p) => {
        const d = idleDays(p, today);
        return d !== null && d >= DORMANT_DAYS;
      }).length,
      cells,
      emptySeasons
    });
  }

  /* Occasions are free text, so the grouping is spelling-only and says so. */
  const byWord = new Map<string, { word: string; pieces: Piece[] }>();
  for (const p of pieces) {
    for (const w of p.occasions) {
      const key = w.toLowerCase();
      const bucket = byWord.get(key);
      if (bucket) bucket.pieces.push(p);
      else byWord.set(key, { word: w, pieces: [p] });
    }
  }
  const occasions: OccasionCoverage[] = [...byWord.values()]
    .map((b) => ({ word: b.word, pieces: b.pieces.length, neverWorn: b.pieces.filter((p) => p.wears === 0).length }))
    .sort((a, b) => b.pieces - a.pieces || a.word.localeCompare(b.word));

  const totals: CoverageTotals = {
    rows: pieces.length,
    placeable: placeable.length,
    unplacable: pieces.length - placeable.length,
    withSeason: pieces.filter((p) => p.seasons.length > 0).length,
    withoutSeason: pieces.filter((p) => p.seasons.length === 0).length,
    withOccasion: pieces.filter((p) => p.occasions.length > 0).length,
    withoutOccasion: pieces.filter((p) => p.occasions.length === 0).length,
    priced: pieces.filter((p) => p.price !== null && p.price > 0).length,
    unpriced: pieces.filter((p) => p.price === null || p.price <= 0).length
  };

  /* ------------------------------------------------------------ sentences */

  if (!pieces.length) {
    gaps.push('The closet holds no pieces, so there is nothing to count.');
    notes.push(COVERAGE_LIMIT_SENTENCE);
    return { slots, unplacable: [], occasions: [], gaps, notes, totals, rule: COVERAGE_RULE_SENTENCE };
  }

  for (const s of slots) {
    if (s.pieces === 0) {
      gaps.push(`Nothing in the closet is categorised as ${s.category}, so the “${s.slot}” slot can never fill.`);
      continue;
    }
    /* The All-season column answers a different question from the four calendar
       ones — "is anything good for all of them" — so it gets its own sentence. */
    const calendar = s.emptySeasons.filter((x) => x !== 'All-season');
    if (calendar.length) {
      gaps.push(
        `${s.category}: ${np(s.pieces, 'piece')} exist${s.pieces === 1 ? 's' : ''} but none can dress ${calendar.join(
          ', '
        )} — no piece carries that tag, none is tagged All-season, and none is left blank.`
      );
    }
    if (s.emptySeasons.includes('All-season')) {
      gaps.push(`${s.category}: ${np(s.pieces, 'piece')} ${is1(s.pieces, 'has', 'have')} a season written and none ${is1(s.pieces, 'is', 'are')} All-season, so nothing in this slot is good for every season.`);
    }
  }

  if (totals.unplacable) {
    notes.push(
      `${totals.unplacable} of ${totals.rows} pieces sit in a category that fills no slot (${[...unplacableCategories.entries()]
        .map(([c, n]) => `${c} ${n}`)
        .join(', ')}). They are counted here and left out of every slot row.`
    );
  }
  if (totals.withoutSeason) {
    notes.push(
      `${np(totals.withoutSeason, 'piece')} ${is1(totals.withoutSeason, 'carries', 'carry')} no season at all. Every season cell counts an untagged piece as reachable, because a filter cannot exclude a blank — so a season number here is never smaller than what you could actually wear.`
    );
  }
  if (!totals.withSeason) {
    notes.push('Nothing carries a season, so every season cell is counting blanks. The matrix cannot say anything about seasonality until pieces are tagged.');
  }
  if (occasions.length) {
    notes.push(
      `Occasions are your own words, grouped only on spelling: “${occasions[0].word}” and “${occasions[0].word.toLowerCase()}” would be one row, “interview” and “job interview” would be two. No occasion is written on ${totals.withoutOccasion} of ${totals.rows} pieces, so those count against none of the rows above.`
    );
  } else {
    notes.push(`No piece carries an occasion, so the occasion rows would all read zero — nothing to group. ${np(totals.withoutOccasion, 'piece')} ${is1(totals.withoutOccasion, 'carries', 'carry')} no word.`);
  }
  if (totals.unpriced) {
    notes.push(`${np(totals.unpriced, 'piece')} ${is1(totals.unpriced, 'has', 'have')} no price, so cost per wear stays unverified for ${is1(totals.unpriced, 'it', 'them')} and no total spend is printed here.`);
  }

  notes.push(COVERAGE_LIMIT_SENTENCE);

  return {
    slots,
    unplacable: [...unplacableCategories.entries()].map(([category, pieces]) => ({ category, pieces })).sort((a, b) => b.pieces - a.pieces || a.category.localeCompare(b.category)),
    occasions,
    gaps,
    notes,
    totals,
    rule: COVERAGE_RULE_SENTENCE
  };
}

/** The one-line summary a dashboard can print without repeating the matrix. */
export function coverageHeadline(c: CoveragePlan): string {
  if (!c.totals.rows) return 'No pieces logged yet.';
  const fillable = c.slots.filter((s) => s.pieces > 0).length;
  const never = c.slots.filter((s) => s.pieces === 0).map((s) => s.slot);
  const seasonHoles = c.slots.reduce((n, s) => n + s.emptySeasons.length, 0);
  const head = `${fillable} of ${c.slots.length} slots have pieces (${c.totals.placeable} of ${c.totals.rows} pieces placeable)`;
  if (!never.length && !seasonHoles) return `${head}, and every slot can dress every season.`;
  const parts = [head];
  if (never.length) parts.push(`${never.length} slot${never.length === 1 ? '' : 's'} empty: ${never.join(', ')}`);
  if (seasonHoles) parts.push(`${seasonHoles} slot-season combination${seasonHoles === 1 ? '' : 's'} nothing can dress`);
  return `${parts.join('; ')}.`;
}

/* ------------------------------------------------- the coverage-hole tag pass */

/**
 * What the assist is for: a cell whose `tagged` count is low while its slot
 * carries untagged pieces cannot be told apart from a real hole in the closet.
 * Only she can tell them apart, so this hands her the rows behind the number
 * one at a time and writes nothing she has not chosen for that one piece.
 */

/** A piece whose `seasons` field is empty — counted everywhere, tagged nowhere. */
export function isUntagged(row: AnyRow | null | undefined): boolean {
  if (!row) return false;
  return toPiece(row).seasons.length === 0;
}

/**
 * The actual `clothingItems` rows behind a slot's `unstated` count.
 *
 * `key` is either a slot name ("Top") or a category ("Tops") — the two words
 * the matrix prints beside each other. Categories are compared exactly, the way
 * `coverageOf` and the draw compare them, so a mistyped "Tops " is reported by
 * its own category and never folded into a slot it does not fill.
 *
 * Ordered by her own name, then the row id, so the same closet hands her the
 * same list twice. A piece that carries a season is never in it, which is what
 * makes running the pass again safe: a piece she tagged is not offered again.
 */
export function unstatedPieces(rows: readonly AnyRow[], key: string): AnyRow[] {
  const wanted = (row: AnyRow) => {
    const p = toPiece(row);
    return p.category === key || SLOT_OF[p.category] === key;
  };
  return rows
    .filter((row) => Boolean(row) && wanted(row) && isUntagged(row))
    .sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')) || String(a.id).localeCompare(String(b.id)));
}

export interface TagAssist {
  /** the slot or category the pass is scoped to */
  key: string;
  /** the closet category it writes against, as she spelled it */
  category: string;
  pieces: AnyRow[];
  /** how many pieces the slot holds in total, tagged or not */
  slotPieces: number;
  /** the season columns reading entirely from blanks and All-season pieces */
  blindSeasons: string[];
  summary: string;
}

/**
 * Everything the assist prints, from her rows alone: the pieces, the columns
 * they are distorting, and the sentence that says what the pass can and cannot
 * do. `tagged` and `unstated` come straight out of `coverageOf`, so the assist
 * cannot disagree with the matrix it is sitting under.
 */
export function tagAssist(rows: readonly AnyRow[], today: string, key: string): TagAssist {
  const c = coverageOf(rows as AnyRow[], today);
  const slot = c.slots.find((s) => s.slot === key) ?? null;
  const category = slot ? slot.category : key;
  const pieces = unstatedPieces(rows, key);
  const blindSeasons = slot
    ? slot.cells.filter((cell) => cell.tagged === 0 && cell.wearable > 0 && slot.unstated > 0).map((cell) => cell.season)
    : [];
  const slotPieces = slot ? slot.pieces : pieces.length;
  return { key, category, pieces, slotPieces, blindSeasons, summary: tagAssistSummary(pieces.length, slotPieces, category, blindSeasons) };
}

/** The header sentence. It states the limit, then what she is about to do about it. */
export function tagAssistSummary(
  untagged: number,
  inSlot: number,
  category: string,
  blindSeasons: string[] = []
): string {
  if (!untagged) return `Every piece filed under ${category} carries a season, so there is nothing here to go through.`;
  const hole = blindSeasons.length
    ? ` The ${blindSeasons.join(', ')} column${blindSeasons.length === 1 ? '' : 's'} read${inSlot === 1 ? 's' : ''} entirely from blanks and All-season pieces with nothing tagged, so a low tagged number there is a missing tag rather than a missing garment.`
    : '';
  return `${untagged} of ${inSlot} pieces filed under ${category} carry no season at all.${hole} Going through them writes a season on the one piece you are looking at, and on nothing else — this app has not seen the garment and will not read one off a photograph.`;
}

/** The step line: whose piece this is, and how far through the set she is. */
export function tagAssistStep(name: string, done: number, total: number): string {
  return `Piece ${done + 1} of ${total} — “${name || 'unnamed piece'}”. ${done} of ${total} done.`;
}

/* ------------------------------------------------------------- dashboard glance */

export interface ClosetGlance {
  headline: string;
  /** the placeable piece that has waited longest; `days: null` is her "no date written" case */
  sitting: { name: string; slot: SlotName; days: number | null; wears: number } | null;
  /** placeable pieces carrying no last-worn date at all, so the longest span cannot be named */
  undated: number;
  rows: number;
  placeable: number;
  /** whole-closet gap sentences, which include categories that fill no slot */
  gaps: number;
  /** slot x season pairs nothing can dress — the season holes alone */
  seasonHoles: number;
}

export interface GlanceLines {
  /** what the card prints under the headline */
  sitting: string;
  /** what the two numbers are, and what they are not */
  note: string;
}

/**
 * Two numbers for the dashboard, read off the same rows `coverageOf` counts.
 * The wait is a fact from her wear log — the card never claims the daily draw
 * would pick this piece, because the draw ranks on occasion, cost per wear and
 * pairing evidence too, and all of that stays on the closet page.
 */
export function closetGlance(rows: AnyRow[], today: string): ClosetGlance {
  const coverage = coverageOf(rows, today);
  const inSlot = rows.map(toPiece).filter((p) => SLOT_OF[p.category]);
  const undated = inSlot.filter((p) => idleDays(p, today) === null);
  const dated = inSlot.filter((p) => idleDays(p, today) !== null);

  /* Never worn sorts ahead of anything dated, the way rank() does; after that
     the longest span wins, and the leftovers are her own tie-breaks. */
  const neverWorn = inSlot.filter((p) => p.wears === 0);
  const first = neverWorn.length
    ? byName(neverWorn)[0]
    : dated
        .slice()
        .sort(
          (a, b) =>
            (idleDays(b, today) ?? 0) - (idleDays(a, today) ?? 0) || a.wears - b.wears || a.name.localeCompare(b.name) || a.id.localeCompare(b.id)
        )[0] ?? null;
  const slot = first ? SLOT_OF[first.category] ?? null : null;

  return {
    headline: coverageHeadline(coverage),
    sitting: first && slot ? { name: first.name, slot, days: idleDays(first, today), wears: first.wears } : null,
    undated: undated.length,
    rows: coverage.totals.rows,
    placeable: coverage.totals.placeable,
    gaps: coverage.gaps.length,
    seasonHoles: coverage.slots.reduce((n, s) => n + s.emptySeasons.length, 0)
  };
}

/** Name, then row id — so a closet of two identical names still prints the same piece. */
const byName = (list: Piece[]) => list.slice().sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

/** The prose the glance card prints, so the sentence is testable without a DOM. */
export function glanceLines(g: ClosetGlance): GlanceLines {
  if (!g.rows) {
    return {
      sitting: 'Nothing logged yet — the closet is empty until you record a piece.',
      note: 'Neither number is advice about what to wear or what to buy.'
    };
  }
  const sitting = !g.sitting
    ? `Every placeable piece here has a wear count but no last-worn date (${np(g.undated, 'piece')} without one), so nothing can be called the longest-waiting.`
    : g.sitting.days === null
      ? `“${g.sitting.name}” (${g.sitting.slot}) has never been worn and carries no wear date.`
      : g.sitting.wears === 0
        ? `“${g.sitting.name}” (${g.sitting.slot}) has waited ${g.sitting.days} day${is1(g.sitting.days, '', 's')} since a wear date, but no wears are logged — the number comes from the date alone.`
        : `“${g.sitting.name}” (${g.sitting.slot}) was last worn ${g.sitting.days} day${is1(g.sitting.days, '', 's')} ago, with ${np(g.sitting.wears, 'wear')} logged.`;
  return {
    sitting,
    note: 'Both numbers count only the pieces you logged, and the dates they name are your own. The closet draw — which also ranks on occasion, cost per wear and pairing evidence — runs on the closet page, not here. Nothing on this card is advice about what to wear or what to buy.'
  };
}
