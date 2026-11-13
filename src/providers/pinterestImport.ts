import JSZip from 'jszip';
import { TABLES, type AnyRow } from '../db/schema';
import { findAll } from '../db/repo';
import { saveRow } from '../hooks/live';
import { ingestImage } from '../media/store';

/**
 * Bringing your own Pinterest saves into the feed — the only route that is
 * free, stays on the device and does not touch Pinterest's terms.
 *
 * What this deliberately is NOT:
 *  - not a scraper (there is no code path that reads a Pinterest page);
 *  - not a password holder (the app never asks for Pinterest credentials);
 *  - not a live sync. Verified from this project on 2026-11-12:
 *    `api.pinterest.com/v5/...` answers 401 with no `Access-Control-Allow-Origin`,
 *    and `widgets.pinterest.com` oEmbed answers with no CORS header either, so a
 *    local-first client cannot call either one from the browser. A live feed would
 *    need a server holding your token, which this app does not have and does not
 *    pretend to have.
 *
 * So the input is data Pinterest already gave you: Settings → Privacy and data →
 * Request your data (free, emailed link, up to about 48 hours), or the images and
 * links you saved yourself.
 */

export interface PinRecord {
  id: string;
  title: string;
  description: string;
  link: string;
  board: string;
  imageKey?: string;
}

export interface ImportSummary {
  source: 'zip' | 'csv' | 'images' | 'links';
  pinsFound: number;
  imagesFound: number;
  imported: number;
  duplicates: number;
  linkOnly: number;
  detail: string;
}

const IMAGE_EXT = /\.(jpe?g|png|webp|gif|avif)$/i;

/** Minimal RFC-4180 reader: quotes, doubled quotes, embedded commas and newlines. */
export function parseCsv(text: string): Record<string, string>[] {
  const clean = text.replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean[i];
    if (quoted) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') {
      cur.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && clean[i + 1] === '\n') i += 1;
      cur.push(field);
      field = '';
      rows.push(cur);
      cur = [];
    } else field += ch;
  }
  if (field || cur.length) {
    cur.push(field);
    rows.push(cur);
  }
  const header = (rows.shift() ?? []).map((h) => h.trim());
  return rows
    .filter((r) => r.some((c) => c.trim()))
    .map((r) => {
      const o: Record<string, string> = {};
      header.forEach((h, i) => {
        if (h) o[h] = (r[i] ?? '').trim();
      });
      return o;
    });
}

function pick(row: Record<string, string>, patterns: RegExp[]): string {
  for (const p of patterns) {
    const key = Object.keys(row).find((k) => p.test(k));
    if (key && row[key]) return row[key];
  }
  return '';
}

const PIN_ID = /(?:\/pin\/|pin\.it\/|[?&]pin[_-]?id=)(\d{6,})/i;

/** Maps one export row to a pin record, whatever column names Pinterest used. */
export function pinFromCsvRow(row: Record<string, string>): PinRecord | null {
  const link = pick(row, [/^pin\s*url$/i, /pin.*url/i, /^url$/i, /permalink/i, /^link$/i]);
  const explicitId = pick(row, [/^id$/i, /^pin[_-]?id$/i]);
  const fromLink = link.match(PIN_ID)?.[1];
  const id = explicitId || fromLink || '';
  const title = pick(row, [/^title$/i, /^name$/i, /^pin[_-]?title$/i]);
  const description = pick(row, [/desc/i, /^note$/i]);
  const board = pick(row, [/board/i, /^folder$/i]);
  if (!id && !link && !title) return null;
  return { id, title: title || board || 'Pinterest save', description, link, board, imageKey: id };
}

/** Basenames that identify one pin, so an image can be matched without a manifest. */
function imageKeysFor(pin: PinRecord, used: Set<string>): string[] {
  const keys: string[] = [];
  if (pin.id) keys.push(pin.id);
  const slug = pin.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
  if (slug.length > 3) keys.push(slug);
  return keys.filter((k) => !used.has(k));
}

function matchImage(fileName: string, keys: string[]): boolean {
  const base = fileName.toLowerCase().replace(IMAGE_EXT, '');
  return keys.some((k) => base.includes(k.toLowerCase()));
}

async function storeImage(bytes: Uint8Array, mime: string, pin: PinRecord) {
  const ext = mime.split('/')[1]?.replace('jpeg', 'jpg') ?? 'jpg';
  const file = new File([bytes as BlobPart], `pinterest-${pin.id || 'save'}.${ext}`, { type: mime });
  return ingestImage({
    file,
    kind: 'library',
    // tagged, not 'user': otherwise the same picture also enters the feed as a
    // "my uploads" card and every imported pin shows up twice.
    sourceKind: 'pinterest',
    album: 'Pinterest saves',
    title: pin.title,
    caption: pin.description,
    sourceUrl: pin.link,
    attribution: 'Saved by you on Pinterest — image rights stay with whoever made it',
    license: 'Your Pinterest save · kept on this device, not redistributed',
    linkedDomain: 'discover'
  });
}

