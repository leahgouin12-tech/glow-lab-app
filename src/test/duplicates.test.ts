/**
 * THE GLOW LAB — duplicate engine tests.
 *
 * Everything asserted here is arithmetic over rows the tests typed. The last
 * group is the honesty guard: the module may not put a brand, a price or a
 * colour on screen that was not present in the rows it was given.
 */
import { describe, expect, it } from 'vitest';
import {
  AXES,
  AXIS_WEIGHTS,
  DEFAULT_MEDIA_DISTANCE,
  TOTAL_WEIGHT,
  VOCABULARY,
  candidateSignature,
  checkPurchaseAgainstWardrobe,
  costPerWear,
  duplicatePairs,
  findLookalikes,
  hexToFamily,
  keeper,
  mediaLookalikes,
  productSignature,
  similarity,
  wardrobeSignature,
  wordsFromText
} from '../engine/duplicates';
import type { AnyRow, ClothingItemRow } from '../db/schema';

/* ------------------------------------------------------------------- fixtures */

function clothing(over: Partial<ClothingItemRow> & Record<string, any> = {}): AnyRow {
  return {
    id: 'cl1',
    createdAt: 1000,
    updatedAt: 1000,
    deletedAt: null,
    rev: 1,
    deviceId: 'test',
    tags: [],
    text: '',
    name: '',
    category: 'Outerwear',
    brand: '',
    colors: [],
    size: '',
    material: '',
    fit: '',
    price: null,
    boughtOn: '2024-03-01',
    seasons: [],
    occasions: [],
    wears: 0,
    mediaId: null,
    careNotes: '',
    data: {},
    ...over
  } as AnyRow;
}

const BLAZER = clothing({
  id: 'cl-navy',
  name: 'Navy wool blazer',
  category: 'Outerwear',
  brand: 'Zephyr Atelier',
  colors: ['navy'],
  material: 'wool',
  fit: 'True to size',
  seasons: ['All-season'],
  price: 210,
  wears: 12,
  boughtOn: '2023-11-02',
  data: { subcategory: 'Blazer' }
});

const SAME_THING = clothing({
  id: 'cl-navy-2',
  name: 'Navy wool blazer',
  category: 'Outerwear',
  brand: 'Zephyr Atelier',
  colors: ['navy'],
  material: 'wool',
  fit: 'True to size',
  seasons: ['All-season'],
  price: null,
  wears: 0,
  boughtOn: '2025-01-04',
  data: { subcategory: 'Blazer' }
});

const OTHER_NAVY = clothing({
  id: 'cl-darkblue',
  name: 'Dark blue blazer',
  category: 'Outerwear',
  brand: 'Northbound Mills',
  colors: ['dark blue'],
  material: '',
  fit: 'Relaxed',
  seasons: ['Winter', 'Summer'],
  price: 95.5,
  wears: 3,
  boughtOn: '2024-06-18',
  data: { subcategory: 'Blazer' }
});

const BLACK_COAT = clothing({
  id: 'cl-black',
  name: 'Black leather coat',
  category: 'Outerwear',
  brand: 'Northbound Mills',
  colors: ['#000000'],
  material: 'leather',
  fit: 'Oversized',
  seasons: ['Winter'],
  price: 480,
  wears: 2,
  data: { subcategory: 'Coat' }
});

const candidate = (over: Partial<Parameters<typeof candidateSignature>[0]> = {}) => ({
  name: 'Navy wool blazer',
  brand: '',
  category: 'Outerwear',
  subcategory: 'Blazer',
  colours: ['navy'],
  material: 'wool',
  fit: 'True to size',
  seasons: ['All-season'],
  price: 190,
  ...over
});

/* -------------------------------------------------------------- synonym tables */

