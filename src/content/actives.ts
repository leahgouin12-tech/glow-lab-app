import type { EvidenceGrade, ProductRow, RoutineStep } from '../db/schema';

/**
 * THE GLOW LAB — actives reference and the nightly layer check (spec Part 12).
 *
 * What this is: a table of ingredient families plus pure functions that read
 * the INCI text and the routine steps you already typed. Every statement here
 * is either a labelling fact (this name belongs to this family), a
 * formulation-level physical fact (benzoyl peroxide bleaches fabric; sunscreen
 * goes last in the morning; water-thin layers sit under oils), or an attribute
 * carried as data — `sunSensitivity`, `irritant`, `bleachesFabric` — rather
 * than as prose.
 *
 * What this is not: it never diagnoses, never states a strength, percentage,
 * dose or frequency for anything, and never recommends a prescription. The
 * prescription set below has exactly one behaviour: a referral line.
 *
 * Honesty floor: matches come from words you typed. Concentration, pH, vehicle,
 * position in the list and your own skin are invisible to this file, so
 * HONESTY_LIMITS ships with every result and no match produces no claim.
 */

/* ------------------------------------------------------------------ types */

export type ActiveRole =
  | 'retinoid'
  | 'retinoid-like'
  | 'strong-exfoliant'
  | 'mild-exfoliant'
  | 'benzoyl-peroxide'
  | 'ascorbic-acid'
  | 'antioxidant'
  | 'barrier'
  | 'tone'
  | 'peptide'
  | 'sunscreen'
  | 'bleaches-fabric'
  | 'sun-sensitivity'
  | 'irritant';

export type LayerGroup = 'cleanse' | 'tone' | 'serum' | 'active' | 'moisturise' | 'oil' | 'occlusive' | 'sunscreen' | 'unplaced';

export interface ActiveEntry {
  key: string;
  label: string;
  family: string;
  /** fragments as they appear on a label, matched on word boundaries */
  aliases: string[];
  roles: ActiveRole[];
  evidence: EvidenceGrade;
  /** one plain sentence, at the confidence the grade supports */
  why: string;
  sunSensitivity: boolean;
  irritant: boolean;
  bleachesFabric: boolean;
  timeOfDay: 'am' | 'pm' | 'either';
  layerGroup: LayerGroup;
}

export interface ActiveMatch {
  key: string;
  label: string;
  family: string;
  roles: ActiveRole[];
  evidence: EvidenceGrade;
  why: string;
  aliases: string[];
  sunSensitivity: boolean;
  irritant: boolean;
  bleachesFabric: boolean;
}

export interface PrescriptionEntry {
  name: string;
  aliases: string[];
  family: string;
}

export interface StepScan {
  stepId: string;
  order: number;
  label: string;
  productId: string | null;
  productName: string;
  group: LayerGroup;
  /** false when the step has no linked product, or the product has no INCI list */
  readable: boolean;
  source: 'linked product' | 'typed in the step' | 'nothing to read';
  matches: ActiveMatch[];
}

export type ConflictRule =
  | 'exfoliant-stack'
  | 'retinoid-strong-acid'
  | 'retinoid-benzoyl-peroxide'
  | 'ascorbic-acid-retinoid'
  | 'ascorbic-acid-strong-acid';

export interface RoutineConflict {
  id: string;
  rule: ConflictRule;
  /** how firmly the rule is held */
  basis: 'established' | 'conservative';
  when: 'one night' | 'same application' | 'different times of day';
  text: string;
  a: { stepId: string; label: string };
  b: { stepId: string; label: string };
  families: string[];
}

export interface LayerItem {
  stepId: string;
  label: string;
  productId: string | null;
  productName: string;
  group: LayerGroup;
  groupLabel: string;
  families: string[];
  note: string;
}

export interface RoutineNote {
  key: 'sun' | 'bleach' | 'one-at-a-time' | 'patch-test' | 'unread';
  text: string;
}

export interface PrescriptionHit {
  name: string;
  family: string;
  line: string;
  stepId: string;
  stepLabel: string;
  productName: string;
}

export interface RoutineAnalysis {
  actives: ActiveMatch[];
  conflicts: RoutineConflict[];
  layering: { am: LayerItem[]; pm: LayerItem[] };
  notes: RoutineNote[];
  prescriptions: PrescriptionHit[];
  stepScans: StepScan[];
  /** honest limits, always present so they cannot be scrolled past */
  limits: string[];
  readSteps: number;
  unreadSteps: number;
}

/* ------------------------------------------------------------ the vocabulary */

/** The only grades this module may emit — imported union, nothing coined. */
export const EVIDENCE_GRADES: EvidenceGrade[] = [
  'strong',
  'moderate',
  'limited',
  'weak',
  'unsupported',
  'emerging',
  'traditional',
  'cosmetic',
  'professional',
  'dangerous'
];

/** Thinnest water-based first, actives next, lipids, occlusive, sunscreen last in the AM. */
export const LAYER_ORDER: LayerGroup[] = ['cleanse', 'tone', 'serum', 'active', 'moisturise', 'oil', 'occlusive', 'sunscreen', 'unplaced'];

