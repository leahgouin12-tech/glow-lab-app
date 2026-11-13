import '../styles/ghost.css';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from 'react';
import { ChevronLeft, ChevronRight, Crosshair, Heart, RotateCcw, Tag, X, ZoomIn, ZoomOut } from 'lucide-react';
import { ingestImage, useImageSrc, type SimilarMedia } from '../media/store';
import { formatDate, hardDelete } from '../db/repo';
import { TABLES, type AnyRow } from '../db/schema';
import { db } from '../db/db';
import { useSettings } from '../state/settings';
import {
  DEFAULT_SHOT_TARGET,
  SHOT_KINDS,
  SHOT_TARGETS,
  captureShot,
  changeTarget,
  clearSlot,
  createGroup,
  groupSummary,
  lineupSlot,
  nextOpenSlot,
  openSequence,
  orderedShots,
  referenceSlot,
  setSlotFields,
  setSlotKind,
  setSlotLabel,
  type ShotFields,
  type ShotGroup,
  type ShotKind
} from '../engine/shotGrid';
import { GhostGuide, type GhostReference } from './GhostGuide';
import { Button, Chip, Field, IconButton, Modal, Select, TextArea, TextInput, useToast } from './primitives';

/* ------------------------------------------------------------------- pin */

export interface PinAction {
  key: string;
  label: string;
  icon: ReactNode;
  on?: boolean;
  onClick: () => void;
}

export function Pin({
  item,
  title,
  sub,
  badge,
  actions,
  onOpen,
  style
}: {
  item: AnyRow | undefined | null;
  title?: ReactNode;
  sub?: ReactNode;
  badge?: ReactNode;
  actions?: PinAction[];
  onOpen?: () => void;
  style?: React.CSSProperties;
}) {
  const src = useImageSrc(item, 'thumb');
  const ratio = item?.width && item?.height ? `${item.width} / ${item.height}` : '3 / 4';
  return (
    <div className="gl-pin" style={{ ...style, aspectRatio: src ? ratio : '3 / 4', minHeight: src ? undefined : 180 }} onClick={onOpen}>
      {src ? (
        <img src={src} alt={String(title ?? '')} loading="lazy" decoding="async" className="gl-img-treated" />
      ) : (
        <div className="gl-missing-img" style={{ position: 'absolute', inset: 0 }}>
          Image unavailable
        </div>
      )}
      {badge ? <div className="gl-pin__state">{badge}</div> : null}
      {actions?.length ? (
        <div className="gl-pin__actions" onClick={(e) => e.stopPropagation()}>
          {actions.map((a) => (
            <button
              key={a.key}
              type="button"
              className="gl-pin__act"
              data-on={a.on}
              title={a.label}
              aria-label={a.label}
              aria-pressed={a.on}
              onClick={(e) => {
                e.stopPropagation();
                a.onClick();
              }}
            >
              {a.icon}
            </button>
          ))}
        </div>
      ) : null}
      <div className="gl-pin__scrim">
        <div className="gl-pin__title">{title}</div>
        {sub ? <div className="gl-tech" style={{ color: 'rgba(255,255,255,.72)' }}>{sub}</div> : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- masonry feed */

export function MasonryFeed({
  items,
  hasMore,
  onLoadMore,
  render,
  skeleton = 0
}: {
  items: any[];
  hasMore: boolean;
  onLoadMore: () => void;
  render: (item: any, index: number) => ReactNode;
  skeleton?: number;
}) {
  const sentinel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) onLoadMore();
      },
      { rootMargin: '900px 0px' }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, onLoadMore, items.length]);
  return (
    <>
      <div className="gl-masonry">
        {items.map((it, i) => (
          <div key={it?.id ?? i}>{render(it, i)}</div>
        ))}
        {Array.from({ length: skeleton }).map((_, i) => (
          <div key={`s${i}`} className="gl-skeleton" style={{ height: 220 + (i % 3) * 70, marginBottom: 12 }} />
        ))}
      </div>
      <div ref={sentinel} style={{ height: 1 }} aria-hidden />
      {!hasMore && items.length > 0 ? (
        <div className="gl-note" style={{ marginTop: 'var(--glow-sp-5)' }}>
          Nothing left to serve — the library is empty or every card in it is hidden. Add a reference, import your Pinterest export, or
          save a free image key in Settings and the feed picks up again.
        </div>
      ) : null}
    </>
  );
}

/* ---------------------------------------------------------------- lightbox */