describe('wardrobeSignature — synonym normalisation', () => {
  it('groups navy, dark blue and a dark blue hex into one colour family', () => {
    expect(wardrobeSignature(clothing({ colors: ['navy'] })).axes.colour.families).toEqual(['navy']);
    expect(wardrobeSignature(clothing({ colors: ['Dark Blue'] })).axes.colour.families).toEqual(['navy']);
    expect(wardrobeSignature(clothing({ colors: ['#1b2a41'] })).axes.colour.families).toEqual(['navy']);
    // a light blue is not a navy: reading them as equal would invent a match
    expect(wardrobeSignature(clothing({ colors: ['sky blue'] })).axes.colour.families).toEqual(['blue']);
  });

  it('reads the fabric out of a composition string the user copied off a label', () => {
    const s = wardrobeSignature(clothing({ material: '98% cotton, 2% elastane' }));
    expect(s.axes.material.typed).toBe('98% cotton, 2% elastane');
    expect(s.axes.material.families).toEqual(['cotton', 'synthetic']);
  });

  it('normalises category, subcategory, fit and season words', () => {
    expect(wardrobeSignature(clothing({ category: 'Tops', data: { subcategory: 'T-shirt' } })).axes.kind.families).toEqual(['tshirt']);
    expect(wardrobeSignature(clothing({ category: 'Tops', data: { subcategory: 'Tee' } })).axes.kind.families).toEqual(['tshirt']);
    expect(wardrobeSignature(clothing({ fit: 'loose' })).axes.fit.families).toEqual(['relaxed']);
    expect(wardrobeSignature(clothing({ fit: 'True to size' })).axes.fit.families).toEqual(['regular']);
    expect(wardrobeSignature(clothing({ seasons: ['Fall'] })).axes.season.families).toEqual(['autumn']);
    expect(wardrobeSignature(clothing({ seasons: ['warm weather'] })).axes.season.families).toEqual(['summer']);
    expect(wardrobeSignature(clothing({ seasons: ['All-season'] })).axes.season.families).toEqual(['all']);
  });

  it('keeps words it does not know as blank rather than guessing a bucket', () => {
    const s = wardrobeSignature(clothing({ material: 'some odd fibre I cannot name', colors: ['vermilion'] }));
    expect(s.axes.material.families).toEqual([]);
    expect(s.axes.colour.families).toEqual([]);
    expect(s.blanks).toEqual(expect.arrayContaining(['colour', 'material']));
  });

  it('buckets hex codes by hue and lightness', () => {
    expect(hexToFamily('#000000')).toBe('black');
    expect(hexToFamily('#ffffff')).toBe('white');
    expect(hexToFamily('#808080')).toBe('grey');
    expect(hexToFamily('#ff0000')).toBe('red');
    expect(hexToFamily('#008000')).toBe('green');
    expect(hexToFamily('#0000ff')).toBe('blue');
    expect(hexToFamily('#1b2a41')).toBe('navy');
    expect(hexToFamily('not-a-colour')).toBeNull();
  });

  it('echoes the user’s own words, not the bucket, in wordsFromText', () => {
    const w = wordsFromText('a slightly loose dark blue wool jumper for winter');
    expect(w.colours).toEqual(['dark blue']);
    expect(w.fits).toEqual(['loose']);
    expect(w.seasons).toEqual(['winter']);
    expect(w.materials).toEqual(['wool']);
  });
});

/* ------------------------------------------------------------------- scoring */

