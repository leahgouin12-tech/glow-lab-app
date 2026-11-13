import { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarPlus, Check, ClipboardList, ExternalLink, FlaskConical, Plus, Search, Trash2, Wand2 } from 'lucide-react';
import {
  Button,
  Chip,
  DateInput,
  Field,
  IconButton,
  Modal,
  Rating,
  Range,
  SafetyBanner,
  Select,
  Swatches,
  TextArea,
  TextInput,
  fmtMoney,
  useToast
} from '../ui/primitives';
import { DeptIntro, EmptyPlate, IndexList, IndexRow, KvList, StatStrip, Timeline } from '../ui/editorial';
import { CompareSlider, PhotoPicker, Pin } from '../ui/media';
import { saveRow, useRows } from '../hooks/live';
import { addDays, formatDate, newId, softDelete, todayISO } from '../db/repo';
import { TABLES, type AnyRow, type PlanAction } from '../db/schema';
import { loadSettings, subscribeSettings, type AppSettings } from '../state/settings';
import { useImageSrc } from '../media/store';
import '../styles/departments/recreate.css';

type Certainty = 'observed' | 'uncertain';

interface Component {
  id: string;
  kind: string;
  label: string;
  certainty: Certainty;
  include: boolean;
  note: string;
  /** the record this was matched to, if the user accepted a match */
  linkedId: string | null;
  linkedTable: string | null;
}

interface Step {
  id: string;
  order: number;
  label: string;
  detail: string;
  kind: string;
  minutes: number;
  costBand: 'free' | 'low' | 'mid' | 'high' | 'professional';
  effort: 1 | 2 | 3 | 4 | 5;
  productId: string | null;
  tutorialId: string | null;
  componentId: string | null;
  doneOn: string[];
}

const KINDS: { value: string; label: string; source: 'clothingItems' | 'products' | 'fragrances' | 'hairstyles' | null }[] = [
  { value: 'clothing', label: 'Clothing', source: 'clothingItems' },
  { value: 'shoes', label: 'Shoes', source: 'clothingItems' },
  { value: 'bag', label: 'Bag', source: 'clothingItems' },
  { value: 'accessory', label: 'Accessory', source: 'clothingItems' },
  { value: 'hair', label: 'Hair', source: 'hairstyles' },
  { value: 'makeup', label: 'Makeup', source: 'products' },
  { value: 'brows', label: 'Brows', source: 'products' },
  { value: 'lashes', label: 'Lashes', source: 'products' },
  { value: 'lips', label: 'Lips', source: 'products' },
  { value: 'nails', label: 'Nails', source: 'products' },
  { value: 'skincare', label: 'Skincare prep', source: 'products' },
  { value: 'fragrance', label: 'Fragrance', source: 'fragrances' },
  { value: 'prop', label: 'Set / prop', source: null }
];

const STOP = new Set([
  'the','and','with','for','from','over','into','onto','your','her','his','one','two','its','this','that','have','will','you',
  'a','an','of','in','on','at','to','by','or','as','is','are','single','soft','pair','set','piece','look','style','styled'
]);

const COST_BANDS: Step['costBand'][] = ['free', 'low', 'mid', 'high', 'professional'];

