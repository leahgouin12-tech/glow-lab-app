import type { AnyRow, ImprovementOption } from '../db/schema';
import { TABLES } from '../db/schema';
import { findAll, put } from '../db/repo';
import { COST_PENALTY, EVIDENCE_WEIGHT, REVERSIBILITY_BONUS, rankOptions } from './prioritisation';
import type { AppSettings } from '../state/settings';

/**
 * Personal constraints (spec Part 11 / Part 26 feasibility layer).
 *
 * Pure functions over the user's own rows. Nothing here is a model: every rule
 * below is an arithmetic comparison against a field the user typed, and where
 * the record does not carry the field the rule needs, the reason string says so
 * and names the proxy it used instead. `local-rules` — no AI, no invented data.
 *
 * Hard policy: an option graded `dangerous` (or `unsupported`) can never be
 * placed in a plan phase. That is enforced by `isPhaseEligible()` at the gate
 * and re-checked by `assertNoRefusedInPlan()` on the finished phases, so a bug
 * in the ordering code cannot smuggle a refusal into advice.
 */

export type DowntimeTolerance = 'none' | 'a-day' | 'a-week' | 'open';

export interface PersonalConstraints {
  monthlyBudget: number;
  minutesPerDay: number;
  horizonWeeks: number;
  downtimeTolerance: DowntimeTolerance;
  /** free-text terms the user does not want proposed; matched against option text only */
  avoid: string[];
  notes: string;
}

/** The profile row that stores them. `kind` is outside the ProfileRow union, so
 *  writes cast — same convention ProfilePage.setField already uses. */
export const CONSTRAINTS_KIND = 'constraints';

export const HORIZON_CHOICES = [4, 8, 12, 24];

export const DOWNTIME_CHOICES: { value: DowntimeTolerance; label: string; note: string }[] = [
  { value: 'none', label: 'None', note: 'Nothing that takes you out of a day.' },
  { value: 'a-day', label: 'A day', note: 'A day away is acceptable.' },
  { value: 'a-week', label: 'A week', note: 'Up to a week of recovery or hiding it.' },
  { value: 'open', label: 'Open', note: 'Recovery time is not a limit for you.' }
];

/** Suggested terms for the intake. Plain words, matched against the user's own
 *  option text — they are not categories the engine recognises. */
export const AVOID_SUGGESTIONS = [
  'needles',
  'clinic visits',
  'prescription',
  'anything permanent',
  'multi-week downtime',
  'products I would have to buy',
  'daily commitment'
];

/**
 * Ordinal band widths — the same ladder the Command Center already publishes
 * ("Estimated band widths — bands, never invented currency"). These are
 * positions on the app's cost scale, not prices, and the reason strings say so.
 */
export const COST_BAND_WIDTH: Record<ImprovementOption['costBand'], number> = {
  free: 4,
  low: 18,
  mid: 42,
  high: 90,
  professional: 160
};

const COST_BAND_ORDER: ImprovementOption['costBand'][] = ['free', 'low', 'mid', 'high', 'professional'];

/**
 * Minutes-a-day inferred from the effort score the user entered.
 * There is no duration field on an improvement option, so this is a disclosed
 * proxy, not a measurement: effort 0..10 (their own number) -> minutes per day.
 */
export const EFFORT_MINUTES_PER_DAY = [0, 2, 3, 5, 8, 10, 14, 18, 22, 26, 30];

/** Downtime rank implied by the risk band the user entered (0..4). */
const RISK_TO_DOWNTIME_RANK = [0, 0, 1, 2, 3];
const DOWNTIME_RANK: Record<DowntimeTolerance, number> = { none: 0, 'a-day': 1, 'a-week': 2, open: 3 };

export type Cadence = 'daily' | 'weekly' | 'monthly' | 'once';

/**
 * Repeats the Command Center's own cadence rule so both places agree:
 * a professional-band or high-risk option is a one-off appointment, a free
 * low-effort option is a daily habit, a slow option is reviewed monthly.
 */
export function cadenceFor(o: ImprovementOption): Cadence {
  if (o.costBand === 'professional' || o.risk >= 3) return 'once';
  if (o.costBand === 'free' && o.effort <= 5) return 'daily';
  if (o.weeksToSee >= 12) return 'monthly';
  return 'weekly';
}

const clampInt = (n: unknown, min: number, max: number, fallback: number) => {
  const v = Number(n);
  if (!Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, Math.round(v)));
};