describe('similarity', () => {
  it('uses the whole 24-point frame as the denominator', () => {
    expect(TOTAL_WEIGHT).toBe(24);
    expect(AXES.reduce((s, a) => s + AXIS_WEIGHTS[a], 0)).toBe(TOTAL_WEIGHT);
  });

  it('names every agreeing field in why, quoting what was typed', () => {
    const sim = similarity(BLAZER, SAME_THING);
    expect(sim.score).toBe(1);
    expect(sim.agreeing).toEqual(AXES);
    expect(sim.missing).toEqual([]);
    expect(sim.why.join(' ')).toContain('“Navy wool blazer”');
    expect(sim.why.some((w) => w.startsWith('colour'))).toBe(true);
    expect(sim.why.some((w) => w.startsWith('fabric'))).toBe(true);
  });

  it('is monotone: an extra agreeing field can only raise the score', () => {
    const target = wardrobeSignature(BLAZER);
    const base = { name: 'Navy blazer', category: 'Outerwear', colors: ['navy'], data: { subcategory: 'Blazer' } };
    const s0 = similarity(target, wardrobeSignature(clothing({ ...base, id: 'm0' }))).score;
    const s1 = similarity(target, wardrobeSignature(clothing({ ...base, id: 'm1', material: 'wool' }))).score;
    const s2 = similarity(target, wardrobeSignature(clothing({ ...base, id: 'm2', material: 'wool', seasons: ['All-season'] }))).score;
    const s3 = similarity(target, wardrobeSignature(clothing({ ...base, id: 'm3', material: 'wool', seasons: ['All-season'], fit: 'True to size' }))).score;
    expect([s0, s1, s2, s3]).toEqual([0.708, 0.833, 0.917, 1]);
    // and a filled field that disagrees never raises it
    const s4 = similarity(target, wardrobeSignature(clothing({ ...base, id: 'm4', material: 'wool', seasons: ['All-season'], fit: 'Oversized' }))).score;
    expect(s4).toBeLessThan(s3);
    expect(s4).toBe(s2);
  });

  it('a disagreeing field lowers the score rather than being ignored', () => {
    const agreeFit = similarity(BLAZER, wardrobeSignature(clothing({ ...BLAZER, fit: 'True to size', id: 'a' })));
    const wrongFit = similarity(BLAZER, wardrobeSignature(clothing({ ...BLAZER, fit: 'Oversized', id: 'b' })));
    expect(agreeFit.score).toBe(1);
    expect(wrongFit.score).toBe(0.917);
    expect(wrongFit.differs.map((d) => d.axis)).toEqual(['fit']);
    expect(wrongFit.differs[0].a).toBe('True to size');
    expect(wrongFit.differs[0].b).toBe('Oversized');
  });

  it('a blank field lowers confidence and is named in missing', () => {
    const sim = similarity(BLAZER, OTHER_NAVY);
    expect(sim.missing.some((m) => m.startsWith('material'))).toBe(true);
    expect(sim.ceiling).toBe(0.875);
    // 5 category + 4 kind + 5 colour + 2 season (all-season covers winter/summer)
    expect(sim.score).toBe(0.667);
    expect(sim.certainty).toBe(0.762);
    expect(sim.why.join(' ')).toContain('“navy”');
    expect(sim.why.join(' ')).toContain('“dark blue”');
  });

  it('never lets a blank count as agreement', () => {
    const bothBlank = similarity(
      wardrobeSignature(clothing({ name: 'Blazer', category: 'Outerwear' })),
      wardrobeSignature(clothing({ name: 'Blazer', category: 'Outerwear', id: 'z' }))
    );
    expect(bothBlank.missing.filter((m) => m.includes('both sides')).length).toBeGreaterThan(0);
    expect(bothBlank.score).toBeCloseTo(12 / TOTAL_WEIGHT, 6);
    expect(bothBlank.agreeing).toEqual(['category', 'kind', 'name']);
  });
});

/* ------------------------------------------------------------------ lookalikes */

describe('findLookalikes', () => {
  const rows = [BLAZER, OTHER_NAVY, BLACK_COAT, SAME_THING];

  it('sorts best-first and skips the row being compared', () => {
    const hits = findLookalikes(BLAZER, rows);
    expect(hits.map((h) => h.signature.id)).toEqual(['cl-navy-2', 'cl-darkblue']);
    expect(hits[0].score).toBeGreaterThanOrEqual(hits[1].score);
  });

  it('respects the threshold and the limit', () => {
    expect(findLookalikes(BLAZER, rows, { threshold: 0.99 }).map((h) => h.signature.id)).toEqual(['cl-navy-2']);
    expect(findLookalikes(BLAZER, rows, { limit: 1 })).toHaveLength(1);
    expect(findLookalikes(BLAZER, [])).toEqual([]);
  });

  it('calls pairs of the same piece possible duplicates and picks a keeper', () => {
    const pairs = duplicatePairs([BLAZER, OTHER_NAVY, BLACK_COAT]);
    expect(pairs.map((p) => p.id)).toEqual(['cl-navy~cl-darkblue']);
    // more wears wins, so the merged count lands on the piece actually worn
    expect(pairs[0].keeperId).toBe('cl-navy');
    expect(keeper(wardrobeSignature(BLAZER), wardrobeSignature(OTHER_NAVY)).id).toBe('cl-navy');
  });

  it('does not pair a navy blazer with a black leather coat', () => {
    expect(findLookalikes(BLAZER, [BLACK_COAT])).toEqual([]);
  });
});

