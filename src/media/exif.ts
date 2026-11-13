/**
 * A small, dependency-free EXIF reader.
 *
 * It only ever reports what the camera wrote into the file itself — the app has
 * no image-recognition service and does not infer anything about the subject.
 * PNG / WebP / HEIC / GIF / screenshots and truncated files come back as a bag
 * of nulls rather than throwing, because "unknown" is the honest answer.
 */

export interface ExifCamera {
  /** Human-readable shutter time as the camera recorded it, e.g. "1/120 s". */
  exposure: string | null;
  iso: number | null;
  focalMm: number | null;
  /** EXIF flash bit 0 — the flash fired, or did not, or was never recorded. */
  flash: boolean | null;
}

export interface ExifSummary {
  /** EXIF orientation 1..8, or null when the file does not state one. */
  orientation: number | null;
  /** Date the file claims the shot happened, normalised to YYYY-MM-DD. */
  takenOn: string | null;
  /** Make + model as the camera spelled them. */
  device: string | null;
  camera: ExifCamera | null;
}

const TAG_ORIENTATION = 0x0112;
const TAG_MAKE = 0x010f;
const TAG_MODEL = 0x0110;
const TAG_DATETIME = 0x0132;
const TAG_EXIF_IFD = 0x8769;
const TAG_DATETIME_ORIGINAL = 0x9003;
const TAG_EXPOSURE_TIME = 0x9201;
const TAG_ISO = 0x8822;
const TAG_FOCAL_LENGTH = 0x920a;
const TAG_FLASH = 0x9209;

/** Bytes per component for the TIFF field types we accept; anything else is skipped. */
const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8, 11: 4, 12: 8 };

const MAX_IFD_ENTRIES = 512;
const MAX_SEGMENTS = 128;

export function emptyExif(): ExifSummary {
  return { orientation: null, takenOn: null, device: null, camera: null };
}

/** True when the file actually told us something. */
export function hasExif(summary: ExifSummary | null | undefined): boolean {
  if (!summary) return false;
  if (summary.orientation !== null || summary.takenOn || summary.device) return true;
  const c = summary.camera;
  return Boolean(c && (c.exposure || c.iso !== null || c.focalMm !== null || c.flash !== null));
}

interface Entry {
  tag: number;
  type: number;
  count: number;
  /** Absolute index of the first value byte, already bounds-checked. */
  at: number;
}

class TiffBlock {
  private view: DataView;
  private little: boolean;
  private end: number;
  private base: number;

  constructor(view: DataView, little: boolean, base: number, end: number) {
    this.view = view;
    this.little = little;
    this.base = base;
    this.end = end;
  }

  private u16(o: number): number | null {
    return o >= 0 && o + 2 <= this.end ? this.view.getUint16(o, this.little) : null;
  }

  private u32(o: number): number | null {
    return o >= 0 && o + 4 <= this.end ? this.view.getUint32(o, this.little) : null;
  }

  /** Parses one IFD and returns its entries; every offset is re-checked, never trusted. */
  ifd(offsetFromBase: number | null): Entry[] {
    if (offsetFromBase === null || offsetFromBase < 0) return [];
    const at = this.base + offsetFromBase;
    if (at + 2 > this.end) return [];
    const count = this.u16(at) ?? 0;
    if (count > MAX_IFD_ENTRIES) return [];
    const out: Entry[] = [];
    for (let i = 0; i < count; i += 1) {
      const p = at + 2 + i * 12;
      if (p + 12 > this.end) break;
      const tag = this.u16(p);
      const type = this.u16(p + 2);
      const size = this.u32(p + 4);
      if (tag === null || type === null || size === null) continue;
      const comp = TYPE_SIZE[type];
      if (!comp || size > 1_000_000) continue;
      const bytes = comp * size;
      // Values of four bytes or fewer live inside the field itself.
      let valueAt: number;
      if (bytes <= 4) {
        valueAt = p + 8;
      } else {
        const rel = this.u32(p + 8);
        if (rel === null || rel < 0 || this.base + rel + bytes > this.end) continue;
        valueAt = this.base + rel;
      }
      out.push({ tag, type, count: size, at: valueAt });
    }
    return out;
  }

