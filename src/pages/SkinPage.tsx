import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowDown,
  ArrowUp,
  CalendarClock,
  Check,
  FlaskConical,
  Microscope,
  NotebookPen,
  Plus,
  Trash2
} from 'lucide-react';
import { addDays, formatDate, hardDelete, newId, restore, softDelete, todayISO } from '../db/repo';
import { TABLES, type AnyRow, type ProductRow, type RoutineStep } from '../db/schema';
import { saveRow, useRows } from '../hooks/live';
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
  Rating,
  Range,
  SafetyBanner,
  Section,
  Select,
  Stat,
  Table,
  TagInput,
  TextArea,
  TextInput,
  Toggle,
  fmtMoney,
  useToast
} from '../ui/primitives';
import { DeptIntro, EmptyPlate, IndexList, IndexRow, KvList, StatStrip, Timeline } from '../ui/editorial';
import { CompareSlider, Lightbox, PhotoPicker } from '../ui/media';
import { HeatStrip, LineChart } from '../ui/charts';
import { useImageSrc } from '../media/store';
import { INGREDIENT_REFERENCE } from '../content/ingredients';
import { analyseRoutine, applyOrder, isMorning } from '../content/actives';
import '../styles/departments/skin.css';

/**
 * SKIN & COMPLEXION LAB (spec Part 12) — an analytical bench, not a moodboard.
 * Everything on this page is a real row: skin profile, routines with ordered
 * steps, daily logs, the product shelf, dated reactions, introduction
 * experiments and progress entries. Ingredient education comes from the
 * seeded reference and is evidence-graded. Nothing here diagnoses anything.
 */

const SKIN_TYPES = ['Normal', 'Dry', 'Oily', 'Combination', 'Not sure yet'];
const SENSITIVITY = ['Low', 'Moderate', 'High — reacts easily', 'Diagnosed condition — under professional care'];
const TIMES = ['morning', 'evening', 'morning and evening', 'weekly treatment'];
const OWNERSHIP = ['own', 'want', 'tried', 'out', 'avoid'];
const REACTIONS = ['none', 'good', 'bad', 'irritation', 'breakout', 'unknown'] as const;
const DECISIONS = ['repeat', 'stop', 'extend', 'open'];

const RAIL = [
  ['baseline', '01', 'Baseline'],
  ['bench', '02', 'Routine bench'],
  ['log', '03', 'Daily record'],
  ['shelf', '04', 'Product shelf'],
  ['reference', '05', 'Ingredient reference'],
  ['intro', '06', 'Active introductions'],
  ['journal', '07', 'Reaction journal'],
  ['progress', '08', 'Progress']
] as const;

const daysBetween = (a: string, b: string) => Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
const byDateAsc = (rows: AnyRow[], key: string) => [...rows].sort((x, y) => String(x[key] ?? '').localeCompare(String(y[key] ?? '')));
const byDateDesc = (rows: AnyRow[], key: string) => byDateAsc(rows, key).reverse();
const asData = (row: AnyRow | undefined) => ((row?.data as Record<string, any>) ?? {}) as Record<string, any>;
const numOrNull = (v: unknown) => (v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v));
const shown = (v: unknown, suffix = '') =>
  v === null || v === undefined || v === '' ? 'not recorded' : `${String(v)}${suffix}`;

/** Field-by-field shelf comparison. Every absent value is spelled out as such. */
function shelfFieldRows(a: AnyRow, b: AnyRow, currency: string, reactionCount: (id: string) => number) {
  const money = (r: AnyRow) => (r.pricePaid === null || r.pricePaid === undefined ? 'not recorded' : fmtMoney(Number(r.pricePaid), String(r.currency || currency)));
  const date = (v: unknown, fallback = 'not recorded') => (v ? formatDate(String(v)) : fallback);
  return [
    { field: 'Brand', a: shown(a.brand), b: shown(b.brand) },
    { field: 'Form', a: shown(a.form), b: shown(b.form) },
    { field: 'Size on the label', a: shown(a.sizeLabel), b: shown(b.sizeLabel) },
    { field: 'Price paid', a: money(a), b: money(b) },
    { field: 'Opened', a: date(a.openedOn), b: date(b.openedOn) },
    { field: 'Expiry / PAO', a: date(a.expiresOn), b: date(b.expiresOn) },
    { field: 'Finished', a: date(a.finishedOn, 'in use'), b: date(b.finishedOn, 'in use') },
    { field: 'Your rating', a: Number(a.rating) ? `${a.rating}/5` : 'not rated', b: Number(b.rating) ? `${b.rating}/5` : 'not rated' },
    { field: 'Status', a: shown(a.status), b: shown(b.status) },
    { field: 'Reactions named', a: String(reactionCount(String(a.id))), b: String(reactionCount(String(b.id))) },
    {
      field: 'INCI list',
      a: a.ingredients ? `${String(a.ingredients).slice(0, 72)}${String(a.ingredients).length > 72 ? '…' : ''}` : 'not transcribed',
      b: b.ingredients ? `${String(b.ingredients).slice(0, 72)}${String(b.ingredients).length > 72 ? '…' : ''}` : 'not transcribed'
    }
  ];
}

const blankProfile = () => ({
  skinType: '',
  sensitivity: '',
  concerns: [] as string[],
  goals: [] as string[],
  actives: [] as string[],
  routineNotes: '',
  baselineOn: '',
  professionalCare: ''
});

function MediaImg({ row, alt }: { row?: AnyRow | null; alt?: string }) {
  const src = useImageSrc(row, 'thumb');
  if (!src) return <div className="gl-missing-img">Image unavailable offline</div>;
  return <img src={src} alt={alt ?? String(row?.title ?? 'Skin photograph')} loading="lazy" className="gl-img-treated" />;
}

function ConfirmDelete({ label, onCancel, onYes }: { label: string; onCancel: () => void; onYes: () => void }) {
  return (
    <Modal
      open
      onClose={onCancel}
      title="Delete this record?"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>Keep it</Button>
          <Button variant="danger" onClick={onYes}>
            <Trash2 size={14} /> Delete
          </Button>
        </>
      }
    >
      <p className="gl-small">
        <b className="gl-strong">{label}</b>
      </p>
      <p className="gl-small gl-muted">
        Soft deletion keeps the row recoverable in the Lab; hard deletion removes it from this device and queues the
        removal for sync. Reaction history is what makes the correlation panel useful — deleting it is permanent analysis loss.
      </p>
    </Modal>
  );
}

/* ------------------------------------------------------------------ 01 · profile */

function ProfileEditor({
  initial,
  onCancel,
  onSave
}: {
  initial: Record<string, any>;
  onCancel: () => void;
  onSave: (v: Record<string, any>) => void;
}) {
  const [f, setF] = useState<Record<string, any>>({ ...blankProfile(), ...initial });
  const set = (k: string, v: unknown) => setF((p) => ({ ...p, [k]: v }));
  return (
    <Modal
      open
      onClose={onCancel}
      title="Skin baseline — self-described"
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button variant="primary" onClick={() => onSave(f)}>
            <Check size={14} /> Save baseline
          </Button>
        </>
      }
    >
      <p className="gl-small gl-muted">
        This is your own description of your skin, stored locally. It is used to grade and order suggestions; it is not
        a diagnosis and it does not override a clinician.
      </p>
      <div className="gl-form-row">
        <Field label="How your skin behaves">
          <Select value={String(f.skinType)} onChange={(v) => set('skinType', v)} options={SKIN_TYPES.map((s) => ({ value: s, label: s }))} placeholder="— choose —" />
        </Field>
        <Field label="Reactivity">
          <Select value={String(f.sensitivity)} onChange={(v) => set('sensitivity', v)} options={SENSITIVITY.map((s) => ({ value: s, label: s }))} placeholder="— choose —" />
        </Field>
        <DateInput label="Baseline described on" value={String(f.baselineOn)} onChange={(v) => set('baselineOn', v)} />
      </div>
      <Field label="What you are tracking" hint="Your words. These label the reaction journal and the progress charts.">
        <TagInput values={f.concerns as string[]} onChange={(v) => set('concerns', v)} placeholder="texture, uneven tone, congestion…" />
      </Field>
      <Field label="What you want from the routine">
        <TagInput values={f.goals as string[]} onChange={(v) => set('goals', v)} placeholder="consistency, less flaking…" />
      </Field>
      <Field label="Actives currently in use" hint="One entry per product class — used by the one-active-at-a-time guardrail.">
        <TagInput values={f.actives as string[]} onChange={(v) => set('actives', v)} placeholder="retinoid, vitamin C, BHA…" />
      </Field>
      <Field label="Notes on the routine itself">
        <TextArea value={String(f.routineNotes ?? '')} onChange={(v) => set('routineNotes', v)} rows={3} placeholder="Hard water, hot showers, mask wear — anything that changes what your skin tolerates." />
      </Field>
      <Field label="Professional care, if any" hint="Who sees you and what they directed. Never a conclusion drawn here.">
        <TextArea value={String(f.professionalCare ?? '')} onChange={(v) => set('professionalCare', v)} rows={2} placeholder="e.g. Reviewed March — directed a 3-month course, follow-up in September" />
      </Field>
    </Modal>
  );
}

/* ------------------------------------------------------------------ 02 · routines */

