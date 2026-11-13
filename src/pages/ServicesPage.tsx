/**
 * THE GLOW LAB — Professional Services & Consultation Planner (spec Part 27).
 *
 * A filing cabinet for the advice you were given, not a source of advice. Every
 * credential, fee, quote and aftercare line is something the user watched being
 * written or read from a document. This department has no clinic, no price
 * list, no professional register and no way to verify anybody, so it never
 * claims to. It will not call a procedure necessary, it will not comment on a
 * photograph, and it will not help with anything injected, heated or cut at
 * home — the refusal panel quotes the unsafe-technique rows the evidence
 * library already holds instead of writing new claims.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Ban,
  BookOpenCheck,
  CalendarClock,
  ClipboardList,
  HeartPulse,
  ListChecks,
  Pencil,
  Plus,
  ReceiptText,
  Search,
  ShieldAlert,
  Stethoscope,
  Trash2
} from 'lucide-react';
import { saveRow, useRow, useRows } from '../hooks/live';
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
  EmptyState,
  EvidenceChip,
  Field,
  IconButton,
  Meter,
  Modal,
  SafetyBanner,
  Select,
  Table,
  TagInput,
  TextArea,
  TextInput,
  Toggle,
  fmtMoney,
  useToast
} from '../ui/primitives';
import { useUndoDelete } from '../ui/undo';
import { DeptIntro, EmptyPlate, IndexList, IndexRow, KvList, PullQuote, StatStrip, Timeline } from '../ui/editorial';
import { ImageTile, PhotoPicker } from '../ui/media';
import '../styles/departments/services.css';

/* ------------------------------------------------------------------ taxonomy */

const DISCIPLINES = [
  'Dermatology (medical)',
  'Dermatology (cosmetic)',
  'Plastic surgery',
  'Dental',
  'Hair restoration / trichology',
  'Aesthetic medicine',
  'Physiotherapy',
  'Dietetics / nutrition',
  'Psychology / body image',
  'Not on this list — typed by me'
];

const DECISIONS: { value: string; label: string; meaning: string }[] = [
  { value: 'considering', label: 'Still considering', meaning: 'nothing booked, nothing decided' },
  { value: 'scheduled', label: 'Booked', meaning: 'an appointment exists' },
  { value: 'second-opinion-sought', label: 'Second opinion sought', meaning: 'the same concern, another professional' },
  { value: 'done', label: 'Had it', meaning: 'the procedure took place' },
  { value: 'declined', label: 'Declined', meaning: 'you said no, and that is a decision worth keeping' }
];

const PERMANENCE = ['Reversible', 'Partly reversible', 'Permanent', 'Not told — must ask'];
const CONCERNS = ['Skin texture / sun damage', 'Pigmentation', 'Acne or scarring', 'Hair loss', 'Facial shape', 'Nose', 'Body contour', 'Teeth and smile', 'Posture or pain', 'Something else'];
const RECOVERY_FLAGS = ['Swelling', 'Bruising', 'Pain', 'Redness', 'Numbness', 'Fever or chills', 'Discharge', 'Nothing notable'];
const HOME_WORDS = /\b(inject|injection|botox myself|filler kit|syringe|steroid cycle|self-administer|at-home laser|melanotan|diphenylcyclopropenone|snip|scalpel|numbing cream then|thread lift kit|dermal punch|subcutaneous)\b/i;

function decisionLabel(value: unknown): string {
  return DECISIONS.find((d) => d.value === value)?.label ?? String(value ?? 'unset');
}

function daysBetween(from: string | null | undefined, to: string): number | null {
  if (!from) return null;
  const [y, m, d] = String(from).split('-').map(Number);
  const [y2, m2, d2] = to.split('-').map(Number);
  if (!y || !y2) return null;
  return Math.round((new Date(y2, m2 - 1, d2).getTime() - new Date(y, m - 1, d).getTime()) / 86400000);
}

