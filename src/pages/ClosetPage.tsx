/**
 * THE GLOW LAB — Style & Digital Closet (spec Part 14).
 *
 * A wardrobe you typed in, and arithmetic over it: cost-per-wear, wear recency,
 * category counts, outfit records and packing lists. Every figure on screen is
 * `price ÷ wears`, a count, or a date difference taken from rows in IndexedDB.
 * There is no clothing recognition, no price feed and no style score here —
 * the app has never seen your clothes, only what you entered.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  CalendarRange,
  Check,
  CircleStop,
  Copy,
  Images,
  LayoutGrid,
  Package,
  Pencil,
  Play,
  Plus,
  Repeat,
  Search,
  ShieldAlert,
  ShieldOff,
  Shuffle,
  Table2,
  Trash2,
  Undo2,
  Wand2
} from 'lucide-react';
import { saveRow, useRows } from '../hooks/live';
import { formatDate, newId, softDelete, todayISO } from '../db/repo';
import { TABLES, type AnyRow, type ListItem, type TableName } from '../db/schema';
import { loadSettings, type AppSettings } from '../state/settings';
import {
  AXES,
  DEFAULT_MEDIA_DISTANCE,
  costPerWear,
  duplicatePairs,
  keeper,
  mediaLookalikes,
  pairExcluded,
  pairKey,
  similarity,
  suppressionPatches,
  wardrobeSignature,
  type WardrobeSignature
} from '../engine/duplicates';
import {
  buildQueue,
  counts,
  decide,
  nextLap,
  nextPair,
  positionOf,
  queueLine,
  queuePair,
  readLedger,
  startReview,
  stopReview,
  suppressedKeys,
  unqueued,
  writeLedger,
  type QueuePair,
  type ReviewLedger
} from '../engine/reviewQueue';
import {
  chosenIds,
  planLook,
  planWeek,
  suggestedName,
  RULE_SENTENCE,
  REPEAT_WINDOW_DAYS,
  weekDates,
  type RotationPlan,
  type SlotName,
  type WeekPlan
} from '../engine/rotation';
import {
  COVERAGE_LIMIT_SENTENCE,
  DORMANT_DAYS,
  SEASONS,
  coverageHeadline,
  coverageOf,
  isUntagged,
  tagAssist,
  tagAssistStep,
  unstatedPieces
} from '../engine/coverage';
import { colourOf, type PieceColour } from '../engine/pairing';
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
  Rating,
  SegmentedControl,
  Select,
  Swatches,
  Table,
  TagInput,
  TextArea,
  TextInput,
  Toggle,
  fmtMoney,
  useToast
} from '../ui/primitives';
import { useUndoDelete } from '../ui/undo';
import { DeptIntro, EmptyPlate, IndexList, IndexRow, KvList, StatStrip, Timeline } from '../ui/editorial';
import { ImageTile, PhotoPicker, Pin } from '../ui/media';
import { ingestImage, objectUrlFor } from '../media/store';
import { composeFitSheet, type FitSheetPiece } from '../media/fitSheet';
import '../styles/departments/closet.css';

/* ------------------------------------------------------------------ taxonomy */

const CATEGORIES: { name: string; subs: string[] }[] = [
  { name: 'Tops', subs: ['Shirt', 'Blouse', 'T-shirt', 'Tank', 'Knit top', 'Blazer-style top'] },
  { name: 'Bottoms', subs: ['Trouser', 'Jean', 'Skirt', 'Short', 'Wide-leg', 'Tailored pant'] },
  { name: 'Dresses & Sets', subs: ['Day dress', 'Evening dress', 'Co-ord set', 'Jumpsuit'] },
  { name: 'Knitwear', subs: ['Sweater', 'Cardigan', 'Vest', 'Fine gauge'] },
  { name: 'Outerwear', subs: ['Coat', 'Jacket', 'Trench', 'Puffer', 'Blazer', 'Rain layer'] },
  { name: 'Footwear', subs: ['Sneaker', 'Boot', 'Flat', 'Heel', 'Loafer', 'Sandal'] },
  { name: 'Bags', subs: ['Tote', 'Crossbody', 'Clutch', 'Backpack', 'Work bag'] },
  { name: 'Accessories', subs: ['Scarf', 'Belt', 'Hat', 'Glove', 'Jewellery', 'Eyewear', 'Socks & tights'] },
  { name: 'Activewear', subs: ['Training top', 'Legging', 'Short', 'Layer'] },
  { name: 'Sleep & Lounge', subs: ['Sleep set', 'Robe', 'Loungewear'] },
  { name: 'Special Occasion', subs: ['Formal', 'Ceremony', 'Workwear', 'Costume'] }
];

/* The season vocabulary lives in the coverage engine, so the form, the draw's
   filter and the matrix columns cannot drift apart. */
const CONDITIONS = ['New', 'Excellent', 'Good', 'Worn-in', 'Needs repair', 'Retired'];
const FITS = ['Very fitted', 'Fitted', 'True to size', 'Relaxed', 'Oversized', 'Altered'];

type SortKey = 'newest' | 'cpw' | 'leastWorn' | 'name';

/* -------------------------------------------------------------------- maths */

function parseAmount(v: string): number | null {
  const cleaned = v.replace(/[^0-9.\-]/g, '');
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Cost per wear is imported from the shared engine, so /market and /closet divide the same two numbers. */

function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  if (!y) return null;
  const then = new Date(y, m - 1, d).getTime();
  return Math.max(0, Math.round((Date.now() - then) / 86400000));
}

/** "Mon 16 Nov" — the weekday is what a planned day is actually sorted by. */
function dayLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y) return iso;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

function lastWornOf(row?: AnyRow): string | null {
  return (row?.data?.lastWornOn as string | null) ?? null;
}

function conditionOf(row?: AnyRow): string {
  return (row?.data?.condition as string) ?? 'Good';
}

function subcategoryOf(row?: AnyRow): string {
  return (row?.data?.subcategory as string) ?? '';
}

/* What the duplicate panel wrote. Absent means "never flagged", not "clean". */
function dupOf(row?: AnyRow): string {
  return (row?.data?.dupOf as string) ?? '';
}

function mergedIntoOf(row?: AnyRow): string {
  return (row?.data?.mergedInto as string) ?? '';
}

function dupNoteOf(row?: AnyRow): string {
  return (row?.data?.dupNote as string) ?? '';
}

function phashOf(row?: AnyRow): string {
  return String(((row?.data as Record<string, unknown> | undefined)?.phash ?? ''));
}

/* ---------------------------------------------------------------- form shape */

interface ItemDraft {
  id?: string;
  name: string;
  category: string;
  subcategory: string;
  brand: string;
  colors: string[];
  size: string;
  material: string;
  fit: string;
  price: string;
  boughtOn: string;
  seasons: string[];
  occasions: string[];
  wears: string;
  condition: string;
  lastWornOn: string;
  careNotes: string;
  mediaId: string | null;
  /** duplicate flags written by the panel below — carried through the form so an edit cannot erase them */
  dupFlags: Record<string, unknown>;
}

const DUP_KEYS = ['dupOf', 'dupNote', 'mergedInto', 'mergedWears', 'wearsBeforeMerge', 'dupExcluded'];

function dupFlagsOf(row?: AnyRow): Record<string, unknown> {
  const data = (row?.data ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of DUP_KEYS) if (data[k] !== undefined) out[k] = data[k];
  return out;
}

function draftFrom(row?: AnyRow): ItemDraft {
  return {
    id: row?.id,
    name: row?.name ?? '',
    category: row?.category ?? CATEGORIES[0].name,
    subcategory: subcategoryOf(row),
    brand: row?.brand ?? '',
    colors: (row?.colors as string[]) ?? [],
    size: row?.size ?? '',
    material: row?.material ?? '',
    fit: row?.fit ?? 'True to size',
    price: row?.price === null || row?.price === undefined ? '' : String(row.price),
    boughtOn: row?.boughtOn ?? todayISO(),
    seasons: (row?.seasons as string[]) ?? [],
    occasions: (row?.occasions as string[]) ?? [],
    wears: String(row?.wears ?? 0),
    condition: conditionOf(row),
    lastWornOn: lastWornOf(row) ?? '',
    careNotes: row?.careNotes ?? '',
    mediaId: (row?.mediaId as string) ?? null,
    dupFlags: dupFlagsOf(row)
  };
}

function payloadFrom(d: ItemDraft): Record<string, unknown> {
  return {
    id: d.id,
    name: d.name.trim(),
    category: d.category,
    brand: d.brand.trim(),
    colors: d.colors,
    size: d.size.trim(),
    material: d.material.trim(),
    fit: d.fit,
    price: parseAmount(d.price),
    boughtOn: d.boughtOn,
    seasons: d.seasons,
    occasions: d.occasions,
    wears: parseAmount(d.wears) ?? 0,
    mediaId: d.mediaId ?? null,
    careNotes: d.careNotes,
    tags: [...d.occasions, ...d.seasons],
    data: { subcategory: d.subcategory, condition: d.condition, lastWornOn: d.lastWornOn || null, ...d.dupFlags }
  };
}

/* ------------------------------------------------------------------ settings */

function useLocalSettings() {
  const [s, setS] = useState<AppSettings | null>(null);
  useEffect(() => {
    let live = true;
    void loadSettings().then((v) => live && setS(v));
    return () => {
      live = false;
    };
  }, []);
  return s;
}

/* ---------------------------------------------------------------------- page */

