/**
 * THE GLOW LAB — duplicate and lookalike arithmetic (spec Part 14 + Part 16).
 *
 * The app's oldest blind spot: /market decides purchases without ever asking
 * /closet what is already hanging there, and /closet has no way to notice that
 * the same navy blazer was entered twice under two names. This module is the
 * single comparison model both screens share.
 *
 * What it is: arithmetic over the rows you typed. Seven axes, each with a
 * weight, each normalised through a synonym table written in this file — the
 * module never consults a network, a catalogue or a product API.
 *
 * Two invariants, enforced structurally rather than promised:
 *
 *  1. NOTHING INVENTED. Every string the module can print is either (a) text
 *     lifted verbatim from an input row, quoted in “curly quotes”, or (b) a
 *     field name or family label from `VOCABULARY` below, which is a property
 *     of this code and not a claim about your things. Brands and prices are
 *     only ever copied from a row: `brand` and `price` come straight off
 *     `row.brand` / `row.price` / `row.pricePaid` / `row.amount`, and a blank
 *     prints as `unverified` — never as a guess.
 *  2. BLANKS REDUCE CONFIDENCE. The denominator is always the full 24-point
 *     frame, so an axis either side left blank contributes nothing and can only
 *     lower the score. It is additionally named in `missing`, and `ceiling`
 *     states the best score the comparison could ever have reached.
 *
 * A high score is a flag for a human, not a verdict: the output says "possibly
 * the same piece", and only you know whether those two blazers are one or two.
 */
import { hammingDistance } from '../media/dhash';
import type { AnyRow } from '../db/schema';

/* ------------------------------------------------------------------ vocabulary */

export type Axis = 'category' | 'kind' | 'colour' | 'material' | 'fit' | 'season' | 'name';

export const AXES: Axis[] = ['category', 'kind', 'colour', 'material', 'fit', 'season', 'name'];

/**
 * Fixed comparison frame. The weights are the module's opinion about how much
 * each field you typed should count; every one of them comes from a field the
 * closet form actually offers (src/pages/ClosetPage.tsx) or a field a product
 * row carries (ProductRow in src/db/schema.ts).
 */
export const AXIS_WEIGHTS: Record<Axis, number> = {
  category: 5,
  kind: 4,
  colour: 5,
  material: 3,
  fit: 2,
  season: 2,
  name: 3
};

export const TOTAL_WEIGHT = AXES.reduce((s, a) => s + AXIS_WEIGHTS[a], 0); // 24

/**
 * Closer-together taxonomies than the two screens use, so a worksheet line in
 * the broad "Clothing" category can still meet a closet row logged as
 * "Outerwear". Half credit only: containment is a hint, not an agreement.
 */
const PARENT: Record<string, string> = {
  top: 'clothing',
  blouse: 'clothing',
  tshirt: 'clothing',
  knit: 'clothing',
  bottom: 'clothing',
  trouser: 'clothing',
  jean: 'clothing',
  skirt: 'clothing',
  short: 'clothing',
  dress: 'clothing',
  set: 'clothing',
  outerwear: 'clothing',
  knitwear: 'clothing',
  accessory: 'clothing',
  activewear: 'clothing',
  lounge: 'clothing',
  occasion: 'clothing',
  bag: 'accessory',
  shoe: 'footwear',
  sneaker: 'footwear',
  boot: 'footwear',
  flat: 'footwear',
  heel: 'footwear',
  loafer: 'footwear',
  sandal: 'footwear'
};

const CATEGORY_SYNONYMS: Record<string, string[]> = {
  clothing: ['clothing', 'clothes', 'apparel', 'garment'],
  outerwear: ['outerwear', 'coat', 'jacket', 'coat jacket'],
  tops: ['tops', 'top', 'shirt', 'blouse', 'tee'],
  bottoms: ['bottoms', 'bottom', 'trouser', 'pants', 'jean', 'skirt'],
  knitwear: ['knitwear', 'knit', 'sweater', 'jumper', 'cardigan'],
  dresses: ['dresses', 'dress', 'gown', 'jumpsuit', 'set', 'co ord'],
  footwear: ['footwear', 'shoes', 'shoe'],
  bags: ['bags', 'bag'],
  accessory: ['accessories', 'accessory', 'scarf', 'belt', 'hat', 'jewellery', 'jewelry'],
  activewear: ['activewear', 'workout', 'training', 'gym'],
  lounge: ['sleep lounge', 'sleep', 'lounge', 'loungewear', 'robe'],
  occasion: ['special occasion', 'occasion', 'formal', 'ceremony', 'workwear', 'costume'],
  skincare: ['skincare', 'skin care'],
  makeup: ['makeup', 'make up', 'cosmetics'],
  haircare: ['haircare', 'hair care'],
  fragrance: ['fragrance', 'perfume', 'cologne', 'scent'],
  grooming: ['grooming'],
  tools: ['tools devices', 'tools', 'device', 'tool'],
  supplements: ['supplements', 'supplement', 'vitamins'],
  service: ['service appointment', 'service', 'appointment', 'treatment'],
  other: ['other']
};