/* ------------------------------------------------------------- buy-time check */

describe('checkPurchaseAgainstWardrobe', () => {
  const products = [
    { id: 'pr1', createdAt: 1, updatedAt: 1, deletedAt: null, rev: 1, deviceId: 't', tags: [], text: '', name: 'Navy wool blazer', brand: 'Zephyr Atelier', category: 'Clothing', form: '', sizeLabel: '', pricePaid: 60, currency: 'USD', owned: true, status: 'own', duplicateKey: 'x', data: {} },
    { id: 'pr2', createdAt: 1, updatedAt: 1, deletedAt: null, rev: 1, deviceId: 't', tags: [], text: '', name: 'Blazer cleaner', brand: '', category: 'Other', form: 'spray', sizeLabel: '100ml', pricePaid: null, currency: 'USD', owned: true, status: 'own', duplicateKey: 'y', data: {} },
    { id: 'pr3', createdAt: 1, updatedAt: 1, deletedAt: null, rev: 1, deviceId: 't', tags: [], text: '', name: 'Navy blazer', brand: '', category: 'Clothing', form: '', pricePaid: 12, currency: 'USD', owned: false, status: 'avoid', data: {} }
  ] as unknown as AnyRow[];
  const purchases = [
    { id: 'pu1', createdAt: 1, updatedAt: 1, deletedAt: null, rev: 1, deviceId: 't', tags: [], text: '', productId: 'pr1', label: 'Navy wool blazer', amount: 145, currency: 'USD', boughtOn: '2023-11-02', retailer: 'stall', orderRef: '', reason: '', wouldBuyAgain: null },
    { id: 'pu2', createdAt: 1, updatedAt: 1, deletedAt: null, rev: 1, deviceId: 't', tags: [], text: '', productId: '', label: 'Dry cleaning', amount: 18, currency: 'USD', boughtOn: '2024-02-02', retailer: 'corner', orderRef: '', reason: '', wouldBuyAgain: null }
  ] as unknown as AnyRow[];

  const check = checkPurchaseAgainstWardrobe(candidate(), {
    clothing: [BLAZER, OTHER_NAVY, BLACK_COAT, SAME_THING],
    products,
    purchases
  });

  it('separates an exact re-entry from a merely possible lookalike', () => {
    expect(check.exact.map((m) => m.id)).toEqual(['cl-navy', 'cl-navy-2']);
    expect(check.exact.every((m) => m.missing.length === 0)).toBe(true);
    // only a fully described closet row can be called exact; receipts never are
    expect(check.exact.every((m) => m.source === 'clothingItems')).toBe(true);
    expect(check.possible.map((m) => m.id)).toEqual(expect.arrayContaining(['cl-darkblue', 'pr1', 'pu1']));
    for (const m of check.exact) expect(check.possible.some((p) => p.id === m.id)).toBe(false);
    expect(check.possible.every((m) => m.score < 0.95 || m.missing.length > 0)).toBe(true);
    // a blazer cleaner shares one word and is not offered as a duplicate
    expect([...check.exact, ...check.possible].map((m) => m.id)).not.toContain('pr2');
    expect([...check.exact, ...check.possible].map((m) => m.id)).not.toContain('pu2');
  });

  it('marks rows whose only agreement is the name as sparse, not confident', () => {
    const receipt = check.possible.find((m) => m.id === 'pu1');
    expect(receipt?.sparse).toBe(true);
    expect(receipt?.ceiling).toBe(0.292);
    expect(receipt?.certainty).toBe(1);
    expect(receipt?.score).toBe(0.292);
    expect(receipt?.missing.some((m) => m.startsWith('colour'))).toBe(true);
    expect(receipt?.costNote).toContain('unverified');
    expect(check.exact.every((m) => !m.sparse)).toBe(true);
  });

  it('attaches only the prices and wear counts the rows already carry', () => {
    const pricedIds = check.priced.map((m) => `${m.id}:${m.price}`).sort();
    expect(pricedIds).toEqual(['cl-darkblue:95.5', 'cl-navy:210', 'pr1:60', 'pu1:145']);
    expect(check.unpriced.map((m) => m.id)).toEqual(['cl-navy-2']);
    expect(check.unpriced.every((m) => m.price === null)).toBe(true);
    const worn = check.priced.find((m) => m.id === 'cl-navy');
    expect(worn?.costPerWear).toBeCloseTo(210 / 12, 6);
    expect(worn?.costNote).toContain('210');
    expect(worn?.costNote).toContain('12 wears');
    const neverWorn = check.priced.find((m) => m.id === 'cl-darkblue');
    expect(neverWorn?.wears).toBe(3);
    expect(check.unpriced.find((m) => m.id === 'cl-navy-2')?.costNote).toContain('unverified');
    expect(check.priced.find((m) => m.id === 'pr1')?.costNote).toContain('unverified');
    // cost per wear never invents a denominator
    expect(costPerWear(210, 0)).toBeNull();
    expect(costPerWear(null, 12)).toBeNull();
    expect(costPerWear(210, 12)).toBeCloseTo(17.5, 6);
  });

  it('ignores rows decided against', () => {
    expect([...check.exact, ...check.possible].map((m) => m.id)).not.toContain('pr3');
  });

  it('reports nothing at all when the closet has nothing alike', () => {
    const none = checkPurchaseAgainstWardrobe(candidate({ name: 'Running shoes', category: 'Footwear', subcategory: 'Sneaker', colours: ['white'], material: 'mesh', fit: '', seasons: [] }), {
      clothing: [BLAZER, BLACK_COAT],
      products: [],
      purchases: []
    });
    expect(none.exact).toEqual([]);
    expect(none.possible).toEqual([]);
  });
});

