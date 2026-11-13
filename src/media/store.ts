import { useEffect, useMemo, useState } from 'react';
import { db } from '../db/db';
import { findAll, newId, put, todayISO } from '../db/repo';
import { TABLES, type MediaBlobRow, type MediaItemRow } from '../db/schema';
import type { AnyRow } from '../db/schema';
import { sha256HexBytes } from '../engine/sha256';
import { loadSettings } from '../state/settings';
import { hasExif, readExif, type ExifSummary } from './exif';
import { DHASH_HEIGHT, DHASH_WIDTH, dHashFromGray, grayFromRgba, hammingDistance } from './dhash';

const MAX_EDGE = 1500;
const THUMB_EDGE = 340;

/** 64-bit dHash: at most this many bits may differ before we call two shots look-alike. */
const SIMILAR_DISTANCE = 6;
const SIMILAR_MAX = 3;

const urlCache = new Map<string, string>();
const pending = new Map<string, Promise<string>>();

export interface IngestInput {
  file?: File | Blob;
  blobHint?: Blob;
  remoteUrl?: string;
  kind: MediaItemRow['kind'];
  album?: string;
  title?: string;
  caption?: string;
  sourceKind?: MediaItemRow['sourceKind'];
  sourceUrl?: string;
  attribution?: string;
  license?: string;
  conditions?: string;
  pose?: string;
  lighting?: string;
  distance?: string;
  linkedDomain?: string;
  linkedIds?: string[];
  private?: boolean;
  takenOn?: string;
}

export interface SimilarMedia {
  id: string;
  title: string;
  takenOn: string | null;
  distance: number;
}

export interface IngestResult {
  row: AnyRow;
  duplicate: boolean;
  bytes: number;
  /**
   * Existing rows whose 64-bit perceptual signature is within
   * SIMILAR_DISTANCE bits of this one. A hint only — never a claim that the
   * photos are identical.
   */
  similar?: SimilarMedia[];
}

/**
 * Rasterises the file at working size, undoing the EXIF orientation flag so
 * what we store is what the photographer saw. width/height stay the file's own
 * natural pixel dimensions.
 */
function decode(
  blob: Blob,
  orientation: number | null
): Promise<{ canvas: HTMLCanvasElement; width: number; height: number; uprighted: boolean }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      const natural = Math.max(img.naturalWidth, img.naturalHeight);
      const scale = Math.min(1, MAX_EDGE / (natural || 1));
      const sw = Math.max(1, Math.round(img.naturalWidth * scale));
      const sh = Math.max(1, Math.round(img.naturalHeight * scale));
      // Orientation 5-8 store the picture on its side, so the upright output swaps edges.
      const turned = orientation !== null && orientation >= 5 && orientation <= 8;
      const canvas = document.createElement('canvas');
      canvas.width = turned ? sh : sw;
      canvas.height = turned ? sw : sh;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(url);
        reject(new Error('This browser cannot open a drawing canvas, so the image could not be stored.'));
        return;
      }
      // Each case maps the stored pixels (u,v) onto upright canvas coords
      // (x,y): 1 as-is · 2 x=Sx-u · 3 x=Sx-u,y=Sy-v · 4 y=Sy-v · 5 x=v,y=u ·
      // 6 x=Sy-v,y=u · 7 x=Sy-v,y=Sx-u · 8 x=v,y=Sx-u  (Sx/Sy = source edges).
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.save();
      switch (orientation) {
        case 2:
          ctx.translate(sw, 0);
          ctx.scale(-1, 1);
          break;
        case 3:
          ctx.translate(sw, sh);
          ctx.rotate(Math.PI);
          break;
        case 4:
          ctx.translate(0, sh);
          ctx.scale(1, -1);
          break;
        case 5:
          ctx.scale(1, -1);
          ctx.rotate(-Math.PI / 2);
          break;
        case 6:
          ctx.translate(sh, 0);
          ctx.rotate(Math.PI / 2);
          break;
        case 7:
          ctx.translate(sh, sw);
          ctx.rotate(Math.PI);
          ctx.scale(1, -1);
          ctx.rotate(-Math.PI / 2);
          break;
        case 8:
          ctx.translate(0, sw);
          ctx.rotate(-Math.PI / 2);
          break;
        default:
          break;
      }
      ctx.drawImage(img, 0, 0, sw, sh);
      ctx.restore();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      URL.revokeObjectURL(url);
      resolve({
        canvas,
        width: img.naturalWidth,
        height: img.naturalHeight,
        uprighted: orientation !== null && orientation !== 1
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not decode image — the file may be corrupt or an unsupported format.'));
    };
    img.src = url;
  });
}