export const DEFAULT_CONSTRAINTS: PersonalConstraints = {
  monthlyBudget: 120,
  minutesPerDay: 15,
  horizonWeeks: 8,
  downtimeTolerance: 'a-day',
  avoid: [],
  notes: ''
};

/** Seed from live settings — only the budget exists there, the rest are defaults. */
export function defaultConstraints(settings: Pick<AppSettings, 'monthlyBudget'> | null | undefined): PersonalConstraints {
  const budget = settings && Number.isFinite(Number(settings.monthlyBudget)) ? clampInt(settings.monthlyBudget, 0, 100000, DEFAULT_CONSTRAINTS.monthlyBudget) : DEFAULT_CONSTRAINTS.monthlyBudget;
  return { ...DEFAULT_CONSTRAINTS, monthlyBudget: budget, avoid: [] };
}

function coerce(raw: Record<string, unknown>, seed: PersonalConstraints): PersonalConstraints {
  const downtime = String(raw.downtimeTolerance ?? seed.downtimeTolerance) as DowntimeTolerance;
  return {
    monthlyBudget: clampInt(raw.monthlyBudget, 0, 100000, seed.monthlyBudget),
    minutesPerDay: clampInt(raw.minutesPerDay, 0, 600, seed.minutesPerDay),
    horizonWeeks: clampInt(raw.horizonWeeks, 1, 104, seed.horizonWeeks),
    downtimeTolerance: DOWNTIME_RANK[downtime] === undefined ? seed.downtimeTolerance : downtime,
    avoid: Array.isArray(raw.avoid) ? (raw.avoid as unknown[]).map((x) => String(x).trim()).filter(Boolean) : [],
    notes: typeof raw.notes === 'string' ? raw.notes : ''
  };
}

/**
 * Read the saved constraints row; fall back to defaults seeded from settings.
 * Returns `saved: false` in the companion `hasSavedConstraints` so callers can
 * tell "the user said 15 minutes" apart from "the app assumed 15 minutes".
 */
export function readConstraints(profileRows: AnyRow[], settings: Pick<AppSettings, 'monthlyBudget'> | null | undefined): PersonalConstraints {
  const row = profileRows.find((r) => String(r.kind) === CONSTRAINTS_KIND && Number(r.singleton ?? 1) === 1);
  const seed = defaultConstraints(settings);
  if (!row) return seed;
  return coerce((row.data ?? {}) as Record<string, unknown>, seed);
}

export function hasSavedConstraints(profileRows: AnyRow[]): boolean {
  return profileRows.some((r) => String(r.kind) === CONSTRAINTS_KIND && Number(r.singleton ?? 1) === 1);
}

/** Write the singleton profile row through the repo, merging with what is stored. */
export async function saveConstraints(
  patch: Partial<PersonalConstraints>,
  settings?: Pick<AppSettings, 'monthlyBudget'>
): Promise<PersonalConstraints> {
  const rows = await findAll(TABLES.profile, { where: { kind: CONSTRAINTS_KIND, singleton: 1 } });
  const existing = rows[0];
  const seed = defaultConstraints(settings ?? { monthlyBudget: DEFAULT_CONSTRAINTS.monthlyBudget });
  const merged = coerce({ ...((existing?.data as Record<string, unknown>) ?? {}), ...patch }, seed);
  // Only carry an id when the row exists — put() spreads over the blank row and an
  // explicit `id: undefined` would clobber the generated key.
  await put(TABLES.profile, {
    ...(existing ? { id: existing.id } : {}),
    kind: CONSTRAINTS_KIND,
    singleton: 1,
    data: { ...merged }
  });
  return merged;
}

/** One line for the intake card, the advisor and the recommendation. */
export function describe(c: PersonalConstraints): string {
  const downtime = c.downtimeTolerance === 'open' ? 'recovery time is not a limit' : c.downtimeTolerance === 'none' ? 'no downtime at all' : `up to ${c.downtimeTolerance} of downtime`;
  const avoid = c.avoid.length ? `avoiding ${c.avoid.slice(0, 3).join(', ')}${c.avoid.length > 3 ? ` and ${c.avoid.length - 3} more` : ''}` : 'nothing marked to avoid';
  return `${c.monthlyBudget} a month · ${c.minutesPerDay} min a day · ${c.horizonWeeks}-week horizon · ${downtime} · ${avoid}`;
}

