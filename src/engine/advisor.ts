import type { AppSettings } from '../state/settings';
import type { AnyRow } from '../db/schema';
import { generate, todayFocus, type EngineContext } from './recommendations';
import { techniqueIsRecommendable } from './prioritisation';
import {
  describe as describeConstraints,
  gradedOptions,
  hasSavedConstraints,
  readConstraints,
  sequencePlan,
  sessionMinutes,
  splitByFit,
  whatWouldUnblock,
  type FeasibilitySource
} from './constraints';

/**
 * Glow Advisor, local-rules engine (spec Part 26 + Part 1 #13).
 *
 * This is a deterministic responder over the user's own records plus the
 * evidence library. It is labelled 'local-rules' in every message row so no
 * screenshot can imply an AI answered. If a provider key is later configured,
 * `engine` becomes 'local-rules+provider' and the provider text is appended,
 * clearly separated — the rules still decide what is safe to say.
 */

export interface AdvisorReply {
  body: string;
  citations: { label: string; kind: string; id: string }[];
  pendingActions: { id: string; label: string; table: string; payload: Record<string, unknown>; accepted: boolean }[];
  chips: string[];
  engine: 'local-rules' | 'local-rules+provider';
  intent: string;
  confidence: 'grounded' | 'partial' | 'no-data';
}

const has = (q: string, ...words: string[]) => words.some((w) => q.includes(w));
const days = (iso?: string | null) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : Infinity);

/** Renders a saved profile section as readable sentences, never raw JSON. */
function profileSummary(row: AnyRow | undefined): string {
  if (!row) return '';
  const d = (row.data ?? {}) as Record<string, unknown>;
  const parts = Object.entries(d)
    .filter(([, v]) => v !== '' && v !== null && v !== undefined && !Array.isArray(v) || (Array.isArray(v) && v.length))
    .map(([k, v]) => {
      const label = k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
      return Array.isArray(v) ? `${label}: ${v.join(', ')}` : `${label}: ${String(v)}`;
    });
  return parts.join('. ');
}

function ctxLine(ctx: EngineContext) {
  const parts = [
    `${ctx.goals.filter((g) => g.status === 'active').length} active goal(s)`,
    `${ctx.plans.filter((p) => p.status === 'active').length} active plan(s)`,
    `${ctx.routines.filter((r) => r.active).length} routine(s)`,
    `${ctx.products.filter((p) => p.status === 'own').length} product(s) owned`,
    `${ctx.clothing.length} garment(s) catalogued`,
    `${ctx.progress.length} progress entr(ies)`
  ];
  return parts.join(', ');
}

/** Questions the feasibility layer owns. Deliberately phrase-shaped, so an
 *  ordinary hair or skin question still routes to its own rule. */
const CONSTRAINT_WORDS = [
  'minutes a day',
  'minute a day',
  'mins a day',
  'minutes per day',
  'time a day',
  'time per day',
  'short on time',
  'no time for',
  'budget',
  'afford',
  'affordable',
  'worth it at my',
  'tight money',
  'free options only',
  'cost band',
  'downtime',
  'recovery time',
  'no downtime',
  'what fits',
  'fits my life',
  'ruled out',
  'constraint',
  'realistic for me',
  'what can i actually do',
  'only have'
];

const moneyP = (q: string) => has(q, 'budget', 'afford', 'affordable', 'money', 'worth it', 'cost band', 'free options', 'pay');
const timeP = (q: string) => has(q, 'minute', 'time', 'busy', 'short on', 'only have', 'realistic');

/** How many ruled-out items to spell out, from the user's own bluntness setting. */
const detailCount = (bluntness: AppSettings['advisorBluntness']) => (bluntness === 'gentle' ? 2 : bluntness === 'technical' ? 6 : 3);

