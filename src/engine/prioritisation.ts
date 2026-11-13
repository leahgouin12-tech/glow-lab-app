import type { AnyRow, EvidenceGrade, ImprovementOption, TechniqueRow } from '../db/schema';

/**
 * Cost-benefit prioritisation engine (spec Part 5.3).
 *
 * Ranking rules that encode the product policy, not just arithmetic:
 *  - evidence quality multiplies impact, it does not merely add;
 *  - cost is penalised hardest for low-evidence options, so expensive
 *    speculative procedures cannot climb the list (Part 5.3 / Part 35);
 *  - 'unsafe' practices are never ranked — they are returned separately as
 *    refusal entries;
 *  - user preference can lift an option but cannot lift an unsafe one.
 */

export const EVIDENCE_WEIGHT: Record<EvidenceGrade, number> = {
  strong: 1,
  moderate: 0.78,
  professional: 0.62,
  emerging: 0.4,
  limited: 0.36,
  traditional: 0.42,
  cosmetic: 0.55,
  weak: 0.16,
  unsupported: 0.05,
  dangerous: 0
};

export const COST_PENALTY: Record<ImprovementOption['costBand'], number> = {
  free: 0,
  low: 0.06,
  mid: 0.16,
  high: 0.32,
  professional: 0.42
};

export const REVERSIBILITY_BONUS = [0, 0.04, 0.09, 0.13, 0.17];
export const RISK_PENALTY = [0, 0.06, 0.16, 0.32, 0.55];

export interface ScoredOption extends ImprovementOption {
  score: number;
  band: Band;
  bandReason: string;
  components: { label: string; value: number }[];
}

export type Band = 'quick-win' | 'worthwhile' | 'consider' | 'hold' | 'avoid';

export const BAND_LABEL: Record<Band, string> = {
  'quick-win': 'Quick win',
  worthwhile: 'Worthwhile',
  consider: 'Consider carefully',
  hold: 'Hold off',
  avoid: 'Not recommended'
};

export const BAND_NOTE: Record<Band, string> = {
  'quick-win': 'Low cost, strong evidence, fast to try. Start here.',
  worthwhile: 'Real benefit for a real commitment. Schedule it.',
  consider: 'Plausible but slower, pricier, or less certain than it looks.',
  hold: 'Evidence or downside does not justify the effort right now.',
  avoid: 'Documented harm without supporting evidence. Not a suggestion.'
};

const clampBand = (n: number) => Math.max(0, Math.min(4, Math.round(Number(n) || 0)));

/** 0..1 normalisation helpers accept whatever scale the user's data uses. */
const norm = (n: number, max = 10) => Math.max(0, Math.min(1, (Number(n) || 0) / max));

export function scoreOption(o: ImprovementOption, opts: { preference?: number; budgetSensitivity?: number } = {}): ScoredOption {
  const impact = norm(o.impact, 10);
  const effort = norm(o.effort, 10);
  const evidence = EVIDENCE_WEIGHT[o.evidence] ?? 0.3;
  const cost = COST_PENALTY[o.costBand] ?? 0.2;
  const weeks = Math.max(0, Math.min(1, (Number(o.weeksToSee) || 0) / 26));
  const reversibility = REVERSIBILITY_BONUS[clampBand(o.reversibility)];
  const risk = RISK_PENALTY[clampBand(o.risk)];
  const preference = Math.max(0, Math.min(0.14, (opts.preference ?? 0) * 0.14));
  // Expensive + weakly evidenced = disqualified, hard.
  const speculationPenalty = cost * (1 - evidence) * (2 + (opts.budgetSensitivity ?? 0));

  const score = Math.max(
    0,
    Math.min(1, impact * evidence * 0.62 + reversibility + preference - effort * 0.14 - weeks * 0.12 - risk * 0.34 - speculationPenalty * 0.3)
  );

  // bandFor works on the 0..100 scale the UI shows, not the 0..1 working value.
  const percent = Math.round(score * 100);
  const band = bandFor(percent, o);
  return {
    ...o,
    score: percent,
    band,
    bandReason: bandReason(o, band, { evidence, cost, effort, weeks }),
    components: [
      { label: 'Impact', value: Math.round(impact * 100) },
      { label: 'Evidence', value: Math.round(evidence * 100) },
      { label: 'Ease', value: Math.round((1 - effort) * 100) },
      { label: 'Speed', value: Math.round((1 - weeks) * 100) },
      { label: 'Reversible', value: Math.round(reversibility * 588) },
      { label: 'Risk', value: Math.round(risk * 100) },
      { label: 'Cost', value: Math.round(cost * 238) }
    ]
  };
}

function bandFor(score: number, o: ImprovementOption): Band {
  if (o.evidence === 'dangerous') return 'avoid';
  const cost = COST_PENALTY[o.costBand] ?? 0.2;
  if (score >= 52 && cost <= 0.16 && (EVIDENCE_WEIGHT[o.evidence] ?? 0) >= 0.55) return 'quick-win';
  if (score >= 42) return 'worthwhile';
  if (score >= 28) return 'consider';
  if (score >= 14) return 'hold';
  return 'avoid';
}

function bandReason(o: ImprovementOption, band: Band, f: { evidence: number; cost: number; effort: number; weeks: number }) {
  const ev = f.evidence >= 0.7 ? 'well-evidenced' : f.evidence >= 0.4 ? 'partly evidenced' : 'weakly evidenced';
  const cost = o.costBand === 'free' ? 'costs nothing' : f.cost >= 0.32 ? 'is a significant spend' : 'is modestly priced';
  const speed = f.weeks <= 0.15 ? 'shows quickly' : f.weeks >= 0.6 ? 'takes months to show' : 'takes a few weeks';
  switch (band) {
    case 'quick-win':
      return `${ev}, ${cost}, and ${speed}. Low downside.`;
    case 'worthwhile':
      return `${ev} and ${cost}, but ${o.effort >= 6 ? 'needs sustained effort' : speed === 'shows quickly' ? 'is easy to start' : 'needs patience'}.`;
    case 'consider':
      return `${ev}; ${cost} and ${speed}. Reasonable if you specifically want this.`;
    case 'hold':
      return `${ev}, ${cost}, and the expected change is small relative to the effort.`;
    case 'avoid':
      return o.evidence === 'dangerous'
        ? 'Flagged by the Glow Lab safety policy. Documented harm without supporting evidence.'
        : `${ev}, with downside that outweighs the plausible gain.`;
  }
}

export function rankOptions(options: ImprovementOption[], opts: { preference?: number; budgetSensitivity?: number } = {}) {
  const scored = options.map((o) => scoreOption(o, opts));
  const unsafe = scored.filter((o) => o.evidence === 'dangerous');
  const rankable = scored
    .filter((o) => o.evidence !== 'dangerous')
    .sort((a, b) => b.score - a.score || a.effort - b.effort);
  return { ranked: rankable, refused: unsafe };
}

/** Technique rows carry safety; use this before any recommendation is written. */
export function techniqueIsRecommendable(t: { safety?: unknown; evidence?: unknown } | AnyRow) {
  const row = t as { safety?: unknown; evidence?: unknown };
  return row.safety !== 'unsafe' && row.evidence !== 'dangerous' && row.evidence !== 'unsupported';
}

export function evidenceTone(e: EvidenceGrade): 'ok' | 'warn' | 'bad' | 'info' {
  if (e === 'strong') return 'ok';
  if (e === 'dangerous' || e === 'unsupported') return 'bad';
  if (e === 'weak' || e === 'limited' || e === 'emerging') return 'warn';
  return 'info';
}
