import { beforeEach, describe, expect, it } from 'vitest';
import { BAND_NOTE, evidenceTone, rankOptions, scoreOption, techniqueIsRecommendable } from '../engine/prioritisation';
import { advise } from '../engine/advisor';
import { buildContext, generate, syncRecommendations } from '../engine/recommendations';
import { computeDna, excludedItemIds, scoreAgainstDna } from '../engine/taste';
import { updateSettings } from '../state/settings';
import {
  AVOID_SUGGESTIONS,
  COST_BAND_WIDTH,
  DEFAULT_CONSTRAINTS,
  EFFORT_MINUTES_PER_DAY,
  HORIZON_CHOICES,
  assertNoRefusedInPlan,
  cadenceFor,
  defaultConstraints,
  describe as describeConstraints,
  feasibility,
  gradedOptions,
  hasSavedConstraints,
  readConstraints,
  recordedDowntimeRank,
  recordedSessionMinutes,
  saveConstraints,
  sequencePlan,
  sessionMinutes,
  splitByFit,
  whatWouldUnblock,
  type FeasibilitySource,
  type PersonalConstraints
} from '../engine/constraints';
import { DEFAULT_SETTINGS } from '../state/settings';
import { TABLES, type ImprovementOption } from '../db/schema';
import { findAll, put, todayISO } from '../db/repo';
import { db } from '../db/db';

beforeEach(async () => {
  await Promise.all(Object.values(TABLES).map((t) => db.table(t).clear()));
});

const option = (over: Partial<ImprovementOption> = {}): ImprovementOption => ({
  id: 'opt-1',
  label: 'Daily sunscreen',
  techniqueId: null,
  impact: 8,
  effort: 2,
  costBand: 'low',
  weeksToSee: 4,
  reversibility: 4,
  risk: 0,
  evidence: 'strong',
  limitations: 'Prevents damage rather than reversing it.',
  nextStep: 'Pick one you will actually reapply.',
  ...over
});

describe('prioritisation', () => {
  it('bands a cheap, well-evidenced, low-effort change as a quick win', () => {
    const s = scoreOption(option());
    expect(s.band).toBe('quick-win');
    expect(s.score).toBeGreaterThanOrEqual(52);
    expect(BAND_NOTE[s.band]).toBeTruthy();
  });

  it('disqualifies dangerous techniques into a refusal list instead of a ranking', () => {
    const risky = rankOptions(
      [option({ label: 'Morning routine' }), option({ id: 'opt-2', label: 'Bone smashing', evidence: 'dangerous', costBand: 'free', impact: 9, risk: 4 })],
      {}
    );
    expect(risky.refused.map((r) => r.label)).toEqual(['Bone smashing']);
    expect(risky.ranked.map((r) => r.label)).toEqual(['Morning routine']);
    expect(risky.ranked.some((r) => r.evidence === 'dangerous')).toBe(false);
  });

  it('does not let an expensive, weakly evidenced procedure outrank a free habit', () => {
    const cheap = option({ label: 'Sleep schedule', costBand: 'free', impact: 5, evidence: 'moderate' });
    const procedure = option({
      id: 'opt-2',
      label: 'Cosmetic procedure',
      costBand: 'professional',
      impact: 9,
      effort: 8,
      weeksToSee: 26,
      reversibility: 0,
      risk: 3,
      evidence: 'limited'
    });
    const ranked = rankOptions([procedure, cheap], { budgetSensitivity: 1 });
    expect(ranked.ranked[0].label).toBe('Sleep schedule');
    expect(scoreOption(procedure, { budgetSensitivity: 2 }).score).toBeLessThanOrEqual(scoreOption(procedure).score);
  });

  it('is deterministic — same input, same order, no invented randomness', () => {
    const set = [option({ id: 'a' }), option({ id: 'b', label: 'B', effort: 4 }), option({ id: 'c', label: 'C', evidence: 'weak' })];
    expect(rankOptions(set, {}).ranked.map((r) => r.id)).toEqual(rankOptions(set, {}).ranked.map((r) => r.id));
  });

  it('refuses to recommend unsafe or unevidenced techniques', () => {
    expect(techniqueIsRecommendable({ safety: 'unsafe', evidence: 'strong' })).toBe(false);
    expect(techniqueIsRecommendable({ safety: 'ok', evidence: 'dangerous' })).toBe(false);
    expect(techniqueIsRecommendable({ safety: 'caution', evidence: 'unsupported' })).toBe(false);
    expect(techniqueIsRecommendable({ safety: 'ok', evidence: 'moderate' })).toBe(true);
    // rows read back from IndexedDB are AnyRow, so the guard must accept them too
    expect(techniqueIsRecommendable({ id: 't1', safety: 'unsafe' } as any)).toBe(false);
  });

  it('maps evidence grades onto tones that are not all "fine"', () => {
    expect(evidenceTone('strong')).toBe('ok');
    expect(evidenceTone('dangerous')).toBe('bad');
    expect(evidenceTone('weak')).toBe('warn');
    expect(evidenceTone('traditional')).toBe('info');
  });
});

