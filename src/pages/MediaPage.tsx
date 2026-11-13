import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Archive,
  Check,
  Database,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  Layers,
  Link2,
  Palette,
  Plus,
  RotateCcw,
  Save,
  Search,
  SlidersHorizontal,
  Star,
  Target,
  Trash2,
  Undo2,
  X
} from 'lucide-react';
import {
  Button,
  Card,
  CardHead,
  Chip,
  Disclosure,
  EmptyState,
  Field,
  IconButton,
  Modal,
  Range,
  SafetyBanner,
  Section,
  SegmentedControl,
  Select,
  Sheet,
  Table,
  TagInput,
  TextArea,
  TextInput,
  Toggle,
  useToast
} from '../ui/primitives';
import { DeptIntro, EmptyPlate, KvList, StatStrip, Timeline } from '../ui/editorial';
import { CompareSlider, Lightbox, MasonryFeed, PhotoCanvas, PhotoPicker, Pin } from '../ui/media';
import { saveRow, useFlags, useRows } from '../hooks/live';
import { hardDelete, newId, restore, softDelete, formatDate, todayISO } from '../db/repo';
import { TABLES, type AnyRow, type MediaItemRow } from '../db/schema';
import { db } from '../db/db';
import { ingestImage, objectUrlFor, useImageSrc, type SimilarMedia } from '../media/store';
import { orientationLabel, type ExifSummary } from '../media/exif';
import { loadSettings, subscribeSettings, type AppSettings } from '../state/settings';
import { DEPARTMENTS } from '../nav/departments';
import '../styles/departments/media.css';

/* ------------------------------------------------------------------ vocabulary */

const KIND_OPTIONS: { value: MediaItemRow['kind']; label: string }[] = [
  { value: 'upload', label: 'Upload' },
  { value: 'library', label: 'Reference / library' },
  { value: 'progress', label: 'Progress' },
  { value: 'outfit', label: 'Outfit' },
  { value: 'board', label: 'Board cover' },
  { value: 'product', label: 'Product shot' },
  { value: 'cover', label: 'Cover' },
  { value: 'experiment', label: 'Experiment / simulation' },
  { value: 'baseline', label: 'Baseline' }
];

const SOURCE_OPTIONS: { value: MediaItemRow['sourceKind']; label: string }[] = [
  { value: 'user', label: 'Yours (uploaded or captured)' },
  { value: 'glow-lab-original', label: 'Glow Lab original artwork' },
  { value: 'manual-link', label: 'Linked by you (URL)' },
  { value: 'pexels', label: 'Pexels' },
  { value: 'unsplash', label: 'Unsplash' },
  { value: 'pixabay', label: 'Pixabay' },
  { value: 'pinterest', label: 'Pinterest' }
];

const CONDITIONS = ['Front · neutral', 'Left profile', 'Right profile', 'Three-quarter', 'Smiling', 'Relaxed', 'Event look', 'Progress check', 'Casual — not standardised'];
const LIGHTING = ['Window light', 'Ring light', 'Overhead indoor', 'Outdoor shade', 'Mixed/unknown'];
const DISTANCES = ['30cm phone', '60cm phone', '1m+', 'Unknown'];
const SORTS = [
  { value: 'captured', label: 'Capture date (newest)' },
  { value: 'added', label: 'Added to library (newest)' },
  { value: 'title', label: 'Title A–Z' },
  { value: 'size', label: 'Largest file first' },
  { value: 'album', label: 'Album A–Z' }
];

const PAGE = 24;

interface Annotation {
  id: string;
  x: number;
  y: number;
  label: string;
  note: string;
}

interface Draft {
  kind: string;
  album: string;
  title: string;
  caption: string;
  takenOn: string;
  conditions: string;
  pose: string;
  lighting: string;
  distance: string;
  sourceKind: string;
  sourceUrl: string;
  attribution: string;
  license: string;
  private: boolean;
  star: boolean;
  linkedDomain: string;
  linkedIds: string[];
  labels: string[];
  annotations: Annotation[];
  note: string;
}

const EMPTY_DRAFT: Draft = {
  kind: 'upload',
  album: 'Unfiled',
  title: '',
  caption: '',
  takenOn: '',
  conditions: '',
  pose: '',
  lighting: '',
  distance: '',
  sourceKind: 'user',
  sourceUrl: '',
  attribution: '',
  license: '',
  private: true,
  star: false,
  linkedDomain: '',
  linkedIds: [],
  labels: [],
  annotations: [],
  note: ''
};