const KIND_SYNONYMS: Record<string, string[]> = {
  blazer: ['blazer', 'sport coat', 'suit jacket'],
  coat: ['coat', 'trench', 'overcoat', 'duffle', 'parka', 'raincoat', 'cape'],
  jacket: ['jacket', 'bomber', 'denim jacket', 'leather jacket', 'gilet'],
  puffer: ['puffer', 'quilted jacket', 'down jacket'],
  shirt: ['shirt', 'button down', 'oxford', 'poplin shirt'],
  blouse: ['blouse', 'top blouse'],
  tshirt: ['t shirt', 'tee', 'jersey', 'polo'],
  tank: ['tank', 'vest top', 'camisole'],
  sweater: ['sweater', 'jumper', 'pullover'],
  cardigan: ['cardigan'],
  trouser: ['trouser', 'pants', 'tailored pant', 'slacks', 'chinos'],
  jean: ['jean', 'jeans', 'denims'],
  short: ['short', 'shorts'],
  skirt: ['skirt', 'miniskirt', 'midi skirt'],
  dress: ['dress', 'gown', 'maxi', 'slip dress'],
  set: ['set', 'co ord', 'two piece'],
  jumpsuit: ['jumpsuit', 'romper'],
  sneaker: ['sneaker', 'sneakers', 'trainers', 'plimsoll'],
  boot: ['boot', 'boots', 'ankle boot', 'derby boot', 'chelsea'],
  flat: ['flat', 'flats', 'ballet pump', 'mule'],
  heel: ['heel', 'heels', 'pump', 'stiletto', 'block heel'],
  loafer: ['loafer', 'loafers'],
  sandal: ['sandal', 'sandals', 'slide'],
  bag: ['bag', 'tote', 'handbag', 'crossbody', 'clutch', 'backpack'],
  scarf: ['scarf', 'muffler', 'pashmina', 'square'],
  belt: ['belt'],
  hat: ['hat', 'cap', 'beanie', 'beret', 'bucket hat'],
  jewellery: ['jewellery', 'jewelry', 'necklace', 'earrings', 'ring', 'bracelet'],
  sock: ['sock', 'socks', 'tights', 'hosiery'],
  legging: ['legging', 'leggings'],
  robe: ['robe', 'kimono'],
  suit: ['suit', 'two piece suit'],
  waistcoat: ['waistcoat', 'vest']
};

/** Colour families. “navy” and “dark blue” land in the same bucket, “blue” does not. */
const COLOUR_SYNONYMS: Record<string, string[]> = {
  black: ['black', 'jet', 'onyx', 'ebony', 'pitch black'],
  navy: ['navy', 'dark blue', 'deep blue', 'midnight', 'marine blue'],
  blue: ['blue', 'royal blue', 'cobalt', 'sky blue', 'baby blue', 'powder blue', 'light blue', 'electric blue', 'indigo', 'denim blue', 'steel blue'],
  teal: ['teal', 'petrol', 'turquoise', 'aqua', 'sage blue'],
  green: ['green', 'emerald', 'forest', 'kelly', 'sage', 'mint', 'bottle green'],
  olive: ['olive', 'khaki', 'army', 'moss', 'drab'],
  yellow: ['yellow', 'mustard', 'amber', 'butter', 'lemon'],
  orange: ['orange', 'burnt orange', 'apricot', 'peach', 'tangerine'],
  brown: ['brown', 'chocolate', 'coffee', 'mocha', 'mahogany', 'chestnut', 'walnut', 'rust', 'terracotta', 'cognac', 'maroon', 'burgundy', 'wine', 'oxblood'],
  beige: ['beige', 'tan', 'camel', 'sand', 'cream', 'ivory', 'ecru', 'stone', 'taupe', 'nude', 'oat', 'almond', 'off white'],
  white: ['white', 'bright white', 'snow', 'optical white', 'chalk'],
  grey: ['grey', 'gray', 'charcoal', 'slate', 'heather', 'graphite', 'ash', 'smoke', 'pewter'],
  pink: ['pink', 'blush', 'rose', 'fuchsia', 'magenta', 'bubblegum', 'pale pink'],
  red: ['red', 'scarlet', 'crimson', 'cherry', 'cardinal'],
  purple: ['purple', 'violet', 'lilac', 'lavender', 'aubergine', 'plum', 'mauve', 'lilac purple'],
  metallic: ['silver', 'gold', 'rose gold', 'bronze', 'copper', 'metallic', 'chrome'],
  clear: ['clear', 'transparent', 'translucent', 'sheer'],
  multi: ['multi', 'multicolor', 'multicolour', 'print', 'patterned', 'floral', 'striped', 'mixed', 'tie dye', 'colour block']
};

const MATERIAL_SYNONYMS: Record<string, string[]> = {
  cotton: ['cotton', 'denim', 'jean', 'chambray', 'poplin', 'twill', 'canvas', 'gingham', 'flannel'],
  wool: ['wool', 'merino', 'cashmere', 'lambswool', 'mohair', 'tweed', 'wool blend', 'knit wool'],
  synthetic: ['polyester', 'poly', 'nylon', 'acrylic', 'elastane', 'spandex', 'lycra', 'fleece'],
  viscose: ['viscose', 'rayon', 'modal', 'lyocell', 'tencel', 'cupro'],
  linen: ['linen', 'flax', 'hemp', 'ramie'],
  leather: ['leather', 'suede', 'nappa', 'faux leather', 'pleather', 'vegan leather', 'patent'],
  silk: ['silk', 'silk blend', 'charmeuse'],
  down: ['down', 'duck down', 'goose down', 'feather', 'fur', 'shearling', 'sherpa'],
  rubber: ['rubber', 'eva', 'foam', 'cork', 'plastic', 'tpu', 'pvc', 'jelly']
};

const FIT_SYNONYMS: Record<string, string[]> = {
  skintight: ['very fitted', 'skintight', 'skin tight', 'compression', 'bodycon', 'second skin'],
  fitted: ['fitted', 'slim', 'tailored fit', 'close fitting', 'narrow'],
  regular: ['true to size', 'true', 'regular', 'standard', 'classic', 'normal', 'straight'],
  relaxed: ['relaxed', 'loose', 'easy', 'boxy', 'roomy', 'generous'],
  oversized: ['oversized', 'oversize', 'big', 'slouchy', 'boyfriend', 'cocoon'],
  altered: ['altered', 'taken in', 'let out', 'resized', 'hemmed', 'tailored in']
};