async function toBlob(canvas: HTMLCanvasElement, type = 'image/webp', quality = 0.82): Promise<Blob> {
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, type, quality));
  if (blob) return blob;
  const fallback = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', quality));
  return fallback ?? new Blob([], { type: 'image/jpeg' });
}

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  /* the same 256-bit digest in a secure context and outside one, so a
     photograph ingested in Safari is still recognised inside an iOS wrapper */
  return sha256HexBytes(new Uint8Array(buf));
}

/**
 * Reading pixels off her photograph is image analysis, so it happens only with
 * `imageAnalysis` switched on. Off, no pixel is sampled here and the two derived
 * colour fields are written empty rather than holding values she never asked
 * for. One sample feeds both fields: `tags` are the top five of the same
 * eight-bucket list `data.palette` keeps.
 */
function colourReading(canvas: HTMLCanvasElement, allowed: boolean): { tags: string[]; palette: string[] } {
  if (!allowed) return { tags: [], palette: [] };
  const palette = swatches(canvas, 8);
  return { tags: palette.slice(0, 5), palette };
}

function swatches(canvas: HTMLCanvasElement, count = 5): string[] {
  const ctx = canvas.getContext('2d')!;
  const side = 64;
  const small = document.createElement('canvas');
  small.width = side;
  small.height = side;
  const sctx = small.getContext('2d')!;
  sctx.drawImage(canvas, 0, 0, side, side);
  const data = sctx.getImageData(0, 0, side, side).data;
  const buckets = new Map<string, { r: number; g: number; b: number; n: number }>();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 120) continue;
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const key = `${r >> 5}-${g >> 5}-${b >> 5}`;
    const cur = buckets.get(key) ?? { r: 0, g: 0, b: 0, n: 0 };
    cur.r += r;
    cur.g += g;
    cur.b += b;
    cur.n += 1;
    buckets.set(key, cur);
  }
  return [...buckets.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, count)
    .map(({ r, g, b, n }) => `#${[r / n, g / n, b / n].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`);
}

async function fetchRemote(url: string): Promise<Blob> {
  const res = await fetch(url, { mode: 'cors' });
  if (!res.ok) throw new Error(`Remote image fetch failed (${res.status}) for ${url}`);
  return res.blob();
}

/**
 * 9x8 luma sample of the stored image, hashed. Returns null whenever the
 * browser cannot hand us pixels — a missing perceptual hash must never fail an
 * ingest, it only means we cannot spot look-alike shots later.
 *
 * STATED LIMIT: this one pixel read is NOT switched off by `imageAnalysis`.
 * It is a 64-bit comparison key with no colour, no face and nothing readable
 * in it, and the shot grid and the duplicate review queue stop working without
 * it. Everything else derived from her pixels — the colour palette and the
 * colour tags — is gated above.
 */
