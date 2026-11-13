import { describe, expect, it } from 'vitest';
import type { EvidenceGrade, ProductRow, RoutineStep } from '../db/schema';
import { evidenceTone } from '../engine/prioritisation';
import {
  ACTIVES,
  EVIDENCE_GRADES,
  HONESTY_LIMITS,
  LAYER_ORDER,
  PRESCRIPTION,
  analyseRoutine,
  applyOrder,
  newActivesSince,
  prescriptionLine,
  scanIngredients,
  scanPrescriptions
} from '../content/actives';

/**
 * The nightly layer check. These tests are the contract: word-boundary alias
 * scanning, conflict pairing that goes both ways, AM/PM ordering built from
 * what is present, a prescription path that is provably an instruction-free
 * referral, and silence where the rows say nothing.
 */

const TODAY = '2026-06-15';

const product = (over: Partial<ProductRow> = {}): ProductRow => ({
  id: over.id ?? 'p1',
  createdAt: 0,
  updatedAt: 0,
  deletedAt: null,
  rev: 1,
  deviceId: 'test',
  tags: [],
  text: '',
  name: 'Product',
  category: 'skincare',
  brand: '',
  form: '',
  sizeLabel: '',
  pricePaid: null,
  currency: 'USD',
  owned: true,
  openedOn: null,
  expiresOn: null,
  finishedOn: null,
  rating: 0,
  ingredients: '',
  sourceUrl: '',
  status: 'own',
  duplicateKey: '',
  ...over
});

const step = (over: Partial<RoutineStep> = {}): RoutineStep => ({
  id: over.id ?? 's1',
  order: over.order ?? 1,
  label: over.label ?? 'Step',
  detail: over.detail ?? '',
  productId: over.productId ?? null,
  durationMin: 1,
  skipIf: ''
});

const keySet = (matches: ReturnType<typeof scanIngredients>) => matches.map((m) => m.key);

/* ------------------------------------------------------------- 1 · scanning */

describe('scanIngredients', () => {
  it('matches aliases inside longer INCI names', () => {
    expect(keySet(scanIngredients('Capryloyl Salicylic Acid, Glycerin'))).toContain('bha');
    expect(keySet(scanIngredients('Betaine Salicylate'))).toContain('bha');
    expect(keySet(scanIngredients('Water, Retinyl Palmitate, Tocopherol'))).toContain('retinoid');
    expect(keySet(scanIngredients('Zinc Oxide 12%'))).toContain('mineral-sunscreen');
  });

  it('does not fire on a shorter name that merely looks similar', () => {
    // "glycol" is not "glycolic"
    expect(scanIngredients('Pentylene Glycol, Caprylyl Glycol, Propanediol')).toEqual([]);
    // "lactobionate" is not "lactobionic"
    expect(keySet(scanIngredients('Sodium Lactobionate'))).not.toContain('pha');
    // a plain fatty alcohol is not an active
    expect(scanIngredients('Cetearyl Alcohol, Cetyl Palmitate')).toEqual([]);
    // nicotinate esters are not niacinamide
    expect(keySet(scanIngredients('Methyl Nicotinate'))).not.toContain('niacinamide');
  });

  it('reads the four vitamin C forms as distinct entries', () => {
    expect(keySet(scanIngredients('Ascorbic Acid, Ferulic Acid'))).toContain('l-ascorbic-acid');
    for (const alias of ['Sodium Ascorbyl Phosphate', '3-O-Ethyl Ascorbic Acid', 'Ascorbyl Tetraisopalmitate']) {
      const keys = keySet(scanIngredients(`${alias}, Glycerin`));
      expect(keys).toContain('vitamin-c-derivative');
      expect(keys).not.toContain('l-ascorbic-acid');
    }
  });

  it('never reads ascorbyl palmitate as pure L-ascorbic acid', () => {
    const keys = keySet(scanIngredients('Ascorbyl Palmitate, Tocopherol'));
    expect(keys).not.toContain('l-ascorbic-acid');
    expect(keys).toContain('vitamin-c-derivative');
  });

  it('says nothing when there is nothing to read', () => {
    expect(scanIngredients('')).toEqual([]);
    expect(scanIngredients('   ')).toEqual([]);
    expect(scanIngredients('Water, Glycerin, Xanthan Gum')).toEqual([]);
  });

  it('is case and separator insensitive', () => {
    expect(keySet(scanIngredients('RETINALDEHYDE'))).toContain('retinoid');
    expect(keySet(scanIngredients('3-O-ETHYL ASCORBIC ACID'))).toContain('vitamin-c-derivative');
    // an en dash in the typed list normalises to the same alias
    expect(keySet(scanIngredients('Water, 3–O–Ethyl Ascorbic Acid'))).toContain('vitamin-c-derivative');
  });

  it('exposes only grades from the app union, and they all tone-map', () => {
    const grades = new Set(EVIDENCE_GRADES);
    for (const a of ACTIVES) {
      expect(grades.has(a.evidence)).toBe(true);
      expect(() => evidenceTone(a.evidence as EvidenceGrade)).not.toThrow();
      expect(typeof evidenceTone(a.evidence)).toBe('string');
    }
  });

  it('keeps the flags as data, not prose', () => {
    const bp = ACTIVES.find((a) => a.key === 'benzoyl-peroxide');
    expect(bp?.bleachesFabric).toBe(true);
    expect(ACTIVES.find((a) => a.key === 'retinoid')?.sunSensitivity).toBe(true);
    expect(ACTIVES.find((a) => a.key === 'niacinamide')?.irritant).toBe(false);
    expect(ACTIVES.find((a) => a.key === 'azelaic-acid')?.sunSensitivity).toBe(false);
  });
});