export const LAYER_LABEL: Record<LayerGroup, string> = {
  cleanse: 'Cleanse',
  tone: 'Water-thin layer',
  serum: 'Serum',
  active: 'Active',
  moisturise: 'Moisturiser',
  oil: 'Oil',
  occlusive: 'Occlusive',
  sunscreen: 'Sunscreen',
  unplaced: 'Could not place'
};

export const HONESTY_LIMITS: string[] = [
  'This reads the ingredient words you typed. It cannot see concentration, pH, vehicle, position in the list, or your skin.',
  'A name near the end of an INCI list is usually a pH adjuster or a preservative rather than an active. Word order is not visible from plain text.',
  'A conflict here is a layering caution, not a diagnosis, and it never applies to a prescription step — that conversation belongs to your prescriber.'
];

/** Attribution window for "is this active new?" — four weeks, from your own open dates. */
export const INTRO_WINDOW_DAYS = 28;
const INTRO_WINDOW_TEXT = 'two to four weeks';

/* ------------------------------------------------------------------ ACTIVES */

export const ACTIVES: ActiveEntry[] = [
  {
    key: 'retinoid',
    label: 'Retinoid',
    family: 'Retinoid',
    aliases: ['retinol', 'retinal', 'retinaldehyde', 'retinyl palmitate', 'retinyl acetate', 'retinyl linoleate', 'hydroxypinacolone retinoate'],
    roles: ['retinoid', 'sun-sensitivity', 'irritant'],
    evidence: 'strong',
    why: 'Vitamin-A derivatives are the best-evidenced topical for texture and tone after sunscreen. How much is actually delivered is not something a label lets this app see.',
    sunSensitivity: true,
    irritant: true,
    bleachesFabric: false,
    timeOfDay: 'pm',
    layerGroup: 'active'
  },
  {
    key: 'bakuchiol',
    label: 'Bakuchiol',
    family: 'Retinol alternative',
    aliases: ['bakuchiol'],
    roles: ['retinoid-like'],
    evidence: 'limited',
    why: 'A plant compound used in place of a retinoid. One small comparison study is behind most of what is claimed for it — a long way from the retinoid data.',
    sunSensitivity: false,
    irritant: false,
    bleachesFabric: false,
    timeOfDay: 'either',
    layerGroup: 'active'
  },
  {
    key: 'aha',
    label: 'AHA',
    family: 'Exfoliating acid',
    aliases: ['glycolic', 'lactic', 'mandelic', 'malic', 'tartaric', 'citric', 'hydroxyacetic acid', 'aha'],
    roles: ['strong-exfoliant', 'sun-sensitivity', 'irritant'],
    evidence: 'moderate',
    why: 'Surface exfoliation for texture and dullness, with reasonable short-term data. Whether an acid here is the active or the pH adjuster at the bottom of the list is not visible from the words alone.',
    sunSensitivity: true,
    irritant: true,
    bleachesFabric: false,
    timeOfDay: 'pm',
    layerGroup: 'active'
  },
  {
    key: 'bha',
    label: 'BHA',
    family: 'Exfoliating acid',
    aliases: ['salicylic', 'salicylate', 'beta hydroxy', 'bha'],
    roles: ['strong-exfoliant', 'sun-sensitivity', 'irritant'],
    evidence: 'moderate',
    why: 'Oil-soluble acid that works inside the follicle. The standard pick for congestion, and an irritant the moment it is layered on top of everything else.',
    sunSensitivity: true,
    irritant: true,
    bleachesFabric: false,
    timeOfDay: 'pm',
    layerGroup: 'active'
  },
  {
    key: 'pha',
    label: 'PHA',
    family: 'Exfoliating acid',
    aliases: ['gluconolactone', 'lactobionic', 'pha'],
    roles: ['mild-exfoliant', 'irritant'],
    evidence: 'limited',
    why: 'Polyhydroxy acids exfoliate more slowly and are usually better tolerated. Their sun-sensitivity profile is studied far less than the classic acids.',
    sunSensitivity: false,
    irritant: true,
    bleachesFabric: false,
    timeOfDay: 'pm',
    layerGroup: 'active'
  },
  {
    key: 'benzoyl-peroxide',
    label: 'Benzoyl peroxide',
    family: 'Antibacterial',
    aliases: ['benzoyl peroxide', 'bpo'],
    roles: ['benzoyl-peroxide', 'sun-sensitivity', 'irritant', 'bleaches-fabric'],
    evidence: 'strong',
    why: 'Extensive acne literature and no bacterial resistance. It oxidises other actives it touches, and it bleaches towels, pillowcases and clothing.',
    sunSensitivity: true,
    irritant: true,
    bleachesFabric: true,
    timeOfDay: 'pm',
    layerGroup: 'active'
  },
  {
    key: 'l-ascorbic-acid',
    label: 'Vitamin C (L-ascorbic acid)',
    family: 'Antioxidant',
    aliases: ['l-ascorbic acid', 'ascorbic acid'],
    roles: ['ascorbic-acid', 'antioxidant', 'irritant'],
    evidence: 'moderate',
    why: 'Antioxidant brightening with solid mechanism data and thinner face data than its reputation. It is a low-pH acid, which is why it stings and why it is awkward to stack.',
    sunSensitivity: false,
    irritant: true,
    bleachesFabric: false,
    timeOfDay: 'am',
    layerGroup: 'serum'
  },
  {
    key: 'vitamin-c-derivative',
    label: 'Vitamin C derivative',
    family: 'Antioxidant',
    aliases: [
      'sodium ascorbyl phosphate',
      'magnesium ascorbyl phosphate',
      '3-o-ethyl ascorbic acid',
      'ascorbyl tetraisopalmitate',
      'tetrahexyldecyl ascorbate',
      'ascorbyl glucoside',
      'ascorbyl palmitate',
      'ascorbyl phosphate'
    ],
    roles: ['antioxidant'],
    evidence: 'limited',
    why: 'Ester and salt forms of vitamin C. Better behaved and less acidic; how much converts back on skin is not readable from a label.',
    sunSensitivity: false,
    irritant: false,
    bleachesFabric: false,
    timeOfDay: 'am',
    layerGroup: 'serum'
  },
  {
    key: 'niacinamide',
    label: 'Niacinamide',
    family: 'Barrier and tone',
    aliases: ['niacinamide', 'nicotinamide'],
    roles: ['barrier', 'tone'],
    evidence: 'moderate',
    why: 'Bland, well tolerated, pairs with everything on this list. The trials used modest amounts, so a higher percentage on a label is not a stronger result.',
    sunSensitivity: false,
    irritant: false,
    bleachesFabric: false,
    timeOfDay: 'either',
    layerGroup: 'serum'
  },
  {
    key: 'azelaic-acid',
    label: 'Azelaic acid',
    family: 'Tone and congestion',
    aliases: ['azelaic', '1,12-dodecanedioic acid'],
    roles: ['tone', 'mild-exfoliant'],
    evidence: 'moderate',
    why: 'Used for redness and post-spot marks, and one of the few actives reactive skin usually accepts. Itching in the first week is common.',
    sunSensitivity: false,
    irritant: false,
    bleachesFabric: false,
    timeOfDay: 'either',
    layerGroup: 'active'
  },
  {
    key: 'copper-peptide',
    label: 'Copper peptide',
    family: 'Peptide',
    aliases: ['copper tripeptide-1', 'copper tripeptide-2', 'copper amino acids', 'ghk-cu'],
    roles: ['peptide'],
    evidence: 'limited',
    why: 'Wound-healing lineage, thin cosmetic data. Listed so the panel recognises it instead of guessing at it.',
    sunSensitivity: false,
    irritant: false,
    bleachesFabric: false,
    timeOfDay: 'either',
    layerGroup: 'serum'
  },
  {
    key: 'mineral-sunscreen',
    label: 'Mineral sunscreen',
    family: 'Photoprotection',
    aliases: ['zinc oxide', 'titanium dioxide'],
    roles: ['sunscreen'],
    evidence: 'strong',
    why: 'The best-supported appearance intervention available without a prescription, and the step every other entry here depends on.',
    sunSensitivity: false,
    irritant: false,
    bleachesFabric: false,
    timeOfDay: 'am',
    layerGroup: 'sunscreen'
  },
  {
    key: 'chemical-sunscreen',
    label: 'Organic sunscreen filter',
    family: 'Photoprotection',
    aliases: [
      'avobenzone',
      'homosalate',
      'octocrylene',
      'octisalate',
      'octinoxate',
      'ethylhexyl methoxycinnamate',
      'bemotrizinol',
      'bis-ethylhexyloxyphenol methoxyphenyl triazine',
      'methylene bis-benzotriazolyl tetramethylbutylphenol',
      'diethylamino hydroxybenzoyl hexyl benzoate',
      'tris-biphenyl triazine',
      'enzacamene',
      'isoamyl p-methoxycinnamate'
    ],
    roles: ['sunscreen'],
    evidence: 'strong',
    why: 'Modern filters reach broad-spectrum protection in a more wearable form than older ones. The class evidence is strong; what one bottle does on your face is not readable from the list.',
    sunSensitivity: false,
    irritant: false,
    bleachesFabric: false,
    timeOfDay: 'am',
    layerGroup: 'sunscreen'
  }
];

