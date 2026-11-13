import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowDown,
  ArrowUp,
  CalendarClock,
  Check,
  Layers,
  Plus,
  RotateCcw,
  Scissors,
  Sparkles,
  Trash2,
  Undo2,
  X
} from 'lucide-react';
import { addDays, formatDate, hardDelete, newId, restore, softDelete, todayISO } from '../db/repo';
import { TABLES, type AnyRow } from '../db/schema';
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
  Swatches,
  TagInput,
  TextArea,
  TextInput,
  Toggle,
  fmtMoney,
  useToast
} from '../ui/primitives';
import { Carousel, Chipbar, DeptIntro, EmptyPlate, IndexList, IndexRow, KvList, ProgressRing, StatStrip, Timeline } from '../ui/editorial';
import { CompareSlider, Lightbox, PhotoPicker, Pin } from '../ui/media';
import { DistributionBars, LineChart } from '../ui/charts';
import { useImageSrc } from '../media/store';
import { techniqueIsRecommendable } from '../engine/prioritisation';
import { SHED_BASES, SHED_LIMIT_NOTE, lengthRead, shedRead } from '../engine/shed';
import '../styles/departments/hair.css';

/**
 * HAIR STUDIO (spec Part 11) — luxury editorial spread + physical archive.
 * Every card here is a real row: profile, events, measurements, routines,
 * calendar events, products, styles, experiments and photographs.
 */

type View = 'spread' | 'profile' | 'length' | 'archive' | 'locs' | 'schedule' | 'library';

const RECORD_KINDS = ['cut', 'colour', 'retwist', 'treatment', 'install', 'take-down', 'repair', 'trim', 'note'] as const;
const TEXTURES = ['Locs — budding', 'Locs — mature', 'Type 4c tight coil', 'Type 4b zig-zag', 'Type 4a coil', 'Type 3c curl', 'Wavy', 'Straight'];
const DENSITIES = ['Dense', 'Medium', 'Light', 'Thinning at crown', 'Thinning at hairline'];
const THICKNESS = ['Fine strand', 'Medium strand', 'Coarse strand', 'Mixed'];
const LOC_THICKNESS = ['Pencil-width', 'Dip-straw', 'Marker-width', 'Thumb-width'];
const ROOT_METHODS = ['Palm rolling', 'Two-strand twist', 'Interlocking', 'Crochet reset', 'Comb twist', 'Freeform — no manipulation'];
const CARE_TYPES = ['wash', 'co-wash', 'deep condition', 'protein', 'scalp care', 'moisture', 'satin wrap'];
const OWNERSHIP = ['own', 'want', 'tried', 'out', 'avoid'];

const blankProfileData = () => ({
  type: '',
  texture: '',
  density: '',
  thickness: '',
  lengthGoal: '',
  colour: '',
  currentStyle: '',
  history: '',
  stylingPrefs: '',
  goals: '',
  locCount: null as number | null,
  locThickness: '',
  retwistWeeks: null as number | null,
  rootMethod: '',
  extensionHistory: '',
  rootTenderness: false,
  tendernessNote: ''
});

const daysBetween = (a: string, b: string) => Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
const byDateDesc = (rows: AnyRow[], key: string) => [...rows].sort((x, y) => String(y[key] ?? '').localeCompare(String(x[key] ?? '')));
const asData = (row: AnyRow | undefined) => ((row?.data as Record<string, any>) ?? {}) as Record<string, any>;

function MediaImg({ row, alt }: { row?: AnyRow | null; alt?: string }) {
  const src = useImageSrc(row, 'thumb');
  if (!src) return <div className="gl-missing-img">Image unavailable offline</div>;
  return <img src={src} alt={alt ?? String(row?.title ?? 'Hair photograph')} loading="lazy" className="gl-img-treated" />;
}

function ConfirmDelete({ label, onCancel, onYes }: { label: string; onCancel: () => void; onYes: () => void }) {
  return (
    <Modal
      open
      onClose={onCancel}
      title="Delete this record?"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Keep it
          </Button>
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
        Soft deletion keeps the row recoverable from the archive drawer. Hard deletion removes it from the local database
        and queues the removal for sync.
      </p>
    </Modal>
  );
}