function amount(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/* ---------------------------------------------------------------- form shape */

interface ProviderDraft {
  id?: string;
  discipline: string;
  name: string;
  credentials: string;
  verified: string;
  location: string;
  contact: string;
  website: string;
  consultFee: string;
  priceNotes: string;
  lastVisitOn: string;
  note: string;
}

function providerDraftFrom(row?: AnyRow, seed?: Partial<ProviderDraft>): ProviderDraft {
  return {
    id: row?.id,
    discipline: row?.discipline ?? DISCIPLINES[0],
    name: row?.name ?? '',
    credentials: row?.credentials ?? '',
    verified: String(row?.data?.verified ?? ''),
    location: row?.location ?? '',
    contact: row?.contact ?? '',
    website: row?.website ?? '',
    consultFee: amount(row?.data?.consultFee) === null ? '' : String(amount(row?.data?.consultFee)),
    priceNotes: row?.priceNotes ?? '',
    lastVisitOn: row?.lastVisitOn ?? '',
    note: String(row?.data?.providerNote ?? ''),
    ...seed
  };
}

function providerPayload(d: ProviderDraft, currency: string): Record<string, unknown> {
  return {
    id: d.id,
    discipline: d.discipline,
    name: d.name.trim(),
    credentials: d.credentials.trim(),
    verified: 'self-recorded',
    location: d.location.trim(),
    contact: d.contact.trim(),
    website: d.website.trim(),
    rating: 0,
    priceNotes: d.priceNotes.trim(),
    lastVisitOn: d.lastVisitOn,
    tags: ['provider', d.discipline],
    data: {
      consultFee: amount(d.consultFee),
      currency,
      verifiedNote: d.verified.trim(),
      providerNote: d.note.trim()
    }
  };
}

interface ConsultDraft {
  id?: string;
  providerId: string;
  procedureTitle: string;
  concern: string;
  on: string;
  purpose: string;
  advised: string;
  quote: string;
  permanence: string;
  recovery: string;
  risks: string;
  limitations: string;
  alternatives: string;
  questions: { label: string; asked: boolean; answer: string }[];
  followUpOn: string;
  decision: string;
  note: string;
  mediaIds: string[];
}

function consultDraftFrom(row?: AnyRow, seed?: Partial<ConsultDraft>): ConsultDraft {
  return {
    id: row?.id,
    providerId: row?.providerId ?? '',
    procedureTitle: row?.procedureTitle ?? '',
    concern: String(row?.data?.concern ?? CONCERNS[0]),
    on: row?.on ?? todayISO(),
    purpose: row?.purpose ?? '',
    advised: String(row?.data?.advised ?? ''),
    quote: amount(row?.quote) === null ? '' : String(amount(row?.quote)),
    permanence: String(row?.data?.permanence ?? PERMANENCE[3]),
    recovery: row?.recovery ?? '',
    risks: row?.risks ?? '',
    limitations: row?.limitations ?? '',
    alternatives: row?.alternatives ?? '',
    questions: ((row?.questions as { label: string; asked: boolean; answer: string }[]) ?? []).map((q) => ({ ...q })),
    followUpOn: row?.followUpOn ?? '',
    decision: String(row?.decision ?? 'considering'),
    note: String(row?.data?.consultNote ?? ''),
    mediaIds: (row?.data?.mediaIds as string[]) ?? [],
    ...seed
  };
}

function consultPayload(d: ConsultDraft, currency: string): Record<string, unknown> {
  return {
    id: d.id,
    providerId: d.providerId || null,
    procedureTitle: d.procedureTitle.trim(),
    on: d.on,
    purpose: d.purpose.trim(),
    evidence: '',
    limitations: d.limitations.trim(),
    risks: d.risks.trim(),
    reversibility: d.permanence,
    recovery: d.recovery.trim(),
    quote: amount(d.quote),
    currency,
    questions: d.questions.map((q, i) => ({ id: `q${i}`, label: q.label, asked: q.asked, answer: q.answer })),
    alternatives: d.alternatives.trim(),
    followUpOn: d.followUpOn || null,
    decision: d.decision,
    beforeMediaIds: [],
    afterMediaIds: [],
    tags: ['consultation', d.concern],
    data: {
      concern: d.concern,
      advised: d.advised.trim(),
      permanence: d.permanence,
      consultNote: d.note.trim(),
      mediaIds: d.mediaIds
    }
  };
}

interface ChecklistItem {
  id: string;
  label: string;
  done: boolean;
}

interface PlanDraft {
  title: string;
  providerId: string;
  date: string;
  time: string;
  minutes: string;
  permanence: string;
  pre: string;
  post: string;
  note: string;
  gateAck: boolean;
}

const EMPTY_PLAN: PlanDraft = {
  title: '',
  providerId: '',
  date: addDays(todayISO(), 14),
  time: '09:00',
  minutes: '60',
  permanence: PERMANENCE[3],
  pre: '',
  post: '',
  note: '',
  gateAck: false
};

interface RecoveryDraft {
  subjectId: string;
  on: string;
  dayOf: string;
  severity: number;
  flags: string[];
  cleared: string;
  note: string;
}

const EMPTY_RECOVERY: RecoveryDraft = {
  subjectId: '',
  on: todayISO(),
  dayOf: '1',
  severity: 2,
  flags: [],
  cleared: '',
  note: ''
};

/* --------------------------------------------------------------------- page */

export default function ServicesPage() {
  const providers = useRows(TABLES.providers);
  const consultations = useRows(TABLES.consultations);
  const events = useRows(TABLES.calendarEvents, { where: { linkDomain: 'services' } });
  const recovery = useRows(TABLES.observations, { where: { subjectType: 'procedure' } });
  const mediaRows = useRows(TABLES.mediaItems);
  const techniques = useRows(TABLES.techniques);
  const toast = useToast();
  const remove = useUndoDelete();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const [currency, setCurrency] = useState('USD');
  const [q, setQ] = useState('');
  const [providerEdit, setProviderEdit] = useState<ProviderDraft | null>(null);
  const [consultEdit, setConsultEdit] = useState<ConsultDraft | null>(null);
  const [plan, setPlan] = useState<PlanDraft | null>(null);
  const [recDraft, setRecDraft] = useState<RecoveryDraft>(EMPTY_RECOVERY);
  const [confirmDel, setConfirmDel] = useState<{ table: TableName; id: string; label: string } | null>(null);

  const deepConsult = params.get('consultation') ?? '';
  const deepProvider = params.get('provider') ?? '';
  const deepConsultRow = useRow(TABLES.consultations, deepConsult || undefined);
  const deepProviderRow = useRow(TABLES.providers, deepProvider || undefined);

  useEffect(() => {
    let live = true;
    void loadSettings().then((s: AppSettings) => live && setCurrency(s.currency));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!deepConsultRow && !deepProviderRow) return;
    if (deepConsultRow) setConsultEdit(consultDraftFrom(deepConsultRow));
    if (deepProviderRow) setProviderEdit(providerDraftFrom(deepProviderRow));
    setParams({});
  }, [deepConsultRow, deepProviderRow, setParams]);

  const providerById = useMemo(() => new Map(providers.map((p) => [p.id, p])), [providers]);
  const mediaById = useMemo(() => new Map(mediaRows.map((m) => [m.id, m])), [mediaRows]);
  const techOf = (slug: string) => techniques.find((t) => t.slug === slug);
  const unsafeTech = useMemo(() => techniques.filter((t) => t.safety === 'unsafe'), [techniques]);
  const proOnlyTech = useMemo(
    () => techniques.filter((t) => ['fillers', 'botulinum-toxin', 'rhinoplasty', 'jaw-chin-implants', 'hair-transplant', 'in-clinic-peel', 'laser-hair-removal'].includes(String(t.slug))),
    [techniques]
  );

  /* ---- directory, filtered over the user's own rows ---- */
  const directory = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return providers
      .filter((p) => (!needle ? true : [p.name, p.discipline, p.credentials, p.location, p.priceNotes, p.data?.providerNote].join(' ').toLowerCase().includes(needle)))
      .sort((a, b) => String(a.discipline).localeCompare(String(b.discipline)) || String(a.name).localeCompare(String(b.name)));
  }, [providers, q]);

  const book = useMemo(
    () =>
      consultations
        .filter((c) => !q.trim() ? true : [c.procedureTitle, c.purpose, c.data?.advised, c.limitations, c.risks, providerById.get(String(c.providerId))?.name].join(' ').toLowerCase().includes(q.trim().toLowerCase()))
        .sort((a, b) => String(b.on).localeCompare(String(a.on))),
    [consultations, q, providerById]
  );

  /** Consults you actually sat through for a given procedure — the gate counter. */
  const consultCountFor = (title: string) =>
    consultations.filter((c) => String(c.procedureTitle).trim().toLowerCase() === title.trim().toLowerCase() && c.decision !== 'declined').length;

  const plannedTitles = useMemo(() => {
    const set = new Set<string>();
    for (const c of consultations) {
      if (c.decision === 'scheduled' || c.decision === 'done') set.add(String(c.procedureTitle).trim().toLowerCase());
    }
    return set;
  }, [consultations]);

  const unmetGate = useMemo(
    () =>
      [...plannedTitles]
        .map((t) => ({ title: t, count: consultCountFor(t) }))
        .filter((x) => x.count < 2),
    [consultations, plannedTitles]
  );

  const spend = useMemo(() => {
    const quotes: { label: string; value: number }[] = [];
    let total = 0;
    let priced = 0;
    for (const c of consultations) {
      const qv = amount(c.quote);
      if (qv === null) continue;
      priced += 1;
      total += qv;
      quotes.push({ label: `${c.procedureTitle} — ${decisionLabel(c.decision)}`, value: qv });
    }
    const fees = providers.reduce((sum, p) => sum + (amount(p.data?.consultFee) ?? 0), 0);
    const feeCount = providers.filter((p) => amount(p.data?.consultFee) !== null).length;
    return { total, priced, unpriced: consultations.length - priced, quotes: quotes.sort((a, b) => b.value - a.value), fees, feeCount };
  }, [consultations, providers]);

  const upcoming = useMemo(() => events.filter((e) => !e.doneOn && Number(e.startAt) >= Date.now() - 86400000).sort((a, b) => Number(a.startAt) - Number(b.startAt)), [events]);
  const pastEvents = useMemo(() => events.filter((e) => Number(e.startAt) < Date.now() - 86400000).sort((a, b) => Number(b.startAt) - Number(a.startAt)), [events]);

  const followUps = useMemo(
    () =>
      consultations
        .filter((c) => c.followUpOn)
        .map((c) => ({ row: c, inDays: daysBetween(todayISO(), String(c.followUpOn)) }))
        .sort((a, b) => (a.inDays ?? 99999) - (b.inDays ?? 99999)),
    [consultations]
  );

  const recoveryLog = useMemo(() => [...recovery].sort((a, b) => String(b.on).localeCompare(String(a.on))), [recovery]);
  const homeFlagged = useMemo(
    () => consultations.filter((c) => HOME_WORDS.test([c.purpose, c.data?.advised, c.alternatives, c.data?.consultNote].join(' '))),
    [consultations]
  );

  /* ------------------------------------------------------------------ writes */

  async function saveProvider(d: ProviderDraft) {
    if (!d.name.trim()) {
      toast('A directory row with no name is not searchable later.', 'bad');
      return;
    }
    await saveRow(TABLES.providers, providerPayload(d, currency));
    setProviderEdit(null);
    toast('Provider stored. Credentials are exactly what you wrote down — this app checks nothing.', 'ok');
  }

  async function saveConsult(d: ConsultDraft) {
    if (!d.procedureTitle.trim()) {
      toast('Name what the consultation was about, in your words.', 'bad');
      return;
    }
    const payload = consultPayload(d, currency);
    const saved = await saveRow(TABLES.consultations, payload);
    setConsultEdit(null);
    const count = consultCountFor(d.procedureTitle) + (d.id ? 0 : 1);
    if (d.decision === 'scheduled' && count < 2) {
      toast('Booked with one consult on file. The two-consult rule is still open on this procedure.', 'info');
    } else {
      toast(d.id ? 'Consultation updated.' : `Consultation stored — ${count} on record for “${d.procedureTitle}”.`, 'ok');
    }
    return saved;
  }

  async function setDecision(row: AnyRow, value: string) {
    await saveRow(TABLES.consultations, { id: row.id, decision: value });
    const count = consultCountFor(String(row.procedureTitle));
    if (value === 'scheduled' && count < 2) {
      toast('Marked booked. Glow Lab will keep showing the two-consult prompt for this procedure.', 'info');
    } else {
      toast(`Decision set to “${decisionLabel(value)}”. Your call, stored, never scored.`, 'ok');
    }
  }

  async function toggleQuestion(row: AnyRow, index: number) {
    const next = ((row.questions as { label: string; asked: boolean; answer: string }[]) ?? []).map((qItem, i) => (i === index ? { ...qItem, asked: !qItem.asked } : qItem));
    await saveRow(TABLES.consultations, { id: row.id, questions: next });
  }

  async function saveQuestionAnswer(row: AnyRow, index: number, answer: string) {
    const next = ((row.questions as { label: string; asked: boolean; answer: string }[]) ?? []).map((qItem, i) => (i === index ? { ...qItem, answer, asked: true } : qItem));
    await saveRow(TABLES.consultations, { id: row.id, questions: next });
    toast('Their answer stored against your question — transcribed by you, not summarised by us.', 'ok');
  }

  async function writePlan(p: PlanDraft) {
    if (!p.title.trim()) {
      toast('Give the plan a title you will recognise in the calendar.', 'bad');
      return;
    }
    if (p.permanence === 'Permanent' && consultCountFor(p.title) < 2 && !p.gateAck) {
      toast('Two consultations before anything permanent. Tick the acknowledgement or book the second opinion.', 'bad');
      return;
    }
    const [y, m, d] = p.date.split('-').map(Number);
    const [hh, mm] = (p.time || '09:00').split(':').map((x) => Number(x) || 0);
    const start = new Date(y, m - 1, d, hh, mm).getTime();
    const pre = p.pre.split('\n').map((x) => x.trim()).filter(Boolean);
    const post = p.post.split('\n').map((x) => x.trim()).filter(Boolean);
    const saved = await saveRow(TABLES.calendarEvents, {
      title: p.title.trim(),
      kind: 'procedure-plan',
      startAt: start,
      endAt: p.minutes ? start + (Number(p.minutes) || 0) * 60000 : null,
      recurrence: undefined,
      reminders: [],
      checklist: [
        ...pre.map((label) => ({ id: newId('chk'), label, done: false })),
        ...post.map((label) => ({ id: newId('chk'), label: `Aftercare: ${label}`, done: false }))
      ],
      linkDomain: 'services',
      linkId: p.providerId || '',
      cost: null,
      doneOn: null,
      note: `${p.note.trim()}\nPermanence as you recorded it: ${p.permanence}. Consultations on file for this title: ${consultCountFor(p.title)}. Provider as written: ${
        providerById.get(p.providerId)?.name ?? 'none selected'
      }.`,
      tags: ['services', 'procedure-plan'],
      data: { origin: 'services-plan', permanence: p.permanence, preCount: pre.length, postCount: post.length }
    });
    setPlan(null);
    toast(`Plan written to calendarEvents with ${pre.length + post.length} checklist item(s). It lives in /calendar now.`, 'ok');
    return saved;
  }

  async function toggleCheck(ev: AnyRow, checkId: string) {
    const next = ((ev.checklist as ChecklistItem[]) ?? []).map((c) => (c.id === checkId ? { ...c, done: !c.done } : c));
    await saveRow(TABLES.calendarEvents, { id: ev.id, checklist: next });
  }

  async function toggleEventDone(ev: AnyRow) {
    await saveRow(TABLES.calendarEvents, { id: ev.id, doneOn: ev.doneOn ? null : todayISO() });
  }

  async function logQuoteAsExpense(row: AnyRow) {
    const value = amount(row.quote);
    if (value === null) {
      toast('There is no quote on this row to turn into an expense — the app will not invent the figure.', 'bad');
      return;
    }
    const who = providerById.get(String(row.providerId))?.name ?? 'provider not linked';
    await saveRow(TABLES.purchases, {
      productId: null,
      label: `${String(row.procedureTitle)} — quoted at consultation ${formatDate(String(row.on))}`,
      amount: value,
      currency,
      boughtOn: todayISO(),
      retailer: String(who),
      orderRef: String(row.id),
      reason: 'Quote written at a consultation and logged as paid by you.',
      wouldBuyAgain: null,
      tags: ['services', 'procedure-cost'],
      data: { origin: 'services-quote', consultationId: row.id }
    });
    await saveRow(TABLES.consultations, { id: row.id, expenseLogged: true });
    toast(`${fmtMoney(value, currency)} written to the purchase ledger. It is your record of paying, not a price list.`, 'ok');
  }

  async function followUpToEvent(row: AnyRow) {
    const on = String(row.followUpOn ?? addDays(todayISO(), 14));
    const [y, m, d] = on.split('-').map(Number);
    const start = new Date(y, m - 1, d, 9, 30).getTime();
    await saveRow(TABLES.calendarEvents, {
      title: `Follow-up: ${row.procedureTitle}`,
      kind: 'review',
      startAt: start,
      endAt: start + 20 * 60000,
      recurrence: undefined,
      reminders: [],
      checklist: [
        { id: newId('chk'), label: 'Write down what changed since the appointment before I forget it', done: false },
        { id: newId('chk'), label: 'Anything I was told to watch for that I have not checked?', done: false }
      ],
      linkDomain: 'services',
      linkId: String(row.id),
      cost: null,
      doneOn: null,
      note: `Follow-up flagged on the consultation row for ${row.procedureTitle} (dated ${formatDate(String(row.on))}). What they advised, as you recorded it: ${String(row.data?.advised ?? 'nothing written')}`,
      tags: ['services', 'follow-up'],
      data: { origin: 'services-followup', consultationId: row.id }
    });
    toast('Follow-up is a real calendar row now.', 'ok');
  }

  async function logRecovery() {
    if (!recDraft.note.trim() && !recDraft.flags.length) {
      toast('One line, or one ticked symptom. Otherwise there is nothing to look back on.', 'bad');
      return;
    }
    await saveRow(TABLES.observations, {
      subjectType: 'procedure',
      subjectId: recDraft.subjectId,
      on: recDraft.on,
      note: recDraft.note.trim() || recDraft.flags.join(', '),
      reaction: recDraft.flags.some((f) => ['Fever or chills', 'Discharge', 'Numbness'].includes(f)) ? 'irritation' : recDraft.severity >= 6 ? 'bad' : 'none',
      severity: recDraft.severity,
      mediaIds: [],
      tags: ['recovery', `day-${recDraft.dayOf}`],
      data: {
        origin: 'services-recovery',
        dayOf: amount(recDraft.dayOf),
        flags: recDraft.flags,
        cleared: recDraft.cleared.trim()
      }
    });
    setRecDraft({ ...EMPTY_RECOVERY, subjectId: recDraft.subjectId, on: addDays(recDraft.on, 1), dayOf: String((Number(recDraft.dayOf) || 0) + 1) });
    toast('Recovery entry stored. This is a diary, not triage — the thresholds are the ones you were given in writing.', 'ok');
  }

  async function runDelete() {
    if (!confirmDel) return;
    await remove(confirmDel.table, confirmDel.id, confirmDel.label);
    setConfirmDel(null);
  }

  /* -------------------------------------------------------------------- view */

  const injectionTech = techOf('diy-injections');
  const steroidTech = techOf('unsupervised-steroids');

  return (
    <div className="gl-page sv-page">
      <DeptIntro
        id="services"
        deck="A filing cabinet for professional advice, with the advice kept out of it. This app employs nobody, lists no clinic, quotes no price and verifies no credential — it stores what you were told, by whom, what it cost and what you decided."
        actions={
          <>
            <Button variant="primary" onClick={() => setConsultEdit(consultDraftFrom())}>
              <Plus size={14} /> Log a consultation
            </Button>
            <Button onClick={() => setProviderEdit(providerDraftFrom())}>
              <Stethoscope size={14} /> Add a provider
            </Button>
            <Button onClick={() => setPlan({ ...EMPTY_PLAN })}>
              <ClipboardList size={14} /> Plan a procedure
            </Button>
          </>
        }
        meta={[
          { label: 'Providers on file', value: String(providers.length) },
          { label: 'Consultations logged', value: String(consultations.length) },
          { label: 'Quotes you recorded', value: `${spend.priced} of ${consultations.length}` }
        ]}
      />

      <StatStrip
        items={[
          { label: 'Consultations', value: String(consultations.length), hint: 'each one dated and attributed' },
          { label: 'Awaiting a second opinion', value: String(unmetGate.length), hint: 'booked or done on one consult only' },
          { label: 'Quoted to you', value: fmtMoney(spend.total, currency), hint: `sum of ${spend.priced} quote(s) you wrote down` },
          { label: 'Consultation fees', value: fmtMoney(spend.fees, currency), hint: `${spend.feeCount} provider(s) with a fee you recorded` },
          { label: 'Recovery entries', value: String(recovery.length), hint: 'your diary, not clinical monitoring' }
        ]}
      />

      {unmetGate.length ? (
        <SafetyBanner tone="danger" title="The two-consultation rule is open on these">
          <p className="gl-small">
            You asked for this gate, so the app enforces the prompt and nothing else: it cannot tell you whether one opinion was enough,
            only how many you filed. These procedures are marked booked or done with a single consultation recorded.
          </p>
          <div className="sv-gate">
            {unmetGate.map((g) => (
              <div key={g.title} className="sv-gate__row">
                <span className="gl-serif">{g.title}</span>
                <span className="gl-tech">{g.count} of 2 consultations on file</span>
                <Button size="sm" onClick={() => setConsultEdit(consultDraftFrom(undefined, { procedureTitle: g.title.charAt(0).toUpperCase() + g.title.slice(1), decision: 'second-opinion-sought' }))}>
                  <Plus size={12} /> Log the second opinion
                </Button>
              </div>
            ))}
          </div>
        </SafetyBanner>
      ) : null}

      <div className="gl-editorial gl-editorial--wide-left">
        {/* ------------------------------------------------------ 01 directory */}
        <div className="gl-stack">
          <section className="gl-section" style={{ marginBottom: 0 }}>
            <div className="gl-section__title">
              <div>
                <div className="gl-eyebrow">Section 01 · the directory</div>
                <h2>People you have actually seen or spoken to</h2>
              </div>
              <Button size="sm" variant="primary" onClick={() => setProviderEdit(providerDraftFrom())}>
                <Plus size={13} /> New provider
              </Button>
            </div>

            <label className="sv-search gl-field" style={{ marginBottom: 'var(--glow-sp-4)' }}>
              <span className="gl-field__label">
                <Search size={12} /> Search the directory
              </span>
              <TextInput value={q} onChange={setQ} placeholder="dermatologist, clinic street, a credential you wrote down…" />
            </label>

            {providers.length === 0 ? (
              <EmptyPlate
                kicker="Empty on purpose"
                title="No providers — because no one has been typed in"
                body="Glow Lab has no professional register, no clinic list and no way to check that anyone exists, so it cannot suggest a name. Add the people you have sat across from: discipline, the credentials as you recorded them, where they are, what the consultation cost."
                action={
                  <Button variant="primary" onClick={() => setProviderEdit(providerDraftFrom())}>
                    <Plus size={14} /> Add the first provider
                  </Button>
                }
              />
            ) : directory.length === 0 ? (
              <Card>
                <CardHead title="Nothing matches the search" sub={`${providers.length} provider(s) exist; the filter is what is empty.`} />
                <Button size="sm" onClick={() => setQ('')}>
                  Clear search
                </Button>
              </Card>
            ) : (
              directory.map((p) => {
                const theirs = consultations.filter((c) => c.providerId === p.id);
                return (
                  <Card key={p.id}>
                    <CardHead
                      title={p.name}
                      eyebrow={`${p.discipline}${p.location ? ` · ${p.location}` : ''}`}
                      sub={theirs.length ? `${theirs.length} consultation(s) logged with them` : 'no consultations filed yet'}
                      right={
                        <>
                          <Chip tone="danger" title="This app cannot check a register, a licence or a review.">
                            self-recorded
                          </Chip>
                          <IconButton label={`Edit ${p.name}`} onClick={() => setProviderEdit(providerDraftFrom(p))}>
                            <Pencil size={14} />
                          </IconButton>
                          <IconButton label={`Delete ${p.name}`} onClick={() => setConfirmDel({ table: TABLES.providers, id: p.id, label: String(p.name) })}>
                            <Trash2 size={14} />
                          </IconButton>
                        </>
                      }
                    />
                    <div className="sv-provider">
                      <div>
                        <div className="gl-label">Credentials as you wrote them</div>
                        <p className="gl-small" style={{ margin: 0 }}>
                          {String(p.credentials ?? '').trim() || <span className="gl-faint">nothing recorded — leave it blank rather than guessing a title</span>}
                        </p>
                        {p.data?.verifiedNote ? <div className="gl-tech">Your own verification note: {String(p.data.verifiedNote)}</div> : null}
                      </div>
                      <div>
                        <div className="gl-label">Consultation fee you were quoted</div>
                        <div className="sv-num">
                          {amount(p.data?.consultFee) === null ? <span className="gl-faint">not told / not recorded</span> : fmtMoney(amount(p.data?.consultFee), currency)}
                        </div>
                        {p.priceNotes ? <div className="gl-small">{String(p.priceNotes)}</div> : null}
                      </div>
                      <div>
                        <div className="gl-label">Contact</div>
                        <div className="gl-small">
                          {String(p.contact ?? '').trim() || <span className="gl-faint">blank</span>}
                          {p.website ? <span className="gl-tech"> · {String(p.website)}</span> : null}
                        </div>
                        {p.lastVisitOn ? <div className="gl-tech">last seen {formatDate(String(p.lastVisitOn))}</div> : <div className="gl-tech">never marked as seen</div>}
                      </div>
                    </div>
                    {p.data?.providerNote ? <p className="gl-small gl-muted">{String(p.data.providerNote)}</p> : null}
                    <div className="gl-row gl-row--tight">
                      <Button size="sm" onClick={() => setConsultEdit(consultDraftFrom(undefined, { providerId: p.id }))}>
                        <Plus size={12} /> Consultation with them
                      </Button>
                      {String(p.discipline).includes('Dental') ? (
                        <Button size="sm" variant="ghost" onClick={() => navigate('/dental')} title="Dental appointments and their costs are kept in their own department">
                          Teeth rows live in /dental
                        </Button>
                      ) : null}
                    </div>
                  </Card>
                );
              })
            )}
          </section>

          {/* -------------------------------------------------- 02 consultations */}
          <section className="gl-section" style={{ marginBottom: 0 }}>
            <div className="gl-section__title">
              <div>
                <div className="gl-eyebrow">Section 02 · what they said</div>
                <h2>Consultations, quotes and your decisions</h2>
              </div>
              <Button size="sm" onClick={() => setConsultEdit(consultDraftFrom())}>
                <Plus size={13} /> Log one
              </Button>
            </div>

            {consultations.length === 0 ? (
              <Card>
                <CardHead title="No consultation on file" sub="The first row is the hardest: it is the one where you write down what you were actually told, rather than what you remember being told." />
                <Button variant="primary" size="sm" onClick={() => setConsultEdit(consultDraftFrom())}>
                  <Plus size={13} /> Start the record
                </Button>
              </Card>
            ) : (
              <Table
                rows={book}
                keyOf={(r: AnyRow) => r.id}
                columns={[
                  { label: 'Date', width: 108, render: (r: AnyRow) => <span className="gl-tech">{formatDate(String(r.on))}</span> },
                  {
                    label: 'About',
                    render: (r: AnyRow) => (
                      <>
                        <button type="button" className="gl-btn gl-btn--link gl-btn--sm" onClick={() => setConsultEdit(consultDraftFrom(r))}>
                          {r.procedureTitle}
                        </button>
                        <div className="gl-tech">{String(r.data?.concern ?? '')}</div>
                      </>
                    )
                  },
                  { label: 'With', width: 130, render: (r: AnyRow) => <span className="gl-small">{providerById.get(String(r.providerId))?.name ?? <span className="gl-faint">provider not linked</span>}</span> },
                  {
                    label: 'Quote you were given',
                    width: 140,
                    render: (r: AnyRow) => (amount(r.quote) === null ? <span className="gl-faint gl-small">none given</span> : <span className="sv-num">{fmtMoney(amount(r.quote), currency)}</span>)
                  },
                  {
                    label: 'Consults on this title',
                    width: 132,
                    render: (r: AnyRow) => {
                      const n = consultCountFor(String(r.procedureTitle));
                      return (
                        <Chip tone={n >= 2 ? 'gold' : 'danger'} title="Two opinions before anything permanent — your own rule, counted from your rows.">
                          {n} of 2
                        </Chip>
                      );
                    }
                  },
                  {
                    label: 'Decision',
                    width: 190,
                    render: (r: AnyRow) => <Select value={String(r.decision ?? 'considering')} onChange={(v) => void setDecision(r, v)} options={DECISIONS.map((d) => ({ value: d.value, label: d.label }))} />
                  },
                  {
                    label: '',
                    width: 118,
                    render: (r: AnyRow) => (
                      <div className="gl-row gl-row--tight">
                        {amount(r.quote) !== null && !r.expenseLogged ? (
                          <IconButton label={`Log the ${String(r.procedureTitle)} quote as paid`} onClick={() => void logQuoteAsExpense(r)}>
                            <ReceiptText size={14} />
                          </IconButton>
                        ) : null}
                        <IconButton label={`Edit ${r.procedureTitle}`} onClick={() => setConsultEdit(consultDraftFrom(r))}>
                          <Pencil size={14} />
                        </IconButton>
                        <IconButton label={`Delete ${r.procedureTitle}`} onClick={() => setConfirmDel({ table: TABLES.consultations, id: r.id, label: String(r.procedureTitle) })}>
                          <Trash2 size={14} />
                        </IconButton>
                      </div>
                    )
                  }
                ]}
              />
            )}

            {consultations.some((c) => ((c.questions as { label: string }[]) ?? []).length) ? (
              <Card variant="flush" style={{ marginTop: 'var(--glow-sp-4)' }}>
                <CardHead title="Questions you took in, answers you brought home" eyebrow="stored on the consultation row" sub="Tick a question the moment they answer it, then write their answer in their words. Nobody’s advice is paraphrased by this app." />
                <div className="sv-qs">
                  {consultations
                    .filter((c) => ((c.questions as { label: string }[]) ?? []).length)
                    .map((c) => (
                      <div key={c.id} className="sv-qs__block">
                        <div className="gl-eyebrow">
                          {formatDate(String(c.on))} · {c.procedureTitle}
                        </div>
                        {((c.questions as { label: string; asked: boolean; answer: string }[]) ?? []).map((qItem, i) => (
                          <div key={`${c.id}-${i}`} className="sv-q" data-asked={qItem.asked}>
                            <button type="button" className="sv-q__check" aria-pressed={qItem.asked} onClick={() => void toggleQuestion(c, i)} title={qItem.asked ? 'Unmark' : 'Mark as asked'}>
                              {qItem.asked ? '✓' : ''}
                            </button>
                            <div style={{ minWidth: 0 }}>
                              <div className="gl-small">{qItem.label}</div>
                              {qItem.answer ? <div className="gl-tech">Answer: {qItem.answer}</div> : null}
                              <input
                                className="gl-input sv-q__answer"
                                placeholder={qItem.answer ? 'Amend the answer you wrote' : 'Write their answer, in their words'}
                                defaultValue={qItem.answer}
                                onBlur={(e) => e.target.value !== qItem.answer && void saveQuestionAnswer(c, i, e.target.value)}
                              />
                            </div>
                          </div>
                        ))}
                      </div>
                    ))}
                </div>
              </Card>
            ) : null}

            {homeFlagged.length ? (
              <SafetyBanner tone="danger" title={`${homeFlagged.length} record(s) mention doing clinical work at home`}>
                <p className="gl-small">
                  Your rows stay as you wrote them. What Glow Lab will not do is help with it: no protocol, no dose, no source list, no
                  comment on whether a particular product is “safe enough”. Unlicensed injection and self-administered clinical treatment
                  is where people lose tissue, sight and sometimes their lives.
                </p>
                <Button size="sm" onClick={() => setConsultEdit(consultDraftFrom(undefined, { purpose: 'I want to ask a qualified professional about something I was tempted to do myself.', decision: 'considering' }))}>
                  <ShieldAlert size={13} /> Turn it into a consultation instead
                </Button>
              </SafetyBanner>
            ) : null}
          </section>
        </div>

        {/* ------------------------------------------------------------ rail */}
        <div className="gl-stack">
          <Card>
            <CardHead title="Money, as quoted to you" eyebrow="consultation quote column" right={<Chip tone="info">{spend.priced} priced</Chip>} />
            {spend.quotes.length ? (
              <>
                <div className="sv-num sv-num--big">{fmtMoney(spend.total, currency)}</div>
                <div className="gl-tech">across {spend.quotes.length} quote(s) you recorded; {spend.unpriced} consultation(s) carried no number.</div>
                <IndexList>
                  {spend.quotes.slice(0, 6).map((qItem, i) => (
                    <IndexRow key={`${qItem.label}-${i}`} no={i + 1} title={qItem.label} right={<span className="sv-num">{fmtMoney(qItem.value, currency)}</span>} />
                  ))}
                </IndexList>
                <div className="sv-note">
                  These are not prices. They are the numbers particular people said out loud on particular dates, and they will have moved.
                </div>
              </>
            ) : (
              <div className="gl-small gl-muted">Nothing to add up. Quote figures only appear once you record what you were told.</div>
            )}
          </Card>

          <Card>
            <CardHead title="Follow-up schedule" eyebrow="consultation followUpOn column" sub="Anything you were told to come back for. Pushing one into the calendar writes a real event." />
            {followUps.length === 0 ? (
              <div className="gl-small gl-muted">No follow-up dates recorded. Add one on a consultation and it queues here.</div>
            ) : (
              <Timeline
                items={followUps.map(({ row, inDays }) => ({
                  when: `${formatDate(String(row.followUpOn))}${inDays !== null ? ` · ${inDays < 0 ? `${Math.abs(inDays)} day(s) past` : `in ${inDays} day(s)`}` : ''}`,
                  title: String(row.procedureTitle),
                  body: <span className="gl-small">Booked with {providerById.get(String(row.providerId))?.name ?? 'a provider you did not link'}</span>,
                  tone: (inDays !== null && inDays < 0 ? 'accent' : 'plain') as 'accent' | 'plain',
                  right: (
                    <Button size="sm" variant="ghost" onClick={() => void followUpToEvent(row)}>
                      <CalendarClock size={12} /> To calendar
                    </Button>
                  )
                }))}
              />
            )}
          </Card>

          <Card>
            <CardHead title="What is booked" eyebrow="calendarEvents · linkDomain services" right={<Chip tone={upcoming.length ? 'moderate' : 'info'}>{upcoming.length} open</Chip>} />
            {upcoming.length === 0 && pastEvents.length === 0 ? (
              <div className="gl-small gl-muted">
                Nothing scheduled. Planning a procedure from Section 03 writes the appointment plus its pre- and post-care checklist here.
              </div>
            ) : (
              <IndexList>
                {upcoming.map((ev, i) => (
                  <IndexRow
                    key={ev.id}
                    no={i + 1}
                    title={String(ev.title)}
                    sub={`${formatDate(new Date(Number(ev.startAt)).toISOString().slice(0, 10))} · ${((ev.checklist as ChecklistItem[]) ?? []).filter((c) => c.done).length}/${((ev.checklist as ChecklistItem[]) ?? []).length} checklist done`}
                    right={
                      <Chip tone={ev.doneOn ? 'gold' : 'moderate'} onClick={() => void toggleEventDone(ev)}>
                        {ev.doneOn ? 'done' : 'tick'}
                      </Chip>
                    }
                    onClick={() => navigate('/calendar')}
                  />
                ))}
                {pastEvents.slice(0, 3).map((ev) => (
                  <IndexRow key={ev.id} no="·" title={String(ev.title)} sub={`passed ${formatDate(new Date(Number(ev.startAt)).toISOString().slice(0, 10))}`} right={<Chip tone="limited">history</Chip>} onClick={() => navigate('/calendar')} />
                ))}
              </IndexList>
            )}
          </Card>
        </div>
      </div>

      {/* ------------------------------------------------------- 03 planning */}
      <section className="gl-section">
        <div className="gl-section__title">
          <div>
            <div className="gl-eyebrow">Section 03 · procedure planning</div>
            <h2>Pre-care, post-care, and the gate you asked for</h2>
          </div>
          <Button size="sm" variant="gold" onClick={() => setPlan({ ...EMPTY_PLAN })}>
            <ClipboardList size={13} /> New plan
          </Button>
        </div>

        <div className="sv-plans">
          <Card>
            <CardHead title="The rule you set" eyebrow="enforced as a prompt, never as permission" />
            <PullQuote cite="Why the gate exists">
              Anything permanent gets two consultations. Not because the first professional was wrong — because a second set of eyes is the
              only check available to someone who cannot see themselves from the outside.
            </PullQuote>
            <div className="sv-meter">
              <Meter value={Math.min(consultations.filter((c) => c.decision !== 'declined').length, 2)} max={2} label="consultations on file (all procedures)" />
              <div className="gl-tech">
                {unmetGate.length ? `${unmetGate.length} procedure title(s) booked or done on one consultation.` : 'Every booked title has two or more consultations on file.'}
              </div>
            </div>
            <Button size="sm" onClick={() => setConsultEdit(consultDraftFrom(undefined, { decision: 'second-opinion-sought' }))}>
              <Plus size={12} /> File a second opinion
            </Button>
          </Card>

          <Card>
            <CardHead title="What the evidence library holds" eyebrow={`${proOnlyTech.length} professional-only entries`} sub="Seeded reference rows, quoted not paraphrased. They describe categories of clinical treatment — never your case." />
            {proOnlyTech.length === 0 ? (
              <div className="gl-small gl-muted">No technique rows found in your database. Run a reseed from Settings to restore the library.</div>
            ) : (
              <div className="sv-pro">
                {proOnlyTech.map((t) => (
                  <div key={t.id} className="sv-pro__row">
                    <div className="gl-row gl-row--between" style={{ alignItems: 'baseline', gap: 'var(--glow-sp-3)' }}>
                      <span className="gl-serif">{t.title}</span>
                      <EvidenceChip grade={String(t.evidence)} />
                    </div>
                    <div className="gl-tech">Reversibility as recorded: {String(t.reversibility)} · Cost band: {String(t.costBand)}</div>
                    <p className="gl-small" style={{ margin: '4px 0 0' }}>
                      {String(t.evidenceSummary)}
                    </p>
                    <div className="gl-tech">When the library says consult: {String(t.whenToConsult)}</div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setConsultEdit(consultDraftFrom(undefined, { procedureTitle: String(t.title), concern: CONCERNS[0], permanence: PERMANENCE[3] }))}
                    >
                      <BookOpenCheck size={12} /> Open a consultation row for this
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        <Disclosure summary="What a plan writes, and what it deliberately does not">
          <p className="gl-small">
            One calendarEvents row: your date, your time, your provider id, and a checklist built line-by-line from the two text boxes you
            fill in. It does not generate pre-care or aftercare advice, does not know what the procedure is, does not know your medication
            and does not know what your clinic told you. Every checklist line is a thing you were told, typed from a leaflet or a note.
          </p>
        </Disclosure>
      </section>

      {/* ------------------------------------------------------- 04 recovery */}
      <section className="gl-section">
        <div className="gl-section__title">
          <div>
            <div className="gl-eyebrow">Section 04 · recovery log</div>
            <h2>How the days after actually went</h2>
          </div>
          <Chip tone="danger">
            <HeartPulse size={11} /> a diary, not monitoring
          </Chip>
        </div>

        <div className="gl-editorial">
          <Card variant="flush">
            <CardHead title="Log a day" eyebrow="observations · subjectType: procedure" sub="Severity is your number on your scale. The symptom list is only words to file what you noticed under." />
            <div className="sv-form">
              <Field label="Which procedure" hint="Only consultation rows you have already filed.">
                <Select
                  value={recDraft.subjectId}
                  onChange={(v) => setRecDraft({ ...recDraft, subjectId: v })}
                  placeholder="Pick a consultation"
                  options={consultations.map((c) => ({ value: c.id, label: `${c.procedureTitle} — ${formatDate(String(c.on))}` }))}
                />
              </Field>
              <DateInput label="Date" value={recDraft.on} onChange={(v) => setRecDraft({ ...recDraft, on: v })} />
              <Field label="Day number">
                <TextInput type="number" value={recDraft.dayOf} onChange={(v) => setRecDraft({ ...recDraft, dayOf: v })} />
              </Field>
              <Field label={`Severity you would call it: ${recDraft.severity}/10`}>
                <input type="range" min={0} max={10} step={1} value={recDraft.severity} onChange={(e) => setRecDraft({ ...recDraft, severity: Number(e.target.value) })} className="sv-range" />
              </Field>
              <Field label="What is happening">
                <TagInput values={recDraft.flags} onChange={(v) => setRecDraft({ ...recDraft, flags: v })} placeholder="add a word you would use" />
              </Field>
              <Field label="What you were told to watch for" hint="Copy the threshold from your discharge sheet so the number has a meaning.">
                <TextInput value={recDraft.cleared} onChange={(v) => setRecDraft({ ...recDraft, cleared: v })} placeholder="“Above 38.5°C or spreading redness — ring the number on the sheet”" />
              </Field>
            </div>
            <div className="sv-chiprow">
              {RECOVERY_FLAGS.map((f) => (
                <Chip
                  key={f}
                  active={recDraft.flags.includes(f)}
                  onClick={() => setRecDraft({ ...recDraft, flags: recDraft.flags.includes(f) ? recDraft.flags.filter((x) => x !== f) : [...recDraft.flags, f] })}
                >
                  {f}
                </Chip>
              ))}
            </div>
            <Field label="One line about the day">
              <TextArea value={recDraft.note} onChange={(v) => setRecDraft({ ...recDraft, note: v })} rows={2} placeholder="Swelling peaked around day three and read the same both mornings." />
            </Field>
            <div className="gl-row gl-row--tight" style={{ marginTop: 'var(--glow-sp-3)' }}>
              <Button variant="primary" onClick={() => void logRecovery()}>
                <ListChecks size={14} /> Store the entry
              </Button>
              {!consultations.length ? <span className="gl-tech">Log a consultation first — recovery entries attach to one.</span> : null}
            </div>
          </Card>

          <div className="gl-stack">
            <Card>
              <CardHead title="The curve you wrote" eyebrow={`${recovery.length} entr${recovery.length === 1 ? 'y' : 'ies'}`} sub="Only what you logged, in order. No smoothing, no trend line, no interpretation." />
              {recoveryLog.length === 0 ? (
                <EmptyState title="Nothing logged yet" body="A recovery log starts empty. Two days of honest numbers beat a week of remembered ones." />
              ) : (
                <div className="sv-bars">
                  {recoveryLog.slice(0, 14).map((r) => (
                    <div key={r.id} className="sv-bar" title={`${formatDate(String(r.on))} — severity ${r.severity}/10`}>
                      <span className="sv-bar__label gl-tech">d{String(r.data?.dayOf ?? '?')}</span>
                      <span className="sv-bar__track">
                        <span className="sv-bar__fill" style={{ width: `${Math.max(4, (Number(r.severity) / 10) * 100)}%` }} />
                      </span>
                      <span className="sv-bar__value gl-tech">{Number(r.severity)}/10</span>
                      <span className="gl-faint sv-bar__note">{String(r.note).slice(0, 60)}</span>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            <Card>
              <CardHead title="Photographs" eyebrow="mediaItems · yours, unexamined" sub="Attach a healing photo to the log if it helps you show the clinic later. Nothing in this app looks at it." />
              <PhotoPicker kind="progress" album="Recovery" label="Add a healing photograph" onPick={() => toast('Stored in your media library and linked to /media.', 'ok')} />
              <div className="sv-thumbs">
                {mediaRows
                  .filter((m) => m.album === 'Recovery')
                  .slice(0, 6)
                  .map((m) => (
                    <div key={m.id} style={{ width: 128 }}>
                      <ImageTile item={m} caption={formatDate(String(m.takenOn ?? m.createdAt))} />
                    </div>
                  ))}
                {mediaRows.filter((m) => m.album === 'Recovery').length === 0 ? <span className="gl-tech">No recovery photographs yet.</span> : null}
              </div>
            </Card>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------ 05 refusals */}
      <section className="gl-section">
        <div className="gl-section__title">
          <div>
            <div className="gl-eyebrow">Section 05 · what this will not help with</div>
            <h2>Refusals, with the reasons attached</h2>
          </div>
          <Chip tone="unsafe">
            <Ban size={11} /> no protocols, no doses, no sources
          </Chip>
        </div>

        <div className="gl-grid gl-grid--2">
          <Card variant="flush">
            <CardHead title="Injections, hormones and clinical treatment at home" eyebrow="the standing refusal" />
            <SafetyBanner tone="danger" title="This app will not help with this in any framing">
              <p className="gl-small">
                No product sourcing, no dose, no dilution, no site map, no “just this once”, no judgement of the person who is considering
                it. Non-prescribed steroids and hormones move through the whole body, and unlicensed injectables travel in unregulated
                supply chains — the failure modes are tissue death, blindness and systemic illness, and none of them are visible in a
                before-photo.
              </p>
            </SafetyBanner>
            {injectionTech || steroidTech ? (
              <div className="sv-ref">
                {[injectionTech, steroidTech].filter(Boolean).map((t) => (
                  <div key={String(t!.id)} data-safety={t!.safety}>
                    <div className="gl-row gl-row--between" style={{ alignItems: 'baseline', gap: 'var(--glow-sp-3)' }}>
                      <span className="gl-serif">{t!.title}</span>
                      <EvidenceChip grade={String(t!.evidence)} />
                    </div>
                    <p className="gl-small" style={{ margin: '4px 0' }}>
                      {String(t!.evidenceSummary)}
                    </p>
                    <div className="gl-label">Documented risks</div>
                    <ul className="sv-flags">
                      {((t!.risks as string[]) ?? []).map((x) => (
                        <li key={x} className="gl-small">
                          {x}
                        </li>
                      ))}
                    </ul>
                    <div className="gl-tech">Safer routes the library lists: {((t!.saferAlternatives as string[]) ?? []).join(' · ') || 'none recorded'}</div>
                    <div className="gl-tech">When to consult: {String(t!.whenToConsult)}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="gl-small gl-muted">The unsafe-technique rows are not in your techniques table — run a reseed from Settings and they will appear here quoted rather than summarised.</div>
            )}
          </Card>

          <Card variant="flush">
            <CardHead title="Nothing here is a recommendation" eyebrow="including by omission" />
            <div className="sv-refuse">
              {[
                { t: '“Do I need this?”', b: 'Needs are clinical. This app has no examination, no bloods, no history and no licence, so it says nothing about necessity — including which of your concerns is “worth it”.' },
                { t: '“Is this person good?”', b: 'No register access, no complaint database, no review import. The credentials field is a transcription of what you saw, and it is labelled self-recorded everywhere it appears.' },
                { t: '“Is this quote fair?”', b: 'No market data at all. It can show you the spread between the quotes you collected and nothing beyond them.' },
                { t: '“Look at this photo”', b: 'No image analysis, no symmetry scoring, no before/after verdict. A photograph is stored as a thing you took, and that is the entire extent of what is known about it.' },
                { t: '“What will recovery be like?”', b: 'Not from here. Recovery specifics come from the person doing the procedure; the log in Section 04 exists so your own days are recorded accurately for them.' }
              ].map((r) => (
                <div key={r.t} className="sv-refuse__row">
                  <div className="gl-serif">{r.t}</div>
                  <p className="gl-small" style={{ margin: '2px 0 0' }}>
                    {r.b}
                  </p>
                </div>
              ))}
            </div>
            {unsafeTech.length ? (
              <div className="sv-note">
                The library already carries {unsafeTech.length} entries graded unsafe (
                {unsafeTech.slice(0, 6).map((t) => String(t.slug)).join(', ')}
                {unsafeTech.length > 6 ? ', …' : ''}). Those rows are read-only reference; this department quotes them and stops.
              </div>
            ) : null}
          </Card>
        </div>
      </section>

      {/* ---------------------------------------------------- 06 honest limits */}
      <section className="gl-section">
        <div className="gl-section__title">
          <div>
            <div className="gl-eyebrow">Section 06 · what this cannot do</div>
            <h2>The limits, in print</h2>
          </div>
        </div>

        <div className="sv-limits">
          {[
            { t: 'No diagnosis, from anything', b: 'Not from a photograph, not from your self-report, not from a symptom list you ticked. Section 04 records what you noticed and stops there.' },
            { t: 'No provider verification', b: 'The app cannot reach a medical register, cannot confirm a licence and cannot read reviews. Every credential line is your transcription, labelled self-recorded.' },
            { t: 'No prices, only quotes you brought back', b: 'There is no fee database. A blank quote means nobody quoted you, or you have not written it down yet.' },
            { t: 'No necessity ranking', b: 'Recommendation rows elsewhere in Glow Lab never mark a clinical procedure as needed. The engine reads your own decisions, it does not author them.' },
            { t: 'No clinical protocol', b: 'Pre-care and post-care checklists are typed from the sheet you were given. The app has no medical content to substitute when the sheet is lost.' },
            { t: 'No safety opinion on unregulated substances', b: 'Non-prescribed hormones, steroids and injectables get a refusal and a pointer to the library row that already documents the risks. Nothing else.' }
          ].map((l) => (
            <Card key={l.t}>
              <CardHead title={l.t} />
              <p className="gl-small">{l.b}</p>
            </Card>
          ))}
        </div>

        <KvList
          items={[
            { k: 'Written to', v: 'providers, consultations, calendarEvents (plans, checklists, follow-ups), observations (recovery log), mediaItems (your photographs) — all local rows.' },
            { k: 'The two-consult gate', v: `a prompt counted from your own consultation rows. ${unmetGate.length ? `${unmetGate.length} title(s) currently booked or done on fewer than two.` : 'Nothing booked on a single opinion right now.'}` },
            { k: 'Blank on purpose', v: `${spend.unpriced} consultation(s) without a quote, ${providers.filter((p) => amount(p.data?.consultFee) === null).length} provider(s) without a fee, ${providers.filter((p) => !String(p.credentials ?? '').trim()).length} without credentials.` },
            { k: 'Never', v: 'no diagnosis, no necessity claim, no verification, no invented price, no protocol for anything injected, heated, cut or taken at home.' }
          ]}
        />
      </section>

      {/* ---------------------------------------------------------------- modals */}
      {providerEdit ? (
        <Modal
          open
          wide
          onClose={() => setProviderEdit(null)}
          title={providerEdit.id ? `Edit — ${providerEdit.name || 'provider'}` : 'Add a provider'}
          footer={
            <>
              <Button variant="ghost" onClick={() => setProviderEdit(null)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={() => void saveProvider(providerEdit)}>
                Store the row
              </Button>
            </>
          }
        >
          <div className="gl-stack">
            <SafetyBanner tone="note" title="Nothing here is verified">
              <p className="gl-small">
                Glow Lab cannot check a register, a licence, a qualification or an address. Write what you saw on the wall, the website or
                the certificate, and date your own check if you did one — that is the honest ceiling for this field.
              </p>
            </SafetyBanner>
            <div className="gl-form-row">
              <Field label="Name">
                <TextInput value={providerEdit.name} onChange={(v) => setProviderEdit({ ...providerEdit, name: v })} placeholder="As written on their own materials" />
              </Field>
              <Field label="Discipline">
                <Select value={providerEdit.discipline} onChange={(v) => setProviderEdit({ ...providerEdit, discipline: v })} options={DISCIPLINES.map((d) => ({ value: d, label: d }))} />
              </Field>
            </div>
            <Field label="Credentials, transcribed by you" hint="Titles, registration number if you wrote one down, where you saw it.">
              <TextArea value={providerEdit.credentials} onChange={(v) => setProviderEdit({ ...providerEdit, credentials: v })} rows={2} placeholder="Read from the certificate in the waiting room on 12 Mar: MBBS, MRCP (Derm), GMC no. recorded on my note" />
            </Field>
            <div className="gl-form-row">
              <Field label="Where they are">
                <TextInput value={providerEdit.location} onChange={(v) => setProviderEdit({ ...providerEdit, location: v })} placeholder="Clinic, city" />
              </Field>
              <Field label="Contact you have">
                <TextInput value={providerEdit.contact} onChange={(v) => setProviderEdit({ ...providerEdit, contact: v })} placeholder="Reception number, booking portal login name" />
              </Field>
            </div>
            <div className="gl-form-row">
              <Field label="Consultation fee you were told" hint="Blank if nobody quoted one.">
                <TextInput type="number" value={providerEdit.consultFee} onChange={(v) => setProviderEdit({ ...providerEdit, consultFee: v })} placeholder="0" />
              </Field>
              <DateInput label="Last seen" value={providerEdit.lastVisitOn} onChange={(v) => setProviderEdit({ ...providerEdit, lastVisitOn: v })} />
            </div>
            <Field label="Other pricing notes">
              <TextInput value={providerEdit.priceNotes} onChange={(v) => setProviderEdit({ ...providerEdit, priceNotes: v })} placeholder="Deposit taken at booking, refundable per their email" />
            </Field>
            <Field label="Anything else worth remembering">
              <TextArea value={providerEdit.note} onChange={(v) => setProviderEdit({ ...providerEdit, note: v })} rows={2} placeholder="Does not do follow-ups by phone; the nurse line is quicker." />
            </Field>
            <Field label="Website, if you found one yourself">
              <TextInput value={providerEdit.website} onChange={(v) => setProviderEdit({ ...providerEdit, website: v })} placeholder="typed, not suggested" />
            </Field>
            <Field label="Did you check anything, and when?" hint="Your own verification, dated — the app cannot do this part.">
              <TextInput value={providerEdit.verified} onChange={(v) => setProviderEdit({ ...providerEdit, verified: v })} placeholder="Looked up on the public register on 4 Apr and the number matched" />
            </Field>
          </div>
        </Modal>
      ) : null}

      {consultEdit ? (
        <ConsultModal
          draft={consultEdit}
          providers={providers}
          mediaById={mediaById}
          consultCount={consultEdit.procedureTitle ? consultCountFor(consultEdit.procedureTitle) : 0}
          onCancel={() => setConsultEdit(null)}
          onSave={(d) => void saveConsult(d)}
        />
      ) : null}

      {plan ? (
        <Modal
          open
          wide
          onClose={() => setPlan(null)}
          title="Plan a procedure"
          footer={
            <>
              <Button variant="ghost" onClick={() => setPlan(null)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={() => void writePlan(plan)} disabled={plan.permanence === 'Permanent' && consultCountFor(plan.title) < 2 && !plan.gateAck}>
                <CalendarClock size={14} /> Write it to the calendar
              </Button>
            </>
          }
        >
          <div className="gl-stack">
            {plan.permanence === 'Permanent' && consultCountFor(plan.title) < 2 ? (
              <div className="sv-gate sv-gate--modal">
                <SafetyBanner tone="danger" title="Two consultations before anything permanent">
                  <p className="gl-small">
                    {plan.title.trim() ? `“${plan.title.trim()}” has ${consultCountFor(plan.title)} consultation(s) on file.` : 'Title this plan and the count will appear here.'} This gate is the one you asked the app to hold you to. Book the
                    second opinion, or record the one you already had, before the permanent option is scheduled.
                  </p>
                  <Toggle checked={plan.gateAck} onChange={(v) => setPlan({ ...plan, gateAck: v })} label="I have had two separate consultations about this" hint="Ticking this with one consultation on file is your statement, not the app’s clearance." />
                  <Button
                    size="sm"
                    onClick={() => {
                      const title = plan.title;
                      setPlan(null);
                      setConsultEdit(consultDraftFrom(undefined, { procedureTitle: title, decision: 'second-opinion-sought' }));
                    }}
                  >
                    <Plus size={12} /> File the other consultation
                  </Button>
                </SafetyBanner>
              </div>
            ) : null}

            <div className="gl-form-row">
              <Field label="What is being planned" hint="Type it the way you would say it to the second professional.">
                <TextInput value={plan.title} onChange={(v) => setPlan({ ...plan, title: v })} placeholder="Consultation followed by in-clinic peel series" />
              </Field>
              <Field label="Provider">
                <Select value={plan.providerId} onChange={(v) => setPlan({ ...plan, providerId: v })} placeholder="Not chosen yet" options={providers.map((p) => ({ value: p.id, label: `${p.name} — ${p.discipline}` }))} />
              </Field>
            </div>
            <div className="gl-form-row">
              <DateInput label="Date" value={plan.date} onChange={(v) => setPlan({ ...plan, date: v })} />
              <Field label="Time">
                <TextInput type="time" value={plan.time} onChange={(v) => setPlan({ ...plan, time: v })} />
              </Field>
              <Field label="Minutes blocked">
                <TextInput type="number" value={plan.minutes} onChange={(v) => setPlan({ ...plan, minutes: v })} />
              </Field>
              <Field label="Permanence, as you were told it">
                <Select value={plan.permanence} onChange={(v) => setPlan({ ...plan, permanence: v })} options={PERMANENCE.map((p) => ({ value: p, label: p }))} />
              </Field>
            </div>
            <div className="gl-form-row">
              <Field label="Pre-care lines — one per row" hint="Copy from the sheet. The app has none of its own.">
                <TextArea value={plan.pre} onChange={(v) => setPlan({ ...plan, pre: v })} rows={4} placeholder={'No retinoid for 5 days (leaflet, clause 3)\nNo makeup on the day\nBring the aftercare number'} />
              </Field>
              <Field label="Post-care lines — one per row">
                <TextArea value={plan.post} onChange={(v) => setPlan({ ...plan, post: v })} rows={4} placeholder={'SPF only, no actives for 14 days\nReturn if blistering\nReview at 6 weeks'} />
              </Field>
            </div>
            <div className="gl-tech">
              {(plan.pre.split('\n').filter((x) => x.trim()).length + plan.post.split('\n').filter((x) => x.trim()).length)} checklist item(s) will be written into the event. Blank boxes write a bare appointment, which is also
              legitimate if nothing was given to you.
            </div>
            <Field label="Anything else about this plan">
              <TextArea value={plan.note} onChange={(v) => setPlan({ ...plan, note: v })} rows={2} placeholder="Deposit paid 20 Apr, non-refundable inside 14 days per their email." />
            </Field>
          </div>
        </Modal>
      ) : null}

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
              <Trash2 size={14} /> Soft-delete
            </Button>
          </>
        }
      >
        <p className="gl-small">
          <strong>{confirmDel?.label}</strong> is marked deleted rather than destroyed, and stays restorable from Settings. Consultation
          quotes and advice are the sort of record people want back — deleting is rarely better than marking the decision “declined”.
        </p>
      </Modal>

    </div>
  );
}

/* ----------------------------------------------------------- consult modal */

function ConsultModal({
  draft,
  providers,
  mediaById,
  consultCount,
  onCancel,
  onSave
}: {
  draft: ConsultDraft;
  providers: AnyRow[];
  mediaById: Map<string, AnyRow>;
  consultCount: number;
  onCancel: () => void;
  onSave: (d: ConsultDraft) => void;
}) {
  const [d, setD] = useState<ConsultDraft | null>(draft);
  useEffect(() => setD(draft), [draft]);
  if (!d) return null;

  const permanentGate = d.permanence === 'Permanent' && consultCount < 2 && (d.decision === 'scheduled' || d.decision === 'done');

  return (
    <Modal
      open
      wide
      onClose={onCancel}
      title={d.id ? `Edit — ${d.procedureTitle || 'consultation'}` : 'Log a consultation'}
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
        {permanentGate ? (
          <SafetyBanner tone="danger" title={`This is recorded as ${decisionLabel(d.decision).toLowerCase()} on ${consultCount} consultation(s)`}>
            <p className="gl-small">
              The row still saves — it is your diary, not a permission slip. But the two-consult rule you asked for is not met, and nothing
              permanent should be booked on one opinion from someone you cannot audit.
            </p>
          </SafetyBanner>
        ) : null}

        <div className="gl-form-row">
          <Field label="What the consultation was about" hint="In your words; this is also the title the two-consult counter matches on.">
            <TextInput value={d.procedureTitle} onChange={(v) => setD({ ...d, procedureTitle: v })} placeholder="Consultation about a peel series" />
          </Field>
          <Field label="Which concern it serves">
            <Select value={d.concern} onChange={(v) => setD({ ...d, concern: v })} options={CONCERNS.map((c) => ({ value: c, label: c }))} />
          </Field>
        </div>

        <div className="gl-form-row">
          <Field label="Provider">
            <Select value={d.providerId} onChange={(v) => setD({ ...d, providerId: v })} placeholder="Not in the directory yet" options={providers.map((p) => ({ value: p.id, label: `${p.name} — ${p.discipline}` }))} />
          </Field>
          <DateInput label="Date" value={d.on} onChange={(v) => setD({ ...d, on: v })} />
          <Field label="Decision you arrived at">
            <Select value={d.decision} onChange={(v) => setD({ ...d, decision: v })} options={DECISIONS.map((x) => ({ value: x.value, label: `${x.label} — ${x.meaning}` }))} />
          </Field>
        </div>

        <Field label="Why you went" hint="What you wanted from the appointment, before they spoke.">
          <TextArea value={d.purpose} onChange={(v) => setD({ ...d, purpose: v })} rows={2} placeholder="To find out whether the marks on my cheeks are treatable at all, and by whom." />
        </Field>

        <Field label="What they advised" hint="Their words as you remember them. Quote, do not improve.">
          <TextArea value={d.advised} onChange={(v) => setD({ ...d, advised: v })} rows={3} placeholder="“Sunscreen first, then we can talk about a peel; the tretinoin may be doing more than the peel would.”" />
        </Field>

        <div className="gl-form-row">
          <Field label="Quote you were given" hint="Blank if nothing was quoted. The app has no price of its own.">
            <TextInput type="number" value={d.quote} onChange={(v) => setD({ ...d, quote: v })} placeholder="0" />
          </Field>
          <Field label="Permanence as stated to you">
            <Select value={d.permanence} onChange={(v) => setD({ ...d, permanence: v })} options={PERMANENCE.map((p) => ({ value: p, label: p }))} />
          </Field>
          <DateInput label="Follow-up date" value={d.followUpOn} onChange={(v) => setD({ ...d, followUpOn: v })} />
        </div>

        <div className="gl-form-row">
          <Field label="Risks they named">
            <TextArea value={d.risks} onChange={(v) => setD({ ...d, risks: v })} rows={2} placeholder="Pigment change on deeper skin tones, two weeks of redness." />
          </Field>
          <Field label="Limitations they admitted">
            <TextArea value={d.limitations} onChange={(v) => setD({ ...d, limitations: v })} rows={2} placeholder="Cannot say how many sessions; depends on how it heals." />
          </Field>
        </div>

        <div className="gl-form-row">
          <Field label="Recovery as described">
            <TextArea value={d.recovery} onChange={(v) => setD({ ...d, recovery: v })} rows={2} placeholder="Peeling days 3–6, no makeup for 48 hours." />
          </Field>
          <Field label="Alternatives they offered">
            <TextArea value={d.alternatives} onChange={(v) => setD({ ...d, alternatives: v })} rows={2} placeholder="Continue tretinoin and reassess in six months; or laser, which they do not provide." />
          </Field>
        </div>

        <div className="sv-qs sv-qs--modal">
          <div className="gl-label">Questions you took with you</div>
          {d.questions.map((qItem, i) => (
            <div key={i} className="sv-q">
              <button type="button" className="sv-q__check" aria-pressed={qItem.asked} onClick={() => setD({ ...d, questions: d.questions.map((x, j) => (j === i ? { ...x, asked: !x.asked } : x)) })} title="Asked?">
                {qItem.asked ? '✓' : ''}
              </button>
              <div style={{ flex: 1, minWidth: 0 }}>
                <TextInput
                  value={qItem.label}
                  onChange={(v) => setD({ ...d, questions: d.questions.map((x, j) => (j === i ? { ...x, label: v } : x)) })}
                  placeholder="What will you not be able to tell me from this appointment?"
                />
                <TextInput
                  value={qItem.answer}
                  onChange={(v) => setD({ ...d, questions: d.questions.map((x, j) => (j === i ? { ...x, answer: v } : x)) })}
                  placeholder="Their answer, in their words"
                />
              </div>
              <IconButton label="Remove question" onClick={() => setD({ ...d, questions: d.questions.filter((_, j) => j !== i) })}>
                <Trash2 size={13} />
              </IconButton>
            </div>
          ))}
          <Button size="sm" onClick={() => setD({ ...d, questions: [...d.questions, { label: '', asked: false, answer: '' }] })}>
            <Plus size={12} /> Add a question
          </Button>
          <div className="gl-tech">{consultCount} consultation(s) on file for this title. Two before anything permanent — your rule.</div>
        </div>

        <Field label="Anything else from the room">
          <TextArea value={d.note} onChange={(v) => setD({ ...d, note: v })} rows={2} placeholder="Handed me a printed aftercare sheet; I have photographed it below rather than retyping it." />
        </Field>

        <div className="sv-photo">
          <PhotoPicker kind="upload" album="Consultations" label="Photograph the sheet they gave you" onPick={(rows) => setD({ ...d, mediaIds: [...d.mediaIds, ...rows.map((r) => r.id)] })} />
          <div className="sv-thumbs">
            {d.mediaIds.map((id) => {
              const m = mediaById.get(id);
              if (!m)
                return (
                  <span key={id} className="gl-tech">
                    <Chip tone="danger">missing file {id.slice(0, 6)}</Chip>
                  </span>
                );
              return (
                <div key={id} style={{ width: 128 }}>
                  <ImageTile item={m} caption="your photograph" />
                  <button type="button" className="gl-btn gl-btn--sm gl-btn--ghost" onClick={() => setD({ ...d, mediaIds: d.mediaIds.filter((x) => x !== id) })}>
                    Detach
                  </button>
                </div>
              );
            })}
          </div>
          <div className="gl-tech">Photographs of documents and of yourself stay unexamined. Nothing in this department reads an image, scores a face or grades a healing photo.</div>
        </div>

        {HOME_WORDS.test(`${d.purpose} ${d.advised} ${d.alternatives} ${d.note}`) ? (
          <SafetyBanner tone="danger" title="This entry mentions doing something clinical at home">
            <p className="gl-small">
              Keeping the note is fine. Glow Lab will not extend it with instructions, sources or doses, and will not reassure you about
              it. The refusal in Section 05 applies whatever the wording is.
            </p>
          </SafetyBanner>
        ) : null}
      </div>
    </Modal>
  );
}
