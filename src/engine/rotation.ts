/**
 * THE GLOW LAB — closet rotation arithmetic (spec Part 14).
 *
 * "What should I wear next?" answered with a sort, not a stylist. Every number
 * here is read off a `clothingItems` or `outfits` row she typed: `wears`,
 * `data.lastWornOn`, `seasons`, `occasions`, `price`. Nothing is recognised in a
 * photograph, nothing is scored for attractiveness, and no garment is invented
 * to fill a slot that her closet cannot fill — a missing slot is reported as a
 * gap with the count that produced it.
 *
 * The order is a lexicographic sort on four stated keys, so the same closet
 * always draws the same look:
 *
 *   1. idle first — never worn, otherwise the longest since it was last worn;
 *   2. then fewest logged wears;
 *   3. then, only among priced pieces, the highest cost per wear, which is the
 *      piece doing the least work for the money it already cost;
 *   4. then name A–Z, then row id, so ties never wander between visits.
 *
 * That answers "which piece has waited longest", not "which of these go
 * together", so a second layer sits on top of it when the caller passes the
 * colour reads from `pairing.ts`: once the look holds its first piece, each
 * following slot is re-ordered on her own co-worn history, then on the colour
 * relationship the arithmetic can name, then back onto the four keys above. The
 * second layer is additive — with no colour map the output is byte-for-byte the
 * idle order, and a piece the pairing keys cannot speak about keeps its place.
 */
import type { AnyRow } from '../db/schema';
import { costPerWear } from './duplicates';
import {
  coWearIndex,
  coWornSentence,
  colourCoverage,
  pairScore,
  pairingEvidence,
  readCoWorn,
  type CoWornRead,
  type Coverage,
  type PieceColour
} from './pairing';

export const ROTATION_RULE_VERSION = 2;

/** A piece worn inside this many days is set aside — only if the slot has an alternative. */
export const REPEAT_WINDOW_DAYS = 7;
/** An assembled outfit not worn for this long is offered before a newly built combination. */
export const STALE_OUTFIT_DAYS = 30;
/** How many ranked alternatives each slot keeps for the "another option" button. */
export const CANDIDATES_PER_SLOT = 5;

export type SlotName = 'Dress or set' | 'Top' | 'Bottom' | 'Outer layer' | 'Shoes' | 'Bag';

/** Closet category → the slot it can fill. Categories not listed fill nothing. */
/** Exported for `coverage.ts`, which counts the same slots the draw fills. */
export const SLOT_OF: Record<string, SlotName> = {
  'Dresses & Sets': 'Dress or set',
  Tops: 'Top',
  Bottoms: 'Bottom',
  Outerwear: 'Outer layer',
  Footwear: 'Shoes',
  Bags: 'Bag'
};

export const SLOT_ORDER: SlotName[] = ['Dress or set', 'Top', 'Bottom', 'Outer layer', 'Shoes', 'Bag'];

/** The reverse read: which closet category each slot is filled from. */
export const SLOT_CATEGORY: Record<SlotName, string> = SLOT_ORDER.reduce(
  (acc, slot) => ({ ...acc, [slot]: Object.keys(SLOT_OF).find((k) => SLOT_OF[k] === slot) ?? slot }),
  {} as Record<SlotName, string>
);

export interface RotationItem {
  id: string;
  name: string;
  category: string;
  wears: number;
  lastWornOn: string | null;
  seasons: string[];
  occasions: string[];
  price: number | null;
}

export interface RankedPiece extends RotationItem {
  slot: SlotName;
  /** days between `lastWornOn` and `today`; null when that date was never written */
  daysSinceWorn: number | null;
  costPerWear: number | null;
  /** true when the row carries no season at all, so the season filter could not read it */
  seasonUnstated: boolean;
  occasionMatched: boolean;
  /** how the piece ranks, in the words the screen prints */
  reasons: string[];
}

export interface Slot {
  name: SlotName;
  required: boolean;
  pieces: RankedPiece[];
  /** index into `pieces` of the piece currently chosen */
  at: number;
}

export interface RotationPlan {
  kind: 'existing-outfit' | 'built' | 'empty';
  /** the outfits row preferred by the stale-outfit rule, when there is one */
  outfitId: string | null;
  outfitName: string;
  slots: Slot[];
  gaps: string[];
  notes: string[];
  /** how many rows the whole draw was able to consider */
  poolSize: number;
  rule: string;
  /** null when no colour reads were passed; otherwise what the pairing layer could and did say */
  pairing: PairingSummary | null;
}