function tokens(s: string) {
  return String(s ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}

function overlap(a: string[], b: string[]) {
  return a.filter((w) => b.includes(w));
}

export default function RecreatePage() {
  const toast = useToast();
  const settings = useSettings();

  const items = useRows(TABLES.discoveryItems);
  const interactions = useRows(TABLES.discoveryInteractions);
  const boards = useRows(TABLES.boards);
  const media = useRows(TABLES.mediaItems);
  const plans = useRows(TABLES.plans);
  const experiments = useRows(TABLES.experiments);
  const clothing = useRows(TABLES.clothingItems);
  const products = useRows(TABLES.products);
  const fragrances = useRows(TABLES.fragrances);
  const hairstyles = useRows(TABLES.hairstyles);
  const tutorials = useRows(TABLES.tutorials);
  const lists = useRows(TABLES.lists);
  const refs = useRows(TABLES.manualReferences);

  const projects = useMemo(() => plans.filter((p) => ((p.tags as string[]) ?? []).includes('recreate') && !p.deletedAt), [plans]);
  const [projectId, setProjectId] = useState<string | null>(null);
  const project = useMemo(() => projects.find((p) => String(p.id) === projectId), [projects, projectId]);

  const [components, setComponents] = useState<Component[]>([]);
  const [steps, setSteps] = useState<Step[]>([]);
  const [autosavedAt, setAutosavedAt] = useState<number | null>(null);
  const [attemptNote, setAttemptNote] = useState('');
  const [attemptRating, setAttemptRating] = useState(0);
  const [attemptMediaIds, setAttemptMediaIds] = useState<string[]>([]);
  const [compareSel, setCompareSel] = useState<{ a: string | null; b: string | null }>({ a: null, b: null });
  const [openCompare, setOpenCompare] = useState(false);
  const [attachPlanId, setAttachPlanId] = useState('');
  const [schedule, setSchedule] = useState({ on: addDays(todayISO(), 2), minutes: 90 });
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQ, setSearchQ] = useState('');
  const [newComp, setNewComp] = useState({ kind: 'clothing', label: '' });
  const [ask, setAsk] = useState<{ title: string; body: string; run: () => void } | null>(null);

  const mediaById = useMemo(() => new Map(media.map((m) => [String(m.id), m])), [media]);
  const refItem = useMemo(() => (project ? items.find((i) => String(i.id) === String(((project.data ?? {}) as Record<string, unknown>).itemId)) : undefined), [project, items]);
  const refWithMedia = useMemo(() => {
    if (!refItem) return undefined;
    const m = refItem.mediaId ? mediaById.get(String(refItem.mediaId)) : undefined;
    const d = (refItem.data ?? {}) as Record<string, unknown>;
    return { ...refItem, blobId: m?.blobId ?? null, remoteUrl: String(m?.remoteUrl ?? d.thumbUrl ?? d.remoteUrl ?? ''), width: m?.width ?? d.width ?? 0, height: m?.height ?? d.height ?? 0 } as AnyRow;
  }, [refItem, mediaById]);

  const savedIds = useMemo(() => {
    const set = new Set<string>();
    for (const x of interactions) if (['save', 'like', 'board', 'mood', 'goal', 'try'].includes(String(x.action))) set.add(String(x.itemId));
    return set;
  }, [interactions]);

  /* ---------------------------------------------------------------- project */
  const loadFromProject = useCallback((p: AnyRow | undefined) => {
    if (!p) return;
    const d = (p.data ?? {}) as Record<string, unknown>;
    setComponents((Array.isArray(d.components) ? (d.components as Component[]) : []));
    const actions = (Array.isArray(p.actions) ? (p.actions as PlanAction[]) : []).map<Step>((a) => {
      const extra = ((d.stepExtras ?? {}) as Record<string, Partial<Step>>)[a.id] ?? {};
      return {
        id: a.id,
        order: a.dayOffset,
        label: a.label,
        detail: extra.detail ?? '',
        kind: a.category,
        minutes: extra.minutes ?? 10,
        costBand: (COST_BANDS.includes(a.costBand as Step['costBand']) ? a.costBand : 'low') as Step['costBand'],
        effort: (extra.effort ?? 2) as Step['effort'],
        productId: a.productId ?? null,
        tutorialId: (((d.stepTutorials ?? {}) as Record<string, string>)[a.id] ?? extra.tutorialId ?? null),
        componentId: extra.componentId ?? null,
        doneOn: a.doneOn ?? []
      };
    });
    setSteps(actions.sort((x, y) => x.order - y.order));
    setAttemptNote(String(d.attemptNote ?? ''));
    setAttemptRating(Number(d.attemptRating ?? 0));
    setAttemptMediaIds(Array.isArray(d.attemptMediaIds) ? (d.attemptMediaIds as string[]) : []);
  }, []);

  useEffect(() => {
    loadFromProject(project);
  }, [projectId, loadFromProject]); // eslint-disable-line react-hooks/exhaustive-deps

  const stored = useMemo(() => {
    const d = ((project?.data ?? {}) as Record<string, unknown>) ?? {};
    return {
      components: JSON.stringify(Array.isArray(d.components) ? d.components : []),
      steps: JSON.stringify((Array.isArray(project?.actions) ? (project.actions as PlanAction[]) : []).map(actionFingerprint)),
      extras: JSON.stringify(d.stepExtras ?? {}),
      tutorials: JSON.stringify(d.stepTutorials ?? {}),
      attemptNote: String(d.attemptNote ?? ''),
      attemptRating: Number(d.attemptRating ?? 0),
      attemptMediaIds: JSON.stringify(d.attemptMediaIds ?? [])
    };
  }, [project]);

  useEffect(() => {
    if (!project) return;
    const compact = JSON.stringify(steps.map((s) => actionFingerprint(compactAction(s))));
    const extras: Record<string, { detail: string; minutes: number; effort: number; componentId: string | null }> = {};
    const tut: Record<string, string> = {};
    for (const s of steps) {
      extras[s.id] = { detail: s.detail, minutes: s.minutes, effort: s.effort, componentId: s.componentId };
      if (s.tutorialId) tut[s.id] = s.tutorialId;
    }
    const next = {
      components: JSON.stringify(components),
      steps: compact,
      extras: JSON.stringify(extras),
      tutorials: JSON.stringify(tut),
      attemptNote,
      attemptRating,
      attemptMediaIds: JSON.stringify(attemptMediaIds)
    };
    if (
      next.components === stored.components &&
      next.steps === stored.steps &&
      next.extras === stored.extras &&
      next.tutorials === stored.tutorials &&
      next.attemptNote === stored.attemptNote &&
      next.attemptRating === stored.attemptRating &&
      next.attemptMediaIds === stored.attemptMediaIds
    )
      return;
    const t = setTimeout(async () => {
      await saveRow(TABLES.plans, {
        id: String(project.id),
        actions: steps.map(compactAction),
        data: {
          ...((project.data as Record<string, unknown>) ?? {}),
          components,
          stepExtras: extras,
          stepTutorials: tut,
          attemptNote,
          attemptRating,
          attemptMediaIds,
          autosavedAt: Date.now()
        }
      });
      setAutosavedAt(Date.now());
    }, 700);
    return () => clearTimeout(t);
  }, [components, steps, attemptNote, attemptRating, attemptMediaIds, project, stored]);

  const startProject = async (itemId: string) => {
    const item = items.find((i) => String(i.id) === itemId);
    if (!item) return;
    const seeded = seedComponents(item);
    const saved = await saveRow(TABLES.plans, {
      name: `Recreate — ${String(item.title).slice(0, 60)}`,
      template: 'recreate',
      days: 21,
      startOn: todayISO(),
      reviewEveryDays: 7,
      budget: null,
      priorities: [String(item.aesthetic || (item.categories as string[])?.[0] || 'look')],
      actions: [],
      milestones: [],
      status: 'draft',
      adjustments: [],
      tags: ['recreate'],
      data: {
        itemId,
        components: seeded,
        stepExtras: {},
        stepTutorials: {},
        attemptMediaIds: [],
        attemptNote: '',
        attemptRating: 0,
        experimentId: null,
        startedOn: todayISO()
      }
    });
    setProjectId(String(saved.id));
    setComponents(seeded);
    setSteps([]);
    setSearchOpen(false);
    toast(`Project opened. ${seeded.length} component(s) pre-filled from the reference’s own tags — check every one.`);
  };

  /* -------------------------------------------------------- step 2: tagging */
  const setComp = (id: string, patch: Partial<Component>) => setComponents((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const addComp = () => {
    const label = newComp.label.trim();
    if (!label) {
      toast('Type what you can see first.', 'bad');
      return;
    }
    setComponents((prev) => [...prev, { id: newId('cmp'), kind: newComp.kind, label, certainty: 'observed', include: true, note: '', linkedId: null, linkedTable: null }]);
    setNewComp({ ...newComp, label: '' });
  };

  /* ------------------------------------------------------ step 3: matching */
  interface Candidate {
    id: string;
    title: string;
    table: string;
    why: string;
    price: number | null;
    score: number;
  }

  const matchFor = useCallback(
    (c: Component): { tone: 'own' | 'similar' | 'none'; rows: Candidate[] } => {
      const kindDef = KINDS.find((k) => k.value === c.kind);
      if (!kindDef || !kindDef.source) return { tone: 'none', rows: [] };
      const ct = tokens(c.label);
      const pool: AnyRow[] =
        kindDef.source === 'clothingItems'
          ? clothing
          : kindDef.source === 'products'
            ? products.filter((p) => String(p.status) === 'own')
            : kindDef.source === 'fragrances'
              ? fragrances
              : hairstyles;
      const scored = pool
        .map((row) => {
          const hay = tokens(
            `${row.name ?? ''} ${row.category ?? ''} ${row.brand ?? ''} ${row.form ?? ''} ${
              (row.colors as string[])?.join(' ') ?? ''
            } ${row.material ?? ''} ${(row.topNotes as string[])?.join(' ') ?? ''} ${(row.baseNotes as string[])?.join(' ') ?? ''} ${
              row.family ?? ''
            } ${row.label ?? ''} ${row.slug ?? ''} ${row.title ?? ''}`
          );
          const hits = overlap(ct, hay);
          const kindHit = ct.includes(kindDef.value) || tokens(String(row.category ?? '')).includes(kindDef.value) ? 1 : 0;
          return { row, hits, score: hits.length + kindHit };
        })
        .filter((x) => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);
      const rows: Candidate[] = scored.map((x) => ({
        id: String(x.row.id),
        title: String(x.row.name || x.row.label || x.row.title || 'Untitled record'),
        table: kindDef.source as string,
        why: difference(x, c),
        price: x.row.pricePaid != null ? Number(x.row.pricePaid) : x.row.price != null ? Number(x.row.price) : null,
        score: x.score
      }));
      if (!rows.length) return { tone: 'none', rows };
      return { tone: rows[0].score >= 2 ? 'own' : 'similar', rows };
    },
    [clothing, products, fragrances, hairstyles]
  );

  const addToWishlist = async (label: string, forWhat: string, mediaId: string | null) => {
    const existing = lists.find((l) => String(l.kind) === 'wishlist' && !l.deletedAt && !l.closedOn);
    const item = {
      id: newId('li'),
      label,
      productId: null,
      estPrice: null,
      quantity: 1,
      neededFor: forWhat,
      linkedMediaId: mediaId,
      checked: false
    };
    if (existing) {
      await saveRow(TABLES.lists, { id: String(existing.id), items: [...(((existing.items as never[]) ?? []) as ListItems), item] });
    } else {
      await saveRow(TABLES.lists, {
        kind: 'wishlist',
        name: 'Wishlist',
        budget: null,
        period: 'monthly',
        items: [item],
        closedOn: null,
        tags: ['recreate'],
        data: { createdFrom: 'recreate' }
      });
    }
    toast(`“${label}” added to your wishlist as a real list entry — no product or price invented.`);
  };

  /* --------------------------------------------------------- step 4: plan */
  const addStep = (c: Component) => {
    setSteps((prev) => [
      ...prev,
      {
        id: newId('act'),
        order: prev.length,
        label: `${labelForKind(c.kind)}: ${c.label}`,
        detail: c.note || '',
        kind: c.kind,
        minutes: 10,
        costBand: 'low',
        effort: 2,
        productId: c.linkedTable === 'products' ? c.linkedId : null,
        tutorialId: null,
        componentId: c.id,
        doneOn: []
      }
    ]);
  };

  const setStep = (id: string, patch: Partial<Step>) => setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const moveStep = (id: string, dir: -1 | 1) =>
    setSteps((prev) => {
      const next = [...prev];
      const i = next.findIndex((s) => s.id === id);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= next.length) return prev;
      [next[i], next[j]] = [next[j], next[i]];
      return next.map((s, k) => ({ ...s, order: k }));
    });
  const dropStep = (id: string) => setSteps((prev) => prev.filter((s) => s.id !== id).map((s, i) => ({ ...s, order: i })));

  const totals = useMemo(() => {
    let minutes = 0;
    let known = 0;
    let missing = 0;
    for (const s of steps) {
      minutes += s.minutes;
      const tut = s.tutorialId ? tutorials.find((t) => String(t.id) === s.tutorialId) : undefined;
      if (tut) minutes += Number(tut.minutes ?? 0);
    }
    for (const c of components.filter((x) => x.include)) {
      const m = matchFor(c);
      if (m.tone === 'own') known += 1;
      if (m.tone === 'none') missing += 1;
    }
    const cost = steps.reduce((sum, s) => {
      const p = s.productId ? products.find((x) => String(x.id) === s.productId) : undefined;
      return sum + Number(p?.pricePaid ?? 0);
    }, 0);
    return { minutes, known, missing, cost };
  }, [steps, components, matchFor, tutorials, products]);

  /* ----------------------------------------------------- step 5: outcomes */
  const saveExperiment = async () => {
    if (!project || !refItem) return;
    const existing = ((project.data as Record<string, unknown>)?.experimentId as string) ?? null;
    const saved = await saveRow(TABLES.experiments, {
      id: existing ?? undefined,
      name: `Recreate — ${String(refItem.title).slice(0, 60)}`,
      category: 'style',
      aim: String(((project.data as Record<string, unknown>)?.aim as string) ?? `Rebuild the ${String(refItem.aesthetic || 'look')} reference from what I already record, and find out how far my own inventory gets me.`),
      startOn: String(project.startOn ?? todayISO()),
      endOn: addDays(String(project.startOn ?? todayISO()), Number(project.days ?? 21)),
      baseline: `${components.length} tagged components · ${totals.known} covered by records · ${totals.missing} with no match`,
      baselineMediaIds: refItem.mediaId ? [String(refItem.mediaId)] : [],
      techniqueIds: [],
      productIds: components.map((c) => (c.linkedTable === 'products' ? c.linkedId : null)).filter((v): v is string => Boolean(v)),
      protocol: steps.length
        ? steps.map((s, i) => `${i + 1}. ${s.label}${s.detail ? ` — ${s.detail}` : ''} (${s.minutes} min, ${s.costBand}, effort ${s.effort}/5)`).join('\n')
        : 'No steps written yet — the reference is being tagged first.',
      observations: [],
      result: attemptNote,
      resultMediaIds: attemptMediaIds,
      rating: attemptRating,
      decision: attemptNote ? 'open' : 'open',
      confounders: 'Lighting, camera distance, hair condition, product layering and photograph compression all differ between a reference and my own photo.',
      tags: ['recreate'],
      data: { planId: String(project.id), itemId: String(refItem.id) }
    });
    await saveRow(TABLES.plans, {
      id: String(project.id),
      status: 'active',
      data: { ...((project.data as Record<string, unknown>) ?? {}), experimentId: String(saved.id) }
    });
    toast(existing ? 'Experiment record updated.' : 'Experiment created with your protocol and baseline.', 'ok');
  };

  const attachToPlan = async () => {
    if (!project) return;
    const target = plans.find((p) => String(p.id) === attachPlanId);
    if (!target) {
      toast('Choose a plan first.', 'bad');
      return;
    }
    const incoming: PlanAction[] = steps.map((s) => ({ ...compactAction(s), id: newId('act') }));
    await saveRow(TABLES.plans, {
      id: String(target.id),
      actions: [...(((target.actions as PlanAction[]) ?? []) as PlanAction[]), ...incoming],
      priorities: [...new Set([...(((target.priorities as string[]) ?? []) as string[]), String(((project.data as Record<string, unknown>)?.itemId ? refItem?.aesthetic ?? 'look' : 'look') as string)])],
      data: { ...((target.data as Record<string, unknown>) ?? {}), recreateLinks: [...((((target.data as Record<string, unknown>)?.recreateLinks ?? []) as string[])), String(project.id)] }
    });
    toast(`${incoming.length} step(s) appended to “${String(target.name)}” as PlanAction rows.`);
  };

  const scheduleAttempt = async () => {
    if (!project) return;
    const [y, m, d] = schedule.on.split('-').map(Number);
    const start = new Date(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0).getTime();
    await saveRow(TABLES.calendarEvents, {
      title: `Attempt — ${String(refItem?.title ?? 'recreate').slice(0, 40)}`,
      kind: 'style-session',
      startAt: start,
      endAt: start + schedule.minutes * 60000,
      recurrence: { freq: 'daily', interval: 1, until: null, byweekday: [] },
      reminders: [60],
      checklist: steps.map((s) => ({ id: s.id, label: s.label, done: false })),
      linkDomain: 'recreate',
      linkId: String(project.id),
      cost: null,
      doneOn: null,
      note: `Scheduled from the Recreate project. ${steps.length} step(s), about ${schedule.minutes} minutes. Reference: ${String(refItem?.title ?? '')}`,
      tags: ['recreate'],
      data: { itemId: String(refItem?.id ?? '') }
    });
    setScheduleOpen(false);
    toast('On your Beauty & Style Calendar as a real event with your checklist attached.');
  };

  const attachAttemptPhoto = async (rows: AnyRow[]) => {
    if (!project || !rows[0]) return;
    const id = String(rows[0].id);
    setAttemptMediaIds((prev) => [...prev, id]);
    await saveRow(TABLES.mediaItems, {
      id,
      linkedDomain: 'recreate',
      linkedIds: [String(project.id), String(((project.data as Record<string, unknown>)?.itemId as string) ?? '')]
    });
    toast('Attempt photo filed against this recreation.', 'ok');
  };

  const recordAttempt = async () => {
    if (!project) return;
    await saveRow(TABLES.observations, {
      subjectType: 'plan',
      subjectId: String(project.id),
      on: todayISO(),
      note: attemptNote || 'Attempted with no written observation.',
      reaction: 'unknown',
      severity: 0,
      mediaIds: attemptMediaIds,
      tags: ['recreate'],
      data: { rating: attemptRating, itemId: String(((project.data as Record<string, unknown>)?.itemId as string) ?? '') }
    });
    await saveRow(TABLES.plans, {
      id: String(project.id),
      status: 'review',
      adjustments: [...(((project.adjustments as { on: string; note: string }[]) ?? []) as { on: string; note: string }[]), { on: todayISO(), note: attemptNote || 'Attempt recorded.' }],
      data: { ...((project.data as Record<string, unknown>) ?? {}), attemptNote, attemptRating }
    });
    toast('Observation row written — visible in Experimentation Lab and Progress.');
  };

  const attemptPool = useMemo(() => attemptMediaIds.map((id) => mediaById.get(id)).filter((v): v is AnyRow => Boolean(v)), [attemptMediaIds, mediaById]);

  const searchPool = useMemo(() => {
    const q = searchQ.toLowerCase().trim();
    const boardIds = new Set(boards.flatMap((b) => ((b.itemIds as string[]) ?? []).map(String)));
    return items
      .filter((i) => savedIds.has(String(i.id)) || boardIds.has(String(i.id)) || String(i.providerId) === 'my-uploads')
      .filter((i) => !q || `${i.title} ${i.description} ${(i.categories as string[])?.join(' ') ?? ''} ${i.aesthetic} ${(i.elements as string[])?.join(' ') ?? ''}`.toLowerCase().includes(q))
      .slice(0, 40);
  }, [items, savedIds, boards, searchQ]);

  const linkedTutorials = useMemo(() => {
    const q = String(refItem?.aesthetic ?? '').toLowerCase();
    return [...tutorials].sort((a, b) => {
      const sa = `${a.title} ${a.domain} ${a.summary}`.toLowerCase().includes(q) ? 1 : 0;
      const sb = `${b.title} ${b.domain} ${b.summary}`.toLowerCase().includes(q) ? 1 : 0;
      return sb - sa;
    });
  }, [tutorials, refItem]);

  return (
    <div className="gl-page">
      <DeptIntro
        id="recreate"
        actions={
          <>
            <Button variant="primary" icon={<Search size={14} />} onClick={() => setSearchOpen(true)}>
              Choose a reference
            </Button>
            {project ? (
              <Button icon={<FlaskConical size={14} />} onClick={() => void saveExperiment()}>
                {((project.data as Record<string, unknown>)?.experimentId ? 'Update experiment' : 'Save as experiment')}
              </Button>
            ) : null}
          </>
        }
        meta={[
          { label: 'Projects', value: projects.length },
          { label: 'Your closet', value: `${clothing.length} pieces` },
          { label: 'Products owned', value: products.filter((p) => String(p.status) === 'own').length },
          { label: 'Fragrances', value: fragrances.length }
        ]}
      />

      <SafetyBanner tone="warn" title="What this page can and cannot do">
        <p style={{ margin: 0 }}>
          Glow Lab has no image-recognition service. It does not identify brands, products, prices or people from a photograph. The component
          list below is pre-filled from the tags already stored with that reference — yours or the commissioned set’s — and every line is
          editable. Matching only reads records you have entered yourself.
        </p>
      </SafetyBanner>

      {projects.length ? (
        <section className="gl-section">
          <div className="gl-row gl-row--between" style={{ marginBottom: 'var(--glow-sp-3)' }}>
            <h2 className="gl-serif" style={{ margin: 0 }}>
              Your recreation projects
            </h2>
            <span className="gl-tech">{autosavedAt ? `autosaved ${new Date(autosavedAt).toLocaleTimeString()}` : 'no changes pending'}</span>
          </div>
          <IndexList>
            {projects
              .sort((a, b) => Number(b.updatedAt) - Number(a.updatedAt))
              .map((p) => {
                const d = (p.data ?? {}) as Record<string, unknown>;
                const comps = (Array.isArray(d.components) ? d.components : []) as Component[];
                return (
                  <IndexRow
                    key={String(p.id)}
                    no={(p.name as string).replace(/^Recreate — /, '').slice(0, 3)}
                    title={String(p.name)}
                    sub={`${comps.length} tagged · ${(p.actions as PlanAction[])?.length ?? 0} steps · ${String(p.status)}${d.experimentId ? ' · experiment linked' : ''}`}
                    right={
                      <IconButton
                        label={`Delete project ${String(p.name)}`}
                        onClick={() =>
                          setAsk({
                            title: 'Delete this project?',
                            body: 'The plan row is soft-deleted. Any experiment, calendar event or observation you created from it stays — delete those where they live if you want them gone.',
                            run: () => {
                              void softDelete(TABLES.plans, String(p.id));
                              if (projectId === String(p.id)) setProjectId(null);
                            }
                          })
                        }
                      >
                        <Trash2 size={14} />
                      </IconButton>
                    }
                    onClick={() => setProjectId(String(p.id))}
                  />
                );
              })}
          </IndexList>
        </section>
      ) : null}

      {!project ? (
        <EmptyPlate
          kicker="Start here"
          title="Pick something you want to be able to do again"
          body="Choose from references you have saved, put on a board, marked to try, or uploaded yourself. A project is a real plan row — tagging, matching, steps and photos all persist against it."
          action={
            <div className="gl-row gl-row--tight">
              <Button variant="primary" onClick={() => setSearchOpen(true)}>
                Choose a reference
              </Button>
              {refs.filter((r) => !r.deletedAt).length ? (
                <Button icon={<ExternalLink size={14} />} onClick={() => window.open(String(refs[0].url), '_blank', 'noopener')}>
                  Open your most recent link
                </Button>
              ) : null}
            </div>
          }
        />
      ) : (
        <div className="gl-steps">
          {/* ------------------------------------------------------ step 1 */}
          <article className="gl-step" data-done="true">
            <div className="gl-step__no">The reference</div>
            <h3 style={{ marginTop: 6 }}>{String(refItem?.title ?? 'Reference record not found')}</h3>
            <div className="gl-row" style={{ alignItems: 'flex-start', gap: 'var(--glow-sp-5)', flexWrap: 'wrap' }}>
              {refWithMedia ? (
                <Pin item={refWithMedia} title={String(refItem?.title ?? '')} style={{ width: 'min(260px, 60vw)' }} />
              ) : (
                <div className="gl-missing-img" style={{ width: 200, height: 240 }}>
                  The image behind this reference is unavailable offline.
                </div>
              )}
              <div style={{ flex: 1, minWidth: 240 }}>
                <p className="gl-small gl-muted" style={{ marginTop: 0 }}>
                  {String(refItem?.description ?? '')}
                </p>
                <div className="gl-row gl-row--tight" style={{ flexWrap: 'wrap', marginBottom: 'var(--glow-sp-3)' }}>
                  {((refItem?.categories as string[]) ?? []).map((c) => (
                    <Chip key={c} tone="info">
                      {c}
                    </Chip>
                  ))}
                  {refItem?.aesthetic ? <Chip tone="gold">{String(refItem.aesthetic)}</Chip> : null}
                </div>
                {((refItem?.palette as string[]) ?? []).length ? <Swatches colors={(refItem?.palette as string[]) ?? []} /> : null}
                <KvList
                  items={[
                    { k: 'Source', v: String(refItem?.providerId ?? '') },
                    { k: 'Licence', v: String(refItem?.license || 'Not stated') },
                    { k: 'Attribution', v: String(refItem?.attribution || 'None') },
                    {
                      k: 'Original link',
                      v: refItem?.sourceUrl ? (
                        <a href={String(refItem.sourceUrl)} target="_blank" rel="noreferrer">
                          open in your browser
                        </a>
                      ) : (
                        'None — this reference lives only in your library'
                      )
                    }
                  ]}
                />
                <Field label="What “done” looks like for you (stored as the experiment’s aim)">
                  <TextArea
                    value={String(((project.data ?? {}) as Record<string, unknown>).aim ?? '')}
                    onChange={(v) => void saveRow(TABLES.plans, { id: String(project.id), data: { ...((project.data as Record<string, unknown>) ?? {}), aim: v } })}
                    rows={2}
                    placeholder="Not a copy — the part of it I actually want."
                  />
                </Field>
              </div>
            </div>
          </article>

          {/* ------------------------------------------------------ step 2 */}
          <article className="gl-step" data-done={components.length > 0}>
            <div className="gl-step__no">Tag what you can see</div>
            <h3 style={{ marginTop: 6 }}>Components</h3>
            <p className="gl-small gl-muted" style={{ marginTop: 0 }}>
              Pre-filled from the reference’s stored tags. Mark each one <b>observed</b> (you can genuinely see it) or <b>uncertain</b>
              (a guess). Uncertain lines never get presented as fact in the plan below.
            </p>
            <div className="gl-comp">
              {components.map((c) => {
                const m = matchFor(c);
                return (
                  <div key={c.id} className="gl-comp__row">
                    <div style={{ minWidth: 0 }}>
                      <TextInput value={c.label} onChange={(v) => setComp(c.id, { label: v })} placeholder="What is it?" />
                      <div className="gl-row gl-row--tight" style={{ marginTop: 8, flexWrap: 'wrap' }}>
                        <Select
                          value={c.kind}
                          onChange={(v) => setComp(c.id, { kind: v, linkedId: null, linkedTable: null })}
                          options={KINDS.map((k) => ({ value: k.value, label: k.label }))}
                        />
                        <Chip active={c.certainty === 'observed'} onClick={() => setComp(c.id, { certainty: 'observed' })} title="You can see this in the image">
                          Observed
                        </Chip>
                        <Chip active={c.certainty === 'uncertain'} onClick={() => setComp(c.id, { certainty: 'uncertain' })} tone="weak" title="A guess — flagged everywhere it appears">
                          Uncertain
                        </Chip>
                        <Chip active={c.include} onClick={() => setComp(c.id, { include: !c.include })} tone={c.include ? 'gold' : undefined}>
                          {c.include ? 'In the plan' : 'Left out'}
                        </Chip>
                      </div>
                    </div>
                    <div>
                      <div className="gl-comp__kind">Match in your records</div>
                      <div className="gl-match" data-tone={m.tone}>
                        {m.rows.length ? (
                          <>
                            <Select
                              value={c.linkedId ?? ''}
                              onChange={(v) => setComp(c.id, { linkedId: v || null, linkedTable: v ? m.rows.find((r) => r.id === v)?.table ?? null : null })}
                              placeholder="None linked"
                              options={m.rows.map((r) => ({ value: r.id, label: `${r.title}${r.price != null ? ` · ${fmtMoney(r.price, settings?.currency ?? 'USD')}` : ''}` }))}
                            />
                            <div className="gl-small gl-muted">{m.rows.map((r) => `${r.title} — ${r.why}`).join(' · ')}</div>
                            <span className="gl-tech">
                              {m.tone === 'own' ? 'you already record this' : 'close but not identical — differences stated above'}
                            </span>
                          </>
                        ) : (
                          <>
                            <span className="gl-small">No match in your records.</span>
                            <Button
                              size="sm"
                              onClick={() => void addToWishlist(c.label, `Recreate: ${String(refItem?.title ?? '')}`, (refItem?.mediaId as string) ?? null)}
                            >
                              <Plus size={13} /> Add to wishlist
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="gl-row gl-row--tight">
                      <Button size="sm" icon={<Plus size={13} />} onClick={() => addStep(c)} disabled={!c.include} title="Turn this component into a plan step">
                        Step
                      </Button>
                      <IconButton label={`Remove component ${c.label}`} onClick={() => setComponents((prev) => prev.filter((x) => x.id !== c.id))}>
                        <Trash2 size={14} />
                      </IconButton>
                    </div>
                  </div>
                );
              })}
              {!components.length ? (
                <p className="gl-small gl-faint">Nothing tagged. Add lines yourself, or re-open a reference that carries stored tags.</p>
              ) : null}
            </div>
            <div className="gl-form-row" style={{ marginTop: 'var(--glow-sp-4)' }}>
              <Field label="Add a component you can see">
                <TextInput value={newComp.label} onChange={(v) => setNewComp({ ...newComp, label: v })} placeholder="satin wrap dress, pointed boot, low brow" onEnter={addComp} />
              </Field>
              <Field label="Kind">
                <Select value={newComp.kind} onChange={(v) => setNewComp({ ...newComp, kind: v })} options={KINDS.map((k) => ({ value: k.value, label: k.label }))} />
              </Field>
              <Field label=" ">
                <Button icon={<Plus size={14} />} onClick={addComp}>
                  Add line
                </Button>
              </Field>
            </div>
            <p className="gl-tech" style={{ marginTop: 10 }}>
              {components.filter((c) => c.certainty === 'uncertain').length} uncertain · {components.filter((c) => c.include).length} in the plan ·
              autosaved on this device
            </p>
          </article>

          {/* ------------------------------------------------------ step 3 */}
          <article className="gl-step" data-done={steps.length > 0}>
            <div className="gl-step__no">Build the recreation plan</div>
            <h3 style={{ marginTop: 6 }}>Steps, in the order you would actually do them</h3>
            <StatStrip
              items={[
                { label: 'Steps', value: steps.length },
                { label: 'Time from your records', value: `${totals.minutes} min`, hint: 'step minutes + linked tutorial minutes' },
                { label: 'Cost from your records', value: fmtMoney(totals.cost, settings?.currency ?? 'USD'), hint: 'paid prices of linked products' },
                { label: 'Covered', value: totals.known, hint: 'components matched to your own items' },
                { label: 'No match', value: totals.missing, hint: 'wishlist entries, not invented products' }
              ]}
            />
            <div className="gl-stack" style={{ marginTop: 'var(--glow-sp-4)' }}>
              {steps.map((s, i) => {
                const tut = s.tutorialId ? tutorials.find((t) => String(t.id) === s.tutorialId) : undefined;
                return (
                  <div key={s.id} className="gl-planstep">
                    <div className="gl-planstep__order">{i + 1}</div>
                    <div style={{ minWidth: 0 }}>
                      <TextInput value={s.label} onChange={(v) => setStep(s.id, { label: v })} />
                      <div className="gl-row gl-row--tight" style={{ marginTop: 8, flexWrap: 'wrap' }}>
                        <Select
                          value={s.tutorialId ?? ''}
                          onChange={(v) => setStep(s.id, { tutorialId: v || null })}
                          placeholder="Link a Glow Academy tutorial"
                          options={linkedTutorials.slice(0, 30).map((t) => ({ value: String(t.id), label: `${String(t.title)} (${Number(t.minutes)} min)` }))}
                        />
                        <Select
                          value={s.costBand}
                          onChange={(v) => setStep(s.id, { costBand: v as Step['costBand'] })}
                          options={COST_BANDS.map((c) => ({ value: c, label: `cost: ${c}` }))}
                        />
                        <Select
                          value={String(s.effort)}
                          onChange={(v) => setStep(s.id, { effort: Number(v) as Step['effort'] })}
                          options={[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `effort ${n}/5` }))}
                        />
                        <span className="gl-tech">{s.minutes} min</span>
                        <input
                          className="gl-range"
                          type="range"
                          min={0}
                          max={90}
                          step={5}
                          value={s.minutes}
                          onChange={(e) => setStep(s.id, { minutes: Number(e.target.value) })}
                          style={{ width: 110, accentColor: 'var(--glow-accent-soft)' }}
                          aria-label={`Minutes for ${s.label}`}
                        />
                        {tut ? <Chip tone="gold">{String(tut.domain)}</Chip> : null}
                        <Chip active={s.doneOn.length > 0} onClick={() => setStep(s.id, { doneOn: s.doneOn.length ? [] : [todayISO()] })}>
                          {s.doneOn.length ? `done ${formatDate(s.doneOn[0])}` : 'not yet done'}
                        </Chip>
                      </div>
                      <TextArea value={s.detail} onChange={(v) => setStep(s.id, { detail: v })} rows={2} placeholder="Technique notes — placement, product, pressure" />
                    </div>
                    <div className="gl-row gl-row--tight" style={{ flexDirection: 'column' }}>
                      <IconButton label="Move earlier" onClick={() => moveStep(s.id, -1)}>
                        ↑
                      </IconButton>
                      <IconButton label="Move later" onClick={() => moveStep(s.id, 1)}>
                        ↓
                      </IconButton>
                      <IconButton label={`Delete step ${s.label}`} onClick={() => dropStep(s.id)}>
                        <Trash2 size={14} />
                      </IconButton>
                    </div>
                  </div>
                );
              })}
              {!steps.length ? (
                <p className="gl-small gl-faint">
                  No steps yet. Use “Step” on any component above — or write the order you know from experience and link tutorials to it.
                </p>
              ) : null}
            </div>
            <div className="gl-row gl-row--tight" style={{ marginTop: 'var(--glow-sp-4)', flexWrap: 'wrap' }}>
              <Button icon={<Plus size={14} />} onClick={() => setSteps((prev) => [...prev, { id: newId('act'), order: prev.length, label: 'New step', detail: '', kind: 'prop', minutes: 5, costBand: 'free', effort: 1, productId: null, tutorialId: null, componentId: null, doneOn: [] }])}>
                Blank step
              </Button>
              <Select value={attachPlanId} onChange={setAttachPlanId} placeholder="Attach steps to an existing plan" options={plans.filter((p) => !p.deletedAt && !((p.tags as string[]) ?? []).includes('recreate')).map((p) => ({ value: String(p.id), label: String(p.name) }))} />
              <Button disabled={!attachPlanId || !steps.length} onClick={() => void attachToPlan()}>
                <ClipboardList size={14} /> Add to plan
              </Button>
              <Button disabled={!steps.length} onClick={() => setScheduleOpen(true)}>
                <CalendarPlus size={14} /> Schedule an attempt
              </Button>
              <Button variant="primary" icon={<FlaskConical size={14} />} onClick={() => void saveExperiment()}>
                Save as experiment
              </Button>
            </div>
          </article>

          {/* ------------------------------------------------------ step 4 */}
          <article className="gl-step" data-done={attemptMediaIds.length > 0}>
            <div className="gl-step__no">Attempt it, then compare honestly</div>
            <h3 style={{ marginTop: 6 }}>Your photograph against the reference</h3>
            <div className="gl-row gl-row--tight" style={{ marginBottom: 'var(--glow-sp-4)' }}>
              <PhotoPicker kind="experiment" album="Recreate attempts" label="Add attempt photo" onPick={(rows) => void attachAttemptPhoto(rows)} />
              {attemptPool.length > 1 ? (
                <Button onClick={() => setOpenCompare(true)} icon={<Wand2 size={14} />}>
                  Compare two
                </Button>
              ) : null}
            </div>
            {attemptPool.length ? (
              <>
                <CompareSlider before={refWithMedia ?? null} after={attemptPool[attemptPool.length - 1]} beforeLabel="Reference" afterLabel="Your attempt" height={380} />
                <p className="gl-small gl-muted" style={{ marginTop: 10 }}>
                  The split you are dragging is between a professionally lit commissioned reference and a photograph taken by you, probably at a
                  different distance, angle and light temperature. Differences below the jaw of the frame are usually the camera, not your face.
                </p>
                <div className="gl-form-row" style={{ marginTop: 'var(--glow-sp-4)' }}>
                  <Field label="What actually happened">
                    <TextArea value={attemptNote} onChange={setAttemptNote} rows={3} placeholder="What came easily, what did not, what you would change." />
                  </Field>
                  <Field label="How it reads to you">
                    <Rating value={attemptRating} onChange={setAttemptRating} />
                  </Field>
                </div>
                <div className="gl-row gl-row--tight" style={{ marginTop: 'var(--glow-sp-3)' }}>
                  <Button variant="primary" onClick={() => void recordAttempt()}>
                    <Check size={14} /> Record this attempt
                  </Button>
                  <Button onClick={() => void saveExperiment()}>Update the experiment</Button>
                </div>
                <div style={{ marginTop: 'var(--glow-sp-5)' }}>
                  <div className="gl-label" style={{ marginBottom: 8 }}>
                    Attempts filed against this project
                  </div>
                  <Timeline
                    items={attemptPool
                      .slice()
                      .reverse()
                      .map((m) => ({
                        when: formatDate(String(m.takenOn ?? '')),
                        title: String(m.title || 'Attempt photo'),
                        body: String(m.caption || ''),
                        right: <Chip>{String(m.kind)}</Chip>,
                        tone: 'accent' as const
                      }))}
                  />
                </div>
              </>
            ) : (
              <p className="gl-small gl-faint">
                Nothing photographed yet. Until you add a real image, this stays a plan and not a result — the comparison view will not fabricate a
                preview for you.
              </p>
            )}
          </article>
        </div>
      )}

      <section className="gl-section">
        <div className="gl-card gl-card--plain">
          <h3 style={{ marginTop: 0 }}>What matching can see</h3>
          <div className="gl-grid gl-grid--4">
            <Coverage label="Closet pieces" count={clothing.length} to="/closet" note="Matching reads name, category, colours, material." />
            <Coverage label="Products you own" count={products.filter((p) => String(p.status) === 'own').length} to="/market" note="Only status “own” is matched against." />
            <Coverage label="Fragrances" count={fragrances.length} to="/fragrance" note="Name, house, family and notes." />
            <Coverage label="Hairstyles tried" count={hairstyles.filter((h) => h.tried).length} to="/hair" note={`${hairstyles.length} recorded in total.`} />
          </div>
          <p className="gl-small gl-faint" style={{ marginBottom: 0 }}>
            A missing match is information, not a failure: it says this app has no record of you owning it. Glow Lab will not fill that line with a
            product it invented.
          </p>
        </div>
      </section>

      {/* ------------------------------------------------------------ modals */}
      <Modal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        title="Choose a reference to recreate"
        wide
        footer={
          <span className="gl-small gl-faint">
            Only things you saved, boarded, marked to try, or uploaded — {searchPool.length} shown.
          </span>
        }
      >
        <Field label="Search your saved references">
          <TextInput value={searchQ} onChange={setSearchQ} placeholder="locs, vamp, velour, chrome…" />
        </Field>
        <div className="gl-assetgrid">
          {searchPool.map((it) => (
            <button key={String(it.id)} type="button" className="gl-asset" onClick={() => void startProject(String(it.id))}>
              <RefThumb item={it} mediaById={mediaById} />
              <div className="gl-asset__body">
                <div className="gl-serif" style={{ fontSize: '0.98rem' }}>
                  {String(it.title)}
                </div>
                <div className="gl-tech">{String(it.aesthetic || it.providerId)}</div>
                {it.recreatable ? <Chip tone="gold">marked recreatable</Chip> : <Chip>untagged for recreation</Chip>}
              </div>
            </button>
          ))}
          {!searchPool.length ? <p className="gl-small gl-faint">Nothing saved yet — go and like a few things in Glow Discover first.</p> : null}
        </div>
      </Modal>

      <Modal
        open={openCompare}
        onClose={() => setOpenCompare(false)}
        title="Compare two of your own attempts"
        wide
        footer={
          <>
            <div className="gl-row gl-row--tight">
              <Select value={compareSel.a ?? ''} onChange={(v) => setCompareSel({ ...compareSel, a: v })} placeholder="Left" options={attemptPool.map((m, i) => ({ value: String(m.id), label: `${String(m.takenOn ?? 'photo')} #${i + 1}` }))} />
              <Select value={compareSel.b ?? ''} onChange={(v) => setCompareSel({ ...compareSel, b: v })} placeholder="Right" options={attemptPool.map((m, i) => ({ value: String(m.id), label: `${String(m.takenOn ?? 'photo')} #${i + 1}` }))} />
            </div>
            <span className="gl-small gl-faint">Same conditions? If the light changed, the difference you see is the light.</span>
          </>
        }
      >
        <CompareSlider
          before={attemptPool.find((m) => String(m.id) === compareSel.a) ?? attemptPool[0] ?? null}
          after={attemptPool.find((m) => String(m.id) === compareSel.b) ?? attemptPool[1] ?? null}
          beforeLabel="Earlier"
          afterLabel="Later"
          height={420}
        />
      </Modal>

      <Modal
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        title="Schedule an attempt"
        footer={
          <>
            <span className="gl-small gl-faint">{steps.length} step(s) become the event checklist.</span>
            <Button variant="primary" onClick={() => void scheduleAttempt()}>
              Put it on the calendar
            </Button>
          </>
        }
      >
        <DateInput label="On" value={schedule.on} onChange={(v) => setSchedule({ ...schedule, on: v })} />
        <Range label="Blocked time" value={schedule.minutes} min={15} max={240} step={15} onChange={(v) => setSchedule({ ...schedule, minutes: v })} format={(v) => `${v} min`} />
        <p className="gl-small gl-faint">
          Created as a calendar event with <code>linkDomain: “recreate”</code>, so the Calendar department shows it and this page can find it again.
        </p>
      </Modal>

      <Modal
        open={Boolean(ask)}
        onClose={() => setAsk(null)}
        title={ask?.title ?? ''}
        footer={
          <>
            <span className="gl-small gl-faint">Nothing leaves this device.</span>
            <div className="gl-row gl-row--tight">
              <Button variant="ghost" onClick={() => setAsk(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  ask?.run();
                  setAsk(null);
                }}
              >
                Confirm
              </Button>
            </div>
          </>
        }
      >
        <p className="gl-small">{ask?.body}</p>
      </Modal>
    </div>
  );
}

/* ------------------------------------------------------------------ helpers */

function compactAction(s: Step): PlanAction {
  return {
    id: s.id,
    label: s.label,
    category: s.kind,
    cadence: 'once',
    dayOffset: s.order,
    weeks: [],
    costBand: s.costBand,
    techniqueId: null,
    productId: s.productId,
    goalId: null,
    doneOn: s.doneOn
  };
}

/** Canonical shape used to compare stored PlanAction rows against the local draft. */
function actionFingerprint(a: PlanAction) {
  return {
    id: String(a.id ?? ''),
    label: String(a.label ?? ''),
    category: String(a.category ?? ''),
    dayOffset: Number(a.dayOffset ?? 0),
    costBand: String(a.costBand ?? ''),
    productId: a.productId ? String(a.productId) : null,
    doneOn: Array.isArray(a.doneOn) ? a.doneOn.map(String).sort().join(',') : ''
  };
}

function labelForKind(kind: string) {  return KINDS.find((k) => k.value === kind)?.label ?? kind;
}

function seedComponents(item: AnyRow): Component[] {
  const out: Component[] = [];
  const seen = new Set<string>();
  const push = (label: string, kind: string, certainty: Certainty) => {
    const key = `${kind}:${label.toLowerCase()}`;
    if (!label || seen.has(key)) return;
    seen.add(key);
    out.push({ id: newId('cmp'), kind, label, certainty, include: true, note: '', linkedId: null, linkedTable: null });
  };
  for (const e of (item.elements as string[]) ?? []) push(String(e), guessKind(String(e)), 'observed');
  for (const c of (item.categories as string[]) ?? []) {
    const k = guessKind(String(c));
    if (k === 'prop') continue;
    push(String(c), k, 'uncertain');
  }
  return out.slice(0, 16);
}

function guessKind(text: string): string {
  const t = text.toLowerCase();
  if (/(brow)/.test(t)) return 'brows';
  if (/(lash)/.test(t)) return 'lashes';
  if (/(lip|gloss|lipstick)/.test(t)) return 'lips';
  if (/(nail|manicure|chrome|almond)/.test(t)) return 'nails';
  if (/(loc|braid|hair|parting|protective|retwist|framing)/.test(t)) return 'hair';
  if (/(fragrance|scent|perfume)/.test(t)) return 'fragrance';
  if (/(serum|skincare|moistur|cleanse|sunscreen)/.test(t)) return 'skincare';
  if (/(boot|heel|shoe|sandal|sneaker)/.test(t)) return 'shoes';
  if (/(bag|purse|shoulder bag)/.test(t)) return 'bag';
  if (/(chain|earring|cuff|ring|accessor|shades|eyewear|scrunchie)/.test(t)) return 'accessory';
  if (/(coat|skirt|dress|velour|top|knit|wool|satin|sheer|tracksuit|outfit|everyday|evening|vacation)/.test(t)) return 'clothing';
  if (/(shadow|liner|makeup|cosmetic|foundation|blush|placement)/.test(t)) return 'makeup';
  return 'prop';
}

/** Stated differences between your record and what the component says. */
function difference(x: { row: AnyRow; hits: string[] }, c: Component): string {
  const row = x.row;
  const bits: string[] = [];
  const comp = tokens(c.label);
  const mat = tokens(String(row.material ?? ''));
  if (mat.length && !mat.some((m) => comp.includes(m))) bits.push(`material on record: ${String(row.material)}`);
  const cols = ((row.colors as string[]) ?? []).map(String);
  if (cols.length && !cols.some((v) => c.label.toLowerCase().includes(v.toLowerCase()))) bits.push(`colours on record: ${cols.join(', ')}`);
  if (row.category && !c.label.toLowerCase().includes(String(row.category).toLowerCase())) bits.push(`filed under ${String(row.category)}`);
  if (row.family) bits.push(`note family: ${String(row.family)}`);
  if (row.form) bits.push(`form: ${String(row.form)}`);
  if (row.lengthCm != null) bits.push(`length ${String(row.lengthCm)}cm`);
  if (row.tried != null) bits.push(row.tried ? 'you have done this before' : 'never installed in your archive');
  bits.push(`${x.hits.length} shared word(s): ${x.hits.slice(0, 3).join(', ') || 'kind only'}`);
  return bits.join(' · ');
}

function useSettings(): AppSettings | null {
  const [s, setS] = useState<AppSettings | null>(null);
  useEffect(() => {
    let alive = true;
    void loadSettings().then((v) => alive && setS(v));
    return subscribeSettings((v) => alive && setS(v));
  }, []);
  return s;
}

function Coverage({ label, count, to, note }: { label: string; count: number; to: string; note: string }) {
  return (
    <div className="gl-inset">
      <div className="gl-label">{label}</div>
      <div className="gl-stat" style={{ fontSize: '1.6rem' }}>
        {count}
      </div>
      <div className="gl-small gl-faint">{note}</div>
      <a className="gl-btn gl-btn--sm gl-btn--ghost" href={`#${to}`} style={{ marginTop: 8 }}>
        Open that department
      </a>
    </div>
  );
}

function RefThumb({ item, mediaById }: { item: AnyRow; mediaById: Map<string, AnyRow> }) {
  const m = item.mediaId ? mediaById.get(String(item.mediaId)) : undefined;
  const d = (item.data ?? {}) as Record<string, unknown>;
  const row = { ...(m ?? {}), blobId: m?.blobId ?? null, remoteUrl: String(m?.remoteUrl ?? d.thumbUrl ?? d.remoteUrl ?? '') } as AnyRow;
  const src = useImageSrc(row, 'thumb');
  return (
    <div className="gl-asset__img">
      {src ? <img src={src} alt="" loading="lazy" /> : <div className="gl-missing-img" style={{ height: '100%' }}>No image</div>}
    </div>
  );
}

type ListItems = import('../db/schema').ListItem[];

