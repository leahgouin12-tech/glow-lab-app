import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Check,
  Download,
  Layers,
  Palette,
  Plus,
  Printer,
  Trash2
} from 'lucide-react';
import { formatDate, hardDelete, restore, softDelete, todayISO } from '../db/repo';
import { TABLES, type AnyRow } from '../db/schema';
import { saveRow, useRows } from '../hooks/live';
import {
  Button,
  Card,
  CardHead,
  Chip,
  DateInput,
  EmptyState,
  Field,
  IconButton,
  Modal,
  Rating,
  SafetyBanner,
  Section,
  Select,
  Stat,
  Swatches,
  Table,
  TagInput,
  TextArea,
  TextInput,
  Toggle,
  fmtMoney,
  useToast
} from '../ui/primitives';
import { DeptIntro, EmptyPlate, IndexList, IndexRow, KvList, PullQuote } from '../ui/editorial';
import { Lightbox, MasonryFeed, Pin, PhotoPicker } from '../ui/media';
import { useImageSrc } from '../media/store';
import '../styles/departments/makeup.css';

/**
 * MAKEUP STUDIO (spec Part 13) — a glossy look-book, not a grid of cards.
 * The collection is your own shelf with your own recorded swatches. Looks are
 * board rows. The face chart is a real editor that writes to the look's row
 * and exports as JSON you can hand to a makeup artist. The shade matcher is
 * arithmetic against your own recorded colours — there is no commercial shade
 * database here and no claim about anyone else's product.
 */

const ZONES = [
  ['base', 'Base'],
  ['complexionTarget', 'Skincare target'],
  ['brows', 'Brows'],
  ['lid', 'Lid'],
  ['crease', 'Crease'],
  ['liner', 'Liner'],
  ['lash', 'Lash'],
  ['cheeks', 'Cheeks'],
  ['contour', 'Contour'],
  ['highlight', 'Highlight'],
  ['lips', 'Lips']
] as const;

const AREAS = ['base', 'conceal', 'cheek', 'lid', 'crease', 'liner', 'lash', 'brow', 'lip', 'highlight', 'contour', 'set'];
const FINISHES = ['matte', 'satin', 'dewy', 'metallic', 'shimmer', 'velvet', 'sheer', 'not recorded'];
const UNDERTONES = ['cool', 'neutral', 'warm', 'olive', 'not sure'];
const DEPTHS = ['fair', 'light', 'light-medium', 'medium', 'medium-deep', 'deep', 'very deep', 'not recorded'];
const OWNERSHIP = ['own', 'want', 'tried', 'out', 'avoid'];
const OCCASIONS = ['everyday', 'work', 'evening', 'editorial', 'photography', 'ceremony', 'stage', 'no-makeup'];

const asData = (row: AnyRow | undefined) => ((row?.data as Record<string, any>) ?? {}) as Record<string, any>;
const byDateDesc = (rows: AnyRow[], key: string) => [...rows].sort((x, y) => String(y[key] ?? '').localeCompare(String(x[key] ?? '')));
const numOrNull = (v: unknown) => (v === '' || v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v));
const isHex = (v: string) => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim());

/** Deterministic sRGB arithmetic — no model, no external data. */
function hexToRgb(hex: string): [number, number, number] | null {
  const h = hex.trim().replace('#', '');
  if (!/^([0-9a-f]{3}|[0-9a-f]{6})$/i.test(h)) return null;
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function shadeDistance(a: string, b: string): number | null {
  const ra = hexToRgb(a);
  const rb = hexToRgb(b);
  if (!ra || !rb) return null;
  // weighted Euclidean distance (luminance-weighted), rounded to one decimal
  const dr = ra[0] - rb[0];
  const dg = ra[1] - rb[1];
  const db = ra[2] - rb[2];
  return Math.round(Math.sqrt(2 * dr * dr + 4 * dg * dg + 3 * db * db) * 10) / 10;
}
function isLight(hex: string) {
  const rgb = hexToRgb(hex);
  if (!rgb) return false;
  return (rgb[0] * 299 + rgb[1] * 587 + rgb[2] * 114) / 1000 > 145;
}
const chartFrom = (board: AnyRow | undefined): Record<string, { hex: string; productId: string; note: string }> => {
  const raw = (asData(board).chart as Record<string, any>) ?? {};
  const out: Record<string, { hex: string; productId: string; note: string }> = {};
  for (const [key] of ZONES) out[key] = { hex: String(raw[key]?.hex ?? ''), productId: String(raw[key]?.productId ?? ''), note: String(raw[key]?.note ?? '') };
  return out;
};

const CHAPTERS = [
  ['collection', 'The collection'],
  ['looks', 'Looks'],
  ['chart', 'Face chart'],
  ['shades', 'Shade matching'],
  ['wall', 'Inspiration wall'],
  ['craft', 'Technique']
] as const;
type Chapter = (typeof CHAPTERS)[number][0];

function MediaImg({ row, alt, size = 'thumb' }: { row?: AnyRow | null; alt?: string; size?: 'thumb' | 'full' }) {
  const src = useImageSrc(row, size);
  if (!src) return <div className="gl-missing-img">Image unavailable offline</div>;
  return <img src={src} alt={alt ?? String(row?.title ?? 'Makeup photograph')} loading="lazy" className="gl-img-treated" />;
}

function ConfirmDelete({ label, onCancel, onYes }: { label: string; onCancel: () => void; onYes: () => void }) {
  return (
    <Modal
      open
      onClose={onCancel}
      title="Delete this entry?"
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
        Looks reference the products they were built from. Deleting a product leaves the look intact but the swatch it
        borrowed goes with it, so this is worth a second thought.
      </p>
    </Modal>
  );
}

/* ------------------------------------------------------------------ product */

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
  const hexOk = isHex(String(f.swatchHex ?? ''));
  return (
    <Modal
      open
      onClose={onCancel}
      title={f.id ? 'Edit collection entry' : 'New collection entry'}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button variant="primary" disabled={!f.name} onClick={() => onSave(f)}>
            <Check size={14} /> Save to collection
          </Button>
        </>
      }
    >
      <p className="gl-small gl-muted">
        Write the shade exactly as printed on your product. The swatch colour is what you sampled or typed — the Studio
        never fetches a shade library, and nothing here tells you what a shade will look like on anyone.
      </p>
      <div className="gl-form-row">
        <Field label="Product name">
          <TextInput value={String(f.name ?? '')} onChange={(v) => set('name', v)} />
        </Field>
        <Field label="Brand as written on it">
          <TextInput value={String(f.brand ?? '')} onChange={(v) => set('brand', v)} />
        </Field>
        <Field label="Form">
          <TextInput value={String(f.form ?? '')} onChange={(v) => set('form', v)} placeholder="stick, cream, pressed powder…" />
        </Field>
        <Field label="Size on the pack">
          <TextInput value={String(f.sizeLabel ?? '')} onChange={(v) => set('sizeLabel', v)} placeholder="4 g" />
        </Field>
      </div>

      <div className="mk-shadefields">
        <CardHead eyebrow="Shade record" title="What is printed on the product, and what you sampled" />
        <div className="gl-form-row">
          <Field label="Shade name">
            <TextInput value={String(f.shadeName ?? '')} onChange={(v) => set('shadeName', v)} placeholder="as printed" />
          </Field>
          <Field label="Shade code / number">
            <TextInput value={String(f.shadeCode ?? '')} onChange={(v) => set('shadeCode', v)} placeholder="optional" />
          </Field>
          <Field label="Area it is used on">
            <Select value={String(f.area)} onChange={(v) => set('area', v)} options={AREAS.map((a) => ({ value: a, label: a }))} />
          </Field>
          <Field label="Finish">
            <Select value={String(f.finish)} onChange={(v) => set('finish', v)} options={FINISHES.map((a) => ({ value: a, label: a }))} />
          </Field>
        </div>
        <div className="gl-form-row">
          <Field label="Undertone as you read it">
            <Select value={String(f.undertone)} onChange={(v) => set('undertone', v)} options={UNDERTONES.map((u) => ({ value: u, label: u }))} />
          </Field>
          <Field label="Depth as you read it">
            <Select value={String(f.depth)} onChange={(v) => set('depth', v)} options={DEPTHS.map((d) => ({ value: d, label: d }))} />
          </Field>
          <Field label="Swatch colour" hint={hexOk ? 'Stored with the row — used by the matcher and the face chart.' : 'Type a hex like #7b2f3a or use the picker.'}>
            <div className="mk-hexpick">
              <input type="color" aria-label="Swatch colour picker" value={hexOk ? String(f.swatchHex) : '#7b2f3a'} onChange={(e) => set('swatchHex', e.target.value)} />
              <TextInput value={String(f.swatchHex ?? '')} onChange={(v) => set('swatchHex', v)} placeholder="#7b2f3a" />
              {hexOk ? <span className="mk-hexchip" style={{ background: String(f.swatchHex), color: isLight(String(f.swatchHex)) ? 'var(--glow-canvas)' : 'var(--glow-text-strong)' }}>{String(f.swatchHex)}</span> : null}
            </div>
          </Field>
          <Field label="Where the swatch came from">
            <Select
              value={String(f.swatchSource)}
              onChange={(v) => set('swatchSource', v)}
              options={[
                { value: 'typed', label: 'typed / read off a list' },
                { value: 'sampled-photo', label: 'sampled from my own photograph' },
                { value: 'picked', label: 'picked to approximate what I see' },
                { value: 'not recorded', label: 'not recorded' }
              ]}
            />
          </Field>
        </div>
      </div>

      <div className="gl-form-row">
        <Field label="Status">
          <Select value={String(f.status)} onChange={(v) => set('status', v)} options={OWNERSHIP.map((o) => ({ value: o, label: o }))} />
        </Field>
        <Field label="Price paid" hint="Blank stays blank. The Studio never estimates a price.">
          <TextInput type="number" value={f.pricePaid ?? ''} onChange={(v) => set('pricePaid', v)} />
        </Field>
        <Field label="Currency">
          <TextInput value={String(f.currency || currency)} onChange={(v) => set('currency', v)} />
        </Field>
        <div className="gl-field">
          <span className="gl-field__label">In the case</span>
          <Toggle checked={Boolean(f.owned)} onChange={(v) => set('owned', v)} label={f.owned ? 'Owned' : 'Not owned'} />
        </div>
      </div>
      <div className="gl-form-row">
        <DateInput label="Opened" value={String(f.openedOn ?? '')} onChange={(v) => set('openedOn', v)} />
        <DateInput label="PAO / expiry" value={String(f.expiresOn ?? '')} onChange={(v) => set('expiresOn', v)} />
        <DateInput label="Finished / retired" value={String(f.finishedOn ?? '')} onChange={(v) => set('finishedOn', v)} />
      </div>
      <Field label="Ingredients as listed" hint="Optional for colour cosmetics, but yours if you transcribe them.">
        <TextArea value={String(f.ingredients ?? '')} onChange={(v) => set('ingredients', v)} rows={2} />
      </Field>
      <div className="gl-form-row">
        <Field label="Your rating">
          <Rating value={Number(f.rating ?? 0)} onChange={(v) => set('rating', v)} />
        </Field>
        <Field label="Duplicate key" hint="Brand + shade means a duplicate is flagged instead of hidden.">
          <TextInput value={String(f.duplicateKey ?? '')} onChange={(v) => set('duplicateKey', v)} placeholder={`${String(f.brand ?? '').toLowerCase()}-${String(f.shadeName ?? f.name ?? '').toLowerCase()}`} />
        </Field>
        <Field label="Source URL you typed">
          <TextInput value={String(f.sourceUrl ?? '')} onChange={(v) => set('sourceUrl', v)} placeholder="optional" />
        </Field>
      </div>
      <Field label="Notes — how it behaves on you">
        <TextArea value={String(f.notes ?? '')} onChange={(v) => set('notes', v)} rows={3} placeholder="Oxidises a half shade warmer. Needs a damp brush. Lasts four hours." />
      </Field>
    </Modal>
  );
}