export interface PairingSummary {
  /** placeable pieces whose colour could be read at all */
  readable: number;
  /** placeable pieces the draw had to choose between */
  total: number;
  /** distinct co-worn pairs available from her own outfit rows */
  coWornPairs: number;
  slots: number;
  /** slots where the pairing layer put something other than the idlest piece first */
  moved: number;
  saidColour: number;
  saidCoWorn: number;
}

export interface RotationOptions {
  season: string;
  occasion: string;
  today: string;
  useOuterwear: boolean;
}

function toItem(row: AnyRow): RotationItem {
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    category: String(row.category ?? ''),
    wears: Number(row.wears ?? 0) || 0,
    lastWornOn: (row.data?.lastWornOn as string | null) ?? null,
    seasons: ((row.seasons as string[]) ?? []).map((s) => String(s)),
    occasions: ((row.occasions as string[]) ?? []).map((s) => String(s)),
    price: typeof row.price === 'number' ? row.price : null
  };
}

export function daysBetween(iso: string | null, today: string): number | null {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  const [ty, tm, td] = today.split('-').map(Number);
  if (!y || !m || !d || !ty || !tm || !td) return null;
  const then = new Date(y, m - 1, d).getTime();
  const now = new Date(ty, tm - 1, td).getTime();
  if (!Number.isFinite(then) || !Number.isFinite(now)) return null;
  return Math.round((now - then) / 86400000);
}

const has = (list: string[], needle: string) => list.some((v) => v.toLowerCase() === needle.toLowerCase());

/**
 * Occasions are free text she typed, so "Interview" has to reach "job interview"
 * and back. Containment both ways, case-insensitive — never a synonym table,
 * because a word list would be the app deciding what her occasions are.
 */
const about = (list: string[], needle: string) => {
  const n = needle.trim().toLowerCase();
  if (!n) return false;
  return list.some((v) => {
    const x = v.trim().toLowerCase();
    return x === n || x.includes(n) || n.includes(x);
  });
};

/**
 * Ranked alternatives for one slot. The filter chain is stated in `notes` by
 * the caller, so this function only decides order and eligibility.
 */
function rank(items: RotationItem[], slot: SlotName, o: RotationOptions): RankedPiece[] {
  const out: RankedPiece[] = [];
  for (const i of items) {
    if (SLOT_OF[i.category] !== slot) continue;
    const seasonUnstated = i.seasons.length === 0;
    const seasonOk = seasonUnstated || has(i.seasons, o.season) || has(i.seasons, 'All-season') || o.season === '';
    if (!seasonOk) continue;
    const matchedOccasion = o.occasion === '' ? '' : i.occasions.find((v) => about([v], o.occasion)) ?? '';
    const occasionMatched = matchedOccasion !== '';
    const daysSinceWorn = daysBetween(i.lastWornOn, o.today);
    const cpw = costPerWear(i.price, i.wears);
    const reasons: string[] = [];
    if (daysSinceWorn === null) reasons.push(i.wears === 0 ? 'never worn' : 'no last-worn date written');
    else reasons.push(daysSinceWorn === 0 ? 'worn today' : `last worn ${daysSinceWorn} day${daysSinceWorn === 1 ? '' : 's'} ago`);
    reasons.push(`${i.wears} wear${i.wears === 1 ? '' : 's'} logged`);
    reasons.push(cpw === null ? 'cost per wear unverified — price or wears missing' : `cost per wear ${cpw.toFixed(2)}`);
    if (seasonUnstated && o.season) reasons.push('no season written, so the season filter could not read it');
    if (occasionMatched) reasons.push(`you marked it “${matchedOccasion}”`);
    out.push({ ...i, slot, daysSinceWorn, costPerWear: cpw, seasonUnstated, occasionMatched, reasons });
  }
  /* When the slot holds anything at all that carries this occasion, those go first —
    a preference, not an exclusion, so a loose word cannot empty a slot. */
  const prefersOccasion = o.occasion !== '' && out.some((p) => p.occasionMatched);
  return out.sort((a, b) => {
    if (prefersOccasion && a.occasionMatched !== b.occasionMatched) return a.occasionMatched ? -1 : 1;
    const idleA = a.daysSinceWorn ?? Number.POSITIVE_INFINITY;
    const idleB = b.daysSinceWorn ?? Number.POSITIVE_INFINITY;
    if (idleA !== idleB) return idleB - idleA;
    if (a.wears !== b.wears) return a.wears - b.wears;
    const cpwA = a.costPerWear ?? Number.NEGATIVE_INFINITY;
    const cpwB = b.costPerWear ?? Number.NEGATIVE_INFINITY;
    if (cpwA !== cpwB) return cpwB - cpwA;
    const n = a.name.localeCompare(b.name);
    return n !== 0 ? n : a.id.localeCompare(b.id);
  });
}

