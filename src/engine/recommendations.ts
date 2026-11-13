import { TABLES, type AnyRow, type RecommendationRow } from '../db/schema';
import { findAll, put, todayISO, addDays } from '../db/repo';
import { loadSettings, type AppSettings } from '../state/settings';
import { describe as describeConstraints, hasSavedConstraints, readConstraints, splitByFit, gradedOptions } from './constraints';

/**
 * Recommendation engine (spec Part 26).
 *
 * Everything here is a readable rule over the user's own rows. `sourceEngine`
 * is always 'local-rules' and the UI prints that label, because claiming
 * machine learning here would be a lie (Part 1 #13, #23).
 */

export type Candidate = Omit<RecommendationRow, keyof import('../db/schema').BaseRow | 'id'> & { id?: string };

const daysSince = (iso: string | null | undefined) => {
  if (!iso) return Infinity;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? Math.floor((Date.now() - t) / 86400000) : Infinity;
};

export interface EngineContext {
  goals: AnyRow[];
  plans: AnyRow[];
  routines: AnyRow[];
  routineLogs: AnyRow[];
  products: AnyRow[];
  experiments: AnyRow[];
  progress: AnyRow[];
  observations: AnyRow[];
  hairRecords: AnyRow[];
  dental: AnyRow[];
  events: AnyRow[];
  outfits: AnyRow[];
  clothing: AnyRow[];
  interactions: AnyRow[];
  discovery: AnyRow[];
  consultations: AnyRow[];
  workouts: AnyRow[];
  profile: AnyRow[];
  techniques: AnyRow[];
  /** graded improvement options live here; rule 13 needs them (Part 11) */
  assessments: AnyRow[];
  /** settings are part of the context so the feasibility layer can seed budget */
  settings: AppSettings;
}

export async function buildContext(): Promise<EngineContext> {
  const [goals, plans, routines, routineLogs, products, experiments, progress, observations, hairRecords, dental, events, outfits, clothing, interactions, discovery, consultations, workouts, profile, techniques, assessments, settings] =
    await Promise.all([
      findAll(TABLES.goals),
      findAll(TABLES.plans),
      findAll(TABLES.routines),
      findAll(TABLES.routineLogs),
      findAll(TABLES.products),
      findAll(TABLES.experiments),
      findAll(TABLES.progressEntries),
      findAll(TABLES.observations),
      findAll(TABLES.hairRecords),
      findAll(TABLES.dental),
      findAll(TABLES.calendarEvents),
      findAll(TABLES.outfits),
      findAll(TABLES.clothingItems),
      findAll(TABLES.discoveryInteractions),
      findAll(TABLES.discoveryItems),
      findAll(TABLES.consultations),
      findAll(TABLES.workoutSessions),
      findAll(TABLES.profile),
      findAll(TABLES.techniques),
      findAll(TABLES.assessments),
      loadSettings()
    ]);
  return { goals, plans, routines, routineLogs, products, experiments, progress, observations, hairRecords, dental, events, outfits, clothing, interactions, discovery, consultations, workouts, profile, techniques, assessments, settings };
}

/**
 * The rules themselves. Returns candidates sorted by score; a candidate is a
 * suggestion, never a stored fact — callers persist them via `syncStore`.
 */