const SAFETY: { match: string[]; title: string; body: string; techniqueSlug: string }[] = [
  {
    match: ['bone smash', 'bone-smashing', 'smashing my face', 'facial bone exercise', 'bone remodeling', 'bone remodelling'],
    title: 'Bone smashing',
    techniqueSlug: 'bone-smashing',
    body: 'No. Bone smashing is not a supported technique and Glow Lab will not plan it. Wolff’s law describes bone adapting to habitual skeletal load — it has never been demonstrated to produce controlled cosmetic facial bone change in an adult, and the “results” online are swelling, lighting, angle and survivorship. The real outcomes in the literature are fracture, permanent asymmetry, nerve injury and chronic TMJ or sinus damage, some of which cannot be undone. If you want a changed jawline or cheekbone, the honest ladder is: photography and angle → hair framing → contour → brows → (only if you want it) a consultation with a qualified clinician about fillers or implants, with two consultations before anything permanent.'
  },
  {
    match: ['mewing', 'tongue posture', 'orthotropics', 'jawline exercise'],
    title: 'Mewing / tongue posture',
    techniqueSlug: 'mewing',
    body: 'Mewing does not reshape an adult mandible. The orthotropics literature concerns growing children and is contested; there is no controlled adult study showing skeletal change from tongue posture. Resting your tongue properly is fine and may ease your airway and neck comfort — treat that as the benefit, not a jawline. Forceful pressing produces jaw pain and clicking. For a visibly sharper lower face the working levers are posture, body composition, camera distance, contour, and beard/hair framing if relevant.'
  },
  {
    match: ['steroid', 'anabolic', 'sarms', 'test without a doctor', 'hormone cycle', 'peptide cycle'],
    title: 'Non-prescribed hormones',
    techniqueSlug: 'unsupervised-steroids',
    body: 'Glow Lab will not help with non-prescribed anabolic or hormone use. Beyond the cardiac, hepatic and endocrine harms, it is usually self-defeating for appearance: nodular acne that scars, accelerated pattern hair loss, gynaecomastia that typically needs surgery, and suppression that takes months to recover. If you are already using something, an endocrinologist is the right next step — not a forum, and not stopping cold without advice.'
  },
  {
    match: ['crash diet', 'eat 800 calories', 'starve', 'detox tea', 'cut water before', 'water cut', 'dehydrate for photos'],
    title: 'Extreme restriction and water cutting',
    techniqueSlug: 'extreme-calorie-restriction',
    body: 'Both make you look worse on a timeline you can measure. Aggressive restriction costs lean mass first, which flattens shape, and commonly triggers telogen effluvium — shedding three months later. Rebound is the norm. Severe water and sodium cutting before an event is a real route to emergency care: electrolyte disturbance, arrhythmia, collapse. What actually works for looking sharp on a date: sleep two nights beforehand, normal hydration, less alcohol, consistent sodium, and a fitted garment. If the urge to restrict feels compulsive rather than practical, that is worth telling a clinician.'
  },
  {
    match: ['inject myself', 'diy filler', 'buy filler online', 'self botox', 'filler at home', 'teeth filing', 'file my teeth', 'diy veneer'],
    title: 'Self-administered procedures',
    techniqueSlug: 'diy-enamel-filing',
    body: 'No — these are the two requests I refuse outright. Facial self-injection can blind within minutes or cause skin death within hours, with no reversal kit and no one to call; counterfeit product is common. Filing your own teeth removes enamel that never grows back, and the internet “before/after” sets are lighting, angle and cropping. Both have supervised versions: a qualified injector with an emergency plan, or bonding/orthodontics/veneers through a dentist.'
  }
];