const SEASON_SYNONYMS: Record<string, string[]> = {
  spring: ['spring', 'primavera'],
  summer: ['summer', 'warm weather', 'hot weather', 'tropical'],
  autumn: ['autumn', 'fall'],
  winter: ['winter', 'cold weather', 'cold season', 'snowy'],
  all: ['all season', 'all seasons', 'year round', 'yearround', 'any season', 'anytime', 'four seasons', 'transitional']
};

/** Every family label this file can print. Nothing outside it can reach the screen. */
export const VOCABULARY: string[] = Array.from(
  new Set([
    ...Object.keys(CATEGORY_SYNONYMS),
    ...Object.keys(KIND_SYNONYMS),
    ...Object.keys(COLOUR_SYNONYMS),
    ...Object.keys(MATERIAL_SYNONYMS),
    ...Object.keys(FIT_SYNONYMS),
    ...Object.keys(SEASON_SYNONYMS),
    ...Object.values(PARENT).filter((v) => !Object.keys(CATEGORY_SYNONYMS).includes(v))
  ])
).sort();

/** Score at which a pair is shown as a possible lookalike. */
export const DEFAULT_THRESHOLD = 0.5;
/** Hamming distance at which two photographs are called "possibly the same shot". */
export const DEFAULT_MEDIA_DISTANCE = 6;

/* -------------------------------------------------------------- normalisation */

/** Lowercase, accents folded, everything non-letteral turned into a space. */
export function norm(s: unknown): string {
  return String(s ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function words(s: unknown): string[] {
  return norm(s).split(' ').filter(Boolean);
}

/**
 * Longest-phrase-first scan, so "dark blue" is read as navy and not as blue
 * plus a stray colour word. Each consumed phrase contributes its family.
 */
function familiesIn(text: unknown, table: Record<string, string[]>): string[] {
  const ws = words(text);
  if (!ws.length) return [];
  const entries: { parts: string[]; family: string }[] = [];
  for (const [family, phrases] of Object.entries(table)) {
    for (const p of phrases) {
      const parts = words(p);
      if (parts.length) entries.push({ parts, family });
    }
  }
  entries.sort((a, b) => b.parts.length - a.parts.length);
  const taken = new Array<boolean>(ws.length).fill(false);
  const out = new Set<string>();
  for (const e of entries) {
    for (let i = 0; i + e.parts.length <= ws.length; i += 1) {
      if (taken[i]) continue;
      let hit = true;
      for (let k = 0; k < e.parts.length; k += 1) {
        if (ws[i + k] !== e.parts[k] || taken[i + k]) {
          hit = false;
          break;
        }
      }
      if (!hit) continue;
      for (let k = 0; k < e.parts.length; k += 1) taken[i + k] = true;
      out.add(e.family);
    }
  }
  return [...out].sort();
}

/** A colour tag can be a word or a hex code — both are things she typed herself. */
export function colourFamilies(raw: string[]): string[] {
  const fams = new Set<string>();
  for (const tag of raw) {
    const t = String(tag ?? '').trim();
    if (!t) continue;
    if (/^#[0-9a-f]{3,8}$/i.test(t)) {
      const f = hexToFamily(t);
      if (f) fams.add(f);
      continue;
    }
    for (const f of familiesIn(t, COLOUR_SYNONYMS)) fams.add(f);
  }
  return [...fams].sort();
}

/** Hue/lightness buckets over the hex the user typed. Arithmetic, not a palette. */
export function hexToFamily(hex: string): string | null {
  let h = hex.replace('#', '').toLowerCase();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/.test(h)) return null;
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  if (l <= 0.12) return 'black';
  if (l >= 0.92 && s <= 0.2) return 'white';
  if (s <= 0.12) return l < 0.5 ? 'black' : 'grey';
  let hue = 0;
  if (d === 0) hue = 0;
  else if (max === r) hue = 60 * (((g - b) / d) % 6);
  else if (max === g) hue = 60 * ((b - r) / d + 2);
  else hue = 60 * ((r - g) / d + 4);
  if (hue < 0) hue += 360;
  if (hue < 15 || hue >= 345) return l < 0.3 ? 'brown' : 'red';
  if (hue < 40) return 'orange';
  if (hue < 70) return 'yellow';
  if (hue < 160) return l < 0.35 && hue >= 140 ? 'olive' : 'green';
  if (hue < 195) return 'teal';
  if (hue < 255) return l < 0.35 ? 'navy' : 'blue';
  if (hue < 290) return 'purple';
  return l < 0.4 ? 'purple' : 'pink';
}

function splitList(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x ?? '')).filter((x) => x.trim() !== '');
  if (v === null || v === undefined) return [];
  const s = String(v).trim();
  return s ? [s] : [];
}

function joinTyped(vals: string[]): string {
  return [...new Set(vals.map((v) => String(v ?? '').trim()).filter((v) => v !== ''))].join(' · ');
}

/* ------------------------------------------------------------------ signature */

export interface AxisValue {
  /** exactly what the user typed, verbatim — '' when they left it blank */
  typed: string;
  /** comparison buckets from the vocabulary above — empty means "no signal" */
  families: string[];
}

export interface WardrobeSignature {
  id: string;
  source: 'clothingItems' | 'products' | 'purchases' | 'candidate';
  label: string;
  brand: string;
  axes: Record<Axis, AxisValue>;
  /** axes this side left blank */
  blanks: Axis[];
  price: number | null;
  currency: string;
  wears: number | null;
  boughtOn: string | null;
  size: string;
  mediaId: string | null;
}