/** Rows the stale-outfit rule is allowed to consider, best idle first. */
function staleOutfits(outfits: AnyRow[], eligible: Set<string>, o: RotationOptions): AnyRow[] {
  return outfits
    .filter((row) => {
      const ids = ((row.itemIds as string[]) ?? []).map(String);
      if (ids.length < 2) return false;
      if (!ids.every((id) => eligible.has(id))) return false;
      const season = String(row.season ?? '');
      if (o.season && season && season.toLowerCase() !== o.season.toLowerCase() && season.toLowerCase() !== 'all-season') return false;
      const stated = String(row.occasion ?? '');
      if (o.occasion && stated && !about([stated], o.occasion)) return false;
      const worn = daysBetween(row.lastWornOn ? String(row.lastWornOn) : null, o.today);
      return worn === null || worn >= STALE_OUTFIT_DAYS;
    })
    .sort((a, b) => {
      const da = daysBetween(a.lastWornOn ? String(a.lastWornOn) : null, o.today) ?? Number.POSITIVE_INFINITY;
      const db = daysBetween(b.lastWornOn ? String(b.lastWornOn) : null, o.today) ?? Number.POSITIVE_INFINITY;
      if (da !== db) return db - da;
      const n = String(a.name ?? '').localeCompare(String(b.name ?? ''));
      return n !== 0 ? n : String(a.id).localeCompare(String(b.id));
    });
}

export const RULE_SENTENCE =
  'Order: pieces you marked for that occasion come first when the slot holds any, then idlest (never worn, or the longest since it was last worn), then fewest logged wears, then highest cost per wear among priced pieces, then name, then row id. A piece worn in the last 7 days is set aside only when the slot has something else to offer, and the season filter only excludes a piece that carries a season.';

/**
 * Printed under the idle sentence only when the caller passed colour reads. It
 * says what the second layer can and cannot claim: it names relationships, it
 * does not rate them, and it never demotes a piece it cannot read.
 */
export const PAIRING_RULE_SENTENCE =
  'Once the look holds a piece, each following slot is re-ordered on her own evidence first: pieces that appear beside it in an outfit row she assembled, then the rating she gave those rows, then the colour relationship the arithmetic can name between the two — tone-on-tone, a value step, a neutral anchor, adjacent hues, opposite hues, or the same colour word — measured from the swatches already stored on each piece photograph, or taken from the colours she typed. Confidence records how completely a pair could be read, never how good it looks. A piece whose colour cannot be read is never dropped and never counted worse: it simply carries no pairing evidence, so it keeps the place the idle order gave it wherever the other candidates carry none either.';

interface PlacedPiece {
  id: string;
  name: string;
  slot: SlotName;
}

interface ScoredPiece {
  piece: RankedPiece;
  /** outfit rows she stored containing this piece and one already in the look */
  coLooks: number;
  /** best mean rating among those rows, null when she rated none */
  coRating: number | null;
  /** confidence of the strongest nameable colour relationship */
  confidence: number;
  saidCoWorn: boolean;
  saidColour: boolean;
  base: number;
}

/**
 * Re-order one slot against the pieces already placed. Three new keys, each of
 * which is silent without evidence, and the base index last — so a pairing layer
 * with nothing to say reproduces the idle order exactly, and the same closet
 * still draws the same look.
 */
