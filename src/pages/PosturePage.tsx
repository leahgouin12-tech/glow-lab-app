/**
 * THE GLOW LAB — Posture & Presentation (spec Part 18).
 *
 * A habit tracker with arithmetic over the rows you write: check-ins, streaks,
 * audit pass rates, drill practice counts, and a tally of which of your own
 * photographs you marked as reading well. It is explicitly NOT a correction
 * service. Nothing here claims to move bone, permanently "fix" a spine, or
 * diagnose pain; the app cannot see you and holds no clinician licence. The
 * reference panel at the bottom quotes the evidence rows in your own library
 * rather than inventing claims, and the limits panel says which claims this
 * page will never generate.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  Ban,
  BookOpen,
  Camera,
  Check,
  GraduationCap,
  PersonStanding,
  Plus,
  Save,
  Sparkles,
  Trash2,
  TriangleAlert
} from 'lucide-react';
import { saveRow, useRows } from '../hooks/live';
import { addDays, formatDate, newId, softDelete, todayISO } from '../db/repo';
import { TABLES, type AnyRow, type RoutineStep, type TableName } from '../db/schema';
import {
  BarChart,
  DistributionBars,
  HeatStrip
} from '../ui/charts';
import {
  Button,
  Card,
  CardHead,
  Chip,
  DateInput,
  Disclosure,
  Field,
  IconButton,
  Meter,
  Modal,
  Range,
  SafetyBanner,
  SegmentedControl,
  Select,
  Table,
  TagInput,
  TextArea,
  TextInput,
  Toggle,
  useToast
} from '../ui/primitives';
import { useUndoDelete } from '../ui/undo';
import { Chipbar, DeptIntro, EmptyPlate, IndexList, IndexRow, KvList, StatStrip, Timeline } from '../ui/editorial';
import { ImageTile, Lightbox, PhotoPicker } from '../ui/media';
import '../styles/departments/posture.css';

/* ------------------------------------------------------------------ constants */

/** Photographs added from this page live in their own album — nothing is scanned. */
const POSTURE_ALBUM = 'Posture & presentation';

/** Stored in routine.timeOfDay so an audit is distinguishable from a daily habit. */
const AUDIT = 'Audit';

const TIME_OF_DAY = ['Anytime', 'Morning', 'Desk block', 'Evening', AUDIT];

/** Movement patterns this department treats as posture-relevant. */
const DRILL_PATTERNS = ['brace', 'carry', 'rotate', 'gait'];

/** Evidence rows worth reading before doing anything here. Read, never rewritten. */
const REFERENCE_SLUGS = ['posture-motor-training', 'mewing', 'bone-smashing', 'photography-angle-work', 'sleep-duration'];

const ACADEMY_SLUG = 'posture-habit-loop';

const REACTIONS: { value: string; label: string; hint: string }[] = [
  { value: 'good', label: 'Stood easy', hint: 'No effort was needed to stay tall.' },
  { value: 'bad', label: 'Head forward / slumped', hint: 'You noticed the drift.' },
  { value: 'irritation', label: 'Sore or achy', hint: 'Discomfort you would call a symptom.' },
  { value: 'none', label: 'Nothing noticed', hint: 'A flat check-in is still data.' },
  { value: 'unknown', label: 'Not sure', hint: 'Honest option.' }
];

const READS: { value: string; label: string }[] = [
  { value: 'good', label: 'Reads well' },
  { value: 'bad', label: 'Did not work' },
  { value: 'unknown', label: 'Not sure' }
];

/**
 * Starter wording the app ships with, offered behind a button (never written on
 * load). Rows created from it carry seed: 1 so they are labelled "starter
 * content" and deletable. The mobility step labels deliberately match the
 * exercise-library names so practice counts line up without any guessing.
 */
const STARTERS: { name: string; timeOfDay: string; blurb: string; steps: { label: string; detail: string }[] }[] = [
  {
    name: 'Awareness check-in',
    timeOfDay: 'Anytime',
    blurb: 'Three anchors you already have in your day, plus one side-view check.',
    steps: [
      { label: 'Anchor 1 — reset, do not freeze', detail: 'Exhale, let the ribs drop, lengthen through the crown, then keep moving. Four seconds.' },
      { label: 'Anchor 2 — reset', detail: 'Pick an event you cannot forget; the cue has to live inside your day, not beside it.' },
      { label: 'Anchor 3 — reset', detail: 'A third anchor is what turns one reminder into a habit.' },
      { label: 'Side view from a mirror or a standard photo', detail: 'Ears relative to shoulders, read from an image — not from a feeling.' }
    ]
  },
  {
    name: 'Mobility & strength set',
    timeOfDay: 'Evening',
    blurb: 'Position practice and loading. Endurance work, not correction.',
    steps: [
      { label: 'Neck-set posture rehearsal', detail: 'Long through the crown, chin level, shoulders unclenched — practice, not correction.' },
      { label: 'Dead bug', detail: 'Low back stays long and calm while the limbs move.' },
      { label: 'Farmer carry', detail: 'Tall, quiet steps, shoulders relaxed down.' },
      { label: 'Thoracic extension over foam', detail: 'Support the head, exhale to let the ribs drop, do not force an arch.' },
      { label: 'Hip flexor stretch (half-kneeling)', detail: 'Posterior tilt before the lunge, gentle stretch only.' }
    ]
  },
  {
    name: 'Workspace ergonomics audit',
    timeOfDay: AUDIT,
    blurb: 'A pass/fail check of the setup you sit in, run once in a while.',
    steps: [
      { label: 'Screen top near eye height', detail: 'The neck stays quiet at the far end of the gaze.' },
      { label: 'Forearms supported at elbow height', detail: 'Shoulders can unclench when the weight rests on something.' },
      { label: 'Feet supported or hips level', detail: 'Sitting on the edge of a chair is a static load.' },
      { label: 'Something to stand up to every ~30 min', detail: 'The best position is the next one.' },
      { label: 'Carry load split across both hands', detail: 'One heavy bag is an asymmetric habit.' }
    ]
  }
];

/** Claims this page will not produce, with the reason and the substitute. */
const LIMITS: { claim: string; why: string; instead: string }[] = [
  {
    claim: '“Tongue posture remoulds an adult jaw/skull” (mewing).',
    why: 'Craniofacial orthotropics research concerns growing children and is contested. There is no accepted evidence that an adult jaw reshapes from where the tongue sits, and the app has no imaging and no licence to say otherwise.',
    instead: 'Read the mewing row in your evidence library (/evidence). Position practice on this page changes muscle habit, not bone.'
  },
  {
    claim: '“Hold good posture and it becomes permanent.”',
    why: 'Static “good” posture is just another static posture — it fatigues. What changes with training is endurance and how often you reposition, which is why the look drifts back without practice.',
    instead: 'Frequent resets against anchors, tracked here as a habit, plus loaded work in /fitness.'
  },
  {
    claim: '“This fixes your scoliosis / pelvic tilt / back pain.”',
    why: 'Diagnosis and treatment are clinical acts. This app records what you notice and the drills you choose; it cannot examine you, image you, or rule out a cause.',
    instead: 'Physiotherapist or sports-medicine physician. Log the consultation and the plan in /services and keep practising what they gave you.'
  },
  {
    claim: '“Remodel your body by pressing on it.”',
    why: 'The bone-smashing entry exists in the library as a hazard record, not an option. Nothing on this page will restate a protocol for it.',
    instead: 'Nothing. If a method involves striking bone, it is not a mobility practice.'
  }
];

const RED_FLAGS = [
  'Sharp, stabbing or night pain that wakes you',
  'Numbness, tingling or weakness in an arm or leg',
  'A joint that will not bear load, or a sudden change after an injury',
  'Loss of bladder or bowel control — emergency, not a habit tracker'
];

/* --------------------------------------------------------------------- drafts */

interface RoutineDraft {
  id?: string;
  name: string;
  timeOfDay: string;
  active: boolean;
  steps: { id: string; label: string; detail: string }[];
}

interface CheckinDraft {
  routineId: string;
  doneOn: string;
  steps: string[];
  /** false until the user touches the boxes, so a stored row is shown, not wiped. */
  touched: boolean;
  mood: number;
  note: string;
}

interface AuditDraft {
  routineId: string;
  doneOn: string;
  passed: string[];
  touched: boolean;
  note: string;
}

interface NoteDraft {
  on: string;
  note: string;
  reaction: string;
  severity: number;
  where: string;
}

interface PresDraft {
  mediaId: string;
  on: string;
  note: string;
  reads: string;
}

