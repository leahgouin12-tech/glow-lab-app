/**
 * THE GLOW LAB — GhostGuide (matched framing).
 *
 * Every before/after figure in this app depends on two photographs being
 * comparable, and the only thing this app knows about a photograph is what you
 * typed when you stored it. So this component does two things, both of which
 * are pure geometry, metadata and arithmetic:
 *
 *   1. "Line up" (before shooting) — shows the reference shot large with its
 *      recorded conditions, a short checklist built from those fields, and —
 *      where `navigator.mediaDevices.getUserMedia` genuinely exists and the user
 *      taps "Open camera" — a live mirrored preview with the reference ghosted
 *      over it. The crosshair and thirds lines are fixed DOM rules you align by
 *      eye. Nothing detects anything, and if the browser will not hand over a
 *      camera we say so in one plain line and fall back to the reference panel
 *      plus the ordinary file picker. There is no fake viewfinder here.
 *
 *   2. "Reconcile" (after picking, before anything is written) — previews the
 *      chosen file with the reference ghosted over it, or side by side, and
 *      reports which of the condition fields you just typed differ from the
 *      reference's. That read-out compares what you recorded, not what the two
 *      images look like, and says so.
 */
import '../styles/ghost.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Check, Columns2, Layers, X } from 'lucide-react';
import { formatDate } from '../db/repo';
import type { AnyRow } from '../db/schema';
import { Button, Chip, Range, Toggle } from './primitives';

/* ------------------------------------------------------------------ types */

/** The stored shot you are trying to reproduce. `src` is an object URL the
 *  caller already holds (see `useImageSrc`) — this component never opens a
 *  blob itself, so it can never leak one. `pose` is optional and means
 *  "the pose this new capture will be filed under", which the Face bench knows
 *  and other departments do not. */
export interface GhostReference {
  row: AnyRow;
  src: string;
  pose?: string;
}

/** A file the user has chosen but which has NOT been ingested yet. */
export interface GhostPreview {
  url: string;
  name: string;
  count: number;
}

/** Anything shaped like the four comparable capture fields. Both stored rows
 *  and the not-yet-saved values you typed fit. A key left `undefined` means
 *  "this side says nothing about that field" and is skipped, so a caller that
 *  has no pose concept never produces a phantom mismatch. */
export interface GhostFields {
  conditions?: unknown;
  pose?: unknown;
  lighting?: unknown;
  distance?: unknown;
  [key: string]: unknown;
}
export type GhostFieldKey = 'conditions' | 'pose' | 'lighting' | 'distance';

export interface ConditionRow {
  key: GhostFieldKey;
  label: string;
  /** what the reference recorded */
  from: string;
  /** what you are about to record */
  to: string;
  /** both sides hold the same non-empty value */
  same: boolean;
  /** at least one side recorded something — otherwise there is no comparison */
  recorded: boolean;
}

export const NOT_RECORDED = 'not recorded';

export const CONDITION_FIELDS: { key: GhostFieldKey; label: string }[] = [
  { key: 'conditions', label: 'Condition set' },
  { key: 'pose', label: 'Pose' },
  { key: 'lighting', label: 'Lighting' },
  { key: 'distance', label: 'Distance' }
];

const clean = (v: unknown) => (v === undefined || v === null ? '' : String(v).trim());

/**
 * Pure. Every comparable field that at least one side speaks about, with its
 * two recorded values and whether they agree. No pixels, no inference: if a
 * field was never written down it says so instead of guessing.
 */
export function conditionRows(reference?: GhostFields | null, candidate?: GhostFields | null): ConditionRow[] {
  const out: ConditionRow[] = [];
  for (const field of CONDITION_FIELDS) {
    const rawFrom = reference ? reference[field.key] : undefined;
    const rawTo = candidate ? candidate[field.key] : undefined;
    if (rawFrom === undefined && rawTo === undefined) continue;
    const from = clean(rawFrom);
    const to = clean(rawTo);
    out.push({
      key: field.key,
      label: field.label,
      from: from || NOT_RECORDED,
      to: to || NOT_RECORDED,
      same: Boolean(from) && from === to,
      recorded: Boolean(from) || Boolean(to)
    });
  }
  return out;
}

