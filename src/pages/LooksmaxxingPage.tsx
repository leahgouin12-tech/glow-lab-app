/**
 * THE GLOW LAB — Looksmaxxing Command Center (spec Part 5).
 *
 * A working analytical workspace, not a checklist: every number on this page is
 * either typed by the user or computed by the deterministic prioritisation
 * engine from numbers the user typed. There is no facial analysis, no
 * attractiveness score and no invented cost. Rows are written straight through
 * `saveRow` so a reload never loses work.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ChevronRight, Plus, RotateCcw, ShieldAlert, Trash2 } from 'lucide-react';
import { saveRow, useRows } from '../hooks/live';
import { addDays, formatDate, newId, softDelete, todayISO } from '../db/repo';
import {
  TABLES,
  type AnyRow,
  type AssessmentCategory,
  type EvidenceGrade,
  type ImprovementOption,
  type PlanAction,
  type PlanMilestone,
  type PlanRow
} from '../db/schema';
import { BAND_LABEL, BAND_NOTE, rankOptions, scoreOption, type Band, type ScoredOption } from '../engine/prioritisation';
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
  Range,
  SafetyBanner,
  SegmentedControl,
  Select,
  Stat,
  TextArea,
  TextInput,
  useToast
} from '../ui/primitives';
import { DeptIntro, EmptyPlate, IndexList, IndexRow, KvList, PullQuote, StatStrip, Timeline } from '../ui/editorial';
import { DistributionBars, HeatStrip } from '../ui/charts';
import { PhotoPicker } from '../ui/media';
import '../styles/departments/looksmaxxing.css';

/* ------------------------------------------------------------------ static shape */

const COST_BANDS = ['free', 'low', 'mid', 'high', 'professional'] as const;
type CostBand = (typeof COST_BANDS)[number];

const GRADES: EvidenceGrade[] = [
  'strong',
  'moderate',
  'cosmetic',
  'professional',
  'traditional',
  'emerging',
  'limited',
  'weak',
  'unsupported',
  'dangerous'
];

const BAND_OPTIONS: { value: string; label: string }[] = COST_BANDS.map((c) => ({ value: c, label: c }));
const GRADE_OPTIONS: { value: string; label: string }[] = GRADES.map((g) => ({ value: g, label: g }));

interface CatDef {
  key: string;
  label: string;
  hint: string;
  optional?: boolean;
}

/** The fourteen assessment categories, exactly as specified. */
const CATEGORIES: CatDef[] = [
  {
    key: 'facial-presentation',
    label: 'Facial presentation',
    hint: 'How your face reads day to day: de-puffing, dryness, shine, redness, lip and eye area, the effort you spend on it each morning.'
  },
  {
    key: 'facial-harmony-education',
    label: 'Facial harmony education',
    hint: 'A learning category, not a change category: understanding thirds, fifths, lens distortion and what is actually modifiable.'
  },
  { key: 'skin-quality', label: 'Skin quality & care', hint: 'Texture, tone, congestion, barrier, pigment, and the routine you can keep.' },
  { key: 'hair', label: 'Hair & hairstyle', hint: 'Cut, framing, density, length retention, tension, maintenance interval and cost.' },
  { key: 'brows-lashes', label: 'Eyebrows & eyelashes', hint: 'Shape mapped from your own landmarks, brow density, lashes, tint and lift.' },
  { key: 'makeup-grooming', label: 'Makeup & grooming', hint: 'Base match, placement, colour, plus shaving/trimming, nails, scent-adjacent grooming.' },
  { key: 'dental-smile', label: 'Dental & smile', hint: 'Hygiene, alignment, tone, the professional route, and what you will maintain afterwards.' },
  {
    key: 'body-composition',
    label: 'Body composition goals',
    hint: 'Optional. Leave it empty if weight or shape is not something you want in this assessment — nothing here requires it.',
    optional: true
  },
  { key: 'posture', label: 'Posture', hint: 'Standing, sitting, screen height, head position, double-chin-at-camera and how much of it is angle.' },
  { key: 'clothing-fit', label: 'Clothing & fit', hint: 'Shoulder seam, armhole, waist placement, sleeve and hem length, tailoring versus buying.' },
  { key: 'personal-colour', label: 'Personal colour', hint: 'Undertone exploration, palettes that repeat in your own wardrobe, and what you want to test.' },
  { key: 'accessories', label: 'Accessories', hint: 'Glasses frame balance, jewellery scale, bag, watch, hat — the small proportion levers.' },
  { key: 'fragrance', label: 'Fragrance', hint: 'Dose, fit for your settings, season, and whether scent is part of how you want to read.' },
  { key: 'overall-presentation', label: 'Overall presentation', hint: 'The sum: grooming consistency, photographic presentation, and how you want to be perceived.' }
];

const EVIDENCE_FOR_PLANS: Record<string, number> = {
  strong: 1,
  moderate: 0.78,
  professional: 0.62,
  cosmetic: 0.55,
  traditional: 0.42,
  emerging: 0.4,
  limited: 0.36,
  weak: 0.16,
  unsupported: 0.05,
  dangerous: 0
};

const COST_LABEL: Record<string, string> = {
  free: 'Free',
  low: 'Low cost',
  mid: 'Mid cost',
  high: 'High cost',
  professional: 'Professional / clinical'
};

/** Estimated band widths — bands, never invented currency. */
const BAND_WIDTH: Record<string, number> = { free: 4, low: 18, mid: 42, high: 90, professional: 160 };

function mapTechniqueCost(raw: string): CostBand {
  const s = (raw || '').trim().toLowerCase();
  if (s === 'free' || s === '$') return s === 'free' ? 'free' : 'low';
  if (s === '$$') return 'mid';
  if (s === '$$$') return 'high';
  if (s === '$$$$') return 'professional';
  return 'mid';
}

function blankCategory(def: CatDef): AssessmentCategory {
  return { id: def.key, label: def.label, baseline: '', desired: '', options: [], rankScore: 0, band: 'hold', note: '' };
}

function blankOption(): ImprovementOption {
  return {
    id: newId('opt'),
    label: '',
    techniqueId: null,
    impact: 5,
    effort: 5,
    costBand: 'low',
    weeksToSee: 4,
    reversibility: 2,
    risk: 1,
    evidence: 'moderate',
    limitations: '',
    nextStep: ''
  };
}

/** rankScore + band per category, always recomputed from the user's own numbers. */
function withRanks(cats: AssessmentCategory[]): AssessmentCategory[] {
  return cats.map((c) => {
    const { ranked } = rankOptions(c.options ?? []);
    const top = ranked[0];
    return { ...c, rankScore: top ? top.score : 0, band: top ? top.band : 'hold' };
  });
}

/** A ranked option plus the category it came from — the shape every ranking
 *  view on this page consumes. */
type Ranked = ScoredOption & { categoryId: string; categoryLabel: string };

function rankAll(cats: AssessmentCategory[], budgetSensitivity = 0) {
  const all: Ranked[] = [];
  for (const c of cats) {
    const { ranked } = rankOptions((c.options ?? []).filter((o) => o.label.trim().length > 0), { budgetSensitivity });
    for (const o of ranked) all.push({ ...o, categoryId: c.id, categoryLabel: c.label });
  }
  return all.sort((a, b) => b.score - a.score || a.effort - b.effort);
}

function refuseAll(cats: AssessmentCategory[]) {
  const out: Ranked[] = [];
  for (const c of cats) {
    const { refused } = rankOptions(c.options ?? []);
    for (const o of refused) out.push({ ...o, categoryId: c.id, categoryLabel: c.label });
  }
  return out;
}

/* -------------------------------------------------------------- commit helpers */

function useCommit(value: string | number, save: (v: string | number) => void, ms = 450) {
  const [draft, setDraft] = useState<string | number>(value);
  const dirty = useRef(false);
  const latest = useRef(draft);
  const saveRef = useRef(save);
  latest.current = draft;
  saveRef.current = save;
  useEffect(() => {
    if (!dirty.current) setDraft(value);
  }, [value]);
  useEffect(() => {
    if (draft === value) {
      dirty.current = false;
      return;
    }
    dirty.current = true;
    const t = setTimeout(() => {
      dirty.current = false;
      saveRef.current(draft);
    }, ms);
    return () => clearTimeout(t);
  }, [draft, value, ms]);
  useEffect(
    () => () => {
      if (dirty.current) saveRef.current(latest.current);
    },
    []
  );
  return [draft, setDraft] as const;
}

function CommitBlock({
  label,
  value,
  onSave,
  placeholder,
  rows = 3,
  hint
}: {
  label: string;
  value: string;
  onSave: (v: string) => void;
  placeholder?: string;
  rows?: number;
  hint?: string;
}) {
  const [draft, setDraft] = useCommit(value, (v) => onSave(String(v)));
  return (
    <Field label={label} hint={hint}>
      <TextArea value={String(draft)} onChange={(v) => setDraft(v)} placeholder={placeholder} rows={rows} />
    </Field>
  );
}

function CommitLine({
  label,
  value,
  onSave,
  placeholder,
  type = 'text',
  hint
}: {
  label: string;
  value: string;
  onSave: (v: string) => void;
  placeholder?: string;
  type?: string;
  hint?: string;
}) {
  const [draft, setDraft] = useCommit(value, (v) => onSave(String(v)));
  return (
    <Field label={label} hint={hint}>
      <TextInput value={draft} onChange={(v) => setDraft(v)} placeholder={placeholder} type={type} />
    </Field>
  );
}

function CommitNum({
  label,
  value,
  onSave,
  min = 0,
  max = 52,
  suffix
}: {
  label: string;
  value: number;
  onSave: (v: number) => void;
  min?: number;
  max?: number;
  suffix?: string;
}) {
  const [draft, setDraft] = useCommit(value, (v) => onSave(Number(v) || 0));
  return (
    <Field label={`${label}${suffix ? ` (${suffix})` : ''}`}>
      <input
        className="gl-input"
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={String(draft)}
        onChange={(e) => {
          const n = Number(e.target.value);
          setDraft(Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : min);
        }}
      />
    </Field>
  );
}

/* -------------------------------------------------------------------- saving */

function writeCats(a: AnyRow, cats: AssessmentCategory[]) {
  return saveRow(TABLES.assessments, { id: a.id, categories: withRanks(cats) });
}

function patchCategory(a: AnyRow, catId: string, patch: Partial<AssessmentCategory>) {
  const cats = (a.categories as AssessmentCategory[]) ?? [];
  return writeCats(a, cats.map((c) => (c.id === catId ? { ...c, ...patch } : c)));
}