function pairOrder(
  pool: RankedPiece[],
  placed: PlacedPiece[],
  colours: Map<string, PieceColour>,
  coWorn: Map<string, CoWornRead>
): ScoredPiece[] {
  const scored: ScoredPiece[] = pool.map((piece, base) => {
    let coLooks = 0;
    let coRating: number | null = null;
    let bestCo: { other: PlacedPiece; read: CoWornRead } | null = null;
    let bestPair: { other: PlacedPiece; confidence: number; reason: string } | null = null;

    for (const other of placed) {
      if (other.id === piece.id) continue;
      const worn = readCoWorn(coWorn, piece.id, other.id);
      if (worn.looks) {
        coLooks += worn.looks;
        if (worn.meanRating !== null && (coRating === null || worn.meanRating > coRating)) coRating = worn.meanRating;
        if (!bestCo || worn.looks > bestCo.read.looks || (worn.looks === bestCo.read.looks && (worn.meanRating ?? -1) > (bestCo.read.meanRating ?? -1))) {
          bestCo = { other, read: worn };
        }
      }
      const a = colours.get(piece.id);
      const b = colours.get(other.id);
      if (!a || !b) continue;
      const read = pairScore(a, b, other.name);
      if (!read.readable) continue;
      if (!bestPair || read.confidence > bestPair.confidence) bestPair = { other, confidence: read.confidence, reason: read.reason };
    }

    const extra: string[] = [];
    if (bestCo) {
      const sentence = coWornSentence(bestCo.read, bestCo.other.name);
      if (sentence) extra.push(sentence);
    }
    if (bestPair) extra.push(bestPair.reason);
    return {
      piece: extra.length ? { ...piece, reasons: [...piece.reasons, ...extra] } : piece,
      coLooks,
      coRating,
      confidence: bestPair?.confidence ?? 0,
      saidCoWorn: Boolean(bestCo),
      saidColour: Boolean(bestPair),
      base
    };
  });

  return scored.sort((x, y) => {
    if (x.coLooks !== y.coLooks) return y.coLooks - x.coLooks;
    const rx = x.coRating ?? -1;
    const ry = y.coRating ?? -1;
    if (rx !== ry) return ry - rx;
    if (x.confidence !== y.confidence) return y.confidence - x.confidence;
    return x.base - y.base;
  });
}

/**
 * Draw the look. `items` and `outfits` are live `clothingItems` / `outfits` rows;
 * nothing else is consulted, so an empty closet produces an empty plan with the
 * reason, not a picture of a stranger's wardrobe. `colours` is optional: the
 * caller builds it from `mediaItems.data.palette` and each garment's typed
 * colours through `pairing.colourOf`, and passing nothing keeps the pure idle
 * order.
 */