export default function ClosetPage() {
  const items = useRows(TABLES.clothingItems);
  const outfits = useRows(TABLES.outfits);
  const lists = useRows(TABLES.lists);
  const mediaRows = useRows(TABLES.mediaItems);
  const settings = useLocalSettings();
  const toast = useToast();
  const remove = useUndoDelete();
  const navigate = useNavigate();
  const currency = settings?.currency ?? 'USD';

  const [view, setView] = useState<'grid' | 'table'>('grid');
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [season, setSeason] = useState('');
  const [sort, setSort] = useState<SortKey>('newest');

  const [editing, setEditing] = useState<ItemDraft | null>(null);
  const [wearing, setWearing] = useState<AnyRow | null>(null);
  const [wearDraft, setWearDraft] = useState({ count: '1', on: todayISO(), note: '' });
  const [confirmDel, setConfirmDel] = useState<{ table: string; id: string; label: string } | null>(null);
  const [outfitEditor, setOutfitEditor] = useState<{ id?: string; name: string; occasion: string; season: string; aesthetic: string; note: string; rating: number; itemIds: string[]; mediaId: string | null } | null>(null);
  const [packEditor, setPackEditor] = useState<{ id?: string; name: string; departOn: string; returnOn: string; itemIds: string[]; extras: string[] } | null>(null);

  /* duplicate panel: the confirm step, and the note you can leave on a flag */
  const [dupAction, setDupAction] = useState<{ kind: 'merge' | 'mark'; keeperId: string; otherId: string } | null>(null);
  const [dupNote, setDupNote] = useState('');
  /**
   * The review queue's ledger — queue position, pass number and her answers —
   * in localStorage under `glowlab.dupReview.v1`. It is a UI-scoped record: it
   * decides what she is shown next, and it writes no row. The row writes are
   * the merge (through `applyDupAction`) and the suppression note.
   */
  const [reviewLedger, setReviewLedger] = useState<ReviewLedger>(() => readLedger());
  /** the queue entry a merge confirm is answering, so the walk advances only once she has applied it */
  const [mergeFollowUp, setMergeFollowUp] = useState<string | null>(null);
  /** the coverage-hole pass: the frozen piece ids for one slot, plus the ones she skipped */
  const [assist, setAssist] = useState<{ key: string; ids: string[]; skipped: string[] } | null>(null);
  const [assistSeason, setAssistSeason] = useState('');
  const [cameFrom, setCameFrom] = useState('');
  /* which outfit's fit sheet is being composed right now, so its button can say so */
  const [sheetBusy, setSheetBusy] = useState('');

  /* the rotation draw: two filters, then the plan it produced */
  const [spin, setSpin] = useState({ season: '', occasion: '', outerwear: true });
  const [plan, setPlan] = useState<RotationPlan | null>(null);

  /* bulk piece logging: the pile of photographs, and the fields shared by all of them */
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkEntries, setBulkEntries] = useState<BulkEntry[]>([]);
  const [bulkShared, setBulkShared] = useState<BulkShared>({
    category: CATEGORIES[0].name,
    subcategory: '',
    brand: '',
    size: '',
    material: '',
    fit: 'True to size',
    condition: 'Good',
    seasons: [],
    occasions: [],
    boughtOn: todayISO()
  });

  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const needle = String(searchParams.get('find') ?? '').trim();
    if (!needle) return;
    setQ(needle);
    setCameFrom(needle);
    setSearchParams({}, { replace: true });
  }, [searchParams, setSearchParams]);

  const mediaById = useMemo(() => new Map(mediaRows.map((m) => [m.id, m])), [mediaRows]);
  const itemById = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);

  /* the queue ledger is written back on every answer, so a reload resumes the
     same pair rather than the same page */
  useEffect(() => {
    writeLedger(reviewLedger);
  }, [reviewLedger]);

  /* ---- filtered + sorted view ---- */
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rows = items.filter((i) => {
      if (category && i.category !== category) return false;
      if (season && !((i.seasons as string[]) ?? []).includes(season)) return false;
      if (!needle) return true;
      const hay = [i.name, i.brand, i.category, subcategoryOf(i), ...((i.colors as string[]) ?? []), ...((i.occasions as string[]) ?? []), i.careNotes]
        .join(' ')
        .toLowerCase();
      return hay.includes(needle);
    });
    const cpw = (i: AnyRow) => costPerWear(i.price ?? null, i.wears ?? 0);
    return [...rows].sort((a, b) => {
      if (sort === 'name') return String(a.name).localeCompare(String(b.name));
      if (sort === 'leastWorn') return (a.wears ?? 0) - (b.wears ?? 0);
      if (sort === 'cpw') {
        const x = cpw(a);
        const y = cpw(b);
        if (x === null && y === null) return 0;
        if (x === null) return 1;
        if (y === null) return -1;
        return y - x;
      }
      return String(b.boughtOn ?? '').localeCompare(String(a.boughtOn ?? '')) || b.createdAt - a.createdAt;
    });
  }, [items, q, category, season, sort]);

  /* ---- aggregate figures (all arithmetic over the rows above) ---- */
  const figures = useMemo(() => {
    const priced = items.filter((i) => typeof i.price === 'number');
    const spend = priced.reduce((s, i) => s + (i.price as number), 0);
    const wornPairs = items.filter((i) => (i.wears ?? 0) > 0 && typeof i.price === 'number');
    const totalWears = items.reduce((s, i) => s + (i.wears ?? 0), 0);
    const measuredCost = wornPairs.reduce((s, i) => s + (i.price as number), 0);
    const measuredWears = wornPairs.reduce((s, i) => s + (i.wears ?? 0), 0);
    return {
      count: items.length,
      spend,
      pricedCount: priced.length,
      unpriced: items.length - priced.length,
      totalWears,
      blended: measuredWears ? measuredCost / measuredWears : null,
      blendedNote: `${fmtMoney(measuredCost, currency)} ÷ ${measuredWears} wears`,
      withPhoto: items.filter((i) => i.mediaId && mediaById.get(i.mediaId as string)).length,
      neverWorn: items.filter((i) => (i.wears ?? 0) === 0).length
    };
  }, [items, mediaById, currency]);

  /* ---- per-category counts drive the observation panel ---- */
  const byCategory = useMemo(() => {
    const map = new Map<string, { count: number; wears: number; spend: number; unworn: number }>();
    for (const c of CATEGORIES) map.set(c.name, { count: 0, wears: 0, spend: 0, unworn: 0 });
    for (const i of items) {
      const bucket = map.get(i.category) ?? { count: 0, wears: 0, spend: 0, unworn: 0 };
      bucket.count += 1;
      bucket.wears += i.wears ?? 0;
      bucket.spend += typeof i.price === 'number' ? i.price : 0;
      if ((i.wears ?? 0) === 0) bucket.unworn += 1;
      map.set(i.category, bucket);
    }
    return [...map.entries()];
  }, [items]);

  const observations = useMemo(() => {
    const notes: { head: string; body: string }[] = [];
    if (!items.length) return notes;
    const empty = byCategory.filter(([, v]) => v.count === 0).map(([k]) => k);
    if (empty.length) {
      notes.push({
        head: `Nothing logged under ${empty.slice(0, 4).join(', ')}${empty.length > 4 ? ` and ${empty.length - 4} more` : ''}.`,
        body: 'That is a statement about your records, not advice. Either you genuinely do not own these, or they are still waiting to be entered.'
      });
    }
    const top = [...byCategory].sort((a, b) => b[1].count - a[1].count)[0];
    if (top && top[1].count > 0) {
      notes.push({
        head: `${top[1].count} of ${items.length} pieces are ${top[0]}.`,
        body: `${((top[1].count / items.length) * 100).toFixed(0)}% of the wardrobe in one category — the ratio is computed from your own entries and nothing else.`
      });
    }
    if (figures.neverWorn > 0) {
      notes.push({
        head: `${figures.neverWorn} pieces have zero logged wears.`,
        body: 'Cost-per-wear is undefined for those, and this page says so instead of inventing a number. Log a wear and they enter the ledger.'
      });
    }
    if (figures.unpriced > 0) {
      notes.push({
        head: `${figures.unpriced} pieces have no acquisition cost.`,
        body: 'They are excluded from every cost figure rather than guessed at. Add a price and they join the total.'
      });
    }
    const stale = items.map((i) => ({ i, gap: daysSince(lastWornOf(i)) })).filter((x) => x.gap !== null && x.gap > 180);
    if (stale.length) {
      notes.push({
        head: `${stale.length} pieces have not been worn in over 180 days.`,
        body: 'Last-worn dates come from your wear log. Seasonal items will look like this on purpose; only you know which are seasonal.'
      });
    }
    return notes;
  }, [items, byCategory, figures.neverWorn, figures.unpriced]);

  const ledger = useMemo(
    () =>
      items
        .map((i) => ({ row: i, cpw: costPerWear(i.price ?? null, i.wears ?? 0) }))
        .filter((x) => x.cpw !== null)
        .sort((a, b) => (b.cpw as number) - (a.cpw as number))
        .slice(0, 6),
    [items]
  );

  const recentWears = useMemo(
    () =>
      items
        .filter((i) => lastWornOf(i))
        .sort((a, b) => String(lastWornOf(b)).localeCompare(String(lastWornOf(a))))
        .slice(0, 8),
    [items]
  );

  /* ---------------------------------------------------------------- duplicates */

  /**
   * The same 24-point field comparison /market runs, turned on the closet
   * against itself. It ranks pairs; it never touches a row by itself. Rows
   * carrying the `dupExcluded` note she wrote are not paired at all.
   */
  const dupPairs = useMemo(() => duplicatePairs(items), [items]);

  /**
   * Pairs ruled out in this session, before the live query has re-read the row
   * notes. `duplicatePairs` needs no help here — the note is on the rows — but
   * the photograph check compares `mediaItems` and cannot see them.
   */
  const suppressed = useMemo(() => suppressedKeys(reviewLedger), [reviewLedger]);

  const photoPairs = useMemo(() => {
    const byMedia = new Map<string, AnyRow[]>();
    for (const i of items) {
      const id = i.mediaId ? String(i.mediaId) : '';
      if (!id || !mediaById.get(id)) continue;
      byMedia.set(id, [...(byMedia.get(id) ?? []), i]);
    }
    const pool = [...byMedia.keys()].map((id) => mediaById.get(id) as AnyRow);
    const seen = new Set<string>();
    const out: { key: string; left: AnyRow; right: AnyRow; distance: number; bits: number }[] = [];
    for (const id of byMedia.keys()) {
      const row = mediaById.get(id) as AnyRow;
      const phash = phashOf(row);
      for (const hit of mediaLookalikes(pool, phash)) {
        if (hit.id === id) continue;
        for (const la of byMedia.get(id) ?? []) {
          for (const lb of byMedia.get(hit.id) ?? []) {
            if (la.id === lb.id) continue;
            const key = pairKey(la.id, lb.id);
            if (seen.has(key)) continue;
            /* she has already said these two are not duplicates */
            if (suppressed.has(key) || pairExcluded(la, lb)) continue;
            seen.add(key);
            out.push({ key, left: la, right: lb, distance: hit.distance, bits: Math.max(1, phash.length) * 4 });
          }
        }
      }
    }
    return out.sort((a, b) => a.distance - b.distance).slice(0, 12);
  }, [items, mediaById, suppressed]);

  const photoDistance = useMemo(() => new Map(photoPairs.map((p) => [p.key, p])), [photoPairs]);

  const dupStats = useMemo(() => {
    const strong = dupPairs.filter((p) => p.score >= 0.85).length;
    return {
      total: dupPairs.length,
      strong,
      possible: dupPairs.length - strong,
      flagged: items.filter((i) => dupOf(i)).length,
      merged: items.filter((i) => mergedIntoOf(i)).length,
      photos: photoPairs.length
    };
  }, [dupPairs, items, photoPairs]);

  /* ---------------------------------------------------------------- the review queue */

  /**
   * One ordered list out of the two candidate lists: every field comparison
   * that cleared the floor, then the photograph pairs the field comparison did
   * not reach. A pair is named by its two row ids, so the same two pieces
   * cannot occupy two places in the queue.
   */
  const reviewPairs = useMemo<ReviewPairView[]>(() => {
    const out: ReviewPairView[] = [];
    const seen = new Set<string>();
    for (const p of dupPairs) {
      const id = pairKey(p.a.id, p.b.id);
      if (seen.has(id) || suppressed.has(id)) continue;
      seen.add(id);
      out.push({
        id,
        pair: p,
        queue: queuePair(p.a.id, p.b.id, p.keeperId, 'fields'),
        photo: photoDistance.get(id) ?? null,
        rows: [p.a.id, p.b.id]
      });
    }
    for (const pp of photoPairs) {
      const id = pairKey(pp.left.id, pp.right.id);
      if (seen.has(id) || suppressed.has(id)) continue;
      seen.add(id);
      const a = wardrobeSignature(pp.left);
      const b = wardrobeSignature(pp.right);
      const sim = similarity(a, b);
      out.push({
        id,
        pair: { id, a, b, sim, score: sim.score, keeperId: keeper(a, b).id },
        queue: queuePair(pp.left.id, pp.right.id, keeper(a, b).id, 'photo'),
        photo: pp,
        rows: [String(pp.left.id), String(pp.right.id)]
      });
    }
    return out;
  }, [dupPairs, photoPairs, photoDistance, suppressed]);

  /**
   * The frozen walk. A merge or an edit that takes a pair below the floor
   * removes it from `reviewPairs`, and `buildQueue` drops it from the order, so
   * the queue cannot offer the same merge twice or point at a row that has
   * collapsed into another.
   */
  const queue = useMemo(
    () => buildQueue(reviewPairs.map((r) => r.queue), reviewLedger, todayISO()),
    [reviewPairs, reviewLedger]
  );
  const queueCounts = useMemo(() => counts(queue, reviewLedger), [queue, reviewLedger]);
  const currentPair = reviewLedger.open ? nextPair(queue, reviewLedger) : null;
  const currentView = currentPair ? reviewPairs.find((r) => r.id === currentPair.pairId) ?? null : null;
  const outsideQueue = useMemo(
    () => (reviewLedger.open ? unqueued(reviewPairs.map((r) => r.queue), queue) : []),
    [reviewPairs, queue, reviewLedger.open]
  );

  /**
   * The rows behind the current queue entry, read live. `buildQueue` already
   * dropped any pair whose rows collapsed, so these exist; the guard is here so a
   * stale render cannot hand `DupPairCard` an undefined row.
   */
  const reviewRows = (() => {
    if (!currentPair) return null;
    const left = itemById.get(currentPair.aId) ?? null;
    const right = itemById.get(currentPair.bId) ?? null;
    const keep = itemById.get(currentPair.keeperId) ?? null;
    const other = itemById.get(otherOf(currentPair)) ?? null;
    return left && right && keep && other ? { left, right, keep, other } : null;
  })();
  const reviewReady = Boolean(currentPair && currentView && reviewRows);

  /* ------------------------------------------------------------------ writes */

  async function saveItem(d: ItemDraft) {
    if (!d.name.trim()) {
      toast('Give the piece a name first.', 'bad');
      return;
    }
    const saved = await saveRow(TABLES.clothingItems, payloadFrom(d) as AnyRow);
    setEditing(null);
    toast(d.id ? `Updated “${saved.name}”.` : `“${saved.name}” is in the closet.`, 'ok');
  }

  /**
   * One photograph in the pile, one stored image, one closet row. The picture is
   * ingested first so the existing content-hash dedupe still applies: a file
   * already in the library is attached to its new row rather than written twice.
   */
  async function logBulk(rows: BulkEntry[], shared: BulkShared) {
    let stored = 0;
    let reused = 0;
    const failed: string[] = [];
    for (const e of rows) {
      const name = e.name.trim();
      try {
        const res = await ingestImage({ file: e.file, kind: 'upload', album: 'Closet pieces', title: name, sourceKind: 'user' });
        if (res.duplicate) reused += 1;
        await saveRow(
          TABLES.clothingItems,
          payloadFrom({
            ...draftFrom(),
            name,
            category: shared.category,
            subcategory: shared.subcategory,
            brand: shared.brand,
            size: shared.size,
            material: shared.material,
            fit: shared.fit,
            condition: shared.condition,
            seasons: shared.seasons,
            occasions: shared.occasions,
            price: e.price,
            boughtOn: shared.boughtOn,
            mediaId: String(res.row.id)
          }) as AnyRow
        );
        stored += 1;
      } catch (err: any) {
        failed.push(`“${name}” — ${err?.message ?? 'the file could not be read'}`);
      }
    }
    for (const e of rows) if (e.url) URL.revokeObjectURL(e.url);
    setBulkEntries([]);
    setBulkOpen(false);
    if (!stored) {
      toast(failed.length ? `Nothing stored: ${failed.join('; ')}` : 'Nothing was stored.', 'bad');
      return;
    }
    toast(
      `${stored} piece${stored === 1 ? '' : 's'} logged${
        reused ? ` — ${reused} photograph${reused === 1 ? '' : 's'} already in your library, re-used rather than stored twice` : ''
      }${failed.length ? `. Failed: ${failed.join('; ')}` : ''}.`,
      failed.length ? 'bad' : 'ok'
    );
  }

  async function logWear() {
    if (!wearing) return;
    const add = Math.max(1, parseAmount(wearDraft.count) ?? 1);
    await saveRow(TABLES.clothingItems, {
      id: wearing.id,
      wears: (wearing.wears ?? 0) + add,
      data: { ...(wearing.data ?? {}), lastWornOn: wearDraft.on, wearNote: wearDraft.note }
    });
    toast(`Logged ${add} wear${add > 1 ? 's' : ''} on ${formatDate(wearDraft.on)}.`, 'ok');
    setWearing(null);
    setWearDraft({ count: '1', on: todayISO(), note: '' });
  }

  async function saveOutfit() {
    if (!outfitEditor) return;
    if (!outfitEditor.name.trim() || outfitEditor.itemIds.length < 2) {
      toast('An outfit needs a name and at least two pieces.', 'bad');
      return;
    }
    await saveRow(TABLES.outfits, {
      ...(outfitEditor.id ? {} : { wornCount: 0, lastWornOn: null }),
      id: outfitEditor.id,
      name: outfitEditor.name.trim(),
      itemIds: outfitEditor.itemIds,
      occasion: outfitEditor.occasion,
      season: outfitEditor.season,
      aesthetic: outfitEditor.aesthetic,
      rating: outfitEditor.rating,
      note: outfitEditor.note,
      mediaId: outfitEditor.mediaId,
      tags: [outfitEditor.occasion, outfitEditor.season].filter(Boolean)
    });
    toast('Outfit saved against those closet items.', 'ok');
    setOutfitEditor(null);
  }

  /**
   * The outfit's own photographs, side by side, saved against the outfit. Only
   * pictures this device already holds for those pieces are drawn, so a sheet
   * cannot appear for a garment that has never been photographed. The URLs come
   * from the media store's own cache, so they are shared with the rest of the
   * app and deliberately not revoked here.
   */
  async function makeFitSheet(o: AnyRow, itemIds?: string[]) {
    const chosen = itemIds ?? ((o.itemIds as string[]) ?? []);
    const ids = chosen.map((id) => itemById.get(id)).filter(Boolean) as AnyRow[];
    const shots = ids.filter((i) => i.mediaId && mediaById.get(String(i.mediaId)));
    if (shots.length < 2) {
      toast(
        shots.length === 1
          ? 'A fit sheet needs at least two photographed pieces. This outfit has one — photograph the others from the item drawer first.'
          : 'A fit sheet needs at least two photographed pieces. None of these garments has a photograph yet.',
        'bad'
      );
      return;
    }
    setSheetBusy(String(o.id));
    try {
      const pieces: FitSheetPiece[] = [];
      for (const i of shots) {
        const media = mediaById.get(String(i.mediaId));
        const url = await objectUrlFor(media?.blobId as string, 'full');
        if (url) pieces.push({ label: String(i.name || 'piece'), url });
      }
      const blob = await composeFitSheet(pieces);
      if (!blob) {
        toast('This browser would not hand back pixels, so no sheet was made.', 'bad');
        return;
      }
      const res = await ingestImage({
        blobHint: blob,
        kind: 'outfit',
        album: 'Closet fit sheets',
        title: `${o.name} — fit sheet`,
        caption: `Composed on this device from the ${pieces.length} stored photographs of the pieces in “${o.name}”. Not a photograph of the outfit being worn.`,
        sourceKind: 'glow-lab-original',
        linkedDomain: 'closet',
        linkedIds: shots.map((i) => String(i.id))
      });
      await saveRow(TABLES.outfits, {
        id: o.id,
        itemIds: chosen,
        data: { ...(o.data ?? {}), sheetMediaId: String(res.row.id), sheetPieces: pieces.length }
      });
      toast(`Fit sheet made from ${pieces.length} of your own piece photographs, and saved against “${o.name}”.`, 'ok');
    } catch {
      toast('A stored picture could not be read, so no sheet was made.', 'bad');
    } finally {
      setSheetBusy('');
    }
  }

  async function wearOutfit(o: AnyRow) {
    await saveRow(TABLES.outfits, { id: o.id, wornCount: (o.wornCount ?? 0) + 1, lastWornOn: todayISO() });
    toast(`“${o.name}” worn today.`, 'ok');
  }

  /* ----------------------------------------------------------- rotation draw */

  /**
   * The pairing layer reads colour from two places the app already fills: the
   * swatch buckets stored when a photograph was ingested, and the colour tags she
   * typed on the garment. Nothing is recognised in the image itself.
   */
  const colourReads = useMemo(() => {
    const map = new Map<string, PieceColour>();
    for (const row of items) {
      const media = row.mediaId ? mediaById.get(String(row.mediaId)) : null;
      map.set(String(row.id), colourOf({ photograph: media?.data?.palette, typed: row.colors }));
    }
    return map;
  }, [items, mediaById]);

  function drawLook() {
    const next = planLook(
      items,
      outfits,
      {
        season: spin.season,
        occasion: spin.occasion,
        today: todayISO(),
        useOuterwear: spin.outerwear
      },
      colourReads
    );
    setPlan(next);
    const p = next.pairing;
    toast(
      next.kind === 'empty'
        ? `Read ${next.poolSize} piece${next.poolSize === 1 ? '' : 's'} and could not fill a slot — the reasons are printed under the look.`
        : p && p.readable === 0
          ? `Drawn from ${next.poolSize} piece${next.poolSize === 1 ? '' : 's'} on the idle order alone — no colour could be read from them.`
          : p
            ? `Drawn from ${next.poolSize} piece${next.poolSize === 1 ? '' : 's'}: colour read for ${p.readable} of ${p.total}${
                p.coWornPairs ? `, ${p.coWornPairs} pair${p.coWornPairs === 1 ? '' : 's'} you have worn together` : ''
              }.`
            : `Drawn from ${next.poolSize} piece${next.poolSize === 1 ? '' : 's'}, ordered by the rule below the controls.`,
      next.kind === 'empty' ? 'bad' : 'ok'
    );
  }

  function swapSlot(at: number) {
    setPlan((p) =>
      p ? { ...p, slots: p.slots.map((s, n) => (n === at && s.pieces.length ? { ...s, at: (s.at + 1) % s.pieces.length } : s)) } : p
    );
  }

  const spinOptions = () => ({ season: spin.season, occasion: spin.occasion, today: todayISO(), useOuterwear: spin.outerwear });

  /* ------------------------------------------------ coverage + planning days */

  /**
   * Coverage is a count over the same four fields the draw filters on, so it
   * stays live: add a piece and the cell moves without pressing anything.
   */
  const coverage = useMemo(() => coverageOf(items, todayISO()), [items]);
  const [week, setWeek] = useState<WeekPlan | null>(null);
  const [weekDays, setWeekDays] = useState(7);
  const [weekStart, setWeekStart] = useState(() => todayISO());
  const [pins, setPins] = useState<Record<string, Partial<Record<SlotName, string>>>>({});

  const weekOptions = () => ({
    startDate: weekStart,
    days: weekDays,
    season: spin.season,
    occasion: spin.occasion,
    useOuterwear: spin.outerwear,
    label: dayLabel
  });

  function drawWeek() {
    const start = todayISO();
    setWeekStart(start);
    const next = planWeek(items, outfits, { ...weekOptions(), startDate: start }, colourReads, pins);
    setWeek(next);
    toast(
      next.days.length
        ? `${next.days.length} of ${weekDays} days dressed from ${items.length} pieces — ${
            Object.keys(next.usedOn).length
          } committed, none of them twice.`
        : `Nothing could be dressed from ${items.length} piece${items.length === 1 ? '' : 's'} — the reasons are printed under the calendar.`,
      next.days.length ? 'ok' : 'bad'
    );
  }

  /**
   * A swap re-runs the week rather than patching the day, so the days after it
   * are drawn from the pile this pin leaves behind. That can drop a later day's
   * piece, which is the honest cost of holding one fixed.
   */
  function pinPiece(date: string, slot: SlotName, id: string) {
    const next = { ...pins, [date]: { ...(pins[date] ?? {}), [slot]: id } };
    setPins(next);
    setWeek(planWeek(items, outfits, weekOptions(), colourReads, next));
  }

  function cycleDay(day: WeekPlan['days'][number], slot: SlotName) {
    const s = day.plan.slots.find((x) => x.name === slot);
    if (!s || s.pieces.length < 2) return;
    const at = s.pieces.findIndex((p) => p.id === day.taken.find((t) => t.slot === slot)?.id);
    pinPiece(day.date, slot, s.pieces[(Math.max(0, at) + 1) % s.pieces.length].id);
  }

  /**
   * Both writes make the same row; wearing it also moves the pieces, so the next
   * draw sees them as recently worn and the set-aside rule has something to say.
   */
  async function writePlanOutfit(worn: boolean) {
    if (!plan) return;
    const ids = chosenIds(plan);
    if (ids.length < 2) {
      toast(`The draw only picked ${ids.length} piece, and an outfit row needs at least two — swap a slot or clear the season filter.`, 'bad');
      return;
    }
    const name = suggestedName(plan, spinOptions());
    await saveRow(TABLES.outfits, {
      name,
      itemIds: ids,
      occasion: spin.occasion,
      season: spin.season,
      aesthetic: '',
      note: `Drawn by the rotation rule over ${plan.poolSize} logged pieces. ${plan.rule}`,
      rating: 0,
      wornCount: worn ? 1 : 0,
      lastWornOn: worn ? todayISO() : null,
      mediaId: null,
      tags: [spin.occasion, spin.season].filter(Boolean)
    });
    if (worn) {
      for (const id of ids) {
        const row = itemById.get(id);
        if (!row) continue;
        await saveRow(TABLES.clothingItems, {
          id,
          wears: (row.wears ?? 0) + 1,
          data: { ...(row.data ?? {}), lastWornOn: todayISO() }
        });
      }
    }
    toast(
      worn
        ? `“${name}” stored and worn today: ${ids.length} piece${ids.length === 1 ? '' : 's'} each +1 wear and a last-worn date of today.`
        : `“${name}” stored as an outfit row over those ${ids.length} pieces.`,
      'ok'
    );
  }

  function editOutfit(o: AnyRow) {
    setOutfitEditor({
      id: o.id,
      name: o.name ?? '',
      occasion: o.occasion ?? '',
      season: o.season ?? '',
      aesthetic: o.aesthetic ?? '',
      note: o.note ?? '',
      rating: o.rating ?? 0,
      itemIds: (o.itemIds as string[]) ?? [],
      mediaId: (o.mediaId as string) ?? null
    });
  }

  async function savePacking() {
    if (!packEditor) return;
    if (!packEditor.name.trim()) {
      toast('Name the trip or the bag.', 'bad');
      return;
    }
    const days = packEditor.returnOn && packEditor.departOn
      ? Math.max(1, Math.round((new Date(packEditor.returnOn).getTime() - new Date(packEditor.departOn).getTime()) / 86400000))
      : null;
    const existing = packEditor.id ? lists.find((l) => l.id === packEditor.id) : undefined;
    const previous = ((existing?.items as ListItem[]) ?? []);
    const rebuilt: ListItem[] = [
      ...packEditor.itemIds.map((id) => {
        const prior = previous.find((x) => x.productId === id);
        return {
          id,
          label: id,
          productId: id,
          estPrice: null,
          quantity: 1,
          neededFor: prior?.neededFor ?? 'Packing',
          linkedMediaId: null,
          checked: Boolean(prior?.checked)
        };
      }),
      ...packEditor.extras.map((label) => ({
        id: newId('pk'),
        label,
        productId: null,
        estPrice: null,
        quantity: 1,
        neededFor: 'Packing',
        linkedMediaId: null,
        checked: false
      }))
    ];
    await saveRow(TABLES.lists, {
      id: packEditor.id,
      kind: 'shopping',
      name: packEditor.name.trim(),
      budget: null,
      period: days ? `${days} days` : '',
      items: rebuilt,
      closedOn: null,
      tags: ['packing'],
      data: { packing: 1, departOn: packEditor.departOn, returnOn: packEditor.returnOn, days }
    });
    toast('Packing list stored.', 'ok');
    setPackEditor(null);
  }

  async function togglePackItem(list: AnyRow, itemId: string) {
    const next = ((list.items as ListItem[]) ?? []).map((it) => (it.id === itemId ? { ...it, checked: !it.checked } : it));
    await saveRow(TABLES.lists, { id: list.id, items: next });
  }

  async function runDelete() {
    if (!confirmDel) return;
    await remove(confirmDel.table as TableName, confirmDel.id, confirmDel.label);
    setConfirmDel(null);
  }

  /**
   * The only two writes the duplicate panel can make, and both are reversible.
   * Neither removes a row: a flag is a note, and a merge moves wear counts
   * while storing the original number on the row it came from.
   *
   * The review queue routes its "merge" answer through here rather than around
   * it — same two `saveRow` calls, same confirm step, same undo. When the
   * answer came from the queue, the queue entry is marked after the write
   * lands, never before.
   */
  async function applyDupAction(
    action: { kind: 'merge' | 'mark'; keeperId: string; otherId: string } | null = dupAction,
    noteRaw: string = dupNote
  ): Promise<boolean> {
    if (!action) return false;
    const keep = itemById.get(action.keeperId);
    const other = itemById.get(action.otherId);
    if (!keep || !other) {
      toast('One of those rows is no longer in the closet, so nothing was changed.', 'bad');
      setDupAction(null);
      setMergeFollowUp(null);
      return false;
    }
    const note = noteRaw.trim();
    if (action.kind === 'mark') {
      await saveRow(TABLES.clothingItems, {
        id: other.id,
        data: {
          ...(other.data ?? {}),
          dupOf: keep.id,
          dupNote: note || `Possible duplicate of “${keep.name}”. Both rows are intact — this is a note, not a merge.`
        }
      });
      toast(`Flagged “${other.name}” against “${keep.name}”. Nothing was deleted or moved.`, 'ok');
    } else {
      const move = other.wears ?? 0;
      await saveRow(TABLES.clothingItems, { id: keep.id, wears: (keep.wears ?? 0) + move });
      await saveRow(TABLES.clothingItems, {
        id: other.id,
        wears: 0,
        data: {
          ...(other.data ?? {}),
          dupOf: keep.id,
          mergedInto: keep.id,
          mergedWears: move,
          wearsBeforeMerge: other.wears ?? 0,
          dupNote: note || `Wears merged into “${keep.name}”. This row keeps its price, photo and history; its original wear count is stored here.`
        }
      });
      toast(
        move
          ? `Moved ${move} wear${move === 1 ? '' : 's'} onto “${keep.name}”. “${other.name}” now reads zero and keeps its own row.`
          : `“${other.name}” had no wears to move, so this was a flag only.`,
        'ok'
      );
      if (mergeFollowUp) {
        const answered = mergeFollowUp;
        setReviewLedger((l) => decide(l, answered, 'merge', todayISO()));
        setMergeFollowUp(null);
      }
    }
    setDupAction(null);
    setDupNote('');
    return true;
  }

  /**
   * "These two are not duplicates" — the one queue answer that has to outlive
   * this tab, so it is written on her rows as a note naming the other piece and
   * `duplicatePairs` honours it from then on. It does not delete, merge or
   * reorder anything: the two rows stay exactly as they are.
   */
  async function suppressPair(pair: QueuePair) {
    const a = itemById.get(pair.aId);
    const b = itemById.get(pair.bId);
    if (!a || !b) {
      toast('One of those rows is no longer in the closet, so nothing was changed.', 'bad');
      return;
    }
    for (const patch of suppressionPatches(a, b)) {
      await saveRow(TABLES.clothingItems, patch as AnyRow);
    }
    setReviewLedger((l) => decide(l, pair.pairId, 'not-duplicates', todayISO(), pair));
    toast(
      `Kept “${a.name}” and “${b.name}” apart. A note naming the other piece is stored on both rows, so this pair stays out of the candidate list until you clear the note.`,
      'ok'
    );
  }

  /** Any of the four answers, from inside the queue. */
  function reviewDecide(verdict: 'keep-both' | 'skip' | 'not-duplicates' | 'merge') {
    if (!currentPair) return;
    if (verdict === 'merge') {
      /* the existing confirm step still stands between her and the write */
      setDupNote('');
      setMergeFollowUp(currentPair.pairId);
      setDupAction({ kind: 'merge', keeperId: currentPair.keeperId, otherId: otherOf(currentPair) });
      return;
    }
    if (verdict === 'not-duplicates') {
      void suppressPair(currentPair);
      return;
    }
    setReviewLedger((l) => decide(l, currentPair.pairId, verdict, todayISO(), currentPair));
  }

  /** Start, stop, and go round again for the pairs she deferred. */
  function beginReview() {
    setReviewLedger((l) => startReview(reviewPairs.map((r) => r.queue), l, todayISO()));
  }
  function endReview() {
    setReviewLedger((l) => stopReview(l, todayISO()));
  }
  function roundAgain() {
    setReviewLedger((l) => nextLap(l, todayISO()));
  }

  /* ------------------------------------------------ coverage-hole tagging pass */

  /**
   * Open the pass on one slot's untagged pieces. The ids freeze here, so the run
   * she is on cannot be reshuffled underneath her; a piece that already carries a
   * season is not in the list, which is what makes running it again harmless.
   */
  function openAssist(key: string) {
    const pieces = unstatedPieces(items, key);
    if (!pieces.length) return;
    setAssistSeason('');
    setAssist({ key, ids: pieces.map((p) => String(p.id)), skipped: [] });
  }

  const assistPieces = useMemo(() => {
    if (!assist) return [] as AnyRow[];
    return assist.ids
      .map((id) => itemById.get(id))
      .filter((row): row is AnyRow => row !== undefined && isUntagged(row) && !assist.skipped.includes(String(row.id)));
  }, [assist, itemById]);

  const assistCurrent = assistPieces[0] ?? null;
  const assistDone = assist ? assist.ids.length - assistPieces.length : 0;
  const assistInfo = assist ? tagAssist(items, todayISO(), assist.key) : null;

  /** One piece, one season, one row. Nothing else in the closet is written. */
  async function saveSeasonTag(row: AnyRow, season: string) {
    if (!season) return;
    const occasions = ((row.occasions as string[]) ?? []).map((o) => String(o));
    await saveRow(TABLES.clothingItems, {
      id: row.id,
      seasons: [season],
      tags: [...occasions, season]
    });
    toast(`Wrote ${season} on “${row.name}”. One row changed — every other piece kept whatever it already had.`, 'ok');
    setAssistSeason('');
  }

  function skipSeasonTag(row: AnyRow) {
    setAssist((a) => (a ? { ...a, skipped: [...new Set([...a.skipped, String(row.id)])] } : a));
    setAssistSeason('');
  }

  /* ------------------------------------------------------------------ writes */

  async function clearDupFlag(row: AnyRow) {
    await saveRow(TABLES.clothingItems, {
      id: row.id,
      data: { ...(row.data ?? {}), dupOf: null, dupNote: '', mergedInto: null, mergedWears: null, wearsBeforeMerge: null }
    });
    toast(`Cleared the duplicate flag on “${row.name}”. Wear counts untouched.`, 'ok');
  }

  async function undoMerge(row: AnyRow) {
    const target = itemById.get(mergedIntoOf(row));
    const back = Number(row.data?.wearsBeforeMerge ?? row.data?.mergedWears ?? 0) || 0;
    if (!target) {
      toast('The row these wears were merged into is no longer in the closet, so nothing was changed.', 'bad');
      return;
    }
    await saveRow(TABLES.clothingItems, { id: target.id, wears: Math.max(0, (target.wears ?? 0) - back) });
    await saveRow(TABLES.clothingItems, {
      id: row.id,
      wears: back,
      data: { ...(row.data ?? {}), dupOf: null, dupNote: '', mergedInto: null, mergedWears: null, wearsBeforeMerge: null }
    });
    toast(`Returned ${back} wear${back === 1 ? '' : 's'} to “${row.name}”. Both rows are as they were before the merge.`, 'ok');
  }

  /* -------------------------------------------------------------------- view */

  const packing = lists.filter((l) => l.data?.packing === 1);
  const otherLists = lists.filter((l) => l.data?.packing !== 1);
  const hashedPhotos = items.filter((i) => i.mediaId && phashOf(mediaById.get(String(i.mediaId)))).length;

  /** how many of a set of piece ids this device holds a readable photograph of */
  const photographedOf = (ids: string[]) =>
    ids.filter((id) => {
      const i = itemById.get(id);
      return Boolean(i?.mediaId && mediaById.get(String(i.mediaId)));
    }).length;
  const editorOutfitRow = outfitEditor?.id ? outfits.find((o) => o.id === outfitEditor.id) ?? null : null;

  /* the confirm step for a duplicate action; its arithmetic lives in
     `MergeArithmetic`, which the review queue prints too */
  const dupKeepRow = dupAction ? (itemById.get(dupAction.keeperId) ?? null) : null;
  const dupOtherRow = dupAction ? (itemById.get(dupAction.otherId) ?? null) : null;

  return (
    <div className="gl-page cl-page">
      <DeptIntro
        id="closet"
        deck="Everything here was typed by you: pieces, prices, wears and outfits. The only thing this page adds is arithmetic — and it always shows the two numbers it divided."
        actions={
          <>
            <Button
              variant="primary"
              onClick={() => setEditing(draftFrom())}
            >
              <Plus size={14} /> Add a piece
            </Button>
            <Button onClick={() => setBulkOpen(true)}>
              <Images size={14} /> Log several pieces
            </Button>
            <Button onClick={() => setOutfitEditor({ name: '', occasion: '', season: '', aesthetic: '', note: '', rating: 0, itemIds: [], mediaId: null })}>
              <Wand2 size={14} /> Build outfit
            </Button>
            <Button onClick={() => setPackEditor({ name: '', departOn: todayISO(), returnOn: '', itemIds: [], extras: [] })}>
              <CalendarRange size={14} /> Packing list
            </Button>
          </>
        }
        meta={[
          { label: 'Pieces recorded', value: String(figures.count) },
          { label: 'Wears logged', value: String(figures.totalWears) },
          { label: 'Cost basis', value: figures.unpriced ? `${figures.pricedCount} priced / ${figures.unpriced} blank` : 'all priced' }
        ]}
      />

      <StatStrip
        items={[
          { label: 'Pieces', value: String(figures.count) },
          { label: 'Logged acquisition cost', value: fmtMoney(figures.spend, currency), hint: `sum of ${figures.pricedCount} prices you entered` },
          { label: 'Blended cost per wear', value: figures.blended === null ? '—' : fmtMoney(figures.blended, currency), hint: figures.blendedNote },
          { label: 'Outfits', value: String(outfits.length) },
          { label: 'Packing lists', value: String(packing.length) }
        ]}
      />

      {/* ------------------------------------------------------------ toolbar */}
      <div className="cl-toolbar">
        <label className="cl-search gl-field" style={{ marginBottom: 0 }}>
          <span className="gl-field__label">
            <Search size={12} /> Search your closet
          </span>
          <TextInput value={q} onChange={setQ} placeholder="name, brand, colour, occasion…" />
        </label>
        <Field label="Category">
          <Select
            value={category}
            onChange={setCategory}
            placeholder="All categories"
            options={CATEGORIES.map((c) => ({ value: c.name, label: `${c.name} (${items.filter((i) => i.category === c.name).length})` }))}
          />
        </Field>
        <Field label="Season">
          <Select value={season} onChange={setSeason} placeholder="Any season" options={SEASONS.map((s) => ({ value: s, label: s }))} />
        </Field>
        <Field label="Sort">
          <Select
            value={sort}
            onChange={(v) => setSort(v as SortKey)}
            options={[
              { value: 'newest', label: 'Newest acquisition' },
              { value: 'cpw', label: 'Cost per wear (highest first)' },
              { value: 'leastWorn', label: 'Least worn' },
              { value: 'name', label: 'Name A–Z' }
            ]}
          />
        </Field>
        <Field label="View">
          <SegmentedControl
            value={view}
            onChange={(v) => setView(v as 'grid' | 'table')}
            options={[
              { value: 'grid', label: <><LayoutGrid size={13} /> Pin wall</> },
              { value: 'table', label: <><Table2 size={13} /> Ledger</> }
            ]}
          />
        </Field>
      </div>

      {/* -------------------------------------------------------- main grid */}
      <div className="gl-editorial gl-editorial--wide-left">
        <section className="gl-section">
          {items.length === 0 ? (
            <EmptyPlate
              kicker="Section 01 · the wardrobe"
              title="Your closet is empty — on purpose"
              body="Nothing was pre-filled: this app has never seen a single garment you own, and it will not pretend to. Add one piece with a name, a category and, if you remember it, the price you paid. Cost-per-wear, gaps and outfits all start from that first row."
              action={
                <Button variant="primary" onClick={() => setEditing(draftFrom())}>
                  <Plus size={14} /> Add the first piece
                </Button>
              }
            />
          ) : visible.length === 0 ? (
            <Card>
              <CardHead title="No piece matches those filters" sub="The closet still holds everything — this is the filter talking." />
              <div className="gl-row gl-row--tight">
                <Button size="sm" onClick={() => { setQ(''); setCategory(''); setSeason(''); }}>
                  Clear filters
                </Button>
                <Button size="sm" onClick={() => setEditing(draftFrom())}>
                  Add piece anyway
                </Button>
              </div>
            </Card>
          ) : view === 'grid' ? (
            <div className="cl-pins">
              {visible.map((i) => {
                const c = costPerWear(i.price ?? null, i.wears ?? 0);
                return (
                  <Pin
                    key={i.id}
                    item={i.mediaId ? mediaById.get(i.mediaId as string) : null}
                    title={i.name}
                    sub={`${i.category}${subcategoryOf(i) ? ` · ${subcategoryOf(i)}` : ''} · ${i.wears ?? 0} wears`}
                    badge={
                      <Chip tone={c === null ? 'info' : 'gold'}>
                        {c === null ? 'no wears yet' : `${fmtMoney(c, currency)}/wear`}
                      </Chip>
                    }
                    onOpen={() => setEditing(draftFrom(i))}
                    actions={[
                      {
                        key: 'wear',
                        label: 'Log a wear',
                        icon: <Repeat size={14} />,
                        onClick: () => {
                          setWearing(i);
                          setWearDraft({ count: '1', on: todayISO(), note: '' });
                        }
                      },
                      { key: 'edit', label: 'Edit piece', icon: <Pencil size={14} />, onClick: () => setEditing(draftFrom(i)) },
                      {
                        key: 'del',
                        label: 'Delete piece',
                        icon: <Trash2 size={14} />,
                        onClick: () => setConfirmDel({ table: TABLES.clothingItems, id: i.id, label: i.name })
                      }
                    ]}
                  />
                );
              })}
            </div>
          ) : (
            <Table
              rows={visible}
              keyOf={(r: AnyRow) => r.id}
              columns={[
                { label: 'Piece', render: (r: AnyRow) => <button className="gl-btn gl-btn--link gl-btn--sm" onClick={() => setEditing(draftFrom(r))}>{r.name}</button> },
                { label: 'Category', render: (r: AnyRow) => <span className="gl-tech">{r.category}{subcategoryOf(r) ? ` / ${subcategoryOf(r)}` : ''}</span> },
                { label: 'Colours', render: (r: AnyRow) => <Swatches colors={(r.colors as string[]) ?? []} size={16} /> },
                { label: 'Wears', render: (r: AnyRow) => <span className="cl-cpw">{r.wears ?? 0}</span> },
                {
                  label: 'Cost per wear',
                  render: (r: AnyRow) => {
                    const c = costPerWear(r.price ?? null, r.wears ?? 0);
                    return c === null ? <span className="cl-cpw--unknown gl-tech">not worn yet</span> : <span className="cl-cpw">{fmtMoney(c, currency)}</span>;
                  }
                },
                { label: 'Last worn', render: (r: AnyRow) => <span className="gl-tech">{formatDate(lastWornOf(r))}</span> },
                { label: 'Condition', render: (r: AnyRow) => <Chip>{conditionOf(r)}</Chip> },
                {
                  label: '',
                  render: (r: AnyRow) => (
                    <div className="gl-row gl-row--tight">
                      <IconButton label={`Log a wear on ${r.name}`} onClick={() => { setWearing(r); setWearDraft({ count: '1', on: todayISO(), note: '' }); }}>
                        <Repeat size={14} />
                      </IconButton>
                      <IconButton label={`Delete ${r.name}`} onClick={() => setConfirmDel({ table: TABLES.clothingItems, id: r.id, label: r.name })}>
                        <Trash2 size={14} />
                      </IconButton>
                    </div>
                  )
                }
              ]}
            />
          )}

          {items.length > 0 ? (
            <div className="gl-row gl-row--tight" style={{ marginTop: 'var(--glow-sp-4)', flexWrap: 'wrap' }}>
              <Chip tone="info">{visible.length} of {items.length} shown</Chip>
              <Chip>{figures.withPhoto} with a photograph</Chip>
              <Chip tone="gold">{figures.neverWorn} never worn</Chip>
              <Button size="sm" variant="ghost" onClick={() => navigate('/color')}>
                Colour & palette work
              </Button>
              <Button size="sm" variant="ghost" onClick={() => navigate('/market')}>
                Market & buying decisions
              </Button>
              <Button size="sm" variant="ghost" onClick={() => navigate('/media')}>
                Photo library
              </Button>
            </div>
          ) : null}
        </section>

        {/* --------------------------------------------------------- side rail */}
        <div className="gl-stack">
          <Card>
            <CardHead title="Wardrobe observations" eyebrow="Counts only" sub="Derived from the category field on your own rows." />
            {items.length === 0 ? (
              <p className="gl-small gl-muted">Nothing to observe yet — the first piece unlocks this panel.</p>
            ) : (
              <div className="gl-stack">
                {observations.map((o, i) => (
                  <div className="cl-gap" key={i}>
                    <div className="gl-serif" style={{ fontSize: '1.05rem' }}>{o.head}</div>
                    <div className="gl-small gl-muted">{o.body}</div>
                  </div>
                ))}
                <Disclosure summary="Show the raw count per category">
                  <div className="cl-facts">
                    {byCategory.map(([name, v]) => (
                      <div key={name}>
                        <div className="gl-label">{name}</div>
                        <div className="gl-tech">
                          {v.count} pieces · {v.wears} wears · {v.unworn} unworn · {fmtMoney(v.spend, currency)} logged cost
                        </div>
                      </div>
                    ))}
                  </div>
                </Disclosure>
              </div>
            )}
          </Card>

          <Card>
            <CardHead
              title="Cost-per-wear ledger"
              eyebrow="price ÷ wears"
              right={<Chip tone="gold">{ledger.length} measurable</Chip>}
            />
            {ledger.length === 0 ? (
              <p className="gl-small gl-muted">
                A figure needs both halves: an acquisition cost and at least one logged wear. Right now you have{' '}
                {figures.totalWears} wears across {figures.count} pieces.
              </p>
            ) : (
              <div className="gl-list">
                {ledger.map(({ row, cpw }) => (
                  <div className="gl-list__row" key={row.id}>
                    <div>
                      <div>{row.name}</div>
                      <div className="gl-tech">
                        {fmtMoney(row.price, currency)} ÷ {row.wears} = <span className="cl-cpw">{fmtMoney(cpw as number, currency)}</span> per wear
                      </div>
                    </div>
                    <Chip tone={row.wears >= 10 ? 'gold' : 'info'}>{row.wears} wears</Chip>
                  </div>
                ))}
                <Meter
                  label="Share of logged cost on priced pieces"
                  value={figures.spend ? (ledger.reduce((s, l) => s + (l.row.price as number), 0) / figures.spend) * 100 : 0}
                />
              </div>
            )}
          </Card>

          <Card>
            <CardHead title="Recent wears" eyebrow="from your wear log" />
            {recentWears.length === 0 ? (
              <p className="gl-small gl-muted">No wear logged yet. The +wear action on any piece writes today's date into its record.</p>
            ) : (
              <Timeline
                items={recentWears.map((r) => ({
                  when: formatDate(lastWornOf(r)),
                  title: r.name,
                  body: `${r.wears ?? 0} wears total · ${(r.data?.wearNote as string) ?? 'no note'}`,
                  tone: 'accent' as const
                }))}
              />
            )}
          </Card>
        </div>
      </div>

      {/* -------------------------------------------------- possible duplicates */}
      <section className="gl-section" id="cl-duplicates">
        <div className="gl-section__title">
          <div>
            <div className="gl-eyebrow">Possible duplicates</div>
            <h2>Pieces that line up on the fields you filled in</h2>
          </div>
          <div className="gl-row gl-row--tight" style={{ flexWrap: 'wrap' }}>
            <Chip tone={dupStats.strong ? 'danger' : dupStats.possible ? 'limited' : 'gold'}>
              {dupStats.total === 0
                ? 'nothing flagged'
                : `${dupStats.strong ? `${dupStats.strong} strong` : 'no strong'} · ${dupStats.possible} possible`}
            </Chip>
            <Chip tone="info">{dupStats.photos} photo pair{dupStats.photos === 1 ? '' : 's'} close</Chip>
            {dupStats.flagged ? <Chip tone="weak">{dupStats.flagged} flagged</Chip> : null}
            {dupStats.merged ? <Chip tone="weak">{dupStats.merged} merged</Chip> : null}
          </div>
        </div>

        {cameFrom ? (
          <div className="cl-dup__arrival">
            Opened from the market check, so “{cameFrom}” is in the search box above.{' '}
            <button
              type="button"
              className="gl-btn gl-btn--link gl-btn--sm"
              onClick={() => {
                setQ('');
                setCameFrom('');
              }}
            >
              clear the search
            </button>
          </div>
        ) : null}

        {/* ------------------------------------------------ one pair at a time */}
        {reviewPairs.length ? (
          <div className="cl-review" data-testid="dup-review">
            <div className="cl-review__bar" data-testid="review-queue">
              <div className="gl-row gl-row--tight" style={{ flexWrap: 'wrap' }}>
                <span className="gl-eyebrow">Review one at a time</span>
                {reviewLedger.open ? (
                  <span className="gl-serif cl-review__where">
                    {currentPair
                      ? `Pair ${positionOf(queue, reviewLedger)} of ${queueCounts.total}`
                      : `Pass ${reviewLedger.lap} finished — ${queueCounts.total} pair${queueCounts.total === 1 ? '' : 's'} in the list`}
                  </span>
                ) : (
                  <span className="gl-small gl-muted">
                    {queueCounts.total} pair{queueCounts.total === 1 ? '' : 's'} flagged · {reviewLedger.order.length ? 'a saved place in the list' : 'nothing answered yet'}
                  </span>
                )}
              </div>
              <div className="gl-row gl-row--tight">
                {reviewLedger.open ? (
                  <Button size="sm" variant="ghost" onClick={endReview}>
                    <CircleStop size={13} /> Stop review
                  </Button>
                ) : (
                  <button type="button" className="gl-btn gl-btn--primary gl-btn--sm" data-testid="review-open" onClick={beginReview}>
                    <Play size={13} /> Start review
                  </button>
                )}
              </div>
            </div>

            <div className="gl-row gl-row--tight cl-review__progress" style={{ flexWrap: 'wrap' }} data-testid="review-progress">
              <Chip tone="info">{queueLine({ ...queueCounts, suppressed: suppressed.size })}</Chip>
              {reviewLedger.lap > 1 ? <Chip tone="weak">pass {reviewLedger.lap}</Chip> : null}
            </div>

            {!reviewLedger.open ? (
              <p className="gl-small gl-muted">
                Starting a review freezes this list and walks it pair by pair, one answer at a time. It changes nothing by itself —
                the first thing it shows you is the pair below, exactly as the panel already computes it.
              </p>
            ) : reviewReady && currentPair && currentView && reviewRows ? (
              <>
                <div className="cl-review__pair" data-testid="review-current">
                  <DupPairCard
                    pair={currentView.pair}
                    left={reviewRows.left}
                    right={reviewRows.right}
                    photo={currentView.photo ? { distance: currentView.photo.distance, bits: currentView.photo.bits } : null}
                    currency={currency}
                    mediaById={mediaById}
                    onEdit={(row) => setEditing(draftFrom(row))}
                    onAction={(kind, keeperId, otherId) => {
                      if (kind === 'merge') {
                        reviewDecide('merge');
                        return;
                      }
                      setDupNote('');
                      setDupAction({ kind, keeperId, otherId });
                    }}
                    onClear={(row) => void clearDupFlag(row)}
                    onUndo={(row) => void undoMerge(row)}
                  />
                </div>

                <div className="cl-review__merge">
                  <div className="gl-label">
                    If you merge these two, this is the arithmetic — the keeper is <span className="gl-tech">keeper(a, b)</span>, the
                    row with more logged wears:
                  </div>
                  <p className="gl-small">
                    <MergeArithmetic keepRow={reviewRows.keep} otherRow={reviewRows.other} currency={currency} />
                  </p>
                </div>

                <div className="gl-row gl-row--tight cl-review__decide" style={{ flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="gl-btn gl-btn--danger gl-btn--sm"
                    data-testid="review-decision-merge"
                    disabled={[currentPair.aId, currentPair.bId].some((id) => Boolean(mergedIntoOf(itemById.get(id))))}
                    onClick={() => reviewDecide('merge')}
                  >
                    <ShieldAlert size={12} /> Merge the wears onto “{reviewRows.keep.name}”
                  </button>
                  <button
                    type="button"
                    className="gl-btn gl-btn--default gl-btn--sm"
                    data-testid="review-decision-keep-both"
                    onClick={() => reviewDecide('keep-both')}
                  >
                    <Check size={12} /> Keep both — different pieces
                  </button>
                  <button
                    type="button"
                    className="gl-btn gl-btn--ghost gl-btn--sm"
                    data-testid="review-decision-skip"
                    onClick={() => reviewDecide('skip')}
                  >
                    <Repeat size={12} /> Skip this pair
                  </button>
                  <button
                    type="button"
                    className="gl-btn gl-btn--ghost gl-btn--sm"
                    data-testid="review-decision-not-duplicates"
                    onClick={() => reviewDecide('not-duplicates')}
                  >
                    <ShieldOff size={12} /> Not duplicates — stop showing them
                  </button>
                </div>

                {outsideQueue.length ? (
                  <p className="gl-small gl-faint">
                    {outsideQueue.length} pair{outsideQueue.length === 1 ? '' : 's'} appeared since you started and{' '}
                    {outsideQueue.length === 1 ? 'is' : 'are'} not in this frozen list — they stay in the panel below and join the
                    queue the next time you start a review. Nothing is inserted in front of you mid-walk.
                  </p>
                ) : null}
              </>
            ) : (
              <div className="gl-note" data-testid="dup-review-done">
                <p className="gl-small">
                  Nothing left to ask in this pass. {queueCounts.skipped ? `${queueCounts.skipped} pair${queueCounts.skipped === 1 ? '' : 's'} you skipped ${queueCounts.skipped === 1 ? 'is' : 'are'} waiting at the end of the list.` : 'Every pair in the frozen list has an answer from you.'}
                </p>
                <div className="gl-row gl-row--tight">
                  {queueCounts.skipped ? (
                    <Button size="sm" variant="primary" onClick={roundAgain}>
                      <Repeat size={13} /> Go round again for the {queueCounts.skipped} skipped
                    </Button>
                  ) : null}
                  <Button size="sm" variant="ghost" onClick={endReview}>
                    <CircleStop size={13} /> Stop review
                  </Button>
                </div>
              </div>
            )}

            <Disclosure summary="What the review remembers, and where it writes">
              <p className="gl-small">
                The order, your place in it and your keep-both and skip answers live in this browser’s storage under{' '}
                <span className="gl-tech">glowlab.dupReview.v1</span>. That is a record of the walk, not of your closet: clear this
                site’s storage and the queue starts again from the top, while every piece you own is untouched.
              </p>
              <p className="gl-small">
                The two answers that reach your data are database writes on the rows themselves. A merge goes through the same
                confirm step as the button in the panel below — wears move onto the keeper, the other row keeps itself and stores the
                number it gave up, and the undo puts it back. “Not duplicates” writes a note naming the other piece on{' '}
                <em>both</em> rows, which is what keeps that pair off the list after a reload, inside a backup and on a device that
                never saw this queue. Clear either note and the pair is offered again.
              </p>
              <p className="gl-small">
                Nothing is decided for you. No pair merges, stays or is ruled out on its own, the photographs are not read as
                clothing, and a blank field is named as blank rather than counted as a match.
              </p>
            </Disclosure>
          </div>
        ) : null}

        {items.length < 2 ? (
          <p className="gl-small gl-muted">
            A comparison needs two logged pieces; you have {items.length}. Nothing here reads a label, a receipt or a photograph
            to decide — it reads the category, subcategory, colour, material, fit and season fields you typed.
          </p>
        ) : dupPairs.length === 0 ? (
          <div className="gl-note">
            No two rows reach half the 24-point frame on the seven fields. That is a statement about your records: two
            identical pieces described differently will not line up, and the closer a photograph looks to another, the more the
            photo check below is the one with something to say.
          </div>
        ) : (
          <div className="cl-dups">
            {dupPairs.map((p) => {
              const left = itemById.get(p.a.id);
              const right = itemById.get(p.b.id);
              if (!left || !right) return null;
              return (
                <DupPairCard
                  key={p.id}
                  pair={p}
                  left={left}
                  right={right}
                  photo={photoDistance.get([left.id, right.id].sort().join('~')) ?? null}
                  currency={currency}
                  mediaById={mediaById}
                  onEdit={(row) => setEditing(draftFrom(row))}
                  onAction={(kind, keeperId, otherId) => {
                    setDupNote('');
                    setDupAction({ kind, keeperId, otherId });
                  }}
                  onClear={(row) => void clearDupFlag(row)}
                  onUndo={(row) => void undoMerge(row)}
                />
              );
            })}
          </div>
        )}

        {photoPairs.length ? (
          <div className="cl-dup__photos">
            <div className="gl-label">Photographs that match each other</div>
            <p className="gl-small gl-muted">
              A 9×8 difference hash of each piece’s photo — 64 bits, compared by counting the bits that differ. Pairs at or below{' '}
              {DEFAULT_MEDIA_DISTANCE} bits land here. It says two pictures look alike; it does not know whether they are the same
              garment, and it cannot tell a duplicate from the same garment photographed twice.
            </p>
            <div className="cl-dup__grid">
              {photoPairs.map((p) => (
                <div className="cl-dup__photo" key={p.key}>
                  <span className="gl-tech">
                    {p.distance} of {p.bits} bits differ · {p.distance <= DEFAULT_MEDIA_DISTANCE ? 'close' : 'further than the floor'}
                  </span>
                  <div className="cl-dup__photoRow">
                    <span className="gl-small gl-strong">{p.left.name}</span>
                    <span className="gl-faint">against</span>
                    <span className="gl-small gl-strong">{p.right.name}</span>
                  </div>
                  <div className="gl-row gl-row--tight" style={{ flexWrap: 'wrap' }}>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(draftFrom(p.left))}>
                      <Pencil size={12} /> {p.left.name}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setEditing(draftFrom(p.right))}>
                      <Pencil size={12} /> {p.right.name}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : figures.withPhoto >= 2 && hashedPhotos < 2 ? (
          <p className="gl-small gl-faint">
            {figures.withPhoto} pieces carry a photograph but only {hashedPhotos} have a stored fingerprint, so the pixel check has
            nothing to compare yet. A fingerprint is written when a photo is added to the library.
          </p>
        ) : figures.withPhoto >= 2 ? (
          <p className="gl-small gl-faint">
            {hashedPhotos} fingerprints compared; no two photographs come within {DEFAULT_MEDIA_DISTANCE} bits of each other.
          </p>
        ) : null}

        <Disclosure summary="How this panel reaches a score, and what it will never do">
          <p className="gl-small">
            Seven fields carry fixed weights: category 5, colour 5, kind (subcategory) 4, material 3, name 3, fit 2, season 2 —
            24 points in total. A field agrees when your two spellings land in the same bucket of a synonym table that ships in
            this app: “navy” and “dark blue” are one colour family, denim and cotton one fabric, “true to size” and “regular” one
            fit. The denominator never shrinks, so a field you left blank can only pull the score down — it is named in the
            disclosure instead of being guessed at. The ceiling line tells you the best the pair could ever have done with the
            fields you actually filled; the certainty line tells you how firm the covered fields are.
          </p>
          <p className="gl-small">
            It will never delete, merge or rewrite a row by itself. Flagging writes one note on one row. Merging wears adds the
            weaker row’s count to the keeper and stores the original number on the row it came from, so the undo puts it back
            exactly. Both rows keep their own photo, price, notes and place in outfits. Which piece is “the keeper” is arithmetic
            too: more logged wears first, then the earlier acquisition date, then the row id so the answer never wanders between
            visits.
          </p>
        </Disclosure>
      </section>

      {/* ---------------------------------------------------- what to wear next */}
      <section className="gl-section" data-testid="rotation">
        <div className="gl-section__title">
          <div>
            <div className="gl-eyebrow">Rotation</div>
            <h2>What to wear next</h2>
          </div>
          <div className="gl-row gl-row--tight">
            <Chip>{items.length} pieces read</Chip>
            <Chip tone="gold">{outfits.length} outfits stored</Chip>
            <Button size="sm" variant="primary" onClick={drawLook}>
              <Shuffle size={13} /> Draw a look
            </Button>
          </div>
        </div>

        <Card>
          <CardHead
            title="The two things it asks you"
            sub="Season and occasion are filters over what you already typed. Nothing here is a style opinion — the app cannot see a garment inside a photograph, so it only ever reads the colour values its own ingest wrote down and the words you typed."
          />
          <div className="gl-form-row">
            <Field label="Season">
              <Select
                value={spin.season}
                onChange={(v) => setSpin({ ...spin, season: v })}
                placeholder="Any season"
                options={SEASONS.map((s) => ({ value: s, label: s }))}
              />
            </Field>
            <Field label="Occasion" hint="Matched against the occasions you wrote on each piece.">
              <TextInput value={spin.occasion} onChange={(v) => setSpin({ ...spin, occasion: v })} placeholder="Interview, Sunday, cold commute" />
            </Field>
            <div style={{ alignSelf: 'flex-end' }}>
              <Toggle
                checked={spin.outerwear}
                onChange={(v) => setSpin({ ...spin, outerwear: v })}
                label="Add an outer layer"
                hint={`Only drawn for Autumn, Winter or All-season, or when no season is picked.`}
              />
            </div>
          </div>

          {plan === null ? (
            <p className="gl-small gl-muted">
              Nothing drawn yet. Press “Draw a look” and the closet is ordered by the rule below — the piece that has waited longest
              comes first, so the draw pushes rotation rather than favouring what you reach for anyway. Once the look holds one piece,
              the next slot is chosen against what you have already stored together and the colour values read off your own piece
              photographs, and both are printed beside the piece they describe.
            </p>
          ) : plan.slots.length === 0 ? (
            <div className="gl-inset">
              <p className="gl-small">
                <span className="gl-strong">Nothing could be drawn.</span> {plan.gaps.join(' ')}
              </p>
              <p className="gl-small gl-muted">
                {plan.poolSize} piece{plan.poolSize === 1 ? '' : 's'} in the closet were read and none of them could fill a slot. Log a
                piece, or widen the season and occasion above — the draw will not invent something to wear.
              </p>
            </div>
          ) : (
            <div className="gl-stack">
              <p className="gl-small">
                {plan.kind === 'existing-outfit' ? (
                  <>
                    <span className="gl-strong">An outfit you already assembled is the idlest thing you own</span>, so it is offered
                    before a new combination: “{plan.outfitName}”.
                  </>
                ) : (
                  <span className="gl-strong">Assembled from the pieces that have waited longest.</span>
                )}
              </p>
              {plan.pairing ? (
                <div className="gl-row gl-row--tight" data-testid="pairing-read">
                  <Chip tone={plan.pairing.readable ? 'gold' : 'limited'}>
                    colour read for {plan.pairing.readable} of {plan.pairing.total} placeable pieces
                  </Chip>
                  <Chip tone={plan.pairing.coWornPairs ? 'info' : 'moderate'}>
                    {plan.pairing.coWornPairs
                      ? `${plan.pairing.coWornPairs} pair${plan.pairing.coWornPairs === 1 ? '' : 's'} you have stored together`
                      : 'no two pieces stored together yet'}
                  </Chip>
                  {plan.pairing.slots > 1 ? (
                    <Chip>{plan.pairing.moved ? `pairing chose over idlest in ${plan.pairing.moved} of ${plan.pairing.slots} slots` : 'pairing agreed with the idle order'}</Chip>
                  ) : null}
                </div>
              ) : null}
              {plan.slots.map((s, n) => {
                const pick = s.pieces[s.at];
                if (!pick) return null;
                const live = itemById.get(pick.id);
                const swatches = colourReads.get(pick.id)?.hexes ?? [];
                return (
                  <div key={s.name} className="gl-row gl-row--tight" data-slot={s.name} style={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
                    <span className="gl-eyebrow" style={{ minWidth: 92 }}>{s.name}</span>
                    <span className="gl-serif">{live?.name ?? pick.name}</span>
                    {swatches.length ? <Swatches colors={swatches.slice(0, 3)} size={12} /> : null}
                    <span className="gl-tech">{pick.reasons.join(' · ')}</span>
                    {s.pieces.length > 1 ? (
                      <Button size="sm" variant="ghost" onClick={() => swapSlot(n)}>
                        <Undo2 size={12} /> another option ({s.at + 1}/{s.pieces.length})
                      </Button>
                    ) : (
                      <span className="gl-small gl-faint">only one option in this slot</span>
                    )}
                    {live?.mediaId && mediaById.get(String(live.mediaId)) ? (
                      <div style={{ width: 74 }}>
                        <ImageTile item={mediaById.get(String(live.mediaId))!} caption="" />
                      </div>
                    ) : null}
                  </div>
                );
              })}
              {plan.gaps.length ? (
                <div className="gl-inset">
                  <div className="gl-label">Slots the closet could not fill</div>
                  <ul className="gl-small gl-muted" style={{ paddingLeft: 18, margin: 0 }}>
                    {plan.gaps.map((g, n) => (
                      <li key={n}>{g}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {plan.notes.length ? (
                <ul className="gl-small gl-faint" style={{ paddingLeft: 18, margin: 0 }}>
                  {plan.notes.map((nt, n) => (
                    <li key={n}>{nt}</li>
                  ))}
                </ul>
              ) : null}
              <div className="gl-row gl-row--tight">
                {plan.outfitId ? (
                  <Button
                    onClick={() => {
                      const row = outfits.find((o) => o.id === plan.outfitId);
                      if (row) editOutfit(row);
                    }}
                  >
                    <Pencil size={13} /> Open that outfit
                  </Button>
                ) : (
                  <Button variant="primary" onClick={() => void writePlanOutfit(false)}>
                    <Check size={13} /> Save these {chosenIds(plan).length} pieces as an outfit
                  </Button>
                )}
                {plan.outfitId ? null : (
                  <Button variant="ghost" onClick={() => void writePlanOutfit(true)} disabled={!chosenIds(plan).length}>
                    <Repeat size={13} /> Wore it today
                  </Button>
                )}
              </div>
            </div>
          )}

          <Disclosure summary="The exact order the draw uses">
            <p className="gl-small">
              {plan?.rule ?? RULE_SENTENCE} A piece worn within the last {REPEAT_WINDOW_DAYS} days is only brought back when the slot
              has nothing else, and that is said out loud under the look. Categories this draw cannot place — Knitwear, Activewear,
              Accessories, Sleep &amp; Lounge, Special Occasion — are counted and named rather than quietly dropped.
            </p>
          </Disclosure>
        </Card>
      </section>

      {/* -------------------------------------------------------- the week */}
      <section className="gl-section" data-testid="week">
        <div className="gl-section__title">
          <div>
            <div className="gl-eyebrow">Rotation</div>
            <h2>Dress the next few days at once</h2>
          </div>
          <div className="gl-row gl-row--tight">
            <Button size="sm" variant="primary" onClick={drawWeek}>
              <CalendarRange size={13} /> Plan from today
            </Button>
            {week ? (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  setWeek(null);
                  setPins({});
                }}
              >
                <Undo2 size={12} /> Clear
              </Button>
            ) : null}
          </div>
        </div>

        <Card>
          <CardHead
            title="One piece, one day"
            sub="The same draw, run one day at a time over what the earlier days left. Nothing is worn twice in the span — that is an arithmetic choice so the pile is measured honestly, not advice about re-wearing, and clearing the plan gives the single-day draw back."
          />
          <div className="gl-form-row">
            <Field label="How many days" hint="Counts forward from today. The season and occasion above are reused as filters.">
              <Select
                value={String(weekDays)}
                onChange={(v) => setWeekDays(Number(v))}
                options={[3, 5, 7, 10, 14].map((n) => ({ value: String(n), label: `${n} days` }))}
              />
            </Field>
          </div>

          {!week ? (
            <p className="gl-small gl-muted">
              Nothing planned yet. Press “Plan from today” and each day takes the look the draw would produce on that date, then hands
              those pieces to the next day. A day the closet cannot dress is left short and says which slot ran out — it is never
              padded with a piece already committed elsewhere.
            </p>
          ) : (
            <div className="gl-stack">
              <div className="gl-row gl-row--tight" data-testid="week-read">
                <Chip tone={week.days.length ? 'strong' : 'moderate'}>
                  {week.days.length} of {weekDates(weekStart, weekDays).length} days dressed
                </Chip>
                <Chip>{Object.keys(week.usedOn).length} pieces committed</Chip>
                <Chip tone={week.days.every((d) => d.complete) ? 'gold' : 'limited'}>
                  {week.days.filter((d) => !d.complete).length} day
                  {week.days.filter((d) => !d.complete).length === 1 ? '' : 's'} missing a base layer
                </Chip>
              </div>

              {week.days.length ? (
                <div className="gl-stack" data-testid="week-days">
                  {week.days.map((d) => (
                    <div key={d.date} className="gl-inset" data-week-day={d.date}>
                      <div className="gl-row gl-row--between" style={{ alignItems: 'baseline', flexWrap: 'wrap' }}>
                        <span className="gl-serif">{dayLabel(d.date)}</span>
                        <span className="gl-row gl-row--tight">
                          {d.complete ? (
                            <Chip tone="strong">full look</Chip>
                          ) : (
                            <Chip tone="moderate">no {d.unfilled.join(', no ').toLowerCase()}</Chip>
                          )}
                          {d.plan.kind === 'existing-outfit' ? <Chip tone="info">an outfit you stored — “{d.plan.outfitName}”</Chip> : null}
                          <Button size="sm" variant="ghost" onClick={() => setPlan(d.plan)}>
                            <Shuffle size={12} /> Open as one look
                          </Button>
                        </span>
                      </div>
                      {d.taken.map((t) => {
                        const live = itemById.get(t.id);
                        const sw = colourReads.get(t.id)?.hexes ?? [];
                        const slot = d.plan.slots.find((x) => x.name === t.slot);
                        return (
                          <div
                            key={t.slot}
                            className="gl-row gl-row--tight"
                            data-day-slot={`${d.date}:${t.slot}`}
                            style={{ alignItems: 'baseline', flexWrap: 'wrap' }}
                          >
                            <span className="gl-eyebrow" style={{ minWidth: 92 }}>
                              {t.slot}
                            </span>
                            <span className="gl-serif">{live?.name ?? t.name}</span>
                            {sw.length ? <Swatches colors={sw.slice(0, 3)} size={12} /> : null}
                            {slot && slot.pieces.length > 1 ? (
                              <Button size="sm" variant="ghost" onClick={() => cycleDay(d, t.slot)}>
                                <Undo2 size={12} /> another option ({slot.pieces.length})
                              </Button>
                            ) : null}
                          </div>
                        );
                      })}
                      {d.gaps.length ? (
                        <ul className="gl-small gl-muted" style={{ paddingLeft: 18, margin: '6px 0 0' }} data-day-gaps={d.date}>
                          {d.gaps.map((g, n) => (
                            <li key={n}>{g}</li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : null}

              {week.gaps.length ? (
                <div className="gl-inset">
                  <div className="gl-label">Days this closet could not dress</div>
                  <ul className="gl-small gl-muted" style={{ paddingLeft: 18, margin: 0 }}>
                    {week.gaps.map((g, n) => (
                      <li key={n}>{g}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {week.notes.length ? (
                <ul className="gl-small gl-faint" style={{ paddingLeft: 18, margin: 0 }}>
                  {week.notes.map((nt, n) => (
                    <li key={n}>{nt}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          )}

          <Disclosure summary="What the week planner cannot do">
            <p className="gl-small">
              {week?.rule ?? ''} It draws only from the pieces logged here, so a week it cannot fill is a limit of your records as much
              as of your closet — a garment you own but never logged will not appear. It does not know laundry, weather forecasts, work
              rosters or what you already agreed to wear, and it holds no opinion about whether seven outfits is a good idea.
            </p>
          </Disclosure>
        </Card>
      </section>

      {/* -------------------------------------------------------- coverage */}
      <section className="gl-section" data-testid="coverage">
        <div className="gl-section__title">
          <div>
            <div className="gl-eyebrow">Coverage</div>
            <h2>What the closet can dress at all</h2>
          </div>
          <div className="gl-row gl-row--tight">
            <Chip tone={coverage.gaps.length ? 'moderate' : 'strong'}>
              {coverage.slots.filter((s) => s.pieces > 0).length} of {coverage.slots.length} slots have pieces
            </Chip>
            <Chip>
              {coverage.totals.placeable} of {coverage.totals.rows} pieces placeable
            </Chip>
          </div>
        </div>

        <Card>
          <CardHead title="Two numbers in every cell" sub={coverageHeadline(coverage)} />
          <Table
            columns={[
              { label: 'Slot', render: (r: (typeof coverage.slots)[number]) => <span className="gl-strong">{r.slot}</span> },
              { label: 'Pieces', render: (r: (typeof coverage.slots)[number]) => r.pieces },
              ...SEASONS.map((season) => ({
                label: season,
                render: (r: (typeof coverage.slots)[number]) => {
                  const c = r.cells.find((x) => x.season === season)!;
                  return (
                    <span title={`${c.tagged} tagged ${season} · ${c.neverWorn} of these never worn`} data-cell={`${r.slot}:${season}`}>
                      <span className="gl-tech">{c.wearable}</span>
                      <span className="gl-small gl-faint"> ({c.tagged})</span>
                    </span>
                  );
                }
              })),
              { label: 'Never worn', render: (r: (typeof coverage.slots)[number]) => r.neverWorn },
              { label: `Idle ${DORMANT_DAYS}d+`, render: (r: (typeof coverage.slots)[number]) => r.dormant },
              {
                label: 'Untagged season',
                render: (r: (typeof coverage.slots)[number]) =>
                  r.unstated > 0 ? (
                    <button
                      type="button"
                      className="gl-btn gl-btn--link gl-btn--sm cl-coverage__assist"
                      data-testid="coverage-assist-open"
                      data-slot={r.slot}
                      onClick={() => openAssist(r.slot)}
                      title={`Go through them one piece at a time; nothing is filled in for you.`}
                    >
                      {r.unstated} piece{r.unstated === 1 ? ' has' : 's have'} no season tag — go through them
                    </button>
                  ) : (
                    <span className="gl-tech">0</span>
                  )
              }
            ]}
            rows={coverage.slots}
            keyOf={(r: (typeof coverage.slots)[number]) => r.slot}
          />
          <p className="gl-small gl-faint">
            A cell reads <span className="gl-tech">what the draw could reach</span> (what is literally tagged that season). The first
            number adds every All-season piece and every piece with no season written, because a filter cannot exclude a blank.
          </p>

          <div className="gl-row gl-row--tight" style={{ marginTop: 10 }} data-testid="coverage-occasions">
            {coverage.occasions.length ? (
              coverage.occasions.map((o) => (
                <Chip key={o.word} title={`${o.neverWorn} of these never worn`}>
                  {o.word} · {o.pieces}
                </Chip>
              ))
            ) : (
              <Chip tone="limited">no occasion written on any piece</Chip>
            )}
            {coverage.totals.withoutOccasion ? <Chip tone="moderate">{coverage.totals.withoutOccasion} with no occasion</Chip> : null}
          </div>

          {coverage.gaps.length ? (
            <div className="gl-inset" style={{ marginTop: 10 }}>
              <div className="gl-label">Holes in the records</div>
              <ul className="gl-small gl-muted" style={{ paddingLeft: 18, margin: 0 }}>
                {coverage.gaps.map((g, n) => (
                  <li key={n}>{g}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {coverage.notes.length ? (
            <ul className="gl-small gl-faint" style={{ paddingLeft: 18, margin: '8px 0 0' }} data-testid="coverage-notes">
              {coverage.notes.map((nt, n) => (
                <li key={n}>{nt}</li>
              ))}
            </ul>
          ) : null}

          <Disclosure summary="What coverage counts, and what it refuses to say">
            <p className="gl-small">
              {coverage.rule} {COVERAGE_LIMIT_SENTENCE}
            </p>
          </Disclosure>
        </Card>
      </section>

      {/* ----------------------------------------------------------- outfits */}
      <SectionedOutfits
        outfits={outfits}
        itemById={itemById}
        mediaById={mediaById}
        currency={currency}
        onNew={() => setOutfitEditor({ name: '', occasion: '', season: '', aesthetic: '', note: '', rating: 0, itemIds: [], mediaId: null })}
        onEdit={(o) => editOutfit(o)}
        onWear={(o) => void wearOutfit(o)}
        sheetBusy={sheetBusy}
        photographedOf={photographedOf}
        onFitSheet={(o) => void makeFitSheet(o)}
        onDelete={(o) => setConfirmDel({ table: TABLES.outfits, id: o.id, label: o.name })}
        onPickItem={(o) => setEditing(draftFrom(itemById.get(o)))}
      />

      {/* ------------------------------------------------------ packing lists */}
      <section className="gl-section">
        <div className="gl-section__title">
          <div>
            <div className="gl-eyebrow">Packing</div>
            <h2>Lists that leave the house</h2>
          </div>
          <div className="gl-row gl-row--tight">
            <Button size="sm" variant="primary" onClick={() => setPackEditor({ name: '', departOn: todayISO(), returnOn: '', itemIds: [], extras: [] })}>
              <Plus size={13} /> New packing list
            </Button>
          </div>
        </div>

        {packing.length === 0 ? (
          <EmptyPlate
            kicker="Section 03"
            title="No packing list yet"
            body="Pick the pieces going into the bag, add loose lines like “two phone cables”, and the list persists as a real row. Tick items as they go in — the ticks are stored, so the list survives a reload and a closed laptop."
            action={<Button onClick={() => setPackEditor({ name: '', departOn: todayISO(), returnOn: '', itemIds: [], extras: [] })}>Start a list</Button>}
          />
        ) : (
          <div className="gl-grid gl-grid--2">
            {packing.map((l) => (
              <Card key={l.id}>
                <CardHead
                  title={l.name}
                  eyebrow={`Trip ${formatDate(l.data?.departOn ?? null)} → ${formatDate(l.data?.returnOn ?? null)}`}
                  right={
                    <>
                      <IconButton label={`Edit ${l.name}`} onClick={() =>
                        setPackEditor({
                          id: l.id,
                          name: l.name ?? '',
                          departOn: l.data?.departOn ?? todayISO(),
                          returnOn: l.data?.returnOn ?? '',
                          itemIds: ((l.items as ListItem[]) ?? []).filter((x) => x.productId).map((x) => x.productId as string),
                          extras: ((l.items as ListItem[]) ?? []).filter((x) => !x.productId).map((x) => x.label)
                        })
                      }>
                        <Pencil size={14} />
                      </IconButton>
                      <IconButton label={`Delete ${l.name}`} onClick={() => setConfirmDel({ table: TABLES.lists, id: l.id, label: l.name })}>
                        <Trash2 size={14} />
                      </IconButton>
                    </>
                  }
                />
                <Meter
                  label={`Packed ${((l.items as ListItem[]) ?? []).filter((x) => x.checked).length} of ${((l.items as ListItem[]) ?? []).length}`}
                  value={(((l.items as ListItem[]) ?? []).filter((x) => x.checked).length / Math.max(1, ((l.items as ListItem[]) ?? []).length)) * 100}
                />
                <div className="gl-list" style={{ marginTop: 'var(--glow-sp-3)' }}>
                  {((l.items as ListItem[]) ?? []).map((it) => (
                    <div className="gl-list__row" key={it.id}>
                      <label className="gl-check" style={{ cursor: 'pointer' }}>
                        <input type="checkbox" checked={Boolean(it.checked)} onChange={() => void togglePackItem(l, it.id)} />
                        <span className={it.checked ? 'gl-faint' : ''} style={{ textDecoration: it.checked ? 'line-through' : 'none' }}>
                          {it.productId ? itemById.get(it.productId)?.name ?? 'Piece removed from closet' : it.label}
                        </span>
                      </label>
                      <span className="gl-tech">{it.productId ? `${itemById.get(it.productId)?.wears ?? 0} wears logged` : 'own line'}</span>
                    </div>
                  ))}
                  {!((l.items as ListItem[]) ?? []).length ? <p className="gl-small gl-muted">Empty list — edit it and add something.</p> : null}
                </div>
              </Card>
            ))}
          </div>
        )}

        {otherLists.length ? (
          <Disclosure summary={`${otherLists.length} wish / shopping list${otherLists.length > 1 ? 'es' : ''} stored here too`}>
            <IndexList>
              {otherLists.map((l, i) => (
                <IndexRow
                  key={l.id}
                  no={i + 1}
                  title={l.name}
                  sub={`${((l.items as ListItem[]) ?? []).length} items · kind ${l.kind}`}
                  right={<Chip>{formatDate(l.closedOn ?? null)}</Chip>}
                  onClick={() => navigate('/market')}
                />
              ))}
            </IndexList>
          </Disclosure>
        ) : null}
      </section>

      {/* ---------------------------------------------------------- honesty */}
      <Card variant="flush">
        <KvList
          items={[
            { k: 'Written to', v: 'clothingItems, outfits, lists — real rows in IndexedDB on this device.' },
            { k: 'Cost per wear', v: `price ÷ wears. Nothing else. Unpriced or unworn pieces are excluded rather than estimated.` },
            { k: 'Gaps', v: 'Category counts expressed as observations. No AI looked at your wardrobe and no stylist opinion exists in this app.' },
            {
              k: 'Duplicate check',
              v: 'Seven typed fields on a fixed 24-point frame, grouped by a synonym table that ships inside this app. Photo matching counts differing bits of a stored fingerprint. Both only flag: nothing is deleted, and a merged wear count keeps the number it moved.'
            },
            { k: 'Photos', v: 'Optional, stored locally in mediaItems. The pin wall shows a labelled placeholder when a piece has none.' },
            { k: 'Deletion', v: 'Soft delete with a confirmation step — restore from Settings & Integrations.' }
          ]}
        />
      </Card>

      {/* ------------------------------------------------------------- modals */}
      <ItemModal
        draft={editing}
        onCancel={() => setEditing(null)}
        onSave={(d) => void saveItem(d)}
        media={mediaRows}
        currentMedia={editing?.mediaId ? (mediaById.get(editing.mediaId) ?? null) : null}
      />

      <BulkLogModal
        open={bulkOpen}
        allowed={settings?.allowUploads ?? true}
        onCancel={() => setBulkOpen(false)}
        onLog={(rows, shared) => void logBulk(rows, shared)}
        shared={bulkShared}
        setShared={setBulkShared}
        entries={bulkEntries}
        setEntries={setBulkEntries}
      />

      <SeasonTagAssistModal
        open={Boolean(assist)}
        allowed={settings?.allowUploads ?? true}
        slotLabel={assist ? (coverage.slots.find((s) => s.slot === assist.key)?.slot ?? assist.key) : ''}
        summary={assistInfo?.summary ?? ''}
        piece={assistCurrent}
        photo={assistCurrent?.mediaId ? (mediaById.get(String(assistCurrent.mediaId)) ?? null) : null}
        done={assistDone}
        total={assist ? assist.ids.length : 0}
        pick={assistSeason}
        setPick={setAssistSeason}
        onCancel={() => {
          setAssist(null);
          setAssistSeason('');
        }}
        onSkip={() => {
          if (assistCurrent) skipSeasonTag(assistCurrent);
        }}
        onSave={(season) => {
          if (assistCurrent) void saveSeasonTag(assistCurrent, season);
        }}
      />

      <Modal
        open={Boolean(wearing)}
        onClose={() => setWearing(null)}
        title={`Log a wear on “${wearing?.name ?? ''}”`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setWearing(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void logWear()}>
              <Check size={14} /> Save wear
            </Button>
          </>
        }
      >
        <p className="gl-small gl-muted">
          This adds to the piece's stored wear count ({wearing?.wears ?? 0} logged so far) and sets its last-worn date. Cost per wear
          will recompute from the new total.
        </p>
        <div className="gl-form-row">
          <Field label="How many wears?">
            <TextInput type="number" value={wearDraft.count} onChange={(v) => setWearDraft({ ...wearDraft, count: v })} />
          </Field>
          <DateInput label="Worn on" value={wearDraft.on} onChange={(v) => setWearDraft({ ...wearDraft, on: v })} />
        </div>
        <Field label="Note (optional)">
          <TextInput value={wearDraft.note} onChange={(v) => setWearDraft({ ...wearDraft, note: v })} placeholder="Weather, event, who you met" />
        </Field>
      </Modal>

      <Modal
        open={Boolean(dupAction)}
        onClose={() => setDupAction(null)}
        title={dupAction?.kind === 'merge' ? 'Merge two wear counts' : 'Flag one piece against the other'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDupAction(null)}>
              Cancel — change nothing
            </Button>
            <Button variant="primary" onClick={() => void applyDupAction()}>
              <Check size={14} /> {dupAction?.kind === 'merge' ? 'Move the wears' : 'Write the flag'}
            </Button>
          </>
        }
      >
        {dupKeepRow && dupOtherRow ? (
          <div className="gl-stack">
            <p className="gl-small">
              {dupAction?.kind === 'merge' ? (
                <MergeArithmetic keepRow={dupKeepRow} otherRow={dupOtherRow} currency={currency} />
              ) : (
                <>
                  This writes one note on “{dupOtherRow.name}” pointing at “{dupKeepRow.name}”. Neither row is deleted, merged or
                  reordered, and no wear count changes. The pair stays in the panel above with a “flagged” chip until you clear it.
                </>
              )}
            </p>
            <div className="gl-note">
              Both rows stay in every outfit they appear in. This app has never seen the garments — you are deciding from a
              comparison of your own typed fields.
            </div>
            <Field label="Note to leave on the flagged row (optional)" hint="Stored on the row. Blank leaves the sentence this panel writes by default.">
              <TextArea rows={3} value={dupNote} onChange={(v) => setDupNote(v)} placeholder="Same coat, bought twice in 2023 — keep the darker one in rotation" />
            </Field>
            <div className="gl-row gl-row--tight" style={{ flexWrap: 'wrap' }}>
              <Button size="sm" variant="ghost" onClick={() => { setDupAction(null); setEditing(draftFrom(dupKeepRow)); }}>
                <Pencil size={12} /> Edit “{dupKeepRow.name}” instead
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setDupAction(null); setEditing(draftFrom(dupOtherRow)); }}>
                <Pencil size={12} /> Edit “{dupOtherRow.name}” instead
              </Button>
            </div>
          </div>
        ) : (
          <p className="gl-small gl-muted">One of those rows is no longer in the closet, so there is nothing to merge or flag.</p>
        )}
      </Modal>

      <Modal
        open={Boolean(outfitEditor)}
        onClose={() => setOutfitEditor(null)}
        title={outfitEditor?.id ? 'Edit outfit' : 'Build an outfit from what you own'}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setOutfitEditor(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void saveOutfit()}>
              Save outfit
            </Button>
          </>
        }
      >
        {outfitEditor ? (
          <div className="gl-stack">
            <div className="gl-form-row">
              <Field label="Outfit name">
                <TextInput value={outfitEditor.name} onChange={(v) => setOutfitEditor({ ...outfitEditor, name: v })} placeholder="Friday, client meeting" />
              </Field>
              <Field label="Occasion">
                <TextInput value={outfitEditor.occasion} onChange={(v) => setOutfitEditor({ ...outfitEditor, occasion: v })} placeholder="Work / wedding / errands" />
              </Field>
              <Field label="Season">
                <Select value={outfitEditor.season} onChange={(v) => setOutfitEditor({ ...outfitEditor, season: v })} placeholder="Pick one" options={SEASONS.map((s) => ({ value: s, label: s }))} />
              </Field>
            </div>
            <Field label="Aesthetic words (yours)">
              <TextInput value={outfitEditor.aesthetic} onChange={(v) => setOutfitEditor({ ...outfitEditor, aesthetic: v })} placeholder="quiet, monochrome, slightly severe" />
            </Field>
            <Field label={`Pieces (${outfitEditor.itemIds.length} selected)`} hint="Toggles write the id list into outfits.itemIds — the outfit references your closet, it never copies it.">
              {items.length === 0 ? (
                <span className="gl-small gl-muted">Add pieces to the closet first; an outfit is a list of those rows.</span>
              ) : (
                <div className="cl-pick">
                  {items.map((i) => {
                    const on = outfitEditor.itemIds.includes(i.id);
                    return (
                      <button
                        key={i.id}
                        type="button"
                        data-on={on}
                        aria-pressed={on}
                        onClick={() =>
                          setOutfitEditor({
                            ...outfitEditor,
                            itemIds: on ? outfitEditor.itemIds.filter((x) => x !== i.id) : [...outfitEditor.itemIds, i.id]
                          })
                        }
                      >
                        <span className="gl-serif">{i.name}</span>
                        <span className="gl-tech">{i.category} · {i.wears ?? 0} wears</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </Field>
            <div className="gl-row gl-row--between">
              <Field label="Your rating">
                <Rating value={outfitEditor.rating} onChange={(v) => setOutfitEditor({ ...outfitEditor, rating: v })} />
              </Field>
              <div>
                <div className="gl-field__label" style={{ marginBottom: 6 }}>Outfit photograph</div>
                <PhotoPicker
                  kind="outfit"
                  album="Outfits"
                  label={outfitEditor.mediaId ? 'Replace photograph' : 'Add photograph'}
                  onPick={(rows) => setOutfitEditor({ ...outfitEditor, mediaId: rows[0]?.id ?? null })}
                />
              </div>
            </div>
            <div className="gl-row gl-row--tight" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
              <Button
                size="sm"
                disabled={!editorOutfitRow || sheetBusy === String(outfitEditor.id)}
                onClick={() => editorOutfitRow && void makeFitSheet(editorOutfitRow, outfitEditor.itemIds)}
              >
                <LayoutGrid size={13} /> {sheetBusy === String(outfitEditor.id) ? 'Composing…' : 'Fit sheet from these piece photos'}
              </Button>
              <span className="gl-small gl-faint">
                {photographedOf(outfitEditor.itemIds)} of {outfitEditor.itemIds.length} selected pieces hold a photo on this device
                {editorOutfitRow ? '' : ' · save the outfit once first, so the sheet has a record to attach to'}
              </span>
            </div>
            <Field label="Note">
              <TextArea value={outfitEditor.note} onChange={(v) => setOutfitEditor({ ...outfitEditor, note: v })} rows={3} placeholder="What worked, what you'd change" />
            </Field>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(packEditor)}
        onClose={() => setPackEditor(null)}
        title={packEditor?.id ? 'Edit packing list' : 'New packing list'}
        wide
        footer={
          <>
            <Button variant="ghost" onClick={() => setPackEditor(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void savePacking()}>
              <Package size={14} /> Store list
            </Button>
          </>
        }
      >
        {packEditor ? (
          <div className="gl-stack">
            <div className="gl-form-row">
              <Field label="Trip / bag name">
                <TextInput value={packEditor.name} onChange={(v) => setPackEditor({ ...packEditor, name: v })} placeholder="Lisbon, 6 days, one carry-on" />
              </Field>
              <DateInput label="Departing" value={packEditor.departOn} onChange={(v) => setPackEditor({ ...packEditor, departOn: v })} />
              <DateInput label="Returning (optional)" value={packEditor.returnOn} onChange={(v) => setPackEditor({ ...packEditor, returnOn: v })} />
            </div>
            <Field label={`Closet pieces (${packEditor.itemIds.length})`}>
              {items.length === 0 ? (
                <span className="gl-small gl-muted">No closet pieces yet — you can still write free-text lines below.</span>
              ) : (
                <div className="cl-pick">
                  {items.map((i) => {
                    const on = packEditor.itemIds.includes(i.id);
                    return (
                      <button
                        key={i.id}
                        type="button"
                        data-on={on}
                        aria-pressed={on}
                        onClick={() =>
                          setPackEditor({
                            ...packEditor,
                            itemIds: on ? packEditor.itemIds.filter((x) => x !== i.id) : [...packEditor.itemIds, i.id]
                          })
                        }
                      >
                        <span className="gl-serif">{i.name}</span>
                        <span className="gl-tech">{i.category} · last worn {formatDate(lastWornOf(i))}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </Field>
            <Field label="Other lines" hint="Each Enter press adds one stored item; ticks are saved per row.">
              <TagInput values={packEditor.extras} onChange={(v) => setPackEditor({ ...packEditor, extras: v })} placeholder="e.g. travel steamer, 3 pairs of socks" />
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
          <strong>{confirmDel?.label}</strong> will be marked deleted. Outfits and packing lists that reference it will keep the id and
          label the missing piece rather than silently rewriting your history.
        </p>
        <p className="gl-small gl-muted">Nothing is erased from disk; restore is available under Settings &amp; Integrations.</p>
      </Modal>
    </div>
  );
}

/* ---------------------------------------------------------------- sub-views */

type DupPair = ReturnType<typeof duplicatePairs>[number];

/**
 * One candidate pair as the walk sees it: the pair object `DupPairCard` renders,
 * the queue's own identity for it, and the photograph distance when the pixel
 * check reached these two rows as well.
 */
type ReviewPairView = {
  id: string;
  pair: DupPair;
  queue: QueuePair;
  photo: { key: string; left: AnyRow; right: AnyRow; distance: number; bits: number } | null;
  rows: string[];
};

/** The row a merge gives up its wears: whichever side `keeper(a, b)` did not choose. */
function otherOf(pair: QueuePair): string {
  return pair.keeperId === pair.aId ? pair.bId : pair.aId;
}

/**
 * The merge arithmetic, computed in one place so the confirm step and the review
 * queue cannot print two different sums for the same two rows.
 */
function mergeNumbers(keep: AnyRow, other: AnyRow) {
  const move = other.wears ?? 0;
  const after = (keep.wears ?? 0) + move;
  return {
    move,
    after,
    cpwBefore: costPerWear(keep.price ?? null, keep.wears ?? 0),
    cpwAfter: costPerWear(keep.price ?? null, after)
  };
}

function MergeArithmetic({ keepRow, otherRow, currency }: { keepRow: AnyRow; otherRow: AnyRow; currency: string }) {
  const { move, after, cpwBefore, cpwAfter } = mergeNumbers(keepRow, otherRow);
  return (
    <>
      “{keepRow.name}” has {keepRow.wears ?? 0} logged wears and “{otherRow.name}” has {otherRow.wears ?? 0}. This adds them:{' '}
      {keepRow.wears ?? 0} + {move} = <span className="gl-strong">{after} wears</span> on “{keepRow.name}”, and {otherRow.name} goes to
      zero with its own number stored on it ({move ? `wearsBeforeMerge = ${move}` : 'nothing to store — it was already at zero'}).
      {cpwBefore === null && cpwAfter === null
        ? ' Cost per wear stays unverified — at least one of the two numbers is missing.'
        : cpwBefore === null
          ? ` Cost per wear becomes ${fmtMoney(cpwAfter as number, currency)} on “${keepRow.name}” = ${fmtMoney(keepRow.price ?? null, currency)} ÷ ${after} wears.`
          : ` Cost per wear on “${keepRow.name}” moves from ${fmtMoney(cpwBefore, currency)} to ${fmtMoney(cpwAfter as number, currency)} = ${fmtMoney(keepRow.price ?? null, currency)} ÷ ${after} wears.`}
    </>
  );
}

function quote(value: string): string {
  return value.trim() ? `“${value.trim()}”` : 'blank';
}

function DupSide({
  row,
  sig,
  isKeeper,
  currency,
  photo,
  onEdit
}: {
  row: AnyRow;
  sig: WardrobeSignature;
  isKeeper: boolean;
  currency: string;
  photo: AnyRow | null;
  onEdit: () => void;
}) {
  const cpw = costPerWear(row.price ?? null, row.wears ?? 0);
  const costLine =
    row.price === null || row.price === undefined
      ? 'no price logged — cost per wear unverified'
      : cpw === null
        ? `${fmtMoney(Number(row.price), currency)} paid · ${row.wears ?? 0} wears · cost per wear unverified`
        : `${fmtMoney(cpw, currency)} per wear = ${fmtMoney(Number(row.price), currency)} ÷ ${row.wears} wears`;
  return (
    <div className="cl-dup__side" data-keeper={isKeeper ? 'true' : 'false'}>
      {photo ? <ImageTile item={photo} caption="your photo" /> : null}
      <div className="gl-serif cl-dup__name">{row.name}</div>
      {row.brand ? <div className="gl-small gl-muted">{row.brand}</div> : null}
      <div className="gl-tech">
        {row.wears ?? 0} wears · last worn {formatDate(lastWornOf(row))} · {conditionOf(row)}
      </div>
      <div className={`gl-tech cl-cpw${cpw === null ? ' cl-cpw--unknown' : ''}`}>{costLine}</div>
      <div className="cl-dup__axes">
        {AXES.filter((ax) => ax !== 'name').map((ax) => (
          <span key={ax}>
            <em>{ax}</em> {quote(sig.axes[ax].typed)}
          </span>
        ))}
      </div>
      {dupNoteOf(row) ? <div className="gl-small gl-faint">Note on this row: “{dupNoteOf(row)}”</div> : null}
      <div className="gl-row gl-row--tight" style={{ flexWrap: 'wrap' }}>
        {isKeeper ? <Chip tone="gold">keeper if you merge</Chip> : null}
        {mergedIntoOf(row) ? <Chip tone="info">wears merged away</Chip> : dupOf(row) ? <Chip tone="weak">flagged</Chip> : null}
        <Button size="sm" variant="ghost" onClick={onEdit}>
          <Pencil size={12} /> Edit piece
        </Button>
      </div>
    </div>
  );
}

function DupPairCard({
  pair,
  left,
  right,
  photo,
  currency,
  mediaById,
  onEdit,
  onAction,
  onClear,
  onUndo
}: {
  pair: DupPair;
  left: AnyRow;
  right: AnyRow;
  photo: { distance: number; bits: number } | null;
  currency: string;
  mediaById: Map<string, AnyRow>;
  onEdit: (row: AnyRow) => void;
  onAction: (kind: 'merge' | 'mark', keeperId: string, otherId: string) => void;
  onClear: (row: AnyRow) => void;
  onUndo: (row: AnyRow) => void;
}) {
  const keepId = pair.keeperId;
  const otherId = keepId === left.id ? right.id : left.id;
  const keepRow = keepId === left.id ? left : right;
  const otherRow = otherId === left.id ? left : right;
  const flagged = [left, right].filter((r) => dupOf(r));
  const merged = [left, right].filter((r) => mergedIntoOf(r));
  const photoOf = (row: AnyRow) => (row.mediaId ? (mediaById.get(String(row.mediaId)) ?? null) : null);
  return (
    <div className="cl-dup">
      <div className="cl-dup__head">
        <div>
          <div className="gl-serif cl-dup__title">
            {left.name} <span className="gl-faint">against</span> {right.name}
          </div>
          <div className="gl-tech">
            {pair.sim.matched} of 24 points · {pair.sim.compared} points comparable · ceiling{' '}
            {(pair.sim.ceiling * 100).toFixed(0)}% · certainty on the covered fields {(pair.sim.certainty * 100).toFixed(0)}%
          </div>
        </div>
        <Chip tone={pair.score >= 0.85 ? 'danger' : 'limited'}>{(pair.score * 100).toFixed(0)}% match</Chip>
      </div>

      <div className="cl-dup__sides">
        <DupSide row={left} sig={pair.a} isKeeper={keepId === left.id} currency={currency} photo={photoOf(left)} onEdit={() => onEdit(left)} />
        <DupSide row={right} sig={pair.b} isKeeper={keepId === right.id} currency={currency} photo={photoOf(right)} onEdit={() => onEdit(right)} />
      </div>

      {pair.sim.why.length ? (
        <ul className="cl-dup__why">
          {pair.sim.why.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      ) : null}

      {pair.sim.differs.length ? (
        <div className="gl-small gl-muted">
          Where your own rows disagree:{' '}
          {pair.sim.differs.map((d) => `${d.axis} — ${quote(d.a)} against ${quote(d.b)}`).join('; ')}
        </div>
      ) : null}

      {pair.sim.missing.length ? (
        <Disclosure summary={`${pair.sim.missing.length} field${pair.sim.missing.length === 1 ? '' : 's'} one or both of you left blank`}>
          <ul className="cl-dup__why">
            {pair.sim.missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
          <p className="gl-small gl-faint">
            A blank field adds no points to either side, which is why this pair scores {(pair.score * 100).toFixed(0)}% and not
            higher: {((pair.sim.compared / 24) * 100).toFixed(0)}% of the frame was comparable at all. Fill the field on either row
            and the number moves — it is never guessed in the meantime.
          </p>
        </Disclosure>
      ) : null}

      {photo ? (
        <div className="cl-dup__pixel gl-tech">
          Their photographs differ on {photo.distance} of {photo.bits} fingerprint bits — the pixel check, independent of anything
          you typed.
        </div>
      ) : null}

      <div className="gl-row gl-row--tight" style={{ flexWrap: 'wrap' }}>
        <Button size="sm" onClick={() => onAction('mark', keepId, otherId)}>
          <Copy size={12} /> Flag “{otherRow.name}” against “{keepRow.name}”
        </Button>
        {merged.length === 0 ? (
          <Button size="sm" variant="danger" onClick={() => onAction('merge', keepId, otherId)}>
            <ShieldAlert size={12} /> Merge wears onto “{keepRow.name}”
          </Button>
        ) : null}
        {merged.map((r) => (
          <Button key={r.id} size="sm" variant="ghost" onClick={() => onUndo(r)}>
            <Undo2 size={12} /> Undo the merge on “{r.name}” — {Number(r.data?.wearsBeforeMerge ?? r.data?.mergedWears ?? 0)} wears
            go back
          </Button>
        ))}
        {flagged.map((r) => (
          <Button key={r.id} size="sm" variant="ghost" onClick={() => onClear(r)}>
            <Undo2 size={12} /> Clear the flag on “{r.name}”
          </Button>
        ))}
      </div>
      <p className="gl-small gl-faint">
        The keeper rule, printed rather than assumed: more logged wears wins ({keepRow.wears ?? 0} on “{keepRow.name}” against{' '}
        {otherRow.wears ?? 0} on “{otherRow.name}”), otherwise the earlier acquisition date, otherwise the row id — so the answer
        is the same every time you open this page.
      </p>
    </div>
  );
}

function SectionedOutfits({
  outfits,
  itemById,
  mediaById,
  currency,
  sheetBusy,
  photographedOf,
  onNew,
  onEdit,
  onWear,
  onFitSheet,
  onDelete,
  onPickItem
}: {
  outfits: AnyRow[];
  itemById: Map<string, AnyRow>;
  mediaById: Map<string, AnyRow>;
  currency: string;
  sheetBusy: string;
  photographedOf: (ids: string[]) => number;
  onNew: () => void;
  onEdit: (o: AnyRow) => void;
  onWear: (o: AnyRow) => void;
  onFitSheet: (o: AnyRow) => void;
  onDelete: (o: AnyRow) => void;
  onPickItem: (id: string) => void;
}) {
  const totalWorn = outfits.reduce((s, o) => s + (o.wornCount ?? 0), 0);
  return (
    <section className="gl-section">
      <div className="gl-section__title">
        <div>
          <div className="gl-eyebrow">Combinations</div>
          <h2>Outfits you actually assembled</h2>
        </div>
        <div className="gl-row gl-row--tight">
          <Chip tone="gold">{outfits.length} stored</Chip>
          <Chip>{totalWorn} outfit wears logged</Chip>
          <Button size="sm" variant="primary" onClick={onNew}>
            <Plus size={13} /> New outfit
          </Button>
        </div>
      </div>

      {outfits.length === 0 ? (
        <Card>
          <CardHead title="No outfit records yet" sub="An outfit is one row that references several clothing item ids." />
          <p className="gl-small gl-muted">
            Build one once you have at least two pieces. Wearing it is a single button that writes wornCount and a date, so repeating a
            look is recorded rather than remembered.
          </p>
          <Button variant="primary" size="sm" onClick={onNew}>
            Build the first outfit
          </Button>
        </Card>
      ) : (
        <div className="gl-split">
          <IndexList>
            {outfits.map((o, idx) => (
              <IndexRow
                key={o.id}
                no={idx + 1}
                title={o.name}
                sub={`${((o.itemIds as string[]) ?? []).length} pieces · ${o.wornCount ?? 0} wears · ${formatDate(o.lastWornOn ?? null)}`}
                right={
                  <>
                    <Chip>{o.occasion || 'no occasion'}</Chip>
                    <Chip tone="gold">{fmtMoney(((o.itemIds as string[]) ?? []).reduce((s, id) => s + (typeof itemById.get(id)?.price === 'number' ? Number(itemById.get(id)?.price) : 0), 0), currency)}</Chip>
                  </>
                }
                onClick={() => onEdit(o)}
              />
            ))}
          </IndexList>
          <div className="gl-stack">
            {outfits.slice(0, 3).map((o) => {
              const its = ((o.itemIds as string[]) ?? []).map((id) => itemById.get(id));
              const media = o.mediaId ? mediaById.get(o.mediaId as string) : null;
              const shots = photographedOf((o.itemIds as string[]) ?? []);
              const sheet = o.data?.sheetMediaId ? mediaById.get(String(o.data.sheetMediaId)) : null;
              const busy = sheetBusy === String(o.id);
              return (
                <Card key={o.id}>
                  <CardHead
                    title={o.name}
                    eyebrow={`${o.season || 'any season'} · worn ${o.wornCount ?? 0}×`}
                    right={
                      <>
                        <Button size="sm" onClick={() => onWear(o)}>
                          <Repeat size={13} /> Wore it
                        </Button>
                        <IconButton label={`Delete ${o.name}`} onClick={() => onDelete(o)}>
                          <Trash2 size={14} />
                        </IconButton>
                      </>
                    }
                  />
                  <div className="gl-row gl-row--tight" style={{ flexWrap: 'wrap' }}>
                    {its.map((i, n) =>
                      i ? (
                        <Chip key={n} onClick={() => onPickItem(i.id)} title="Open this piece">
                          {i.name}
                        </Chip>
                      ) : (
                        <Chip key={n} tone="danger">
                          piece removed
                        </Chip>
                      )
                    )}
                    {!its.length ? <span className="gl-small gl-muted">No pieces attached.</span> : null}
                  </div>
                  {o.note ? <p className="gl-small gl-muted">{o.note}</p> : null}
                  {media ? <ImageTile item={media} caption={formatDate(media.takenOn)} /> : null}
                  {sheet ? (
                    <ImageTile
                      raw
                      item={sheet}
                      caption={`Fit sheet — ${o.data?.sheetPieces ?? shots} of ${((o.itemIds as string[]) ?? []).length} pieces, from their own stored photographs. Not a photo of the outfit worn.`}
                    />
                  ) : null}
                  <div className="gl-row gl-row--tight">
                    <Button size="sm" variant={sheet ? 'ghost' : 'default'} disabled={busy} onClick={() => onFitSheet(o)}>
                      <LayoutGrid size={13} /> {busy ? 'Composing…' : sheet ? 'Re-compose fit sheet' : 'Fit sheet from piece photos'}
                    </Button>
                    <span className="gl-small gl-faint">{shots} of {((o.itemIds as string[]) ?? []).length} pieces photographed</span>
                  </div>
                  <Rating value={o.rating ?? 0} />
                </Card>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------- item editor */

function ItemModal({
  draft,
  onCancel,
  onSave,
  media,
  currentMedia
}: {
  draft: ItemDraft | null;
  onCancel: () => void;
  onSave: (d: ItemDraft) => void;
  media: AnyRow[];
  currentMedia: AnyRow | null;
}) {
  const [d, setD] = useState<ItemDraft | null>(draft);
  useEffect(() => setD(draft), [draft]);
  if (!d) return null;
  const subs = CATEGORIES.find((c) => c.name === d.category)?.subs ?? [];
  const cpw = costPerWear(parseAmount(d.price), parseAmount(d.wears) ?? 0);

  return (
    <Modal
      open
      onClose={onCancel}
      wide
      title={d.id ? `Edit — ${d.name || 'unnamed piece'}` : 'Add a piece to the closet'}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => onSave(d)}>
            {d.id ? 'Save changes' : 'Store this piece'}
          </Button>
        </>
      }
    >
      <div className="gl-form-row">
        <Field label="Name" hint="Whatever you call it in your head.">
          <TextInput value={d.name} onChange={(v) => setD({ ...d, name: v })} placeholder="Navy wool coat" />
        </Field>
        <Field label="Category">
          <Select value={d.category} onChange={(v) => setD({ ...d, category: v, subcategory: '' })} options={CATEGORIES.map((c) => ({ value: c.name, label: c.name }))} />
        </Field>
        <Field label="Subcategory">
          <Select value={d.subcategory} onChange={(v) => setD({ ...d, subcategory: v })} placeholder="Unspecified" options={subs.map((s) => ({ value: s, label: s }))} />
        </Field>
        <Field label="Brand / maker">
          <TextInput value={d.brand} onChange={(v) => setD({ ...d, brand: v })} placeholder="Only if you remember it" />
        </Field>
        <Field label="Size as written on the label">
          <TextInput value={d.size} onChange={(v) => setD({ ...d, size: v })} placeholder="M / 38 / 7.5" />
        </Field>
        <Field label="Material">
          <TextInput value={d.material} onChange={(v) => setD({ ...d, material: v })} placeholder="98% cotton, 2% elastane" />
        </Field>
        <Field label="Fit">
          <Select value={d.fit} onChange={(v) => setD({ ...d, fit: v })} options={FITS.map((f) => ({ value: f, label: f }))} />
        </Field>
        <Field label="Condition">
          <Select value={d.condition} onChange={(v) => setD({ ...d, condition: v })} options={CONDITIONS.map((c) => ({ value: c, label: c }))} />
        </Field>
      </div>

      <Field label="Colours" hint="Hex codes render as swatches; words work too. Only what you type here reaches the pairing key — Personal Colour applies a palette name as a tag, which is not a colour measurement.">
        <TagInput values={d.colors} onChange={(v) => setD({ ...d, colors: v })} placeholder="#2d3b4a or charcoal" />
      </Field>
      {d.colors.some((c) => /^#[0-9a-f]{6}$/i.test(c)) ? <Swatches colors={d.colors.filter((c) => /^#[0-9a-f]{3,8}$/i.test(c))} size={22} /> : null}

      <div className="gl-form-row">
        <Field label="Seasons">
          <TagInput values={d.seasons} onChange={(v) => setD({ ...d, seasons: v })} placeholder="Add a season, press Enter" />
        </Field>
        <Field label="Occasions">
          <TagInput values={d.occasions} onChange={(v) => setD({ ...d, occasions: v })} placeholder="Interview, Sunday, cold commute" />
        </Field>
      </div>

      <div className="gl-form-row">
        <Field label="Acquisition cost (number only)" hint="Leave blank if unknown — the piece is then excluded from cost maths.">
          <TextInput type="number" value={d.price} onChange={(v) => setD({ ...d, price: v })} placeholder="148" />
        </Field>
        <DateInput label="Bought / acquired on" value={d.boughtOn} onChange={(v) => setD({ ...d, boughtOn: v })} />
        <Field label="Times worn" hint="Edit directly if you are reconstructing history.">
          <TextInput type="number" value={d.wears} onChange={(v) => setD({ ...d, wears: v })} />
        </Field>
        <DateInput label="Last worn (optional)" value={d.lastWornOn} onChange={(v) => setD({ ...d, lastWornOn: v })} />
      </div>

      <div className="gl-inset">
        <div className="gl-label">Live cost per wear</div>
        {cpw === null ? (
          <div className="gl-tech cl-cpw--unknown">
            Not computable: needs a price and at least one wear. You have price={d.price || 'blank'}, wears={d.wears || '0'}.
          </div>
        ) : (
          <div className="gl-tech">
            {d.price} ÷ {d.wears} = <span className="cl-cpw">{cpw.toFixed(2)}</span> per wear
          </div>
        )}
      </div>

      <Field label="Care notes">
        <TextArea value={d.careNotes} onChange={(v) => setD({ ...d, careNotes: v })} rows={2} placeholder="Cold wash, no dryer, steam only" />
      </Field>

      <div className="gl-row gl-row--between" style={{ alignItems: 'flex-end', marginTop: 'var(--glow-sp-4)' }}>
        <div>
          <div className="gl-field__label" style={{ marginBottom: 6 }}>Photograph</div>
          <PhotoPicker kind="upload" album="Closet" label={d.mediaId ? 'Replace photograph' : 'Add photograph'} onPick={(rows) => setD({ ...d, mediaId: rows[0]?.id ?? d.mediaId })} />
          <div className="gl-tech" style={{ marginTop: 6 }}>{media.length} images in your local library already</div>
        </div>
        {currentMedia ? <div style={{ width: 132 }}><ImageTile item={currentMedia} caption="attached" /></div> : null}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------- bulk piece logging */

interface BulkEntry {
  file: File;
  url: string;
  name: string;
  price: string;
}

interface BulkShared {
  category: string;
  subcategory: string;
  brand: string;
  size: string;
  material: string;
  fit: string;
  condition: string;
  seasons: string[];
  occasions: string[];
  boughtOn: string;
}

const nameFromFile = (file: File) => file.name.replace(/\.[^./\\]+$/, '').replace(/[-_]+/g, ' ').trim();

/* ------------------------------------------------ coverage-hole tagging pass */

/**
 * One piece at a time out of a coverage hole, modelled on `BulkLogModal`'s shape
 * and lifted-state idiom and deliberately doing the opposite of what that dialog
 * does: it never writes one shared value across a set. A season is a claim about
 * one garment, so exactly one row is on screen, the save button is dead until she
 * chooses a word for *that* piece, and skipping writes nothing at all. The
 * photograph is decoration when this device holds one and the privacy switch
 * allows it, and absent otherwise — the tagging works either way, because this app
 * has never seen the clothing and does not read a season off a picture.
 */
function SeasonTagAssistModal({
  open,
  allowed,
  slotLabel,
  summary,
  piece,
  photo,
  done,
  total,
  pick,
  setPick,
  onCancel,
  onSkip,
  onSave
}: {
  open: boolean;
  allowed: boolean;
  slotLabel: string;
  summary: string;
  piece: AnyRow | null;
  photo: AnyRow | null;
  done: number;
  total: number;
  pick: string;
  setPick: (v: string) => void;
  onCancel: () => void;
  onSkip: () => void;
  onSave: (season: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  if (!open) return null;

  const run = (fn: () => void) => {
    setBusy(true);
    fn();
    setBusy(false);
  };

  return (
    <Modal
      open
      wide
      onClose={onCancel}
      title={piece ? `Which season? — ${slotLabel}` : `Nothing left to ask in ${slotLabel}`}
      footer={
        piece ? (
          <>
            <Button variant="ghost" onClick={onCancel}>
              Stop here
            </Button>
            <button
              type="button"
              className="gl-btn gl-btn--ghost"
              data-testid="assist-skip"
              onClick={() => run(onSkip)}
              disabled={busy}
            >
              Skip this piece
            </button>
            <button
              type="button"
              className="gl-btn gl-btn--primary"
              data-testid="assist-save"
              disabled={busy || !pick}
              onClick={() => run(() => onSave(pick))}
            >
              <Check size={14} /> Save for this piece
            </button>
          </>
        ) : (
          <Button variant="primary" onClick={onCancel}>
            <Check size={14} /> Done
          </Button>
        )
      }
    >
      <div className="cl-assist" data-testid="coverage-assist">
        <p className="gl-small gl-muted">{summary}</p>

      {piece ? (
        <>
          <div className="gl-serif cl-assist__step" data-testid="assist-progress">
            {tagAssistStep(String(piece.name ?? ''), done, total)}
          </div>

          <div className="gl-row gl-row--tight" style={{ alignItems: 'flex-start', flexWrap: 'wrap' }}>
            {allowed && photo ? (
              <div style={{ width: 148, flex: '0 0 148px' }}>
                <ImageTile item={photo} caption="your photo" />
              </div>
            ) : (
              <div className="gl-inset cl-assist__nophoto">
                <span className="gl-small gl-muted">
                  {allowed
                    ? 'No photograph on this device for the piece you are looking at.'
                    : 'Photographs are switched off under Settings → Privacy, so nothing is shown here. A season tag does not need one — you are the one who knows what this piece is for.'}
                </span>
              </div>
            )}

            <div className="cl-assist__fields" data-testid="assist-piece">
              <div className="gl-serif cl-assist__name">{piece.name}</div>
              <div className="gl-tech">
                {piece.category}
                {subcategoryOf(piece) ? ` · ${subcategoryOf(piece)}` : ''} · {piece.wears ?? 0} wears · last worn{' '}
                {formatDate(lastWornOf(piece))}
              </div>
              {((piece.occasions as string[]) ?? []).length ? (
                <div className="gl-small gl-muted">Occasions you wrote on it: {(piece.occasions as string[]).join(', ')}</div>
              ) : (
                <div className="gl-small gl-faint">No occasion written on this row.</div>
              )}
              <div className="gl-small gl-faint">
                Seasons on this row right now: none — that is the whole reason this piece is in front of you.
              </div>
            </div>
          </div>

          <div className="cl-assist__choices">
            <div className="gl-label">Choose a season for “{piece.name}”</div>
            <div className="gl-row gl-row--tight" style={{ flexWrap: 'wrap' }}>
              {SEASONS.map((season) => (
                <button
                  key={season}
                  type="button"
                  className={`gl-chip gl-chip--clickable ${pick === season ? 'gl-chip--on' : ''}`}
                  data-testid="assist-season"
                  data-season={season}
                  onClick={() => setPick(pick === season ? '' : season)}
                >
                  {season}
                </button>
              ))}
            </div>
            <p className="gl-small gl-faint">
              {pick
                ? `Saving writes ${pick} on this one row. The other pieces in this set keep whatever they have, including nothing.`
                : 'Nothing is chosen yet. This dialog will not guess from the name, the category or the photograph — pick a word, or skip the piece and leave it exactly as it is.'}
            </p>
          </div>
        </>
      ) : (
        <div className="gl-note">
          <p className="gl-small">
            Every piece that was in this set now has an answer from you — a season, or a skip that left it alone. Closing this does
            not touch anything else; the matrix behind it re-counts on its own, so a hole that filled stays filled and one that did
            not is still printed as a hole.
          </p>
        </div>
      )}
      </div>
    </Modal>
  );
}

/**
 * One photograph in, one closet row out — the naming and the shared fields are
 * typed here, the writing happens in the page so the row shape stays the one
 * `payloadFrom` produces everywhere else. Nothing recognises a garment: the
 * default name is the file's own name, nothing else.
 */
function BulkLogModal({
  open,
  allowed,
  onCancel,
  onLog,
  shared,
  setShared,
  entries,
  setEntries
}: {
  open: boolean;
  allowed: boolean;
  onCancel: () => void;
  onLog: (rows: BulkEntry[], shared: BulkShared) => void;
  shared: BulkShared;
  setShared: (s: BulkShared) => void;
  entries: BulkEntry[];
  setEntries: (e: BulkEntry[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const take = (fileList: FileList | null) => {
    const files = Array.from(fileList ?? []).filter((f) => f.type.startsWith('image/'));
    if (inputRef.current) inputRef.current.value = '';
    if (!files.length) return;
    const added: BulkEntry[] = files.map((file) => {
      let url = '';
      try {
        url = URL.createObjectURL(file);
      } catch {
        url = '';
      }
      return { file, url, name: nameFromFile(file), price: '' };
    });
    setEntries([...entries, ...added]);
  };

  const drop = (at: number) => {
    const gone = entries[at];
    if (gone?.url) URL.revokeObjectURL(gone.url);
    setEntries(entries.filter((_, n) => n !== at));
  };

  const clearAll = () => {
    for (const e of entries) if (e.url) URL.revokeObjectURL(e.url);
    setEntries([]);
  };

  if (!open) return null;
  const named = entries.filter((e) => e.name.trim()).length;
  const subs = CATEGORIES.find((c) => c.name === shared.category)?.subs ?? [];

  return (
    <Modal
      open
      wide
      onClose={onCancel}
      title="Log several pieces at once"
      footer={
        <>
          <Button variant="ghost" onClick={clearAll} disabled={!entries.length}>
            Clear the pile
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={busy || !named || !allowed}
            onClick={() => {
              setBusy(true);
              void (async () => {
                await onLog(entries.filter((e) => e.name.trim()), shared);
                setBusy(false);
              })();
            }}
          >
            <Check size={14} /> Store {named} piece{named === 1 ? '' : 's'}
          </Button>
        </>
      }
    >
      <p className="gl-small gl-muted">
        Choose one photograph per garment. Each picture becomes its own stored image and its own closet row, with the fields below
        written onto every row in the pile — so it is fifty names and one category, not fifty forms. Names default to the file's own
        name because this app does not recognise clothing; it never looked at your clothes, only at what you typed.
      </p>

      <div className="gl-row gl-row--tight" style={{ alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <input ref={inputRef} type="file" accept="image/*" multiple hidden disabled={!allowed} onChange={() => take(inputRef.current?.files ?? null)} />
        <Button onClick={() => inputRef.current?.click()} disabled={!allowed}>
          <Plus size={14} /> Choose photographs
        </Button>
        <span className="gl-small gl-faint">{entries.length} in the pile · {named} named</span>
      </div>

      {!allowed ? (
        <div className="gl-inset">
          <span className="gl-small gl-muted">
            Adding photographs is switched off in Settings → Privacy, so nothing here can be stored. Switch it on, or log the pieces
            without pictures using “Add a piece”.
          </span>
        </div>
      ) : null}

      {entries.length ? (
        <div className="gl-stack">
          {entries.map((e, n) => (
            <div key={`${e.file.name}-${n}`} className="gl-row gl-row--tight" style={{ alignItems: 'center' }}>
              <div style={{ width: 74, flex: '0 0 74px' }}>
                {e.url ? (
                  <img src={e.url} alt="" style={{ width: '100%', height: 74, objectFit: 'cover', border: '1px solid var(--glow-line)' }} />
                ) : (
                  <div className="gl-tech" style={{ height: 74, display: 'grid', placeItems: 'center' }}>no preview</div>
                )}
              </div>
              <Field label={`Name ${n + 1}`} hint={e.file.name}>
                <TextInput value={e.name} onChange={(v) => setEntries(entries.map((x, i) => (i === n ? { ...x, name: v } : x)))} />
              </Field>
              <Field label="Cost">
                <TextInput
                  type="number"
                  value={e.price}
                  onChange={(v) => setEntries(entries.map((x, i) => (i === n ? { ...x, price: v } : x)))}
                  placeholder="blank = unknown"
                />
              </Field>
              <IconButton label={`Take ${e.name || 'this photo'} out of the pile`} onClick={() => drop(n)}>
                <Trash2 size={14} />
              </IconButton>
            </div>
          ))}
        </div>
      ) : (
        <div className="gl-inset">
          <span className="gl-small gl-muted">Nothing chosen yet. The pile builds on this device; no file leaves it.</span>
        </div>
      )}

      <div className="gl-form-row">
        <Field label="Category for all of them">
          <Select
            value={shared.category}
            onChange={(v) => setShared({ ...shared, category: v, subcategory: '' })}
            options={CATEGORIES.map((c) => ({ value: c.name, label: c.name }))}
          />
        </Field>
        <Field label="Subcategory">
          <Select value={shared.subcategory} onChange={(v) => setShared({ ...shared, subcategory: v })} placeholder="Unspecified" options={subs.map((s) => ({ value: s, label: s }))} />
        </Field>
        <Field label="Brand / maker">
          <TextInput value={shared.brand} onChange={(v) => setShared({ ...shared, brand: v })} placeholder="Same shop for the lot?" />
        </Field>
        <Field label="Size on the label">
          <TextInput value={shared.size} onChange={(v) => setShared({ ...shared, size: v })} placeholder="M / 38 / 7.5" />
        </Field>
        <Field label="Material">
          <TextInput value={shared.material} onChange={(v) => setShared({ ...shared, material: v })} placeholder="98% cotton, 2% elastane" />
        </Field>
        <Field label="Fit">
          <Select value={shared.fit} onChange={(v) => setShared({ ...shared, fit: v })} options={FITS.map((f) => ({ value: f, label: f }))} />
        </Field>
        <Field label="Condition">
          <Select value={shared.condition} onChange={(v) => setShared({ ...shared, condition: v })} options={CONDITIONS.map((c) => ({ value: c, label: c }))} />
        </Field>
        <DateInput label="Acquired on" value={shared.boughtOn} onChange={(v) => setShared({ ...shared, boughtOn: v })} />
      </div>
      <div className="gl-form-row">
        <Field label="Seasons for all">
          <TagInput values={shared.seasons} onChange={(v) => setShared({ ...shared, seasons: v })} placeholder="Add a season, press Enter" />
        </Field>
        <Field label="Occasions for all">
          <TagInput values={shared.occasions} onChange={(v) => setShared({ ...shared, occasions: v })} placeholder="Everyday, Interview" />
        </Field>
      </div>
    </Modal>
  );
}