/* ------------------------------------------------------------------ recorded */

/** Optional real records that let a rule use data instead of a proxy. */
export interface FeasibilitySource {
  /** technique rows, matched through ImprovementOption.techniqueId */
  techniques?: AnyRow[];
  /** consultation rows, matched by procedure title, for a recorded recovery note */
  consultations?: AnyRow[];
  /** the assessment category the option sits under, when the caller knows it */
  categoryLabel?: string;
}

/** "4 minutes daily" / "60–75 minutes" / "1 hour" -> per-session minutes. */
export function recordedSessionMinutes(text: string | undefined | null): number | null {
  const s = String(text ?? '').toLowerCase();
  if (!s.trim()) return null;
  const min = [...s.matchAll(/(\d+(?:\.\d+)?)\s*(?:minutes?|mins?)/g)].map((m) => Number(m[1]));
  if (min.length) return Math.max(...min);
  const hrs = [...s.matchAll(/(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)/g)].map((m) => Number(m[1]));
  if (hrs.length) return Math.max(...hrs) * 60;
  return null;
}

/** A recovery note is the only honest source of downtime; text like
 *  "12 weeks at tolerated strength" is a judging window, not recovery, so it is
 *  deliberately not read as downtime. */
export function recordedDowntimeRank(text: string | undefined | null): number | null {
  const s = String(text ?? '').toLowerCase().trim();
  if (!s) return null;
  if (/(no|none|zero|nil)\s*downtime|no recovery|same day|walk in, walk out|minimal(ly)? no downtime/.test(s)) return 0;
  if (/(minimal|little|some|light) downtime|a few hours|half a day|hour or two/.test(s)) return 1;
  const days = [...s.matchAll(/(\d+)\s*days?/g)].map((m) => Number(m[1]));
  const weeks = [...s.matchAll(/(\d+)\s*weeks?/g)].map((m) => Number(m[1]));
  const total = Math.max(0, ...days, ...weeks.map((w) => w * 7));
  if (/downtime|recovery|recover|sore|swell|bruise|down time/.test(s) && total > 0) return total <= 1 ? 1 : total <= 7 ? 2 : 3;
  if (/downtime|recovery/.test(s) && !days.length && !weeks.length) return 1;
  return null;
}

function techniqueFor(option: ImprovementOption, src?: FeasibilitySource): AnyRow | undefined {
  if (!option.techniqueId || !src?.techniques?.length) return undefined;
  return src.techniques.find((t) => t.id === option.techniqueId || t.slug === option.techniqueId);
}

function consultationFor(option: ImprovementOption, src?: FeasibilitySource): AnyRow | undefined {
  const label = String(option.label ?? '').toLowerCase().trim();
  if (label.length < 6 || !src?.consultations?.length) return undefined;
  return src.consultations.find((x) => {
    const title = String(x.procedureTitle ?? '').toLowerCase().trim();
    return title.length >= 6 && (label.includes(title) || title.includes(label));
  });
}

/** Session minutes for an option: recorded text when it exists, otherwise the
 *  disclosed effort proxy. `from` is printed in every reason so nothing looks
 *  like a measurement the app did not have. */
export function sessionMinutes(option: ImprovementOption, src?: FeasibilitySource): { minutes: number; from: string } {
  const tec = techniqueFor(option, src);
  const recorded = recordedSessionMinutes(tec?.timeToTry as string | undefined);
  if (recorded !== null) {
    return { minutes: recorded, from: `the evidence library records “${String(tec?.timeToTry)}” for ${String(tec?.title ?? 'its technique')}` };
  }
  const idx = Math.max(0, Math.min(10, Math.round(Number(option.effort) || 0)));
  return { minutes: EFFORT_MINUTES_PER_DAY[idx], from: `inferred from the effort score you entered (${option.effort}/10) — the option record has no duration field` };
}

/* ------------------------------------------------------------------- gates */

/** Refusal policy, reused: `dangerous` never ranks, `unsupported` never gets planned. */
export function isPhaseEligible(o: Pick<ImprovementOption, 'evidence'> | AnyRow): boolean {
  const e = String((o as { evidence?: unknown }).evidence ?? '');
  return e !== 'dangerous' && e !== 'unsupported';
}

/** Refusals are never presented as a budget or time decision. */
export const REFUSAL_PREFIX = 'Excluded by the Glow Lab safety policy';
const refusalReason = (o: Pick<ImprovementOption, 'evidence'>) => `${REFUSAL_PREFIX} (${o.evidence}), not by anything you described.`;