export default function HairPage() {
  const toast = useToast();
  const [view, setView] = useState<View>('spread');

  /* ------------------------------------------------------------------ rows */
  const profileRows = useRows(TABLES.profile, { where: { kind: 'hair' } });
  const profile = profileRows.find((r) => r.singleton === 1) ?? profileRows[0];
  const pd = { ...blankProfileData(), ...asData(profile) };

  const allRecords = useRows(TABLES.hairRecords, { includeDeleted: true });
  const liveRecords = useMemo(() => byDateDesc(allRecords.filter((r) => !r.deletedAt), 'doneOn'), [allRecords]);
  const trashed = useMemo(() => allRecords.filter((r) => Boolean(r.deletedAt)), [allRecords]);

  const measurementRows = useRows(TABLES.measurements, { where: { kind: 'hair' } });
  const measurements = useMemo(() => [...measurementRows].sort((a, b) => String(a.takenOn).localeCompare(String(b.takenOn))), [measurementRows]);

  const products = useRows(TABLES.products, { where: { category: 'hair' } });
  const routines = useRows(TABLES.routines, { where: { domain: 'hair' } });
  const hairstyles = useRows(TABLES.hairstyles);
  const tutorials = useRows(TABLES.tutorials, { where: { domain: 'hair' } });
  const experiments = useRows(TABLES.experiments, { where: { category: 'hair' } });
  const mediaRows = useRows(TABLES.mediaItems, { where: { linkedDomain: 'hair' } });
  const media = useMemo(() => byDateDesc(mediaRows, 'takenOn'), [mediaRows]);
  const events = useRows(TABLES.calendarEvents, { where: { linkDomain: 'hair' } });
  const providers = useRows(TABLES.providers);
  const techniques = useRows(TABLES.techniques, { where: { domain: 'hair' } });

  /* ------------------------------------------------------------- derivations */
  const retwists = useMemo(
    () => liveRecords.filter((r) => r.kind === 'retwist').sort((a, b) => String(a.doneOn).localeCompare(String(b.doneOn))),
    [liveRecords]
  );
  const lastRetwist = retwists[retwists.length - 1];
  const retwistGaps = useMemo(() => {
    const gaps: number[] = [];
    for (let i = 1; i < retwists.length; i += 1) gaps.push(daysBetween(String(retwists[i - 1].doneOn), String(retwists[i].doneOn)));
    return gaps;
  }, [retwists]);
  const avgGap = retwistGaps.length ? Math.round(retwistGaps.reduce((a, b) => a + b, 0) / retwistGaps.length) : null;
  const intervalDays = pd.retwistWeeks ? Math.round(Number(pd.retwistWeeks) * 7) : avgGap ?? 28;
  const sinceRetwist = lastRetwist ? daysBetween(String(lastRetwist.doneOn), todayISO()) : null;
  const dueInDays = sinceRetwist === null ? null : intervalDays - sinceRetwist;
  const duePct = sinceRetwist === null ? 0 : Math.min(100, Math.round((sinceRetwist / Math.max(1, intervalDays)) * 100));

  const lengthSeries = measurements.filter((m) => String(m.site).toLowerCase() === 'length');
  const latestLength = lengthSeries[lengthSeries.length - 1];
  const firstLength = lengthSeries[0];
  const growthCm = lengthSeries.length > 1 ? Number((Number(latestLength.value) - Number(firstLength.value)).toFixed(1)) : null;

  const costTotal = liveRecords.reduce((sum, r) => sum + (r.cost === null || r.cost === undefined ? 0 : Number(r.cost)), 0);
  const spendByKind = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of liveRecords) if (r.cost !== null && r.cost !== undefined) map.set(String(r.kind), (map.get(String(r.kind)) ?? 0) + Number(r.cost));
    return [...map.entries()].map(([label, value]) => ({ label, value: Math.round(value * 100) / 100 }));
  }, [liveRecords]);

  const repairs = liveRecords.filter((r) => r.kind === 'repair');
  const repairByLoc = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of repairs) {
      const key = String(asData(r).locRef ?? 'Unlabelled');
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [repairs]);

  /* ------------------------------------------------------------------ state */
  const [draft, setDraft] = useState<{ row?: Record<string, any>; kind?: string } | null>(null);
  const [confirm, setConfirm] = useState<{ label: string; run: () => void } | null>(null);
  const [compareIds, setCompareIds] = useState<{ before: string; after: string }>({ before: '', after: '' });
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [openTutorial, setOpenTutorial] = useState<string | null>(null);
  const [routineEdit, setRoutineEdit] = useState<string | null>(null);
  const [mForm, setMForm] = useState<Record<string, any> | null>(null);
  const [pForm, setPForm] = useState<Record<string, any> | null>(null);
  const [sForm, setSForm] = useState<Record<string, any> | null>(null);
  const [xForm, setXForm] = useState<Record<string, any> | null>(null);

  const blankRecord = (kind: string) => ({
    kind,
    doneOn: todayISO(),
    label: '',
    detail: '',
    cost: '',
    professionalId: '',
    locCount: '',
    locThickness: '',
    lengthCm: '',
    mediaIds: [] as string[],
    careType: '',
    locRef: '',
    weight: '',
    shedCount: '',
    shedBasis: '',
    breakageCount: '',
    variableChanged: ''
  });
  const blankProduct = () => ({
    name: '',
    brand: '',
    form: '',
    sizeLabel: '',
    pricePaid: '',
    currency: '',
    owned: true,
    openedOn: '',
    expiresOn: '',
    finishedOn: '',
    rating: 0,
    ingredients: '',
    sourceUrl: '',
    status: 'own',
    tool: false,
    hairCategory: '',
    useFor: [] as string[]
  });
  const blankStyle = () => ({
    name: '',
    family: '',
    lengthCm: '',
    protective: false,
    installMinutes: '',
    takeMinutes: '',
    costLabel: '',
    maintenanceEveryDays: '',
    suitableFor: [] as string[],
    mediaIds: [] as string[],
    tried: false
  });
  const blankExperiment = () => ({
    name: '',
    aim: '',
    startOn: todayISO(),
    endOn: '',
    baseline: '',
    protocol: '',
    productIds: [] as string[],
    techniqueIds: [] as string[],
    observations: [] as { on: string; note: string; mediaIds: string[]; rating: number | null }[],
    result: '',
    rating: 0,
    decision: 'open',
    confounders: '',
    obsOn: todayISO(),
    obsNote: '',
    obsRating: 3
  });

  const rowToProduct = (p: AnyRow) => ({
    id: p.id,
    name: p.name ?? '',
    brand: p.brand ?? '',
    form: p.form ?? '',
    sizeLabel: p.sizeLabel ?? '',
    pricePaid: p.pricePaid ?? '',
    currency: p.currency ?? '',
    owned: Boolean(p.owned),
    openedOn: p.openedOn ?? '',
    expiresOn: p.expiresOn ?? '',
    finishedOn: p.finishedOn ?? '',
    rating: Number(p.rating ?? 0),
    ingredients: p.ingredients ?? '',
    sourceUrl: p.sourceUrl ?? '',
    status: p.status ?? 'own',
    tool: Boolean(asData(p).tool),
    hairCategory: String(asData(p).hairCategory ?? ''),
    useFor: (p.tags as string[]) ?? []
  });
  const rowToStyle = (h: AnyRow) => ({
    id: h.id,
    name: h.name ?? '',
    family: h.family ?? '',
    lengthCm: h.lengthCm ?? '',
    protective: Boolean(h.protective),
    installMinutes: h.installMinutes ?? '',
    takeMinutes: h.takeMinutes ?? '',
    costLabel: h.costLabel ?? '',
    maintenanceEveryDays: h.maintenanceEveryDays ?? '',
    suitableFor: (h.suitableFor as string[]) ?? [],
    mediaIds: (h.mediaIds as string[]) ?? [],
    tried: Boolean(h.tried)
  });
  const rowToRecord = (r: AnyRow) => ({
    id: r.id,
    kind: r.kind,
    doneOn: r.doneOn,
    label: r.label ?? '',
    detail: r.detail ?? '',
    cost: r.cost ?? '',
    professionalId: r.professionalId ?? '',
    locCount: r.locCount ?? '',
    locThickness: r.locThickness ?? '',
    lengthCm: r.lengthCm ?? '',
    mediaIds: (r.mediaIds as string[]) ?? [],
    careType: String(asData(r).careType ?? ''),
    locRef: String(asData(r).locRef ?? ''),
    weight: String(asData(r).weight ?? ''),
    shedCount: asData(r).shedCount ?? '',
    shedBasis: String(asData(r).shedBasis ?? ''),
    breakageCount: asData(r).breakageCount ?? '',
    variableChanged: String(asData(r).variableChanged ?? '')
  });
  const rowToExperiment = (x: AnyRow) => ({
    id: x.id,
    name: x.name ?? '',
    aim: x.aim ?? '',
    startOn: x.startOn ?? todayISO(),
    endOn: x.endOn ?? '',
    baseline: x.baseline ?? '',
    protocol: x.protocol ?? '',
    productIds: (x.productIds as string[]) ?? [],
    techniqueIds: (x.techniqueIds as string[]) ?? [],
    observations: (x.observations as any[]) ?? [],
    result: x.result ?? '',
    rating: Number(x.rating ?? 0),
    decision: x.decision ?? 'open',
    confounders: x.confounders ?? '',
    obsOn: todayISO(),
    obsNote: '',
    obsRating: 3
  });

  const linkMedia = async (rows: AnyRow[], linkedIds: string[] = []) => {
    for (const r of rows) {
      await saveRow(TABLES.mediaItems, { id: r.id, linkedDomain: 'hair', linkedIds, album: 'Hair Studio', kind: 'progress' });
    }
  };

  const removeRecord = (r: AnyRow) =>
    setConfirm({
      label: `${r.label || 'Hair record'} · ${formatDate(String(r.doneOn))}`,
      run: async () => {
        await softDelete(TABLES.hairRecords, r.id);
        setConfirm(null);
        toast('Archived — restore it from the drawer below.', 'ok');
      }
    });

  /* =============================================================== rendering */
  return (
    <div className="gl-page hs-hair">
      <DeptIntro
        id="hair"
        image={media[0]}
        actions={
          <>
            <Button variant="gold" onClick={() => setDraft({ kind: 'note' })}>
              <Plus size={14} /> Log an event
            </Button>
            <Button variant="ghost" onClick={() => setView('locs')}>
              <Layers size={14} /> Loc tracker
            </Button>
          </>
        }
        meta={[
          { label: 'Records', value: liveRecords.length },
          { label: 'Last retwist', value: lastRetwist ? formatDate(String(lastRetwist.doneOn)) : 'not logged' },
          { label: 'Length', value: latestLength ? `${latestLength.value} ${latestLength.unit}` : 'not measured' },
          { label: 'Archive', value: `${media.length} photo(s)` }
        ]}
      />

      <div className="gl-strip hs-strip">
        {media.slice(0, 4).map((m) => (
          <div key={m.id} className="hs-strip__cell">
            <MediaImg row={m} />
            <div className="hs-strip__cap">
              <span className="gl-serif">{m.title || 'Untitled'}</span>
              <span className="gl-tech">{formatDate(String(m.takenOn))}</span>
            </div>
          </div>
        ))}
        {!media.length ? (
          <div className="hs-strip__cell hs-strip__cell--empty">
            <span className="gl-tech">No hair photography stored yet — this strip fills with your own archive</span>
          </div>
        ) : null}
      </div>

      <nav className="gl-chipbar hs-nav" aria-label="Hair Studio sections">
        {(
          [
            ['spread', 'The spread'],
            ['profile', 'Hair profile'],
            ['length', 'Length & density'],
            ['archive', 'Event archive'],
            ['locs', 'Loc tracking'],
            ['schedule', 'Maintenance'],
            ['library', 'Products, styles & labs']
          ] as [View, string][]
        ).map(([id, label]) => (
          <Chip key={id} active={view === id} onClick={() => setView(id)}>
            {label}
          </Chip>
        ))}
      </nav>

      {view === 'spread' ? <Spread /> : null}
      {view === 'profile' ? <ProfileView /> : null}
      {view === 'length' ? <LengthView /> : null}
      {view === 'archive' ? <ArchiveView /> : null}
      {view === 'locs' ? <LocView /> : null}
      {view === 'schedule' ? <ScheduleView /> : null}
      {view === 'library' ? <LibraryView /> : null}

      {confirm ? <ConfirmDelete label={confirm.label} onCancel={() => setConfirm(null)} onYes={confirm.run} /> : null}
      {draft ? <RecordEditor /> : null}
      {mForm ? <MeasurementEditor /> : null}
      {pForm ? <ProductEditor /> : null}
      {sForm ? <StyleEditor /> : null}
      {xForm ? <ExperimentEditor /> : null}
      {routineEdit ? <RoutineEditor /> : null}
      {openTutorial ? <TutorialViewer /> : null}

      <Lightbox
        items={media}
        index={lightbox}
        onIndex={setLightbox}
        onClose={() => setLightbox(null)}
        header={(m) => (
          <div>
            <div className="gl-serif" style={{ fontSize: '1.2rem' }}>{m.title || 'Hair photograph'}</div>
            <div className="gl-tech">
              {formatDate(String(m.takenOn))} · {m.conditions || 'conditions not recorded'}
            </div>
          </div>
        )}
        footer={(m) => (
          <div className="gl-row gl-row--tight">
            {asData(m).palette?.length ? <Swatches colors={asData(m).palette.slice(0, 5)} size={22} /> : null}
            <Chip>{m.lighting || 'lighting not recorded'}</Chip>
            <Chip>{m.distance || 'distance not recorded'}</Chip>
          </div>
        )}
      />
    </div>
  );

  /* ------------------------------------------------------------- 1 · spread */
  function Spread() {
    const recent = liveRecords.slice(0, 6);
    const protective = hairstyles.filter((h) => h.protective && !h.deletedAt);
    return (
      <>
        <Section eyebrow="Editorial desk" title="Where the studio stands today">
          <div className="gl-split">
            <div className="gl-stack">
              <StatStrip
                items={[
                  { label: 'Events logged', value: liveRecords.length },
                  { label: 'Retwist interval', value: avgGap ? `${avgGap}d` : '—', hint: 'mean of your own records' },
                  { label: 'Photographs', value: media.length },
                  { label: 'Logged spend', value: fmtMoney(costTotal) }
                ]}
              />
              <Card variant="flush">
                <p className="gl-lead drop">
                  Length retention is a records problem before it is a product problem. This studio keeps the four things
                  that actually show change: dated events, dated measurements, dated photographs, and the interval between
                  appointments. Nothing is estimated on your behalf — if a field reads <em>not recorded</em>, it is because
                  the number has not entered the lab yet.
                </p>
              </Card>
              {lastRetwist ? (
                <Card accent={dueInDays !== null && dueInDays <= 7}>
                  <CardHead
                    eyebrow="Maintenance"
                    title={dueInDays === null ? 'Retwist timing' : dueInDays > 0 ? `Retwist due in ${dueInDays} day(s)` : `Retwist ${Math.abs(dueInDays)} day(s) overdue`}
                    sub={`From your logged ${intervalDays}-day cycle, last done ${formatDate(String(lastRetwist.doneOn))}`}
                    right={<Button size="sm" onClick={() => setView('schedule')}>Schedule</Button>}
                  />
                  <Meter value={duePct} label="Cycle elapsed" />
                </Card>
              ) : (
                <EmptyPlate
                  kicker="Nothing invented"
                  title="No retwist logged yet"
                  body="Add your first retwist or reset and the interval, the due-soon meter and the whole loc timeline begin computing from your dates."
                  action={
                    <Button variant="primary" onClick={() => setDraft({ kind: 'retwist' })}>
                      Log a retwist
                    </Button>
                  }
                />
              )}
            </div>

            <div className="gl-stack rule-col">
              <Card variant="default">
                <CardHead eyebrow="Latest" title="From the archive" right={<Button size="sm" variant="ghost" onClick={() => setView('archive')}>All events</Button>} />
                {recent.length ? (
                  <Timeline
                    items={recent.map((r) => ({
                      when: `${formatDate(String(r.doneOn))} · ${String(r.kind).toUpperCase()}`,
                      title: r.label || 'Untitled event',
                      body: r.detail ? String(r.detail).slice(0, 140) : undefined,
                      tone: r.kind === 'retwist' || r.kind === 'cut' ? ('accent' as const) : ('plain' as const)
                    }))}
                  />
                ) : (
                  <EmptyState title="The archive is empty" body="Cuts, colour, retwists, installs, repairs, trims and notes all live here as dated rows." />
                )}
              </Card>

              <Card>
                <CardHead eyebrow="Guardrails" title="What this studio will not do" />
                <SafetyBanner tone="note" title="No analysis of your photographs">
                  Hair Studio stores your images and your own descriptions. There is no computer vision here and no medical
                  conclusion — shedding, patch loss or scalp changes belong to a clinician, not an app.
                </SafetyBanner>
                <div style={{ height: 10 }} />
                <SafetyBanner tone="warn" title="Tension is the one variable that stops being reversible">
                  Tight styles and painful roots are the documented route to traction alopecia. Log tenderness in your
                  profile and the loc view will keep reminding you while it is still a styling decision.
                </SafetyBanner>
              </Card>

              {protective.length ? (
                <Card variant="flush">
                  <div style={{ padding: 'var(--glow-sp-4)' }}>
                    <div className="gl-eyebrow">Protective options you saved</div>
                  </div>
                  <Carousel height={170}>
                    {protective.slice(0, 8).map((h) => (
                      <div key={h.id} className="hs-style-card">
                        <div className="gl-serif" style={{ fontSize: '1.1rem' }}>{h.name}</div>
                        <div className="gl-tech">{h.installMinutes} min install · every {h.maintenanceEveryDays}d</div>
                        {h.costLabel ? <Chip>{String(h.costLabel)}</Chip> : <Chip>cost not entered</Chip>}
                      </div>
                    ))}
                  </Carousel>
                </Card>
              ) : null}
            </div>
          </div>
        </Section>

        <Section
          eyebrow="Evidence desk"
          title="Techniques graded, not hyped"
          description="Read from the evidence library and marked with the ranking engine’s own recommendability test."
          right={<Link className="gl-btn gl-btn--sm gl-btn--ghost" to="/evidence">Evidence Center</Link>}
        >
          {techniques.length ? (
            <div className="gl-grid gl-grid--2">
              {techniques.map((t) => (
                <Card key={t.id} variant="default" className="hs-ev">
                  <div className="gl-row gl-row--between" style={{ alignItems: 'baseline' }}>
                    <h4 className="gl-serif" style={{ margin: 0, fontSize: '1.15rem' }}>{t.title}</h4>
                    <EvidenceChip grade={String(t.evidence)} />
                  </div>
                  <p className="gl-small gl-muted" style={{ margin: '8px 0' }}>{t.claim}</p>
                  <div className="gl-row gl-row--tight">
                    {techniqueIsRecommendable(t as any) ? <Chip>Within scope</Chip> : <Chip tone="danger">Flagged</Chip>}
                    <Chip>{String(t.costBand)}</Chip>
                    <Chip>{String(t.timeToTry)}</Chip>
                  </div>
                  {t.whenToConsult ? <div className="gl-small gl-faint" style={{ marginTop: 8 }}>Ask a professional: {String(t.whenToConsult)}</div> : null}
                </Card>
              ))}
            </div>
          ) : (
            <EmptyPlate
              kicker="Reference"
              title="Evidence entries not seeded yet"
              body="Open the Evidence Center once and the hair-domain techniques appear here with their grades and limits."
              action={<Link className="gl-btn gl-btn--sm" to="/evidence">Open evidence</Link>}
            />
          )}
          <div className="gl-row gl-row--tight" style={{ marginTop: 'var(--glow-sp-4)' }}>
            <Link className="gl-btn gl-btn--sm gl-btn--ghost" to="/services">Find a professional</Link>
            <Link className="gl-btn gl-btn--sm gl-btn--ghost" to="/academy">Academy: loc maintenance log</Link>
            <Link className="gl-btn gl-btn--sm gl-btn--ghost" to="/progress">Progress analytics</Link>
          </div>
        </Section>
      </>
    );
  }

  /* ----------------------------------------------------------- 2 · profile */
  function ProfileView() {
    const [editing, setEditing] = useState(false);
    const [form, setForm] = useState<Record<string, any>>(pd);
    const openEditor = () => {
      setForm({ ...pd });
      setEditing(true);
    };
    const commit = async () => {
      await saveRow(TABLES.profile, {
        id: profile?.id,
        kind: 'hair',
        singleton: 1,
        data: { ...blankProfileData(), ...asData(profile), ...form },
        tags: ['hair', 'profile']
      });
      setEditing(false);
      toast('Hair profile saved.', 'ok');
    };
    const textField = (k: string, label: string, opts?: string[]) => (
      <Field label={label} key={k}>
        {opts ? (
          <Select
            value={String(form[k] ?? '')}
            onChange={(v) => setForm({ ...form, [k]: v })}
            options={opts.map((o) => ({ value: o, label: o }))}
            placeholder="Not recorded"
          />
        ) : (
          <TextInput value={String(form[k] ?? '')} onChange={(v) => setForm({ ...form, [k]: v })} />
        )}
      </Field>
    );
    return (
      <Section eyebrow="Part 11 · profile" title="Hair profile & loc block" description="A self-described record. It shapes what the studio suggests and it never leaves this device.">
        <div className="gl-split">
          <Card>
            <CardHead
              eyebrow="Your hair, in your words"
              title={profile ? 'Hair profile' : 'No profile yet'}
              right={<Button size="sm" variant={profile ? 'default' : 'primary'} onClick={openEditor}>{profile ? 'Edit profile' : 'Create profile'}</Button>}
            />
            {profile ? (
              <>
                <KvList
                  items={[
                    { k: 'Type', v: pd.type || 'not recorded' },
                    { k: 'Texture', v: pd.texture || 'not recorded' },
                    { k: 'Density', v: pd.density || 'not recorded' },
                    { k: 'Strand', v: pd.thickness || 'not recorded' },
                    { k: 'Length goal', v: pd.lengthGoal || 'not recorded' },
                    { k: 'Colour', v: pd.colour || 'not recorded' },
                    { k: 'Current style', v: pd.currentStyle || 'not recorded' }
                  ]}
                />
                <div style={{ height: 12 }} />
                <Disclosure summary="History, styling preferences and goals">
                  <div className="gl-stack" style={{ marginTop: 10 }}>
                    <div>
                      <div className="gl-label">History</div>
                      <p className="gl-small">{pd.history || 'not recorded'}</p>
                    </div>
                    <div>
                      <div className="gl-label">Styling preferences</div>
                      <p className="gl-small">{pd.stylingPrefs || 'not recorded'}</p>
                    </div>
                    <div>
                      <div className="gl-label">Hair goals</div>
                      <p className="gl-small">{pd.goals || 'not recorded'}</p>
                    </div>
                  </div>
                </Disclosure>
              </>
            ) : (
              <EmptyState
                title="Nothing assumed about your hair"
                body="Fill the profile once and every other view reads from it — the loc block, the retwist meter and the style suggestions all draw on these fields."
              />
            )}
          </Card>

          <Card variant="raised">
            <CardHead eyebrow="Loc-specific block" title="Locs, thickness & root maintenance" />
            <KvList
              items={[
                { k: 'Number of locs', v: pd.locCount ?? 'not recorded' },
                { k: 'Approx. thickness', v: pd.locThickness || 'not recorded' },
                { k: 'Retwist interval', v: pd.retwistWeeks ? `${pd.retwistWeeks} weeks` : 'not recorded' },
                { k: 'Root method', v: pd.rootMethod || 'not recorded' },
                { k: 'Extensions', v: pd.extensionHistory || 'no extension history entered' },
                { k: 'Root tenderness', v: pd.rootTenderness ? 'flagged' : 'not flagged' }
              ]}
            />
            <div style={{ height: 12 }} />
            {pd.rootTenderness ? (
              <SafetyBanner tone="warn" title="Root tenderness flagged">
                {pd.tendernessNote ? <p className="gl-small" style={{ marginTop: 0 }}>{pd.tendernessNote}</p> : null}
                <p className="gl-small">
                  This is your own note, not a diagnosis. What the literature is clear on: sustained tension on the
                  follicle can cause loss that is reversible early and permanent late. Looser installs, longer intervals
                  and a professional look at the hairline are the responses worth taking.
                </p>
                <div className="gl-row gl-row--tight" style={{ marginTop: 8 }}>
                  <Link className="gl-btn gl-btn--sm" to="/services">Book a dermatology consult</Link>
                  <Link className="gl-btn gl-btn--sm gl-btn--ghost" to="/evidence">Protective-styling evidence</Link>
                </div>
              </SafetyBanner>
            ) : (
              <div className="gl-note">
                Keep the tenderness flag honest: switch it on in the editor the week your roots start hurting, not after
                the style comes out.
              </div>
            )}
          </Card>
        </div>

        <Modal
          open={editing}
          onClose={() => setEditing(false)}
          title="Hair profile"
          wide
          footer={
            <>
              <Button variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
              <Button variant="primary" onClick={commit}>
                <Check size={14} /> Save profile
              </Button>
            </>
          }
        >
          <p className="gl-small gl-muted">Every field is self-described. Leave anything blank rather than guess — blanks display as “not recorded”.</p>
          <div className="gl-form-row">
            {textField('type', 'Hair type / pattern')}
            {textField('texture', 'Texture', TEXTURES)}
            {textField('density', 'Density', DENSITIES)}
            {textField('thickness', 'Strand thickness', THICKNESS)}
            {textField('lengthGoal', 'Length goal, in your words')}
            {textField('colour', 'Colour (natural + any service)')}
            {textField('currentStyle', 'Current style')}
          </div>
          <Field label="Hair history">
            <TextArea value={String(form.history ?? '')} onChange={(v) => setForm({ ...form, history: v })} rows={3} placeholder="Chemical services, colour, illness, medication you were told about — as you remember it." />
          </Field>
          <div className="gl-form-row">
            <Field label="Styling preferences">
              <TextArea value={String(form.stylingPrefs ?? '')} onChange={(v) => setForm({ ...form, stylingPrefs: v })} rows={2} />
            </Field>
            <Field label="Hair goals">
              <TextArea value={String(form.goals ?? '')} onChange={(v) => setForm({ ...form, goals: v })} rows={2} />
            </Field>
          </div>
          <div className="gl-eyebrow" style={{ margin: 'var(--glow-sp-4) 0' }}>Loc block</div>
          <div className="gl-form-row">
            {textField('locThickness', 'Approximate loc thickness', LOC_THICKNESS)}
            {textField('rootMethod', 'Root maintenance method', ROOT_METHODS)}
            <Field label="Number of locs">
              <TextInput type="number" value={form.locCount ?? ''} onChange={(v) => setForm({ ...form, locCount: v === '' ? null : Number(v) })} />
            </Field>
            <Field label="Retwist interval (weeks)" hint="Drives the due-soon meter">
              <TextInput type="number" value={form.retwistWeeks ?? ''} onChange={(v) => setForm({ ...form, retwistWeeks: v === '' ? null : Number(v) })} />
            </Field>
          </div>
          <Field label="Extension history">
            <TextArea value={String(form.extensionHistory ?? '')} onChange={(v) => setForm({ ...form, extensionHistory: v })} rows={2} placeholder="Type, months worn, weight added, how the take-down looked." />
          </Field>
          <div className="gl-form-row">
            <Toggle checked={Boolean(form.rootTenderness)} onChange={(v) => setForm({ ...form, rootTenderness: v })} label="Roots are currently tender" hint="Your observation — treated as a caution flag, never a diagnosis." />
            <Field label="Tenderness note">
              <TextInput value={String(form.tendernessNote ?? '')} onChange={(v) => setForm({ ...form, tendernessNote: v })} placeholder="Where, since when, what changed" />
            </Field>
          </div>
        </Modal>
      </Section>
    );
  }

  /* ------------------------------------------------------------ 3 · length */
  function LengthView() {
    const before = media.find((m) => m.id === compareIds.before);
    const after = media.find((m) => m.id === compareIds.after);
    const conditionsMatch = before && after ? before.conditions === after.conditions && before.lighting === after.lighting && before.distance === after.distance : null;
    const observations = liveRecords.filter((r) => /density|texture|breakage|shed|single strand/i.test(`${r.label} ${r.detail}`));

    return (
      <>
        <Section eyebrow="Part 11 · measurement" title="Length over time" description="Only measurements you took, on the date you took them, with the method you used.">
          <div className="gl-split">
            <Card>
              <CardHead
                eyebrow="Chart"
                title="Centimetres, dated"
                right={
                  <Button size="sm" variant="primary" onClick={() => setMForm({ site: 'Length', value: '', unit: 'cm', method: 'Tape from scalp to tip, same section each time', takenOn: todayISO(), note: '', mediaId: '' })}>
                    <Plus size={13} /> Measurement
                  </Button>
                }
              />
              {lengthSeries.length > 1 ? (
                <LineChart
                  labels={lengthSeries.map((m) => formatDate(String(m.takenOn)))}
                  series={[{ label: 'Length (cm)', data: lengthSeries.map((m) => Number(m.value)), area: true }]}
                  yTitle="cm"
                  height={260}
                />
              ) : (
                <EmptyState title="Two dated measurements make a line" body="One point is an anecdote. Measure the same section, same method, and the trend appears here." />
              )}
              {growthCm !== null ? (
                <div className="gl-row gl-row--between" style={{ marginTop: 'var(--glow-sp-4)' }}>
                  <Chip>{growthCm >= 0 ? `+${growthCm}` : growthCm} cm since {formatDate(String(firstLength.takenOn))}</Chip>
                  <span className="gl-tech">
                    {lengthSeries.length} measurements · {daysBetween(String(firstLength.takenOn), String(latestLength.takenOn))} days
                  </span>
                </div>
              ) : null}
            </Card>

            <Card variant="default">
              <CardHead eyebrow="Ledger" title="Every measurement" />
              {measurements.length ? (
                <IndexList>
                  {byDateDesc(measurements, 'takenOn').map((m, i) => (
                    <IndexRow
                      key={m.id}
                      no={i + 1}
                      title={`${m.site} — ${m.value} ${m.unit}`}
                      sub={`${formatDate(String(m.takenOn))} · ${m.method || 'method not recorded'}${m.note ? ` · ${m.note}` : ''}`}
                      right={
                        <span className="gl-row gl-row--tight">
                          <IconButton
                            label="Attach a photograph"
                            onClick={() =>
                              setMForm({
                                id: m.id,
                                site: String(m.site),
                                value: String(m.value),
                                unit: String(m.unit),
                                method: String(m.method ?? ''),
                                takenOn: String(m.takenOn),
                                note: String(m.note ?? ''),
                                mediaId: String(asData(m).mediaId ?? '')
                              })
                            }
                          >
                            <Scissors size={13} />
                          </IconButton>
                          <IconButton
                            label="Delete measurement"
                            onClick={() =>
                              setConfirm({
                                label: `${m.site} ${m.value} ${m.unit}`,
                                run: async () => {
                                  await softDelete(TABLES.measurements, m.id);
                                  setConfirm(null);
                                  toast('Measurement archived.', 'ok');
                                }
                              })
                            }
                          >
                            <Trash2 size={13} />
                          </IconButton>
                        </span>
                      }
                      onClick={() =>
                        setMForm({
                          id: m.id,
                          site: String(m.site),
                          value: String(m.value),
                          unit: String(m.unit),
                          method: String(m.method ?? ''),
                          takenOn: String(m.takenOn),
                          note: String(m.note ?? ''),
                          mediaId: String(asData(m).mediaId ?? '')
                        })
                      }
                    />
                  ))}
                </IndexList>
              ) : (
                <EmptyState title="No measurements" body="Length, circumference or hairline count — anything you can measure with a tape and a date." />
              )}
            </Card>
          </div>
        </Section>

        <Section eyebrow="Part 11 · photography" title="Before & after, with conditions attached">
          <div className="gl-split">
            <div className="gl-stack">
              <CompareSlider
                before={before}
                after={after}
                height={420}
                beforeLabel={before ? formatDate(String(before.takenOn)) : 'Before'}
                afterLabel={after ? formatDate(String(after.takenOn)) : 'After'}
              />
              <div className="gl-form-row">
                <Field label="Earlier photograph">
                  <Select value={compareIds.before} onChange={(v) => setCompareIds((c) => ({ ...c, before: v }))} options={media.map((m) => ({ value: m.id, label: `${formatDate(String(m.takenOn))} — ${m.title || 'untitled'}` }))} placeholder="Choose" />
                </Field>
                <Field label="Later photograph">
                  <Select value={compareIds.after} onChange={(v) => setCompareIds((c) => ({ ...c, after: v }))} options={media.map((m) => ({ value: m.id, label: `${formatDate(String(m.takenOn))} — ${m.title || 'untitled'}` }))} placeholder="Choose" />
                </Field>
              </div>
              {before && after ? (
                conditionsMatch ? (
                  <div className="gl-note gl-note--ok">Both frames record the same conditions, lighting and distance — the comparison is as fair as you made it.</div>
                ) : (
                  <SafetyBanner tone="warn" title="Different capture conditions — read this as illustration">
                    {before.conditions || 'no conditions'} · {before.lighting || 'no lighting'} · {before.distance || 'no distance'} versus{' '}
                    {after.conditions || 'no conditions'} · {after.lighting || 'no lighting'} · {after.distance || 'no distance'}. Lens
                    distance, lighting and even wet-versus-dry hair change apparent length and density more than most products do.
                  </SafetyBanner>
                )
              ) : (
                <div className="gl-note">Pick two photographs to compare. Recording conditions at capture lets the studio warn you when a comparison is unfair.</div>
              )}
            </div>

            <div className="gl-stack rule-col">
              <Card variant="default">
                <CardHead eyebrow="Observations" title="Density, texture & breakage notes" right={<Button size="sm" onClick={() => setDraft({ kind: 'note' })}>Add note</Button>} />
                {observations.length ? (
                  <Timeline items={observations.slice(0, 8).map((r) => ({ when: formatDate(String(r.doneOn)), title: r.label, body: r.detail }))} />
                ) : (
                  <EmptyState title="No density or breakage notes yet" body="Log a note mentioning density, texture, breakage or shedding and it gathers here." />
                )}
              </Card>
              <Card variant="default">
                <CardHead eyebrow="Retention" title="Where length is being lost" />
                <KvList
                  items={[
                    { k: 'Breakage notes', v: observations.length },
                    { k: 'Cuts & trims', v: liveRecords.filter((r) => r.kind === 'trim' || r.kind === 'cut').length },
                    { k: 'Last trim', v: liveRecords.find((r) => r.kind === 'trim') ? formatDate(String(liveRecords.find((r) => r.kind === 'trim')!.doneOn)) : 'not recorded' },
                    { k: 'Measured retention', v: growthCm !== null ? `${growthCm} cm` : 'needs two length entries' }
                  ]}
                />
                <p className="gl-small gl-faint" style={{ marginTop: 10 }}>
                  Retention is measured, never inferred: growth you did not record is not claimed here.
                </p>
              </Card>
            </div>
          </div>
        </Section>
      </>
    );
  }

  function MeasurementEditor() {
    const draftM = mForm ?? {};
    const set = (k: string, v: unknown) => setMForm((p) => ({ ...(p as Record<string, any>), [k]: v }));
    return (
      <Modal
        open
        onClose={() => setMForm(null)}
        title={draftM.id ? 'Edit measurement' : 'New hair measurement'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setMForm(null)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!draftM.value || !draftM.site}
              onClick={async () => {
                const existing = draftM.id ? measurementRows.find((m) => m.id === draftM.id) : undefined;
                const linked = media.find((m) => m.id === draftM.mediaId);
                await saveRow(TABLES.measurements, {
                  id: draftM.id,
                  kind: 'hair',
                  site: draftM.site,
                  value: Number(draftM.value),
                  unit: draftM.unit || 'cm',
                  takenOn: draftM.takenOn || todayISO(),
                  method: draftM.method,
                  note: draftM.note,
                  data: { ...asData(existing), mediaId: draftM.mediaId || null, mediaTitle: linked?.title ?? null }
                });
                setMForm(null);
                toast('Measurement stored.', 'ok');
              }}
            >
              Save measurement
            </Button>
          </>
        }
      >
        <div className="gl-form-row">
          <Field label="Site" hint="Length, ponytail circumference, hairline count…">
            <TextInput value={draftM.site} onChange={(v) => set('site', v)} placeholder="Length" />
          </Field>
          <Field label="Value">
            <TextInput type="number" value={draftM.value} onChange={(v) => set('value', v)} />
          </Field>
          <Field label="Unit">
            <Select value={draftM.unit} onChange={(v) => set('unit', v)} options={[{ value: 'cm', label: 'cm' }, { value: 'in', label: 'in' }, { value: 'count', label: 'count' }]} />
          </Field>
          <DateInput label="Taken on" value={draftM.takenOn} onChange={(v) => set('takenOn', v)} />
        </div>
        <Field label="Method" hint="What you did — this is what makes the next one comparable.">
          <TextInput value={draftM.method} onChange={(v) => set('method', v)} />
        </Field>
        <Field label="Note">
          <TextArea value={draftM.note} onChange={(v) => set('note', v)} rows={2} />
        </Field>
        <Field label="Photograph from the same day">
          <Select value={draftM.mediaId} onChange={(v) => set('mediaId', v)} options={media.map((m) => ({ value: m.id, label: `${formatDate(String(m.takenOn))} — ${m.title || 'untitled'}` }))} placeholder="None attached" />
        </Field>
        <div style={{ marginTop: 'var(--glow-sp-3)' }}>
          <PhotoPicker
            kind="progress"
            album="Hair Studio"
            label="Capture a measurement photo"
            withConditions
            onPick={(rows) => {
              void linkMedia(rows, draftM.id ? [draftM.id] : []);
              set('mediaId', rows[0]?.id ?? draftM.mediaId);
            }}
          />
        </div>
      </Modal>
    );
  }

  /* ----------------------------------------------------------- 4 · archive */
  function ArchiveView() {
    const [kindFilter, setKindFilter] = useState('');
    const [q, setQ] = useState('');
    const rows = liveRecords.filter((r) => (kindFilter ? r.kind === kindFilter : true)).filter((r) => (q ? `${r.label} ${r.detail}`.toLowerCase().includes(q.toLowerCase()) : true));
    const shedView = shedRead(liveRecords);
    const lengthView = lengthRead(liveRecords);
    return (
      <>
        <Section
          eyebrow="Part 11 · archive"
          title="Every hair event, dated"
          right={
            <>
              <TextInput value={q} onChange={setQ} placeholder="Search labels & notes" />
              <Button size="sm" variant="primary" onClick={() => setDraft({ kind: 'cut' })}>
                <Plus size={13} /> Event
              </Button>
            </>
          }
        >
          <Chipbar
            value={kindFilter}
            onChange={setKindFilter}
            allLabel="All kinds"
            items={RECORD_KINDS.map((k) => ({ value: k, label: k, count: liveRecords.filter((r) => r.kind === k).length }))}
          />
          {rows.length ? (
            <div className="gl-stack" style={{ marginTop: 'var(--glow-sp-4)' }}>
              {rows.map((r) => (
                <Card key={r.id} variant="default" className="hs-rec">
                  <div className="gl-row gl-row--between" style={{ alignItems: 'baseline', gap: 'var(--glow-sp-3)' }}>
                    <div style={{ minWidth: 0 }}>
                      <div className="gl-tech">{formatDate(String(r.doneOn))} · {String(r.kind).toUpperCase()}</div>
                      <div className="gl-serif" style={{ fontSize: '1.25rem', color: 'var(--glow-text-strong)' }}>{r.label || 'Untitled event'}</div>
                      {r.detail ? <p className="gl-small gl-muted" style={{ margin: '6px 0 0' }}>{r.detail}</p> : null}
                      <div className="gl-row gl-row--tight" style={{ marginTop: 10 }}>
                        {r.cost !== null && r.cost !== undefined ? <Chip>{fmtMoney(Number(r.cost))}</Chip> : <Chip>cost not entered</Chip>}
                        {r.lengthCm !== null && r.lengthCm !== undefined ? <Chip>{r.lengthCm} cm</Chip> : null}
                        {r.locCount !== null && r.locCount !== undefined ? <Chip>{r.locCount} locs</Chip> : null}
                        {r.locThickness ? <Chip>{String(r.locThickness)}</Chip> : null}
                        {asData(r).careType ? <Chip tone="info">{String(asData(r).careType)}</Chip> : null}
                        {asData(r).shedCount !== undefined ? (
                          <Chip tone="moderate">
                            {String(asData(r).shedCount)} shed
                            {asData(r).shedBasis ? ` / ${SHED_BASES.find((b) => b.key === asData(r).shedBasis)?.label ?? String(asData(r).shedBasis)}` : ' · window not set'}
                          </Chip>
                        ) : null}
                        {asData(r).breakageCount !== undefined ? <Chip tone="limited">{String(asData(r).breakageCount)} broken</Chip> : null}
                        {asData(r).locRef ? <Chip tone="info">loc {String(asData(r).locRef)}</Chip> : null}
                        {asData(r).weight ? <Chip tone="info">{String(asData(r).weight)}</Chip> : null}
                        <Chip>{r.professionalId ? providers.find((p) => p.id === r.professionalId)?.name || 'provider' : 'home / unattributed'}</Chip>
                        <span className="gl-tech">{((r.mediaIds as string[]) ?? []).length} photo(s)</span>
                      </div>
                    </div>
                    <div className="gl-row gl-row--tight">
                      <IconButton label="Edit event" onClick={() => setDraft({ row: rowToRecord(r) })}>
                        <RotateCcw size={13} />
                      </IconButton>
                      <IconButton label="Delete event" onClick={() => removeRecord(r)}>
                        <Trash2 size={13} />
                      </IconButton>
                    </div>
                  </div>
                  {((r.mediaIds as string[]) ?? []).length ? (
                    <div className="hs-rec__thumbs">
                      {(r.mediaIds as string[]).map((id) => {
                        const m = media.find((x) => x.id === id);
                        return m ? (
                          <button key={id} type="button" className="hs-thumb-btn" onClick={() => setLightbox(media.findIndex((x) => x.id === id))} aria-label={`Open photo from ${formatDate(String(m.takenOn))}`}>
                            <MediaImg row={m} />
                          </button>
                        ) : null;
                      })}
                    </div>
                  ) : null}
                </Card>
              ))}
            </div>
          ) : (
            <EmptyPlate
              kicker="Archive"
              title="Nothing matches this filter"
              body="This list only ever shows rows you created — no samples, no filler."
              action={<Button variant="primary" onClick={() => setDraft({ kind: 'note' })}>Log an event</Button>}
            />
          )}
        </Section>

        <Section
          eyebrow="Part 11 · shedding"
          title="What you counted, and what the length did"
          description="The two numbers the growth lessons ask for — hairs shed over a named window, and length at each event — read back to you. Both are your own estimate of what you saw and what you measured; the app counts nothing on its own."
        >
          <div className="gl-split">
            <Card variant="default">
              <CardHead eyebrow="Shed" title={`${shedView.counted} counted record(s) of ${shedView.records}`} />
              <div className="gl-row gl-row--tight" style={{ marginBottom: 8 }}>
                <Chip tone={shedView.shed.usable ? 'moderate' : 'limited'}>
                  {shedView.shed.usable ? shedView.shed.direction : 'not enough to read a direction'}
                </Chip>
                {shedView.missingWindow ? <Chip tone="limited">{shedView.missingWindow} count(s) with no window</Chip> : null}
                {shedView.noCount ? <Chip>{shedView.noCount} record(s) with no count</Chip> : null}
              </div>
              <p className="gl-small" style={{ margin: 0 }}>
                {shedView.sentence}
              </p>
              {shedView.latest ? (
                <p className="gl-tech gl-faint" style={{ margin: '8px 0 0' }}>
                  newest count: {shedView.latest.count} over {shedView.latest.basisLabel.toLowerCase()} ={' '}
                  {Math.round(shedView.latest.perDay * 10) / 10} per day · {formatDate(shedView.latest.on)}
                </p>
              ) : null}
              {shedView.breakage.n ? (
                <p className="gl-small gl-muted" style={{ margin: '8px 0 0' }}>
                  Broken, on the same windows: {shedView.breakage.sentence}
                </p>
              ) : null}
              {shedView.pairs.length ? (
                <>
                  <div className="gl-eyebrow" style={{ margin: '12px 0 6px' }}>Each count beside the one thing you changed</div>
                  <IndexList>
                    {shedView.pairs.slice(0, 8).map((p, i) => (
                      <IndexRow
                        key={p.on}
                        no={i + 1}
                        title={formatDate(p.on)}
                        sub={
                          p.perDay !== null
                            ? `${p.perDay} per day (${p.count} over ${p.basisLabel.toLowerCase()})${p.variable ? ` · ${p.variable}` : ' · no variable noted'}`
                            : `${p.count ?? 'no count'} · ${p.variable || 'no variable noted'}`
                        }
                      />
                    ))}
                  </IndexList>
                </>
              ) : null}
              <div style={{ marginTop: 12 }}>
                <Button size="sm" variant="ghost" onClick={() => setDraft({ kind: 'note' })}>
                  <Plus size={13} /> Log a counted wash
                </Button>
              </div>
            </Card>

            <Card variant="default">
              <CardHead eyebrow="Length" title={lengthView.n ? `${lengthView.n} length reading(s)` : 'No length readings yet'} />
              <div className="gl-row gl-row--tight" style={{ marginBottom: 8 }}>
                {lengthView.change !== null ? (
                  <Chip tone={lengthView.change < 0 ? 'limited' : lengthView.change > 0 ? 'moderate' : 'info'}>
                    {lengthView.change > 0 ? '+' : ''}
                    {lengthView.change} cm
                  </Chip>
                ) : null}
                {lengthView.cuts.length ? <Chip tone="info">{lengthView.cuts.length} cut(s) inside the span</Chip> : null}
                {lengthView.fitted.usable ? <Chip>{lengthView.fitted.direction}</Chip> : null}
              </div>
              <p className="gl-small" style={{ margin: 0 }}>
                {lengthView.sentence}
              </p>
              {lengthView.first && lengthView.latest ? (
                <p className="gl-tech gl-faint" style={{ margin: '8px 0 0' }}>
                  {lengthView.first.cm} cm on {lengthView.first.on} → {lengthView.latest.cm} cm on {lengthView.latest.on} ·{' '}
                  {lengthView.spanDays} days apart · every one of those numbers typed by you or your stylist
                </p>
              ) : null}
              <p className="gl-small gl-muted" style={{ marginTop: 10 }}>
                Retention is not the same as growth: a length that never rises can mean slow growth, or it means the ends are going
                as fast as the roots. This page cannot tell those apart — it only shows the two columns you filled in.
              </p>
              <div style={{ marginTop: 12 }}>
                <Button size="sm" variant="ghost" onClick={() => setDraft({ kind: 'cut' })}>
                  <Plus size={13} /> Record a cut or a length
                </Button>
              </div>
            </Card>
          </div>
          <p className="gl-note" style={{ marginTop: 12 }}>
            {SHED_LIMIT_NOTE}
          </p>
        </Section>

        <Section eyebrow="Ledger" title="Spend, exactly as you entered it">
          {spendByKind.length ? (
            <div className="gl-split">
              <Card variant="default">
                <CardHead eyebrow="By kind" title="Money you recorded" />
                <DistributionBars rows={spendByKind.map((s) => ({ label: s.label, value: s.value }))} />
                <div className="gl-tech" style={{ marginTop: 10 }}>
                  Total {fmtMoney(costTotal)} across {liveRecords.filter((r) => r.cost !== null && r.cost !== undefined).length} priced event(s). Blanks stay blank.
                </div>
              </Card>
              <Card variant="default">
                <CardHead eyebrow="Providers" title="Who did the work" />
                {providers.some((p) => liveRecords.some((r) => r.professionalId === p.id)) ? (
                  <IndexList>
                    {providers.map((p, i) => {
                      const mine = liveRecords.filter((r) => r.professionalId === p.id);
                      return mine.length ? (
                        <IndexRow
                          key={p.id}
                          no={i + 1}
                          title={p.name}
                          sub={`${p.discipline || 'provider'} · ${mine.length} record(s)`}
                          right={<Chip>{fmtMoney(mine.reduce((s, r) => s + Number(r.cost ?? 0), 0))}</Chip>}
                          onClick={() => setQ(p.name)}
                        />
                      ) : null;
                    })}
                  </IndexList>
                ) : (
                  <EmptyState title="No provider attached" body="Add providers in Services, then attribute cuts, colour and retwists to them." />
                )}
                <Link className="gl-btn gl-btn--sm gl-btn--ghost" to="/services" style={{ marginTop: 10 }}>Open Services</Link>
              </Card>
            </div>
          ) : (
            <EmptyState title="No costs entered" body="Cost is optional on every record. Where you did enter it, these totals come from those numbers only." />
          )}
        </Section>

        {trashed.length ? (
          <Section eyebrow="Recoverable" title="Soft-deleted records">
            <IndexList>
              {trashed.map((r, i) => (
                <IndexRow
                  key={r.id}
                  no={i + 1}
                  title={r.label || 'Untitled'}
                  sub={`${String(r.kind)} · ${formatDate(String(r.doneOn))}`}
                  right={
                    <span className="gl-row gl-row--tight">
                      <IconButton
                        label="Restore record"
                        onClick={async () => {
                          await restore(TABLES.hairRecords, r.id);
                          toast('Restored to the archive.', 'ok');
                        }}
                      >
                        <Undo2 size={13} />
                      </IconButton>
                      <IconButton
                        label="Delete permanently"
                        onClick={() =>
                          setConfirm({
                            label: `${r.label || 'Record'} — permanently`,
                            run: async () => {
                              await hardDelete(TABLES.hairRecords, r.id);
                              setConfirm(null);
                              toast('Removed from the database.', 'ok');
                            }
                          })
                        }
                      >
                        <X size={13} />
                      </IconButton>
                    </span>
                  }
                />
              ))}
            </IndexList>
          </Section>
        ) : null}
      </>
    );
  }

  /* -------------------------------------------------------------- 5 · locs */
  function LocView() {
    const installs = liveRecords.filter((r) => r.kind === 'install' || r.kind === 'take-down' || r.kind === 'retwist');
    return (
      <Section eyebrow="Part 11 · loc tracking" title="The loc ledger" description="Intervals, repairs and extension history computed from your own dated records.">
        <div className="gl-split">
          <div className="gl-stack">
            <Card accent>
              <CardHead eyebrow="Cycle" title={lastRetwist ? `Last retwist ${formatDate(String(lastRetwist.doneOn))}` : 'No retwist logged'} />
              <div className="gl-row" style={{ gap: 'var(--glow-sp-6)' }}>
                <ProgressRing value={duePct} label={dueInDays === null ? 'no data yet' : dueInDays >= 0 ? `${dueInDays} days to due date` : `${Math.abs(dueInDays)} days over`} sub={`interval ${intervalDays} days`} />
                <div className="gl-stack" style={{ gap: 10, flex: 1, minWidth: 220 }}>
                  <Stat label="Mean interval from your records" value={avgGap ? `${avgGap} days` : '—'} hint={retwistGaps.length ? `across ${retwistGaps.length} gap(s)` : 'log two retwists'} />
                  <Stat label="Locs on record" value={pd.locCount ?? 'not recorded'} hint={pd.locThickness || 'thickness not recorded'} />
                  <Stat label="Repairs logged" value={repairs.length} hint={repairByLoc.length ? `across ${repairByLoc.length} labelled loc(s)` : 'none labelled'} />
                </div>
              </div>
            </Card>

            <Card variant="default">
              <CardHead eyebrow="Timeline" title="Retwists and the interval each one created" right={<Button size="sm" onClick={() => setDraft({ kind: 'retwist' })}><Plus size={13} /> Retwist</Button>} />
              {retwists.length ? (
                <Timeline
                  items={[...retwists].reverse().map((r, i) => {
                    const idx = retwists.findIndex((x) => x.id === r.id);
                    const gap = idx > 0 ? daysBetween(String(retwists[idx - 1].doneOn), String(r.doneOn)) : null;
                    return {
                      when: formatDate(String(r.doneOn)),
                      tone: i === 0 ? ('accent' as const) : ('plain' as const),
                      title: r.label || 'Retwist',
                      body: r.detail || undefined,
                      right: <Chip>{gap ? `${gap} days since the previous` : 'first logged retwist'}</Chip>
                    };
                  })}
                />
              ) : (
                <EmptyState title="No retwists yet" body="The interval meter, the due-soon warning and the repair history all start from this list." />
              )}
            </Card>
          </div>

          <div className="gl-stack rule-col">
            <Card variant="default">
              <CardHead eyebrow="Per loc" title="Repairs by your own label" />
              {repairByLoc.length ? (
                <DistributionBars rows={repairByLoc.slice(0, 10).map(([label, value]) => ({ label: `Loc ${label}`, value }))} />
              ) : (
                <EmptyState title="No repairs labelled" body="When you log a repair, give the loc a number or label. Re-breakage in the same place is the only real signal that tension or a weak point is at work." />
              )}
            </Card>

            <Card variant="default">
              <CardHead eyebrow="Extensions" title="Install / take-down history" />
              {installs.length ? (
                <IndexList>
                  {installs.map((r, i) => (
                    <IndexRow
                      key={r.id}
                      no={i + 1}
                      title={`${String(r.kind)} — ${r.label || 'untitled'}`}
                      sub={[formatDate(String(r.doneOn)), r.cost !== null && r.cost !== undefined ? fmtMoney(Number(r.cost)) : '', asData(r).weight ? String(asData(r).weight) : ''].filter(Boolean).join(' · ')}
                      onClick={() => setDraft({ row: rowToRecord(r) })}
                    />
                  ))}
                </IndexList>
              ) : (
                <EmptyState title="Nothing installed or taken down" />
              )}
              {pd.extensionHistory ? <p className="gl-small gl-muted" style={{ marginTop: 10 }}>{pd.extensionHistory}</p> : null}
            </Card>

            <Card variant="raised">
              <CardHead eyebrow="Caution" title="Traction is a mechanical trade-off" />
              <p className="gl-small" style={{ color: 'var(--glow-plate-text)' }}>
                {pd.rootTenderness ? 'You have flagged tender roots in your profile. ' : ''}
                Pain is not a styling instruction, and this page will not tell you what your scalp is doing. What is
                documented: sustained tension at the hairline and parts can cause traction alopecia — reversible early,
                often permanent late.
              </p>
              <p className="gl-small" style={{ color: 'var(--glow-plate-text)', marginTop: 8 }}>
                If tenderness outlasts a day or two after an install, or you see bumps or thinning at the margin, that is a
                professional visit rather than a product.
              </p>
              <div className="gl-row gl-row--tight" style={{ marginTop: 12 }}>
                <EvidenceChip grade="traditional" label="Protective styling · traditional practice" />
                <Link className="gl-btn gl-btn--sm" to="/services">Find a professional</Link>
              </div>
            </Card>
          </div>
        </div>
      </Section>
    );
  }

  /* ------------------------------------------------------- 6 · maintenance */
  function ScheduleView() {
    const treatments = liveRecords.filter((r) => r.kind === 'treatment' || r.kind === 'note');
    const cadence = useMemo(() => {
      const map = new Map<string, string[]>();
      for (const r of treatments) {
        const key = String(asData(r).careType || r.label || 'note').toLowerCase();
        map.set(key, [...(map.get(key) ?? []), String(r.doneOn)]);
      }
      return [...map.entries()]
        .map(([label, dates]) => {
          const sorted = dates.sort();
          let gap = 0;
          for (let i = 1; i < sorted.length; i += 1) gap += daysBetween(sorted[i - 1], sorted[i]);
          const avg = sorted.length > 1 ? Math.round(gap / (sorted.length - 1)) : null;
          const last = sorted[sorted.length - 1];
          return { label, count: sorted.length, gap: avg, last, overdue: avg ? Math.max(0, daysBetween(last, todayISO()) - avg) : 0 };
        })
        .sort((a, b) => b.count - a.count);
    }, [treatments]);

    return (
      <Section eyebrow="Part 11 · routines" title="Maintenance schedule" description="Routines with real steps, scheduled into the calendar table with a real recurrence rule.">
        <div className="gl-split">
          <div className="gl-stack">
            {routines.filter((r) => !r.deletedAt).length ? (
              routines
                .filter((r) => !r.deletedAt)
                .map((rt) => (
                  <Card key={rt.id}>
                    <CardHead
                      eyebrow={`${rt.timeOfDay || 'Anytime'} · ${(rt.steps as AnyRow[])?.length ?? 0} step(s)`}
                      title={rt.name}
                      right={
                        <>
                          <Button size="sm" onClick={() => setRoutineEdit(rt.id)}>Steps</Button>
                          <IconButton
                            label={`Delete ${rt.name}`}
                            onClick={() =>
                              setConfirm({
                                label: `Routine “${rt.name}”`,
                                run: async () => {
                                  await softDelete(TABLES.routines, rt.id);
                                  setConfirm(null);
                                }
                              })
                            }
                          >
                            <Trash2 size={13} />
                          </IconButton>
                        </>
                      }
                    />
                    {((rt.steps as AnyRow[]) ?? []).length ? (
                      <IndexList>
                        {[...(rt.steps as AnyRow[])]
                          .sort((a, b) => Number(a.order) - Number(b.order))
                          .map((s, i) => (
                            <IndexRow
                              key={String(s.id)}
                              no={i + 1}
                              title={s.label}
                              sub={[s.detail, s.durationMin ? `${s.durationMin} min` : '', s.skipIf ? `skip if: ${s.skipIf}` : '', products.find((p) => p.id === s.productId)?.name ?? '']
                                .filter(Boolean)
                                .join(' · ')}
                            />
                          ))}
                      </IndexList>
                    ) : (
                      <EmptyState title="No steps yet" body="Open Steps and add the order your hands actually follow." />
                    )}
                    <RoutineScheduling rt={rt} />
                  </Card>
                ))
            ) : (
              <EmptyPlate
                kicker="No routine yet"
                title="Build the maintenance rhythm"
                body="A loc refresh, a wash day, a nightly satin wrap — each becomes a row with ordered steps you can reorder and schedule."
                action={
                  <Button
                    variant="primary"
                    onClick={async () => {
                      const id = newId('rtn');
                      await saveRow(TABLES.routines, {
                        id,
                        name: 'Wash & deep condition',
                        domain: 'hair',
                        timeOfDay: 'Weekend',
                        active: true,
                        steps: [{ id: newId('stp'), order: 1, label: 'Pre-poo oil', detail: '', productId: null, durationMin: 15, skipIf: '' }],
                        tags: ['hair']
                      });
                      setRoutineEdit(id);
                      toast('Routine created — set your steps.', 'ok');
                    }}
                  >
                    <Plus size={14} /> New routine
                  </Button>
                }
              />
            )}
            {routines.filter((r) => !r.deletedAt).length ? (
              <Button
                variant="ghost"
                onClick={async () => {
                  const id = newId('rtn');
                  await saveRow(TABLES.routines, { id, name: 'Untitled routine', domain: 'hair', timeOfDay: 'Evening', active: true, steps: [], tags: ['hair'] });
                  setRoutineEdit(id);
                }}
              >
                <Plus size={14} /> Another routine
              </Button>
            ) : null}
          </div>

          <div className="gl-stack rule-col">
            <Card variant="default">
              <CardHead eyebrow="Cadence" title="Wash & treatment rhythm" right={<Button size="sm" onClick={() => setDraft({ kind: 'treatment' })}>Log care</Button>} />
              {cadence.length ? (
                <div className="gl-stack" style={{ gap: 12 }}>
                  {cadence.map((c) => (
                    <div key={c.label}>
                      <div className="gl-row gl-row--between gl-small">
                        <span className="gl-muted" style={{ textTransform: 'capitalize' }}>{c.label}</span>
                        <span className="gl-tech">{c.count}× · {c.gap !== null ? `every ~${c.gap} days${c.overdue > 3 ? ` · ${c.overdue}d past` : ''}` : 'one record so far'}</span>
                      </div>
                      <Meter value={c.gap ? Math.min(100, Math.round((daysBetween(c.last, todayISO()) / c.gap) * 100)) : 12} />
                    </div>
                  ))}
                  <div className="gl-tech">Gaps are averages of your own dates. A single record cannot produce a cadence, so it says so.</div>
                </div>
              ) : (
                <EmptyState title="No wash or treatment records" body="Log care events with a care type and the cadence builds itself." />
              )}
            </Card>

            <Card variant="default">
              <CardHead eyebrow="Calendar" title="Scheduled maintenance" right={<Link className="gl-btn gl-btn--sm gl-btn--ghost" to="/calendar">Open calendar</Link>} />
              {events.filter((e) => !e.deletedAt).length ? (
                <IndexList>
                  {events
                    .filter((e) => !e.deletedAt)
                    .map((e, i) => (
                      <IndexRow
                        key={e.id}
                        no={i + 1}
                        title={e.title}
                        sub={`${new Date(Number(e.startAt)).toLocaleDateString()} · repeats ${String((e.recurrence as any)?.freq ?? 'once')}${Number((e.recurrence as any)?.interval ?? 1) > 1 ? ` every ${Number((e.recurrence as any).interval)}` : ''}`}
                        right={
                          <span className="gl-row gl-row--tight">
                            <Chip active={Boolean(e.doneOn)} onClick={() => void saveRow(TABLES.calendarEvents, { id: e.id, doneOn: e.doneOn ? null : todayISO() })}>
                              {e.doneOn ? 'done' : 'mark done'}
                            </Chip>
                            <IconButton
                              label="Remove event"
                              onClick={() =>
                                setConfirm({
                                  label: String(e.title),
                                  run: async () => {
                                    await softDelete(TABLES.calendarEvents, e.id);
                                    setConfirm(null);
                                  }
                                })
                              }
                            >
                              <Trash2 size={13} />
                            </IconButton>
                          </span>
                        }
                      />
                    ))}
                </IndexList>
              ) : (
                <EmptyState title="Nothing scheduled" body="Use “Add to calendar” on a routine to write a real recurring event row." />
              )}
            </Card>
          </div>
        </div>
      </Section>
    );
  }

  function RoutineScheduling({ rt }: { rt: AnyRow }) {
    const [freq, setFreq] = useState('weekly');
    const [interval, setIntervalN] = useState('2');
    const [start, setStart] = useState(addDays(todayISO(), 2));
    const minutes = ((rt.steps as AnyRow[]) ?? []).reduce((s, x) => s + Number(x.durationMin || 0), 0);
    return (
      <div className="hs-sched">
        <Field label="Repeat">
          <Select value={freq} onChange={setFreq} options={[{ value: 'daily', label: 'Daily' }, { value: 'weekly', label: 'Weekly' }, { value: 'monthly', label: 'Monthly' }]} />
        </Field>
        <Field label="Every">
          <TextInput type="number" value={interval} onChange={setIntervalN} />
        </Field>
        <Field label="First occurrence">
          <DateInput value={start} onChange={setStart} />
        </Field>
        <div className="gl-field">
          <span className="gl-field__label">Schedule</span>
          <Button
            size="sm"
            onClick={async () => {
              const day = new Date(`${start}T09:00:00`);
              await saveRow(TABLES.calendarEvents, {
                id: newId('cal'),
                title: `${rt.name} — ${rt.timeOfDay || 'maintenance'}`,
                kind: 'routine',
                startAt: day.getTime(),
                endAt: day.getTime() + minutes * 60000,
                recurrence: { freq: freq as 'daily' | 'weekly' | 'monthly', interval: Math.max(1, Number(interval) || 1), until: null, byweekday: [day.getDay()] },
                reminders: [1440],
                checklist: ((rt.steps as AnyRow[]) ?? []).map((s) => ({ id: String(s.id), label: String(s.label), done: false })),
                linkDomain: 'hair',
                linkId: rt.id,
                cost: null,
                doneOn: null,
                note: 'Created from the Hair Studio maintenance routine.'
              });
              toast('Recurring event written to your calendar.', 'ok');
            }}
          >
            <CalendarClock size={13} /> Add to calendar
          </Button>
        </div>
      </div>
    );
  }

  /* ----------------------------------------------------------- 7 · library */
  function LibraryView() {
    const dupCount = (key: string) => products.filter((p) => !p.deletedAt && String(p.duplicateKey) === key).length;
    return (
      <>
        <Section
          eyebrow="Part 11 · products & tools"
          title="What touches your hair"
          right={
            <Button size="sm" variant="primary" onClick={() => setPForm(blankProduct())}>
              <Plus size={13} /> Product or tool
            </Button>
          }
        >
          {products.filter((p) => !p.deletedAt).length ? (
            <div className="gl-grid gl-grid--auto">
              {products
                .filter((p) => !p.deletedAt)
                .map((p) => (
                  <Card key={p.id} variant="default" className="hs-prod">
                    <div className="gl-row gl-row--between" style={{ alignItems: 'baseline' }}>
                      <div className="gl-serif" style={{ fontSize: '1.12rem' }}>{p.name}</div>
                      <Chip>{asData(p).tool ? 'tool' : String(p.form || 'product')}</Chip>
                    </div>
                    <div className="gl-tech">{p.brand || 'brand not recorded'} · {p.sizeLabel || 'size not recorded'}</div>
                    <div className="gl-row gl-row--tight" style={{ marginTop: 8 }}>
                      <Chip>{String(p.status)}</Chip>
                      <Chip>{p.pricePaid !== null && p.pricePaid !== undefined ? fmtMoney(Number(p.pricePaid), String(p.currency || 'USD')) : 'price not recorded'}</Chip>
                      {p.openedOn ? <Chip>opened {formatDate(String(p.openedOn))}</Chip> : null}
                      {p.expiresOn ? <Chip>expires {formatDate(String(p.expiresOn))}</Chip> : null}
                      {asData(p).hairCategory ? <Chip tone="info">{String(asData(p).hairCategory)}</Chip> : null}
                      {dupCount(String(p.duplicateKey)) > 1 ? <Chip tone="weak">possible duplicate</Chip> : null}
                    </div>
                    <div style={{ marginTop: 8 }}>
                      <Rating value={Number(p.rating ?? 0)} onChange={async (v) => saveRow(TABLES.products, { id: p.id, rating: v })} />
                    </div>
                    {p.ingredients ? <p className="gl-small gl-faint" style={{ marginTop: 6 }}>{String(p.ingredients).slice(0, 150)}{String(p.ingredients).length > 150 ? '…' : ''}</p> : <p className="gl-small gl-faint">Ingredient list not pasted in.</p>}
                    <div className="gl-row gl-row--tight" style={{ marginTop: 10 }}>
                      <Button size="sm" variant="ghost" onClick={() => setPForm(rowToProduct(p))}>Edit</Button>
                      <IconButton
                        label={`Delete ${p.name}`}
                        onClick={() =>
                          setConfirm({
                            label: String(p.name),
                            run: async () => {
                              await softDelete(TABLES.products, p.id);
                              setConfirm(null);
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
              kicker="No products"
              title="Your shelf is empty"
              body="Add the shampoos, butters, gels, durags, combs and steamers you actually own — routine steps can then link to them."
              action={<Button variant="primary" onClick={() => setPForm(blankProduct())}>Add first product</Button>}
            />
          )}
        </Section>

        <Section
          eyebrow="Part 11 · hairstyle library"
          title="Styles, priced in time"
          right={
            <Button size="sm" variant="primary" onClick={() => setSForm(blankStyle())}>
              <Plus size={13} /> Style
            </Button>
          }
        >
          {hairstyles.filter((h) => !h.deletedAt).length ? (
            <div className="gl-grid gl-grid--3">
              {hairstyles
                .filter((h) => !h.deletedAt)
                .map((h) => (
                  <Card key={h.id} variant={h.tried ? 'accent' : 'default'} className="hs-style">
                    <div className="gl-row gl-row--between" style={{ alignItems: 'baseline' }}>
                      <div className="gl-serif" style={{ fontSize: '1.2rem' }}>{h.name}</div>
                      {h.protective ? <Chip>protective</Chip> : null}
                    </div>
                    <div className="gl-tech">{h.family || 'family not recorded'}</div>
                    <KvList
                      items={[
                        { k: 'Install', v: h.installMinutes ? `${h.installMinutes} min` : 'not recorded' },
                        { k: 'Take down', v: h.takeMinutes ? `${h.takeMinutes} min` : 'not recorded' },
                        { k: 'Maintain', v: h.maintenanceEveryDays ? `every ${h.maintenanceEveryDays} days` : 'not recorded' },
                        { k: 'Cost', v: h.costLabel ? String(h.costLabel) : 'not entered' },
                        { k: 'Length', v: h.lengthCm ? `${h.lengthCm} cm` : 'not recorded' }
                      ]}
                    />
                    {(h.suitableFor as string[])?.length ? (
                      <div className="gl-row gl-row--tight" style={{ marginTop: 8 }}>
                        {(h.suitableFor as string[]).map((s) => (
                          <Chip key={s}>{s}</Chip>
                        ))}
                      </div>
                    ) : null}
                    <div className="gl-row gl-row--between" style={{ marginTop: 12 }}>
                      <Toggle
                        checked={Boolean(h.tried)}
                        label="Tried this"
                        onChange={async (v) => {
                          await saveRow(TABLES.hairstyles, { id: h.id, tried: v });
                          toast(v ? 'Marked as worn.' : 'Marked as not yet tried.', 'ok');
                        }}
                      />
                      <span className="gl-row gl-row--tight">
                        <IconButton label={`Edit ${h.name}`} onClick={() => setSForm(rowToStyle(h))}><RotateCcw size={13} /></IconButton>
                        <IconButton
                          label={`Delete ${h.name}`}
                          onClick={() =>
                            setConfirm({
                              label: String(h.name),
                              run: async () => {
                                await softDelete(TABLES.hairstyles, h.id);
                                setConfirm(null);
                              }
                            })
                          }
                        >
                          <Trash2 size={13} />
                        </IconButton>
                      </span>
                    </div>
                  </Card>
                ))}
            </div>
          ) : (
            <EmptyPlate
              kicker="Library"
              title="No styles saved"
              body="Record what you wear, what it costs in minutes and what it costs you. The next retwist decision gets easier."
              action={<Button variant="primary" onClick={() => setSForm(blankStyle())}>Add a style</Button>}
            />
          )}
        </Section>

        <Section eyebrow="Part 11 · study" title="Experiments & tutorials">
          <div className="gl-split">
            <Card variant="default">
              <CardHead
                eyebrow="Self-tests"
                title="Experiments"
                right={<Button size="sm" onClick={() => setXForm(blankExperiment())}><Plus size={13} /></Button>}
              />
              {experiments.filter((x) => !x.deletedAt).length ? (
                <IndexList>
                  {experiments
                    .filter((x) => !x.deletedAt)
                    .map((x, i) => (
                      <IndexRow key={x.id} no={i + 1} title={x.name} sub={`${formatDate(String(x.startOn))} · ${(x.observations as any[])?.length ?? 0} observation(s) · ${x.decision}`} onClick={() => setXForm(rowToExperiment(x))} />
                    ))}
                </IndexList>
              ) : (
                <EmptyState
                  title="No experiments"
                  body="One variable, a baseline note, dated observations, a verdict. That is the whole method."
                  action={<Button size="sm" onClick={() => setXForm(blankExperiment())}>Start one</Button>}
                />
              )}
              <div className="gl-row gl-row--tight" style={{ marginTop: 12 }}>
                <Link className="gl-btn gl-btn--sm gl-btn--ghost" to="/experiments">Full lab</Link>
                <Link className="gl-btn gl-btn--sm gl-btn--ghost" to="/knowledge">Knowledge library</Link>
              </div>
            </Card>

            <Card variant="default">
              <CardHead eyebrow="Written guides" title="Hair tutorials" right={<Link className="gl-btn gl-btn--sm gl-btn--ghost" to="/academy">Academy</Link>} />
              {tutorials.filter((t) => !t.deletedAt).length ? (
                <IndexList>
                  {tutorials
                    .filter((t) => !t.deletedAt)
                    .map((t, i) => (
                      <IndexRow key={t.id} no={i + 1} title={t.title} sub={`${t.minutes} min · difficulty ${t.difficulty}/5${t.attempts ? ` · attempted ${t.attempts}×` : ''}`} onClick={() => setOpenTutorial(t.id)} />
                    ))}
                </IndexList>
              ) : (
                <EmptyState title="Academy not seeded yet" body="Open the Academy once and the written hair tutorials appear here." />
              )}
            </Card>
          </div>
        </Section>

        <Section eyebrow="Part 11 · photo timeline" title="The photographic archive" right={<PhotoPicker kind="progress" album="Hair Studio" label="Add photographs" withConditions onPick={(rows) => void linkMedia(rows)} />}>
          {media.length ? (
            <div className="gl-carousel hs-timeline">
              {media.map((m) => (
                <div key={m.id} className="hs-timeline__item">
                  <Pin item={m} title={m.title || formatDate(String(m.takenOn))} sub={m.conditions || 'conditions not recorded'} onOpen={() => setLightbox(media.findIndex((x) => x.id === m.id))} style={{ width: 220 }} />
                </div>
              ))}
            </div>
          ) : (
            <EmptyPlate kicker="Archive" title="No photographs stored" body="Captures stay on this device, labelled with lighting, distance and condition so future comparisons are honest." />
          )}
        </Section>
      </>
    );
  }

  /* ------------------------------------------------------------- editors */
  function RecordEditor() {
    const editing = Boolean(draft?.row);
    const f = (draft?.row as Record<string, any>) ?? blankRecord(String(draft?.kind ?? 'note'));
    const set = (k: string, v: unknown) => setDraft((p) => ({ ...(p as { row?: Record<string, any>; kind?: string }), row: { ...((p?.row as Record<string, any>) ?? blankRecord(String(p?.kind ?? 'note'))), [k]: v } }));
    const isLoc = f.kind === 'retwist' || f.kind === 'repair' || f.kind === 'install' || f.kind === 'take-down';
    const save = async () => {
      const existing = draft?.row?.id ? allRecords.find((r) => r.id === draft.row!.id) : undefined;
      const shed = f.shedCount === '' || f.shedCount === null || f.shedCount === undefined ? null : Number(f.shedCount);
      const broken =
        f.breakageCount === '' || f.breakageCount === null || f.breakageCount === undefined ? null : Number(f.breakageCount);
      const counts: Record<string, unknown> = {
        ...asData(existing),
        ...(f.careType ? { careType: f.careType } : {}),
        ...(f.locRef ? { locRef: f.locRef } : {}),
        ...(f.weight ? { weight: f.weight } : {})
      };
      /* blank means she took the figure back off the record, not that it stays stored */
      if (shed === null || Number.isNaN(shed)) delete counts.shedCount;
      else counts.shedCount = shed;
      if (broken === null || Number.isNaN(broken)) delete counts.breakageCount;
      else counts.breakageCount = broken;
      if (f.shedBasis) counts.shedBasis = String(f.shedBasis);
      else delete counts.shedBasis;
      if (String(f.variableChanged ?? '').trim()) counts.variableChanged = String(f.variableChanged).trim();
      else delete counts.variableChanged;
      await saveRow(TABLES.hairRecords, {
        id: existing?.id,
        kind: f.kind,
        doneOn: f.doneOn || todayISO(),
        label: f.label,
        detail: f.detail,
        cost: f.cost === '' || f.cost === null ? null : Number(f.cost),
        professionalId: f.professionalId || null,
        locCount: f.locCount === '' || f.locCount === null ? null : Number(f.locCount),
        locThickness: f.locThickness || '',
        lengthCm: f.lengthCm === '' || f.lengthCm === null ? null : Number(f.lengthCm),
        mediaIds: (f.mediaIds as string[]) ?? [],
        tags: (existing?.tags as string[]) ?? [],
        data: counts
      });
      setDraft(null);
      toast('Event recorded.', 'ok');
    };
    return (
      <Modal
        open
        onClose={() => setDraft(null)}
        title={editing ? 'Edit hair event' : 'New hair event'}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
            <Button variant="primary" disabled={!f.label} onClick={save}>
              <Check size={14} /> Save event
            </Button>
          </>
        }
      >
        <div className="gl-form-row">
          <Field label="Kind">
            <Select value={String(f.kind)} onChange={(v) => set('kind', v)} options={RECORD_KINDS.map((k) => ({ value: k, label: k }))} />
          </Field>
          <DateInput label="Date" value={String(f.doneOn)} onChange={(v) => set('doneOn', v)} />
          <Field label="Label">
            <TextInput value={String(f.label)} onChange={(v) => set('label', v)} placeholder="e.g. Retwist — roots only, loose parts" />
          </Field>
          <Field label="Cost you actually paid" hint="Optional. Blank stays blank in the ledger.">
            <TextInput type="number" value={f.cost ?? ''} onChange={(v) => set('cost', v)} />
          </Field>
        </div>
        <Field label="Detail">
          <TextArea value={String(f.detail ?? '')} onChange={(v) => set('detail', v)} rows={3} placeholder="Products used, tension, what you noticed, what you would change." />
        </Field>
        <div className="gl-form-row">
          <Field label="Professional">
            <Select value={String(f.professionalId ?? '')} onChange={(v) => set('professionalId', v)} options={providers.map((p) => ({ value: p.id, label: p.name }))} placeholder="Done by me / not attributed" />
          </Field>
          <Field label="Length at this event (cm)">
            <TextInput type="number" value={f.lengthCm ?? ''} onChange={(v) => set('lengthCm', v)} />
          </Field>
          <Field label="Care type" hint="Powers the wash & treatment cadence">
            <Select value={String(f.careType ?? '')} onChange={(v) => set('careType', v)} options={CARE_TYPES.map((c) => ({ value: c, label: c }))} placeholder="—" />
          </Field>
        </div>
        <div className="gl-form-row">
          <Field label="Hairs shed" hint="Drain plus brush, counted — the lesson’s “one wash” number. Blank means not counted.">
            <TextInput type="number" value={f.shedCount ?? ''} onChange={(v) => set('shedCount', v)} />
          </Field>
          <Field label="Counted over" hint="The divisor. A count without its window is not a number the app can compare.">
            <Select
              value={String(f.shedBasis ?? '')}
              onChange={(v) => set('shedBasis', v)}
              options={SHED_BASES.map((b) => ({ value: b.key, label: b.label }))}
              placeholder="—"
            />
          </Field>
          <Field label="Hairs broken" hint="Snapped mid-length, in the same window — a different thing from hairs shed at the root.">
            <TextInput type="number" value={f.breakageCount ?? ''} onChange={(v) => set('breakageCount', v)} />
          </Field>
          <Field label="The one variable changed" hint="What the lesson asks for: the single thing different since the last count.">
            <TextInput value={String(f.variableChanged ?? '')} onChange={(v) => set('variableChanged', v)} placeholder="e.g. started the new shampoo" />
          </Field>
        </div>
        {isLoc ? (
          <div className="gl-form-row">
            <Field label="Loc count">
              <TextInput type="number" value={f.locCount ?? ''} onChange={(v) => set('locCount', v)} />
            </Field>
            <Field label="Loc thickness">
              <Select value={String(f.locThickness ?? '')} onChange={(v) => set('locThickness', v)} options={LOC_THICKNESS.map((c) => ({ value: c, label: c }))} placeholder="—" />
            </Field>
            <Field label="Loc reference" hint="Number or label of the loc repaired">
              <TextInput value={String(f.locRef ?? '')} onChange={(v) => set('locRef', v)} placeholder="e.g. #34 back-left" />
            </Field>
            <Field label="Extension weight" hint="Only meaningful for installs">
              <TextInput value={String(f.weight ?? '')} onChange={(v) => set('weight', v)} placeholder="e.g. 2 bundles, braided-in 8in" />
            </Field>
          </div>
        ) : null}
        <Field label="Photographs">
          <div className="gl-row gl-row--tight">
            {((f.mediaIds as string[]) ?? []).length === 0 && !media.length ? <span className="gl-small gl-faint">No photographs in the archive yet.</span> : null}
            {media.map((m) => {
              const ids = (f.mediaIds as string[]) ?? [];
              const on = ids.includes(m.id);
              return (
                <Chip
                  key={m.id}
                  active={on}
                  title={formatDate(String(m.takenOn))}
                  onClick={() => set('mediaIds', on ? ids.filter((x) => x !== m.id) : [...ids, m.id])}
                >
                  {m.title || formatDate(String(m.takenOn))}
                </Chip>
              );
            })}
          </div>
        </Field>
        <div style={{ marginTop: 'var(--glow-sp-3)' }}>
          <PhotoPicker
            kind="progress"
            album="Hair Studio"
            label="Capture & attach"
            withConditions
            onPick={async (rows) => {
              await linkMedia(rows, draft?.row?.id ? [draft.row.id] : []);
              set('mediaIds', [...((f.mediaIds as string[]) ?? []), ...rows.map((x) => x.id)]);
            }}
          />
        </div>
      </Modal>
    );
  }

  function ProductEditor() {
    const draftP = pForm ?? {};
    const set = (k: string, v: unknown) => setPForm((p) => ({ ...(p as Record<string, any>), [k]: v }));
    return (
      <Modal
        open
        onClose={() => setPForm(null)}
        title={draftP.id ? 'Edit product or tool' : 'New product or tool'}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setPForm(null)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!draftP.name}
              onClick={async () => {
                const existing = draftP.id ? products.find((x) => x.id === draftP.id) : undefined;
                await saveRow(TABLES.products, {
                  id: draftP.id || newId('prd'),
                  name: draftP.name,
                  category: 'hair',
                  brand: draftP.brand || '',
                  form: draftP.form || '',
                  sizeLabel: draftP.sizeLabel || '',
                  pricePaid: draftP.pricePaid === '' || draftP.pricePaid === null ? null : Number(draftP.pricePaid),
                  currency: draftP.currency || '',
                  owned: Boolean(draftP.owned),
                  openedOn: draftP.openedOn || null,
                  expiresOn: draftP.expiresOn || null,
                  finishedOn: draftP.finishedOn || null,
                  rating: Number(draftP.rating) || 0,
                  ingredients: draftP.ingredients || '',
                  sourceUrl: draftP.sourceUrl || '',
                  status: draftP.status,
                  duplicateKey: `${String(draftP.brand).toLowerCase()}::${String(draftP.name).toLowerCase()}`,
                  tags: draftP.useFor ?? [],
                  data: { ...asData(existing), tool: Boolean(draftP.tool), hairCategory: draftP.hairCategory || '' }
                });
                setPForm(null);
                toast('Product saved.', 'ok');
              }}
            >
              Save
            </Button>
          </>
        }
      >
        <div className="gl-form-row">
          <Field label="Name"><TextInput value={draftP.name} onChange={(v) => set('name', v)} /></Field>
          <Field label="Brand"><TextInput value={draftP.brand} onChange={(v) => set('brand', v)} /></Field>
          <Field label="Form / type"><TextInput value={draftP.form} onChange={(v) => set('form', v)} placeholder="Butter, gel, wide-tooth comb…" /></Field>
          <Field label="Size"><TextInput value={draftP.sizeLabel} onChange={(v) => set('sizeLabel', v)} placeholder="250ml, 1 pair…" /></Field>
          <Field label="Price paid (yours)"><TextInput type="number" value={draftP.pricePaid} onChange={(v) => set('pricePaid', v)} /></Field>
          <Field label="Currency"><TextInput value={draftP.currency} onChange={(v) => set('currency', v)} placeholder="GBP, USD…" /></Field>
          <Field label="Hair use">
            <Select value={String(draftP.hairCategory ?? '')} onChange={(v) => set('hairCategory', v)} options={CARE_TYPES.map((c) => ({ value: c, label: c }))} placeholder="—" />
          </Field>
          <Field label="Status">
            <Select value={String(draftP.status)} onChange={(v) => set('status', v)} options={OWNERSHIP.map((s) => ({ value: s, label: s }))} />
          </Field>
        </div>
        <div className="gl-form-row">
          <DateInput label="Opened" value={String(draftP.openedOn ?? '')} onChange={(v) => set('openedOn', v)} />
          <DateInput label="Expires / PAO end" value={String(draftP.expiresOn ?? '')} onChange={(v) => set('expiresOn', v)} />
          <DateInput label="Finished" value={String(draftP.finishedOn ?? '')} onChange={(v) => set('finishedOn', v)} />
          <Field label="Your rating"><Rating value={Number(draftP.rating)} onChange={(v) => set('rating', v)} /></Field>
        </div>
        <Field label="Ingredients (paste the real label)"><TextArea value={String(draftP.ingredients ?? '')} onChange={(v) => set('ingredients', v)} rows={3} /></Field>
        <div className="gl-form-row">
          <Field label="Source link you used" hint="The lab fetches nothing — this is a note of where you looked.">
            <TextInput value={String(draftP.sourceUrl ?? '')} onChange={(v) => set('sourceUrl', v)} />
          </Field>
          <Field label="Use for"><TagInput values={(draftP.useFor as string[]) ?? []} onChange={(v) => set('useFor', v)} placeholder="retwist, sealing, scalp…" /></Field>
          <Field label="Tool rather than product"><Toggle checked={Boolean(draftP.tool)} onChange={(v) => set('tool', v)} label="Tool" /></Field>
          <Field label="Currently owned"><Toggle checked={Boolean(draftP.owned)} onChange={(v) => set('owned', v)} label="On my shelf" /></Field>
        </div>
      </Modal>
    );
  }

  function StyleEditor() {
    const draftS = sForm ?? {};
    const set = (k: string, v: unknown) => setSForm((p) => ({ ...(p as Record<string, any>), [k]: v }));
    return (
      <Modal
        open
        onClose={() => setSForm(null)}
        title={draftS.id ? 'Edit style' : 'New hairstyle entry'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setSForm(null)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!draftS.name}
              onClick={async () => {
                await saveRow(TABLES.hairstyles, {
                  id: draftS.id || newId('sty'),
                  name: draftS.name,
                  family: draftS.family || '',
                  lengthCm: draftS.lengthCm === '' || draftS.lengthCm === null ? null : Number(draftS.lengthCm),
                  protective: Boolean(draftS.protective),
                  installMinutes: Number(draftS.installMinutes) || 0,
                  takeMinutes: Number(draftS.takeMinutes) || 0,
                  costLabel: draftS.costLabel || '',
                  maintenanceEveryDays: Number(draftS.maintenanceEveryDays) || 0,
                  suitableFor: draftS.suitableFor ?? [],
                  mediaIds: draftS.mediaIds ?? [],
                  tried: Boolean(draftS.tried)
                });
                setSForm(null);
                toast('Style saved.', 'ok');
              }}
            >
              Save
            </Button>
          </>
        }
      >
        <div className="gl-form-row">
          <Field label="Name"><TextInput value={draftS.name} onChange={(v) => set('name', v)} /></Field>
          <Field label="Family"><TextInput value={draftS.family} onChange={(v) => set('family', v)} placeholder="Locs, braids, twist-out, wig…" /></Field>
          <Field label="Install minutes"><TextInput type="number" value={draftS.installMinutes} onChange={(v) => set('installMinutes', v)} /></Field>
          <Field label="Take-down minutes"><TextInput type="number" value={draftS.takeMinutes} onChange={(v) => set('takeMinutes', v)} /></Field>
          <Field label="Maintenance every (days)"><TextInput type="number" value={draftS.maintenanceEveryDays} onChange={(v) => set('maintenanceEveryDays', v)} /></Field>
          <Field label="Length (cm)"><TextInput type="number" value={draftS.lengthCm} onChange={(v) => set('lengthCm', v)} /></Field>
        </div>
        <Field label="What it cost you" hint="Type it as it happened — a number, a range, a trade. Nothing is invented here.">
          <TextInput value={String(draftS.costLabel ?? '')} onChange={(v) => set('costLabel', v)} placeholder="e.g. £60 + 4 hours" />
        </Field>
        <Field label="Suitable for"><TagInput values={(draftS.suitableFor as string[]) ?? []} onChange={(v) => set('suitableFor', v)} placeholder="gym weeks, heat, protective months…" /></Field>
        <div className="gl-form-row">
          <Field label="Counts as protective"><Toggle checked={Boolean(draftS.protective)} onChange={(v) => set('protective', v)} label="Protective" /></Field>
          <Field label="I have worn it"><Toggle checked={Boolean(draftS.tried)} onChange={(v) => set('tried', v)} label="Tried" /></Field>
        </div>
        <Field label="Photographs of this style">
          <div className="gl-row gl-row--tight">
            {media.map((m) => {
              const ids = (draftS.mediaIds as string[]) ?? [];
              const on = ids.includes(m.id);
              return (
                <Chip key={m.id} active={on} onClick={() => set('mediaIds', on ? ids.filter((x) => x !== m.id) : [...ids, m.id])}>
                  {m.title || formatDate(String(m.takenOn))}
                </Chip>
              );
            })}
            {!media.length ? <span className="gl-small gl-faint">Upload hair photographs to attach them to a style.</span> : null}
          </div>
        </Field>
      </Modal>
    );
  }

  function ExperimentEditor() {
    const draftX = xForm ?? {};
    const set = (k: string, v: unknown) => setXForm((p) => ({ ...(p as Record<string, any>), [k]: v }));
    return (
      <Modal
        open
        onClose={() => setXForm(null)}
        title={draftX.id ? 'Experiment' : 'New experiment'}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setXForm(null)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!draftX.name}
              onClick={async () => {
                const existing = draftX.id ? experiments.find((x) => x.id === draftX.id) : undefined;
                await saveRow(TABLES.experiments, {
                  id: draftX.id || newId('exp'),
                  name: draftX.name,
                  category: 'hair',
                  aim: draftX.aim || '',
                  startOn: draftX.startOn || todayISO(),
                  endOn: draftX.endOn || '',
                  baseline: draftX.baseline || '',
                  baselineMediaIds: (existing?.baselineMediaIds as string[]) ?? [],
                  techniqueIds: draftX.techniqueIds ?? [],
                  productIds: draftX.productIds ?? [],
                  protocol: draftX.protocol || '',
                  observations: draftX.observations ?? [],
                  result: draftX.result || '',
                  resultMediaIds: (existing?.resultMediaIds as string[]) ?? [],
                  rating: Number(draftX.rating) || 0,
                  decision: draftX.decision,
                  confounders: draftX.confounders || ''
                });
                setXForm(null);
                toast('Experiment saved.', 'ok');
              }}
            >
              Save
            </Button>
          </>
        }
      >
        <div className="gl-form-row">
          <Field label="Name"><TextInput value={draftX.name} onChange={(v) => set('name', v)} placeholder="Rosemary oil on the hairline, 12 weeks" /></Field>
          <Field label="Question it answers"><TextInput value={String(draftX.aim ?? '')} onChange={(v) => set('aim', v)} /></Field>
          <DateInput label="Start" value={String(draftX.startOn)} onChange={(v) => set('startOn', v)} />
          <DateInput label="Planned end" value={String(draftX.endOn ?? '')} onChange={(v) => set('endOn', v)} />
        </div>
        <Field label="Baseline — what it looks like before"><TextArea value={String(draftX.baseline ?? '')} onChange={(v) => set('baseline', v)} rows={2} /></Field>
        <Field label="Protocol"><TextArea value={String(draftX.protocol ?? '')} onChange={(v) => set('protocol', v)} rows={2} /></Field>
        <Field label="Confounders to remember"><TextInput value={String(draftX.confounders ?? '')} onChange={(v) => set('confounders', v)} placeholder="New season, post-partum, medication, bigger trim" /></Field>
        <div className="gl-form-row">
          <Field label="Products in play">
            <div className="gl-row gl-row--tight">
              {products.filter((p) => !p.deletedAt).map((p) => {
                const ids = (draftX.productIds as string[]) ?? [];
                return (
                  <Chip key={p.id} active={ids.includes(p.id)} onClick={() => set('productIds', ids.includes(p.id) ? ids.filter((x) => x !== p.id) : [...ids, p.id])}>
                    {p.name}
                  </Chip>
                );
              })}
              {!products.length ? <span className="gl-small gl-faint">Add products first.</span> : null}
            </div>
          </Field>
          <Field label="Techniques referenced">
            <div className="gl-row gl-row--tight">
              {techniques.map((t) => {
                const ids = (draftX.techniqueIds as string[]) ?? [];
                return (
                  <Chip key={t.id} active={ids.includes(t.id)} title={String(t.evidence)} onClick={() => set('techniqueIds', ids.includes(t.id) ? ids.filter((x) => x !== t.id) : [...ids, t.id])}>
                    {String(t.title).slice(0, 26)}
                  </Chip>
                );
              })}
              {!techniques.length ? <span className="gl-small gl-faint">Evidence library not seeded yet.</span> : null}
            </div>
          </Field>
        </div>

        <CardHead eyebrow="Dated observations" title="Log as you go" />
        <div className="gl-stack" style={{ gap: 8 }}>
          {((draftX.observations as any[]) ?? []).map((o, i) => (
            <div key={i} className="gl-inset hs-obs">
              <div className="gl-row gl-row--between">
                <span className="gl-tech">{formatDate(String(o.on))}</span>
                <IconButton label="Remove observation" onClick={() => set('observations', (draftX.observations as any[]).filter((_, j) => j !== i))}>
                  <Trash2 size={13} />
                </IconButton>
              </div>
              <div className="gl-small">{String(o.note)}</div>
              {o.rating !== null && o.rating !== undefined ? <Rating value={Number(o.rating)} /> : null}
            </div>
          ))}
          {!(draftX.observations as any[])?.length ? <p className="gl-small gl-faint">Nothing observed yet.</p> : null}
        </div>
        <div className="gl-form-row" style={{ marginTop: 'var(--glow-sp-3)' }}>
          <DateInput label="Observation date" value={String(draftX.obsOn ?? todayISO())} onChange={(v) => set('obsOn', v)} />
          <Field label="Note"><TextInput value={String(draftX.obsNote ?? '')} onChange={(v) => set('obsNote', v)} placeholder="Week 4 — less shedding on the pillow" /></Field>
          <Field label="Feeling 0–5"><Range value={Number(draftX.obsRating ?? 3)} min={0} max={5} onChange={(v) => set('obsRating', v)} /></Field>
          <div className="gl-field">
            <span className="gl-field__label">Add</span>
            <Button
              size="sm"
              onClick={() => {
                set('observations', [...((draftX.observations as any[]) ?? []), { on: draftX.obsOn ?? todayISO(), note: draftX.obsNote ?? '', mediaIds: [], rating: Number(draftX.obsRating ?? 3) }]);
                set('obsNote', '');
              }}
            >
              <Plus size={13} /> Observation
            </Button>
          </div>
        </div>
        <div className="gl-form-row">
          <Field label="Result"><TextArea value={String(draftX.result ?? '')} onChange={(v) => set('result', v)} rows={2} /></Field>
          <Field label="Decision">
            <Select value={String(draftX.decision)} onChange={(v) => set('decision', v)} options={[{ value: 'open', label: 'still running' }, { value: 'repeat', label: 'keep doing it' }, { value: 'stop', label: 'stop' }, { value: 'extend', label: 'extend the run' }]} />
          </Field>
          <Field label="Verdict rating"><Rating value={Number(draftX.rating)} onChange={(v) => set('rating', v)} /></Field>
        </div>
      </Modal>
    );
  }

  function RoutineEditor() {
    const rt = routines.find((r) => r.id === routineEdit);
    const steps = [...(((rt?.steps as AnyRow[]) ?? []) as AnyRow[])].sort((a, b) => Number(a.order) - Number(b.order));
    const persist = async (next: Record<string, any>[]) => {
      if (!rt) return;
      await saveRow(TABLES.routines, { id: rt.id, steps: next.map((s, i) => ({ ...s, order: i + 1 })) });
    };
    const move = async (i: number, dir: -1 | 1) => {
      const j = i + dir;
      if (j < 0 || j >= steps.length) return;
      const next = [...steps];
      [next[i], next[j]] = [next[j], next[i]];
      await persist(next);
    };
    return (
      <Modal
        open
        onClose={() => setRoutineEdit(null)}
        title={`Steps — ${rt?.name ?? 'routine'}`}
        wide
        footer={
          <>
            <Button
              variant="danger"
              onClick={() =>
                setConfirm({
                  label: `Routine “${rt?.name ?? ''}”`,
                  run: async () => {
                    if (rt) await softDelete(TABLES.routines, rt.id);
                    setConfirm(null);
                    setRoutineEdit(null);
                  }
                })
              }
            >
              <Trash2 size={14} /> Delete routine
            </Button>
            <Button variant="primary" onClick={() => setRoutineEdit(null)}>Done</Button>
          </>
        }
      >
        <div className="gl-stack" style={{ gap: 10 }}>
          {steps.map((s, i) => (
            <div key={String(s.id)} className="gl-inset hs-step">
              <div className="gl-row gl-row--between">
                <div className="gl-serif" style={{ fontSize: '1.05rem' }}>{i + 1}. {String(s.label) || 'Untitled step'}</div>
                <div className="gl-row gl-row--tight">
                  <IconButton label="Move up" onClick={() => move(i, -1)}><ArrowUp size={13} /></IconButton>
                  <IconButton label="Move down" onClick={() => move(i, 1)}><ArrowDown size={13} /></IconButton>
                  <IconButton label="Remove step" onClick={() => persist(steps.filter((x) => x.id !== s.id))}><Trash2 size={13} /></IconButton>
                </div>
              </div>
              <div className="gl-small gl-muted">{String(s.detail || 'no detail')}{s.durationMin ? ` · ${s.durationMin} min` : ''}</div>
              <div className="gl-row gl-row--tight" style={{ marginTop: 8 }}>
                <Chip>{products.find((p) => p.id === s.productId)?.name ?? 'no product linked'}</Chip>
                {s.skipIf ? <Chip tone="info">skip if: {String(s.skipIf)}</Chip> : null}
              </div>
            </div>
          ))}
          {!steps.length ? <EmptyState title="No steps yet" body="Add the first one below — order matters and is saved." /> : null}
        </div>
        <div style={{ height: 14 }} />
        <CardHead eyebrow="Add a step" title="Ordered, linked, skippable" />
        <NewStep
          products={products.filter((p) => !p.deletedAt)}
          onAdd={async (step) => {
            await persist([...steps, { id: newId('stp'), order: steps.length + 1, ...step }]);
          }}
        />
      </Modal>
    );
  }

  function NewStep({ products: opts, onAdd }: { products: AnyRow[]; onAdd: (s: { label: string; detail: string; productId: string | null; durationMin: number; skipIf: string }) => void }) {
    const [s, setS] = useState({ label: '', detail: '', productId: '', durationMin: '5', skipIf: '' });
    return (
      <div className="gl-form-row">
        <Field label="Step"><TextInput value={s.label} onChange={(v) => setS({ ...s, label: v })} placeholder="Detangle in sections" /></Field>
        <Field label="Detail"><TextInput value={s.detail} onChange={(v) => setS({ ...s, detail: v })} /></Field>
        <Field label="Product">
          <Select value={s.productId} onChange={(v) => setS({ ...s, productId: v })} options={opts.map((p) => ({ value: p.id, label: p.name }))} placeholder="None" />
        </Field>
        <Field label="Minutes"><TextInput type="number" value={s.durationMin} onChange={(v) => setS({ ...s, durationMin: v })} /></Field>
        <Field label="Skip if"><TextInput value={s.skipIf} onChange={(v) => setS({ ...s, skipIf: v })} /></Field>
        <div className="gl-field">
          <span className="gl-field__label">Add</span>
          <Button
            size="sm"
            variant="primary"
            disabled={!s.label}
            onClick={() => {
              onAdd({ label: s.label, detail: s.detail, productId: s.productId || null, durationMin: Number(s.durationMin) || 0, skipIf: s.skipIf });
              setS({ label: '', detail: '', productId: '', durationMin: '5', skipIf: '' });
            }}
          >
            <Plus size={13} /> Step
          </Button>
        </div>
      </div>
    );
  }

  function TutorialViewer() {
    const t = tutorials.find((x) => x.id === openTutorial);
    if (!t) return null;
    return (
      <Modal
        open
        onClose={() => setOpenTutorial(null)}
        title={t.title}
        wide
        footer={
          <>
            <span className="gl-tech">
              {t.attempts ? `attempted ${t.attempts}×` : 'not attempted yet'}
              {t.completedOn ? ` · last completed ${formatDate(String(t.completedOn))}` : ''}
            </span>
            <div className="gl-row gl-row--tight">
              <Button
                variant="ghost"
                onClick={async () => {
                  await saveRow(TABLES.tutorials, { id: t.id, favorite: !t.favorite });
                  toast(t.favorite ? 'Removed from favourites.' : 'Saved to favourites.', 'ok');
                }}
              >
                <Sparkles size={14} /> {t.favorite ? 'Unfavourite' : 'Favourite'}
              </Button>
              <Button
                variant="primary"
                onClick={async () => {
                  await saveRow(TABLES.tutorials, { id: t.id, attempts: Number(t.attempts ?? 0) + 1, completedOn: todayISO() });
                  toast('Attempt logged against your own records.', 'ok');
                }}
              >
                <Check size={14} /> I did this
              </Button>
            </div>
          </>
        }
      >
        <p className="gl-lead">{t.summary}</p>
        <div className="gl-row gl-row--tight" style={{ margin: 'var(--glow-sp-3) 0' }}>
          <Chip>{t.minutes} min</Chip>
          <Chip>difficulty {t.difficulty}/5</Chip>
          <Link className="gl-btn gl-btn--sm gl-btn--ghost" to="/academy">Full Academy</Link>
        </div>
        <CardHead eyebrow="Materials" title="What you need" />
        <div className="gl-row gl-row--tight" style={{ marginBottom: 'var(--glow-sp-4)' }}>
          {(t.materials as AnyRow[])?.length ? (
            (t.materials as AnyRow[]).map((m, i) => (
              <Chip key={i}>{m.label}{m.optional ? ' (optional)' : ''}</Chip>
            ))
          ) : (
            <span className="gl-small gl-faint">None listed.</span>
          )}
        </div>
        <CardHead eyebrow="Method" title="Steps" />
        <IndexList>
          {(t.steps as AnyRow[]).map((s, i) => (
            <IndexRow key={String(s.id)} no={i + 1} title={s.label} sub={`${s.detail}${s.caution ? ` — caution: ${s.caution}` : ''}`} />
          ))}
        </IndexList>
        {(t.pitfalls as string[])?.length ? (
          <div style={{ marginTop: 'var(--glow-sp-4)' }}>
            <CardHead eyebrow="Where it goes wrong" title="Pitfalls" />
            <ul className="gl-list" style={{ border: 0 }}>
              {(t.pitfalls as string[]).map((p, i) => (
                <li key={i} className="gl-list__row gl-small">{p}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </Modal>
    );
  }
}