export function planLook(
  rows: AnyRow[],
  outfitRows: AnyRow[],
  options: RotationOptions,
  colours: Map<string, PieceColour> | null = null
): RotationPlan {
  const o: RotationOptions = { ...options, season: options.season.trim(), occasion: options.occasion.trim() };
  const items = rows.map(toItem);
  const notes: string[] = [];
  const gaps: string[] = [];
  const colourMap = colours && colours.size ? colours : null;
  const coWorn = colourMap ? coWearIndex(outfitRows) : null;
  const rule = colourMap ? `${RULE_SENTENCE} ${PAIRING_RULE_SENTENCE}` : RULE_SENTENCE;

  if (!items.length) {
    return {
      kind: 'empty',
      outfitId: null,
      outfitName: '',
      slots: [],
      gaps: ['No clothing items in the closet — the draw has nothing to order.'],
      notes: [],
      poolSize: 0,
      rule,
      pairing: null
    };
  }

  const bySlot: Record<SlotName, RankedPiece[]> = {
    'Dress or set': [],
    Top: [],
    Bottom: [],
    'Outer layer': [],
    Shoes: [],
    Bag: []
  };
  for (const slot of SLOT_ORDER) bySlot[slot] = rank(items, slot, o);

  const counted = items.filter((i) => SLOT_OF[i.category]);
  if (counted.length < items.length) {
    notes.push(
      `${items.length - counted.length} of ${items.length} pieces sit in a category this draw does not place (Knitwear, Activewear, Accessories, Sleep & Lounge, Special Occasion, or a category name you typed yourself), so they were left out.`
    );
  }
  const unstated = items.filter((i) => i.seasons.length === 0).length;
  if (o.season && unstated) notes.push(`${unstated} pieces carry no season, so the season filter could not exclude them either.`);
  if (o.occasion) {
    const marked = items.filter((i) => i.occasions.length > 0).length;
    if (!marked) notes.push(`Nothing carries an occasion, so “${o.occasion}” could not filter anything.`);
    else {
      const matching = items.filter((i) => about(i.occasions, o.occasion)).length;
      notes.push(
        matching
          ? `${matching} of ${marked} pieces that declare an occasion declare something that reads as “${o.occasion}”; those are drawn first, and the rest stay in the pile.`
          : `Nothing in the pile reads as “${o.occasion}” — ${marked} piece${marked === 1 ? '' : 's'} declare${marked === 1 ? 's' : ''} an occasion, none of them that one — so the occasion could not rank anything and only the idle order was used.`
      );
    }
  }

  const eligible = new Set(Object.values(bySlot).flat().map((p) => p.id));

  /* The denominators come first, so what follows is read against a stated
     coverage rather than as an unexplained preference. */
  let evidence: { rows: number; pairs: number; rated: number } | null = null;
  let coverage: Coverage | null = null;
  if (colourMap) {
    const cov = colourCoverage(colourMap, [...eligible]);
    coverage = cov;
    const origins: string[] = [];
    if (cov.fromPhotograph) origins.push(`${cov.fromPhotograph} from a photograph you stored`);
    if (cov.fromTypedHex) origins.push(`${cov.fromTypedHex} from a colour code you typed`);
    if (cov.fromTypedWord) origins.push(`${cov.fromTypedWord} from a colour word you typed`);
    if (!cov.readable) {
      notes.push(
        `Colour could not be read for any of the ${cov.total} placeable piece${cov.total === 1 ? '' : 's'} — none carries a stored photograph with a palette, and none carries a colour you typed — so the pairing keys were skipped entirely and only the idle order decided.`
      );
    } else {
      notes.push(
        `Colour was read for ${cov.readable} of ${cov.total} placeable piece${cov.total === 1 ? '' : 's'}${
          origins.length ? ` (${origins.join(', ')})` : ''
        }; for the other ${cov.unreadable}, the pairing keys had nothing to say and the idle order decided.`
      );
      if (cov.varied) {
        notes.push(
          `${cov.varied} piece${cov.varied === 1 ? '' : 's'} carry a colour word with no single hue — a print, a metal, a sheer — so they were treated as unreadable rather than guessed at.`
        );
      }
      if (cov.unnamed) {
        notes.push(
          `${cov.unnamed} piece${cov.unnamed === 1 ? '' : 's'} have a colour tag outside the vocabulary this app reads; the tag stays on the row and no family was invented for it.`
        );
      }
      if (cov.fromTypedWord) {
        notes.push('Where the only evidence is a colour word, the relationship named is the same one but counted with less confidence — the app does not invent a hue or a depth for a word.');
      }
    }
    evidence = pairingEvidence(outfitRows, eligible);
    if (!evidence.rows) {
      notes.push(
        outfitRows.length === 0
          ? 'You have not stored an outfit yet, so the co-worn key had nothing of yours to rank and colour and the idle order decided.'
          : `None of the ${outfitRows.length} outfit row${outfitRows.length === 1 ? '' : 's'} you stored puts two pieces from this pile together, so the co-worn key had nothing to rank.`
      );
    } else {
      notes.push(
        `The co-worn key read ${evidence.rows} outfit row${evidence.rows === 1 ? '' : 's'} you assembled that ${
          evidence.rows === 1 ? 'holds' : 'hold'
        } at least two pieces from this pile — ${evidence.pairs} distinct pair${
          evidence.pairs === 1 ? '' : 's'
        }, of which you rated ${evidence.rated}.`
      );
    }
  }

  const stale = staleOutfits(outfitRows, eligible, o);
  if (stale.length) {
    const row = stale[0];
    const ids = ((row.itemIds as string[]) ?? []).map(String);
    const chosen = ids.map((id) => items.find((i) => i.id === id)!).filter(Boolean);
    const slots: Slot[] = [];
    for (const piece of chosen) {
      const slot = SLOT_OF[piece.category];
      if (!slot) continue;
      const pool = bySlot[slot] ?? [];
      const at = Math.max(0, pool.findIndex((p) => p.id === piece.id));
      slots.push({ name: slot, required: false, pieces: pool.slice(0, CANDIDATES_PER_SLOT), at });
    }
    const worn = daysBetween(row.lastWornOn ? String(row.lastWornOn) : null, o.today);
    notes.push(
      `An outfit you already assembled is idle, so it comes before a new combination: “${row.name}” (${ids.length} pieces, ${
        row.wornCount ?? 0
      } wears logged${worn === null ? ', no last-worn date' : `, last worn ${worn} days ago`}).`
    );
    if (colourMap) notes.push('That outfit is offered whole, so the pairing keys had nothing to re-order — the alternatives behind each slot stay in the idle order.');
    return { kind: 'existing-outfit', outfitId: String(row.id), outfitName: String(row.name ?? ''), slots, gaps, notes, poolSize: items.length, rule, pairing: null };
  }

  const dress = bySlot['Dress or set'];
  const wantOuter = o.useOuterwear && (!o.season || ['Winter', 'Autumn', 'All-season'].some((s) => s.toLowerCase() === o.season.toLowerCase()));
  const plan: SlotName[] = dress.length
    ? ['Dress or set', ...(wantOuter ? ['Outer layer' as SlotName] : []), 'Shoes', 'Bag']
    : ['Top', 'Bottom', ...(wantOuter ? ['Outer layer' as SlotName] : []), 'Shoes', 'Bag'];

  const slots: Slot[] = [];
  const placed: PlacedPiece[] = [];
  let saidColour = 0;
  let saidCoWorn = 0;
  let moved = 0;
  for (const name of plan) {
    const pool = bySlot[name];
    const required = name === 'Top' || name === 'Bottom';
    if (!pool.length) {
      const inCategory = items.filter((i) => SLOT_OF[i.category] === name).length;
      /* What the draw was *given*, not what the closet holds: when a week is
         being planned, a category can be empty because earlier days used it. */
      gaps.push(
        inCategory
          ? `No ${name.toLowerCase()} available: ${inCategory} in that ${inCategory === 1 ? 'category' : 'categories'} exist, but ${o.season ? `none carry ${o.season} or All-season` : 'none could be placed'}.`
          : `Nothing in the pieces this look was drawn from is categorised as ${SLOT_CATEGORY[name]} — the ${name.toLowerCase()} slot stayed empty.`
      );
      continue;
    }
    const fresh = pool.filter((p) => (p.daysSinceWorn ?? REPEAT_WINDOW_DAYS + 1) > REPEAT_WINDOW_DAYS);
    const usable = fresh.length ? fresh : pool;
    if (!fresh.length) notes.push(`Every ${name.toLowerCase()} option was worn within ${REPEAT_WINDOW_DAYS} days, so the set-aside rule was dropped rather than leave the slot empty.`);
    else if (fresh.length < pool.length) notes.push(`${pool.length - fresh.length} ${name.toLowerCase()} option${pool.length - fresh.length === 1 ? ' was' : 's were'} set aside for having been worn in the last ${REPEAT_WINDOW_DAYS} days.`);
    /* The first slot has nothing to pair against; every slot after it is scored
       against what the look already holds. */
    const scored =
      colourMap && coWorn && placed.length
        ? pairOrder(usable, placed, colourMap, coWorn)
        : usable.map((piece, base) => ({ piece, coLooks: 0, coRating: null, confidence: 0, saidCoWorn: false, saidColour: false, base }));
    const ordered = scored.map((s) => s.piece);
    const top = scored[0];
    if (top?.saidColour) saidColour += 1;
    if (top?.saidCoWorn) saidCoWorn += 1;
    if (top && usable.length > 1 && usable[0].id !== top.piece.id) moved += 1;
    if (top) placed.push({ id: top.piece.id, name: top.piece.name, slot: name });
    slots.push({ name, required, pieces: ordered.slice(0, CANDIDATES_PER_SLOT), at: 0 });
  }

  if (colourMap && evidence) {
    if (evidence.pairs && !saidCoWorn) {
      notes.push('None of the pieces this look drew had been stored together with a piece already in it, so the co-worn key changed nothing this time.');
    }
    if (placed.length > 1) {
      if (moved) {
        notes.push(
          `The pairing keys took the first choice in ${moved} of ${slots.length} slot${slots.length === 1 ? '' : 's'} over the idlest piece; the sentence printed beside each piece says which key took it.`
        );
      } else if (saidColour || saidCoWorn) {
        notes.push(
          `The pairing keys could speak in ${saidColour + saidCoWorn} slot${saidColour + saidCoWorn === 1 ? '' : 's'} and changed nothing — the idlest piece was also the best-supported one, so the two layers agree here.`
        );
      } else {
        notes.push('The pairing keys found nothing they could say about the pieces this look drew — no readable colour and no stored outfit holding two of them together — so every slot is the idlest candidate.');
      }
    }
  }

  const built = slots.filter((s) => s.pieces.length);
  if (!built.length) {
    return { kind: 'empty', outfitId: null, outfitName: '', slots, gaps, notes, poolSize: items.length, rule, pairing: null };
  }
  if (dress.length) notes.push('A dress or set was available, so no separate top and bottom were drawn.');
  if (!o.useOuterwear) notes.push('No outer layer was drawn — the switch for it is off.');
  return {
    kind: 'built',
    outfitId: null,
    outfitName: '',
    slots,
    gaps,
    notes,
    poolSize: items.length,
    rule,
    pairing: colourMap
      ? {
          readable: coverage?.readable ?? 0,
          total: coverage?.total ?? 0,
          coWornPairs: evidence?.pairs ?? 0,
          slots: built.length,
          moved,
          saidColour,
          saidCoWorn
        }
      : null
  };
}

