/**
 * THE GLOW LAB — Beauty Market & "SHOULD I BUY THIS?" (spec Part 16).
 *
 * A decision worksheet and a stock ledger. The verdict is arithmetic over the
 * numbers you typed plus your own stored prices — it is printed component by
 * component so you can argue with it. This app has no product database, no
 * price feed, no review scraping, no image recognition and no opinion about
 * quality: if you do not enter a price, the maths says "unknown" instead of
 * inventing one.
 */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlarmClock,
  ArrowLeftRight,
  Check,
  Copy,
  Plus,
  Scale,
  Search,
  ShoppingBag,
  Sparkles,
  Trash2,
  Wallet
} from 'lucide-react';
import { saveRow, useRows } from '../hooks/live';
import { addDays, formatDate, newId, softDelete, todayISO } from '../db/repo';
import { TABLES, type AnyRow, type ListItem, type TableName } from '../db/schema';
import { loadSettings, updateSettings, type AppSettings } from '../state/settings';
import {
  checkPurchaseAgainstWardrobe,
  wordsFromText,
  type CandidateInput,
  type Match,
  type PurchaseCheck
} from '../engine/duplicates';
import {
  Button,
  Card,
  CardHead,
  Chip,
  DateInput,
  Disclosure,
  EmptyState,
  Field,
  IconButton,
  Meter,
  Modal,
  Rating,
  SafetyBanner,
  SegmentedControl,
  Select,
  Table,
  TextArea,
  TextInput,
  fmtMoney,
  pct,
  useToast
} from '../ui/primitives';
import { useUndoDelete } from '../ui/undo';
import { DeptIntro, EmptyPlate, IndexList, IndexRow, KvList, StatStrip, Timeline } from '../ui/editorial';
import { ImageTile } from '../ui/media';
import '../styles/departments/market.css';

const CATEGORIES = [
  'Skincare',
  'Makeup',
  'Haircare',
  'Fragrance',
  'Grooming',
  'Tools & devices',
  'Supplements',
  'Clothing',
  'Footwear',
  'Accessories',
  'Service / appointment',
  'Other'
];

const STATUSES: { value: ProductStatus; label: string }[] = [
  { value: 'own', label: 'Owned' },
  { value: 'want', label: 'On the want list' },
  { value: 'tried', label: 'Tried / sampled' },
  { value: 'out', label: 'Finished / given away' },
  { value: 'avoid', label: 'Decided against' }
];

type ProductStatus = 'own' | 'want' | 'tried' | 'out' | 'avoid';

/* ------------------------------------------------------------------- helpers */