/**
 * Prescription-level names. Their ONLY behaviour in this module is the referral
 * line. There is deliberately no evidence grade, no roles, no layer group and
 * no timeOfDay here, so nothing in this file can generate an instruction, an
 * ordering or a conflict for any of them.
 */
export const PRESCRIPTION: PrescriptionEntry[] = [
  { name: 'Tretinoin', aliases: ['tretinoin', 'all-trans retinoic acid'], family: 'Retinoid' },
  { name: 'Adapalene', aliases: ['adapalene'], family: 'Retinoid' },
  { name: 'Tazarotene', aliases: ['tazarotene', 'tazarotone'], family: 'Retinoid' },
  { name: 'Trifarotene', aliases: ['trifarotene'], family: 'Retinoid' },
  { name: 'Isotretinoin', aliases: ['isotretinoin'], family: 'Oral retinoid' },
  { name: 'Hydroquinone', aliases: ['hydroquinone', 'monobenzone', 'mequinol'], family: 'Depigmenting' },
  { name: 'Minoxidil', aliases: ['minoxidil'], family: 'Hair growth' },
  { name: 'Spironolactone', aliases: ['spironolactone'], family: 'Hormonal' },
  { name: 'Doxycycline', aliases: ['doxycycline', 'minocycline', 'sarecycline', 'tetracycline'], family: 'Oral antibiotic' },
  { name: 'Clindamycin', aliases: ['clindamycin', 'erythromycin', 'dapsone', 'metronidazole', 'ivermectin', 'sulfacetamide', 'sodium sulfacetamide'], family: 'Antibiotic' },
  { name: 'Bimatoprost', aliases: ['bimatoprost', 'latanoprost', 'travoprost', 'tafluprost'], family: 'Prostaglandin analogue' },
  { name: 'Finasteride', aliases: ['finasteride', 'dutasteride'], family: '5-alpha reductase inhibitor' },
  { name: 'Clobetasol', aliases: ['clobetasol', 'mometasone', 'fluocinolone acetonide', 'triamcinolone', 'betamethasone', 'halcinonide', 'desonide'], family: 'Topical steroid' },
  { name: 'Tacrolimus', aliases: ['tacrolimus', 'pimecrolimus', 'ruxolitinib', 'crisaborole'], family: 'Anti-inflammatory' },
  { name: 'Hydrocortisone ester', aliases: ['hydrocortisone butyrate', 'hydrocortisone valerate', 'hydrocortisone propionate'], family: 'Topical steroid' }
];