/* ------------------------------------------------------------------- photos */

describe('mediaLookalikes', () => {
  const rows = [
    { id: 'm1', title: 'Same shot', takenOn: '2026-01-02', data: { phash: '0000000000000000' } },
    { id: 'm2', title: 'Six bits away', takenOn: '2026-01-03', data: { phash: 'f300000000000000' } },
    { id: 'm3', title: 'Seven bits away', takenOn: '2026-01-04', data: { phash: 'f700000000000000' } },
    { id: 'm4', title: 'No signature', takenOn: null, data: {} },
    { id: 'm5', title: 'Garbage signature', takenOn: null, data: { phash: 'zzzzzzzz' } }
  ] as unknown as AnyRow[];

  it('keeps what is within maxDistance and drops the rest', () => {
    const hits = mediaLookalikes(rows, '0000000000000000', 6);
    expect(hits.map((h) => h.id)).toEqual(['m1', 'm2']);
    expect(hits[0].distance).toBe(0);
    expect(mediaLookalikes(rows, '0000000000000000', 7).map((h) => h.id)).toContain('m3');
    expect(mediaLookalikes(rows, '0000000000000000', 3).map((h) => h.id)).toEqual(['m1']);
  });

  it('defaults to the library distance and refuses garbage', () => {
    expect(DEFAULT_MEDIA_DISTANCE).toBe(6);
    expect(mediaLookalikes(rows, '0000000000000000').map((h) => h.id)).toEqual(['m1', 'm2']);
    expect(mediaLookalikes(rows, '')).toEqual([]);
    expect(mediaLookalikes(rows, null)).toEqual([]);
    expect(mediaLookalikes(rows, 'not-a-hash')).toEqual([]);
    // a row with no signature can never be reported as a match
    expect(mediaLookalikes(rows, 'f300000000000000').map((h) => h.id)).not.toContain('m4');
    expect(mediaLookalikes(rows, 'f300000000000000').map((h) => h.id)).not.toContain('m5');
  });
});