/** The ids of the pieces currently chosen in a plan, for saving as an outfit row. */
export function chosenIds(plan: RotationPlan): string[] {
  return plan.slots.map((s) => s.pieces[s.at]?.id).filter((x): x is string => Boolean(x));
}

export function chosenNames(plan: RotationPlan): string[] {
  return plan.slots.map((s) => s.pieces[s.at]?.name ?? '').filter(Boolean);
}

/** A plain-language label for a plan she can accept as an outfit row. */
export function suggestedName(plan: RotationPlan, o: RotationOptions): string {
  const head = plan.kind === 'existing-outfit' ? plan.outfitName : chosenNames(plan).slice(0, 2).join(' + ');
  const bits = [o.occasion, o.season].filter(Boolean).join(', ');
  return bits ? `${head || 'Look'} — ${bits}` : head || 'Look';
}

/* ------------------------------------------------------------------ the week */

/** Calendar dates from `startDate`, forward, as ISO strings. */
export function weekDates(startDate: string, days: number): string[] {
  const [y, m, d] = (startDate || '').split('-').map(Number);
  if (!y || !m || !d) return [];
  const base = Date.UTC(y, m - 1, d);
  const out: string[] = [];
  for (let i = 0; i < Math.max(0, Math.floor(days)); i += 1) {
    out.push(new Date(base + i * 86400000).toISOString().slice(0, 10));
  }
  return out;
}