/**
 * The whole behaviour of the prescription set: name it, say this app gives none
 * of it, point at the prescriber. No number, no unit, no percentage, no
 * frequency, no verb that tells anyone what to put where.
 */
export function prescriptionLine(name: string): string {
  return `${name} is prescription-level. Glow Lab does not state a strength, a frequency or a method for it — that belongs to whoever prescribes it. Ask them, and bring the label from the bottle.`;
}

/* ------------------------------------------------------------ text scanning */

const ALIAS_INDEX: { alias: string; entry: ActiveEntry }[] = ACTIVES.flatMap((entry) =>
  entry.aliases.map((alias) => ({ alias: alias.toLowerCase(), entry }))
).sort((a, b) => b.alias.length - a.alias.length);

const PRESCRIPTION_INDEX: { alias: string; entry: PrescriptionEntry }[] = PRESCRIPTION.flatMap((entry) =>
  entry.aliases.map((alias) => ({ alias: alias.toLowerCase(), entry }))
).sort((a, b) => b.alias.length - a.alias.length);

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalise = (text: string) => ` ${text.toLowerCase().replace(/[\u2013\u2014]/g, '-').replace(/\s+/g, ' ')} `;

/**
 * Word-boundary scan of typed INCI text.
 *
 * Longest alias wins and its span is then blanked out, so "3-O-Ethyl Ascorbic
 * Acid" is read as a derivative and never miscounted as pure L-ascorbic acid,
 * while "salicylic" still matches inside a longer name such as "Capryloyl
 * Salicylic Acid". "Glycol" alone never fires the AHA entry. Empty or
 * unrecognised text returns an empty array: no fallback, no guess, no invented
 * family.
 */
export function scanIngredients(text: string): ActiveMatch[] {
  if (!text || !text.trim()) return [];
  let work = normalise(text);
  const found = new Map<string, { entry: ActiveEntry; aliases: string[] }>();
  for (const { alias, entry } of ALIAS_INDEX) {
    const re = new RegExp(`(?<![a-z0-9])${escapeRe(alias)}(?![a-z0-9])`, 'g');
    if (!re.test(work)) continue;
    const bucket = found.get(entry.key) ?? { entry, aliases: [] };
    bucket.aliases.push(alias);
    found.set(entry.key, bucket);
    work = work.replace(re, ' '.repeat(alias.length));
  }
  return [...found.values()].map(({ entry, aliases }) => toMatch(entry, [...new Set(aliases)].sort()));
}

/** Prescription names found in typed text. Emits a referral line and nothing else. */
export function scanPrescriptions(text: string): { name: string; family: string; line: string }[] {
  if (!text || !text.trim()) return [];
  const work = normalise(text);
  const out: { name: string; family: string; line: string }[] = [];
  const seen = new Set<string>();
  for (const { alias, entry } of PRESCRIPTION_INDEX) {
    if (seen.has(entry.name)) continue;
    if (new RegExp(`(?<![a-z0-9])${escapeRe(alias)}(?![a-z0-9])`).test(work)) {
      seen.add(entry.name);
      out.push({ name: entry.name, family: entry.family, line: prescriptionLine(entry.name) });
    }
  }
  return out;
}

function toMatch(entry: ActiveEntry, aliases: string[]): ActiveMatch {
  return {
    key: entry.key,
    label: entry.label,
    family: entry.family,
    roles: entry.roles,
    evidence: entry.evidence,
    why: entry.why,
    aliases,
    sunSensitivity: entry.sunSensitivity,
    irritant: entry.irritant,
    bleachesFabric: entry.bleachesFabric
  };
}

/* ------------------------------------------------------------- layer groups */

