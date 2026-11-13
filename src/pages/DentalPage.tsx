/**
 * THE GLOW LAB — Dental & Smile Care (spec Part 19).
 *
 * A record book, not a clinic. Every row here is something the user lived,
 * paid for, or was told at an appointment — including the whitening and
 * alignment entries, which are stored as *records of what a professional said
 * to them*, never as instructions this app authored. There is no photo
 * analysis, no shade grading, no diagnosis, no clinic pricing and no
 * enamel-filing content anywhere in this department: the refusal panel reads
 * the unsafe-technique rows the evidence library already carries and explains
 * the refusal instead.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Ban,
  BellRing,
  CalendarClock,
  CircleDollarSign,
  ClipboardList,
  FileWarning,
  MessageSquareQuote,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
  TriangleAlert
} from 'lucide-react';
import { saveRow, useFlags, useRow, useRows } from '../hooks/live';
import { addDays, formatDate, newId, softDelete, todayISO } from '../db/repo';
import { TABLES, type AnyRow, type TableName } from '../db/schema';
import { loadSettings, type AppSettings } from '../state/settings';
import {
  Button,
  Card,
  CardHead,
  Chip,
  DateInput,
  Disclosure,
  EvidenceChip,
  Field,
  IconButton,
  Meter,
  Modal,
  SafetyBanner,
  Select,
  Table,
  TextArea,
  TextInput,
  fmtMoney,
  useToast
} from '../ui/primitives';
import { useUndoDelete } from '../ui/undo';
import { DeptIntro, EmptyPlate, IndexList, IndexRow, KvList, StatStrip, Timeline } from '../ui/editorial';
import { ImageTile, PhotoPicker } from '../ui/media';
import '../styles/departments/dental.css';

/* ------------------------------------------------------------------ taxonomy */

type RecKind = 'visit' | 'hygiene' | 'restoration' | 'whitening' | 'alignment' | 'expense' | 'note';

const KINDS: { value: RecKind; label: string; meaning: string }[] = [
  { value: 'visit', label: 'Visit', meaning: 'An appointment you attended, with what was said and what it cost.' },
  { value: 'hygiene', label: 'Hygiene / clean & scale', meaning: 'Professional clean, polish, scale — usually the recurring one.' },
  { value: 'restoration', label: 'Filling / crown / restoration', meaning: 'Work done to a tooth, and the aftercare you were given.' },
  { value: 'whitening', label: 'Whitening', meaning: 'Your record of a whitening plan or session. Stored as advice you received.' },
  { value: 'alignment', label: 'Braces / aligner / retainer', meaning: 'Orthodontic stages, retainer wear, change cadence — as told to you.' },
  { value: 'expense', label: 'Expense', meaning: 'Money out, dated. Does not have to be tied to a procedure.' },
  { value: 'note', label: 'Note / question', meaning: 'Anything you want kept beside the smile records.' }
];

const ATTRIBUTIONS = [
  { value: 'clinic-said', label: 'What a clinician told me at the appointment' },
  { value: 'clinic-written', label: 'Written aftercare handed to me by the clinic' },
  { value: 'my-own', label: 'My own plan — not professional advice' },
  { value: 'online', label: 'Something I read online' },
  { value: 'unset', label: 'Source not recorded' }
];

const REACTIONS = [
  { value: 'none', label: 'No reaction' },
  { value: 'good', label: 'Went well' },
  { value: 'bad', label: 'Went badly' },
  { value: 'irritation', label: 'Irritation / sensitivity' },
  { value: 'unknown', label: 'Cannot tell yet' }
];

/** The practices this department refuses to give instructions for, ever. */
const RED_WORDS = /\b(fil(?:e|ing|ed)|reshap\w*|sand(?:ing|ed)?|emery|dremel|nail file|buffer block|unlock your teeth|veneer kit|smile kit)\b/i;

/* -------------------------------------------------------------------- maths */