interface DrillDraft {
  name: string;
  pattern: string;
  focus: string[];
  cue: string;
  caution: string;
}

function lowerHas(a: string, b: string): boolean {
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

function stepsOf(routine: AnyRow | undefined): RoutineStep[] {
  return ((routine?.steps as RoutineStep[]) ?? []).slice().sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0));
}

/** Consecutive-day streak over the dates you actually logged, tolerating an unlogged today. */
function streakOf(days: Set<string>): { current: number; longest: number } {
  if (!days.size) return { current: 0, longest: 0 };
  let current = 0;
  let cursor = days.has(todayISO()) ? todayISO() : addDays(todayISO(), -1);
  while (days.has(cursor)) {
    current += 1;
    cursor = addDays(cursor, -1);
  }
  const sorted = [...days].sort((a, b) => a.localeCompare(b));
  let longest = 1;
  let run = 1;
  for (let i = 1; i < sorted.length; i += 1) {
    if (addDays(sorted[i - 1], 1) === sorted[i]) run += 1;
    else run = 1;
    longest = Math.max(longest, run);
  }
  return { current, longest: Math.max(longest, current) };
}

function weekKey(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  const shift = (dt.getDay() + 6) % 7;
  dt.setDate(dt.getDate() - shift);
  const yy = dt.getFullYear();
  const mm = `${dt.getMonth() + 1}`.padStart(2, '0');
  const dd = `${dt.getDate()}`.padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

export default function PosturePage() {
  const routines = useRows(TABLES.routines, { where: { domain: 'posture' } });
  const allLogs = useRows(TABLES.routineLogs);
  const exercises = useRows(TABLES.exercises);
  const observations = useRows(TABLES.observations);
  const techniques = useRows(TABLES.techniques);
  const tutorials = useRows(TABLES.tutorials);
  const photos = useRows(TABLES.mediaItems, { where: { album: POSTURE_ALBUM } });
  const goals = useRows(TABLES.goals, { where: { domain: 'posture' } });
  const toast = useToast();
  const remove = useUndoDelete();
  const navigate = useNavigate();

  const [checkin, setCheckin] = useState<CheckinDraft>({ routineId: '', doneOn: todayISO(), steps: [], touched: false, mood: 0, note: '' });
  const [audit, setAudit] = useState<AuditDraft>({ routineId: '', doneOn: todayISO(), passed: [], touched: false, note: '' });
  const [routineDraft, setRoutineDraft] = useState<RoutineDraft | null>(null);
  const [noteDraft, setNoteDraft] = useState<NoteDraft>({ on: todayISO(), note: '', reaction: 'bad', severity: 0, where: 'Desk' });
  const [presDraft, setPresDraft] = useState<PresDraft>({ mediaId: '', on: todayISO(), note: '', reads: 'good' });
  const [drillDraft, setDrillDraft] = useState<DrillDraft | null>(null);
  const [drillFilter, setDrillFilter] = useState('');
  const [confirmDel, setConfirmDel] = useState<{ table: TableName; id: string; label: string } | null>(null);
  const [lightbox, setLightbox] = useState<number | null>(null);

  /* ------------------------------------------------------------------ derived */

  const routineById = useMemo(() => new Map(routines.map((r) => [String(r.id), r])), [routines]);
  const routineIds = useMemo(() => new Set(routines.map((r) => String(r.id))), [routines]);

  const dailyRoutines = useMemo(() => routines.filter((r) => String(r.timeOfDay) !== AUDIT), [routines]);
  const auditRoutines = useMemo(() => routines.filter((r) => String(r.timeOfDay) === AUDIT), [routines]);

  const logs = useMemo(
    () =>
      allLogs
        .filter((l) => routineIds.has(String(l.routineId)))
        .slice()
        .sort((a, b) => String(b.doneOn).localeCompare(String(a.doneOn))),
    [allLogs, routineIds]
  );

  const auditRoutineIds = useMemo(() => new Set(auditRoutines.map((r) => String(r.id))), [auditRoutines]);
  const auditRuns = useMemo(() => logs.filter((l) => auditRoutineIds.has(String(l.routineId))), [logs, auditRoutineIds]);
  const habitLogs = useMemo(() => logs.filter((l) => !auditRoutineIds.has(String(l.routineId))), [logs, auditRoutineIds]);

  const loggedDays = useMemo(() => new Set(logs.map((l) => String(l.doneOn))), [logs]);
  const streak = useMemo(() => streakOf(loggedDays), [loggedDays]);

  const heat = useMemo(() => {
    const counts = new Map<string, number>();
    for (const l of habitLogs) counts.set(String(l.doneOn), (counts.get(String(l.doneOn)) ?? 0) + 1);
    return Array.from({ length: 56 }).map((_, i) => {
      const date = addDays(todayISO(), -(55 - i));
      const n = counts.get(date) ?? 0;
      return { date, level: Math.min(3, n), title: n ? `${n} check-in${n > 1 ? 's' : ''}` : 'nothing logged' };
    });
  }, [habitLogs]);

  const weekly = useMemo(() => {
    const map = new Map<string, number>();
    for (const l of habitLogs) {
      const k = weekKey(String(l.doneOn));
      map.set(k, (map.get(k) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-12);
  }, [habitLogs]);

  /** Step labels across non-audit routines: the only link between a drill and a log. */
  const stepIndex = useMemo(() => {
    const out: { stepId: string; label: string }[] = [];
    for (const r of dailyRoutines) for (const s of stepsOf(r)) out.push({ stepId: String(s.id), label: String(s.label ?? '').toLowerCase() });
    return out;
  }, [dailyRoutines]);

  function practisedIn(name: string, withinDays: number): number {
    const key = name.toLowerCase();
    const ids = new Set(stepIndex.filter((s) => lowerHas(s.label, key)).map((s) => s.stepId));
    if (!ids.size) return 0;
    const cutoff = addDays(todayISO(), -(withinDays - 1));
    return habitLogs.filter(
      (l) => String(l.doneOn) >= cutoff && ((l.completedSteps as string[]) ?? []).some((c) => ids.has(String(c)))
    ).length;
  }

  const drills = useMemo(() => {
    const list = exercises.filter((e) => {
      const pattern = String(e.pattern ?? '');
      const focus = ((e.focus as string[]) ?? []).map((f) => f.toLowerCase());
      return DRILL_PATTERNS.includes(pattern) || focus.includes('posture') || focus.includes('mobility') || focus.includes('trunk');
    });
    return list.slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }, [exercises]);

  const patternCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const d of drills) {
      const p = String(d.pattern ?? 'other');
      map.set(p, (map.get(p) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [drills]);

  const visibleDrills = useMemo(
    () => (drillFilter ? drills.filter((d) => String(d.pattern) === drillFilter) : drills),
    [drills, drillFilter]
  );

  const postureNotes = useMemo(
    () =>
      observations
        .filter((o) => String(o.subjectType) === 'posture')
        .slice()
        .sort((a, b) => String(b.on).localeCompare(String(a.on))),
    [observations]
  );

  const presNotes = useMemo(
    () =>
      observations
        .filter((o) => String(o.subjectType) === 'presentation')
        .slice()
        .sort((a, b) => String(b.on).localeCompare(String(a.on))),
    [observations]
  );

  const photoById = useMemo(() => new Map(photos.map((p) => [String(p.id), p])), [photos]);

  /** Tally of your own judgements, grouped by the capture condition you tagged. */
  const readTally = useMemo(() => {
    const map = new Map<string, { good: number; total: number }>();
    for (const n of presNotes) {
      const p = photoById.get(String(n.subjectId));
      const key = String(p?.conditions ?? '') || String(p?.pose ?? '') || String(p?.lighting ?? '') || 'Untagged photograph';
      const cur = map.get(key) ?? { good: 0, total: 0 };
      cur.total += 1;
      if (String(n.reaction) === 'good') cur.good += 1;
      map.set(key, cur);
    }
    return [...map.entries()].sort((a, b) => b[1].total - a[1].total);
  }, [presNotes, photoById]);

  const reactionTally = useMemo(() => {
    const map = new Map<string, number>();
    for (const n of postureNotes) {
      const r = REACTIONS.find((x) => x.value === String(n.reaction));
      const key = r?.label ?? String(n.reaction || 'unspecified');
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [postureNotes]);

  const soreFlag = useMemo(() => postureNotes.filter((n) => String(n.reaction) === 'irritation' && Number(n.severity) >= 7), [postureNotes]);

  const reference = useMemo(
    () =>
      techniques.filter(
        (t) => REFERENCE_SLUGS.includes(String(t.slug)) || ['posture', 'lifestyle'].includes(String(t.domain))
      ),
    [techniques]
  );

  const lesson = useMemo(() => tutorials.find((x) => String(x.slug) === ACADEMY_SLUG), [tutorials]);

  const latestAudit = auditRuns[0];
  const prevAudit = auditRuns[1];
  const auditRate = (run: AnyRow | undefined) => {
    if (!run) return null;
    const steps = stepsOf(routineById.get(String(run.routineId)));
    if (!steps.length) return null;
    const passed = ((run.completedSteps as string[]) ?? []).filter((c) => steps.some((s) => String(s.id) === String(c))).length;
    return { passed, total: steps.length, pct: Math.round((passed / steps.length) * 100) };
  };
  const latestRate = auditRate(latestAudit);
  const prevRate = auditRate(prevAudit);

  const seededRoutines = routines.filter((r) => r.seed === 1).length;
  const seededDrills = drills.filter((d) => d.seed === 1).length;

  const ciRoutineId = checkin.routineId && routineIds.has(checkin.routineId) ? checkin.routineId : String(dailyRoutines[0]?.id ?? '');
  const ciRoutine = routineById.get(ciRoutineId);
  const ciSteps = stepsOf(ciRoutine);
  const ciExisting = habitLogs.find((l) => String(l.routineId) === ciRoutineId && String(l.doneOn) === checkin.doneOn);
  /** Boxes show the user's edits, otherwise whatever that routine already holds for that date. */
  const ciChecked = checkin.touched ? checkin.steps : ((ciExisting?.completedSteps as string[]) ?? []).map(String);

  const auRoutineId = audit.routineId && auditRoutineIds.has(audit.routineId) ? audit.routineId : String(auditRoutines[0]?.id ?? '');
  const auRoutine = routineById.get(auRoutineId);
  const auSteps = stepsOf(auRoutine);
  const auExisting = auditRuns.find((l) => String(l.routineId) === auRoutineId && String(l.doneOn) === audit.doneOn);
  const auChecked = audit.touched ? audit.passed : ((auExisting?.completedSteps as string[]) ?? []).map(String);

  /** Pulls a stored row into the form so an existing day is edited, never silently blanked. */
  function loadCheckin(routineId: string, doneOn: string): CheckinDraft {
    const row = habitLogs.find((l) => String(l.routineId) === routineId && String(l.doneOn) === doneOn);
    return {
      routineId,
      doneOn,
      steps: ((row?.completedSteps as string[]) ?? []).map(String),
      touched: true,
      mood: Number(row?.mood ?? 0),
      note: String(row?.note ?? '')
    };
  }

  function loadAudit(routineId: string, doneOn: string): AuditDraft {
    const row = auditRuns.find((l) => String(l.routineId) === routineId && String(l.doneOn) === doneOn);
    return {
      routineId,
      doneOn,
      passed: ((row?.completedSteps as string[]) ?? []).map(String),
      touched: true,
      note: String(row?.note ?? '')
    };
  }

  /* -------------------------------------------------------------------- saves */

  async function saveCheckin() {
    if (!ciRoutine) {
      toast('Pick a routine first, or build one — a check-in is measured against a step list.', 'bad');
      return;
    }
    const chosen = ciSteps.filter((s) => ciChecked.includes(String(s.id))).map((s) => String(s.id));
    await saveRow(TABLES.routineLogs, {
      id: ciExisting?.id,
      routineId: ciRoutineId,
      doneOn: checkin.doneOn,
      completedSteps: chosen,
      mood: checkin.mood,
      note: checkin.note,
      tags: ['posture']
    });
    toast(ciExisting ? 'That day’s check-in was updated.' : `Check-in stored: ${chosen.length}/${ciSteps.length} steps.`, 'ok');
    setCheckin({ routineId: ciRoutineId, doneOn: todayISO(), steps: [], touched: false, mood: 0, note: '' });
  }

  async function saveAudit() {
    if (!auRoutine) {
      toast('No audit routine yet. Create one with the audit type, or use the starter set.', 'bad');
      return;
    }
    const chosen = auSteps.filter((s) => auChecked.includes(String(s.id))).map((s) => String(s.id));
    await saveRow(TABLES.routineLogs, {
      id: auExisting?.id,
      routineId: auRoutineId,
      doneOn: audit.doneOn,
      completedSteps: chosen,
      mood: 0,
      note: audit.note,
      tags: ['posture', 'audit']
    });
    toast(`Audit saved — ${chosen.length}/${auSteps.length} passed (${Math.round((chosen.length / Math.max(1, auSteps.length)) * 100)}%).`, 'ok');
    setAudit({ routineId: auRoutineId, doneOn: todayISO(), passed: [], touched: false, note: '' });
  }

  async function saveRoutine() {
    if (!routineDraft) return;
    const clean = routineDraft.steps.filter((s) => s.label.trim());
    if (!routineDraft.name.trim()) {
      toast('A routine needs a name.', 'bad');
      return;
    }
    if (!clean.length) {
      toast('Add at least one step — a step is one thing you can honestly mark done.', 'bad');
      return;
    }
    const steps: RoutineStep[] = clean.map((s, i) => ({
      id: s.id || newId('st'),
      order: i + 1,
      label: s.label.trim(),
      detail: s.detail.trim(),
      productId: null,
      durationMin: 0,
      skipIf: ''
    }));
    const saved = await saveRow(TABLES.routines, {
      id: routineDraft.id,
      name: routineDraft.name.trim(),
      domain: 'posture',
      timeOfDay: routineDraft.timeOfDay,
      active: routineDraft.active,
      steps,
      tags: ['posture', routineDraft.timeOfDay.toLowerCase()]
    });
    toast(routineDraft.id ? 'Routine updated — the old step list is replaced, history stays.' : 'Routine stored.', 'ok');
    setRoutineDraft(null);
    if (String(saved.timeOfDay) === AUDIT) setAudit({ routineId: String(saved.id), doneOn: todayISO(), passed: [], touched: false, note: '' });
    else setCheckin({ routineId: String(saved.id), doneOn: todayISO(), steps: [], touched: false, mood: 0, note: '' });
  }

  async function saveNote() {
    if (!noteDraft.note.trim()) {
      toast('Write what you noticed — one sentence is enough.', 'bad');
      return;
    }
    await saveRow(TABLES.observations, {
      subjectType: 'posture',
      subjectId: '',
      on: noteDraft.on,
      note: `${noteDraft.where ? noteDraft.where + ' — ' : ''}${noteDraft.note.trim()}`,
      reaction: noteDraft.reaction,
      severity: noteDraft.severity,
      mediaIds: [],
      tags: ['posture', noteDraft.where.toLowerCase()]
    });
    toast('Note stored.', 'ok');
    setNoteDraft({ ...noteDraft, note: '', severity: 0 });
  }

  async function savePresentationNote() {
    if (!presDraft.mediaId) {
      toast('Choose one of your own photographs — the note has to point at something you took.', 'bad');
      return;
    }
    await saveRow(TABLES.observations, {
      subjectType: 'presentation',
      subjectId: presDraft.mediaId,
      on: presDraft.on,
      note: presDraft.note.trim() || '(no words — just the verdict)',
      reaction: presDraft.reads,
      severity: 0,
      mediaIds: [presDraft.mediaId],
      tags: ['posture', 'presentation']
    });
    toast('Verdict recorded against that photograph.', 'ok');
    setPresDraft({ ...presDraft, note: '' });
  }

  async function saveDrill() {
    if (!drillDraft) return;
    if (!drillDraft.name.trim()) {
      toast('Give the drill a name.', 'bad');
      return;
    }
    await saveRow(TABLES.exercises, {
      name: drillDraft.name.trim(),
      pattern: drillDraft.pattern,
      focus: drillDraft.focus.length ? drillDraft.focus : ['posture'],
      equipment: [],
      difficulty: 1,
      cue: drillDraft.cue.trim(),
      caution: drillDraft.caution.trim(),
      mediaIds: [],
      tags: ['posture']
    });
    toast('Drill added to the shared exercise library.', 'ok');
    setDrillDraft(null);
  }

  async function buildStarters() {
    for (const s of STARTERS) {
      await saveRow(TABLES.routines, {
        name: s.name,
        domain: 'posture',
        timeOfDay: s.timeOfDay,
        active: true,
        steps: s.steps.map((x, i) => ({
          id: newId('st'),
          order: i + 1,
          label: x.label,
          detail: x.detail,
          productId: null,
          durationMin: 0,
          skipIf: ''
        })),
        tags: ['posture', 'starter'],
        seed: 1
      });
    }
    toast(`${STARTERS.length} starter routines written. They are labelled starter content and you can delete any of them.`, 'ok');
  }

  async function clearStarterRoutines() {
    const list = routines.filter((r) => r.seed === 1);
    for (const r of list) await softDelete(TABLES.routines, String(r.id));
    toast(`${list.length} starter routines removed. Your own routines and all logged history stay.`, 'ok');
  }

  async function clearStarterDrills() {
    const list = drills.filter((d) => d.seed === 1);
    for (const d of list) await softDelete(TABLES.exercises, String(d.id));
    toast(`${list.length} starter drills removed from the exercise library.`, 'ok');
  }

  async function toggleDrillDone(name: string) {
    const day = todayISO();
    const routine = dailyRoutines.find((r) => stepsOf(r).some((s) => lowerHas(String(s.label ?? '').toLowerCase(), name.toLowerCase())));
    if (!routine) {
      toast('That drill is not a step in any routine yet. Add it to a mobility set first, then it can be marked done.', 'bad');
      return;
    }
    const step = stepsOf(routine).find((s) => lowerHas(String(s.label ?? '').toLowerCase(), name.toLowerCase()));
    if (!step) return;
    const target = habitLogs.find((l) => String(l.doneOn) === day && String(l.routineId) === String(routine.id));
    const done = ((target?.completedSteps as string[]) ?? []).map(String);
    const next = done.includes(String(step.id)) ? done.filter((d) => d !== String(step.id)) : [...done, String(step.id)];
    await saveRow(TABLES.routineLogs, {
      id: target?.id,
      routineId: String(routine.id),
      doneOn: day,
      completedSteps: next,
      mood: Number(target?.mood ?? 0),
      note: String(target?.note ?? ''),
      tags: ['posture']
    });
    toast(next.includes(String(step.id)) ? `“${name}” marked done today.` : `Removed today's mark for “${name}”.`, 'ok');
  }

  async function runDelete() {
    if (!confirmDel) return;
    await remove(confirmDel.table, confirmDel.id, confirmDel.label);
    setConfirmDel(null);
  }

  /* --------------------------------------------------------------------- view */

  return (
    <div className="gl-page ps-page">
      <DeptIntro
        id="posture"
        deck="A habit, strength and ergonomics tracker. It records what you do and what you noticed; it does not claim to move bone, straighten a spine permanently, or explain your pain."
        actions={
          <>
            <Button variant="primary" onClick={() => setCheckin({ ...checkin, routineId: ciRoutineId, steps: [] })}>
              <Activity size={14} /> Check in
            </Button>
            <Button onClick={() => setRoutineDraft({ name: '', timeOfDay: 'Anytime', active: true, steps: [{ id: newId('st'), label: '', detail: '' }] })}>
              <Plus size={14} /> New routine
            </Button>
            <Button variant="ghost" onClick={() => navigate('/fitness')}>
              Training log
            </Button>
          </>
        }
        meta={[
          { label: 'Routines', value: `${routines.length} (${seededRoutines} starter)` },
          { label: 'Check-ins', value: String(logs.length) },
          { label: 'Current streak', value: `${streak.current} day(s)` },
          { label: 'Notes', value: `${postureNotes.length} position, ${presNotes.length} photo` }
        ]}
      />

      <SafetyBanner tone="warn" title="What this department is, in one line">
        Position practice plus habit tracking. Strength and endurance change how easy a position is to reach and how often you
        drift back; that is a real, visible change, and it is also why nothing here is described as permanent. The app has no
        imaging, no examination and no licence — so it makes no diagnosis and no correction promise.
      </SafetyBanner>

      <StatStrip
        items={[
          { label: 'Days logged', value: String(loggedDays.size), hint: 'distinct dates in routineLogs' },
          { label: 'Current streak', value: String(streak.current), hint: 'consecutive days, today may be open' },
          { label: 'Longest run', value: String(streak.longest), hint: 'over the same list' },
          {
            label: 'Last audit',
            value: latestRate ? `${latestRate.passed}/${latestRate.total}` : '—',
            hint: latestAudit ? `${formatDate(String(latestAudit.doneOn))} · ${latestRate?.pct}% passed` : 'no audit run yet'
          },
          { label: 'Soreness flags', value: String(soreFlag.length), hint: 'your own notes at severity 7+' }
        ]}
      />

      {/* ------------------------------------------------------ daily check-in */}
      <section className="gl-section">
        <div className="gl-section__title">
          <div>
            <div className="gl-eyebrow">Habit loop</div>
            <h2>Check in against a step list</h2>
          </div>
          <Chip tone="info">{habitLogs.length} check-ins</Chip>
        </div>

        {dailyRoutines.length === 0 ? (
          <EmptyPlate
            kicker="Plate 01"
            title="No routine to check in against yet"
            body="A routine here is a short list of things you can honestly mark done: three reset anchors, a side-view check, a mobility set. Nothing is prescribed by the app — you write the list, it counts what you did. The starter set below is app-written wording you can edit or delete."
            action={
              <>
                <Button variant="primary" onClick={buildStarters}>
                  <Sparkles size={13} /> Write the three starter routines
                </Button>{' '}
                <Button onClick={() => setRoutineDraft({ name: '', timeOfDay: 'Anytime', active: true, steps: [{ id: newId('st'), label: '', detail: '' }] })}>
                  <Plus size={13} /> Build my own
                </Button>
              </>
            }
          />
        ) : (
          <div className="gl-grid gl-grid--2">
            <Card variant="accent">
              <CardHead
                title={
                  <>
                    <PersonStanding size={14} /> Today
                  </>
                }
                eyebrow={ciRoutine ? String(ciRoutine.name) : 'no routine selected'}
                right={<Chip tone={checkin.steps.length === ciSteps.length && ciSteps.length ? 'gold' : 'info'}>{`${checkin.steps.length}/${ciSteps.length}`}</Chip>}
              />
              <div className="ps-form">
                <Field label="Routine">
                  <Select
                    value={ciRoutineId}
                    onChange={(v) => setCheckin({ routineId: v, doneOn: checkin.doneOn, steps: [], touched: false, mood: 0, note: checkin.note })}
                    options={dailyRoutines.map((r) => ({ value: String(r.id), label: String(r.name) }))}
                  />
                </Field>
                <DateInput label="Date" value={checkin.doneOn} onChange={(v) => setCheckin({ ...checkin, doneOn: v })} />
                {ciExisting ? <div className="gl-tech">A check-in already exists for this routine on this date — saving updates it instead of duplicating.</div> : null}
                <div className="ps-steps">
                  {ciSteps.map((s) => {
                    const on = checkin.steps.includes(String(s.id));
                    return (
                      <button
                        type="button"
                        key={String(s.id)}
                        className="ps-step"
                        data-on={on}
                        onClick={() =>
                          setCheckin({
                            ...checkin,
                            steps: on ? checkin.steps.filter((x) => x !== String(s.id)) : [...checkin.steps, String(s.id)]
                          })
                        }
                      >
                        <span className="ps-step__box">{on ? <Check size={12} /> : null}</span>
                        <span>
                          <span className="ps-step__label">{s.label}</span>
                          {s.detail ? <span className="ps-step__detail">{s.detail}</span> : null}
                        </span>
                      </button>
                    );
                  })}
                  {!ciSteps.length ? <span className="gl-small gl-muted">This routine has no steps yet.</span> : null}
                </div>
                <Range
                  label="How easy did staying tall feel (your rating)"
                  value={checkin.mood}
                  onChange={(v) => setCheckin({ ...checkin, mood: v })}
                  min={0}
                  max={10}
                />
                <Field label="Note">
                  <TextArea value={checkin.note} onChange={(v) => setCheckin({ ...checkin, note: v })} rows={3} placeholder="What pulled you forward today — chair, phone, fatigue, a long call" />
                </Field>
                <Button variant="primary" onClick={() => void saveCheckin()}>
                  <Save size={13} /> {ciExisting ? 'Update this check-in' : 'Save check-in'}
                </Button>
              </div>
            </Card>

            <Card>
              <CardHead title="Consistency, as arithmetic" sub="Everything below is counted from rows you wrote." />
              <div className="ps-heatwrap">
                <HeatStrip days={heat} />
                <div className="gl-tech">56 days, one square per day, shade = number of check-ins logged that day.</div>
              </div>
              <div className="ps-form" style={{ marginTop: 'var(--glow-sp-4)' }}>
                {weekly.length ? (
                  <BarChart
                    labels={weekly.map((w) => w[0])}
                    series={[{ label: 'Check-ins per week', data: weekly.map((w) => w[1]) }]}
                    height={170}
                    yTitle="count"
                  />
                ) : (
                  <p className="gl-small gl-muted">No weekly bars yet — they appear once a check-in is saved.</p>
                )}
                <div className="gl-tech">
                  streak formula: count back from today (or yesterday, if today is still open) through dates present in
                  routineLogs for this department. Gaps reset it. Nothing is inferred for a missed day.
                </div>
                {goals.length ? (
                  <Disclosure summary={`Goals tagged posture (${goals.length})`}>
                    <IndexList>
                      {goals.map((g, i) => (
                        <IndexRow
                          key={g.id}
                          no={i + 1}
                          title={String(g.title)}
                          sub={`${String(g.status)}${g.targetOn ? ` · target ${formatDate(String(g.targetOn))}` : ''} · managed in /profile`}
                          right={<Chip>{String(g.priority ?? '')}</Chip>}
                          onClick={() => navigate('/profile')}
                        />
                      ))}
                    </IndexList>
                  </Disclosure>
                ) : null}
              </div>
            </Card>
          </div>
        )}

        {habitLogs.length ? (
          <Disclosure summary={`Recent check-ins (${Math.min(habitLogs.length, 40)})`}>
            <Table
              rows={habitLogs.slice(0, 40)}
              keyOf={(r) => String(r.id)}
              columns={[
                { label: 'Date', render: (r) => <span className="gl-tech">{formatDate(String(r.doneOn))}</span> },
                { label: 'Routine', render: (r) => String(routineById.get(String(r.routineId))?.name ?? 'routine deleted') },
                {
                  label: 'Steps',
                  render: (r) => {
                    const total = stepsOf(routineById.get(String(r.routineId))).length;
                    const done = ((r.completedSteps as string[]) ?? []).length;
                    return (
                      <span className="gl-tech">
                        {done}/{total}
                      </span>
                    );
                  }
                },
                { label: 'Ease', render: (r) => <span className="gl-tech">{Number(r.mood ?? 0)}/10</span> },
                { label: 'Note', render: (r) => <span className="gl-small">{String(r.note ?? '') || '—'}</span> },
                {
                  label: '',
                  render: (r) => (
                    <IconButton label="Delete check-in" onClick={() => setConfirmDel({ table: TABLES.routineLogs, id: String(r.id), label: `check-in on ${r.doneOn}` })}>
                      <Trash2 size={13} />
                    </IconButton>
                  )
                }
              ]}
            />
          </Disclosure>
        ) : null}
      </section>

      {/* ------------------------------------------------------------ routines */}
      <section className="gl-section">
        <div className="gl-section__title">
          <div>
            <div className="gl-eyebrow">Movement habits</div>
            <h2>Your routines</h2>
          </div>
          <div className="gl-row gl-row--tight">
            <Button size="sm" variant="primary" onClick={() => setRoutineDraft({ name: '', timeOfDay: 'Anytime', active: true, steps: [{ id: newId('st'), label: '', detail: '' }] })}>
              <Plus size={13} /> New routine
            </Button>
            {seededRoutines ? (
              <Button size="sm" variant="ghost" onClick={() => void clearStarterRoutines()}>
                Remove {seededRoutines} starter {seededRoutines === 1 ? 'routine' : 'routines'}
              </Button>
            ) : null}
          </div>
        </div>

        {routines.length === 0 ? (
          <EmptyPlate
            kicker="Plate 02"
            title="Empty on purpose"
            body="Nothing was seeded behind your back. Press the button below to write three starter routines — an awareness check-in, a mobility set, a workspace audit — in the app's own wording, which you are expected to edit."
            action={
              <Button variant="primary" onClick={buildStarters}>
                <Sparkles size={13} /> Write the starter routines
              </Button>
            }
          />
        ) : (
          <div className="gl-grid gl-grid--3">
            {routines.map((r) => {
              const steps = stepsOf(r);
              const runs = logs.filter((l) => String(l.routineId) === String(r.id));
              return (
                <Card key={String(r.id)} variant={r.active ? 'default' : 'flush'}>
                  <CardHead
                    title={String(r.name)}
                    eyebrow={`${String(r.timeOfDay) === AUDIT ? 'audit' : 'habit'} · ${steps.length} steps`}
                    right={
                      <>
                        {r.seed === 1 ? <Chip tone="gold">starter</Chip> : null}
                        <IconButton label={`Edit ${r.name}`} onClick={() => setRoutineDraft({ id: String(r.id), name: String(r.name ?? ''), timeOfDay: String(r.timeOfDay ?? 'Anytime'), active: Boolean(r.active), steps: steps.map((s) => ({ id: String(s.id), label: String(s.label ?? ''), detail: String(s.detail ?? '') })) })}>
                          <Sparkles size={13} />
                        </IconButton>
                        <IconButton label={`Delete ${r.name}`} onClick={() => setConfirmDel({ table: TABLES.routines, id: String(r.id), label: String(r.name) })}>
                          <Trash2 size={13} />
                        </IconButton>
                      </>
                    }
                  />
                  <div className="ps-steplist">
                    {steps.map((s) => (
                      <div key={String(s.id)} className="ps-steplist__row">
                        <span className="gl-tech">{s.order}</span>
                        <span>
                          <span className="gl-small">{s.label}</span>
                          {s.detail ? <span className="ps-steplist__detail">{s.detail}</span> : null}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="gl-row gl-row--between" style={{ marginTop: 'var(--glow-sp-3)' }}>
                    <span className="gl-tech">{runs.length} run{runs.length === 1 ? '' : 's'} logged</span>
                    <span className={r.active ? 'gl-tech' : 'gl-tech gl-muted'}>{r.active ? 'active' : 'paused'}</span>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* ----------------------------------------------------- drills library */}
      <section className="gl-section">
        <div className="gl-section__title">
          <div>
            <div className="gl-eyebrow">Safe mobility work</div>
            <h2>Drills, cues and cautions</h2>
          </div>
          <div className="gl-row gl-row--tight">
            <Button size="sm" onClick={() => setDrillDraft({ name: '', pattern: 'brace', focus: ['posture'], cue: '', caution: '' })}>
              <Plus size={13} /> Add drill
            </Button>
            {seededDrills ? (
              <Button size="sm" variant="ghost" onClick={() => void clearStarterDrills()}>
                Remove {seededDrills} starter drills
              </Button>
            ) : null}
          </div>
        </div>
        <p className="gl-small gl-muted">
          The drill library is shared with /fitness — the same rows, filtered to the movement patterns that matter here (
          {DRILL_PATTERNS.join(', ')}). Cues and cautions are read from the row; this page adds none. A practice count below is a
          count of logs whose step label contains the drill name, not a measurement of quality.
        </p>

        <Chipbar
          value={drillFilter}
          onChange={setDrillFilter}
          allLabel="All patterns"
          items={patternCounts.map(([p, n]) => ({ value: p, label: p, count: n }))}
        />

        {visibleDrills.length === 0 ? (
          <EmptyPlate
            kicker="Plate 03"
            title="No drills in this filter"
            body="Add one and it lands in the shared exercise library with your own cue and caution text. Or clear the starter drills above and the library is yours alone."
            action={
              <Button variant="primary" onClick={() => setDrillDraft({ name: '', pattern: 'brace', focus: ['posture'], cue: '', caution: '' })}>
                <Plus size={13} /> Add the first drill
              </Button>
            }
          />
        ) : (
          <div className="gl-grid gl-grid--2">
            {visibleDrills.map((d) => {
              const name = String(d.name ?? '');
              const last28 = practisedIn(name, 28);
              const doneToday = habitLogs
                .filter((l) => String(l.doneOn) === todayISO())
                .some((l) => {
                  const routine = routineById.get(String(l.routineId));
                  return stepsOf(routine).some(
                    (s) => lowerHas(String(s.label ?? '').toLowerCase(), name.toLowerCase()) && ((l.completedSteps as string[]) ?? []).map(String).includes(String(s.id))
                  );
                });
              return (
                <Card key={String(d.id)}>
                  <div className="ps-drill">
                    <div className="gl-row gl-row--between" style={{ alignItems: 'baseline' }}>
                      <div>
                        <div className="gl-serif" style={{ fontSize: '1.12rem' }}>{name}</div>
                        <div className="gl-tech">{String(d.pattern)} · {((d.focus as string[]) ?? []).join(', ') || 'no focus set'}</div>
                      </div>
                      <div className="gl-row gl-row--tight">
                        {d.seed === 1 ? <Chip tone="gold">starter</Chip> : null}
                        <IconButton label={`Delete ${name}`} onClick={() => setConfirmDel({ table: TABLES.exercises, id: String(d.id), label: name })}>
                          <Trash2 size={13} />
                        </IconButton>
                      </div>
                    </div>
                    {d.cue ? <p className="gl-small"><span className="gl-label">Cue on the row</span> {String(d.cue)}</p> : null}
                    {d.caution ? (
                      <p className="gl-small ps-caution">
                        <span className="gl-label">Caution on the row</span> {String(d.caution)}
                      </p>
                    ) : null}
                    <div className="gl-row gl-row--between" style={{ marginTop: 'var(--glow-sp-3)', flexWrap: 'wrap', gap: 8 }}>
                      <span className="gl-tech">{last28} logged practice{last28 !== 1 ? 's' : ''} in 28 days</span>
                      <Button size="sm" variant={doneToday ? 'gold' : 'default'} onClick={() => void toggleDrillDone(name)}>
                        {doneToday ? 'Marked today ✓' : 'Mark done today'}
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}

        {drillDraft ? (
          <Card variant="raised" style={{ marginTop: 'var(--glow-sp-4)' }}>
            <CardHead title="New drill" eyebrow="written to the exercise library, shared with /fitness" />
            <div className="gl-grid gl-grid--2">
              <Field label="Name">
                <TextInput value={drillDraft.name} onChange={(v) => setDrillDraft({ ...drillDraft, name: v })} placeholder="Wall slide, band pull-apart…" />
              </Field>
              <Field label="Movement pattern">
                <Select
                  value={drillDraft.pattern}
                  onChange={(v) => setDrillDraft({ ...drillDraft, pattern: v })}
                  options={[...DRILL_PATTERNS, 'squat', 'hinge', 'push', 'pull'].map((p) => ({ value: p, label: p }))}
                />
              </Field>
              <Field label="Focus" hint="Tags only — they change the filter, not the drill.">
                <TagInput values={drillDraft.focus} onChange={(v) => setDrillDraft({ ...drillDraft, focus: v })} placeholder="posture, trunk, mobility" />
              </Field>
              <Field label="Cue" hint="How you say it to yourself. Keep it to one instruction.">
                <TextInput value={drillDraft.cue} onChange={(v) => setDrillDraft({ ...drillDraft, cue: v })} />
              </Field>
              <Field label="Caution" hint="What makes you stop or reduce.">
                <TextInput value={drillDraft.caution} onChange={(v) => setDrillDraft({ ...drillDraft, caution: v })} />
              </Field>
            </div>
            <div className="gl-row gl-row--tight" style={{ marginTop: 'var(--glow-sp-4)' }}>
              <Button variant="primary" onClick={() => void saveDrill()}>
                <Save size={13} /> Save drill
              </Button>
              <Button variant="ghost" onClick={() => setDrillDraft(null)}>
                Cancel
              </Button>
            </div>
          </Card>
        ) : null}
      </section>

      {/* ---------------------------------------------------------- ergonomics */}
      <section className="gl-section">
        <div className="gl-section__title">
          <div>
            <div className="gl-eyebrow">Ergonomics</div>
            <h2>Setup audits, pass or fail</h2>
          </div>
          <Chip tone="info">{auditRuns.length} audit run{auditRuns.length === 1 ? '' : 's'}</Chip>
        </div>
        <p className="gl-small gl-muted">
          An audit is a checklist you write (screen height, forearm support, something to stand up to). A run stores which items
          passed. The rate is passed ÷ steps for that routine's current list — if you later edit the list, older runs are
          recomputed against it, so treat the count as approximate and the note as the record.
        </p>

        {auditRoutines.length === 0 ? (
          <EmptyPlate
            kicker="Plate 04"
            title="No audit routine yet"
            body="Build one with the routine type set to “Audit”: five or six things about the place you actually sit and carry things. Run it monthly; the only claim it makes is about what was true that day."
            action={
              <Button variant="primary" onClick={() => setRoutineDraft({ name: 'Workspace ergonomics audit', timeOfDay: AUDIT, active: true, steps: [{ id: newId('st'), label: 'Screen top near eye height', detail: '' }, { id: newId('st'), label: 'Feet supported or hips level', detail: '' }] })}>
                <Plus size={13} /> Start an audit routine
              </Button>
            }
          />
        ) : (
          <div className="gl-grid gl-grid--2">
            <Card>
              <CardHead title="Run an audit" eyebrow={auRoutine ? String(auRoutine.name) : 'select one'} />
              <div className="ps-form">
                <Field label="Audit routine">
                  <Select
                    value={auRoutineId}
                    onChange={(v) => setAudit({ routineId: v, doneOn: audit.doneOn, passed: [], touched: false, note: audit.note })}
                    options={auditRoutines.map((r) => ({ value: String(r.id), label: String(r.name) }))}
                  />
                </Field>
                <DateInput label="Checked on" value={audit.doneOn} onChange={(v) => setAudit({ ...audit, doneOn: v })} />
                {auExisting ? <div className="gl-tech">A run already exists for this routine on this date — saving updates it.</div> : null}
                <div className="ps-steps">
                  {auSteps.map((s) => {
                    const on = audit.passed.includes(String(s.id));
                    return (
                      <button type="button" key={String(s.id)} className="ps-step" data-on={on} onClick={() => setAudit({ ...audit, passed: on ? audit.passed.filter((x) => x !== String(s.id)) : [...audit.passed, String(s.id)] })}>
                        <span className="ps-step__box">{on ? <Check size={12} /> : null}</span>
                        <span>
                          <span className="ps-step__label">{s.label}</span>
                          {s.detail ? <span className="ps-step__detail">{s.detail}</span> : null}
                        </span>
                      </button>
                    );
                  })}
                </div>
                <Field label="What you changed or will change">
                  <TextArea value={audit.note} onChange={(v) => setAudit({ ...audit, note: v })} rows={3} placeholder="One booked change beats five noted ones." />
                </Field>
                <Button variant="primary" onClick={() => void saveAudit()}>
                  <Save size={13} /> Save audit run
                </Button>
              </div>
            </Card>

            <Card>
              <CardHead title="Trend" sub="Latest run against the run before it" />
              {latestRate ? (
                <>
                  <Meter value={latestRate.pct} label={`Latest pass rate — ${latestRate.passed} of ${latestRate.total} steps`} />
                  <div className="gl-tech" style={{ marginTop: 8 }}>
                    {latestRate.passed} ÷ {latestRate.total} = {latestRate.pct}%
                    {prevRate ? ` · previous run ${prevRate.passed} ÷ ${prevRate.total} = ${prevRate.pct}% (${latestRate.pct - prevRate.pct >= 0 ? '+' : ''}${latestRate.pct - prevRate.pct} points)` : ' · no second run to compare yet'}
                  </div>
                </>
              ) : (
                <p className="gl-small gl-muted">No audit run stored yet, so there is nothing to average.</p>
              )}
              {auditRuns.length ? (
                <div style={{ marginTop: 'var(--glow-sp-4)' }}>
                  <Timeline
                    items={auditRuns.slice(0, 8).map((run) => {
                      const rate = auditRate(run);
                      return {
                        when: formatDate(String(run.doneOn)),
                        title: String(routineById.get(String(run.routineId))?.name ?? 'audit'),
                        body: String(run.note ?? '') || 'no note',
                        right: rate ? <Chip tone={rate.pct >= 80 ? 'gold' : 'info'}>{rate.passed}/{rate.total}</Chip> : null
                      };
                    })}
                  />
                </div>
              ) : null}
              <div className="ps-audit-actions">
                {auditRuns.map((run) => (
                  <IconButton key={String(run.id)} label="Delete audit run" onClick={() => setConfirmDel({ table: TABLES.routineLogs, id: String(run.id), label: `audit on ${run.doneOn}` })}>
                    <Trash2 size={12} />
                  </IconButton>
                ))}
              </div>
            </Card>
          </div>
        )}
      </section>

      {/* -------------------------------------------------------- photo verdicts */}
      <section className="gl-section">
        <div className="gl-section__title">
          <div>
            <div className="gl-eyebrow">Camera presentation</div>
            <h2>Which of your own photographs you liked</h2>
          </div>
          <Chip tone="info">{photos.length} photo{photos.length === 1 ? '' : 's'} in this album</Chip>
        </div>
        <SafetyBanner tone="note" title="No analysis happens here">
          The app does not look at your photographs. There is no face mesh, no line detection, no scoring model. Every number below
          is a count of verdicts you typed against a photograph you took, grouped by the capture tag you chose when adding it.
        </SafetyBanner>

        <div className="gl-grid gl-grid--2" style={{ marginTop: 'var(--glow-sp-4)' }}>
          <Card>
            <CardHead title="Your reference set" eyebrow={`album “${POSTURE_ALBUM}”`} />
            {photos.length === 0 ? (
              <div className="ps-form">
                <p className="gl-small gl-muted">
                  Nothing captured from this page yet. Add a front view and two profiles taken at the same distance — the value is
                  repeatability, not the equipment.
                </p>
                <PhotoPicker
                  kind="upload"
                  album={POSTURE_ALBUM}
                  label="Add photographs"
                  withConditions
                  onPick={(rows) => {
                    if (rows[0]) setPresDraft((p) => ({ ...p, mediaId: String(rows[0].id) }));
                  }}
                />
              </div>
            ) : (
              <>
                <div className="ps-media">
                  {photos.map((p, i) => (
                    <ImageTile
                      key={String(p.id)}
                      item={p}
                      caption={`${String(p.conditions || p.pose || 'untagged')} · ${formatDate(String(p.takenOn))}`}
                      onClick={() => setLightbox(i)}
                    />
                  ))}
                </div>
                <div className="gl-row gl-row--tight" style={{ marginTop: 'var(--glow-sp-3)' }}>
                  <PhotoPicker
                    kind="upload"
                    album={POSTURE_ALBUM}
                    label="Add more"
                    withConditions
                    onPick={(rows) => {
                      if (rows[0]) setPresDraft((p) => ({ ...p, mediaId: String(rows[0].id) }));
                    }}
                  />
                  <Button size="sm" variant="ghost" onClick={() => navigate('/media')}>
                    <Camera size={13} /> Media library
                  </Button>
                </div>
              </>
            )}
          </Card>

          <Card>
            <CardHead title="Record a verdict" sub="One opinion about one photograph of yours" />
            <div className="ps-form">
              <Field label="Photograph">
                <Select
                  value={presDraft.mediaId}
                  onChange={(v) => setPresDraft({ ...presDraft, mediaId: v })}
                  options={photos.map((p) => ({ value: String(p.id), label: `${String(p.title || 'Untitled')} — ${String(p.conditions || p.pose || 'untagged')}` }))}
                  placeholder={photos.length ? 'Choose a photograph' : 'Add a photograph first'}
                />
              </Field>
              <Field label="Your read">
                <SegmentedControl value={presDraft.reads} onChange={(v) => setPresDraft({ ...presDraft, reads: v })} options={READS.map((r) => ({ value: r.value, label: r.label }))} size="sm" />
              </Field>
              <DateInput label="Date of the note" value={presDraft.on} onChange={(v) => setPresDraft({ ...presDraft, on: v })} />
              <Field label="What specifically" hint="Angle, distance, lens height, hair, clothing line — your words, your eye.">
                <TextArea value={presDraft.note} onChange={(v) => setPresDraft({ ...presDraft, note: v })} rows={3} placeholder="Phone at eye height, chin a touch down, shoulders unclenched." />
              </Field>
              <Button variant="primary" onClick={() => void savePresentationNote()}>
                <Save size={13} /> Save verdict
              </Button>
            </div>
          </Card>
        </div>

        {readTally.length ? (
          <div className="gl-grid gl-grid--2" style={{ marginTop: 'var(--glow-sp-4)' }}>
            <Card>
              <CardHead title="Where your own marks land" sub="Counts of your verdicts, grouped by capture tag" />
              <DistributionBars
                rows={readTally.map(([key, v]) => ({ label: `${key} — ${v.good} “reads well” of ${v.total}`, value: v.good }))}
              />
              <div className="gl-tech" style={{ marginTop: 8 }}>
                No weighting, no comparison to other people, no ideal. A tag with one note is one note.
              </div>
            </Card>
            <Card>
              <CardHead title={`Verdict notes (${presNotes.length})`} />
              {presNotes.length === 0 ? <p className="gl-small gl-muted">Nothing recorded yet.</p> : null}
              <div className="ps-notes">
                {presNotes.slice(0, 12).map((n) => {
                  const p = photoById.get(String(n.subjectId));
                  return (
                    <div key={String(n.id)} className="ps-notes__row">
                      <span className="gl-tech">{formatDate(String(n.on))}</span>
                      <span>
                        <span className="gl-small">{String(n.note)}</span>
                        <span className="ps-notes__meta">
                          {String(n.reaction)} · {String(p?.title || 'photograph removed')}
                        </span>
                      </span>
                      <IconButton label="Delete verdict" onClick={() => setConfirmDel({ table: TABLES.observations, id: String(n.id), label: 'verdict' })}>
                        <Trash2 size={12} />
                      </IconButton>
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>
        ) : null}
      </section>

      {/* -------------------------------------------------------- position notes */}
      <section className="gl-section">
        <div className="gl-section__title">
          <div>
            <div className="gl-eyebrow">Awareness log</div>
            <h2>What you noticed, in your words</h2>
          </div>
          <Chip tone="info">{postureNotes.length} note{postureNotes.length === 1 ? '' : 's'}</Chip>
        </div>

        <div className="gl-grid gl-grid--2">
          <Card>
            <CardHead title="Add a note" sub="One line is enough — the point is frequency, not prose" />
            <div className="ps-form">
              <DateInput label="When" value={noteDraft.on} onChange={(v) => setNoteDraft({ ...noteDraft, on: v })} />
              <Field label="Where / during what">
                <TextInput value={noteDraft.where} onChange={(v) => setNoteDraft({ ...noteDraft, where: v })} placeholder="Desk, commute, phone, lifting a case…" />
              </Field>
              <Field label="What happened">
                <SegmentedControl
                  value={noteDraft.reaction}
                  onChange={(v) => setNoteDraft({ ...noteDraft, reaction: v })}
                  options={REACTIONS.map((r) => ({ value: r.value, label: r.label }))}
                  size="sm"
                />
              </Field>
              <Range label="How much it bothered you (0–10)" value={noteDraft.severity} onChange={(v) => setNoteDraft({ ...noteDraft, severity: v })} min={0} max={10} />
              <Field label="Note">
                <TextArea value={noteDraft.note} onChange={(v) => setNoteDraft({ ...noteDraft, note: v })} rows={3} placeholder="Head drifted forward during the second call; fixed by standing, not by willing." />
              </Field>
              <Button variant="primary" onClick={() => void saveNote()}>
                <Save size={13} /> Save note
              </Button>
            </div>
          </Card>

          <div className="gl-stack">
            <Card>
              <CardHead title="Tally by kind" sub="Counts over your own labels" />
              {reactionTally.length ? (
                <DistributionBars rows={reactionTally.map(([label, value]) => ({ label, value }))} />
              ) : (
                <p className="gl-small gl-muted">Nothing logged yet, so there is nothing to count.</p>
              )}
            </Card>
            <Card>
              <CardHead title={`Notes (${postureNotes.length})`} />
              <div className="ps-notes">
                {postureNotes.slice(0, 14).map((n) => (
                  <div key={String(n.id)} className="ps-notes__row">
                    <span className="gl-tech">{formatDate(String(n.on))}</span>
                    <span>
                      <span className="gl-small">{String(n.note)}</span>
                      <span className="ps-notes__meta">
                        {REACTIONS.find((r) => r.value === String(n.reaction))?.label ?? String(n.reaction || 'unspecified')}
                        {Number(n.severity) ? ` · bothered ${n.severity}/10` : ''}
                      </span>
                    </span>
                    <IconButton label="Delete note" onClick={() => setConfirmDel({ table: TABLES.observations, id: String(n.id), label: 'note' })}>
                      <Trash2 size={12} />
                    </IconButton>
                  </div>
                ))}
                {!postureNotes.length ? <p className="gl-small gl-muted">No position notes yet.</p> : null}
              </div>
            </Card>
          </div>
        </div>

        {soreFlag.length ? (
          <SafetyBanner tone="danger" title={`${soreFlag.length} note${soreFlag.length === 1 ? '' : 's'} you marked 7 or worse`}>
            This app records that you said it hurt; it cannot tell you why. Persistent, worsening or night pain, or anything with
            numbness or weakness, is a clinician visit, not a habit to optimise. Book it through /services and keep the drills you
            were actually given.
          </SafetyBanner>
        ) : null}
      </section>

      {/* ------------------------------------------------------------ reference */}
      <section className="gl-section">
        <div className="gl-section__title">
          <div>
            <div className="gl-eyebrow">Technique reference</div>
            <h2>The rows in your library that cover this</h2>
          </div>
          <Chip tone="info">{reference.length} reference rows</Chip>
        </div>
        <p className="gl-small gl-muted">
          Grading, risks and the “when to consult” line are read from each row — this page adds no claim of its own. Rows live in
          the evidence centre, where the sources sit.
        </p>
        <div className="gl-grid gl-grid--2">
          {reference.map((t) => (
            <Card key={String(t.id)}>
              <div className="ps-ref" data-safety={String(t.safety)}>
                <div className="gl-row gl-row--between" style={{ alignItems: 'baseline' }}>
                  <div className="gl-serif" style={{ fontSize: '1.12rem' }}>{String(t.title)}</div>
                  <Chip>{String(t.costBand)}</Chip>
                </div>
                <div className="gl-small gl-strong">{String(t.claim)}</div>
                <p className="gl-small gl-muted">{String(t.evidenceSummary)}</p>
                {(t.benefits as string[])?.length ? (
                  <p className="gl-small"><span className="gl-label">Benefits listed on the row</span> {(t.benefits as string[]).join(' · ')}</p>
                ) : null}
                {(t.risks as string[])?.length ? (
                  <p className="gl-small ps-caution">
                    <span className="gl-label">Risks listed on the row</span> {(t.risks as string[]).join(' · ')}
                  </p>
                ) : null}
                <div className="gl-row gl-row--tight" style={{ marginTop: 8, flexWrap: 'wrap' }}>
                  <Chip>{String(t.evidence)}</Chip>
                  {String(t.safety) === 'unsafe' ? <Chip tone="danger">not offered as an option here</Chip> : null}
                  {t.whenToConsult ? <span className="gl-tech">Consult: {String(t.whenToConsult)}</span> : null}
                </div>
              </div>
            </Card>
          ))}
        </div>

        {lesson ? (
          <Card style={{ marginTop: 'var(--glow-sp-4)' }}>
            <CardHead
              title={<><GraduationCap size={14} /> {String(lesson.title)}</>}
              eyebrow="academy lesson in your library"
              sub={String(lesson.summary ?? '')}
              right={
                <Button size="sm" variant="ghost" onClick={() => navigate('/academy')}>
                  <BookOpen size={13} /> Open the lesson
                </Button>
              }
            />
            <div className="ps-cues">
              {(Array.isArray(lesson.pitfalls) ? (lesson.pitfalls as string[]) : []).slice(0, 4).map((m) => (
                <span key={m} className="ps-cues__item">
                  <TriangleAlert size={11} /> {m}
                </span>
              ))}
            </div>
          </Card>
        ) : null}
      </section>

      {/* ------------------------------------------------------------- limits */}
      <section className="gl-section">
        <div className="gl-section__title">
          <div>
            <div className="gl-eyebrow">Said plainly</div>
            <h2>Claims this page will not make</h2>
          </div>
          <Chip tone="danger">
            <Ban size={11} /> {LIMITS.length} standing refusals
          </Chip>
        </div>
        <div className="gl-grid gl-grid--2">
          {LIMITS.map((l) => (
            <Card key={l.claim}>
              <CardHead title={l.claim} eyebrow="will not be generated here" />
              <p className="gl-small">{l.why}</p>
              <div className="gl-tech">Instead: {l.instead}</div>
            </Card>
          ))}
        </div>

        <Card variant="raised" style={{ marginTop: 'var(--glow-sp-4)' }}>
          <CardHead title="Stop tracking and see someone when…" eyebrow="not a diagnosis — a threshold you set" />
          <ul className="ps-flags">
            {RED_FLAGS.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
          <div className="gl-row gl-row--tight" style={{ marginTop: 'var(--glow-sp-3)' }}>
            <Button size="sm" variant="ghost" onClick={() => navigate('/services')}>
              <BookOpen size={13} /> Find a provider
            </Button>
            <Button size="sm" variant="ghost" onClick={() => navigate('/evidence')}>
              Evidence centre
            </Button>
            <Button size="sm" variant="ghost" onClick={() => navigate('/fitness')}>
              Strength work
            </Button>
            <Button size="sm" variant="ghost" onClick={() => navigate('/calendar')}>
              Schedule the resets
            </Button>
          </div>
        </Card>
      </section>

      <Card variant="flush">
        <KvList
          items={[
            { k: 'Written to', v: 'routines (domain: posture) and routineLogs for habits and audits, exercises for drills, observations for position notes and photo verdicts, mediaItems for photographs in the “' + POSTURE_ALBUM + '” album. Everything goes through the same store, so it is in the backup.' },
            { k: 'Streak', v: 'count of consecutive dates present in your own routineLogs, ending today or yesterday. A missed day breaks it; nothing is estimated.' },
            { k: 'Pass rate', v: 'passed steps ÷ current step count of that audit routine. Editing a routine re-reads older runs, which is why the note is the record.' },
            { k: 'Practice count', v: 'logs in the window whose completed step label contains the drill name (either direction, case-insensitive). A label match, not a measurement.' },
            { k: 'Photo verdicts', v: 'your own judgement per photograph, grouped by the capture tag you picked. No image is analysed, scored or compared.' },
            { k: 'Starter content', v: 'rows tagged “starter” were written by the app, not by you, and every one can be deleted with the remove buttons above.' },
            { k: 'No claims', v: 'no correction promise, no timeline for a permanent change, no diagnosis, no protocol for anything marked unsafe in the library.' }
          ]}
        />
      </Card>

      {/* ------------------------------------------------------------- modals */}
      <Modal open={Boolean(routineDraft)} onClose={() => setRoutineDraft(null)} title={routineDraft?.id ? 'Edit routine' : 'New routine'} wide>
        {routineDraft ? (
          <div className="ps-form">
            <div className="gl-grid gl-grid--2">
              <Field label="Name">
                <TextInput value={routineDraft.name} onChange={(v) => setRoutineDraft({ ...routineDraft, name: v })} placeholder="Awareness check-in" />
              </Field>
              <Field label="Type" hint="“Audit” turns this routine into a pass/fail check instead of a daily habit.">
                <Select value={routineDraft.timeOfDay} onChange={(v) => setRoutineDraft({ ...routineDraft, timeOfDay: v })} options={TIME_OF_DAY.map((t) => ({ value: t, label: t === AUDIT ? 'Audit (pass/fail check)' : t }))} />
              </Field>
            </div>
            <Toggle checked={routineDraft.active} onChange={(v) => setRoutineDraft({ ...routineDraft, active: v })} label="Active" hint="Paused routines stay in the library and keep their history." />
            <div className="gl-field__label" style={{ marginTop: 'var(--glow-sp-4)' }}>Steps</div>
            <div className="ps-steps-editor">
              {routineDraft.steps.map((s, i) => (
                <div key={s.id} className="ps-step-edit">
                  <span className="gl-tech">{i + 1}</span>
                  <TextInput value={s.label} onChange={(v) => setRoutineDraft({ ...routineDraft, steps: routineDraft.steps.map((x, j) => (j === i ? { ...x, label: v } : x)) })} placeholder="One thing you can honestly mark done" />
                  <TextInput value={s.detail} onChange={(v) => setRoutineDraft({ ...routineDraft, steps: routineDraft.steps.map((x, j) => (j === i ? { ...x, detail: v } : x)) })} placeholder="The cue, in your words (optional)" />
                  <IconButton label="Remove step" onClick={() => setRoutineDraft({ ...routineDraft, steps: routineDraft.steps.filter((_, j) => j !== i) })}>
                    <Trash2 size={13} />
                  </IconButton>
                </div>
              ))}
            </div>
            <Button size="sm" onClick={() => setRoutineDraft({ ...routineDraft, steps: [...routineDraft.steps, { id: newId('st'), label: '', detail: '' }] })}>
              <Plus size={13} /> Add step
            </Button>
          </div>
        ) : null}
        <div className="ps-modal-actions">
          <Button variant="ghost" onClick={() => setRoutineDraft(null)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void saveRoutine()}>
            <Save size={13} /> {routineDraft?.id ? 'Update routine' : 'Save routine'}
          </Button>
        </div>
      </Modal>

      <Modal
        open={Boolean(confirmDel)}
        onClose={() => setConfirmDel(null)}
        title="Delete this row?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDel(null)}>
              Keep it
            </Button>
            <Button variant="danger" onClick={() => void runDelete()}>
              <Trash2 size={13} /> Delete
            </Button>
          </>
        }
      >
        <p className="gl-small">
          “{confirmDel?.label}” is marked deleted and leaves every list. It stays in your local database until a purge, so it is
          still in the backup and still recoverable by a clinician asking what you logged.
        </p>
      </Modal>

      <Lightbox items={photos} index={lightbox} onIndex={setLightbox} onClose={() => setLightbox(null)} />
    </div>
  );
}