const GROUP_HINTS: { group: LayerGroup; words: string[] }[] = [
  { group: 'sunscreen', words: ['sunscreen', 'suncream', 'sun stick', 'spf', 'uv fluid', 'day fluid'] },
  { group: 'cleanse', words: ['cleanse', 'cleanser', 'cleansing', 'face wash', 'wash', 'co-wash', 'micellar'] },
  { group: 'occlusive', words: ['petrolatum', 'occlusive', 'slugging', 'sleeping mask', 'overnight mask', 'lanolin'] },
  { group: 'oil', words: ['facial oil', 'face oil', 'squalane', 'jojoba', 'rosehip', 'argan', 'marula'] },
  { group: 'tone', words: ['toner', 'essence', 'mist', 'face water', 'lotion'] },
  { group: 'serum', words: ['serum', 'ampoule', 'booster', 'concentrate'] },
  { group: 'moisturise', words: ['moisturiser', 'moisturizer', 'cream', 'gel', 'fluid', 'emulsion', 'milk', 'eye cream'] },
  { group: 'active', words: ['exfoliant', 'peeling', 'peel', 'treatment', 'spot', 'mask'] }
];

/** Roles that make a step the active layer of its routine, whatever it is called. */
const ACTIVE_ROLES: ActiveRole[] = ['retinoid', 'strong-exfoliant', 'mild-exfoliant', 'benzoyl-peroxide', 'ascorbic-acid', 'tone'];
/** Roles that sit in a thin serum layer, under the actives. */
const SERUM_ROLES: ActiveRole[] = ['antioxidant', 'peptide', 'barrier', 'retinoid-like'];

const FORM_GROUPS: Record<string, LayerGroup> = {
  cleanser: 'cleanse',
  'oil cleanser': 'cleanse',
  toner: 'tone',
  essence: 'tone',
  mist: 'tone',
  serum: 'serum',
  ampoule: 'serum',
  exfoliant: 'active',
  treatment: 'active',
  moisturiser: 'moisturise',
  moisturizer: 'moisturise',
  cream: 'moisturise',
  lotion: 'moisturise',
  gel: 'moisturise',
  oil: 'oil',
  'face oil': 'oil',
  balm: 'occlusive',
  sunscreen: 'sunscreen',
  spf: 'sunscreen'
};

/**
 * Which layer a step belongs to. Physical position wins first (a salicylic
 * cleanser is still the first step; an occlusive is still the last), then what
 * the ingredients actually are, then what the product is called.
 */
function groupFor(label: string, detail: string, product: ProductRow | undefined, matches: ActiveMatch[]): LayerGroup {
  if (matches.some((m) => m.roles.includes('sunscreen'))) return 'sunscreen';
  const hay = `${label} ${detail} ${product ? `${product.name} ${product.category} ${product.form}` : ''}`.toLowerCase();
  const form = String(product?.form ?? '').toLowerCase().trim();
  const hinted = (form && FORM_GROUPS[form]) || GROUP_HINTS.find((h) => h.words.some((w) => hay.includes(w)))?.group;
  // rinse-off, sealing and oiling layers keep their position whatever is in them
  if (hinted === 'cleanse' || hinted === 'occlusive' || hinted === 'oil') return hinted;
  const has = (roles: ActiveRole[]) => matches.some((m) => m.roles.some((r) => roles.includes(r)));
  if (has(ACTIVE_ROLES)) return 'active';
  if (has(SERUM_ROLES)) return 'serum';
  if (hinted) return hinted;
  return 'unplaced';
}

/* ---------------------------------------------------------------- conflicts */

const RULE_PAIRS: { a: ActiveRole; b: ActiveRole; rule: ConflictRule }[] = [
  { a: 'retinoid', b: 'strong-exfoliant', rule: 'retinoid-strong-acid' },
  { a: 'retinoid', b: 'benzoyl-peroxide', rule: 'retinoid-benzoyl-peroxide' },
  { a: 'ascorbic-acid', b: 'retinoid', rule: 'ascorbic-acid-retinoid' },
  { a: 'ascorbic-acid', b: 'strong-exfoliant', rule: 'ascorbic-acid-strong-acid' },
  { a: 'strong-exfoliant', b: 'strong-exfoliant', rule: 'exfoliant-stack' }
];

const CONFLICT_COPY: Record<ConflictRule, (a: string, b: string) => Pick<RoutineConflict, 'text' | 'basis' | 'when'>> = {
  'exfoliant-stack': (a, b) => ({
    basis: 'established',
    when: 'one night',
    text: `${a} and ${b} are both exfoliating acids. One exfoliant in a night is the version people tolerate. Stacked, they damage the barrier, and a damaged barrier looks worse than the thing you were treating.`
  }),
  'retinoid-strong-acid': (a, b) => ({
    basis: 'established',
    when: 'one night',
    text: `${a} carries a retinoid and ${b} carries an exfoliating acid. Put them on different nights, or one at each end of the day. Together they mostly produce irritation, and irritation is why people give up on retinoids.`
  }),
  'retinoid-benzoyl-peroxide': (a, b) => ({
    basis: 'established',
    when: 'same application',
    text: `${a} carries a retinoid and ${b} is benzoyl peroxide. Peroxide oxidises retinoid on contact, so layered together you get the sting of both and the benefit of neither. Split them across the day.`
  }),
  'ascorbic-acid-retinoid': (a, b) => ({
    basis: 'conservative',
    when: 'different times of day',
    text: `${a} is pure L-ascorbic acid and ${b} carries a retinoid. Both want a low-pH, tingly application, so they are usually kept apart — the acid in the morning, the retinoid at night.`
  }),
  'ascorbic-acid-strong-acid': (a, b) => ({
    basis: 'conservative',
    when: 'one night',
    text: `${a} is pure L-ascorbic acid and ${b} carries an exfoliating acid. Two low-pH layers in one night is a stinging recipe with no extra benefit attached. Pick one.`
  })
};