function axis(typed: string, families: string[]): AxisValue {
  return { typed: typed.trim(), families };
}

function emptyAxes(): Record<Axis, AxisValue> {
  return {
    category: axis('', []),
    kind: axis('', []),
    colour: axis('', []),
    material: axis('', []),
    fit: axis('', []),
    season: axis('', []),
    name: axis('', [])
  };
}

function withBlanks(sig: WardrobeSignature): WardrobeSignature {
  sig.blanks = AXES.filter((a) => sig.axes[a].families.length === 0);
  return sig;
}

export interface CandidateInput {
  name: string;
  brand?: string;
  category?: string;
  subcategory?: string;
  colours?: string[];
  material?: string;
  fit?: string;
  seasons?: string[];
  size?: string;
  price?: number | null;
  currency?: string;
  wears?: number | null;
  id?: string;
}

function numberOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * The signature of a closet row. Only fields the closet form offers are read:
 * nothing here is inferred about a garment the user did not describe.
 */
export function wardrobeSignature(item: Comparable): WardrobeSignature {
  if (isSignature(item)) return item;
  const row = item as AnyRow & Partial<CandidateInput>;
  const isCandidate = !('createdAt' in row) || 'colours' in row;
  if (isCandidate) return candidateSignature(row as unknown as CandidateInput);

  const name = String(row.name ?? '');
  const category = String(row.category ?? '');
  const subcategory = String(((row.data as Record<string, unknown> | undefined)?.subcategory ?? ''));
  const colourTags = splitList(row.colors);
  const seasons = splitList(row.seasons);
  const materialRaw = splitList(row.material);
  const fitRaw = String(row.fit ?? '');

  const kindSource = subcategory || category;
  const sig: WardrobeSignature = {
    id: String(row.id ?? ''),
    source: 'clothingItems',
    label: name.trim(),
    brand: String(row.brand ?? ''),
    axes: {
      ...emptyAxes(),
      category: axis(category, familiesIn(category, CATEGORY_SYNONYMS)),
      kind: axis(kindSource, familiesIn(`${subcategory} ${category}`, KIND_SYNONYMS).length
        ? familiesIn(`${subcategory} ${category}`, KIND_SYNONYMS)
        : familiesIn(category, CATEGORY_SYNONYMS)),
      colour: axis(joinTyped(colourTags), colourFamilies(colourTags)),
      material: axis(joinTyped(materialRaw), familiesIn(joinTyped(materialRaw), MATERIAL_SYNONYMS)),
      fit: axis(fitRaw, familiesIn(fitRaw, FIT_SYNONYMS)),
      season: axis(joinTyped(seasons), familiesIn(joinTyped(seasons), SEASON_SYNONYMS)),
      name: axis(name, words(name).length ? ['named'] : [])
    },
    blanks: [],
    price: numberOrNull(row.price),
    currency: String(row.currency ?? ''),
    wears: numberOrNull(row.wears),
    boughtOn: row.boughtOn ? String(row.boughtOn) : null,
    size: String(row.size ?? ''),
    mediaId: row.mediaId ? String(row.mediaId) : null
  };
  return withBlanks(sig);
}

/**
 * A product row carries a name, a category and a form — no colour, fabric, fit
 * or season. Those axes stay blank, which caps its score by design: the
 * comparison says so in `missing` instead of pretending.
 */
export function productSignature(row: AnyRow | WardrobeSignature): WardrobeSignature {
  if (isSignature(row)) return row;
  const name = String(row.name ?? '');
  const category = String(row.category ?? '');
  const form = String(row.form ?? '');
  const sig: WardrobeSignature = {
    id: String(row.id ?? ''),
    source: 'products',
    label: name.trim(),
    brand: String(row.brand ?? ''),
    axes: {
      ...emptyAxes(),
      category: axis(category, familiesIn(category, CATEGORY_SYNONYMS)),
      kind: axis(form, familiesIn(`${form} ${name}`, KIND_SYNONYMS).length
        ? familiesIn(`${form} ${name}`, KIND_SYNONYMS)
        : familiesIn(category, CATEGORY_SYNONYMS)),
      name: axis(name, words(name).length ? ['named'] : [])
    },
    blanks: [],
    price: numberOrNull(row.pricePaid),
    currency: String(row.currency ?? ''),
    wears: null,
    boughtOn: row.openedOn ? String(row.openedOn) : null,
    size: String(row.sizeLabel ?? ''),
    mediaId: row.mediaId ? String(row.mediaId) : null
  };
  sig.axes.material = axis(form, familiesIn(form, MATERIAL_SYNONYMS));
  return withBlanks(sig);
}

/** A purchase row is a receipt: a label and an amount, nothing else. */
export function purchaseSignature(row: AnyRow | WardrobeSignature): WardrobeSignature {
  if (isSignature(row)) return row;
  const label = String(row.label ?? '');
  const sig: WardrobeSignature = {
    id: String(row.id ?? ''),
    source: 'purchases',
    label: label.trim(),
    brand: '',
    axes: {
      ...emptyAxes(),
      kind: axis(label, familiesIn(label, KIND_SYNONYMS)),
      name: axis(label, words(label).length ? ['named'] : [])
    },
    blanks: [],
    price: numberOrNull(row.amount),
    currency: String(row.currency ?? ''),
    wears: null,
    boughtOn: row.boughtOn ? String(row.boughtOn) : null,
    size: '',
    mediaId: null
  };
  return withBlanks(sig);
}

