/**
 * Reading a skin tone band and an undertone off pixels the user framed
 * themselves — no face model, no network, nothing that can phone home.
 *
 * The honest limitation is the design: an unassisted photo is lit by one light
 * source, so what is measured is the photo's colour as much as the skin's.
 * That is why every result here is a proposal the user confirms, why the
 * confidence is allowed to say "unsure", and why nothing is ever called a
 * measurement.
 */

/** RGBA bytes, straight off a canvas the user aligned. Non-finite pixels are dropped. */
export type Sample = { r: number; g: number; b: number }[];

export function sampleToRgb(data: Uint8ClampedArray | null | undefined, step = 4): Sample {
  if (!data || data.length < 4) return [];
  const out: Sample = [];
  const stride = Math.max(1, Math.round(step)) * 4;
  for (let i = 0; i + 2 < data.length; i += stride) {
    const a = data.length > i + 3 ? data[i + 3] : 255;
    if (a < 128) continue; // transparent — a guide outside the picture, not skin
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    if (!Number.isFinite(r) || !Number.isFinite(g) || !Number.isFinite(b)) continue;
    out.push({ r, g, b });
  }
  return out;
}

/** sRGB → CIE XYZ (D65), then XYZ → Lab. Same math a paint chip goes through. */
function toLab(r: number, g: number, b: number) {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const R = lin(r);
  const G = lin(g);
  const B = lin(b);
  const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const s = [...xs].sort((p, q) => p - q);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function spread(xs: number[]) {
  if (xs.length < 3) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1));
}

export const TONE_BANDS = ['fair', 'light', 'medium', 'tan', 'deep', 'very deep'] as const;
export type ToneBand = (typeof TONE_BANDS)[number];

export const UNDERTONES = ['cool', 'neutral', 'warm', 'olive', 'unsure'] as const;
export type Undertone = (typeof UNDERTONES)[number];

/**
 * Lightness bands, pinned to the L* values a face actually sits at when it is
 * lit evenly. Read them as "in this photo": a lamp moves a fair face into the
 * light band and a shadow moves a deep one into tan, which is why the UI asks
 * the user to confirm rather than to accept.
 */
export const L_BOUNDS: { band: ToneBand; min: number }[] = [
  { band: 'fair', min: 78 },
  { band: 'light', min: 71 },
  { band: 'medium', min: 61 },
  { band: 'tan', min: 49 },
  { band: 'deep', min: 34 },
  { band: 'very deep', min: -1 }
];

/** Hue angle (Lab) where each family starts, clockwise from blue. */
const H_BOUNDS: { tone: Undertone; from: number }[] = [
  { tone: 'cool', from: -90 },
  { tone: 'neutral', from: 61 },
  { tone: 'warm', from: 70 },
  { tone: 'olive', from: 83 }
];

const NEAR = 4; // degrees of hue that counts as a coin-flip
const CHROMA_FLOOR = 7; // below this there is no undertone to read

export type ToneRead = {
  skinTone: { value: ToneBand; confidence: number };
  undertone: { value: Undertone; confidence: number };
  pixels: number;
  /** L*, a*, b*, chroma and hue of the median pixel — the arithmetic shown, not hidden. */
  figures: { L: number; a: number; b: number; chroma: number; hue: number };
  notes: string[];
};

/**
 * `null` means the app is not proposing anything: too few pixels, or the sample
 * is not a colour it can talk about. Silence is the honest answer more often
 * than a confident wrong band.
 */
export function readTone(sample: Sample): ToneRead | null {
  if (sample.length < 24) return null;
  const labs = sample.map((p) => toLab(p.r, p.g, p.b));
  const Ls = labs.map((l) => l.L);
  const as = labs.map((l) => l.a);
  const bs = labs.map((l) => l.b);

  const L = median(Ls);
  const a = median(as);
  const b = median(bs);
  if (![L, a, b].every(Number.isFinite)) return null;
  if (L < 6) return null; // a black crop is a framing mistake, not a skin colour
  if (L > 97) return null; // a blown-out highlight holds no tone to report

  const chroma = Math.hypot(a, b);
  const hue = (Math.atan2(b, a) * 180) / Math.PI;

  const idx = L_BOUNDS.findIndex((band) => L >= band.min);
  const band = (L_BOUNDS[idx] ?? L_BOUNDS[2]).band;
  const nextBound = idx > 0 ? L_BOUNDS[idx - 1].min : Infinity;
  const prevBound = L_BOUNDS[idx].min;
  // How far inside its own band, 0 = straddling the edge, 1 = comfortably inside.
  const room = Math.min(Math.abs(L - prevBound) / 6, Math.abs(nextBound - L) / 6, 1);

  let undertone: Undertone = 'unsure';
  let hRoom = 0;
  if (chroma >= CHROMA_FLOOR) {
    // `from` runs low to high, so the band is the last one the hue has passed.
    let hi = -1;
    for (let i = 0; i < H_BOUNDS.length; i += 1) if (hue >= H_BOUNDS[i].from) hi = i;
    undertone = (UNDERTONES[hi] ?? 'unsure') as Undertone;
    const lo = H_BOUNDS[hi]?.from ?? -90;
    const hiBound = H_BOUNDS[hi + 1]?.from ?? Infinity;
    hRoom = Math.min(Math.abs(hue - lo) / NEAR, Math.abs(hiBound - hue) / NEAR, 1);
    if (hRoom < 0.35) undertone = 'unsure';
  }

  const notes: string[] = [];
  const spreadL = spread(Ls);
  if (sample.length < 120) notes.push(`${sample.length} pixels sampled — a small crop, so one odd shadow shifts the answer.`);
  if (spreadL > 9) notes.push('The framed area is unevenly lit, which blurs every band here.');
  if (chroma < CHROMA_FLOOR) notes.push(`Chroma ${chroma.toFixed(1)} is too low to read an undertone from — only lightness was decided.`);
  if (L > 82) notes.push('This crop is very bright; light or flash is carrying it, so treat the band as a guess.');
  if (L < 24) notes.push('This crop is dark; a shadow is carrying it, so treat the band as a guess.');

  const confidence = (c: number) => Math.round(Math.max(0.05, Math.min(1, c)) * 100) / 100;

  return {
    skinTone: { value: band, confidence: confidence(0.35 + room * 0.45 + (sample.length > 400 ? 0.2 : 0)) },
    undertone: {
      value: undertone,
      confidence: confidence(undertone === 'unsure' ? 0.18 : 0.2 + hRoom * 0.5 + (sample.length > 400 ? 0.25 : 0))
    },
    pixels: sample.length,
    figures: {
      L: round1(L),
      a: round1(a),
      b: round1(b),
      chroma: round1(chroma),
      hue: round1(hue)
    },
    notes
  };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * The sentence the UI prints under the proposal. No hedging language invented
 * for marketing: it names what was read, from where, and what can move it.
 */
export function describeRead(read: ToneRead): string {
  const bits = [
    `${read.pixels} pixels inside the ellipse`,
    `lightness L* ${read.figures.L}, chroma ${read.figures.chroma}, hue ${read.figures.hue}°`
  ];
  if (read.undertone.value === 'unsure') bits.push('the hue is too close to call');
  return bits.join(' · ');
}
