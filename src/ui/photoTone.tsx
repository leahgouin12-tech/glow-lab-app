import { useEffect, useRef, useState } from 'react';
import { TABLES, type AnyRow } from '../db/schema';
import { objectUrlFor } from '../media/store';
import { L_BOUNDS, TONE_BANDS, UNDERTONES, describeRead, readTone, sampleToRgb, type ToneRead } from '../engine/photoTone';
import { PhotoPicker } from './media';
import { Button, Card, CardHead, Chip, Disclosure, Field, Meter, Select } from './primitives';
import type { AppSettings } from '../state/settings';

/**
 * The one place the app offers to read something off a photograph.
 *
 * It is deliberately small: two bands, both of them editable before anything is
 * written, both of them stamped with the arithmetic they came from. Everything
 * a camera cannot tell — shape, texture, sensitivity, a diagnosis — stays a
 * question the user answers.
 */

const MAX_SAMPLE_EDGE = 512;

export function ToneReadCard({
  settings,
  startShot = null,
  onApply
}: {
  settings: AppSettings | null;
  /** a photo already logged on this device, offered so no one has to re-take one */
  startShot?: AnyRow | null;
  onApply: (patch: Record<string, unknown>) => void;
}) {
  const [shot, setShot] = useState<AnyRow | null>(startShot);
  const [src, setSrc] = useState<string | null>(null);
  const [centreX, setCentreX] = useState(50);
  const [centreY, setCentreY] = useState(48);
  const [width, setWidth] = useState(46);
  const [read, setRead] = useState<ToneRead | null>(null);
  const [pickedTone, setPickedTone] = useState<string>(TONE_BANDS[2]);
  const [pickedUndertone, setPickedUndertone] = useState<string>('neutral');
  const [fault, setFault] = useState('');
  const [applied, setApplied] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);

  // The album query resolves after first paint, so adopt the offered shot then
  // — but never overrule one the user already picked or already read.
  useEffect(() => {
    if (!startShot || shot) return;
    setShot(startShot);
  }, [startShot, shot]);

  useEffect(() => {
    let live = true;
    let url: string | null = null;
    if (!shot) {
      setSrc(null);
      return;
    }
    void objectUrlFor(shot.blobId, 'full').then((u) => {
      if (!live) return;
      url = u;
      setSrc(u);
    });
    return () => {
      live = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [shot]);

  const frame = { left: `${centreX - width / 2}%`, top: `${centreY - width / 2.6}%`, width: `${width}%`, height: `${width / 1.3}%` };

  const sample = async () => {
    setFault('');
    setRead(null);
    const img = imgRef.current;
    if (!img || !shot) return;
    if (!img.complete || !img.naturalWidth) {
      setFault('The photo has not finished loading on this device — try again in a moment.');
      return;
    }
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, MAX_SAMPLE_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setFault('This browser will not hand pixels back, so there is nothing to read. Type the two bands yourself instead.');
      return;
    }
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const box = {
      x: Math.round((centreX / 100) * canvas.width - (width / 100 / 2) * canvas.width),
      y: Math.round((centreY / 100) * canvas.height - (width / 100 / 2.6) * canvas.height),
      w: Math.round((width / 100) * canvas.width),
      h: Math.round((width / 100 / 1.3) * canvas.height)
    };
    box.x = Math.max(0, box.x);
    box.y = Math.max(0, box.y);
    box.w = Math.min(canvas.width - box.x, box.w);
    box.h = Math.min(canvas.height - box.y, box.h);
    if (box.w < 8 || box.h < 8) {
      setFault('The ellipse is too small to read anything from. Make it bigger.');
      return;
    }
    let data: Uint8ClampedArray;
    try {
      data = ctx.getImageData(box.x, box.y, box.w, box.h).data;
    } catch (err) {
      setFault(`The framed area could not be read (${err instanceof Error ? err.message : 'unknown reason'}) — nothing was stored.`);
      return;
    }
    const result = readTone(sampleToRgb(data, 1));
    if (!result) {
      setFault('Nothing readable inside the ellipse — it is either too dark, blown out, or off the face. Move it and try again.');
      return;
    }
    setRead(result);
    setPickedTone(result.skinTone.value);
    setPickedUndertone(result.undertone.value);
    setApplied(false);
  };

  const apply = () => {
    if (!read) return;
    onApply({
      skinTone: pickedTone,
      undertone: pickedUndertone,
      toneRead: {
        at: new Date().toISOString(),
        mediaId: shot?.id ?? null,
        pixels: read.pixels,
        ...read.figures,
        skinToneConfidence: read.skinTone.confidence,
        undertoneConfidence: read.undertone.confidence
      }
    });
    setApplied(true);
  };

  if (!settings?.imageAnalysis) {
    return (
      <Card className="pt-card">
        <CardHead
          title="Photo-assisted reading is switched off"
          eyebrow="Read from a photo"
          sub="The switch below is the only thing that lets this app sample pixels off your photographs. Nothing is read while it stays off, and every band on every screen stays yours to type."
        />
        <div className="gl-row gl-row--tight" style={{ marginTop: 10 }}>
          <Chip>off — no pixels read</Chip>
        </div>
      </Card>
    );
  }

  return (
    <Card className="pt-card">
      <CardHead
        title="Read the two colour bands off a photo"
        eyebrow="Read from a photo"
        sub="Skin tone and undertone, from pixels inside an ellipse you position yourself. No face model, no upload, no service: the arithmetic is local and it is shown below. It reads the photo's colour, which a lamp, a window or a shadow can move by a band — so the result is a proposal you confirm, never a measurement."
      />

            <div className="gl-row gl-row--tight pt-card__row">
              <PhotoPicker
                kind="baseline"
                album="Profile — tone read"
                label={shot ? 'Take or choose another front-lit photo' : 'Take or choose a front-lit photo'}
                onPick={(rows) => {
                  setShot(rows[rows.length - 1] ?? null);
                  setRead(null);
                  setApplied(false);
                }}
              />
            </div>

      {src ? (
        <div className="pt-stage" style={{ ['--frame' as string]: 'url(' + src + ')' }}>
          <img ref={imgRef} className="pt-stage__img" src={src} alt="The photo you are reading from" onLoad={() => setFault('')} />
          <div className="pt-stage__ellipse" style={frame} aria-hidden="true" />
          <div className="pt-stage__hud">
            <span>
              {read ? `${read.pixels} pixels · L* ${read.figures.L}` : 'ellipse over the cheek and jaw, away from hair and shadow'}
            </span>
          </div>
        </div>
      ) : null}

      <div className="pt-controls">
        <Field label="Ellipse across the face">
          <input type="range" min={10} max={90} step={1} value={centreX} onChange={(e) => setCentreX(Number(e.target.value))} aria-label="Ellipse horizontal position, percent" />
        </Field>
        <Field label="Ellipse down the face">
          <input type="range" min={10} max={90} step={1} value={centreY} onChange={(e) => setCentreY(Number(e.target.value))} aria-label="Ellipse vertical position, percent" />
        </Field>
        <Field label="Ellipse size">
          <input type="range" min={14} max={92} step={1} value={width} onChange={(e) => setWidth(Number(e.target.value))} aria-label="Ellipse width, percent of the photo" />
        </Field>
        <div className="gl-row gl-row--tight pt-controls__actions">
          <Button variant="gold" size="sm" onClick={() => void sample()}>Read the framed area</Button>
          {read ? <Button variant="ghost" size="sm" onClick={() => { setRead(null); setApplied(false); }}>Clear the read</Button> : null}
        </div>
      </div>

      {fault ? <div className="pt-fault">{fault}</div> : null}

      {read ? (
        <div className="pt-result">
          <div className="gl-row gl-row--tight">
            <Chip tone={read.skinTone.confidence > 0.6 ? 'gold' : 'info'}>{Math.round(read.skinTone.confidence * 100)}% on the band</Chip>
            <Chip tone={read.undertone.confidence > 0.6 ? 'gold' : 'info'}>{Math.round(read.undertone.confidence * 100)}% on the undertone</Chip>
          </div>

          <div className="gl-form-row">
            <Field label="Skin tone it proposes" hint={`L* ${read.figures.L} against the bands ${L_BOUNDS.map((b) => `${b.band} ${b.min}`).join(' · ')}`}>
              <Select value={pickedTone} onChange={setPickedTone} options={TONE_BANDS.map((o) => ({ value: o, label: o }))} />
            </Field>
            <Field label="Undertone it proposes" hint={`hue ${read.figures.hue}° at chroma ${read.figures.chroma}`}>
              <Select value={pickedUndertone} onChange={setPickedUndertone} options={UNDERTONES.map((o) => ({ value: o, label: o }))} placeholder="Not sure" />
            </Field>
          </div>

          <Meter label="How much of the framed area agreed" value={read.pixels > 400 ? 0.8 : read.pixels > 120 ? 0.55 : 0.3} max={1} />

          <ul className="pt-result__notes">
            <li>{describeRead(read)}.</li>
            {read.notes.map((n) => (
              <li key={n}>{n}.</li>
            ))}
          </ul>

          <div className="gl-row gl-row--tight">
            <Button variant="primary" size="sm" onClick={apply}>
              Use these two bands
            </Button>
            <span className="gl-small gl-faint">
              Writing them stamps your Appearance section with the figures above, so the screen can tell you later which photo they came from.
            </span>
          </div>
          {applied ? <Chip tone="gold">Saved to Appearance — you can change either band by hand.</Chip> : null}
        </div>
      ) : null}

      <Disclosure summary="What a photo cannot tell you">
        Shape of the face, jaw and cheekbone structure, eye position and spacing, skin texture, pores, sensitivity, reactions to products, hair pattern, and any diagnosis of any kind. There is no face model in this app, so those stay questions you answer. The two bands here are the only thing a plain photograph carries any weight about, and even they move with the light.
      </Disclosure>
    </Card>
  );
}