export function candidateSignature(c: CandidateInput | WardrobeSignature): WardrobeSignature {
  if (isSignature(c)) return c;
  // Colour words are only ever taken from the text the user typed — the name
  // plus anything they put in the colours box. No colour is inferred from a
  // category, a brand or a photograph.
  const colourWords = [...(c.colours ?? []), ...wordsFromText(`${c.name ?? ''} ${c.subcategory ?? ''}`).colours];
  const materialWords = [c.material ?? '', c.name ?? ''].filter(Boolean).join(' ');
  const seen = wordsFromText(`${c.fit ?? ''} ${c.name ?? ''} ${c.seasons ?? ''}`);
  const seasonWords = [...(c.seasons ?? []), ...seen.seasons];
  const fitWords = [c.fit ?? '', ...seen.fits].filter(Boolean);
  const materialSeen = wordsFromText(materialWords).materials;
  const sig: WardrobeSignature = {
    id: c.id ? String(c.id) : 'candidate',
    source: 'candidate',
    label: String(c.name ?? '').trim(),
    brand: String(c.brand ?? ''),
    axes: {
      ...emptyAxes(),
      category: axis(String(c.category ?? ''), familiesIn(`${c.category ?? ''} ${c.name ?? ''}`, CATEGORY_SYNONYMS)),
      kind: axis(
        `${c.subcategory ?? ''} ${c.name ?? ''}`.trim(),
        familiesIn(`${c.subcategory ?? ''} ${c.category ?? ''} ${c.name ?? ''}`, KIND_SYNONYMS)
      ),
      colour: axis(joinTyped(colourWords), colourFamilies(colourWords)),
      material: axis(joinTyped([c.material ?? '', ...materialSeen].filter(Boolean)), familiesIn(materialWords, MATERIAL_SYNONYMS)),
      fit: axis(joinTyped(fitWords), familiesIn(`${c.fit ?? ''} ${c.name ?? ''}`, FIT_SYNONYMS)),
      season: axis(joinTyped(seasonWords), familiesIn(joinTyped(seasonWords), SEASON_SYNONYMS)),
      name: axis(String(c.name ?? ''), words(c.name ?? '').length ? ['named'] : [])
    },
    blanks: [],
    price: numberOrNull(c.price ?? null),
    currency: String(c.currency ?? ''),
    wears: null,
    boughtOn: null,
    size: String(c.size ?? ''),
    mediaId: null
  };
  return withBlanks(sig);
}

function isSignature(x: unknown): x is WardrobeSignature {
  return Boolean(x && typeof x === 'object' && 'axes' in (x as Record<string, unknown>));
}

/** Structural sniff so `similarity(rowA, rowB)` works with raw rows from any table. */
export function signatureOf(row: Comparable): WardrobeSignature {
  if (isSignature(row)) return row;
  const r = row as Record<string, unknown>;
  if ('pricePaid' in r || 'status' in r || 'form' in r) return productSignature(row as AnyRow);
  if ('productId' in r && 'amount' in r) return purchaseSignature(row as AnyRow);
  if (!('createdAt' in r) || 'colours' in r) return candidateSignature(row as unknown as CandidateInput);
  return wardrobeSignature(row);
}

export type Comparable = WardrobeSignature | CandidateInput | AnyRow;

/* ------------------------------------------------------------------ similarity */

export interface Similarity {
  /** matched points ÷ the full 24-point frame; blanks can only lower it */
  score: number;
  /** one line per agreeing axis, naming it and quoting your own words */
  why: string[];
  /** one line per axis one or both sides left blank */
  missing: string[];
  /** axes where both sides said something and it did not line up */
  differs: { axis: Axis; a: string; b: string }[];
  agreeing: Axis[];
  blank: Axis[];
  matched: number;
  /** points the two sides actually had in common to compare */
  compared: number;
  /** best score this pair could reach, given the blanks: compared ÷ 24 */
  ceiling: number;
  /** matched ÷ compared — how sure the *covered* fields make us */
  certainty: number;
}

function q(s: string): string {
  return `“${String(s).trim()}”`;
}

function labelOf(s: WardrobeSignature): string {
  return s.label ? q(s.label) : 'an unlabelled row';
}

function setAgree(a: string[], b: string[]): boolean {
  if (a.includes('all') || b.includes('all')) return true;
  return a.some((x) => b.includes(x));
}

function overlap(a: string[], b: string[]): string[] {
  if (a.includes('all') || b.includes('all')) return ['all'];
  return a.filter((x) => b.includes(x));
}

function nameTokensMatch(a: WardrobeSignature, b: WardrobeSignature): { hits: number; words: number } {
  const ta = new Set(words(a.label).filter((w) => w.length > 2));
  const tb = new Set(words(b.label).filter((w) => w.length > 2));
  if (!ta.size || !tb.size) return { hits: 0, words: 0 };
  let hits = 0;
  for (const t of ta) if (tb.has(t)) hits += 1;
  return { hits, words: Math.min(ta.size, tb.size) };
}

/** Half credit when one side's category contains the other's (clothing ⊃ outerwear). */
function categoryValue(a: string[], b: string[]): number {
  if (overlap(a, b).length) return 1;
  for (const x of a) {
    for (const y of b) {
      if (PARENT[x] === y || PARENT[y] === x) return 0.5;
    }
  }
  return 0;
}