export interface Feasibility {
  fits: boolean;
  reasons: string[];
}

/**
 * The four real tests plus the safety gate. Every reason names the field it
 * read, so a ruled-out option can be argued with. `reasons` always shows the
 * working: blocking reasons first, then the arithmetic for what passed.
 */
export function feasibility(option: ImprovementOption, c: PersonalConstraints, src: FeasibilitySource = {}): Feasibility {
  const blocked = blockingReasons(option, c, src);
  if (blocked.length === 1 && blocked[0].startsWith(REFUSAL_PREFIX)) return { fits: false, reasons: blocked };
  return { fits: blocked.length === 0, reasons: [...blocked, ...passNotes(option, c, src)] };
}

/** The arithmetic for the tests an option *passed*, so a fitting option shows
 *  its working instead of a bare tick. */
function passNotes(option: ImprovementOption, c: PersonalConstraints, src: FeasibilitySource): string[] {
  if (!isPhaseEligible(option)) return [];
  const out: string[] = [];
  const width = COST_BAND_WIDTH[option.costBand] ?? 0;
  if (option.costBand === 'free') out.push('Costs nothing, so the budget never comes up.');
  else if (width <= Math.max(0, c.monthlyBudget)) {
    out.push(`Cost band “${option.costBand}” (${width}) is inside your ${c.monthlyBudget} a month; the ranker already charges it ${COST_PENALTY[option.costBand].toFixed(2)}.`);
  }
  const { minutes, from } = sessionMinutes(option, src);
  const cadence = cadenceFor(option);
  if (minutes > 0) out.push(`About ${minutes} min ${cadence === 'once' ? 'once' : `per ${cadence === 'daily' ? 'day' : cadence === 'weekly' ? 'week' : 'month'}`}, ${from}.`);
  const weeks = Number(option.weeksToSee) || 0;
  if (weeks > 0 && weeks <= c.horizonWeeks) out.push(`Shows in ${weeks} week${weeks === 1 ? '' : 's'}, inside your ${c.horizonWeeks}-week horizon.`);
  return out;
}

export interface RuledOut<T> {
  option: T;
  reasons: string[];
  /** 'policy' = refused on safety grounds; 'constraint' = ruled out by what the user said */
  origin: 'constraint' | 'policy';
}

/** Blocking reasons only, so a fitting option's arithmetic notes are not read as complaints. */
function blockingReasons(option: ImprovementOption, c: PersonalConstraints, src: FeasibilitySource): string[] {
  if (!isPhaseEligible(option)) return [refusalReason(option)];
  const out: string[] = [];
  const width = COST_BAND_WIDTH[option.costBand] ?? 0;
  if (option.costBand !== 'free' && width > Math.max(0, c.monthlyBudget)) {
    out.push(`Cost band “${option.costBand}” sits at ${width} on the app's band scale, above the ${c.monthlyBudget} a month you gave. Bands are positions, not prices.`);
  }
  const { minutes, from } = sessionMinutes(option, src);
  const cadence = cadenceFor(option);
  const allowance = cadence === 'daily' ? c.minutesPerDay : cadence === 'weekly' ? c.minutesPerDay * 7 : cadence === 'monthly' ? c.minutesPerDay * 28 : c.minutesPerDay * 7 * c.horizonWeeks;
  if (minutes > allowance) {
    out.push(`${cadence === 'once' ? 'One-off session' : `${cadence} work`} of about ${minutes} min against ${allowance} min available on your ${c.minutesPerDay} min a day (${from}).`);
  }
  const weeks = Number(option.weeksToSee) || 0;
  if (weeks > c.horizonWeeks) out.push(`Records ${weeks} weeks before it shows anything; your horizon is ${c.horizonWeeks} weeks.`);
  const consult = consultationFor(option, src);
  const recorded = recordedDowntimeRank(consult?.recovery as string | undefined);
  const neededRank = recorded ?? RISK_TO_DOWNTIME_RANK[Math.max(0, Math.min(4, Math.round(Number(option.risk) || 0)))];
  if (neededRank > DOWNTIME_RANK[c.downtimeTolerance]) {
    out.push(
      recorded !== null
        ? `Your consultation note for it records the recovery as “${String(consult?.recovery)}”, more than “${c.downtimeTolerance}” allows.`
        : `Risk band ${option.risk}/4 implies more disruption than “${c.downtimeTolerance}” downtime allows — no recovery window is recorded on the option, so your own risk score is the proxy.`
    );
  }
  const hay = [option.label, option.limitations, option.nextStep, src.categoryLabel ?? '', String(techniqueFor(option, src)?.title ?? ''), String(techniqueFor(option, src)?.slug ?? '')]
    .join(' · ')
    .toLowerCase();
  for (const term of c.avoid) {
    const t = term.toLowerCase().trim();
    if (!t) continue;
    const words = t.split(/\s+/).filter(Boolean);
    if (hay.includes(t) || (words.length > 1 && words.every((w) => hay.includes(w)))) {
      out.push(`You marked “${term}” as something to avoid and it appears in this option's own text.`);
    }
  }
  return out;
}

