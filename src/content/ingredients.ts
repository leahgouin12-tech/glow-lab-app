import type { EvidenceGrade } from '../db/schema';

export interface IngredientRef {
  slug: string;
  name: string;
  family: string[];
  purpose: string;
  evidence: string;
  evidenceGrade: EvidenceGrade;
  combine: string;
  cautions: string[];
  introduce: string;
  professional: string;
}

/**
 * Ingredient reference (Part 12). Written as general education: what the
 * ingredient is used for, how strong the evidence is, and where a professional
 * is needed. No diagnosis, no prescription, no brand claims.
 */
export const INGREDIENT_REFERENCE: IngredientRef[] = [
  {
    slug: 'sunscreen',
    name: 'Broad-spectrum sunscreen (SPF 30+)',
    family: ['photoprotection'],
    purpose: 'Reduces ultraviolet damage that drives pigmentation change and textural ageing over time.',
    evidence:
      'The best-supported step in any daily routine. Randomised and cohort studies link regular broad-spectrum use with less photoageing and lower risk of keratinocyte skin cancers.',
    evidenceGrade: 'strong',
    combine: 'Last step of a morning routine, before makeup. Reapplication matters more than the number on the bottle.',
    cautions: ['Texture and white cast drive abandonment — a formula you actually wear beats a higher number you skip.'],
    introduce: 'Daily, morning. Two finger-lengths for face and neck.',
    professional: 'Persistent irritation, or any lesion changing in colour, shape or bleeding — assessed by a dermatologist, not tracked here.'
  },
  {
    slug: 'retinoid',
    name: 'Retinoids (retinol, adapalene, prescription retinoids)',
    family: ['cell turnover', 'collagen'],
    purpose: 'Speeds turnover, is used for congestion and texture, and has the most evidence for fine-line change.',
    evidence:
      'Strong for prescription retinoids; moderate for over-the-counter retinol at the concentrations and durations usually studied.',
    evidenceGrade: 'strong',
    combine: 'Do not stack with acids on the same night at first. Buffer over moisturiser if irritated.',
    cautions: ['Dryness and purging in weeks 2–6', 'Sun sensitivity', 'Not used during pregnancy — medical decision, not an app decision'],
    introduce: 'Pea-size, dry skin, 2 nights a week, increasing over 6–8 weeks.',
    professional: 'Prescription strengths require a prescriber. Irruption that persists past 8 weeks is a review point.'
  },
  {
    slug: 'niacinamide',
    name: 'Niacinamide (vitamin B3)',
    family: ['barrier', 'pigmentation'],
    purpose: 'Supports barrier function; some evidence for a modest effect on uneven tone and oiliness.',
    evidence: 'Moderate. Small trials, mostly at 4–5%, with effects appearing around 8–12 weeks.',
    evidenceGrade: 'moderate',
    combine: 'Tolerated with almost everything; a sensible first addition while a routine settles.',
    cautions: ['High percentages (10%+) cause flushing and stinging in some people — the 4% studied is not the 10% marketed.'],
    introduce: 'Once daily, patch-test 48 hours before full-face use.',
    professional: 'Persistent stinging or rash.'
  },
  {
    slug: 'ascorbic-acid',
    name: 'L-ascorbic acid (vitamin C)',
    family: ['antioxidant', 'brightening'],
    purpose: 'Antioxidant; used for dullness and uneven tone.',
    evidence: 'Moderate. Formulation and pH decide a lot, and most studies use specific stabilised systems.',
    evidenceGrade: 'moderate',
    combine: 'Morning, under sunscreen. Oxidises on light and heat — storage matters.',
    cautions: ['Stinging on compromised skin', 'Oxidised serum turns brown and is largely inert'],
    introduce: 'Every other morning, then daily if tolerated.',
    professional: 'Any lesion or pigment change you cannot explain — an in-person assessment is the answer.'
  },
  {
    slug: 'aha',
    name: 'Alpha hydroxy acids (glycolic, lactic)',
    family: ['exfoliation'],
    purpose: 'Removes surface cohesion, used for texture and dullness.',
    evidence: 'Moderate for cosmetic texture improvement at the concentrations and frequencies studied.',
    evidenceGrade: 'moderate',
    combine: 'Not on the same night as a retinoid when starting. Always paired with daytime sunscreen.',
    cautions: ['Over-use is the main cause of acid-related damage — daily strong exfoliation is not the protocol studied'],
    introduce: 'Once weekly, evening, increasing to 2–3× only if the skin settles.',
    professional: 'Broken barrier (stinging with plain water), or any chemical burn.'
  },
  {
    slug: 'bha',
    name: 'Salicylic acid (BHA)',
    family: ['exfoliation', 'congestion'],
    purpose: 'Oil-soluble exfoliant used for congestion.',
    evidence: 'Moderate; long-standing cosmetic use with reasonable supporting data at 0.5–2%.',
    evidenceGrade: 'moderate',
    combine: 'One exfoliant per routine. Spot-only use is often enough.',
    cautions: ['Drying beyond the target area'],
    introduce: '2–3 nights weekly on affected areas.',
    professional: 'Cystic or painful lesions, or scarring — those need treatment, not tracking.'
  },
  {
    slug: 'ceramides',
    name: 'Ceramides and barrier blends',
    family: ['barrier', 'moisturising'],
    purpose: 'Replace lipids in the surface barrier; reduce transepidermal water loss.',
    evidence: 'Moderate. Measurable barrier improvement; perceived "repair" claims are broader than the data.',
    evidenceGrade: 'moderate',
    combine: 'Works at any point in a routine; usually the last step before sunscreen.',
    cautions: [],
    introduce: 'Daily, indefinitely — this one has no ramp-up.',
    professional: 'Eczema or suspected dermatitis: a diagnosis belongs to a clinician.'
  },
  {
    slug: 'azelaic',
    name: 'Azelaic acid',
    family: ['tone', 'congestion'],
    purpose: 'Used for redness-prone and congested skin.',
    evidence: 'Moderate to strong at prescription strengths; limited for cosmetic percentages.',
    evidenceGrade: 'moderate',
    combine: 'Can be used morning or evening; separates well from other actives.',
    cautions: ['Temporary itching at introduction'],
    introduce: 'Every other evening, building up.',
    professional: 'Prescription strengths require a prescriber.'
  },
  {
    slug: 'benzoyl-peroxide',
    name: 'Benzoyl peroxide',
    family: ['congestion'],
    purpose: 'Antimicrobial used for congestion.',
    evidence: 'Strong for short-term acne management as a documented OTC active.',
    evidenceGrade: 'strong',
    combine: 'Bleaches fabrics. Not layered with retinoids at the same time of day.',
    cautions: ['Irritation is dose-dependent; 2.5% is usually as effective as higher strengths with less irritation'],
    introduce: 'Short-contact application in the evening, 2–3× weekly.',
    professional: 'When OTC management is not enough after 8–12 weeks — that is a clinician conversation.'
  },
  {
    slug: 'hydroquinone',
    name: 'Hydroquinone and "brightening" claims',
    family: ['pigmentation'],
    purpose: 'Inhibits melanin production; used for hyperpigmentation.',
    evidence: 'Effective but regulated. In many jurisdictions it is prescription-only or banned in cosmetics.',
    evidenceGrade: 'professional',
    combine: 'Only ever as a directed, time-limited course.',
    cautions: ['Prolonged unsupervised use risks exogenous ochronosis', 'Not an everyday cosmetic'],
    introduce: 'Not introduced from an app recommendation.',
    professional: 'Any pigment change worth treating should be diagnosed first.'
  }
];