export function Lightbox({
  items,
  index,
  onIndex,
  onClose,
  header,
  footer
}: {
  items: AnyRow[];
  index: number | null;
  onIndex: (i: number) => void;
  onClose: () => void;
  header?: (item: AnyRow) => ReactNode;
  footer?: (item: AnyRow) => ReactNode;
}) {
  const item = index === null ? undefined : items[index];
  const src = useImageSrc(item, 'full');
  useEffect(() => {
    if (index === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight' && index < items.length - 1) onIndex(index + 1);
      if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [index, items.length, onClose, onIndex]);
  if (!item) return null;
  const idx = index ?? 0;
  return (
    <div className="gl-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        style={{
          width: 'min(1200px, 96vw)',
          maxHeight: '94vh',
          display: 'grid',
          gridTemplateColumns: 'minmax(0,1fr)',
          gap: 'var(--glow-sp-3)'
        }}
      >
        <div className="gl-row gl-row--between" style={{ color: 'var(--glow-text-secondary)' }}>
          <div style={{ minWidth: 0 }}>{header?.(item)}</div>
          <IconButton label="Close" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>
        <div
          className="gl-feature-img"
          style={{ background: 'var(--glow-plate)', height: 'min(72vh, 900px)', display: 'grid', placeItems: 'center' }}
        >
          {src ? <img src={src} alt="" style={{ maxHeight: '100%', width: 'auto', objectFit: 'contain' }} /> : <span className="gl-tech">Image unavailable offline</span>}
        </div>
        <div className="gl-row gl-row--between">
          <Button variant="ghost" size="sm" onClick={() => onIndex(Math.max(0, idx - 1))} disabled={idx <= 0}>
            <ChevronLeft size={14} /> Previous
          </Button>
          <div className="gl-tech">
            {idx + 1} / {items.length}
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onIndex(Math.min(items.length - 1, idx + 1))}
            disabled={idx >= items.length - 1}
          >
            Next <ChevronRight size={14} />
          </Button>
        </div>
        {footer ? <div>{footer(item)}</div> : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------ comparison */

export function CompareSlider({
  before,
  after,
  beforeLabel = 'Before',
  afterLabel = 'After',
  height = 420
}: {
  before?: AnyRow | null;
  after?: AnyRow | null;
  beforeLabel?: string;
  afterLabel?: string;
  height?: number;
}) {
  const a = useImageSrc(before, 'full');
  const b = useImageSrc(after, 'full');
  const [split, setSplit] = useState(52);
  const ref = useRef<HTMLDivElement | null>(null);
  const drag = (clientX: number) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    setSplit(Math.max(2, Math.min(98, ((clientX - rect.left) / rect.width) * 100)));
  };
  if (!a && !b) return <div className="gl-empty">Add two photographs to compare them.</div>;
  return (
    <div
      className="gl-compare"
      style={{ height, ['--glow-split' as any]: `${split}%` }}
      ref={ref}
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        drag(e.clientX);
      }}
      onPointerMove={(e) => e.buttons === 1 && drag(e.clientX)}
    >
      <div className="gl-compare__layer">
        {b ? <img src={b} alt={afterLabel} /> : <div className="gl-missing-img" style={{ height: '100%' }}>No after image</div>}
        <span className="gl-compare__label" style={{ right: 8 }}>{afterLabel}</span>
      </div>
      <div className="gl-compare__layer gl-compare__top">
        {a ? <img src={a} alt={beforeLabel} /> : <div className="gl-missing-img" style={{ height: '100%' }}>No before image</div>}
        <span className="gl-compare__label" style={{ left: 8 }}>{beforeLabel}</span>
      </div>
      <div className="gl-compare__handle" role="slider" aria-label="Comparison position" aria-valuenow={Math.round(split)} tabIndex={0} />
    </div>
  );
}

/* ------------------------------------------------------- analysis canvas */

export interface Guide {
  type: 'h' | 'v';
  at: number;
  label?: string;
}
export interface CanvasPin {
  id: string;
  x: number;
  y: number;
  label: string;
  note?: string;
}