/**
 * Pure. The fields both sides could be compared on, where the incoming side
 * actually speaks about the field. A progress check-in has no pose at all, and
 * "the form never mentioned pose" is not a recorded difference.
 */
export function comparableRows(reference?: GhostFields | null, candidate?: GhostFields | null): ConditionRow[] {
  return conditionRows(reference, candidate).filter((r) => !candidate || candidate[r.key] !== undefined);
}

/**
 * Pure. The fields that genuinely conflict — differing values, or a value on
 * one side and nothing on the other. Fields neither side recorded are left out:
 * two blanks do not "differ". Map `.label` for the plain list of names.
 */
export function conditionDiff(reference?: GhostFields | null, candidate?: GhostFields | null): ConditionRow[] {
  return comparableRows(reference, candidate).filter((r) => !r.same && r.recorded);
}

/* -------------------------------------------------------------- camera talk */

export const NO_LIVE_PREVIEW =
  "This browser will not show a live preview here, so line up against the reference image and use the photo picker as usual.";

/** Honest, specific reason for a failed getUserMedia — never a generic spinner. */
export function cameraFailureMessage(err: unknown): string {
  const name = (err as { name?: string } | null)?.name ?? '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
    return 'Camera permission was declined, so there is no live preview. Line up against the reference image and use the photo picker as usual.';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
    return 'This device has no camera this page can reach, so there is no live preview. Line up against the reference image and use the photo picker as usual.';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError') {
    return 'The camera is busy in another app, so there is no live preview. Close that app or use the photo picker as usual.';
  }
  const detail = err instanceof Error && err.message ? `: ${err.message}` : '';
  return `This browser would not hand over a camera${detail}, so there is no live preview. Line up against the reference image and use the photo picker as usual.`;
}

/** True only where a live preview is actually reachable. */
export function canRequestCamera(): boolean {
  const md = (typeof navigator === 'undefined' ? undefined : navigator.mediaDevices) as
    | { getUserMedia?: unknown }
    | undefined;
  return typeof md?.getUserMedia === 'function';
}

/* --------------------------------------------------------------- component */