/* -------------------------------------------------------------- honesty guard */

describe('the module invents nothing', () => {
  const banned = ['prada', 'gucci', 'vermilion', 'scarlet', 'teal', '999', '84.99', 'zara'];
  const cand = candidate();

  const pools = {
    clothing: [BLAZER, OTHER_NAVY, SAME_THING],
    products: [
      { id: 'pr1', createdAt: 1, updatedAt: 1, deletedAt: null, rev: 1, deviceId: 't', tags: [], text: '', name: 'Navy wool blazer', brand: 'Zephyr Atelier', category: 'Clothing', pricePaid: 60, currency: 'USD', owned: true, status: 'own', data: {} }
    ] as unknown as AnyRow[],
    purchases: [
      { id: 'pu1', createdAt: 1, updatedAt: 1, deletedAt: null, rev: 1, deviceId: 't', tags: [], text: '', productId: 'pr1', label: 'Navy wool blazer', amount: 145, currency: 'USD', boughtOn: '2023-11-02', retailer: 'stall', data: {} }
    ] as unknown as AnyRow[]
  };

  const typedValues = [
    ...pools.clothing.flatMap((r) => [r.name, r.brand, r.category, r.material, r.fit, ...(r.colors ?? []), ...(r.seasons ?? []), (r.data?.subcategory ?? '')]),
    ...pools.products.flatMap((r) => [r.name, r.brand, r.category, r.form ?? '']),
    ...pools.purchases.flatMap((r) => [r.label, r.retailer]),
    // the worksheet candidate is an input too: its own words may be quoted back
    ...[cand.name, cand.category, cand.subcategory ?? '', ...cand.colours, cand.material, cand.fit, ...cand.seasons, cand.brand]
  ]
    .map((v) => String(v ?? '').toLowerCase())
    .filter((v) => v.trim() !== '');

  const result = checkPurchaseAgainstWardrobe(cand, pools);
  const blob = JSON.stringify(result).toLowerCase();

  it('prints no brand, price or colour that is not in the rows it was given', () => {
    for (const word of banned) expect(blob).not.toContain(word);
  });

  it('quotes only the user’s own words inside every why and missing line', () => {
    const lines = [...result.exact, ...result.possible].flatMap((m) => [...m.why, ...m.missing]);
    expect(lines.length).toBeGreaterThan(0);
    const quoted = lines.flatMap((l) => l.match(/[“”][^“”]*[“”]/g) ?? []);
    expect(quoted.length).toBeGreaterThan(0);
    const offenders: string[] = [];
    for (const span of quoted) {
      const inner = span.replace(/[“”]/g, '').trim();
      for (const part of inner.split('·')) {
        const p = part.trim().toLowerCase();
        if (!p) continue;
        if (!typedValues.some((t) => t.includes(p) || p.includes(t))) offenders.push(p);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('copies brands, prices and sizes straight off the row objects', () => {
    const brands = [...new Set([...result.exact, ...result.possible].map((m) => m.brand))];
    for (const b of brands) {
      expect([...pools.clothing.map((r) => r.brand), ...pools.products.map((r) => r.brand), '']).toContain(b);
    }
    const prices = [...result.exact, ...result.possible].map((m) => m.price);
    for (const p of prices) {
      expect([210, 95.5, null, 60, 145]).toContain(p);
    }
    for (const m of [...result.exact, ...result.possible]) {
      if (m.costPerWear !== null) expect(m.wears && m.wears > 0).toBe(true);
    }
  });

  it('limits its own vocabulary to the buckets declared in code', () => {
    expect(VOCABULARY).toContain('navy');
    expect(VOCABULARY).toContain('blazer');
    expect(VOCABULARY).not.toContain('scarlet');
    const sig = candidateSignature(candidate());
    for (const ax of AXES) {
      for (const f of sig.axes[ax].families) {
        expect([...VOCABULARY, 'named', 'all'].includes(f)).toBe(true);
      }
    }
  });
});
