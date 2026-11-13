/**
 * THE GLOW LAB — Body & Fitness (spec Part 17).
 *
 * A training log with arithmetic over your own entries: session volume, weekly
 * totals, "personal record" as the maximum load you actually wrote down. It is
 * not a coach, not a diet, and not a medical service. There are no calorie
 * targets, no deficit calculations, no cutting protocols and no substance
 * dosing anywhere in this department — see the refusal panel at the bottom for
 * why, and for what the app will do instead.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  Ban,
  BookOpen,
  Check,
  Dumbbell,
  Plus,
  Ruler,
  Save,
  Sparkles,
  Trash2,
  TriangleAlert
} from 'lucide-react';
import { saveRow, useRows } from '../hooks/live';
import { formatDate, newId, softDelete, todayISO } from '../db/repo';
import { TABLES, type AnyRow, type TableName, type WorkoutDay } from '../db/schema';
import { loadSettings, updateSettings, type AppSettings } from '../state/settings';
import {
  buildDigest,
  DIGEST_LIMITS,
  GAP_NOT_EXPLAINED,
  fmt,
  mondayOf,
  sessionVolume,
  type DigestGap,
  type DigestWeek,
  type FitnessDigest
} from '../engine/fitness';
import {
  Button,
  Card,
  CardHead,
  Chip,
  DateInput,
  Disclosure,
  EmptyState,
  Field,
  IconButton,
  Modal,
  SafetyBanner,
  Select,
  Table,
  TagInput,
  TextArea,
  TextInput,
  Toggle,
  useToast
} from '../ui/primitives';
import { useUndoDelete } from '../ui/undo';
import { DeptIntro, EmptyPlate, IndexList, IndexRow, KvList, StatStrip, Timeline } from '../ui/editorial';
import { BarChart, DistributionBars, HeatStrip, LineChart } from '../ui/charts';
import '../styles/departments/fitness.css';

/* ------------------------------------------------------------------ constants */

const PATTERNS = ['hinge', 'squat', 'push', 'pull', 'carry', 'brace', 'rotate', 'gait'];

const MEASURE_SITES = ['Neck', 'Chest', 'Waist', 'Navel', 'Hips', 'Thigh (left)', 'Thigh (right)', 'Upper arm', 'Wrist'];

/** The three things this department will not help with, and the plain reason. */
const REFUSALS: { title: string; reason: string; instead: string }[] = [
  {
    title: 'Extreme calorie restriction / crash dieting',
    reason:
      'Rapid restriction tends to cost lean mass before fat, and the appearance consequences people actually want to avoid — hair shedding, hollow face, dull skin, loss of shape — are the documented pattern. Any number this app could invent would be a guess at your metabolism, which we cannot measure.',
    instead: 'Log training and, if you want it, optional measurements. For intake, a registered dietitian or physician; /services holds provider records.'
  },
  {
    title: 'Water cutting / dehydration for a look',
    reason:
      'It removes water from everywhere including the places that keep you conscious. The visual change lasts hours, and the risk list is electrolyte disturbance and kidney stress. No app should produce a protocol for that.',
    instead: 'Photograph under consistent conditions and judge the look on your own timeline — /progress and /media.'
  },
  {
    title: 'Unsupervised hormones, steroids, or "research compounds"',
    reason:
      'These are prescription decisions with systemic effects on fertility, lipids, liver and mood. This app holds no prescriber, no lab values and no authority, so it will not suggest a dose, a cycle or a stack.',
    instead: 'Endocrinologist or sports-medicine physician. Record the consultation, the questions and the quote in /services.'
  }
];

/* --------------------------------------------------------------------- drafts */

interface PlanDraft {
  id?: string;
  name: string;
  goal: string;
  daysPerWeek: string;
  weeks: string;
  active: boolean;
  split: WorkoutDay[];
}

interface SetDraft {
  reps: string;
  kg: string;
  rpe: string;
  done: boolean;
}

interface EntryDraft {
  exerciseId: string;
  sets: SetDraft[];
}

interface SessionDraft {
  id?: string;
  doneOn: string;
  label: string;
  durationMin: string;
  rpe: string;
  note: string;
  planDayId: string | null;
  entries: EntryDraft[];
}

function blankSet(): SetDraft {
  return { reps: '', kg: '', rpe: '', done: true };
}

function blankSession(): SessionDraft {
  return { doneOn: todayISO(), label: '', durationMin: '', rpe: '', note: '', planDayId: null, entries: [] };
}

