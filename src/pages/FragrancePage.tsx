/**
 * THE GLOW LAB — Fragrance Studio (spec Part 20).
 *
 * A scent library with no nose in it. Every word about how anything smells is
 * a word the user chose about their own skin on their own day; this department
 * never states that a bottle contains anything, never quotes a house's pyramid
 * as fact, never invents a price and never reports someone else's longevity.
 * Wear tests are observations with a date and a weather line; the decant plan
 * is a real experiment row; the want list is measured against a budget the
 * user typed.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  BadgeCheck,
  Droplets,
  FlaskConical,
  Flower2,
  Gauge,
  Layers,
  Pencil,
  Plus,
  Repeat,
  RotateCcw,
  Search,
  ShoppingBag,
  Snowflake,
  Sun,
  Timer,
  Trash2,
  TriangleAlert,
  Wallet
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
  Rating,
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
import { Chipbar, DeptIntro, EmptyPlate, IndexList, IndexRow, KvList, PullQuote, StatStrip, Timeline } from '../ui/editorial';
import { ImageTile, PhotoPicker } from '../ui/media';
import '../styles/departments/fragrance.css';

/* ------------------------------------------------------------------ taxonomy */

type StatusKey = 'own' | 'sample' | 'want' | 'finished';

const STATUSES: { value: StatusKey; label: string; meaning: string }[] = [
  { value: 'own', label: 'Owned', meaning: 'a bottle you physically have' },
  { value: 'sample', label: 'Sample / decant', meaning: 'vial, sprayer or puff — not a commitment' },
  { value: 'want', label: 'Wanted', meaning: 'not owned; price is whatever you found, not what we guess' },
  { value: 'finished', label: 'Finished', meaning: 'used up, kept for the record' }
];

const CONCENTRATIONS = ['EDT', 'EDP', 'Parfum / extrait', 'EDC / splash', 'Body spray', 'Not printed on the bottle'];
const SEASONS = ['Spring', 'Summer', 'Autumn', 'Winter', 'All-season'];
const OCCASIONS = ['Daytime', 'Work', 'Evening', 'Sport', 'Formal', 'Home', 'Cold weather', 'Heat'];
const SKIN_STATES = ['Fresh out of the shower', 'Moisturised', 'Bare / dry', 'Oily', 'Sweaty / post-gym', 'On clothes', 'On hair'];
const WEATHERS = ['Cold & dry', 'Cold & wet', 'Mild', 'Warm', 'Hot & humid', 'Hot & dry', 'Heated indoors', 'Air-conditioned indoors'];
const PROJECTION = [
  { value: 'skin', label: 'Skin scent — only I can find it' },
  { value: 'close', label: "Arm's length — the person next to me" },
  { value: 'room', label: 'Enters the room with me' },
  { value: 'trail', label: 'Leaves a trail behind me' },
  { value: 'loud', label: 'Loud enough that someone commented' }
];
const REACTIONS = [
  { value: 'good', label: 'Pleasant on me' },
  { value: 'none', label: 'No reaction' },
  { value: 'irritation', label: 'Irritation where sprayed' },
  { value: 'bad', label: 'Went bad / sour on me' },
  { value: 'breakout', label: 'Breakout under the spray line' },
  { value: 'unknown', label: 'Cannot tell yet' }
];
const WANT_DECISIONS = [
  { value: 'still-wanting', label: 'Still wanting' },
  { value: 'decant-first', label: 'Decanting first' },
  { value: 'waiting-price', label: 'Waiting on my price' },
  { value: 'ordered', label: 'Ordered' },
  { value: 'passed', label: 'Passed on it' }
];

/* -------------------------------------------------------------------- maths */

function amount(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const [y, m, d] = String(iso).split('-').map(Number);
  if (!y) return null;
  return Math.max(0, Math.round((Date.now() - new Date(y, m - 1, d).getTime()) / 86400000));
}

function hoursLabel(min: number | null): string {
  if (min === null) return 'no measurement yet';
  const h = Math.floor(min / 60);
  const rest = min % 60;
  return h ? `${h}h${rest ? ` ${rest}m` : ''}` : `${rest}m`;
}

function mlPrice(price: number | null, ml: number | null): number | null {
  if (price === null || ml === null || ml <= 0) return null;
  return price / ml;
}

function projectionLabel(value: unknown): string {
  return PROJECTION.find((p) => p.value === value)?.label ?? 'not recorded';
}

function statusLabel(value: unknown): string {
  return STATUSES.find((s) => s.value === value)?.label ?? String(value ?? 'unset');
}

function smelledWords(row?: AnyRow): string[] {
  return [...((row?.topNotes as string[]) ?? []), ...((row?.heartNotes as string[]) ?? []), ...((row?.baseNotes as string[]) ?? [])].filter(Boolean);
}

/* ---------------------------------------------------------------- form shape */

interface BottleDraft {
  id?: string;
  name: string;
  house: string;
  status: StatusKey;
  family: string;
  concentration: string;
  sizeMl: string;
  price: string;
  boughtOn: string;
  seasons: string[];
  occasions: string[];
  rating: number;
  smelledTop: string[];
  smelledHeart: string[];
  smelledBase: string[];
  houseNotes: string;
  layeringWith: string[];
  inRotation: boolean;
  wantDecision: string;
  priceFound: string;
  priceSource: string;
  note: string;
  mediaId: string | null;
}

function draftFrom(row?: AnyRow, seed?: Partial<BottleDraft>): BottleDraft {
  return {
    id: row?.id,
    name: row?.name ?? '',
    house: row?.house ?? '',
    status: (row?.status as StatusKey) ?? 'own',
    family: row?.family ?? '',
    concentration: row?.concentration ?? CONCENTRATIONS[1],
    sizeMl: row?.sizeMl === null || row?.sizeMl === undefined ? '' : String(row.sizeMl),
    price: amount(row?.price) === null ? '' : String(amount(row?.price)),
    boughtOn: row?.boughtOn ?? todayISO(),
    seasons: (row?.seasons as string[]) ?? [],
    occasions: (row?.occasions as string[]) ?? [],
    rating: Number(row?.rating ?? 0),
    smelledTop: (row?.topNotes as string[]) ?? [],
    smelledHeart: (row?.heartNotes as string[]) ?? [],
    smelledBase: (row?.baseNotes as string[]) ?? [],
    houseNotes: String(row?.data?.houseNotes ?? ''),
    layeringWith: (row?.layeringWith as string[]) ?? [],
    inRotation: Boolean(row?.data?.inRotation),
    wantDecision: String(row?.data?.wantDecision ?? 'still-wanting'),
    priceFound: amount(row?.data?.priceFound) === null ? '' : String(amount(row?.data?.priceFound)),
    priceSource: String(row?.data?.priceSource ?? ''),
    note: String(row?.data?.bottleNote ?? ''),
    mediaId: (row?.mediaId as string) ?? null,
    ...seed
  };
}

function payloadFrom(d: BottleDraft, currency: string): Record<string, unknown> {
  return {
    id: d.id,
    name: d.name.trim(),
    house: d.house.trim(),
    status: d.status,
    family: d.family.trim(),
    concentration: d.concentration,
    sizeMl: amount(d.sizeMl),
    price: amount(d.price),
    boughtOn: d.boughtOn,
    seasons: d.seasons,
    occasions: d.occasions,
    rating: d.rating,
    topNotes: d.smelledTop,
    heartNotes: d.smelledHeart,
    baseNotes: d.smelledBase,
    layeringWith: d.layeringWith,
    mediaId: d.mediaId,
    tags: [d.status, d.family, ...d.seasons].filter(Boolean),
    data: {
      currency,
      houseNotes: d.houseNotes.trim(),
      inRotation: d.inRotation,
      wantDecision: d.status === 'want' ? d.wantDecision : null,
      priceFound: amount(d.priceFound),
      priceSource: d.priceSource.trim(),
      bottleNote: d.note.trim()
    }
  };
}

interface TestDraft {
  fragranceId: string;
  on: string;
  sprays: string;
  skin: string;
  weather: string;
  occasion: string;
  longevity: string;
  projection: string;
  noticed: string;
  reaction: string;
  rating: number;
  note: string;
}

const EMPTY_TEST: TestDraft = {
  fragranceId: '',
  on: todayISO(),
  sprays: '2',
  skin: SKIN_STATES[0],
  weather: WEATHERS[2],
  occasion: OCCASIONS[0],
  longevity: '',
  projection: 'close',
  noticed: '',
  reaction: 'none',
  rating: 0,
  note: ''
};

interface DecantDraft {
  fragranceId: string;
  days: string;
  aim: string;
  protocol: string;
  occasions: string;
}

const EMPTY_DECANT: DecantDraft = {
  fragranceId: '',
  days: '14',
  aim: '',
  protocol: '',
  occasions: ''
};

/* --------------------------------------------------------------------- page */

/* ---------------------------------------------------------------- note truth */