function perceptualHash(canvas: HTMLCanvasElement): string | null {
  try {
    const small = document.createElement('canvas');
    small.width = DHASH_WIDTH;
    small.height = DHASH_HEIGHT;
    const ctx = small.getContext('2d');
    if (!ctx || typeof ctx.getImageData !== 'function') return null;
    ctx.drawImage(canvas, 0, 0, DHASH_WIDTH, DHASH_HEIGHT);
    const sample = ctx.getImageData(0, 0, DHASH_WIDTH, DHASH_HEIGHT);
    if (!sample || !sample.data || sample.data.length < DHASH_WIDTH * DHASH_HEIGHT * 4) return null;
    return dHashFromGray(grayFromRgba(sample.data, DHASH_WIDTH, DHASH_HEIGHT)) || null;
  } catch {
    return null;
  }
}

function phashOf(row: AnyRow): string {
  const data = (row.data ?? {}) as Record<string, unknown>;
  return typeof data.phash === 'string' ? data.phash : '';
}

/**
 * Rows already in the library whose signature is within SIMILAR_DISTANCE bits.
 * Exact-hash duplicates are handled before this, so a hit here means "looks
 * like something you already logged" — a re-crop, a re-encode, a burst shot.
 */
async function findSimilar(phash: string | null): Promise<SimilarMedia[]> {
  if (!phash) return [];
  try {
    const rows = await findAll(TABLES.mediaItems);
    const hits: SimilarMedia[] = [];
    for (const r of rows) {
      const other = phashOf(r);
      if (!other) continue;
      const distance = hammingDistance(phash, other);
      if (distance > SIMILAR_DISTANCE) continue;
      hits.push({
        id: String(r.id),
        title: String(r.title ?? '').trim() || 'Untitled',
        takenOn: r.takenOn ? String(r.takenOn) : null,
        distance
      });
    }
    hits.sort((a, b) => a.distance - b.distance || String(a.title).localeCompare(String(b.title)));
    return hits.slice(0, SIMILAR_MAX);
  } catch {
    return [];
  }
}

/**
 * Single ingestion path for every image in the app: read the file's own EXIF →
 * decode → upright → downscale → thumbnail → hash → dedupe → blob store →
 * metadata row.
 */
export async function ingestImage(input: IngestInput): Promise<IngestResult> {
  const s = await loadSettings();
  if (input.remoteUrl && !s.allowExternalProcessing) {
    throw new Error('Fetching an outside image needs "Allow external processing" switched on in Settings → Privacy.');
  }
  if ((input.file || input.blobHint) && !s.allowUploads) {
    throw new Error('Adding photographs is switched off in Settings → Privacy.');
  }
  const blob = input.blobHint ?? (input.file ?? (input.remoteUrl ? await fetchRemote(input.remoteUrl) : null));
  if (!blob) throw new Error('No image source provided.');
  const buf = await blob.arrayBuffer();
  const hash = await sha256Hex(buf);
  const existing = (await findAll(TABLES.mediaItems, { where: { hash } }))[0];
  if (existing) return { row: existing, duplicate: true, bytes: blob.size };

  // Whatever the camera wrote, read from the user's own file — never inferred.
  const exif: ExifSummary = readExif(buf);
  const { canvas, width: originalWidth, height: originalHeight, uprighted } = await decode(blob, exif.orientation);
  const full = await toBlob(canvas, 'image/webp', 0.84);
  const thumbCanvas = document.createElement('canvas');
  const tScale = Math.min(1, THUMB_EDGE / Math.max(canvas.width, canvas.height));
  thumbCanvas.width = Math.max(1, Math.round(canvas.width * tScale));
  thumbCanvas.height = Math.max(1, Math.round(canvas.height * tScale));
  thumbCanvas.getContext('2d')!.drawImage(canvas, 0, 0, thumbCanvas.width, thumbCanvas.height);
  const thumb = await toBlob(thumbCanvas, 'image/webp', 0.7);

  const blobId = newId('blob');
  const blobRow: MediaBlobRow = {
    id: blobId,
    blob: full,
    thumb,
    createdAt: Date.now(),
    bytes: full.size,
    mime: full.type || 'image/webp'
  };
  await db.mediaBlobs.put(blobRow);

  const sourceKind = input.sourceKind ?? 'user';
  const derived = colourReading(canvas, s.imageAnalysis);
  const phash = perceptualHash(canvas);
  const similar = await findSimilar(phash);

  const row = await put(TABLES.mediaItems, {
    id: newId('med'),
    kind: input.kind,
    album: input.album ?? 'Unfiled',
    title: input.title ?? '',
    caption: input.caption ?? '',
    blobId,
    remoteUrl: input.remoteUrl ?? '',
    width: canvas.width,
    height: canvas.height,
    takenOn: input.takenOn?.trim() || exif.takenOn || todayISO(),
    conditions: input.conditions ?? '',
    pose: input.pose ?? '',
    lighting: input.lighting ?? '',
    distance: input.distance ?? '',
    linkedDomain: input.linkedDomain ?? '',
    linkedIds: input.linkedIds ?? [],
    sourceKind,
    sourceUrl: input.sourceUrl ?? '',
    attribution: input.attribution ?? '',
    license: input.license ?? (sourceKind === 'user' ? 'User-owned' : 'Unlicensed — verify before reuse'),
    private: input.private ?? s.privateMediaByDefault,
    hash,
    star: false,
    tags: derived.tags,
    data: {
      palette: derived.palette,
      ...(phash ? { phash } : {}),
      exif: hasExif(exif) ? exif : null,
      capturedOn: exif.takenOn,
      originalWidth,
      originalHeight,
      uprighted
    }
  } as any);

  return { row, duplicate: false, bytes: full.size, ...(similar.length ? { similar } : {}) };
}

