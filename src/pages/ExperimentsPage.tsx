import '../styles/departments/experiments.css';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, CircleOff, FlaskConical, Plus, Save, Trash2, XCircle } from 'lucide-react';
import { TABLES, type AnyRow } from '../db/schema';
import { addDays, formatDate, newId, softDelete, todayISO } from '../db/repo';
import { saveRow, useRows } from '../hooks/live';
import {
  Button,
  Card,
  CardHead,
  Chip,
  Disclosure,
  EmptyState,
  EvidenceChip,
  Field,
  IconButton,
  Meter,
  Modal,
  Range,
  Rating,
  SafetyBanner,
  Section,
  Select,
  TextArea,
  TextInput,
  useToast
} from '../ui/primitives';
import { DeptIntro, EmptyPlate, IndexList, IndexRow, KvList, PullQuote, StatStrip, Timeline } from '../ui/editorial';
import { ImageTile, PhotoPicker } from '../ui/media';
import { LineChart } from '../ui/charts';

/**
 * Experimentation Lab — spec Part 23. An N-of-1 self-test tracker.
 *
 * What is stored: the hypothesis in the user's words, the one variable they
 * changed, a cadence, dated check-ins as `observations` rows, and a verdict the
 * user chose themselves. What is deliberately absent: a control arm, blinding,
 * randomisation, inter-rater reliability, and any claim that a self-report is
 * measurement. The page states that in plain words because the alternative —
 * showing a trend line and letting it imply proof — is the dishonest option.
 */

const VERDICTS = [
  { value: 'worked', label: 'It worked', note: 'You judged the change worth keeping.' },
  { value: 'no-difference', label: 'No difference I could see', note: 'You kept the protocol and noticed nothing you would attribute to it.' },
  { value: 'harmful', label: 'It made things worse', note: 'Cost, reaction, effort or outcome outweighed whatever it did.' },
  { value: 'inconclusive', label: 'Inconclusive', note: 'Too short, too inconsistent, or too many things changed at once.' }
] as const;

const DECISION_FOR_VERDICT: Record<string, 'repeat' | 'stop' | 'extend' | 'open'> = {
  worked: 'repeat',
  'no-difference': 'extend',
  harmful: 'stop',
  inconclusive: 'open'
};

/** Scaffolds only — no claims, no expected outcomes, no invented products. */
const TEMPLATES = [
  {
    name: 'One variable, eight weeks',
    category: 'protocol',
    cadenceDays: 7,
    days: 56,
    protocol: 'Change exactly one thing. Everything else in the routine stays identical for the whole window.',
    prompt: 'If I change ______ and nothing else, then within 8 weeks I will notice ______.'
  },
  {
    name: 'Introducing one product slowly',
    category: 'product',
    cadenceDays: 2,
    days: 28,
    protocol: 'Patch test first. Start twice in week one. Increase frequency only while tolerating. No other new product in the window.',
    prompt: 'If I introduce ______ at this frequency, my skin/scalp will do ______ by week 4.'
  },
  {
    name: 'A habit I want to prove to myself',
    category: 'habit',
    cadenceDays: 1,
    days: 21,
    protocol: 'Daily check-in, one line, logged on the same day — not remembered the next morning.',
    prompt: 'If I do ______ every day for 21 days, I expect ______ to change.'
  },
  {
    name: 'Sleep timing and how mornings feel',
    category: 'routine',
    cadenceDays: 1,
    days: 14,
    protocol: 'Fix the bedtime, not the wake time. Rate the morning immediately after waking, before coffee.',
    prompt: 'If I am in bed by ______, my morning rating will be ______ rather than ______.'
  }
];

const uid = (p: string) => newId(p);

type Reaction = 'none' | 'good' | 'bad' | 'irritation' | 'breakout' | 'unknown';
const REACTIONS: Reaction[] = ['none', 'good', 'bad', 'irritation', 'breakout', 'unknown'];

const isoOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const num = (v: unknown, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

export default function ExperimentsPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  const runs = useRows(TABLES.experiments);
  const checks = useRows(TABLES.observations, { where: { subjectType: 'experiment' } });
  const techniques = useRows(TABLES.techniques);
  const products = useRows(TABLES.products);
  const media = useRows(TABLES.mediaItems);

  const [openId, setOpenId] = useState<string | null>(null);
  const [filter, setFilter] = useState('all');
  const [creating, setCreating] = useState<Record<string, unknown> | null>(null);
  const [closing, setClosing] = useState<AnyRow | null>(null);
  const [askDelete, setAskDelete] = useState<AnyRow | null>(null);

  const wanted = params.get('id');
  const open = runs.find((r) => r.id === (openId ?? wanted)) ?? null;

  useEffect(() => {
    if (wanted) setOpenId(wanted);
  }, [wanted]);

  const checksFor = useMemo(() => {
    const m = new Map<string, AnyRow[]>();
    for (const c of [...checks].sort((a, b) => String(a.on).localeCompare(String(b.on)))) {
      const arr = m.get(String(c.subjectId)) ?? [];
      arr.push(c);
      m.set(String(c.subjectId), arr);
    }
    return m;
  }, [checks]);

  const live = runs.filter((r) => !r.data?.verdict);
  const closed = runs.filter((r) => r.data?.verdict);

  const visible = runs
    .filter((r) => (filter === 'running' ? !r.data?.verdict : filter === 'closed' ? Boolean(r.data?.verdict) : true))
    .sort((a, b) => String(b.updatedAt ?? 0).localeCompare(String(a.updatedAt ?? 0)));

  const startFrom = async (t: Record<string, unknown>) => {
    const start = todayISO();
    const row = await saveRow(TABLES.experiments, {
      id: uid('exp'),
      name: String(t.name),
      category: String(t.category),
      aim: String(t.prompt ?? ''),
      startOn: String(t.startOn ?? start),
      endOn: String(t.endOn ?? addDays(start, num(t.days, 28))),
      baseline: '',
      baselineMediaIds: [],
      techniqueIds: [],
      productIds: [],
      protocol: String(t.protocol ?? ''),
      observations: [],
      result: '',
      resultMediaIds: [],
      rating: 0,
      decision: 'open',
      confounders: '',
      tags: ['template'],
      data: { cadenceDays: num(t.cadenceDays, 7), variable: '', expected: String(t.prompt ?? '') }
    });
    setOpenId(row.id);
    setCreating(null);
    toast('Run created as a row. Write your own hypothesis over the prompt before you start.', 'ok');
  };

  const totals = {
    scheduled: runs.reduce((n, r) => n + scheduledDates(r).length, 0),
    logged: checks.length
  };

  return (
    <div className="gl-page exp">
      <DeptIntro
        id="experiments"
        actions={
          <Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreating({ name: '', category: 'general', cadenceDays: 7, days: 28, protocol: '', prompt: '' })}>
            Design a run
          </Button>
        }
        meta={[
          { label: 'Runs open now', value: String(live.length) },
          { label: 'Check-ins logged', value: String(checks.length) },
          { label: 'Verdicts you gave', value: String(closed.length) }
        ]}
      />

      <SafetyBanner tone="note" title="What an N-of-1 run can and cannot tell you">
        One person, one timeline, no control arm, no blinding, no randomisation, no-one else rating the photographs. A
        trend line here is a record of what you wrote down on the days you wrote something down. It cannot separate the
        intervention from expectancy, season, sleep, weather or a second product you forgot to mention — which is why
        “confounders” is a required field on every run, not an optional note.
      </SafetyBanner>

      <StatStrip
        items={[
          { label: 'Runs stored', value: runs.length, hint: 'experiments rows' },
          { label: 'Running', value: live.length, hint: 'no verdict yet' },
          { label: 'Closed', value: closed.length, hint: 'your own judgement' },
          { label: 'Check-ins vs schedule', value: `${totals.logged}/${totals.scheduled}`, hint: totals.scheduled ? `${Math.round((totals.logged / totals.scheduled) * 100)}% of scheduled days logged` : 'no schedule yet' }
        ]}
      />

      <Section
        eyebrow="Start here"
        title="Templates"
        description="Structures, not predictions. Nothing below tells you what will happen — the hypothesis line is a sentence for you to finish."
      >
        <div className="gl-grid gl-grid--4 exp-templates">
          {TEMPLATES.map((t) => (
            <Card key={t.name} className="exp-template">
              <div className="gl-eyebrow">{t.category} · every {t.cadenceDays}d · {Math.round(num(t.days) / 7)} weeks</div>
              <div className="gl-serif exp-template__h">{t.name}</div>
              <p className="gl-small gl-muted">{t.protocol}</p>
              <Button size="sm" variant="primary" icon={<FlaskConical size={13} />} onClick={() => void startFrom(t)}>
                Start this run
              </Button>
            </Card>
          ))}
        </div>
      </Section>

      <div className="exp-work">
        <div className="exp-rail">
          <div className="gl-row gl-row--tight" style={{ marginBottom: 'var(--glow-sp-3)' }}>
            {(['all', 'running', 'closed'] as const).map((f) => (
              <Chip key={f} active={filter === f} onClick={() => setFilter(f)}>
                {f} <span className="gl-tech">{f === 'running' ? live.length : f === 'closed' ? closed.length : runs.length}</span>
              </Chip>
            ))}
          </div>

          {visible.length === 0 ? (
            <EmptyPlate
              kicker="No runs"
              title={runs.length ? 'Nothing in that state' : 'The lab bench is empty'}
              body={
                runs.length
                  ? `${runs.length} run${runs.length > 1 ? 's are' : ' is'} stored under another filter.`
                  : 'A run needs three things you already know: the one thing you changed, how often you will check in, and the sentence you want to be able to finish in eight weeks.'
              }
              action={
                <Button variant="primary" icon={<Plus size={14} />} onClick={() => setCreating({ name: '', category: 'general', cadenceDays: 7, days: 28, protocol: '', prompt: '' })}>
                  Design your first run
                </Button>
              }
            />
          ) : (
            <IndexList>
              {visible.map((r, i) => {
                const cs = checksFor.get(r.id) ?? [];
                const sched = scheduledDates(r);
                return (
                  <IndexRow
                    key={r.id}
                    no={i + 1}
                    title={r.name || 'Untitled run'}
                    sub={
                      <span className="exp-sub">
                        <span>{r.category || 'general'}</span>
                        <span>·</span>
                        <span>{formatDate(r.startOn)} → {formatDate(r.endOn)}</span>
                        <span>·</span>
                        <span>{cs.length}/{sched.length} check-ins</span>
                        {r.data?.verdict ? <span className="exp-verdict">· {String(r.data.verdict)}</span> : null}
                      </span>
                    }
                    right={r.data?.verdict ? <Chip tone="gold">Closed</Chip> : <Chip tone="moderate">Open</Chip>}
                    onClick={() => setOpenId(r.id)}
                  />
                );
              })}
            </IndexList>
          )}
        </div>

        <div className="exp-pane gl-rule-col">
          {open ? (
            <RunSheet
              run={open}
              checks={checksFor.get(open.id) ?? []}
              techniques={techniques}
              products={products}
              media={media}
              onNavigate={navigate}
              onClose={() => {
                setOpenId(null);
                if (wanted) navigate('/experiments');
              }}
              onAskClose={() => setClosing(open)}
              onAskDelete={() => setAskDelete(open)}
              onPatch={async (changes) => {
                await saveRow(TABLES.experiments, { id: open.id, ...changes, data: { ...(open.data ?? {}), ...((changes.data as object) ?? {}) } });
              }}
              onCheckIn={async (payload) => {
                await saveRow(TABLES.observations, {
                  id: uid('obs'),
                  subjectType: 'experiment',
                  subjectId: open.id,
                  on: payload.on,
                  note: payload.note,
                  reaction: payload.reaction,
                  severity: payload.severity,
                  mediaIds: [],
                  tags: [],
                  data: { rating: payload.rating, sideEffects: payload.sideEffects }
                });
                await saveRow(TABLES.logs, {
                  channel: 'capture',
                  level: 'info',
                  message: `Check-in logged for “${open.name}”`,
                  detail: `${payload.on} · rating ${payload.rating}/5`
                });
                toast('Check-in stored as its own dated row.', 'ok');
              }}
              onAttachPhoto={async (checkId, mediaIds) => {
                const row = checks.find((c) => c.id === checkId);
                if (!row) return;
                await saveRow(TABLES.observations, { id: checkId, mediaIds: [...((row.mediaIds as string[]) ?? []), ...mediaIds] });
              }}
            />
          ) : (
            <Card>
              <CardHead eyebrow="Method" title="How a run works here" />
              <div className="gl-stack" style={{ gap: 'var(--glow-sp-3)' }}>
                <p className="gl-small gl-muted" style={{ margin: 0 }}>
                  Each run is an <code>experiments</code> row. Each check-in is a separate <code>observations</code> row
                  pointing back at it, dated, with your note, your 1–5 rating, any side effects and any photographs you
                  attached. Adherence is check-ins logged divided by check-ins the cadence scheduled — the two numbers are
                  printed next to it, because a percentage without its denominator is decoration.
                </p>
                <PullQuote cite="The honest failure mode of a self-test is not a wrong answer. It is a vague question.">
                  Write the hypothesis so a stranger could tell, on day 56, whether you finished the sentence.
                </PullQuote>
                {runs.length ? (
                  <Button size="sm" variant="primary" onClick={() => setOpenId(visible[0]?.id ?? runs[0].id)}>
                    Open a run
                  </Button>
                ) : (
                  <Button size="sm" variant="primary" icon={<Plus size={13} />} onClick={() => setCreating({ name: '', category: 'general', cadenceDays: 7, days: 28, protocol: '', prompt: '' })}>
                    Design a run
                  </Button>
                )}
              </div>
            </Card>
          )}
        </div>
      </div>

      {creating ? (
        <RunForm
          draft={creating}
          onClose={() => setCreating(null)}
          onCancelDraft={() => setCreating(null)}
          onSave={async (payload) => {
            await saveRow(TABLES.experiments, { ...payload, id: uid('exp'), observations: [], baselineMediaIds: [], techniqueIds: [], productIds: [], resultMediaIds: [], rating: 0, decision: 'open' });
            setCreating(null);
            toast('Run written to the experiments table.', 'ok');
          }}
          onUpdate={setCreating}
        />
      ) : null}

      <Modal
        open={Boolean(closing)}
        onClose={() => setClosing(null)}
        title="Close this run — on your judgement"
        footer={
          <>
            <Button variant="ghost" onClick={() => setClosing(null)}>
              Keep it open
            </Button>
          </>
        }
      >
        {closing ? (
          <CloseRun
            run={closing}
            onDone={async (verdict, result, rating) => {
              await saveRow(TABLES.experiments, {
                id: closing.id,
                result,
                rating,
                decision: DECISION_FOR_VERDICT[verdict] ?? 'open',
                closedOn: todayISO(),
                data: { ...(closing.data ?? {}), verdict, closedOn: todayISO() }
              });
              setClosing(null);
              toast(`Verdict stored: ${verdict}. It is your call, written on your row — not a conclusion the app reached.`, 'ok');
            }}
          />
        ) : null}
      </Modal>

      <Modal
        open={Boolean(askDelete)}
        onClose={() => setAskDelete(null)}
        title="Remove this run?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAskDelete(null)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              icon={<XCircle size={13} />}
              onClick={async () => {
                if (!askDelete) return;
                await softDelete(TABLES.experiments, askDelete.id);
                if (openId === askDelete.id) setOpenId(null);
                setAskDelete(null);
                toast('Run removed. Its check-ins stay in your records as dated observations.', 'ok');
              }}
            >
              Remove the run
            </Button>
          </>
        }
      >
        <p className="gl-small">
          <b>{askDelete?.name}</b> and its verdict leave the lab bench.
        </p>
        <p className="gl-small gl-muted">
          {(checksFor.get(askDelete?.id ?? '') ?? []).length} check-in(s) stay in the observations table. They are records
          of days you actually logged, and deleting a run should not erase that.
        </p>
      </Modal>
    </div>
  );
}