/* ------------------------------------------------------------------ analysis */

export interface AnalyseOptions {
  /** ISO date, injected for testability; defaults to the device date */
  today?: string;
  windowDays?: number;
}

const isoToday = () => new Date().toISOString().slice(0, 10);
const daySpan = (from: string, to: string) => Math.round((new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86400000);

/**
 * The nightly instruction, built only from the rows supplied.
 *
 * Steps with no linked product, or with an untranscribed INCI list, contribute
 * no claim; they are counted and reported as unread instead.
 */
export function analyseRoutine(steps: RoutineStep[], products: ProductRow[], opts: AnalyseOptions = {}): RoutineAnalysis {
  const windowDays = opts.windowDays ?? INTRO_WINDOW_DAYS;
  const day = opts.today ?? isoToday();
  const byId = new Map(products.map((p) => [String(p.id), p]));
  const ordered = [...steps].sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0));

  const stepScans: StepScan[] = ordered.map((s, i) => {
    const stepId = String(s.id ?? `step-${i}`);
    const label = String(s.label ?? '').trim() || 'Untitled step';
    const detail = String(s.detail ?? '');
    const product = s.productId ? byId.get(String(s.productId)) : undefined;
    const ingredientText = product ? String(product.ingredients ?? '') : '';
    const fromProduct = scanIngredients(ingredientText);
    const fromStepText = ingredientText.trim() ? [] : scanIngredients(`${label} ${detail}`);
    const matches = [...fromProduct, ...fromStepText];
    // "readable" means there was an ingredient list to read, not that a family
    // was found in it. A list that matches nothing is still a list you wrote.
    const source: StepScan['source'] = ingredientText.trim() ? 'linked product' : matches.length ? 'typed in the step' : 'nothing to read';
    return {
      stepId,
      order: Number(s.order ?? i + 1),
      label,
      productId: s.productId ? String(s.productId) : null,
      productName: product ? String(product.name ?? '') : '',
      group: groupFor(label, detail, product, matches),
      readable: source !== 'nothing to read',
      source,
      matches
    };
  });

  const actives = dedupeMatches(stepScans.flatMap((s) => s.matches));
  const conflicts = buildConflicts(stepScans);
  const layering: { am: LayerItem[]; pm: LayerItem[] } = { am: orderFor('am', stepScans), pm: orderFor('pm', stepScans) };

  /* which linked products are actually new — only if your rows say so */
  const linkedProducts = stepScans
    .filter((s) => s.productId)
    .map((s) => byId.get(String(s.productId)))
    .filter((p): p is ProductRow => Boolean(p));
  const freshness = newActivesSince(linkedProducts, windowDays, day);
  const activeProductIds = new Set(stepScans.filter((s) => s.matches.length && s.productId).map((s) => String(s.productId)));
  const freshActives = freshness.hits.filter((h) => activeProductIds.has(h.productId));

  const notes: RoutineNote[] = [];

  const sunHits = actives.filter((a) => a.sunSensitivity);
  const hasSunscreen = stepScans.some((s) => s.matches.some((m) => m.roles.includes('sunscreen')));
  if (sunHits.length) {
    notes.push({
      key: 'sun',
      text: `${sunHits.map((s) => s.label).join(' and ')} make skin react more easily to sun. Daytime broad-spectrum SPF is part of this routine, not an optional extra — no order below is worth anything if the morning step is skipped.`
    });
    if (!hasSunscreen) {
      notes.push({ key: 'sun', text: 'None of these steps reads as a sunscreen. That gap sits in the morning routine, and it is the one layer that protects everything the rest of this list is chasing.' });
    }
  }

  const bleach = actives.find((a) => a.bleachesFabric);
  if (bleach) {
    notes.push({ key: 'bleach', text: `${bleach.label} bleaches fabric, and permanently on coloured towels, pillowcases and clothing. Dark or spare linen at night, and give it time to dry before you lie down.` });
  }

  const activeFamilies = [...new Set(actives.filter((a) => !a.roles.includes('sunscreen') && !a.roles.includes('barrier')).map((a) => a.family))];
  if (activeFamilies.length > 1) {
    notes.push({
      key: 'one-at-a-time',
      text: freshness.computable
        ? freshActives.length > 1
          ? `${freshActives.length} of the products here were opened within the last ${Math.round(windowDays / 7)} weeks — ${freshActives.map((f) => f.name).join(', ')}. One new active at a time, ${INTRO_WINDOW_TEXT} apart. When two start together, nothing you notice afterwards can be credited to either of them.`
          : `${activeFamilies.length} active families are in this routine, and ${freshActives.length ? `${freshActives.map((f) => f.name).join(', ')} looks like the newest of them` : 'your open dates say none of them is recent'}. New actives go in one at a time, ${INTRO_WINDOW_TEXT} apart, so the record says something later.`
        : `${activeFamilies.length} active families sit in this routine and none of the linked products has an open date, so this app cannot tell which of them is new. One new active at a time, ${INTRO_WINDOW_TEXT} apart, is what makes the record readable afterwards.`
    });
  }

  const irritants = actives.filter((a) => a.irritant);
  if (irritants.length && (freshActives.length || !freshness.computable)) {
    notes.push({
      key: 'patch-test',
      text: `${irritants.map((i) => i.label).join(', ')} are the ones that bite.${freshActives.length ? ` Newest here: ${freshActives.map((f) => f.name).join(', ')}.` : ''} Patch-test a new one — a small area, several days, everything else unchanged — before it goes near the face.${
        freshness.computable ? '' : ' Open dates are missing, so which product is new is not something this app can see.'
      }`
    });
  }

  const unreadSteps = stepScans.filter((s) => !s.readable).length;
  if (unreadSteps) {
    notes.push({
      key: 'unread',
      text: `${unreadSteps} step${unreadSteps === 1 ? '' : 's'} in this routine gave the check nothing to read — no linked product, or no ingredient list transcribed on it. That is a gap in the record, not a clean result.${actives.length ? ' Everything below covers only the steps it could read.' : ' Nothing below is an all-clear.'}`
    });
  }

  /* prescriptions: referral only */
  const hits: PrescriptionHit[] = [];
  for (const s of stepScans) {
    const product = s.productId ? byId.get(String(s.productId)) : undefined;
    const text = `${product ? String(product.ingredients ?? '') : ''} ${s.label}`;
    for (const hit of scanPrescriptions(text)) {
      if (hits.some((h) => h.name === hit.name)) continue;
      hits.push({ ...hit, stepId: s.stepId, stepLabel: s.label, productName: product ? String(product.name ?? '') : s.label });
    }
  }

  const limits = actives.length ? [...HONESTY_LIMITS] : ['Nothing in these steps matched the actives list. That is not an all-clear — it means no family was recognised in the words available.', ...HONESTY_LIMITS];

  return {
    actives,
    conflicts,
    layering,
    notes,
    prescriptions: hits,
    stepScans,
    limits,
    readSteps: stepScans.filter((s) => s.readable).length,
    unreadSteps
  };
}