function patchOption(a: AnyRow, catId: string, optId: string, patch: Partial<ImprovementOption>) {
  const cats = (a.categories as AssessmentCategory[]) ?? [];
  return writeCats(a, cats.map((c) => (c.id === catId ? { ...c, options: c.options.map((o) => (o.id === optId ? { ...o, ...patch } : o)) } : c)));
}

/* ---------------------------------------------------------------- components */

function BandChip({ band }: { band: Band }) {
  const tone = band === 'quick-win' ? 'gold' : band === 'worthwhile' ? 'strong' : band === 'consider' ? 'info' : band === 'hold' ? 'limited' : 'danger';
  return <Chip tone={tone as any}>{BAND_LABEL[band]}</Chip>;
}

function ScoreBreakdown({ opt }: { opt: ScoredOption }) {
  return (
    <div className="lm-breakdown">
      <div className="lm-breakdown__head">
        <span className="gl-label">Scoring components</span>
        <span className="gl-tech">score {opt.score}/100</span>
      </div>
      <DistributionBars rows={opt.components.map((c) => ({ label: c.label, value: c.value }))} max={100} />
      <p className="gl-small gl-faint">
        Computed locally by the prioritisation rules from the numbers you entered — impact, effort, cost band, weeks, reversibility, risk and your
        evidence grade. Nothing here is measured by a camera.
      </p>
    </div>
  );
}

function OptionEditor({
  a,
  cat,
  opt,
  techniques,
  onRemove
}: {
  a: AnyRow;
  cat: AssessmentCategory;
  opt: ImprovementOption;
  techniques: AnyRow[];
  onRemove: () => void;
}) {
  const scored = scoreOption(opt);
  const linked = techniques.find((t) => t.id === opt.techniqueId);
  const [showMath, setShowMath] = useState(false);
  return (
    <div className="lm-option">
      <div className="lm-option__head">
        <CommitLine label="Improvement option" value={opt.label} onSave={(v) => patchOption(a, cat.id, opt.id, { label: v })} placeholder="e.g. Switch to a lower, looser ponytail" />
        <div className="lm-option__flags">
          <BandChip band={scored.band} />
          <IconButton label="Remove this option" onClick={onRemove}>
            <Trash2 size={14} />
          </IconButton>
        </div>
      </div>
      <div className="gl-form-row">
        <Field label="Evidence grade (yours)" hint="Your reading of the evidence you found, or the grade of the linked library entry.">
          <Select
            value={opt.evidence}
            onChange={(v) => void patchOption(a, cat.id, opt.id, { evidence: v as EvidenceGrade })}
            options={GRADE_OPTIONS}
          />
        </Field>
        <Field label="Cost band" hint="Band, not a price. Glow Lab never invents currency.">
          <Select value={opt.costBand} onChange={(v) => void patchOption(a, cat.id, opt.id, { costBand: v as CostBand })} options={BAND_OPTIONS} />
        </Field>
      </div>
      <div className="lm-sliders">
        <Range label="Expected impact" value={opt.impact} min={0} max={10} onChange={(v) => void patchOption(a, cat.id, opt.id, { impact: v })} format={(v) => `${v}/10 you entered`} />
        <Range label="Effort required" value={opt.effort} min={0} max={10} onChange={(v) => void patchOption(a, cat.id, opt.id, { effort: v })} format={(v) => `${v}/10 you entered`} />
        <Range label="Reversibility" value={opt.reversibility} min={0} max={4} onChange={(v) => void patchOption(a, cat.id, opt.id, { reversibility: v })} format={(v) => `${v}/4`} />
        <Range label="Risk of harm" value={opt.risk} min={0} max={4} onChange={(v) => void patchOption(a, cat.id, opt.id, { risk: v })} format={(v) => `${v}/4`} />
      </div>
      <div className="gl-form-row">
        <CommitNum label="Weeks before you would see a change" value={opt.weeksToSee} onSave={(v) => void patchOption(a, cat.id, opt.id, { weeksToSee: v })} min={0} max={104} suffix="weeks" />
        <Field
          label="Link an Evidence-library technique"
          hint="Prefills grade, cost band, limitations and first step. Impact, effort, timing, risk and reversibility stay yours."
        >
          <Select
            value={opt.techniqueId ?? ''}
            onChange={(v) => {
              const t = techniques.find((x) => x.id === v);
              if (!t) return void patchOption(a, cat.id, opt.id, { techniqueId: null });
              void patchOption(a, cat.id, opt.id, {
                techniqueId: t.id,
                label: opt.label.trim() ? opt.label : String(t.title ?? ''),
                evidence: (t.evidence ?? 'limited') as EvidenceGrade,
                costBand: mapTechniqueCost(String(t.costBand ?? '')),
                limitations: Array.isArray(t.limitations) ? (t.limitations as string[]).join(' · ') : String(t.limitations ?? ''),
                nextStep: String(t.timeToTry ?? '')
              });
            }}
            options={techniques.map((t) => ({ value: t.id, label: `${t.title} — ${t.domain} (${t.evidence})` }))}
            placeholder="No linked technique"
          />
        </Field>
      </div>
      {linked ? (
        <div className="gl-small gl-muted lm-linked">
          From the library: <Link to="/evidence">{String(linked.title)}</Link> · evidence {String(linked.evidence)} · safety {String(linked.safety)} ·{' '}
          {Array.isArray(linked.risks) ? (linked.risks as string[]).join('; ') : 'no risks recorded'}
        </div>
      ) : null}
      <div className="gl-form-row">
        <CommitBlock label="Limitations you accept" value={opt.limitations} onSave={(v) => void patchOption(a, cat.id, opt.id, { limitations: v })} placeholder="What this does not do, what it costs in time" rows={2} />
        <CommitBlock label="Next concrete step" value={opt.nextStep} onSave={(v) => void patchOption(a, cat.id, opt.id, { nextStep: v })} placeholder="The one thing you would actually do first" rows={2} />
      </div>
      <div className="lm-option__foot">
        <Button variant="ghost" size="sm" onClick={() => setShowMath((s) => !s)}>
          {showMath ? 'Hide scoring math' : 'Show scoring math'}
        </Button>
        {scored.band === 'avoid' ? <Chip tone="danger">Ranked lowest — see the refusal list</Chip> : null}
      </div>
      {showMath ? <ScoreBreakdown opt={scored} /> : null}
    </div>
  );
}

function CategoryEditor({
  a,
  cat,
  def,
  techniques,
  media,
  onLinkPhotos
}: {
  a: AnyRow;
  cat: AssessmentCategory;
  def: CatDef;
  techniques: AnyRow[];
  media: AnyRow[];
  onLinkPhotos: (catId: string) => void;
}) {
  const linked = ((a.data?.categoryMedia as Record<string, string[]>) ?? {})[cat.id] ?? [];
  const photos = media.filter((m) => linked.includes(m.id));
  const scored = rankOptions(cat.options ?? []);
  const summary = scored.ranked[0];
  return (
    <details className="gl-details lm-cat" id={`cat-${cat.id}`}>
      <summary>
        <span className="lm-cat__no">{String(CATEGORIES.findIndex((c) => c.key === cat.id) + 1).padStart(2, '0')}</span>
        <span className="lm-cat__name">{def.label}</span>
        {def.optional ? <Chip>optional</Chip> : null}
        <span className="lm-cat__count">{cat.options.length ? `${cat.options.length} option${cat.options.length > 1 ? 's' : ''}` : 'no options yet'}</span>
        {cat.options.length ? <BandChip band={cat.band} /> : null}
      </summary>
      <div className="gl-details__body">
        <p className="gl-small gl-faint lm-cat__hint">{def.hint}</p>
        <div className="lm-cat__grid">
          <CommitBlock
            label="Current baseline — in your words"
            value={cat.baseline}
            onSave={(v) => void patchCategory(a, cat.id, { baseline: v })}
            placeholder="What is true today. Describe it the way you would to a professional, not the way an internet comment section would."
            rows={4}
          />
          <CommitBlock
            label="Desired outcome"
            value={cat.desired}
            onSave={(v) => void patchCategory(a, cat.id, { desired: v })}
            placeholder="Specific, observable, and yours — not a trend."
            rows={4}
          />
        </div>
        <div className="lm-cat__photos">
          <div className="gl-row gl-row--between" style={{ alignItems: 'center', gap: 'var(--glow-sp-3)' }}>
            <span className="gl-label">Standardised photographs attached ({photos.length})</span>
            <Button size="sm" variant="ghost" onClick={() => onLinkPhotos(cat.id)}>
              Link or capture photos
            </Button>
          </div>
          {photos.length ? (
            <div className="lm-photoline">
              {photos.map((p) => (
                <Link to="/media" key={p.id} className="lm-photochip">
                  {String(p.title || 'Untitled')}
                  <span className="gl-tech">{p.conditions || 'conditions not recorded'}</span>
                </Link>
              ))}
            </div>
          ) : (
            <p className="gl-small gl-faint">
              Optional. Photos make the before/after honest: same distance, same light, same expression. Without them the baseline is still valid — it is
              just text.
            </p>
          )}
        </div>
        <CommitBlock
          label="Category note (read-only for you)"
          value={cat.note}
          onSave={(v) => void patchCategory(a, cat.id, { note: v })}
          placeholder="Anything a professional said, or something you want to revisit later"
          rows={2}
        />
        <div className="lm-cat__options">
          <div className="gl-row gl-row--between" style={{ alignItems: 'center' }}>
            <span className="gl-label">Improvement options</span>
            <Button size="sm" onClick={() => void patchCategory(a, cat.id, { options: [...(cat.options ?? []), blankOption()] })}>
              <Plus size={14} /> Add option
            </Button>
          </div>
          {cat.options.length ? (
            cat.options.map((o) => (
              <OptionEditor
                key={o.id}
                a={a}
                cat={cat}
                opt={o}
                techniques={techniques}
                onRemove={() => void patchCategory(a, cat.id, { options: cat.options.filter((x) => x.id !== o.id) })}
              />
            ))
          ) : (
            <p className="gl-small gl-faint">
              No options yet. A category with no options still counts as an assessed baseline — it simply cannot be ranked, so nothing is invented for it.
            </p>
          )}
        </div>
        {summary ? (
          <div className="lm-cat__verdict">
            <div className="gl-row gl-row--tight">
              <BandChip band={cat.band} />
              <span className="gl-tech">rank {cat.rankScore}/100</span>
            </div>
            <p className="gl-small">
              Best-ranked option: <b>{summary.label}</b> — {summary.bandReason}
            </p>
            <p className="gl-small gl-faint">{BAND_NOTE[cat.band]}</p>
          </div>
        ) : null}
      </div>
    </details>
  );
}