/* ------------------------------------------------------------- scheduling */

function scheduledDates(run: AnyRow): string[] {
  const cadence = Math.max(1, Math.round(num(run.data?.cadenceDays, 7)));
  const start = String(run.startOn || todayISO());
  const end = String(run.endOn || addDays(start, 28));
  const stop = end < todayISO() ? end : todayISO();
  const out: string[] = [];
  let cur = start;
  let guard = 0;
  while (cur <= stop && guard < 1500) {
    out.push(cur);
    cur = addDays(cur, cadence);
    guard += 1;
  }
  return out;
}

/* ---------------------------------------------------------------- run sheet */

function RunSheet({
  run,
  checks,
  techniques,
  products,
  media,
  onNavigate,
  onClose,
  onAskClose,
  onAskDelete,
  onPatch,
  onCheckIn,
  onAttachPhoto
}: {
  run: AnyRow;
  checks: AnyRow[];
  techniques: AnyRow[];
  products: AnyRow[];
  media: AnyRow[];
  onNavigate: (p: string) => void;
  onClose: () => void;
  onAskClose: () => void;
  onAskDelete: () => void;
  onPatch: (changes: Record<string, unknown>) => Promise<void>;
  onCheckIn: (p: { on: string; note: string; rating: number; reaction: Reaction; severity: number; sideEffects: string }) => Promise<void>;
  onAttachPhoto: (checkId: string, mediaIds: string[]) => Promise<void>;
}) {
  const [name, setName] = useState(String(run.name ?? ''));
  const [aim, setAim] = useState(String(run.aim ?? ''));
  const [variable, setVariable] = useState(String(run.data?.variable ?? ''));
  const [protocol, setProtocol] = useState(String(run.protocol ?? ''));
  const [expected, setExpected] = useState(String(run.data?.expected ?? ''));
  const [actual, setActual] = useState(String(run.result ?? ''));
  const [confounders, setConfounders] = useState(String(run.confounders ?? ''));
  const [cadence, setCadence] = useState(num(run.data?.cadenceDays, 7));
  const [startOn, setStartOn] = useState(String(run.startOn ?? todayISO()));
  const [endOn, setEndOn] = useState(String(run.endOn ?? addDays(todayISO(), 28)));
  const [draft, setDraft] = useState({ on: todayISO(), note: '', rating: 3, reaction: 'none' as Reaction, severity: 0, sideEffects: '' });
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setName(String(run.name ?? ''));
    setAim(String(run.aim ?? ''));
    setVariable(String(run.data?.variable ?? ''));
    setProtocol(String(run.protocol ?? ''));
    setExpected(String(run.data?.expected ?? ''));
    setActual(String(run.result ?? ''));
    setConfounders(String(run.confounders ?? ''));
    setCadence(num(run.data?.cadenceDays, 7));
    setStartOn(String(run.startOn ?? todayISO()));
    setEndOn(String(run.endOn ?? addDays(todayISO(), 28)));
    setDirty(false);
  }, [run.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const sched = scheduledDates(run);
  const loggedDates = new Set(checks.map((c) => String(c.on)));
  const missed = sched.filter((d) => !loggedDates.has(d));
  const adherence = sched.length ? Math.round((loggedDates.size / sched.length) * 100) : 0;
  const rated = checks.filter((c) => num(c.data?.rating, 0) > 0);

  const save = async () => {
    await onPatch({
      name: name.trim() || 'Untitled run',
      aim,
      protocol,
      result: actual,
      confounders,
      startOn,
      endOn,
      data: { variable, expected, cadenceDays: Math.max(1, Math.round(cadence)) }
    });
    setDirty(false);
  };

  return (
    <article className="exp-run">
      <div className="gl-row gl-row--between exp-run__top">
        <div className="gl-eyebrow">
          Run · {run.category || 'general'} · {run.data?.verdict ? `closed: ${run.data.verdict}` : 'open'} · rev {run.rev ?? 1}
        </div>
        <div className="gl-row gl-row--tight">
          {dirty ? <Chip tone="gold">Unsaved</Chip> : null}
          <Button size="sm" variant="primary" onClick={() => void save()} disabled={!dirty}>
            {dirty ? 'Save run' : 'Saved'}
          </Button>
          {run.data?.verdict ? null : (
            <Button size="sm" variant="gold" onClick={onAskClose}>
              Close with a verdict
            </Button>
          )}
          <IconButton label="Back to the bench" onClick={onClose}>
            ✕
          </IconButton>
          <IconButton label="Remove run" tone="danger" onClick={onAskDelete}>
            <Trash2 size={14} />
          </IconButton>
        </div>
      </div>

      <div className="exp-grid">
        <Field label="Name of the run">
          <TextInput value={name} onChange={(v) => { setName(v); setDirty(true); }} />
        </Field>
        <Field label="Category">
          <TextInput value={String(run.category ?? '')} onChange={(v) => void onPatch({ category: v })} />
        </Field>
        <DateField label="Starts" value={startOn} onChange={(v) => { setStartOn(v); setDirty(true); }} />
        <DateField label="Ends" value={endOn} onChange={(v) => { setEndOn(v); setDirty(true); }} />
        <Field label="Check in every … days" hint="Drives the schedule the adherence number divides by.">
          <TextInput type="number" value={cadence} onChange={(v) => { setCadence(num(v, 7)); setDirty(true); }} />
        </Field>
        <Field label="The ONE variable you changed" hint="If two things changed, say so here — that is a confounder, not a protocol.">
          <TextInput value={variable} onChange={(v) => { setVariable(v); setDirty(true); }} placeholder="What is different from your baseline?" />
        </Field>
      </div>

      <Field label="Hypothesis — finish this sentence">
        <TextArea value={aim} onChange={(v) => { setAim(v); setDirty(true); }} rows={2} placeholder="If I ______, then ______ within ______ weeks." />
      </Field>
      <Field label="Protocol, as you will actually run it">
        <TextArea value={protocol} onChange={(v) => { setProtocol(v); setDirty(true); }} rows={3} placeholder="Frequency, amount, timing, what you will not change at the same time." />
      </Field>
      <div className="exp-two">
        <Field label="What you expected">
          <TextArea value={expected} onChange={(v) => { setExpected(v); setDirty(true); }} rows={3} placeholder="Written before, ideally. Edited afterwards and it stops being evidence." />
        </Field>
        <Field label="What actually happened">
          <TextArea value={actual} onChange={(v) => { setActual(v); setDirty(true); }} rows={3} placeholder="What you observed, including the boring and the inconvenient." />
        </Field>
      </div>
      <Field label="Confounders — everything else that moved" hint="Required in spirit. Season, sleep, stress, a second product, a better camera.">
        <TextArea value={confounders} onChange={(v) => { setConfounders(v); setDirty(true); }} rows={2} />
      </Field>

      <div className="exp-links">
        <LinkMulti
          label="Techniques in play"
          rows={techniques}
          ids={(run.techniqueIds as string[]) ?? []}
          onChange={(ids) => void onPatch({ techniqueIds: ids })}
          onOpen={(id) => {
            const t = techniques.find((x) => x.id === id);
            if (t) onNavigate(`/knowledge?technique=${t.slug}`);
          }}
          render={(t) => (
            <span className="exp-link__inner">
              {t.title} <EvidenceChip grade={String(t.evidence)} />
              {t.safety === 'unsafe' ? <Chip tone="danger">Will not be scheduled</Chip> : null}
            </span>
          )}
        />
        <LinkMulti
          label="Products in play"
          rows={products}
          idKey="name"
          ids={(run.productIds as string[]) ?? []}
          onChange={(ids) => void onPatch({ productIds: ids })}
          onOpen={(id) => onNavigate(`/market?product=${id}`)}
          render={(p) => <span className="exp-link__inner">{p.name}{p.brand ? ` — ${p.brand}` : ''}</span>}
        />
      </div>

      {/* adherence + trend ------------------------------------------------- */}
      <div className="exp-metrics">
        <div className="gl-inset">
          <div className="gl-label">Adherence</div>
          <Meter value={adherence} label={`${loggedDates.size} logged of ${sched.length} scheduled`} />
          <p className="gl-tech gl-faint" style={{ marginBottom: 0 }}>
            cadence every {Math.max(1, Math.round(num(run.data?.cadenceDays, 7)))} days between {formatDate(run.startOn)} and{' '}
            {formatDate(run.endOn)} · {missed.length} missed {missed.length === 1 ? 'day' : 'days'}
          </p>
          {missed.length ? (
            <div className="gl-row gl-row--tight" style={{ marginTop: 8 }}>
              {missed.slice(0, 12).map((d) => (
                <Chip key={d} title="Scheduled, never logged">
                  {d.slice(5)}
                </Chip>
              ))}
              {missed.length > 12 ? <span className="gl-tech gl-faint">+{missed.length - 12} more</span> : null}
            </div>
          ) : null}
        </div>

        <div className="gl-inset">
          <div className="gl-label">Your ratings over time</div>
          {rated.length >= 2 ? (
            <LineChart
              height={190}
              yTitle="your 1–5 rating"
              labels={rated.map((c) => String(c.on).slice(5))}
              series={[{ label: `${run.name || 'run'} — self-rated`, data: rated.map((c) => num(c.data?.rating, 0)), area: true }]}
            />
          ) : (
            <p className="gl-small gl-faint" style={{ marginBottom: 0 }}>
              {rated.length === 0
                ? 'No ratings logged yet. The chart appears once two dated ratings exist.'
                : 'One rating so far — a single point is not a trend, so nothing is drawn.'}
            </p>
          )}
        </div>
      </div>

      {/* check-ins --------------------------------------------------------- */}
      <Section eyebrow="Primary record" title="Check-ins" description="Each one is a row. Dates, notes and photographs are stored exactly as you enter them — nothing is interpolated between them.">
        <Card className="exp-checkin">
          <CardHead eyebrow="New check-in" title="Log today, or backdate a day you forgot" />
          <div className="exp-checkin__row">
            <DateField label="Date" value={draft.on} onChange={(v) => setDraft({ ...draft, on: v })} />
            <Field label="Overall rating">
              <Rating value={draft.rating} onChange={(v) => setDraft({ ...draft, rating: v })} />
            </Field>
            <Field label="Reaction">
              <Select
                value={draft.reaction}
                onChange={(v) => setDraft({ ...draft, reaction: v as Reaction })}
                options={REACTIONS.map((r) => ({ value: r, label: r }))}
              />
            </Field>
            <Range label="Severity" min={0} max={5} value={draft.severity} onChange={(v) => setDraft({ ...draft, severity: v })} format={(v) => `${v}/5`} />
          </div>
          <Field label="Note">
            <TextArea value={draft.note} onChange={(v) => setDraft({ ...draft, note: v })} rows={2} placeholder="What you actually saw, felt or measured today. One line is enough." />
          </Field>
          <Field label="Side effects" hint="Separate with commas. Blank means you recorded none, which is different from not asking.">
            <TextInput value={draft.sideEffects} onChange={(v) => setDraft({ ...draft, sideEffects: v })} />
          </Field>
          <div className="gl-row gl-row--tight">
            <Button
              variant="primary"
              size="sm"
              icon={<Save size={13} />}
              disabled={!draft.note.trim() && draft.rating === 0}
              onClick={async () => {
                await onCheckIn(draft);
                setDraft({ on: todayISO(), note: '', rating: 3, reaction: 'none', severity: 0, sideEffects: '' });
              }}
            >
              Save check-in
            </Button>
            {sched.length && loggedDates.size >= sched.length ? <Chip tone="gold">Schedule fully logged</Chip> : null}
          </div>
        </Card>

        {checks.length === 0 ? (
          <EmptyState title="No check-ins yet" body="The run means nothing until the first one exists. Log the baseline day too — a start date with no entry beside it is just a diary resolution." icon={<AlertTriangle size={20} />} />
        ) : (
          <Timeline
            items={checks.map((c) => {
              const cMedia = ((c.mediaIds as string[]) ?? []).map((id) => media.find((m) => m.id === id)).filter(Boolean) as AnyRow[];
              return {
                when: `${formatDate(String(c.on))} · ${num(c.data?.rating, 0) || '—'}/5`,
                tone: c.reaction === 'bad' || c.reaction === 'irritation' || c.reaction === 'breakout' ? ('accent' as const) : ('plain' as const),
                title: c.reaction === 'none' ? 'No reaction recorded' : `Reaction: ${c.reaction}${num(c.severity) ? ` · severity ${c.severity}/5` : ''}`,
                body: (
                  <div className="gl-stack" style={{ gap: 'var(--glow-sp-2)' }}>
                    <div className="gl-small">{c.note || '—'}</div>
                    {c.data?.sideEffects ? <div className="gl-tech gl-faint">side effects: {String(c.data.sideEffects)}</div> : null}
                    {cMedia.length ? (
                      <div className="exp-checkin__media">
                        {cMedia.map((m) => (
                          <ImageTile key={m.id} item={m} caption={isoOf(Number(m.createdAt ?? 0))} onClick={() => onNavigate(`/media?id=${m.id}`)} />
                        ))}
                      </div>
                    ) : null}
                    <div className="gl-row gl-row--tight">
                      <PhotoPicker kind="experiment" label="Attach a photograph" onPick={(rows) => void onAttachPhoto(String(c.id), rows.map((r) => r.id))} />
                      <Button size="sm" variant="ghost" icon={<CircleOff size={13} />} onClick={() => void softDelete(TABLES.observations, String(c.id))}>
                        Void this check-in
                      </Button>
                    </div>
                  </div>
                ),
                right: <span className="gl-tech gl-faint">{cMedia.length ? `${cMedia.length} photo(s)` : 'no photo'}</span>
              };
            })}
          />
        )}
      </Section>

      <KvList
        items={[
          { k: 'Row id', v: <span className="gl-tech">{String(run.id)}</span> },
          { k: 'Decision field', v: String(run.decision ?? 'open') },
          { k: 'Stored verdict', v: run.data?.verdict ? String(run.data.verdict) : 'none — still open' },
          { k: 'Check-in rows', v: String(checks.length) }
        ]}
      />
    </article>
  );
}