/**
 * What already exists, read once per import. Boards are newest-first, so a
 * re-export can hand the same picture a different title; the stored image is
 * the only identity that survives that shuffle.
 */
async function pinIndex() {
  const pins = (await findAll(TABLES.discoveryItems, { includeDeleted: true })).filter((r) => r.providerId === 'pinterest');
  const bySlug = new Map<string, AnyRow>();
  const byMedia = new Map<string, AnyRow>();
  // A tidied-away card keeps its identity in the index, so a re-run reports it as
  // already known instead of adding it back. When a live card and a deleted one
  // point at the same picture, the live one wins the slot — otherwise the relabel
  // would rename a hidden row and the card she can actually see would keep the
  // stale name.
  const prefer = (map: Map<string, AnyRow>, key: string, row: AnyRow) => {
    if (!key) return;
    const seen = map.get(key);
    if (!seen || (seen.deletedAt && !row.deletedAt)) map.set(key, row);
  };
  for (const r of pins) {
    prefer(bySlug, String(r.slug), r);
    prefer(byMedia, r.mediaId ? String(r.mediaId) : '', r);
  }
  return { bySlug, byMedia };
}

type PinIndex = Awaited<ReturnType<typeof pinIndex>>;

/** One discovery row per imported pin, tagged so taste learning can respect the boundary. */
async function storePin(pin: PinRecord, blobRow: AnyRow | null, index: PinIndex): Promise<'created' | 'existing'> {
  const slug = `pinterest-${pin.id || pin.link || pin.title}`.slice(0, 120);
  const mediaId = blobRow ? String(blobRow.id) : '';
  const bySlug = index.bySlug.get(slug);
  const byMedia = mediaId ? index.byMedia.get(mediaId) : undefined;
  const hit = bySlug ?? byMedia;
  if (hit) {
    // Found by picture but not by name: the label drifted, the save did not.
    // Renaming it here means the next import matches on the first look.
    if (!bySlug && pin.title) {
      const relabelled = { ...hit, slug, title: pin.title } as AnyRow;
      await saveRow(TABLES.discoveryItems, relabelled);
      index.bySlug.set(slug, relabelled);
      if (mediaId) index.byMedia.set(mediaId, relabelled);
    }
    return 'existing';
  }
  const row = {
    slug,
    providerId: 'pinterest',
    title: pin.title,
    description: pin.description,
    categories: pin.board ? [pin.board.toLowerCase()] : ['pinterest'],
    aesthetic: '',
    palette: [],
    elements: [],
    mediaId: blobRow ? String(blobRow.id) : null,
    sourceUrl: pin.link,
    attribution: 'Saved by you on Pinterest — imported from your own data',
    license: 'Your Pinterest save · display on this device only',
    recreatable: false,
    seed: 0,
    tags: ['pinterest', pin.board].filter(Boolean),
    data: { pinId: pin.id, board: pin.board, importedAt: Date.now() }
  } as unknown as AnyRow;
  await saveRow(TABLES.discoveryItems, row);
  index.bySlug.set(slug, row);
  if (mediaId) index.byMedia.set(mediaId, row);
  return 'created';
}

function mimeOf(name: string) {
  const ext = name.toLowerCase().split('.').pop();
  return ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : ext === 'avif' ? 'image/avif' : 'image/jpeg';
}

/** The export archive: CSV rows plus the image folders, matched by pin id or title. */
export async function importExportZip(file: File): Promise<ImportSummary> {
  const zip = await JSZip.loadAsync(file);
  const csvs: { name: string; text: string }[] = [];
  const images: { name: string; bytes: Uint8Array; mime: string }[] = [];
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    if (/\.csv$/i.test(entry.name)) csvs.push({ name: entry.name, text: await entry.async('string') });
    else if (IMAGE_EXT.test(entry.name)) images.push({ name: entry.name, bytes: await entry.async('uint8array'), mime: mimeOf(entry.name) });
  }

  const pins: PinRecord[] = [];
  for (const c of csvs) {
    const rows = parseCsv(c.text);
    if (!rows.length) continue;
    // Only tables that actually describe saves: a boards.csv (name and
    // description columns) would otherwise pass for a pin list.
    const isPinTable = /pins?/i.test(c.name) || Object.keys(rows[0]).some((k) => /pin|save|board/i.test(k));
    if (!isPinTable) continue;
    for (const row of rows) {
      const p = pinFromCsvRow(row);
      if (p) pins.push(p);
    }
  }

  const used = new Set<string>();
  const index = await pinIndex();
  const summary: ImportSummary = { source: 'zip', pinsFound: pins.length, imagesFound: images.length, imported: 0, duplicates: 0, linkOnly: 0, detail: '' };
  for (const pin of pins) {
    const keys = imageKeysFor(pin, used);
    const hit = keys.length ? images.find((im) => matchImage(im.name, keys)) : undefined;
    if (hit) used.add(hit.name.toLowerCase().replace(IMAGE_EXT, ''));
    if (!hit) {
      if (pin.link) await storeReference(pin);
      summary.linkOnly += 1;
      continue;
    }
    try {
      const res = await storeImage(hit.bytes, hit.mime, pin);
      const state = await storePin(pin, res.row, index);
      if (state === 'existing' || res.duplicate) summary.duplicates += 1;
      else summary.imported += 1;
    } catch (e) {
      summary.detail = (e as Error).message;
    }
  }
  summary.detail ||=
    pins.length === 0
      ? 'No pin rows found in that archive. If your export holds only links, use “Just my pin links” instead.'
      : `${summary.imported} card(s) added, ${summary.linkOnly} stored as links, ${summary.duplicates} already in your library.`;
  return summary;
}