/* ---------------------------------------------------------- 2 · prescriptions */

describe('prescription referral', () => {
  const names = ['tretinoin', 'tazarotene', 'adapalene', 'hydroquinone', 'minoxidil', 'spironolactone', 'doxycycline'];

  it('recognises every prescription name in the table', () => {
    for (const n of names) {
      expect(PRESCRIPTION.some((p) => p.aliases.includes(n))).toBe(true);
      const hits = scanPrescriptions(`Water, ${n}, Glycerin`);
      expect(hits.length).toBe(1);
      expect(hits[0].line).toContain(n.charAt(0).toUpperCase() + n.slice(1));
    }
  });

  it('emits no digit, unit, percentage, frequency, duration or method anywhere in the line', () => {
    for (const n of names) {
      const line = prescriptionLine(n);
      expect(line).not.toMatch(/\d/);
      expect(line).not.toMatch(/%/);
      expect(line).not.toMatch(/\b(mg|ml|mcg|g|iu|units?)\b/i);
      expect(line).not.toMatch(/\b(daily|nightly|weekly|twice|thrice|once|every other|per (day|week|night)|times? a (day|week|night)|a week|pea-size|pea sized)\b/i);
      expect(line).not.toMatch(/\b(apply|spread|massage|smooth|pat|dab|swipe|rinse|layer|leave on|start with|build up|ramp up|increase to|work up|dose|strength of \d)\b/i);
      expect(line).not.toMatch(/how to (use|apply)/i);
      expect(line).toMatch(/prescrib/i);
    }
  });

  it('gives prescription entries no behavioural fields at all', () => {
    for (const p of PRESCRIPTION) {
      const raw = p as unknown as Record<string, unknown>;
      expect(Object.keys(raw).sort()).toEqual(['aliases', 'family', 'name']);
      expect(raw).not.toHaveProperty('why');
      expect(raw).not.toHaveProperty('evidence');
      expect(raw).not.toHaveProperty('roles');
      expect(raw).not.toHaveProperty('layerGroup');
      expect(raw).not.toHaveProperty('timeOfDay');
    }
    // and they never appear in the actives table, so they cannot reach a rule
    for (const p of PRESCRIPTION) {
      for (const alias of p.aliases) {
        const hit = scanIngredients(alias);
        expect(hit.map((h) => h.key)).not.toContain('retinoid');
      }
    }
  });

  it('names the prescription and refuses the rest, without touching the actives list', () => {
    const rows = [
      product({ id: 'rx', name: 'Tube from the clinic', ingredients: 'Tretinoin 0.05%, emulsified base' }),
      product({ id: 'gel', name: 'Cleanser', ingredients: 'Water, Glycerin, Cocamidopropyl Betaine' })
    ];
    const steps = [step({ id: 'a', order: 1, label: 'Wash', productId: 'gel' }), step({ id: 'b', order: 2, label: 'Treatment', productId: 'rx' })];
    const out = analyseRoutine(steps, rows, { today: TODAY });
    expect(out.prescriptions.map((p) => p.name)).toEqual(['Tretinoin']);
    expect(out.prescriptions[0].line).toMatch(/does not state a strength, a frequency or a method/);
    expect(out.actives.map((a) => a.key)).not.toContain('retinoid');
    expect(out.conflicts).toEqual([]);
  });
});