function fmtBytes(n: number) {
  if (!n) return '0 B';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

const hexes = (row: AnyRow) =>
  [...(((row.tags as string[]) ?? []) as string[]), ...(((row.data as Record<string, unknown> | undefined)?.palette as string[]) ?? [])].filter(
    (t) => typeof t === 'string' && /^#[0-9a-fA-F]{6}$/.test(t)
  );

/** Distinct stored values, so every filter dropdown is populated by real data. */
function distinct(rows: AnyRow[], key: keyof MediaItemRow) {
  const set = new Set<string>();
  for (const r of rows) {
    const v = String((r as unknown as Record<string, unknown>)[key as string] ?? '');
    if (v.trim()) set.add(v);
  }
  return [...set].sort((a, b) => a.localeCompare(b));
}

function withExtra(values: string[], current: string, presets: string[]) {
  const out = [...new Set([...presets, ...values, ...(current ? [current] : [])])];
  return out.map((v) => ({ value: v, label: v }));
}

/**
 * The camera's own recorded values, lifted out of the photo file at ingest.
 * Absent fields stay out of the list entirely — an empty block honestly means
 * the file said nothing, which is what screenshots and edited exports do.
 */
function fileFacts(row: AnyRow): { label: string; value: string }[] {
  const ex = ((row.data as Record<string, unknown> | undefined)?.exif ?? null) as ExifSummary | null;
  if (!ex) return [];
  const out: { label: string; value: string }[] = [];
  if (ex.device) out.push({ label: 'Camera', value: ex.device });
  if (ex.takenOn) out.push({ label: 'Shot on', value: formatDate(ex.takenOn) });
  const c = ex.camera;
  if (c?.exposure) out.push({ label: 'Shutter', value: c.exposure });
  if (c && c.iso !== null) out.push({ label: 'ISO', value: String(c.iso) });
  if (c && c.focalMm !== null) out.push({ label: 'Focal length', value: `${c.focalMm} mm` });
  if (c && c.flash !== null) out.push({ label: 'Flash', value: c.flash ? 'Fired' : 'Did not fire' });
  if (ex.orientation && ex.orientation !== 1) {
    out.push({ label: 'Straightened on import', value: orientationLabel(ex.orientation) ?? `orientation ${ex.orientation}` });
  }
  return out;
}

/* ------------------------------------------------------------------------ page */

export default function MediaPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const flags = useFlags();
  const media = useRows(TABLES.mediaItems);
  const allMedia = useRows(TABLES.mediaItems, { includeDeleted: true });
  const blobs = useRows(TABLES.mediaBlobs);
  const boards = useRows(TABLES.boards);
  const experiments = useRows(TABLES.experiments);
  const settings = useMediaSettings();

  const [tab, setTab] = useState<'library' | 'duplicates' | 'storage' | 'trash'>('library');
  const [view, setView] = useState<'grid' | 'masonry' | 'timeline'>('grid');
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [album, setAlbum] = useState('');
  const [source, setSource] = useState('');
  const [cond, setCond] = useState('');
  const [lighting, setLighting] = useState('');
  const [distance, setDistance] = useState('');
  const [pose, setPose] = useState('');
  const [privacy, setPrivacy] = useState('');
  const [onlyStarred, setOnlyStarred] = useState(false);
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [colour, setColour] = useState('');
  const [sort, setSort] = useState('captured');
  const [visible, setVisible] = useState(PAGE);

  const [bulk, setBulk] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [moveAlbum, setMoveAlbum] = useState('');
  const [linkOpen, setLinkOpen] = useState(false);
  const [link, setLink] = useState({ url: '', title: '', kind: 'library', album: 'Unfiled', license: '', attribution: '' });
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkLookalikes, setLinkLookalikes] = useState<SimilarMedia[]>([]);
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [ask, setAsk] = useState<{ title: string; body: string; run: () => void } | null>(null);

  const blobInfo = useMemo(() => {
    const map = new Map<string, { bytes: number; mime: string; thumbOnly: boolean }>();
    for (const b of blobs) {
      const thumbSize = ((b.thumb as Blob)?.size ?? 0) as number;
      map.set(String(b.id), {
        bytes: Number(b.bytes ?? 0),
        mime: String(b.mime ?? 'image/webp'),
        thumbOnly: Boolean(thumbSize) && Number(b.bytes ?? 0) === thumbSize
      });
    }
    return map;
  }, [blobs]);

  const bytesOf = useCallback((row: AnyRow) => (row.blobId ? blobInfo.get(String(row.blobId))?.bytes ?? 0 : 0), [blobInfo]);

  const missingCount = useMemo(
    () => media.filter((m) => m.blobId && !blobInfo.has(String(m.blobId))).length,
    [media, blobInfo]
  );

  const totals = useMemo(() => {
    const bytes = blobs.reduce((s, b) => s + Number(b.bytes ?? 0), 0);
    return { items: media.length, blobs: blobs.length, bytes, albums: new Set(media.map((m) => String(m.album || 'Unfiled'))).size };
  }, [media, blobs]);

  /* ------------------------------------------------------------ filter + sort */

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rows = media.filter((m) => {
      if (kind && String(m.kind) !== kind) return false;
      if (album && String(m.album || 'Unfiled') !== album) return false;
      if (source && String(m.sourceKind) !== source) return false;
      if (cond && String(m.conditions) !== cond) return false;
      if (lighting && String(m.lighting) !== lighting) return false;
      if (distance && String(m.distance) !== distance) return false;
      if (pose && String(m.pose) !== pose) return false;
      if (privacy === 'private' && !m.private) return false;
      if (privacy === 'open' && m.private) return false;
      if (onlyStarred && !m.star) return false;
      if (onlyMissing && !(m.blobId && !blobInfo.has(String(m.blobId)))) return false;
      if (colour) {
        const cols = hexes(m).map((c) => c.toLowerCase());
        if (!cols.includes(colour.toLowerCase())) return false;
      }
      if (needle) {
        const hay = `${m.title} ${m.caption} ${m.album} ${m.conditions} ${m.pose} ${m.lighting} ${m.distance} ${m.attribution} ${m.license} ${
          ((m.data as Record<string, unknown> | undefined)?.labels as string[]) ?? []
        }`.toLowerCase();
        if (!hay.includes(needle)) return false;
      }
      return true;
    });
    return rows.sort((a, b) => {
      if (sort === 'title') return String(a.title || '').localeCompare(String(b.title || ''));
      if (sort === 'album') return `${String(a.album)}${String(a.title)}`.localeCompare(`${String(b.album)}${String(b.title)}`);
      if (sort === 'size') return bytesOf(b) - bytesOf(a);
      if (sort === 'added') return Number(b.createdAt ?? 0) - Number(a.createdAt ?? 0);
      return `${String(a.takenOn ?? '')}`.localeCompare(`${String(b.takenOn ?? '')}`) * -1;
    });
  }, [media, q, kind, album, source, cond, lighting, distance, pose, privacy, onlyStarred, onlyMissing, colour, sort, blobInfo, bytesOf]);

  useEffect(() => setVisible(PAGE), [q, kind, album, source, cond, lighting, distance, pose, privacy, onlyStarred, onlyMissing, colour, sort, tab]);

  const shown = filtered.slice(0, visible);

  const grouped = useMemo(() => {
    const map = new Map<string, AnyRow[]>();
    for (const m of filtered) {
      const key = String(m.takenOn || '').slice(0, 7) || 'Undated';
      const list = map.get(key) ?? [];
      list.push(m);
      map.set(key, list);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [filtered]);

  const dupGroups = useMemo(() => {
    const map = new Map<string, AnyRow[]>();
    for (const m of media) {
      const h = String(m.hash || '');
      if (!h || h.startsWith('seed-')) continue;
      const list = map.get(h) ?? [];
      list.push(m);
      map.set(h, list);
    }
    return [...map.entries()].filter(([, list]) => list.length > 1);
  }, [media]);

  const trashed = useMemo(() => allMedia.filter((m) => m.deletedAt), [allMedia]);

  const drawerItem = useMemo(() => media.find((m) => String(m.id) === drawerId) ?? null, [media, drawerId]);

  /* -------------------------------------------------------------- row writers */

  const patchMedia = useCallback(
    async (id: string, changes: Record<string, unknown>, note?: string) => {
      await saveRow(TABLES.mediaItems, { id, ...changes });
      if (note) toast(note, 'ok');
    },
    [toast]
  );

  const toggleStar = useCallback(
    async (row: AnyRow) => {
      await patchMedia(String(row.id), { star: !row.star });
    },
    [patchMedia]
  );

  const togglePrivate = useCallback(
    async (row: AnyRow) => {
      await patchMedia(String(row.id), { private: !row.private });
    },
    [patchMedia]
  );

  const purgeBlobsFor = useCallback(async (ids: string[]) => {
    let purged = 0;
    let freed = 0;
    for (const id of ids) {
      const item = await db.mediaItems.get(id);
      if (!item?.blobId) continue;
      const blob = await db.mediaBlobs.get(item.blobId);
      if (!blob) continue;
      freed += Number(blob.bytes ?? 0);
      await db.mediaBlobs.delete(item.blobId);
      purged += 1;
    }
    return { purged, freed };
  }, []);

  const trashItem = useCallback(
    (row: AnyRow) => {
      setAsk({
        title: 'Move to trash?',
        body: `“${String(row.title || 'Untitled')}” leaves the library but stays restorable from the Trash tab. Nothing is deleted yet.`,
        run: async () => {
          await softDelete(TABLES.mediaItems, String(row.id));
          toast('Moved to trash — restore it any time from the Trash tab.');
          setDrawerId(null);
          setLightbox(null);
        }
      });
    },
    [toast]
  );

  const destroyItem = useCallback(
    (row: AnyRow) => {
      setAsk({
        title: 'Delete permanently, including the image data?',
        body: `This removes the row and its stored image bytes (${fmtBytes(bytesOf(row))}) from IndexedDB on this device. It cannot be undone and there is no server copy to recover from.`,
        run: async () => {
          await purgeBlobsFor([String(row.id)]);
          await hardDelete(TABLES.mediaItems, String(row.id));
          toast('Permanently deleted and the stored image was purged.', 'ok');
          setDrawerId(null);
        }
      });
    },
    [bytesOf, purgeBlobsFor, toast]
  );

  /* ----------------------------------------------------------------- bulk ops */

  const applyBulk = async (changes: Record<string, unknown>, label: string) => {
    if (!selected.length) {
      toast('Select some assets first.', 'info');
      return;
    }
    for (const id of selected) await saveRow(TABLES.mediaItems, { id, ...changes });
    toast(`${selected.length} asset(s): ${label}.`, 'ok');
  };

  const bulkTrash = () => {
    if (!selected.length) return;
    setAsk({
      title: `Move ${selected.length} asset(s) to trash?`,
      body: 'They stay restorable in the Trash tab. Image bytes are not touched until you delete for good.',
      run: async () => {
        for (const id of selected) await softDelete(TABLES.mediaItems, id);
        toast(`${selected.length} moved to trash.`, 'ok');
        setSelected([]);
      }
    });
  };

  const bulkReclaim = () => {
    if (!selected.length) return;
    setAsk({
      title: `Reclaim full resolution for ${selected.length} asset(s)?`,
      body: 'The full-size image is replaced by the small preview already stored for it, so the picture stays viewable everywhere but loses detail when zoomed or downloaded. Only assets you selected here are touched.',
      run: async () => {
        let freed = 0;
        let done = 0;
        for (const id of selected) {
          const item = await db.mediaItems.get(id);
          if (!item?.blobId) continue;
          const blob = await db.mediaBlobs.get(item.blobId);
          if (!blob || Number(blob.bytes ?? 0) === blob.thumb.size) continue;
          freed += Number(blob.bytes ?? 0) - blob.thumb.size;
          await db.mediaBlobs.put({ ...blob, blob: blob.thumb, bytes: blob.thumb.size, mime: blob.thumb.type || 'image/webp' });
          await saveRow(TABLES.mediaItems, { id, data: { ...((item.data as Record<string, unknown>) ?? {}), fullResReclaimedOn: todayISO() } });
          done += 1;
        }
        toast(done ? `Reclaimed ${fmtBytes(freed)} across ${done} asset(s).` : 'Nothing to reclaim — those assets already store only the preview.', done ? 'ok' : 'info');
        setSelected([]);
      }
    });
  };

  const emptyTrash = () => {
    if (!trashed.length) return;
    setAsk({
      title: 'Empty the trash?',
      body: `${trashed.length} row(s) and their stored image bytes go permanently. There is no undo and no server copy.`,
      run: async () => {
        const ids = trashed.map((t) => String(t.id));
        const { purged, freed } = await purgeBlobsFor(ids);
        for (const id of ids) await hardDelete(TABLES.mediaItems, id);
        toast(`Emptied ${ids.length} row(s), purged ${purged} stored image(s) (${fmtBytes(freed)}).`, 'ok');
      }
    });
  };

  /* ------------------------------------------------------------------ URL link */

  const linkIngest = async () => {
    if (!/^https?:\/\//i.test(link.url.trim())) {
      toast('Paste a full https:// image address.', 'bad');
      return;
    }
    setLinkBusy(true);
    try {
      const res = await ingestImage({
        remoteUrl: link.url.trim(),
        kind: link.kind as MediaItemRow['kind'],
        album: link.album || 'Unfiled',
        title: link.title || link.url.trim().split('/').pop() || 'Linked image',
        sourceKind: 'manual-link',
        sourceUrl: link.url.trim(),
        license: link.license || 'Unlicensed — verify before reuse',
        attribution: link.attribution,
        private: settings.privateMediaByDefault
      });
      toast(res.duplicate ? 'That exact image was already in your library — matched by content hash.' : 'Linked image fetched and stored locally.', res.duplicate ? 'info' : 'ok');
      setLinkLookalikes(res.similar ?? []);
      setLinkOpen(false);
      setLink({ url: '', title: '', kind: 'library', album: 'Unfiled', license: '', attribution: '' });
    } catch (err: any) {
      toast(err?.message ? `Fetch failed: ${err.message}` : 'Fetch failed for an unknown reason.', 'bad');
    } finally {
      setLinkBusy(false);
    }
  };

  const download = async (row: AnyRow) => {
    if (!row.blobId) {
      const remote = String(row.remoteUrl || '');
      if (!remote) {
        toast('No stored bytes for this entry — it only points at a record with no image.', 'info');
        return;
      }
      toast('This entry is a bundled or remote file, so there is nothing stored locally to download. Opening the reference instead.');
      window.open(remote, '_blank', 'noopener');
      return;
    }
    try {
      const info = blobInfo.get(String(row.blobId));
      const url = await objectUrlFor(String(row.blobId), 'full');
      const a = document.createElement('a');
      a.href = url;
      const ext = (String(info?.mime ?? 'image/webp').split('/')[1] || 'webp').replace(/[^a-z0-9]/gi, '');
      a.download = `${String(row.title || 'glow-lab-image').replace(/[^\w-]+/g, '-').slice(0, 48)}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      toast(info?.thumbOnly ? 'Downloaded the preview copy — you reclaimed the full resolution earlier.' : 'Downloaded the stored image.', 'ok');
    } catch {
      toast('The stored image bytes are missing on this device, so there is nothing to download.', 'bad');
    }
  };

  /* -------------------------------------------------------------------- render */

  const albumValues = distinct(media, 'album');
  const condValues = distinct(media, 'conditions');
  const lightValues = distinct(media, 'lighting');
  const distValues = distinct(media, 'distance');
  const poseValues = distinct(media, 'pose');

  return (
    <div className="gl-page">
      <DeptIntro
        id="media"
        actions={
          <>
            <PhotoPicker
              label="Add photographs"
              kind="upload"
              album={album || 'Unfiled'}
              withConditions
              onPick={(rows) => {
                setSelected(rows.map((r) => String(r.id)));
                setBulk(true);
              }}
            />
            <Button variant="ghost" icon={<Link2 size={14} />} onClick={() => setLinkOpen(true)}>
              Link by URL
            </Button>
          </>
        }
        meta={[
          { label: 'Assets', value: totals.items },
          { label: 'Stored images', value: totals.blobs },
          { label: 'On this device', value: fmtBytes(totals.bytes) },
          { label: 'Albums', value: totals.albums }
        ]}
      />

      <SafetyBanner tone="note" title="Everything here stays on this device">
        Glow Lab has no server and uploads nothing. Original artwork bundled with the app and images you linked by URL are stored as
        references, and each tile tells you whether its bytes are actually on this device. If an image cannot be read, the tile says so
        instead of showing a made-up picture.
      </SafetyBanner>

      {linkLookalikes.length ? (
        <div className="gl-row gl-row--tight" style={{ flexWrap: 'wrap', alignItems: 'center', gap: 6, marginTop: 'var(--glow-sp-4)' }}>
          <span className="gl-small gl-muted">The image you just linked looks like shots you already hold:</span>
          {linkLookalikes.map((s) => (
            <Chip key={s.id} title={`The picture fingerprint differs in ${s.distance} of 64 bits — a near match, not a certainty.`}>
              {s.title}
              {s.takenOn ? ` · ${formatDate(s.takenOn)}` : ''}
            </Chip>
          ))}
          <Button size="sm" variant="ghost" onClick={() => setLinkLookalikes([])}>
            Dismiss
          </Button>
        </div>
      ) : null}

      <div style={{ marginTop: 'var(--glow-sp-5)' }}>
        <SegmentedControl
          value={tab}
          onChange={(v) => setTab(v as typeof tab)}
          options={[
            { value: 'library', label: `Library · ${media.length}` },
            { value: 'duplicates', label: `Duplicates · ${dupGroups.length}` },
            { value: 'storage', label: 'Storage' },
            { value: 'trash', label: `Trash · ${trashed.length}` }
          ]}
        />
      </div>

      {tab === 'library' ? (
        <>
          {/* ------------------------------------------------------------ toolbar */}
          <div className="gl-mediatool" style={{ marginTop: 'var(--glow-sp-5)' }}>
            <Field label="Search titles, notes, captions and labels">
              <div className="gl-row gl-row--tight">
                <Search size={15} />
                <TextInput value={q} onChange={setQ} placeholder="e.g. window light, baseline, silk" />
              </div>
            </Field>
            <div className="gl-row gl-row--tight" style={{ flexWrap: 'wrap' }}>
              <SegmentedControl
                size="sm"
                value={view}
                onChange={(v) => setView(v as typeof view)}
                options={[
                  { value: 'grid', label: 'Grid' },
                  { value: 'masonry', label: 'Masonry' },
                  { value: 'timeline', label: 'Timeline' }
                ]}
              />
              <Button variant={bulk ? 'gold' : 'ghost'} size="sm" icon={<Check size={14} />} onClick={() => setBulk((b) => !b)}>
                {bulk ? 'Selecting' : 'Select'}
              </Button>
              {colour ? (
                <Chip tone="gold" onClick={() => setColour('')} title="Clear the colour filter">
                  <Palette size={12} /> {colour} ✕
                </Chip>
              ) : null}
            </div>
            <Field label="Sort">
              <Select value={sort} onChange={setSort} options={SORTS} />
            </Field>

            <div className="gl-mediatool__filters">
              <Field label="Kind">
                <Select
                  value={kind}
                  onChange={setKind}
                  placeholder="Every kind"
                  options={KIND_OPTIONS.map((k) => ({ value: k.value, label: k.label }))}
                />
              </Field>
              <Field label="Album">
                <Select value={album} onChange={setAlbum} placeholder="Every album" options={albumValues.map((v) => ({ value: v, label: v }))} />
              </Field>
              <Field label="Source">
                <Select
                  value={source}
                  onChange={setSource}
                  placeholder="Every source"
                  options={SOURCE_OPTIONS.map((s) => ({ value: s.value, label: s.label }))}
                />
              </Field>
              <Field label="Condition set">
                <Select value={cond} onChange={setCond} placeholder="Any condition" options={withExtra(condValues, cond, CONDITIONS)} />
              </Field>
              <Field label="Lighting">
                <Select value={lighting} onChange={setLighting} placeholder="Any lighting" options={withExtra(lightValues, lighting, LIGHTING)} />
              </Field>
              <Field label="Camera distance">
                <Select value={distance} onChange={setDistance} placeholder="Any distance" options={withExtra(distValues, distance, DISTANCES)} />
              </Field>
              <Field label="Pose note">
                <Select value={pose} onChange={setPose} placeholder="Any pose note" options={withExtra(poseValues, pose, [])} />
              </Field>
              <Field label="Privacy">
                <Select
                  value={privacy}
                  onChange={setPrivacy}
                  placeholder="Private and shared"
                  options={[
                    { value: 'private', label: 'Marked private' },
                    { value: 'open', label: 'Not marked private' }
                  ]}
                />
              </Field>
              <div className="gl-row gl-row--tight" style={{ flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                <Toggle checked={onlyStarred} onChange={setOnlyStarred} label="Starred only" />
                <Toggle checked={onlyMissing} onChange={setOnlyMissing} label={`Unreadable on device${missingCount ? ` · ${missingCount}` : ''}`} />
              </div>
            </div>

            <div className="gl-row gl-row--between" style={{ flexWrap: 'wrap', gap: 8 }}>
              <div className="gl-small gl-muted">
                {filtered.length} of {media.length} asset(s) match. Click a colour chip below any tile to filter the whole library to that
                tone — the chips are the palette sampled from the file when it was stored, not a guess.
              </div>
              {filtered.length !== media.length ? (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<RotateCcw size={14} />}
                  onClick={() => {
                    setQ('');
                    setKind('');
                    setAlbum('');
                    setSource('');
                    setCond('');
                    setLighting('');
                    setDistance('');
                    setPose('');
                    setPrivacy('');
                    setColour('');
                    setOnlyStarred(false);
                    setOnlyMissing(false);
                  }}
                >
                  Clear filters
                </Button>
              ) : null}
            </div>
          </div>

          {/* -------------------------------------------------------- bulk bar */}
          {bulk ? (
            <Card style={{ marginTop: 'var(--glow-sp-4)' }} accent={selected.length > 0}>
              <div className="gl-row gl-row--between" style={{ flexWrap: 'wrap', gap: 'var(--glow-sp-3)' }}>
                <div className="gl-tech">
                  {selected.length} selected ·{' '}
                  <button
                    type="button"
                    className="gl-btn gl-btn--link gl-btn--sm"
                    onClick={() => setSelected(filtered.map((m) => String(m.id)))}
                  >
                    select all {filtered.length} shown
                  </button>
                  <button type="button" className="gl-btn gl-btn--link gl-btn--sm" onClick={() => setSelected([])}>
                    clear
                  </button>
                </div>
                <div className="gl-row gl-row--tight" style={{ flexWrap: 'wrap' }}>
                  <Button size="sm" variant="ghost" icon={<EyeOff size={14} />} onClick={() => applyBulk({ private: true }, 'marked private')}>
                    Private
                  </Button>
                  <Button size="sm" variant="ghost" icon={<Eye size={14} />} onClick={() => applyBulk({ private: false }, 'unmarked private')}>
                    Not private
                  </Button>
                  <Button size="sm" variant="ghost" icon={<Star size={14} />} onClick={() => applyBulk({ star: true }, 'starred')}>
                    Star
                  </Button>
                  <Button size="sm" variant="ghost" icon={<Database size={14} />} onClick={bulkReclaim}>
                    Reclaim resolution
                  </Button>
                  <Button size="sm" variant="danger" icon={<Trash2 size={14} />} onClick={bulkTrash}>
                    To trash
                  </Button>
                </div>
                <div className="gl-row gl-row--tight" style={{ width: '100%' }}>
                  <Select
                    value={moveAlbum}
                    onChange={setMoveAlbum}
                    placeholder="Choose or type an album in the box beside"
                    options={albumValues.map((v) => ({ value: v, label: v }))}
                  />
                  <TextInput value={moveAlbum} onChange={setMoveAlbum} placeholder="Album name" />
                  <Button size="sm" variant="primary" icon={<Archive size={14} />} onClick={() => applyBulk({ album: moveAlbum.trim() || 'Unfiled' }, `moved to “${moveAlbum.trim() || 'Unfiled'}”`)}>
                    Move selection
                  </Button>
                </div>
              </div>
              <div className="gl-small gl-faint" style={{ marginTop: 8 }}>
                Marking an asset private is a flag you and the app's screens can filter on — boards, the Lightbox and comparison views still
                render on this device. No export path here sends anything anywhere, because there is nowhere to send it.
              </div>
            </Card>
          ) : null}

          {/* ------------------------------------------------------------ assets */}
          <div style={{ marginTop: 'var(--glow-sp-5)' }}>
            {!media.length ? (
              <EmptyPlate
                kicker="Nothing stored yet"
                title="Your photo studio is empty"
                body="Add photographs and every one of them gets stored on this device with its own conditions, palette and links. Bundled Glow Lab artwork appears here too, labelled as original reference rather than your own imagery."
                action={
                  <PhotoPicker label="Add your first photographs" kind="upload" album="Unfiled" withConditions onPick={() => toast('Stored. Open a tile to add conditions and notes.', 'ok')} />
                }
              />
            ) : !filtered.length ? (
              <EmptyState
                icon={<SlidersHorizontal size={20} />}
                title="No asset matches those filters"
                body="The library is unchanged — only the view is filtered. Clear a filter or two, or search a word you know appears in a caption."
              />
            ) : view === 'grid' ? (
              <>
                <div className="gl-assetgrid">
                  {shown.map((m) => (
                    <AssetTile
                      key={String(m.id)}
                      row={m}
                      bytes={bytesOf(m)}
                      missing={Boolean(m.blobId) && !blobInfo.has(String(m.blobId))}
                      thumbOnly={Boolean(m.blobId) && blobInfo.get(String(m.blobId))?.thumbOnly}
                      dupes={dupGroups.find(([, list]) => list.some((x) => String(x.id) === String(m.id)))?.[1].length ?? 1}
                      picked={selected.includes(String(m.id))}
                      open={drawerId === String(m.id)}
                      bulk={bulk}
                      onPick={() => setSelected((s) => (s.includes(String(m.id)) ? s.filter((x) => x !== String(m.id)) : [...s, String(m.id)]))}
                      onOpen={() => setDrawerId(String(m.id))}
                      onColour={setColour}
                    />
                  ))}
                </div>
                {filtered.length > shown.length ? (
                  <div className="gl-row" style={{ justifyContent: 'center', marginTop: 'var(--glow-sp-5)' }}>
                    <Button variant="ghost" icon={<Plus size={14} />} onClick={() => setVisible((v) => v + PAGE)}>
                      Show {Math.min(PAGE, filtered.length - shown.length)} more · {filtered.length - shown.length} left
                    </Button>
                  </div>
                ) : (
                  <div className="gl-note" style={{ marginTop: 'var(--glow-sp-5)' }}>
                    End of the filtered set: {filtered.length} asset(s). Nothing is padded or repeated to fill the grid.
                  </div>
                )}
              </>
            ) : view === 'masonry' ? (
              <MasonryFeed
                items={shown}
                hasMore={filtered.length > shown.length}
                onLoadMore={() => setVisible((v) => v + PAGE)}
                render={(m, i) => (
                  <Pin
                    item={m}
                    title={String(m.title || 'Untitled')}
                    sub={`${String(m.album || 'Unfiled')} · ${formatDate(String(m.takenOn || ''))}`}
                    badge={<FlagRow row={m} missing={Boolean(m.blobId) && !blobInfo.has(String(m.blobId))} dupes={dupGroups.find(([, l]) => l.some((x) => String(x.id) === String(m.id)))?.[1].length ?? 1} />}
                    onOpen={() => setLightbox(i)}
                    actions={[
                      { key: 'star', label: m.star ? 'Unstar' : 'Star', icon: <Star size={14} />, on: Boolean(m.star), onClick: () => void toggleStar(m) },
                      { key: 'open', label: 'Open details', icon: <Layers size={14} />, onClick: () => setDrawerId(String(m.id)) }
                    ]}
                  />
                )}
              />
            ) : (
              <div className="gl-stack" style={{ gap: 'var(--glow-sp-5)' }}>
                {grouped.map(([month, rows]) => (
                  <div key={month}>
                    <div className="gl-eyebrow" style={{ marginBottom: 'var(--glow-sp-3)' }}>
                      {month === 'Undated' ? 'No capture date' : new Date(`${month}-01T00:00:00`).toLocaleString(undefined, { month: 'long', year: 'numeric' })}
                      <span style={{ marginLeft: 8, color: 'var(--glow-text-faint)' }}>· {rows.length} asset(s)</span>
                    </div>
                    <Timeline
                      items={rows.slice(0, 12).map((r) => ({
                        when: formatDate(String(r.takenOn || '')),
                        title: String(r.title || 'Untitled'),
                        body: (
                          <div className="gl-row gl-row--tight" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
                            <Thumb row={r} />
                            <span className="gl-small gl-muted">{String(r.album || 'Unfiled')} · {String(r.kind)}</span>
                            <Button size="sm" variant="ghost" onClick={() => setDrawerId(String(r.id))}>
                              Open
                            </Button>
                          </div>
                        )
                      }))}
                    />
                    {rows.length > 12 ? <div className="gl-small gl-faint" style={{ marginTop: 6 }}>+{rows.length - 12} more in {month} — use the grid view to browse all of them.</div> : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      ) : null}

      {/* ------------------------------------------------------------ duplicates */}
      {tab === 'duplicates' ? (
        <Section
          eyebrow="Content hashes"
          title="Exact duplicates"
          description="Grouped by the SHA-256 of the stored bytes — the same value whether or not the browser offers SubtleCrypto — so these are pixel-identical files rather than similar-looking photos. Nothing is auto-deleted: choose which copy to keep."
        >
          {!dupGroups.length ? (
            <EmptyPlate
              kicker="Clean"
              title="No exact duplicates"
              body="Every stored image has its own content hash. Similar-but-not-identical shots (same outfit, different day) are not flagged here — compare those in the Lightbox or the comparison view inside an asset."
            />
          ) : (
            <div className="gl-stack">
              {dupGroups.map(([hash, rows]) => (
                <div className="gl-dupgroup" key={hash}>
                  <div className="gl-row gl-row--between" style={{ flexWrap: 'wrap', gap: 8 }}>
                    <div className="gl-tech">
                      {rows.length} identical copies · {fmtBytes(rows.reduce((s, r) => s + bytesOf(r), 0))} stored · {hash.slice(0, 16)}…
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<Database size={14} />}
                      onClick={() => {
                        const keep = rows.slice().sort((a, b) => Number(a.createdAt ?? 0) - Number(b.createdAt ?? 0))[0];
                        setAsk({
                          title: `Keep the oldest copy and trash ${rows.length - 1}?`,
                          body: 'Extras move to the Trash tab where you can restore them, then delete their bytes for good once you are sure.',
                          run: async () => {
                            for (const r of rows) if (String(r.id) !== String(keep.id)) await softDelete(TABLES.mediaItems, String(r.id));
                            toast(`${rows.length - 1} duplicate(s) moved to trash; “${String(keep.title || 'the oldest copy')}” kept.`, 'ok');
                          }
                        });
                      }}
                    >
                      Keep oldest, trash rest
                    </Button>
                  </div>
                  <div className="gl-assetgrid">
                    {rows.map((r) => (
                      <AssetTile
                        key={String(r.id)}
                        row={r}
                        bytes={bytesOf(r)}
                        missing={Boolean(r.blobId) && !blobInfo.has(String(r.blobId))}
                        thumbOnly={Boolean(r.blobId) && blobInfo.get(String(r.blobId))?.thumbOnly}
                        dupes={rows.length}
                        oldest={String(r.id) === String(rows.slice().sort((a, b) => Number(a.createdAt ?? 0) - Number(b.createdAt ?? 0))[0].id)}
                        onOpen={() => setDrawerId(String(r.id))}
                        onColour={setColour}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>
      ) : null}

      {/* --------------------------------------------------------------- storage */}
      {tab === 'storage' ? (
        <>
          <StatStrip
            items={[
              { label: 'Asset rows', value: totals.items, hint: 'metadata records' },
              { label: 'Stored images', value: totals.blobs, hint: 'binary copies on this device' },
              { label: 'Space used', value: fmtBytes(totals.bytes), hint: 'sum of stored bytes', tone: 'gold' },
              { label: 'Unreadable', value: missingCount, hint: 'rows whose bytes are gone', tone: missingCount ? 'rose' : undefined }
            ]}
          />
          <Card style={{ marginTop: 'var(--glow-sp-5)' }}>
            <CardHead
              title="Where the bytes are"
              eyebrow="By album"
              sub="Albums are plain labels you can rename from any asset, so this is a grouping of your own making, not a fixed folder tree."
            />
            <Table
              columns={[
                { label: 'Album', render: (r: { album: string }) => r.album },
                { label: 'Assets', render: (r: { n: number }) => r.n },
                { label: 'Stored', render: (r: { images: number }) => r.images },
                { label: 'Bytes', render: (r: { bytes: number }) => fmtBytes(r.bytes) },
                {
                  label: 'Previews only',
                  render: (r: { previews: number }) => (r.previews ? <Chip tone="gold">{r.previews} reclaimed</Chip> : <span className="gl-faint">—</span>)
                }
              ]}
              rows={(() => {
                const map = new Map<string, { album: string; n: number; images: number; bytes: number; previews: number }>();
                for (const m of media) {
                  const key = String(m.album || 'Unfiled');
                  const cur = map.get(key) ?? { album: key, n: 0, images: 0, bytes: 0, previews: 0 };
                  cur.n += 1;
                  const info = m.blobId ? blobInfo.get(String(m.blobId)) : undefined;
                  if (info) {
                    cur.images += 1;
                    cur.bytes += info.bytes;
                    if (info.thumbOnly) cur.previews += 1;
                  }
                  map.set(key, cur);
                }
                return [...map.values()].sort((a, b) => b.bytes - a.bytes);
              })()}
              keyOf={(r: { album: string }) => r.album}
            />
          </Card>

          <Card style={{ marginTop: 'var(--glow-sp-4)' }}>
            <CardHead
              title="Reclaim space"
              eyebrow="You choose each file"
              sub="Tick the assets whose full-resolution copy you no longer need. Their stored full image is replaced by the small preview already kept for it, so nothing disappears from a board, a timeline or the Lightbox — it is simply lower detail. Nothing is selected for you."
            />
            <ReclaimList
              media={media}
              bytesOf={bytesOf}
              blobInfo={blobInfo}
              onReclaim={async (row) => {
                const blob = row.blobId ? await db.mediaBlobs.get(String(row.blobId)) : undefined;
                if (!blob) {
                  toast('No stored bytes for this asset — there is nothing to reclaim.', 'info');
                  return;
                }
                if (Number(blob.bytes ?? 0) === blob.thumb.size) {
                  toast('This one already stores only its preview.', 'info');
                  return;
                }
                const freed = Number(blob.bytes ?? 0) - blob.thumb.size;
                await db.mediaBlobs.put({ ...blob, blob: blob.thumb, bytes: blob.thumb.size, mime: blob.thumb.type || 'image/webp' });
                await saveRow(TABLES.mediaItems, {
                  id: String(row.id),
                  data: { ...((row.data as Record<string, unknown>) ?? {}), fullResReclaimedOn: todayISO() }
                });
                toast(`Freed ${fmtBytes(freed)}. Full-size views pick the preview up after a reload.`, 'ok');
              }}
              onPurge={(row) => destroyItem(row)}
            />
            <SafetyBanner tone="note" title="Honest limits">
              IndexedDB releases reclaimed space lazily and browsers do not report a precise file-system figure, so the number above is the
              sum of the bytes this app stored — the device's own storage readout may differ. Reclaiming cannot be undone from this page:
              if you need the original again, re-add it from your own camera roll or file.
            </SafetyBanner>
          </Card>
        </>
      ) : null}

      {/* ----------------------------------------------------------------- trash */}
      {tab === 'trash' ? (
        <Section
          eyebrow="Restorable"
          title="Trash"
          description="Soft-deleted assets keep their image bytes until you delete them for good, so a mistake here is reversible."
          right={
            trashed.length ? (
              <Button variant="danger" size="sm" icon={<Trash2 size={14} />} onClick={emptyTrash}>
                Empty trash
              </Button>
            ) : null
          }
        >
          {!trashed.length ? (
            <EmptyPlate kicker="Empty" title="Nothing waiting to be restored" body="Deleted assets appear here with their restore button until their bytes are purged." />
          ) : (
            <div className="gl-assetgrid">
              {trashed.map((m) => (
                <div className="gl-asset" key={String(m.id)} data-open={false}>
                  <Thumb row={m} muted />
                  <div className="gl-asset__body">
                    <div className="gl-serif">{String(m.title || 'Untitled')}</div>
                    <div className="gl-small gl-faint">Deleted {formatDate(new Date(Number(m.deletedAt)).toISOString().slice(0, 10))}</div>
                    <div className="gl-row gl-row--tight" style={{ flexWrap: 'wrap' }}>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon={<Undo2 size={14} />}
                        onClick={async () => {
                          await restore(TABLES.mediaItems, String(m.id));
                          toast(`“${String(m.title || 'Untitled')}” is back in the library.`, 'ok');
                        }}
                      >
                        Restore
                      </Button>
                      <Button size="sm" variant="danger" icon={<X size={14} />} onClick={() => destroyItem(m)}>
                        Delete for good
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>
      ) : null}

      {/* -------------------------------------------------------------- lightbox */}
      <Lightbox
        items={filtered}
        index={lightbox}
        onIndex={setLightbox}
        onClose={() => setLightbox(null)}
        header={(item) => (
          <div style={{ minWidth: 0 }}>
            <div className="gl-serif" style={{ fontSize: '1.1rem' }}>{String(item.title || 'Untitled')}</div>
            <div className="gl-small gl-muted">
              {String(item.album || 'Unfiled')} · {String(item.kind)} · {formatDate(String(item.takenOn || ''))}
              {item.private ? ' · marked private' : ''}
            </div>
          </div>
        )}
        footer={(item) => (
          <div className="gl-row gl-row--between" style={{ flexWrap: 'wrap', gap: 8 }}>
            <div className="gl-row gl-row--tight" style={{ flexWrap: 'wrap' }}>
              <Button size="sm" variant={item.star ? 'gold' : 'ghost'} icon={<Star size={14} />} onClick={() => void toggleStar(item)}>
                {item.star ? 'Starred' : 'Star'}
              </Button>
              <Button size="sm" variant="ghost" icon={item.private ? <EyeOff size={14} /> : <Eye size={14} />} onClick={() => void togglePrivate(item)}>
                {item.private ? 'Private' : 'Not private'}
              </Button>
              <Button size="sm" variant="ghost" icon={<Layers size={14} />} onClick={() => setDrawerId(String(item.id))}>
                Details
              </Button>
              <Button size="sm" variant="ghost" icon={<Download size={14} />} onClick={() => void download(item)}>
                Download
              </Button>
            </div>
            <div className="gl-tech">{String(item.attribution || item.license || 'no licence noted')}</div>
          </div>
        )}
      />

      {/* ----------------------------------------------------------------- drawer */}
      {drawerItem ? (
        <MediaDrawer
          key={String(drawerItem.id)}
          row={drawerItem}
          bytes={bytesOf(drawerItem)}
          missing={Boolean(drawerItem.blobId) && !blobInfo.has(String(drawerItem.blobId))}
          thumbOnly={Boolean(drawerItem.blobId && blobInfo.get(String(drawerItem.blobId))?.thumbOnly)}
          allMedia={media}
          boards={boards}
          experiments={experiments}
          albumValues={albumValues}
          flags={flags}
          onClose={() => setDrawerId(null)}
          onSave={async (changes) => {
            await patchMedia(String(drawerItem.id), changes);
            toast('Metadata saved to this device.', 'ok');
          }}
          onStar={() => void toggleStar(drawerItem)}
          onPrivate={() => void togglePrivate(drawerItem)}
          onBaseline={async (experimentId) => {
            const changes: Record<string, unknown> = { kind: 'baseline', star: true };
            if (experimentId) {
              const exp = experiments.find((e) => String(e.id) === experimentId);
              if (exp) {
                await saveRow(TABLES.experiments, {
                  id: String(exp.id),
                  baselineMediaIds: [...new Set([...(((exp.baselineMediaIds as string[]) ?? []) as string[]), String(drawerItem.id)])]
                });
              }
            }
            await patchMedia(String(drawerItem.id), changes);
            toast(experimentId ? 'Marked as this experiment’s baseline.' : 'Marked as a baseline capture.', 'ok');
          }}
          onTrash={() => trashItem(drawerItem)}
          onDestroy={() => destroyItem(drawerItem)}
          onDownload={() => void download(drawerItem)}
          onAddToBoard={async (boardId) => {
            const b = boards.find((x) => String(x.id) === boardId);
            if (!b) return;
            await saveRow(TABLES.boards, {
              id: String(b.id),
              itemIds: [...new Set([...(((b.itemIds as string[]) ?? []) as string[]), String(drawerItem.id)])]
            });
            toast(`Added to “${String(b.name)}”. The board is membership-based, not a copy — this row stays single.`);
          }}
          onColour={setColour}
        />
      ) : null}

      {/* ------------------------------------------------------------- link modal */}
      <Modal
        open={linkOpen}
        onClose={() => setLinkOpen(false)}
        title="Link an image by URL"
        footer={
          <>
            <Button variant="ghost" onClick={() => setLinkOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={linkIngest} disabled={linkBusy} icon={<Link2 size={14} />}>
              {linkBusy ? 'Fetching…' : 'Fetch and store'}
            </Button>
          </>
        }
      >
        <div className="gl-drawermeta">
          <Field label="Image address" hint="The file is fetched by your browser and stored locally, then deduplicated by content hash.">
            <TextInput value={link.url} onChange={(v) => setLink({ ...link, url: v })} placeholder="https://…/photo.jpg" />
          </Field>
          <div className="gl-form-row">
            <Field label="Title">
              <TextInput value={link.title} onChange={(v) => setLink({ ...link, title: v })} />
            </Field>
            <Field label="Kind">
              <Select value={link.kind} onChange={(v) => setLink({ ...link, kind: v })} options={KIND_OPTIONS.map((k) => ({ value: k.value, label: k.label }))} />
            </Field>
            <Field label="Album">
              <TextInput value={link.album} onChange={(v) => setLink({ ...link, album: v })} />
            </Field>
            <Field label="Licence as stated by the page you got it from">
              <TextInput value={link.license} onChange={(v) => setLink({ ...link, license: v })} placeholder="e.g. CC0, site licence" />
            </Field>
            <Field label="Attribution">
              <TextInput value={link.attribution} onChange={(v) => setLink({ ...link, attribution: v })} />
            </Field>
          </div>
          <SafetyBanner tone="warn" title="This can genuinely fail">
            Many hosts refuse cross-origin image requests. If the fetch is blocked, the browser's own error is shown verbatim and nothing is
            substituted, guessed or left as a blank placeholder row.
          </SafetyBanner>
        </div>
      </Modal>

      {/* ----------------------------------------------------------- confirm modal */}
      <Modal
        open={Boolean(ask)}
        onClose={() => setAsk(null)}
        title={ask?.title ?? ''}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAsk(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                const run = ask?.run;
                setAsk(null);
                run?.();
              }}
            >
              Confirm
            </Button>
          </>
        }
      >
        <p className="gl-small">{ask?.body}</p>
      </Modal>
    </div>
  );
}

/* ------------------------------------------------------------------- subviews */

function FlagRow({ row, missing, dupes }: { row: AnyRow; missing?: boolean; dupes: number }) {
  const d = (row.data ?? {}) as Record<string, unknown>;
  return (
    <>
      {missing ? <span className="gl-flag gl-flag--bad">Bytes missing</span> : null}
      {row.private ? <span className="gl-flag">Private</span> : null}
      {String(row.sourceKind) === 'glow-lab-original' ? <span className="gl-flag gl-flag--gold">Glow Lab original</span> : null}
      {((row.tags as string[]) ?? []).includes('simulated') ? <span className="gl-flag gl-flag--gold">Simulated</span> : null}
      {d.fullResReclaimedOn ? <span className="gl-flag">Preview only</span> : null}
      {!missing && dupes > 1 ? <span className="gl-flag gl-flag--bad">{dupes} identical</span> : null}
    </>
  );
}

function Thumb({ row, muted }: { row: AnyRow; muted?: boolean }) {
  const src = useImageSrc(row, 'thumb');
  return (
    <div className="gl-asset__img" style={{ aspectRatio: '1 / 1', width: 92, opacity: muted ? 0.6 : 1 }}>
      {src ? <img src={src} alt="" loading="lazy" decoding="async" className="gl-img-treated" /> : <div className="gl-missing-img">Unavailable</div>}
    </div>
  );
}

function AssetTile({
  row,
  bytes,
  missing,
  thumbOnly,
  dupes,
  picked,
  open,
  oldest,
  bulk,
  onPick,
  onOpen,
  onColour
}: {
  row: AnyRow;
  bytes: number;
  missing?: boolean;
  thumbOnly?: boolean;
  dupes: number;
  picked?: boolean;
  open?: boolean;
  oldest?: boolean;
  bulk?: boolean;
  onPick?: () => void;
  onOpen: () => void;
  onColour: (hex: string) => void;
}) {
  const src = useImageSrc(row, 'thumb');
  const colours = useMemo(() => [...new Set(hexes(row))].slice(0, 6), [row]);
  const d = (row.data ?? {}) as Record<string, unknown>;
  const markers = Array.isArray(d.annotations) ? (d.annotations as Annotation[]).length : 0;
  return (
    <div className="gl-asset" data-pick={Boolean(picked)} data-open={Boolean(open)} role="group">
      <div className="gl-asset__img">
        {src ? (
          <img src={src} alt={String(row.title || 'Untitled')} loading="lazy" decoding="async" className="gl-img-treated" />
        ) : (
          <div className="gl-missing-img">{missing ? 'Stored image missing on this device' : 'No image stored'}</div>
        )}
        <div className="gl-asset__flags">
          <FlagRow row={row} missing={missing} dupes={dupes} />
        </div>
      </div>
      <div className="gl-asset__body">
        <div className="gl-serif" style={{ fontSize: '0.98rem' }}>
          {String(row.title || 'Untitled')}
          {oldest ? <span className="gl-flag gl-flag--gold" style={{ marginLeft: 6 }}>oldest</span> : null}
        </div>
        <div className="gl-tech" style={{ color: 'var(--glow-text-faint)' }}>
          {String(row.album || 'Unfiled')} · {formatDate(String(row.takenOn || ''))} · {fmtBytes(bytes)}
          {thumbOnly ? ' · preview only' : ''}
          {markers ? ` · ${markers} marker(s)` : ''}
        </div>
        <div className="gl-row gl-row--tight" style={{ flexWrap: 'wrap' }}>
          {bulk ? (
            <Button size="sm" variant={picked ? 'gold' : 'ghost'} icon={<Check size={13} />} onClick={onPick}>
              {picked ? 'Selected' : 'Select'}
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" icon={<Layers size={13} />} onClick={onOpen}>
            Details
          </Button>
          {row.star ? <Star size={14} style={{ color: 'var(--glow-champagne-400, #e2c49a)' }} /> : null}
        </div>
        {colours.length ? (
          <div className="gl-asset__swatches">
            {colours.map((c) => (
              <button
                key={c}
                type="button"
                title={`Filter the library to ${c}`}
                aria-label={`Filter to colour ${c}`}
                style={{ background: c }}
                onClick={() => onColour(c)}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ReclaimList({
  media,
  bytesOf,
  blobInfo,
  onReclaim,
  onPurge
}: {
  media: AnyRow[];
  bytesOf: (row: AnyRow) => number;
  blobInfo: Map<string, { bytes: number; mime: string; thumbOnly: boolean }>;
  onReclaim: (row: AnyRow) => void;
  onPurge: (row: AnyRow) => void;
}) {
  const [tick, setTick] = useState<string[]>([]);
  const rows = useMemo(
    () =>
      media
        .filter((m) => m.blobId && blobInfo.has(String(m.blobId)))
        .slice()
        .sort((a, b) => bytesOf(b) - bytesOf(a))
        .slice(0, 40),
    [media, blobInfo, bytesOf]
  );
  const pickedBytes = tick.reduce((s, id) => s + bytesOf(media.find((m) => String(m.id) === id) ?? ({} as AnyRow)), 0);
  if (!rows.length) {
    return <EmptyState title="No stored bytes yet" body="Nothing to reclaim: every entry in your library currently points at bundled artwork or a remote reference rather than a file stored on this device." />;
  }
  return (
    <div className="gl-stack">
      <div className="gl-row gl-row--between" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div className="gl-small gl-muted">Largest stored images first — {rows.length} shown of {media.filter((m) => m.blobId).length} with bytes.</div>
        <div className="gl-row gl-row--tight">
          <Chip tone="gold">{tick.length} ticked · {fmtBytes(pickedBytes)}</Chip>
          <Button
            size="sm"
            variant="primary"
            disabled={!tick.length}
            icon={<Database size={14} />}
            onClick={() => {
              const ids = [...tick];
              setTick([]);
              for (const id of ids) {
                const row = media.find((m) => String(m.id) === id);
                if (row) onReclaim(row);
              }
            }}
          >
            Reclaim ticked
          </Button>
        </div>
      </div>
      <div className="gl-list">
        {rows.map((m) => {
          const id = String(m.id);
          const info = blobInfo.get(String(m.blobId));
          return (
            <div className="gl-list__row" key={id}>
              <label className="gl-check">
                <input
                  type="checkbox"
                  checked={tick.includes(id)}
                  onChange={(e) => setTick((t) => (e.target.checked ? [...t, id] : t.filter((x) => x !== id)))}
                  aria-label={`Reclaim full resolution for ${String(m.title || 'Untitled')}`}
                />
                <span>
                  <strong>{String(m.title || 'Untitled')}</strong>
                  <span className="gl-small gl-muted" style={{ display: 'block' }}>
                    {String(m.album || 'Unfiled')} · {fmtBytes(info?.bytes ?? 0)} · {info?.mime}
                    {info?.thumbOnly ? ' · already preview only' : ''}
                  </span>
                </span>
              </label>
              <div className="gl-row gl-row--tight">
                {info?.thumbOnly ? (
                  <Chip>Reclaimed</Chip>
                ) : (
                  <Button size="sm" variant="ghost" icon={<Database size={13} />} onClick={() => onReclaim(m)}>
                    Reclaim
                  </Button>
                )}
                <IconButton label="Delete for good" tone="danger" onClick={() => onPurge(m)}>
                  <Trash2 size={14} />
                </IconButton>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- drawer */

function MediaDrawer({
  row,
  bytes,
  missing,
  thumbOnly,
  allMedia,
  boards,
  experiments,
  albumValues,
  flags,
  onClose,
  onSave,
  onStar,
  onPrivate,
  onBaseline,
  onTrash,
  onDestroy,
  onDownload,
  onAddToBoard,
  onColour
}: {
  row: AnyRow;
  bytes: number;
  missing: boolean;
  thumbOnly: boolean;
  allMedia: AnyRow[];
  boards: AnyRow[];
  experiments: AnyRow[];
  albumValues: string[];
  flags: string;
  onClose: () => void;
  onSave: (changes: Record<string, unknown>) => Promise<void> | void;
  onStar: () => void;
  onPrivate: () => void;
  onBaseline: (experimentId: string) => void;
  onTrash: () => void;
  onDestroy: () => void;
  onDownload: () => void;
  onAddToBoard: (boardId: string) => void;
  onColour: (hex: string) => void;
}) {
  const toast = useToast();
  const navigate = useNavigate();
  const src = useImageSrc(row, 'full');
  const d = (row.data ?? {}) as Record<string, unknown>;
  const facts = fileFacts(row);
  const fileNote = (() => {
    const w = Number(d.originalWidth) || 0;
    const h = Number(d.originalHeight) || 0;
    if (!w || !h) return '';
    if (w === Number(row.width) && h === Number(row.height)) return '';
    return `The file itself held ${w}×${h} px${d.uprighted ? ', turned upright as it was imported' : ''}; the working copy stored here is ${String(row.width)}×${String(row.height)} px.`;
  })();
  const [draft, setDraft] = useState<Draft>(() => ({
    kind: String(row.kind),
    album: String(row.album || ''),
    title: String(row.title || ''),
    caption: String(row.caption || ''),
    takenOn: String(row.takenOn || ''),
    conditions: String(row.conditions || ''),
    pose: String(row.pose || ''),
    lighting: String(row.lighting || ''),
    distance: String(row.distance || ''),
    sourceKind: String(row.sourceKind || 'user'),
    sourceUrl: String(row.sourceUrl || ''),
    attribution: String(row.attribution || ''),
    license: String(row.license || ''),
    private: Boolean(row.private),
    star: Boolean(row.star),
    linkedDomain: String(row.linkedDomain || ''),
    linkedIds: [...(((row.linkedIds as string[]) ?? []) as string[])],
    labels: [...(((d.labels as string[]) ?? []) as string[])],
    annotations: Array.isArray(d.annotations) ? (d.annotations as Annotation[]) : [],
    note: String(d.note ?? '')
  }));
  const [dirty, setDirty] = useState(false);
  const [compareId, setCompareId] = useState('');
  const [pinId, setPinId] = useState<string | null>(null);
  const [baselineExp, setBaselineExp] = useState('');
  const [boardId, setBoardId] = useState('');

  // The star and privacy buttons write the row straight away; keep the draft in
  // step so an explicit Save cannot roll back a flag the user just flipped.
  useEffect(() => {
    setDraft((s) =>
      s.private === Boolean(row.private) && s.star === Boolean(row.star)
        ? s
        : { ...s, private: Boolean(row.private), star: Boolean(row.star) }
    );
  }, [row.private, row.star]);

  const linkedDept = useMemo(() => DEPARTMENTS.find((x) => x.id === draft.linkedDomain), [draft.linkedDomain]);

  const compare = useMemo(() => allMedia.find((m) => String(m.id) === compareId) ?? null, [allMedia, compareId]);

  const mismatch = useMemo(() => {
    if (!compare) return [];
    const out: string[] = [];
    const pairs: [string, keyof MediaItemRow][] = [
      ['condition set', 'conditions'],
      ['lighting', 'lighting'],
      ['camera distance', 'distance'],
      ['pose note', 'pose']
    ];
    for (const [label, key] of pairs) {
      const a = String((row as unknown as Record<string, unknown>)[key] ?? '');
      const b = String((compare as unknown as Record<string, unknown>)[key] ?? '');
      if (a !== b) out.push(`${label}: “${a || 'unrecorded'}” vs “${b || 'unrecorded'}”`);
    }
    const ar = (Number(row.width) || 1) / (Number(row.height) || 1);
    const br = (Number(compare.width) || 1) / (Number(compare.height) || 1);
    if (Math.abs(ar - br) / br > 0.06) out.push('different crop ratio, so features sit at different heights in the slider');
    return out;
  }, [compare, row]);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((s) => ({ ...s, [key]: value }));
    setDirty(true);
  };

  const save = async () => {
    await onSave({
      kind: draft.kind as MediaItemRow['kind'],
      album: draft.album.trim() || 'Unfiled',
      title: draft.title,
      caption: draft.caption,
      takenOn: draft.takenOn,
      conditions: draft.conditions,
      pose: draft.pose,
      lighting: draft.lighting,
      distance: draft.distance,
      sourceKind: draft.sourceKind as MediaItemRow['sourceKind'],
      sourceUrl: draft.sourceUrl,
      attribution: draft.attribution,
      license: draft.license,
      private: draft.private,
      star: draft.star,
      linkedDomain: draft.linkedDomain,
      linkedIds: draft.linkedIds,
      data: {
        ...((row.data as Record<string, unknown>) ?? {}),
        labels: draft.labels,
        annotations: draft.annotations,
        note: draft.note
      }
    });
    setDirty(false);
  };

  const active = draft.annotations.find((a) => a.id === pinId) ?? null;

  return (
    <Sheet open onClose={onClose} title="Asset detail">
      <div className="gl-drawermeta">
        <div>
          <div className="gl-asset__img" style={{ aspectRatio: '4 / 5', maxHeight: '40vh' }}>
            {src ? <img src={src} alt={draft.title || 'Untitled'} className="gl-img-treated" /> : <div className="gl-missing-img">{missing ? 'The stored image bytes are gone from this device.' : 'No image stored for this record.'}</div>}
          </div>
          <div className="gl-row gl-row--tight" style={{ flexWrap: 'wrap', marginTop: 8 }}>
            <FlagRow row={row} missing={missing} dupes={allMedia.filter((m) => m.hash === row.hash && m.hash && !String(m.hash).startsWith('seed-')).length} />
            {thumbOnly ? <span className="gl-flag">Preview only</span> : null}
          </div>
          <div className="gl-tech" style={{ color: 'var(--glow-text-faint)', marginTop: 6 }}>
            {fmtBytes(bytes)} · {String(row.width)}×{String(row.height)} · id {String(row.id)}
            {d.fullResReclaimedOn ? ` · resolution reclaimed ${String(d.fullResReclaimedOn)}` : ''}
            {d.simulated ? ' · produced by the Try-On simulator, not a camera' : ''}
          </div>
        </div>

        <div className="gl-row gl-row--between" style={{ flexWrap: 'wrap', gap: 8 }}>
          <div className="gl-row gl-row--tight">
            <Button size="sm" variant={draft.star ? 'gold' : 'ghost'} icon={<Star size={13} />} onClick={onStar}>
              Star
            </Button>
            <Button size="sm" variant="ghost" icon={draft.private ? <EyeOff size={13} /> : <Eye size={13} />} onClick={onPrivate}>
              {draft.private ? 'Private' : 'Not private'}
            </Button>
            <Button size="sm" variant="ghost" icon={<Download size={13} />} onClick={onDownload}>
              Download
            </Button>
          </div>
          <div className="gl-row gl-row--tight">
            <Button size="sm" variant="ghost" icon={<Trash2 size={13} />} onClick={onTrash}>
              To trash
            </Button>
            <Button size="sm" variant="danger" icon={<X size={13} />} onClick={onDestroy}>
              Delete for good
            </Button>
          </div>
        </div>

        {/* -------------------------------------------------------- metadata */}
        <Section title="Metadata" eyebrow="Every field on the row" description="Changes are written to the mediaItems row on save — reload this page any time to confirm they stuck.">
          <div className="gl-form-row">
            <Field label="Title">
              <TextInput value={draft.title} onChange={(v) => set('title', v)} placeholder="What this is" />
            </Field>
            <Field label="Album">
              <TextInput value={draft.album} onChange={(v) => set('album', v)} placeholder="Unfiled" />
            </Field>
            <Field label="Kind">
              <Select value={draft.kind} onChange={(v) => set('kind', v)} options={KIND_OPTIONS.map((k) => ({ value: k.value, label: k.label }))} />
            </Field>
            <Field label="Capture date" hint="What the photograph claims, not when you added it.">
              <TextInput value={draft.takenOn} onChange={(v) => set('takenOn', v)} type="date" />
            </Field>
            <Field label="Condition set">
              <Select value={draft.conditions} onChange={(v) => set('conditions', v)} placeholder="Not recorded" options={withExtra(distinct(allMedia, 'conditions'), draft.conditions, CONDITIONS)} />
            </Field>
            <Field label="Lighting">
              <Select value={draft.lighting} onChange={(v) => set('lighting', v)} placeholder="Not recorded" options={withExtra(distinct(allMedia, 'lighting'), draft.lighting, LIGHTING)} />
            </Field>
            <Field label="Camera distance">
              <Select value={draft.distance} onChange={(v) => set('distance', v)} placeholder="Not recorded" options={withExtra(distinct(allMedia, 'distance'), draft.distance, DISTANCES)} />
            </Field>
            <Field label="Pose note">
              <TextInput value={draft.pose} onChange={(v) => set('pose', v)} placeholder="e.g. chin level, shoulders square" />
            </Field>
          </div>

          <div className="gl-inset">
            <div className="gl-label">From the file</div>
            {facts.length ? (
              <>
                <KvList items={facts.map((f) => ({ k: f.label, v: f.value }))} />
                <div className="gl-small gl-faint" style={{ marginTop: 6 }}>
                  These are the camera's own recorded numbers, read straight out of this photo file. Glow Lab does not
                  measure anything in the picture and does not fill gaps: a field missing above was missing in the file.
                </div>
              </>
            ) : (
              <div className="gl-small gl-faint" style={{ marginTop: 6 }}>
                {d.exif === null
                  ? 'No camera metadata in this file — screenshots, edited exports and stripped copies carry none, so there is nothing to show and nothing invented in its place.'
                  : 'This entry carries no recorded file data: it was stored before Glow Lab started reading the camera block, or it is linked/bundled artwork with no file behind it.'}
              </div>
            )}
            {fileNote ? (
              <div className="gl-small gl-faint" style={{ marginTop: 6 }}>
                {fileNote}
              </div>
            ) : null}
          </div>
          <Field label="Caption">
            <TextArea value={draft.caption} onChange={(v) => set('caption', v)} placeholder="What to remember about this shot" />
          </Field>
          <Field label="Working notes" hint="Private to this device and never rendered on a shared board.">
            <TextArea value={draft.note} onChange={(v) => set('note', v)} />
          </Field>

          <div className="gl-form-row">
            <Field label="Source">
              <Select value={draft.sourceKind} onChange={(v) => set('sourceKind', v)} options={SOURCE_OPTIONS.map((s) => ({ value: s.value, label: s.label }))} />
            </Field>
            <Field label="Source address">
              <TextInput value={draft.sourceUrl} onChange={(v) => set('sourceUrl', v)} placeholder="https://…" />
            </Field>
            <Field label="Attribution">
              <TextInput value={draft.attribution} onChange={(v) => set('attribution', v)} placeholder="Who made it" />
            </Field>
            <Field label="Licence">
              <TextInput value={draft.license} onChange={(v) => set('license', v)} placeholder="As stated by the source" />
            </Field>
          </div>

          <div className="gl-row gl-row--between" style={{ flexWrap: 'wrap', gap: 8, alignItems: 'flex-end' }}>
            <Field label="Labels">
              <TagInput values={draft.labels} onChange={(v) => set('labels', v)} placeholder="Tag and press Enter" />
            </Field>
          </div>

          <div className="gl-inset">
            <div className="gl-label">Palette sampled when this file was stored</div>
            <div className="gl-asset__swatches" style={{ marginTop: 6 }}>
              {[...new Set(hexes(row))].map((c) => (
                <button
                  key={c}
                  type="button"
                  data-on={String(c).toLowerCase() === String(draft.title).toLowerCase()}
                  title={`Filter the whole library to ${c}`}
                  aria-label={`Filter library to ${c}`}
                  style={{ background: c, width: 26, height: 26 }}
                  onClick={() => onColour(c)}
                />
              ))}
              {!hexes(row).length ? <div className="gl-small gl-faint">No palette was sampled for this entry (bundled artwork carries its own set).</div> : null}
            </div>
            <div className="gl-small gl-faint" style={{ marginTop: 6 }}>
              These are the bucketed colours read from the file's own pixels at ingest, which is why they match the image rather than a label.
            </div>
          </div>

          <div className="gl-form-row">
            <Field label="Linked department" hint="Free text — e.g. tryon, recreate, experiments, hair.">
              <TextInput value={draft.linkedDomain} onChange={(v) => set('linkedDomain', v)} />
            </Field>
            <Field label="Linked record ids">
              <TagInput values={draft.linkedIds} onChange={(v) => set('linkedIds', v)} placeholder="id and press Enter" />
            </Field>
          </div>
          {linkedDept ? (
            <Button size="sm" variant="ghost" icon={<ExternalLink size={13} />} onClick={() => navigate(linkedDept.path)}>
              Open the {linkedDept.short} department this belongs to
            </Button>
          ) : null}
        </Section>

        {/* -------------------------------------------------------- annotations */}
        <Section title="Markers on this image" eyebrow="Your own reading of the photo" description="Drag a marker to place it. Notes here are what you see, written by you — Glow Lab has no image-recognition service and will not decide what is in your photograph.">
          <PhotoCanvas
            item={row}
            height={340}
            pins={draft.annotations.map((a) => ({ id: a.id, x: a.x, y: a.y, label: a.label, note: a.note }))}
            onMovePin={(id, x, y) => {
              set(
                'annotations',
                draft.annotations.map((a) => (a.id === id ? { ...a, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 } : a))
              );
              setPinId(id);
            }}
            overlaysOffLabel="No markers yet"
          />
          <div className="gl-row gl-row--tight" style={{ flexWrap: 'wrap' }}>
            <Button
              size="sm"
              variant="ghost"
              icon={<Target size={13} />}
              onClick={() => {
                const a: Annotation = { id: newId('mk'), x: 50, y: 50, label: `Marker ${draft.annotations.length + 1}`, note: '' };
                set('annotations', [...draft.annotations, a]);
                setPinId(a.id);
                toast('Marker dropped in the centre — drag it onto what you mean, then write its note.');
              }}
            >
              Add marker
            </Button>
            {draft.annotations.map((a) => (
              <Chip key={a.id} active={pinId === a.id} onClick={() => setPinId(a.id)} title={a.note || a.label}>
                {a.label}
              </Chip>
            ))}
          </div>
          {active ? (
            <div className="gl-inset">
              <div className="gl-form-row">
                <Field label="Marker label">
                  <TextInput
                    value={active.label}
                    onChange={(v) => set('annotations', draft.annotations.map((a) => (a.id === active.id ? { ...a, label: v } : a)))}
                  />
                </Field>
                <Field label="Note">
                  <TextInput
                    value={active.note}
                    onChange={(v) => set('annotations', draft.annotations.map((a) => (a.id === active.id ? { ...a, note: v } : a)))}
                    placeholder="What you are pointing at"
                  />
                </Field>
              </div>
              <div className="gl-row gl-row--tight">
                <Range
                  label="Horizontal"
                  value={active.x}
                  min={0}
                  max={100}
                  onChange={(v) => set('annotations', draft.annotations.map((a) => (a.id === active.id ? { ...a, x: v } : a)))}
                  format={(v) => `${v.toFixed(0)}%`}
                />
                <Range
                  label="Vertical"
                  value={active.y}
                  min={0}
                  max={100}
                  onChange={(v) => set('annotations', draft.annotations.map((a) => (a.id === active.id ? { ...a, y: v } : a)))}
                  format={(v) => `${v.toFixed(0)}%`}
                />
                <Button size="sm" variant="danger" icon={<X size={13} />} onClick={() => { set('annotations', draft.annotations.filter((a) => a.id !== active.id)); setPinId(null); }}>
                  Remove
                </Button>
              </div>
              <div className="gl-small gl-faint" style={{ marginTop: 4 }}>
                Position is stored as a percentage of the image, so markers stay put at any size.
              </div>
            </div>
          ) : null}
        </Section>

        {/* ------------------------------------------------------------ compare */}
        <Section title="Compare with another asset" eyebrow="Side by side, honestly" description="The slider shows exactly what is stored; it does not align, relight or straighten either picture.">
          <div className="gl-form-row">
            <Field label="Compare against">
              <Select
                value={compareId}
                onChange={setCompareId}
                placeholder="Choose an asset"
                options={allMedia.filter((m) => String(m.id) !== String(row.id)).map((m) => ({ value: String(m.id), label: `${String(m.title || 'Untitled')} · ${formatDate(String(m.takenOn || ''))}` }))}
              />
            </Field>
            <Field label="Baseline use">
              <div className="gl-row gl-row--tight">
                <Select
                  value={baselineExp}
                  onChange={setBaselineExp}
                  placeholder="Which experiment?"
                  options={experiments.map((e) => ({ value: String(e.id), label: String(e.name || 'Untitled experiment') }))}
                />
                <Button size="sm" variant="primary" icon={<Target size={13} />} disabled={!experiments.length} onClick={() => onBaseline(baselineExp || (experiments[0] ? String(experiments[0].id) : ''))}>
                  Use as baseline
                </Button>
              </div>
            </Field>
          </div>
          {!experiments.length ? <div className="gl-small gl-faint">No experiments exist yet, so there is nothing to attach a baseline to. Create one in Experiments first.</div> : null}
          {compare ? (
            <>
              <CompareSlider before={row} after={compare} beforeLabel="This asset" afterLabel={String(compare.title || 'Selected')} height={360} />
              {mismatch.length ? (
                <SafetyBanner tone="warn" title="These two were not shot alike">
                  {mismatch.join(' · ')}. Differences like these change apparent proportions, so read the slider as a rough comparison rather than a measured one.
                </SafetyBanner>
              ) : (
                <div className="gl-note gl-note--ok">Capture conditions match, so this is the fairest comparison the two files can give.</div>
              )}
            </>
          ) : (
            <div className="gl-empty">Pick an asset above to build a comparison.</div>
          )}
          <Field label="Add to a board" hint="Boards store ids, so the image stays a single copy on this device.">
            <div className="gl-row gl-row--tight">
              <Select
                value={boardId}
                onChange={setBoardId}
                placeholder="Which board?"
                options={boards.map((b) => ({ value: String(b.id), label: String(b.name || 'Untitled board') }))}
              />
              <Button size="sm" variant="ghost" icon={<Plus size={13} />} disabled={!boardId} onClick={() => { onAddToBoard(boardId); setBoardId(''); }}>
                Add
              </Button>
            </div>
          </Field>
          {!boards.length ? <div className="gl-small gl-faint">No boards yet — make one in Inspiration and it will appear here.</div> : null}
        </Section>

        <Disclosure summary="Raw row, for verification">
          <KvList
            items={[
              { k: 'id', v: String(row.id) },
              { k: 'rev', v: String(row.rev) },
              { k: 'updatedAt', v: new Date(Number(row.updatedAt ?? 0)).toLocaleString() },
              { k: 'deletedAt', v: row.deletedAt ? new Date(Number(row.deletedAt)).toLocaleString() : 'not deleted' },
              { k: 'blobId', v: row.blobId ? String(row.blobId) : 'no stored bytes' },
              { k: 'hash', v: String(row.hash || '') },
              { k: 'remoteUrl', v: String(row.remoteUrl || '') },
              { k: 'deviceId', v: String(row.deviceId || '') },
              { k: 'text index', v: String(row.text || '').slice(0, 120) }
            ]}
          />
          <div className="gl-small gl-faint" style={{ marginTop: 6 }}>
            Live query revision {flags}.
          </div>
        </Disclosure>

        <div className="gl-row gl-row--between" style={{ position: 'sticky', bottom: 0, background: 'var(--glow-surface)', padding: 'var(--glow-sp-3) 0' }}>
          <div className="gl-small gl-faint">{dirty ? 'Unsaved changes on this asset' : 'Everything on this screen is saved'}</div>
          <div className="gl-row gl-row--tight">
            <Button variant="ghost" icon={<RotateCcw size={14} />} onClick={() => onClose()}>
              Close
            </Button>
            <Button variant="primary" icon={<Save size={14} />} disabled={!dirty} onClick={() => void save()}>
              Save asset
            </Button>
          </div>
        </div>
      </div>
    </Sheet>
  );
}

/* --------------------------------------------------------------------- helpers */

function useMediaSettings() {
  const [s, setS] = useState<AppSettings | null>(null);
  useEffect(() => {
    let alive = true;
    void loadSettings().then((v) => alive && setS(v));
    const unsub = subscribeSettings((v) => {
      if (alive) setS(v);
    });
    return () => {
      unsub();
      alive = false;
    };
  }, []);
  return s ?? { privateMediaByDefault: true } as Pick<AppSettings, 'privateMediaByDefault'>;
}