/* ------------------------------------------------------------------ looks */

function LookEditor({
  initial,
  products,
  media,
  onCancel,
  onSave
}: {
  initial: Record<string, any>;
  products: AnyRow[];
  media: AnyRow[];
  onCancel: () => void;
  onSave: (v: Record<string, any>) => void;
}) {
  const [f, setF] = useState<Record<string, any>>(initial);
  const set = (k: string, v: unknown) => setF((p) => ({ ...p, [k]: v }));
  const ids = (f.itemIds as string[]) ?? [];
  return (
    <Modal
      open
      onClose={onCancel}
      title={f.id ? 'Edit look' : 'New look'}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button variant="primary" disabled={!f.name} onClick={() => onSave(f)}>
            <Check size={14} /> Save look
          </Button>
        </>
      }
    >
      <div className="gl-form-row">
        <Field label="Look name">
          <TextInput value={String(f.name ?? '')} onChange={(v) => set('name', v)} placeholder="e.g. Vamp weekend, soft daylight" />
        </Field>
        <Field label="Identity — the one line you would say out loud">
          <TextInput value={String(f.identity ?? '')} onChange={(v) => set('identity', v)} placeholder="matte skin, one dark lip, no liner" />
        </Field>
      </div>
      <Field label="Purpose">
        <TextArea value={String(f.purpose ?? '')} onChange={(v) => set('purpose', v)} rows={2} placeholder="What this look is for, and what you wanted it to do." />
      </Field>
      <Field label="Occasions">
        <TagInput values={(f.occasions as string[]) ?? []} onChange={(v) => set('occasions', v)} placeholder="evening, photography…" />
      </Field>
      <CardHead eyebrow="Built from" title="Only products in your own collection" />
      <div className="mk-pick">
        {products.map((p) => {
          const on = ids.includes(p.id);
          const hex = String(asData(p).swatchHex ?? '');
          return (
            <button
              key={p.id}
              type="button"
              className="mk-pick__item"
              data-on={on}
              onClick={() => set('itemIds', on ? ids.filter((x) => x !== p.id) : [...ids, p.id])}
            >
              <span className="mk-pick__swatch" style={isHex(hex) ? { background: hex } : undefined}>
                {isHex(hex) ? '' : '—'}
              </span>
              <span className="mk-pick__label">{p.name}</span>
              <span className="gl-tech">{String(asData(p).shadeName || p.brand || '')}</span>
            </button>
          );
        })}
        {!products.length ? <p className="gl-small gl-faint">Nothing in the collection yet — add products first.</p> : null}
      </div>
      <Field label="Cover photograph" hint="Your own image. The look-book never uses stock photography as your cover.">
        <div className="gl-row gl-row--tight" style={{ flexWrap: 'wrap' }}>
          {media.map((m) => (
            <Chip key={m.id} active={f.coverMediaId === m.id} onClick={() => set('coverMediaId', f.coverMediaId === m.id ? null : m.id)}>
              {m.title || formatDate(String(m.takenOn))}
            </Chip>
          ))}
          <PhotoPicker kind="outfit" album="Makeup Studio" label="Add cover" withConditions onPick={(rows) => set('coverMediaId', rows[0]?.id ?? f.coverMediaId)} />
        </div>
      </Field>
    </Modal>
  );
}

/* ------------------------------------------------------------------ face chart */