export function similarity(a: Comparable, b: Comparable): Similarity {
  const A = signatureOf(a);
  const B = signatureOf(b);
  const out: Similarity = {
    score: 0,
    why: [],
    missing: [],
    differs: [],
    agreeing: [],
    blank: [],
    matched: 0,
    compared: 0,
    ceiling: 0,
    certainty: 0
  };

  for (const ax of AXES) {
    const w = AXIS_WEIGHTS[ax];
    const av = A.axes[ax];
    const bv = B.axes[ax];

    if (!av.families.length || !bv.families.length) {
      out.blank.push(ax);
      if (!av.families.length && !bv.families.length) {
        out.missing.push(`${ax} — blank on both sides, so it cannot count for or against`);
      } else if (!av.families.length) {
        out.missing.push(`${ax} — blank on ${labelOf(A)}, filled on ${labelOf(B)}`);
      } else {
        out.missing.push(`${ax} — blank on ${labelOf(B)}, filled on ${labelOf(A)}`);
      }
      continue;
    }

    out.compared += w;
    let value = 0;
    let note = '';

    if (ax === 'category') {
      value = categoryValue(av.families, bv.families);
      note =
        value === 1
          ? `category — ${q(av.typed)} and ${q(bv.typed)} are the same bucket`
          : `category — ${q(av.typed)} sits inside ${q(bv.typed)}, so this is a broader match, worth half`;
    } else if (ax === 'kind') {
      const sh = overlap(av.families, bv.families);
      value = sh.length ? 1 : 0;
      note = `type — ${q(av.typed)} and ${q(bv.typed)} are both the same kind of piece`;
    } else if (ax === 'colour') {
      const sh = overlap(av.families, bv.families);
      value = sh.length ? 1 : 0;
      note = `colour — ${q(av.typed)} and ${q(bv.typed)} both land in the ${sh[0] === 'all' ? av.families[0] : sh[0]} family`;
    } else if (ax === 'material') {
      const sh = overlap(av.families, bv.families);
      value = sh.length ? 1 : 0;
      note = `fabric — ${q(av.typed)} and ${q(bv.typed)} share ${sh.join(', ')}`;
    } else if (ax === 'fit') {
      value = overlap(av.families, bv.families).length ? 1 : 0;
      note = `fit — both entered as the same shape on the body`;
    } else if (ax === 'season') {
      const sh = overlap(av.families, bv.families);
      value = sh.length ? 1 : 0;
      note =
        sh[0] === 'all'
          ? `season — ${q(av.families.includes('all') ? av.typed : bv.typed)} is labelled as covering any season, the other one included`
          : `season — both cover ${sh.join(', ')}`;
    } else {
      const nm = nameTokensMatch(A, B);
      value = nm.words > 0 && nm.hits / nm.words >= 0.5 ? 1 : 0;
      note = `name — ${q(A.label)} and ${q(B.label)} share ${nm.hits} of ${nm.words} of the shorter one's words`;
    }

    if (value > 0) {
      out.matched += w * value;
      out.agreeing.push(ax);
      out.why.push(note);
    } else {
      out.differs.push({ axis: ax, a: av.typed, b: bv.typed });
    }
  }

  out.score = round3(out.matched / TOTAL_WEIGHT);
  out.ceiling = round3(out.compared / TOTAL_WEIGHT);
  out.certainty = out.compared ? round3(out.matched / out.compared) : 0;
  return out;
}

function round3(n: number): number {
  return Math.round((Number.isFinite(n) ? n : 0) * 1000) / 1000;
}

/* ------------------------------------------------------------------- lookalikes */

export interface Lookalike {
  signature: WardrobeSignature;
  sim: Similarity;
  score: number;
  why: string[];
  missing: string[];
}

/**
 * Best-first list of closet rows that could be the same piece as `target`.
 * Self-comparisons are skipped by id, never by guesswork.
 */
export function findLookalikes(
  target: Comparable,
  items: readonly AnyRow[],
  opts: { threshold?: number; limit?: number } = {}
): Lookalike[] {
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
  const t = signatureOf(target);
  const out: Lookalike[] = [];
  for (const row of items) {
    if (!row) continue;
    const s = wardrobeSignature(row);
    if (t.source === 'clothingItems' && s.id && t.id && s.id === t.id) continue;
    const sim = similarity(t, s);
    if (sim.score < threshold) continue;
    out.push({ signature: s, sim, score: sim.score, why: sim.why, missing: sim.missing });
  }
  out.sort((a, b) => b.score - a.score || a.signature.label.localeCompare(b.signature.label));
  return opts.limit ? out.slice(0, opts.limit) : out;
}

/**
 * Every unordered pair above threshold — the closet panel's data.
 *
 * A pair she has already answered "these two are not duplicates" is not
 * returned: `duplicatePairs` reads the `dupExcluded` note the review queue
 * writes on both rows, so the suppression is data on her rows rather than a
 * queue that has to be remembered. Nothing else about the arithmetic changes.
 */
export function duplicatePairs(
  items: readonly AnyRow[],
  opts: { threshold?: number; limit?: number } = {}
): { id: string; a: WardrobeSignature; b: WardrobeSignature; sim: Similarity; score: number; keeperId: string }[] {
  const threshold = opts.threshold ?? DEFAULT_THRESHOLD;
  const sigs = items.map((r) => wardrobeSignature(r));
  const pairs: { id: string; a: WardrobeSignature; b: WardrobeSignature; sim: Similarity; score: number; keeperId: string }[] = [];
  for (let i = 0; i < sigs.length; i += 1) {
    for (let j = i + 1; j < sigs.length; j += 1) {
      if (pairExcluded(items[i], items[j])) continue;
      const sim = similarity(sigs[i], sigs[j]);
      if (sim.score < threshold) continue;
      pairs.push({
        id: `${sigs[i].id}~${sigs[j].id}`,
        a: sigs[i],
        b: sigs[j],
        sim,
        score: sim.score,
        keeperId: keeper(sigs[i], sigs[j]).id
      });
    }
  }
  pairs.sort((x, y) => y.score - x.score);
  return opts.limit ? pairs.slice(0, opts.limit) : pairs;
}

/**
 * Which of two lookalikes keeps the merged wear count: more wears first, then
 * the earlier acquisition. Ties fall back to id so the answer never wanders.
 */
