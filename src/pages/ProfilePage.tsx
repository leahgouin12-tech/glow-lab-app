import { useEffect, useMemo, useRef, useState } from 'react';
import { Download, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { TABLES, type AnyRow } from '../db/schema';
import { formatDate, softDelete, todayISO } from '../db/repo';
import { bumpFlags, saveRow, useRows } from '../hooks/live';
import { loadSettings, updateSettings, type AppSettings } from '../state/settings';
import { AVERAGE_IDENTITY, computeDna, dnaToProfileRow, type AestheticDna } from '../engine/taste';
import {
  AVOID_SUGGESTIONS,
  CONSTRAINTS_KIND,
  DOWNTIME_CHOICES,
  HORIZON_CHOICES,
  describe as describeConstraints,
  gradedOptions,
  hasSavedConstraints,
  readConstraints,
  saveConstraints,
  sequencePlan,
  splitByFit,
  unaffordableBands,
  whatWouldUnblock,
  type DowntimeTolerance,
  type PersonalConstraints
} from '../engine/constraints';
import { exportJson } from '../db/backup';
import {
  Button,
  Card,
  CardHead,
  Chip,
  DateInput,
  Disclosure,
  EmptyState,
  Field,
  Meter,
  Range,
  Section,
  SegmentedControl,
  Select,
  Stat,
  Table,
  TagInput,
  TextArea,
  TextInput,
  Toggle,
  useDebounced,
  useToast
} from '../ui/primitives';
import { DeptIntro, IndexList, IndexRow, KvList, StatStrip } from '../ui/editorial';
import { ToneReadCard } from '../ui/photoTone';
import '../styles/departments/profile.css';

type FieldDef = { key: string; label: string; hint?: string; type?: 'text' | 'area' | 'number' | 'select'; options?: string[] };

const SECTIONS: { kind: string; title: string; blurb: string; fields: FieldDef[] }[] = [
  {
    kind: 'personal',
    title: 'Person',
    blurb: 'Who the lab is for. Nothing here is transmitted anywhere unless you turn on your own sync endpoint.',
    fields: [
      { key: 'name', label: 'Name or nickname' },
      { key: 'pronouns', label: 'Pronouns' },
      { key: 'ageBand', label: 'Age band', type: 'select', options: ['under 18', '18–24', '25–34', '35–49', '50+'] },
      { key: 'country', label: 'Country' },
      { key: 'lifestyle', label: 'Lifestyle', type: 'area', hint: 'Hours, work, sleep, social calendar — shapes routine length.' },
      { key: 'occupation', label: 'Occupation / dress code' },
      { key: 'sleep', label: 'Typical sleep', hint: 'e.g. 23:30–06:45' }
    ]
  },
  {
    kind: 'appearance',
    title: 'Appearance baseline',
    blurb: 'What you already know about your own features. Self-reported, never measured by the app.',
    fields: [
      { key: 'skinTone', label: 'Skin tone', type: 'select', options: ['fair', 'light', 'medium', 'tan', 'deep', 'very deep'] },
      { key: 'undertone', label: 'Undertone', type: 'select', options: ['cool', 'neutral', 'warm', 'olive', 'unsure'] },
      { key: 'faceShape', label: 'Face shape (your read)', type: 'select', options: ['oval', 'round', 'square', 'heart', 'oblong', 'unsure'] },
      { key: 'eyes', label: 'Eye colour and shape' },
      { key: 'brows', label: 'Brows' },
      { key: 'hairTextureNote', label: 'Note on framing' },
      { key: 'featuresToKeep', label: 'Features you would keep as they are', type: 'area' }
    ]
  },
  {
    kind: 'hair',
    title: 'Hair',
    blurb: 'Drives the retwist reminders and the length-retention audit. All values are yours.',
    fields: [
      { key: 'texture', label: 'Texture', type: 'select', options: ['straight', 'wavy', 'curly', 'coily', 'locs', 'braids', 'relaxed', 'trimmed short'] },
      { key: 'porosity', label: 'Porosity', type: 'select', options: ['low', 'medium', 'high', 'unknown'] },
      { key: 'scalp', label: 'Scalp', type: 'select', options: ['dry', 'balanced', 'oily', 'flaking', 'sensitive'] },
      { key: 'retwistEveryWeeks', label: 'Retwist interval (weeks)', type: 'number' },
      { key: 'currentLengthCm', label: 'Current length (cm)', type: 'number' },
      { key: 'goalLengthCm', label: 'Goal length (cm)', type: 'number' },
      { key: 'notes', label: 'Notes', type: 'area' }
    ]
  },
  {
    kind: 'skin',
    title: 'Skin',
    blurb: 'Describes what you notice. It is not a diagnosis and the app will not turn it into one.',
    fields: [
      { key: 'type', label: 'Type', type: 'select', options: ['dry', 'normal', 'combination', 'oily', 'unsure'] },
      { key: 'concerns', label: 'Concerns you have noticed', type: 'area' },
      { key: 'sensitivity', label: 'Sensitivity', type: 'select', options: ['low', 'moderate', 'high', 'reactive'] },
      { key: 'conditions', label: 'Conditions a clinician has told you about', hint: 'Only what you were told. The app cannot assess this.' },
      { key: 'currentActives', label: 'Actives in use now', type: 'area' },
      { key: 'sunProtection', label: 'Sun protection habit', type: 'area' }
    ]
  },
  {
    kind: 'style',
    title: 'Style',
    blurb: 'Feeds the closet, the purchase worksheet and discovery ranking.',
    fields: [
      { key: 'aesthetics', label: 'Aesthetics you like', type: 'area' },
      { key: 'avoid', label: 'Aesthetics you avoid', type: 'area' },
      { key: 'sizes', label: 'Sizes across brands', type: 'area' },
      { key: 'fitIssues', label: 'Fit problems you keep hitting', type: 'area' },
      { key: 'dressCode', label: 'Dress code', type: 'select', options: ['free', 'business', 'smart casual', 'uniform', 'manual labour'] },
      { key: 'climate', label: 'Climate' }
    ]
  },
  {
    kind: 'fitness',
    title: 'Body & training',
    blurb: 'Training history and constraints. Reference for the fitness plan builder only.',
    fields: [
      { key: 'experience', label: 'Training experience', type: 'select', options: ['new', 'under a year', '1–3 years', '3+ years'] },
      { key: 'daysAvailable', label: 'Days available per week', type: 'number' },
      { key: 'equipment', label: 'Equipment', type: 'area' },
      { key: 'limitations', label: 'Injuries or limitations', type: 'area', hint: 'Anything a clinician should know, not a self-diagnosis.' },
      { key: 'goal', label: 'Primary goal', type: 'select', options: ['strength', 'composition', 'endurance', 'mobility', 'sport', 'general health'] }
    ]
  }
];

const GOAL_DOMAINS = ['skin', 'hair', 'smile', 'body', 'style', 'grooming', 'posture', 'fragrance', 'budget', 'confidence'];

/** Profile, goals and the privacy controls over them (spec Parts 1, 30, 38). */
export default function ProfilePage() {
  const toast = useToast();
  const rows = useRows(TABLES.profile);
  const goals = useRows(TABLES.goals);
  const measurements = useRows(TABLES.measurements);
  const weights = useRows(TABLES.weightEntries);
  const assessments = useRows(TABLES.assessments);
  const techniques = useRows(TABLES.techniques);
  const consultations = useRows(TABLES.consultations);
  const shots = useRows(TABLES.mediaItems);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [dna, setDna] = useState<AestheticDna | null>(null);
  const [goalDraft, setGoalDraft] = useState({ title: '', domain: 'skin', targetOn: '', metric: '', targetValue: '', unit: '' });
  const [showGoalForm, setShowGoalForm] = useState(false);
  // Budget and notes are typed, so they hold a local draft and write on a beat.
  const [budgetDraft, setBudgetDraft] = useState('');
  const [notesDraft, setNotesDraft] = useState('');
  const budgetTouched = useRef(false);
  const notesTouched = useRef(false);

  useEffect(() => {
    loadSettings().then(setSettings);
    computeDna(AVERAGE_IDENTITY).then(setDna).catch(() => setDna(null));
  }, []);

  const rowFor = (kind: string) => rows.find((r) => r.kind === kind);

  const constraints = useMemo(() => readConstraints(rows, settings), [rows, settings]);
  const constraintsSaved = useMemo(() => hasSavedConstraints(rows), [rows]);
  const constraintsRow = rows.find((r) => String(r.kind) === CONSTRAINTS_KIND);

  useEffect(() => {
    if (!budgetTouched.current) setBudgetDraft(String(constraints.monthlyBudget));
  }, [constraints.monthlyBudget]);
  useEffect(() => {
    if (!notesTouched.current) setNotesDraft(constraints.notes);
  }, [constraints.notes]);

  const debouncedBudget = useDebounced(budgetDraft, 450);
  const debouncedNotes = useDebounced(notesDraft, 700);

  useEffect(() => {
    const n = Number(debouncedBudget);
    if (!debouncedBudget.trim() || !Number.isFinite(n) || n < 0) return;
    if (n === constraints.monthlyBudget) return;
    void saveConstraints({ monthlyBudget: n }, settings ?? undefined).then(() => bumpFlags(TABLES.profile));
  }, [debouncedBudget, constraints.monthlyBudget, settings]);

  useEffect(() => {
    if (debouncedNotes === constraints.notes) return;
    void saveConstraints({ notes: debouncedNotes }, settings ?? undefined).then(() => bumpFlags(TABLES.profile));
  }, [debouncedNotes, constraints.notes, settings]);

  /** Writes the singleton `constraints` profile row through the repo. */
  const setConstraint = async (patch: Partial<PersonalConstraints>) => {
    await saveConstraints(patch, settings ?? undefined);
    bumpFlags(TABLES.profile);
  };

  // The live feasibility read: the user's own graded options against their own numbers.
  const graded = useMemo(() => gradedOptions(assessments), [assessments]);
  const split = useMemo(
    () => splitByFit(graded, constraints, { techniques, consultations }),
    [graded, constraints, techniques, consultations]
  );
  const fits = split.inPlan;
  const byConstraint = split.ruledOut.filter((r) => r.origin === 'constraint');
  const byPolicy = split.ruledOut.filter((r) => r.origin === 'policy');
  const plan = useMemo(() => sequencePlan(fits, constraints, { weeks: constraints.horizonWeeks, src: { techniques, consultations } }), [fits, constraints, techniques, consultations]);
  const unblocks = useMemo(() => whatWouldUnblock(graded, constraints, { techniques, consultations }), [graded, constraints, techniques, consultations]);
  const blockedBands = unaffordableBands(constraints);

  /**
   * One row per section, written as a whole. Typing holds a local draft and
   * flushes on a beat, so a burst of keystrokes is one revision of the row and
   * one entry in the sync queue instead of one per character.
   */
  const writeSection = async (kind: string, patch: Record<string, unknown>) => {
    const existing = rowFor(kind);
    const data = { ...(((existing?.data as Record<string, unknown>) ?? {})), ...patch };
    await saveRow(
      TABLES.profile,
      { ...(existing?.id ? { id: existing.id } : {}), kind: kind as never, singleton: 1, data } as never
    );
  };

  const addGoal = async () => {
    if (!goalDraft.title.trim()) return;
    await saveRow(TABLES.goals, {
      title: goalDraft.title.trim(),
      domain: goalDraft.domain,
      status: 'active',
      priority: goals.filter((g) => g.status === 'active').length + 1,
      startOn: todayISO(),
      targetOn: goalDraft.targetOn || null,
      metric: goalDraft.metric.trim(),
      targetValue: goalDraft.targetValue ? Number(goalDraft.targetValue) : null,
      unit: goalDraft.unit.trim(),
      planId: null
    } as never);
    setGoalDraft({ title: '', domain: goalDraft.domain, targetOn: '', metric: '', targetValue: '', unit: '' });
    setShowGoalForm(false);
    toast('Goal saved.', 'ok');
  };

  const cycle = (g: AnyRow) => {
    const order: string[] = ['active', 'paused', 'completed', 'dropped'];
    const next = order[(order.indexOf(String(g.status)) + 1) % order.length];
    void saveRow(TABLES.goals, { ...g, status: next } as never);
  };

  const personalName = String(((rowFor('personal')?.data as Record<string, unknown>) ?? {}).name ?? '').trim();

  // Newest face baseline already on the device, offered so the tone read does
  // not ask anyone to re-take a photo they logged for the Face or Skin lab.
  const baselineShot = useMemo(() => {
    const faces = shots.filter((m) => m.kind === 'baseline' && m.blobId);
    return faces.sort((a, b) => Number(b.updatedAt) - Number(a.updatedAt))[0] ?? null;
  }, [shots]);

  const counts = useMemo(
    () => [
      { label: 'Profile sections', value: rows.filter((r) => String(r.kind) !== CONSTRAINTS_KIND).length, hint: 'one row per section, editable' },
      { label: 'Goals', value: goals.length, hint: `${goals.filter((g) => g.status === 'active').length} active` },
      { label: 'Measurements', value: measurements.length, hint: settings?.measurementsTracking ? 'tracking on' : 'tracking off' },
      { label: 'Weight entries', value: weights.length, hint: settings?.weightTracking ? 'tracking on' : 'tracking off' },
      { label: 'Options graded', value: graded.length, hint: `${fits.length} fit what you described` }
    ],
    [rows, goals.length, measurements.length, weights.length, settings, graded.length, fits.length]
  );

  return (
    <>
      <DeptIntro
        id="profile"
        deck="The single record of what you have told the app about yourself. Every field is optional, every field is yours to delete."
        meta={[
          { label: 'Stored on', value: 'this device' },
          { label: 'Sections', value: String(rows.length) },
          { label: 'Advisor reads', value: 'goals, routines, logs, purchases, profile' }
        ]}
        actions={
          <Button
            variant="ghost"
            icon={<Download size={15} />}
            onClick={() => void exportJson().then((b) => toast('Profile JSON ready in Settings → Backup.'))}
          >
            Inspect what is stored
          </Button>
        }
      />

      <StatStrip items={counts} />

      <Section
        eyebrow="Identity"
        title="Your profile sections"
        description="Each section is one row in the shared profile table. The advisor quotes these back verbatim when it answers, so write what you would want a colleague to know."
      >
        <div className="gl-profile__sections">
          {SECTIONS.map((s) => {
            const row = rowFor(s.kind);
            return (
              <SectionEditor
                key={s.kind}
                section={s}
                row={row}
                onWrite={(data) => void writeSection(s.kind, data)}
                onDelete={
                  row
                    ? () => {
                        if (!window.confirm(`Delete the ${s.title.toLowerCase()} section? Your other records stay.`)) return;
                        void softDelete(TABLES.profile, row.id).then(() => toast('Section deleted.', 'ok'));
                      }
                    : undefined
                }
              />
            );
          })}
        </div>
      </Section>

      <Section
        eyebrow="From a photograph"
        title="Two colour bands, proposed off your own pixels"
        description="The app cannot tell you your face shape or your skin's story, and it will not pretend. What it can do is arithmetic on the colour inside an ellipse you position — which is how skin tone and undertone get proposed here, as editable guesses you confirm."
      >
        <ToneReadCard settings={settings} startShot={baselineShot} onApply={(patch) => void writeSection('appearance', patch)} />
      </Section>

      <Section
        eyebrow="Constraints"
        title="Feasibility"
        description="Advice is only useful if it survives contact with your calendar and your bank account. These figures are stored as one profile row and read by the ranking views, the recommendation rules and the advisor."
      >
        <div className="gl-grid gl-grid--2 gl-profile__constraints">
          <Card accent>
            <CardHead
              title="What actually fits your life"
              sub={describeConstraints(constraints)}
              right={
                <Chip tone={constraintsSaved ? 'gold' : 'info'}>
                  {constraintsSaved && constraintsRow
                    ? `saved ${formatDate(new Date(constraintsRow.updatedAt).toISOString().slice(0, 10))}`
                    : 'not saved yet — defaults'}
                </Chip>
              }
            />
            <div className="gl-stack">
              <div className="gl-form-row">
                <Field label="Monthly budget" hint={`Compared against cost bands, never against prices — this app stores no prices. First visit seeds from Settings (${settings?.monthlyBudget ?? 0} ${settings?.currency ?? ''}).`}>
                  <TextInput
                    type="number"
                    value={budgetDraft}
                    onChange={(v) => {
                      budgetTouched.current = true;
                      setBudgetDraft(v);
                    }}
                  />
                </Field>
                <Field label="Judging window" hint="An option records how many weeks it needs before it shows anything. Longer than this waits.">
                  <Select
                    value={constraints.horizonWeeks}
                    onChange={(v) => void setConstraint({ horizonWeeks: Number(v) })}
                    options={HORIZON_CHOICES.map((w) => ({ value: w, label: `${w} weeks` }))}
                  />
                </Field>
              </div>

              <Range
                label="Minutes a day you will really spend"
                value={constraints.minutesPerDay}
                min={0}
                max={90}
                step={5}
                onChange={(v) => void setConstraint({ minutesPerDay: v })}
                format={(v) => `${v} min`}
              />
              <div className="gl-small gl-faint">
                Repeated work has to fit inside {constraints.minutesPerDay} min a day. Weekly and monthly tasks are spread across the week, and a one-off
                appointment is spread across the {constraints.horizonWeeks}-week window. An option carries no duration field, so minutes come from the effort
                score you entered unless its technique records real ones.
              </div>

              <div>
                <div className="gl-label">Downtime you can absorb</div>
                <SegmentedControl
                  value={constraints.downtimeTolerance}
                  onChange={(v) => void setConstraint({ downtimeTolerance: v as DowntimeTolerance })}
                  options={DOWNTIME_CHOICES.map((d) => ({ value: d.value, label: d.label }))}
                />
                <div className="gl-small gl-faint" style={{ marginTop: 6 }}>
                  {DOWNTIME_CHOICES.find((d) => d.value === constraints.downtimeTolerance)?.note} No option stores a recovery window, so this is judged on the
                  recovery note in a matching consultation record when you have written one, and on your own risk score otherwise — the reason always says
                  which.
                </div>
              </div>

              <Field label="Things to avoid" hint="Plain words matched against the text of your own options. The engine recognises no categories here — it reads only what you typed.">
                <TagInput values={constraints.avoid} onChange={(v) => void setConstraint({ avoid: v })} placeholder="Type a word and press Enter" />
              </Field>
              <div className="gl-row gl-row--tight gl-profile__suggest">
                {AVOID_SUGGESTIONS.filter((s) => !constraints.avoid.includes(s)).map((s) => (
                  <Chip key={s} onClick={() => void setConstraint({ avoid: [...constraints.avoid, s] })} title="Add to avoid">
                    + {s}
                  </Chip>
                ))}
              </div>

              <Field label="Notes" hint="Anything you would say out loud to a professional: shift work, a wedding in March, a scalp that reacts to everything. Kept verbatim and shown back to you.">
                <TextArea
                  rows={3}
                  value={notesDraft}
                  onChange={(v) => {
                    notesTouched.current = true;
                    setNotesDraft(v);
                  }}
                  placeholder="What the app should know about your limits"
                />
              </Field>

              <p className="gl-profile__fit">
                {graded.length
                  ? `Of the ${graded.length} options you have graded, ${fits.length} fit what you described${
                      byConstraint.length ? `, ${byConstraint.length} do not` : ''
                    }${byPolicy.length ? `, and ${byPolicy.length} ${byPolicy.length === 1 ? 'is' : 'are'} excluded by the safety policy rather than by you` : ''}.`
                  : constraintsSaved
                    ? 'You have saved constraints but graded no options in an assessment yet, so there is nothing to test them against. The Command Center assessment is where options come from.'
                    : 'Nothing is saved yet, so these are the app’s defaults with your Settings budget in front. Save a figure and it becomes yours.'}
              </p>

              <p className="gl-small gl-faint">
                These values change ordering and annotation only. They never delete the other options from your record, never hide an assessment entry, and
                never mark anything unsafe.
              </p>

              {blockedBands.length ? (
                <div className="gl-small gl-faint">
                  At {constraints.monthlyBudget} a month the band ladder sets {blockedBands.join(' and ')} aside. A band is a position on the app’s cost
                  scale, not a currency figure.
                </div>
              ) : null}
            </div>
          </Card>

          <div className="gl-stack">
            <Card>
              <CardHead title="What reads these numbers" sub="Three places, all local rules." />
              <KvList
                items={[
                  { k: 'Advisor', v: 'answers budget and time questions from this row, and says so when it is empty' },
                  { k: 'Recommendations', v: 'rule 13 reports what is ruled out and what still fits' },
                  { k: 'Command Center', v: 'keeps ranking on evidence, cost, risk and reversibility — this row annotates, it does not delete' },
                  { k: 'Engine stamp', v: 'local-rules. No AI service reads this row, or anything else.' }
                ]}
              />
            </Card>

            {byConstraint.length || byPolicy.length ? (
              <Card>
                <Disclosure summary={`What is ruled out, and why (${byConstraint.length})`}>
                  <div className="gl-stack">
                    {byConstraint.map((r, i) => (
                      <div key={`${r.option.id}-${i}`} className="gl-profile__ruledout">
                        <div className="gl-strong">{String(r.option.label)}</div>
                        <div className="gl-small gl-faint">
                          {r.option.categoryLabel ? `${r.option.categoryLabel} · ` : ''}band {r.option.costBand} · evidence {r.option.evidence} · effort{' '}
                          {r.option.effort}/10 · {r.option.weeksToSee} weeks
                        </div>
                        <ul className="gl-profile__reasons">
                          {r.reasons.map((reason, j) => (
                            <li key={j}>{reason}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                    {byPolicy.length ? (
                      <div className="gl-profile__ruledout gl-profile__ruledout--policy">
                        <div className="gl-label">Never proposed, whatever you enter here</div>
                        <ul className="gl-profile__reasons">
                          {byPolicy.map((r, i) => (
                            <li key={`${r.option.id}-${i}`}>
                              {String(r.option.label)} — {r.reasons[0]}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {unblocks.length ? (
                      <div className="gl-small gl-faint">
                        One figure does most of the blocking: {unblocks[0].change} would bring {unblocks[0].extra} more option
                        {unblocks[0].extra === 1 ? '' : 's'} back in ({unblocks[0].examples.join(', ')}).
                      </div>
                    ) : (
                      <div className="gl-small gl-faint">
                        No single figure is doing the blocking on its own — whatever is excluded fails more than one of your limits.
                      </div>
                    )}
                  </div>
                </Disclosure>
              </Card>
            ) : null}

            {plan.phases.some((p) => p.items.length) ? (
              <Card>
                <CardHead title="How it would sequence" sub={plan.summary[1]} />
                <div className="gl-stack gl-profile__phases">
                  {plan.phases.map((p) => (
                    <div key={p.index} className="gl-profile__phase">
                      <div className="gl-row gl-row--between">
                        <span className="gl-strong">{p.label}</span>
                        <span className="gl-tech">
                          {Math.round(p.minutesPerDayCommitted * 10) / 10} / {p.minutesPerDayAvailable} min a day
                        </span>
                      </div>
                      {p.items.length ? (
                        <ul className="gl-profile__reasons">
                          {p.items.map((it) => (
                            <li key={it.id}>
                              {it.label} <span className="gl-faint">— {it.math}</span>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      <div className="gl-small gl-faint">{p.arithmetic}</div>
                    </div>
                  ))}
                  {plan.deferred.length ? (
                    <div className="gl-small gl-faint">
                      {plan.deferred.length} option{plan.deferred.length === 1 ? '' : 's'} fit but had no room left inside {constraints.horizonWeeks} weeks.
                      {' '}
                      {plan.deferred[0].why}
                    </div>
                  ) : null}
                </div>
              </Card>
            ) : null}

            {constraintsSaved ? (
              <Card>
                <CardHead title="Start again from your Settings figure" sub="Clears the saved row and falls back to defaults." />
                <div className="gl-row gl-row--tight">
                  <Button
                    variant="ghost"
                    onClick={() => {
                      if (!window.confirm('Discard the saved constraints? Your other profile sections stay.')) return;
                      budgetTouched.current = false;
                      notesTouched.current = false;
                      void saveConstraints(
                        {
                          monthlyBudget: settings?.monthlyBudget ?? 0,
                          minutesPerDay: 15,
                          horizonWeeks: 8,
                          downtimeTolerance: 'a-day',
                          avoid: [],
                          notes: ''
                        },
                        settings ?? undefined
                      ).then(() => {
                        bumpFlags(TABLES.profile);
                        toast('Constraints reset to defaults.', 'ok');
                      });
                    }}
                  >
                    Reset constraints
                  </Button>
                  {constraintsRow ? (
                    <Button
                      variant="ghost"
                      icon={<Trash2 size={13} />}
                      onClick={() => {
                        if (!window.confirm('Delete the constraints row? Nothing else in your profile is touched.')) return;
                        void softDelete(TABLES.profile, constraintsRow.id).then(() => {
                          bumpFlags(TABLES.profile);
                          toast('Constraints row deleted.', 'ok');
                        });
                      }}
                    >
                      Delete row
                    </Button>
                  ) : null}
                </div>
              </Card>
            ) : null}
          </div>
        </div>
      </Section>

      <Section eyebrow="Aesthetic DNA" title="What discovery learned from you">
        <div className="gl-split">
          <Card>
            <CardHead
              title={`Identity: ${dna?.identity ?? AVERAGE_IDENTITY}`}
              sub={
                dna
                  ? `${dna.interactions} interaction${dna.interactions === 1 ? '' : 's'} recorded. Pinterest-sourced rows are excluded from this profile by design.`
                  : 'No interactions recorded yet.'
              }
              right={
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    if (!dna) return;
                    void saveRow(TABLES.profile, dnaToProfileRow(dna) as never).then(() => toast('Taste profile saved.', 'ok'));
                  }}
                >
                  Save snapshot
                </Button>
              }
            />
            {!dna || dna.signals.length === 0 ? (
              <EmptyState title="Nothing learned yet" body="Like, save, board or dislike a few discovery items and the profile fills from your own behaviour." />
            ) : (
              <div className="gl-stack">
                <Meter value={dna.confidence} max={1} label="Confidence" />
                <div>
                  <div className="gl-eyebrow">Drawn to</div>
                  <IndexList>
                    {dna.top.slice(0, 8).map((s, i) => (
                      <IndexRow
                        key={s.kind + s.key}
                        no={i + 1}
                        title={s.key}
                        sub={`${s.kind} · ${s.positives} positive signal${s.positives === 1 ? '' : 's'}${s.negatives ? ` · ${s.negatives} negative` : ''}`}
                        right={<span className="gl-tech">{s.score.toFixed(1)}</span>}
                      />
                    ))}
                  </IndexList>
                </div>
                {dna.aversions.length ? (
                  <div>
                    <div className="gl-eyebrow">Moved away from</div>
                    <div className="gl-row gl-row--tight" style={{ flexWrap: 'wrap' }}>
                      {dna.aversions.slice(0, 8).map((s) => (
                        <Chip key={s.kind + s.key}>{s.key}</Chip>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </Card>
          <div className="gl-stack">
            <Card accent>
              <CardHead title="Tracking switches" sub="Off means the screens stay closed and no row is written." />
              <div className="gl-stack" style={{ gap: 12 }}>
                <Toggle
                  checked={!!settings?.measurementsTracking}
                  onChange={(v) => {
                    setSettings((s) => (s ? { ...s, measurementsTracking: v } : s));
                    void updateSettings({ measurementsTracking: v });
                  }}
                  label="Body measurements"
                />
                <Toggle
                  checked={!!settings?.weightTracking}
                  onChange={(v) => {
                    setSettings((s) => (s ? { ...s, weightTracking: v } : s));
                    void updateSettings({ weightTracking: v });
                  }}
                  label="Weight entries"
                  hint="If seeing a trend line harms you, keep this off. Nothing in the app depends on it."
                />
                <Toggle
                  checked={!!settings?.imageAnalysis}
                  onChange={(v) => {
                    setSettings((s) => (s ? { ...s, imageAnalysis: v } : s));
                    void updateSettings({ imageAnalysis: v });
                  }}
                  label="On-device image tools"
                  hint="Cropping, guides, comparison sliders, and one colour read: skin tone and undertone proposed from pixels inside an ellipse you position, which you confirm before anything is written. There is still no face model, no landmark detection and no body analysis in this app — and nothing is uploaded to be checked."
                />
              </div>
            </Card>
            {settings?.measurementsTracking || settings?.weightTracking ? (
              <Card>
                <CardHead title="Logged numbers" sub="Arithmetic over your entries — nothing inferred." />
                <KvList
                  items={[
                    ...measurements.slice(0, 6).map((m) => ({ k: `${m.site} · ${formatDate(m.takenOn)}`, v: `${m.value} ${m.unit}` })),
                    ...weights.slice(0, 4).map((w) => ({ k: `Weight ${formatDate(w.loggedOn)}`, v: `${w.kg} kg` }))
                  ]}
                />
              </Card>
            ) : (
              <Card>
                <CardHead title="No body numbers stored" sub="You have both trackers off, so these tables are empty by choice." />
              </Card>
            )}
          </div>
        </div>
      </Section>

      <Section
        eyebrow="Goals"
        title={personalName ? `${personalName}'s goals` : 'Your goals'}
        description="Priority order is what you set. The command centre re-ranks options inside a goal by evidence, cost and reversibility — it never sets a goal for you."
        right={
          <Button size="sm" variant="primary" icon={<Plus size={14} />} onClick={() => setShowGoalForm((s) => !s)}>
            New goal
          </Button>
        }
      >
        {showGoalForm ? (
          <Card className="gl-profile__goalform" accent>
            <div className="gl-form-row">
              <Field label="Goal">
                <TextInput value={goalDraft.title} onChange={(v) => setGoalDraft({ ...goalDraft, title: v })} placeholder="e.g. even out jawline skin texture" onEnter={() => void addGoal()} />
              </Field>
              <Field label="Domain">
                <Select value={goalDraft.domain} onChange={(v) => setGoalDraft({ ...goalDraft, domain: v })} options={GOAL_DOMAINS.map((d) => ({ value: d, label: d }))} />
              </Field>
              <DateInput label="Target date" value={goalDraft.targetOn} onChange={(v) => setGoalDraft({ ...goalDraft, targetOn: v })} />
              <Field label="Metric" hint="How you will know. Text is fine.">
                <TextInput value={goalDraft.metric} onChange={(v) => setGoalDraft({ ...goalDraft, metric: v })} placeholder="e.g. routine adherence above 80%" />
              </Field>
              <Field label="Target value">
                <TextInput type="number" value={goalDraft.targetValue} onChange={(v) => setGoalDraft({ ...goalDraft, targetValue: v })} />
              </Field>
              <Field label="Unit">
                <TextInput value={goalDraft.unit} onChange={(v) => setGoalDraft({ ...goalDraft, unit: v })} placeholder="% , cm, sessions" />
              </Field>
            </div>
            <div className="gl-row gl-row--tight" style={{ marginTop: 14 }}>
              <Button variant="gold" onClick={() => void addGoal()} disabled={!goalDraft.title.trim()}>
                Save goal
              </Button>
              <Button variant="ghost" onClick={() => setShowGoalForm(false)}>
                Cancel
              </Button>
            </div>
          </Card>
        ) : null}

        {goals.length === 0 && !showGoalForm ? (
          <EmptyState
            title="No goals yet"
            body="Start with one thing you actually want to change. The command centre turns it into a plan with costs, evidence and a review date."
            action={
              <Button variant="primary" icon={<Plus size={14} />} onClick={() => setShowGoalForm(true)}>
                Add your first goal
              </Button>
            }
          />
        ) : (
          <Table
            rows={goals.slice().sort((a, b) => Number(a.priority) - Number(b.priority))}
            columns={[
              { label: '#', render: (g) => <span className="gl-tech">{g.priority}</span>, width: 44 },
              {
                label: 'Goal',
                render: (g) => (
                  <div>
                    <div className="gl-strong">{g.title}</div>
                    <div className="gl-small gl-faint">{g.metric || 'no metric recorded'}</div>
                  </div>
                )
              },
              { label: 'Domain', render: (g) => <Chip>{g.domain}</Chip>, width: 110 },
              {
                label: 'Target',
                render: (g) =>
                  g.targetValue ? (
                    <span className="gl-tech">
                      {g.targetValue}
                      {g.unit ? ` ${g.unit}` : ''}
                    </span>
                  ) : (
                    <span className="gl-faint">—</span>
                  ),
                width: 90
              },
              { label: 'By', render: (g) => <span className="gl-tech gl-small">{formatDate(g.targetOn)}</span>, width: 110 },
              {
                label: 'Status',
                width: 130,
                render: (g) => (
                  <button type="button" className="gl-chip gl-chip--clickable" onClick={() => cycle(g)} title="Click to change status">
                    {g.status}
                  </button>
                )
              },
              {
                label: '',
                width: 60,
                render: (g) => (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      if (!window.confirm(`Delete “${g.title}”?`)) return;
                      void softDelete(TABLES.goals, g.id);
                    }}
                  >
                    <Trash2 size={13} />
                  </Button>
                )
              }
            ]}
          />
        )}
      </Section>

      <Section eyebrow="Privacy" title="What leaves this device">
        <div className="gl-grid gl-grid--2">
          <Card>
            <CardHead title="Nothing, unless you say so" sub="No analytics, no telemetry, no third-party scripts." />
            <KvList
              items={[
                { k: 'Storage', v: 'IndexedDB in this browser / app webview' },
                { k: 'Backups', v: 'only when you press export' },
                { k: 'Sync', v: settings?.syncEnabled ? `your endpoint: ${settings.syncEndpoint || 'not set'}` : 'off' },
                { k: 'External processing', v: settings?.allowExternalProcessing ? 'allowed' : 'blocked' },
                { k: 'Private media by default', v: settings?.privateMediaByDefault ? 'yes' : 'no' }
              ]}
            />
          </Card>
          <Card>
            <CardHead title="Delete cleanly" sub="Every action is reversible until you empty the trash." />
            <div className="gl-stack" style={{ gap: 10 }}>
              <Button
                variant="ghost"
                icon={<ShieldCheck size={15} />}
                onClick={() => {
                  setSettings((s) => (s ? { ...s, privateMediaByDefault: true, allowExternalProcessing: false, syncEnabled: false } : s));
                  void updateSettings({ privateMediaByDefault: true, allowExternalProcessing: false, syncEnabled: false });
                  toast('Locked down.', 'ok');
                }}
              >
                Lock everything down
              </Button>
              <div className="gl-small gl-faint">
                Removing starter content, clearing media or erasing the database live in Settings — those actions touch more than your
                profile, so they are not here.
              </div>
            </div>
          </Card>
        </div>
      </Section>
    </>
  );
}

/**
 * One profile card the user can actually type into: local draft, debounced
 * write, and it re-adopts the stored row when something outside the card
 * changes it (a photo fill, a restore, an undo).
 */
function SectionEditor({
  section,
  row,
  onWrite,
  onDelete
}: {
  section: (typeof SECTIONS)[number];
  row: AnyRow | undefined;
  onWrite: (data: Record<string, unknown>) => void;
  onDelete?: () => void;
}) {
  const stored = (row?.data as Record<string, unknown>) ?? {};
  const [draft, setDraft] = useState<Record<string, unknown>>(() => ({ ...stored }));
  const pending = useRef(false);
  const timer = useRef<number | null>(null);
  const latest = useRef(draft);
  latest.current = draft;
  const write = useRef(onWrite);
  write.current = onWrite;

  const flush = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
    if (!pending.current) return;
    pending.current = false;
    write.current(latest.current);
  };

  // Leaving the page mid-beat must not swallow the last edit.
  useEffect(() => () => { flush(); }, []);

  // An outside write (photo fill, restore, undo) moves the row; adopt it as
  // long as nothing of the user's is still sitting in the timer.
  useEffect(() => {
    if (pending.current) return;
    setDraft({ ...stored });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row?.id, row?.updatedAt]);

  const edit = (key: string, value: unknown) => {
    const next = { ...draft, [key]: value };
    pending.current = true;
    setDraft(next);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, 500);
  };

  const filled = section.fields.filter((f) => String(draft[f.key] ?? '').trim() !== '').length;
  const status = pending.current ? 'unsaved keystrokes' : row ? 'saved to this device' : 'not started';

  return (
    <Card className="gl-profile__section">
      <CardHead
        title={section.title}
        eyebrow={section.kind}
        right={
          onDelete ? (
            <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} onClick={onDelete}>
              Delete
            </Button>
          ) : null
        }
        sub={section.blurb}
      />
      <div className="gl-row gl-row--tight" style={{ marginBottom: 12 }}>
        <Chip>{filled}/{section.fields.length} answered</Chip>
        <Chip>{status}</Chip>
      </div>
      <div className="gl-form-row" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) flush(); }}>
        {section.fields.map((f) => {
          const v = draft[f.key];
          if (f.type === 'area') {
            return (
              <Field key={f.key} label={f.label} hint={f.hint}>
                <TextArea value={String(v ?? '')} onChange={(nv) => edit(f.key, nv)} rows={3} />
              </Field>
            );
          }
          if (f.type === 'select') {
            return (
              <Field key={f.key} label={f.label} hint={f.hint}>
                <Select
                  value={String(v ?? '')}
                  onChange={(nv) => edit(f.key, nv)}
                  placeholder="Not recorded"
                  options={(f.options ?? []).map((o) => ({ value: o, label: o }))}
                />
              </Field>
            );
          }
          return (
            <Field key={f.key} label={f.label} hint={f.hint}>
              <TextInput
                type={f.type === 'number' ? 'number' : 'text'}
                value={v === undefined || v === null ? '' : String(v)}
                onChange={(nv) => {
                  if (f.type !== 'number') return edit(f.key, nv);
                  const n = Number(nv);
                  edit(f.key, nv.trim() === '' || !Number.isFinite(n) ? null : n);
                }}
              />
            </Field>
          );
        })}
      </div>
    </Card>
  );
}