/** A folder of images you saved yourself — no CSV needed. */
export async function importImageFiles(files: File[]): Promise<ImportSummary> {
  const summary: ImportSummary = { source: 'images', pinsFound: files.length, imagesFound: files.length, imported: 0, duplicates: 0, linkOnly: 0, detail: '' };
  const index = await pinIndex();
  for (const f of files) {
    if (!IMAGE_EXT.test(f.name)) continue;
    const pin: PinRecord = {
      id: '',
      title: f.name.replace(IMAGE_EXT, '').replace(/[-_]+/g, ' ').slice(0, 80),
      description: '',
      link: '',
      board: 'Pinterest saves'
    };
    try {
      const res = await ingestImage({
        file: f,
        kind: 'library',
        sourceKind: 'pinterest',
        album: 'Pinterest saves',
        title: pin.title,
        attribution: 'Saved by you — image rights stay with whoever made it',
        license: 'Your Pinterest save · kept on this device, not redistributed',
        linkedDomain: 'discover'
      });
      pin.id = String(res.row.id);
      const state = await storePin(pin, res.row, index);
      if (state === 'existing' || res.duplicate) summary.duplicates += 1;
      else summary.imported += 1;
    } catch (e) {
      summary.detail = (e as Error).message;
    }
  }
  summary.detail ||= `${summary.imported} card(s) added, ${summary.duplicates} already in your library (exact-duplicate pictures are skipped).`;
  return summary;
}

async function storeReference(pin: PinRecord) {
  const existing = await findAll(TABLES.manualReferences, { where: { url: pin.link }, includeDeleted: true });
  if (existing.length) return 'existing';
  await saveRow(TABLES.manualReferences, {
    url: pin.link,
    title: pin.title,
    note: pin.description,
    provider: 'pinterest',
    boardHint: pin.board,
    imported: true
  });
  return 'created';
}

/** Links only: pasted pin URLs, stored as references. No image is ever fetched. */
export async function importPinLinks(text: string): Promise<ImportSummary> {
  const urls = Array.from(new Set((text.match(/https?:\/\/\S+/g) ?? []).map((u) => u.replace(/[),.;]+$/, ''))));
  const summary: ImportSummary = { source: 'links', pinsFound: urls.length, imagesFound: 0, imported: 0, duplicates: 0, linkOnly: 0, detail: '' };
  for (const url of urls) {
    const state = await storeReference({ id: url.match(PIN_ID)?.[1] ?? '', title: '', description: '', link: url, board: '' });
    if (state === 'existing') summary.duplicates += 1;
    else summary.linkOnly += 1;
  }
  summary.detail = summary.pinsFound
    ? `${summary.linkOnly} link(s) stored, ${summary.duplicates} already there. Links open the original — Glow Lab never downloads someone else's image for you.`
    : 'No http(s) links found in that text.';
  return summary;
}

export async function importPinterestFiles(files: File[]): Promise<ImportSummary> {
  const zip = files.find((f) => /\.zip$/i.test(f.name));
  if (zip) return importExportZip(zip);
  const csv = files.find((f) => /\.(csv|tsv)$/i.test(f.name));
  if (csv) {
    const text = await csv.text();
    const pins = parseCsv(text).map(pinFromCsvRow).filter((p): p is PinRecord => Boolean(p));
    const summary: ImportSummary = { source: 'csv', pinsFound: pins.length, imagesFound: 0, imported: 0, duplicates: 0, linkOnly: 0, detail: '' };
    for (const pin of pins) {
      if (pin.link) await storeReference(pin);
      summary.linkOnly += 1;
    }
    summary.detail = pins.length
      ? `${summary.linkOnly} pin(s) stored as links. A CSV on its own carries no pictures — export the full archive, or drop the image files in as well.`
      : 'That CSV has no recognisable pin rows (no title, URL or id column).';
    return summary;
  }
  return importImageFiles(files);
}

export const PINTEREST_IMPORT_NOTES = [
  'Free and official: Pinterest → Settings → Privacy and data → “Request your data”. The archive is emailed to you, usually within about 48 hours.',
  'Nothing is fetched for you. The app reads the file you hand it, on this device, and never contacts Pinterest to do it.',
  'Your saves stay separate from taste learning until you say otherwise — see Settings → “Let my Pinterest saves steer the taste arithmetic”.',
  'Someone else made those pictures. They are for your own reference on your own device; the app does not redistribute them.'
];