function BaselinePanel({ a, cats, techniques, media }: { a: AnyRow; cats: AssessmentCategory[]; techniques: AnyRow[]; media: AnyRow[] }) {
  const [pickerFor, setPickerFor] = useState<string | null>(null);
  const target = pickerFor ? cats.find((c) => c.id === pickerFor) : undefined;
  const current = ((a.data?.categoryMedia as Record<string, string[]>) ?? {});
  const linkedIds = pickerFor ? current[pickerFor] ?? [] : [];
  const attachPhotos = (catId: string, rows: AnyRow[]) => {
    const allIds = [...new Set([...(((a.baselineMediaIds as string[]) ?? []) as string[]), ...rows.map((r) => r.id)])];
    for (const r of rows) void saveRow(TABLES.mediaItems, { id: r.id, linkedDomain: 'looksmaxxing', linkedIds: [a.id] });
    const next = catId ? { ...current, [catId]: [...(current[catId] ?? []), ...rows.map((r) => r.id)] } : current;
    void saveRow(TABLES.assessments, { id: a.id, baselineMediaIds: allIds, data: { ...a.data, categoryMedia: next } });
  };
  return (
    <Card>
      <CardHead
        title="Personal baseline"
        eyebrow="Section 01"
        sub="Fourteen categories. Each one stores what is true now, what you want, and the options you are weighing."
        right={
          <div className="gl-row gl-row--tight">
            <Chip tone="info">Saved automatically as you type</Chip>
            <span className="gl-tech">updated {new Date(a.updatedAt).toLocaleTimeString()}</span>
          </div>
        }
      />
      <div className="gl-form-row">
        <CommitLine label="Assessment title" value={String(a.name ?? '')} onSave={(v) => void saveRow(TABLES.assessments, { id: a.id, name: v })} />
        <DateInput label="Taken on (anchors every later comparison)" value={String(a.takenOn ?? todayISO())} onChange={(v) => void saveRow(TABLES.assessments, { id: a.id, takenOn: v })} />
      </div>
      <CommitBlock
        label="Summary in your own words"
        value={String(a.summary ?? '')}
        onSave={(v) => void saveRow(TABLES.assessments, { id: a.id, summary: v })}
        placeholder="Two or three sentences: what you are actually working on, and what you have decided to leave alone."
        rows={3}
        hint="Written by you. Glow Lab does not generate a summary of your face."
      />
      <div className="lm-baseline-photos">
        <div className="gl-row gl-row--between" style={{ alignItems: 'center' }}>
          <span className="gl-label">Assessment baseline set ({((a.baselineMediaIds as string[]) ?? []).length})</span>
          <PhotoPicker
            label="Capture baseline photos"
            kind="baseline"
            album="Face — baseline"
            withConditions
            standard
            onPick={(rows) => attachPhotos('', rows)}
          />
        </div>
        {(((a.baselineMediaIds as string[]) ?? []) as string[]).length ? (
          <div className="lm-photoline">
            {(((a.baselineMediaIds as string[]) ?? []) as string[])
              .map((id) => media.find((m) => m.id === id))
              .filter(Boolean)
              .map((m) => (
                <Link to="/media" key={m!.id} className="lm-photochip">
                  {String(m!.title || 'Untitled')}
                  <span className="gl-tech">{String(m!.conditions || 'no conditions recorded')}</span>
                </Link>
              ))}
          </div>
        ) : (
          <p className="gl-small gl-faint">
            A standardised set (front, left, right, three-quarter, same light and distance) is what turns this assessment into a comparison later. It is
            optional — the written baseline is valid on its own.
          </p>
        )}
      </div>
      <div className="lm-cats">
        {cats.map((c) => {
          const def = CATEGORIES.find((d) => d.key === c.id) ?? { key: c.id, label: c.label, hint: '' };
          return <CategoryEditor key={c.id} a={a} cat={c} def={def} techniques={techniques} media={media} onLinkPhotos={(id) => setPickerFor(id)} />;
        })}
      </div>
      <Modal open={Boolean(target)} onClose={() => setPickerFor(null)} title={`Photographs — ${target?.label ?? ''}`} wide>
        <p className="gl-small gl-muted">
          Tick any stored photograph to attach it to this category, or capture a new standardised one. Attachments persist with the assessment.
        </p>
        <PhotoPicker
          label="Capture and attach"
          kind="baseline"
          album="Face — baseline"
          withConditions
          standard
          onPick={(rows) => {
            if (pickerFor) attachPhotos(pickerFor, rows);
          }}
        />
        <div className="lm-pickgrid">
          {media.map((m) => {
            const on = linkedIds.includes(m.id);
            return (
              <button
                type="button"
                key={m.id}
                className="lm-pick"
                data-on={on}
                aria-pressed={on}
                onClick={() => {
                  if (!pickerFor) return;
                  const nextIds = on ? linkedIds.filter((x) => x !== m.id) : [...linkedIds, m.id];
                  const next = { ...current, [pickerFor]: nextIds };
                  void saveRow(TABLES.assessments, { id: a.id, data: { ...a.data, categoryMedia: next } });
                }}
              >
                <span>{String(m.title || 'Untitled')}</span>
                <span className="gl-tech">
                  {String(m.conditions || 'no conditions')} · {formatDate(String(m.takenOn ?? ''))}
                </span>
              </button>
            );
          })}
          {!media.length ? <p className="gl-small gl-faint">Nothing stored yet — capture one above.</p> : null}
        </div>
      </Modal>
    </Card>
  );
}