export async function objectUrlFor(blobId: string | null | undefined, prefer: 'full' | 'thumb' = 'full'): Promise<string> {
  if (!blobId) return '';
  const key = `${blobId}:${prefer}`;
  const cached = urlCache.get(key);
  if (cached) return cached;
  const inflight = pending.get(key);
  if (inflight) return inflight;
  const p = (async () => {
    const row = await db.mediaBlobs.get(blobId);
    if (!row) throw new Error(`Missing blob ${blobId}`);
    const blob = prefer === 'thumb' ? row.thumb : row.blob;
    const url = URL.createObjectURL(blob);
    urlCache.set(key, url);
    pending.delete(key);
    return url;
  })();
  pending.set(key, p);
  return p;
}

/** Reactive src for an image; falls back to the remote URL for external providers. */
export function useImageSrc(item: AnyRow | undefined | null, prefer: 'full' | 'thumb' = 'full'): string {
  const [src, setSrc] = useState('');
  const blobId = item?.blobId as string | undefined;
  const remote = (item?.remoteUrl as string) || '';
  useEffect(() => {
    let alive = true;
    if (!blobId) {
      setSrc(remote);
      return;
    }
    objectUrlFor(blobId, prefer)
      .then((url) => {
        if (alive) setSrc(url);
      })
      .catch(() => alive && setSrc(remote));
    return () => {
      alive = false;
    };
  }, [blobId, prefer, remote]);
  return src;
}

export async function mediaStats() {
  const blobs = await db.mediaBlobs.toArray();
  const bytes = blobs.reduce((sum, b) => sum + (b.bytes ?? 0), 0);
  return { count: blobs.length, bytes, items: (await findAll(TABLES.mediaItems)).length };
}

export function useMedia(item: AnyRow | undefined | null, prefer: 'full' | 'thumb' = 'full') {
  const src = useImageSrc(item, prefer);
  return useMemo(() => ({ src, ready: Boolean(src) }), [src]);
}

export async function findMediaByDomain(domain: string, ids: string[]) {
  const all = await findAll(TABLES.mediaItems);
  return all.filter((m) => ids.includes(m.id) || (m.linkedDomain === domain && !m.deletedAt));
}

export { TABLES };