export function PhotoCanvas({
  item,
  guides = [],
  pins = [],
  onMovePin,
  height = 460,
  overlaysOffLabel = 'Guides hidden'
}: {
  item?: AnyRow | null;
  guides?: Guide[];
  pins?: CanvasPin[];
  onMovePin?: (id: string, x: number, y: number) => void;
  height?: number;
  overlaysOffLabel?: string;
}) {
  const src = useImageSrc(item, 'full');
  // "On-device image tools" in Settings → Privacy is what puts guides and annotation
  // markers on the canvas; off means the canvas shows only the photograph.
  const toolsOn = useSettings().imageAnalysis;
  const activeGuides = toolsOn ? guides : [];
  const activePins = toolsOn ? pins : [];
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [rotate, setRotate] = useState(0);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const dragging = useRef<{ x: number; y: number } | null>(null);
  const pinDrag = useRef<string | null>(null);

  const reset = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
    setRotate(0);
  };

  const toPercent = useCallback((clientX: number, clientY: number) => {
    const rect = boxRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100)),
      y: Math.max(0, Math.min(100, ((clientY - rect.top) / rect.height) * 100))
    };
  }, []);

  return (
    <div className="gl-canvas" style={{ height }} ref={boxRef}>
      <div
        className="gl-canvas__stage"
        onPointerDown={(e) => {
          dragging.current = { x: e.clientX - pan.x, y: e.clientY - pan.y };
        }}
        onPointerMove={(e) => {
          if (pinDrag.current && onMovePin) {
            const p = toPercent(e.clientX, e.clientY);
            onMovePin(pinDrag.current, p.x, p.y);
            return;
          }
          if (dragging.current) setPan({ x: e.clientX - dragging.current.x, y: e.clientY - dragging.current.y });
        }}
        onPointerUp={() => {
          dragging.current = null;
          pinDrag.current = null;
        }}
        onPointerLeave={() => {
          dragging.current = null;
          pinDrag.current = null;
        }}
        onWheel={(e) => setZoom((z) => Math.max(0.5, Math.min(4, z - Math.sign(e.deltaY) * 0.12)))}
      >
        {src ? (
          <img
            src={src}
            alt=""
            className="gl-canvas__img gl-img-treated"
            style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom}) rotate(${rotate}deg)`, maxHeight: 'none', width: '100%' }}
            draggable={false}
          />
        ) : (
          <div className="gl-missing-img" style={{ width: '100%', height: '100%' }}>
            No photograph loaded — capture one under standardised conditions.
          </div>
        )}
        <div className="gl-canvas__overlay">
          {activeGuides.map((g, i) => (
            <div
              key={i}
              className={`gl-guide gl-guide--${g.type}`}
              style={g.type === 'h' ? { top: `${g.at}%` } : { left: `${g.at}%` }}
            >
              {g.label ? <span className="gl-guide__tag">{g.label}</span> : null}
            </div>
          ))}
          {activePins.map((p) => (
            <div
              key={p.id}
              className="gl-pin-dot"
              title={`${p.label}${p.note ? ` — ${p.note}` : ''}`}
              style={{ left: `${p.x}%`, top: `${p.y}%`, pointerEvents: 'auto' }}
              onPointerDown={(e) => {
                e.stopPropagation();
                pinDrag.current = p.id;
              }}
            />
          ))}
        </div>
      </div>
      <div className="gl-canvas__tools">
        <button type="button" className="gl-pin__act" title="Zoom out" onClick={() => setZoom((z) => Math.max(0.5, z - 0.2))}>
          <ZoomOut size={14} />
        </button>
        <span className="gl-tech" style={{ padding: '0 6px', color: '#efe7e0' }}>{Math.round(zoom * 100)}%</span>
        <button type="button" className="gl-pin__act" title="Zoom in" onClick={() => setZoom((z) => Math.min(4, z + 0.2))}>
          <ZoomIn size={14} />
        </button>
        <button type="button" className="gl-pin__act" title="Rotate 90°" onClick={() => setRotate((r) => (r + 90) % 360)}>
          <RotateCcw size={14} />
        </button>
        <button type="button" className="gl-pin__act" title="Reset view" onClick={reset}>
          <X size={14} />
        </button>
        {!guides.length ? <span className="gl-tech" style={{ padding: '0 6px', color: '#b8ada6' }}>{overlaysOffLabel}</span> : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- photo picker */

export const CAPTURE_CONDITIONS = ['Front · neutral', 'Left profile', 'Right profile', 'Three-quarter', 'Smiling', 'Relaxed', 'Event look', 'Progress check'];
export const LIGHTING = ['Window light', 'Ring light', 'Overhead indoor', 'Outdoor shade', 'Mixed/unknown'];
export const DISTANCES = ['30cm phone', '60cm phone', '1m+', 'Unknown'];

/**
 * The one file path every capture flow in the app uses.
 *
 * `reference` is opt-in and changes nothing when it is absent: pass
 * `{ row, src }` to get the matched-framing guide (line up before shooting,
 * reconcile after choosing a file and before anything is written), or pass
 * `null` to say "this set has no stored shot yet" and still show the guide.
 * Leave the prop out entirely and the picker behaves exactly as it always did.
 */
export function PhotoPicker({
  onPick,
  kind = 'upload',
  accept = 'image/*',
  label = 'Add photograph',
  withConditions = false,
  album,
  standard = false,
  reference
}: {
  onPick: (rows: AnyRow[]) => void;
  kind?: AnyRow['kind'];
  accept?: string;
  label?: string;
  withConditions?: boolean;
  album?: string;
  standard?: boolean;
  reference?: GhostReference | null;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [similar, setSimilar] = useState<SimilarMedia[]>([]);
  const allowAdding = useSettings().allowUploads;
  const [meta, setMeta] = useState({ title: '', caption: '', conditions: CAPTURE_CONDITIONS[0], lighting: LIGHTING[0], distance: DISTANCES[1] });

  /* ------------------------------------------------- matched-framing guide */
  const guide = reference !== undefined;
  const wantsConditions = withConditions || standard || guide;
  const [lineup, setLineup] = useState(false);
  const [pending, setPending] = useState<{ files: File[]; url: string; name: string } | null>(null);
  const stagedUrl = useRef<string | null>(null);

  const dropStaged = useCallback(() => {
    if (stagedUrl.current) URL.revokeObjectURL(stagedUrl.current);
    stagedUrl.current = null;
  }, []);
  /** Closing the picker by any route — including unmount — must not strand a preview URL. */
  useEffect(() => dropStaged, [dropStaged]);

  /** Hold the chosen file(s) back from ingest so the reconcile step can run. */
  const stage = (files: File[]) => {
    if (!files.length) return;
    dropStaged();
    let url = '';
    try {
      url = URL.createObjectURL(files[0]);
    } catch {
      url = '';
    }
    stagedUrl.current = url || null;
    setPending({ files, url, name: files[0].name || 'the file you chose' });
  };

  const handle = async (files: File[]) => {
    if (!files.length) return;
    setBusy(true);
    setSimilar([]);
    const rows: AnyRow[] = [];
    const lookalikes: SimilarMedia[] = [];
    for (const file of files) {
      try {
        const res = await ingestImage({
          file,
          kind,
          album,
          title: meta.title,
          caption: meta.caption,
          sourceKind: 'user',
          conditions: wantsConditions ? meta.conditions : '',
          lighting: wantsConditions ? meta.lighting : '',
          distance: wantsConditions ? meta.distance : ''
        });
        rows.push(res.row);
        if (res.duplicate) toast('That photograph was already in your library — matched by content hash, not added twice.');
        for (const hit of res.similar ?? []) {
          if (!lookalikes.some((l) => l.id === hit.id)) lookalikes.push(hit);
        }
      } catch (err: any) {
        toast(err?.message ?? 'Could not read that image.', 'bad');
      }
    }
    lookalikes.sort((a, b) => a.distance - b.distance);
    setSimilar(lookalikes.slice(0, 3));
    setBusy(false);
    if (rows.length) {
      onPick(rows);
      toast(`${rows.length} image${rows.length > 1 ? 's' : ''} stored locally.`, 'ok');
    }
  };

  /** File input → guide on: nothing is read or written until the reconcile step is confirmed. */
  const receive = (fileList: FileList | null) => {
    const files = Array.from(fileList ?? []);
    if (inputRef.current) inputRef.current.value = '';
    if (!files.length) return;
    if (guide) {
      stage(files);
      setOpen(true);
      return;
    }
    void handle(files);
  };

  /** Backing out of the form discards the held file: nothing is ingested. */
  const closeForm = () => {
    dropStaged();
    setPending(null);
    setOpen(false);
  };

  const confirmPending = async () => {
    if (!pending) return;
    const files = pending.files;
    dropStaged();
    setPending(null);
    setOpen(false);
    await handle(files);
  };

  return (
    <>
      {!allowAdding ? (
        <CaptureRefused />
      ) : (
      <>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple
        hidden
        capture={standard ? 'environment' : undefined}
        onChange={(e) => receive(e.target.files)}
      />
      {guide ? (
        <div className="gl-row gl-row--tight" style={{ flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
          <Button variant="ghost" icon={<Crosshair size={14} />} onClick={() => setLineup(true)}>
            Line up first
          </Button>
          <span className="gl-small gl-faint">
            {reference
              ? `Reproduce the shot stored as “${String(reference.row.title || 'Untitled')}” before you capture — then the new file is checked against it before anything is written.`
              : 'Nothing is stored in this set yet, so there is nothing to line up against. This capture becomes the reference.'}
          </span>
        </div>
      ) : null}
      <Button
        variant="primary"
        onClick={() => {
          if (wantsConditions) setOpen(true);
          else inputRef.current?.click();
        }}
        disabled={busy}
        icon={<Tag size={14} />}
      >
        {busy ? 'Storing…' : label}
      </Button>
      {similar.length ? (
        <div className="gl-row gl-row--tight" style={{ flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
          <span className="gl-small gl-muted">This looks like shots you already logged:</span>
          {similar.map((s) => (
            <Chip key={s.id} title={`The picture fingerprint differs in ${s.distance} of 64 bits — a near match, not a certainty.`}>
              {s.title}
              {s.takenOn ? ` · ${formatDate(s.takenOn)}` : ''}
            </Chip>
          ))}
          <Button size="sm" variant="ghost" onClick={() => setSimilar([])}>
            Dismiss
          </Button>
        </div>
      ) : null}
      <Modal
        open={open}
        onClose={closeForm}
        wide={Boolean(guide && pending)}
        title={guide && pending ? 'Check it against the reference' : 'Capture conditions'}
        footer={
          guide && pending ? (
            <>
              <Chip tone="info">Nothing is written until you confirm</Chip>
              <div className="gl-row gl-row--tight" style={{ flexWrap: 'wrap' }}>
                <Button variant="ghost" onClick={closeForm}>
                  Cancel
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    dropStaged();
                    setPending(null);
                    inputRef.current?.click();
                  }}
                >
                  Pick a different file
                </Button>
                <Button variant="primary" disabled={busy} onClick={() => void confirmPending()}>
                  {busy ? 'Storing…' : `Store ${pending.files.length} ${pending.files.length > 1 ? 'files' : 'file'}`}
                </Button>
              </div>
            </>
          ) : (
            <>
              <Chip tone="info">Recorded with the image so future shots are comparable</Chip>
              <Button
                variant="primary"
                onClick={() => {
                  setOpen(false);
                  inputRef.current?.click();
                }}
              >
                Choose photo
              </Button>
            </>
          )
        }
      >
        <p className="gl-small gl-muted">
          Standardised conditions are what make later comparisons mean something. Casual selfies are welcome — just label
          them as casual, because lens distance and lighting change apparent proportions.
        </p>
        <div className="gl-form-row">
          <Field label="Title">
            <TextInput value={meta.title} onChange={(v) => setMeta({ ...meta, title: v })} placeholder="e.g. Baseline — March" />
          </Field>
          <Field label="Condition set">
            <Select
              value={meta.conditions}
              onChange={(v) => setMeta({ ...meta, conditions: v })}
              options={CAPTURE_CONDITIONS.map((c) => ({ value: c, label: c }))}
            />
          </Field>
          <Field label="Lighting">
            <Select value={meta.lighting} onChange={(v) => setMeta({ ...meta, lighting: v })} options={LIGHTING.map((c) => ({ value: c, label: c }))} />
          </Field>
          <Field label="Camera distance">
            <Select value={meta.distance} onChange={(v) => setMeta({ ...meta, distance: v })} options={DISTANCES.map((c) => ({ value: c, label: c }))} />
          </Field>
        </div>
        <Field label="Notes">
          <TextArea value={meta.caption} onChange={(v) => setMeta({ ...meta, caption: v })} placeholder="Anything that affected the shot" />
        </Field>
        {guide ? (
          <p className="gl-small gl-faint" style={{ marginTop: 'var(--glow-sp-3)' }}>
            {pending
              ? 'These four values are what the check below compares — change one and the check follows. The file stays outside your library until you store it.'
              : 'Choose a file and it will be shown over the reference, with this record checked against it, before anything is written.'}
          </p>
        ) : null}
        {guide && pending ? (
          <div style={{ marginTop: 'var(--glow-sp-5)' }}>
            <GhostGuide
              mode="reconcile"
              reference={reference ?? null}
              preview={{ url: pending.url, name: pending.name, count: pending.files.length }}
              typed={{
                conditions: meta.conditions,
                lighting: meta.lighting,
                distance: meta.distance,
                ...(reference?.pose === undefined ? {} : { pose: reference.pose })
              }}
            />
          </div>
        ) : null}
      </Modal>
      {guide ? (
        <Modal open={lineup} onClose={() => setLineup(false)} title="Line up with the reference shot" wide>
          <GhostGuide
            mode="lineup"
            reference={reference ?? null}
            onShot={(files) => {
              setLineup(false);
              stage(files);
              setOpen(true);
            }}
          />
          <p className="gl-small gl-faint" style={{ marginTop: 'var(--glow-sp-4)' }}>
            Close this panel and the camera is released. The ordinary file picker below still works, and it is the only
            route on browsers that will not show a live preview.
          </p>
        </Modal>
      ) : null}
      </>
      )}
    </>
  );
}

/* ------------------------------------------------------------ capture gate */

/**
 * The refusal every capture flow gives when Settings → Privacy has photograph
 * adding switched off. One copy, one markup, so no flow can word it softer.
 */
export function CaptureRefused() {
  return (
    <>
      <Button variant="ghost" disabled icon={<Tag size={14} />} title="Switched off in Settings → Privacy">
        Capture is off
      </Button>
      <Chip tone="info">Adding photographs is off — your existing library is untouched</Chip>
    </>
  );
}

/**
 * Delete media rows for good, bytes included. This is the route the photo
 * library's own "delete permanently" takes: the blob row is removed first,
 * because `hardDelete`'s blob lookup keys on the media id and so never matches
 * a row's `blobId`. Anything still referenced by a saved row is left alone by
 * the caller, not by this function.
 */
export async function purgeStoredMedia(ids: string[]): Promise<number> {
  let purged = 0;
  for (const id of ids) {
    if (!id) continue;
    const item = await db.mediaItems.get(id);
    if (!item) continue;
    if (item.blobId) await db.mediaBlobs.delete(String(item.blobId));
    await hardDelete(TABLES.mediaItems, String(item.id));
    purged += 1;
  }
  return purged;
}

/* ------------------------------------------------------- shot grid picker */

/** A progress check-in records three fields; pose is not one of them. */
const DEFAULT_SHOT_FIELDS: ShotFields = {
  conditions: 'Progress check',
  lighting: LIGHTING[0],
  distance: DISTANCES[1]
};

const slotFields = (slot: { fields: ShotFields | null } | undefined): ShotFields => ({
  ...DEFAULT_SHOT_FIELDS,
  ...(slot?.fields ?? {})
});

function ShotThumb({ row }: { row: AnyRow | null }) {
  const src = useImageSrc(row, 'thumb');
  return (
    <span className="sg__frame">
      {src ? <img src={src} alt="" loading="lazy" decoding="async" /> : <span className="gl-missing-img">No frame in this slot</span>}
    </span>
  );
}

/**
 * An N-shot same-framing capture set.
 *
 * The reason this exists is the flaw in one photo per check-in: two frames shot
 * on different days, in different light, from different distances are not
 * comparable, and the honest answer the comparison screens can give is a warning.
 * Here she sets the framing up once and shoots a whole set. The first frame
 * taken becomes the reference, and `GhostGuide mode="lineup"` — the same overlay
 * machinery the rest of the app uses, not a second one — frames every later slot
 * against it. Each slot keeps its own recorded conditions, and the set's summary
 * names the shots whose recorded fields differ from the reference, using
 * `conditionDiff` / `comparableRows`.
 *
 * Save semantics: one group, one `progressEntries` row. `onGroup` hands over the
 * media ids in slot order, and empty slots contribute nothing — a slot she did
 * not shoot stays a hole in the record, described in words, never a placeholder
 * image. Existing callers are untouched by this component; it is additive and
 * standalone.
 */
export function ShotGridPicker({
  kind = 'progress',
  album = 'Progress',
  initialTarget = DEFAULT_SHOT_TARGET,
  /** media ids the saved entry already references — a set never deletes those */
  protectedIds = [],
  onGroup
}: {
  kind?: AnyRow['kind'];
  album?: string;
  initialTarget?: number;
  protectedIds?: string[];
  /** ids in slot order, the rows beside them, and every id this set has written */
  onGroup?: (ids: string[], rows: AnyRow[], ownedIds: string[]) => void;
}) {
  const toast = useToast();
  const allowed = useSettings().allowUploads;
  const opened = useMemo(() => openSequence(initialTarget, allowed), [initialTarget, allowed]);
  const [group, setGroup] = useState<ShotGroup>(() => opened.group ?? createGroup(initialTarget));
  const [active, setActive] = useState(1);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [showLineup, setShowLineup] = useState(false);
  const [askDiscard, setAskDiscard] = useState(false);

  const groupRef = useRef(group);
  groupRef.current = group;
  const inputRef = useRef<HTMLInputElement | null>(null);
  /** which slot an open file dialog belongs to */
  const openFor = useRef<number>(0);
  /** ids this panel wrote into the library */
  const created = useRef<Set<string>>(new Set());
  /** ids handed to `onGroup` and not yet replaced */
  const committed = useRef<Set<string>>(new Set());
  /** ids the panel wrote that no slot points at any more */
  const retired = useRef<Set<string>>(new Set());

  const summary = groupSummary(group);
  const slot = group.slots.find((s) => s.n === active) ?? group.slots[0];
  const fields = slotFields(slot);
  const guide = lineupSlot(group, slot?.n ?? 1);
  const guideRow = guide?.shot ?? null;
  const guideSrc = useImageSrc(guideRow, 'full');
  const anchor = referenceSlot(group);

  /**
   * Release frames nothing points at any more: the set's own slots, the ids
   * already handed over, and the ids the saved entry references are all kept.
   */
  const sweep = useCallback(async (keepIds: string[]) => {
    const keep = new Set([...keepIds, ...Array.from(committed.current), ...protectedIds]);
    const gone: string[] = [];
    for (const id of Array.from(retired.current)) {
      if (keep.has(id)) continue;
      gone.push(id);
      retired.current.delete(id);
    }
    if (gone.length) await purgeStoredMedia(gone);
    return gone.length;
  }, [protectedIds]);

  /** Ingest one file into one slot. Nothing is uploaded: `ingestImage` is local. */
  const captureInto = useCallback(
    async (n: number, files: File[]) => {
      const file = files[0];
      const current = groupRef.current;
      const target = current.slots.find((s) => s.n === n);
      if (!file || !target) return;
      setBusy(true);
      setNote('');
      try {
        const typed = slotFields(target);
        const res = await ingestImage({
          file,
          kind,
          album,
          title: `Shot ${n} — ${target.label}`,
          caption: `Shot ${n} of a ${current.target}-shot same-framing set (${target.label}).`,
          sourceKind: 'user',
          conditions: typed.conditions,
          lighting: typed.lighting,
          distance: typed.distance
        });
        if (res.duplicate) {
          toast('That photograph was already in your library — matched by content hash, not added twice.');
        } else {
          created.current.add(String(res.row.id));
        }
        const out = captureShot(current, n, res.row, typed);
        if (out.alreadyInSet) {
          // the content hash matched a frame this set already holds, so the row
          // was never ours to write and nothing here deletes it
          const holder = current.slots.find((s) => s.n !== n && s.shot && String(s.shot.id) === String(res.row.id));
          setNote(
            `That file is already shot ${holder?.n ?? n} of this set, matched by content hash. A set needs different frames, so nothing was changed.`
          );
          return;
        }
        if (out.unchanged) {
          setNote(`Shot ${n} already holds this exact frame, so nothing changed.`);
          return;
        }
        for (const id of out.displaced) retired.current.add(id);
        setGroup(out.group);
        const dropped = await sweep(orderedShots(out.group).map((s) => s.id));
        const nextOpen = nextOpenSlot(out.group);
        if (nextOpen !== null) setActive(nextOpen);
        setShowLineup(false);
        setNote(
          dropped
            ? `Shot ${n} replaced: the frame it displaced was deleted with its image data, because nothing points at it now.`
            : out.displaced.length
              ? `Shot ${n} replaced. The frame it displaced stays in your library — this check-in still points at it.`
              : ''
        );
      } catch (err: any) {
        toast(err?.message ?? 'Could not read that image.', 'bad');
      } finally {
        setBusy(false);
      }
    },
    [album, kind, sweep, toast]
  );

  const chooseFor = (n: number) => {
    openFor.current = n;
    setActive(n);
    setAskDiscard(false);
    inputRef.current?.click();
  };

  const receive = (list: FileList | null) => {
    const files = Array.from(list ?? []);
    if (inputRef.current) inputRef.current.value = '';
    const n = openFor.current || slot?.n || 1;
    if (files.length) void captureInto(n, files);
  };

  const onTarget = (value: string) => {
    const res = changeTarget(groupRef.current, Number(value));
    if (res.reason) {
      setNote(res.reason);
      return;
    }
    setNote('');
    setGroup(res.group);
    if (nextOpenSlot(res.group) !== null) setActive(nextOpenSlot(res.group) as number);
  };

  const setField = (key: 'conditions' | 'lighting' | 'distance', value: string) => {
    const next: ShotFields = { ...fields, [key]: value };
    setGroup(setSlotFields(groupRef.current, slot.n, next));
  };

  const detach = async (n: number) => {
    const out = clearSlot(groupRef.current, n);
    for (const id of out.displaced) retired.current.add(id);
    setGroup(out.group);
    setNote('');
    const dropped = await sweep(orderedShots(out.group).map((s) => s.id));
    if (!dropped && out.displaced.length) {
      setNote('That frame stays in your library — this check-in still points at it.');
    }
  };

  const commit = () => {
    const ordered = orderedShots(groupRef.current);
    if (!ordered.length) return;
    const ids = ordered.map((s) => s.id);
    committed.current = new Set(ids);
    onGroup?.(ids, ordered.map((s) => s.row), Array.from(created.current));
    const holes = groupRef.current.slots.filter((s) => !s.shot).map((s) => s.n);
    setNote(
      `${ids.length} shot${ids.length > 1 ? 's' : ''} attached to this check-in in slot order${
        holes.length ? `, with ${holes.length > 1 ? `shots ${holes.join(', ')}` : `shot ${holes[0]}`} still empty` : ''
      }. Storing the check-in writes one row.`
    );
    void sweep(ids);
  };

  const discard = async () => {
    const current = groupRef.current;
    const ids = orderedShots(current).map((s) => s.id);
    for (const id of ids) retired.current.add(id);
    committed.current = new Set();
    const fresh = createGroup(current.target);
    setGroup(fresh);
    setActive(1);
    setAskDiscard(false);
    setShowLineup(false);
    onGroup?.([], [], Array.from(created.current));
    const dropped = await sweep([]);
    const staying = ids.length - dropped;
    setNote(
      dropped
        ? `${dropped} shot${dropped === 1 ? '' : 's'} deleted, image data included, and taken off this check-in.${
            staying ? ` The other ${staying} frame${staying === 1 ? '' : 's'} stay in your library — the saved check-in references them.` : ''
          }`
        : 'The set was cleared. Those frames stay in your library because the saved check-in references them — delete them from the photo library if you want them gone.'
    );
    toast('Sequence discarded.', 'info');
  };

  return (
    <div className="sg" data-testid="shot-grid">
      <div className="sg__head">
        <div className="sg__headings">
          <span className="gl-eyebrow">Same-framing set</span>
          <p className="gl-small gl-muted">
            Set the framing up once, then shoot every slot against the first frame. A set is comparable with itself by
            construction; two shots from different sets still are not.
          </p>
        </div>
        <Chip tone={summary.complete ? 'strong' : 'info'}>
          {summary.captured} of {summary.target} captured
        </Chip>
      </div>

      {!allowed ? (
        <div className="sg__refused">
          <CaptureRefused />
          <p className="gl-small gl-faint">{opened.note}</p>
        </div>
      ) : (
        <>
          <input ref={inputRef} type="file" accept="image/*" hidden onChange={(e) => receive(e.target.files)} />

          <div data-testid="shot-target" className="sg__target">
            <Field
              label="Shots in this set"
              hint={`3 to 6. Lowering the number never drops a frame you already shot — it only takes off empty slots.`}
            >
              <Select
                value={String(group.target)}
                onChange={(v) => onTarget(v)}
                options={SHOT_TARGETS.map((t) => ({ value: String(t), label: `${t} shots` }))}
              />
            </Field>
          </div>

          <ol className="sg__slots">
            {group.slots.map((s) => (
              <li
                key={s.n}
                className="sg__slot"
                data-testid={`shot-slot-${s.n}`}
                data-filled={Boolean(s.shot)}
                data-active={s.n === (slot?.n ?? 1)}
              >
                <div className="sg__slot-top">
                  <span className="gl-tech">Shot {s.n}</span>
                  {anchor?.n === s.n ? <Chip tone="gold">reference</Chip> : null}
                  {s.shot ? null : <Chip tone="limited">not captured</Chip>}
                </div>
                <ShotThumb row={s.shot} />
                <div className="sg__slot-label">{s.label}</div>
                <div className="sg__slot-acts">
                  <button
                    type="button"
                    className="gl-btn gl-btn--link gl-btn--sm"
                    onClick={() => {
                      setActive(s.n);
                      setNote('');
                    }}
                  >
                    {s.shot ? `Work on shot ${s.n}` : `Capture shot ${s.n}`}
                  </button>
                  {s.shot ? (
                    <button
                      type="button"
                      className="gl-btn gl-btn--ghost gl-btn--sm"
                      data-testid="shot-retake"
                      disabled={busy}
                      title={`Replaces shot ${s.n} only; the other slots keep their frames`}
                      onClick={() => chooseFor(s.n)}
                    >
                      <RotateCcw size={13} /> Retake
                    </button>
                  ) : null}
                  {s.shot ? (
                    <button
                      type="button"
                      className="gl-btn gl-btn--link gl-btn--sm"
                      onClick={() => void detach(s.n)}
                      disabled={busy}
                    >
                      Clear
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>

          <div className="sg__panel" data-testid="shot-conditions">
            <div className="sg__panel-head">
              <span className="gl-eyebrow">Shot {slot?.n} · {slot?.label}</span>
              <Chip tone="info">This slot’s conditions are recorded with its frame</Chip>
            </div>

            <div className="gl-form-row">
              <Field label="This slot shows" hint="The framing this slot is for. Front, side, back, detail or free.">
                <Select
                  value={slot?.kind ?? 'front'}
                  onChange={(v) => setGroup(setSlotKind(groupRef.current, slot.n, v as ShotKind))}
                  options={SHOT_KINDS.map((k) => ({ value: k.value, label: `${k.label} — ${k.hint}` }))}
                />
              </Field>
              <Field label="Slot label" hint="Editable. Rename it to what you actually shot — “Left profile, chin down”.">
                <TextInput value={slot?.label ?? ''} onChange={(v) => setGroup(setSlotLabel(groupRef.current, slot.n, v))} />
              </Field>
            </div>

            {slot?.shot ? (
              <>
                <div className="sg__recorded">
                  <span className="gl-label">Recorded with this frame</span>
                  <div className="gl-row gl-row--tight" style={{ flexWrap: 'wrap' }}>
                    <Chip>{slotFields(slot).conditions}</Chip>
                    <Chip>{slotFields(slot).lighting}</Chip>
                    <Chip>{slotFields(slot).distance}</Chip>
                  </div>
                </div>
                <p className="gl-small gl-faint">
                  These three are what the set is compared on, and they are already written on the stored row. Retake the
                  slot to record different ones.
                </p>
              </>
            ) : (
              <div className="gl-form-row">
                <Field label="Condition set">
                  <Select
                    value={fields.conditions}
                    onChange={(v) => setField('conditions', v)}
                    options={CAPTURE_CONDITIONS.map((c) => ({ value: c, label: c }))}
                  />
                </Field>
                <Field label="Lighting">
                  <Select
                    value={fields.lighting}
                    onChange={(v) => setField('lighting', v)}
                    options={LIGHTING.map((c) => ({ value: c, label: c }))}
                  />
                </Field>
                <Field label="Camera distance">
                  <Select
                    value={fields.distance}
                    onChange={(v) => setField('distance', v)}
                    options={DISTANCES.map((c) => ({ value: c, label: c }))}
                  />
                </Field>
              </div>
            )}

            <div className="sg__panel-acts">
              <button
                type="button"
                className="gl-btn gl-btn--primary"
                data-testid="shot-capture"
                disabled={busy}
                onClick={() => chooseFor(slot?.n ?? 1)}
              >
                <Tag size={14} /> {busy ? 'Storing…' : slot?.shot ? `Retake shot ${slot.n}` : `Capture shot ${slot?.n ?? 1}`}
              </button>
              <Button variant="ghost" icon={<Crosshair size={14} />} onClick={() => setShowLineup((v) => !v)}>
                {showLineup ? 'Hide the reference panel' : anchor ? `Line up against shot ${anchor.n}` : 'Line up first'}
              </Button>
              <span className="gl-small gl-faint">
                {anchor
                  ? `Shots after the first are framed against shot ${anchor.n} (${anchor.label}) — the first frame you took in this set.`
                  : 'Nothing is shot in this set yet, so there is nothing to line up against. This first capture becomes the reference.'}
              </span>
            </div>

            {showLineup ? (
              <div className="sg__lineup">
                <GhostGuide
                  mode="lineup"
                  reference={guideRow ? { row: guideRow, src: guideSrc } : null}
                  onShot={(files) => void captureInto(slot?.n ?? 1, files)}
                />
              </div>
            ) : null}

            {note ? <div className="gl-note">{note}</div> : null}
          </div>

          <div className="sg__summary" data-testid="shot-summary">
            <p className="gl-small sg__summary-head">{summary.head}</p>
            <p className="gl-small gl-muted">{summary.text}</p>
            {summary.lines.some((l) => l.captured) ? (
              <ul className="sg__summary-list">
                {summary.lines
                  .filter((l) => l.captured)
                  .map((l) => (
                    <li key={l.n}>
                      <span className="gl-tech">
                        Shot {l.n} · {l.label}
                      </span>
                      {l.reference ? (
                        <Chip tone="gold">the reference frame</Chip>
                      ) : l.diffs.length ? (
                        <Chip tone="moderate">
                          {l.diffs.map((d) => `${d.label}: ${d.from} vs ${d.to}`).join(' · ')}
                        </Chip>
                      ) : l.rows.length ? (
                        <Chip tone="strong">recorded the same as the reference</Chip>
                      ) : (
                        <Chip tone="limited">no recorded fields to match</Chip>
                      )}
                    </li>
                  ))}
              </ul>
            ) : null}
            <p className="gl-note">{summary.limits}</p>
          </div>

          <div className="sg__foot">
            <div className="gl-row gl-row--tight" style={{ flexWrap: 'wrap' }}>
              <button
                type="button"
                className="gl-btn gl-btn--primary"
                data-testid="shot-save"
                disabled={!summary.savable || busy}
                onClick={commit}
              >
                Store these {summary.captured} shot{summary.captured === 1 ? '' : 's'} with the check-in
              </button>
              <button
                type="button"
                className="gl-btn gl-btn--ghost"
                data-testid="shot-discard"
                disabled={!summary.captured || busy}
                onClick={() => setAskDiscard(true)}
              >
                Discard the sequence
              </button>
              <span className="gl-tech gl-faint">progressEntries.mediaIds · slot order · one row per check-in</span>
            </div>
            {askDiscard ? (
              <div className="sg__confirm">
                <span className="gl-small">
                  This deletes the {summary.captured} frame{summary.captured === 1 ? '' : 's'} of this set from your
                  library, image data included, and takes them off this check-in. It cannot be undone, and there is no
                  server copy.
                </span>
                <div className="gl-row gl-row--tight">
                  <Button variant="danger" size="sm" onClick={() => void discard()}>
                    Yes, delete them
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setAskDiscard(false)}>
                    Keep them
                  </Button>
                </div>
              </div>
            ) : null}
            {summary.savable && !summary.complete ? (
              <p className="gl-small gl-faint">
                Saving now stores {summary.captured} of {summary.target} shots. The empty slots are left empty and named
                in the record — no placeholder frame is written.
              </p>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * `raw` is for an artifact the app composed — a fit sheet — not a photograph of
 * something in her life: the whole picture is shown, uncropped, and the theme's
 * image treatment is left off so the colours on it are the colours it was made
 * with.
 */
export function ImageTile({
  item,
  caption,
  onClick,
  raw
}: {
  item: AnyRow;
  caption?: ReactNode;
  onClick?: () => void;
  raw?: boolean;
}) {
  const src = useImageSrc(item, 'thumb');
  return (
    <button type="button" className="gl-tile" onClick={onClick} style={{ textAlign: 'left', cursor: onClick ? 'pointer' : 'default' }}>
      <div className="gl-tile__img" style={raw ? { aspectRatio: 'auto' } : undefined}>
        {src ? (
          <img
            src={src}
            alt=""
            loading="lazy"
            className={raw ? 'gl-img' : 'gl-img gl-img-treated'}
            style={raw ? { height: 'auto', objectFit: 'contain' } : undefined}
          />
        ) : (
          <div className="gl-missing-img" style={{ height: '100%' }}>Unavailable</div>
        )}
      </div>
      <div className="gl-tile__body">
        <div className="gl-serif" style={{ fontSize: '1rem' }}>{item.title || 'Untitled'}</div>
        {caption ? <div className="gl-small gl-muted">{caption}</div> : null}
      </div>
    </button>
  );
}