export function keeper(a: WardrobeSignature, b: WardrobeSignature): WardrobeSignature {
  const aw = a.wears ?? 0;
  const bw = b.wears ?? 0;
  if (aw !== bw) return aw > bw ? a : b;
  const ad = String(a.boughtOn ?? '9999');
  const bd = String(b.boughtOn ?? '9999');
  if (ad !== bd) return ad < bd ? a : b;
  return a.id <= b.id ? a : b;
}

/* --------------------------------------------------------------- suppression */

/**
 * Where a "these two are not duplicates" answer is stored: on BOTH rows, in
 * `row.data.dupExcluded`, as the list of other row ids she has ruled out. It
 * sits beside `dupOf` / `dupNote` / `mergedInto`, which the same panel already
 * writes, so it rides through the closet form's `dupFlags` the way those do and
 * survives a reload because it is a row field, not a screen state.
 */
export const DUP_EXCLUDED_KEY = 'dupExcluded';

/**
 * The pair's stable name: the two row ids sorted, joined with "~". Row order
 * does not change it, so a decision made today still names the same pair after
 * a re-sort, a merge or a reload.
 */
export function pairKey(aId: string, bId: string): string {
  return [String(aId), String(bId)].sort().join('~');
}

/** The ids this row has been ruled out against, as she wrote them. */
export function excludedIdsOf(row: AnyRow | null | undefined): string[] {
  const raw = (row?.data as Record<string, unknown> | undefined)?.[DUP_EXCLUDED_KEY];
  if (!Array.isArray(raw)) return [];
  return [...new Set(raw.map((x) => String(x ?? '')).filter((x) => x !== ''))];
}

/**
 * One-way on purpose: a note on either row suppresses the pair, because the
 * write below puts the same note on both and a half-finished sync should not
 * resurrect a pair she already answered.
 */
export function pairExcluded(a: AnyRow | null | undefined, b: AnyRow | null | undefined): boolean {
  if (!a || !b) return false;
  return excludedIdsOf(a).includes(String(b.id)) || excludedIdsOf(b).includes(String(a.id));
}

/**
 * The two partial row payloads that make the suppression real. Each keeps the
 * fields already on the row — `put` merges — and adds the other row's id plus a
 * note naming it, so the answer is readable on the piece rather than hidden in
 * a queue. Neither row is deleted, merged or reordered by it.
 */
export function suppressionPatches(
  a: AnyRow,
  b: AnyRow
): { id: string; data: Record<string, unknown> }[] {
  const day = isoDay(Date.now());
  const peer = (row: AnyRow, other: AnyRow) => ({
    id: String(row.id),
    data: {
      ...(((row as AnyRow).data as Record<string, unknown>) ?? {}),
      [DUP_EXCLUDED_KEY]: [...new Set([...excludedIdsOf(row), String(other.id)])],
      dupNote:
        dupNoteOf(row) ||
        `Ruled out as a duplicate of “${String(other.name ?? other.id)}” on ${day}. Both rows are untouched — this note is the only thing written.`
    }
  });
  return [peer(a, b), peer(b, a)];
}

function dupNoteOf(row: AnyRow): string {
  return String(((row.data as Record<string, unknown> | undefined)?.dupNote as string) ?? '');
}

/** The date the note names, in the same ISO shape every other row field uses. */
function isoDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/* --------------------------------------------------------------- buy decision */

export type CostBasis = 'computed' | 'no wears' | 'no price';

export interface Match extends Lookalike {
  source: WardrobeSignature['source'];
  id: string;
  label: string;
  brand: string;
  size: string;
  mediaId: string | null;
  /** the row's own typed price, verbatim — null prints as unverified */
  price: number | null;
  currency: string;
  wears: number | null;
  boughtOn: string | null;
  costPerWear: number | null;
  costBasis: CostBasis;
  /** printed denominator, built from the two typed numbers */
  costNote: string;
  ceiling: number;
  certainty: number;
  /** three or more axes were blank on one side or the other */
  sparse: boolean;
}

export interface PurchaseCheck {
  /** every axis you filled agrees — rare, and still only "check this" */
  exact: Match[];
  /** possibly the same kind of thing, best first */
  possible: Match[];
  /** matches whose row carries a price you paid */
  priced: Match[];
  /** matches with no price on the row — printed as unverified, never guessed */
  unpriced: Match[];
}

export interface WardrobePools {
  clothing: readonly AnyRow[];
  products: readonly AnyRow[];
  purchases: readonly AnyRow[];
  threshold?: number;
}

/** Cost per wear: the row's own price ÷ the row's own wears. Undefined until both exist. */
export function costPerWear(price: number | null, wears: number | null | undefined): number | null {
  if (price === null || !Number.isFinite(price)) return null;
  if (!wears || wears <= 0) return null;
  return price / wears;
}