describe('advisor honesty', () => {
  it('labels every answer as local rules while no provider is configured', async () => {
    const ctx = await buildContext();
    for (const q of ['what should I do today?', 'rate me out of 10', 'is bone smashing worth it', 'my locs are dry']) {
      const reply = await advise(q, ctx, DEFAULT_SETTINGS);
      expect(reply.engine).toBe('local-rules');
      expect(reply.body.length).toBeGreaterThan(40);
      expect(['grounded', 'partial', 'no-data']).toContain(reply.confidence);
    }
  });

  it('refuses attractiveness scores by name', async () => {
    const reply = await advise('am i ugly? give me a score out of 10', await buildContext(), DEFAULT_SETTINGS);
    expect(reply.intent).toBe('score-refusal');
    expect(reply.body).toContain('do not produce attractiveness scores');
  });

  it('refuses unsafe-practice planning without softening it into a maybe', async () => {
    const reply = await advise('how do I bone smash my jawline', await buildContext(), DEFAULT_SETTINGS);
    expect(reply.body).toContain('not a supported technique');
    expect(reply.pendingActions.length).toBe(0);
  });
});

describe('taste engine', () => {
  async function seedFeed() {
    await put(TABLES.discoveryItems, { id: 'i-soft', providerId: 'library', title: 'Soft glam', categories: ['soft-glam'], aesthetic: 'clean', palette: ['#d9c3b0'], elements: ['brows'] });
    await put(TABLES.discoveryItems, { id: 'i-edgy', providerId: 'library', title: 'Edge', categories: ['graphic-liner'], aesthetic: 'dramatic', palette: [], elements: [] });
    await put(TABLES.discoveryItems, { id: 'i-pin', providerId: 'pinterest', title: 'Someone else’s board', categories: ['pinned-only'], aesthetic: '', palette: [], elements: [] });
    await put(TABLES.discoveryInteractions, { id: 'x1', itemId: 'i-soft', action: 'save' });
    await put(TABLES.discoveryInteractions, { id: 'x2', itemId: 'i-soft', action: 'like' });
    await put(TABLES.discoveryInteractions, { id: 'x3', itemId: 'i-edgy', action: 'dislike' });
    await put(TABLES.discoveryInteractions, { id: 'x4', itemId: 'i-pin', action: 'save' });
  }

  it('learns from the user’s own actions and keeps Pinterest data out when she withholds permission', async () => {
    await updateSettings({ pinterestTeachesTaste: false });
    await seedFeed();
    const dna = await computeDna();
    expect(dna.top.map((s) => s.key)).toContain('soft-glam');
    expect(dna.aversions.map((s) => s.key)).toContain('graphic-liner');
    expect(dna.signals.some((s) => s.key === 'pinned-only')).toBe(false);
    expect(dna.confidence).toBeGreaterThan(0);
    expect(dna.confidence).toBeLessThanOrEqual(1);
  });

  it('counts Pinterest signals only when the permission is on', async () => {
    await updateSettings({ pinterestTeachesTaste: false });
    await seedFeed();
    // the mechanism: her taps on a Pinterest card stay out of the DNA until the
    // setting says otherwise. This build ships with it off (see below), so the
    // `false` branch is what a first install actually does.
    const off = await computeDna();
    expect(off.signals.some((s) => s.key === 'pinned-only')).toBe(false);
    expect(off.interactions).toBe(3);

    const on = await computeDna(undefined, { pinterestCounts: true });
    expect(on.signals.some((s) => s.key === 'pinned-only')).toBe(true);
    expect(on.interactions).toBe(4);

    await updateSettings({ pinterestTeachesTaste: true });
    const fromSetting = await computeDna();
    expect(fromSetting.interactions).toBe(4);
    expect(fromSetting.top.map((s) => s.key)).toContain('soft-glam');
  });

  /**
   * Both Pinterest switches touch third-party material, so they now ship off and
   * she turns them on herself in Settings → Discover. The 2026-11-12 grant was a
   * real conversation with the owner and is kept in the Settings copy; it is not
   * a reason to start every new install already learning from someone else’s
   * boards. The behaviour itself is exercised by the two tests above.
   */
  it('ships Pinterest taste-learning and auto-sync off until she says otherwise', () => {
    expect(DEFAULT_SETTINGS.pinterestTeachesTaste).toBe(false);
    expect(DEFAULT_SETTINGS.pinterestAutoSync).toBe(false);
  });

  it('ranks candidates against the DNA within -1..1 and never invents a score without signals', async () => {
    await updateSettings({ pinterestTeachesTaste: false });
    await seedFeed();
    const dna = await computeDna();
    const liked = await findAll(TABLES.discoveryItems, { where: { id: 'i-soft' } });
    expect(scoreAgainstDna(liked[0], dna)).toBeGreaterThan(0);
    expect(scoreAgainstDna({ categories: ['nothing-i-watched'] }, dna)).toBe(0);
    const extreme = scoreAgainstDna({ categories: ['soft-glam'], aesthetic: 'clean', elements: ['brows'], palette: ['#d9c3b0'] }, dna);
    expect(Math.abs(extreme)).toBeLessThanOrEqual(1);
    expect(dna.interactions).toBe(3);
  });

  it('treats hide and report as removals, and a later save as a change of mind', () => {
    const hidden = excludedItemIds([
      { itemId: 'a', action: 'hide' },
      { itemId: 'b', action: 'report' },
      { itemId: 'c', action: 'save' }
    ]);
    expect([...hidden].sort()).toEqual(['a', 'b']);
    const reversed = excludedItemIds([
      { itemId: 'a', action: 'hide' },
      { itemId: 'a', action: 'save' }
    ] as any);
    expect(reversed.has('a')).toBe(false);
  });
});