  text(entry: Entry | undefined, maxLen = 96): string | null {
    if (!entry || (entry.type !== 2 && entry.type !== 7)) return null;
    const n = Math.min(entry.count, maxLen);
    let s = '';
    for (let i = 0; i < n; i += 1) {
      const o = entry.at + i;
      if (o >= this.end) break;
      const c = this.view.getUint8(o);
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    const clean = printable(s);
    return clean || null;
  }

  /** First scalar of a numeric field, converted from whatever TIFF type it was stored as. */
  number(entry: Entry | undefined): number | null {
    if (!entry || entry.count < 1) return null;
    const rational = entry.type === 5 || entry.type === 10;
    if (rational) return this.rational(entry, 0);
    const o = entry.at;
    switch (entry.type) {
      case 1:
      case 7:
        return o < this.end ? this.view.getUint8(o) : null;
      case 3:
        return o + 2 <= this.end ? this.view.getUint16(o, this.little) : null;
      case 4:
        return o + 4 <= this.end ? this.view.getUint32(o, this.little) : null;
      case 9:
        return o + 4 <= this.end ? this.view.getInt32(o, this.little) : null;
      case 11:
        return o + 4 <= this.end ? this.view.getFloat32(o, this.little) : null;
      case 12:
        return o + 8 <= this.end ? this.view.getFloat64(o, this.little) : null;
      default:
        return null;
    }
  }

  rational(entry: Entry | undefined, index: number): number | null {
    if (!entry || (entry.type !== 5 && entry.type !== 10) || index >= entry.count) return null;
    const o = entry.at + index * 8;
    const num = this.u32(o);
    const den = this.u32(o + 4);
    if (num === null || den === null || den === 0) return null;
    const value = entry.type === 10 ? (num | 0) / (den | 0) : num / den;
    return Number.isFinite(value) ? value : null;
  }

  find(entries: Entry[], tag: number): Entry | undefined {
    return entries.find((e) => e.tag === tag);
  }
}

function printable(raw: string): string {
  return raw
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** EXIF writes "2026:09:12 18:04:22"; the app's convention is YYYY-MM-DD (see db/repo.ts todayISO). */
function toDayDate(raw: string | null): string | null {
  if (!raw) return null;
  const m = /(\d{4})[:\-.\/](\d{1,2})[:\-.\/](\d{1,2})/.exec(raw);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 1900 || y > 2999 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function formatExposure(seconds: number | null): string | null {
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0 || seconds > 3600) return null;
  if (seconds >= 1) return `${seconds >= 10 ? Math.round(seconds) : Math.round(seconds * 10) / 10} s`;
  return `1/${Math.max(1, Math.round(1 / seconds))} s`;
}

/** Keeps a focal length only if it could plausibly be printed on a lens. */
function plausibleFocal(mm: number | null): number | null {
  if (mm === null || !Number.isFinite(mm) || mm <= 0 || mm > 2500) return null;
  return Math.round(mm * 10) / 10;
}

/** Locates the APP1 "Exif\0\0" segment and returns the TIFF block start, or null. */
function exifTiffStart(view: DataView, byteLen: number): number | null {
  if (byteLen < 4 || view.getUint16(0) !== 0xffd8) return null;
  let p = 2;
  for (let guard = 0; guard < MAX_SEGMENTS && p + 4 <= byteLen; guard += 1) {
    if (view.getUint8(p) !== 0xff) {
      p += 1;
      continue;
    }
    const marker = view.getUint16(p);
    // Standalone markers (SOI, EOI, RSTn, TEM) carry no length field.
    if (marker === 0xffd8 || marker === 0xffd9 || marker === 0xff01 || (marker >= 0xffd0 && marker <= 0xffd7)) {
      p += 2;
      continue;
    }
    const len = view.getUint16(p + 2);
    if (len < 2) return null;
    const payload = p + 4;
    const next = payload + len - 2;
    // A segment claiming more bytes than the file holds is read as far as the
    // file goes: the bounds checks below do the rest, nothing is trusted.
    if (marker === 0xffe1 && byteLen - payload >= 6 && isExifHeader(view, payload)) return payload + 6;
    if (marker === 0xffda) return null; // scan data started; EXIF is never after it
    if (next > byteLen) return null;
    p = next;
  }
  return null;
}

function isExifHeader(view: DataView, at: number): boolean {
  return (
    view.getUint8(at) === 0x45 &&
    view.getUint8(at + 1) === 0x78 &&
    view.getUint8(at + 2) === 0x69 &&
    view.getUint8(at + 3) === 0x66 &&
    view.getUint8(at + 4) === 0x00 &&
    view.getUint8(at + 5) === 0x00
  );
}

/**
 * Reads orientation, capture date, device and the camera's own exposure
 * settings out of a JPEG's EXIF block. Never throws: anything unreadable is
 * reported as null and the ingest continues with the file as given.
 */
export function readExif(buffer: ArrayBuffer | null | undefined): ExifSummary {
  const summary = emptyExif();
  try {
    if (!buffer || buffer.byteLength < 14) return summary;
    const view = new DataView(buffer);
    const tiffStart = exifTiffStart(view, buffer.byteLength);
    if (tiffStart === null || tiffStart + 8 > buffer.byteLength) return summary;
    const bo = view.getUint16(tiffStart);
    if (bo !== 0x4949 && bo !== 0x4d4d) return summary;
    if (view.getUint16(tiffStart + 2, bo === 0x4949) !== 0x002a) return summary;
    const tiff = new TiffBlock(view, bo === 0x4949, tiffStart, buffer.byteLength);
    const ifd0 = tiff.ifd(view.getUint32(tiffStart + 4, bo === 0x4949));
    if (!ifd0.length) return summary;

    const orientation = tiff.number(tiff.find(ifd0, TAG_ORIENTATION));
    if (orientation !== null && Number.isInteger(orientation) && orientation >= 1 && orientation <= 8) {
      summary.orientation = orientation;
    }

    const make = printable(tiff.text(tiff.find(ifd0, TAG_MAKE), 48) ?? '');
    const model = printable(tiff.text(tiff.find(ifd0, TAG_MODEL), 48) ?? '');
    const device = [make, model].filter(Boolean).join(' ').trim();
    summary.device = device ? (model && model.toLowerCase().startsWith(make.toLowerCase()) ? model : device).slice(0, 96) : null;

    // The Exif sub-IFD holds the fields worth showing a user.
    let sub: Entry[] = [];
    const pointer = tiff.find(ifd0, TAG_EXIF_IFD);
    if (pointer && (pointer.type === 3 || pointer.type === 4)) {
      const off = tiff.number(pointer);
      if (off !== null && off > 0) sub = tiff.ifd(off);
    }

    const shot =
      toDayDate(tiff.text(tiff.find(sub, TAG_DATETIME_ORIGINAL), 32)) ??
      toDayDate(tiff.text(tiff.find(ifd0, TAG_DATETIME), 32));
    summary.takenOn = shot;

    const exposure = formatExposure(tiff.rational(tiff.find(sub, TAG_EXPOSURE_TIME), 0));
    const rawIso = tiff.number(tiff.find(sub, TAG_ISO));
    const iso = rawIso !== null && Number.isFinite(rawIso) && rawIso >= 1 && rawIso <= 512000 ? Math.round(rawIso) : null;
    const focal = plausibleFocal(tiff.rational(tiff.find(sub, TAG_FOCAL_LENGTH), 0));
    const flashRaw = tiff.number(tiff.find(sub, TAG_FLASH));
    const flash = flashRaw !== null && Number.isFinite(flashRaw) ? (Math.trunc(flashRaw) & 1) === 1 : null;

    if (exposure || iso !== null || focal !== null || flash !== null) {
      summary.camera = { exposure, iso, focalMm: focal, flash };
    }
  } catch {
    return emptyExif();
  }
  return summary;
}

/**
 * Names the turn the stored pixels needed to sit upright — i.e. what the app
 * applied at import, phrased the way a person would say it.
 */
export function orientationLabel(orientation: number | null): string | null {
  switch (orientation) {
    case 2:
      return 'flipped sideways';
    case 3:
      return 'spun 180°';
    case 4:
      return 'flipped upside down';
    case 5:
      return 'mirrored along one diagonal';
    case 6:
      return 'turned a quarter clockwise';
    case 7:
      return 'mirrored along the other diagonal';
    case 8:
      return 'turned a quarter counter-clockwise';
    default:
      return null;
  }
}