function toMatch(s: WardrobeSignature, sim: Similarity): Match {
  const cpw = costPerWear(s.price, s.wears);
  const basis: CostBasis = s.price === null ? 'no price' : cpw === null ? 'no wears' : 'computed';
  return {
    signature: s,
    sim,
    score: sim.score,
    why: sim.why,
    missing: sim.missing,
    source: s.source,
    id: s.id,
    label: s.label,
    brand: s.brand,
    size: s.size,
    mediaId: s.mediaId,
    price: s.price,
    currency: s.currency,
    wears: s.wears,
    boughtOn: s.boughtOn,
    costPerWear: cpw,
    costBasis: basis,
    costNote:
      basis === 'computed'
        ? `${s.price} ÷ ${s.wears} wears = ${round4(cpw as number)} per wear`
        : basis === 'no price'
          ? 'no price on the row — unverified, and not guessed'
          : s.wears === null
            ? 'this record type carries no wear count — unverified'
            : 'no wears logged — unverified',
    ceiling: sim.ceiling,
    certainty: sim.certainty,
    sparse: sim.missing.length >= 3
  };
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * The one cross-department check: what the worksheet (or a wishlist line) is
 * asking for, against the closet, the product shelf and the purchase ledger.
 */
export function checkPurchaseAgainstWardrobe(
  candidate: CandidateInput | WardrobeSignature,
  pools: WardrobePools
): PurchaseCheck {
  const threshold = pools.threshold ?? DEFAULT_THRESHOLD;
  const c = candidateSignature(candidate);
  const exact: Match[] = [];
  const possible: Match[] = [];

  const consider = (s: WardrobeSignature) => {
    const sim = similarity(c, s);
    if (sim.matched === 0) return;
    const m = toMatch(s, sim);
    if (sim.score >= 0.95 && sim.missing.length === 0) {
      exact.push(m);
      return;
    }
    // A purchase row is a receipt and a product row carries no colour, fabric,
    // fit or season, so neither can ever reach the threshold on attributes.
    // They still earn a look if what little they do say lines up: the name has
    // to agree, one describing axis has to agree, and at least three quarters
    // of the axes they do share have to agree. The panel then prints `ceiling`
    // so the user can see how low the bar was.
    const thinEvidence =
      m.sparse &&
      sim.certainty >= 0.75 &&
      sim.agreeing.includes('name') &&
      ['kind', 'colour', 'material', 'fit'].some((a) => sim.agreeing.includes(a as Axis));
    if (sim.score >= threshold || thinEvidence) possible.push(m);
  };

  for (const row of pools.clothing ?? []) consider(wardrobeSignature(row));
  for (const row of pools.products ?? []) {
    if (row.status === 'avoid') continue;
    consider(productSignature(row));
  }
  for (const row of pools.purchases ?? []) consider(purchaseSignature(row));

  const byScore = (x: Match, y: Match) => y.score - x.score || String(x.label).localeCompare(String(y.label));
  exact.sort(byScore);
  possible.sort(byScore);

  return {
    exact,
    possible,
    priced: [...exact, ...possible].filter((m) => m.price !== null).sort(byScore),
    unpriced: [...exact, ...possible].filter((m) => m.price === null).sort(byScore)
  };
}

/* --------------------------------------------------------------------- photos */

export interface MediaLookalike {
  id: string;
  title: string;
  distance: number;
  phash: string;
  takenOn: string | null;
}

/** Reads the signature an ingest wrote, never recomputes one. */
function phashOf(row: AnyRow): string {
  const data = (row.data ?? {}) as Record<string, unknown>;
  return typeof data.phash === 'string' ? data.phash : '';
}

/**
 * Rows whose 9x8 difference hash is within `maxDistance` bits of `phash`.
 * Garbage or absent hashes return Infinity from hammingDistance and are
 * dropped, so a missing signature can never produce a false "same photo".
 * A hit means "these two files look close", not "these are the same shot".
 */
export function mediaLookalikes(
  rows: readonly AnyRow[],
  phash: string | null | undefined,
  maxDistance: number = DEFAULT_MEDIA_DISTANCE
): MediaLookalike[] {
  const target = String(phash ?? '').toLowerCase();
  if (!/^[0-9a-f]{4,32}$/.test(target)) return [];
  const hits: MediaLookalike[] = [];
  for (const row of rows) {
    if (!row) continue;
    const other = phashOf(row);
    if (!/^[0-9a-f]{4,32}$/.test(other)) continue;
    const distance = hammingDistance(target, other);
    if (!Number.isFinite(distance) || distance > maxDistance) continue;
    hits.push({
      id: String(row.id ?? ''),
      title: String(row.title ?? '').trim() || 'Untitled',
      distance,
      phash: other,
      takenOn: row.takenOn ? String(row.takenOn) : null
    });
  }
  hits.sort((a, b) => a.distance - b.distance || a.title.localeCompare(b.title));
  return hits;
}

/* ------------------------------------------------------------------- candidates */

/**
 * Pull the describing words out of a free-text worksheet line. Only words the
 * user typed are echoed back — the synonym tables above decide the bucket, and
 * a word with no bucket contributes nothing rather than a guess.
 */
export function wordsFromText(text: string): { colours: string[]; materials: string[]; fits: string[]; seasons: string[] } {
  const w = words(text).join(' ');
  const echo = (families: string[], table: Record<string, string[]>) =>
    [...new Set(families.map((f) => firstPhraseFor(f, String(text ?? ''), table)).filter(Boolean))];
  return {
    colours: echo(familiesIn(w, COLOUR_SYNONYMS), COLOUR_SYNONYMS),
    materials: echo(familiesIn(w, MATERIAL_SYNONYMS), MATERIAL_SYNONYMS),
    fits: echo(familiesIn(w, FIT_SYNONYMS), FIT_SYNONYMS),
    seasons: echo(familiesIn(w, SEASON_SYNONYMS), SEASON_SYNONYMS)
  };
}

/** Returns the user's own characters that fell into `family` — the raw slice,
 *  hyphens and capitals intact, never the bucket name and never a re-typed word. */
function firstPhraseFor(family: string, text: string, table: Record<string, string[]>): string {
  const phrases = table[family] ?? [];
  let best = '';
  for (const p of phrases) {
    const parts = words(p);
    if (!parts.length) continue;
    const body = parts.map(escapeRe).join('[^a-z0-9]+');
    const m = new RegExp(`(?:^|[^a-z0-9])(${body})(?=[^a-z0-9]|$)`, 'i').exec(text);
    if (m && m[1].length > best.length) best = m[1];
  }
  return best;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