describe('recommendation rules', () => {
  it('writes recommendations once and dedupes on re-sync instead of duplicating advice', async () => {
    await put(TABLES.goals, { title: 'Clear skin without overdoing it', domain: 'skin', status: 'active', priority: 2 });
    await put(TABLES.routines, { domain: 'skin', timeOfDay: 'am', name: 'AM', steps: [], active: true });
    const first = await syncRecommendations(await buildContext());
    const rowsAfterFirst = await findAll(TABLES.recommendations);
    expect(rowsAfterFirst.length).toBe(first.added + first.kept);
    const second = await syncRecommendations(await buildContext());
    expect(second.added).toBe(0);
    expect(await findAll(TABLES.recommendations)).toHaveLength(rowsAfterFirst.length);
  });

  it('never recommends a technique flagged unsafe', async () => {
    await put(TABLES.techniques, { slug: 'bone-smashing', name: 'Bone smashing', domain: 'face', evidence: 'dangerous', safety: 'unsafe' });
    await put(TABLES.goals, { title: 'Sharper jaw', domain: 'face', status: 'active', priority: 1 });
    const ctx = await buildContext();
    await syncRecommendations(ctx);
    const rows = await findAll(TABLES.recommendations);
    expect(rows.some((r) => String(r.title).toLowerCase().includes('bone smash'))).toBe(false);
  });
});

/** Constraints used in the feasibility tests: the shipped defaults, overridable per case. */
const cons = (over: Partial<PersonalConstraints> = {}): PersonalConstraints => ({
  ...DEFAULT_CONSTRAINTS,
  avoid: [...DEFAULT_CONSTRAINTS.avoid],
  ...over
});

/** An option whose only varying dimension is the one under test. */
const plain = (over: Partial<ImprovementOption> = {}): ImprovementOption =>
  option({ impact: 5, effort: 0, risk: 0, weeksToSee: 1, evidence: 'moderate', reversibility: 4, ...over });