const NOTE_TIERS: { key: 'topNotes' | 'heartNotes' | 'baseNotes'; label: string; hint: string }[] = [
  { key: 'topNotes', label: 'First ten minutes', hint: 'Words you would use — not a pyramid.' },
  { key: 'heartNotes', label: 'An hour in', hint: 'What survived the opening.' },
  { key: 'baseNotes', label: 'What was left at the end', hint: '“Nothing at all” is a real answer.' }
];

function NoteCard({
  bottle,
  testCount,
  onWords,
  onEdit
}: {
  bottle: AnyRow;
  testCount: number;
  onWords: (field: 'topNotes' | 'heartNotes' | 'baseNotes', words: string[]) => void;
  onEdit: () => void;
}) {
  const houseNotes = String(bottle.data?.houseNotes ?? '').trim();
  const mine = smelledWords(bottle);
  return (
    <Card>
      <CardHead
        title={String(bottle.name)}
        eyebrow={String(bottle.house || 'house not recorded')}
        sub={`${statusLabel(bottle.status)}${bottle.concentration ? ` · ${bottle.concentration}` : ''}`}
        right={
          <IconButton label={`Edit ${String(bottle.name)}`} onClick={onEdit}>
            <Pencil size={14} />
          </IconButton>
        }
      />

      <div className="fr-notes">
        {NOTE_TIERS.map((t) => (
          <Field key={t.key} label={t.label} hint={t.hint}>
            <TagInput values={(bottle[t.key] as string[]) ?? []} onChange={(v) => onWords(t.key, v)} placeholder="smoke, wet stone, soap…" />
          </Field>
        ))}
      </div>

      {houseNotes ? (
        <div className="fr-noteblock">
          <div className="fr-noteblock__head">
            <span className="gl-serif">What the house claims</span>
            <Chip tone="danger">typed by you, kept apart</Chip>
          </div>
          <p className="gl-small">{houseNotes}</p>
        </div>
      ) : (
        <div className="gl-tech">No house note list stored here. This page will not supply one from memory or marketing.</div>
      )}

      <div className="gl-tech">
        {mine.length ? `${mine.length} word(s) of yours. ` : 'No words of yours yet. '}
        {testCount ? `${testCount} wear test(s) on this bottle.` : 'No wear test yet — these words are a first impression, and the page says so.'}
      </div>
    </Card>
  );
}

/* ---------------------------------------------------------------- decant trial */

function DecantCard({
  exp,
  onLogDay,
  onClose
}: {
  exp: AnyRow;
  onLogDay: (note: string, rating: number) => void;
  onClose: (decision: 'repeat' | 'stop' | 'extend', result: string) => void;
}) {
  const [note, setNote] = useState('');
  const [rating, setRating] = useState(0);
  const [result, setResult] = useState('');
  const days = ((exp.observations as { on: string; note: string; rating: number | null }[]) ?? []).slice().reverse();
  const open = exp.decision === 'open';
  const remaining = (() => {
    if (!exp.endOn) return null;
    const [y, m, d] = String(exp.endOn).split('-').map(Number);
    if (!y) return null;
    return Math.round((new Date(y, m - 1, d).getTime() - Date.now()) / 86400000);
  })();
  return (
    <div>
      <div className="gl-serif" style={{ fontSize: '1.05rem' }}>
        {String(exp.name)}
      </div>
      <div className="gl-tech" style={{ marginTop: 4 }}>
        started {formatDate(String(exp.startOn))} · {days.length} day(s) logged
        {open && remaining !== null ? (remaining >= 0 ? ` · ${remaining} day(s) left` : ' · past its end date, still open until you close it') : ''}
        {!open ? ` · closed as “${exp.decision}”` : ''}
      </div>
      <p className="gl-small gl-muted" style={{ marginTop: 6 }}>
        {String(exp.aim ?? '')}
      </p>

      {days.length ? (
        <ul className="fr-flags" style={{ marginTop: 8 }}>
          {days.slice(0, 5).map((o, i) => (
            <li key={`${o.on}-${i}`} className="gl-small">
              <span className="gl-tech">{formatDate(o.on)}</span>
              {o.rating ? ` · ${o.rating}/5` : ''} — {o.note}
            </li>
          ))}
        </ul>
      ) : (
        <div className="gl-tech" style={{ marginTop: 8 }}>
          Nothing logged yet. An empty trial is honest; a filled-in one is not.
        </div>
      )}

      {open ? (
        <>
          <Field label="Today, in one line" hint="What the juice did on your skin today, in your words.">
            <TextArea value={note} onChange={setNote} rows={2} placeholder="third day — still loud in the first hour, gone by lunch" />
          </Field>
          <div className="gl-row gl-row--between" style={{ alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            <Rating value={rating} onChange={setRating} />
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                onLogDay(note, rating);
                setNote('');
                setRating(0);
              }}
            >
              <Droplets size={13} /> Log today
            </Button>
          </div>

          <Field label="Verdict note (optional)" hint="Saved with the decision, on the experiment row.">
            <TextInput value={result} onChange={setResult} placeholder="worth a full bottle at the right price" />
          </Field>
          <div className="fr-chiprow">
            <Button size="sm" variant="gold" onClick={() => onClose('repeat', result)}>
              <BadgeCheck size={13} /> Worth the bottle
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onClose('stop', result)}>
              <RotateCcw size={13} /> Not worth it
            </Button>
            <Button size="sm" onClick={() => onClose('extend', result)}>
              <Repeat size={13} /> Two more weeks
            </Button>
          </div>
        </>
      ) : (
        <div className="gl-tech" style={{ marginTop: 8 }}>
          {String(exp.result ?? '') || 'No verdict note written.'}
        </div>
      )}
    </div>
  );
}