export function generate(ctx: EngineContext, opts: { today?: string } = {}): Candidate[] {
  const today = opts.today ?? todayISO();
  const out: Candidate[] = [];
  const push = (c: Candidate) => out.push(c);

  // 1. Goals with no active plan.
  const activePlans = ctx.plans.filter((p) => p.status === 'active');
  for (const g of ctx.goals.filter((g) => g.status === 'active')) {
    if (g.planId) continue;
    if (activePlans.some((p) => (p.priorities as string[]).includes(g.domain))) continue;
    push({
      title: `Turn the “${g.title}” goal into a plan`,
      reason: 'The goal is active but nothing scheduled points at it. Goals without actions stay wishes.',
      domain: g.domain,
      score: 72,
      factors: [{ label: 'Untracked goal', value: 72 }],
      status: 'new',
      sourceEngine: 'local-rules',
      linkTable: TABLES.goals,
      linkId: g.id,
      evidence: null,
      costBand: 'free'
    });
  }

  // 2. Routines with collapsing adherence.
  for (const r of ctx.routines.filter((r) => r.active)) {
    const logs = (ctx.routineLogs as AnyRow[]).filter((l) => l.routineId === r.id && daysSince(l.doneOn as string) <= 14);
    const steps = (r.steps as unknown[])?.length ?? 0;
    if (!steps) continue;
    const expected = 14;
    if (logs.length === 0) {
      push({
        title: `Restart “${r.name}” at one step`,
        reason: `No log in 14 days for a ${steps}-step routine. Full restarts fail more often than shrinking the first week does.`,
        domain: r.domain,
        score: 64,
        factors: [{ label: 'Adherence', value: 0 }, { label: 'Effort to restart', value: 30 }],
        status: 'new',
        sourceEngine: 'local-rules',
        linkTable: TABLES.routines,
        linkId: r.id,
        evidence: null,
        costBand: 'free'
      });
    } else if (logs.length / expected < 0.35) {
      push({
        title: `Trim “${r.name}” to what you actually do`,
        reason: `${logs.length} of ${expected} possible logs in two weeks. The routine is bigger than the habit.`,
        domain: r.domain,
        score: 58,
        factors: [{ label: 'Adherence', value: Math.round((logs.length / expected) * 100) }],
        status: 'new',
        sourceEngine: 'local-rules',
        linkTable: TABLES.routines,
        linkId: r.id,
        evidence: null,
        costBand: 'free'
      });
    }
  }

  // 3. Maintenance overdue (hair retwist, dental, upcoming appointments).
  const lastRetwist = ctx.hairRecords
    .filter((h) => h.kind === 'retwist')
    .map((h) => h.doneOn as string)
    .sort()
    .at(-1);
  const interval = Number(ctx.profile.find((p) => p.kind === 'hair')?.data?.retwistEveryWeeks ?? 6) * 7;
  if (lastRetwist && daysSince(lastRetwist) > interval + 14) {
    push({
      title: 'Retwist interval has passed',
      reason: `Last recorded retwist ${daysSince(lastRetwist)} days ago against your ${interval}-day note. Over-tight retwists cause traction loss, so book time rather than rushing it.`,
      domain: 'hair',
      score: 66,
      factors: [{ label: 'Overdue', value: Math.min(100, daysSince(lastRetwist) - interval) }],
      status: 'new',
      sourceEngine: 'local-rules',
      linkTable: TABLES.hairRecords,
      linkId: lastRetwist ? (ctx.hairRecords.find((h) => h.doneOn === lastRetwist)?.id ?? '') : '',
      evidence: 'moderate',
      costBand: 'mid'
    });
  }
  const nextDental = (ctx.dental as AnyRow[]).map((d) => d.nextVisitOn).filter(Boolean).sort()[0] as string | undefined;
  if (nextDental && daysSince(nextDental) > -21 && daysSince(nextDental) <= 0) {
    push({
      title: 'Dental appointment is inside three weeks',
      reason: 'Professional cleaning is the cheapest supported smile improvement available. Book before the slot disappears.',
      domain: 'smile',
      score: 60,
      factors: [{ label: 'Soon', value: 60 }],
      status: 'new',
      sourceEngine: 'local-rules',
      linkTable: TABLES.dental,
      linkId: '',
      evidence: 'strong',
      costBand: 'mid'
    });
  }

  // 4. Experiments past their end date and still open.
  for (const e of ctx.experiments.filter((e) => e.decision === 'open' && e.endOn && e.endOn < today)) {
    push({
      title: `Close out the “${e.name}” experiment`,
      reason: `Ended ${daysSince(e.endOn as string)} days ago with no verdict. Unclosed experiments keep consuming attention and teach nothing.`,
      domain: e.category,
      score: 74,
      factors: [{ label: 'Overdue review', value: 74 }],
      status: 'new',
      sourceEngine: 'local-rules',
      linkTable: TABLES.experiments,
      linkId: e.id,
      evidence: null,
      costBand: 'free'
    });
  }

  // 5. Saved-but-never-tried discovery content.
  const tried = new Set(ctx.experiments.map((e) => String((e.data?.sourceItemId as string) ?? '')));
  const wantsToTry = (ctx.interactions as AnyRow[]).filter((i) => i.action === 'try');
  const stale = wantsToTry.filter((i) => !tried.has(String(i.itemId)) && daysSince(i.createdAt ? new Date(i.createdAt).toISOString().slice(0, 10) : '') > 30);
  if (stale.length >= 3) {
    push({
      title: `${stale.length} “want to try” saves have aged past a month`,
      reason: 'A save with no attempt is a wish list. Pick one, make it an experiment, drop the rest without guilt.',
      domain: 'discover',
      score: 52,
      factors: [{ label: 'Backlog', value: Math.min(100, stale.length * 12) }],
      status: 'new',
      sourceEngine: 'local-rules',
      linkTable: TABLES.experiments,
      linkId: '',
      evidence: null,
      costBand: 'free'
    });
  }

  // 6. Purchase intent vs duplication.
  const wants = ctx.products.filter((p) => p.status === 'want');
  const dupes = wants.filter((w) => ctx.products.some((p) => p.id !== w.id && p.status === 'own' && p.category === w.category));
  for (const d of dupes.slice(0, 2)) {
    push({
      title: `Should I buy this? You already own ${dupes.length + 1 > 1 ? 'a ' + d.category : 'one'}`,
      reason: `Wishlist item “${d.name}” shares a category with something you own${d.pricePaid ? `, priced ${d.pricePaid}` : ''}. Duplicate-check before cost-per-wear math.`,
      domain: 'market',
      score: 48,
      factors: [{ label: 'Duplicate risk', value: 70 }],
      status: 'new',
      sourceEngine: 'local-rules',
      linkTable: TABLES.products,
      linkId: d.id,
      evidence: null,
      costBand: Number(d.pricePaid) > 60 ? 'high' : 'mid'
    });
  }

  // 7. Recording gap.
  const lastProgress = ctx.progress.map((p) => p.on as string).sort().at(-1);
  if (ctx.goals.length && daysSince(lastProgress) > 21) {
    push({
      title: 'No progress entry in three weeks',
      reason: 'Analytics needs entries. Two photos and one rating is enough to keep the trend line honest.',
      domain: 'progress',
      score: 56,
      factors: [{ label: 'Silence', value: Math.min(100, daysSince(lastProgress)) }],
      status: 'new',
      sourceEngine: 'local-rules',
      linkTable: TABLES.progressEntries,
      linkId: '',
      evidence: null,
      costBand: 'free'
    });
  }

  // 8. Training stall.
  const lastSession = (ctx.workouts as AnyRow[]).map((w) => w.doneOn as string).sort().at(-1);
  if (lastSession && daysSince(lastSession) > 12) {
    push({
      title: 'Training has been paused for two weeks',
      reason: `Last session ${daysSince(lastSession)} days ago. Two sessions restore the stimulus without demanding a comeback arc.`,
      domain: 'body',
      score: 54,
      factors: [{ label: 'Time off', value: Math.min(100, daysSince(lastSession) * 2) }],
      status: 'new',
      sourceEngine: 'local-rules',
      linkTable: TABLES.workoutSessions,
      linkId: '',
      evidence: 'strong',
      costBand: 'free'
    });
  } else if (!ctx.workouts.length && ctx.plans.some((p) => p.domain === 'body' || /train|fitness|strength/i.test(String(p.name)))) {
    push({
      title: 'Log the first session of your plan',
      reason: 'A plan with no logged sessions cannot show progress, which is the only reason to keep it.',
      domain: 'body',
      score: 50,
      factors: [{ label: 'Untested plan', value: 50 }],
      status: 'new',
      sourceEngine: 'local-rules',
      linkTable: TABLES.workoutPlans,
      linkId: '',
      evidence: 'strong',
      costBand: 'free'
    });
  }

  // 9. Wardrobe that never gets worn.
  const neverWorn = ctx.clothing.filter((c) => Number(c.wears || 0) === 0 && daysSince(c.boughtOn as string) > 90);
  if (neverWorn.length >= 5) {
    push({
      title: `${neverWorn.length} garments unworn for over three months`,
      reason: 'Build three outfits from them before buying anything similar. If none work, they are storage, not wardrobe.',
      domain: 'style',
      score: 46,
      factors: [{ label: 'Dormant stock', value: Math.min(100, neverWorn.length * 8) }],
      status: 'new',
      sourceEngine: 'local-rules',
      linkTable: TABLES.clothingItems,
      linkId: neverWorn[0]?.id ?? '',
      evidence: null,
      costBand: 'free'
    });
  }
  const orphanOutfits = ctx.outfits.length < 4 && ctx.clothing.length > 12;
  if (orphanOutfits) {
    push({
      title: 'Compose outfits you already own',
      reason: `${ctx.clothing.length} garments and ${ctx.outfits.length} saved outfits. Combination is free; it is the fastest glow-up available.`,
      domain: 'style',
      score: 55,
      factors: [{ label: 'Untapped inventory', value: 60 }],
      status: 'new',
      sourceEngine: 'local-rules',
      linkTable: TABLES.outfits,
      linkId: '',
      evidence: null,
      costBand: 'free'
    });
  }

  // 10. Consultations still in the air.
  for (const c of ctx.consultations.filter((x) => x.decision === 'considering').slice(0, 1)) {
    push({
      title: `Prepare questions for “${c.procedureTitle}”`,
      reason: 'Written questions get better consultations. Ask what happens if you do nothing, and what you should stop doing.',
      domain: 'services',
      score: 44,
      factors: [{ label: 'Pending decision', value: 44 }],
      status: 'new',
      sourceEngine: 'local-rules',
      linkTable: TABLES.consultations,
      linkId: c.id,
      evidence: null,
      costBand: 'high'
    });
  }

  // 11. Profile holes that quietly degrade every other department.
  const have = new Set(ctx.profile.map((p) => p.kind as string));
  for (const kind of ['hair', 'skin', 'style'] as const) {
    if (have.has(kind)) continue;
    push({
      title: `Complete the ${kind} profile`,
      reason: `Recommendations in ${kind} departments fall back to generic guidance until they know your baseline.`,
      domain: kind,
      score: 42,
      factors: [{ label: 'Missing baseline', value: 42 }],
      status: 'new',
      sourceEngine: 'local-rules',
      linkTable: TABLES.profile,
      linkId: '',
      evidence: null,
      costBand: 'free'
    });
  }

  // 12. Upcoming scheduled care in the next 7 days.
  const soon = ctx.events.filter((e) => {
    const d = new Date(Number(e.startAt)).toISOString().slice(0, 10);
    return d >= today && d <= addDays(today, 7);
  });
  if (soon.length) {
    push({
      title: `${soon.length} scheduled item${soon.length > 1 ? 's' : ''} in the next week`,
      reason: soon
        .slice(0, 3)
        .map((e) => e.title)
        .join(', '),
      domain: 'calendar',
      score: 62,
      factors: [{ label: 'Imminent', value: 62 }],
      status: 'new',
      sourceEngine: 'local-rules',
      linkTable: TABLES.calendarEvents,
      linkId: soon[0].id,
      evidence: null,
      costBand: 'free'
    });
  }

  // 13. Constraint feasibility (Part 11). The options the user graded themselves,
  // split against the constraints they saved. Nothing is deleted here — this is
  // annotation and ordering only, and the copy says so.
  {
    const graded = gradedOptions(ctx.assessments ?? []);
    const constraints = readConstraints(ctx.profile, ctx.settings ?? undefined);
    if (!hasSavedConstraints(ctx.profile)) {
      push({
        title: 'Tell the app what actually fits your life',
        reason: `No constraints record is saved, so every plan is ranked on evidence and cost alone and filtered by a default budget of ${constraints.monthlyBudget} taken from Settings rather than from you. Profile → “What actually fits your life” takes a minute and changes which options are proposed first.`,
        domain: 'planning',
        score: 47,
        factors: [{ label: 'Missing constraints record', value: 47 }],
        status: 'new',
        sourceEngine: 'local-rules',
        linkTable: TABLES.profile,
        linkId: '',
        evidence: null,
        costBand: 'free'
      });
    } else if (graded.length) {
      const { inPlan, ruledOut } = splitByFit(graded, constraints, { techniques: ctx.techniques, consultations: ctx.consultations });
      const byConstraint = ruledOut.filter((r) => r.origin === 'constraint');
      const named = byConstraint
        .slice(0, 3)
        .map((r) => `“${r.option.label}” — ${r.reasons[0]}`)
        .join(' ');
      if (byConstraint.length && !inPlan.length) {
        push({
          title: `Nothing you graded fits the constraints you saved`,
          reason: `All ${graded.length} graded option(s) fall outside them: ${named} Check the figures in Profile — the constraints change what is proposed, they do not remove anything from your record.`,
          domain: 'planning',
          score: 76,
          factors: [
            { label: 'Graded options', value: graded.length },
            { label: 'Outside constraints', value: byConstraint.length }
          ],
          status: 'new',
          sourceEngine: 'local-rules',
          linkTable: TABLES.profile,
          linkId: '',
          evidence: null,
          costBand: 'free'
        });
      } else if (byConstraint.length) {
        push({
          title: `${byConstraint.length} of your ${graded.length} graded options are ruled out by what you told the app`,
          reason: `${named} Still inside: ${inPlan.length} option(s), on ${describeConstraints(constraints)}. Nothing was deleted — this only changes what is proposed first.`,
          domain: 'planning',
          score: 68,
          factors: [
            { label: 'Fits your constraints', value: inPlan.length },
            { label: 'Ruled out', value: byConstraint.length }
          ],
          status: 'new',
          sourceEngine: 'local-rules',
          linkTable: TABLES.profile,
          linkId: '',
          evidence: null,
          costBand: 'free'
        });
      }
    }
  }

  return out.sort((a, b) => b.score - a.score);
}