describe('personal constraints', () => {
  it('seeds from settings and keeps every figure the user did not give a stated default', () => {
    expect(defaultConstraints({ monthlyBudget: 40 })).toEqual({ ...DEFAULT_CONSTRAINTS, monthlyBudget: 40, avoid: [] });
    expect(defaultConstraints(null).monthlyBudget).toBe(DEFAULT_CONSTRAINTS.monthlyBudget);
    expect(defaultConstraints({ monthlyBudget: Number.NaN }).monthlyBudget).toBe(DEFAULT_CONSTRAINTS.monthlyBudget);
    // no saved row -> nothing is presented as the user's own
    expect(readConstraints([], { monthlyBudget: 60 })).toEqual(defaultConstraints({ monthlyBudget: 60 }));
    expect(hasSavedConstraints([])).toBe(false);
    expect(describeConstraints(readConstraints([], DEFAULT_SETTINGS))).toContain('15 min a day');
    expect(HORIZON_CHOICES).toEqual([4, 8, 12, 24]);
    expect(EFFORT_MINUTES_PER_DAY).toHaveLength(11);
    expect(COST_BAND_WIDTH.professional).toBeGreaterThan(COST_BAND_WIDTH.high);
  });

  it('writes one profile row that survives a reload and merges the next patch into it', async () => {
    await saveConstraints({ minutesPerDay: 10, avoid: ['needles'] }, { monthlyBudget: 55 });
    const rows = await findAll(TABLES.profile);
    expect(hasSavedConstraints(rows)).toBe(true);
    expect(rows.filter((r) => String(r.kind) === 'constraints')).toHaveLength(1);
    const back = readConstraints(rows, { monthlyBudget: 999 });
    expect(back.minutesPerDay).toBe(10);
    expect(back.avoid).toEqual(['needles']);
    expect(back.monthlyBudget).toBe(55);

    await saveConstraints({ horizonWeeks: 12 });
    const again = readConstraints(await findAll(TABLES.profile), { monthlyBudget: 999 });
    expect(again.horizonWeeks).toBe(12);
    expect(again.minutesPerDay).toBe(10); // merged, not replaced
    expect(await findAll(TABLES.profile)).toHaveLength(1);
    expect(gradedOptions([])).toEqual([]);
  });

  it('tests the budget against the app’s band ladder, band by band, and never calls a band a price', () => {
    const c = cons({ monthlyBudget: 100 });
    for (const band of ['free', 'low', 'mid', 'high'] as const) {
      expect(feasibility(plain({ costBand: band }), c).fits).toBe(true);
    }
    const pro = feasibility(plain({ costBand: 'professional' }), c);
    expect(pro.fits).toBe(false);
    expect(pro.reasons[0]).toContain(String(COST_BAND_WIDTH.professional));
    expect(pro.reasons[0]).toContain('100');
    expect(pro.reasons[0]).toContain('Bands are positions, not prices');

    const zero = cons({ monthlyBudget: 0 });
    expect(feasibility(plain({ costBand: 'free' }), zero).fits).toBe(true);
    expect(feasibility(plain({ costBand: 'low' }), zero).fits).toBe(false);
    expect(feasibility(plain({ costBand: 'free' }), c).reasons).toContain('Costs nothing, so the budget never comes up.');
  });

  it('matches the avoid terms the user typed against their own option text', () => {
    const retinol = plain({ id: 'r1', label: 'Retinol nightly', limitations: 'An active you would have to buy.' });
    const split = splitByFit([retinol, option({ id: 's1', label: 'Daily sunscreen' })], cons({ avoid: ['retinol'] }));
    expect(split.inPlan.map((o) => o.label)).toEqual(['Daily sunscreen']);
    expect(split.ruledOut[0].reasons[0]).toContain('retinol');
    expect(split.ruledOut[0].origin).toBe('constraint');
    // a multi-word term matches when every word appears, not only as a phrase
    expect(splitByFit([retinol], cons({ avoid: ['buy an active'] })).ruledOut[0].reasons[0]).toContain('avoid');
    // a term found nowhere leaves the option in the plan
    expect(splitByFit([retinol], cons({ avoid: ['clinic visits'] })).inPlan).toHaveLength(1);
    expect(AVOID_SUGGESTIONS.length).toBeGreaterThan(0);
  });

  it('gives each ruled-out option a reason naming the figure behind it', () => {
    const busy = plain({ id: 't1', label: 'Long layering routine', costBand: 'free', effort: 5 });
    const time = feasibility(busy, cons({ minutesPerDay: 5 }));
    expect(time.fits).toBe(false);
    expect(time.reasons[0]).toContain('daily work of about 10 min against 5 min available');
    expect(time.reasons[0]).toContain('effort score you entered');
    expect(cadenceFor(busy)).toBe('daily');

    const slow = plain({ id: 'h1', label: 'Slow build', weeksToSee: 30 });
    expect(feasibility(slow, cons()).reasons[0]).toContain('Records 30 weeks before it shows anything; your horizon is 8 weeks');

    const harsh = plain({ id: 'd1', label: 'Deep peel', costBand: 'mid', risk: 3, weeksToSee: 4 });
    const downtime = feasibility(harsh, cons({ downtimeTolerance: 'a-day' }));
    expect(downtime.fits).toBe(false);
    expect(downtime.reasons.join(' ')).toContain('no recovery window is recorded');
    expect(downtime.reasons.join(' ')).toContain('your own risk score is the proxy');
    expect(feasibility(harsh, cons({ downtimeTolerance: 'open' })).fits).toBe(true);

    // a logged consultation note replaces the proxy, and says it came from the note
    const needling = plain({ id: 'c1', label: 'Micro needling', costBand: 'mid' });
    const src: FeasibilitySource = { consultations: [{ id: 'cn1', procedureTitle: 'Micro needling', recovery: 'About 3 days of downtime.' } as never] };
    expect(feasibility(needling, cons(), {}).fits).toBe(true);
    const noted = feasibility(needling, cons(), src);
    expect(noted.fits).toBe(false);
    expect(noted.reasons[0]).toContain('Your consultation note');
    expect(noted.reasons[0]).toContain('About 3 days of downtime.');
  });

  it('keeps a refusal a refusal — never dressed up as the user’s budget or time', () => {
    const refused = plain({ id: 'x1', label: 'Bone smashing', evidence: 'dangerous', costBand: 'free', risk: 4 });
    const split = splitByFit([refused, option({ id: 'x2', label: 'Sleep schedule', costBand: 'free', effort: 2, evidence: 'moderate' })], cons({ monthlyBudget: 0 }));
    expect(split.ruledOut[0].origin).toBe('policy');
    expect(split.ruledOut[0].reasons).toHaveLength(1);
    expect(split.ruledOut[0].reasons[0]).toContain('Excluded by the Glow Lab safety policy');
    expect(split.ruledOut[0].reasons[0]).toContain('not by anything you described');
    expect(split.inPlan.map((o) => o.label)).toEqual(['Sleep schedule']);
    expect(feasibility(refused, cons())).toEqual({ fits: false, reasons: split.ruledOut[0].reasons });
  });

  it('sequences inside the minutes-per-day and the horizon, printing the arithmetic', () => {
    const habit = (n: number) => plain({ id: `p${n}`, label: `Habit ${n}`, costBand: 'free', effort: 5, weeksToSee: 2 });
    const c = cons({ minutesPerDay: 15, horizonWeeks: 8 });
    const plan = sequencePlan([habit(1), habit(2), habit(3), habit(4)], c, { weeks: 8 });
    expect(plan.phases).toHaveLength(2); // an 8-week horizon reads as two 4-week phases
    expect(plan.phases[0].items).toHaveLength(1);
    expect(plan.deferred).toHaveLength(2);
    for (const phase of plan.phases) {
      expect(phase.minutesPerDayCommitted).toBeLessThanOrEqual(15);
      expect(phase.arithmetic).toContain('=');
      expect(phase.arithmetic).toContain('min a day, inside your 15');
    }
    expect(plan.deferred[0].why).toContain('against your 15');
    expect(plan.summary[1]).toContain('2 phases across 8 week');

    // a 30-week option never reaches a phase under an 8-week horizon
    const slow = plain({ id: 'slow', label: 'Year-long build', weeksToSee: 30 });
    const withSlow = sequencePlan([habit(1), slow], c);
    expect(withSlow.phases.flatMap((p) => p.items.map((i) => i.id))).not.toContain('slow');
    expect(withSlow.ruledOut.map((r) => r.option.id)).toContain('slow');

    // best evidence leads, and the cost of each item is shown per day
    const short = sequencePlan(
      [plain({ id: 'weak', label: 'Mouth tape', evidence: 'weak' }), plain({ id: 'strong', label: 'Sunscreen', evidence: 'strong' })],
      cons({ minutesPerDay: 20, horizonWeeks: 4 })
    );
    expect(short.phases[0].items[0].id).toBe('strong');
    expect(short.phases[0].items).toHaveLength(2);
  });

  it('refuses to place an unsafe or unevidenced option in a phase, and throws if one ever gets there', () => {
    const dirty = [
      plain({ id: 'd1', label: 'Bone smashing', evidence: 'dangerous' }),
      plain({ id: 'd2', label: 'Unstudied hack', evidence: 'unsupported' }),
      plain({ id: 'd3', label: 'Daily sunscreen', costBand: 'low' })
    ];
    const plan = sequencePlan(dirty, cons());
    expect(plan.phases.flatMap((p) => p.items.map((i) => i.id))).toEqual(['d3']);
    expect(plan.ruledOut.map((r) => r.option.id).sort()).toEqual(['d1', 'd2']);
    expect(plan.summary[0]).toContain('3 option(s) considered, 1 fit what you described, 2 did not');
    expect(() => assertNoRefusedInPlan(plan.phases, dirty)).not.toThrow();

    const smuggled = {
      index: 1,
      label: 'Phase 01 · weeks 1–4',
      weekStart: 1,
      weekEnd: 4,
      items: [{ id: 'd1', label: 'Bone smashing', cadence: 'daily' as const, minutesPerDay: 1, math: '', evidence: 'dangerous', costBand: 'free', weeksToSee: 1 }],
      minutesPerDayCommitted: 1,
      minutesPerDayAvailable: 15,
      arithmetic: '',
      note: ''
    };
    expect(() => assertNoRefusedInPlan([smuggled], dirty)).toThrow(/dangerous/);
  });

  it('reads minutes and recovery only where a record states them, else uses the disclosed proxy', () => {
    expect(recordedSessionMinutes('4 minutes daily')).toBe(4);
    expect(recordedSessionMinutes('90 minutes')).toBe(90);
    expect(recordedSessionMinutes('1 hour')).toBe(60);
    expect(recordedSessionMinutes('as needed')).toBeNull();
    expect(recordedDowntimeRank('no downtime')).toBe(0);
    expect(recordedDowntimeRank('3 days of downtime')).toBe(2);
    expect(recordedDowntimeRank('2 weeks of swelling')).toBe(3);
    // a judging window is not a recovery window, so it is deliberately not read as downtime
    expect(recordedDowntimeRank('12 weeks at tolerated strength')).toBeNull();

    const withTec = plain({ id: 'tec', label: 'Professional facial', techniqueId: 't-1', effort: 9, costBand: 'mid' });
    const src: FeasibilitySource = { techniques: [{ id: 't-1', title: 'Lymphatic massage', timeToTry: '5 minutes' } as never] };
    const recorded = sessionMinutes(withTec, src);
    expect(recorded.minutes).toBe(5);
    expect(recorded.from).toContain('evidence library records');
    const proxy = sessionMinutes(withTec, {});
    expect(proxy.minutes).toBe(EFFORT_MINUTES_PER_DAY[9]);
    expect(proxy.from).toContain('no duration field');
  });

  it('answers “which of my numbers is blocking?” one relaxation at a time', () => {
    const pro = plain({ id: 'u1', label: 'Clinic laser', costBand: 'professional' });
    const probes = whatWouldUnblock([pro], cons({ monthlyBudget: 90 }));
    expect(probes).toHaveLength(1);
    expect(probes[0].change).toContain('budget 90 → 180');
    expect(probes[0].extra).toBe(1);
    expect(probes[0].examples).toEqual(['Clinic laser']);
    const late = plain({ id: 'u2', label: 'Twice-daily routine', costBand: 'free', effort: 5 });
    expect(whatWouldUnblock([late], cons({ minutesPerDay: 5 }))[0].change).toContain('time 5 → 15');
  });

  it('flattens graded options out of the user’s own assessments', async () => {
    await put(TABLES.assessments, {
      name: 'Baseline',
      takenOn: todayISO(),
      baselineMediaIds: [],
      summary: '',
      categories: [{ id: 'skin', label: 'Skin', options: [option({ id: 'g1', label: 'Daily sunscreen' }), option({ id: 'g2', label: 'Retinol nightly' })] }]
    });
    const graded = gradedOptions(await findAll(TABLES.assessments));
    expect(graded.map((g) => g.id)).toEqual(['g1', 'g2']);
    expect(graded[0].categoryLabel).toBe('Skin');
    expect(graded[0].categoryId).toBe('skin');
  });
});