function buildConflicts(stepScans: StepScan[]): RoutineConflict[] {
  const named = (s: StepScan) => (s.productName && s.productName !== s.label ? `“${s.label}” (${s.productName})` : `“${s.label}”`);
  const out: RoutineConflict[] = [];
  const seen = new Set<string>();
  const push = (rule: ConflictRule, a: StepScan, ma: ActiveMatch, b: StepScan, mb: ActiveMatch) => {
    const key = `${rule}|${[a.stepId, b.stepId].sort().join()}|${[ma.key, mb.key].sort().join()}`;
    if (seen.has(key)) return;
    seen.add(key);
    const copy = CONFLICT_COPY[rule](named(a), named(b));
    out.push({ id: key, rule, ...copy, a: { stepId: a.stepId, label: a.label }, b: { stepId: b.stepId, label: b.label }, families: [ma.label, mb.label] });
  };

  const reading = stepScans.filter((s) => s.matches.length);
  for (let i = 0; i < reading.length; i += 1) {
    for (let j = i; j < reading.length; j += 1) {
      const a = reading[i];
      const b = reading[j];
      if (a === b) {
        // two families inside one step: that is a same-application question.
        // Two exfoliants inside one product is a normal combined formula, not a
        // stacking error, so exfoliant-stack is deliberately not paired there.
        for (const pair of RULE_PAIRS) {
          if (pair.rule === 'exfoliant-stack') continue;
          for (const ma of a.matches.filter((m) => m.roles.includes(pair.a))) {
            for (const mb of a.matches.filter((m) => m.roles.includes(pair.b))) {
              if (ma === mb) continue;
              push(pair.rule, a, ma, b, mb);
              push(pair.rule, b, mb, a, ma);
            }
          }
        }
        continue;
      }
      for (const pair of RULE_PAIRS) {
        // order in the routine must not decide who is "a" and who is "b"
        for (const [x, y] of [[a, b], [b, a]] as [StepScan, StepScan][]) {
          const as = x.matches.filter((m) => m.roles.includes(pair.a));
          const bs = y.matches.filter((m) => m.roles.includes(pair.b));
          for (const ma of as) for (const mb of bs) push(pair.rule, x, ma, y, mb);
        }
      }
    }
  }
  return out.sort((x, y) => (x.basis === y.basis ? 0 : x.basis === 'established' ? -1 : 1));
}

/* ----------------------------------------------------------------- ordering */

const groupRank = (g: LayerGroup) => LAYER_ORDER.indexOf(g);