function StepRow({
  step,
  index,
  products,
  onMove,
  onRemove
}: {
  step: Record<string, any>;
  index: number;
  products: AnyRow[];
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  return (
    <div className="gl-inset sk-step">
      <div className="gl-row gl-row--between" style={{ alignItems: 'baseline' }}>
        <div className="sk-step__no">{index + 1}</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="gl-serif" style={{ fontSize: '1.08rem', color: 'var(--glow-text-strong)' }}>{String(step.label) || 'Untitled step'}</div>
          <div className="gl-small gl-muted">{String(step.detail || 'no detail recorded')}{step.durationMin ? ` · ${step.durationMin} min` : ''}</div>
          <div className="gl-row gl-row--tight" style={{ marginTop: 8 }}>
            <Chip tone={step.productId ? 'info' : undefined}>{products.find((p) => p.id === step.productId)?.name ?? 'no product linked'}</Chip>
            {step.skipIf ? <Chip tone="limited">skip if: {String(step.skipIf)}</Chip> : null}
          </div>
        </div>
        <div className="gl-row gl-row--tight">
          <IconButton label="Move earlier" onClick={() => onMove(-1)}>
            <ArrowUp size={13} />
          </IconButton>
          <IconButton label="Move later" onClick={() => onMove(1)}>
            <ArrowDown size={13} />
          </IconButton>
          <IconButton label="Remove step" tone="danger" onClick={onRemove}>
            <Trash2 size={13} />
          </IconButton>
        </div>
      </div>
    </div>
  );
}

function NewStepForm({ products, onAdd }: { products: AnyRow[]; onAdd: (s: Record<string, any>) => void }) {
  const [s, setS] = useState<Record<string, any>>({ label: '', detail: '', productId: '', durationMin: '1', skipIf: '' });
  const set = (k: string, v: unknown) => setS((p) => ({ ...p, [k]: v }));
  return (
    <div className="sk-newstep">
      <CardHead eyebrow="Add a step" title="Order matters — it is saved as step order" />
      <div className="gl-form-row">
        <Field label="Step">
          <TextInput value={s.label} onChange={(v) => set('label', v)} placeholder="e.g. Second cleanse" />
        </Field>
        <Field label="Link a shelf product">
          <Select value={String(s.productId)} onChange={(v) => set('productId', v)} options={products.map((p) => ({ value: p.id, label: p.name }))} placeholder="— none —" />
        </Field>
        <Field label="Minutes">
          <TextInput type="number" value={s.durationMin} onChange={(v) => set('durationMin', v)} />
        </Field>
      </div>
      <div className="gl-form-row">
        <Field label="How you actually do it">
          <TextInput value={s.detail} onChange={(v) => set('detail', v)} placeholder="Pea-size, dry skin, avoided the eye area" />
        </Field>
        <Field label="Skip if" hint="A rule you set, not an instruction from the app.">
          <TextInput value={s.skipIf} onChange={(v) => set('skipIf', v)} placeholder="skin stings after cleansing" />
        </Field>
        <div className="gl-field">
          <span className="gl-field__label">&nbsp;</span>
          <Button
            variant="primary"
            disabled={!s.label}
            onClick={() => {
              onAdd({
                id: newId('stp'),
                order: 0,
                label: s.label,
                detail: s.detail,
                productId: s.productId || null,
                durationMin: numOrNull(s.durationMin) ?? 0,
                skipIf: s.skipIf
              });
              setS({ label: '', detail: '', productId: '', durationMin: '1', skipIf: '' });
            }}
          >
            <Plus size={13} /> Add step
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Tonight's layer check. Reads the steps and the INCI lists you already typed
 * and turns them into one nightly instruction: what is in the routine, which
 * steps actually collide, the order the layers want, and the few things worth
 * knowing about sun, fabric and attribution.
 *
 * It never edits the routine. The single write it offers is a renumbering of
 * step `order`, labelled as exactly that. Ingredient text it cannot read
 * produces no claim at all — and it says so, out loud, every time.
 */
function LayerCheck({
  routine,
  steps,
  products,
  onApplyOrder
}: {
  routine: AnyRow;
  steps: Record<string, any>[];
  products: AnyRow[];
  onApplyOrder: (ordered: Record<string, any>[]) => void;
}) {
  const analysis = useMemo(() => analyseRoutine(steps as RoutineStep[], products as ProductRow[], { today: todayISO() }), [steps, products]);
  const morning = isMorning(String(routine.timeOfDay ?? ''));
  const wanted = morning ? analysis.layering.am : analysis.layering.pm;
  const wantedLabel = morning ? 'morning' : 'evening';
  const proposed = useMemo(() => applyOrder(steps as RoutineStep[], wanted) as Record<string, any>[], [steps, wanted]);
  const current = useMemo(() => applyOrder(steps as RoutineStep[], []), [steps]);
  const differs = proposed.some((s, i) => s.id !== current[i]?.id);

  if (!steps.length) {
    return (
      <div className="sk-check sk-check--empty">
        <CardHead eyebrow="Tonight's layer check" title="Nothing to check yet" sub="This reads the steps below. Add one and it reads them again." />
      </div>
    );
  }

  return (
    <div className="sk-check">
      <CardHead
        eyebrow="Tonight's layer check"
        title={analysis.conflicts.length ? `${analysis.conflicts.length} layering ${analysis.conflicts.length === 1 ? 'clash' : 'clashes'} in this routine` : 'No layering clash in these steps'}
        sub={`${analysis.readSteps} of ${steps.length} step(s) had an ingredient list to read · ${analysis.actives.length} active ${analysis.actives.length === 1 ? 'family' : 'families'} recognised`}
        right={
          differs ? (
            <Button size="sm" onClick={() => onApplyOrder(proposed)} title="Renumbers the steps to the order below">
              <Check size={13} /> Apply {wantedLabel} order
            </Button>
          ) : null
        }
      />

      {differs ? (
        <p className="gl-small gl-faint sk-check__write">
          <b className="gl-strong">Apply {wantedLabel} order</b> writes new <code>order</code> numbers onto these steps — the
          one change this panel can make. No step is added, removed, unlinked or reworded, and you can move them back by hand.
        </p>
      ) : null}

      {analysis.actives.length ? (
        <div className="sk-actives">
          {analysis.actives.map((a) => (
            <div key={a.key} className="sk-active">
              <div className="gl-row gl-row--tight" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
                <Chip tone="info">{a.label}</Chip>
                <EvidenceChip grade={a.evidence} />
              </div>
              <p className="gl-small gl-muted">{a.why}</p>
              <p className="gl-tech sk-active__words">{a.aliases.slice(0, 3).join(' · ')}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="gl-small gl-muted">No active family was recognised in the words available. That is not an all-clear — see the limits at the bottom of this panel.</p>
      )}

      {analysis.conflicts.length ? (
        <div className="sk-conflicts">
          {analysis.conflicts.map((c) => (
            <div key={c.id} className="sk-conflict">
              <div className="gl-row gl-row--tight" style={{ alignItems: 'center' }}>
                <span className="gl-tech sk-conflict__when">{c.when}</span>
                <Chip tone={c.basis === 'established' ? 'weak' : 'limited'}>{c.basis === 'established' ? 'Well-established layering rule' : 'Cautious practice, not a hard rule'}</Chip>
              </div>
              <p className="gl-small">{c.text}</p>
              <p className="gl-tech sk-conflict__pair">
                step {stepNo(steps, c.a.stepId)} ↔ step {stepNo(steps, c.b.stepId)}
              </p>
            </div>
          ))}
        </div>
      ) : null}

      {analysis.prescriptions.map((p) => (
        <SafetyBanner key={p.name} tone="warn" title={`Prescription-level name: ${p.name}`}>
          <p className="gl-small">
            {p.line}{' '}
            <Link to="/services" className="gl-btn gl-btn--sm gl-btn--ghost" style={{ marginLeft: 8 }}>
              Find professional care
            </Link>
          </p>
        </SafetyBanner>
      ))}

      <div className="sk-orders">
        <div className="sk-ordercol">
          <div className="gl-tech sk-ordercol__head">Morning</div>
          <ol className="sk-order sk-order--check">
            {analysis.layering.am.map((i, n) => (
              <li key={i.stepId}>
                <span className="sk-order__no">{n + 1}</span>
                <span className="sk-order__label">{i.label}</span>
                <Chip tone={i.group === 'unplaced' ? 'limited' : 'info'}>{i.groupLabel}</Chip>
                <span className="gl-small gl-muted sk-order__note">{i.note}</span>
              </li>
            ))}
            {!analysis.layering.am.length ? <li className="gl-small gl-faint">Nothing here belongs to the morning order.</li> : null}
          </ol>
        </div>
        <div className="sk-ordercol">
          <div className="gl-tech sk-ordercol__head">Evening</div>
          <ol className="sk-order sk-order--check">
            {analysis.layering.pm.map((i, n) => (
              <li key={i.stepId}>
                <span className="sk-order__no">{n + 1}</span>
                <span className="sk-order__label">{i.label}</span>
                <Chip tone={i.group === 'unplaced' ? 'limited' : 'info'}>{i.groupLabel}</Chip>
                <span className="gl-small gl-muted sk-order__note">{i.note}</span>
              </li>
            ))}
            {!analysis.layering.pm.length ? <li className="gl-small gl-faint">Nothing here belongs to the evening order.</li> : null}
          </ol>
        </div>
      </div>

      {analysis.notes.length ? (
        <ul className="sk-notes">
          {analysis.notes.map((n) => (
            <li key={`${n.key}-${n.text.slice(0, 12)}`}>
              <span className="gl-tech sk-notes__k">{NOTE_LABEL[n.key]}</span>
              <span className="gl-small">{n.text}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="sk-limits">
        <div className="gl-tech">What this cannot see</div>
        <ul>
          {analysis.limits.map((l) => (
            <li key={l} className="gl-small gl-muted">
              {l}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

const NOTE_LABEL: Record<'sun' | 'bleach' | 'one-at-a-time' | 'patch-test' | 'unread', string> = {
  sun: 'Sun',
  bleach: 'Fabric',
  'one-at-a-time': 'Attribution',
  'patch-test': 'Patch test',
  unread: 'Blind spot'
};

const stepNo = (steps: Record<string, any>[], id: string) => {
  const sorted = [...steps].sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0));
  return sorted.findIndex((s) => String(s.id) === id) + 1;
};

function RoutineEditor({
  routine,
  steps,
  products,
  onClose,
  onPersist,
  onDelete,
  onSchedule
}: {
  routine: AnyRow;
  steps: Record<string, any>[];
  products: AnyRow[];
  onClose: () => void;
  onPersist: (changes: { name?: string; timeOfDay?: string; active?: boolean; steps: Record<string, any>[] }) => void;
  onDelete: () => void;
  onSchedule: (freq: string, interval: number, start: string) => void;
}) {
  const [freq, setFreq] = useState('daily');
  const [interval, setInterval_] = useState('1');
  const [start, setStart] = useState(addDays(todayISO(), 1));
  const [confirming, setConfirming] = useState(false);
  const total = steps.reduce((sum, s) => sum + Number(s.durationMin || 0), 0);

  const move = (i: number, dir: -1 | 1) => {
    const next = [...steps];
    const j = i + dir;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j], next[i]];
    onPersist({ steps: next.map((s, k) => ({ ...s, order: k + 1 })) });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={routine.name || 'Routine'}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button variant="danger" onClick={() => setConfirming(true)}>
            <Trash2 size={13} /> Delete routine
          </Button>
        </>
      }
    >
      <div className="gl-form-row">
        <Field label="Name">
          <TextInput value={String(routine.name ?? '')} onChange={(v) => onPersist({ name: v, steps })} />
        </Field>
        <Field label="When">
          <Select value={String(routine.timeOfDay)} onChange={(v) => onPersist({ timeOfDay: v, steps })} options={TIMES.map((t) => ({ value: t, label: t }))} />
        </Field>
        <div className="gl-field">
          <span className="gl-field__label">Active</span>
          <Toggle checked={Boolean(routine.active)} onChange={(v) => onPersist({ active: v, steps })} label={routine.active ? 'In use' : 'Paused'} />
        </div>
      </div>

      <div className="gl-row gl-row--between" style={{ margin: '6px 0 10px' }}>
        <span className="gl-tech">{steps.length} step(s) · {total} min total</span>
        <span className="gl-tech">Order is persisted to the row</span>
      </div>

      <div className="gl-stack" style={{ gap: 10 }}>
        {steps.map((s, i) => (
          <StepRow
            key={String(s.id)}
            step={s}
            index={i}
            products={products}
            onMove={(dir) => move(i, dir)}
            onRemove={() => onPersist({ steps: steps.filter((x) => x.id !== s.id).map((x, k) => ({ ...x, order: k + 1 })) })}
          />
        ))}
        {!steps.length ? <EmptyState title="No steps yet" body="A routine with zero steps cannot be logged honestly, so nothing is assumed for you." /> : null}
      </div>

      <div style={{ height: 16 }} />
      <LayerCheck routine={routine} steps={steps} products={products} onApplyOrder={(ordered) => onPersist({ steps: ordered })} />
      <div style={{ height: 16 }} />
      <NewStepForm products={products} onAdd={(s) => onPersist({ steps: [...steps, { ...s, order: steps.length + 1 }] })} />

      <div style={{ height: 18 }} />
      <CardHead eyebrow="Cadence" title="Put it on the calendar" sub="Writes a real recurring event with this routine's steps as its checklist." />
      <div className="sk-sched">
        <Field label="Repeat">
          <Select value={freq} onChange={setFreq} options={[{ value: 'daily', label: 'Daily' }, { value: 'weekly', label: 'Weekly' }, { value: 'monthly', label: 'Monthly' }]} />
        </Field>
        <Field label="Every">
          <TextInput type="number" value={interval} onChange={setInterval_} />
        </Field>
        <DateInput label="First occurrence" value={start} onChange={setStart} />
        <div className="gl-field">
          <span className="gl-field__label">&nbsp;</span>
          <Button
            onClick={() => onSchedule(freq, Math.max(1, Number(interval) || 1), start)}
            disabled={!steps.length}
          >
            <CalendarClock size={13} /> Schedule
          </Button>
        </div>
      </div>

      {confirming ? (
        <Modal
          open
          onClose={() => setConfirming(false)}
          title="Delete this routine?"
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirming(false)}>Keep it</Button>
              <Button variant="danger" onClick={onDelete}>
                <Trash2 size={13} /> Delete routine
              </Button>
            </>
          }
        >
          <p className="gl-small gl-muted">
            Logs already recorded stay in the table — they are your history — but the step definitions go with the routine.
          </p>
        </Modal>
      ) : null}
    </Modal>
  );
}

/* ------------------------------------------------------------------ 03 · daily log */

function LogEditor({
  routine,
  steps,
  existing,
  products,
  onCancel,
  onSave
}: {
  routine: AnyRow;
  steps: Record<string, any>[];
  existing?: AnyRow;
  products: AnyRow[];
  onCancel: () => void;
  onSave: (v: { doneOn: string; completedSteps: string[]; mood: number; note: string }) => void;
}) {
  const [doneOn, setDoneOn] = useState(String(existing?.doneOn ?? todayISO()));
  const [completed, setCompleted] = useState<string[]>(() =>
    existing ? ((existing.completedSteps as string[]) ?? []) : steps.map((s) => String(s.id))
  );
  const [mood, setMood] = useState(Number(existing?.mood ?? 3));
  const [note, setNote] = useState(String(existing?.note ?? ''));
  return (
    <Modal
      open
      onClose={onCancel}
      title={existing ? 'Edit this session' : 'Log a session'}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button variant="primary" onClick={() => onSave({ doneOn, completedSteps: completed, mood, note })}>
            <Check size={14} /> {existing ? 'Update log' : 'Save log'}
          </Button>
        </>
      }
    >
      <div className="gl-form-row">
        <DateInput label="Date" value={doneOn} onChange={setDoneOn} />
        <Field label="Session">
          <span className="gl-serif" style={{ fontSize: '1.05rem' }}>{routine.name}</span>
        </Field>
      </div>
      <span className="gl-field__label">Steps actually completed</span>
      <div className="sk-checks">
        {steps.map((s) => {
          const on = completed.includes(String(s.id));
          return (
            <label key={String(s.id)} className="sk-check" data-on={on}>
              <input
                type="checkbox"
                checked={on}
                onChange={() => setCompleted((p) => (on ? p.filter((x) => x !== String(s.id)) : [...p, String(s.id)]))}
              />
              <span>
                <b>{String(s.label)}</b>
                {s.productId ? <em className="gl-tech"> {products.find((p) => p.id === s.productId)?.name ?? ''}</em> : null}
                {s.skipIf ? <em className="gl-faint"> · skip rule: {String(s.skipIf)}</em> : null}
              </span>
            </label>
          );
        })}
        {!steps.length ? <p className="gl-small gl-faint">This routine has no steps yet — add them in the bench first.</p> : null}
      </div>
      <div className="gl-form-row" style={{ marginTop: 'var(--glow-sp-4)' }}>
        <Field label="How your skin felt after" hint="0 = tight and irritated, 5 = calm">
          <Range value={mood} min={0} max={5} onChange={setMood} label="Comfort" />
        </Field>
      </div>
      <Field label="Note">
        <TextArea value={note} onChange={setNote} rows={3} placeholder="Sting on the cheekbones for 20 seconds. Skipped step 3." />
      </Field>
      {completed.length < steps.length && steps.length > 0 ? (
        <div style={{ marginTop: 'var(--glow-sp-3)' }}>
          <SafetyBanner tone="note" title="Partial sessions still count">
            The adherence figure below is computed from completed steps, not from whether you showed up. An incomplete
            session logged honestly is worth more than a perfect one invented later.
          </SafetyBanner>
        </div>
      ) : null}
    </Modal>
  );
}

/* ------------------------------------------------------------------ 04 · products */

function ProductEditor({
  initial,
  currency,
  onCancel,
  onSave
}: {
  initial: Record<string, any>;
  currency: string;
  onCancel: () => void;
  onSave: (v: Record<string, any>) => void;
}) {
  const [f, setF] = useState<Record<string, any>>(initial);
  const set = (k: string, v: unknown) => setF((p) => ({ ...p, [k]: v }));
  return (
    <Modal
      open
      onClose={onCancel}
      title={f.id ? 'Edit shelf entry' : 'New shelf entry'}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button variant="primary" disabled={!f.name} onClick={() => onSave(f)}>
            <Check size={14} /> Save to shelf
          </Button>
        </>
      }
    >
      <p className="gl-small gl-muted">
        Record the label exactly as it is on your bottle — including the ingredients you can actually read. No product
        data is fetched, guessed or invented here.
      </p>
      <div className="gl-form-row">
        <Field label="Product name">
          <TextInput value={String(f.name ?? '')} onChange={(v) => set('name', v)} />
        </Field>
        <Field label="Brand as written on the pack">
          <TextInput value={String(f.brand ?? '')} onChange={(v) => set('brand', v)} />
        </Field>
        <Field label="Form">
          <TextInput value={String(f.form ?? '')} onChange={(v) => set('form', v)} placeholder="gel cleanser, emulsion, aqueous serum…" />
        </Field>
        <Field label="Size on the label">
          <TextInput value={String(f.sizeLabel ?? '')} onChange={(v) => set('sizeLabel', v)} placeholder="50 ml" />
        </Field>
      </div>
      <div className="gl-form-row">
        <Field label="Status">
          <Select value={String(f.status)} onChange={(v) => set('status', v)} options={OWNERSHIP.map((o) => ({ value: o, label: o }))} />
        </Field>
        <Field label="Price you paid" hint="Blank stays blank — the shelf never estimates.">
          <TextInput type="number" value={f.pricePaid ?? ''} onChange={(v) => set('pricePaid', v)} />
        </Field>
        <Field label="Currency">
          <TextInput value={String(f.currency || currency)} onChange={(v) => set('currency', v)} />
        </Field>
        <div className="gl-field">
          <span className="gl-field__label">On the shelf</span>
          <Toggle checked={Boolean(f.owned)} onChange={(v) => set('owned', v)} label={f.owned ? 'Owned' : 'Not owned'} />
        </div>
      </div>
      <div className="gl-form-row">
        <DateInput label="Opened on" value={String(f.openedOn ?? '')} onChange={(v) => set('openedOn', v)} />
        <DateInput label="Expires / PAO ends" value={String(f.expiresOn ?? '')} onChange={(v) => set('expiresOn', v)} />
        <DateInput label="Finished on" value={String(f.finishedOn ?? '')} onChange={(v) => set('finishedOn', v)} />
      </div>
      <Field label="Ingredients as listed" hint="Paste or type the INCI list you can read. Used for the combine-with check.">
        <TextArea value={String(f.ingredients ?? '')} onChange={(v) => set('ingredients', v)} rows={3} placeholder="Aqua, Glycerin, Niacinamide, ..." />
      </Field>
      <div className="gl-form-row">
        <Field label="Your rating" hint="1–5, yours alone.">
          <Rating value={Number(f.rating ?? 0)} onChange={(v) => set('rating', v)} />
        </Field>
        <Field label="Where it came from" hint="A URL you typed, not a link we generated.">
          <TextInput value={String(f.sourceUrl ?? '')} onChange={(v) => set('sourceUrl', v)} placeholder="optional" />
        </Field>
      </div>
      <Field label="Duplicate key" hint="Same brand + name means the shelf flags a possible duplicate instead of hiding it.">
        <TextInput value={String(f.duplicateKey ?? '')} onChange={(v) => set('duplicateKey', v)} placeholder={`${String(f.brand ?? '').toLowerCase()}-${String(f.name ?? '').toLowerCase()}`} />
      </Field>
    </Modal>
  );
}

/* ------------------------------------------------------------------ 05 · ingredient reference */

function IngredientDetail({
  ing,
  onCancel,
  onSaveNote
}: {
  ing: (typeof INGREDIENT_REFERENCE)[number];
  onCancel: () => void;
  onSaveNote: (ing: (typeof INGREDIENT_REFERENCE)[number]) => void;
}) {
  return (
    <Modal
      open
      onClose={onCancel}
      title={ing.name}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>Close</Button>
          <Button variant="primary" onClick={() => onSaveNote(ing)}>
            <NotebookPen size={13} /> Keep a copy in Knowledge
          </Button>
        </>
      }
    >
      <div className="gl-row gl-row--tight" style={{ marginBottom: 'var(--glow-sp-4)' }}>
        <EvidenceChip grade={ing.evidenceGrade} />
        {ing.family.map((fam) => (
          <Chip key={fam} tone="info">{fam}</Chip>
        ))}
      </div>
      <KvList
        items={[
          { k: 'What it is used for', v: ing.purpose },
          { k: 'What the evidence supports', v: ing.evidence },
          { k: 'Combining', v: ing.combine },
          { k: 'Introduction cadence', v: ing.introduce }
        ]}
      />
      {ing.cautions.length ? (
        <div style={{ marginTop: 'var(--glow-sp-4)' }}>
          <div className="gl-eyebrow">Cautions</div>
          <ul className="gl-list sk-cautions">
            {ing.cautions.map((c) => (
              <li key={c} className="gl-list__row">{c}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="gl-small gl-faint" style={{ marginTop: 'var(--glow-sp-4)' }}>No specific caution recorded in the reference entry.</p>
      )}
      <div style={{ marginTop: 'var(--glow-sp-4)' }}>
        <SafetyBanner tone="warn" title="When a professional is needed">
          {ing.professional}
        </SafetyBanner>
      </div>
      <p className="gl-small gl-faint" style={{ marginTop: 'var(--glow-sp-3)' }}>
        This is general education from the built-in reference. It is not a recommendation to buy or use anything, and it
        cannot account for your own skin, other products, medication or pregnancy.
      </p>
    </Modal>
  );
}

/* ------------------------------------------------------------------ 06 · introduction experiments */

function ExperimentEditor({
  initial,
  products,
  techniques,
  media,
  onAttach,
  onCancel,
  onSave
}: {
  initial: Record<string, any>;
  products: AnyRow[];
  techniques: AnyRow[];
  media: AnyRow[];
  onAttach: (rows: AnyRow[]) => void;
  onCancel: () => void;
  onSave: (v: Record<string, any>) => void;
}) {
  const [f, setF] = useState<Record<string, any>>(initial);
  const set = (k: string, v: unknown) => setF((p) => ({ ...p, [k]: v }));
  const obs = (f.observations as AnyRow[]) ?? [];
  return (
    <Modal
      open
      onClose={onCancel}
      title={f.id ? 'Edit introduction log' : 'New introduction log'}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button variant="primary" disabled={!f.name} onClick={() => onSave(f)}>
            <Check size={14} /> Save protocol
          </Button>
        </>
      }
    >
      <p className="gl-small gl-muted">
        One new active at a time, at its own introduction cadence, with dated observations. If two things change on the
        same day you cannot attribute anything to either — that is what the confounders field is for.
      </p>
      <div className="gl-form-row">
        <Field label="What you are introducing">
          <TextInput value={String(f.name ?? '')} onChange={(v) => set('name', v)} placeholder="e.g. Adapalene 0.1%, 2 nights a week" />
        </Field>
        <Field label="Aim">
          <TextInput value={String(f.aim ?? '')} onChange={(v) => set('aim', v)} placeholder="Texture, over 12 weeks, without stinging" />
        </Field>
      </div>
      <div className="gl-form-row">
        <DateInput label="Start" value={String(f.startOn ?? '')} onChange={(v) => set('startOn', v)} />
        <DateInput label="Review on" value={String(f.endOn ?? '')} onChange={(v) => set('endOn', v)} />
        <Field label="Product under test">
          <Select value={String(f.productId ?? '')} onChange={(v) => set('productId', v)} options={products.map((p) => ({ value: p.id, label: p.name }))} placeholder="— none —" />
        </Field>
      </div>
      <Field label="Baseline — what the skin looked like before">
        <TextArea value={String(f.baseline ?? '')} onChange={(v) => set('baseline', v)} rows={2} placeholder="Describe it in your own words; attach a standardised photograph below." />
      </Field>
      <div className="gl-row gl-row--tight" style={{ marginBottom: 'var(--glow-sp-4)' }}>
        {media.map((m) => {
          const ids = (f.baselineMediaIds as string[]) ?? [];
          const on = ids.includes(m.id);
          return (
            <Chip key={m.id} active={on} title="Baseline photograph" onClick={() => set('baselineMediaIds', on ? ids.filter((x) => x !== m.id) : [...ids, m.id])}>
              {m.title || formatDate(String(m.takenOn))}
            </Chip>
          );
        })}
        <PhotoPicker
          kind="baseline"
          album="Skin Lab"
          label="Add baseline photo"
          withConditions
          onPick={(rows) => {
            onAttach(rows);
            set('baselineMediaIds', [...((f.baselineMediaIds as string[]) ?? []), ...rows.map((r) => r.id)]);
          }}
        />
      </div>

      <Field label="Protocol — exactly how you will introduce it">
        <TextArea value={String(f.protocol ?? '')} onChange={(v) => set('protocol', v)} rows={3} placeholder="Pea-size, dry skin, every third night for 2 weeks, then alternate nights if no stinging." />
      </Field>

      <Field label="Reference techniques in play">
        <div className="gl-row gl-row--tight" style={{ flexWrap: 'wrap' }}>
          {techniques.map((t) => {
            const ids = (f.techniqueIds as string[]) ?? [];
            const on = ids.includes(t.id);
            return (
              <Chip key={t.id} active={on} title={String(t.evidence)} onClick={() => set('techniqueIds', on ? ids.filter((x) => x !== t.id) : [...ids, t.id])}>
                {String(t.title).slice(0, 30)}
              </Chip>
            );
          })}
          {!techniques.length ? <span className="gl-small gl-faint">Evidence library not seeded yet — open the Evidence Center once.</span> : null}
        </div>
      </Field>

      <CardHead eyebrow="Dated observations" title="Log as you go" sub="Nothing is auto-filled. Each entry is a day you actually looked." />
      <div className="gl-stack" style={{ gap: 8 }}>
        {obs.map((o, i) => (
          <div key={`${String(o.on)}-${i}`} className="gl-inset sk-obs">
            <div className="gl-row gl-row--between">
              <span className="gl-tech">{formatDate(String(o.on))}</span>
              <IconButton label="Remove observation" tone="danger" onClick={() => set('observations', obs.filter((_, j) => j !== i))}>
                <Trash2 size={12} />
              </IconButton>
            </div>
            <div className="gl-small">{String(o.note)}</div>
            {o.rating !== null && o.rating !== undefined ? <Rating value={Number(o.rating)} /> : null}
          </div>
        ))}
        {!obs.length ? <p className="gl-small gl-faint">No observations yet.</p> : null}
      </div>
      <div className="gl-form-row" style={{ marginTop: 'var(--glow-sp-3)' }}>
        <DateInput label="Observation date" value={String(f.obsOn ?? todayISO())} onChange={(v) => set('obsOn', v)} />
        <Field label="What you saw">
          <TextInput value={String(f.obsNote ?? '')} onChange={(v) => set('obsNote', v)} placeholder="Week 3 — flaking at the jaw, no stinging" />
        </Field>
        <Field label="Comfort 0–5">
          <Range value={Number(f.obsRating ?? 3)} min={0} max={5} onChange={(v) => set('obsRating', v)} />
        </Field>
        <div className="gl-field">
          <span className="gl-field__label">&nbsp;</span>
          <Button
            disabled={!f.obsNote}
            onClick={() =>
              set('observations', [...obs, { on: String(f.obsOn ?? todayISO()), note: String(f.obsNote), mediaIds: [] as string[], rating: numOrNull(f.obsRating) }])
            }
          >
            <Plus size={13} /> Add observation
          </Button>
        </div>
      </div>

      <div style={{ height: 18 }} />
      <div className="gl-form-row">
        <Field label="Outcome at review">
          <TextArea value={String(f.result ?? '')} onChange={(v) => set('result', v)} rows={2} placeholder="Where it landed after the agreed period." />
        </Field>
        <Field label="Confounders" hint="Sun, travel, stress, another product — say it plainly.">
          <TextArea value={String(f.confounders ?? '')} onChange={(v) => set('confounders', v)} rows={2} />
        </Field>
      </div>
      <div className="gl-form-row">
        <Field label="Overall rating">
          <Rating value={Number(f.rating ?? 0)} onChange={(v) => set('rating', v)} />
        </Field>
        <Field label="Decision">
          <Select value={String(f.decision)} onChange={(v) => set('decision', v)} options={DECISIONS.map((d) => ({ value: d, label: d }))} />
        </Field>
        <Field label="Result photographs">
          <div className="gl-row gl-row--tight" style={{ flexWrap: 'wrap' }}>
            {media.map((m) => {
              const ids = (f.resultMediaIds as string[]) ?? [];
              const on = ids.includes(m.id);
              return (
                <Chip key={m.id} active={on} onClick={() => set('resultMediaIds', on ? ids.filter((x) => x !== m.id) : [...ids, m.id])}>
                  {m.title || formatDate(String(m.takenOn))}
                </Chip>
              );
            })}
          </div>
        </Field>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ 07 · observations */

function ObservationEditor({
  initial,
  products,
  media,
  onAttach,
  onCancel,
  onSave
}: {
  initial: Record<string, any>;
  products: AnyRow[];
  media: AnyRow[];
  onAttach: (rows: AnyRow[]) => void;
  onCancel: () => void;
  onSave: (v: Record<string, any>) => void;
}) {
  const [f, setF] = useState<Record<string, any>>(initial);
  const set = (k: string, v: unknown) => setF((p) => ({ ...p, [k]: v }));
  const ids = (f.mediaIds as string[]) ?? [];
  return (
    <Modal
      open
      onClose={onCancel}
      title={f.id ? 'Edit reaction entry' : 'New reaction entry'}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button variant="primary" disabled={!f.note} onClick={() => onSave(f)}>
            <Check size={14} /> Save entry
          </Button>
        </>
      }
    >
      <p className="gl-small gl-muted">
        Describe what you see and when it appeared. Naming a product is a record of timing, not proof of cause — the
        journal never concludes anything about your skin.
      </p>
      <div className="gl-form-row">
        <DateInput label="Observed on" value={String(f.on ?? todayISO())} onChange={(v) => set('on', v)} />
        <Field label="What happened">
          <Select value={String(f.reaction)} onChange={(v) => set('reaction', v)} options={REACTIONS.map((r) => ({ value: r, label: r }))} />
        </Field>
        <Field label="Suspected product" hint="Timing link only.">
          <Select value={String(f.subjectId ?? '')} onChange={(v) => set('subjectId', v)} options={products.map((p) => ({ value: p.id, label: p.name }))} placeholder="— none named —" />
        </Field>
      </div>
      <Field label="What it looks like, where, and for how long">
        <TextArea value={String(f.note ?? '')} onChange={(v) => set('note', v)} rows={3} placeholder="Small rough patches at the corners of the mouth, appeared the morning after, stings with plain water." />
      </Field>
      <Field label="Severity" hint="Your own scale. It is only ever compared with your other entries.">
        <Range value={Number(f.severity ?? 2)} min={0} max={10} onChange={(v) => set('severity', v)} label="Severity" format={(v) => `${v}/10`} />
      </Field>
      <Field label="Photographs" hint="Attached to this entry with the conditions you recorded.">
        <div className="sk-attach">
          {ids.length ? (
            ids.map((id: string) => {
              const m = media.find((x: AnyRow) => x.id === id);
              return (
                <Chip key={id} active onClick={() => set('mediaIds', ids.filter((x: string) => x !== id))}>
                  {m ? `${m.title || formatDate(String(m.takenOn))} ✕` : `${id} ✕`}
                </Chip>
              );
            })
          ) : (
            <span className="gl-small gl-faint">No photographs attached to this entry.</span>
          )}
        </div>
      </Field>
      <div style={{ marginTop: 'var(--glow-sp-3)' }}>
        <PhotoPicker
          kind="progress"
          album="Skin Lab"
          label="Capture & attach"
          withConditions
          onPick={(rows) => {
            onAttach(rows);
            set('mediaIds', [...ids, ...rows.map((r) => r.id)]);
          }}
        />
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ 08 · progress */

function ProgressEditor({
  initial,
  goals,
  experiments,
  media,
  onAttach,
  onCancel,
  onSave
}: {
  initial: Record<string, any>;
  goals: AnyRow[];
  experiments: AnyRow[];
  media: AnyRow[];
  onAttach: (rows: AnyRow[]) => void;
  onCancel: () => void;
  onSave: (v: Record<string, any>) => void;
}) {
  const [f, setF] = useState<Record<string, any>>(initial);
  const set = (k: string, v: unknown) => setF((p) => ({ ...p, [k]: v }));
  const ids = (f.mediaIds as string[]) ?? [];
  return (
    <Modal
      open
      onClose={onCancel}
      title={f.id ? 'Edit progress entry' : 'New progress entry'}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button variant="primary" disabled={!f.label} onClick={() => onSave(f)}>
            <Check size={14} /> Save entry
          </Button>
        </>
      }
    >
      <div className="gl-form-row">
        <Field label="Entry">
          <TextInput value={String(f.label ?? '')} onChange={(v) => set('label', v)} placeholder="Week 8 — texture at the cheek" />
        </Field>
        <DateInput label="On" value={String(f.on ?? todayISO())} onChange={(v) => set('on', v)} />
      </div>
      <div className="gl-form-row">
        <Field label="Metric" hint="Name it yourself: comfort, flaking days, sessions.">
          <TextInput value={String(f.metric ?? '')} onChange={(v) => set('metric', v)} placeholder="stinging episodes" />
        </Field>
        <Field label="Value">
          <TextInput type="number" value={f.value ?? ''} onChange={(v) => set('value', v)} />
        </Field>
        <Field label="Unit">
          <TextInput value={String(f.unit ?? '')} onChange={(v) => set('unit', v)} placeholder="per week" />
        </Field>
        <Field label="Self rating">
          <Rating value={Number(f.rating ?? 0)} onChange={(v) => set('rating', v)} />
        </Field>
      </div>
      <Field label="Note">
        <TextArea value={String(f.note ?? '')} onChange={(v) => set('note', v)} rows={3} placeholder="What changed, what you changed, what you would not repeat." />
      </Field>
      <div className="gl-form-row">
        <Field label="Linked goal">
          <Select value={String(f.linkedGoalId ?? '')} onChange={(v) => set('linkedGoalId', v)} options={goals.map((g) => ({ value: g.id, label: String(g.title) }))} placeholder="— none —" />
        </Field>
        <Field label="Linked introduction">
          <Select value={String(f.linkedExperimentId ?? '')} onChange={(v) => set('linkedExperimentId', v)} options={experiments.map((e) => ({ value: e.id, label: String(e.name) }))} placeholder="— none —" />
        </Field>
        <Field label="Photographs" hint="Standardised conditions or the comparison means nothing.">
          <div className="gl-row gl-row--tight" style={{ flexWrap: 'wrap' }}>
            {ids.length ? (
              ids.map((id: string) => {
                const m = media.find((x: AnyRow) => x.id === id);
                return (
                  <Chip key={id} active onClick={() => set('mediaIds', ids.filter((x: string) => x !== id))}>
                    {m ? `${m.title || formatDate(String(m.takenOn))} ✕` : `${id} ✕`}
                  </Chip>
                );
              })
            ) : (
              <span className="gl-small gl-faint">none attached</span>
            )}
            <PhotoPicker
              kind="progress"
              album="Skin Lab"
              label="Attach"
              withConditions
              onPick={(rows) => {
                onAttach(rows);
                set('mediaIds', [...ids, ...rows.map((r) => r.id)]);
              }}
            />
          </div>
        </Field>
      </div>
    </Modal>
  );
}

/* ================================================================== page */

export default function SkinPage() {
  const toast = useToast();

  /* ------------------------------------------------------------------ rows */
  const profileRows = useRows(TABLES.profile, { where: { kind: 'skin' } });
  const profile = profileRows.find((r) => r.singleton === 1) ?? profileRows[0];
  const pd = useMemo(() => ({ ...blankProfile(), ...asData(profile) }), [profile]);

  const routines = useRows(TABLES.routines, { where: { domain: 'skin' } });
  const allLogs = useRows(TABLES.routineLogs, { includeDeleted: true });
  const products = useRows(TABLES.products, { where: { category: 'skincare' }, includeDeleted: true });
  const observations = useRows(TABLES.observations, { where: { subjectType: 'skin' }, includeDeleted: true });
  const progressRows = useRows(TABLES.progressEntries, { where: { domain: 'skin' } });
  const experiments = useRows(TABLES.experiments, { where: { category: 'skin' } });
  const techniques = useRows(TABLES.techniques, { where: { domain: 'skin' } });
  const tutorials = useRows(TABLES.tutorials, { where: { domain: 'skincare' } });
  const mediaRows = useRows(TABLES.mediaItems, { where: { linkedDomain: 'skin' } });
  const goals = useRows(TABLES.goals);
  const settingsRows = useRows(TABLES.settings);
  const currency = String(((settingsRows[0]?.value as Record<string, any>) ?? {}).currency ?? 'USD');

  const liveProducts = useMemo(() => products.filter((p) => !p.deletedAt), [products]);
  const trashedProducts = useMemo(() => products.filter((p) => Boolean(p.deletedAt)), [products]);
  const liveObservations = useMemo(() => byDateDesc(observations.filter((o) => !o.deletedAt), 'on'), [observations]);
  const trashedObservations = useMemo(() => observations.filter((o) => Boolean(o.deletedAt)), [observations]);
  const media = useMemo(() => byDateDesc(mediaRows, 'takenOn'), [mediaRows]);
  const logs = useMemo(() => byDateDesc(allLogs, 'doneOn'), [allLogs]);

  /* ------------------------------------------------------------- derivations */
  const heatDays = useMemo(() => {
    const stepsByRoutine = new Map<string, number>();
    for (const r of routines) stepsByRoutine.set(r.id, ((r.steps as AnyRow[]) ?? []).length || 1);
    const byDate = new Map<string, number>();
    for (const l of logs) {
      const total = stepsByRoutine.get(String(l.routineId)) ?? 1;
      const frac = Math.min(1, ((l.completedSteps as string[]) ?? []).length / Math.max(1, total));
      byDate.set(String(l.doneOn), Math.max(byDate.get(String(l.doneOn)) ?? 0, frac));
    }
    return Array.from({ length: 91 }, (_, i) => {
      const date = addDays(todayISO(), i - 90);
      const frac = byDate.get(date) ?? 0;
      return { date, level: byDate.has(date) ? Math.round(frac * 3) : 0, title: byDate.has(date) ? `${Math.round(frac * 100)}% of steps` : 'no log' };
    });
  }, [logs, routines]);

  const last28 = useMemo(() => heatDays.slice(-28), [heatDays]);
  const adherence = Math.round((last28.filter((d) => d.level > 0).length / last28.length) * 100);
  const streak = useMemo(() => {
    let n = 0;
    for (let i = 0; i < heatDays.length; i += 1) {
      const d = heatDays[heatDays.length - 1 - i];
      if (d.level > 0) n += 1;
      else if (i > 0) break;
    }
    return n;
  }, [heatDays]);

  const moodSeries = useMemo(() => {
    const pts = logs.filter((l) => !l.deletedAt).slice(0, 30).reverse();
    return { labels: pts.map((p) => formatDate(String(p.doneOn))), series: [{ label: 'Comfort after', data: pts.map((p) => Number(p.mood ?? 0)) }] };
  }, [logs]);

  const reactionMix = useMemo(() => {
    const map = new Map<string, number>();
    for (const o of liveObservations) map.set(String(o.reaction), (map.get(String(o.reaction)) ?? 0) + 1);
    return REACTIONS.map((r) => ({ label: r, value: map.get(r) ?? 0 })).filter((x) => x.value > 0);
  }, [liveObservations]);

  /** 14-day timing association: which shelf entries were opened just before each reaction. */
  const associations = useMemo(() => {
    const rows: { on: string; note: string; reaction: string; candidates: { id: string; name: string; days: number }[] }[] = [];
    for (const o of liveObservations) {
      if (o.reaction === 'none' || o.reaction === 'good') continue;
      const candidates = liveProducts
        .filter((p) => p.openedOn && daysBetween(String(p.openedOn), String(o.on)) >= 0 && daysBetween(String(p.openedOn), String(o.on)) <= 14)
        .map((p) => ({ id: p.id, name: String(p.name), days: daysBetween(String(p.openedOn), String(o.on)) }));
      const named = o.subjectId ? liveProducts.find((p) => p.id === o.subjectId) : undefined;
      if (candidates.length || named) {
        rows.push({
          on: String(o.on),
          note: String(o.note),
          reaction: String(o.reaction),
          candidates: named && !candidates.find((c) => c.id === named.id) ? [...candidates, { id: named.id, name: String(named.name), days: 0 }] : candidates
        });
      }
    }
    return rows;
  }, [liveObservations, liveProducts]);

  const shelfValue = liveProducts.reduce((sum, p) => sum + (p.pricePaid === null || p.pricePaid === undefined ? 0 : Number(p.pricePaid)), 0);
  const openSince = (p: AnyRow) => (p.openedOn ? daysBetween(String(p.openedOn), todayISO()) : null);

  /* ------------------------------------------------------------------ state */
  const [profileOpen, setProfileOpen] = useState(false);
  const [routineEdit, setRoutineEdit] = useState<string | null>(null);
  const [logDraft, setLogDraft] = useState<{ routineId: string; logId?: string } | null>(null);
  const [pForm, setPForm] = useState<Record<string, any> | null>(null);
  const [oForm, setOForm] = useState<Record<string, any> | null>(null);
  const [xForm, setXForm] = useState<Record<string, any> | null>(null);
  const [prForm, setPrForm] = useState<Record<string, any> | null>(null);
  const [ingredient, setIngredient] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ label: string; run: () => void } | null>(null);
  const [compare, setCompare] = useState<{ a: string; b: string }>({ a: '', b: '' });
  const [statusFilter, setStatusFilter] = useState('');
  const [photoCompare, setPhotoCompare] = useState<{ before: string; after: string }>({ before: '', after: '' });
  const [lightbox, setLightbox] = useState<number | null>(null);

  /* ------------------------------------------------------------------ writers */
  const saveProfile = async (v: Record<string, any>) => {
    await saveRow(TABLES.profile, {
      id: profile?.id,
      kind: 'skin',
      singleton: 1,
      tags: (profile?.tags as string[]) ?? [],
      data: {
        skinType: v.skinType,
        sensitivity: v.sensitivity,
        concerns: v.concerns,
        goals: v.goals,
        actives: v.actives,
        routineNotes: v.routineNotes,
        baselineOn: v.baselineOn || todayISO(),
        professionalCare: v.professionalCare
      }
    });
    setProfileOpen(false);
    toast('Baseline saved to your profile.', 'ok');
  };

  const blankRoutine = async (timeOfDay: string) => {
    const saved = await saveRow(TABLES.routines, {
      name: `${timeOfDay.charAt(0).toUpperCase()}${timeOfDay.slice(1)} routine`,
      domain: 'skin',
      timeOfDay,
      active: true,
      steps: []
    });
    toast('Routine created — now define its steps.', 'ok');
    setRoutineEdit(saved.id);
  };

  /** Photographs ingested anywhere in the Lab are filed under this department. */
  const linkMedia = async (rows: AnyRow[]) => {
    for (const r of rows) {
      await saveRow(TABLES.mediaItems, { id: r.id, linkedDomain: 'skin', album: r.album || 'Skin Lab', kind: r.kind || 'progress' });
    }
  };

  const persistRoutine = async (rt: AnyRow, changes: { name?: string; timeOfDay?: string; active?: boolean; steps: Record<string, any>[] }) => {
    await saveRow(TABLES.routines, {
      id: rt.id,
      name: changes.name ?? rt.name,
      domain: 'skin',
      timeOfDay: changes.timeOfDay ?? rt.timeOfDay,
      active: changes.active ?? rt.active,
      steps: (changes.steps ?? []).map((s, i) => ({ ...s, order: i + 1 })),
      tags: (rt.tags as string[]) ?? []
    });
  };

  const scheduleRoutine = async (rt: AnyRow, freq: string, interval: number, start: string) => {
    const steps = ((rt.steps as AnyRow[]) ?? []).map((s) => ({ id: String(s.id), label: String(s.label), done: false }));
    const minutes = steps.length ? 10 : 10;
    const day = new Date(`${start}T08:00:00`);
    await saveRow(TABLES.calendarEvents, {
      id: newId('cal'),
      title: `${rt.name} — ${rt.timeOfDay || 'skin routine'}`,
      kind: 'routine',
      startAt: day.getTime(),
      endAt: day.getTime() + minutes * 60000,
      recurrence: { freq: freq as 'daily' | 'weekly' | 'monthly', interval, until: null, byweekday: [day.getDay()] },
      reminders: [60],
      checklist: steps,
      linkDomain: 'skin',
      linkId: rt.id,
      cost: null,
      doneOn: null,
      note: 'Scheduled from the Skin Lab bench.'
    });
    toast('Recurring event written to your calendar.', 'ok');
  };

  const saveLog = async (v: { doneOn: string; completedSteps: string[]; mood: number; note: string }) => {
    const existingId = logDraft?.logId;
    await saveRow(TABLES.routineLogs, {
      id: existingId,
      routineId: logDraft?.routineId ?? '',
      doneOn: v.doneOn,
      completedSteps: v.completedSteps,
      mood: v.mood,
      note: v.note,
      tags: []
    });
    setLogDraft(null);
    toast(existingId ? 'Session updated.' : 'Session logged.', 'ok');
  };

  const saveProduct = async (v: Record<string, any>) => {
    await saveRow(TABLES.products, {
      id: v.id,
      name: v.name,
      category: 'skincare',
      brand: v.brand ?? '',
      form: v.form ?? '',
      sizeLabel: v.sizeLabel ?? '',
      pricePaid: numOrNull(v.pricePaid),
      currency: v.currency || currency,
      owned: Boolean(v.owned),
      openedOn: v.openedOn || null,
      expiresOn: v.expiresOn || null,
      finishedOn: v.finishedOn || null,
      rating: Number(v.rating ?? 0),
      ingredients: v.ingredients ?? '',
      sourceUrl: v.sourceUrl ?? '',
      status: v.status ?? 'own',
      duplicateKey: v.duplicateKey || `${String(v.brand ?? '').toLowerCase().trim()}-${String(v.name ?? '').toLowerCase().trim()}`,
      tags: (v.tags as string[]) ?? [],
      data: { ...asData(products.find((p) => p.id === v.id)), notes: v.notes ?? '' }
    });
    setPForm(null);
    toast('Shelf updated.', 'ok');
  };

  const saveObservation = async (v: Record<string, any>) => {
    await saveRow(TABLES.observations, {
      id: v.id,
      subjectType: 'skin',
      subjectId: v.subjectId ?? '',
      on: v.on || todayISO(),
      note: v.note,
      reaction: v.reaction ?? 'unknown',
      severity: Number(v.severity ?? 0),
      mediaIds: (v.mediaIds as string[]) ?? [],
      tags: (v.tags as string[]) ?? ['skin-reaction']
    });
    setOForm(null);
    toast('Reaction logged.', 'ok');
  };

  const saveExperiment = async (v: Record<string, any>) => {
    await saveRow(TABLES.experiments, {
      id: v.id,
      name: v.name,
      category: 'skin',
      aim: v.aim ?? '',
      startOn: v.startOn || todayISO(),
      endOn: v.endOn || '',
      baseline: v.baseline ?? '',
      baselineMediaIds: (v.baselineMediaIds as string[]) ?? [],
      techniqueIds: (v.techniqueIds as string[]) ?? [],
      productIds: v.productId ? [String(v.productId)] : [],
      protocol: v.protocol ?? '',
      observations: (v.observations as AnyRow[]) ?? [],
      result: v.result ?? '',
      resultMediaIds: (v.resultMediaIds as string[]) ?? [],
      rating: Number(v.rating ?? 0),
      decision: (v.decision as 'repeat' | 'stop' | 'extend' | 'open') ?? 'open',
      confounders: v.confounders ?? '',
      tags: (v.tags as string[]) ?? ['introduction']
    });
    setXForm(null);
    toast('Introduction protocol saved.', 'ok');
  };

  const saveProgress = async (v: Record<string, any>) => {
    await saveRow(TABLES.progressEntries, {
      id: v.id,
      label: v.label,
      domain: 'skin',
      on: v.on || todayISO(),
      metric: v.metric ?? '',
      value: numOrNull(v.value),
      unit: v.unit ?? '',
      rating: numOrNull(v.rating),
      note: v.note ?? '',
      mediaIds: (v.mediaIds as string[]) ?? [],
      linkedGoalId: v.linkedGoalId || null,
      linkedPlanId: null,
      linkedExperimentId: v.linkedExperimentId || null,
      tags: (v.tags as string[]) ?? []
    });
    setPrForm(null);
    toast('Progress entry saved.', 'ok');
  };

  const saveIngredientNote = async (ing: (typeof INGREDIENT_REFERENCE)[number]) => {
    await saveRow(TABLES.knowledge, {
      id: newId('kno'),
      title: `Reference copy — ${ing.name}`,
      kind: 'reference',
      body: `${ing.purpose}\n\nEvidence: ${ing.evidence}\n\nCombine: ${ing.combine}\n\nIntroduce: ${ing.introduce}\n\nProfessional: ${ing.professional}`,
      domain: 'skincare',
      confidence: 3,
      worked: 'unset',
      linkedGoalIds: [],
      linkedTechniqueIds: [],
      linkedProductIds: [],
      linkedExperimentIds: [],
      tags: ['ingredient', ...ing.family],
      data: { slug: `ingredient-${ing.slug}`, evidence: ing.evidenceGrade, cautions: ing.cautions, source: 'Skin Lab reference copy' }
    });
    toast('Saved to Knowledge — edit it there.', 'ok');
  };

  const blankProduct = () => ({
    name: '',
    brand: '',
    form: '',
    sizeLabel: '',
    pricePaid: '',
    currency,
    owned: true,
    openedOn: '',
    expiresOn: '',
    finishedOn: '',
    rating: 0,
    ingredients: '',
    sourceUrl: '',
    status: 'own',
    duplicateKey: '',
    notes: ''
  });
  const rowToProduct = (r: AnyRow) => ({
    id: r.id,
    name: String(r.name ?? ''),
    brand: String(r.brand ?? ''),
    form: String(r.form ?? ''),
    sizeLabel: String(r.sizeLabel ?? ''),
    pricePaid: r.pricePaid ?? '',
    currency: String(r.currency || currency),
    owned: Boolean(r.owned),
    openedOn: String(r.openedOn ?? ''),
    expiresOn: String(r.expiresOn ?? ''),
    finishedOn: String(r.finishedOn ?? ''),
    rating: Number(r.rating ?? 0),
    ingredients: String(r.ingredients ?? ''),
    sourceUrl: String(r.sourceUrl ?? ''),
    status: String(r.status ?? 'own'),
    duplicateKey: String(r.duplicateKey ?? ''),
    notes: String(asData(r).notes ?? ''),
    tags: (r.tags as string[]) ?? []
  });
  const blankObservation = () => ({ on: todayISO(), note: '', reaction: 'unknown', severity: 2, subjectId: '', mediaIds: [] as string[] });
  const rowToObservation = (r: AnyRow) => ({
    id: r.id,
    on: String(r.on ?? todayISO()),
    note: String(r.note ?? ''),
    reaction: String(r.reaction ?? 'unknown'),
    severity: Number(r.severity ?? 0),
    subjectId: String(r.subjectId ?? ''),
    mediaIds: (r.mediaIds as string[]) ?? [],
    tags: (r.tags as string[]) ?? []
  });
  const blankExperiment = () => ({
    name: '',
    aim: '',
    startOn: todayISO(),
    endOn: addDays(todayISO(), 56),
    productId: '',
    baseline: '',
    baselineMediaIds: [] as string[],
    techniqueIds: [] as string[],
    protocol: '',
    observations: [] as AnyRow[],
    obsOn: todayISO(),
    obsNote: '',
    obsRating: 3,
    result: '',
    resultMediaIds: [] as string[],
    rating: 0,
    decision: 'open',
    confounders: ''
  });
  const rowToExperiment = (r: AnyRow) => ({
    id: r.id,
    name: String(r.name ?? ''),
    aim: String(r.aim ?? ''),
    startOn: String(r.startOn ?? todayISO()),
    endOn: String(r.endOn ?? ''),
    productId: ((r.productIds as string[]) ?? [])[0] ?? '',
    baseline: String(r.baseline ?? ''),
    baselineMediaIds: (r.baselineMediaIds as string[]) ?? [],
    techniqueIds: (r.techniqueIds as string[]) ?? [],
    protocol: String(r.protocol ?? ''),
    observations: (r.observations as AnyRow[]) ?? [],
    obsOn: todayISO(),
    obsNote: '',
    obsRating: 3,
    result: String(r.result ?? ''),
    resultMediaIds: (r.resultMediaIds as string[]) ?? [],
    rating: Number(r.rating ?? 0),
    decision: String(r.decision ?? 'open'),
    confounders: String(r.confounders ?? '')
  });
  const blankProgress = () => ({
    label: '',
    on: todayISO(),
    metric: '',
    value: '',
    unit: '',
    rating: 0,
    note: '',
    mediaIds: [] as string[],
    linkedGoalId: '',
    linkedExperimentId: ''
  });
  const rowToProgress = (r: AnyRow) => ({
    id: r.id,
    label: String(r.label ?? ''),
    on: String(r.on ?? todayISO()),
    metric: String(r.metric ?? ''),
    value: r.value ?? '',
    unit: String(r.unit ?? ''),
    rating: Number(r.rating ?? 0),
    note: String(r.note ?? ''),
    mediaIds: (r.mediaIds as string[]) ?? [],
    linkedGoalId: String(r.linkedGoalId ?? ''),
    linkedExperimentId: String(r.linkedExperimentId ?? '')
  });

  /* -------------------------------------------------------------- jump rail */
  const jump = (id: string) => document.getElementById(`sk-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  const activeIng = INGREDIENT_REFERENCE.find((i) => i.slug === ingredient) ?? null;
  const editingRoutine = routines.find((r) => r.id === routineEdit);
  const compareA = liveProducts.find((p) => p.id === compare.a);
  const compareB = liveProducts.find((p) => p.id === compare.b);
  const beforeImg = media.find((m) => m.id === photoCompare.before);
  const afterImg = media.find((m) => m.id === photoCompare.after);
  const conditionsMatch = Boolean(beforeImg && afterImg && beforeImg.conditions === afterImg.conditions && beforeImg.lighting === afterImg.lighting);

  const shelfRows = statusFilter ? liveProducts.filter((p) => String(p.status) === statusFilter) : liveProducts;
  const dupCount = (key: string) => liveProducts.filter((p) => String(p.duplicateKey) === key).length;
  const routineSteps = (rt?: AnyRow) =>
    (((rt?.steps as AnyRow[]) ?? []).slice().sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0)));
  const loggingRoutine = logDraft ? routines.find((r) => r.id === logDraft.routineId) : undefined;

  return (
    <div className="gl-page sk-lab">
      <DeptIntro
        id="skin"
        actions={
          <>
            <Button variant="primary" onClick={() => setOForm(blankObservation())}>
              <Plus size={14} /> Log a reaction
            </Button>
            <Button variant="ghost" onClick={() => setProfileOpen(true)}>
              <Microscope size={14} /> Baseline
            </Button>
          </>
        }
        meta={[
          { label: 'Routines', value: routines.filter((r) => r.active).length },
          { label: 'Sessions logged', value: logs.filter((l) => !l.deletedAt).length },
          { label: 'Shelf entries', value: liveProducts.length },
          { label: 'Reactions', value: liveObservations.length }
        ]}
      >
        <SafetyBanner tone="note" title="What this department does not do">
          Glow Lab does not diagnose skin conditions from photographs and does not prescribe. Persistent, painful,
          spreading or changing findings need a clinician.{' '}
          <Link to="/services" className="gl-btn gl-btn--sm gl-btn--ghost" style={{ marginLeft: 8 }}>
            Find professional care
          </Link>
        </SafetyBanner>
      </DeptIntro>

      <nav className="sk-rail" aria-label="Skin Lab sections">
        {RAIL.map(([id, no, label]) => (
          <button key={id} type="button" className="sk-rail__item" onClick={() => jump(id)}>
            <span className="gl-tech">{no}</span>
            <span>{label}</span>
          </button>
        ))}
      </nav>

      {/* ------------------------------------------------------ 01 baseline */}
      <Section
        title="Baseline"
        eyebrow="01 · self-reported starting point"
        right={<Button size="sm" variant={profile ? 'default' : 'primary'} onClick={() => setProfileOpen(true)}>{profile ? 'Edit baseline' : 'Set baseline'}</Button>}
        description="Your own description, stored in your profile row. It grades what the reference desk surfaces and it is never treated as a diagnosis."
      >
        <div id="sk-baseline" className="sk-anchor" />
        {profile ? (
          <div className="sk-baseline">
            <StatStrip
              items={[
                { label: 'Skin as you describe it', value: pd.skinType || 'not stated' },
                { label: 'Reactivity', value: pd.sensitivity || 'not stated' },
                { label: 'Actives in play', value: (pd.actives as string[]).length },
                { label: 'Baseline recorded', value: pd.baselineOn ? formatDate(String(pd.baselineOn)) : 'not dated' }
              ]}
            />
            <Card variant="default">
              <KvList
                items={[
                  { k: 'Tracking', v: (pd.concerns as string[]).length ? (pd.concerns as string[]).join(' · ') : 'nothing named yet' },
                  { k: 'Goals', v: (pd.goals as string[]).length ? (pd.goals as string[]).join(' · ') : 'nothing named yet' },
                  { k: 'Actives', v: (pd.actives as string[]).length ? (pd.actives as string[]).join(' · ') : 'none listed' },
                  { k: 'Routine notes', v: pd.routineNotes || 'none' },
                  { k: 'Professional care', v: pd.professionalCare || 'none recorded' }
                ]}
              />
            </Card>
            {(pd.actives as string[]).length > 1 ? (
              <SafetyBanner tone="warn" title="More than one active listed">
                Introducing several actives together makes every later reaction impossible to attribute. The bench keeps
                one active per introduction log for exactly that reason — start one, hold everything else steady, and
                date it.
              </SafetyBanner>
            ) : null}
          </div>
        ) : (
          <EmptyPlate
            kicker="Baseline"
            title="Nothing described yet"
            body="The Lab works from what you tell it. Two minutes here is what makes the reaction journal and the introduction logs readable later."
            action={<Button variant="primary" onClick={() => setProfileOpen(true)}>Set your baseline</Button>}
          />
        )}
      </Section>

      {/* -------------------------------------------------------- 02 bench */}
      <Section
        title="Routine bench"
        eyebrow="02 · ordered steps, saved order"
        right={
          <>
            <Button size="sm" onClick={() => void blankRoutine('morning')}>
              <Plus size={13} /> Morning
            </Button>
            <Button size="sm" onClick={() => void blankRoutine('evening')}>
              <Plus size={13} /> Evening
            </Button>
          </>
        }
        description="A routine is a row with steps in a saved order. Changing an order here changes the log checkboxes and the scheduled calendar checklist."
      >
        <div id="sk-bench" className="sk-anchor" />
        {routines.length ? (
          <div className="sk-bench">
            {routines.map((rt) => {
              const steps = routineSteps(rt);
              const rtLogs = logs.filter((l) => l.routineId === rt.id && !l.deletedAt);
              const last = rtLogs[0];
              return (
                <Card key={rt.id} variant={rt.active ? 'default' : 'flush'} className="sk-benchcard">
                  <CardHead
                    eyebrow={`${String(rt.timeOfDay) || 'unscheduled'} · ${steps.length} steps`}
                    title={rt.name || 'Untitled routine'}
                    sub={last ? `Last logged ${formatDate(String(last.doneOn))}` : 'Never logged'}
                    right={
                      <>
                        <Button size="sm" variant="primary" disabled={!steps.length} onClick={() => setLogDraft({ routineId: rt.id })}>
                          Log today
                        </Button>
                        <Button size="sm" onClick={() => setRoutineEdit(rt.id)}>
                          Steps
                        </Button>
                      </>
                    }
                  />
                  <ol className="sk-order">
                    {steps.map((s, i) => (
                      <li key={String(s.id)}>
                        <span className="sk-order__no">{i + 1}</span>
                        <span className="sk-order__label">{String(s.label)}</span>
                        {s.productId ? <Chip tone="info">{liveProducts.find((p) => p.id === s.productId)?.name ?? 'linked product'}</Chip> : null}
                        {s.durationMin ? <span className="gl-tech">{s.durationMin} min</span> : null}
                      </li>
                    ))}
                    {!steps.length ? <li className="gl-small gl-faint">No steps defined — this routine cannot be logged yet.</li> : null}
                  </ol>
                  <div className="gl-row gl-row--between" style={{ marginTop: 'var(--glow-sp-3)' }}>
                    <Toggle checked={Boolean(rt.active)} onChange={(v) => void persistRoutine(rt, { active: v, steps })} label={rt.active ? 'Active' : 'Paused'} />
                    <span className="gl-tech">{rtLogs.length} session(s)</span>
                  </div>
                  <LayerCheck
                    routine={rt}
                    steps={steps}
                    products={liveProducts}
                    onApplyOrder={(ordered) => void persistRoutine(rt, { active: rt.active, steps: ordered })}
                  />
                </Card>
              );
            })}
          </div>
        ) : (
          <EmptyPlate
            kicker="Bench"
            title="No skin routines yet"
            body="Build one from the products already on your shelf. Steps keep their order, their product link and your own skip rules."
            action={<Button variant="primary" onClick={() => void blankRoutine('evening')}>Create an evening routine</Button>}
          />
        )}
      </Section>

      {/* --------------------------------------------------------- 03 log */}
      <Section
        title="Daily record"
        eyebrow="03 · adherence, not aspiration"
        description="The strip is 91 days of real logs. A day only lights up if a session row exists for it."
      >
        <div id="sk-log" className="sk-anchor" />
        <div className="sk-metrics">
          <Stat label="Days logged, last 28" value={`${last28.filter((d) => d.level > 0).length}/28`} hint="Any session counts, partial included." />
          <Meter value={adherence} label="Adherence" />
          <Stat label="Current streak" value={streak} hint="Consecutive days with a log" />
          <Stat label="Comfort mean" value={logs.filter((l) => !l.deletedAt).length ? (logs.filter((l) => !l.deletedAt).reduce((s, l) => s + Number(l.mood ?? 0), 0) / logs.filter((l) => !l.deletedAt).length).toFixed(1) : '—'} tone="gold" hint="0–5, your own scale" />
        </div>
        <Card variant="default" className="sk-heat">
          <CardHead eyebrow="91 days" title="Consistency" sub="Darker means a higher share of that routine's steps completed." />
          <HeatStrip days={heatDays} />
        </Card>
        {moodSeries.series[0].data.length > 2 ? (
          <Card variant="default">
            <CardHead eyebrow="Last 30 sessions" title="Comfort after" />
            <LineChart labels={moodSeries.labels} series={moodSeries.series} height={190} yTitle="0–5" />
          </Card>
        ) : null}
        <Disclosure summary={`Session history (${logs.filter((l) => !l.deletedAt).length})`}>
          <div className="gl-stack" style={{ gap: 8 }}>
            {logs.filter((l) => !l.deletedAt).slice(0, 40).map((l) => {
              const rt = routines.find((r) => r.id === l.routineId);
              const total = ((rt?.steps as AnyRow[]) ?? []).length || 0;
              const done = ((l.completedSteps as string[]) ?? []).length;
              return (
                <div key={l.id} className="gl-inset sk-logrow">
                  <div className="gl-row gl-row--between">
                    <div>
                      <div className="gl-tech">{formatDate(String(l.doneOn))} · {rt?.name ?? 'routine deleted'}</div>
                      <div className="gl-small">{done}/{total || '?'} steps · comfort {Number(l.mood ?? 0)}/5</div>
                      {l.note ? <div className="gl-small gl-muted" style={{ marginTop: 4 }}>{String(l.note)}</div> : null}
                    </div>
                    <div className="gl-row gl-row--tight">
                      <Button size="sm" onClick={() => setLogDraft({ routineId: String(l.routineId), logId: l.id })}>Edit</Button>
                      <IconButton
                        label="Delete session"
                        tone="danger"
                        onClick={() =>
                          setConfirm({
                            label: `${formatDate(String(l.doneOn))} — ${rt?.name ?? 'session'}`,
                            run: async () => {
                              await softDelete(TABLES.routineLogs, l.id);
                              setConfirm(null);
                              toast('Session archived.', 'ok');
                            }
                          })
                        }
                      >
                        <Trash2 size={13} />
                      </IconButton>
                    </div>
                  </div>
                </div>
              );
            })}
            {!logs.filter((l) => !l.deletedAt).length ? <p className="gl-small gl-faint">Nothing logged yet.</p> : null}
          </div>
        </Disclosure>
      </Section>

      {/* ------------------------------------------------------- 04 shelf */}
      <Section
        title="Product shelf"
        eyebrow="04 · what you actually own"
        right={
          <Button size="sm" variant="primary" onClick={() => setPForm(blankProduct())}>
            <Plus size={13} /> Shelf entry
          </Button>
        }
        description="Everything here was typed by you: the label, the INCI list, the price you paid, the date you opened it. Nothing is fetched or invented."
      >
        <div id="sk-shelf" className="sk-anchor" />
        <div className="sk-shelftop">
          <div className="sk-filter">
            <span className="gl-field__label">Status</span>
            <Select
              value={statusFilter}
              onChange={setStatusFilter}
              options={[{ value: '', label: 'Everything' }, ...OWNERSHIP.map((o) => ({ value: o, label: o }))]}
            />
          </div>
          <StatStrip items={[{ label: 'Entries', value: shelfRows.length }, { label: 'Recorded spend', value: fmtMoney(shelfValue, currency), hint: 'Only entries where you entered a price' }]} />
        </div>

        {shelfRows.length ? (
          <div className="sk-shelf">
            {shelfRows.map((p) => {
              const reactions = liveObservations.filter((o) => o.subjectId === p.id);
              const since = openSince(p);
              return (
                <Card key={p.id} variant="default" className="sk-item">
                  <div className="gl-row gl-row--between" style={{ alignItems: 'baseline' }}>
                    <div className="gl-serif sk-item__name">{p.name}</div>
                    <Chip>{String(p.status)}</Chip>
                  </div>
                  <div className="gl-tech">{p.brand || 'brand not recorded'}{p.form ? ` · ${p.form}` : ''}{p.sizeLabel ? ` · ${p.sizeLabel}` : ''}</div>
                  <KvList
                    items={[
                      { k: 'Price paid', v: p.pricePaid === null || p.pricePaid === undefined ? 'not recorded' : fmtMoney(Number(p.pricePaid), String(p.currency || currency)) },
                      { k: 'Opened', v: since === null ? 'not recorded' : `${formatDate(String(p.openedOn))} · ${since} days ago` },
                      { k: 'Expiry / PAO', v: p.expiresOn ? formatDate(String(p.expiresOn)) : 'not recorded' },
                      { k: 'Finished', v: p.finishedOn ? formatDate(String(p.finishedOn)) : 'in use' },
                      { k: 'Your rating', v: Number(p.rating) ? `${p.rating}/5` : 'not rated' },
                      { k: 'Reactions named', v: reactions.length ? `${reactions.length} dated entr${reactions.length === 1 ? 'y' : 'ies'}` : 'none named' }
                    ]}
                  />
                  {p.ingredients ? (
                    <p className="gl-small gl-faint sk-inci" title={String(p.ingredients)}>
                      {String(p.ingredients)}
                    </p>
                  ) : (
                    <p className="gl-small gl-faint">INCI list not transcribed.</p>
                  )}
                  {dupCount(String(p.duplicateKey)) > 1 ? <Chip tone="limited">possible duplicate on the shelf</Chip> : null}
                  <div className="gl-row gl-row--between" style={{ marginTop: 'var(--glow-sp-3)' }}>
                    <Button size="sm" onClick={() => setPForm(rowToProduct(p))}>Edit</Button>
                    <IconButton
                      label="Remove from shelf"
                      tone="danger"
                      onClick={() =>
                        setConfirm({
                          label: String(p.name),
                          run: async () => {
                            await softDelete(TABLES.products, p.id);
                            setConfirm(null);
                            toast('Moved to the archive drawer below.', 'ok');
                          }
                        })
                      }
                    >
                      <Trash2 size={13} />
                    </IconButton>
                  </div>
                </Card>
              );
            })}
          </div>
        ) : (
          <EmptyPlate
            kicker="Shelf"
            title="No entries match"
            body="The shelf is empty until you add something. It never fills itself with catalogue data, prices or ratings."
            action={<Button variant="primary" onClick={() => setPForm(blankProduct())}>Add an entry</Button>}
          />
        )}

        {trashedProducts.length ? (
          <Card variant="default">
            <CardHead eyebrow="Archive" title={`${trashedProducts.length} removed entry(ies)`} sub="Soft-deleted rows stay recoverable." />
            <div className="gl-row gl-row--tight" style={{ flexWrap: 'wrap' }}>
              {trashedProducts.map((p) => (
                <span key={p.id} className="sk-trashed">
                  <Chip>{String(p.name)}</Chip>
                  <Button size="sm" onClick={() => void restore(TABLES.products, p.id)}>Restore</Button>
                  <IconButton
                    label="Delete permanently"
                    tone="danger"
                    onClick={() =>
                      setConfirm({
                        label: `${p.name} — permanently`,
                        run: async () => {
                          await hardDelete(TABLES.products, p.id);
                          setConfirm(null);
                          toast('Removed from the database.', 'ok');
                        }
                      })
                    }
                  >
                    <Trash2 size={12} />
                  </IconButton>
                </span>
              ))}
            </div>
          </Card>
        ) : null}

        <Card variant="default">
          <CardHead
            eyebrow="Side by side"
            title="Two shelf entries, field by field"
            sub="Any blank prints as “not recorded” — never as a guess."
            right={
              <>
                <Select value={compare.a} onChange={(v) => setCompare((c) => ({ ...c, a: v }))} options={liveProducts.map((p) => ({ value: p.id, label: String(p.name) }))} placeholder="Product A" />
                <Select value={compare.b} onChange={(v) => setCompare((c) => ({ ...c, b: v }))} options={liveProducts.map((p) => ({ value: p.id, label: String(p.name) }))} placeholder="Product B" />
              </>
            }
          />
          {compareA && compareB ? (
            <Table
              columns={[
                { label: 'Field', render: (r: AnyRow) => <span className="gl-tech">{r.field}</span> },
                { label: String(compareA.name), render: (r: AnyRow) => r.a },
                { label: String(compareB.name), render: (r: AnyRow) => r.b }
              ]}
              rows={shelfFieldRows(compareA, compareB, currency, (id) => liveObservations.filter((o) => o.subjectId === id).length)}
              keyOf={(r: AnyRow) => String(r.field)}
            />
          ) : (
            <p className="gl-small gl-faint">Choose two entries to compare them. Ratings and prices are only ever what you typed.</p>
          )}
        </Card>
      </Section>

      {/* ---------------------------------------------------- 05 reference */}
      <Section
        title="Ingredient reference"
        eyebrow="05 · graded, with limits stated"
        right={<Link className="gl-btn gl-btn--sm gl-btn--ghost" to="/knowledge">Knowledge</Link>}
        description="Ten entries built into the Lab. Each one says what the evidence supports, how it is introduced in the literature, and where a professional is required."
      >
        <div id="sk-reference" className="sk-anchor" />
        <IndexList>
          {INGREDIENT_REFERENCE.map((ing, i) => (
            <IndexRow
              key={ing.slug}
              no={i + 1}
              title={ing.name}
              sub={ing.family.join(' · ')}
              right={<EvidenceChip grade={ing.evidenceGrade} />}
              onClick={() => setIngredient(ing.slug)}
            />
          ))}
        </IndexList>
        <div className="sk-reflinks">
          <Link className="gl-btn gl-btn--sm" to="/academy">
            Academy — label reading and one-active introductions
          </Link>
          <Link className="gl-btn gl-btn--sm gl-btn--ghost" to="/evidence">
            Evidence Center
          </Link>
          {tutorials.filter((t) => !t.deletedAt).length ? (
            <span className="gl-small gl-faint">{tutorials.filter((t) => !t.deletedAt).length} skincare tutorial(s) in your Academy library.</span>
          ) : null}
        </div>
        {techniques.filter((t) => !t.deletedAt && t.safety !== 'unsafe').length ? (
          <Card variant="default">
            <CardHead eyebrow="Techniques on file" title="Graded for the skin domain" sub="Flagged techniques are listed but never presented as options." />
            <div className="sk-techlist">
              {techniques.filter((t) => !t.deletedAt).map((t) => (
                <div key={t.id} className="sk-techrow" data-unsafe={t.safety === 'unsafe'}>
                  <div className="gl-row gl-row--between" style={{ alignItems: 'baseline' }}>
                    <span className="gl-serif">{t.title}</span>
                    <EvidenceChip grade={String(t.evidence)} />
                  </div>
                  <p className="gl-small gl-muted">{t.claim}</p>
                  <div className="gl-row gl-row--tight">
                    {t.safety === 'unsafe' ? <Chip tone="danger">Not offered here</Chip> : <Chip tone="info">Documented limits: {String(t.evidenceGaps || 'gaps not recorded')}</Chip>}
                    {t.whenToConsult ? <Chip tone="limited">Ask a professional: {String(t.whenToConsult)}</Chip> : null}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        ) : null}
      </Section>

      {/* -------------------------------------------------- 06 introductions */}
      <Section
        title="Active introductions"
        eyebrow="06 · one variable at a time"
        right={
          <Button size="sm" variant="primary" onClick={() => setXForm(blankExperiment())}>
            <FlaskConical size={13} /> New protocol
          </Button>
        }
        description="A dated protocol with a baseline, a cadence, weekly observations and a decision. This is the only part of the Lab that can tell you what your own skin did."
      >
        <div id="sk-intro" className="sk-anchor" />
        {experiments.filter((e) => !e.deletedAt).length ? (
          <div className="sk-intros">
            {byDateDesc(experiments.filter((e) => !e.deletedAt), 'startOn').map((e) => {
              const obs = (e.observations as AnyRow[]) ?? [];
              const linked = ((e.productIds as string[]) ?? []).map((id) => liveProducts.find((p) => p.id === id)?.name ?? 'unlinked product');
              return (
                <Card key={e.id} variant="accent" className="sk-introcard">
                  <CardHead
                    eyebrow={`${formatDate(String(e.startOn))} → ${e.endOn ? formatDate(String(e.endOn)) : 'open'}`}
                    title={e.name}
                    sub={e.aim || 'aim not written'}
                    right={<Button size="sm" onClick={() => setXForm(rowToExperiment(e))}>Edit</Button>}
                  />
                  <KvList
                    items={[
                      { k: 'Protocol', v: e.protocol || 'not written' },
                      { k: 'Baseline', v: e.baseline || 'not described' },
                      { k: 'Product', v: linked.length ? linked.join(', ') : 'none linked' },
                      { k: 'Observations', v: obs.length ? `${obs.length} dated entries` : 'none yet' },
                      { k: 'Outcome', v: e.result || 'not concluded' },
                      { k: 'Confounders', v: e.confounders || 'none declared' }
                    ]}
                  />
                  <div className="gl-row gl-row--between" style={{ marginTop: 'var(--glow-sp-3)' }}>
                    <Chip tone={String(e.decision) === 'stop' ? 'limited' : String(e.decision) === 'repeat' ? 'strong' : 'info'}>Decision: {String(e.decision)}</Chip>
                    {Number(e.rating) ? <Rating value={Number(e.rating)} /> : null}
                    <IconButton
                      label="Delete protocol"
                      tone="danger"
                      onClick={() =>
                        setConfirm({
                          label: String(e.name),
                          run: async () => {
                            await softDelete(TABLES.experiments, e.id);
                            setConfirm(null);
                            toast('Protocol archived.', 'ok');
                          }
                        })
                      }
                    >
                      <Trash2 size={13} />
                    </IconButton>
                  </div>
                  {obs.length ? (
                    <div className="sk-introobs">
                      {obs.slice(-4).map((o, i) => (
                        <div key={`${String(o.on)}-${i}`} className="gl-inset sk-obs">
                          <span className="gl-tech">{formatDate(String(o.on))}</span>
                          <div className="gl-small">{String(o.note)}</div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </Card>
              );
            })}
          </div>
        ) : (
          <EmptyPlate
            kicker="Protocol"
            title="No introduction logs"
            body="Start one when you add a new active. Write the cadence before you begin, not after — that is the difference between a record and a story you tell later."
            action={<Button variant="primary" onClick={() => setXForm(blankExperiment())}>Write a protocol</Button>}
          />
        )}
      </Section>

      {/* ------------------------------------------------------ 07 journal */}
      <Section
        title="Reaction journal"
        eyebrow="07 · dated observations, no conclusions"
        right={
          <Button size="sm" variant="primary" onClick={() => setOForm(blankObservation())}>
            <Plus size={13} /> New entry
          </Button>
        }
      >
        <div id="sk-journal" className="sk-anchor" />
        {liveObservations.length ? (
          <div className="sk-journal">
            {liveObservations.map((o) => (
              <Card key={o.id} variant="default" className="sk-react">
                <div className="gl-row gl-row--between" style={{ alignItems: 'baseline' }}>
                  <span className="gl-tech">{formatDate(String(o.on))}</span>
                  <Chip tone={o.reaction === 'irritation' || o.reaction === 'breakout' || o.reaction === 'bad' ? 'danger' : o.reaction === 'good' ? 'strong' : undefined}>
                    {String(o.reaction)}
                  </Chip>
                </div>
                <p className="gl-small" style={{ margin: '8px 0' }}>{o.note}</p>
                {o.subjectId ? <Chip tone="info">{liveProducts.find((p) => p.id === o.subjectId)?.name ?? 'named entry no longer on the shelf'}</Chip> : null}
                <Meter value={Number(o.severity ?? 0)} max={10} label="Severity as you rated it" />
                {((o.mediaIds as string[]) ?? []).length ? (
                  <div className="sk-react__thumbs">
                    {(o.mediaIds as string[]).map((id) => {
                      const m = media.find((x) => x.id === id);
                      return m ? (
                        <button
                          key={id}
                          type="button"
                          className="sk-thumb"
                          onClick={() => setLightbox(media.findIndex((x) => x.id === id))}
                          aria-label={`Open photograph from ${formatDate(String(m.takenOn))}`}
                        >
                          <MediaImg row={m} />
                        </button>
                      ) : (
                        <span key={id} className="gl-tech sk-thumb sk-thumb--missing">image not in library</span>
                      );
                    })}
                  </div>
                ) : null}
                <div className="gl-row gl-row--between" style={{ marginTop: 'var(--glow-sp-3)' }}>
                  <Button size="sm" onClick={() => setOForm(rowToObservation(o))}>Edit</Button>
                  <IconButton
                    label="Delete entry"
                    tone="danger"
                    onClick={() =>
                      setConfirm({
                        label: `${formatDate(String(o.on))} — ${String(o.note).slice(0, 40)}`,
                        run: async () => {
                          await softDelete(TABLES.observations, o.id);
                          setConfirm(null);
                          toast('Entry archived.', 'ok');
                        }
                      })
                    }
                  >
                    <Trash2 size={13} />
                  </IconButton>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <EmptyPlate
            kicker="Journal"
            title="No reactions logged"
            body="A stinging that lasts two minutes and a patch that appears on day nine are different records. Write them down when they happen — the association panel can only work with dates you captured."
            action={<Button variant="primary" onClick={() => setOForm(blankObservation())}>Log the first entry</Button>}
          />
        )}

        {trashedObservations.length ? (
          <div className="gl-row gl-row--tight" style={{ flexWrap: 'wrap' }}>
            {trashedObservations.map((o) => (
              <span key={o.id} className="sk-trashed">
                <Chip>{formatDate(String(o.on))} archived</Chip>
                <Button size="sm" onClick={() => void restore(TABLES.observations, o.id)}>Restore</Button>
                <Button size="sm" variant="danger" onClick={() => void hardDelete(TABLES.observations, o.id)}>Purge</Button>
              </span>
            ))}
          </div>
        ) : null}

        <Card variant="default">
          <CardHead
            eyebrow="Association only"
            title="Shelf entries opened within 14 days before a reaction"
            sub="Timing coincidence, not attribution. A product opened two weeks earlier may have nothing to do with anything."
          />
          {associations.length ? (
            <div className="sk-assoc">
              {associations.map((a) => (
                <div key={`${a.on}-${a.reaction}`} className="sk-assoc__row">
                  <div className="sk-assoc__when">
                    <span className="gl-tech">{formatDate(a.on)}</span>
                    <Chip tone={a.reaction === 'good' ? 'strong' : 'danger'}>{a.reaction}</Chip>
                  </div>
                  <div className="sk-assoc__body">
                    <div className="gl-small">{a.note}</div>
                    <div className="gl-row gl-row--tight" style={{ marginTop: 6 }}>
                      {a.candidates.length ? (
                        a.candidates.map((c) => (
                          <Chip key={c.id} tone="limited">
                            {c.name} — opened {c.days} day(s) before
                          </Chip>
                        ))
                      ) : (
                        <span className="gl-tech">no dated product in the window</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="gl-small gl-faint">Nothing to associate yet — this needs both a reaction entry and a product with an opening date.</p>
          )}
          <SafetyBanner tone="warn" title="When the pattern stops being a cosmetic matter">
            Spreading rash, swelling, blistering, painful or changing lesions, or anything that persists after you stop a
            product: that is a clinician visit, not a journal entry. Photographs stored here stay on this device and are
            never analysed.
          </SafetyBanner>
        </Card>

        <Card variant="default">
          <CardHead
            eyebrow="Photographic record"
            title="Same conditions, or say so"
            right={<PhotoPicker kind="progress" album="Skin Lab" label="Add standardised photo" withConditions onPick={(rows) => void linkMedia(rows)} />}
          />
          <div className="gl-form-row">
            <Field label="Before">
              <Select value={photoCompare.before} onChange={(v) => setPhotoCompare((c) => ({ ...c, before: v }))} options={media.map((m) => ({ value: m.id, label: `${formatDate(String(m.takenOn))} · ${m.conditions || 'unlabelled'}` }))} placeholder="— choose —" />
            </Field>
            <Field label="After">
              <Select value={photoCompare.after} onChange={(v) => setPhotoCompare((c) => ({ ...c, after: v }))} options={media.map((m) => ({ value: m.id, label: `${formatDate(String(m.takenOn))} · ${m.conditions || 'unlabelled'}` }))} placeholder="— choose —" />
            </Field>
          </div>
          {beforeImg && afterImg ? (
            <>
              {!conditionsMatch ? (
                <SafetyBanner tone="warn" title="These were not shot under the same conditions">
                  <b className="gl-strong">{String(beforeImg.conditions || 'condition unlabelled')} / {String(beforeImg.lighting || 'lighting unlabelled')}</b> versus{' '}
                  <b className="gl-strong">{String(afterImg.conditions || 'condition unlabelled')} / {String(afterImg.lighting || 'lighting unlabelled')}</b>. Lighting and
                  lens distance change apparent texture and tone more than most products do. Treat this slider as a memory, not as evidence.
                </SafetyBanner>
              ) : (
                <p className="gl-small gl-note--ok gl-note" style={{ marginBottom: 'var(--glow-sp-3)' }}>
                  Same condition set and lighting — this pair is comparable as far as your records go. Colour still shifts
                  between phones and screens.
                </p>
              )}
              <CompareSlider before={beforeImg} after={afterImg} beforeLabel={formatDate(String(beforeImg.takenOn))} afterLabel={formatDate(String(afterImg.takenOn))} height={340} />
            </>
          ) : (
            <p className="gl-small gl-faint">Pick two of your own photographs. Nothing is compared automatically, and nothing is analysed.</p>
          )}
        </Card>
      </Section>

      {/* ------------------------------------------------------ 08 progress */}
      <Section
        title="Progress"
        eyebrow="08 · what actually happened"
        right={
          <>
            <Button size="sm" variant="primary" onClick={() => setPrForm(blankProgress())}>
              <Plus size={13} /> Entry
            </Button>
            <Link className="gl-btn gl-btn--sm gl-btn--ghost" to="/progress">All departments</Link>
          </>
        }
      >
        <div id="sk-progress" className="sk-anchor" />
        {progressRows.filter((p) => !p.deletedAt).length ? (
          <>
            <Timeline
              items={byDateDesc(progressRows.filter((p) => !p.deletedAt), 'on').map((p) => ({
                when: formatDate(String(p.on)),
                title: String(p.label),
                body: `${p.metric ? `${p.metric}: ${p.value ?? '—'} ${p.unit || ''}` : ''}${p.note ? ` — ${p.note}` : ''}`.trim(),
                tone: p.rating && Number(p.rating) >= 4 ? ('accent' as const) : ('plain' as const),
                right: Number(p.rating) ? <Rating value={Number(p.rating)} /> : null
              }))}
            />
            <div className="sk-prodtable">
              {byDateDesc(progressRows.filter((x) => !x.deletedAt), 'on').map((p) => (
                <div key={p.id} className="sk-prodrow">
                  <span className="gl-tech">{formatDate(String(p.on))}</span>
                  <span className="sk-prodrow__label">{p.label}</span>
                  <span className="gl-tech">{p.metric ? `${p.metric} ${p.value ?? '—'} ${p.unit || ''}` : '—'}</span>
                  <span className="gl-row gl-row--tight">
                    <Button size="sm" onClick={() => setPrForm(rowToProgress(p))}>Edit</Button>
                    <IconButton
                      label="Delete entry"
                      tone="danger"
                      onClick={() =>
                        setConfirm({
                          label: String(p.label),
                          run: async () => {
                            await softDelete(TABLES.progressEntries, p.id);
                            setConfirm(null);
                            toast('Entry archived.', 'ok');
                          }
                        })
                      }
                    >
                      <Trash2 size={12} />
                    </IconButton>
                  </span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <EmptyPlate
            kicker="Progress"
            title="No entries"
            body="Progress here is anything you decide to measure — episodes per week, days of stinging, how your own comfort rating moved. It is written by you, in words you choose."
            action={<Button variant="primary" onClick={() => setPrForm(blankProgress())}>Record the first entry</Button>}
          />
        )}
        {reactionMix.length ? (
          <Card variant="default">
            <CardHead eyebrow={`${liveObservations.length} journal entries`} title="Reaction mix" sub="Counts only. The journal never interprets them." />
            <div className="sk-mix">
              {reactionMix.map((r) => (
                <div key={r.label} className="sk-mix__row">
                  <span className="gl-tech">{r.label}</span>
                  <Meter value={r.value} max={liveObservations.length} />
                  <span className="gl-tech">{r.value}</span>
                </div>
              ))}
            </div>
          </Card>
        ) : null}
      </Section>

      {/* ---------------------------------------------------------- overlays */}
      {profileOpen ? <ProfileEditor key={profile?.id ?? 'new'} initial={asData(profile)} onCancel={() => setProfileOpen(false)} onSave={(v) => void saveProfile(v)} /> : null}
      {editingRoutine ? (
        <RoutineEditor
          key={editingRoutine.id}
          routine={editingRoutine}
          steps={routineSteps(editingRoutine)}
          products={liveProducts}
          onClose={() => setRoutineEdit(null)}
          onPersist={(changes) => void persistRoutine(editingRoutine, changes)}
          onDelete={async () => {
            await softDelete(TABLES.routines, editingRoutine.id);
            setRoutineEdit(null);
            toast('Routine archived. Its session logs remain.', 'ok');
          }}
          onSchedule={(freq, interval, start) => void scheduleRoutine(editingRoutine, freq, interval, start)}
        />
      ) : null}
      {logDraft && loggingRoutine ? (
        <LogEditor
          key={`${logDraft.routineId}-${logDraft.logId ?? 'new'}`}
          routine={loggingRoutine}
          steps={routineSteps(loggingRoutine)}
          existing={logDraft.logId ? allLogs.find((l) => l.id === logDraft.logId) : undefined}
          products={liveProducts}
          onCancel={() => setLogDraft(null)}
          onSave={(v) => void saveLog(v)}
        />
      ) : null}
      {pForm ? <ProductEditor key={pForm.id ?? 'new'} initial={pForm} currency={currency} onCancel={() => setPForm(null)} onSave={(v) => void saveProduct(v)} /> : null}
      {oForm ? (
        <ObservationEditor
          key={oForm.id ?? 'new'}
          initial={oForm}
          products={liveProducts}
          media={media}
          onAttach={(rows) => void linkMedia(rows)}
          onCancel={() => setOForm(null)}
          onSave={(v) => void saveObservation(v)}
        />
      ) : null}
      {xForm ? (
        <ExperimentEditor
          key={xForm.id ?? 'new'}
          initial={xForm}
          products={liveProducts}
          techniques={techniques.filter((t) => !t.deletedAt)}
          media={media}
          onAttach={(rows) => void linkMedia(rows)}
          onCancel={() => setXForm(null)}
          onSave={(v) => void saveExperiment(v)}
        />
      ) : null}
      {prForm ? (
        <ProgressEditor
          key={prForm.id ?? 'new'}
          initial={prForm}
          goals={goals.filter((g) => !g.deletedAt && String(g.domain) === 'skin')}
          experiments={experiments.filter((e) => !e.deletedAt)}
          media={media}
          onAttach={(rows) => void linkMedia(rows)}
          onCancel={() => setPrForm(null)}
          onSave={(v) => void saveProgress(v)}
        />
      ) : null}
      {activeIng ? <IngredientDetail key={activeIng.slug} ing={activeIng} onCancel={() => setIngredient(null)} onSaveNote={(i) => void saveIngredientNote(i)} /> : null}
      {confirm ? <ConfirmDelete label={confirm.label} onCancel={() => setConfirm(null)} onYes={confirm.run} /> : null}

      <Lightbox
        items={media}
        index={lightbox}
        onIndex={setLightbox}
        onClose={() => setLightbox(null)}
        header={(m) => (
          <div>
            <div className="gl-serif" style={{ fontSize: '1.2rem' }}>{m.title || 'Skin photograph'}</div>
            <div className="gl-tech">
              {formatDate(String(m.takenOn))} · {m.conditions || 'conditions not recorded'} · {m.lighting || 'lighting not recorded'}
            </div>
          </div>
        )}
      />
    </div>
  );
}