function amount(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const n = Number(String(raw).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}

function tokens(s: string): string[] {
  return slug(s).split('-').filter((t) => t.length > 2);
}

/** Pure string overlap. No fuzzy magic, no product knowledge. */
function similarity(a: string, b: string): number {
  const ta = new Set(tokens(a));
  const tb = new Set(tokens(b));
  if (!ta.size || !tb.size) return 0;
  let hits = 0;
  for (const t of ta) if (tb.has(t)) hits += 1;
  return hits / Math.max(1, Math.min(ta.size, tb.size));
}

function paoExpiry(openedOn: string | null, paoMonths: number | null): string | null {
  if (!openedOn || !paoMonths || paoMonths <= 0) return null;
  return addDays(openedOn, Math.round(paoMonths * 30.44));
}

/* ---------------------------------------------------------------- interfaces */

interface ProductDraft {
  id?: string;
  name: string;
  brand: string;
  category: string;
  form: string;
  sizeLabel: string;
  pricePaid: string;
  currency: string;
  whereBought: string;
  status: ProductStatus;
  openedOn: string;
  paoMonths: string;
  expiresOn: string;
  finishedOn: string;
  rating: number;
  ingredients: string;
  sourceUrl: string;
  note: string;
}

function productDraft(p?: AnyRow): ProductDraft {
  return {
    id: p?.id,
    name: p?.name ?? '',
    brand: p?.brand ?? '',
    category: CATEGORIES.includes(String(p?.category ?? '')) ? String(p?.category) : 'Other',
    form: p?.form ?? '',
    sizeLabel: p?.sizeLabel ?? '',
    pricePaid: p?.pricePaid == null ? '' : String(p.pricePaid),
    currency: p?.currency ?? 'USD',
    whereBought: (p?.data?.whereBought as string) ?? '',
    status: (p?.status as ProductStatus) ?? 'own',
    openedOn: p?.openedOn ?? '',
    paoMonths: p?.data?.paoMonths == null ? '' : String(p.data.paoMonths),
    expiresOn: p?.expiresOn ?? '',
    finishedOn: p?.finishedOn ?? '',
    rating: p?.rating ?? 0,
    ingredients: p?.ingredients ?? '',
    sourceUrl: p?.sourceUrl ?? '',
    note: (p?.data?.note as string) ?? ''
  };
}

function productPayload(d: ProductDraft): Record<string, unknown> {
  return {
    id: d.id,
    name: d.name.trim(),
    brand: d.brand.trim(),
    category: d.category,
    form: d.form,
    sizeLabel: d.sizeLabel,
    pricePaid: amount(d.pricePaid),
    currency: d.currency,
    owned: d.status === 'own',
    openedOn: d.openedOn || null,
    expiresOn: d.expiresOn || paoExpiry(d.openedOn || null, amount(d.paoMonths)) || null,
    finishedOn: d.finishedOn || null,
    rating: d.rating,
    ingredients: d.ingredients,
    sourceUrl: d.sourceUrl.trim(),
    status: d.status,
    duplicateKey: `${slug(d.name)}|${slug(d.brand)}`,
    tags: [d.category.toLowerCase(), slug(d.brand)].filter(Boolean),
    data: { whereBought: d.whereBought, paoMonths: amount(d.paoMonths), note: d.note }
  };
}

interface Worksheet {
  label: string;
  brand: string;
  category: string;
  price: string;
  usesPerMonth: string;
  months: string;
  necessity: number;
  origin: string;
  alreadyOwns: string;
  dupQuery: string;
}

const BLANK_WORKSHEET: Worksheet = {
  label: '',
  brand: '',
  category: 'Skincare',
  price: '',
  usesPerMonth: '',
  months: '',
  necessity: 3,
  origin: '',
  alreadyOwns: '',
  dupQuery: ''
};

/* ------------------------------------------------------------------ settings */

function useSettings(): [AppSettings | null, (p: Partial<AppSettings>) => void] {
  const [s, setS] = useState<AppSettings | null>(null);
  useEffect(() => {
    let live = true;
    void loadSettings().then((v) => live && setS(v));
    return () => {
      live = false;
    };
  }, []);
  return [
    s,
    (p) => {
      void updateSettings(p).then((next) => setS(next));
    }
  ];
}

/* ---------------------------------------------------------------- verdict fn */

interface Component {
  label: string;
  value: number;
  why: string;
}

interface Verdict {
  word: 'buy' | 'wait' | 'skip';
  score: number;
  components: Component[];
  costPerUse: number | null;
  usesTotal: number | null;
  remaining: number | null;
  dupes: { table: string; label: string; where: string; sim: number }[];
  problems: string[];
}

function decide(
  w: Worksheet,
  opts: {
    currency: string;
    monthlyBudget: number;
    spentThisMonth: number;
    products: AnyRow[];
    clothing: AnyRow[];
    purchases: AnyRow[];
  }
): Verdict {
  const price = amount(w.price);
  const usesPerMonth = amount(w.usesPerMonth);
  const months = amount(w.months);
  const problems: string[] = [];
  const components: Component[] = [];

  if (price === null) problems.push('No price entered — cost-per-use and budget fit are unknown, not zero.');
  if (!usesPerMonth || usesPerMonth <= 0) problems.push('Uses per month is empty or zero, so cost-per-use cannot be divided.');
  if (!months || months <= 0) problems.push('Months of expected use is empty, so total uses are unknown.');

  const usesTotal = usesPerMonth && months ? usesPerMonth * months : null;
  const costPerUse = price !== null && usesTotal ? price / usesTotal : null;

  /* 1. your own stated necessity, 1–5 */
  components.push({ label: 'Necessity you rated', value: w.necessity, why: `your slider said ${w.necessity} of 5` });

  /* 2. frequency band from your own uses/month number */
  const freq = usesPerMonth === null ? 0 : usesPerMonth >= 12 ? 3 : usesPerMonth >= 6 ? 2 : usesPerMonth >= 2 ? 0.5 : usesPerMonth >= 1 ? -0.5 : -3;
  components.push({
    label: 'Frequency band',
    value: freq,
    why: `${usesPerMonth ?? 'blank'} uses per month → ${usesPerMonth === null ? 'no data, 0' : usesPerMonth >= 12 ? 'near-daily = +3' : usesPerMonth >= 6 ? 'weekly-plus = +2' : usesPerMonth >= 2 ? 'occasional = +0.5' : usesPerMonth >= 1 ? 'once a month = -0.5' : 'never = -3'}`
  });

  /* 3. budget fit against the money actually left this month */
  const remaining = opts.monthlyBudget - opts.spentThisMonth;
  let budgetFit = 0;
  if (price === null) budgetFit = 0;
  else if (remaining <= 0) budgetFit = -2;
  else if (price <= remaining) budgetFit = 2;
  else if (price <= remaining * 1.5) budgetFit = 0.5;
  else if (price <= remaining * 3) budgetFit = -1;
  else budgetFit = -2.5;
  components.push({
    label: 'Budget fit',
    value: budgetFit,
    why: `price ${fmtMoney(price, opts.currency)} vs ${fmtMoney(remaining, opts.currency)} left this month (budget ${fmtMoney(opts.monthlyBudget, opts.currency)} − spent ${fmtMoney(opts.spentThisMonth, opts.currency)})`
  });

  /* 4. duplication against the rows you already own */
  const needle = `${w.label} ${w.brand} ${w.alreadyOwns} ${w.dupQuery}`.trim();
  const dupes: Verdict['dupes'] = [];
  if (needle.trim().length > 2) {
    for (const p of opts.products) {
      if (p.status === 'avoid') continue;
      const sim = similarity(needle, `${p.name} ${p.brand} ${p.category}`);
      if (sim >= 0.5) dupes.push({ table: 'products', label: `${p.name}${p.brand ? ` — ${p.brand}` : ''}`, where: `status ${p.status}, ${fmtMoney(p.pricePaid ?? null, String(p.currency ?? opts.currency))}`, sim });
    }
    for (const c of opts.clothing) {
      const sim = similarity(needle, `${c.name} ${c.brand} ${c.category}`);
      if (sim >= 0.5) dupes.push({ table: 'clothingItems', label: `${c.name}${c.brand ? ` — ${c.brand}` : ''}`, where: `${c.category}, ${c.wears ?? 0} wears logged`, sim });
    }
    for (const pu of opts.purchases) {
      const sim = similarity(needle, `${pu.label} ${pu.retailer}`);
      if (sim >= 0.5) dupes.push({ table: 'purchases', label: String(pu.label), where: `${formatDate(pu.boughtOn)} · ${fmtMoney(pu.amount, String(pu.currency ?? opts.currency))}`, sim });
    }
  }
  dupes.sort((a, b) => b.sim - a.sim);
  const dupPenalty = dupes.length ? Math.min(4, dupes.length * 1.5) : 0;
  components.push({
    label: 'Duplication penalty',
    value: -dupPenalty,
    why: dupes.length ? `${dupes.length} stored record(s) with name overlap ≥ 0.5 (max penalty 4)` : 'no overlapping record found in your own rows'
  });

  /* 5. cost-per-use compared to what you already paid for similar things */
  const ownedPrices = opts.products.filter((p) => typeof p.pricePaid === 'number').map((p) => p.pricePaid as number);
  const medianPaid = ownedPrices.length ? [...ownedPrices].sort((a, b) => a - b)[Math.floor(ownedPrices.length / 2)] : null;
  let cupScore = 0;
  if (costPerUse !== null && medianPaid !== null) {
    cupScore = costPerUse <= medianPaid * 0.15 ? 1.5 : costPerUse <= medianPaid * 0.5 ? 0.5 : costPerUse <= medianPaid ? -0.5 : -1.5;
  }
  components.push({
    label: 'Cost-per-use vs your own median paid price',
    value: cupScore,
    why:
      costPerUse === null
        ? 'not computable from the numbers given'
        : medianPaid === null
          ? 'you have no stored prices to compare against'
          : `${fmtMoney(costPerUse, opts.currency)} per use against a median paid price of ${fmtMoney(medianPaid, opts.currency)} (from ${ownedPrices.length} of your rows)`
  });

  const score = components.reduce((s, c) => s + c.value, 0);
  const word: Verdict['word'] = score >= 5 ? 'buy' : score >= 2 ? 'wait' : 'skip';
  return { word, score, components, costPerUse, usesTotal, remaining, dupes, problems };
}

/* ------------------------------------------------------------- "at home" scan */

/**
 * Building blocks for the Already at home? check. Nothing here knows a product:
 * the only words it can use are the ones in the worksheet or on the wishlist
 * line, and `wordsFromText` hands back the user's own spelling, not a category.
 */
function worksheetCandidate(w: Worksheet, currency: string): CandidateInput | null {
  const label = String(w.label ?? '').trim();
  if (label.length < 2) return null;
  const found = wordsFromText(`${label} ${w.alreadyOwns} ${w.dupQuery}`);
  return {
    id: 'worksheet',
    name: label,
    brand: String(w.brand ?? '').trim(),
    category: w.category,
    colours: found.colours,
    material: found.materials.join(', '),
    fit: found.fits.join(', '),
    seasons: found.seasons,
    price: amount(w.price),
    currency
  };
}

function wishItemCandidate(it: ListItem, product: AnyRow | undefined, currency: string): CandidateInput {
  const found = wordsFromText(`${it.label} ${it.neededFor ?? ''} ${product?.name ?? ''} ${product?.form ?? ''}`);
  const estPrice = typeof it.estPrice === 'number' ? it.estPrice : null;
  return {
    id: it.id,
    name: String(product?.name ?? it.label ?? '').trim(),
    brand: String(product?.brand ?? ''),
    category: String(product?.category ?? ''),
    colours: found.colours,
    material: found.materials.join(', '),
    fit: found.fits.join(', '),
    seasons: found.seasons,
    price: product?.pricePaid == null ? estPrice : Number(product.pricePaid),
    currency: String(product?.currency ?? currency)
  };
}

function wantCandidate(p: AnyRow, currency: string): CandidateInput {
  const found = wordsFromText(`${p.name ?? ''} ${p.form ?? ''} ${p.sizeLabel ?? ''}`);
  return {
    id: String(p.id),
    name: String(p.name ?? '').trim(),
    brand: String(p.brand ?? ''),
    category: String(p.category ?? ''),
    colours: found.colours,
    material: found.materials.join(', '),
    fit: found.fits.join(', '),
    seasons: found.seasons,
    price: p.pricePaid == null ? null : Number(p.pricePaid),
    currency: String(p.currency ?? currency)
  };
}

interface AtHomeGroup {
  key: string;
  title: string;
  where: string;
  cand: CandidateInput;
  check: PurchaseCheck;
}

const SOURCE_WHERE: Record<string, string> = {
  clothingItems: 'closet row',
  products: 'inventory row',
  purchases: 'purchase row'
};

/** The words the comparison actually got hold of — echoed from what you typed. */
function readFrom(cand: CandidateInput): string {
  const colours = cand.colours ?? [];
  const seasons = cand.seasons ?? [];
  const bits: string[] = [];
  if (cand.category) bits.push(cand.category);
  if (colours.length) bits.push(colours.join(', '));
  if (cand.material) bits.push(cand.material);
  if (cand.fit) bits.push(cand.fit);
  if (seasons.length) bits.push(seasons.join(', '));
  return bits.join(' · ');
}

function AtHomeMatchRow({
  m,
  currency,
  media,
  onOpen
}: {
  m: Match;
  currency: string;
  media: Map<string, AnyRow>;
  onOpen: (m: Match) => void;
}) {
  const photo = m.mediaId ? (media.get(m.mediaId) ?? null) : null;
  const priceLine = m.price === null ? 'price unverified — the row carries none' : `${fmtMoney(m.price, m.currency || currency)} you paid`;
  const wearLine = m.wears === null ? 'this record type has no wear count' : `${m.wears} wear(s) logged`;
  return (
    <div className="mk-atm__match">
      {photo ? <ImageTile item={photo} caption="your photo" /> : null}
      <div className="mk-atm__body">
        <div className="gl-row gl-row--tight" style={{ flexWrap: 'wrap' }}>
          <Chip tone={m.score >= 0.95 ? 'danger' : 'limited'}>{pct(m.score)} match</Chip>
          <Chip>{SOURCE_WHERE[m.source] ?? m.source}</Chip>
          {m.sparse ? <Chip tone="weak">few fields to compare</Chip> : null}
          {m.price === null ? <Chip tone="weak">price unverified</Chip> : null}
        </div>
        <div className="gl-small gl-strong">
          {m.label}
          {m.brand ? ` — ${m.brand}` : ''}
        </div>
        <div className="gl-tech">
          {m.size ? `size ${m.size} · ` : 'size not recorded · '}
          {priceLine} · {wearLine}
        </div>
        <div className="gl-tech">{m.costNote}</div>
        {m.why.length ? (
          <ul className="mk-atm__why">
            {m.why.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        ) : null}
        {m.sim.differs.length ? (
          <div className="gl-small gl-muted">
            Where your own rows disagree:{' '}
            {m.sim.differs.map((d) => `${d.axis} — ${d.a || 'blank'} against ${d.b || 'blank'}`).join('; ')}
          </div>
        ) : null}
        {m.missing.length ? (
          <Disclosure summary={`Fields left blank on one side (${m.missing.length})`}>
            <ul className="mk-atm__why">
              {m.missing.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
            <p className="gl-small gl-faint">
              A blank field cannot count for a match, so it only pulls the score down. The best this pair could have scored is{' '}
              {pct(m.ceiling)} of the 24-point frame; across the fields actually filled in, certainty is {pct(m.certainty)}.
            </p>
          </Disclosure>
        ) : null}
        <Button size="sm" variant="ghost" onClick={() => onOpen(m)}>
          <ArrowLeftRight size={12} /> {m.source === 'clothingItems' ? 'Find it in the closet' : 'Open the row'}
        </Button>
      </div>
    </div>
  );
}

function AtHomeGroupCard({
  group,
  currency,
  media,
  onOpen
}: {
  group: AtHomeGroup;
  currency: string;
  media: Map<string, AnyRow>;
  onOpen: (m: Match) => void;
}) {
  const found = [...group.check.exact, ...group.check.possible];
  const read = readFrom(group.cand);
  return (
    <div className="mk-atm">
      <div className="mk-atm__head">
        <div>
          <div className="gl-eyebrow">{group.where}</div>
          <div className="gl-serif" style={{ fontSize: '1.05rem' }}>
            {group.title}
          </div>
        </div>
        <Chip tone={found.length ? 'danger' : 'gold'}>{found.length ? `${found.length} possible` : 'no overlap'}</Chip>
      </div>
      <div className="gl-tech">
        Read from your own words: {read || 'the name only — nothing descriptive to compare, so any flag here rests on thin evidence'}
        {group.cand.price !== null && group.cand.price !== undefined ? ` · price asked ${fmtMoney(group.cand.price, group.cand.currency || currency)}` : ' · no price typed'}
      </div>
      {found.length === 0 ? (
        <div className="gl-note">
          No clothing, product or purchase row reached the comparison threshold for this. That is a statement about your records,
          not about the item.
        </div>
      ) : (
        <div className="mk-atm__list">
          {group.check.exact.length ? <div className="gl-label">Every field you filled in agrees</div> : null}
          {group.check.exact.map((m) => (
            <AtHomeMatchRow key={`x-${m.source}-${m.id}`} m={m} currency={currency} media={media} onOpen={onOpen} />
          ))}
          {group.check.possible.length ? <div className="gl-label">Possibly the same kind of thing</div> : null}
          {group.check.possible.map((m) => (
            <AtHomeMatchRow key={`p-${m.source}-${m.id}`} m={m} currency={currency} media={media} onOpen={onOpen} />
          ))}
          {group.check.unpriced.length ? (
            <p className="gl-small gl-faint">
              {group.check.unpriced.length} of these rows have no price you typed, so their cost per wear prints as unverified
              rather than estimated.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------------- page */

export default function MarketPage() {
  const products = useRows(TABLES.products);
  const purchases = useRows(TABLES.purchases);
  const lists = useRows(TABLES.lists);
  const clothing = useRows(TABLES.clothingItems);
  const events = useRows(TABLES.calendarEvents);
  const [settings, patchSettings] = useSettings();
  const toast = useToast();
  const remove = useUndoDelete();
  const navigate = useNavigate();

  const currency = settings?.currency ?? 'USD';
  const monthlyBudget = settings?.monthlyBudget ?? 0;
  const thisMonth = monthKey(todayISO());

  const [ws, setWs] = useState<Worksheet>(BLANK_WORKSHEET);
  const [dupQuery, setDupQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [editor, setEditor] = useState<ProductDraft | null>(null);
  const [purchaseOf, setPurchaseOf] = useState<{ id: string; name: string; brand: string; category: string; pricePaid: number | null } | null>(null);
  const [purchaseDraft, setPurchaseDraft] = useState({ amount: '', retailer: '', boughtOn: todayISO(), reason: '', orderRef: '' });
  const [confirmDel, setConfirmDel] = useState<{ table: TableName; id: string; label: string } | null>(null);
  const [detail, setDetail] = useState<AnyRow | null>(null);

  const spentThisMonth = useMemo(
    () => purchases.filter((p) => monthKey(String(p.boughtOn ?? '')) === thisMonth).reduce((s, p) => s + (Number(p.amount) || 0), 0),
    [purchases, thisMonth]
  );

  const verdict = useMemo(
    () => decide(ws, { currency, monthlyBudget, spentThisMonth, products, clothing, purchases }),
    [ws, currency, monthlyBudget, spentThisMonth, products, clothing, purchases]
  );

  const lifetime = useMemo(() => purchases.reduce((s, p) => s + (Number(p.amount) || 0), 0), [purchases]);

  const reminders = useMemo(() => {
    const rows = products
      .filter((p) => p.status === 'own' && (p.openedOn || p.expiresOn))
      .map((p) => {
        const est = paoExpiry((p.openedOn as string) ?? null, (p.data?.paoMonths as number) ?? null);
        const target = (p.expiresOn as string) ?? est;
        if (!target) return null;
        const left = daysBetween(todayISO(), target);
        return { row: p, target, left, viaPAO: !p.expiresOn && Boolean(est) };
      })
      .filter(Boolean) as { row: AnyRow; target: string; left: number; viaPAO: boolean }[];
    return rows.sort((a, b) => a.left - b.left);
  }, [products]);

  const dupMatches = useMemo(() => {
    if (dupQuery.trim().length < 3) return [];
    const out: { table: string; label: string; detail: string; sim: number; id: string }[] = [];
    for (const p of products) {
      const sim = similarity(dupQuery, `${p.name} ${p.brand} ${p.category} ${p.form} ${p.sizeLabel}`);
      if (sim >= 0.34) out.push({ table: 'products', id: p.id, label: `${p.name}${p.brand ? ` — ${p.brand}` : ''}`, detail: `${p.status} · ${fmtMoney(p.pricePaid ?? null, String(p.currency ?? currency))}${p.openedOn ? ` · opened ${formatDate(String(p.openedOn))}` : ''}`, sim });
    }
    for (const c of clothing) {
      const sim = similarity(dupQuery, `${c.name} ${c.brand} ${c.category} ${c.material}`);
      if (sim >= 0.34) out.push({ table: 'clothingItems', id: c.id, label: `${c.name}${c.brand ? ` — ${c.brand}` : ''}`, detail: `${c.category} · ${c.wears ?? 0} wears · ${fmtMoney(c.price ?? null, currency)}`, sim });
    }
    for (const pu of purchases) {
      const sim = similarity(dupQuery, `${pu.label} ${pu.retailer} ${pu.reason}`);
      if (sim >= 0.34) out.push({ table: 'purchases', id: pu.id, label: String(pu.label), detail: `${formatDate(String(pu.boughtOn))} · ${fmtMoney(pu.amount, String(pu.currency ?? currency))} at ${pu.retailer || 'retailer not recorded'}`, sim });
    }
    return out.sort((a, b) => b.sim - a.sim).slice(0, 14);
  }, [dupQuery, products, clothing, purchases, currency]);

  const wishlist = lists.filter((l) => l.kind === 'wishlist');

  /* ---- Already at home? — the closet, the shelf and the ledger, cross-read ---- */
  const mediaRows = useRows(TABLES.mediaItems);
  const mediaById = useMemo(() => new Map(mediaRows.map((m) => [m.id, m])), [mediaRows]);
  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  const atHome = useMemo<AtHomeGroup[]>(() => {
    const run = (c: CandidateInput) => checkPurchaseAgainstWardrobe(c, { clothing, products, purchases });
    const groups: AtHomeGroup[] = [];
    const w = worksheetCandidate(ws, currency);
    if (w) groups.push({ key: 'worksheet', title: w.name, where: 'the worksheet, as typed', cand: w, check: run(w) });
    for (const l of wishlist) {
      if (l.closedOn) continue;
      for (const it of ((l.items as ListItem[]) ?? [])) {
        if (it.checked) continue;
        const cand = wishItemCandidate(it, it.productId ? productById.get(it.productId) : undefined, currency);
        if (cand.name.length < 2) continue;
        groups.push({ key: `wish-${l.id}-${it.id}`, title: cand.name, where: `wishlist · ${l.name}`, cand, check: run(cand) });
      }
    }
    for (const p of products) {
      if (p.status !== 'want') continue;
      if (groups.some((g) => g.cand.id === p.id)) continue;
      const cand = wantCandidate(p, currency);
      if (cand.name.length < 2) continue;
      groups.push({ key: `want-${p.id}`, title: cand.name, where: 'want list, status want', cand, check: run(cand) });
    }
    return groups;
  }, [ws, currency, wishlist, products, clothing, purchases, productById]);

  const atHomeSeen = atHome.reduce((s, g) => s + g.check.exact.length + g.check.possible.length, 0);
  const atHomeFlagged = atHome.filter((g) => g.check.exact.length + g.check.possible.length > 0);
  const atHomeQuiet = atHome.filter((g) => g.check.exact.length + g.check.possible.length === 0);

  function openAt(m: Match) {
    if (m.source === 'clothingItems') {
      navigate(`/closet?find=${encodeURIComponent(m.label)}`);
      return;
    }
    const row = m.source === 'products' ? productById.get(m.id) : purchases.find((p) => p.id === m.id);
    if (row) {
      setDetail(row);
      return;
    }
    toast('That row is no longer in the database, so there is nothing to open.', 'info');
  }

  /* ------------------------------------------------------------------ writes */

  async function saveProduct() {
    if (!editor) return;
    if (!editor.name.trim()) {
      toast('The name is the only part you have to type.', 'bad');
      return;
    }
    await saveRow(TABLES.products, productPayload(editor) as AnyRow);
    toast(editor.id ? 'Product updated.' : 'Product stored in your inventory.', 'ok');
    setEditor(null);
  }

  async function act(kind: 'buy' | 'wait' | 'skip') {
    if (!ws.label.trim()) {
      toast('Name the thing you are deciding about.', 'bad');
      return;
    }
    const price = amount(ws.price);
    const productId = newId('prd');
    const snapshot = [
      `Verdict: ${verdict.word} at score ${verdict.score.toFixed(1)}`,
      ...verdict.components.map((c) => `${c.label}: ${c.value} (${c.why})`),
      verdict.costPerUse !== null ? `cost per use = ${price} ÷ ${verdict.usesTotal} uses = ${verdict.costPerUse.toFixed(3)} ${currency}` : 'cost per use: not computable',
      ...verdict.problems
    ].join('\n');

    if (kind === 'buy') {
      setPurchaseOf({
        id: productId,
        name: ws.label.trim(),
        brand: ws.brand.trim(),
        category: ws.category,
        pricePaid: price
      });
      setPurchaseDraft({ amount: price !== null ? String(price) : '', retailer: ws.origin, boughtOn: todayISO(), reason: snapshot.slice(0, 300), orderRef: '' });
      return;
    }

    await saveRow(TABLES.products, {
      id: productId,
      name: ws.label.trim(),
      brand: ws.brand.trim(),
      category: ws.category,
      form: '',
      sizeLabel: '',
      pricePaid: price,
      currency,
      owned: false,
      openedOn: null,
      expiresOn: null,
      finishedOn: null,
      rating: 0,
      ingredients: '',
      sourceUrl: '',
      status: kind === 'skip' ? 'avoid' : 'want',
      duplicateKey: `${slug(ws.label)}|${slug(ws.brand)}`,
      tags: [kind === 'skip' ? 'declined' : 'want'],
      data: { note: snapshot, decidedOn: todayISO(), worksheet: ws, score: verdict.score }
    });

    if (kind === 'wait') {
      const on = addDays(todayISO(), 30);
      await saveRow(TABLES.calendarEvents, {
        title: `Still want “${ws.label.trim()}”?`,
        kind: 'cooling-off',
        startAt: new Date(`${on}T09:00:00`).getTime(),
        endAt: null,
        recurrence: { freq: 'monthly', interval: 1, until: on, byweekday: [] },
        reminders: [],
        checklist: [{ id: newId('chk'), label: 'Do I still want this after 30 days?', done: false }],
        linkDomain: 'market',
        linkId: productId,
        cost: price,
        doneOn: null,
        note: snapshot,
        tags: ['cooling-off']
      });
      toast(`Want-listed with a 30-day review on ${formatDate(on)}.`, 'ok');
      return;
    }
    toast('Recorded as decided-against, with the arithmetic attached.', 'ok');
  }

  async function commitPurchase() {
    if (!purchaseOf) return;
    const amt = amount(purchaseDraft.amount);
    await saveRow(TABLES.products, {
      id: purchaseOf.id,
      name: purchaseOf.name,
      brand: purchaseOf.brand ?? '',
      category: purchaseOf.category ?? 'Other',
      pricePaid: amt,
      currency,
      owned: true,
      status: 'own',
      openedOn: null,
      duplicateKey: `${slug(String(purchaseOf.name))}|${slug(String(purchaseOf.brand ?? ''))}`,
      data: { whereBought: purchaseDraft.retailer, decision: 'buy', boughtOn: purchaseDraft.boughtOn }
    });
    await saveRow(TABLES.purchases, {
      productId: purchaseOf.id,
      label: String(purchaseOf.name),
      amount: amt ?? 0,
      currency,
      boughtOn: purchaseDraft.boughtOn,
      retailer: purchaseDraft.retailer,
      orderRef: purchaseDraft.orderRef,
      reason: purchaseDraft.reason,
      wouldBuyAgain: null,
      tags: ['purchase']
    });
    toast('Purchase logged — it now counts against this month.', 'ok');
    setPurchaseOf(null);
    setWs(BLANK_WORKSHEET);
  }

  async function toggleWishItem(list: AnyRow, item: ListItem) {
    const next = ((list.items as ListItem[]) ?? []).map((it) => (it.id === item.id ? { ...it, checked: !it.checked } : it));
    await saveRow(TABLES.lists, { id: list.id, items: next });
  }

  async function ratePurchase(p: AnyRow, v: number) {
    await saveRow(TABLES.purchases, { id: p.id, wouldBuyAgain: v });
  }

  async function runDelete() {
    if (!confirmDel) return;
    await remove(confirmDel.table, confirmDel.id, confirmDel.label);
    setConfirmDel(null);
  }

  /* ------------------------------------------------------------------- view */

  const inventory = useMemo(
    () => (statusFilter ? products.filter((p) => p.status === statusFilter) : products),
    [products, statusFilter]
  );

  return (
    <div className="gl-page mk-page">
      <DeptIntro
        id="market"
        deck="Your inventory, your spend and one decision worksheet. Every figure is arithmetic over rows you typed; the app knows nothing about products it has never been told about."
        actions={
          <>
            <Button variant="primary" onClick={() => setEditor(productDraft())}>
              <Plus size={14} /> Add a product
            </Button>
            <Button onClick={() => document.getElementById('mk-worksheet')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}>
              <Scale size={14} /> Open the worksheet
            </Button>
            <Button variant="ghost" onClick={() => navigate('/closet')}>
              Closet
            </Button>
          </>
        }
        meta={[
          { label: 'Products recorded', value: String(products.length) },
          { label: 'Purchases logged', value: String(purchases.length) },
          { label: 'Month', value: thisMonth }
        ]}
      />

      {/* ------------------------------------------------------------- budget */}
      <StatStrip
        items={[
          { label: 'Products tracked', value: String(products.length), hint: `${products.filter((p) => p.status === 'own').length} owned` },
          { label: 'Spent this month', value: fmtMoney(spentThisMonth, currency), hint: `purchase rows in ${thisMonth}` },
          { label: 'Budget', value: fmtMoney(monthlyBudget, currency), hint: 'settings row, editable below' },
          { label: 'Duplicate flags', value: String(dupMatches.length), hint: dupQuery.trim() ? 'token overlap' : 'run a search' },
          { label: 'PAO clocks running', value: String(reminders.length), hint: 'opened date + months' }
        ]}
      />

      <Card>
        <CardHead
          title="This month against your own budget"
          eyebrow="sum of purchase rows dated in the current month"
          right={<Chip tone={spentThisMonth > monthlyBudget ? 'danger' : 'gold'}>{fmtMoney(monthlyBudget - spentThisMonth, currency)} left</Chip>}
        />
        <Meter
          label={`Spent ${fmtMoney(spentThisMonth, currency)} of ${fmtMoney(monthlyBudget, currency)}`}
          value={monthlyBudget ? (spentThisMonth / monthlyBudget) * 100 : 0}
          tone={spentThisMonth > monthlyBudget ? 'var(--glow-bad)' : undefined}
        />
        <div className="gl-tech" style={{ marginTop: 6 }}>
          formula: sum(amount) where boughtOn starts with “{thisMonth}” → {fmtMoney(spentThisMonth, currency)}. Lifetime logged: {fmtMoney(lifetime, currency)} across {purchases.length} purchases.
        </div>
        <div className="gl-form-row" style={{ marginTop: 'var(--glow-sp-4)' }}>
          <Field label="Monthly budget" hint="Stored in the settings row — this is the only budget number the worksheet can use.">
            <TextInput type="number" value={String(monthlyBudget)} onChange={(v) => patchSettings({ monthlyBudget: amount(v) ?? 0 })} />
          </Field>
          <Field label="Currency">
            <Select
              value={currency}
              onChange={(v) => patchSettings({ currency: v })}
              options={['USD', 'EUR', 'GBP', 'NGN', 'GHS', 'KES', 'ZAR', 'CAD', 'AUD', 'INR', 'JPY'].map((c) => ({ value: c, label: c }))}
            />
          </Field>
        </div>
        <p className="gl-small gl-faint">
          Products can carry a price without being purchases. Only purchase rows move the month total, so browsing and deciding
          never silently spend your budget.
        </p>
      </Card>

      {/* ---------------------------------------------------------- worksheet */}
      <section className="gl-section" id="mk-worksheet" style={{ marginTop: 'var(--glow-sp-5)' }}>
        <div className="gl-section__title">
          <div>
            <div className="gl-eyebrow">SHOULD I BUY THIS?</div>
            <h2>The worksheet, with its arithmetic exposed</h2>
          </div>
          <Chip tone="info">{verdict.components.length} components · thresholds printed</Chip>
        </div>

        <div className="mk-plate">
          <div className="gl-split" style={{ alignItems: 'start' }}>
            <div className="gl-stack">
              <div className="gl-form-row">
                <Field label="What is it" hint="Your words. There is no catalogue to pick from.">
                  <TextInput value={ws.label} onChange={(v) => setWs({ ...ws, label: v })} placeholder="A second fine-knit navy jumper" />
                </Field>
                <Field label="Brand, if known">
                  <TextInput value={ws.brand} onChange={(v) => setWs({ ...ws, brand: v })} placeholder="Type it or leave blank" />
                </Field>
                <Field label="Category">
                  <Select value={ws.category} onChange={(v) => setWs({ ...ws, category: v })} options={CATEGORIES.map((c) => ({ value: c, label: c }))} />
                </Field>
                <Field label="Price asked" hint="Number only, in your currency.">
                  <TextInput type="number" value={ws.price} onChange={(v) => setWs({ ...ws, price: v })} placeholder="89" />
                </Field>
                <Field label="Uses per month you realistically expect">
                  <TextInput type="number" value={ws.usesPerMonth} onChange={(v) => setWs({ ...ws, usesPerMonth: v })} placeholder="6" />
                </Field>
                <Field label="Over how many months">
                  <TextInput type="number" value={ws.months} onChange={(v) => setWs({ ...ws, months: v })} placeholder="18" />
                </Field>
              </div>
              <Field label={`How necessary does this feel? ${ws.necessity}/5`} hint="This is your opinion and it is weighted as one component out of five.">
                <div>
                  <input
                    type="range"
                    className="gl-range"
                    min={1}
                    max={5}
                    step={1}
                    value={ws.necessity}
                    aria-label="Necessity from 1 to 5"
                    onChange={(e) => setWs({ ...ws, necessity: Number(e.target.value) })}
                    style={{ width: '100%', accentColor: 'var(--glow-accent-soft)' }}
                  />
                </div>
              </Field>
              <Field label="Where the want came from" hint="Ad, friend, restock, boredom — recorded as text, used nowhere in the maths.">
                <TextInput value={ws.origin} onChange={(v) => setWs({ ...ws, origin: v })} placeholder="Saw it on a commute-scroll" />
              </Field>
              <div className="gl-form-row">
                <Field label="What already does this job" hint="Free text; feeds the duplication search together with the name and brand.">
                  <TextInput value={ws.alreadyOwns} onChange={(v) => setWs({ ...ws, alreadyOwns: v })} placeholder="The grey one I own two of" />
                </Field>
                <Field label="Extra duplicate-search words">
                  <TextInput value={ws.dupQuery} onChange={(v) => setWs({ ...ws, dupQuery: v })} placeholder="jumper knit navy" />
                </Field>
              </div>
            </div>

            <div className="gl-stack">
              <div className="mk-verdict" data-verdict={verdict.word}>
                <div className="gl-label">Verdict from your own inputs</div>
                <div className="mk-word">{verdict.word.toUpperCase()}</div>
                <div className="gl-tech">
                  score {verdict.score.toFixed(1)} · buy at 5.0 or above · wait from 2.0 · skip below 2.0
                </div>
              </div>

              <div className="mk-formula">
                score = necessity + frequency + budgetFit − duplicatePenalty + costPerUseVsMedian
                <br />
                cost per use = price ÷ (usesPerMonth × months)
                <br />
                duplicatePenalty = min(4, 1.5 × matching stored rows)
              </div>

              <div className="mk-rows">
                {verdict.components.map((c) => (
                  <div key={c.label} style={{ display: 'contents' }}>
                    <span>{c.label}</span>
                    <span>{c.value > 0 ? `+${c.value}` : c.value}</span>
                    <span style={{ gridColumn: '1 / span 2', color: 'var(--glow-text-faint)', fontSize: '0.72rem' }}>{c.why}</span>
                  </div>
                ))}
                <span>Total uses assumed</span>
                <span>{verdict.usesTotal ?? 'unknown'}</span>
                <span>Cost per use</span>
                <span>{verdict.costPerUse === null ? 'not computable' : `${verdict.costPerUse.toFixed(2)} ${currency}`}</span>
              </div>

              {verdict.problems.length ? (
                <SafetyBanner tone="warn" title="Missing inputs, stated plainly">
                  <ul style={{ margin: '4px 0 0 18px' }}>
                    {verdict.problems.map((p) => (
                      <li key={p} className="gl-small">
                        {p}
                      </li>
                    ))}
                  </ul>
                </SafetyBanner>
              ) : null}

              {verdict.dupes.length ? (
                <div className="mk-dupes">
                  <div className="gl-label">Your own records that overlap</div>
                  {verdict.dupes.slice(0, 6).map((x, i) => (
                    <div className="mk-dupe" key={`${x.table}-${i}`}>
                      <span className="gl-small">{x.label}</span>
                      <span className="gl-tech">
                        {x.table} · {(x.sim * 100).toFixed(0)}% name overlap · {x.where}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="gl-tech">Duplication scan found nothing in your stored rows for those words.</div>
              )}

              <div className="gl-row gl-row--tight" style={{ flexWrap: 'wrap' }}>
                <Button variant="primary" onClick={() => void act('buy')}>
                  <Check size={14} /> Buy it — log the purchase
                </Button>
                <Button onClick={() => void act('wait')}>
                  <AlarmClock size={14} /> Wait 30 days
                </Button>
                <Button variant="danger" onClick={() => void act('skip')}>
                  <Trash2 size={14} /> Skip and record why
                </Button>
              </div>

              <Disclosure summary="What this worksheet does not know">
                <p className="gl-small">
                  It cannot judge quality, ethics, durability, fit or ingredients. It has never seen the product, has no price
                  history and no reviews. It knows only the six numbers you typed and the rows already in your database. A high
                  score means the arithmetic favoured buying — nothing more, and certainly not that the item is good.
                </p>
              </Disclosure>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------- already at home? */}
      <Card>
        <CardHead
          title="Already at home?"
          eyebrow="the worksheet, your open wishlist lines and the want list, compared field by field with what you logged"
          right={
            <Chip tone={atHomeSeen ? 'danger' : 'gold'}>
              {atHomeSeen ? `${atHomeSeen} possible match${atHomeSeen === 1 ? '' : 'es'}` : atHome.length ? 'nothing flagged' : 'nothing to check'}
            </Chip>
          }
        />
        {atHome.length === 0 ? (
          <p className="gl-small gl-muted">
            Nothing to compare yet. Name the item on the worksheet, or keep an open wishlist line or a product whose status is
            “want” — the check runs those against every clothing, product and purchase row in your own database.
          </p>
        ) : (
          <div className="mk-atm__stack">
            {atHomeFlagged.length === 0 ? (
              <div className="gl-note">
                {atHome.length} {atHome.length === 1 ? 'entry was' : 'entries were'} compared with your whole wardrobe and none of
                them lined up well enough to flag.
              </div>
            ) : (
              atHomeFlagged.map((g) => (
                <AtHomeGroupCard key={g.key} group={g} currency={currency} media={mediaById} onOpen={openAt} />
              ))
            )}
            {atHomeQuiet.length ? (
              <Disclosure summary={`${atHomeQuiet.length} ${atHomeQuiet.length === 1 ? 'entry came back' : 'entries came back'} with nothing to flag`}>
                <div className="mk-atm__stack">
                  {atHomeQuiet.map((g) => (
                    <AtHomeGroupCard key={g.key} group={g} currency={currency} media={mediaById} onOpen={openAt} />
                  ))}
                </div>
              </Disclosure>
            ) : null}
            <p className="gl-small gl-faint">
              Every line above is arithmetic over the closet, shelf and ledger rows you logged — a possible match, not a verdict.
              This app has never seen the item: no catalogue, no prices, no availability, no image recognition. Colour, fabric, fit
              and season come from your own typed words through a fixed synonym table; a field you left blank lowers the score
              instead of being guessed, and is named in the disclosure. Cost per wear divides the price you paid by the wears you
              logged, and prints “unverified” when either is missing.
            </p>
          </div>
        )}
      </Card>

      {/* ------------------------------------------------------ duplicate scan */}
      <Card>
        <CardHead
          title="Duplicate check across everything you own"
          eyebrow="string overlap only"
          right={<Chip tone={dupMatches.length ? 'danger' : 'gold'}>{dupMatches.length ? `${dupMatches.length} overlaps` : 'clean'}</Chip>}
        />
        <label className="gl-field" style={{ maxWidth: 520 }}>
          <span className="gl-field__label">
            <Search size={12} /> Search words
          </span>
          <TextInput value={dupQuery} onChange={setDupQuery} placeholder="vitamin c serum, or navy jumper" />
        </label>
        {!dupQuery.trim() ? (
          <p className="gl-small gl-muted" style={{ marginTop: 'var(--glow-sp-3)' }}>
            Type three or more characters. Matching is token overlap on names, brands, categories and notes across products,
            clothingItems and purchases — which means “retinol 0.3% serum” will match your “retinol serum” even though a human
            would also want the strength checked. You are the human.
          </p>
        ) : dupMatches.length === 0 ? (
          <div className="gl-note" style={{ marginTop: 'var(--glow-sp-3)' }}>
            Nothing stored matches those words. That is a statement about your records, not about the world.
          </div>
        ) : (
          <div className="mk-dupes" style={{ marginTop: 'var(--glow-sp-3)' }}>
            {dupMatches.map((m, i) => (
              <div className="mk-dupe" key={`${m.table}-${m.id}-${i}`}>
                <span>
                  <span className="gl-small gl-strong">{m.label}</span>
                  <span className="gl-tech" style={{ display: 'block' }}>{m.detail}</span>
                </span>
                <span className="gl-row gl-row--tight">
                  <Chip tone={m.sim >= 0.75 ? 'danger' : 'info'}>{(m.sim * 100).toFixed(0)}%</Chip>
                  <Button size="sm" variant="ghost" onClick={() => navigate(m.table === 'clothingItems' ? '/closet' : m.table === 'purchases' ? '/market' : '/market')}>
                    <ArrowLeftRight size={12} /> {m.table}
                  </Button>
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* --------------------------------------------------------- inventory */}
      <section className="gl-section">
        <div className="gl-section__title">
          <div>
            <div className="gl-eyebrow">Inventory</div>
            <h2>What you own, want, tried and refused</h2>
          </div>
          <div className="gl-row gl-row--tight">
            <Button size="sm" variant="primary" onClick={() => setEditor(productDraft())}>
              <Plus size={13} /> Add product
            </Button>
          </div>
        </div>

        {products.length === 0 ? (
          <EmptyPlate
            kicker="Section 03"
            title="No products in your inventory"
            body="Nothing here is pre-loaded: this app ships with no brand list, no prices and no availability, because those facts change and we do not have them. Add the things you actually own — the name you know it by, and any of the rest you remember. Empty fields stay empty rather than being filled with a guess."
            action={
              <Button variant="primary" onClick={() => setEditor(productDraft())}>
                Add your first product
              </Button>
            }
          />
        ) : (
          <>
            <div className="gl-row gl-row--tight" style={{ marginBottom: 'var(--glow-sp-3)', flexWrap: 'wrap' }}>
              <SegmentedControl
                value={statusFilter}
                onChange={setStatusFilter}
                size="sm"
                options={[
                  { value: '', label: `All ${products.length}` },
                  ...STATUSES.map((s) => ({ value: s.value, label: `${s.label} ${products.filter((p) => p.status === s.value).length}` }))
                ]}
              />
            </div>
            <Table
              rows={inventory}
              keyOf={(r: AnyRow) => r.id}
              columns={[
                {
                  label: 'Name',
                  render: (r: AnyRow) => (
                    <button type="button" className="gl-btn gl-btn--link gl-btn--sm" onClick={() => setDetail(r)}>
                      {r.name}
                    </button>
                  )
                },
                { label: 'Brand', render: (r: AnyRow) => <span className="gl-tech">{r.brand || '—'}</span> },
                { label: 'Category', render: (r: AnyRow) => <Chip>{r.category}</Chip> },
                {
                  label: 'Paid',
                  render: (r: AnyRow) => <span className="gl-tech">{fmtMoney(r.pricePaid ?? null, String(r.currency ?? currency))}</span>
                },
                {
                  label: 'Opened / expiry',
                  render: (r: AnyRow) => {
                    const est = paoExpiry((r.openedOn as string) ?? null, (r.data?.paoMonths as number) ?? null);
                    return (
                      <span className="gl-tech">
                        {formatDate(r.openedOn ?? null)}
                        {r.expiresOn || est ? ` → ${formatDate(r.expiresOn ?? est)}` : ''}
                        {!r.expiresOn && est ? ' (PAO estimate)' : ''}
                      </span>
                    );
                  }
                },
                { label: 'Rating', render: (r: AnyRow) => <Rating value={r.rating ?? 0} size={13} /> },
                {
                  label: '',
                  render: (r: AnyRow) => (
                    <div className="gl-row gl-row--tight">
                      <IconButton label={`Log a purchase of ${r.name}`} onClick={() => { setPurchaseOf({ id: r.id, name: String(r.name ?? ''), brand: String(r.brand ?? ''), category: String(r.category ?? 'Other'), pricePaid: typeof r.pricePaid === 'number' ? r.pricePaid : null }); setPurchaseDraft({ amount: r.pricePaid != null ? String(r.pricePaid) : '', retailer: (r.data?.whereBought as string) ?? '', boughtOn: todayISO(), reason: '', orderRef: '' }); }}>
                        <Wallet size={14} />
                      </IconButton>
                      <IconButton label={`Edit ${r.name}`} onClick={() => setEditor(productDraft(r))}>
                        <Sparkles size={14} />
                      </IconButton>
                      <IconButton label={`Delete ${r.name}`} onClick={() => setConfirmDel({ table: TABLES.products, id: r.id, label: r.name })}>
                        <Trash2 size={14} />
                      </IconButton>
                    </div>
                  )
                }
              ]}
            />
          </>
        )}
      </section>

      {/* ----------------------------------------------------- PAO reminders */}
      <section className="gl-section">
        <div className="gl-section__title">
          <div>
            <div className="gl-eyebrow">Run-out & PAO</div>
            <h2>Things whose clock is already running</h2>
          </div>
          <Chip tone="info">
            expiry = openedOn + round(paoMonths × 30.44) days — or the date you typed
          </Chip>
        </div>
        {reminders.length === 0 ? (
          <Card>
            <CardHead title="Nothing with an open date yet" sub="Set an opened-on date and a PAO in months (or a hard expiry) on a product and it appears here." />
            <div className="gl-tech">
              Currently {products.filter((p) => p.status === 'own').length} owned · {products.filter((p) => p.openedOn).length} with an open date ·{' '}
              {products.filter((p) => p.expiresOn).length} with an explicit expiry.
            </div>
          </Card>
        ) : (
          <div className="gl-grid gl-grid--3">
            {reminders.slice(0, 12).map((r) => (
              <Card key={r.row.id}>
                <div className="mk-flag" data-state={r.left < 0 ? 'past' : r.left > 90 ? 'fresh' : undefined}>
                  <div className="gl-serif" style={{ fontSize: '1.1rem' }}>{r.row.name}</div>
                  <div className="gl-tech">{r.row.brand || 'brand not recorded'} · opened {formatDate(String(r.row.openedOn ?? ''))}</div>
                  <div className="gl-small" style={{ marginTop: 6 }}>
                    {r.left < 0
                      ? `Estimated ${Math.abs(r.left)} days past ${r.target}${r.viaPAO ? ' by PAO math' : ''}. Whether it is actually off is your nose and your skin's call — a PAO estimate is a floor-level guideline, not a test.`
                      : `${r.left} days to the estimated date (${r.target}${r.viaPAO ? ' · from PAO' : ' · your date'}).`}
                  </div>
                  <div className="gl-row gl-row--tight" style={{ marginTop: 'var(--glow-sp-2)' }}>
                    <Button size="sm" onClick={() => setEditor(productDraft(r.row))}>
                      Adjust dates
                    </Button>
                    <Chip>{fmtMoney(r.row.pricePaid ?? null, String(r.row.currency ?? currency))} paid</Chip>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
        <Disclosure summary="Which products are finished but never replaced in the log?">
          <IndexList>
            {products.filter((p) => p.status === 'out').map((p, i) => (
              <IndexRow key={p.id} no={i + 1} title={p.name} sub={`finished ${formatDate(p.finishedOn ?? null)} · paid ${fmtMoney(p.pricePaid ?? null, String(p.currency ?? currency))}`} right={<Chip>{p.brand || '—'}</Chip>} onClick={() => setEditor(productDraft(p))} />
            ))}
            {products.filter((p) => p.status === 'out').length === 0 ? <p className="gl-small gl-muted">None marked finished.</p> : null}
          </IndexList>
        </Disclosure>
      </section>

      {/* --------------------------------------------------------- purchases */}
      <section className="gl-section">
        <div className="gl-section__title">
          <div>
            <div className="gl-eyebrow">Ledger</div>
            <h2>Purchases, and whether you would repeat them</h2>
          </div>
          <Chip tone="gold">{fmtMoney(lifetime, currency)} lifetime logged</Chip>
        </div>
        {purchases.length === 0 ? (
          <EmptyState title="No purchase rows yet" body="Log one from the worksheet or from the wallet icon on any inventory row. Amount, retailer and the reason you gave yourself are all stored." />
        ) : (
          <Timeline
            items={purchases
              .slice()
              .sort((a, b) => String(b.boughtOn).localeCompare(String(a.boughtOn)))
              .slice(0, 12)
              .map((p) => ({
                when: formatDate(String(p.boughtOn)),
                title: `${p.label} — ${fmtMoney(p.amount, String(p.currency ?? currency))}`,
                body: `${p.retailer || 'retailer not recorded'}${p.orderRef ? ` · ref ${p.orderRef}` : ''}${p.reason ? ` · reason: ${p.reason}` : ''}`,
                tone: 'accent' as const,
                right: (
                  <>
                    <Rating value={p.wouldBuyAgain ?? 0} size={13} onChange={(v) => void ratePurchase(p, v)} />
                    <IconButton label={`Delete purchase ${p.label}`} onClick={() => setConfirmDel({ table: TABLES.purchases, id: p.id, label: String(p.label) })}>
                      <Trash2 size={13} />
                    </IconButton>
                  </>
                )
              }))}
          />
        )}
      </section>

      {/* ---------------------------------------------------------- wishlist */}
      <Card>
        <CardHead
          title="Want lists stored in the same database"
          eyebrow="lists table, kind wishlist"
          right={<Chip>{wishlist.length}</Chip>}
        />
        {wishlist.length === 0 ? (
          <p className="gl-small gl-muted">
            Choosing “Wait 30 days” in the worksheet writes a want-list product row plus a calendar review event. Packing lists are
            handled in the Closet; wish lists created here would appear below.
          </p>
        ) : (
          wishlist.map((l) => (
            <div key={l.id} style={{ marginBottom: 'var(--glow-sp-4)' }}>
              <div className="gl-row gl-row--between">
                <div className="gl-serif" style={{ fontSize: '1.15rem' }}>{l.name}</div>
                <span className="gl-tech">
                  {((l.items as ListItem[]) ?? []).filter((i) => i.checked).length}/{((l.items as ListItem[]) ?? []).length} ticked ·{' '}
                  {fmtMoney(((l.items as ListItem[]) ?? []).reduce((s, i) => s + (i.estPrice ?? 0), 0), currency)} estimated
                </span>
              </div>
              <div className="gl-list">
                {((l.items as ListItem[]) ?? []).map((it) => (
                  <div className="gl-list__row" key={it.id}>
                    <label className="gl-check">
                      <input type="checkbox" checked={Boolean(it.checked)} onChange={() => void toggleWishItem(l, it)} />
                      <span>{it.label}</span>
                    </label>
                    <span className="gl-tech">{it.estPrice != null ? fmtMoney(it.estPrice, currency) : 'no price'}{it.neededFor ? ` · ${it.neededFor}` : ''}</span>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
        <div className="gl-row gl-row--tight" style={{ marginTop: 'var(--glow-sp-3)' }}>
          <Chip tone="info">{events.filter((e) => e.kind === 'cooling-off').length} cooling-off reviews scheduled</Chip>
          <Button size="sm" variant="ghost" onClick={() => navigate('/calendar')}>
            Open the calendar
          </Button>
          <Button size="sm" variant="ghost" onClick={() => navigate('/services')}>
            Provider consultations
          </Button>
          <Button size="sm" variant="ghost" onClick={() => navigate('/experiments')}>
            Test before you commit
          </Button>
        </div>
      </Card>

      <Card variant="flush">
        <KvList
          items={[
            { k: 'Written to', v: 'products, purchases, lists, calendarEvents, settings (budget + currency) — all local rows.' },
            { k: 'Verdict', v: 'A weighted sum of five components you can read. Thresholds: 5.0 buy, 2.0 wait, below skip.' },
            { k: 'No external data', v: 'No price API, no scraping, no ratings, no “best of” lists, no stock or availability.' },
            { k: 'Duplication', v: 'Token overlap over your own stored names and brands. It cannot see the product, so it cannot certify a match.' },
            {
              k: 'Already at home?',
              v: 'A weighted seven-field comparison (24 points) over your clothing, product and purchase rows, using only the words you typed. Blanks lower the score instead of being guessed; a high figure is a flag for you, not a verdict.'
            },
            { k: 'PAO', v: 'An estimate from the open date and the months you entered. Smell, texture and a clinician beat arithmetic.' }
          ]}
        />
      </Card>

      {/* ------------------------------------------------------------- modals */}
      <Modal
        open={Boolean(editor)}
        onClose={() => setEditor(null)}
        wide
        title={editor?.id ? `Edit — ${editor.name}` : 'Add a product to your inventory'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditor(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void saveProduct()}>
              {editor?.id ? 'Save changes' : 'Store product'}
            </Button>
          </>
        }
      >
        {editor ? (
          <div className="gl-stack">
            <div className="gl-form-row">
              <Field label="Name">
                <TextInput value={editor.name} onChange={(v) => setEditor({ ...editor, name: v })} placeholder="The one with the pump" />
              </Field>
              <Field label="Brand">
                <TextInput value={editor.brand} onChange={(v) => setEditor({ ...editor, brand: v })} placeholder="Only what you know" />
              </Field>
              <Field label="Category">
                <Select value={editor.category} onChange={(v) => setEditor({ ...editor, category: v })} options={CATEGORIES.map((c) => ({ value: c, label: c }))} />
              </Field>
              <Field label="Form / format">
                <TextInput value={editor.form} onChange={(v) => setEditor({ ...editor, form: v })} placeholder="gel, cream, bar, spray" />
              </Field>
              <Field label="Size as bought">
                <TextInput value={editor.sizeLabel} onChange={(v) => setEditor({ ...editor, sizeLabel: v })} placeholder="50 ml" />
              </Field>
              <Field label="Status">
                <Select value={editor.status} onChange={(v) => setEditor({ ...editor, status: v as ProductStatus })} options={STATUSES.map((s) => ({ value: s.value, label: s.label }))} />
              </Field>
            </div>
            <div className="gl-form-row">
              <Field label="Price paid" hint="Blank stays blank and is excluded from cost maths.">
                <TextInput type="number" value={editor.pricePaid} onChange={(v) => setEditor({ ...editor, pricePaid: v })} />
              </Field>
              <Field label="Currency of that price">
                <Select value={editor.currency} onChange={(v) => setEditor({ ...editor, currency: v })} options={[...new Set([currency, 'USD', 'EUR', 'GBP', 'NGN', 'GHS', 'KES', 'ZAR', 'CAD', 'AUD', 'INR', 'JPY'])].map((c) => ({ value: c, label: c }))} />
              </Field>
              <Field label="Where you bought it">
                <TextInput value={editor.whereBought} onChange={(v) => setEditor({ ...editor, whereBought: v })} placeholder="Market stall, pharmacy, online" />
              </Field>
              <Field label="Link you saved (optional)">
                <TextInput value={editor.sourceUrl} onChange={(v) => setEditor({ ...editor, sourceUrl: v })} placeholder="https://…" />
              </Field>
            </div>
            <div className="gl-form-row">
              <DateInput label="Opened on" value={editor.openedOn} onChange={(v) => setEditor({ ...editor, openedOn: v })} />
              <Field label="PAO in months" hint="Printed on the pack as a jar-with-a-number symbol. Estimate if you cannot find it and say so in the note.">
                <TextInput type="number" value={editor.paoMonths} onChange={(v) => setEditor({ ...editor, paoMonths: v })} />
              </Field>
              <DateInput label="Hard expiry (if printed)" value={editor.expiresOn} onChange={(v) => setEditor({ ...editor, expiresOn: v })} />
              <DateInput label="Finished on" value={editor.finishedOn} onChange={(v) => setEditor({ ...editor, finishedOn: v })} />
            </div>
            <div className="mk-formula">
              duplicateKey = slug(name) + &quot;|&quot; + slug(brand) → {`${slug(editor.name)}|${slug(editor.brand)}`}
              <br />
              {editor.openedOn && editor.paoMonths
                ? `PAO expiry estimate = ${editor.openedOn} + ${Math.round((amount(editor.paoMonths) ?? 0) * 30.44)} days = ${paoExpiry(editor.openedOn, amount(editor.paoMonths))}`
                : 'PAO expiry: needs both an open date and a PAO in months.'}
            </div>
            <Field label="Rating you would give it">
              <Rating value={editor.rating} onChange={(v) => setEditor({ ...editor, rating: v })} />
            </Field>
            <Field label="Ingredients, as written on the pack">
              <TextArea rows={2} value={editor.ingredients} onChange={(v) => setEditor({ ...editor, ingredients: v })} placeholder="Copy them if you want the ingredient reference to be able to read them" />
            </Field>
            <Field label="Notes">
              <TextArea rows={2} value={editor.note} onChange={(v) => setEditor({ ...editor, note: v })} placeholder="Smell, texture, whether it pilled, who recommended it" />
            </Field>
          </div>
        ) : null}
      </Modal>

      <Modal
        open={Boolean(purchaseOf)}
        onClose={() => setPurchaseOf(null)}
        title={`Log the purchase of “${purchaseOf?.name ?? ''}”`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPurchaseOf(null)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void commitPurchase()}>
              <Copy size={14} /> Write purchase row
            </Button>
          </>
        }
      >
        <p className="gl-small gl-muted">
          This creates a products row marked owned plus a purchases row. The purchases row is what moves your monthly total — right
          now that total is {fmtMoney(spentThisMonth, currency)} against a budget of {fmtMoney(monthlyBudget, currency)}.
        </p>
        <div className="gl-form-row">
          <Field label="Amount actually paid">
            <TextInput type="number" value={purchaseDraft.amount} onChange={(v) => setPurchaseDraft({ ...purchaseDraft, amount: v })} />
          </Field>
          <Field label="Retailer">
            <TextInput value={purchaseDraft.retailer} onChange={(v) => setPurchaseDraft({ ...purchaseDraft, retailer: v })} />
          </Field>
          <DateInput label="Date" value={purchaseDraft.boughtOn} onChange={(v) => setPurchaseDraft({ ...purchaseDraft, boughtOn: v })} />
          <Field label="Order reference">
            <TextInput value={purchaseDraft.orderRef} onChange={(v) => setPurchaseDraft({ ...purchaseDraft, orderRef: v })} />
          </Field>
        </div>
        <Field label="Reason, in your words">
          <TextArea rows={3} value={purchaseDraft.reason} onChange={(v) => setPurchaseDraft({ ...purchaseDraft, reason: v })} placeholder="What the worksheet said, and what you told yourself" />
        </Field>
        <div className="gl-note">
          <ShoppingBag size={13} /> No receipt is invented here. If you did not keep the number, leave it blank.
        </div>
      </Modal>

      <Modal open={Boolean(detail)} onClose={() => setDetail(null)} title={detail?.name ?? ''} wide>
        {detail ? (
          <div className="gl-stack">
            <KvList
              items={[
                { k: 'Brand', v: detail.brand || 'not recorded' },
                { k: 'Category', v: detail.category },
                { k: 'Status', v: String(detail.status) },
                { k: 'Paid', v: fmtMoney(detail.pricePaid ?? null, String(detail.currency ?? currency)) },
                { k: 'Opened', v: formatDate(detail.openedOn ?? null) },
                { k: 'Expiry', v: `${formatDate(detail.expiresOn ?? null)}${detail.expiresOn ? '' : detail.openedOn && detail.data?.paoMonths ? ' (PAO estimate)' : ''}` },
                { k: 'Where bought', v: (detail.data?.whereBought as string) || 'not recorded' },
                { k: 'Duplicate key', v: detail.duplicateKey || '—' },
                { k: 'Purchases logged', v: String(purchases.filter((p) => p.productId === detail.id).length) },
                { k: 'Note', v: (detail.data?.note as string) || 'none' }
              ]}
            />
            {detail.ingredients ? <p className="gl-small">{detail.ingredients}</p> : null}
            <div className="gl-row gl-row--tight">
              <Button size="sm" onClick={() => { setEditor(productDraft(detail)); setDetail(null); }}>
                Edit product
              </Button>
              <Button size="sm" variant="ghost" onClick={() => navigate('/skin')}>
                Routines that use it
              </Button>
            </div>
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
          <strong>{confirmDel?.label}</strong> will be soft-deleted. Purchase history stays even if a product row goes, because the
          money you spent is a fact independent of the label.
        </p>
      </Modal>
    </div>
  );
}