function orderFor(which: 'am' | 'pm', stepScans: StepScan[]): LayerItem[] {
  const items: { item: LayerItem; seq: number }[] = [];
  stepScans.forEach((s, seq) => {
    if (s.group === 'sunscreen' && which !== 'am') return;
    const entryTimes = s.matches.map((m) => ACTIVES.find((a) => a.key === m.key)?.timeOfDay ?? 'either');
    // A night-only active is not in the morning order at all. A morning-active
    // still appears in the evening order — it is not wrong at night, just less
    // usual — so nothing is silently dropped from the list the user reads.
    if (which === 'am' && entryTimes.length && entryTimes.every((t) => t === 'pm')) return;
    items.push({
      seq,
      item: {
        stepId: s.stepId,
        label: s.label,
        productId: s.productId,
        productName: s.productName,
        group: s.group,
        groupLabel: LAYER_LABEL[s.group],
        families: [...new Set(s.matches.map((m) => m.family))],
        note: layerNote(which, s)
      }
    });
  });
  return items
    .sort((x, y) => groupRank(x.item.group) - groupRank(y.item.group) || weight(x.item, which) - weight(y.item, which) || x.seq - y.seq)
    .map(({ item }) => item);
}

/** Inside one group: thin and antioxidant first, exfoliants next, retinoid last at night. */
function weight(item: LayerItem, which: 'am' | 'pm') {
  if (item.group === 'serum') return /Antioxidant|Barrier|Peptide/.test(item.families.join(',')) ? 0 : 1;
  if (item.group === 'active') return which === 'pm' ? (/Retinoid/.test(item.families.join(',')) ? 2 : 1) : 0;
  if (item.group === 'unplaced') return 0;
  return 0;
}

function layerNote(which: 'am' | 'pm', s: StepScan): string {
  if (s.group === 'sunscreen') return 'Last layer in the morning, over everything else.';
  if (s.group === 'occlusive') return 'Sits on top of everything, so anything you want absorbed goes first.';
  if (s.group === 'oil') return 'Oil seals the layer underneath in — it comes after water-based ones.';
  if (s.group === 'cleanse') return 'First, on skin that has nothing else on it.';
  if (s.matches.some((m) => m.roles.includes('retinoid'))) return which === 'pm' ? 'Night, onto dry skin.' : 'A night step, so it is not in the morning order.';
  if (s.matches.some((m) => m.roles.includes('strong-exfoliant'))) return which === 'pm' ? 'A night of its own — not on top of a retinoid.' : 'Usually a night step.';
  if (which === 'pm' && s.matches.some((m) => m.roles.includes('ascorbic-acid') || m.roles.includes('antioxidant'))) return 'Usually a morning layer. It is not wrong at night — the morning is just where it earns its place.';
  if (s.group === 'unplaced') return 'This app could not work out what this one is, so it stays where you put it.';
  if (which === 'pm' && s.group === 'moisturise' && LAYER_ORDER.indexOf('moisturise') > LAYER_ORDER.indexOf('active')) return 'Over the actives — the layer that makes them tolerable.';
  return 'Thin layer, then the next one over the top.';
}

/* ------------------------------------------------------------ new actives */

export interface NewActiveHit {
  productId: string;
  name: string;
  openedOn: string;
  daysSince: number;
  keys: string[];
}

export interface NewActiveReport {
  /** false when not one product carries an open date — then the claim is dropped */
  computable: boolean;
  windowDays: number;
  dated: number;
  hits: NewActiveHit[];
}

/** Which linked products were opened inside the attribution window, from your own open dates. */
export function newActivesSince(products: ProductRow[], windowDays = INTRO_WINDOW_DAYS, day = isoToday()): NewActiveReport {
  const dated = products.filter((p) => p.openedOn);
  const hits: NewActiveHit[] = [];
  for (const p of dated) {
    const days = daySpan(String(p.openedOn), day);
    if (days < 0 || days > windowDays) continue;
    const keys = scanIngredients(String(p.ingredients ?? '')).filter((m) => m.irritant || m.roles.includes('strong-exfoliant'));
    if (!keys.length) continue;
    hits.push({ productId: String(p.id), name: String(p.name ?? 'unnamed product'), openedOn: String(p.openedOn), daysSince: days, keys: keys.map((k) => k.key) });
  }
  return { computable: dated.length > 0, windowDays, dated: dated.length, hits };
}

/* ------------------------------------------------------------------- helpers */

function dedupeMatches(list: ActiveMatch[]): ActiveMatch[] {
  const out: ActiveMatch[] = [];
  for (const m of list) if (!out.some((x) => x.key === m.key)) out.push(m);
  return out;
}

/**
 * The suggested sequence for a routine's own time of day, followed by any step
 * the check could not place. Same steps, same count, same content — only the
 * `order` value differs, and only if the caller writes it back.
 */
export function applyOrder(steps: RoutineStep[], suggested: LayerItem[]): RoutineStep[] {
  const ordered = [...steps].sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0));
  const head = suggested
    .map((item) => ordered.find((s) => String(s.id ?? '') === item.stepId))
    .filter((s): s is RoutineStep => Boolean(s));
  const tail = ordered.filter((s) => !head.includes(s));
  return [...head, ...tail].map((s, i) => ({ ...s, order: i + 1 }));
}

/** Morning routines read the AM order; everything else reads the PM order. */
export const isMorning = (timeOfDay: string) => timeOfDay.toLowerCase().trim() === 'morning';