/** The split the intake card and the engine rule both consume. */
export function splitByFit<T extends ImprovementOption>(
  ranked: T[],
  c: PersonalConstraints,
  src: FeasibilitySource = {}
): { inPlan: T[]; ruledOut: RuledOut<T>[] } {
  const inPlan: T[] = [];
  const ruledOut: RuledOut<T>[] = [];
  for (const option of ranked) {
    if (!isPhaseEligible(option)) {
      ruledOut.push({ option, reasons: [refusalReason(option)], origin: 'policy' });
      continue;
    }
    const blocked = blockingReasons(option, c, src);
    if (blocked.length) ruledOut.push({ option, reasons: blocked, origin: 'constraint' });
    else inPlan.push(option);
  }
  return { inPlan, ruledOut };
}

/* ------------------------------------------------------------------ plan */

export interface PlannedItem {
  id: string;
  label: string;
  cadence: Cadence;
  /** minutes this item occupies per day inside the phase, after conversion */
  minutesPerDay: number;
  /** the arithmetic, in words, that produced that figure */
  math: string;
  evidence: string;
  costBand: string;
  weeksToSee: number;
}

export interface PlanPhase {
  index: number;
  label: string;
  weekStart: number;
  weekEnd: number;
  items: PlannedItem[];
  minutesPerDayCommitted: number;
  minutesPerDayAvailable: number;
  arithmetic: string;
  note: string;
}