function DateField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <Field label={label}>
      <input className="gl-input" type="date" value={value ?? ''} onChange={(e) => onChange(e.target.value)} style={{ colorScheme: 'dark' }} />
    </Field>
  );
}

function LinkMulti({
  label,
  rows,
  ids,
  onChange,
  onOpen,
  render,
  idKey = 'title'
}: {
  label: string;
  rows: AnyRow[];
  ids: string[];
  onChange: (ids: string[]) => void;
  onOpen: (id: string) => void;
  render: (row: AnyRow) => ReactNode;
  idKey?: string;
}) {
  const [pick, setPick] = useState('');
  const available = rows.filter((r) => !ids.includes(r.id));
  return (
    <div className="exp-link">
      <div className="gl-label">{label}</div>
      {ids.length === 0 ? <span className="gl-small gl-faint">Nothing linked.</span> : null}
      {ids.map((id) => {
        const r = rows.find((x) => x.id === id);
        if (!r) return <Chip key={id}>Removed record</Chip>;
        return (
          <div className="gl-row gl-row--tight" key={id} style={{ marginBottom: 4 }}>
            <button type="button" className="gl-btn gl-btn--link gl-btn--sm" onClick={() => onOpen(id)}>
              {render(r)}
            </button>
            <IconButton label={`Unlink from ${label}`} onClick={() => onChange(ids.filter((x) => x !== id))}>
              ✕
            </IconButton>
          </div>
        );
      })}
      {available.length ? (
        <div className="gl-row gl-row--tight">
          <div style={{ flex: 1, minWidth: 170 }}>
            <Select
              value={pick}
              onChange={setPick}
              placeholder={`Link one…`}
              options={available.map((r) => ({ value: r.id, label: String(r[idKey] ?? r.name ?? r.title ?? r.id) }))}
            />
          </div>
          <Button size="sm" disabled={!pick} onClick={() => { onChange([...ids, pick]); setPick(''); }}>
            Link
          </Button>
        </div>
      ) : (
        <span className="gl-tech gl-faint">Nothing else available — that department has no rows yet.</span>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ forms */

function RunForm({
  draft,
  onSave,
  onClose,
  onUpdate
}: {
  draft: Record<string, unknown>;
  onSave: (payload: Record<string, unknown>) => Promise<void>;
  onClose: () => void;
  onCancelDraft?: () => void;
  onUpdate: (d: Record<string, unknown>) => void;
}) {
  const start = todayISO();
  const d = {
    name: '',
    category: 'general',
    prompt: '',
    protocol: '',
    cadenceDays: 7,
    days: 28,
    startOn: start,
    endOn: addDays(start, 28),
    ...draft
  };
  const set = (k: string, v: unknown) => onUpdate({ ...d, [k]: v });
  const valid = String(d.name).trim().length > 2;

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title="Design a run"
      footer={
        <>
          <span className="gl-tech gl-faint">Stored in the experiments table. Nothing starts until you log a check-in.</span>
          <div className="gl-row gl-row--tight">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!valid}
              onClick={() =>
                void onSave({
                  name: String(d.name).trim(),
                  category: String(d.category),
                  aim: String(d.prompt),
                  protocol: String(d.protocol),
                  startOn: String(d.startOn),
                  endOn: String(d.endOn),
                  baseline: '',
                  confounders: '',
                  result: '',
                  tags: [],
                  data: { cadenceDays: num(d.cadenceDays, 7), variable: '', expected: String(d.prompt) }
                })
              }
            >
              Create run
            </Button>
          </div>
        </>
      }
    >
      <div className="exp-grid">
        <Field label="Name">
          <TextInput value={String(d.name)} onChange={(v) => set('name', v)} placeholder="Short, unglamorous, specific" />
        </Field>
        <Field label="Category">
          <TextInput value={String(d.category)} onChange={(v) => set('category', v)} placeholder="skin, hair, sleep, posture…" />
        </Field>
        <DateField label="Start" value={String(d.startOn)} onChange={(v) => set('startOn', v)} />
        <DateField label="End" value={String(d.endOn)} onChange={(v) => set('endOn', v)} />
        <Field label="Check in every … days">
          <TextInput type="number" value={String(d.cadenceDays)} onChange={(v) => set('cadenceDays', num(v, 7))} />
        </Field>
        <Field label="Window length (days)" hint="Only used to prefill the end date.">
          <TextInput type="number" value={String(d.days)} onChange={(v) => { set('days', num(v, 28)); set('endOn', addDays(String(d.startOn), num(v, 28))); }} />
        </Field>
      </div>
      <Field label="Your hypothesis">
        <TextArea value={String(d.prompt)} onChange={(v) => set('prompt', v)} rows={3} placeholder="If I ______, then ______ within ______ weeks, and I will notice it by ______." />
      </Field>
      <Field label="Protocol">
        <TextArea value={String(d.protocol)} onChange={(v) => set('protocol', v)} rows={3} placeholder="Exactly what you will do, how often, and what you will hold constant." />
      </Field>
      <SafetyBanner tone="note">
        Write the end date before you start. A run with no end date is a habit with a grudge attached to it.
      </SafetyBanner>
      <Disclosure summary="What makes a self-test answerable">
        <ul className="exp-ul">
          <li>One variable. Two variables and you have a story, not a result.</li>
          <li>A way to notice: a rating, a photograph under the same conditions, a measurement, a count.</li>
          <li>A cadence you can keep while tired — adherence is the difference between an answer and an anecdote.</li>
          <li>An end date you will honour even if the answer is boring.</li>
          <li>Permission for the verdict to be “nothing happened”. That is a real result and it is one of the four options.</li>
        </ul>
      </Disclosure>
    </Modal>
  );
}

function CloseRun({ run, onDone }: { run: AnyRow; onDone: (verdict: string, result: string, rating: number) => Promise<void> }) {
  const [verdict, setVerdict] = useState('inconclusive');
  const [result, setResult] = useState(String(run.result ?? ''));
  const [rating, setRating] = useState(num(run.rating, 3));
  const chosen = VERDICTS.find((v) => v.value === verdict) ?? VERDICTS[3];
  const checks = scheduledDates(run).length;
  return (
    <div className="gl-stack">
      <p className="gl-small gl-muted">
        This is your judgement, written on your row. Nothing here compares you to anyone, converts your rating into a
        score, or decides on your behalf that the run “worked”.
      </p>
      <div className="gl-row gl-row--tight">
        {VERDICTS.map((v) => (
          <Chip key={v.value} active={verdict === v.value} onClick={() => setVerdict(v.value)} tone={v.value === 'harmful' ? 'danger' : v.value === 'worked' ? 'strong' : 'info'}>
            {v.label}
          </Chip>
        ))}
      </div>
      <p className="gl-small">{chosen.note}</p>
      <Field label="What actually happened (this is what future-you will read)">
        <TextArea value={result} onChange={setResult} rows={4} placeholder="Include the parts that do not support the verdict." />
      </Field>
      <Range label="Overall rating you would give this run" min={0} max={5} value={rating} onChange={setRating} format={(v) => `${v}/5`} />
      <p className="gl-tech gl-faint">
        {run.name}: {formatDate(run.startOn)} → {formatDate(run.endOn)} · schedule held {checks} check-in slots.
      </p>
      <Button variant="primary" onClick={() => void onDone(verdict, result, rating)}>
        Store the verdict
      </Button>
    </div>
  );
}