export default function FragrancePage() {
  const bottles = useRows(TABLES.fragrances);
  const tests = useRows(TABLES.observations, { where: { subjectType: 'fragrance' } });
  const experiments = useRows(TABLES.experiments);
  const events = useRows(TABLES.calendarEvents, { where: { linkDomain: 'fragrance' } });
  const lists = useRows(TABLES.lists);
  const mediaRows = useRows(TABLES.mediaItems);
  const techniques = useRows(TABLES.techniques);
  const flags = useFlags();
  const toast = useToast();
  const remove = useUndoDelete();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();

  const [currency, setCurrency] = useState('USD');
  const [q, setQ] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [editing, setEditing] = useState<BottleDraft | null>(null);
  const [test, setTest] = useState<TestDraft>(EMPTY_TEST);
  const [decant, setDecant] = useState<DecantDraft | null>(null);
  const [budgetDraft, setBudgetDraft] = useState('');
  const [showBudget, setShowBudget] = useState(false);
  const [confirmDel, setConfirmDel] = useState<{ table: TableName; id: string; label: string } | null>(null);

  const deepId = params.get('id') ?? '';
  const deepRow = useRow(TABLES.fragrances, deepId || undefined);

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
  const bottleById = useMemo(() => new Map(bottles.map((b) => [b.id, b])), [bottles]);
  const presenceRow = techniques.find((t) => t.slug === 'fragrance-presence');

  /* ---- one index of wear tests per bottle, newest first ---- */
  const testsByBottle = useMemo(() => {
    const map = new Map<string, AnyRow[]>();
    for (const t of tests) {
      const key = String(t.subjectId ?? '');
      map.set(key, [...(map.get(key) ?? []), t]);
    }
    for (const [k, v] of map) map.set(k, [...v].sort((a, b) => String(b.on).localeCompare(String(a.on))));
    return map;
  }, [tests]);

  const ledger = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return bottles
      .filter((b) => (statusFilter ? b.status === statusFilter : true))
      .filter((b) =>
        !needle ? true : [b.name, b.house, b.family, b.concentration, b.data?.houseNotes, smelledWords(b).join(' '), b.data?.priceSource].join(' ').toLowerCase().includes(needle)
      )
      .sort((a, b) => String(a.house).localeCompare(String(b.house)) || String(a.name).localeCompare(String(b.name)));
  }, [bottles, q, statusFilter]);

  const owned = useMemo(() => bottles.filter((b) => b.status === 'own'), [bottles]);
  const wants = useMemo(
    () => bottles.filter((b) => b.status === 'want').sort((a, b) => (amount(a.data?.priceFound) ?? 1e9) - (amount(b.data?.priceFound) ?? 1e9)),
    [bottles]
  );
  const untested = useMemo(() => bottles.filter((b) => b.status !== 'want' && !(testsByBottle.get(b.id) ?? []).length), [bottles, testsByBottle]);
  const decants = useMemo(() => experiments.filter((e) => e.category === 'fragrance' && e.data?.origin === 'fragrance-decant'), [experiments]);
  const openDecants = useMemo(() => decants.filter((e) => e.decision === 'open'), [decants]);

  const budgetRow = useMemo(() => lists.find((l) => l.data?.origin === 'fragrance-wants'), [lists]);
  const budget = amount(budgetRow?.budget);

  const wantMath = useMemo(() => {
    const live = wants.filter((w) => w.data?.wantDecision !== 'passed');
    const priced = live.filter((w) => amount(w.data?.priceFound) !== null);
    const total = priced.reduce((sum, w) => sum + (amount(w.data?.priceFound) ?? 0), 0);
    return { liveCount: live.length, pricedCount: priced.length, blankCount: live.length - priced.length, total };
  }, [wants]);

  const shelfMath = useMemo(() => {
    let spend = 0;
    let priced = 0;
    let ml = 0;
    for (const b of owned) {
      const p = amount(b.price);
      if (p !== null) {
        spend += p;
        priced += 1;
      }
      ml += amount(b.sizeMl) ?? 0;
    }
    return { spend, priced, blanks: owned.length - priced, ml };
  }, [owned]);

  const performance = useMemo(() => {
    const measured = tests.map((t) => amount(t.data?.longevityMin)).filter((v): v is number => v !== null);
    return { measured: measured.length, of: tests.length, mid: median(measured) };
  }, [tests]);

  const rotation = useMemo(() => {
    const groups = new Map<string, { label: string; rows: AnyRow[] }>();
    for (const s of SEASONS) groups.set(s, { label: s, rows: [] });
    for (const b of owned) {
      const list = (b.seasons as string[]) ?? [];
      if (!list.length) {
        const g = groups.get('All-season');
        if (g) g.rows.push(b);
        continue;
      }
      for (const s of list) groups.get(s)?.rows.push(b);
    }
    return [...groups.values()].filter((g) => g.rows.length);
  }, [owned]);

  const nextReview = useMemo(
    () => events.filter((e) => !e.doneOn && Number(e.startAt) >= Date.now() - 86400000).sort((a, b) => Number(a.startAt) - Number(b.startAt))[0] ?? null,
    [events]
  );

  /* ------------------------------------------------------------------ writes */

  async function saveBottle(d: BottleDraft) {
    if (!d.name.trim()) {
      toast('Give the bottle a name you will recognise in six months.', 'bad');
      return;
    }
    if (!d.house.trim()) {
      toast('House left blank — store the name anyway, or type “unmarked” if the bottle truly has none.', 'bad');
      return;
    }
    const saved = await saveRow(TABLES.fragrances, payloadFrom(d, currency));
    setEditing(null);
    toast(d.id ? 'Bottle updated. Your words, stored locally.' : 'Bottle stored in the fragrances table.', 'ok');
    if (d.status === 'want' && !d.priceFound.trim()) {
      toast('No price on the want line — the app will not invent one. Add what you found when you find it.', 'info');
    }
    return saved;
  }

  async function logTest() {
    if (!test.fragranceId) {
      toast('Pick the bottle you actually wore.', 'bad');
      return;
    }
    const bottle = bottleById.get(test.fragranceId);
    if (!bottle) {
      toast('That bottle is no longer in the collection.', 'bad');
      return;
    }
    const name = String(bottle.name);
    await saveRow(TABLES.observations, {
      subjectType: 'fragrance',
      subjectId: test.fragranceId,
      on: test.on,
      note: test.note.trim() || `${name} on ${test.skin.toLowerCase()}, ${test.weather.toLowerCase()}.`,
      reaction: test.reaction,
      severity: test.reaction === 'irritation' || test.reaction === 'breakout' ? 5 : 0,
      mediaIds: [],
      tags: ['fragrance', String(bottle.house || 'unattributed')],
      data: {
        origin: 'fragrance-wear-test',
        bottleName: name,
        sprays: amount(test.sprays),
        skin: test.skin,
        weather: test.weather,
        occasion: test.occasion,
        longevityMin: amount(test.longevity),
        projection: test.projection,
        noticed: test.noticed.trim(),
        rating: test.rating
      }
    });
    if (test.rating > 0) {
      await saveRow(TABLES.fragrances, {
        id: bottle.id,
        rating: test.rating,
        longevityMin: amount(test.longevity) ?? amount(bottle.longevityMin),
        data: { ...(bottle.data ?? {}), ratingFromWearTestOn: test.on }
      });
    }
    setTest({ ...EMPTY_TEST, fragranceId: test.fragranceId, on: todayISO() });
    toast('Wear test stored. Nothing here was estimated from someone else’s review.', 'ok');
  }

  async function toggleRotation(bottle: AnyRow) {
    await saveRow(TABLES.fragrances, { id: bottle.id, data: { ...(bottle.data ?? {}), inRotation: !bottle.data?.inRotation } });
    toast(bottle.data?.inRotation ? 'Out of the rotation.' : 'In the rotation.', 'ok');
  }

  async function setWantDecision(bottle: AnyRow, value: string) {
    await saveRow(TABLES.fragrances, { id: bottle.id, data: { ...(bottle.data ?? {}), wantDecision: value } });
    toast(value === 'passed' ? 'Marked as passed — it stays in the record, out of the budget maths.' : 'Want line updated.', 'ok');
  }

  async function markBought(bottle: AnyRow) {
    const paid = amount(bottle.data?.priceFound);
    await saveRow(TABLES.fragrances, {
      id: bottle.id,
      status: 'own',
      price: paid,
      boughtOn: todayISO(),
      data: { ...(bottle.data ?? {}), wantDecision: null, boughtFrom: String(bottle.data?.priceSource ?? '') }
    });
    toast(paid === null ? 'Moved to owned with the price blank — type what you actually paid.' : 'Moved to owned at the price you recorded.', 'ok');
  }

  async function saveBudget() {
    const value = amount(budgetDraft);
    if (value === null) {
      toast('Type a number, even 0. Blank is not a budget.', 'bad');
      return;
    }
    await saveRow(TABLES.lists, {
      id: budgetRow?.id,
      kind: 'wishlist',
      name: 'Fragrance want budget',
      budget: value,
      period: String(budgetRow?.period ?? 'month'),
      items: [],
      closedOn: null,
      tags: ['fragrance', 'budget'],
      data: { origin: 'fragrance-wants', currency }
    });
    setShowBudget(false);
    toast('Budget stored in the lists table.', 'ok');
  }

  async function createDecant(d: DecantDraft) {
    const bottle = bottleById.get(d.fragranceId);
    if (!bottle) {
      toast('Choose which want or sample the decant trial is for.', 'bad');
      return;
    }
    const days = Math.max(1, Number(d.days) || 14);
    const start = todayISO();
    await saveRow(TABLES.experiments, {
      name: `Decant before committing — ${bottle.name}${bottle.house ? ` (${bottle.house})` : ''}`,
      category: 'fragrance',
      aim: d.aim.trim() || `Wear ${bottle.name} on my skin ${days} days before deciding on a full bottle.`,
      startOn: start,
      endOn: addDays(start, days),
      baseline: `What I already know: ${smelledWords(bottle).length ? `my own note words (${smelledWords(bottle).join(', ')})` : 'no note words logged yet'} · ${
        (testsByBottle.get(bottle.id) ?? []).length
      } wear test(s) on file.`,
      baselineMediaIds: [],
      techniqueIds: presenceRow ? [String(presenceRow.id)] : [],
      productIds: [bottle.id],
      protocol:
        d.protocol.trim() ||
        `Spray ${d.occasions.trim() || 'on ordinary days'}, log a wear test each time with the minutes I actually measured, and re-read the lot on ${formatDate(
          addDays(start, days)
        )}.`,
      observations: [],
      result: '',
      resultMediaIds: [],
      rating: 0,
      decision: 'open',
      confounders: 'Season, skin condition, dose and the weather all move longevity. This app cannot separate them; you have to write that down.',
      tags: ['fragrance', 'decant'],
      data: { origin: 'fragrance-decant', fragranceId: bottle.id, days }
    });
    if (bottle.status === 'want') {
      await saveRow(TABLES.fragrances, { id: bottle.id, data: { ...(bottle.data ?? {}), wantDecision: 'decant-first' } });
    }
    setDecant(null);
    toast('Decant trial is a real experiment row — it shows up in /experiments.', 'ok');
  }

  async function closeDecant(e: AnyRow, decision: 'repeat' | 'stop' | 'extend', result: string) {
    await saveRow(TABLES.experiments, {
      id: e.id,
      decision,
      result: result.trim() || String(e.result ?? ''),
      endOn: decision === 'extend' ? addDays(todayISO(), 14) : todayISO()
    });
    toast(decision === 'repeat' ? 'Marked: worth the full bottle. Price still yours to find.' : decision === 'stop' ? 'Marked: not worth the bottle. That is a saved purchase.' : 'Extended two weeks — same rules.', 'ok');
  }

  async function logDecantDay(e: AnyRow, note: string, rating: number) {
    if (!note.trim()) {
      toast('One line about today, or the day is not worth storing.', 'bad');
      return;
    }
    const prior = ((e.observations as { on: string; note: string; mediaIds: string[]; rating: number | null }[]) ?? []);
    await saveRow(TABLES.experiments, {
      id: e.id,
      observations: [...prior, { on: todayISO(), note: note.trim(), mediaIds: [], rating: rating || null }]
    });
    toast('Day written onto the trial row.', 'ok');
  }

  async function scheduleReview(bottle: AnyRow) {
    const on = addDays(todayISO(), 30);
    const [y, m, d] = on.split('-').map(Number);
    const start = new Date(y, m - 1, d, 10, 0).getTime();
    await saveRow(TABLES.calendarEvents, {
      title: `Still want ${bottle.name}?`,
      kind: 'cooling-off',
      startAt: start,
      endAt: start + 15 * 60000,
      recurrence: undefined,
      reminders: [],
      checklist: [
        { id: newId('chk'), label: 'Do I still remember smelling it, or only the marketing?', done: false },
        { id: newId('chk'), label: 'What price did I actually find?', done: false }
      ],
      linkDomain: 'fragrance',
      linkId: bottle.id,
      cost: null,
      doneOn: null,
      note: `Cooling-off on a want line. The app has no opinion on the juice and no price for it. Recorded price found: ${
        amount(bottle.data?.priceFound) === null ? 'none yet' : fmtMoney(amount(bottle.data?.priceFound), currency)
      }.`,
      tags: ['fragrance', 'cooling-off'],
      data: { origin: 'fragrance-cooling-off', fragranceId: bottle.id }
    });
    toast('30-day review written to calendarEvents.', 'ok');
  }

  async function toggleEventDone(ev: AnyRow) {
    await saveRow(TABLES.calendarEvents, { id: ev.id, doneOn: ev.doneOn ? null : todayISO() });
  }

  async function setSmellWords(bottle: AnyRow, field: 'topNotes' | 'heartNotes' | 'baseNotes', words: string[]) {
    await saveRow(TABLES.fragrances, { id: bottle.id, [field]: words });
  }

  async function runDelete() {
    if (!confirmDel) return;
    await remove(confirmDel.table, confirmDel.id, confirmDel.label);
    setConfirmDel(null);
  }

  /* -------------------------------------------------------------------- view */

  return (
    <div className="gl-page fr-page">
      <DeptIntro
        id="fragrance"
        deck="This studio has no nose. It cannot tell you what anything smells like, what it costs, how long it lasts on your skin or whether anyone will compliment you. It stores your wear tests, your words and your prices — and does arithmetic on them."
        actions={
          <>
            <Button variant="primary" onClick={() => setEditing(draftFrom(undefined, { status: 'own' }))}>
              <Plus size={14} /> Add a bottle
            </Button>
            <Button onClick={() => setEditing(draftFrom(undefined, { status: 'want' }))}>
              <ShoppingBag size={14} /> Add a want
            </Button>
            <Button onClick={() => setShowBudget(true)}>
              <Wallet size={14} /> Want budget
            </Button>
          </>
        }
        meta={[
          { label: 'Bottles recorded', value: String(bottles.length) },
          { label: 'Wear tests', value: String(tests.length) },
          { label: 'Notes sourced from', value: 'your own nose, only' }
        ]}
      />

      <StatStrip
        items={[
          { label: 'On the shelf', value: String(owned.length), hint: 'status: owned' },
          { label: 'Money you recorded', value: fmtMoney(shelfMath.spend, currency), hint: `${shelfMath.priced} priced / ${shelfMath.blanks} blank` },
          { label: 'Want list', value: `${wantMath.liveCount} live`, hint: `${wantMath.pricedCount} with a price you found, ${wantMath.blankCount} blank` },
          { label: 'Median longevity', value: hoursLabel(performance.mid), hint: `${performance.measured} of ${performance.of} tests carried a number you measured` },
          { label: 'Untested bottles', value: String(untested.length), hint: 'rated or bought with no wear test logged' }
        ]}
      />

      {/* -------------------------------------------------------- 01 collection */}
      <section className="gl-section">
        <div className="gl-section__title">
          <div>
            <div className="gl-eyebrow">Section 01 · the collection</div>
            <h2>What you own, what you hold, what you want</h2>
          </div>
          <Button size="sm" variant="primary" onClick={() => setEditing(draftFrom())}>
            <Plus size={13} /> New line
          </Button>
        </div>

        <div className="fr-toolbar">
          <label className="fr-search gl-field" style={{ marginBottom: 0 }}>
            <span className="gl-field__label">
              <Search size={12} /> Search by bottle, house, or a word you smelled
            </span>
            <TextInput value={q} onChange={setQ} placeholder="vetiver, smoke, sample from a counter…" />
          </label>
          <Chipbar
            allLabel="Everything"
            value={statusFilter}
            onChange={setStatusFilter}
            items={STATUSES.map((s) => ({ value: s.value, label: s.label, count: bottles.filter((b) => b.status === s.value).length }))}
          />
        </div>

        {bottles.length === 0 ? (
          <EmptyPlate
            kicker="Empty on purpose"
            title="No bottles here — because no one has typed one"
            body="This app has no catalogue, no retailer feed and no notes database, so it cannot show you a shelf. Add what you own: the name, the house, the size, what you paid. Add what you want and the price you found. Everything downstream — the diary, the budget maths, the decant planner — reads from those rows."
            action={
              <Button variant="primary" onClick={() => setEditing(draftFrom())}>
                <Plus size={14} /> Add the first bottle
              </Button>
            }
          />
        ) : ledger.length === 0 ? (
          <Card>
            <CardHead title="Nothing matches" sub={`${bottles.length} bottles exist; the filter is what is empty.`} />
            <Button size="sm" onClick={() => { setQ(''); setStatusFilter(''); }}>
              Clear filters
            </Button>
          </Card>
        ) : (
          <Table
            rows={ledger}
            keyOf={(r: AnyRow) => r.id}
            columns={[
              {
                label: 'Bottle',
                render: (r: AnyRow) => (
                  <button type="button" className="gl-btn gl-btn--link gl-btn--sm" onClick={() => setEditing(draftFrom(r))}>
                    {r.name}
                  </button>
                )
              },
              { label: 'House', width: 140, render: (r: AnyRow) => <span className="gl-small">{r.house || <span className="gl-faint">unmarked</span>}</span> },
              { label: 'Status', width: 110, render: (r: AnyRow) => <Chip tone={r.status === 'want' ? 'info' : r.status === 'finished' ? 'limited' : 'gold'}>{statusLabel(r.status)}</Chip> },
              { label: 'Format', width: 150, render: (r: AnyRow) => <span className="gl-tech">{[r.concentration, amount(r.sizeMl) === null ? '' : `${r.sizeMl} ml`].filter(Boolean).join(' · ') || '—'}</span> },
              {
                label: 'Cost',
                width: 140,
                render: (r: AnyRow) => {
                  const paid = amount(r.price);
                  const found = r.status === 'want' ? amount(r.data?.priceFound) : null;
                  const per = mlPrice(paid ?? found, amount(r.sizeMl));
                  if (paid === null && found === null) return <span className="gl-faint">no price you recorded</span>;
                  return (
                    <span className="fr-num">
                      {fmtMoney(paid ?? found, currency)}
                      {per !== null ? <span className="gl-faint"> · {fmtMoney(Math.round(per * 100) / 100, currency)}/ml</span> : null}
                    </span>
                  );
                }
              },
              {
                label: 'Your note words',
                render: (r: AnyRow) =>
                  smelledWords(r).length ? (
                    <span className="gl-small">{smelledWords(r).slice(0, 6).join(' · ')}</span>
                  ) : (
                    <span className="gl-faint gl-small">nothing smelled yet</span>
                  )
              },
              {
                label: 'Wear tests',
                width: 130,
                render: (r: AnyRow) => {
                  const list = testsByBottle.get(r.id) ?? [];
                  const m = median(list.map((t) => amount(t.data?.longevityMin)).filter((v): v is number => v !== null));
                  return (
                    <span className="gl-small">
                      {list.length ? `${list.length} · ${hoursLabel(m)}` : <span className="gl-faint">none</span>}
                    </span>
                  );
                }
              },
              { label: 'Rating', width: 96, render: (r: AnyRow) => <Rating value={Number(r.rating ?? 0)} size={12} count={5} /> },
              {
                label: '',
                width: 84,
                render: (r: AnyRow) => (
                  <div className="gl-row gl-row--tight">
                    <IconButton label={`Edit ${r.name}`} onClick={() => setEditing(draftFrom(r))}>
                      <Pencil size={14} />
                    </IconButton>
                    <IconButton label={`Delete ${r.name}`} onClick={() => setConfirmDel({ table: TABLES.fragrances, id: r.id, label: String(r.name) })}>
                      <Trash2 size={14} />
                    </IconButton>
                  </div>
                )
              }
            ]}
          />
        )}

        {untested.length ? (
          <SafetyBanner tone="warn" title={`${untested.length} bottle${untested.length > 1 ? 's' : ''} carry a rating or a price but no wear test`}>
            <p className="gl-small">
              A rating without a wear test is a first spray, a counter sniff or an advertisement you half-remember. That is still worth
              storing — just not worth calling a review. Log a test on a normal day and the number below this line means something.
            </p>
            <div className="fr-flags">
              {untested.slice(0, 8).map((b) => (
                <button key={b.id} type="button" className="gl-btn gl-btn--sm gl-btn--ghost" onClick={() => setTest({ ...EMPTY_TEST, fragranceId: b.id })}>
                  <Droplets size={12} /> Test {b.name}
                </button>
              ))}
            </div>
          </SafetyBanner>
        ) : null}
      </section>

      {/* --------------------------------------------------------- 02 note truth */}
      <section className="gl-section">
        <div className="gl-section__title">
          <div>
            <div className="gl-eyebrow">Section 02 · note accuracy</div>
            <h2>Words you smelled, kept apart from words you were sold</h2>
          </div>
          <Chip tone="danger">
            <TriangleAlert size={11} /> the app never names a note
          </Chip>
        </div>

        <PullQuote cite="Why the two fields are never merged">
          A house’s pyramid is marketing copy written by whoever formulated it, and a reviewer’s list is one person’s nose in another
          climate. The only note claim this page will store is yours, on your skin, on a dated day.
        </PullQuote>

        <div className="gl-grid gl-grid--2">
          {bottles
            .filter((b) => b.status !== 'want')
            .slice(0, 6)
            .map((b) => (
              <NoteCard
                key={b.id}
                bottle={b}
                testCount={(testsByBottle.get(b.id) ?? []).length}
                onWords={(field, words) => void setSmellWords(b, field, words)}
                onEdit={() => setEditing(draftFrom(b))}
              />
            ))}
          {bottles.filter((b) => b.status !== 'want').length === 0 ? (
            <Card>
              <CardHead title="Nothing to compare yet" sub="Add a bottle or a sample and the two columns appear here." />
              <Button size="sm" variant="primary" onClick={() => setEditing(draftFrom())}>
                <Plus size={12} /> Add a bottle
              </Button>
            </Card>
          ) : null}
        </div>

        <Disclosure summary="Why there is no note suggestion list in this app">
          <p className="gl-small">
            Autocomplete note words would quietly turn a guess into a stored fact: pick “iris” from a dropdown and in six months the row
            looks like an observation. Every word in the left column above was typed by you. That is the difference this department
            protects, so there are no dropdowns of smells anywhere in it.
          </p>
        </Disclosure>
      </section>

      {/* ---------------------------------------------------------- 03 wear tests */}
      <section className="gl-section">
        <div className="gl-section__title">
          <div>
            <div className="gl-eyebrow">Section 03 · the diary</div>
            <h2>Wear tests, measured with your own clock</h2>
          </div>
          <Chip tone="info">{tests.length} stored</Chip>
        </div>

        <Card variant="flush">
          <CardHead title="Log today" eyebrow="observations table · subjectType: fragrance" sub="Longevity is the number you measured. Projection is what you observed. Who noticed is optional and can be left blank." />
          <div className="fr-form">
            <Field label="Bottle" hint="Only what is already in the collection — add the bottle first.">
              <Select
                value={test.fragranceId}
                onChange={(v) => setTest({ ...test, fragranceId: v })}
                placeholder="Which bottle did you wear?"
                options={bottles.map((b) => ({ value: b.id, label: `${b.name}${b.house ? ` — ${b.house}` : ''}` }))}
              />
            </Field>
            <DateInput label="Date worn" value={test.on} onChange={(v) => setTest({ ...test, on: v })} />
            <Field label="Sprays">
              <TextInput type="number" value={test.sprays} onChange={(v) => setTest({ ...test, sprays: v })} placeholder="2" />
            </Field>
            <Field label="Skin state">
              <Select value={test.skin} onChange={(v) => setTest({ ...test, skin: v })} options={SKIN_STATES.map((s) => ({ value: s, label: s }))} />
            </Field>
            <Field label="Weather">
              <Select value={test.weather} onChange={(v) => setTest({ ...test, weather: v })} options={WEATHERS.map((s) => ({ value: s, label: s }))} />
            </Field>
            <Field label="Occasion">
              <Select value={test.occasion} onChange={(v) => setTest({ ...test, occasion: v })} options={OCCASIONS.map((s) => ({ value: s, label: s }))} />
            </Field>
            <Field label="Longevity you measured (minutes)" hint="Clock it. Leave blank if you did not, rather than rounding a guess.">
              <TextInput type="number" value={test.longevity} onChange={(v) => setTest({ ...test, longevity: v })} placeholder="240" />
            </Field>
            <Field label="Projection you observed">
              <Select value={test.projection} onChange={(v) => setTest({ ...test, projection: v })} options={PROJECTION.map((p) => ({ value: p.value, label: p.label }))} />
            </Field>
            <Field label="Who noticed (optional)" hint="Names, or nothing at all. Nobody else’s opinion belongs in your row.">
              <TextInput value={test.noticed} onChange={(v) => setTest({ ...test, noticed: v })} placeholder="Colleague said it smelled like bread" />
            </Field>
            <Field label="Skin reaction">
              <Select value={test.reaction} onChange={(v) => setTest({ ...test, reaction: v })} options={REACTIONS.map((r) => ({ value: r.value, label: r.label }))} />
            </Field>
            <Field label="Wear rating">
              <Rating value={test.rating} onChange={(v) => setTest({ ...test, rating: v })} count={5} />
            </Field>
            <Field label="One line about it">
              <TextArea value={test.note} onChange={(v) => setTest({ ...test, note: v })} rows={2} placeholder="Strong for two hours, then it sat close. Still like it at 6pm." />
            </Field>
          </div>
          <div className="gl-row gl-row--tight" style={{ marginTop: 'var(--glow-sp-4)' }}>
            <Button variant="primary" onClick={() => void logTest()}>
              <Timer size={14} /> Store the wear test
            </Button>
            <Button variant="ghost" onClick={() => setTest({ ...EMPTY_TEST, fragranceId: test.fragranceId })}>
              <RotateCcw size={13} /> Reset the form
            </Button>
          </div>
        </Card>

        {tests.length === 0 ? (
          <Card>
            <CardHead title="The diary is empty" sub="No longevity hours, no projection, no compliments — because none have been logged. First spray counts once you write it down." />
          </Card>
        ) : (
          <div className="fr-diary" key={`diary:${flags}`}>
            {[...testsByBottle.entries()].map(([bottleId, list]) => {
              const bottle = bottleById.get(bottleId);
              const measured = list.map((t) => amount(t.data?.longevityMin)).filter((v): v is number => v !== null);
              return (
                <Card key={bottleId}>
                  <CardHead
                    title={bottle ? String(bottle.name) : 'A bottle you have since deleted'}
                    eyebrow={`${list.length} wear test${list.length > 1 ? 's' : ''}`}
                    sub={measured.length ? `median ${hoursLabel(median(measured))} across ${measured.length} measured test${measured.length > 1 ? 's' : ''}` : 'no test carried a measured time'}
                    right={
                      <Chip tone={bottle ? 'info' : 'danger'}>
                        {bottle ? `${(bottle.seasons as string[])?.length ?? 0} season tags` : 'orphaned tests'}
                      </Chip>
                    }
                  />
                  <Timeline
                    items={list.map((t) => ({
                      when: `${formatDate(String(t.on))}${amount(t.data?.sprays) ? ` · ${amount(t.data?.sprays)} sprays` : ''}`,
                      title: `${String(t.data?.skin ?? 'skin unrecorded')} · ${String(t.data?.weather ?? 'weather unrecorded')}`,
                      body: (
                        <>
                          <span className="gl-small">{t.note}</span>
                          <div className="fr-test__meta">
                            <span>
                              <Timer size={11} /> {hoursLabel(amount(t.data?.longevityMin))}
                            </span>
                            <span>
                              <Gauge size={11} /> {projectionLabel(t.data?.projection)}
                            </span>
                            {t.data?.noticed ? (
                            <span>
                              <BadgeCheck size={11} /> {String(t.data?.noticed)}
                            </span>
                          ) : null}
                          {Number(t.data?.rating ?? 0) > 0 ? <Rating value={Number(t.data?.rating)} size={11} count={5} /> : null}
                          </div>
                        </>
                      ),
                      tone: 'plain' as const,
                      right: (
                        <IconButton label="Delete wear test" onClick={() => setConfirmDel({ table: TABLES.observations, id: t.id, label: `Wear test of ${formatDate(String(t.on))}` })}>
                          <Trash2 size={13} />
                        </IconButton>
                      )
                    }))}
                  />
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* ------------------------------------------------------------- 04 wants */}
      <section className="gl-section">
        <div className="gl-section__title">
          <div>
            <div className="gl-eyebrow">Section 04 · wants and budget</div>
            <h2>The want list, priced only by you</h2>
          </div>
          <Button size="sm" onClick={() => setEditing(draftFrom(undefined, { status: 'want' }))}>
            <Plus size={13} /> Add a want
          </Button>
        </div>

        <div className="gl-editorial gl-editorial--wide-left">
          <div className="gl-stack">
            <Card>
              <CardHead
                title="Live want list"
                eyebrow="fragrances table · status: want"
                sub="The price column is blank until you find a price and type it. This app has no retailer, no feed and no idea what anything costs today."
                right={
                  <>
                    <Chip tone={budget === null ? 'info' : wantMath.total > budget ? 'danger' : 'gold'}>
                      {budget === null ? 'no budget set' : wantMath.total > budget ? 'over your budget' : 'inside your budget'}
                    </Chip>
                    <IconButton label="Edit budget" onClick={() => { setBudgetDraft(budget === null ? '' : String(budget)); setShowBudget(true); }}>
                      <Wallet size={14} />
                    </IconButton>
                  </>
                }
              />
              {wants.length === 0 ? (
                <EmptyPlate
                  kicker="Nothing wanted yet"
                  title="The want list is empty because you have not added to it"
                  body="Add the bottle, the house and — when you have it — the price you actually saw. No price is invented here, and no “you might also like” appears either."
                  action={
                    <Button variant="primary" onClick={() => setEditing(draftFrom(undefined, { status: 'want' }))}>
                      <Plus size={14} /> Add the first want
                    </Button>
                  }
                />
              ) : (
                <>
                  <div className="fr-budget">
                    <div>
                      <span className="gl-num">{fmtMoney(wantMath.total, currency)}</span>
                      <span className="gl-tech">sum of the {wantMath.pricedCount} price(s) you recorded</span>
                    </div>
                    <div>
                      <span className="gl-num">{wantMath.blankCount}</span>
                      <span className="gl-tech">want line(s) with no price found yet</span>
                    </div>
                    <div>
                      <span className="gl-num">{budget === null ? '—' : fmtMoney(Math.max(0, budget - wantMath.total), currency)}</span>
                      <span className="gl-tech">
                        {budget === null ? 'no budget to subtract from' : budget - wantMath.total < 0 ? `over by ${fmtMoney(wantMath.total - budget, currency)}` : 'headroom against your budget'}
                      </span>
                    </div>
                  </div>
                  <Table
                    rows={wants}
                    keyOf={(r: AnyRow) => r.id}
                    columns={[
                      {
                        label: 'Wanted',
                        render: (r: AnyRow) => (
                          <>
                            <button type="button" className="gl-btn gl-btn--link gl-btn--sm" onClick={() => setEditing(draftFrom(r))}>
                              {r.name}
                            </button>
                            <div className="gl-tech">{r.house || 'unmarked'}</div>
                          </>
                        )
                      },
                      {
                        label: 'Price you found',
                        width: 150,
                        render: (r: AnyRow) =>
                          amount(r.data?.priceFound) === null ? (
                            <span className="gl-faint gl-small">not found yet</span>
                          ) : (
                            <span className="fr-num">
                              {fmtMoney(amount(r.data?.priceFound), currency)}
                              {mlPrice(amount(r.data?.priceFound), amount(r.sizeMl)) !== null ? ` · ${fmtMoney(Math.round((mlPrice(amount(r.data?.priceFound), amount(r.sizeMl)) ?? 0) * 100) / 100, currency)}/ml` : ''}
                            </span>
                          )
                      },
                      { label: 'Where you saw it', width: 160, render: (r: AnyRow) => <span className="gl-small">{String(r.data?.priceSource ?? '') || <span className="gl-faint">not written</span>}</span> },
                      {
                        label: 'In your words',
                        render: (r: AnyRow) => (smelledWords(r).length ? <span className="gl-small">{smelledWords(r).slice(0, 5).join(' · ')}</span> : <span className="gl-faint gl-small">you have not smelled it</span>)
                      },
                      {
                        label: 'Decision',
                        width: 170,
                        render: (r: AnyRow) => <Select value={String(r.data?.wantDecision ?? 'still-wanting')} onChange={(v) => void setWantDecision(r, v)} options={WANT_DECISIONS.map((d) => ({ value: d.value, label: d.label }))} />
                      },
                      {
                        label: '',
                        width: 130,
                        render: (r: AnyRow) => (
                          <div className="gl-row gl-row--tight">
                            <IconButton label="30-day review" onClick={() => void scheduleReview(r)}>
                              <Repeat size={14} />
                            </IconButton>
                            <IconButton label="Start decant plan" onClick={() => setDecant({ ...EMPTY_DECANT, fragranceId: r.id })}>
                              <FlaskConical size={14} />
                            </IconButton>
                            <IconButton label="Mark as bought" onClick={() => void markBought(r)}>
                              <ShoppingBag size={14} />
                            </IconButton>
                          </div>
                        )
                      }
                    ]}
                  />
                </>
              )}
            </Card>

            {nextReview || openDecants.length ? (
              <Card>
                <CardHead title="Holding pattern" eyebrow="calendarEvents + experiments rows" sub="Things the app is holding open for you — each one is a real row you created, tickable and deletable." />
                <IndexList>
                  {nextReview ? (
                    <IndexRow
                      no="R"
                      title={String(nextReview.title)}
                      sub={formatDate(new Date(Number(nextReview.startAt)).toISOString().slice(0, 10))}
                      right={
                        <Chip tone={nextReview.doneOn ? 'gold' : 'moderate'} onClick={() => void toggleEventDone(nextReview)}>
                          {nextReview.doneOn ? 'done' : 'tick when decided'}
                        </Chip>
                      }
                      onClick={() => navigate('/calendar')}
                    />
                  ) : null}
                  {openDecants.map((e, i) => (
                    <IndexRow
                      key={e.id}
                      no={i + 1}
                      title={String(e.name)}
                      sub={`ends ${formatDate(String(e.endOn))} · ${((e.observations as never[]) ?? []).length} logged day(s)`}
                      right={<Chip tone="info">{e.decision}</Chip>}
                      onClick={() => navigate('/experiments')}
                    />
                  ))}
                </IndexList>
              </Card>
            ) : null}
          </div>

          <div className="gl-stack">
            <Card>
              <CardHead title="Decant before you commit" eyebrow="writes an experiments row" sub="The cheapest honest answer to a want list: buy 2 ml, wear it properly, and let your own diary decide." />
              <p className="gl-small gl-muted">
                The planner does not know whether this fragrance is worth a full bottle and will not pretend to. It creates a dated
                experiment with the window you choose, then the wear tests you log are what fill it.
              </p>
              <Button variant="gold" onClick={() => setDecant({ ...EMPTY_DECANT, fragranceId: wants[0]?.id ?? bottles[0]?.id ?? '' })} disabled={!bottles.length}>
                <FlaskConical size={14} /> Plan a decant trial
              </Button>
              {!bottles.length ? <div className="gl-tech" style={{ marginTop: 8 }}>Add a bottle or a want first — the trial has to point at a row.</div> : null}
            </Card>

            {decants.length ? (
              <Card>
                <CardHead
                  title="Trials you are running"
                  eyebrow="experiments · category: fragrance"
                  sub="Each day you log lands on the experiment row itself. The verdict buttons are yours — the app has no opinion about the juice."
                  right={<Chip tone="moderate">{openDecants.length} open</Chip>}
                />
                <div className="fr-decants" key={`decants:${flags}`}>
                  {decants.map((e) => (
                    <DecantCard
                      key={e.id}
                      exp={e}
                      onLogDay={(note, rating) => void logDecantDay(e, note, rating)}
                      onClose={(decision, result) => void closeDecant(e, decision, result)}
                    />
                  ))}
                </div>
              </Card>
            ) : null}

            {presenceRow ? (
              <Card>
                <CardHead title="Dose, from the evidence library" eyebrow={`technique · ${presenceRow.slug}`} right={<EvidenceChip grade={String(presenceRow.evidence)} />} />
                <p className="gl-small">{presenceRow.evidenceSummary}</p>
                <ul className="fr-flags">
                  {((presenceRow.risks as string[]) ?? []).map((x) => (
                    <li key={x} className="gl-small">
                      {x}
                    </li>
                  ))}
                </ul>
                <div className="gl-tech">When to stop and think: {presenceRow.whenToConsult}</div>
              </Card>
            ) : (
              <Card>
                <CardHead title="Evidence row missing" sub="The fragrance dose entry is not in your techniques table — run a reseed from Settings." />
              </Card>
            )}
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------- 05 rotation */}
      <section className="gl-section">
        <div className="gl-section__title">
          <div>
            <div className="gl-eyebrow">Section 05 · rotation</div>
            <h2>The scent wardrobe you actually built</h2>
          </div>
          <Chip tone="info">{owned.filter((b) => b.data?.inRotation).length} in rotation</Chip>
        </div>

        {owned.length === 0 ? (
          <Card>
            <CardHead title="Nothing to rotate" sub="Rotation is built from owned bottles. Add what is on your shelf and the season grid fills itself." />
          </Card>
        ) : (
          <div className="fr-rot">
            {rotation.map((g) => (
              <div key={g.label} className="fr-rot__cell">
                <div className="fr-rot__head">
                  <span className="gl-serif">
                    {g.label === 'Winter' || g.label === 'Cold weather' ? <Snowflake size={13} /> : g.label === 'Summer' || g.label === 'Heat' ? <Sun size={13} /> : <Layers size={13} />} {g.label}
                  </span>
                  <span className="gl-tech">{g.rows.length} bottle(s)</span>
                </div>
                {g.rows.map((b) => {
                  const list = testsByBottle.get(b.id) ?? [];
                  const last = list[0]?.on ? String(list[0].on) : null;
                  const gap = daysSince(last);
                  return (
                    <div key={b.id} className="fr-rot__row">
                      <button type="button" className="gl-btn gl-btn--link gl-btn--sm" onClick={() => setEditing(draftFrom(b))}>
                        {b.name}
                      </button>
                      <span className="gl-tech">
                        {list.length ? `${list.length} test(s)${gap !== null ? ` · last worn ${gap} day(s) ago` : ''}` : 'no wear test'} ·{' '}
                        {(b.occasions as string[])?.length ? (b.occasions as string[]).join(', ') : 'no occasion tagged'}
                      </span>
                      <div className="gl-row gl-row--tight">
                        <Chip tone={b.data?.inRotation ? 'gold' : 'limited'} onClick={() => void toggleRotation(b)}>
                          {b.data?.inRotation ? 'in rotation' : 'bench'}
                        </Chip>
                        <IconButton label={`Log a wear test for ${b.name}`} onClick={() => setTest({ ...EMPTY_TEST, fragranceId: b.id })}>
                          <Droplets size={13} />
                        </IconButton>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}

        <Card variant="flush" style={{ marginTop: 'var(--glow-sp-4)' }}>
          <CardHead title="Layering pairs you actually tried" eyebrow="layeringWith on your own rows" sub="Stored as names you typed after wearing both. Nothing here is a recommended combination." />
          {owned.some((b) => ((b.layeringWith as string[]) ?? []).length) ? (
            <IndexList>
              {owned
                .filter((b) => ((b.layeringWith as string[]) ?? []).length)
                .map((b, i) => (
                  <IndexRow key={b.id} no={i + 1} title={String(b.name)} sub={`you layered it with ${(b.layeringWith as string[]).join(' + ')}`} right={<Chip tone="info">{(b.layeringWith as string[]).length}</Chip>} onClick={() => setEditing(draftFrom(b))} />
                ))}
            </IndexList>
          ) : (
            <div className="gl-small gl-muted" style={{ padding: '0 var(--glow-sp-4) var(--glow-sp-4)' }}>
              Empty, because no layering has been recorded. If two bottles went well together, that is a fact about your skin and your
              weather, not a recipe — write it down when it happens.
            </div>
          )}
        </Card>
      </section>

      {/* ---------------------------------------------------- 06 honest limits */}
      <section className="gl-section">
        <div className="gl-section__title">
          <div>
            <div className="gl-eyebrow">Section 06 · what this cannot do</div>
            <h2>The limits, in print</h2>
          </div>
        </div>

        <div className="fr-limits">
          {[
            { t: 'It cannot tell you what anything smells like', b: 'There is no scent hardware in a browser and no notes database behind this page. The only descriptions here are words you typed about your own skin.' },
            { t: 'It cannot price anything', b: 'No retailer feed, no scraping, no “usually around”. A blank price means you have not found one yet, and it stays blank.' },
            { t: 'It cannot measure longevity', b: 'It stores the number your clock produced and says how many tests that median came from. A bottle with one measured test shows a median of one test.' },
            { t: 'It cannot repeat anyone else’s review', b: 'No imported ratings, no community scores, no copied blurbs. Other people’s skin chemistry is not your data.' },
            { t: 'It cannot detect reformulations or batches', b: 'If yesterday’s bottle smells different, that is a note you write; the app has no batch database to check it against.' },
            { t: 'It cannot advise on allergy', b: 'An irritation entry is a flag that says stop and see someone qualified. It is not a diagnosis and not an ingredient analysis.' }
          ].map((l) => (
            <Card key={l.t}>
              <CardHead title={l.t} />
              <p className="gl-small">{l.b}</p>
            </Card>
          ))}
        </div>

        <KvList
          items={[
            { k: 'Written to', v: 'fragrances (bottles, wants, rotation flags), observations (wear tests), experiments (decant trials), calendarEvents (30-day reviews), lists (one want budget row) — all local IndexedDB.' },
            { k: 'Derived, never invented', v: 'medians, sums and per-ml figures are computed from the rows above and always print their denominator.' },
            { k: 'Left blank on purpose', v: `${wantMath.blankCount} want line(s) without a price, ${untested.length} bottle(s) without a wear test, ${bottles.filter((b) => !smelledWords(b).length).length} bottle(s) with no words you smelled.` },
            { k: 'Never', v: 'no scent description authored by the app, no price guess, no imported review, no medical or allergy claim, no reformulation watch.' }
          ]}
        />
      </section>

      {/* ---------------------------------------------------------------- modals */}
      {editing ? (
        <BottleModal
          draft={editing}
          bottles={bottles}
          testCount={editing.id ? (testsByBottle.get(editing.id) ?? []).length : 0}
          mediaById={mediaById}
          currency={currency}
          onCancel={() => setEditing(null)}
          onSave={(d) => void saveBottle(d)}
        />
      ) : null}

      {decant ? (
        <Modal
          open
          onClose={() => setDecant(null)}
          title="Decant before you commit"
          footer={
            <>
              <Button variant="ghost" onClick={() => setDecant(null)}>
                Cancel
              </Button>
              <Button variant="primary" onClick={() => void createDecant(decant)}>
                <FlaskConical size={14} /> Create the experiment row
              </Button>
            </>
          }
        >
          <div className="gl-stack">
            <SafetyBanner tone="note" title="What this writes and what it does not">
              <p className="gl-small">
                One row in the experiments table, dated from today, with your window in days. It carries no verdict, no price and no claim
                about the juice — the verdict can only arrive from wear tests you log against the bottle.
              </p>
            </SafetyBanner>
            <Field label="Which bottle">
              <Select
                value={decant.fragranceId}
                onChange={(v) => setDecant({ ...decant, fragranceId: v })}
                placeholder="Pick a want or a sample"
                options={bottles.map((b) => ({ value: b.id, label: `${b.name}${b.house ? ` — ${b.house}` : ''}${b.status === 'want' ? ' (want)' : ''}` }))}
              />
            </Field>
            <div className="gl-form-row">
              <Field label="Trial length (days)" hint="However long you would genuinely wear it before deciding.">
                <TextInput type="number" value={decant.days} onChange={(v) => setDecant({ ...decant, days: v })} />
              </Field>
              <Field label="Occasions you are testing it on">
                <TextInput value={decant.occasions} onChange={(v) => setDecant({ ...decant, occasions: v })} placeholder="work mornings, evenings out" />
              </Field>
            </div>
            <Field label="What you are trying to find out">
              <TextArea value={decant.aim} onChange={(v) => setDecant({ ...decant, aim: v })} rows={2} placeholder="Does it still please me on day nine, on my skin, at two sprays?" />
            </Field>
            <Field label="Protocol in your words">
              <TextArea value={decant.protocol} onChange={(v) => setDecant({ ...decant, protocol: v })} rows={2} placeholder="Two sprays on the forearms, logged every wear, no re-spray before the first smell check." />
            </Field>
          </div>
        </Modal>
      ) : null}

      <Modal
        open={showBudget}
        onClose={() => setShowBudget(false)}
        title="Want budget"
        footer={
          <>
            <Button variant="ghost" onClick={() => setShowBudget(false)}>
              Close
            </Button>
            <Button variant="primary" onClick={() => void saveBudget()}>
              Store the number
            </Button>
          </>
        }
      >
        <div className="gl-stack">
          <Field label="How much a month do you allow yourself for fragrance?" hint="Stored as a lists row so the want totals can be subtracted from something real.">
            <TextInput type="number" value={budgetDraft} onChange={setBudgetDraft} placeholder="0" />
          </Field>
          {budget !== null ? (
            <div className="fr-meter">
              <Meter value={wantMath.total} max={Math.max(budget, wantMath.total, 1)} label={`${fmtMoney(wantMath.total, currency)} of ${fmtMoney(budget, currency)} wanted`} />
              <div className="gl-tech">
                counted from {wantMath.pricedCount} recorded price(s); {wantMath.blankCount} want line(s) carry no price and are excluded rather than guessed.
              </div>
            </div>
          ) : (
            <div className="gl-tech">No budget stored yet — the want total currently has nothing to be compared against.</div>
          )}
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
              <Trash2 size={14} /> Soft-delete
            </Button>
          </>
        }
      >
        <p className="gl-small">
          <strong>{confirmDel?.label}</strong> will be marked deleted, not destroyed, and can be restored from Settings. Wear tests and
          bottles reference each other by id, so deleting a bottle leaves its diary entries readable but unattached.
        </p>
      </Modal>
    </div>
  );
}

/* --------------------------------------------------------------- bottle modal */

function BottleModal({
  draft,
  bottles,
  testCount,
  mediaById,
  currency,
  onCancel,
  onSave
}: {
  draft: BottleDraft;
  bottles: AnyRow[];
  testCount: number;
  mediaById: Map<string, AnyRow>;
  currency: string;
  onCancel: () => void;
  onSave: (d: BottleDraft) => void;
}) {
  const [d, setD] = useState<BottleDraft | null>(draft);
  useEffect(() => setD(draft), [draft]);
  if (!d) return null;

  const isWant = d.status === 'want';
  const paid = amount(d.price);
  const found = amount(d.priceFound);
  const ml = amount(d.sizeMl);
  const per = mlPrice(paid ?? found, ml);
  const wordCount = [...d.smelledTop, ...d.smelledHeart, ...d.smelledBase].filter(Boolean).length;
  const others = bottles.filter((b) => b.id !== d.id);

  return (
    <Modal
      open
      wide
      onClose={onCancel}
      title={d.id ? `Edit — ${d.name || 'untitled bottle'}` : 'Add to the collection'}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => onSave(d)}>
            {d.id ? 'Save changes' : 'Store this row'}
          </Button>
        </>
      }
    >
      <div className="gl-stack">
        <div className="gl-form-row">
          <Field label="Bottle name">
            <TextInput value={d.name} onChange={(v) => setD({ ...d, name: v })} placeholder="Whatever is printed on the flacon" />
          </Field>
          <Field label="House">
            <TextInput value={d.house} onChange={(v) => setD({ ...d, house: v })} placeholder="The maker, as you read it" />
          </Field>
        </div>

        <div className="gl-form-row">
          <Field label="Status">
            <Select value={d.status} onChange={(v) => setD({ ...d, status: v as StatusKey })} options={STATUSES.map((s) => ({ value: s.value, label: `${s.label} — ${s.meaning}` }))} />
          </Field>
          <Field label="Concentration, as printed">
            <Select value={d.concentration} onChange={(v) => setD({ ...d, concentration: v })} options={CONCENTRATIONS.map((c) => ({ value: c, label: c }))} />
          </Field>
        </div>

        <div className="gl-form-row">
          <Field label="Size (ml)">
            <TextInput type="number" value={d.sizeMl} onChange={(v) => setD({ ...d, sizeMl: v })} placeholder="50" />
          </Field>
          {isWant ? (
            <>
              <Field label="Price you found" hint="Blank until you find one. The app has no price for anything.">
                <TextInput type="number" value={d.priceFound} onChange={(v) => setD({ ...d, priceFound: v })} placeholder="leave blank if unknown" />
              </Field>
              <Field label="Where you saw that price">
                <TextInput value={d.priceSource} onChange={(v) => setD({ ...d, priceSource: v })} placeholder="counter, site, friend’s bottle" />
              </Field>
            </>
          ) : (
            <>
              <Field label="What you paid" hint="Blank if you were gifted it or simply do not remember.">
                <TextInput type="number" value={d.price} onChange={(v) => setD({ ...d, price: v })} placeholder="0" />
              </Field>
              <DateInput label="Bought on" value={d.boughtOn} onChange={(v) => setD({ ...d, boughtOn: v })} />
            </>
          )}
        </div>

        {per !== null ? (
          <div className="gl-tech">
            Arithmetic, not advice: {fmtMoney((paid ?? found) as number, currency)} ÷ {ml} ml = {fmtMoney(Math.round(per * 100) / 100, currency)}/ml. Both numbers came from you; delete either and the figure disappears.
          </div>
        ) : (
          <div className="gl-tech">Per-ml figure unavailable until you record both a price and a size.</div>
        )}

        <div className="fr-noteblock">
          <div className="fr-noteblock__head">
            <span className="gl-serif">What you smelled</span>
            <Chip tone="danger">the app will not fill this in</Chip>
          </div>
          <Field label="First ten minutes" hint="Words you would use. Not a pyramid — a record of your nose on one day.">
            <TagInput values={d.smelledTop} onChange={(v) => setD({ ...d, smelledTop: v })} placeholder="smoke, wet stone, soap…" />
          </Field>
          <Field label="An hour in">
            <TagInput values={d.smelledHeart} onChange={(v) => setD({ ...d, smelledHeart: v })} placeholder="papery, powdery, green…" />
          </Field>
          <Field label="What was left at the end">
            <TagInput values={d.smelledBase} onChange={(v) => setD({ ...d, smelledBase: v })} placeholder="skin, wood, nothing at all…" />
          </Field>
          <Field label="The house’s own note list (optional, typed by you)" hint="Stored separately so marketing never reads as observation.">
            <TextArea value={d.houseNotes} onChange={(v) => setD({ ...d, houseNotes: v })} rows={2} placeholder="Bergeron, violet leaf, cedar — as printed on the card at the counter" />
          </Field>
          <div className="gl-tech">
            {wordCount ? `${wordCount} of your own word(s) stored.` : 'No words yet — which honestly means “I have not smelled it long enough to describe it”. That is a valid state, not a gap to fill.'}{' '}
            {testCount ? `${testCount} wear test(s) reference this bottle.` : 'No wear test references this bottle yet.'}
          </div>
        </div>

        <div className="gl-form-row">
          <Field label="Seasons you would reach for it">
            <TagInput values={d.seasons} onChange={(v) => setD({ ...d, seasons: v })} placeholder="type and press Enter" />
          </Field>
          <Field label="Occasions">
            <TagInput values={d.occasions} onChange={(v) => setD({ ...d, occasions: v })} placeholder="work, evenings, gym…" />
          </Field>
        </div>
        <div className="fr-chiprow">
          {SEASONS.map((s) => (
            <Chip key={s} active={d.seasons.includes(s)} onClick={() => setD({ ...d, seasons: d.seasons.includes(s) ? d.seasons.filter((x) => x !== s) : [...d.seasons, s] })}>
              {s}
            </Chip>
          ))}
        </div>
        <div className="fr-chiprow">
          {OCCASIONS.map((s) => (
            <Chip key={s} active={d.occasions.includes(s)} onClick={() => setD({ ...d, occasions: d.occasions.includes(s) ? d.occasions.filter((x) => x !== s) : [...d.occasions, s] })}>
              {s}
            </Chip>
          ))}
        </div>

        {isWant ? (
          <Field label="Where this want stands">
            <Select value={d.wantDecision} onChange={(v) => setD({ ...d, wantDecision: v })} options={WANT_DECISIONS.map((w) => ({ value: w.value, label: w.label }))} />
          </Field>
        ) : (
          <div className="gl-form-row">
            <Field label="Your rating (after real wear, ideally)">
              <Rating value={d.rating} onChange={(v) => setD({ ...d, rating: v })} count={5} />
            </Field>
            <Toggle checked={d.inRotation} onChange={(v) => setD({ ...d, inRotation: v })} label="Keep in the active rotation" hint="Drives the season grid in Section 05." />
          </div>
        )}

        <Field label="Layered with (names you actually wore together)" hint={others.length ? undefined : 'Add other bottles first and their names appear as removable chips.'}>
          <TagInput values={d.layeringWith} onChange={(v) => setD({ ...d, layeringWith: v })} placeholder="another bottle from your shelf" />
        </Field>

        <Field label="Anything else about this row">
          <TextArea value={d.note} onChange={(v) => setD({ ...d, note: v })} rows={2} placeholder="Bought at an airport, half the price, no box. 30 ml travel spray." />
        </Field>

        <div className="fr-photo">
          <PhotoPicker kind="product" album="Fragrance" label="Photograph the bottle" onPick={(rows) => setD({ ...d, mediaId: rows[0]?.id ?? d.mediaId })} />
          {d.mediaId && mediaById.get(d.mediaId) ? (
            <div style={{ width: 140 }}>
              <ImageTile item={mediaById.get(d.mediaId) as AnyRow} caption="your photograph" />
              <button type="button" className="gl-btn gl-btn--sm gl-btn--ghost" onClick={() => setD({ ...d, mediaId: null })}>
                Detach
              </button>
            </div>
          ) : null}
          <div className="gl-tech">The photo is a record of your bottle. Nothing reads it — there is no liquid recognition, no label OCR and no authenticity check.</div>
        </div>
      </div>
    </Modal>
  );
}