/* ----------------------------------------------------------- 3 · conflicts */

describe('analyseRoutine conflicts', () => {
  const shelves = [
    product({ id: 'ret', name: 'Retinol 0.3 buffer', ingredients: 'Water, Retinol, Squalane', openedOn: '2026-05-02' }),
    product({ id: 'aha', name: 'Glow peel', ingredients: 'Glycolic Acid, Water', openedOn: '2026-05-20' }),
    product({ id: 'bha', name: 'Congestion liquid', ingredients: 'Salicylic Acid, Water', openedOn: '2026-04-01' }),
    product({ id: 'moist', name: 'Ceramide cream', ingredients: 'Water, Ceramide NP, Glycerin' })
  ];
  const steps = [
    step({ id: '1', order: 1, label: 'Cleanse', productId: null }),
    step({ id: '2', order: 2, label: 'Retinoid', productId: 'ret' }),
    step({ id: '3', order: 3, label: 'Acid', productId: 'aha' }),
    step({ id: '4', order: 4, label: 'BHA', productId: 'bha' }),
    step({ id: '5', order: 5, label: 'Moisturiser', productId: 'moist' })
  ];
  const out = analyseRoutine(steps, shelves, { today: TODAY });

  it('pairs the retinoid with both acids and the two acids with each other', () => {
    const rules = out.conflicts.map((c) => c.rule).sort();
    expect(rules).toEqual(['exfoliant-stack', 'retinoid-strong-acid', 'retinoid-strong-acid']);
    const acid = out.conflicts.find((c) => c.rule === 'retinoid-strong-acid');
    expect(acid?.families).toEqual(expect.arrayContaining(['Retinoid', 'AHA']));
    expect(acid?.basis).toBe('established');
    expect(acid?.when).toBe('one night');
    expect(acid?.text).toContain('(Retinol 0.3 buffer)');
    expect(acid?.text).toContain('carries a retinoid');
  });

  it('names the actual colliding steps, not a generic warning', () => {
    for (const c of out.conflicts) {
      expect(out.stepScans.some((s) => s.stepId === c.a.stepId)).toBe(true);
      expect(out.stepScans.some((s) => s.stepId === c.b.stepId)).toBe(true);
      expect(c.text).toContain(c.a.label);
      expect(c.text).toContain(c.b.label);
    }
    const stack = out.conflicts.find((c) => c.rule === 'exfoliant-stack');
    expect(stack?.a.label).toBe('Acid');
    expect(stack?.b.label).toBe('BHA');
  });

  it('finds the same conflict whichever order the steps sit in', () => {
    const flipped = analyseRoutine(steps.map((s, i) => ({ ...s, order: steps.length - i })), shelves, { today: TODAY });
    expect(flipped.conflicts.map((c) => c.rule).sort()).toEqual(['exfoliant-stack', 'retinoid-strong-acid', 'retinoid-strong-acid']);
  });

  it('does not invent a conflict out of one product that holds two exfoliants', () => {
    const one = analyseRoutine([step({ id: 'x', label: 'Exfoliant toner', productId: 'combo' })], [product({ id: 'combo', name: 'A+B', ingredients: 'Glycolic Acid, Salicylic Acid' })], { today: TODAY });
    // one step, one bottle: conflicts are pairs of steps, and there is no pair
    expect(one.conflicts).toEqual([]);
    expect(keySet(one.actives).sort()).toEqual(['aha', 'bha']);
  });

  it('keeps conservative rules labelled as conservative', () => {
    const out2 = analyseRoutine(
      [step({ id: 'c', order: 1, label: 'Vitamin C', productId: 'vc' }), step({ id: 'r', order: 2, label: 'Retinoid', productId: 'ret' })],
      [...shelves, product({ id: 'vc', name: 'C serum', ingredients: 'Ascorbic Acid, Ferulic Acid' })],
      { today: TODAY }
    );
    expect(out2.conflicts).toHaveLength(1);
    const pair = out2.conflicts[0];
    expect(pair.rule).toBe('ascorbic-acid-retinoid');
    expect(pair.basis).toBe('conservative');
    expect(pair.when).toBe('different times of day');
  });

  it('sorts established cautions ahead of conservative ones', () => {
    const mixed = analyseRoutine(
      [
        step({ id: 'c', order: 1, label: 'Vitamin C', productId: 'vc' }),
        step({ id: 'r', order: 2, label: 'Retinoid', productId: 'ret' }),
        step({ id: 'a', order: 3, label: 'Acid', productId: 'aha' })
      ],
      [...shelves, product({ id: 'vc', name: 'C serum', ingredients: 'Ascorbic Acid, Ferulic Acid' })],
      { today: TODAY }
    );
    expect(mixed.conflicts.map((c) => c.basis)[0]).toBe('established');
    expect(mixed.conflicts.some((c) => c.basis === 'conservative')).toBe(true);
  });

  it('never puts a benign pair on the collision list', () => {
    const calm = analyseRoutine(
      [step({ id: 'n', order: 1, label: 'Serum', productId: 'nia' }), step({ id: 'm', order: 2, label: 'Cream', productId: 'moist' })],
      [...shelves, product({ id: 'nia', name: 'Niacinamide', ingredients: 'Niacinamide, Water' })],
      { today: TODAY }
    );
    expect(calm.conflicts).toEqual([]);
    expect(keySet(calm.actives)).toEqual(['niacinamide']);
  });
});