export interface WeekOptions extends Omit<RotationOptions, 'today'> {
  startDate: string;
  days: number;
  /** how a date is spoken of in the sentences; the ISO string is the fallback */
  label?: (iso: string) => string;
}

export interface DayPlan {
  date: string;
  plan: RotationPlan;
  /** what the day actually commits, in slot order */
  taken: { slot: SlotName; id: string; name: string }[];
  /** the base-layer slots the day could not fill — a look needs a dress, or a top and a bottom */
  unfilled: SlotName[];
  /** false when `unfilled` is non-empty, so the UI can mark the day as not a look */
  complete: boolean;
  /** what this day could not fill — printed inside the day, not in the week list */
  gaps: string[];
}

export interface WeekPlan {
  days: DayPlan[];
  gaps: string[];
  notes: string[];
  /** piece id → the date it was committed to */
  usedOn: Record<string, string>;
  /** pieces left in the closet that could have filled a slot this week */
  left: { slot: SlotName; ids: string[] }[];
  /** pieces left over in a category the draw cannot place */
  leftUnplaced: { category: string; ids: string[] }[];
  rule: string;
}

export const WEEK_RULE_SENTENCE =
  'A week is the same draw run one day at a time over what the earlier days left: day one takes its pieces out of the pile, day two is drawn from the rest, and no piece is committed twice. Each day is still ranked by the keys below, and an outfit you assembled before is only offered on a day when every piece in it is still free. Swapping a piece on any day re-runs the whole week from that day forward, so the seven looks always come from one arithmetic rather than seven separate guesses.';

/**
 * `pins` is `date → slot → piece id`. It is how the UI expresses "I want this
 * one on Tuesday": the week is recomputed with the pin, not patched, so the
 * days after it see the smaller pile.
 */