/** Writes candidates into the recommendations table, deduping on rule identity. */
export async function syncRecommendations(ctx: EngineContext): Promise<{ added: number; kept: number }> {
  const existing = await findAll(TABLES.recommendations);
  const keyOf = (c: { title: string; domain: string } | AnyRow) => `${c.domain}::${c.title}`;
  const have = new Map(existing.map((r) => [keyOf(r), r]));
  let added = 0;
  let kept = 0;
  for (const c of generate(ctx)) {
    const k = keyOf(c);
    const prev = have.get(k);
    if (prev) {
      if (prev.status === 'dismissed') continue;
      kept += 1;
      continue;
    }
    await put(TABLES.recommendations, c);
    added += 1;
  }
  return { added, kept };
}

/** Today's focus, built from real dated rows only — never invented tasks. */
export async function todayFocus(today = todayISO()) {
  const [events, routines, logs, plans] = await Promise.all([
    findAll(TABLES.calendarEvents),
    findAll(TABLES.routines),
    findAll(TABLES.routineLogs),
    findAll(TABLES.plans)
  ]);
  const day = new Date(today).getDay();
  const due: { label: string; kind: string; linkTo: string; id: string }[] = [];

  for (const e of events) {
    const d = new Date(Number(e.startAt));
    const iso = d.toISOString().slice(0, 10);
    if (iso !== today) continue;
    due.push({ label: e.title, kind: e.kind || 'event', linkTo: '/calendar', id: e.id });
  }
  for (const r of routines.filter((x) => x.active)) {
    const done = (logs as AnyRow[]).some((l) => l.routineId === r.id && l.doneOn === today);
    if (done) continue;
    due.push({ label: r.name, kind: r.domain || 'routine', linkTo: `/${r.domain ?? 'home'}?focus=routines`, id: r.id });
  }
  for (const p of plans.filter((x) => x.status === 'active')) {
    for (const a of (p.actions as AnyRow[]) ?? []) {
      const cadence = a.cadence;
      const hit =
        cadence === 'daily' ||
        (cadence === 'weekly' && (a.data?.weekday ?? 1) === day) ||
        (cadence === 'monthly' && Number(today.slice(8, 10)) === 1);
      if (!hit) continue;
      if (((a.doneOn as string[]) ?? []).includes(today)) continue;
      due.push({ label: a.label, kind: a.category || p.name, linkTo: '/plans', id: a.id });
    }
  }
  return due.slice(0, 8);
}