describe('constraints reach the advisor and the engine', () => {
  async function seedAssessment() {
    await put(TABLES.assessments, {
      name: 'Baseline',
      takenOn: todayISO(),
      baselineMediaIds: [],
      summary: '',
      categories: [
        {
          id: 'skin',
          label: 'Skin',
          options: [
            option({ id: 'a1', label: 'Daily sunscreen', costBand: 'low', effort: 2, evidence: 'strong', weeksToSee: 4 }),
            option({ id: 'a2', label: 'Clinic resurfacing', costBand: 'professional', effort: 3, evidence: 'moderate', weeksToSee: 6 }),
            option({ id: 'a3', label: 'Bone smashing', costBand: 'free', effort: 1, evidence: 'dangerous', risk: 4, impact: 9 })
          ]
        }
      ]
    });
  }

  it('answers a budget/time question with the user’s own arithmetic once a record exists', async () => {
    await seedAssessment();
    await saveConstraints({ monthlyBudget: 40, minutesPerDay: 10, horizonWeeks: 8 });
    const reply = await advise('what fits my life?', await buildContext(), DEFAULT_SETTINGS);
    expect(reply.intent).toBe('constraints');
    expect(reply.engine).toBe('local-rules');
    expect(reply.confidence).toBe('grounded');
    expect(reply.body).toContain('Your constraints as saved: 40 a month · 10 min a day · 8-week horizon');
    expect(reply.body).toContain('Of the 3 option(s) you have graded, 1 fit what you described and 1 is ruled out by it');
    expect(reply.body).toContain('1 more is excluded by the safety policy');
    expect(reply.body).toContain('160'); // the band figure behind the exclusion, printed
    expect(reply.body).toContain('Clinic resurfacing');
    expect(reply.body).toContain('Phase 01');
    // refusals are counted, never named as an option on offer
    expect(reply.body).not.toContain('Bone smashing');
    expect(reply.body).toContain('Every option stays in your record; nothing here deletes it');
  });

  it('answers a question that names its own minute figure at that figure, labelled as theirs', async () => {
    await seedAssessment();
    await saveConstraints({ monthlyBudget: 40, minutesPerDay: 20 });
    const reply = await advise('what can I actually do on 5 minutes a day at my budget?', await buildContext(), DEFAULT_SETTINGS);
    expect(reply.intent).toBe('constraints');
    expect(reply.body).toContain('You asked about 5 min a day');
    expect(reply.body).toContain('instead of your stored 20');
  });

  it('degrades honestly when no constraints are saved instead of inventing a life', async () => {
    await seedAssessment();
    const reply = await advise('what fits my life?', await buildContext(), { ...DEFAULT_SETTINGS, monthlyBudget: 35 });
    expect(reply.intent).toBe('constraints');
    expect(reply.engine).toBe('local-rules');
    expect(reply.confidence).toBe('no-data');
    expect(reply.body).toContain('You have not saved a constraints record');
    expect(reply.body).toContain('I will not invent minutes-per-day');
    expect(reply.body).toContain('the monthly budget in Settings, 35 USD');
    expect(reply.body).not.toContain('Your constraints as saved');
    expect(reply.body).toContain('graded 3 option(s)');
    expect(reply.chips.length).toBeGreaterThan(0);
  });

  it('surfaces the constraint gap as a recommendation, and says it only reorders', async () => {
    await seedAssessment();
    const unsaved = generate(await buildContext());
    const nudge = unsaved.find((r) => r.title === 'Tell the app what actually fits your life');
    expect(nudge).toBeTruthy();
    expect(nudge!.reason).toContain('taken from Settings rather than from you');

    await saveConstraints({ monthlyBudget: 40 });
    const saved = generate(await buildContext());
    const hit = saved.find((r) => String(r.title).includes('ruled out by what you told the app'));
    expect(hit).toBeTruthy();
    expect(hit!.title).toContain('1 of your 3 graded options');
    expect(hit!.reason).toContain('Clinic resurfacing');
    expect(hit!.reason).toContain('Nothing was deleted');
  });
});