function PriorityColumn({
  band,
  rows,
  onOpen
}: {
  band: Band;
  rows: Ranked[];
  onOpen: (categoryId: string) => void;
}) {
  return (
    <div className="lm-band" data-band={band}>
      <div className="lm-band__head">
        <span className="gl-label">{BAND_LABEL[band]}</span>
        <span className="gl-tech">{rows.length}</span>
      </div>
      <p className="gl-small gl-faint">{BAND_NOTE[band]}</p>
      {rows.length ? (
        <ul className="lm-band__list">
          {rows.map((o) => (
            <li key={`${o.categoryId}-${o.id}`}>
              <button type="button" className="lm-band__row" onClick={() => onOpen(o.categoryId)}>
                <span className="lm-band__title">{o.label}</span>
                <span className="gl-tech">
                  {o.categoryLabel} · {o.score}/100 · {o.costBand} · {o.weeksToSee}w
                </span>
                <span className="gl-small">{o.bandReason}</span>
                <span className="lm-band__go">
                  open category <ChevronRight size={13} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="gl-small gl-faint">Nothing in this band yet.</p>
      )}
    </div>
  );
}

const BANDS: Band[] = ['quick-win', 'worthwhile', 'consider', 'hold', 'avoid'];

function PrioritiesPanel({
  a,
  cats,
  budgetSensitivity,
  onOpenCategory
}: {
  a: AnyRow;
  cats: AssessmentCategory[];
  budgetSensitivity: number;
  onOpenCategory: (id: string) => void;
}) {
  const [mode, setMode] = useState<'bands' | 'index'>('bands');
  const ranked = useMemo(() => rankAll(cats, budgetSensitivity), [cats, budgetSensitivity]);
  const refused = useMemo(() => refuseAll(cats), [cats]);
  const scored = useMemo(
    () =>
      [...cats]
        .map((c) => ({ cat: c, best: rankOptions(c.options ?? [], { budgetSensitivity }).ranked[0] }))
        .filter((x) => x.best)
        .sort((x, y) => (y.best as ScoredOption).score - (x.best as ScoredOption).score),
    [cats, budgetSensitivity]
  );

  return (
    <Card>
      <CardHead
        title="Appearance priorities"
        eyebrow="Section 02"
        sub="Ranked by the local cost–benefit rules over your own numbers. Bands, not a body score."
        right={
          <SegmentedControl
            value={mode}
            onChange={(v) => setMode(v as 'bands' | 'index')}
            options={[
              { value: 'bands', label: 'Bands' },
              { value: 'index', label: 'Index list' }
            ]}
          />
        }
      />
      <SafetyBanner tone="note">
        <b>No overall attractiveness score is produced, by design.</b>
        <div className="gl-small">
          There is no validated instrument that turns a face into one number, and a single score could not tell you what to do next. What you get instead:
          per-option bands, the reason for each band, and the arithmetic behind it — all from the impact, effort, cost, timing, risk and reversibility you
          entered.
        </div>
      </SafetyBanner>
      <div className="lm-budget">
        <Range
          label="Your budget sensitivity"
          value={budgetSensitivity}
          min={0}
          max={3}
          onChange={(v) => void saveRow(TABLES.assessments, { id: a.id, data: { ...a.data, budgetSensitivity: v } })}
          format={(v) => (v === 0 ? 'not a factor right now' : v === 3 ? 'spending is the constraint' : `weight ${v}/3`)}
        />
        <p className="gl-small gl-faint">
          This slider is stored on the assessment. It changes how hard expensive, weakly-evidenced options are penalised — it does not change your data.
        </p>
      </div>
      {mode === 'bands' ? (
        <div className="lm-bandgrid">
          {BANDS.map((b) => (
            <PriorityColumn key={b} band={b} rows={ranked.filter((r) => r.band === b)} onOpen={onOpenCategory} />
          ))}
        </div>
      ) : (
        <IndexList>
          {ranked.length ? (
            ranked.map((o, i) => (
              <IndexRow
                key={`${o.categoryId}-${o.id}`}
                no={i + 1}
                title={o.label}
                sub={`${o.categoryLabel} · ${o.costBand} · ${o.evidence} evidence · ${o.weeksToSee} weeks · ${BAND_LABEL[o.band]}`}
                right={<span className="gl-tech">{o.score}</span>}
                onClick={() => onOpenCategory(o.categoryId)}
              />
            ))
          ) : (
            <div className="gl-empty">
              <h3>Nothing to rank yet</h3>
              <p className="gl-small gl-muted">Add at least one improvement option to a category in the baseline section.</p>
            </div>
          )}
        </IndexList>
      )}
      <div className="lm-categoryverdicts">
        <span className="gl-label">Category verdicts</span>
        {scored.length ? (
          <ul className="lm-verdictlist">
            {scored.map(({ cat, best }) => (
              <li key={cat.id}>
                <button type="button" onClick={() => onOpenCategory(cat.id)}>
                  <span>{cat.label}</span>
                  <span className="gl-tech">{cat.rankScore}</span>
                  <BandChip band={cat.band} />
                  <span className="gl-small gl-faint">{best ? best.label : ''}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="gl-small gl-faint">No category has a rankable option yet.</p>
        )}
      </div>
      {refused.length ? (
        <div className="lm-refusals">
          <SafetyBanner tone="danger" title="Refused recommendations">
            <p className="gl-small">
              These entries are stored because you entered them, and they are shown here rather than ranked. Glow Lab does not plan them, and does not put
              them in any plan template.
            </p>
            <ul className="lm-refusallist">
              {refused.map((o) => (
                <li key={`${o.categoryId}-${o.id}`}>
                  <ShieldAlert size={14} aria-hidden />
                  <div>
                    <b>{o.label}</b> <span className="gl-tech">{o.categoryLabel}</span>
                    <div className="gl-small">{o.bandReason}</div>
                    {o.limitations ? <div className="gl-small gl-faint">Your note: {o.limitations}</div> : null}
                    <Link to="/evidence" className="gl-small">
                      Read the evidence entry on unsafe practices
                    </Link>
                  </div>
                </li>
              ))}
            </ul>
          </SafetyBanner>
        </div>
      ) : null}
      <PullQuote cite="Glow Lab working principle">
        Nothing in this list is a defect. It is a set of choices, ranked by what they cost you and what the evidence says you get back — and a number of
        perfectly ordinary features are not problems to fix.
      </PullQuote>
      <SafetyBanner tone="warn" title="Where this stops">
        <p className="gl-small">
          If a concern is medical — a changing mole, hair falling out in patches, jaw clicking or pain, bleeding gums, a rash, disordered eating, or distress
          about your appearance that does not lift — it needs a professional assessment, not a prioritisation list. Prepare questions in{' '}
          <Link to="/services">Professional Services</Link> and record what you find in <Link to="/knowledge">your knowledge library</Link>.
        </p>
      </SafetyBanner>
    </Card>
  );
}

/* --------------------------------------------------------------------- plans */

interface Template {
  key: string;
  name: string;
  days: number;
  blurb: string;
  keep?: (o: Ranked) => boolean;
  needsDate?: boolean;
  cap: number;
}

const TEMPLATES: Template[] = [
  {
    key: 'refresh30',
    name: '30-day appearance refresh',
    days: 30,
    cap: 8,
    blurb: 'Only quick wins and worthwhile options that show within a month: free, reversible, no purchases required.'
  },
  {
    key: 'hair-skin-60',
    name: '60-day hair + skin',
    days: 60,
    cap: 8,
    keep: (o) => /hair|skin|brow|lash|groom/i.test(`${o.categoryLabel} ${o.label}`),
    blurb: 'Drawn from your hair, skin, brow and grooming categories, where the timeline is 6–8 weeks rather than days.'
  },
  {
    key: 'comprehensive90',
    name: '90-day comprehensive',
    days: 90,
    cap: 14,
    blurb: 'The highest-ranked option from each category that has one, sequenced cheapest-first so you learn before you spend.'
  },
  {
    key: 'budget',
    name: 'Budget plan',
    days: 45,
    cap: 8,
    keep: (o) => o.costBand === 'free' || o.costBand === 'low',
    blurb: 'Free and low-band options only. Uses your budget slider as a hard filter.'
  },
  {
    key: 'no-purchase',
    name: 'No-purchase plan',
    days: 45,
    cap: 8,
    keep: (o) => o.costBand === 'free' && EVIDENCE_FOR_PLANS[o.evidence] >= 0.36,
    blurb: 'Nothing you have to buy. Technique, habit, fit and framing only — the honest ceiling of free changes.'
  },
  {
    key: 'event',
    name: 'Event preparation',
    days: 21,
    cap: 7,
    needsDate: true,
    keep: (o) => o.weeksToSee <= 3 && o.risk <= 2,
    blurb: 'Back-planned from a date you give: only things that reliably show inside three weeks and can be undone.'
  },
  {
    key: 'longterm',
    name: 'Long-term transformation',
    days: 180,
    cap: 12,
    blurb: 'Slow levers with real evidence, ordered by the timeline they actually need — skin, hair, fit, strength, colour.'
  }
];

function cadenceFor(o: ScoredOption): PlanAction['cadence'] {
  if (o.costBand === 'professional' || o.risk >= 3) return 'once';
  if (o.costBand === 'free' && o.effort <= 5) return 'daily';
  if (o.weeksToSee >= 12) return 'monthly';
  return 'weekly';
}

function buildActions(tpl: Template, ranked: Ranked[], routines: AnyRow[], goals: AnyRow[]): PlanAction[] {
  const pool = ranked.filter((o) => (tpl.keep ? tpl.keep(o) : true));
  const byCategory = new Map<string, Ranked>();
  for (const o of pool) if (!byCategory.has(o.categoryId)) byCategory.set(o.categoryId, o);
  const chosen = [...byCategory.values()].sort((a, b) => b.score - a.score).slice(0, Math.max(0, tpl.cap - routines.length));
  const weeks = Math.max(1, Math.ceil(tpl.days / 7));
  const actions: PlanAction[] = chosen.map((o, i) => ({
    id: newId('act'),
    label: o.label,
    category: o.categoryLabel,
    cadence: cadenceFor(o),
    dayOffset: Math.min(weeks * 7 - 1, i * 2),
    weeks: Array.from({ length: weeks }, (_, k) => k + 1),
    costBand: o.costBand,
    techniqueId: o.techniqueId,
    productId: null,
    goalId: goals.find((g) => String(g.domain) === o.categoryId)?.id ?? null,
    doneOn: []
  }));
  for (const r of routines.filter((x) => x.active)) {
    actions.push({
      id: newId('act'),
      label: `${r.name} — keep it running`,
      category: String(r.domain ?? 'routine'),
      cadence: 'daily',
      dayOffset: 0,
      weeks: Array.from({ length: weeks }, (_, k) => k + 1),
      costBand: 'free',
      techniqueId: null,
      productId: null,
      goalId: null,
      doneOn: []
    });
  }
  return actions;
}

function buildMilestones(tpl: Template, startOn: string, rankedCount: number): PlanMilestone[] {
  const w = Math.ceil(tpl.days / 7);
  const marks = [
    { label: 'Baseline set captured (same light, same distance)', offset: 0 },
    ...(rankedCount ? [{ label: 'First two weeks of actions completed', offset: 14 }] : []),
    { label: `Week ${Math.max(2, Math.round(w / 2))} review photographs`, offset: Math.round(tpl.days / 2) },
    { label: `Week ${w} comparison against baseline`, offset: tpl.days - 2 },
    { label: 'Verdict written: keep, change, or stop', offset: tpl.days }
  ];
  return marks.map((m) => ({ id: newId('mil'), label: m.label, dueOn: addDays(startOn, m.offset), metOn: null, mediaId: null }));
}

function expectedFor(a: PlanAction, startOn: string, days: number, today: string): number {
  const elapsed = Math.max(0, Math.round((new Date(today).getTime() - new Date(startOn).getTime()) / 86400000) + 1);
  if (elapsed <= a.dayOffset) return 0;
  const span = Math.min(days, elapsed) - a.dayOffset;
  const activeWeeks = a.weeks && a.weeks.length ? a.weeks : Array.from({ length: Math.ceil(days / 7) }, (_, i) => i + 1);
  let n = 0;
  for (const w of activeWeeks) {
    const from = (w - 1) * 7;
    const to = w * 7 - 1;
    if (from + a.dayOffset >= days) continue;
    if (elapsed <= from + a.dayOffset) break;
    const counted = Math.min(to, span - 1) - from + 1;
    if (counted <= 0) continue;
    if (a.cadence === 'daily') n += counted;
    else if (a.cadence === 'weekly') n += 1;
    else if (a.cadence === 'monthly') n += w === 1 || w % 4 === 1 ? 1 : 0;
    else n += w === Math.min(...activeWeeks) ? 1 : 0;
  }
  return Math.max(0, n);
}

function planProgress(p: AnyRow, today = todayISO()) {
  const actions = (p.actions as PlanAction[]) ?? [];
  const days = Number(p.days) || 30;
  let expected = 0;
  let done = 0;
  for (const a of actions) {
    expected += expectedFor(a, String(p.startOn), days, today);
    done += ((a.doneOn as string[]) ?? []).length;
  }
  return { expected, done, pct: expected ? Math.min(100, Math.round((done / expected) * 100)) : 0 };
}

function costTotals(actions: PlanAction[], purchases: AnyRow[]) {
  const bands = new Map<string, number>();
  for (const a of actions) bands.set(a.costBand, (bands.get(a.costBand) ?? 0) + 1);
  const linkedProductIds = actions.map((a) => a.productId).filter(Boolean) as string[];
  const spent = purchases.filter((x) => linkedProductIds.includes(String(x.productId))).reduce((sum, x) => sum + (Number(x.amount) || 0), 0);
  return { bands: [...bands.entries()], spent, productIds: linkedProductIds };
}

function PlansPanel({
  plans,
  ranked,
  routines,
  goals,
  techniques,
  purchases,
  products,
  media,
  assessmentExists,
  goAssessment
}: {
  plans: AnyRow[];
  ranked: Ranked[];
  routines: AnyRow[];
  goals: AnyRow[];
  techniques: AnyRow[];
  purchases: AnyRow[];
  products: AnyRow[];
  media: AnyRow[];
  assessmentExists: boolean;
  goAssessment: () => void;
}) {
  const toast = useToast();
  const [openTpl, setOpenTpl] = useState(false);
  const [tpl, setTpl] = useState<Template>(TEMPLATES[0]);
  const [eventDate, setEventDate] = useState(addDays(todayISO(), 30));
  const [name, setName] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [adjustNote, setAdjustNote] = useState<Record<string, string>>({});
  const selected = plans.slice().sort((a, b) => Number(b.updatedAt) - Number(a.updatedAt))[0];
  const [pickId, setPickId] = useState<string | null>(null);
  const plan = plans.find((p) => p.id === (pickId ?? selected?.id)) ?? selected;
  const today = todayISO();

  const createPlan = () => {
    const startOn = tpl.needsDate && eventDate > today ? today : today;
    const days = tpl.needsDate && eventDate > today ? Math.max(7, Math.min(180, Math.round((new Date(eventDate).getTime() - new Date(startOn).getTime()) / 86400000))) : tpl.days;
    const actions = buildActions({ ...tpl, days }, ranked, routines, goals);
    const milestones = buildMilestones({ ...tpl, days }, startOn, actions.length);
    const priorities = [...new Set(actions.map((a) => a.category))];
    const row: Record<string, unknown> = {
      id: newId('pln'),
      name: name.trim() || tpl.name,
      template: tpl.key,
      days,
      startOn,
      reviewEveryDays: days <= 30 ? 10 : days <= 60 ? 15 : 30,
      budget: null,
      priorities,
      actions,
      milestones,
      status: 'draft',
      adjustments: [{ on: today, note: `Built from ${actions.length} ranked option(s) and ${routines.filter((r) => r.active).length} active routine(s).` }]
    };
    void saveRow(TABLES.plans, row as Partial<AnyRow>).then(() => {
      toast('Plan created from your own ranked options.', 'ok');
      setOpenTpl(false);
      setName('');
    });
  };

  const patchPlan = (p: AnyRow, patch: Record<string, unknown>) => saveRow(TABLES.plans, { id: p.id, ...patch });

  return (
    <Card>
      <CardHead
        title="Improvement plans"
        eyebrow="Section 05"
        sub="Templates are seeds for your own top-ranked options and routines — they are not pre-filled dummy schedules."
        right={
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              if (!ranked.length) {
                toast('No ranked options yet — the plan would have nothing honest to put in it.', 'bad');
                goAssessment();
                return;
              }
              setOpenTpl(true);
            }}
          >
            <Plus size={14} /> New plan from template
          </Button>
        }
      />
      {!ranked.length ? (
        <EmptyPlate
          kicker="Not enough data"
          title="There is nothing to plan yet, and Glow Lab will not invent actions"
          body="A plan built from dummy text would tell you nothing. Run a baseline assessment and add at least one improvement option with impact, effort, cost band and timing you chose — then the templates fill from that."
          action={<Button variant="primary" onClick={goAssessment}>{assessmentExists ? 'Open the assessment' : 'Start the assessment'}</Button>}
        />
      ) : null}
      {plans.length ? (
        <div className="lm-planbar">
          {plans.map((p) => {
            const prog = planProgress(p, today);
            return (
              <button key={p.id} type="button" className="lm-plannav" data-on={p.id === plan?.id} onClick={() => setPickId(p.id)}>
                <span className="gl-serif">{String(p.name)}</span>
                <span className="gl-tech">
                  {String(p.status)} · {prog.done}/{prog.expected || 0} done · {formatDate(String(p.startOn))}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
      {plan ? (
        <PlanDetail
          key={plan.id}
          plan={plan}
          techniques={techniques}
          goals={goals}
          media={media}
          purchases={purchases}
          products={products}
          today={today}
          onPatch={(patch) => void patchPlan(plan, patch)}
          onDelete={() => setConfirmDelete(plan.id)}
          adjustNote={adjustNote[plan.id] ?? ''}
          setAdjustNote={(v) => setAdjustNote((s) => ({ ...s, [plan.id]: v }))}
        />
      ) : null}
      <Modal open={openTpl} onClose={() => setOpenTpl(false)} title="New plan — pick a template" wide>
        <p className="gl-small gl-muted">
          Each template filters <b>your</b> ranked options ({ranked.length} available) and appends your {routines.filter((r) => r.active).length} active
          routine(s). Cadence and day offset are assigned by stated rules, not guessed.
        </p>
        <div className="gl-form-row">
          <CommitLine label="Plan name (yours)" value={name} onSave={setName} placeholder={tpl.name} />
          <Field label="Template">
            <Select value={tpl.key} onChange={(v) => setTpl(TEMPLATES.find((t) => t.key === v) ?? TEMPLATES[0])} options={TEMPLATES.map((t) => ({ value: t.key, label: t.name }))} />
          </Field>
        </div>
        <p className="gl-small">{tpl.blurb}</p>
        {tpl.needsDate ? (
          <DateInput label="Event date — the plan back-plans from this" value={eventDate} onChange={setEventDate} />
        ) : null}
        <div className="lm-templatematch">
          {TEMPLATES.map((t) => (
            <button type="button" key={t.key} className="lm-tmatch" data-on={t.key === tpl.key} onClick={() => setTpl(t)} aria-pressed={t.key === tpl.key}>
              <span className="gl-serif">{t.name}</span>
              <span className="gl-tech">{ranked.filter((o) => (t.keep ? t.keep(o) : true)).length} of your options qualify · capped at {t.cap + routines.filter((r) => r.active).length}</span>
              <span className="gl-small gl-faint">{t.blurb}</span>
            </button>
          ))}
        </div>
        <ModalFooterNote rankedCount={ranked.length} routineCount={routines.filter((r) => r.active).length} />
      </Modal>
      <Modal
        open={Boolean(confirmDelete)}
        onClose={() => setConfirmDelete(null)}
        title="Delete this plan?"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(null)}>
              Keep it
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (confirmDelete) void softDelete(TABLES.plans, confirmDelete);
                setConfirmDelete(null);
                setPickId(null);
                toast('Plan removed. It stays restorable in Trash until you empty it.', 'ok');
              }}
            >
              Delete plan
            </Button>
          </>
        }
      >
        <p className="gl-small">
          This marks the plan deleted (soft delete, restorable). Its completed action dates are kept with the row, so your consistency history survives if you
          restore it.
        </p>
      </Modal>
    </Card>
  );
}

function ModalFooterNote({ rankedCount, routineCount }: { rankedCount: number; routineCount: number }) {
  return (
    <p className="gl-small gl-faint lm-note">
      Source of the actions: {rankedCount} ranked option(s) and {routineCount} active routine(s) currently in your records. If a template matches zero
      options it will be created with your routines only and say so in the adjustments log — it will not be padded.
    </p>
  );
}

function PlanDetail({
  plan,
  techniques,
  goals,
  media,
  purchases,
  products,
  today,
  onPatch,
  onDelete,
  adjustNote,
  setAdjustNote
}: {
  plan: AnyRow;
  techniques: AnyRow[];
  goals: AnyRow[];
  media: AnyRow[];
  purchases: AnyRow[];
  products: AnyRow[];
  today: string;
  onPatch: (patch: Record<string, unknown>) => void;
  onDelete: () => void;
  adjustNote: string;
  setAdjustNote: (v: string) => void;
}) {
  const actions = (plan.actions as PlanAction[]) ?? [];
  const milestones = (plan.milestones as PlanMilestone[]) ?? [];
  const adjustments = (plan.adjustments as { on: string; note: string }[]) ?? [];
  const prog = planProgress(plan, today);
  const costs = costTotals(actions, purchases);
  const productName = (id: string | null) => (id ? String(products.find((p) => p.id === id)?.name ?? 'record not found') : '');
  const reviewEvery = Number(plan.reviewEveryDays) || 14;
  const nextReview = (() => {
    for (let k = 0; k < 60; k += 1) {
      const d = addDays(String(plan.startOn), k * reviewEvery);
      if (d >= today) return d;
    }
    return addDays(String(plan.startOn), reviewEvery);
  })();

  const setActions = (next: PlanAction[]) => onPatch({ actions: next });
  const setAction = (id: string, patch: Partial<PlanAction>) => setActions(actions.map((a) => (a.id === id ? { ...a, ...patch } : a)));

  const heat = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of actions) for (const d of (a.doneOn as string[]) ?? []) counts.set(d, (counts.get(d) ?? 0) + 1);
    const days: { date: string; level: number; title?: string }[] = [];
    for (let i = 111; i >= 0; i -= 1) {
      const date = addDays(today, -i);
      const n = counts.get(date) ?? 0;
      days.push({ date, level: Math.min(4, n), title: n ? `${n} action(s) completed` : 'nothing logged' });
    }
    return days;
  }, [actions, today]);

  const byWeek = useMemo(() => {
    const weeks = Math.max(1, Math.ceil(Number(plan.days) / 7));
    const rows: { label: string; value: number }[] = [];
    for (let w = 1; w <= weeks; w += 1) {
      const from = addDays(String(plan.startOn), (w - 1) * 7);
      const to = addDays(String(plan.startOn), w * 7 - 1);
      let n = 0;
      for (const a of actions) for (const d of (a.doneOn as string[]) ?? []) if (d >= from && d <= to) n += 1;
      rows.push({ label: `Week ${w}`, value: n });
    }
    return rows;
  }, [actions, plan.days, plan.startOn]);

  const STATUS_ORDER: PlanRow['status'][] = ['draft', 'active', 'review', 'done', 'archived'];
  const current = String(plan.status) as PlanRow['status'];
  const nexts = STATUS_ORDER.slice(STATUS_ORDER.indexOf(current) + 1, STATUS_ORDER.indexOf(current) + 2);

  return (
    <div className="lm-plan">
      <div className="lm-plan__head">
        <div>
          <CommitLine label="Plan name" value={String(plan.name ?? '')} onSave={(v) => onPatch({ name: v })} />
          <div className="gl-row gl-row--tight" style={{ marginTop: 6 }}>
            <Chip tone={current === 'active' ? 'strong' : current === 'draft' ? 'info' : 'limited'}>{current}</Chip>
            {nexts.map((s) => (
              <Button key={s} size="sm" onClick={() => onPatch({ status: s, adjustments: [...adjustments, { on: today, note: `Status moved ${current} → ${s}` }] })}>
                Move to {s}
              </Button>
            ))}
            {current !== 'draft' ? (
              <Button size="sm" variant="ghost" onClick={() => onPatch({ status: 'draft', adjustments: [...adjustments, { on: today, note: 'Reopened as draft' }] })}>
                <RotateCcw size={13} /> Back to draft
              </Button>
            ) : null}
          </div>
        </div>
        <div className="lm-plan__meter">
          <Meter value={prog.pct} label="Completion against scheduled occurrences" />
          <p className="gl-tech">
            {prog.done} logged / {prog.expected} expected · review {formatDate(nextReview)}
          </p>
          <p className="gl-small gl-faint">
            Expected occurrences come from each action’s cadence, day offset and week list against the plan start date. Nothing counts automatically.
          </p>
        </div>
      </div>

      <div className="lm-plan__meta">
        <DateInput label="Start date" value={String(plan.startOn ?? today)} onChange={(v) => onPatch({ startOn: v })} />
        <CommitNum label="Length" value={Number(plan.days) || 30} onSave={(v) => onPatch({ days: v })} min={7} max={365} suffix="days" />
        <CommitNum label="Review every" value={reviewEvery} onSave={(v) => onPatch({ reviewEveryDays: v })} min={3} max={90} suffix="days" />
        <Field label="Budget you set" hint="Only if you enter a number. Glow Lab does not estimate a currency figure for you.">
          <TextInput
            type="number"
            value={plan.budget === null || plan.budget === undefined ? '' : String(plan.budget)}
            onChange={(v) => onPatch({ budget: v === '' ? null : Number(v) })}
            placeholder="blank = no budget set"
          />
        </Field>
      </div>

      <div className="lm-priorities">
        <span className="gl-label">Priorities this plan covers</span>
        <div className="gl-row gl-row--tight">
          {((plan.priorities as string[]) ?? []).length ? (
            ((plan.priorities as string[]) ?? []).map((p) => <Chip key={p}>{p}</Chip>)
          ) : (
            <span className="gl-small gl-faint">none recorded</span>
          )}
        </div>
      </div>

      <div className="gl-tabs" role="tablist" aria-label="Plan detail views">
        <span className="gl-tab gl-btn--gold is-active" role="tab" aria-selected>
          Actions · milestones · cost · history
        </span>
      </div>

      <div className="lm-actions">
        <div className="gl-row gl-row--between" style={{ alignItems: 'center' }}>
          <span className="gl-label">Weekly / daily actions ({actions.length})</span>
          <Button
            size="sm"
            onClick={() =>
              setActions([
                ...actions,
                {
                  id: newId('act'),
                  label: '',
                  category: 'general',
                  cadence: 'weekly',
                  dayOffset: 0,
                  weeks: [1],
                  costBand: 'free',
                  techniqueId: null,
                  productId: null,
                  goalId: null,
                  doneOn: []
                }
              ])
            }
          >
            <Plus size={14} /> Add action
          </Button>
        </div>
        {actions.map((a) => {
          const doneToday = ((a.doneOn as string[]) ?? []).includes(today);
          const exp = expectedFor(a, String(plan.startOn), Number(plan.days) || 30, today);
          const tec = techniques.find((t) => t.id === a.techniqueId);
          return (
            <div className="lm-action" key={a.id} data-done={doneToday}>
              <CommitLine label="Action" value={a.label} onSave={(v) => setAction(a.id, { label: v })} placeholder="What you actually do" />
              <div className="lm-action__grid">
                <Field label="Category">
                  <TextInput value={a.category} onChange={(v) => setAction(a.id, { category: v })} />
                </Field>
                <Field label="Cadence">
                  <Select
                    value={a.cadence}
                    onChange={(v) => setAction(a.id, { cadence: v as PlanAction['cadence'] })}
                    options={[
                      { value: 'daily', label: 'daily' },
                      { value: 'weekly', label: 'weekly' },
                      { value: 'monthly', label: 'monthly' },
                      { value: 'once', label: 'once' }
                    ]}
                  />
                </Field>
                <CommitNum label="Day offset" value={a.dayOffset} onSave={(v) => setAction(a.id, { dayOffset: v })} min={0} max={364} suffix="days from start" />
                <Field label="Cost band">
                  <Select value={a.costBand} onChange={(v) => setAction(a.id, { costBand: v })} options={BAND_OPTIONS} />
                </Field>
                <Field label="Weeks active" hint="Comma-separated week numbers.">
                  <TextInput
                    value={(a.weeks ?? []).join(', ')}
                    onChange={(v) => setAction(a.id, { weeks: v.split(',').map((x) => Number(x.trim())).filter((n) => Number.isFinite(n)) })}
                    placeholder="1, 2, 3"
                  />
                </Field>
                <Field label="Linked technique">
                  <Select
                    value={a.techniqueId ?? ''}
                    onChange={(v) => setAction(a.id, { techniqueId: v || null })}
                    options={techniques.map((t) => ({ value: t.id, label: String(t.title) }))}
                    placeholder="None"
                  />
                </Field>
                <Field label="Linked goal">
                  <Select value={a.goalId ?? ''} onChange={(v) => setAction(a.id, { goalId: v || null })} options={goals.map((g) => ({ value: g.id, label: String(g.title) }))} placeholder="None" />
                </Field>
                <Field label="Linked product" hint="Your own Market records only — Glow Lab never suggests a product or a price.">
                  <Select
                    value={a.productId ?? ''}
                    onChange={(v) => setAction(a.id, { productId: v || null })}
                    options={products.map((p) => ({ value: p.id, label: String(p.name) }))}
                    placeholder="No product linked"
                  />
                </Field>
              </div>
              {a.productId ? <div className="gl-small gl-muted">Product: {productName(a.productId)}</div> : null}
              {tec ? <div className="gl-small gl-muted">Evidence entry: <Link to="/evidence">{String(tec.title)}</Link> · {String(tec.evidence)}</div> : null}
              <div className="lm-action__foot">
                <Button
                  size="sm"
                  variant={doneToday ? 'gold' : 'default'}
                  onClick={() =>
                    setAction(a.id, {
                      doneOn: doneToday ? ((a.doneOn as string[]) ?? []).filter((d) => d !== today) : [...((a.doneOn as string[]) ?? []), today]
                    })
                  }
                >
                  {doneToday ? <Check size={13} /> : <Plus size={13} />} {doneToday ? 'Completed today — undo' : 'Mark done today'}
                </Button>
                <span className="gl-tech">
                  {((a.doneOn as string[]) ?? []).length}/{exp || 0} scheduled so far
                </span>
                <span className="gl-tech">{((a.doneOn as string[]) ?? []).slice(-3).join(' · ') || 'no dates yet'}</span>
                <IconButton label="Delete action" onClick={() => setActions(actions.filter((x) => x.id !== a.id))}>
                  <Trash2 size={13} />
                </IconButton>
              </div>
            </div>
          );
        })}
        {!actions.length ? <p className="gl-small gl-faint">No actions in this plan yet.</p> : null}
      </div>

      <div className="lm-views">
        <div>
          <span className="gl-label">Completion by day (last 16 weeks)</span>
          <HeatStrip days={heat} />
        </div>
        <div>
          <span className="gl-label">Completion by week</span>
          <DistributionBars rows={byWeek} />
        </div>
      </div>

      <div className="lm-milestones">
        <div className="gl-row gl-row--between" style={{ alignItems: 'center' }}>
          <span className="gl-label">Milestones ({milestones.length})</span>
          <Button
            size="sm"
            onClick={() =>
              setMilestones([...milestones, { id: newId('mil'), label: 'New milestone', dueOn: addDays(today, 7), metOn: null, mediaId: null }])
            }
          >
            <Plus size={14} /> Add milestone
          </Button>
        </div>
        {milestones.map((m) => {
          const shot = media.find((x) => x.id === m.mediaId);
          const overdue = !m.metOn && m.dueOn < today;
          return (
            <div className="lm-milestone" key={m.id} data-overdue={overdue}>
              <CommitLine label="Milestone" value={m.label} onSave={(v) => setMilestone(m.id, { label: v })} />
              <DateInput label="Due" value={m.dueOn} onChange={(v) => setMilestone(m.id, { dueOn: v })} />
              <div className="gl-row gl-row--tight" style={{ flexWrap: 'wrap' }}>
                {m.metOn ? (
                  <Chip tone="strong" onClick={() => setMilestone(m.id, { metOn: null })} title="Clear the completion date">
                    met {formatDate(m.metOn)} ✕
                  </Chip>
                ) : (
                  <Button size="sm" onClick={() => setMilestone(m.id, { metOn: today })}>
                    <Check size={13} /> Mark met today
                  </Button>
                )}
                <PhotoPicker
                  label={shot ? 'Replace photo' : 'Attach photo'}
                  kind="progress"
                  album="Plan milestones"
                  withConditions
                  onPick={(rows) => setMilestone(m.id, { mediaId: rows[0]?.id ?? m.mediaId })}
                />
                <IconButton label="Delete milestone" onClick={() => setMilestones(milestones.filter((x) => x.id !== m.id))}>
                  <Trash2 size={13} />
                </IconButton>
              </div>
              {shot ? <div className="gl-tech">photo: {String(shot.title || 'Untitled')} · {String(shot.conditions || 'no conditions recorded')}</div> : null}
              {overdue ? <div className="gl-small lm-overdue">Past due — reschedule the date or record what actually happened.</div> : null}
            </div>
          );
        })}
      </div>

      <div className="lm-costs">
        <span className="gl-label">Cost and time from your own numbers</span>
        <div className="gl-grid gl-grid--2">
          <Stat label="Options by cost band" value={[...costs.bands].map(([b, n]) => `${COST_LABEL[b] ?? b}: ${n}`).join(' · ') || 'none'} hint="Band counts only — a band is not a price." />
          <Stat
            label="Scheduled weeks"
            value={`${Math.ceil(Number(plan.days) / 7)} weeks from ${formatDate(String(plan.startOn))}`}
            hint="Derived from the plan length you set."
          />
          <Stat
            label="Money you actually recorded"
            value={costs.spent ? `${costs.spent.toFixed(2)} across ${costs.productIds.length} linked product(s)` : 'no purchases linked to this plan'}
            hint="Summed from your own purchase records. Nothing estimated."
          />
          <Stat
            label="Budget you set"
            value={plan.budget === null || plan.budget === undefined ? 'not set' : String(plan.budget)}
            hint="Edit the budget field above; it is stored on the plan."
          />
        </div>
        <DistributionBars rows={[...costs.bands].map(([b, n]) => ({ label: COST_LABEL[b] ?? b, value: n }))} />
        <p className="gl-small gl-faint">
          The bars count actions per band. If you want a real figure, enter prices in <Link to="/market">Beauty Market</Link> — those numbers are yours and
          this page will add them up, but it will never supply one.
        </p>
      </div>

      <div className="lm-adjust">
        <span className="gl-label">Adjustments log</span>
        <div className="gl-row gl-row--tight" style={{ gap: 'var(--glow-sp-3)', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <TextArea value={adjustNote} onChange={setAdjustNote} rows={2} placeholder="What changed and why — e.g. dropped the peel, kept the sunscreen" />
          </div>
          <Button
            onClick={() => {
              const note = adjustNote.trim();
              if (!note) return;
              onPatch({ adjustments: [...adjustments, { on: today, note }] });
              setAdjustNote('');
            }}
          >
            Log adjustment
          </Button>
        </div>
        {adjustments.length ? (
          <Timeline
            items={adjustments
              .slice()
              .reverse()
              .map((x) => ({ when: formatDate(x.on), title: x.note, tone: 'plain' as const }))}
          />
        ) : (
          <p className="gl-small gl-faint">Nothing logged yet.</p>
        )}
      </div>

      <div className="lm-danger">
        <Button variant="danger" size="sm" onClick={onDelete}>
          <Trash2 size={13} /> Delete plan
        </Button>
      </div>
    </div>
  );

  function setMilestones(next: PlanMilestone[]) {
    onPatch({ milestones: next });
  }
  function setMilestone(id: string, patch: Partial<PlanMilestone>) {
    setMilestones(milestones.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }
}

/* ---------------------------------------------------------------------- goals */

function GoalsPanel({ goals, plans }: { goals: AnyRow[]; plans: AnyRow[] }) {
  const toast = useToast();
  const add = () => {
    void saveRow(TABLES.goals, {
      id: newId('gop'),
      title: '',
      domain: 'appearance',
      status: 'active',
      priority: goals.length + 1,
      startOn: todayISO(),
      targetOn: addDays(todayISO(), 90),
      metric: '',
      targetValue: null,
      unit: '',
      planId: null
    });
    toast('Goal row created — it saves as you type.', 'ok');
  };
  return (
    <Card>
      <CardHead
        title="Goal tracking"
        eyebrow="Section 03"
        sub="Goals are yours: wording, metric, target value and dates. Nothing here is scored or graded for you."
        right={
          <Button size="sm" variant="primary" onClick={add}>
            <Plus size={14} /> Add goal
          </Button>
        }
      />
      {goals.length ? (
        <div className="lm-goals">
          {goals.map((g) => (
            <div className="lm-goal" key={g.id}>
              <CommitLine label="Goal" value={String(g.title ?? '')} onSave={(v) => void saveRow(TABLES.goals, { id: g.id, title: v })} placeholder="e.g. Keep a 12-week sunscreen habit" />
              <div className="lm-goal__grid">
                <CommitLine label="Domain" value={String(g.domain ?? '')} onSave={(v) => void saveRow(TABLES.goals, { id: g.id, domain: v })} />
                <Field label="Status">
                  <Select
                    value={String(g.status ?? 'active')}
                    onChange={(v) => void saveRow(TABLES.goals, { id: g.id, status: v })}
                    options={[
                      { value: 'active', label: 'active' },
                      { value: 'paused', label: 'paused' },
                      { value: 'completed', label: 'completed' },
                      { value: 'dropped', label: 'dropped' }
                    ]}
                  />
                </Field>
                <CommitNum label="Priority" value={Number(g.priority) || 1} onSave={(v) => void saveRow(TABLES.goals, { id: g.id, priority: v })} min={1} max={99} />
                <DateInput label="Start" value={String(g.startOn ?? todayISO())} onChange={(v) => void saveRow(TABLES.goals, { id: g.id, startOn: v })} />
                <DateInput label="Target" value={String(g.targetOn ?? '')} onChange={(v) => void saveRow(TABLES.goals, { id: g.id, targetOn: v })} />
                <CommitLine label="Metric" value={String(g.metric ?? '')} onSave={(v) => void saveRow(TABLES.goals, { id: g.id, metric: v })} placeholder="e.g. sessions logged" />
                <Field label="Target value" hint="Blank means no numeric target — that is allowed.">
                  <TextInput
                    type="number"
                    value={g.targetValue === null || g.targetValue === undefined ? '' : String(g.targetValue)}
                    onChange={(v) => void saveRow(TABLES.goals, { id: g.id, targetValue: v === '' ? null : Number(v) })}
                  />
                </Field>
                <CommitLine label="Unit" value={String(g.unit ?? '')} onSave={(v) => void saveRow(TABLES.goals, { id: g.id, unit: v })} placeholder="e.g. sessions/week" />
                <Field label="Bound plan">
                  <Select
                    value={String(g.planId ?? '')}
                    onChange={(v) => void saveRow(TABLES.goals, { id: g.id, planId: v || null })}
                    options={plans.map((p) => ({ value: p.id, label: String(p.name) }))}
                    placeholder="No plan attached"
                  />
                </Field>
              </div>
              <div className="lm-goal__foot">
                <IconButton label="Delete goal" onClick={() => void softDelete(TABLES.goals, g.id)}>
                  <Trash2 size={13} />
                </IconButton>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState title="No goals yet" body="A goal here is a plain record: title, domain, dates, the metric you care about. Add one and it saves as you type." action={<Button variant="primary" onClick={add}>Add goal</Button>} />
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------- routines */

function RoutinesPanel({ routines, logs }: { routines: AnyRow[]; logs: AnyRow[] }) {
  const today = todayISO();
  return (
    <Card>
      <CardHead title="Current routines" eyebrow="Section 04" sub="Read live from the routines you saved in their own departments. Toggling active here writes back to the routine row." />
      {routines.length ? (
        <div className="gl-list lm-routinelist">
          {routines.map((r, i) => {
            const steps = (r.steps as AnyRow[]) ?? [];
            const doneToday = logs.some((l) => l.routineId === r.id && l.doneOn === today);
            const last = logs.filter((l) => l.routineId === r.id).map((l) => String(l.doneOn)).sort().at(-1);
            const minutes = steps.reduce((s, x) => s + (Number(x.durationMin) || 0), 0);
            return (
              <div className="gl-list__row lm-routine" key={r.id}>
                <span className="gl-index__no">{String(i + 1).padStart(2, '0')}</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="gl-serif lm-routine__name">{String(r.name)}</div>
                  <div className="gl-tech lm-routine__meta">
                    {String(r.domain)} · {String(r.timeOfDay || 'anytime')} · {steps.length} step(s)
                    {minutes ? ` · ~${minutes} min from your own durations` : ''} · last logged {last ? formatDate(last) : 'never'}
                  </div>
                  <div className="gl-row gl-row--tight" style={{ marginTop: 6, flexWrap: 'wrap' }}>
                    <Chip tone={r.active ? 'strong' : 'limited'}>{r.active ? 'active' : 'paused'}</Chip>
                    <Chip tone={doneToday ? 'gold' : undefined}>{doneToday ? 'logged today' : 'not logged today'}</Chip>
                  </div>
                </div>
                <div className="gl-row gl-row--tight lm-routine__acts" style={{ flexWrap: 'wrap' }}>
                  <Button
                    size="sm"
                    variant={doneToday ? 'gold' : 'default'}
                    onClick={() => {
                      if (doneToday) {
                        const hit = logs.find((l) => l.routineId === r.id && l.doneOn === today);
                        if (hit) void softDelete(TABLES.routineLogs, hit.id);
                        return;
                      }
                      void saveRow(TABLES.routineLogs, {
                        id: newId('log'),
                        routineId: r.id,
                        doneOn: today,
                        completedSteps: steps.map((s) => String(s.id)),
                        mood: 0,
                        note: ''
                      });
                    }}
                  >
                    {doneToday ? 'Undo today’s log' : 'Log today'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => void saveRow(TABLES.routines, { id: r.id, active: !r.active })}>
                    {r.active ? 'Pause routine' : 'Activate routine'}
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyPlate
          kicker="Nothing stored"
          title="You have no routines saved yet"
          body="Routines live in their own departments — skin, hair, grooming, fragrance. Build one there and it appears here, and a plan can schedule it."
          action={
            <div className="gl-row gl-row--tight">
              <Link className="gl-btn gl-btn--sm" to="/skin">
                Skin Studio
              </Link>
              <Link className="gl-btn gl-btn--sm" to="/hair">
                Hair Studio
              </Link>
            </div>
          }
        />
      )}
      <p className="gl-small gl-faint lm-note">
        Tapping a routine logs it as done today in your routine log. Glow Lab does not mark adherence for you, and does not infer that a routine was done
        from anything other than a log you created.
      </p>
    </Card>
  );
}

/* --------------------------------------------------------------- cost–benefit */

function CostPanel({ cats, plans, purchases, budgetSensitivity }: { cats: AssessmentCategory[]; plans: AnyRow[]; purchases: AnyRow[]; budgetSensitivity: number }) {
  const rows = rankAll(cats, budgetSensitivity);
  const refused = refuseAll(cats);
  const weeks = rows.map((o) => o.weeksToSee);
  const slowest = weeks.length ? Math.max(...weeks) : 0;
  const bandCounts = COST_BANDS.map((b) => ({ label: COST_LABEL[b], value: rows.filter((o) => o.costBand === b).length }));
  const enteredPrices = purchases.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const planActionBands = new Map<string, number>();
  for (const p of plans) for (const a of ((p.actions as PlanAction[]) ?? [])) planActionBands.set(a.costBand, (planActionBands.get(a.costBand) ?? 0) + 1);

  return (
    <Card>
      <CardHead
        title="Cost–benefit comparison"
        eyebrow="Section 06"
        sub="Every option side by side on the axes you filled in. Cost is shown as a band, because you never entered a price."
      />
      {rows.length ? (
        <div style={{ overflowX: 'auto' }}>
          <table className="gl-table lm-costtable">
            <thead>
              <tr>
                <th>Option</th>
                <th>Category</th>
                <th>Impact</th>
                <th>Effort</th>
                <th>Cost band</th>
                <th>Weeks</th>
                <th>Risk</th>
                <th>Reversible</th>
                <th>Evidence</th>
                <th>Score</th>
                <th>Band</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((o) => (
                <tr key={`${o.categoryId}-${o.id}`}>
                  <td>
                    <b>{o.label}</b>
                    <div className="gl-small gl-faint">{o.nextStep || 'no next step set'}</div>
                  </td>
                  <td className="gl-small">{o.categoryLabel}</td>
                  <td className="gl-tech">{o.impact}/10</td>
                  <td className="gl-tech">{o.effort}/10</td>
                  <td className="gl-small">{COST_LABEL[o.costBand]}</td>
                  <td className="gl-tech">{o.weeksToSee}</td>
                  <td className="gl-tech">{o.risk}/4</td>
                  <td className="gl-tech">{o.reversibility}/4</td>
                  <td>
                    <EvidenceChip grade={o.evidence} />
                  </td>
                  <td className="gl-tech">{o.score}</td>
                  <td>
                    <BandChip band={o.band} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="gl-small gl-faint">No options entered yet, so there is nothing to compare — and nothing will be invented to fill this table.</p>
      )}
      <div className="gl-grid gl-grid--2" style={{ marginTop: 'var(--glow-sp-4)' }}>
        <Stat label="Longest wait you recorded" value={slowest ? `${slowest} weeks` : '—'} hint="The slowest option in your own list, not an average of strangers’ results." />
        <Stat
          label="Money recorded in your purchase log"
          value={enteredPrices ? `${enteredPrices.toFixed(2)} (your entries)` : 'no purchases recorded'}
          hint="Summed from Beauty Market purchase rows. Bands are never converted into currency here."
        />
      </div>
      <div className="lm-costsplit">
        <div>
          <span className="gl-label">Options by cost band</span>
          <DistributionBars rows={bandCounts} />
        </div>
        <div>
          <span className="gl-label">Scheduled actions by cost band (all plans)</span>
          {planActionBands.size ? <DistributionBars rows={[...planActionBands].map(([b, n]) => ({ label: COST_LABEL[b] ?? b, value: n }))} /> : <p className="gl-small gl-faint">No plan actions yet.</p>}
        </div>
      </div>
      {refused.length ? (
        <SafetyBanner tone="danger" title={`${refused.length} option(s) excluded from the comparison`}>
          <p className="gl-small">
            Entries graded ‘dangerous’ are ranked nowhere and compared nowhere. They are listed in the refusal panel with the reason instead:{' '}
            {refused.map((r) => r.label).join('; ')}.
          </p>
        </SafetyBanner>
      ) : null}
    </Card>
  );
}

/* --------------------------------------------------------------------- history */

function HistoryPanel({
  assessments,
  activeId,
  onSelect,
  plans,
  progress
}: {
  assessments: AnyRow[];
  activeId: string;
  onSelect: (id: string) => void;
  plans: AnyRow[];
  progress: AnyRow[];
}) {
  const sorted = assessments.slice().sort((a, b) => String(b.takenOn).localeCompare(String(a.takenOn)));
  const timeline = [
    ...sorted.map((a) => ({
      raw: String(a.takenOn ?? ''),
      when: formatDate(String(a.takenOn)),
      title: `Assessment — ${String(a.name || 'untitled')}`,
      body: `${(((a.categories as AssessmentCategory[]) ?? []).flatMap((c) => c.options ?? [])).length} options recorded across ${
        ((a.categories as AssessmentCategory[]) ?? []).filter((c) => (c.options ?? []).length).length
      } categories.`,
      tone: 'accent' as const
    })),
    ...plans.map((p) => ({
      raw: String(p.startOn ?? ''),
      when: formatDate(String(p.startOn)),
      title: `Plan — ${String(p.name)} (${String(p.status)})`,
      body: `${((p.actions as PlanAction[]) ?? []).length} actions · ${planProgress(p).done} completions logged`,
      tone: 'plain' as const
    })),
    ...progress.map((e) => ({
      raw: String(e.on ?? ''),
      when: formatDate(String(e.on)),
      title: String(e.label || 'Progress entry'),
      body: `${String(e.domain ?? '')}${e.note ? ` — ${String(e.note)}` : ''}`,
      tone: 'plain' as const
    }))
  ]
    .sort((a, b) => b.raw.localeCompare(a.raw))
    .slice(0, 40)
    .map(({ when, title, body, tone }) => ({ when, title, body, tone }));

  return (
    <Card>
      <CardHead title="Progress history" eyebrow="Section 07" sub="Every saved assessment, plan and progress entry, newest first. Switching an assessment loads it for editing." />
      {sorted.length ? (
        <IndexList>
          {sorted.map((a, i) => (
            <IndexRow
              key={a.id}
              no={i + 1}
              title={String(a.name || 'Untitled assessment')}
              sub={`${formatDate(String(a.takenOn))} · ${((a.categories as AssessmentCategory[]) ?? []).length} categories · saved ${new Date(a.updatedAt).toLocaleString()}`}
              right={a.id === activeId ? <Chip tone="gold">open</Chip> : undefined}
              onClick={() => onSelect(a.id)}
            />
          ))}
        </IndexList>
      ) : null}
      {timeline.length ? <Timeline items={timeline} /> : <p className="gl-small gl-faint">No history yet — this stays honest: it only lists what you have actually saved.</p>}
      <p className="gl-small gl-faint lm-note">
        For photographic comparison and trend charts, <Link to="/progress">Progress &amp; Analytics</Link> reads the same rows. Comparisons are only
        meaningful when conditions match: same distance, same light, same expression.
      </p>
    </Card>
  );
}

/* ------------------------------------------------------------------------ page */

const TABS = [
  { key: 'baseline', label: 'Baseline' },
  { key: 'priorities', label: 'Priorities' },
  { key: 'goals', label: 'Goals' },
  { key: 'plans', label: 'Plans' },
  { key: 'routines', label: 'Routines' },
  { key: 'cost', label: 'Cost–benefit' },
  { key: 'history', label: 'History' }
];

export default function LooksmaxxingPage() {
  const assessments = useRows(TABLES.assessments).slice().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const cats0 = (assessments[0]?.categories as AssessmentCategory[]) ?? [];
  const [pick, setPick] = useState<string | null>(null);
  const activeId = pick && assessments.some((a) => a.id === pick) ? pick : assessments[0]?.id ?? '';
  const active = assessments.find((a) => a.id === activeId);
  const [tab, setTab] = useState('baseline');
  const toast = useToast();

  const plans = useRows(TABLES.plans).slice().sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const goals = useRows(TABLES.goals);
  const routines = useRows(TABLES.routines);
  const logs = useRows(TABLES.routineLogs);
  const techniques = useRows(TABLES.techniques);
  const media = useRows(TABLES.mediaItems);
  const purchases = useRows(TABLES.purchases);
  const products = useRows(TABLES.products);
  const progress = useRows(TABLES.progressEntries);

  const cats = useMemo(() => (active ? withRanks((active.categories as AssessmentCategory[]) ?? []) : []), [active, assessments]);
  const ranked = useMemo(() => rankAll(cats, Number(active?.data?.budgetSensitivity ?? 0)), [cats, active]);
  const refused = useMemo(() => refuseAll(cats), [cats]);
  const quick = ranked.filter((o) => o.band === 'quick-win').length;
  const enteredOptions = cats.reduce((s, c) => s + (c.options ?? []).length, 0);

  const createAssessment = () => {
    const id = newId('ass');
    void saveRow(TABLES.assessments, {
      id,
      name: `Baseline assessment — ${formatDate(todayISO())}`,
      takenOn: todayISO(),
      baselineMediaIds: [],
      categories: withRanks(CATEGORIES.map(blankCategory)),
      summary: '',
      data: { budgetSensitivity: 0, categoryMedia: {} }
    }).then(() => {
      setPick(id);
      setTab('baseline');
      toast('Assessment created. All fourteen categories are open for editing.', 'ok');
    });
  };

  const openCategory = (categoryId: string) => {
    setTab('baseline');
    setTimeout(() => {
      const el = document.getElementById(`cat-${categoryId}`);
      if (el) {
        (el as HTMLDetailsElement).open = true;
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }, 40);
  };

  return (
    <div className="gl-page lm-page">
      <DeptIntro
        id="looksmaxxing"
        deck="A working analysis of what you would change, what it costs, and what the evidence supports — built entirely from your own records. No score, no mirror-math, no invented price."
        actions={
          <>
            <Button variant="primary" onClick={createAssessment}>
              <Plus size={14} /> New assessment
            </Button>
            <Button onClick={() => setTab('plans')}>Plans</Button>
            <Link className="gl-btn gl-btn--ghost" to="/face">
              Facial Aesthetics Lab
            </Link>
          </>
        }
        meta={[
          { label: 'Assessments', value: String(assessments.length) },
          { label: 'Options recorded', value: String(enteredOptions) },
          { label: 'Quick wins', value: String(quick) },
          { label: 'Refused entries', value: String(refused.length) }
        ]}
      />

      <StatStrip
        items={[
          { label: 'Ranking engine', value: 'local rules', hint: 'prioritisation.ts' },
          { label: 'Overall score', value: 'none — by design', hint: 'bands only' },
          { label: 'Active plans', value: String(plans.filter((p) => p.status === 'active').length), hint: 'from your ranked options' },
          { label: 'Cost figures', value: 'bands only', hint: enteredOptions ? 'no prices invented' : 'nothing entered yet' }
        ]}
      />

      <div className="gl-tabs lm-tabs" role="tablist" aria-label="Command Center sections">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={`gl-tab ${tab === t.key ? 'gl-btn--gold' : ''}`} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {!active ? (
        <EmptyPlate
          kicker="Section 01"
          title="No assessment yet"
          body="The Command Center needs a baseline before it can rank anything. Creating an assessment writes a real record with all fourteen categories into your local database — nothing is pre-filled on your behalf, because we do not know your face."
          action={
            <Button variant="primary" onClick={createAssessment}>
              Start the fourteen-category assessment
            </Button>
          }
        />
      ) : null}

      {active ? (
        <div className="lm-stack">
          {tab === 'baseline' ? <BaselinePanel a={active} cats={cats} techniques={techniques} media={media} /> : null}
          {tab === 'priorities' ? (
            <PrioritiesPanel a={active} cats={cats} budgetSensitivity={Number(active.data?.budgetSensitivity ?? 0)} onOpenCategory={openCategory} />
          ) : null}
          {tab === 'goals' ? <GoalsPanel goals={goals} plans={plans} /> : null}
          {tab === 'plans' ? (
            <PlansPanel
              plans={plans}
              ranked={ranked}
              routines={routines}
              goals={goals}
              techniques={techniques}
              purchases={purchases}
              products={products}
              media={media}
              assessmentExists={Boolean(active)}
              goAssessment={() => setTab('baseline')}
            />
          ) : null}
          {tab === 'routines' ? <RoutinesPanel routines={routines} logs={logs} /> : null}
          {tab === 'cost' ? <CostPanel cats={cats} plans={plans} purchases={purchases} budgetSensitivity={Number(active.data?.budgetSensitivity ?? 0)} /> : null}
          {tab === 'history' ? <HistoryPanel assessments={assessments} activeId={active.id} onSelect={setPick} plans={plans} progress={progress} /> : null}
        </div>
      ) : null}

      <div className="lm-footer-note">
        <KvList
          items={[
            { k: 'Analysis', v: 'None. There is no computer-vision service in this app and no paid AI behind any number on this page.' },
            { k: 'Scores', v: 'Bands per option, bands per category. No attractiveness score exists, and none is implied by a rank.' },
            { k: 'Costs', v: 'Cost bands you chose. Currency appears only when you typed it into a purchase record.' },
            { k: 'Health', v: 'Hair loss in patches, jaw pain, skin lesions, dental pain or disordered eating are clinical matters — see a professional via /services.' },
            { k: 'Storage', v: 'Every field writes through saveRow into IndexedDB on this device; reload and it is still here.' }
          ]}
        />
      </div>
    </div>
  );
}