function num(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(String(raw).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * Week buckets and volume come from `engine/fitness.ts` so the grid, the stats
 * strip and the read-only digest cannot drift into two definitions of the same
 * number. Volume = Σ reps × load over the sets you marked done, in the unit you
 * typed.
 */
function draftVolume(entries: EntryDraft[]): number {
  let total = 0;
  for (const e of entries)
    for (const s of e.sets) {
      if (!s.done) continue;
      total += (num(s.reps) ?? 0) * (num(s.kg) ?? 0);
    }
  return total;
}

export default function FitnessPage() {
  const exercises = useRows(TABLES.exercises);
  const plans = useRows(TABLES.workoutPlans);
  const sessions = useRows(TABLES.workoutSessions);
  const measurements = useRows(TABLES.measurements, { where: { kind: 'body' } });
  const weights = useRows(TABLES.weightEntries);
  const techniques = useRows(TABLES.techniques);
  const toast = useToast();
  const remove = useUndoDelete();
  const navigate = useNavigate();

  const [settings, setSettings] = useState<AppSettings | null>(null);
  useEffect(() => {
    let live = true;
    void loadSettings().then((s) => live && setSettings(s));
    return () => {
      live = false;
    };
  }, []);

  function patchSettings(p: Partial<AppSettings>) {
    void updateSettings(p).then((next) => setSettings(next));
  }

  const [planDraft, setPlanDraft] = useState<PlanDraft | null>(null);
  const [sessionDraft, setSessionDraft] = useState<SessionDraft | null>(null);
  const [exerciseDraft, setExerciseDraft] = useState<{ id?: string; name: string; pattern: string; focus: string[]; equipment: string[]; difficulty: string; cue: string; caution: string } | null>(null);
  const [weightDraft, setWeightDraft] = useState({ kg: '', loggedOn: todayISO(), context: '' });
  const [measureDraft, setMeasureDraft] = useState({ site: MEASURE_SITES[0], value: '', unit: 'cm', takenOn: todayISO(), method: 'Tape, relaxed', note: '' });
  const [focusExercise, setFocusExercise] = useState<string>('');
  const [confirmDel, setConfirmDel] = useState<{ table: TableName; id: string; label: string } | null>(null);

  const exerciseById = useMemo(() => new Map(exercises.map((e) => [e.id, e])), [exercises]);

  /* ------------------------------------------------------------- maths */
  const stats = useMemo(() => {
    const setsLogged = sessions.reduce((s, x) => s + ((x.entries as any[]) ?? []).reduce((a, e) => a + ((e.sets ?? []).length), 0), 0);
    const volumes = sessions.map((s) => sessionVolume((s.entries as any[]) ?? []));
    const totalVolume = volumes.reduce((a, b) => a + b, 0);
    const weeks = new Map<string, number>();
    for (const s of sessions) {
      const key = mondayOf(String(s.doneOn ?? todayISO()));
      weeks.set(key, (weeks.get(key) ?? 0) + sessionVolume((s.entries as any[]) ?? []));
    }
    const sortedWeeks = [...weeks.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    const last = sessions.slice().sort((a, b) => String(b.doneOn).localeCompare(String(a.doneOn)))[0];
    return {
      sessions: sessions.length,
      setsLogged,
      totalVolume,
      avgVolume: sessions.length ? totalVolume / sessions.length : 0,
      weeks: sortedWeeks.slice(-12),
      lastSession: last ? String(last.doneOn) : null,
      activePlans: plans.filter((p) => p.active).length,
      seededExercises: exercises.filter((e) => e.seed === 1).length
    };
  }, [sessions, plans, exercises]);

  /**
   * The read-only digest: twelve weeks of her own rows, bucketed with the same
   * `mondayOf` the grid above uses. All arithmetic lives in `engine/fitness.ts`;
   * this page only formats it. Nothing in the section writes.
   */
  const digest = useMemo(
    () => buildDigest({ sessions, exercises, plans, today: todayISO() }),
    [sessions, exercises, plans]
  );

  /** Best logged set per exercise: pure max over your own numbers. */
  const prs = useMemo(() => {
    const map = new Map<string, { kg: number; reps: number; on: string; sets: number; sessions: number }>();
    for (const s of sessions) {
      for (const e of ((s.entries as any[]) ?? [])) {
        const id = String(e.exerciseId);
        if (!id) continue;
        const cur = map.get(id) ?? { kg: -1, reps: 0, on: '', sets: 0, sessions: 0 };
        let touched = false;
        for (const set of e.sets ?? []) {
          if (!set.done) continue;
          cur.sets += 1;
          touched = true;
          const kg = Number(set.kg) || 0;
          if (kg > cur.kg) {
            cur.kg = kg;
            cur.reps = Number(set.reps) || 0;
            cur.on = String(s.doneOn);
          }
        }
        if (touched) cur.sessions += 1;
        map.set(id, cur);
      }
    }
    return map;
  }, [sessions]);

  const focusId = useMemo(() => {
    if (focusExercise) return focusExercise;
    const counts = new Map<string, number>();
    for (const [, v] of prs) for (const [id] of prs) void id;
    for (const [id, v] of prs) counts.set(id, v.sessions);
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    return ranked[0]?.[0] ?? exercises[0]?.id ?? '';
  }, [focusExercise, prs, exercises]);

  const progression = useMemo(() => {
    const rows = sessions
      .filter((s) => ((s.entries as any[]) ?? []).some((e) => String(e.exerciseId) === focusId))
      .map((s) => {
        const entry = ((s.entries as any[]) ?? []).find((e) => String(e.exerciseId) === focusId);
        const done = (entry?.sets ?? []).filter((x: any) => x.done);
        const top = done.reduce((m: number, x: any) => Math.max(m, Number(x.kg) || 0), 0);
        const volume = done.reduce((a: number, x: any) => a + (Number(x.reps) || 0) * (Number(x.kg) || 0), 0);
        return { on: String(s.doneOn), top, volume, sets: done.length };
      })
      .sort((a, b) => a.on.localeCompare(b.on));
    return {
      labels: rows.map((r) => r.on),
      top: rows.map((r) => r.top),
      volume: rows.map((r) => r.volume),
      rows
    };
  }, [sessions, focusId]);

  const heat = useMemo(() => {
    const logged = new Set(sessions.map((s) => String(s.doneOn)));
    const out: { date: string; level: number; title?: string }[] = [];
    const start = new Date();
    start.setDate(start.getDate() - 111);
    for (let i = 0; i < 112; i += 1) {
      const d = new Date(start.getTime() + i * 86400000);
      const iso = `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`;
      out.push({ date: iso, level: logged.has(iso) ? 3 : 0, title: logged.has(iso) ? 'Session logged' : undefined });
    }
    return out;
  }, [sessions]);

  const bodyTechniques = useMemo(
    () => techniques.filter((t) => ['body', 'lifestyle'].includes(String(t.domain)) && !t.deletedAt),
    [techniques]
  );
  const unsafeTechniques = useMemo(() => bodyTechniques.filter((t) => t.safety === 'unsafe'), [bodyTechniques]);

  const weightSeries = useMemo(
    () => weights.slice().sort((a, b) => String(a.loggedOn).localeCompare(String(b.loggedOn))),
    [weights]
  );

  const measureTrend = useMemo(() => {
    const bySite = new Map<string, AnyRow[]>();
    for (const m of measurements) {
      const list = bySite.get(String(m.site)) ?? [];
      list.push(m);
      bySite.set(String(m.site), list);
    }
    return [...bySite.entries()]
      .map(([site, rows]) => {
        const sorted = rows.slice().sort((a, b) => String(a.takenOn).localeCompare(String(b.takenOn)));
        const first = Number(sorted[0]?.value);
        const last = Number(sorted[sorted.length - 1]?.value);
        return { site, rows: sorted, delta: sorted.length > 1 ? last - first : 0, unit: String(sorted[sorted.length - 1]?.unit ?? '') };
      })
      .sort((a, b) => b.rows.length - a.rows.length);
  }, [measurements]);

  /* -------------------------------------------------------------- writes */

  async function saveExercise() {
    if (!exerciseDraft) return;
    if (!exerciseDraft.name.trim()) {
      toast('An exercise needs a name.', 'bad');
      return;
    }
    await saveRow(TABLES.exercises, {
      id: exerciseDraft.id,
      name: exerciseDraft.name.trim(),
      pattern: exerciseDraft.pattern,
      focus: exerciseDraft.focus,
      equipment: exerciseDraft.equipment,
      difficulty: num(exerciseDraft.difficulty) ?? 1,
      cue: exerciseDraft.cue,
      caution: exerciseDraft.caution,
      mediaIds: [],
      tags: [exerciseDraft.pattern, ...exerciseDraft.focus].filter(Boolean)
    });
    toast(exerciseDraft.id ? 'Exercise updated.' : 'Exercise added to your library.', 'ok');
    setExerciseDraft(null);
  }

  async function savePlan() {
    if (!planDraft) return;
    if (!planDraft.name.trim()) {
      toast('Name the plan.', 'bad');
      return;
    }
    await saveRow(TABLES.workoutPlans, {
      id: planDraft.id,
      name: planDraft.name.trim(),
      goal: planDraft.goal,
      daysPerWeek: num(planDraft.daysPerWeek) ?? 0,
      weeks: num(planDraft.weeks) ?? 0,
      split: planDraft.split,
      active: planDraft.active,
      tags: ['plan', planDraft.goal.toLowerCase()].filter(Boolean)
    });
    toast('Plan stored with its days and blocks.', 'ok');
    setPlanDraft(null);
  }

  async function saveSession() {
    if (!sessionDraft) return;
    const entries = sessionDraft.entries
      .filter((e) => e.exerciseId)
      .map((e) => ({
        exerciseId: e.exerciseId,
        sets: e.sets.map((s) => ({ reps: num(s.reps) ?? 0, kg: num(s.kg) ?? 0, rpe: num(s.rpe) ?? 0, done: s.done }))
      }));
    if (!entries.length) {
      toast('Add at least one exercise with a set before saving.', 'bad');
      return;
    }
    await saveRow(TABLES.workoutSessions, {
      id: sessionDraft.id,
      doneOn: sessionDraft.doneOn,
      label: sessionDraft.label.trim() || `Session ${sessionDraft.doneOn}`,
      durationMin: num(sessionDraft.durationMin) ?? 0,
      rpe: num(sessionDraft.rpe) ?? 0,
      note: sessionDraft.note,
      planDayId: sessionDraft.planDayId,
      entries,
      tags: ['session']
    });
    toast(`Session logged — volume ${Math.round(draftVolume(sessionDraft.entries))}.`, 'ok');
    setSessionDraft(null);
  }

  function prefillFromDay(planId: string, dayId: string) {
    const plan = plans.find((p) => p.id === planId);
    const day = (((plan?.split as WorkoutDay[]) ?? []).find((d) => d.id === dayId)) as WorkoutDay | undefined;
    if (!day || !sessionDraft) return;
    const entries: EntryDraft[] = (day.blocks ?? []).map((b) => ({
      exerciseId: String(b.exerciseId),
      sets: Array.from({ length: Math.max(1, Number(b.sets) || 1) }).map(() => ({
        reps: String(b.reps ?? '').replace(/[^0-9]/g, '') || '',
        kg: '',
        rpe: '',
        done: true
      }))
    }));
    setSessionDraft({ ...sessionDraft, planDayId: dayId, label: sessionDraft.label || `${plan?.name ?? 'Plan'} · ${day.label}`, entries });
    toast(`Loaded ${entries.length} block(s) from ${day.label}. Enter what you actually did.`);
  }

  async function saveWeight() {
    const kg = num(weightDraft.kg);
    if (kg === null) {
      toast('Enter a number, or do not log the day.', 'bad');
      return;
    }
    await saveRow(TABLES.weightEntries, { kg, loggedOn: weightDraft.loggedOn, context: weightDraft.context, tags: [] });
    toast('Entry stored.', 'ok');
    setWeightDraft({ kg: '', loggedOn: todayISO(), context: '' });
  }

  async function saveMeasurement() {
    const value = num(measureDraft.value);
    if (value === null) {
      toast('A measurement needs a number.', 'bad');
      return;
    }
    await saveRow(TABLES.measurements, {
      kind: 'body',
      site: measureDraft.site,
      value,
      unit: measureDraft.unit,
      takenOn: measureDraft.takenOn,
      method: measureDraft.method,
      note: measureDraft.note,
      tags: ['body', measureDraft.site.toLowerCase()]
    });
    toast('Measurement stored.', 'ok');
    setMeasureDraft({ ...measureDraft, value: '' });
  }

  async function runDelete() {
    if (!confirmDel) return;
    await remove(confirmDel.table, confirmDel.id, confirmDel.label);
    setConfirmDel(null);
  }

  async function clearStarterExercises() {
    const seeded = exercises.filter((e) => e.seed === 1);
    for (const e of seeded) await softDelete(TABLES.exercises, e.id);
    toast(`${seeded.length} starter exercises removed. Your custom ones stay.`, 'ok');
  }

  /* ------------------------------------------------------------------ view */

  const dayOptions = useMemo(() => {
    const out: { value: string; label: string; planId: string }[] = [];
    for (const p of plans.filter((x) => x.active || !planDraft)) {
      for (const d of ((p.split as WorkoutDay[]) ?? [])) out.push({ value: d.id, label: `${p.name} — ${d.label}`, planId: p.id });
    }
    return out;
  }, [plans, planDraft]);

  /** Read twice from the maps so the JSX below narrows instead of asserting. */
  const focusPr = prs.get(focusId);
  const focusRow = exerciseById.get(focusId);

  return (
    <div className="gl-page fb-page">
      <DeptIntro
        id="fitness"
        deck="Training history you wrote, plus the arithmetic over it: volume, weekly totals, and a personal record defined as the heaviest set you logged. Body data is optional and switched off by default."
        actions={
          <>
            <Button variant="primary" onClick={() => setSessionDraft(blankSession())}>
              <Activity size={14} /> Log a session
            </Button>
            <Button onClick={() => setPlanDraft({ name: '', goal: '', daysPerWeek: '3', weeks: '8', active: true, split: [] })}>
              <Plus size={14} /> New plan
            </Button>
            <Button variant="ghost" onClick={() => navigate('/posture')}>
              Posture & presence
            </Button>
          </>
        }
        meta={[
          { label: 'Sessions', value: String(stats.sessions) },
          { label: 'Sets logged', value: String(stats.setsLogged) },
          { label: 'Library', value: `${exercises.length} exercises (${stats.seededExercises} starter)` },
          { label: 'Body data', value: settings ? `${settings.weightTracking ? 'weight on' : 'weight off'} / ${settings.measurementsTracking ? 'measure on' : 'measure off'}` : '—' }
        ]}
      />

      <StatStrip
        items={[
          { label: 'Total logged volume', value: Math.round(stats.totalVolume).toLocaleString(), hint: 'Σ reps × load, your unit as entered' },
          { label: 'Average per session', value: stats.sessions ? Math.round(stats.avgVolume).toLocaleString() : '—', hint: `over ${stats.sessions} sessions` },
          { label: 'Last session', value: stats.lastSession ? formatDate(stats.lastSession) : 'none', hint: 'from workoutSessions.doneOn' },
          { label: 'Active plans', value: String(stats.activePlans), hint: `${plans.length} stored` },
          { label: 'Safety-flagged entries', value: String(unsafeTechniques.length), hint: 'rows marked unsafe in your evidence library' }
        ]}
      />

      {/* ------------------------------------------------------------ plans */}
      <section className="gl-section">
        <div className="gl-section__title">
          <div>
            <div className="gl-eyebrow">Programming</div>
            <h2>Plans, days and blocks</h2>
          </div>
          <div className="gl-row gl-row--tight">
            <Button size="sm" variant="primary" onClick={() => setPlanDraft({ name: '', goal: '', daysPerWeek: '3', weeks: '8', active: true, split: [] })}>
              <Plus size={13} /> New plan
            </Button>
            <Button size="sm" onClick={() => setExerciseDraft({ name: '', pattern: 'squat', focus: [], equipment: [], difficulty: '2', cue: '', caution: '' })}>
              <Dumbbell size={13} /> Add exercise
            </Button>
          </div>
        </div>

        {plans.length === 0 ? (
          <EmptyPlate
            kicker="Section 01"
            title="No training plan stored yet"
            body="A plan here is just a name, a goal, and a list of days whose blocks say exercise × sets × rep range × rest. Build one from your exercise library, or log a session without any plan at all — the log does not require programming."
            action={<Button variant="primary" onClick={() => setPlanDraft({ name: '', goal: '', daysPerWeek: '3', weeks: '8', active: true, split: [] })}>Write the first plan</Button>}
          />
        ) : (
          <div className="gl-grid gl-grid--2">
            {plans.map((p) => {
              const days = (p.split as WorkoutDay[]) ?? [];
              return (
                <Card key={p.id} variant={p.active ? 'accent' : 'default'}>
                  <CardHead
                    title={p.name}
                    eyebrow={`${p.goal || 'no stated goal'} · ${days.length} day(s) · ${p.weeks ?? 0} weeks`}
                    right={
                      <>
                        <Chip tone={p.active ? 'gold' : 'info'}>{p.active ? 'active' : 'paused'}</Chip>
                        <IconButton label={`Edit ${p.name}`} onClick={() => setPlanDraft({ id: p.id, name: p.name ?? '', goal: p.goal ?? '', daysPerWeek: String(p.daysPerWeek ?? ''), weeks: String(p.weeks ?? ''), active: Boolean(p.active), split: days })}>
                          <Sparkles size={14} />
                        </IconButton>
                        <IconButton label={`Delete ${p.name}`} onClick={() => setConfirmDel({ table: TABLES.workoutPlans, id: p.id, label: p.name })}>
                          <Trash2 size={14} />
                        </IconButton>
                      </>
                    }
                  />
                  {days.length === 0 ? <p className="gl-small gl-muted">No days built in this plan yet.</p> : null}
                  {days.map((d) => (
                    <div key={d.id} style={{ marginBottom: 'var(--glow-sp-3)' }}>
                      <div className="gl-row gl-row--between">
                        <div className="gl-serif" style={{ fontSize: '1.1rem' }}>{d.label}</div>
                        <Button size="sm" variant="ghost" onClick={() => { setSessionDraft({ ...blankSession(), planDayId: d.id, label: `${p.name} · ${d.label}` }); prefillFromDay(p.id, d.id); }}>
                          Log this day
                        </Button>
                      </div>
                      <div className="gl-tech">{d.focus || 'focus not set'}</div>
                      <div className="gl-list">
                        {(d.blocks ?? []).map((b, i) => (
                          <div className="gl-list__row" key={`${d.id}-${i}`}>
                            <span>{exerciseById.get(String(b.exerciseId))?.name ?? 'exercise removed'}</span>
                            <span className="gl-tech">{b.sets} × {b.reps} · rest {b.restSec}s</span>
                          </div>
                        ))}
                        {!d.blocks?.length ? <span className="gl-small gl-muted">Empty day.</span> : null}
                      </div>
                    </div>
                  ))}
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* -------------------------------------------------------- progression */}
      <section className="gl-section">
        <div className="gl-section__title">
          <div>
            <div className="gl-eyebrow">Progression</div>
            <h2>What your logged numbers say</h2>
          </div>
          <Field label="Exercise">
            <Select
              value={focusId}
              onChange={setFocusExercise}
              placeholder="Pick an exercise"
              options={[...prs.entries()].map(([id, v]) => ({ value: id, label: `${exerciseById.get(id)?.name ?? 'unknown exercise'} (top ${v.kg})` }))}
            />
          </Field>
        </div>

        {!focusId ? (
          <Card>
            <CardHead title="Nothing charted yet" sub="Charts need rows: log a session with at least one completed set." />
            <Button variant="primary" size="sm" onClick={() => setSessionDraft(blankSession())}>
              Log your first session
            </Button>
          </Card>
        ) : (
          <div className="gl-split">
            <Card>
              <CardHead
                title="Heaviest completed set per session"
                eyebrow={`${exerciseById.get(focusId)?.name ?? 'exercise'} · ${progression.labels.length} sessions`}
                right={<Chip tone="gold">{stats.weeks.length} weekly bars</Chip>}
              />
              <LineChart labels={progression.labels} series={[{ label: 'Top set (load as logged)', data: progression.top, area: true }]} yTitle="load" />
              <div className="gl-tech" style={{ marginTop: 8 }}>
                formula: per session, max(kg) over sets marked done. Nothing is estimated for skipped sessions — they simply do not
                appear on the line.
              </div>
              <BarChart
                labels={stats.weeks.map((w) => w[0])}
                series={[{ label: 'Weekly volume (Σ reps × load)', data: stats.weeks.map((w) => Math.round(w[1])) }]}
                height={180}
              />
            </Card>

            <div className="gl-stack">
              <Card>
                <CardHead title="Personal record, as this app defines it" sub="A maximum over your own rows. No spotter, no federation, no verification." />
                <div className="fb-pr">
                  <div>
                    <div className="gl-label">Best load</div>
                    <div className="gl-stat">{focusPr && focusPr.kg >= 0 ? focusPr.kg : '—'}</div>
                    <div className="gl-tech">for {focusPr?.reps ?? 0} reps on {formatDate(focusPr?.on ?? null)}</div>
                  </div>
                  <div>
                    <div className="gl-label">Sets compared</div>
                    <div className="gl-stat">{focusPr?.sets ?? 0}</div>
                    <div className="gl-tech">across {focusPr?.sessions ?? 0} session(s)</div>
                  </div>
                  <div>
                    <div className="gl-label">Cue from the library</div>
                    <div className="gl-small">{focusRow?.cue || 'no cue recorded'}</div>
                  </div>
                </div>
                {focusRow?.caution ? <div className="gl-note" style={{ marginTop: 'var(--glow-sp-3)' }}>{focusRow.caution}</div> : null}
              </Card>

              <Card>
                <CardHead title="Consistency, last 112 days" eyebrow="one cell per calendar day" sub="A cell lights only when a session row exists for that date." />
                <HeatStrip days={heat} />
                <div className="gl-tech" style={{ marginTop: 8 }}>
                  {heat.filter((d) => d.level > 0).length} logged days out of {heat.length}.
                </div>
              </Card>
            </div>
          </div>
        )}

        {sessions.length ? (
          <Disclosure summary={`Session log — ${sessions.length} rows`}>
            <Table
              rows={sessions.slice().sort((a, b) => String(b.doneOn).localeCompare(String(a.doneOn)))}
              keyOf={(r: AnyRow) => r.id}
              columns={[
                { label: 'Date', render: (r: AnyRow) => <span className="gl-tech">{formatDate(String(r.doneOn))}</span> },
                {
                  label: 'Session',
                  render: (r: AnyRow) => (
                    <button type="button" className="gl-btn gl-btn--link gl-btn--sm" onClick={() => setSessionDraft(fromSession(r))}>
                      {r.label}
                    </button>
                  )
                },
                { label: 'Exercises', render: (r: AnyRow) => <span>{((r.entries as any[]) ?? []).length}</span> },
                { label: 'Sets', render: (r: AnyRow) => <span className="gl-tech">{((r.entries as any[]) ?? []).reduce((a, e) => a + (e.sets ?? []).length, 0)}</span> },
                { label: 'Volume', render: (r: AnyRow) => <span className="gl-tech">{Math.round(sessionVolume((r.entries as any[]) ?? []))}</span> },
                { label: 'Minutes', render: (r: AnyRow) => <span className="gl-tech">{r.durationMin ?? 0}</span> },
                { label: 'RPE', render: (r: AnyRow) => <span className="gl-tech">{r.rpe ?? 0}/10</span> },
                {
                  label: '',
                  render: (r: AnyRow) => (
                    <IconButton label={`Delete session ${r.label}`} onClick={() => setConfirmDel({ table: TABLES.workoutSessions, id: r.id, label: String(r.label) })}>
                      <Trash2 size={13} />
                    </IconButton>
                  )
                }
              ]}
            />
          </Disclosure>
        ) : null}
      </section>

      {/* ------------------------------------------------- training digest (read-only) */}
      <section className="gl-section" data-testid="fitness-digest">
        <div className="gl-section__title">
          <div>
            <div className="gl-eyebrow">Read-only · nothing in this section writes</div>
            <h2>What your logged sessions add up to</h2>
          </div>
          <div className="gl-row gl-row--tight">
            {digest.empty ? (
              <Chip>nothing logged in this window</Chip>
            ) : (
              <Chip>{fmt(digest.totals.sessions, { digits: 0 })} session(s) you logged in it</Chip>
            )}
            <Chip tone="info">
              {formatDate(digest.window.from)} → {formatDate(digest.window.to)}
            </Chip>
          </div>
        </div>

        <div className="gl-note fb-digest__limits" data-testid="digest-limits">
          {DIGEST_LIMITS}
        </div>

        {digest.empty ? (
          <div className="fb-digest" data-testid="digest-empty">
            <EmptyPlate
              kicker="Training digest"
              title="Nothing logged in this window"
              body="The digest reads session rows and nothing else, and these weeks hold none. An empty window describes the log, not you. Save a session anywhere on this page and every figure below appears on its own, computed from what you typed."
            />
            <div className="gl-tech" data-testid="digest-empty-reach" style={{ marginTop: 'var(--glow-sp-3)' }}>
              {digest.quality.olderThanWindow
                ? `${fmt(digest.quality.olderThanWindow, { digits: 0 })} dated session row(s) sit before this window. The digest does not reach back further than ${fmt(digest.window.weeks, { digits: 0 })} weeks, so it is reporting none of them.`
                : digest.totals.lastLogged
                  ? `The newest dated session row is ${formatDate(digest.totals.lastLogged)}, outside this window.`
                  : 'There is no dated session row in the log at all yet.'}
            </div>
          </div>
        ) : (
          <div className="fb-digest gl-stack" style={{ marginTop: 'var(--glow-sp-4)' }}>
            <div className="gl-split">
              {/* ------------------------------------------------ volume and cadence */}
              <Card>
                <CardHead
                  title="Volume and cadence, week by week"
                  eyebrow={`${fmt(digest.weeks.length, { digits: 0 })} weeks, Monday to Sunday`}
                  sub="The same weeks the grid above draws and the same volume the stats strip adds — Σ reps × load over the sets you marked done."
                />
                <div data-testid="digest-weeks">
                  <Table
                    rows={digest.weeks}
                    keyOf={(w: DigestWeek) => w.weekOf}
                    columns={[
                      { label: 'Week from', render: (w: DigestWeek) => <span className="gl-tech">{formatDate(w.weekOf)}</span> },
                      {
                        label: 'Sessions you logged',
                        render: (w: DigestWeek) => <span className="gl-tech">{w.hasSession ? fmt(w.sessions, { digits: 0 }) : 'no session'}</span>
                      },
                      { label: 'Days logged', render: (w: DigestWeek) => <span className="gl-tech">{w.hasSession ? fmt(w.days, { digits: 0 }) : '—'}</span> },
                      {
                        label: 'Volume you logged',
                        render: (w: DigestWeek) => <span className="gl-tech">{w.hasSession ? fmt(w.volume, { digits: 0, unit: digest.volumeUnit }) : '—'}</span>
                      },
                      {
                        label: 'Per session',
                        render: (w: DigestWeek) => <span className="gl-tech">{w.perSession === null ? '—' : fmt(w.perSession, { digits: 1, unit: digest.volumeUnit })}</span>
                      }
                    ]}
                  />
                </div>

                <div className="gl-inset" style={{ marginTop: 'var(--glow-sp-3)' }} data-testid="digest-totals">
                  <div className="gl-label">Across the window, from your rows</div>
                  <div className="gl-tech">
                    {fmt(digest.totals.sessions, { digits: 0 })} session(s) ·{' '}
                    {fmt(digest.quality.doneSets, { digits: 0 })} completed set(s) · volume{' '}
                    {fmt(digest.totals.volume, { digits: 0, unit: digest.volumeUnit })} · per session{' '}
                    {fmt(digest.totals.perSession, { digits: 1, unit: digest.volumeUnit })} ·{' '}
                    {fmt(digest.totals.weeksWithSessions, { digits: 0 })} of {fmt(digest.weeks.length, { digits: 0 })} weeks carry a
                    session
                  </div>
                  <div className="gl-tech" style={{ marginTop: 6 }}>
                    A week with no session row reads “no session”, not a zero you logged, and the trend fit uses only the weeks that
                    carry one.
                  </div>
                  {!digest.volumeUnit ? (
                    <div className="gl-note gl-note--warn" style={{ marginTop: 'var(--glow-sp-3)' }} data-testid="digest-no-unit">
                      No completed set in this window carries a load, so these totals carry no unit. Reps logged without a load add
                      nothing here, and nothing is estimated for them.
                    </div>
                  ) : null}
                </div>
              </Card>

              <div className="gl-stack">
                {/* ------------------------------------------------------- trend */}
                <Card>
                  <CardHead
                    title="Trend of weekly volume"
                    eyebrow="least squares over the weeks that carry a session"
                    sub="The house trend engine, with its own refusal when the series is too short to point anywhere."
                    right={
                      <Chip tone={digest.trend.usable ? 'gold' : 'info'}>
                        {digest.trend.usable ? digest.trend.direction : 'no direction claimed'}
                      </Chip>
                    }
                  />
                  <p className="gl-small" data-testid="digest-trend-sentence">
                    {digest.trend.sentence}
                  </p>
                  <div className="gl-tech" data-testid="digest-trend-meta" style={{ marginTop: 8 }}>
                    {fmt(digest.trendPoints, { digits: 0 })} week(s) with a session fed the fit;{' '}
                    {fmt(digest.completeWeeks, { digits: 0 })} complete week(s) in the window.{' '}
                    {digest.trend.usable
                      ? 'This is a description of the weeks you logged, not a forecast of the weeks ahead.'
                      : `What the engine says it would need: ${digest.trend.needs.join(' · ') || 'more logged weeks'}.`}
                  </div>
                </Card>

                {/* -------------------------------------------------------- gaps */}
                <Card>
                  <CardHead
                    title="Rest gaps between sessions"
                    eyebrow={`${fmt(digest.gaps.distinctDays, { digits: 0 })} logged day(s) in the window`}
                    sub="Distances between the dates you logged. Nothing else."
                  />
                  <div className="gl-list" data-testid="digest-gaps">
                    <div className="gl-list__row">
                      <span>Longest gap inside the window</span>
                      <span className="gl-tech">{digest.gaps.longest ? gapPhrase(digest.gaps.longest) : 'needs two logged days'}</span>
                    </div>
                    <div className="gl-list__row">
                      <span>Since your last logged session</span>
                      <span className="gl-tech">{digest.gaps.current ? gapPhrase(digest.gaps.current) : 'no session in the window'}</span>
                    </div>
                    <div className="gl-list__row">
                      <span>Average distance between logged days</span>
                      <span className="gl-tech">
                        {digest.gaps.averageDays === null ? 'needs two logged days' : `${fmt(digest.gaps.averageDays, { digits: 1 })} days`}
                      </span>
                    </div>
                    {digest.gaps.boundary ? (
                      <div className="gl-list__row">
                        <span>Gap crossing into the window</span>
                        <span className="gl-tech">{gapPhrase(digest.gaps.boundary)}</span>
                      </div>
                    ) : null}
                  </div>
                  <div className="gl-tech" style={{ marginTop: 8 }}>
                    {digest.gaps.boundary
                      ? 'The window has an edge: the stretch before your first in-window session is listed separately rather than dropped.'
                      : 'No dated session sits before this window, so nothing is being cut off at its edge.'}
                  </div>
                  <div className="gl-note" style={{ marginTop: 'var(--glow-sp-3)' }} data-testid="digest-gaps-limits">
                    {GAP_NOT_EXPLAINED}
                  </div>
                </Card>
              </div>
            </div>

            <div className="gl-grid gl-grid--2">
              {/* --------------------------------------------------- adherence */}
              <Card>
                <CardHead
                  title="Adherence to the active plan"
                  eyebrow={
                    digest.adherence.planName
                      ? `${digest.adherence.planName}${digest.adherence.activePlans > 1 ? ` — 1 of ${fmt(digest.adherence.activePlans, { digits: 0 })} plans marked active` : ''}`
                      : 'no plan marked active'
                  }
                  sub="Your plan row's own target against your own dates. If the row carries no target, this says so instead of inventing one."
                  right={<Chip tone={digest.adherence.available ? 'gold' : 'info'}>{digest.adherence.available ? `target from ${digest.adherence.targetField}` : 'no readable target'}</Chip>}
                />
                {digest.adherence.available ? (
                  <div data-testid="digest-adherence-scored">
                    <div className="fb-digest__figures">
                      <div>
                        <div className="gl-label">Weeks that hit it</div>
                        <div className="gl-stat">{fmt(digest.adherence.hitWeeks, { digits: 0 })}</div>
                        <div className="gl-tech">of {fmt(digest.adherence.weeksScored, { digits: 0 })} complete week(s) scored</div>
                      </div>
                      <div>
                        <div className="gl-label">Weeks that missed it</div>
                        <div className="gl-stat">{fmt(digest.adherence.missedWeeks, { digits: 0 })}</div>
                        <div className="gl-tech">target {fmt(digest.adherence.target, { digits: 0 })} day(s) per week</div>
                      </div>
                    </div>
                    <div className="gl-list" style={{ marginTop: 'var(--glow-sp-3)' }} data-testid="digest-adherence-weeks">
                      {digest.adherence.detail.map((w) => (
                        <div className="gl-list__row" key={w.weekOf}>
                          <span className="gl-tech">{formatDate(w.weekOf)}</span>
                          <span>{w.logged ? `${fmt(w.days, { digits: 0 })} day(s) with a session` : 'no session logged'}</span>
                          <Chip tone={w.hit ? 'gold' : 'info'}>{w.hit ? 'target met' : 'under target'}</Chip>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="gl-tech" data-testid="digest-cadence-only" style={{ marginBottom: 'var(--glow-sp-3)' }}>
                    Cadence with no denominator: {fmt(digest.totals.sessions, { digits: 0 })} session(s) you logged across{' '}
                    {fmt(digest.totals.weeksWithSessions, { digits: 0 })} week(s) that carry one —{' '}
                    {fmt(digest.totals.sessionsPerActiveWeek, { digits: 2 })} sessions per logged week, and{' '}
                    {fmt(digest.gaps.averageDays, { digits: 1 })} days between logged days on average.
                  </div>
                )}
                <div className="gl-note" data-testid="digest-adherence-note">
                  {digest.adherence.note}
                </div>
              </Card>

              {/* --------------------------------------------------- coverage */}
              <Card>
                <CardHead
                  title="What you log against what is catalogued"
                  eyebrow={`${fmt(digest.coverage.loggedIds, { digits: 0 })} exercise id(s) appear in these sessions · ${fmt(
                    digest.coverage.libraryRows,
                    { digits: 0 }
                  )} row(s) in your library`}
                  sub="Coverage of your own records. It is not a suggestion of what you should be training."
                />
                <div className="gl-label">Most volume in this window</div>
                {digest.coverage.top.length ? (
                  <div className="gl-list" data-testid="digest-coverage-top">
                    {digest.coverage.top.map((e) => (
                      <div className="gl-list__row" key={e.id}>
                        <span>{e.name ?? 'no library row for this id'}</span>
                        <span className="gl-tech">
                          {fmt(e.sessions, { digits: 0 })} session(s) · {fmt(e.doneSets, { digits: 0 })} done set(s) ·{' '}
                          {fmt(e.volume, { digits: 0, unit: digest.volumeUnit })}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="gl-tech" data-testid="digest-coverage-top">
                    No session entry in this window names an exercise.
                  </div>
                )}

                <div className="gl-tech" style={{ marginTop: 6 }} data-testid="digest-coverage-rest">
                  {digest.coverage.loggedIds > digest.coverage.top.length
                    ? `${fmt(digest.coverage.loggedIds - digest.coverage.top.length, { digits: 0 })} further exercise id(s) appear in these sessions and are not listed — the list stops at the volume figures, not at the log.`
                    : `${fmt(digest.coverage.loggedIds, { digits: 0 })} exercise id(s) appear in these sessions, all listed above.`}
                </div>

                <div className="gl-tech" style={{ marginTop: 'var(--glow-sp-3)' }} data-testid="digest-coverage-never">
                  {digest.coverage.neverLogged === 0
                    ? `Every one of the ${fmt(digest.coverage.libraryRows, { digits: 0 })} library row(s) appears in at least one session in this window.`
                    : `${fmt(digest.coverage.neverLogged, { digits: 0 })} library row(s) appear in none of these sessions: ${digest.coverage.neverLoggedRows
                        .slice(0, 12)
                        .map((e) => e.name)
                        .join(', ')}${digest.coverage.neverLogged > 12 ? `, and ${fmt(digest.coverage.neverLogged - 12, { digits: 0 })} more` : ''}.`}
                </div>
                {digest.coverage.untracked.length ? (
                  <div className="gl-tech" style={{ marginTop: 6 }} data-testid="digest-coverage-untracked">
                    {fmt(digest.coverage.untracked.length, { digits: 0 })} logged exercise id(s) have no library row behind them — the
                    volume still counts, the name is simply unavailable: {digest.coverage.untracked.slice(0, 6).map((u) => u.id).join(', ')}
                    {digest.coverage.untracked.length > 6 ? ', …' : ''}.
                  </div>
                ) : null}
                {digest.coverage.entriesWithoutExercise ? (
                  <div className="gl-tech" style={{ marginTop: 6 }} data-testid="digest-coverage-unnamed">
                    {fmt(digest.coverage.entriesWithoutExercise, { digits: 0 })} entry row(s) in this window carry no exercise id, so
                    they count toward session volume but toward no exercise.
                  </div>
                ) : null}
              </Card>
            </div>

            {/* -------------------------------------------------- data quality */}
            <Card>
              <CardHead
                title="How complete your own logging is"
                eyebrow="counted over the same rows the figures above use"
                sub="Every number in this section is computed only over rows that carry it. This is where they do not."
                right={<Chip>{fmt(digest.quality.sessionsInWindow, { digits: 0 })} row(s) in the window</Chip>}
              />
              {digest.quality.rowsOutsideWindow === 0 ? null : (
                <div className="gl-tech" style={{ marginBottom: 8 }} data-testid="digest-quality-excluded">
                  {fmt(digest.quality.olderThanWindow, { digits: 0 })} dated session(s) before the window and{' '}
                  {fmt(digest.quality.afterWindow, { digits: 0 })} after it are outside the read;{' '}
                  {fmt(digest.quality.rowsWithoutDate, { digits: 0 })} row(s) carry no usable date and are excluded from everything.
                </div>
              )}
              <div className="gl-list" data-testid="digest-quality">
                {qualityFlags(digest).map((f) => (
                  <div className="gl-list__row" key={f.label}>
                    <span>{f.label}</span>
                    <span className="gl-tech">{f.value}</span>
                  </div>
                ))}
              </div>
              <div className="gl-tech" style={{ marginTop: 8 }}>
                Volume is Σ reps × load over the sets you marked done. A set stored as not done is a set you said you did not do, so it
                adds nothing and is counted here instead.
              </div>
            </Card>
          </div>
        )}
      </section>

      {/* ------------------------------------------------------- body stats */}
      <section className="gl-section">
        <div className="gl-section__title">
          <div>
            <div className="gl-eyebrow">Optional and off by default</div>
            <h2>Body measurements and weight</h2>
          </div>
        </div>

        {!settings ? (
          <EmptyState title="Reading your preferences…" body="Two switches decide what this panel shows; they are stored in your settings row, not in a cloud." />
        ) : (
          <div className="gl-stack">
            <div className="gl-grid gl-grid--2">
              <Card>
                <Toggle
                  checked={settings.weightTracking}
                  onChange={(v) => patchSettings({ weightTracking: v })}
                  label="Track weight entries"
                  hint="Off means no weight field, no weight chart and nothing stored in weightEntries. Turn it on only if number-tracking helps you — for many people it does not, and this app is not offended either way."
                />
              </Card>
              <Card>
                <Toggle
                  checked={settings.measurementsTracking}
                  onChange={(v) => patchSettings({ measurementsTracking: v })}
                  label="Track body measurements"
                  hint="Off hides the tape-measure form and the per-site trend. Measurements are your own numbers on your own tape, nothing more."
                />
              </Card>
            </div>

            {!settings.weightTracking && !settings.measurementsTracking ? (
              <div className="fb-gate">
                <div className="gl-serif" style={{ fontSize: '1.3rem', marginBottom: 6 }}>Nothing is being tracked, and that is a supported configuration</div>
                <p className="gl-small">
                  This department's core job is training history: what you lifted, how it felt, whether the line went up. Neither
                  goal requires a body number. Weight and measurements are gated because they are the two fields people most often
                  regret logging, and because a single number on one morning says almost nothing — hydration, food, cycle, sleep and
                  a recent drink all move it more than tissue does.
                </p>
                <p className="gl-small gl-muted">
                  If you do turn either on: no target appears anywhere, no "should be" is computed, and no plan is generated from it.
                  You get a chart of the values you entered, and the honest caveat that trends under about eight entries are noise.
                </p>
              </div>
            ) : null}

            {(settings.weightTracking || settings.measurementsTracking) && (
              <div className="gl-split">
                <div className="gl-stack">
                  {settings.weightTracking ? (
                    <Card>
                      <CardHead
                        title="Weight entries"
                        eyebrow="kg, date, context"
                        right={<Chip>{weights.length} stored</Chip>}
                      />
                      <div className="gl-form-row">
                        <Field label="Kilograms" hint="One number. If you would rather log in pounds, note it in the context line.">
                          <TextInput type="number" value={weightDraft.kg} onChange={(v) => setWeightDraft({ ...weightDraft, kg: v })} placeholder="0.0" />
                        </Field>
                        <DateInput label="Date" value={weightDraft.loggedOn} onChange={(v) => setWeightDraft({ ...weightDraft, loggedOn: v })} />
                        <Field label="Context" hint="Morning/fasting/travel/after a heavy meal — this line is what makes the series readable later.">
                          <TextInput value={weightDraft.context} onChange={(v) => setWeightDraft({ ...weightDraft, context: v })} placeholder="First thing, before coffee" />
                        </Field>
                      </div>
                      <Button size="sm" variant="primary" onClick={() => void saveWeight()}>
                        <Save size={13} /> Store entry
                      </Button>
                      {weightSeries.length > 1 ? (
                        <>
                          <LineChart
                            labels={weightSeries.map((w) => String(w.loggedOn))}
                            series={[{ label: 'Logged kg', data: weightSeries.map((w) => Number(w.kg)), stepped: false }]}
                            height={190}
                            yTitle="kg"
                          />
                          <div className="gl-tech">
                            first {weightSeries[0].kg} on {formatDate(String(weightSeries[0].loggedOn))} → last{' '}
                            {weightSeries[weightSeries.length - 1].kg} on {formatDate(String(weightSeries[weightSeries.length - 1].loggedOn))} =
                            delta {(Number(weightSeries[weightSeries.length - 1].kg) - Number(weightSeries[0].kg)).toFixed(1)} kg over{' '}
                            {weightSeries.length} entries. No target, no rate, no recommendation.
                          </div>
                        </>
                      ) : (
                        <p className="gl-small gl-muted">A second entry is the minimum for a line. One point cannot be a trend.</p>
                      )}
                      <div className="gl-list">
                        {weightSeries.slice(-8).map((w) => (
                          <div className="gl-list__row" key={w.id}>
                            <span className="gl-tech">{formatDate(String(w.loggedOn))} · {w.kg} kg</span>
                            <span className="gl-small gl-muted">{w.context || 'no context'}</span>
                            <IconButton label="Delete entry" onClick={() => setConfirmDel({ table: TABLES.weightEntries, id: w.id, label: `${w.kg} kg on ${formatDate(String(w.loggedOn))}` })}>
                              <Trash2 size={13} />
                            </IconButton>
                          </div>
                        ))}
                      </div>
                    </Card>
                  ) : null}

                  {settings.measurementsTracking ? (
                    <Card>
                      <CardHead title="Tape measurements" eyebrow="your method, your numbers" right={<Chip>{measurements.length} stored</Chip>} />
                      <div className="gl-form-row">
                        <Field label="Site">
                          <Select value={measureDraft.site} onChange={(v) => setMeasureDraft({ ...measureDraft, site: v })} options={MEASURE_SITES.map((s) => ({ value: s, label: s }))} />
                        </Field>
                        <Field label="Value">
                          <TextInput type="number" value={measureDraft.value} onChange={(v) => setMeasureDraft({ ...measureDraft, value: v })} />
                        </Field>
                        <Field label="Unit">
                          <Select value={measureDraft.unit} onChange={(v) => setMeasureDraft({ ...measureDraft, unit: v })} options={[{ value: 'cm', label: 'cm' }, { value: 'in', label: 'in' }]} />
                        </Field>
                        <DateInput label="Taken on" value={measureDraft.takenOn} onChange={(v) => setMeasureDraft({ ...measureDraft, takenOn: v })} />
                      </div>
                      <div className="gl-form-row">
                        <Field label="Method" hint="Same method twice is what makes a comparison mean anything.">
                          <TextInput value={measureDraft.method} onChange={(v) => setMeasureDraft({ ...measureDraft, method: v })} placeholder="Tape relaxed, end of exhale" />
                        </Field>
                        <Field label="Note">
                          <TextInput value={measureDraft.note} onChange={(v) => setMeasureDraft({ ...measureDraft, note: v })} placeholder="Anything that changed" />
                        </Field>
                      </div>
                      <Button size="sm" variant="primary" onClick={() => void saveMeasurement()}>
                        <Ruler size={13} /> Store measurement
                      </Button>

                      {measureTrend.length ? (
                        <div className="gl-stack" style={{ marginTop: 'var(--glow-sp-4)' }}>
                          {measureTrend.slice(0, 4).map((t) => (
                            <div key={t.site}>
                              <div className="gl-row gl-row--between">
                                <span className="gl-serif" style={{ fontSize: '1.05rem' }}>{t.site}</span>
                                <span className="gl-tech">
                                  {t.rows.length} entries · {t.rows[0].value}
                                  {t.unit} → {t.rows[t.rows.length - 1].value}
                                  {t.unit} ({t.delta > 0 ? '+' : ''}
                                  {t.delta.toFixed(1)}
                                  {t.unit})
                                </span>
                              </div>
                              {t.rows.length > 1 ? (
                                <LineChart labels={t.rows.map((r) => String(r.takenOn))} series={[{ label: `${t.site} ${t.unit}`, data: t.rows.map((r) => Number(r.value)) }]} height={140} />
                              ) : (
                                <div className="gl-tech">Single point — no line drawn.</div>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </Card>
                  ) : null}
                </div>

                <Card>
                  <CardHead title="How to read your own numbers" sub="Written for this app's limits, not for motivation." />
                  <div className="gl-stack">
                    {[
                      'One weighing is one moment. Morning-vs-evening differences of 1–2 units are ordinary and mostly fluid and food.',
                      'Tape measurements move with technique more than tissue: same site, same tension, same time of day, or the comparison is decoration.',
                      'Strength going up while a measurement is flat is common and usually the better signal. Both are in this app; neither outranks the other.',
                      'Sudden, large or unexplained change is a reason to see a clinician, not a reason to adjust training harder.',
                      'This department will not compute an intake target, a deficit, a "cut", or a weigh-in schedule for an event.'
                    ].map((line, i) => (
                      <div key={i} className="fb-ref">
                        <span className="gl-small">{line}</span>
                      </div>
                    ))}
                    <Disclosure summary="Remove all body data from this device">
                      <p className="gl-small gl-muted">
                        {weights.length} weight row(s) and {measurements.length} measurement row(s) exist. Soft-deleting keeps them
                        restorable; Settings has the hard-delete and export path.
                      </p>
                      <div className="gl-row gl-row--tight">
                        {weights.map((w) => (
                          <Chip key={w.id} onClick={() => setConfirmDel({ table: TABLES.weightEntries, id: w.id, label: `${w.kg} kg` })}>
                            {formatDate(String(w.loggedOn))} ✕
                          </Chip>
                        ))}
                        {measurements.map((m) => (
                          <Chip key={m.id} onClick={() => setConfirmDel({ table: TABLES.measurements, id: m.id, label: `${m.site} ${m.value}${m.unit}` })}>
                            {m.site} ✕
                          </Chip>
                        ))}
                      </div>
                    </Disclosure>
                  </div>
                </Card>
              </div>
            )}
          </div>
        )}
      </section>

      {/* --------------------------------------------------------- library */}
      <section className="gl-section">
        <div className="gl-section__title">
          <div>
            <div className="gl-eyebrow">Movement library</div>
            <h2>Exercises, cues and cautions</h2>
          </div>
          <div className="gl-row gl-row--tight">
            <Chip>{exercises.length} rows</Chip>
            {stats.seededExercises > 0 ? (
              <>
                <Chip tone="gold">{stats.seededExercises} starter content</Chip>
                <Button size="sm" variant="ghost" onClick={() => setConfirmDel({ table: TABLES.exercises, id: '__all_seeded__', label: 'all starter exercises' })}>
                  Remove starter set
                </Button>
              </>
            ) : null}
            <Button size="sm" variant="primary" onClick={() => setExerciseDraft({ name: '', pattern: 'squat', focus: [], equipment: [], difficulty: '2', cue: '', caution: '' })}>
              <Plus size={13} /> Custom exercise
            </Button>
          </div>
        </div>

        {exercises.length === 0 ? (
          <EmptyPlate
            kicker="Section 04"
            title="No exercises in the library"
            body="Add your own movements with the cues you actually respond to. A short library is fine — most people train a handful of patterns well."
            action={<Button variant="primary" onClick={() => setExerciseDraft({ name: '', pattern: 'squat', focus: [], equipment: [], difficulty: '2', cue: '', caution: '' })}>Add one</Button>}
          />
        ) : (
          <div className="fb-list">
            {exercises.map((e) => {
              const pr = prs.get(e.id);
              return (
                <div className="fb-row" key={e.id}>
                  <div style={{ minWidth: 0 }}>
                    <span className="gl-serif" style={{ fontSize: '1.08rem' }}>{e.name}</span>
                    <span className="gl-tech" style={{ marginLeft: 8 }}>
                      {e.pattern} · {(e.focus as string[])?.join(', ')} · {(e.equipment as string[])?.join('/')} · difficulty {e.difficulty ?? 1}/5
                    </span>
                    {e.cue ? <div className="gl-small gl-muted">{e.cue}</div> : null}
                    {e.caution ? <div className="gl-small" style={{ color: 'var(--glow-warn)' }}>{e.caution}</div> : null}
                  </div>
                  <div className="gl-row gl-row--tight">
                    {e.seed === 1 ? <Chip tone="gold" title="Shipped with the app; delete it if it is noise for you">starter content</Chip> : null}
                    {pr && pr.kg >= 0 ? <Chip tone="gold">best {pr.kg} × {pr.reps}</Chip> : <Chip>no sets logged</Chip>}
                    <Button size="sm" variant="ghost" onClick={() => setSessionDraft({ ...blankSession(), entries: [{ exerciseId: e.id, sets: [blankSet()] }] })}>
                      Log now
                    </Button>
                    <IconButton label={`Edit ${e.name}`} onClick={() => setExerciseDraft({ id: e.id, name: e.name ?? '', pattern: String(e.pattern ?? 'squat'), focus: (e.focus as string[]) ?? [], equipment: (e.equipment as string[]) ?? [], difficulty: String(e.difficulty ?? 1), cue: e.cue ?? '', caution: e.caution ?? '' })}>
                      <Sparkles size={13} />
                    </IconButton>
                    <IconButton label={`Delete ${e.name}`} onClick={() => setConfirmDel({ table: TABLES.exercises, id: e.id, label: e.name })}>
                      <Trash2 size={13} />
                    </IconButton>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {stats.weeks.length ? (
          <Card style={{ marginTop: 'var(--glow-sp-4)' }}>
            <CardHead title="Volume by week" eyebrow="Σ reps × load over completed sets" />
            <DistributionBars rows={stats.weeks.map(([w, v]) => ({ label: w, value: Math.round(v) }))} />
          </Card>
        ) : null}
      </section>

      {/* --------------------------------------------------------- reference */}
      <section className="gl-section">
        <div className="gl-section__title">
          <div>
            <div className="gl-eyebrow">Reference</div>
            <h2>Body & lifestyle techniques, graded</h2>
          </div>
          <Chip tone="info">{bodyTechniques.length} rows from your evidence library</Chip>
        </div>
        <p className="gl-small gl-muted">
          These are the app's bundled reference rows, filtered to the body and lifestyle domains. The grading, the risk list and the
          "when to consult" line come from the row itself — this page adds no claims of its own.
        </p>
        <div className="gl-grid gl-grid--2">
          {bodyTechniques.map((t) => (
            <Card key={t.id}>
              <div className="fb-ref" data-safety={t.safety}>
                <div className="gl-row gl-row--between" style={{ alignItems: 'baseline' }}>
                  <div className="gl-serif" style={{ fontSize: '1.15rem' }}>{t.title}</div>
                  <Chip>{t.costBand}</Chip>
                </div>
                <div className="gl-small gl-strong">{t.claim}</div>
                <p className="gl-small gl-muted">{t.evidenceSummary}</p>
                {(t.risks as string[])?.length ? (
                  <div className="gl-small">
                    <span className="gl-label">Risks listed on the row</span>
                    <ul style={{ margin: '4px 0 0 18px' }}>
                      {(t.risks as string[]).map((r) => (
                        <li key={r}>{r}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                <div className="gl-row gl-row--tight" style={{ marginTop: 8, flexWrap: 'wrap' }}>
                  <Chip tone={t.evidence as any}>{String(t.evidence)}</Chip>
                  {t.safety === 'unsafe' ? <SafetyBanner tone="danger">Marked unsafe in the reference library — not offered as an option here.</SafetyBanner> : null}
                  {(t.whenToConsult as string) ? <span className="gl-tech">Consult: {t.whenToConsult}</span> : null}
                </div>
              </div>
            </Card>
          ))}
        </div>
      </section>

      {/* --------------------------------------------------------- refusals */}
      <section className="gl-section">
        <div className="gl-section__title">
          <div>
            <div className="gl-eyebrow">Refused by design</div>
            <h2>What I should not do — and what this app will not write for me</h2>
          </div>
          <Chip tone="danger">
            <Ban size={11} /> {REFUSALS.length} standing refusals
          </Chip>
        </div>
        <SafetyBanner tone="warn" title="The reason is capability, not moralising">
          This app has no weight, no bloods, no medical history, no licensed clinician and no way to see you. Anything it produced
          about intake, dehydration or hormones would be a guess with an authoritative font. So it produces none.
        </SafetyBanner>
        <div className="gl-grid gl-grid--3" style={{ marginTop: 'var(--glow-sp-4)' }}>
          {REFUSALS.map((r) => (
            <Card key={r.title}>
              <CardHead title={<><TriangleAlert size={13} /> {r.title}</>} eyebrow="will not be generated here" />
              <p className="gl-small">{r.reason}</p>
              <div className="gl-tech">Instead: {r.instead}</div>
            </Card>
          ))}
        </div>
        {unsafeTechniques.length ? (
          <Disclosure summary={`${unsafeTechniques.length} reference rows in your library are graded unsafe`}>
            <IndexList>
              {unsafeTechniques.map((t, i) => (
                <IndexRow key={t.id} no={i + 1} title={t.title} sub={(t.risks as string[])?.join(' · ') || t.evidenceSummary} right={<Chip tone="danger">{t.evidence}</Chip>} />
              ))}
            </IndexList>
          </Disclosure>
        ) : null}
        <div className="gl-row gl-row--tight" style={{ marginTop: 'var(--glow-sp-4)' }}>
          <Button size="sm" variant="ghost" onClick={() => navigate('/evidence')}>
            <BookOpen size={13} /> Full evidence centre
          </Button>
          <Button size="sm" variant="ghost" onClick={() => navigate('/services')}>
            Find a clinician
          </Button>
          <Button size="sm" variant="ghost" onClick={() => navigate('/calendar')}>
            Schedule sessions
          </Button>
          <Button size="sm" variant="ghost" onClick={() => navigate('/progress')}>
            Progress analytics
          </Button>
        </div>
      </section>

      <Card variant="flush">
        <KvList
          items={[
            { k: 'Written to', v: 'exercises, workoutPlans, workoutSessions, plus weightEntries / measurements only when you switch them on.' },
            { k: 'Volume', v: 'Σ reps × load for sets marked done. One unit throughout: whatever you typed.' },
            { k: 'PR', v: 'max(kg) over your logged sets. Not tested, not verified, not comparable to anyone else.' },
            { k: 'No plans invented', v: 'Sets, reps and loads come from you or from a plan row you built. Nothing was prescribed.' },
            { k: 'Red flags', v: 'Chest pain, fainting, numbness, a joint that will not bear load, or sudden weight change: stop and see a clinician.' }
          ]}
        />
      </Card>

      {/* ---------------------------------------------------------- session */}
      {sessionDraft ? (
        <SessionModal
          draft={sessionDraft}
          setDraft={setSessionDraft}
          exercises={exercises}
          dayOptions={dayOptions}
          onPrefill={prefillFromDay}
          onSave={() => void saveSession()}
          onClose={() => setSessionDraft(null)}
        />
      ) : null}

      <Modal
        open={Boolean(planDraft)}
        onClose={() => setPlanDraft(null)}
        wide
        title={planDraft?.id ? `Edit plan — ${planDraft.name}` : 'New plan'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPlanDraft(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void savePlan()}>
              <Check size={14} /> Store plan
            </Button>
          </>
        }
      >
        {planDraft ? (
          <div className="gl-stack">
            <div className="gl-form-row">
              <Field label="Plan name">
                <TextInput value={planDraft.name} onChange={(v) => setPlanDraft({ ...planDraft, name: v })} placeholder="Three days, eight weeks" />
              </Field>
              <Field label="Goal in your words">
                <TextInput value={planDraft.goal} onChange={(v) => setPlanDraft({ ...planDraft, goal: v })} placeholder="Get stronger at hinging" />
              </Field>
              <Field label="Days per week">
                <TextInput type="number" value={planDraft.daysPerWeek} onChange={(v) => setPlanDraft({ ...planDraft, daysPerWeek: v })} />
              </Field>
              <Field label="Weeks">
                <TextInput type="number" value={planDraft.weeks} onChange={(v) => setPlanDraft({ ...planDraft, weeks: v })} />
              </Field>
            </div>
            <Toggle checked={planDraft.active} onChange={(v) => setPlanDraft({ ...planDraft, active: v })} label="Active plan" />
            {planDraft.split.map((d, di) => (
              <div className="fb-entry" key={d.id}>
                <div className="gl-form-row">
                  <Field label="Day label">
                    <TextInput value={d.label} onChange={(v) => setPlanDraft({ ...planDraft, split: planDraft.split.map((x, i) => (i === di ? { ...x, label: v } : x)) })} />
                  </Field>
                  <Field label="Focus">
                    <TextInput value={d.focus} onChange={(v) => setPlanDraft({ ...planDraft, split: planDraft.split.map((x, i) => (i === di ? { ...x, focus: v } : x)) })} placeholder="hinge + push" />
                  </Field>
                  <Button size="sm" variant="ghost" onClick={() => setPlanDraft({ ...planDraft, split: planDraft.split.filter((_, i) => i !== di) })}>
                    <Trash2 size={12} /> Remove day
                  </Button>
                </div>
                {(d.blocks ?? []).map((b, bi) => (
                  <div className="gl-form-row" key={`${d.id}-${bi}`}>
                    <Field label="Exercise">
                      <Select
                        value={String(b.exerciseId)}
                        onChange={(v) => setPlanDraft({ ...planDraft, split: planDraft.split.map((x, i) => (i === di ? { ...x, blocks: x.blocks.map((y, j) => (j === bi ? { ...y, exerciseId: v } : y)) } : x)) })}
                        placeholder="Pick from library"
                        options={exercises.map((e) => ({ value: e.id, label: e.name }))}
                      />
                    </Field>
                    <Field label="Sets">
                      <TextInput type="number" value={String(b.sets)} onChange={(v) => setPlanDraft({ ...planDraft, split: planDraft.split.map((x, i) => (i === di ? { ...x, blocks: x.blocks.map((y, j) => (j === bi ? { ...y, sets: num(v) ?? 0 } : y)) } : x)) })} />
                    </Field>
                    <Field label="Reps">
                      <TextInput value={b.reps} onChange={(v) => setPlanDraft({ ...planDraft, split: planDraft.split.map((x, i) => (i === di ? { ...x, blocks: x.blocks.map((y, j) => (j === bi ? { ...y, reps: v } : y)) } : x)) })} placeholder="6–8" />
                    </Field>
                    <Field label="Rest (s)">
                      <TextInput type="number" value={String(b.restSec)} onChange={(v) => setPlanDraft({ ...planDraft, split: planDraft.split.map((x, i) => (i === di ? { ...x, blocks: x.blocks.map((y, j) => (j === bi ? { ...y, restSec: num(v) ?? 0 } : y)) } : x)) })} />
                    </Field>
                    <Button size="sm" variant="ghost" onClick={() => setPlanDraft({ ...planDraft, split: planDraft.split.map((x, i) => (i === di ? { ...x, blocks: x.blocks.filter((_, j) => j !== bi) } : x)) })}>
                      <Trash2 size={12} />
                    </Button>
                  </div>
                ))}
                <Button
                  size="sm"
                  onClick={() => setPlanDraft({ ...planDraft, split: planDraft.split.map((x, i) => (i === di ? { ...x, blocks: [...(x.blocks ?? []), { exerciseId: exercises[0]?.id ?? '', sets: 3, reps: '8', restSec: 120, note: '' }] } : x)) })}
                >
                  <Plus size={12} /> Add block
                </Button>
              </div>
            ))}
            <Button
              variant="primary"
              size="sm"
              onClick={() =>
                setPlanDraft({
                  ...planDraft,
                  split: [...planDraft.split, { id: newId('day'), label: `Day ${planDraft.split.length + 1}`, focus: '', blocks: [] }]
                })
              }
            >
              <Plus size={13} /> Add day
            </Button>
            <p className="gl-small gl-faint">
              A plan is a wish written down. Nothing here auto-generates progression, deloads or substitutions — when reality
              differs, log the actual session and edit the plan yourself.
            </p>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(exerciseDraft)}
        onClose={() => setExerciseDraft(null)}
        title={exerciseDraft?.id ? 'Edit exercise' : 'Add an exercise'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setExerciseDraft(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void saveExercise()}>
              Save exercise
            </Button>
          </>
        }
      >
        {exerciseDraft ? (
          <div className="gl-stack">
            <div className="gl-form-row">
              <Field label="Name">
                <TextInput value={exerciseDraft.name} onChange={(v) => setExerciseDraft({ ...exerciseDraft, name: v })} placeholder="High-hang clean pull" />
              </Field>
              <Field label="Pattern">
                <Select value={exerciseDraft.pattern} onChange={(v) => setExerciseDraft({ ...exerciseDraft, pattern: v })} options={PATTERNS.map((p) => ({ value: p, label: p }))} />
              </Field>
              <Field label="Difficulty 1–5">
                <TextInput type="number" value={exerciseDraft.difficulty} onChange={(v) => setExerciseDraft({ ...exerciseDraft, difficulty: v })} />
              </Field>
            </div>
            <div className="gl-form-row">
              <Field label="Focus areas">
                <TagInput values={exerciseDraft.focus} onChange={(v) => setExerciseDraft({ ...exerciseDraft, focus: v })} placeholder="glutes, trunk" />
              </Field>
              <Field label="Equipment">
                <TagInput values={exerciseDraft.equipment} onChange={(v) => setExerciseDraft({ ...exerciseDraft, equipment: v })} placeholder="barbell, bands" />
              </Field>
            </div>
            <Field label="Cue in your own words" hint="The one sentence that fixes it for you.">
              <TextArea rows={2} value={exerciseDraft.cue} onChange={(v) => setExerciseDraft({ ...exerciseDraft, cue: v })} />
            </Field>
            <Field label="Caution / what stops you doing it">
              <TextArea rows={2} value={exerciseDraft.caution} onChange={(v) => setExerciseDraft({ ...exerciseDraft, caution: v })} />
            </Field>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(confirmDel)}
        onClose={() => setConfirmDel(null)}
        title="Delete this record?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDel(null)}>
              Keep it
            </Button>
            <Button variant="danger" onClick={() => void runDelete()}>
              <Trash2 size={14} /> Delete
            </Button>
          </>
        }
      >
        <p>
          <strong>{confirmDel?.label}</strong> will be soft-deleted. Charts recompute from the remaining rows, which is why a line
          may move when you remove a session.
        </p>
        {confirmDel?.id === '__all_seeded__' ? (
          <p className="gl-small gl-muted">
            This removes {stats.seededExercises} bundled starter exercises only. Sessions that referenced them keep their numbers but
            the exercise name will read as removed — your custom rows are untouched.
          </p>
        ) : null}
      </Modal>
    </div>
  );
}

/* ------------------------------------------------------------- digest strings */

/** One distance, phrased the same way every time it appears. */
function gapPhrase(gap: DigestGap): string {
  return `${fmt(gap.days, { digits: 0 })} days · ${formatDate(gap.from)} → ${formatDate(gap.to)}`;
}

/**
 * The data-quality lines. Each one is a count over the window's rows, so the
 * reader can see which figures above her own logging supports and which it
 * does not. A line that reads 0 is a line about a thing she logged completely,
 * so it is kept — the point is the thinness map, not a problem list.
 */
function qualityFlags(d: FitnessDigest): { label: string; value: string }[] {
  const q = d.quality;
  const n = (v: number) => fmt(v, { digits: 0 });
  return [
    { label: 'Sessions in the window', value: `${n(q.sessionsInWindow)} row(s) you logged` },
    {
      label: 'Too sparse to compute anything from',
      value: `${n(q.sparseSessions)} session(s) with no entry row or no completed set`
    },
    { label: 'Sessions whose volume comes out at zero', value: `${n(q.zeroVolumeSessions)} of ${n(q.sessionsInWindow)}` },
    { label: 'Sets stored as not done', value: `${n(q.skippedSets)} of ${n(q.sets)} set(s) — excluded from volume` },
    { label: 'Completed sets with no reps written', value: `${n(q.doneSetsMissingReps)} set(s)` },
    { label: 'Completed sets with no load written', value: `${n(q.doneSetsMissingLoad)} set(s)` },
    { label: 'Completed sets with neither reps nor load', value: `${n(q.doneSetsMissingBoth)} set(s)` },
    { label: 'Sets whose stored value is not a number', value: `${n(q.unusableSetValues)} set(s) contribute nothing` },
    { label: 'Exercise entries with no set rows', value: `${n(q.entriesWithoutSets)} entry(ies) of ${n(q.entries)}` },
    { label: 'Sessions carrying a note', value: `${n(q.sessionsWithNote)} of ${n(q.sessionsInWindow)} — the only place a reason can live` },
    {
      label: 'Unit carried by these rows',
      value: d.volumeUnit ? 'kg, as you typed it' : 'none — no completed set here carries a load'
    }
  ];
}

/* ------------------------------------------------------------- session modal */

function fromSession(s: AnyRow): SessionDraft {
  return {
    id: s.id,
    doneOn: String(s.doneOn ?? todayISO()),
    label: String(s.label ?? ''),
    durationMin: s.durationMin == null ? '' : String(s.durationMin),
    rpe: s.rpe == null ? '' : String(s.rpe),
    note: String(s.note ?? ''),
    planDayId: (s.planDayId as string) ?? null,
    entries: (((s.entries as any[]) ?? []) as EntryDraft[]).map((e) => ({
      exerciseId: String(e.exerciseId),
      sets: (e.sets ?? []).map((x: any) => ({ reps: String(x.reps ?? ''), kg: String(x.kg ?? ''), rpe: String(x.rpe ?? ''), done: x.done !== false }))
    }))
  };
}

function SessionModal({
  draft,
  setDraft,
  exercises,
  dayOptions,
  onPrefill,
  onSave,
  onClose
}: {
  draft: SessionDraft;
  setDraft: (d: SessionDraft) => void;
  exercises: AnyRow[];
  dayOptions: { value: string; label: string; planId: string }[];
  onPrefill: (planId: string, dayId: string) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const volume = draftVolume(draft.entries);
  const totalSets = draft.entries.reduce((a, e) => a + e.sets.filter((s) => s.done).length, 0);

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={draft.id ? 'Edit logged session' : 'Log a session'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onSave}>
            <Save size={14} /> {draft.id ? 'Update session' : 'Save session'}
          </Button>
        </>
      }
    >
      <div className="gl-form-row">
        <DateInput label="Done on" value={draft.doneOn} onChange={(v) => setDraft({ ...draft, doneOn: v })} />
        <Field label="Session label">
          <TextInput value={draft.label} onChange={(v) => setDraft({ ...draft, label: v })} placeholder="Tuesday, gym, slightly tired" />
        </Field>
        <Field label="Minutes">
          <TextInput type="number" value={draft.durationMin} onChange={(v) => setDraft({ ...draft, durationMin: v })} />
        </Field>
        <Field label="Overall RPE 1–10" hint="Your effort read on the day. It is stored, never converted into a prescription.">
          <TextInput type="number" value={draft.rpe} onChange={(v) => setDraft({ ...draft, rpe: v })} />
        </Field>
      </div>

      {dayOptions.length ? (
        <Field label="Prefill from a plan day" hint="Creates empty set rows for you to fill with what you actually did.">
          <div className="gl-row gl-row--tight">
            <Select
              value=""
              onChange={(v) => {
                const opt = dayOptions.find((o) => o.value === v);
                if (opt) onPrefill(opt.planId, opt.value);
              }}
              placeholder="Choose a day"
              options={dayOptions.map((o) => ({ value: o.value, label: o.label }))}
            />
          </div>
        </Field>
      ) : null}

      <div className="gl-stack">
        {draft.entries.map((e, ei) => (
          <div className="fb-entry" key={`${e.exerciseId}-${ei}`}>
            <div className="gl-row gl-row--between">
              <Field label="Exercise">
                <Select
                  value={String(e.exerciseId)}
                  onChange={(v) => setDraft({ ...draft, entries: draft.entries.map((x, i) => (i === ei ? { ...x, exerciseId: v } : x)) })}
                  placeholder="Pick"
                  options={exercises.map((x) => ({ value: x.id, label: x.name }))}
                />
              </Field>
              <Button size="sm" variant="ghost" onClick={() => setDraft({ ...draft, entries: draft.entries.filter((_, i) => i !== ei) })}>
                <Trash2 size={12} /> Remove
              </Button>
            </div>
            {exercises.find((x) => x.id === e.exerciseId)?.cue ? (
              <div className="gl-tech">cue: {String(exercises.find((x) => x.id === e.exerciseId)!.cue)}</div>
            ) : null}
            <div className="fb-sets fb-sets--head">
              <span>Reps</span>
              <span>Load (kg)</span>
              <span>RPE</span>
              <span>Done</span>
              <span />
            </div>
            {e.sets.map((s, si) => (
              <div className="fb-sets" key={si}>
                <TextInput type="number" value={s.reps} onChange={(v) => setDraft({ ...draft, entries: draft.entries.map((x, i) => (i === ei ? { ...x, sets: x.sets.map((y, j) => (j === si ? { ...y, reps: v } : y)) } : x)) })} />
                <TextInput type="number" value={s.kg} onChange={(v) => setDraft({ ...draft, entries: draft.entries.map((x, i) => (i === ei ? { ...x, sets: x.sets.map((y, j) => (j === si ? { ...y, kg: v } : y)) } : x)) })} />
                <TextInput type="number" value={s.rpe} onChange={(v) => setDraft({ ...draft, entries: draft.entries.map((x, i) => (i === ei ? { ...x, sets: x.sets.map((y, j) => (j === si ? { ...y, rpe: v } : y)) } : x)) })} />
                <input
                  type="checkbox"
                  checked={s.done}
                  aria-label={`Set ${si + 1} completed`}
                  onChange={(ev) => setDraft({ ...draft, entries: draft.entries.map((x, i) => (i === ei ? { ...x, sets: x.sets.map((y, j) => (j === si ? { ...y, done: ev.target.checked } : y)) } : x)) })}
                  style={{ width: 20, height: 20, accentColor: 'var(--glow-accent-soft)' }}
                />
                <button type="button" className="gl-btn gl-btn--icon gl-btn--sm" aria-label={`Remove set ${si + 1}`} onClick={() => setDraft({ ...draft, entries: draft.entries.map((x, i) => (i === ei ? { ...x, sets: x.sets.filter((_, j) => j !== si) } : x)) })}>
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
            <div>
              <Button size="sm" onClick={() => setDraft({ ...draft, entries: draft.entries.map((x, i) => (i === ei ? { ...x, sets: [...x.sets, blankSet()] } : x)) })}>
                <Plus size={12} /> Add set
              </Button>
            </div>
          </div>
        ))}
        {!draft.entries.length ? <p className="gl-small gl-muted">No exercises yet — add one, or prefill from a plan day above.</p> : null}
        <div>
          <Button size="sm" variant="primary" onClick={() => setDraft({ ...draft, entries: [...draft.entries, { exerciseId: exercises[0]?.id ?? '', sets: [blankSet()] }] })}>
            <Plus size={13} /> Add exercise row
          </Button>
        </div>
      </div>

      <div className="gl-inset" style={{ marginTop: 'var(--glow-sp-4)' }}>
        <div className="gl-label">This session as entered</div>
        <div className="gl-tech">
          volume = Σ reps × load over done sets = {Math.round(volume)} · {totalSets} completed set(s) · {draft.entries.length} exercise
          row(s). Loads are kg as you typed them; if you train in pounds, write that in the note so future-you can read the chart
          honestly.
        </div>
      </div>

      <Field label="Note" style-={undefined}>
        <TextArea rows={2} value={draft.note} onChange={(v) => setDraft({ ...draft, note: v })} placeholder="Sleep, stress, why the third set disappeared" />
      </Field>
    </Modal>
  );
}