function FaceChart({
  board,
  products,
  onSaveChart,
  onExport,
  onPrint
}: {
  board: AnyRow;
  products: AnyRow[];
  onSaveChart: (chart: Record<string, { hex: string; productId: string; note: string }>) => Promise<void> | void;
  onExport: (chart: Record<string, { hex: string; productId: string; note: string }>) => void;
  onPrint: () => void;
}) {
  const [chart, setChart] = useState(() => chartFrom(board));
  const [active, setActive] = useState<string>('lips');
  const [dirty, setDirty] = useState(false);
  const [savedOn, setSavedOn] = useState('');
  const zone = ZONES.find((z) => z[0] === active) ?? ZONES[0];
  const current = chart[active] ?? { hex: '', productId: '', note: '' };
  const patch = (key: string, value: Partial<{ hex: string; productId: string; note: string }>) => {
    setChart((prev) => ({ ...prev, [key]: { ...prev[key], ...value } }));
    setDirty(true);
  };
  const commit = async () => {
    await onSaveChart(chart);
    setDirty(false);
    setSavedOn(new Date().toLocaleTimeString());
  };
  const swatchable = products.filter((p) => isHex(String(asData(p).swatchHex ?? '')));

  return (
    <div className="mk-chart">
      <div className="mk-chart__head">
        <div>
          <div className="gl-eyebrow">Chart for</div>
          <div className="gl-serif mk-chart__look">{board.name || 'Untitled look'}</div>
        </div>
        <div className="gl-row gl-row--tight">
          {dirty ? <Chip tone="limited">unsaved edits</Chip> : <Chip tone="strong">{savedOn ? `saved ${savedOn}` : 'matches the row'}</Chip>}
          <Button size="sm" variant="gold" onClick={() => void commit()}>
            Save chart
          </Button>
          <Button size="sm" onClick={() => onExport(chart)}>
            <Download size={13} /> Export JSON
          </Button>
          <Button size="sm" variant="ghost" onClick={onPrint}>
            <Printer size={13} /> Print chart
          </Button>
        </div>
      </div>

      <div className="mk-chart__body">
        <div className="mk-zones" role="listbox" aria-label="Face chart zones">
          {ZONES.map(([key, label]) => {
            const hex = chart[key]?.hex ?? '';
            return (
              <button
                key={key}
                type="button"
                role="option"
                aria-selected={active === key}
                className="mk-zone"
                data-on={active === key}
                onClick={() => setActive(key)}
              >
                <span className="mk-zone__chip" style={isHex(hex) ? { background: hex } : undefined} />
                <span className="mk-zone__label">{label}</span>
                <span className="gl-tech mk-zone__hex">{isHex(hex) ? hex : 'empty'}</span>
              </button>
            );
          })}
        </div>

        <div className="mk-editor">
          <CardHead eyebrow={zone[1]} title="Zone editor" sub="Edit freely — nothing touches the row until you press Save chart." />
          <div className="mk-editor__row">
            <label className="mk-editor__pick">
              <span className="gl-field__label">Colour</span>
              <input
                type="color"
                aria-label={`${zone[1]} colour`}
                value={isHex(current.hex) ? current.hex : '#7b2f3a'}
                onChange={(e) => patch(active, { hex: e.target.value })}
              />
              <span className="mk-editor__preview" style={isHex(current.hex) ? { background: current.hex } : undefined} />
            </label>
            <Field label="Hex" hint="Type it if you have an exact value from your own swatch.">
              <TextInput value={current.hex} onChange={(v) => patch(active, { hex: v })} placeholder="#5c1f2b" />
            </Field>
          </div>
          <Field label="Product assigned to this zone" hint="Only your own collection appears here.">
            <Select
              value={current.productId}
              onChange={(v) => {
                const p = products.find((x) => x.id === v);
                patch(active, { productId: v, hex: p && isHex(String(asData(p).swatchHex)) ? String(asData(p).swatchHex) : chart[active].hex });
              }}
              options={swatchable.map((p) => ({ value: p.id, label: `${p.name}${asData(p).shadeName ? ` — ${asData(p).shadeName}` : ''}` }))}
              placeholder={swatchable.length ? '— no product —' : 'no recorded swatches to assign yet'}
            />
          </Field>
          <Field label="Placement note" hint="Where, how, with what. This is the part an artist actually reads.">
            <TextArea value={current.note} onChange={(v) => patch(active, { note: v })} rows={3} placeholder="Liner kept tight to the lash line, wing follows the brow tail, no smudge beyond the outer corner." />
          </Field>
          <div className="mk-editor__foot">
            <span className="gl-tech">{Object.values(chart).filter((z) => z && isHex(z.hex)).length}/{ZONES.length} zones coloured</span>
            <Button size="sm" variant="ghost" onClick={() => patch(active, { hex: '', productId: '', note: '' })}>Clear this zone</Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ shade matching */

function ShadeMatcher({
  products,
  undertone,
  depth
}: {
  products: AnyRow[];
  undertone: string;
  depth: string;
}) {
  const withHex = useMemo(() => products.filter((p) => isHex(String(asData(p).swatchHex ?? ''))), [products]);
  const [target, setTarget] = useState('');
  const targetOk = isHex(target);
  const ranked = useMemo(() => {
    if (!targetOk) return [];
    return withHex
      .map((p) => ({ p, d: shadeDistance(target, String(asData(p).swatchHex)) ?? 999 }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 8);
  }, [target, targetOk, withHex]);

  return (
    <div className="mk-match">
      <div className="mk-match__controls">
        <label className="mk-match__pick">
          <span className="gl-field__label">Target colour</span>
          <input type="color" aria-label="Target colour picker" value={targetOk ? target : '#7b2f3a'} onChange={(e) => setTarget(e.target.value)} />
        </label>
        <Field label="Target hex" hint="Pick a colour you can see, or paste a hex from your own note.">
          <TextInput value={target} onChange={setTarget} placeholder="#7b2f3a" />
        </Field>
        <Field label="Or choose one of your recorded swatches">
          <Select
            value=""
            onChange={(v) => setTarget(String(asData(withHex.find((p) => p.id === v))?.swatchHex ?? ''))}
            options={withHex.map((p) => ({ value: p.id, label: `${p.name} — ${String(asData(p).swatchHex)}` }))}
            placeholder={withHex.length ? '— pick a swatch —' : 'no recorded swatches yet'}
          />
        </Field>
      </div>

      {!withHex.length ? (
        <EmptyState title="Nothing to match against" body="The matcher only ever compares colours you recorded yourself. Add a swatch to a collection entry and it appears here." />
      ) : null}

      {targetOk && withHex.length ? (
        <>
          <div className="mk-match__strip">
            <span className="mk-swatch mk-swatch--target" style={{ background: target }}>
              target
            </span>
            {ranked.map(({ p, d }) => (
              <span key={p.id} className="mk-swatch" style={{ background: String(asData(p).swatchHex) }} title={`${String(d)} distance`}>
                {String(asData(p).shadeName || p.name)}
              </span>
            ))}
          </div>
          <Table
            columns={[
              { label: 'Closest in your collection', render: (r: any) => <span className="gl-serif" style={{ fontSize: '1.05rem' }}>{r.p.name}</span> },
              { label: 'Shade as recorded', render: (r: any) => `${String(asData(r.p).shadeName || '—')} ${String(asData(r.p).shadeCode ? `(${asData(r.p).shadeCode})` : '')}` },
              { label: 'Swatch', render: (r: any) => <span className="mk-swatch mk-swatch--small" style={{ background: String(asData(r.p).swatchHex) }} /> },
              { label: 'Distance', render: (r: any) => <span className="gl-tech">{r.d}</span> },
              { label: 'Undertone you recorded', render: (r: any) => String(asData(r.p).undertone || 'not recorded') },
              { label: 'Depth you recorded', render: (r: any) => String(asData(r.p).depth || 'not recorded') }
            ]}
            rows={ranked}
            keyOf={(r: any) => r.p.id}
          />
          <p className="gl-small gl-faint" style={{ marginTop: 'var(--glow-sp-3)' }}>
            Ranking is weighted sRGB distance (√(2ΔR² + 4ΔG² + 3ΔB²)) between your target hex and your recorded swatch
            hex values. Your undertone ({undertone || 'not recorded'}) and depth ({depth || 'not recorded'}) are shown beside
            each result as context, from your own profile. This says nothing about who sells a similar colour, about
            formulation, or about how it will look on skin — it is arithmetic on the values you typed.
          </p>
        </>
      ) : null}
      {targetOk === false && withHex.length ? (
        <p className="gl-small gl-faint">Enter a valid hex like <b className="gl-strong">#6d1a2c</b> to run the comparison.</p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ appearance profile */

function AppearanceEditor({
  initial,
  onCancel,
  onSave
}: {
  initial: Record<string, any>;
  onCancel: () => void;
  onSave: (v: Record<string, any>) => void;
}) {
  const [f, setF] = useState<Record<string, any>>(initial);
  const set = (k: string, v: unknown) => setF((p) => ({ ...p, [k]: v }));
  return (
    <Modal
      open
      onClose={onCancel}
      title="How you describe your own colouring"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button variant="primary" onClick={() => onSave(f)}>
            <Check size={14} /> Save
          </Button>
        </>
      }
    >
      <p className="gl-small gl-muted">
        Your words, stored locally, used only to place your own swatches in context. Nothing here is analysed from a
        photograph and nothing here is a verdict on what suits you.
      </p>
      <div className="gl-form-row">
        <Field label="Undertone as you read it">
          <Select value={String(f.undertone)} onChange={(v) => set('undertone', v)} options={UNDERTONES.map((u) => ({ value: u, label: u }))} />
        </Field>
        <Field label="Depth as you read it">
          <Select value={String(f.depth)} onChange={(v) => set('depth', v)} options={DEPTHS.map((d) => ({ value: d, label: d }))} />
        </Field>
      </div>
      <Field label="How you know" hint="The test or the reason — so future-you can revisit the assumption.">
        <TextArea value={String(f.evidence ?? '')} onChange={(v) => set('evidence', v)} rows={3} placeholder="Veins read green in daylight; jewellery preference changed after a year abroad." />
      </Field>
      <Field label="Contrast / features you want the look-book to keep in mind">
        <TagInput values={(f.notes as string[]) ?? []} onChange={(v) => set('notes', v)} placeholder="high contrast brows, deepening under-eye…" />
      </Field>
    </Modal>
  );
}

/* ------------------------------------------------------------------ tutorial viewer */

function TutorialViewer({
  tutorial,
  onClose,
  onAttempt,
  onComplete
}: {
  tutorial: AnyRow;
  onClose: () => void;
  onAttempt: () => void;
  onComplete: (on: string) => void;
}) {
  const [done, setDone] = useState(String(tutorial.completedOn ?? todayISO()));
  return (
    <Modal
      open
      onClose={onClose}
      title={String(tutorial.title)}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button onClick={onAttempt}>
            <Layers size={13} /> Logged an attempt ({Number(tutorial.attempts ?? 0)})
          </Button>
          <Button variant="primary" onClick={() => onComplete(done)}>
            <Check size={13} /> Mark completed
          </Button>
        </>
      }
    >
      <div className="gl-row gl-row--tight" style={{ marginBottom: 'var(--glow-sp-3)' }}>
        <Chip tone="info">{String(tutorial.difficulty ?? '—')} / 5 difficulty</Chip>
        <Chip>{String(tutorial.minutes ?? '—')} min</Chip>
        {tutorial.completedOn ? <Chip tone="strong">Completed {formatDate(String(tutorial.completedOn))}</Chip> : <Chip>not completed</Chip>}
      </div>
      <p className="gl-lead">{String(tutorial.summary ?? '')}</p>
      {(tutorial.materials as AnyRow[])?.length ? (
        <Card variant="default">
          <CardHead eyebrow="What you need" title="Materials you already recorded" />
          <ul className="gl-list">
            {(tutorial.materials as AnyRow[]).map((m, i) => (
              <li key={i} className="gl-list__row">
                <span>{String(m.label)}</span>
                <span className="gl-tech">{m.optional ? 'optional' : 'required'}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      <CardHead eyebrow="Steps" title="Written steps, from the Academy copy" />
      <ol className="mk-steps">
        {((tutorial.steps as AnyRow[]) ?? []).map((s, i) => (
          <li key={String(s.id ?? i)}>
            <span className="mk-steps__no">{i + 1}</span>
            <div>
              <div className="gl-serif" style={{ fontSize: '1.05rem' }}>{String(s.label)}</div>
              <div className="gl-small gl-muted">{String(s.detail)}</div>
              {s.caution ? <Chip tone="limited">{String(s.caution)}</Chip> : null}
            </div>
          </li>
        ))}
      </ol>
      {(tutorial.pitfalls as string[])?.length ? (
        <SafetyBanner tone="warn" title="Pitfalls">
          <ul className="gl-list mk-pitfalls">
            {(tutorial.pitfalls as string[]).map((p) => (
              <li key={p} className="gl-list__row">{p}</li>
            ))}
          </ul>
        </SafetyBanner>
      ) : null}
      <div className="gl-form-row" style={{ marginTop: 'var(--glow-sp-4)' }}>
        <DateInput label="Completed on" value={done} onChange={setDone} />
      </div>
    </Modal>
  );
}

/* ================================================================== page */

export default function MakeupPage() {
  const toast = useToast();
  const [chapter, setChapter] = useState<Chapter>('collection');
  const [areaFilter, setAreaFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [wallFilter, setWallFilter] = useState('makeup');
  const [wallCount, setWallCount] = useState(18);

  const [pForm, setPForm] = useState<Record<string, any> | null>(null);
  const [lForm, setLForm] = useState<Record<string, any> | null>(null);
  const [apForm, setApForm] = useState<Record<string, any> | null>(null);
  const [confirm, setConfirm] = useState<{ label: string; run: () => void } | null>(null);
  const [openTutorial, setOpenTutorial] = useState<string | null>(null);
  const [compare, setCompare] = useState<{ a: string; b: string }>({ a: '', b: '' });
  const [chartLook, setChartLook] = useState('');
  const [lightbox, setLightbox] = useState<number | null>(null);

  /* ------------------------------------------------------------------ rows */
  const products = useRows(TABLES.products, { where: { category: 'makeup' }, includeDeleted: true });
  const looks = useRows(TABLES.boards, {
    where: { kind: 'collection' },
    some: { isLook: (r) => ((r.tags as string[]) ?? []).includes('look') }
  });
  const appearanceRows = useRows(TABLES.profile, { where: { kind: 'appearance' } });
  const appearance = appearanceRows.find((r) => r.singleton === 1) ?? appearanceRows[0];
  const ad = { undertone: '', depth: '', evidence: '', notes: [] as string[], ...asData(appearance) };
  const mediaRows = useRows(TABLES.mediaItems, { where: { linkedDomain: 'makeup' } });
  const allMedia = useRows(TABLES.mediaItems);
  const mediaById = useMemo(() => new Map(allMedia.map((m) => [String(m.id), m])), [allMedia]);
  const media = useMemo(() => byDateDesc(mediaRows, 'takenOn'), [mediaRows]);
  const discovery = useRows(TABLES.discoveryItems);
  const tutorials = useRows(TABLES.tutorials, { where: { domain: ['makeup', 'grooming'] } });
  const observations = useRows(TABLES.observations, { where: { subjectType: 'makeup' } });
  const settingsRows = useRows(TABLES.settings);
  const currency = String(((settingsRows[0]?.value as Record<string, any>) ?? {}).currency ?? 'USD');

  const liveProducts = useMemo(() => products.filter((p) => !p.deletedAt), [products]);
  const trashedProducts = useMemo(() => products.filter((p) => Boolean(p.deletedAt)), [products]);
  const liveLooks = useMemo(() => looks.filter((l) => !l.deletedAt), [looks]);

  const swatched = liveProducts.filter((p) => isHex(String(asData(p).swatchHex ?? '')));
  const spend = liveProducts.reduce((s, p) => s + (p.pricePaid === null || p.pricePaid === undefined ? 0 : Number(p.pricePaid)), 0);
  const dupCount = (key: string) => liveProducts.filter((p) => String(p.duplicateKey) === key).length;

  const wallItems = useMemo(
    () =>
      discovery.filter(
        (d) => ((d.categories as string[]) ?? []).some((c) => String(c).toLowerCase().includes(wallFilter) || String(c).toLowerCase() === 'makeup')
      ),
    [discovery, wallFilter]
  );

  const selectedLook = liveLooks.find((l) => l.id === (chartLook || liveLooks[0]?.id));
  const filteredProducts = liveProducts.filter(
    (p) => (!areaFilter || String(asData(p).area) === areaFilter) && (!statusFilter || String(p.status) === statusFilter)
  );
  const compareA = liveProducts.find((p) => p.id === compare.a);
  const compareB = liveProducts.find((p) => p.id === compare.b);

  /* ------------------------------------------------------------------ writers */
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
    shadeName: '',
    shadeCode: '',
    area: 'lid',
    finish: 'not recorded',
    undertone: 'not sure',
    depth: 'not recorded',
    swatchHex: '',
    swatchSource: 'not recorded',
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
    shadeName: String(asData(r).shadeName ?? ''),
    shadeCode: String(asData(r).shadeCode ?? ''),
    area: String(asData(r).area ?? 'lid'),
    finish: String(asData(r).finish ?? 'not recorded'),
    undertone: String(asData(r).undertone ?? 'not sure'),
    depth: String(asData(r).depth ?? 'not recorded'),
    swatchHex: String(asData(r).swatchHex ?? ''),
    swatchSource: String(asData(r).swatchSource ?? 'not recorded'),
    notes: String(asData(r).notes ?? ''),
    tags: (r.tags as string[]) ?? []
  });
  const blankLook = () => ({ name: '', purpose: '', identity: '', occasions: [] as string[], itemIds: [] as string[], coverMediaId: null as string | null });
  const rowToLook = (l: AnyRow) => ({
    id: l.id,
    name: String(l.name ?? ''),
    purpose: String(l.purpose ?? ''),
    identity: String(l.identity ?? ''),
    occasions: ((asData(l).occasions as string[]) ?? []) as string[],
    itemIds: (l.itemIds as string[]) ?? [],
    coverMediaId: (l.coverMediaId as string | null) ?? null
  });

  const saveProduct = async (v: Record<string, any>) => {
    const existing = products.find((p) => p.id === v.id);
    await saveRow(TABLES.products, {
      id: v.id,
      name: v.name,
      category: 'makeup',
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
      duplicateKey:
        v.duplicateKey || `${String(v.brand ?? '').toLowerCase().trim()}-${String((v.shadeName || v.name) ?? '').toLowerCase().trim()}`,
      tags: ((existing?.tags as string[]) ?? []).length ? (existing!.tags as string[]) : ['colour-cosmetic'],
      data: {
        ...asData(existing),
        shadeName: v.shadeName ?? '',
        shadeCode: v.shadeCode ?? '',
        area: v.area ?? '',
        finish: v.finish ?? '',
        undertone: v.undertone ?? '',
        depth: v.depth ?? '',
        swatchHex: v.swatchHex ?? '',
        swatchSource: v.swatchSource ?? 'not recorded',
        notes: v.notes ?? ''
      }
    });
    setPForm(null);
    toast('Collection updated.', 'ok');
  };

  const saveLook = async (v: Record<string, any>) => {
    const existing = looks.find((l) => l.id === v.id);
    const linked = ((v.itemIds as string[]) ?? []).map((id) => liveProducts.find((p) => p.id === id)).filter(Boolean) as AnyRow[];
    const palette = [...new Set(linked.map((p) => String(asData(p).swatchHex ?? '')).filter(isHex))];
    await saveRow(TABLES.boards, {
      id: v.id,
      kind: 'collection',
      name: v.name,
      purpose: v.purpose ?? '',
      identity: v.identity ?? '',
      coverMediaId: v.coverMediaId ?? null,
      itemIds: (v.itemIds as string[]) ?? [],
      palette,
      exported: Boolean(existing?.exported),
      tags: (existing?.tags as string[]) ?? ['look'],
      data: { ...asData(existing), occasions: (v.occasions as string[]) ?? [], chart: asData(existing).chart ?? {} }
    });
    setLForm(null);
    if (!existing) setChartLook(v.id ?? '');
    toast('Look saved.', 'ok');
  };

  const saveChart = async (chart: Record<string, { hex: string; productId: string; note: string }>) => {
    if (!selectedLook) return;
    await saveRow(TABLES.boards, {
      id: selectedLook.id,
      data: { ...asData(selectedLook), chart },
      palette: [...new Set(Object.values(chart).map((z) => z.hex).filter(isHex))]
    });
    toast('Face chart saved to the look.', 'ok');
  };

  const saveAppearance = async (v: Record<string, any>) => {
    await saveRow(TABLES.profile, {
      id: appearance?.id,
      kind: 'appearance',
      singleton: 1,
      tags: (appearance?.tags as string[]) ?? [],
      /* `put` merges rows but replaces `data`, and this singleton is shared with
        Personal Color and the photo tone read — spreading is what keeps them. */
      data: { ...asData(appearance), undertone: v.undertone, depth: v.depth, evidence: v.evidence, notes: v.notes }
    });
    setApForm(null);
    toast('Colouring record saved to your profile.', 'ok');
  };

  const exportLook = async (
    look: AnyRow,
    chartDraft?: Record<string, { hex: string; productId: string; note: string }>
  ) => {
    const chart = chartDraft ?? chartFrom(look);
    const linked = ((look.itemIds as string[]) ?? [])
      .map((id: string) => liveProducts.find((p) => p.id === id))
      .filter((p): p is AnyRow => Boolean(p));
    const payload = {
      application: 'THE GLOW LAB',
      department: 'Makeup Studio',
      exportedOn: new Date().toISOString(),
      look: {
        name: look.name,
        identity: look.identity,
        purpose: look.purpose,
        occasions: (asData(look).occasions as string[]) ?? [],
        palette: (look.palette as string[]) ?? [],
        chart: Object.entries(chart)
          .filter(([, z]) => isHex(z.hex))
          .map(([zone, z]) => {
            const matched = linked.find((p) => p.id === z.productId);
            return {
              zone,
              hex: z.hex,
              product: matched?.name ?? null,
              shadeAsRecorded: matched ? { name: asData(matched).shadeName, code: asData(matched).shadeCode } : null,
              note: z.note
            };
          }),
        products: linked.map((p: AnyRow) => ({
          name: p.name,
          brand: p.brand,
          shadeName: asData(p).shadeName ?? null,
          shadeCode: asData(p).shadeCode ?? null,
          swatchHex: asData(p).swatchHex ?? null,
          finish: asData(p).finish ?? null,
          notes: asData(p).notes ?? null
        }))
      },
      yourColouring: { undertone: ad.undertone || null, depth: ad.depth || null, asYouDescribed: ad.evidence || null },
      disclaimer:
        'Every value above was typed or sampled by the owner of this device. No shade names, prices, availability or matches were supplied by the application.'
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `glow-lab-look-${String(look.name || 'untitled').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
    await saveRow(TABLES.boards, { id: look.id, exported: true });
    toast('Look exported as JSON — hand it to anyone, the numbers are yours.', 'ok');
  };

  const linkMedia = async (rows: AnyRow[]) => {
    for (const r of rows) await saveRow(TABLES.mediaItems, { id: r.id, linkedDomain: 'makeup', album: r.album || 'Makeup Studio' });
  };

  const bumpAttempt = async (t: AnyRow) => {
    await saveRow(TABLES.tutorials, { id: t.id, attempts: Number(t.attempts ?? 0) + 1 });
    toast('Attempt recorded.', 'ok');
  };
  const completeTutorial = async (t: AnyRow, on: string) => {
    await saveRow(TABLES.tutorials, { id: t.id, completedOn: on, attempts: Number(t.attempts ?? 0) + 1 });
    setOpenTutorial(null);
    toast('Marked completed.', 'ok');
  };

  /* ------------------------------------------------------------------ render */
  return (
    <div className="gl-page mk-studio">
      <DeptIntro
        id="makeup"
        image={media[0]}
        actions={
          <>
            <Button variant="primary" onClick={() => setPForm(blankProduct())}>
              <Plus size={14} /> Add to collection
            </Button>
            <Button variant="gold" onClick={() => setChapter('chart')}>
              <Palette size={14} /> Face chart
            </Button>
          </>
        }
        meta={[
          { label: 'Collection', value: `${liveProducts.length} entries` },
          { label: 'Recorded swatches', value: `${swatched.length}` },
          { label: 'Looks', value: liveLooks.length },
          { label: 'In your case', value: fmtMoney(spend, currency) }
        ]}
      />

      <nav className="mk-chapters" aria-label="Look-book chapters">
        {CHAPTERS.map(([id, label]) => (
          <button key={id} type="button" className="mk-chapter" data-on={chapter === id} onClick={() => setChapter(id)}>
            {label}
          </button>
        ))}
      </nav>

      {/* ------------------------------------------------------ collection */}
      {chapter === 'collection' ? (
        <>
          <Section
            title="The collection"
            eyebrow="Colour cosmetics you actually own"
            right={
              <>
                <Select value={areaFilter} onChange={setAreaFilter} options={[{ value: '', label: 'Every area' }, ...AREAS.map((a) => ({ value: a, label: a }))]} />
                <Select value={statusFilter} onChange={setStatusFilter} options={[{ value: '', label: 'Every status' }, ...OWNERSHIP.map((o) => ({ value: o, label: o }))]} />
                <Button size="sm" variant="primary" onClick={() => setPForm(blankProduct())}>
                  <Plus size={13} /> Entry
                </Button>
              </>
            }
            description="Shade names, codes and swatches are transcribed by you. The Studio stores them, draws them and compares them — it does not supply any of them."
          >
            {filteredProducts.length ? (
              <div className="mk-grid">
                {filteredProducts.map((p) => {
                  const d = asData(p);
                  const hex = String(d.swatchHex ?? '');
                  return (
                    <article key={p.id} className="mk-plate">
                      <div className="mk-plate__swatch" style={isHex(hex) ? { background: hex } : undefined}>
                        {isHex(hex) ? <span className="mk-plate__hex">{hex}</span> : <span className="mk-plate__hex mk-plate__hex--empty">no swatch</span>}
                      </div>
                      <div className="mk-plate__body">
                        <div className="gl-row gl-row--between" style={{ alignItems: 'baseline' }}>
                          <h3 className="gl-serif mk-plate__name">{p.name}</h3>
                          <Chip>{String(p.status)}</Chip>
                        </div>
                        <div className="gl-tech">{p.brand || 'brand not recorded'}</div>
                        <div className="mk-plate__shade">
                          <span className="gl-serif">{String(d.shadeName || 'shade not recorded')}</span>
                          {d.shadeCode ? <span className="gl-tech"> · {String(d.shadeCode)}</span> : null}
                        </div>
                        <KvList
                          items={[
                            { k: 'Area', v: shown(d.area) },
                            { k: 'Finish', v: shown(d.finish) },
                            { k: 'Undertone', v: shown(d.undertone) },
                            { k: 'Depth', v: shown(d.depth) },
                            { k: 'Opened', v: p.openedOn ? formatDate(String(p.openedOn)) : 'not recorded' },
                            { k: 'PAO / expiry', v: p.expiresOn ? formatDate(String(p.expiresOn)) : 'not recorded' },
                            { k: 'Price paid', v: p.pricePaid === null || p.pricePaid === undefined ? 'not recorded' : fmtMoney(Number(p.pricePaid), String(p.currency || currency)) }
                          ]}
                        />
                        {d.notes ? <p className="gl-small gl-muted mk-plate__note">{String(d.notes)}</p> : null}
                        {Number(p.rating) ? <Rating value={Number(p.rating)} /> : <span className="gl-tech">not rated</span>}
                        {dupCount(String(p.duplicateKey)) > 1 ? <Chip tone="limited">possible duplicate</Chip> : null}
                        <div className="gl-row gl-row--between" style={{ marginTop: 'var(--glow-sp-3)' }}>
                          <Button size="sm" onClick={() => setPForm(rowToProduct(p))}>Edit</Button>
                          <IconButton
                            label="Remove from collection"
                            tone="danger"
                            onClick={() =>
                              setConfirm({
                                label: `${p.name}${d.shadeName ? ` — ${d.shadeName}` : ''}`,
                                run: async () => {
                                  await softDelete(TABLES.products, p.id);
                                  setConfirm(null);
                                  toast('Moved to the archive below.', 'ok');
                                }
                              })
                            }
                          >
                            <Trash2 size={13} />
                          </IconButton>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <EmptyPlate
                kicker="Collection"
                title="Nothing here yet"
                body="The look-book starts when you write down what is in your case — the shade as printed, the finish as you feel it, the colour as you sampled it."
                action={<Button variant="primary" onClick={() => setPForm(blankProduct())}>Add the first entry</Button>}
              />
            )}

            {trashedProducts.length ? (
              <Card variant="default">
                <CardHead eyebrow="Archive" title={`${trashedProducts.length} retired entr${trashedProducts.length === 1 ? 'y' : 'ies'}`} />
                <div className="gl-row gl-row--tight" style={{ flexWrap: 'wrap' }}>
                  {trashedProducts.map((p) => (
                    <span key={p.id} className="mk-retired">
                      <Chip>{String(p.name)}</Chip>
                      <Button size="sm" onClick={() => void restore(TABLES.products, p.id)}>Restore</Button>
                      <Button size="sm" variant="danger" onClick={() => void hardDelete(TABLES.products, p.id)}>Purge</Button>
                    </span>
                  ))}
                </div>
              </Card>
            ) : null}
          </Section>

          <Section title="Two entries, field by field" eyebrow="Comparison" description="Blanks read as “not recorded”, never as a guess.">
            <div className="gl-form-row">
              <Field label="Entry A">
                <Select value={compare.a} onChange={(v) => setCompare((c) => ({ ...c, a: v }))} options={liveProducts.map((p) => ({ value: p.id, label: String(p.name) }))} placeholder="choose" />
              </Field>
              <Field label="Entry B">
                <Select value={compare.b} onChange={(v) => setCompare((c) => ({ ...c, b: v }))} options={liveProducts.map((p) => ({ value: p.id, label: String(p.name) }))} placeholder="choose" />
              </Field>
            </div>
            {compareA && compareB ? (
              <Table
                columns={[
                  { label: 'Field', render: (r: any) => <span className="gl-tech">{r.field}</span> },
                  { label: String(compareA.name), render: (r: any) => r.a },
                  { label: String(compareB.name), render: (r: any) => r.b }
                ]}
                rows={compareFields(compareA, compareB, currency, observations, liveLooks)}
                keyOf={(r: any) => String(r.field)}
              />
            ) : (
              <p className="gl-small gl-faint">Choose two entries.</p>
            )}
          </Section>
        </>
      ) : null}

      {/* ------------------------------------------------------------- looks */}
      {chapter === 'looks' ? (
        <Section
          title="Looks"
          eyebrow="Built only from what is in the collection"
          right={
            <Button size="sm" variant="primary" disabled={!liveProducts.length} onClick={() => setLForm(blankLook())}>
              <Plus size={13} /> New look
            </Button>
          }
          description="A look is a board row: the products it used, the occasions you tagged, the palette it produced and the chart you drew on it."
        >
          {liveLooks.length ? (
            <div className="mk-looks">
              {liveLooks.map((l) => {
                const linked = ((l.itemIds as string[]) ?? []).map((id: string) => liveProducts.find((p) => p.id === id)).filter(Boolean) as AnyRow[];
                const chartZones = Object.values(chartFrom(l)).filter((z) => isHex(z.hex)).length;
                return (
                  <Card key={l.id} variant="flush" className="mk-look">
                    <div className="mk-look__cover">
                      <MediaImg row={media.find((m) => m.id === l.coverMediaId)} alt={`${String(l.name)} cover`} />
                    </div>
                    <div className="mk-look__body">
                      <CardHead
                        eyebrow={(asData(l).occasions as string[])?.length ? (asData(l).occasions as string[]).join(' · ') : 'occasions not tagged'}
                        title={String(l.name)}
                        sub={l.identity ? String(l.identity) : 'identity not written'}
                        right={
                          <>
                            <Button size="sm" onClick={() => { setChartLook(String(l.id)); setChapter('chart'); }}>Chart</Button>
                            <Button size="sm" onClick={() => setLForm(rowToLook(l))}>Edit</Button>
                          </>
                        }
                      />
                      <div className="mk-look__palette">
                        {((l.palette as string[]) ?? []).filter(isHex).map((hex) => (
                          <span key={hex} className="mk-dot" style={{ background: hex }} title={hex} />
                        ))}
                        {!((l.palette as string[]) ?? []).length ? <span className="gl-tech">no recorded swatches in this look</span> : null}
                      </div>
                      <p className="gl-small gl-muted">{l.purpose ? String(l.purpose) : 'purpose not written'}</p>
                      <div className="mk-look__items">
                        {linked.map((p) => (
                          <Chip key={p.id}>
                            {p.name}
                            {asData(p).shadeName ? ` — ${String(asData(p).shadeName)}` : ''}
                          </Chip>
                        ))}
                        {!linked.length ? <span className="gl-tech">no products assigned</span> : null}
                      </div>
                      <div className="gl-row gl-row--between" style={{ marginTop: 'var(--glow-sp-3)', flexWrap: 'wrap', gap: 8 }}>
                        <span className="gl-tech">{chartZones}/{ZONES.length} zones · {linked.length} product(s)</span>
                        <div className="gl-row gl-row--tight">
                          <Button size="sm" onClick={() => void exportLook(l)}>
                            <Download size={12} /> Export JSON
                          </Button>
                          {l.exported ? <Chip tone="strong">exported</Chip> : null}
                          <IconButton
                            label="Delete look"
                            tone="danger"
                            onClick={() =>
                              setConfirm({
                                label: String(l.name),
                                run: async () => {
                                  await softDelete(TABLES.boards, l.id);
                                  setConfirm(null);
                                  toast('Look archived.', 'ok');
                                }
                              })
                            }
                          >
                            <Trash2 size={12} />
                          </IconButton>
                        </div>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          ) : (
            <EmptyPlate
              kicker="Looks"
              title="No looks built yet"
              body="A look is how you remember what you did. Name it, tag the occasion, pick the products — the palette and the chart come from them."
              action={<Button variant="primary" disabled={!liveProducts.length} onClick={() => setLForm(blankLook())}>Build a look</Button>}
            />
          )}
        </Section>
      ) : null}

      {/* -------------------------------------------------------- face chart */}
      {chapter === 'chart' ? (
        <Section
          title="Face chart"
          eyebrow="A placement map you can hand over"
          right={
            liveLooks.length ? (
              <>
                <Select value={selectedLook?.id ?? ''} onChange={setChartLook} options={liveLooks.map((l) => ({ value: l.id, label: String(l.name) }))} />
                <Button size="sm" onClick={() => setLForm(blankLook())} disabled={!liveProducts.length}>
                  <Plus size={12} /> New look
                </Button>
              </>
            ) : null
          }
          description="Eleven editable zones. Colour, assigned product and a placement note for each — all of it written to the look's row when you save the chart."
        >
          {selectedLook ? (
            <FaceChart
              key={selectedLook.id}
              board={selectedLook}
              products={liveProducts}
              onSaveChart={(chart) => saveChart(chart)}
              onExport={(chart) => void exportLook(selectedLook, chart)}
              onPrint={() => window.print()}
            />
          ) : (
            <EmptyPlate
              kicker="Chart"
              title="No look to chart"
              body="Charts live on looks, so the same face can hold several. Create one and this becomes editable."
              action={<Button variant="primary" onClick={() => setChapter('looks')}>Go to looks</Button>}
            />
          )}

          <Card variant="default" className="mk-profile">
            <CardHead
              eyebrow="Context for every chart"
              title="Your own colouring, in your own words"
              right={<Button size="sm" onClick={() => setApForm({ ...blankAppearance(), ...ad })}>{appearance ? 'Edit' : 'Record'}</Button>}
            />
            <div className="mk-profile__row">
              <Stat label="Undertone as you read it" value={ad.undertone || 'not recorded'} />
              <Stat label="Depth as you read it" value={ad.depth || 'not recorded'} />
              <Stat label="Swatches recorded" value={swatched.length} hint="Only yours are ever compared" />
            </div>
            {ad.evidence ? <p className="gl-small gl-muted">How you know: {String(ad.evidence)}</p> : null}
            {(ad.notes as string[])?.length ? (
              <div className="gl-row gl-row--tight" style={{ marginTop: 8 }}>
                {(ad.notes as string[]).map((n) => (
                  <Chip key={n}>{n}</Chip>
                ))}
              </div>
            ) : null}
            <SafetyBanner tone="note" title="What this cannot do">
              No photograph is analysed, no colour is "recommended for your season", and no result here is a conclusion
              about your face. The Studio is a record-keeping tool with arithmetic attached.
            </SafetyBanner>
          </Card>
        </Section>
      ) : null}

      {/* ---------------------------------------------------- shade matching */}
      {chapter === 'shades' ? (
        <Section
          title="Shade matching"
          eyebrow="Arithmetic on your recorded swatches"
          description="Give it a colour. It ranks the swatches you recorded by weighted RGB distance. Nothing else — no brand database, no availability, no claim that any product exists."
          right={<Link className="gl-btn gl-btn--sm gl-btn--ghost" to="/color">Undertone work in Color</Link>}
        >
          <ShadeMatcher products={liveProducts} undertone={String(ad.undertone)} depth={String(ad.depth)} />
        </Section>
      ) : null}

      {/* ------------------------------------------------- inspiration wall */}
      {chapter === 'wall' ? (
        <Section
          title="Inspiration wall"
          eyebrow="Saved references and your own photographs"
          right={
            <>
              <Select
                value={wallFilter}
                onChange={setWallFilter}
                options={[
                  { value: 'makeup', label: 'makeup' },
                  { value: 'lips', label: 'lips' },
                  { value: 'brows', label: 'brows' },
                  { value: 'photography', label: 'photography' },
                  { value: 'grooming', label: 'grooming' }
                ]}
              />
              <PhotoPicker kind="progress" album="Makeup Studio" label="Add my own" withConditions onPick={(rows) => void linkMedia(rows)} />
            </>
          }
          description="References come from your Discover saves with their attribution and licence kept. Your own photographs sit alongside them, labelled."
        >
          {wallItems.length || media.length ? (
            <MasonryFeed
              items={[...wallItems.slice(0, wallCount), ...media.map((m) => ({ ...m, __own: true }))]}
              hasMore={wallCount < wallItems.length}
              onLoadMore={() => setWallCount((c) => c + 12)}
              render={(item) =>
                item.__own ? (
                  <Pin
                    item={item}
                    title={item.title || formatDate(String(item.takenOn))}
                    sub={`Your own · ${item.conditions || 'conditions not recorded'}`}
                    badge={<Chip tone="gold">mine</Chip>}
                    onOpen={() => setLightbox(media.findIndex((m) => m.id === item.id))}
                  />
                ) : (
                  <div className="mk-refcell">
                    <Pin
                      item={item.mediaId ? mediaById.get(String(item.mediaId)) : undefined}
                      title={String(item.title)}
                      sub={String(item.attribution || item.license || 'licence not recorded')}
                      badge={item.recreatable ? <Chip tone="strong">recreatable</Chip> : undefined}
                    />
                    <div className="mk-refcell__meta">
                      <p className="gl-small gl-muted">{String(item.description || 'no description saved')}</p>
                      <div className="gl-row gl-row--tight" style={{ flexWrap: 'wrap' }}>
                        {((item.categories as string[]) ?? []).slice(0, 4).map((c) => (
                          <Chip key={c} tone="info">{c}</Chip>
                        ))}
                      </div>
                      <div className="gl-row gl-row--tight" style={{ marginTop: 6 }}>
                        {item.sourceUrl ? (
                          <a className="gl-btn gl-btn--sm gl-btn--ghost" href={String(item.sourceUrl)} target="_blank" rel="noreferrer">
                            Open source
                          </a>
                        ) : null}
                        {item.recreatable ? (
                          <Link className="gl-btn gl-btn--sm" to="/recreate">
                            Recreate this look
                          </Link>
                        ) : null}
                        <Link className="gl-btn gl-btn--sm gl-btn--ghost" to="/inspiration">
                          Boards
                        </Link>
                      </div>
                    </div>
                  </div>
                )
              }
            />
          ) : (
            <EmptyPlate
              kicker="Wall"
              title="Nothing saved yet"
              body="Save references in Discover and your own finished-look photographs land here. The wall never fills itself with stock imagery."
              action={<Link className="gl-btn gl-btn--sm gl-btn--primary" to="/discover">Open Discover</Link>}
            />
          )}
          <PullQuote cite="Makeup Studio">A look you can rebuild is worth ten you merely liked — which is why the chart, the products and the occasions are all stored together.</PullQuote>
        </Section>
      ) : null}

      {/* --------------------------------------------------------- technique */}
      {chapter === 'craft' ? (
        <>
          <Section
            title="Technique"
            eyebrow="Written tutorials, your attempts recorded"
            right={<Link className="gl-btn gl-btn--sm gl-btn--ghost" to="/academy">Glow Academy</Link>}
            description="These are the Academy's written guides for this department. Attempts and completion are stored on the tutorial row."
          >
            {tutorials.filter((t) => !t.deletedAt).length ? (
              <IndexList>
                {tutorials
                  .filter((t) => !t.deletedAt)
                  .map((t, i) => (
                    <IndexRow
                      key={t.id}
                      no={i + 1}
                      title={String(t.title)}
                      sub={`${String(t.domain)} · ${String(t.minutes ?? '—')} min · difficulty ${String(t.difficulty ?? '—')}/5 · ${Number(t.attempts ?? 0)} attempt(s)`}
                      right={t.completedOn ? <Chip tone="strong">{formatDate(String(t.completedOn))}</Chip> : <Chip>not yet</Chip>}
                      onClick={() => setOpenTutorial(t.id)}
                    />
                  ))}
              </IndexList>
            ) : (
              <EmptyPlate
                kicker="Academy"
                title="No tutorials loaded"
                body="Open the Academy once and its written guides appear here with their steps and pitfalls."
                action={<Link className="gl-btn gl-btn--sm gl-btn--primary" to="/academy">Open Academy</Link>}
              />
            )}
          </Section>

          <Section title="Reactions you recorded" eyebrow="Colour cosmetics, dated" description="A product can be beautiful and still not agree with you. That is a record, not a verdict.">
            {observations.filter((o) => !o.deletedAt).length ? (
              <div className="mk-reacts">
                {byDateDesc(observations.filter((o) => !o.deletedAt), 'on').map((o) => (
                  <Card key={o.id} variant="default" className="mk-react">
                    <div className="gl-row gl-row--between" style={{ alignItems: 'baseline' }}>
                      <span className="gl-tech">{formatDate(String(o.on))}</span>
                      <Chip tone={o.reaction === 'irritation' || o.reaction === 'breakout' || o.reaction === 'bad' ? 'danger' : undefined}>{String(o.reaction)}</Chip>
                    </div>
                    <p className="gl-small">{String(o.note)}</p>
                    {o.subjectId ? <Chip tone="info">{liveProducts.find((p) => p.id === o.subjectId)?.name ?? 'entry no longer in the collection'}</Chip> : null}
                  </Card>
                ))}
              </div>
            ) : (
              <EmptyState title="No reaction entries" body="If something stings, settles badly or will not stay, note the date and the product while you still remember." />
            )}
            <SafetyBanner tone="warn" title="Swelling, blistering or spreading rash is not a cosmetics matter">
              Stop using the product and get clinical care. This page records what happened to you; it cannot assess
              your skin, and it does not offer diagnoses or treatments.
            </SafetyBanner>
          </Section>

          <Section title="Photographic record" eyebrow="Your own finished looks">
            {media.length ? (
              <div className="mk-strip">
                {media.slice(0, 10).map((m, i) => (
                  <button key={m.id} type="button" className="mk-strip__cell" onClick={() => setLightbox(i)} aria-label={`Open ${m.title || formatDate(String(m.takenOn))}`}>
                    <MediaImg row={m} />
                    <span className="mk-strip__cap">
                      <span className="gl-serif">{m.title || 'Untitled'}</span>
                      <span className="gl-tech">{formatDate(String(m.takenOn))} · {m.conditions || 'conditions unlabelled'}</span>
                    </span>
                  </button>
                ))}
              </div>
            ) : (
              <EmptyPlate
                kicker="Photography"
                title="No photographs filed here"
                body="Standardised conditions are what make a later comparison honest. Add one and it is labelled with lighting, distance and condition."
                action={<PhotoPicker kind="progress" album="Makeup Studio" label="Add photograph" withConditions onPick={(rows) => void linkMedia(rows)} />}
              />
            )}
          </Section>
        </>
      ) : null}

      {/* ------------------------------------------------------------ modals */}
      {pForm ? <ProductEditor key={pForm.id ?? 'new'} initial={pForm} currency={currency} onCancel={() => setPForm(null)} onSave={(v) => void saveProduct(v)} /> : null}
      {lForm ? (
        <LookEditor key={lForm.id ?? 'new'} initial={lForm} products={liveProducts} media={media} onCancel={() => setLForm(null)} onSave={(v) => void saveLook(v)} />
      ) : null}
      {apForm ? <AppearanceEditor key={appearance?.id ?? 'appearance'} initial={apForm} onCancel={() => setApForm(null)} onSave={(v) => void saveAppearance(v)} /> : null}
      {confirm ? <ConfirmDelete label={confirm.label} onCancel={() => setConfirm(null)} onYes={confirm.run} /> : null}
      {openTutorial && tutorials.find((t) => t.id === openTutorial) ? (
        <TutorialViewer
          key={openTutorial}
          tutorial={tutorials.find((t) => t.id === openTutorial)!}
          onClose={() => setOpenTutorial(null)}
          onAttempt={() => void bumpAttempt(tutorials.find((t) => t.id === openTutorial)!)}
          onComplete={(on) => void completeTutorial(tutorials.find((t) => t.id === openTutorial)!, on)}
        />
      ) : null}

      <Lightbox
        items={media}
        index={lightbox}
        onIndex={setLightbox}
        onClose={() => setLightbox(null)}
        header={(m) => (
          <div>
            <div className="gl-serif" style={{ fontSize: '1.2rem' }}>{m.title || 'Makeup photograph'}</div>
            <div className="gl-tech">{formatDate(String(m.takenOn))} · {m.conditions || 'conditions not recorded'} · {m.lighting || 'lighting not recorded'}</div>
          </div>
        )}
        footer={(m) => (asData(m).palette?.length ? <Swatches colors={(asData(m).palette as string[]).slice(0, 6)} size={24} /> : null)}
      />
    </div>
  );
}

/* ---------------------------------------------------------------- helpers */

const blankAppearance = () => ({ undertone: '', depth: '', evidence: '', notes: [] as string[] });

function shown(v: unknown) {
  return v === null || v === undefined || v === '' ? 'not recorded' : String(v);
}

function compareFields(
  a: AnyRow,
  b: AnyRow,
  currency: string,
  observations: AnyRow[],
  looks: AnyRow[]
) {
  const da = asData(a);
  const db = asData(b);
  const hex = (d: Record<string, any>) => (isHex(String(d.swatchHex ?? '')) ? String(d.swatchHex) : 'no swatch recorded');
  const money = (r: AnyRow) => (r.pricePaid === null || r.pricePaid === undefined ? 'not recorded' : fmtMoney(Number(r.pricePaid), String(r.currency || currency)));
  const reactions = (r: AnyRow) => String(observations.filter((o) => o.subjectId === r.id && !o.deletedAt).length);
  const inLooks = (r: AnyRow) => {
    const names = looks
      .filter((l) => ((l.itemIds as string[]) ?? []).includes(r.id))
      .map((l) => String(l.name || 'untitled'));
    return names.length ? `${names.length} — ${names.join(', ')}` : 'none yet';
  };
  const distance =
    isHex(String(da.swatchHex ?? '')) && isHex(String(db.swatchHex ?? '')) ? String(shadeDistance(String(da.swatchHex), String(db.swatchHex))) : 'needs two recorded swatches';
  return [
    { field: 'Brand', a: shown(a.brand), b: shown(b.brand) },
    { field: 'Shade name', a: shown(da.shadeName), b: shown(db.shadeName) },
    { field: 'Shade code', a: shown(da.shadeCode), b: shown(db.shadeCode) },
    { field: 'Swatch hex', a: hex(da), b: hex(db) },
    { field: 'Undertone recorded', a: shown(da.undertone), b: shown(db.undertone) },
    { field: 'Depth recorded', a: shown(da.depth), b: shown(db.depth) },
    { field: 'Finish', a: shown(da.finish), b: shown(db.finish) },
    { field: 'Area', a: shown(da.area), b: shown(db.area) },
    { field: 'Form', a: shown(a.form), b: shown(b.form) },
    { field: 'Price paid', a: money(a), b: money(b) },
    { field: 'Opened', a: a.openedOn ? formatDate(String(a.openedOn)) : 'not recorded', b: b.openedOn ? formatDate(String(b.openedOn)) : 'not recorded' },
    { field: 'Your rating', a: Number(a.rating) ? `${a.rating}/5` : 'not rated', b: Number(b.rating) ? `${b.rating}/5` : 'not rated' },
    { field: 'Reactions named', a: reactions(a), b: reactions(b) },
    { field: 'Distance between the two swatches', a: distance, b: distance },
    { field: 'Looks containing it', a: inLooks(a), b: inLooks(b) }
  ];
}