/** Rule dispatch. Order matters: safety and refusal rules answer first. */
export async function advise(rawQuestion: string, ctx: EngineContext, s: AppSettings): Promise<AdvisorReply> {
  const q = rawQuestion.toLowerCase().trim();
  const base = { chips: [] as string[], citations: [] as AdvisorReply['citations'], pendingActions: [] as AdvisorReply['pendingActions'], engine: 'local-rules' as const };

  for (const sf of SAFETY) {
    if (!has(q, ...sf.match)) continue;
    const tec = ctx.techniques.find((t) => t.slug === sf.techniqueSlug);
    return {
      ...base,
      intent: 'safety-refusal',
      confidence: 'grounded',
      body: sf.body,
      citations: tec ? [{ label: tec.title, kind: 'technique', id: tec.id }] : [],
      chips: ['What is safe instead?', 'Show the evidence grading']
    };
  }

  if (has(q, 'rate me', 'score me', 'how attractive', 'am i ugly', 'am i hot', 'what am i out of 10', 'out of 10', 'how rare am i', 'looksmaxx rating')) {
    return {
      ...base,
      intent: 'score-refusal',
      confidence: 'grounded',
      body: 'I do not produce attractiveness scores, and no number anyone shows you from a photo is a measurement — it is a stranger’s taste formatted as data. There is no validated facial scoring instrument, and a single number is useless for actually changing anything. What I can do: read your assessment bands, tell you which changes have the best evidence-to-cost ratio, and show your own progress photos side by side under matched conditions. If the question behind the question is “am I okay”, the honest answer is that the app cannot resolve that and neither can a score.',
      citations: [],
      chips: ['Show my priorities', 'Compare my progress photos', 'What should I work on first?']
    };
  }

  if (has(q, 'diagnos', 'is this cancer', 'mole', 'lump', 'infection', 'should i see a doctor', 'rash that', 'pain in my', 'bleeding', 'fever')) {
    return {
      ...base,
      intent: 'medical-referral',
      confidence: 'grounded',
      body: 'That is a clinical question, and photograph-based reasoning here cannot answer it. Glow Lab describes what is visible and grades the evidence behind cosmetic options; it does not diagnose. Please have a clinician look — especially for a changing mole, a spreading or painful rash, swelling, pus, or anything that has persisted past a few weeks. If it helps, record the timeline here first: date, appearance, what changed, what you used. Bringing that to the appointment is genuinely useful and is not the same as self-diagnosing.',
      chips: ['Log this as an observation', 'Prepare for the appointment']
    };
  }

  const focus = await todayFocus();
  if (has(q, 'today', 'right now', 'what should i do', 'next step', 'focus', 'start')) {
    const top = generate(ctx).slice(0, 3);
    const lines = focus.length
      ? focus.slice(0, 5).map((f) => `• ${f.label} — ${f.kind}`)
      : ['• Nothing is scheduled or due in your records today.'];
    return {
      ...base,
      intent: 'today',
      confidence: focus.length ? 'grounded' : 'no-data',
      body: `Today, from your own calendar, routines and plans:\n\n${lines.join('\n')}\n\n${top.length ? `Highest-value items waiting on you: ${top.map((t) => `“${t.title}”`).join('; ')}.` : 'No open recommendation is currently above the line.'}\n\nYour records right now: ${ctxLine(ctx)}.`,
      citations: top.map((t) => ({ label: t.title, kind: t.linkTable, id: t.linkId })),
      pendingActions: top.slice(0, 2).map((t) => ({ id: 'pa' + t.domain, label: t.title, table: t.linkTable, payload: { from: 'advisor', domain: t.domain }, accepted: false })),
      chips: ['Why these?', 'Show all recommendations', 'Add a task for today']
    };
  }

  // Feasibility (Part 11). This rule is where `s` is actually read: the Settings
  // budget seeds the constraints record, and the bluntness setting decides how
  // much of the ruled-out list is spelled out.
  if (has(q, ...CONSTRAINT_WORDS)) {
    const saved = hasSavedConstraints(ctx.profile);
    const constraints = readConstraints(ctx.profile, s);
    const graded = gradedOptions(ctx.assessments ?? []);
    const src: FeasibilitySource = { techniques: ctx.techniques, consultations: ctx.consultations };
    const split = splitByFit(graded, constraints, src);
    const blocked = split.ruledOut.filter((r) => r.origin === 'constraint');
    const refused = split.ruledOut.filter((r) => r.origin === 'policy');
    const show = detailCount(s.advisorBluntness);
    // A figure named in the question is answered at that figure — labelled as theirs,
    // not silently swapped for the stored one.
    const asked = Number((q.match(/(\d+)\s*(?:min|minutes)\b/) ?? [])[1] ?? NaN);
    const askedMinutes = Number.isFinite(asked) && asked > 0 ? Math.min(600, Math.round(asked)) : null;
    const lens = askedMinutes !== null ? { ...constraints, minutesPerDay: askedMinutes } : constraints;
    const lensSplit = askedMinutes === null ? split : splitByFit(graded, lens, src);
    const lensBlocked = lensSplit.ruledOut.filter((r) => r.origin === 'constraint');
    const lifestyleNote = s.lifestyle.trim() ? `Your saved lifestyle note: “${s.lifestyle.trim().slice(0, 160)}”.` : '';

    if (!saved) {
      const unfiltered = generate(ctx).slice(0, 3);
      return {
        ...base,
        intent: 'constraints',
        confidence: 'no-data',
        body: `You have not saved a constraints record, so I have nothing of yours to filter against — and I will not invent minutes-per-day, downtime tolerance or a horizon and present them as your life.\n\nWhat the app actually holds: the monthly budget in Settings, ${s.monthlyBudget} ${s.currency}. That is a default you can change, not a figure you gave me${s.lifestyle.trim() ? `, and the only lifestyle note on file is “${s.lifestyle.trim().slice(0, 140)}”` : ', with no lifestyle note recorded'}.\n\nSo the honest answer to a budget or time question is: unranked-by-constraints. ${graded.length ? `You have graded ${graded.length} option(s); none are being excluded on feasibility grounds because there is nothing to exclude them with.` : 'And you have not graded any options in an assessment yet, so there is nothing to filter at all.'}\n\nWithout constraints the ranking still runs on evidence, cost band, risk and reversibility. Highest from your own records right now: ${unfiltered.length ? unfiltered.map((r) => `“${r.title}” (score ${r.score}, ${r.costBand})`).join('; ') : 'nothing is currently above the line.'}\n\nFill in Profile → “What actually fits your life” and this answer changes to your arithmetic. It only reorders and annotates — it never deletes options from your record.`,
        citations: unfiltered.map((r) => ({ label: r.title, kind: r.linkTable, id: r.linkId })),
        chips: ['What can I do on 10 minutes a day?', 'Is this worth it at my budget?', 'What data do you have on me?']
      };
    }

    const focus = moneyP(q) && !timeP(q) ? 'money' : timeP(q) && !moneyP(q) ? 'time' : 'both';
    const lead =
      focus === 'money'
        ? `At ${lens.monthlyBudget} ${s.currency} a month, cost band is checked against the app's band ladder (free 4 · low 18 · mid 42 · high 90 · professional 160). Bands are positions on that ladder, not prices — the app stores no prices.`
        : focus === 'time'
          ? `At ${lens.minutesPerDay} minutes a day, options are checked by how they repeat: a daily habit needs to fit inside ${lens.minutesPerDay} min; a weekly or monthly task is spread across the week; a one-off appointment is spread across the ${lens.horizonWeeks}-week window. There is no duration field on an option, so minutes come from your effort score unless the linked technique records them.`
          : `Your constraints as saved: ${describeConstraints(constraints)}.${askedMinutes !== null ? ` You asked about ${askedMinutes} min a day, so the numbers below use that instead of your stored ${constraints.minutesPerDay}.` : ''}`;
    const fits = lensSplit.inPlan;
    const plan = sequencePlan(fits, lens, { weeks: lens.horizonWeeks, src });
    const firstPhase = plan.phases[0];
    const probes = whatWouldUnblock(graded, lens, src);

    const fitLines = fits
      .slice(0, show)
      .map((o, i) => {
        const m = sessionMinutes(o, src);
        return `${i + 1}. “${o.label}” — about ${m.minutes} min ${o.costBand === 'professional' || o.risk >= 3 ? 'once' : 'per sitting'}, shows in ${o.weeksToSee} week(s), band ${o.costBand}, evidence ${o.evidence}.`;
      })
      .join('\n');
    const outLines = lensBlocked
      .slice(0, show)
      .map((r) => `• “${r.option.label}” — ${r.reasons[0]}`)
      .join('\n');

    const blocks: string[] = [
      lead,
      `Of the ${graded.length} option(s) you have graded, ${fits.length} fit what you described${
        lensBlocked.length ? ` and ${lensBlocked.length} ${lensBlocked.length === 1 ? 'is' : 'are'} ruled out by it` : ''
      }${
        refused.length
          ? `. ${refused.length} more ${refused.length === 1 ? 'is' : 'are'} excluded by the safety policy, not by you — they are never ranked or proposed`
          : ''
      }.`,
      fitLines
        ? `Inside your constraints, best-evidenced first:\n${fitLines}`
        : graded.length
          ? 'Nothing you have graded fits these numbers. That is a real answer, not a rounding issue — the reasons are below.'
          : 'You have not graded any options in an assessment yet, so there is nothing to test against your constraints. The fourteen-category assessment in the Command Center is where options come from.',
      outLines
        ? `Ruled out, and why:\n${outLines}`
        : lensBlocked.length === 0 && graded.length
          ? 'Nothing you have graded is excluded by your constraints right now.'
          : '',
      firstPhase && plan.phases.some((p) => p.items.length)
        ? `Sequenced over ${plan.phases.length} phase(s) inside ${lens.horizonWeeks} weeks: ${firstPhase.label} — ${firstPhase.arithmetic}. ${plan.summary[0]}${
            plan.deferred.length ? ` ${plan.deferred.length} fitting option(s) had no room left in the horizon.` : ''
          }`
        : '',
      probes.length
        ? `The number doing the most blocking: ${probes[0].change} alone would let ${probes[0].extra} more back in (${probes[0].examples.join(', ')}).`
        : 'No single relaxation of your figures would let anything else in — whatever is excluded is excluded by more than one of them.',
      lifestyleNote,
      'These values change ordering and annotation only. Every option stays in your record; nothing here deletes it.'
    ].filter(Boolean);

    return {
      ...base,
      intent: 'constraints',
      confidence: graded.length ? 'grounded' : 'partial',
      body: blocks.join('\n\n'),
      citations: [
        ...fits.slice(0, 3).map((o) => ({ label: String(o.label), kind: 'assessments', id: o.id })),
        ...lensBlocked.slice(0, 2).map((r) => ({ label: String(r.option.label), kind: 'assessments', id: r.option.id }))
      ],
      chips: ['Sequence it week by week', 'What is ruled out and why?', 'Which of my numbers is blocking most?']
    };
  }

  if (has(q, 'hair', 'locs', 'locks', 'retwist', 'braid', 'edges', 'fringe', 'bangs', 'cut', 'color', 'colour', 'length', 'density', 'shed', 'thinning')) {
    const hair = ctx.profile.find((p) => p.kind === 'hair');
    const records = ctx.hairRecords.slice().sort((a, b) => String(b.doneOn).localeCompare(String(a.doneOn)));
    const last = records[0];
    const tec = ctx.techniques.filter((t) => t.domain === 'hair' && techniqueIsRecommendable(t));
    const facts = profileSummary(hair);
    return {
      ...base,
      intent: 'hair',
      confidence: hair ? 'grounded' : 'partial',
      body: `${hair ? `Your saved hair profile: ${facts}\n\n` : 'You have not saved a hair profile yet, so everything below is generic — the Hair Studio profile takes two minutes and makes the rest specific.\n\n'}${last ? `Most recent hair record: ${last.label || last.kind} on ${last.doneOn}${days(last.doneOn as string) < 400 ? ` (${days(last.doneOn as string)} days ago)` : ''}.` : 'No hair records logged yet.'}\n\nThe three levers with actual support, in order of cost-effectiveness: (1) reduce tension and friction — ponytail position, night wrap, combing dry hair; this is where length retention actually comes from; (2) keep a standardised measurement and photo cadence so you can tell retention from growth; (3) only then consider actives — minoxidil has real evidence for pattern thinning, supplements mostly do not unless a deficiency is confirmed.\n\n${tec.length ? `Evidence-graded hair techniques available: ${tec.slice(0, 4).map((t) => `${t.title} (${t.evidence})`).join(', ')}.` : ''}`,
      citations: [...(last ? [{ label: String(last.label || last.kind), kind: 'hairRecord', id: last.id }] : []), ...tec.slice(0, 3).map((t) => ({ label: t.title, kind: 'technique', id: t.id }))],
      chips: ['Explain retention vs growth', 'Start a length experiment', 'What about my locs?']
    };
  }

  if (has(q, 'skin', 'acne', 'breakout', 'purge', 'pimple', 'scar', 'pigment', 'dark spot', 'retinol', 'serum', 'moistur', 'spf', 'sunscreen', 'routine', 'barrier', 'redness', 'rosacea', 'oily', 'dry')) {
    const skin = ctx.profile.find((p) => p.kind === 'skin');
    const routines = ctx.routines.filter((r) => r.domain === 'skin');
    const irritations = ctx.observations.filter((o) => o.reaction === 'irritation' || o.reaction === 'breakout');
    const steps = (routines[0]?.steps as AnyRow[]) ?? [];
    return {
      ...base,
      intent: 'skin',
      confidence: skin || routines.length ? 'grounded' : 'no-data',
      body: `${routines.length ? `Your saved skin routine (${routines[0].name}) has ${steps.length} steps: ${steps.map((x, i) => `${i + 1}. ${x.label ?? x.productName ?? 'step'}`).join(' · ')}\n\n` : 'No skin routine is saved yet.\n\n'}The order that actually matters, cheapest-first: sunscreen every day, then one active matched to the concern you named, then barrier support. Two things people get wrong: (1) starting several actives at once, which makes attribution impossible — introduce one every two weeks; (2) treating a damaged barrier as congestion and adding exfoliation, which makes it worse.\n\n${irritations.length ? `You have logged ${irritations.length} irritation/breakout observation(s). The most useful next step is matching each one to the product introduced within the previous 14 days — not quitting the whole routine.` : 'You have no irritation observations logged. If something stings or breaks you out, log it the same day; a week later the attribution is guesswork.'}\n\n${has(q, 'purge') ? 'Purge vs breakout: a purge follows your existing congestion pattern, appears early, and clears faster than usual. A breakout is new locations, new pustule type, and does not settle. If it is burning rather than just bumpy, stop — that is irritation, not detox.' : ''}`,
      citations: routines.slice(0, 2).map((r) => ({ label: String(r.name), kind: 'routine', id: r.id })),
      chips: ['One-active plan for me', 'Explain my irritation log', 'Build a morning routine']
    };
  }

  if (has(q, 'buy', 'worth it', 'splurge', 'price', 'cost per', 'expensive', 'should i get', 'add to cart')) {
    const wants = ctx.products.filter((p) => p.status === 'want');
    const owned = ctx.products.filter((p) => p.status === 'own');
    return {
      ...base,
      intent: 'purchase',
      confidence: wants.length ? 'grounded' : 'partial',
      body: `${wants.length ? `${wants.length} item(s) on your list: ${wants.slice(0, 5).map((w) => w.name).join(', ')}.\n\n` : ''}The framework, in order: state the outcome you want, not the item. Count how many owned products already do this job${owned.length ? ` (you own ${owned.length} products total)` : ''}. Predict real monthly uses from last season's behaviour, not intentions. Divide price by that — cost per wear only means something against your own average. Then name three outfits or three routines it fits into; fewer than three is the answer. Wait 7 days above your instant threshold, 30 for anything large. Most wants do not survive the wait, and that is data, not discipline failure.\n\nI will not invent a price, rating or availability for a product. If the record has no price, the comparison says “unverified”.`,
      citations: wants.slice(0, 3).map((w) => ({ label: String(w.name), kind: 'product', id: w.id })),
      pendingActions: wants.slice(0, 1).map((w) => ({ id: 'waitlist', label: `Wait-list “${w.name}” for 7 days`, table: 'products', payload: { id: w.id, data: { waitUntil: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10) } }, accepted: false })),
      chips: ['Run SHOULD I BUY THIS?', 'Show my cost-per-wear', 'What duplicates what I own?']
    };
  }

  if (has(q, 'outfit', 'wear', 'closet', 'wardrobe', 'style', 'aesthetic', 'fit', 'tailor', 'capsule', 'dress')) {
    const items = ctx.clothing.length;
    const outfits = ctx.outfits.length;
    const unworn = ctx.clothing.filter((c) => !((c.wears as unknown[]) ?? []).length);
    return {
      ...base,
      intent: 'style',
      confidence: items ? 'grounded' : 'no-data',
      body: `${items ? `${items} garment(s) catalogued, ${outfits} saved outfit(s), ${unworn.length} with no recorded wear.\n\n` : 'Nothing catalogued yet — Style & Digital Closet is where this starts.\n\n'}Fit beats fashion in every impression study: shoulder seam, armhole depth, waist placement, break. Buy for the armhole because tailoring cannot rescue it; pay a tailor for hems and waists because that is where money converts directly into looking deliberate.\n\nThe fastest change available to you is combination, not purchase. Three new outfits from existing stock will do more for how you read day-to-day than one new item — and it costs nothing.\n\n${unworn.length > 4 ? `With ${unworn.length} unworn pieces, the honest exercise is: build one outfit for each before buying anything in a category they cover.` : ''}`,
      citations: ctx.outfits.slice(0, 2).map((o) => ({ label: String(o.name), kind: 'outfit', id: o.id })),
      chips: ['Build 6 outfits from what I own', 'Audit my unworn items', 'What are my palette gaps?']
    };
  }

  if (has(q, 'makeup', 'contour', 'foundation', 'concealer', 'mascara', 'lip', 'eyeshadow', 'brow', 'lash', 'shade', 'undertone')) {
    return {
      ...base,
      intent: 'makeup',
      confidence: 'partial',
      body: 'Makeup is the highest impact-per-dollar modifier of how facial proportions read, and it is fully removable. Placement beats product: light advances, shadow recedes, and the frame of the eye changes apparent spacing more than any single product.\n\nWork in this order — base match tested on the jawline in daylight, brows mapped from your own nostril/iris landmarks, then colour placement for the feature you actually want to emphasise, then the finish (matte vs foil) which people notice before they notice hue.\n\nTwo things worth saying plainly: a look charted from a studio-lit reference will not translate without adjusting placement for your own eye shape, and the "does not work on me" conclusion is almost always a placement or lighting issue, not a facial issue.',
      chips: ['Map my brows', 'Build a face chart', 'Match my undertone']
    };
  }

  if (has(q, 'progress', 'am i improving', 'before', 'after', 'change', 'results', 'trend', 'measurement')) {
    const entries = ctx.progress.slice().sort((a, b) => String(a.on).localeCompare(String(b.on)));
    const first = entries[0];
    const last = entries.at(-1);
    return {
      ...base,
      intent: 'progress',
      confidence: entries.length ? 'grounded' : 'no-data',
      body: entries.length
        ? `${entries.length} progress entries from ${first.on} to ${last?.on}. ${last?.rating ? `Your latest self-rating was ${last.rating}/5 on “${last.label}”.` : ''}\n\nComparisons only count when conditions match: same distance, same lens, same light, same time of day, same expression. Everything else is decoration. Progress & Analytics shows your entries; the comparison tool is in the departments that own the photos.\n\nIf a trend line looks flat, the likelier cause is measurement variance rather than a stalled change — tighten the protocol before changing the plan.`
        : 'No progress entries yet, so I have nothing to compare and I will not invent a trend. The honest first step is a standardised baseline set — front, left, right, three-quarter, full body, same conditions — then one entry per week.',
      citations: entries.slice(-3).map((e) => ({ label: `${e.on} — ${e.label}`, kind: 'progress', id: e.id })),
      chips: ['Set up my photo standard', 'Add a progress entry', 'Show analytics']
    };
  }

  if (has(q, 'plan', '30 day', '60 day', '90 day', 'glow up', 'event', 'wedding', 'holiday', 'photoshoot', 'prep')) {
    const ranked = generate(ctx).slice(0, 4);
    return {
      ...base,
      intent: 'plan',
      confidence: 'grounded',
      body: `A plan here is built from your top-ranked actions, not a template.\n\n${ranked.map((r, i) => `${i + 1}. ${r.title} — ${r.reason} (score ${r.score}, ${r.costBand})`).join('\n')}\n\nSequencing rule that matters: free, reversible, high-evidence changes go first (sleep, fit, brows, parting, sunscreen), because they change how you look within weeks and tell you which concerns are actually worth spending on. Expensive or permanent options get scheduled last, after you have seen the cheap ceiling.\n\nCreate the plan in Looksmaxxing Command Center and it will pull these in with dates, costs and review points. I can prepare the actions for you to accept.`,
      citations: ranked.map((r) => ({ label: r.title, kind: r.linkTable, id: r.linkId })),
      pendingActions: ranked.slice(0, 3).map((r, i) => ({ id: `plan-${i}`, label: r.title, table: r.linkTable, payload: { from: 'advisor-plan-draft', domain: r.domain, score: r.score }, accepted: false })),
      chips: ['Draft a 30-day plan', 'What can I do for free?', 'Plan for a specific date']
    };
  }

  if (has(q, 'fitness', 'gym', 'workout', 'train', 'strength', 'cardio', 'weight', 'fat', 'muscle', 'abs', 'posture', 'sleep')) {
    const sessions = ctx.workouts.length;
    const lastSession = ctx.workouts.map((w) => w.doneOn as string).sort().at(-1);
    return {
      ...base,
      intent: 'fitness',
      confidence: sessions ? 'grounded' : 'partial',
      body: `${sessions ? `${sessions} logged session(s), most recent ${lastSession}${days(lastSession as string) < 365 ? ` (${days(lastSession as string)} days ago)` : ''}.\n\n` : 'No sessions logged yet.\n\n'}For appearance, the honest hierarchy is: progressive resistance (changes shape), protein adequacy (supports it), sleep (shows it), then optional supplements like creatine. Nothing here is a shortcut: two to four sessions a week for twelve weeks, one variable progressed at a time, written down.\n\nGlow Lab will not build a restrictive diet plan or a weight-shaming target. If a number on the scale is driving this, say so and I will reframe it around strength and measurements instead — those respond to behaviour, and the scale responds to water, sodium and where you are in a cycle.`,
      chips: ['Suggest two sessions this week', 'Show my training log', 'What should I not do?']
    };
  }

  if (has(q, 'discover', 'inspiration', 'aesthetic dna', 'taste', 'save', 'board', 'moodboard', 'more like this')) {
    const saves = ctx.interactions.filter((i) => ['save', 'board', 'mood', 'goal', 'try'].includes(String(i.action))).length;
    const likes = ctx.interactions.filter((i) => i.action === 'like').length;
    return {
      ...base,
      intent: 'discover',
      confidence: ctx.interactions.length ? 'grounded' : 'no-data',
      body: ctx.interactions.length
        ? `${ctx.interactions.length} recorded interaction(s): ${likes} likes, ${saves} saves/boards/wants-to-try.\n\nAesthetic DNA counts those signals only${ctx.discovery.some((d) => d.providerId === 'pinterest') ? ' and excludes anything from a connected Pinterest account, by design' : ''}. It is a weighted tally of your own actions, fully editable — not a hidden model, so you can see exactly why a category ranks where it does.\n\nOne rule the engine follows: liking something is not wanting to buy it, and wanting to buy it is not needing it. Those are separate states in the record.`
        : 'No discovery interactions yet, so Aesthetic DNA has nothing to say. The feed starts neutral and only becomes yours after you like, save, dislike and hide things.',
      chips: ['Open my DNA profile', 'Show saved items I never tried', 'What do I keep disliking?']
    };
  }

  if (has(q, 'what can you', 'help', 'how do you work', 'are you ai', 'do you use chatgpt', 'who are you', 'capabilities')) {
    return {
      ...base,
      intent: 'meta',
      confidence: 'grounded',
      body: 'I am the Glow Lab advisor running on local rules — keyword routing over your own records plus the bundled evidence library. No AI service is involved, no image is analysed without your permission, nothing leaves the device unless you enable a provider and approve it.\n\nBecause of that, I will be specific where your data exists and honest where it does not. I read: profile, goals, plans, routines and logs, product and closet records, hair and skin history, experiments, progress entries, boards and discovery interactions, consultations.\n\nI refuse four things on purpose: attractiveness scores, diagnoses, unsafe-practice planning (bone smashing, DIY injections, self-tooth filing, non-prescribed hormones, extreme restriction, water cutting), and invented prices, products or citations.',
      chips: ['What should I do today?', 'Show my priorities', 'What data do you have on me?']
    };
  }

  const top = generate(ctx).slice(0, 3);
  return {
    ...base,
    intent: 'fallback',
    confidence: top.length ? 'partial' : 'no-data',
    body: `I did not match that to a specific rule, and I would rather say so than produce confident noise.\n\n${top.length ? `From your records, the most actionable things right now:\n${top.map((t) => `• ${t.title} — ${t.reason}`).join('\n')}` : 'Your records are too sparse for me to recommend anything honest yet. Start with a profile and one goal.'}\n\nTry asking about: today’s focus, hair, skin, makeup, buying decisions, outfits, progress, a plan, fitness or discovery taste. Ask “what can you do” for the full picture.`,
    citations: top.map((t) => ({ label: t.title, kind: t.linkTable, id: t.linkId })),
    chips: ['What can you do?', 'Show my priorities', 'Open Glow Discover']
  };
}