export function GhostGuide({
  mode,
  reference = null,
  preview = null,
  typed = null,
  onShot,
  ghostOpacity = 45,
  framingLines = true
}: {
  mode: 'lineup' | 'reconcile';
  reference?: GhostReference | null;
  /** reconcile only: the file that is about to be stored */
  preview?: GhostPreview | null;
  /** reconcile only: the condition values typed in the picker form */
  typed?: GhostFields | null;
  /** lineup only: offered when the host can accept a captured frame */
  onShot?: (files: File[]) => void;
  /** starting opacity of the ghosted reference, percent */
  ghostOpacity?: number;
  framingLines?: boolean;
}) {
  const row = reference?.row ?? null;
  const refSrc = reference?.src ?? '';

  const [opacity, setOpacity] = useState(ghostOpacity);
  const [lines, setLines] = useState(framingLines);
  const [view, setView] = useState<'ghost' | 'split'>('ghost');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [asking, setAsking] = useState(false);
  const [cameraNote, setCameraNote] = useState('');

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const stopCamera = useCallback(() => {
    const s = streamRef.current;
    if (s) {
      for (const t of s.getTracks()) t.stop();
    }
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setStream(null);
  }, []);

  /* closing this panel must not leave a camera burning */
  useEffect(() => stopCamera, [stopCamera]);

  /* attach after the <video> exists — jsdom and locked-down browsers simply
     never get here, because no stream is ever created */
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !stream) return;
    v.srcObject = stream;
    const played = v.play();
    if (played && typeof played.catch === 'function') played.catch(() => undefined);
  }, [stream]);

  const startCamera = async () => {
    setAsking(true);
    setCameraNote('');
    try {
      const md = navigator.mediaDevices as MediaDevices;
      const s = await md.getUserMedia({ video: { facingMode: 'user' }, audio: false });
      streamRef.current = s;
      setStream(s);
    } catch (err) {
      stopCamera();
      setCameraNote(cameraFailureMessage(err));
    } finally {
      setAsking(false);
    }
  };

  const capture = async () => {
    const v = videoRef.current;
    if (!v || !onShot) return;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = v.videoWidth || 720;
      canvas.height = v.videoHeight || 960;
      const ctx = canvas.getContext('2d');
      if (!ctx || !canvas.width || !canvas.height) throw new Error('no drawing canvas');
      // Stored unmirrored on purpose: the preview mirrors for framing, the file
      // keeps the orientation the sensor produced.
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.92));
      if (!blob || !blob.size) throw new Error('empty frame');
      onShot([new File([blob], `camera-frame-${Date.now()}.jpg`, { type: blob.type || 'image/jpeg' })]);
    } catch (err) {
      setCameraNote(
        `This browser would not hand the frame back (${err instanceof Error ? err.message : 'unknown reason'}), so nothing was stored — use the photo picker.`
      );
    }
  };

  const live = Boolean(stream);

  /* -------------------------------------------------- the fixed geometry */

  const grid = lines ? (
    <div className="gg__lines" aria-hidden="true">
      <i className="v" style={{ left: '33.333%' }} />
      <i className="v" style={{ left: '66.667%' }} />
      <i className="h" style={{ top: '33.333%' }} />
      <i className="h" style={{ top: '66.667%' }} />
      <i className="v axis" />
      <i className="h axis" />
      <span style={{ left: '50%', top: 'calc(50% + 6px)', transform: 'translateX(-50%)' }}>centre</span>
    </div>
  ) : null;

  const ghost = (what: string) => (
    <img src={refSrc} alt="" className="gg__media gg__media--ghost" style={{ opacity: what }} />
  );

  /* -------------------------------------------------------- no reference */

  if (!row) {
    return (
      <div className="gg" data-mode={mode}>
        <div className="gg__head">
          <span className="gl-eyebrow">{mode === 'lineup' ? 'Line up' : 'Reconcile'}</span>
          <Chip tone="info">No reference yet</Chip>
        </div>
        <div className="gg__fallback">
          <span>
            {mode === 'lineup'
              ? 'There is no stored shot to line up against yet — this app can only compare against a photograph it already has. Capture as usual and record the conditions; the next shot in this set will have something to match.'
              : 'There is no stored shot to check this one against yet. Nothing has been written and nothing has been measured — the conditions you typed still travel with the file, and the next capture in this set will have a reference.'}
          </span>
          <span className="gg__note" style={{ borderLeft: 0, paddingLeft: 0 }}>
            The conditions you record are the whole comparison. Glow Lab reads no pixels and detects nothing.
          </span>
        </div>
      </div>
    );
  }

  /* ------------------------------------------------------------- lineup */

  if (mode === 'lineup') {
    const checklist = [
      row.conditions
        ? <span>Condition set <b>{String(row.conditions)}</b> — the same pose and expression this file was labelled with.</span>
        : <span>The reference has no condition set recorded. Record yours anyway; it becomes the target for the next shot.</span>,
      row.lighting
        ? <span>Light: <b>{String(row.lighting)}</b>. Same source, same side of the room, same time of day where you can.</span>
        : <span>Lighting was never recorded on the reference, so treat this shot as the new standard and name it.</span>,
      row.distance
        ? <span>Lens distance: <b>{String(row.distance)}</b>. Same phone, no digital zoom — cropping is not the same as moving closer.</span>
        : <span>Distance was not recorded on the reference. Note yours so the next shot has something to match.</span>,
      <span>Phone at eye height, back camera where you can, feet planted — then fill the grid the way the reference does.</span>,
      <span>Taken {formatDate(String(row.takenOn ?? ''))} · {String(row.album || 'unfiled')}{row.pose ? ` · pose ${String(row.pose)}` : ''}</span>
    ];

    return (
      <div className="gg" data-mode="lineup">
        <div className="gg__head">
          <span className="gl-eyebrow">Line up with the last shot</span>
          <div className="gg__chips">
            <Chip tone="gold">{String(row.title || 'Untitled')}</Chip>
            <Chip>{String(row.conditions || `condition ${NOT_RECORDED}`)}</Chip>
            <Chip>{String(row.lighting || `lighting ${NOT_RECORDED}`)}</Chip>
            <Chip>{String(row.distance || `distance ${NOT_RECORDED}`)}</Chip>
            {row.pose ? <Chip>{`pose ${String(row.pose)}`}</Chip> : null}
            <Chip tone="info">{formatDate(String(row.takenOn ?? ''))}</Chip>
          </div>
        </div>

        <div className="gg__body">
          <div className="gg__stage">
            {live ? (
              <video
                ref={videoRef}
                className="gg__media gg__media--video"
                muted
                playsInline
                aria-label="Live camera preview, mirrored"
              />
            ) : null}
            {!live && refSrc ? <img src={refSrc} alt="The reference photograph" className="gg__media" /> : null}
            {live && refSrc ? ghost(`${opacity / 100}`) : null}
            {grid}
            {live ? (
              <span className="gg__badge">
                <i /> live · mirrored
              </span>
            ) : null}
            {!live && !refSrc ? (
              <div className="gg__none">
                <X size={16} />
                <span>
                  The stored photograph could not be opened by this browser, so only its recorded fields are shown below.
                  Your file is untouched — this is a display limit, not a data loss.
                </span>
              </div>
            ) : null}
          </div>

          <div className="gg__side">
            {canRequestCamera() ? (
              <div className="gg__actions">
                {live ? (
                  <>
                    <Button variant="ghost" size="sm" icon={<Layers size={14} />} onClick={stopCamera}>
                      Close the preview
                    </Button>
                    {onShot ? (
                      <Button variant="primary" size="sm" onClick={() => void capture()}>
                        Shoot this frame
                      </Button>
                    ) : null}
                  </>
                ) : (
                  <Button variant="ghost" size="sm" icon={<Camera size={14} />} onClick={() => void startCamera()} disabled={asking}>
                    {asking ? 'Asking this browser for the camera…' : 'Open camera'}
                  </Button>
                )}
              </div>
            ) : (
              <div className="gg__fallback">
                <span>{NO_LIVE_PREVIEW}</span>
              </div>
            )}
            {cameraNote ? <div className="gg__fallback">{cameraNote}</div> : null}
            {live ? (
              <p className="gg__note" style={{ marginBottom: 0 }}>
                The live view is mirrored so it behaves like a mirror; a frame you shoot here is stored unmirrored. It is
                a framing aid — nothing here finds your face, and the reference ghost is the same photograph you
                already stored, drawn at the opacity you set.
              </p>
            ) : null}

            {live ? (
              <Range
                label="Reference ghost"
                value={opacity}
                min={0}
                max={100}
                step={5}
                onChange={setOpacity}
                format={(v) => `${v}%`}
              />
            ) : null}
            <Toggle
              checked={lines}
              onChange={setLines}
              label="Framing lines"
              hint="A centre crosshair and the third lines, drawn at fixed positions. You align to them by eye — the app cannot see the frame."
            />

            {live && refSrc ? null : (
              <div className="gg__thumb">
                <span className="gl-label">Reference</span>
                {refSrc ? <img src={refSrc} alt="The reference photograph" /> : <span className="gg__note">No image available offline.</span>}
              </div>
            )}

            <ul className="gg__check">
              {checklist.map((item, i) => (
                <li key={i}>
                  <Check size={14} />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    );
  }

  /* ---------------------------------------------------------- reconcile */

  /** Only fields the form actually speaks about. A caller with no pose concept
   *  (a progress check-in) must not be told its pose "differs". */
  const compared = comparableRows(reference?.row ?? null, typed);
  const gaps = compared.filter((r) => !r.same && r.recorded);
  const matched = compared.filter((r) => r.same);

  return (
    <div className="gg gg--reconcile" data-mode="reconcile">
      <div className="gg__head">
        <span className="gl-eyebrow">Reconcile against the reference</span>
        <Chip tone={gaps.length ? 'moderate' : 'strong'}>{gaps.length ? `${gaps.length} recorded ${gaps.length === 1 ? 'field differs' : 'fields differ'}` : 'recorded fields match'}</Chip>
      </div>

      <div className="gg__body">
        <div className="gg__stage">
          {preview?.url ? <img src={preview.url} alt="The photograph you just chose" className="gg__media" /> : null}
          {view === 'ghost' && refSrc && preview?.url ? ghost(`${opacity / 100}`) : null}
          {grid}
          {!preview ? (
            <div className="gg__none">
              <Columns2 size={16} />
              <span>No file chosen yet — pick one and it appears here over the reference.</span>
            </div>
          ) : !preview.url ? (
            <div className="gg__none">
              <X size={16} />
              <span>
                This browser would not draw a preview of “{preview.name}”, so only the recorded-field check is available.
                The file itself is fine — nothing is stored until you confirm.
              </span>
            </div>
          ) : null}
        </div>

        <div className="gg__side">
          <div className="gg__actions">
            <Button
              variant={view === 'ghost' ? 'primary' : 'ghost'}
              size="sm"
              icon={<Layers size={14} />}
              onClick={() => setView('ghost')}
              disabled={!preview?.url || !refSrc}
            >
              Ghosted
            </Button>
            <Button
              variant={view === 'split' ? 'primary' : 'ghost'}
              size="sm"
              icon={<Columns2 size={14} />}
              onClick={() => setView('split')}
              disabled={!preview?.url}
            >
              Side by side
            </Button>
            <Toggle checked={lines} onChange={setLines} label="Framing lines" />
          </div>

          {view === 'ghost' && preview?.url && refSrc ? (
            <Range
              label="Reference ghost"
              value={opacity}
              min={0}
              max={100}
              step={5}
              onChange={setOpacity}
              format={(v) => `${v}%`}
            />
          ) : null}

          {view === 'split' && preview?.url ? (
            <div className="gg__split">
              <figure>
                {refSrc ? <img src={refSrc} alt="The reference photograph" /> : <span className="gg__note">Reference image unavailable offline.</span>}
                <figcaption>
                  reference · {formatDate(String(row.takenOn ?? ''))} · {String(row.title || 'Untitled')}
                </figcaption>
              </figure>
              <figure>
                <img src={preview.url} alt="The photograph you just chose" />
                <figcaption>
                  your new file · {preview.name}
                  {preview.count > 1 ? ` · 1 of ${preview.count}` : ''}
                </figcaption>
              </figure>
            </div>
          ) : null}

          {preview && preview.count > 1 && view === 'ghost' ? (
            <p className="gg__note" style={{ marginBottom: 0 }}>
              The preview is the first of {preview.count} files. Every one of them gets the conditions you recorded on
              this form.
            </p>
          ) : null}
        </div>
      </div>

      <div className="gg__readout">
        {compared.length ? (
          compared.map((r) => (
            <div className="gg__row" key={r.key}>
              <span className="gg__row-k">{r.label}</span>
              <span className="gg__row-v">
                <span className={r.same ? '' : 'gg__row-off'}>{r.from}</span>
                <em>→</em>
                <span>{r.to}</span>
              </span>
              <Chip tone={!r.recorded ? 'limited' : r.same ? 'strong' : 'moderate'}>
                {!r.recorded ? 'neither side recorded' : r.same ? 'same' : 'differs'}
              </Chip>
            </div>
          ))
        ) : (
          <div className="gg__row">
            <span className="gg__row-k">Fields</span>
            <span className="gg__row-v">Neither this file nor the reference carries a capture condition.</span>
            <Chip tone="limited">nothing to match</Chip>
          </div>
        )}
      </div>

      <p className="gg__note">
        <strong>This compares what you recorded, not what the two images look like.</strong> Glow Lab reads no pixels and
        runs no face model, so it cannot tell you whether the framing, distance or light actually match — only whether
        the labels agree.
        {gaps.length
          ? ` Differing: ${gaps.map((g) => `${g.label} (${g.from} vs ${g.to})`).join('; ')}. You can still store the shot: it will be filed as a different condition, and the comparison screens will say so.`
          : matched.length
            ? ' Everything you recorded agrees with the reference, which is what makes the pair comparable later.'
            : ''}
      </p>
    </div>
  );
}

export default GhostGuide;