/* ------------------------------------------------------------- 4 · ordering */

describe('layering order', () => {
  const rows = [
    product({ id: 'wash', name: 'Gel cleanser', ingredients: 'Water, Coco-Glucoside' }),
    product({ id: 'toner', name: 'Hydrating toner', ingredients: 'Water, Glycerin' }),
    product({ id: 'vc', name: 'C serum', ingredients: 'Ascorbic Acid, Ferulic Acid' }),
    product({ id: 'ret', name: 'Retinol', ingredients: 'Retinol, Squalane' }),
    product({ id: 'cream', name: 'Moisturiser', ingredients: 'Water, Ceramide NP' }),
    product({ id: 'oil', name: 'Rosehip oil', ingredients: 'Rosa Canina Seed Oil' }),
    product({ id: 'spf', name: 'Day fluid', ingredients: 'Zinc Oxide, Avobenzone' })
  ];
  const steps = [
    step({ id: 's7', order: 7, label: 'Face oil', productId: 'oil' }),
    step({ id: 's1', order: 1, label: 'Cleanse', productId: 'wash' }),
    step({ id: 's6', order: 6, label: 'Sunscreen', productId: 'spf' }),
    step({ id: 's4', order: 4, label: 'Retinol', productId: 'ret' }),
    step({ id: 's2', order: 2, label: 'Toner', productId: 'toner' }),
    step({ id: 's5', order: 5, label: 'Moisturiser', productId: 'cream' }),
    step({ id: 's3', order: 3, label: 'Vitamin C', productId: 'vc' })
  ];
  const out = analyseRoutine(steps, rows, { today: TODAY });

  it('runs thinnest to occlusive and finishes the morning with sunscreen', () => {
    // the vitamin C bottle is grouped by its active, not by the word "serum"
    expect(out.layering.am.map((i) => i.group)).toEqual(['cleanse', 'tone', 'active', 'moisturise', 'oil', 'sunscreen']);
    expect(out.layering.am.map((i) => i.label)).toEqual(['Cleanse', 'Toner', 'Vitamin C', 'Moisturiser', 'Face oil', 'Sunscreen']);
    expect(out.layering.am[out.layering.am.length - 1].note).toContain('Last layer in the morning');
  });

  it('drops the night-only active and the sunscreen from the morning list', () => {
    expect(out.layering.am.map((i) => i.stepId)).not.toContain('s4');
    expect(out.layering.pm.map((i) => i.stepId)).not.toContain('s6');
    expect(out.layering.pm.map((i) => i.label)).toEqual(['Cleanse', 'Toner', 'Vitamin C', 'Retinol', 'Moisturiser', 'Face oil']);
  });

  it('orders every group in the declared sequence', () => {
    const ranks = out.layering.pm.map((i) => LAYER_ORDER.indexOf(i.group));
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
  });

  it('places an unrecognised step last instead of guessing', () => {
    const withUnknown = analyseRoutine([...steps, step({ id: 'zz', order: 8, label: 'The blue bottle', productId: null })], rows, { today: TODAY });
    const last = withUnknown.layering.pm[withUnknown.layering.pm.length - 1];
    expect(last.group).toBe('unplaced');
    expect(last.groupLabel).toBe('Could not place');
    expect(last.note).toContain('could not work out');
  });

  it('apply order renumbers only, and keeps every step', () => {
    const next = applyOrder(steps, out.layering.pm);
    expect(next).toHaveLength(steps.length);
    expect([...next.map((s) => s.id)].sort()).toEqual([...steps.map((s) => s.id)].sort());
    expect(next.map((s) => s.order)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(next.map((s) => s.id)).toEqual(['s1', 's2', 's3', 's4', 's5', 's7', 's6']);
    expect(next.find((s) => s.id === 's1')?.productId).toBe('wash');
    expect(next.find((s) => s.id === 's6')?.label).toBe('Sunscreen');
  });
});

/* ---------------------------------------------------------------- 5 · notes */

describe('notes and honest silence', () => {
  const ret = product({ id: 'ret', name: 'Retinol', ingredients: 'Retinol, Squalane' });
  const aha = product({ id: 'aha', name: 'Glow peel', ingredients: 'Glycolic Acid, Water' });
  const bp = product({ id: 'bp', name: 'Spot cream', ingredients: 'Benzoyl Peroxide, Carbomer' });

  it('attaches the sun item to the routine that needs it and not to one that does not', () => {
    const withAcid = analyseRoutine(
      [step({ id: 'a', order: 1, label: 'Acid', productId: 'aha' }), step({ id: 'u', order: 2, label: 'Something else', productId: null })],
      [aha],
      { today: TODAY }
    );
    expect(withAcid.notes.map((n) => n.key)).toContain('sun');
    expect(withAcid.notes.find((n) => n.key === 'sun')?.text).toMatch(/SPF|sunscreen/i);
    expect(withAcid.notes.map((n) => n.key)).toContain('unread');
    expect(withAcid.notes.find((n) => n.key === 'unread')?.text).toMatch(/not a clean result/);

    const calm = analyseRoutine([step({ id: 'n', label: 'Serum', productId: 'nia' })], [product({ id: 'nia', name: 'Niacinamide', ingredients: 'Niacinamide, Water' })], { today: TODAY });
    expect(calm.notes.map((n) => n.key)).toEqual([]);
  });

  it('carries the bleach warning as a note the moment peroxide appears', () => {
    const out = analyseRoutine([step({ id: 'b', label: 'Spot', productId: 'bp' })], [bp], { today: TODAY });
    expect(out.notes.find((n) => n.key === 'bleach')?.text).toMatch(/bleaches fabric/i);
    expect(out.notes.map((n) => n.key)).not.toContain('one-at-a-time');
  });

  it('retinoid against peroxide is a collision, not a suggestion', () => {
    const out = analyseRoutine(
      [step({ id: '1', order: 1, label: 'Peroxide', productId: 'bp' }), step({ id: '2', order: 2, label: 'Retinoid', productId: 'ret' })],
      [bp, ret],
      { today: TODAY }
    );
    expect(out.conflicts.map((c) => c.rule)).toContain('retinoid-benzoyl-peroxide');
  });

  it('only claims a new active when your open dates say so', () => {
    const dated = analyseRoutine(
      [step({ id: '1', order: 1, label: 'Retinoid', productId: 'ret' }), step({ id: '2', order: 2, label: 'Acid', productId: 'aha' })],
      [product({ ...ret, openedOn: '2026-06-01' }), product({ ...aha, openedOn: '2026-06-05' })],
      { today: TODAY }
    );
    expect(dated.notes.find((n) => n.key === 'one-at-a-time')?.text).toContain('were opened within the last 4 weeks');
    expect(dated.notes.map((n) => n.key)).toContain('patch-test');

    const undated = analyseRoutine(
      [step({ id: '1', order: 1, label: 'Retinoid', productId: 'ret' }), step({ id: '2', order: 2, label: 'Acid', productId: 'aha' })],
      [ret, aha],
      { today: TODAY }
    );
    const note = undated.notes.find((n) => n.key === 'one-at-a-time')?.text ?? '';
    expect(note).toMatch(/cannot tell which of them is new/);
    expect(note).not.toMatch(/was opened|were opened/);
    expect(undated.notes.map((n) => n.key)).toContain('patch-test');
  });

  it('reports newActivesSince as not computable without dates', () => {
    expect(newActivesSince([ret, aha], 28, TODAY).computable).toBe(false);
    const dated = newActivesSince([product({ ...ret, openedOn: '2026-06-10' })], 28, TODAY);
    expect(dated.computable).toBe(true);
    expect(dated.hits.map((h) => h.productId)).toEqual(['ret']);
    expect(newActivesSince([product({ ...ret, openedOn: '2025-01-01' })], 28, TODAY).hits).toEqual([]);
  });

  it('makes no claim at all from empty or unknown ingredient text', () => {
    const out = analyseRoutine(
      [step({ id: '1', order: 1, label: 'Mystery', productId: 'x' }), step({ id: '2', order: 2, label: 'Blank', productId: 'y' })],
      [product({ id: 'x', name: 'Unlabeled', ingredients: 'Aqua, Sodium Chloride, Parfum' }), product({ id: 'y', name: 'No list', ingredients: '' })],
      { today: TODAY }
    );
    expect(out.actives).toEqual([]);
    expect(out.conflicts).toEqual([]);
    expect(out.prescriptions).toEqual([]);
    expect(out.notes.map((n) => n.key)).toEqual(['unread']);
    // one bottle had a list to read (it just named no active family), one had none
    expect(out.readSteps).toBe(1);
    expect(out.unreadSteps).toBe(1);
    expect(out.limits[0]).toMatch(/not an all-clear/);
    expect(out.layering.am).toHaveLength(2);
  });

  it('always states what it cannot see', () => {
    const out = analyseRoutine([step({ id: 'a', label: 'Acid', productId: 'aha' })], [aha], { today: TODAY });
    expect(out.limits).toEqual(expect.arrayContaining(HONESTY_LIMITS));
    expect(out.limits.join(' ')).toMatch(/concentration/i);
    expect(out.limits.join(' ')).toMatch(/cannot see/i);
  });

  it('reads an active typed into the step itself, and says where it came from', () => {
    const out = analyseRoutine([step({ id: 's', label: 'Retinoid', detail: 'pea size, retinaldehyde', productId: null })], [], { today: TODAY });
    expect(keySet(out.actives)).toContain('retinoid');
    expect(out.stepScans[0].source).toBe('typed in the step');
  });

  it('handles an empty routine without inventing anything', () => {
    const out = analyseRoutine([], [], { today: TODAY });
    expect(out.actives).toEqual([]);
    expect(out.conflicts).toEqual([]);
    expect(out.layering).toEqual({ am: [], pm: [] });
    expect(out.notes).toEqual([]);
  });
});