export interface SequencedPlan<T extends ImprovementOption = ImprovementOption> {
  phases: PlanPhase[];
  /** fits your constraints but the phases had no room left inside the horizon */
  deferred: { option: T; why: string }[];
  ruledOut: RuledOut<T>[];
  summary: string[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Evidence first, then reversibility, then cheapest — the shipped ranking axes,
 *  used here for *sequencing* rather than for scoring. */
function orderingKey<T extends ImprovementOption>(o: T) {
  const evidence = EVIDENCE_WEIGHT[o.evidence] ?? 0.3;
  const reversible = REVERSIBILITY_BONUS[Math.max(0, Math.min(4, Math.round(Number(o.reversibility) || 0)))];
  const cost = COST_PENALTY[o.costBand] ?? 0.2;
  const score = Number((o as { score?: number }).score ?? 0);
  return { evidence, reversible, cost, score };
}

function compareForPhasing(a: ImprovementOption, b: ImprovementOption) {
  const ka = orderingKey(a);
  const kb = orderingKey(b);
  return kb.evidence - ka.evidence || kb.reversible - ka.reversible || ka.cost - kb.cost || kb.score - ka.score;
}

/** Per-day occupation inside a phase of `weeks` weeks. */
function perDay(cost: number, cadence: Cadence, weeks: number) {
  if (cadence === 'daily') return cost;
  if (cadence === 'weekly') return cost / 7;
  if (cadence === 'monthly') return cost / 28;
  return cost / (7 * Math.max(1, weeks));
}

export function sequencePlan<T extends ImprovementOption>(
  options: T[],
  c: PersonalConstraints,
  o: { weeks?: number; src?: FeasibilitySource } = {}
): SequencedPlan<T> {
  const weeks = clampInt(o.weeks ?? c.horizonWeeks, 1, 104, c.horizonWeeks);
  const src = o.src ?? {};
  const { inPlan, ruledOut } = splitByFit([...options], c, src);

  const phaseCount = Math.max(1, Math.min(4, Math.ceil(weeks / 4)));
  const size = Math.ceil(weeks / phaseCount);
  const phases: PlanPhase[] = [];
  for (let i = 0; i < phaseCount; i += 1) {
    const start = i * size + 1;
    const end = Math.min(weeks, (i + 1) * size);
    phases.push({
      index: i + 1,
      label: `Phase ${String(i + 1).padStart(2, '0')} · weeks ${start}–${end}`,
      weekStart: start,
      weekEnd: end,
      items: [],
      minutesPerDayCommitted: 0,
      minutesPerDayAvailable: c.minutesPerDay,
      arithmetic: `${c.minutesPerDay} min a day available`,
      note: ''
    });
  }

  // Belt and braces: the gate above already refuses these, so a phase can only
  // contain them if splitByFit is ever broken. assertNoRefusedInPlan() below
  // turns that into a thrown bug rather than bad advice.
  const ordered = inPlan.filter((o) => isPhaseEligible(o)).sort(compareForPhasing);
  const deferred: { option: T; why: string }[] = [];

  for (const option of ordered) {
    const cost = sessionMinutes(option, src);
    const cadence = cadenceFor(option);
    let placed = false;
    for (const phase of phases) {
      const load = perDay(cost.minutes, cadence, phase.weekEnd - phase.weekStart + 1);
      const next = phase.minutesPerDayCommitted + load;
      if (next > c.minutesPerDay + 1e-9) continue;
      phase.items.push({
        id: option.id,
        label: option.label,
        cadence,
        minutesPerDay: round1(load),
        math:
          cadence === 'once'
            ? `${cost.minutes} min once over ${phase.weekEnd - phase.weekStart + 1} weeks = ${round1(load)} min/day`
            : cadence === 'daily'
              ? `${cost.minutes} min a day, every day`
              : `${cost.minutes} min ${cadence === 'weekly' ? 'a week' : 'a month'} = ${round1(load)} min/day`,
        evidence: option.evidence,
        costBand: option.costBand,
        weeksToSee: Number(option.weeksToSee) || 0
      });
      phase.minutesPerDayCommitted = Math.round(next * 1000) / 1000;
      placed = true;
      break;
    }
    if (!placed) {
      const last = phases[phases.length - 1];
      const overflow = last.minutesPerDayCommitted + perDay(cost.minutes, cadence, last.weekEnd - last.weekStart + 1);
      deferred.push({
        option,
        why: `Fits what you described, but adding it to ${last.label} would reach ${round1(overflow)} min a day against your ${c.minutesPerDay}. Raise the minutes, extend the horizon, or drop something.`
      });
    }
  }

  for (const phase of phases) {
    const parts = phase.items.map((i) => `${round1(i.minutesPerDay)} (${i.cadence})`);
    phase.arithmetic = phase.items.length
      ? `${parts.join(' + ')} = ${round1(phase.minutesPerDayCommitted)} min a day, inside your ${c.minutesPerDay}`
      : `Nothing scheduled — every fitting option was already placed earlier, or none survived the split. ${c.minutesPerDay} min a day unclaimed.`;
    phase.note = phase.items.length
      ? `${phase.items.length} item${phase.items.length === 1 ? '' : 's'} · ordered by evidence, then reversibility, then cost.`
      : 'Empty phase.';
  }

  assertNoRefusedInPlan(phases, options);

  const summary = [
    `${options.length} option(s) considered, ${inPlan.length} fit what you described, ${ruledOut.length} did not.`,
    `${phaseCount} phase${phaseCount === 1 ? '' : 's'} across ${weeks} week${weeks === 1 ? '' : 's'} at ${c.minutesPerDay} min a day.`,
    deferred.length ? `${deferred.length} fitting option(s) had no room left in the horizon.` : 'Every fitting option found a phase.'
  ];
  return { phases, deferred, ruledOut, summary };
}

/**
 * Code-level assertion, not copy: a refused option in a phase is a bug, so it
 * throws instead of shipping advice. Called on every finished plan.
 */
export function assertNoRefusedInPlan(phases: PlanPhase[], source: ImprovementOption[]): void {
  const byId = new Map(source.map((o) => [o.id, o]));
  for (const phase of phases) {
    for (const item of phase.items) {
      const origin = byId.get(item.id);
      const evidence = origin?.evidence ?? item.evidence;
      if (evidence === 'dangerous' || evidence === 'unsupported') {
        throw new Error(`constraints: refused option leaked into ${phase.label} — ${item.label} (${evidence})`);
      }
    }
  }
}

/* --------------------------------------------------------------- assessment */

export type GradedOption = ImprovementOption & { categoryId: string; categoryLabel: string };

/** Flatten every graded option out of the user's assessments. Read-only. */
export function gradedOptions(assessmentRows: AnyRow[]): GradedOption[] {
  const out: GradedOption[] = [];
  const seen = new Set<string>();
  for (const a of assessmentRows) {
    const cats = (a.categories as { id?: string; label?: string; options?: ImprovementOption[] }[]) ?? [];
    for (const c of cats) {
      for (const o of c.options ?? []) {
        if (!String(o.label ?? '').trim()) continue;
        const key = `${c.id ?? ''}::${o.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ ...o, categoryId: String(c.id ?? ''), categoryLabel: String(c.label ?? '') });
      }
    }
  }
  return out;
}

/** Scored + ranked, refused already separated by the shipped policy. */
export function rankedGradedOptions(assessmentRows: AnyRow[]): (GradedOption & { score: number })[] {
  const all = gradedOptions(assessmentRows);
  const byCat = new Map<string, GradedOption[]>();
  for (const o of all) {
    const list = byCat.get(o.categoryId) ?? [];
    list.push(o);
    byCat.set(o.categoryId, list);
  }
  const ranked: (GradedOption & { score: number })[] = [];
  for (const list of byCat.values()) {
    const { ranked: r } = rankOptions(list, {});
    for (const o of r) ranked.push(o as unknown as GradedOption & { score: number });
  }
  return ranked.sort((a, b) => b.score - a.score);
}

export interface UnblockProbe {
  /** what the single relaxation is, in words */
  change: string;
  /** how many graded options would come back if only that changed */
  extra: number;
  examples: string[];
}

/**
 * "Which one of my numbers is doing the blocking?" — each probe relaxes exactly
 * one field and recounts. Everything reported is a count of the user's own
 * options; nothing is asserted about the world.
 */
export function whatWouldUnblock<T extends ImprovementOption>(options: T[], c: PersonalConstraints, src: FeasibilitySource = {}): UnblockProbe[] {
  const eligible = options.filter(isPhaseEligible);
  const nowFit = splitByFit(eligible, c, src).inPlan.map((o) => o.id);
  const nextDowntime: DowntimeTolerance = c.downtimeTolerance === 'none' ? 'a-day' : c.downtimeTolerance === 'a-day' ? 'a-week' : 'open';
  const probes: PersonalConstraints[] = [
    { ...c, monthlyBudget: Math.max(1, Math.round(c.monthlyBudget * 2)) },
    { ...c, minutesPerDay: c.minutesPerDay + 10 },
    { ...c, horizonWeeks: Math.min(104, c.horizonWeeks * 2) },
    { ...c, downtimeTolerance: nextDowntime },
    { ...c, avoid: [] }
  ];
  const labels = [
    `budget ${c.monthlyBudget} → ${Math.max(1, Math.round(c.monthlyBudget * 2))} a month`,
    `time ${c.minutesPerDay} → ${c.minutesPerDay + 10} min a day`,
    `horizon ${c.horizonWeeks} → ${Math.min(104, c.horizonWeeks * 2)} weeks`,
    `downtime “${c.downtimeTolerance}” → “${nextDowntime}”`,
    `the “avoid” list cleared (${c.avoid.length} term(s))`
  ];
  const out: UnblockProbe[] = [];
  probes.forEach((probe, i) => {
    const fit = splitByFit(eligible, probe, src).inPlan;
    const gained = fit.filter((o) => !nowFit.includes(o.id));
    if (gained.length) {
      out.push({ change: labels[i], extra: gained.length, examples: gained.slice(0, 3).map((g) => String(g.label)) });
    }
  });
  return out.sort((a, b) => b.extra - a.extra);
}

/** Band ceiling ladder for the intake copy: which bands the budget currently covers. */
export function affordableBands(c: PersonalConstraints): ImprovementOption['costBand'][] {
  return COST_BAND_ORDER.filter((b) => b === 'free' || (COST_BAND_WIDTH[b] ?? 0) <= Math.max(0, c.monthlyBudget));
}

export function unaffordableBands(c: PersonalConstraints): ImprovementOption['costBand'][] {
  return COST_BAND_ORDER.filter((b) => b !== 'free' && (COST_BAND_WIDTH[b] ?? 0) > Math.max(0, c.monthlyBudget));
}