function money(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(String(raw).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const [y, m, d] = String(iso).split('-').map(Number);
  if (!y || !m || !d) return null;
  return Math.round((Date.now() - new Date(y, m - 1, d).getTime()) / 86400000);
}

function daysUntil(iso: string | null | undefined): number | null {
  const past = daysSince(iso);
  return past === null ? null : -past;
}

function attributionLabel(row?: AnyRow): string {
  const v = String(row?.data?.attributedTo ?? 'unset');
  return ATTRIBUTIONS.find((a) => a.value === v)?.label ?? v;
}

function timeOfDay(iso: number): string {
  const d = new Date(iso);
  return `${`${d.getHours()}`.padStart(2, '0')}:${`${d.getMinutes()}`.padStart(2, '0')}`;
}

function dateOf(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${`${d.getMonth() + 1}`.padStart(2, '0')}-${`${d.getDate()}`.padStart(2, '0')}`;
}

function attachedMedia(ids: unknown, mediaById: Map<string, AnyRow>): AnyRow[] {
  return ((ids as string[]) ?? [])
    .map((id) => mediaById.get(id))
    .filter((m): m is AnyRow => Boolean(m));
}

/* -------------------------------------------------------------------- draft */

interface RecDraft {
  id?: string;
  kind: RecKind;
  on: string;
  label: string;
  dentist: string;
  cost: string;
  detail: string;
  aftercare: string;
  followUpNeeded: boolean;
  followUpOn: string;
  followUpNote: string;
  attributedTo: string;
  nextVisitOn: string;
  mediaIds: string[];
}

function draftFrom(row?: AnyRow, seed?: Partial<RecDraft>): RecDraft {
  return {
    id: row?.id,
    kind: (row?.kind as RecKind) ?? 'visit',
    on: row?.on ? String(row.on) : todayISO(),
    label: row?.label ?? '',
    dentist: row?.dentist ?? '',
    cost: row?.cost === null || row?.cost === undefined ? '' : String(row.cost),
    detail: row?.detail ?? '',
    aftercare: (row?.data?.aftercare as string) ?? '',
    followUpNeeded: Boolean(row?.data?.followUpNeeded),
    followUpOn: (row?.data?.followUpOn as string) ?? '',
    followUpNote: (row?.data?.followUpNote as string) ?? '',
    attributedTo: (row?.data?.attributedTo as string) ?? 'unset',
    nextVisitOn: row?.nextVisitOn ? String(row.nextVisitOn) : '',
    mediaIds: (row?.mediaIds as string[]) ?? [],
    ...seed
  };
}

function payloadFrom(d: RecDraft, currency: string): Record<string, unknown> {
  return {
    id: d.id,
    kind: d.kind,
    on: d.on,
    label: d.label.trim(),
    dentist: d.dentist.trim(),
    detail: d.detail,
    cost: money(d.cost),
    currency: money(d.cost) === null ? null : currency,
    questions: d.followUpNote,
    nextVisitOn: d.nextVisitOn || null,
    mediaIds: d.mediaIds,
    tags: [d.kind, d.dentist.trim().toLowerCase()].filter(Boolean),
    data: {
      aftercare: d.aftercare,
      followUpNeeded: d.followUpNeeded,
      followUpOn: d.followUpOn || null,
      followUpNote: d.followUpNote,
      attributedTo: d.attributedTo,
      currency: money(d.cost) === null ? null : currency
    }
  };
}

/* ------------------------------------------------------------------- remind */

interface PlanDraft {
  key: string;
  title: string;
  date: string;
  time: string;
  minutes: string;
  freq: string;
  interval: string;
  until: string;
  note: string;
  kind: string;
}

const PLANS: { key: string; label: string; blurb: string; seed: Omit<PlanDraft, 'key'> }[] = [
  {
    key: 'visit',
    label: 'Next check-up & clean',
    blurb: 'The recurring appointment itself. Six-month and twelve-month cycles are both ordinary; the interval here is the one your clinic told you to keep.',
    seed: { title: 'Dental check-up', date: addDays(todayISO(), 60), time: '09:00', minutes: '45', freq: 'monthly', interval: '6', until: '', note: '', kind: 'appointment' }
  },
  {
    key: 'retainer',
    label: 'Retainer wear / retainer review',
    blurb: 'Retainer schedules come from the orthodontist who fitted it. This writes the reminder you asked for — it does not know whether yours is nightly or nights-only.',
    seed: { title: 'Retainer check', date: addDays(todayISO(), 30), time: '20:00', minutes: '10', freq: 'weekly', interval: '1', until: '', note: '', kind: 'maintenance' }
  },
  {
    key: 'aligner',
    label: 'Aligner change',
    blurb: 'If your clinic set a change cadence, put that number here. If nobody told you one, leave this plan alone and ask at the next visit.',
    seed: { title: 'Aligner change', date: addDays(todayISO(), 7), time: '21:00', minutes: '5', freq: 'weekly', interval: '1', until: '', note: '', kind: 'routine' }
  }
];

/* --------------------------------------------------------------------- page */

export default function DentalPage() {
  const records = useRows(TABLES.dental);
  const events = useRows(TABLES.calendarEvents, { where: { linkDomain: 'dental' } });
  const observations = useRows(TABLES.observations, { where: { subjectType: 'dental' } });
  const providers = useRows(TABLES.providers);
  const techniques = useRows(TABLES.techniques);
  const mediaRows = useRows(TABLES.mediaItems);
  const flags = useFlags();
  const toast = useToast();
  const remove = useUndoDelete();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const [currency, setCurrency] = useState('USD');
  const [q, setQ] = useState('');
  const [kindFilter, setKindFilter] = useState('');
  const [editing, setEditing] = useState<RecDraft | null>(null);
  const [plan, setPlan] = useState<PlanDraft | null>(null);
  const [obsDraft, setObsDraft] = useState({ note: '', reaction: 'none', severity: '2', on: todayISO() });
  const [questionDraft, setQuestionDraft] = useState('');
  const [confirmDel, setConfirmDel] = useState<{ table: TableName; id: string; label: string } | null>(null);

  const deepId = params.get('record') ?? '';
  const deepRow = useRow(TABLES.dental, deepId || undefined);

  useEffect(() => {
    let live = true;
    void loadSettings().then((s: AppSettings) => live && setCurrency(s.currency));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!deepRow) return;
    setEditing(draftFrom(deepRow));
    setParams({});
  }, [deepRow, setParams]);

  const mediaById = useMemo(() => new Map(mediaRows.map((m) => [m.id, m])), [mediaRows]);
  const techOf = (slug: string) => techniques.find((t) => t.slug === slug);

  /* ---- ledger: filter + sort over the user's own rows ---- */
  const ledger = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return records
      .filter((r) => (r.data?.purpose === 'question' ? false : true))
      .filter((r) => (kindFilter ? r.kind === kindFilter : true))
      .filter((r) =>
        !needle
          ? true
          : [r.label, r.dentist, r.detail, r.kind, r.data?.aftercare, r.data?.followUpNote]
              .join(' ')
              .toLowerCase()
              .includes(needle)
      )
      .sort((a, b) => String(b.on ?? '').localeCompare(String(a.on ?? '')) || b.createdAt - a.createdAt);
  }, [records, q, kindFilter]);

  /* ---- questions live in the same table, tagged, so they stay restorable ---- */
  const questions = useMemo(
    () =>
      records
        .filter((r) => r.kind === 'note' && r.data?.purpose === 'question')
        .sort((a, b) => Number(Boolean(a.data?.asked)) - Number(Boolean(b.data?.asked)) || String(b.on).localeCompare(String(a.on))),
    [records]
  );

  const aftercareQueue = useMemo(
    () =>
      records
        .filter((r) => r.data?.followUpNeeded)
        .map((r) => ({ row: r, dueIn: daysUntil(r.data?.followUpOn ?? null), overdue: daysUntil(r.data?.followUpOn ?? null) !== null && Number(daysUntil(r.data?.followUpOn ?? null)) < 0 }))
        .sort((a, b) => (a.dueIn ?? 99999) - (b.dueIn ?? 99999)),
    [records]
  );

  const spend = useMemo(() => {
    const byYear = new Map<string, number>();
    const byKind = new Map<string, number>();
    let total = 0;
    let last12 = 0;
    let priced = 0;
    for (const r of records) {
      const c = money(r.cost);
      if (c === null) continue;
      priced += 1;
      total += c;
      const y = String(r.on ?? '').slice(0, 4);
      if (y) byYear.set(y, (byYear.get(y) ?? 0) + c);
      byKind.set(String(r.kind), (byKind.get(String(r.kind)) ?? 0) + c);
      const gap = daysSince(r.on);
      if (gap !== null && gap >= 0 && gap <= 365) last12 += c;
    }
    return { total, last12, priced, byYear: [...byYear.entries()].sort((a, b) => b[0].localeCompare(a[0])), byKind: [...byKind.entries()].sort((a, b) => b[1] - a[1]) };
  }, [records]);

  const nextEvent = useMemo(() => {
    const upcoming = events
      .filter((e) => !e.doneOn && Number(e.startAt) >= Date.now() - 86400000)
      .sort((a, b) => Number(a.startAt) - Number(b.startAt));
    return upcoming[0] ?? null;
  }, [events]);

  const nextFromRecords = useMemo(() => {
    const dates = records.map((r) => r.nextVisitOn).filter(Boolean) as string[];
    return dates.sort()[0] ?? null;
  }, [records]);

  /* ---- whitening exposure, read out of the user's own log ---- */
  const whitening = useMemo(() => {
    const rows = records.filter((r) => r.kind === 'whitening');
    const in90 = rows.filter((r) => {
      const d = daysSince(r.on);
      return d !== null && d >= 0 && d <= 90;
    });
    return { rows: rows.sort((a, b) => String(b.on).localeCompare(String(a.on))), in90: in90.length, last: rows[0]?.on ?? null };
  }, [records]);

  const sensitivity = useMemo(() => {
    return observations.filter((o) => {
      const d = daysSince(o.on);
      return (o.reaction === 'irritation' || Number(o.severity) >= 5) && d !== null && d >= 0 && d <= 90;
    });
  }, [observations]);

  /* ---- the red-word scan: refuse and explain, never instruct ---- */
  const flagged = useMemo(() => {
    return records.filter((r) => RED_WORDS.test([r.label, r.detail, r.data?.aftercare, r.data?.followUpNote].join(' ')));
  }, [records]);

  /* ------------------------------------------------------------------ writes */

  async function saveRecord(d: RecDraft) {
    if (!d.label.trim()) {
      toast('A record needs a line of its own — what happened, in your words.', 'bad');
      return;
    }
    const saved = await saveRow(TABLES.dental, payloadFrom(d, currency));
    setEditing(null);
    toast(d.id ? `Updated “${saved.label}”.` : `“${saved.label}” stored in your dental record.`, 'ok');
  }

  async function addQuestion(text: string) {
    const t = text.trim();
    if (!t) {
      toast('Type the question first.', 'bad');
      return;
    }
    await saveRow(TABLES.dental, {
      kind: 'note',
      on: todayISO(),
      label: t,
      detail: '',
      cost: null,
      dentist: '',
      questions: t,
      mediaIds: [],
      tags: ['dental-question'],
      data: { purpose: 'question', asked: false, answer: '', source: 'manual' }
    });
    setQuestionDraft('');
    toast('Added to the list you take with you.', 'ok');
  }

  async function importFromObservations() {
    const pending = observations.filter((o) => !records.some((r) => r.data?.fromObservation === o.id));
    if (!pending.length) {
      toast(observations.length ? 'Every stored observation already has a question.' : 'No dental observations logged yet.', 'info');
      return;
    }
    for (const o of pending) {
      const first = String(o.note).split(/[.\n]/)[0].trim().slice(0, 120);
      await saveRow(TABLES.dental, {
        kind: 'note',
        on: todayISO(),
        label: `About “${first || 'an observation'}” — what should I ask?`,
        detail: `Written up from your own log entry of ${formatDate(String(o.on))}: “${o.note}”`,
        cost: null,
        questions: first,
        mediaIds: [],
        tags: ['dental-question', 'from-observation'],
        data: { purpose: 'question', asked: false, answer: '', source: 'observation', fromObservation: o.id }
      });
    }
    toast(`${pending.length} question${pending.length > 1 ? 's' : ''} drafted from what you yourself logged.`, 'ok');
  }

  async function toggleAsked(row: AnyRow) {
    await saveRow(TABLES.dental, { id: row.id, data: { ...(row.data ?? {}), asked: !row.data?.asked, askedOn: row.data?.asked ? null : todayISO() } });
  }

  async function saveQuestionAnswer(row: AnyRow, answer: string) {
    await saveRow(TABLES.dental, { id: row.id, data: { ...(row.data ?? {}), answer, answeredOn: todayISO() } });
    toast('Their answer is stored against your question. Yours, transcribed — not ours.', 'ok');
  }

  async function writePlan(p: PlanDraft) {
    if (!p.title.trim()) {
      toast('Give the reminder a title you will recognise in the calendar.', 'bad');
      return;
    }
    const [y, m, d] = p.date.split('-').map(Number);
    const [hh, mm] = (p.time || '09:00').split(':').map((x) => Number(x) || 0);
    const start = new Date(y, m - 1, d, hh, mm).getTime();
    await saveRow(TABLES.calendarEvents, {
      title: p.title.trim(),
      kind: p.kind,
      startAt: start,
      endAt: p.minutes ? start + (Number(p.minutes) || 0) * 60000 : null,
      recurrence: p.freq ? { freq: p.freq as 'daily' | 'weekly' | 'monthly', interval: Number(p.interval) || 1, until: p.until || null, byweekday: [] } : undefined,
      reminders: [],
      checklist: [],
      linkDomain: 'dental',
      linkId: '',
      cost: null,
      doneOn: null,
      note: p.note,
      tags: ['dental', 'department:dental'],
      data: { origin: 'dental-reminder', planKey: p.key }
    });
    toast('Written to calendarEvents — it is in /calendar now, alongside everything else.', 'ok');
    setPlan(null);
  }

  async function followUpToEvent(row: AnyRow) {
    const due = (row.data?.followUpOn as string) ?? addDays(todayISO(), 7);
    const [y, m, d] = due.split('-').map(Number);
    await saveRow(TABLES.calendarEvents, {
      title: `Follow-up: ${row.label}`,
      kind: 'review',
      startAt: new Date(y, m - 1, d, 9, 0).getTime(),
      endAt: new Date(y, m - 1, d, 9, 30).getTime(),
      recurrence: undefined,
      reminders: [],
      checklist: [
        { id: newId('chk'), label: 'Did the aftercare you were given actually work?', done: false },
        { id: newId('chk'), label: 'Anything to ask at the next visit?', done: false }
      ],
      linkDomain: 'dental',
      linkId: row.id,
      cost: null,
      doneOn: null,
      note: `Follow-up flag raised on dental record ${row.id} (${formatDate(String(row.on))}). Aftercare as recorded: ${String(row.data?.aftercare ?? 'nothing written')}`,
      tags: ['dental', 'follow-up'],
      data: { origin: 'dental-followup', recordId: row.id }
    });
    toast('Follow-up is a real calendar row now.', 'ok');
  }

  async function toggleEventDone(ev: AnyRow) {
    await saveRow(TABLES.calendarEvents, { id: ev.id, doneOn: ev.doneOn ? null : todayISO() });
  }

  async function logObservation() {
    if (!obsDraft.note.trim()) {
      toast('One line about what you noticed. That is the whole entry.', 'bad');
      return;
    }
    await saveRow(TABLES.observations, {
      subjectType: 'dental',
      subjectId: '',
      on: obsDraft.on,
      note: obsDraft.note.trim(),
      reaction: obsDraft.reaction,
      severity: Number(obsDraft.severity) || 0,
      mediaIds: [],
      tags: ['dental'],
      data: { origin: 'dental' }
    });
    setObsDraft({ note: '', reaction: 'none', severity: '2', on: todayISO() });
    toast('Observation stored. It can become a question for your dentist, never a diagnosis.', 'ok');
  }

  async function runDelete() {
    if (!confirmDel) return;
    await remove(confirmDel.table, confirmDel.id, confirmDel.label);
    setConfirmDel(null);
  }

  const unsafeRow = techOf('diy-enamel-filing');
  const whiteningRow = techOf('peroxide-whitening');
  const charcoalRow = techOf('charcoal-tooth-powder');
  const hygieneRow = techOf('professional-dental-hygiene');

  return (
    <div className="gl-page dt-page">
      <DeptIntro
        id="dental"
        deck="This department is a record book with arithmetic bolted on. It has never seen your teeth, cannot read an x-ray, has no clinic, no price list and no opinion about your enamel — and it will not fabricate one."
        actions={
          <>
            <Button variant="primary" onClick={() => setEditing(draftFrom(undefined, { kind: 'visit' }))}>
              <Plus size={14} /> Log a visit
            </Button>
            <Button onClick={() => setEditing(draftFrom(undefined, { kind: 'restoration' }))}>
              <Sparkles size={14} /> Treatment / aftercare
            </Button>
            <Button onClick={() => setPlan({ ...PLANS[0].seed, key: 'visit' })}>
              <BellRing size={14} /> Add reminder
            </Button>
          </>
        }
        meta={[
          { label: 'Records kept', value: String(records.length) },
          { label: 'Next appointment', value: nextEvent ? `${formatDate(dateOf(Number(nextEvent.startAt)))} · ${timeOfDay(Number(nextEvent.startAt))}` : nextFromRecords ? formatDate(nextFromRecords) : 'nothing scheduled' },
          { label: 'Money you recorded', value: fmtMoney(spend.total, currency) }
        ]}
      />

      <StatStrip
        items={[
          { label: 'Visits & hygiene', value: String(records.filter((r) => r.kind === 'visit' || r.kind === 'hygiene').length), hint: 'rows you typed, dated' },
          { label: 'Treatments logged', value: String(records.filter((r) => r.kind === 'restoration' || r.kind === 'alignment' || r.kind === 'whitening').length), hint: 'stored as records, not advice' },
          { label: 'Last 12 months', value: fmtMoney(spend.last12, currency), hint: `cost column on records dated within 365 days` },
          { label: 'Open questions', value: String(questions.filter((r) => !r.data?.asked).length), hint: `of ${questions.length} written` },
          { label: 'Dental calendar rows', value: String(events.length), hint: 'live in /calendar' }
        ]}
      />

      {/* --------------------------------------------------------- 01 ledger */}
      <section className="gl-section">
        <div className="gl-section__title">
          <div>
            <div className="gl-eyebrow">Section 01 · the record</div>
            <h2>Visits, treatments, money — in your words</h2>
          </div>
          <Button size="sm" variant="primary" onClick={() => setEditing(draftFrom())}>
            <Plus size={13} /> New record
          </Button>
        </div>

        <div className="dt-toolbar">
          <label className="dt-search gl-field" style={{ marginBottom: 0 }}>
            <span className="gl-field__label">
              <Search size={12} /> Search your dental history
            </span>
            <TextInput value={q} onChange={setQ} placeholder="cleaning, crown, Dr. name, sensitivity…" />
          </label>
          <Field label="Record type">
            <Select
              value={kindFilter}
              onChange={setKindFilter}
              placeholder="All types"
              options={KINDS.map((k) => ({ value: k.value, label: `${k.label} (${records.filter((r) => r.kind === k.value).length})` }))}
            />
          </Field>
          <div className="dt-legend">
            {KINDS.map((k) => (
              <span key={k.value} className="gl-tech">
                <b>{k.label}</b> — {k.meaning}
              </span>
            ))}
          </div>
        </div>

        {records.length === 0 ? (
          <EmptyPlate
            kicker="Empty on purpose"
            title="No dental records yet — and none were invented for you"
            body="This app has no clinic, no appointment history and no invoice feed, so it cannot pre-fill a single row. Add the last appointment you remember: the date, who you saw, what it cost, what they said. Everything below — spending, follow-ups, the reminder planner — starts from that first honest line."
            action={
              <Button variant="primary" onClick={() => setEditing(draftFrom(undefined, { kind: 'visit' }))}>
                <Plus size={14} /> Record your last visit
              </Button>
            }
          />
        ) : ledger.length === 0 ? (
          <Card>
            <CardHead title="Nothing matches" sub={`${records.length} records exist; your filters are what is empty here.`} />
            <Button size="sm" onClick={() => { setQ(''); setKindFilter(''); }}>
              Clear filters
            </Button>
          </Card>
        ) : (
          <Table
            rows={ledger}
            keyOf={(r: AnyRow) => r.id}
            columns={[
              { label: 'Date', width: 110, render: (r: AnyRow) => <span className="gl-tech">{formatDate(r.on)}</span> },
              { label: 'Type', width: 120, render: (r: AnyRow) => <Chip>{KINDS.find((k) => k.value === r.kind)?.label ?? String(r.kind)}</Chip> },
              {
                label: 'Record',
                render: (r: AnyRow) => (
                  <button type="button" className="gl-btn gl-btn--link gl-btn--sm" onClick={() => setEditing(draftFrom(r))}>
                    {r.label}
                  </button>
                )
              },
              { label: 'Clinic / dentist', width: 150, render: (r: AnyRow) => <span className="gl-small">{r.dentist || <span className="gl-faint">not recorded</span>}</span> },
              { label: 'Cost', width: 100, render: (r: AnyRow) => <span className="dt-num">{money(r.cost) === null ? <span className="gl-faint">blank</span> : fmtMoney(money(r.cost), currency)}</span> },
              {
                label: 'Source',
                width: 130,
                render: (r: AnyRow) =>
                  r.kind === 'whitening' || r.kind === 'alignment' ? (
                    <Chip tone={r.data?.attributedTo === 'clinic-said' || r.data?.attributedTo === 'clinic-written' ? 'gold' : 'danger'} title={attributionLabel(r)}>
                      {attributionLabel(r).split(' ')[0]}
                    </Chip>
                  ) : (
                    <span className="gl-faint gl-tech">—</span>
                  )
              },
              {
                label: 'Follow-up',
                width: 110,
                render: (r: AnyRow) =>
                  r.data?.followUpNeeded ? (
                    <Chip tone={daysUntil(r.data?.followUpOn) !== null && Number(daysUntil(r.data?.followUpOn)) < 0 ? 'danger' : 'moderate'}>
                      {r.data?.followUpOn ? formatDate(r.data.followUpOn) : 'flagged'}
                    </Chip>
                  ) : (
                    <span className="gl-faint gl-tech">none</span>
                  )
              },
              {
                label: '',
                width: 84,
                render: (r: AnyRow) => (
                  <div className="gl-row gl-row--tight">
                    <IconButton label={`Edit ${r.label}`} onClick={() => setEditing(draftFrom(r))}>
                      <Pencil size={14} />
                    </IconButton>
                    <IconButton label={`Delete ${r.label}`} onClick={() => setConfirmDel({ table: TABLES.dental, id: r.id, label: String(r.label) })}>
                      <Trash2 size={14} />
                    </IconButton>
                  </div>
                )
              }
            ]}
          />
        )}

        {flagged.length ? (
          <SafetyBanner tone="danger" title={`${flagged.length} record${flagged.length > 1 ? 's' : ''} mention a practice this app will not give instructions for`}>
            <p className="gl-small">
              You wrote it, so it stays in your history — softening your own record would be dishonest. But Glow Lab will not add a
              how-to to it, and nothing here endorses it. Enamel that is removed does not grow back, and no shape change belongs to a
              home kit. The exact wording you used:
            </p>
            <ul className="dt-flags">
              {flagged.map((r) => (
                <li key={r.id} className="gl-small">
                  {formatDate(r.on)} — “{r.label}”
                </li>
              ))}
            </ul>
            <div className="gl-row gl-row--tight" style={{ marginTop: 'var(--glow-sp-3)' }}>
              <Button size="sm" onClick={() => void addQuestion('Is the shape change I am thinking about something bonding could do, or nothing at all?')}>
                <MessageSquareQuote size={13} /> Turn it into a dentist question
              </Button>
              {unsafeRow ? (
                <Button size="sm" variant="ghost" onClick={() => navigate('/evidence')}>
                  Read the {unsafeRow.evidence} graded entry
                </Button>
              ) : null}
            </div>
          </SafetyBanner>
        ) : null}
      </section>

      {/* ------------------------------------------------ 02 aftercare queue */}
      <div className="gl-editorial gl-editorial--wide-left">
        <section className="gl-section">
          <div className="gl-section__title">
            <div>
              <div className="gl-eyebrow">Section 02 · aftercare</div>
              <h2>What you were told to do afterwards</h2>
            </div>
            <Chip tone={aftercareQueue.length ? 'moderate' : 'info'}>{aftercareQueue.length} flagged</Chip>
          </div>

          {aftercareQueue.length === 0 ? (
            <Card>
              <CardHead title="No open aftercare flags" sub="Tick “follow-up needed” on any treatment record and it queues here with its date." />
              <p className="gl-small gl-muted">
                Aftercare text is the clinic's words copied by you, not this app's words composed for you. If nobody gave you any, write
                “none given” rather than letting a well-meaning guess fill the field.
              </p>
            </Card>
          ) : (
            <div className="dt-after">
              {aftercareQueue.map(({ row, dueIn, overdue }) => (
                <Card key={row.id}>
                  <CardHead
                    title={row.label}
                    eyebrow={`${KINDS.find((k) => k.value === row.kind)?.label ?? row.kind} · ${formatDate(row.on)}`}
                    sub={row.dentist ? `with ${row.dentist}` : 'clinic not recorded'}
                    right={
                      <>
                        <Chip tone={overdue ? 'danger' : 'moderate'}>{dueIn === null ? 'no date' : overdue ? `${Math.abs(dueIn)} days past` : `in ${dueIn} days`}</Chip>
                        <IconButton label={`Edit ${row.label}`} onClick={() => setEditing(draftFrom(row))}>
                          <Pencil size={14} />
                        </IconButton>
                      </>
                    }
                  />
                  <p className="dt-after__text">{String(row.data?.aftercare ?? 'No aftercare text stored — add what they told you.')}</p>
                  {row.data?.followUpNote ? <div className="gl-tech">Flag reason: {row.data.followUpNote}</div> : null}
                  <div className="gl-row gl-row--tight" style={{ marginTop: 'var(--glow-sp-3)' }}>
                    <Button size="sm" onClick={() => void followUpToEvent(row)}>
                      <CalendarClock size={13} /> Put the follow-up in the calendar
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        void saveRow(TABLES.dental, { id: row.id, data: { ...(row.data ?? {}), followUpNeeded: false } });
                        toast('Flag cleared on your record.', 'ok');
                      }}
                    >
                      Close the flag
                    </Button>
                  </div>
                  {attachedMedia(row.mediaIds, mediaById).map((m) => (
                    <div key={String(m.id)} style={{ marginTop: 'var(--glow-sp-3)', width: 150 }}>
                      <ImageTile item={m} caption={formatDate(m.takenOn)} />
                    </div>
                  ))}
                </Card>
              ))}
            </div>
          )}
        </section>

        {/* ---------------------------------------------------- 02b reminders */}
        <div className="gl-stack">
          <Card>
            <CardHead title="Reminder planner" eyebrow="writes calendarEvents rows" sub="Three planners you asked for. Intervals are whatever your clinic gave you — the app has none of its own." />
            <div className="dt-plans">
              {PLANS.map((p) => (
                <div key={p.key} className="dt-plan">
                  <div className="dt-plan__head">
                    <span className="gl-serif">{p.label}</span>
                    <Button size="sm" onClick={() => setPlan({ ...p.seed, key: p.key })}>
                      <BellRing size={12} /> Schedule
                    </Button>
                  </div>
                  <p className="gl-small gl-muted">{p.blurb}</p>
                  <div className="gl-tech">
                    {events.filter((e) => e.data?.planKey === p.key).length} row(s) on the calendar from this planner
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <CardHead
              title="Dental rows on your calendar"
              eyebrow={`${events.length} event(s)`}
              right={
                <Button size="sm" variant="ghost" onClick={() => navigate('/calendar')}>
                  Open calendar
                </Button>
              }
            />
            {events.length === 0 ? (
              <p className="gl-small gl-muted">Nothing scheduled from this department yet. A planner above, or a follow-up flag, both write real rows.</p>
            ) : (
              <Timeline
                items={[...events]
                  .sort((a, b) => Number(a.startAt) - Number(b.startAt))
                  .slice(0, 8)
                  .map((e) => ({
                    when: `${formatDate(dateOf(Number(e.startAt)))} · ${timeOfDay(Number(e.startAt))}`,
                    title: e.title,
                    body: `${e.kind}${e.recurrence ? ` · repeats ${e.recurrence.interval}× ${e.recurrence.freq}` : ''}${e.doneOn ? ` · marked done ${formatDate(e.doneOn)}` : ''}`,
                    tone: e.doneOn ? ('plain' as const) : ('accent' as const),
                    right: (
                      <>
                        <Button size="sm" variant={e.doneOn ? 'ghost' : 'gold'} onClick={() => void toggleEventDone(e)}>
                          {e.doneOn ? 'Reopen' : 'Done'}
                        </Button>
                        <IconButton label={`Delete ${e.title}`} onClick={() => setConfirmDel({ table: TABLES.calendarEvents, id: e.id, label: String(e.title) })}>
                          <Trash2 size={13} />
                        </IconButton>
                      </>
                    )
                  }))}
              />
            )}
            <div className="gl-tech" style={{ marginTop: 'var(--glow-sp-3)' }}>
              These reminders live inside the app. Nothing is pushed to your phone, no notification is sent, no server sees any of it.
            </div>
          </Card>

          {nextFromRecords || nextEvent ? (
            <Card>
              <CardHead title="Next visit" eyebrow="from your own records" />
              <div className="dt-next">
                {nextEvent ? (
                  <div>
                    <div className="gl-label">Calendar</div>
                    <div className="gl-num">{formatDate(dateOf(Number(nextEvent.startAt)))}</div>
                    <div className="gl-tech">{daysUntil(dateOf(Number(nextEvent.startAt)))} days away · {nextEvent.title}</div>
                  </div>
                ) : null}
                {nextFromRecords ? (
                  <div>
                    <div className="gl-label">Written on a record</div>
                    <div className="gl-num">{formatDate(nextFromRecords)}</div>
                    <div className="gl-tech">{daysUntil(nextFromRecords)} days from today</div>
                  </div>
                ) : null}
              </div>
            </Card>
          ) : (
            <Card>
              <CardHead title="No next visit on the books" sub="Not a judgment — just an absence. Set a date on a record or use a planner above." />
            </Card>
          )}
        </div>
      </div>

      {/* ------------------------------------------------------ 03 cost log */}
      <section className="gl-section">
        <div className="gl-section__title">
          <div>
            <div className="gl-eyebrow">Section 03 · money</div>
            <h2>The cost log, with its denominator printed</h2>
          </div>
          <Button size="sm" onClick={() => setEditing(draftFrom(undefined, { kind: 'expense' }))}>
            <CircleDollarSign size={13} /> Add expense
          </Button>
        </div>

        <div className="gl-grid gl-grid--3">
          <Card>
            <CardHead title="All time" eyebrow="sum of the cost column" />
            <div className="gl-num">{fmtMoney(spend.total, currency)}</div>
            <div className="gl-tech">
              {spend.priced} of {records.length} records carry a number. The other {records.length - spend.priced} stay blank rather than
              estimated — a receipt you did not keep is not a zero.
            </div>
            <Meter label="Priced records" value={records.length ? (spend.priced / records.length) * 100 : 0} />
          </Card>

          <Card>
            <CardHead title="By year" eyebrow="from the record date" />
            {spend.byYear.length === 0 ? (
              <p className="gl-small gl-muted">No dated costs yet.</p>
            ) : (
              <div className="gl-list">
                {spend.byYear.map(([y, v]) => (
                  <div className="gl-list__row" key={y}>
                    <span className="gl-tech">{y}</span>
                    <span className="dt-num">{fmtMoney(v, currency)}</span>
                  </div>
                ))}
              </div>
            )}
            <p className="gl-small gl-faint">
              Currency is the app-wide setting ({currency}). Costs you logged in another currency are totals of numbers, not of
              converted money — this app has no exchange feed.
            </p>
          </Card>

          <Card>
            <CardHead title="By record type" eyebrow="where the money went, per your rows" />
            {spend.byKind.length === 0 ? (
              <p className="gl-small gl-muted">Nothing priced yet.</p>
            ) : (
              <IndexList>
                {spend.byKind.map(([k, v], i) => (
                  <IndexRow
                    key={k}
                    no={i + 1}
                    title={KINDS.find((x) => x.value === k)?.label ?? k}
                    sub={`${fmtMoney(v, currency)} · ${((v / spend.total) * 100).toFixed(0)}% of all logged cost`}
                    right={<Chip>{records.filter((r) => r.kind === k).length} rows</Chip>}
                    onClick={() => setKindFilter(k)}
                  />
                ))}
              </IndexList>
            )}
            {providers.filter((p) => /dent/i.test(String(p.discipline))).length ? (
              <Disclosure summary={`${providers.filter((p) => /dent/i.test(String(p.discipline))).length} dental provider(s) in your Services directory`}>
                <div className="gl-list">
                  {providers
                    .filter((p) => /dent/i.test(String(p.discipline)))
                    .map((p) => (
                      <div className="gl-list__row" key={p.id}>
                        <span>{p.name}</span>
                        <span className="gl-tech">{p.credentials || 'credentials not recorded'}</span>
                      </div>
                    ))}
                </div>
                <Button size="sm" variant="ghost" onClick={() => navigate('/services')}>
                  Open provider directory
                </Button>
              </Disclosure>
            ) : (
              <p className="gl-small gl-muted">
                No dentist saved as a provider yet. The directory lives in <a href="#/services">/services</a> — prices there are the fees
                you recorded, never quotes this app produced.
              </p>
            )}
          </Card>
        </div>
      </section>

      {/* ---------------------------------------------------- 04 observations */}
      <div className="gl-editorial gl-editorial--asym">
        <section className="gl-section">
          <div className="gl-section__title">
            <div>
              <div className="gl-eyebrow">Section 04 · noticing</div>
              <h2>Your own observations</h2>
            </div>
            <Chip tone="info">{observations.length} logged</Chip>
          </div>
          <Card>
            <CardHead title="Log something you felt" sub="Sensitivity, a sharp edge, a gap, a taste. What you noticed — not what it means." />
            <div className="gl-form-row">
              <DateInput label="When" value={obsDraft.on} onChange={(v) => setObsDraft({ ...obsDraft, on: v })} />
              <Field label="Reaction">
                <Select value={obsDraft.reaction} onChange={(v) => setObsDraft({ ...obsDraft, reaction: v })} options={REACTIONS} />
              </Field>
              <Field label={`Nuisance level ${obsDraft.severity}/10`} hint="Your own scale. It is not a clinical severity score.">
                <TextInput type="number" value={obsDraft.severity} onChange={(v) => setObsDraft({ ...obsDraft, severity: v })} />
              </Field>
            </div>
            <Field label="What you noticed">
              <TextArea value={obsDraft.note} onChange={(v) => setObsDraft({ ...obsDraft, note: v })} rows={3} placeholder="Cold water bites on the upper left back tooth, started around the 3rd." />
            </Field>
            <div className="gl-row gl-row--between" style={{ marginTop: 'var(--glow-sp-3)' }}>
              <span className="gl-tech">Writes an observations row with subjectType “dental”.</span>
              <Button variant="primary" size="sm" onClick={() => void logObservation()}>
                <Plus size={13} /> Store observation
              </Button>
            </div>
          </Card>

          {observations.length ? (
            <div className="gl-list" style={{ marginTop: 'var(--glow-sp-4)' }}>
              {[...observations]
                .sort((a, b) => String(b.on).localeCompare(String(a.on)))
                .slice(0, 10)
                .map((o) => (
                  <div className="gl-list__row" key={o.id}>
                    <span>
                      <span className="gl-small">{o.note}</span>
                      <span className="gl-tech" style={{ display: 'block' }}>
                        {formatDate(o.on)} · {String(o.reaction)} · nuisance {o.severity}/10
                      </span>
                    </span>
                    <span className="gl-row gl-row--tight">
                      <Button size="sm" variant="ghost" onClick={() => void addQuestion(`${String(o.note).slice(0, 60)} — what should I ask about this?`)}>
                        Ask my dentist
                      </Button>
                      <IconButton label="Delete observation" onClick={() => setConfirmDel({ table: TABLES.observations, id: o.id, label: String(o.note).slice(0, 40) })}>
                        <Trash2 size={13} />
                      </IconButton>
                    </span>
                  </div>
                ))}
            </div>
          ) : (
            <p className="gl-small gl-muted" style={{ marginTop: 'var(--glow-sp-3)' }}>
              Nothing logged. Observations are the raw material for the question list below — the app cannot invent either half.
            </p>
          )}
        </section>

        {/* --------------------------------------------------- 04b questions */}
        <div className="gl-stack">
          <Card>
            <CardHead
              title="Questions to bring"
              eyebrow="Section 05"
              right={
                <Button size="sm" onClick={() => void importFromObservations()}>
                  <ClipboardList size={13} /> Draft from my observations
                </Button>
              }
            />
            <Field label="Add a question" hint="Enter stores it as its own row, dated, so the list survives a reload.">
              <TextInput value={questionDraft} onChange={setQuestionDraft} onEnter={() => void addQuestion(questionDraft)} placeholder="Does the white spot near the gum need watching or leaving alone?" />
            </Field>
            {questions.length === 0 ? (
              <p className="gl-small gl-muted">The list is empty because nothing has been typed. Add one line, or draft from your observations.</p>
            ) : (
              <div className="dt-qs">
                {questions.map((r) => (
                  <QuestionRow key={`${r.id}:${flags}`} row={r} onToggle={() => void toggleAsked(r)} onDelete={() => setConfirmDel({ table: TABLES.dental, id: r.id, label: String(r.label) })} onSaveAnswer={(a) => void saveQuestionAnswer(r, a)} />
                ))}
              </div>
            )}
            <div className="gl-tech" style={{ marginTop: 'var(--glow-sp-3)' }}>
              {questions.filter((r) => r.data?.asked).length} asked · {questions.filter((r) => r.data?.answer).length} with an answer you wrote down
            </div>
          </Card>

          {sensitivity.length ? (
            <SafetyBanner tone="warn" title={`${sensitivity.length} recent observation(s) you graded as irritation or a 5+ nuisance`}>
              <p className="gl-small">
                That is a pattern in your log, not a diagnosis. This app has no way to know whether it is a high spot, a cracked
                restoration, a gum issue or cold water doing exactly what cold water does. Bring the dated lines above to the person who
                can look.
              </p>
              <Button size="sm" onClick={() => void addQuestion('I have had sensitivity most days since [date] — what should I describe to you and what would you want to check?')}>
                <MessageSquareQuote size={13} /> Add as a question
              </Button>
            </SafetyBanner>
          ) : null}
        </div>
      </div>

      {/* -------------------------------------------------- 06 refuse/explain */}
      <section className="gl-section">
        <div className="gl-section__title">
          <div>
            <div className="gl-eyebrow">Section 06 · refusals, with the reason</div>
            <h2>Whitening overuse and enamel filing</h2>
          </div>
          <Chip tone="danger">
            <Ban size={11} /> nothing here is a how-to
          </Chip>
        </div>

        <div className="gl-grid gl-grid--2">
          <Card variant="flush">
            <CardHead
              title="Your whitening exposure"
              eyebrow="read from your own rows"
              right={<Chip tone={whitening.in90 > 2 ? 'danger' : 'info'}>{whitening.in90} in the last 90 days</Chip>}
            />
            <div className="dt-meter">
              <div className="gl-num">{whitening.rows.length}</div>
              <div className="gl-tech">
                whitening records all time{whitening.last ? ` · most recent ${formatDate(whitening.last)}` : ''}
              </div>
            </div>
            <p className="gl-small">
              Glow Lab will not tell you how much is too much for you, because the variables are yours and invisible to this app:
              peroxide concentration, tray fit, gum recession, existing sensitivity, and whether any of the surfaces are bonded, crowned
              or veneered — none of which whiten the same way natural enamel does. What it can do is count your entries and hand the
              number to a dentist.
            </p>
            {whiteningRow ? (
              <div className="dt-ref" data-safety={whiteningRow.safety}>
                <div className="gl-row gl-row--between" style={{ alignItems: 'baseline' }}>
                  <span className="gl-serif">{whiteningRow.title}</span>
                  <EvidenceChip grade={String(whiteningRow.evidence)} />
                </div>
                <p className="gl-small">{whiteningRow.evidenceSummary}</p>
                <ul className="dt-flags">
                  {((whiteningRow.risks as string[]) ?? []).map((x) => (
                    <li key={x} className="gl-small">
                      {x}
                    </li>
                  ))}
                </ul>
                <div className="gl-tech">When the library says to ask: {whiteningRow.whenToConsult}</div>
              </div>
            ) : (
              <p className="gl-small gl-muted">The peroxide whitening entry is not in your techniques table — run a reseed from Settings if you expected it.</p>
            )}
            <Button size="sm" variant="ghost" onClick={() => void addQuestion('How many whitening cycles are sensible for my enamel, given the restorations you can see and I cannot describe?')}>
              Ask about my whitening frequency
            </Button>
          </Card>

          <Card variant="flush">
            <CardHead title="Enamel filing, reshaping, sanding" eyebrow="the standing refusal" />
            <SafetyBanner tone="danger" title="This app will not help with this, in any framing">
              <p className="gl-small">
                No instruction, no taper, no “just the edges”, no sanding schedule, no product recommendation, no comment on a photo of
                your teeth. Tooth shape is a dentist's decision taken with a mirror, a probe and an x-ray — this department has none of
                the three. “Smile contouring” content online is lighting, cropping and angle; the damage is the part that does not photograph.
              </p>
            </SafetyBanner>
            {unsafeRow ? (
              <div className="dt-ref" data-safety="unsafe">
                <div className="gl-row gl-row--between" style={{ alignItems: 'baseline' }}>
                  <span className="gl-serif">{unsafeRow.title}</span>
                  <EvidenceChip grade={String(unsafeRow.evidence)} />
                </div>
                <p className="gl-small">{unsafeRow.evidenceSummary}</p>
                <div className="dt-ref__grid">
                  <div>
                    <div className="gl-label">Documented risks</div>
                    <ul className="dt-flags">
                      {((unsafeRow.risks as string[]) ?? []).map((x) => (
                        <li key={x} className="gl-small">
                          {x}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <div className="gl-label">What professionals do instead</div>
                    <ul className="dt-flags">
                      {((unsafeRow.saferAlternatives as string[]) ?? []).map((x) => (
                        <li key={x} className="gl-small">
                          {x}
                        </li>
                      ))}
                    </ul>
                    <div className="gl-tech">Reversibility: {unsafeRow.reversibility}</div>
                  </div>
                </div>
              </div>
            ) : null}
            {charcoalRow ? (
              <Disclosure summary={`Adjacent refusal: ${charcoalRow.title}`}>
                <div className="gl-row gl-row--tight" style={{ marginBottom: 6 }}>
                  <EvidenceChip grade={String(charcoalRow.evidence)} />
                  <Chip tone="limited">{charcoalRow.costBand}</Chip>
                </div>
                <p className="gl-small">{charcoalRow.evidenceSummary}</p>
                <div className="gl-tech">{charcoalRow.reversibility}</div>
              </Disclosure>
            ) : null}
            <div className="gl-row gl-row--tight" style={{ marginTop: 'var(--glow-sp-3)' }}>
              <Button size="sm" onClick={() => void addQuestion('I have been reading about contouring my own teeth. What are the options you would actually offer me, and what would each cost?')}>
                <FileWarning size={13} /> Put it to my dentist instead
              </Button>
              <Button size="sm" variant="ghost" onClick={() => navigate('/services')}>
                Book a consultation
              </Button>
            </div>
          </Card>
        </div>

        {hygieneRow ? (
          <Card style={{ marginTop: 'var(--glow-sp-4)' }}>
            <CardHead
              title="The one thing the record can support"
              eyebrow="from the evidence library, not from us"
              right={<EvidenceChip grade={String(hygieneRow.evidence)} />}
            />
            <p className="gl-small">{hygieneRow.evidenceSummary}</p>
            <div className="gl-row gl-row--tight" style={{ flexWrap: 'wrap', marginTop: 'var(--glow-sp-3)' }}>
              {((hygieneRow.benefits as string[]) ?? []).map((b) => (
                <Chip key={b} tone="gold">
                  {b}
                </Chip>
              ))}
              <Button size="sm" variant="gold" onClick={() => setPlan({ ...PLANS[0].seed, key: 'visit', title: 'Hygiene appointment — clean & scale' })}>
                <CalendarClock size={13} /> Schedule the next clean
              </Button>
              <Button size="sm" variant="ghost" onClick={() => navigate('/evidence')}>
                Open the evidence centre
              </Button>
            </div>
          </Card>
        ) : null}
      </section>

      {/* ---------------------------------------------------------- 07 limits */}
      <section className="gl-section">
        <div className="gl-section__title">
          <div>
            <div className="gl-eyebrow">Said plainly</div>
            <h2>What this cannot do</h2>
          </div>
          <Chip tone="danger">
            <TriangleAlert size={11} /> 6 standing limits
          </Chip>
        </div>
        <div className="gl-grid gl-grid--3">
          {[
            {
              t: 'It cannot look at your teeth',
              b: 'No photo analysis, no shade grading, no x-ray reading, no diagnosis, no “this looks like a crack”. A photograph cannot carry what a clinician needs, so the app does not pretend otherwise.'
            },
            {
              t: 'It has no clinic knowledge',
              b: 'No prices, no availability, no insurance rules, no referral lists, no waiting times. Costs here are the numbers you typed on the day you paid them.'
            },
            {
              t: 'It cannot verify advice',
              b: 'Whitening, aligner and retainer entries are your transcription of what someone told you, dated. The app stores it as a record, not as a recommendation it authored.' },
            {
              t: 'It will never write a clinical protocol',
              b: 'No dosing, no filing, no at-home “reshaping”, no antibiotic or painkiller plan, no tray recipe. That content does not exist in this department and will not be generated on request.'
            },
            {
              t: 'It cannot push you',
              b: 'Reminders are rows in your own database, on this device. There is no notification service, no export to a phone calendar unless you take one from /calendar.'
            },
            {
              t: 'It cannot judge your smile',
              b: 'No attractiveness score, no ranking, no before/after verdict. Progress here is dates, counts and money — the parts that are facts.'
            }
          ].map((l) => (
            <Card key={l.t} variant="flush">
              <CardHead title={l.t} eyebrow="will not be produced here" />
              <p className="gl-small">{l.b}</p>
            </Card>
          ))}
        </div>

        <Card variant="flush" style={{ marginTop: 'var(--glow-sp-4)' }}>
          <KvList
            items={[
              { k: 'Written to', v: 'dental (records, expenses, questions), observations (what you noticed), calendarEvents (reminders you asked for) — real rows in IndexedDB on this device.' },
              { k: 'Read from', v: 'techniques (the evidence library behind the refusal panel), providers (your Services directory), mediaItems (photos you attach).' },
              { k: 'Cost figures', v: 'A sum of the cost column on dated rows you entered. Blank costs are excluded, never estimated. Currency is the app-wide setting, un-converted.' },
              { k: 'Deleting', v: 'Soft delete with a confirmation step; restore from Settings & Integrations. Calendar rows you created here are deleted separately so an attended appointment stays in history.' },
              { k: 'Nothing leaves', v: 'No upload, no scraping, no remote model. This page runs entirely on your records.' }
            ]}
          />
        </Card>
      </section>

      {/* -------------------------------------------------------------- modals */}
      <RecordModal
        draft={editing}
        onCancel={() => setEditing(null)}
        onSave={(d) => void saveRecord(d)}
        currency={currency}
        onCurrency={setCurrency}
        providerNames={providers.map((p) => String(p.name))}
        mediaById={mediaById}
      />

      <Modal
        open={Boolean(plan)}
        onClose={() => setPlan(null)}
        title="Write a reminder into your calendar"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPlan(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => plan && void writePlan(plan)}>
              <BellRing size={14} /> Create the event
            </Button>
          </>
        }
      >
        {plan ? (
          <div className="gl-stack">
            <p className="gl-small gl-muted">
              This creates one <code>calendarEvents</code> row, optionally repeating. It is a row, not a notification: nothing outside
              this app is told.
            </p>
            <Field label="Title">
              <TextInput value={plan.title} onChange={(v) => setPlan({ ...plan, title: v })} placeholder="Dental check-up & clean" />
            </Field>
            <div className="gl-form-row">
              <DateInput label="First date" value={plan.date} onChange={(v) => setPlan({ ...plan, date: v })} />
              <Field label="Time">
                <TextInput type="time" value={plan.time} onChange={(v) => setPlan({ ...plan, time: v })} />
              </Field>
              <Field label="Length in minutes">
                <TextInput type="number" value={plan.minutes} onChange={(v) => setPlan({ ...plan, minutes: v })} />
              </Field>
            </div>
            <div className="gl-form-row">
              <Field label="Repeat">
                <Select
                  value={plan.freq}
                  onChange={(v) => setPlan({ ...plan, freq: v })}
                  placeholder="One-off"
                  options={[
                    { value: 'daily', label: 'Daily' },
                    { value: 'weekly', label: 'Weekly' },
                    { value: 'monthly', label: 'Monthly' }
                  ]}
                />
              </Field>
              <Field label="Every">
                <TextInput type="number" value={plan.interval} onChange={(v) => setPlan({ ...plan, interval: v })} />
              </Field>
              <DateInput label="Until (optional)" value={plan.until} onChange={(v) => setPlan({ ...plan, until: v })} />
            </div>
            <Field label="Event kind">
              <Select
                value={plan.kind}
                onChange={(v) => setPlan({ ...plan, kind: v })}
                options={[
                  { value: 'appointment', label: 'appointment' },
                  { value: 'maintenance', label: 'maintenance' },
                  { value: 'routine', label: 'routine' },
                  { value: 'review', label: 'review' }
                ]}
              />
            </Field>
            <Field label="Note on the event">
              <TextArea value={plan.note} onChange={(v) => setPlan({ ...plan, note: v })} rows={2} placeholder="Ask about the lower right filling; bring the questions list" />
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
          <strong>{confirmDel?.label}</strong> will be marked deleted rather than destroyed. Dental history is the kind of record people
          want back.
        </p>
        <p className="gl-small gl-muted">Restore is available under Settings &amp; Integrations, and nothing is erased from disk here.</p>
      </Modal>
    </div>
  );
}

/* ---------------------------------------------------------------- question */

function QuestionRow({
  row,
  onToggle,
  onSaveAnswer,
  onDelete
}: {
  row: AnyRow;
  onToggle: () => void;
  onSaveAnswer: (answer: string) => void;
  onDelete: () => void;
}) {
  const [answer, setAnswer] = useState(String(row.data?.answer ?? ''));
  const [open, setOpen] = useState(Boolean(row.data?.answer));
  const asked = Boolean(row.data?.asked);

  return (
    <div className="dt-q" data-asked={asked}>
      <div className="dt-q__head">
        <button type="button" className="dt-q__check" onClick={onToggle} aria-pressed={asked} title={asked ? 'Mark as not asked yet' : 'Mark as asked'}>
          {asked ? '✓' : ''}
        </button>
        <span className="gl-serif dt-q__text">{row.label}</span>
        <span className="gl-row gl-row--tight">
          <IconButton label={open ? 'Hide answer' : 'Write what they said'} onClick={() => setOpen(!open)}>
            <Pencil size={13} />
          </IconButton>
          <IconButton label="Delete question" onClick={onDelete}>
            <Trash2 size={13} />
          </IconButton>
        </span>
      </div>
      <div className="gl-tech">
        added {formatDate(row.on)}
        {row.data?.source === 'observation' ? ' · drafted from your own log' : ''}
        {row.data?.askedOn ? ` · asked ${formatDate(row.data.askedOn)}` : ''}
      </div>
      {open ? (
        <div style={{ marginTop: 'var(--glow-sp-2)' }}>
          <Field label="What they said, in your words" hint="Stored on the question row. The app adds no interpretation.">
            <TextArea value={answer} onChange={setAnswer} rows={3} placeholder="“Watch it — bring it back if it starts waking you up.”" />
          </Field>
          <Button size="sm" variant="primary" onClick={() => onSaveAnswer(answer)}>
            Save the answer
          </Button>
        </div>
      ) : row.data?.answer ? (
        <p className="gl-small dt-q__answer">{String(row.data.answer)}</p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------ record modal */

function RecordModal({
  draft,
  onCancel,
  onSave,
  currency,
  onCurrency,
  providerNames,
  mediaById
}: {
  draft: RecDraft | null;
  onCancel: () => void;
  onSave: (d: RecDraft) => void;
  currency: string;
  onCurrency: (v: string) => void;
  providerNames: string[];
  mediaById: Map<string, AnyRow>;
}) {
  const [d, setD] = useState<RecDraft | null>(draft);
  useEffect(() => setD(draft), [draft]);
  if (!d) return null;

  const professionalKind = d.kind === 'whitening' || d.kind === 'alignment';
  const notFromClinic = professionalKind && d.attributedTo !== 'clinic-said' && d.attributedTo !== 'clinic-written';
  const set = <K extends keyof RecDraft>(k: K, v: RecDraft[K]) => setD({ ...d, [k]: v });

  return (
    <Modal
      open
      wide
      onClose={onCancel}
      title={d.id ? `Edit record — ${d.label || 'untitled'}` : 'Add a dental record'}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => onSave(d)}>
            {d.id ? 'Save changes' : 'Store this record'}
          </Button>
        </>
      }
    >
      <div className="gl-stack">
        <div className="gl-form-row">
          <Field label="Record type">
            <Select value={d.kind} onChange={(v) => set('kind', v as RecKind)} options={KINDS.map((k) => ({ value: k.value, label: k.label }))} />
          </Field>
          <DateInput label="Date" value={d.on} onChange={(v) => set('on', v)} />
          <Field label="Clinic / dentist" hint="Their actual name. This app has no clinic directory to suggest one.">
            <TextInput value={d.dentist} onChange={(v) => set('dentist', v)} placeholder="Whom you saw" />
          </Field>
          <Field label={`Cost you paid (${currency})`} hint="Blank is honest. It is then excluded from every total rather than guessed.">
            <TextInput type="number" value={d.cost} onChange={(v) => set('cost', v)} />
          </Field>
        </div>

        {['USD', 'EUR', 'GBP', 'NGN', 'GHS', 'KES', 'ZAR', 'CAD', 'AUD', 'INR', 'JPY'].indexOf(currency) === -1 ? (
          <Field label="Currency used app-wide">
            <Select value={currency} onChange={onCurrency} options={['USD', 'EUR', 'GBP', 'NGN', 'GHS', 'KES', 'ZAR', 'CAD', 'AUD', 'INR', 'JPY'].map((c) => ({ value: c, label: c }))} />
          </Field>
        ) : null}

        <Field label="What happened" hint="One line. It is the heading the rest of this page will show.">
          <TextInput value={d.label} onChange={(v) => set('label', v)} placeholder="Hygienist clean + two small fillings, upper right" />
        </Field>

        <Field label="Notes from the appointment">
          <TextArea value={d.detail} onChange={(v) => set('detail', v)} rows={4} placeholder="What they said, what they did, what to watch" />
        </Field>

        {providerNames.length ? (
          <div className="gl-tech">Your directory has: {providerNames.slice(0, 6).join(' · ')}{providerNames.length > 6 ? ` and ${providerNames.length - 6} more` : ''}</div>
        ) : null}

        {professionalKind ? (
          <Card variant="flush">
            <CardHead
              title="Where did this come from?"
              eyebrow="attribution is mandatory on whitening and alignment rows"
              sub="This app does not author treatment plans. If it is not from a professional, it has to be labelled as yours."
            />
            <Field label="Source of this plan">
              <Select value={d.attributedTo} onChange={(v) => set('attributedTo', v)} options={ATTRIBUTIONS} />
            </Field>
            {notFromClinic ? (
              <SafetyBanner tone="warn" title="Recorded as your own intention, not advice">
                <p className="gl-small">
                  It will be stored and displayed as something you decided or read — with that label visible in the ledger. Glow Lab will
                  not add steps, timings, wear schedules or concentrations to it, and will not tell you it is safe. Aligner and
                  whitening schedules change what happens to your teeth; a dentist or orthodontist sets them.
                </p>
              </SafetyBanner>
            ) : null}
          </Card>
        ) : null}

        <Card variant="flush">
          <CardHead title="Aftercare & follow-up" eyebrow="the clinic's words, copied by you" />
          <Field label="Aftercare you were given" hint="Write what they actually said. If nothing was given, write “none given”.">
            <TextArea value={d.aftercare} onChange={(v) => set('aftercare', v)} rows={3} placeholder="No hot drinks for 24h, soft food either side, come back if it bites when you bite" />
          </Field>
          <div className="gl-form-row">
            <Field label="Follow-up needed?">
              <button type="button" className="gl-btn gl-btn--sm" aria-pressed={d.followUpNeeded} onClick={() => set('followUpNeeded', !d.followUpNeeded)}>
                {d.followUpNeeded ? 'Yes — flagged' : 'No'}
              </button>
            </Field>
            <DateInput label="Follow-up date" value={d.followUpOn} onChange={(v) => set('followUpOn', v)} />
            <Field label="Why the flag exists">
              <TextInput value={d.followUpNote} onChange={(v) => set('followUpNote', v)} placeholder="They wanted to re-check the margin in 3 months" />
            </Field>
          </div>
          <DateInput label="Next visit date they gave you" value={d.nextVisitOn} onChange={(v) => set('nextVisitOn', v)} />
        </Card>

        <div className="gl-row gl-row--between" style={{ alignItems: 'flex-end' }}>
          <div>
            <div className="gl-field__label" style={{ marginBottom: 6 }}>Photographs you attach</div>
            <PhotoPicker
              kind="upload"
              album="Dental"
              label={d.mediaIds.length ? 'Add another' : 'Attach a photo'}
              onPick={(rows) => setD({ ...d, mediaIds: [...d.mediaIds, ...rows.map((r) => r.id)] })}
            />
            <div className="gl-tech" style={{ marginTop: 6 }}>
              Photos stay local. Nothing here reads them: no shade analysis, no lesion detection, no diagnosis from an image.
            </div>
          </div>
          <div className="dt-thumbs">
            {d.mediaIds.map((id) => {
              const m = mediaById.get(id);
              if (!m)
                return (
                  <span key={id} className="gl-tech">
                    <Chip tone="danger">missing media {id.slice(0, 6)}</Chip>
                  </span>
                );
              return (
                <div key={id} style={{ width: 120 }}>
                  <ImageTile item={m} caption="attached" />
                  <button type="button" className="gl-btn gl-btn--sm gl-btn--ghost" onClick={() => setD({ ...d, mediaIds: d.mediaIds.filter((x) => x !== id) })}>
                    Detach
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        {RED_WORDS.test(`${d.label} ${d.detail} ${d.aftercare} ${d.followUpNote}`) ? (
          <SafetyBanner tone="danger" title="This entry mentions filing or reshaping">
            <p className="gl-small">
              Saving it is fine — it is your record. But this app will not add instructions to it and will not tell you a shape change is
              safe or reversible. Removed enamel does not regrow. The refusal panel on the main page has the evidence-library entry, and
              the honest answer is a dentist with a mirror.
            </p>
          </SafetyBanner>
        ) : null}
      </div>
    </Modal>
  );
}