export function planWeek(
  rows: AnyRow[],
  outfitRows: AnyRow[],
  options: WeekOptions,
  colours: Map<string, PieceColour> | null = null,
  pins: Record<string, Partial<Record<SlotName, string>>> = {}
): WeekPlan {
  const gaps: string[] = [];
  const notes: string[] = [];
  const usedOn: Record<string, string> = {};
  const days: DayPlan[] = [];
  /** dates are spoken of the way the page speaks of them, never as bare ISO */
  const when = (iso: string) => options.label?.(iso) ?? iso;
  const rule = colours && colours.size ? `${WEEK_RULE_SENTENCE} ${PAIRING_RULE_SENTENCE}` : WEEK_RULE_SENTENCE;
  const dates = weekDates(options.startDate, options.days);

  if (!rows.length) {
    return {
      days: [],
      gaps: ['The closet holds no clothing items, so there is no week to plan.'],
      notes,
      usedOn,
      left: [],
      leftUnplaced: [],
      rule
    };
  }
  if (!dates.length) {
    return { days: [], gaps: [], notes: ['No dates were asked for, so nothing was drawn.'], usedOn, left: [], leftUnplaced: [], rule };
  }

  const free = new Set(rows.map((r) => String(r.id)));
  const nameOf = new Map(rows.map((r) => [String(r.id), String(r.name ?? '')]));

  for (const date of dates) {
    const pool = rows.filter((r) => free.has(String(r.id)));
    if (!pool.length) {
      gaps.push(`${when(date)}: nothing left to draw — every piece in the closet is already committed to an earlier day.`);
      continue;
    }
    /* The stale-outfit branch would otherwise offer the same assembled look on
       every day it still qualifies for. */
    const liveOutfits = outfitRows.filter((o) => {
      const ids = ((o.itemIds as string[]) ?? []).map(String);
      return ids.length > 0 && ids.every((id) => free.has(id));
    });
    const plan = planLook(pool, liveOutfits, { ...options, today: date }, colours);
    const dayPins = pins[date] ?? {};
    for (const slot of plan.slots) {
      const want = dayPins[slot.name];
      if (!want) continue;
      const at = slot.pieces.findIndex((p) => p.id === want);
      if (at >= 0) slot.at = at;
      else if (free.has(want)) notes.push(`${when(date)}: “${nameOf.get(want) ?? want}” is not one of the ${slot.name.toLowerCase()} options the draw produced for that day, so the pin was dropped rather than placed outside its slot.`);
      else notes.push(`${when(date)}: the piece pinned to ${slot.name.toLowerCase()} had already been taken by a day before it, so the pin was dropped rather than worn twice.`);
    }
    const taken: { slot: SlotName; id: string; name: string }[] = [];
    for (const slot of plan.slots) {
      const piece = slot.pieces[slot.at];
      if (!piece) continue;
      taken.push({ slot: slot.name, id: piece.id, name: piece.name });
    }
    /* Slots the draw could not fill are not in `plan.slots` at all, so the base
       layer is read off what the day actually wears: a dress, or a top and a
       bottom together. Shoes and a bag are wanted, never required. */
    const hasDress = taken.some((t) => t.slot === 'Dress or set');
    const unfilled = hasDress
      ? []
      : (['Top', 'Bottom'] as SlotName[]).filter((s) => !taken.some((t) => t.slot === s));
    /* A day that gets a card keeps its own reasons; a day that gets nothing has
       nowhere else to say them, so those go into the week list with the date. */
    if (!taken.length) {
      gaps.push(`${when(date)}: the draw could place nothing — ${plan.gaps.join(' ') || 'no slot in this pile was fillable'}.`);
      continue;
    }
    for (const t of taken) {
      usedOn[t.id] = date;
      free.delete(t.id);
    }
    days.push({ date, plan, taken, unfilled, complete: unfilled.length === 0, gaps: plan.gaps });
  }

  const slotOfId = (id: string): SlotName | null => {
    const row = rows.find((r) => String(r.id) === id);
    return row ? SLOT_OF[String(row.category ?? '')] ?? null : null;
  };
  const leftovers = [...free];
  const bySlot = new Map<SlotName, string[]>();
  const unplaced = new Map<string, string[]>();
  for (const id of leftovers) {
    const slot = slotOfId(id);
    if (slot) bySlot.set(slot, [...(bySlot.get(slot) ?? []), id]);
    else {
      const row = rows.find((r) => String(r.id) === id);
      const category = String(row?.category ?? '(no category)');
      unplaced.set(category, [...(unplaced.get(category) ?? []), id]);
    }
  }
  const left = [...bySlot.entries()].map(([slot, ids]) => ({ slot, ids })).sort((a, b) => SLOT_ORDER.indexOf(a.slot) - SLOT_ORDER.indexOf(b.slot));
  const leftUnplaced = [...unplaced.entries()].map(([category, ids]) => ({ category, ids })).sort((a, b) => b.ids.length - a.ids.length);

  const filled = days.length;
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  notes.unshift(
    `${filled} of ${plural(dates.length, 'day')} dressed from ${rows.length} pieces — ${Object.keys(usedOn).length} committed, ${leftovers.length} still untouched in the closet.`
  );
  const partial = days.filter((d) => !d.complete);
  if (partial.length) {
    notes.push(
      `${plural(partial.length, 'day')} in this week has no base layer — a dress, or a top and a bottom together: ${partial
        .map((d) => `${when(d.date)} — no ${d.unfilled.join(', no ').toLowerCase()}`)
        .join('; ')}. Those days are listed as they are rather than padded with a piece already committed elsewhere.`
    );
  }
  if (leftovers.length && filled < dates.length) {
    notes.push(
      `The week stopped early with ${leftovers.length} piece${leftovers.length === 1 ? '' : 's'} unused, because what remained could not fill the slots a look needs — not because the closet was empty.`
    );
  }
  if (left.some((l) => l.ids.length)) {
    notes.push(
      `Still uncommitted: ${left.map((l) => `${l.ids.length} ${l.slot.toLowerCase()}`).join(', ')}. A piece not drawn is not a piece that does not fit — the draw only reaches the idlest candidate in each slot each day.`
    );
  }
  notes.push('No piece appears twice in this week because the planner removes it from the pile after use. That is an arithmetic choice, not advice: re-wearing is normal, and the single-day draw has no such limit.');

  return { days, gaps, notes, usedOn, left, leftUnplaced, rule };
}
