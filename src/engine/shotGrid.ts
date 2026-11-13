/**
 * THE GLOW LAB — N-shot same-framing capture grid (pure).
 *
 * The problem this exists for: one photograph per check-in means a progress
 * comparison is usually a front-lit morning frame measured against a
 * bathroom-lit night frame, and the honest answer the app can give is "those
 * two are not comparable". A capture sequence fixes that at the source — she
 * sets the framing up once and shoots a whole set, so every shot after the
 * first is lined up against the first.
 *
 * What lives here is only ordering, slotting and arithmetic over the text she
 * recorded. No React, no IndexedDB, no pixels. Comparability is delegated to
 * the one implementation the app already has (`conditionDiff` /
 * `comparableRows` in `ui/GhostGuide`), so a set cannot invent a stricter or
 * lazier rule than the rest of the screens use.
 *
 * The honest limit, stated in the UI and repeated here: a sequence guarantees
 * a shared *framing target* and shared *recorded conditions*. It cannot
 * guarantee the light, the time of day or the lens were actually the same,
 * because nothing in this app reads an image.
 */
import type { AnyRow } from '../db/schema';
import {
  comparableRows,
  conditionDiff,
  type ConditionRow,
  type GhostFields
} from '../ui/GhostGuide';

/* ------------------------------------------------------------------ shapes */

/** The five framings a slot can start on. `free` covers anything else. */
export type ShotKind = 'front' | 'side' | 'back' | 'detail' | 'free';

export interface ShotKindOption {
  value: ShotKind;
  /** the default label — she can overwrite it per slot */
  label: string;
  hint: string;
}

export const SHOT_KINDS: ShotKindOption[] = [
  { value: 'front', label: 'Front', hint: 'Facing the lens, eyes to camera.' },
  { value: 'side', label: 'Side', hint: 'One profile — the same side every shot.' },
  { value: 'back', label: 'Back', hint: 'Turned away: hair, shoulders, posture.' },
  { value: 'detail', label: 'Detail', hint: 'Close on one area — skin, jaw, hairline.' },
  { value: 'free', label: 'Free', hint: 'Anything else you want inside this set.' }
];

/** The selectable set sizes. Stated in the UI, not hidden in a constant. */
export const SHOT_TARGETS = [3, 4, 5, 6];
export const DEFAULT_SHOT_TARGET = 4;
export const MIN_SHOT_TARGET = SHOT_TARGETS[0];
export const MAX_SHOT_TARGET = SHOT_TARGETS[SHOT_TARGETS.length - 1];

/** The capture fields a progress check-in records. A check-in has no pose, and
 *  leaving `pose` out of the candidate side is what keeps `comparableRows` from
 *  reporting a field this department never asks about. */
export interface ShotFields {
  conditions: string;
  lighting: string;
  distance: string;
  pose?: string;
}

export interface ShotSlot {
  /** 1-based position in the grid — the order that survives into `mediaIds` */
  n: number;
  kind: ShotKind;
  /** editable, seeded from the kind */
  label: string;
  /** the stored mediaItems row once she shoots into this slot; null = empty */
  shot: AnyRow | null;
  /** what she recorded for it, kept so the notes read back without a row lookup */
  fields: ShotFields | null;
  /** capture order inside the group (1 = first shot taken); null = never captured */
  capturedAt: number | null;
}

export interface ShotGroup {
  target: number;
  /** slot number of the frame every other shot is lined up against, set by the
   *  first shot taken and only re-pointed if that shot is removed */
  anchor: number | null;
  /** monotonic capture counter, so `capturedAt` never collides */
  seq: number;
  slots: ShotSlot[];
}

export interface GroupMutation {
  group: ShotGroup;
  /** ids that are no longer referenced by any slot and can be deleted for good */
  displaced: string[];
}

/* ------------------------------------------------------------------- builders */

/** The existing refusal copy, verbatim, so the gate says one thing everywhere. */
export const CAPTURE_REFUSAL = 'Adding photographs is off — your existing library is untouched';

/**
 * Opening a set is the first place the privacy switch bites. Refused means no
 * group at all: no slots, no ids, nothing to store — the caller draws the
 * refusal and writes nothing.
 */
export function openSequence(
  target: number = DEFAULT_SHOT_TARGET,
  allowed: boolean = true
): { ok: boolean; group: ShotGroup | null; note: string } {
  if (!allowed) {
    return {
      ok: false,
      group: null,
      note: `${CAPTURE_REFUSAL}, so no sequence was started. Nothing was captured and nothing was written.`
    };
  }
  const group = createGroup(target);
  return {
    ok: true,
    group,
    note: `${group.target} empty slots. The first frame you shoot becomes the reference the rest are lined up against.`
  };
}

export function clampTarget(target: number): number {
  const n = Math.round(Number(target));
  if (!Number.isFinite(n)) return DEFAULT_SHOT_TARGET;
  return Math.max(MIN_SHOT_TARGET, Math.min(MAX_SHOT_TARGET, n));
}

export function labelForKind(kind: ShotKind): string {
  return SHOT_KINDS.find((k) => k.value === kind)?.label ?? 'Free';
}

/** The framing pattern a set of N shots opens with, one kind per slot. */
export function defaultKinds(target: number): ShotKind[] {
  const pattern: ShotKind[] = ['front', 'side', 'back', 'detail', 'free', 'free', 'free', 'free'];
  const n = clampTarget(target);
  return Array.from({ length: n }, (_v, i) => pattern[i] ?? 'free');
}

export function createGroup(target: number = DEFAULT_SHOT_TARGET): ShotGroup {
  const kinds = defaultKinds(target);
  return {
    target: kinds.length,
    anchor: null,
    seq: 0,
    slots: kinds.map((kind, i) => ({
      n: i + 1,
      kind,
      label: labelForKind(kind),
      shot: null,
      fields: null,
      capturedAt: null
    }))
  };
}

const clone = (group: ShotGroup): ShotGroup => ({
  ...group,
  slots: group.slots.map((s) => ({ ...s }))
});

const slotAt = (group: ShotGroup, n: number) => group.slots.find((s) => s.n === n) ?? null;

/* ---------------------------------------------------------------- ordering */

export function filledSlots(group: ShotGroup): ShotSlot[] {
  return group.slots.filter((s) => Boolean(s.shot));
}

export function filledCount(group: ShotGroup): number {
  return filledSlots(group).length;
}

export function isComplete(group: ShotGroup): boolean {
  return filledCount(group) >= group.target;
}

/** slot numbers she has not shot — reported, never papered over */
export function missingSlots(group: ShotGroup): number[] {
  return group.slots.filter((s) => !s.shot).map((s) => s.n);
}

export function nextOpenSlot(group: ShotGroup): number | null {
  return missingSlots(group)[0] ?? null;
}

/** Every shot's media id, in slot order, skipping empty slots. This is exactly
 *  what goes into `progressEntries.mediaIds` — one row per check-in, one id per
 *  frame, no placeholder ids for slots that were never shot. */
export function mediaIds(group: ShotGroup): string[] {
  return filledSlots(group)
    .slice()
    .sort((a, b) => a.n - b.n)
    .map((s) => String((s.shot as AnyRow).id));
}

/* -------------------------------------------------------------- mutations */

export interface CaptureResult extends GroupMutation {
  /** the same file already sits in another slot of this set */
  alreadyInSet: boolean;
  /** the slot already holds this very row, so capturing changes nothing */
  unchanged: boolean;
}

/**
 * Put a stored media row into slot `n`. Works for a first capture and for a
 * retake — a retake displaces only that slot's previous row and leaves every
 * other slot, and every other id, exactly where it was.
 */
export function captureShot(
  group: ShotGroup,
  n: number,
  shot: AnyRow,
  fields: ShotFields
): CaptureResult {
  const target = slotAt(group, n);
  if (!target) return { group, displaced: [], alreadyInSet: false, unchanged: true };

  const id = String(shot.id);
  const previous = target.shot ? String(target.shot.id) : null;
  if (previous === id) {
    // Same frame back into the same slot: keep the capture order, change nothing else.
    return { group, displaced: [], alreadyInSet: false, unchanged: true };
  }
  if (group.slots.some((s) => s.n !== n && s.shot && String(s.shot.id) === id)) {
    // One photograph cannot occupy two slots of the same set — the dedupe in
    // `ingestImage` means this is genuinely the same file, not a similar one.
    return { group, displaced: [], alreadyInSet: true, unchanged: true };
  }

  const next = clone(group);
  const slot = next.slots.find((s) => s.n === n) as ShotSlot;
  const seq = next.seq + 1;
  slot.shot = shot;
  slot.fields = { ...fields };
  slot.capturedAt = seq;
  next.seq = seq;
  if (next.anchor === null) next.anchor = n;

  const displaced = previous && previous !== id ? [previous] : [];
  return { group: next, displaced, alreadyInSet: false, unchanged: false };
}

/** Empty slot `n`, leaving a hole. Returns the id that became unreferenced. */
export function clearSlot(group: ShotGroup, n: number): GroupMutation {
  const target = slotAt(group, n);
  if (!target) return { group, displaced: [] };
  const next = clone(group);
  const slot = next.slots.find((s) => s.n === n) as ShotSlot;
  const displaced = slot.shot ? [String(slot.shot.id)] : [];
  slot.shot = null;
  slot.fields = null;
  slot.capturedAt = null;
  if (next.anchor === n) next.anchor = earliestCaptured(next)?.n ?? null;
  return { group: next, displaced };
}

export interface RenameResult {
  group: ShotGroup;
  reason: string;
}

/**
 * Change the size of the set. Growing appends the default framing for each new
 * slot. Shrinking is refused while a slot past the new end holds a shot — a
 * captured frame is never dropped to make a number fit.
 */
export function changeTarget(group: ShotGroup, target: number): RenameResult {
  const wanted = clampTarget(target);
  if (wanted === group.target) return { group, reason: '' };

  if (wanted > group.target) {
    const next = clone(group);
    next.target = wanted;
    for (let n = group.target + 1; n <= wanted; n += 1) {
      const kind = defaultKinds(wanted)[n - 1] ?? 'free';
      next.slots.push({ n, kind, label: labelForKind(kind), shot: null, fields: null, capturedAt: null });
    }
    return { group: next, reason: '' };
  }

  const dropped = group.slots.filter((s) => s.n > wanted && s.shot);
  if (dropped.length) {
    const names = dropped.map((s) => `shot ${s.n} (${s.label})`).join(', ');
    return {
      group,
      reason: `Shot ${dropped.length > 1 ? `${dropped.length} shots are` : 'A shot is'} already captured past that number — ${names}. Retake or clear ${dropped.length > 1 ? 'them' : 'it'} first, or leave the set at ${group.target}.`
    };
  }

  const next = clone(group);
  next.target = wanted;
  next.slots = next.slots.filter((s) => s.n <= wanted).map((s) => ({ ...s }));
  if (next.anchor !== null && next.anchor > wanted) next.anchor = earliestCaptured(next)?.n ?? null;
  return { group: next, reason: '' };
}

/** Set a slot's framing kind; the label follows the kind unless she retypes it. */
export function setSlotKind(group: ShotGroup, n: number, kind: ShotKind): ShotGroup {
  const next = clone(group);
  const slot = next.slots.find((s) => s.n === n);
  if (!slot) return group;
  slot.kind = kind;
  slot.label = labelForKind(kind);
  return next;
}

export function setSlotLabel(group: ShotGroup, n: number, label: string): ShotGroup {
  const next = clone(group);
  const slot = next.slots.find((s) => s.n === n);
  if (!slot) return group;
  slot.label = label.trim() ? label : labelForKind(slot.kind);
  return next;
}

/** Record what she says about this slot. Held whether or not the slot is shot
 *  yet, so the conditions can be set up before reaching for the camera. */
export function setSlotFields(group: ShotGroup, n: number, fields: ShotFields): ShotGroup {
  const next = clone(group);
  const slot = next.slots.find((s) => s.n === n);
  if (!slot) return group;
  slot.fields = { ...fields };
  return next;
}

/* ------------------------------------------------------------- the reference */

/** The earliest captured shot still in the set — the fallback anchor. */
export function earliestCaptured(group: ShotGroup): ShotSlot | null {
  const shots = filledSlots(group).filter((s) => s.capturedAt !== null);
  if (!shots.length) return null;
  return shots.slice().sort((a, b) => Number(a.capturedAt) - Number(b.capturedAt))[0];
}

/** The frame this set is lined up against: the first shot she took in it. */
export function referenceSlot(group: ShotGroup): ShotSlot | null {
  const anchor = group.anchor === null ? null : slotAt(group, group.anchor);
  if (anchor?.shot) return anchor;
  return earliestCaptured(group);
}

/**
 * What the camera should be framed against when capturing slot `n`.
 *
 *  - an empty slot with no reference shot yet → null, so the guide says plainly
 *    that there is nothing to line up against (the first shot of a set);
 *  - a retake of the reference slot → that slot's own current frame, because the
 *    point of a retake is to reproduce the frame it replaces;
 *  - any other slot → the reference shot, which is what makes the set internally
 *    comparable. A shot is never used as its own reference on a first capture.
 */
export function lineupSlot(group: ShotGroup, n: number): ShotSlot | null {
  const reference = referenceSlot(group);
  if (!reference?.shot) return null;
  if (reference.n === n) {
    const own = slotAt(group, n);
    return own?.shot ? own : null;
  }
  return reference;
}

/* ----------------------------------------------------------------- summary */

export interface ShotLine {
  n: number;
  label: string;
  captured: boolean;
  reference: boolean;
  /** fields both this shot and the reference actually speak about */
  rows: ConditionRow[];
  /** the recorded fields that genuinely conflict with the reference */
  diffs: ConditionRow[];
  mediaId: string | null;
}

export interface ShotSummary {
  target: number;
  captured: number;
  complete: boolean;
  holes: number[];
  reference: { n: number; label: string } | null;
  /** slot numbers recorded differently from the reference */
  differing: number[];
  lines: ShotLine[];
  /** how many she has versus the target */
  head: string;
  /** which shots differ, and on what, named */
  text: string;
  /** the honest limits of what a set guarantees */
  limits: string;
  /** whether anything can be stored at all yet */
  savable: boolean;
}

export const SHOT_GRID_LIMITS =
  'What a set guarantees is the framing target and the labels: every shot after the first was lined up against one reference frame, and the conditions you recorded for each travel with it. It does not guarantee the light, the time of day or the lens were the same — you control those, and Glow Lab reads no pixels, so it can only repeat what you wrote down. The shots inside one set are comparable with each other; two different sets, or a set and a casual selfie, are not.';

/**
 * The fields a capture set compares, read off a stored row. `pose` is left out
 * entirely unless the row actually recorded one: a progress check-in has no
 * pose concept, and an empty column is "this side says nothing about pose",
 * not a difference — which is exactly the rule `comparableRows` implements.
 */
export function compareFieldsOf(row: AnyRow | null | undefined): GhostFields | null {
  if (!row) return null;
  const out: Record<string, unknown> = {
    conditions: row.conditions ?? '',
    lighting: row.lighting ?? '',
    distance: row.distance ?? ''
  };
  const pose = String(row.pose ?? '').trim();
  if (pose) out.pose = pose;
  return out as GhostFields;
}

const listNames = (ns: number[]) =>
  ns.length < 2 ? `shot ${ns[0]}` : `shots ${ns.slice(0, -1).join(', ')} and ${ns[ns.length - 1]}`;

/**
 * The group's own condition read-out. Built entirely from `comparableRows` /
 * `conditionDiff` over the stored rows, so a set cannot claim a stricter rule
 * than the comparison screens next door.
 */
export function groupSummary(group: ShotGroup): ShotSummary {
  const reference = referenceSlot(group);
  const refFields = compareFieldsOf(reference?.shot ?? null);
  const holes = missingSlots(group);
  const captured = filledCount(group);

  const lines: ShotLine[] = group.slots.map((slot) => {
    const candidate = compareFieldsOf(slot.shot);
    const isReference = reference?.n === slot.n;
    return {
      n: slot.n,
      label: slot.label,
      captured: Boolean(slot.shot),
      reference: isReference,
      mediaId: slot.shot ? String(slot.shot.id) : null,
      rows: candidate && refFields ? comparableRows(refFields, candidate) : [],
      // the reference is never compared against itself — that would be a
      // difference the app invented out of one photograph
      diffs: candidate && refFields && !isReference ? conditionDiff(refFields, candidate) : []
    };
  });

  const differing = lines.filter((l) => l.captured && !l.reference && l.diffs.length).map((l) => l.n);

  const head =
    captured === 0
      ? 'No shot taken yet in this set. Nothing is stored until you capture at least one.'
      : captured < group.target
        ? `${captured} of ${group.target} shots captured — ${listNames(holes)} still empty. Saving now stores the ${captured} you took, in slot order, and leaves the empty slots empty: no placeholder frame is written for a shot you did not take.`
        : `All ${group.target} shots captured, in slot order: ${lines.map((l) => `${l.n} ${l.label}`).join(' · ')}.`;

  let text: string;
  if (!reference) {
    text = 'There is no reference frame in this set yet, so there is nothing to compare the shots against. The first shot you take becomes it.';
  } else if (captured < 2) {
    text = `Shot ${reference.n} (${reference.label}) is the reference for this set. One frame so far, so there is nothing in the set to compare it with yet.`;
  } else if (differing.length) {
    text = `Recorded differently from shot ${reference.n} (${reference.label}): ${lines
      .filter((l) => differing.includes(l.n))
      .map((l) => `shot ${l.n} (${l.label}) — ${l.diffs.map((d) => `${d.label}: ${d.from} vs ${d.to}`).join('; ')}`)
      .join('; ')}. That is what you typed when each shot was stored; those frames are not interchangeable with the reference.`;
  } else {
    text = `Shot ${reference.n} (${reference.label}) is the reference, and every other shot in the set records the same conditions, lighting and distance as it.`;
  }

  return {
    target: group.target,
    captured,
    complete: captured >= group.target,
    holes,
    reference: reference ? { n: reference.n, label: reference.label } : null,
    differing,
    lines,
    head,
    text,
    limits: SHOT_GRID_LIMITS,
    savable: captured > 0
  };
}

/** The slot order the entry row is written in, with the rows beside it. */
export function orderedShots(group: ShotGroup): { n: number; label: string; id: string; row: AnyRow }[] {
  return filledSlots(group)
    .slice()
    .sort((a, b) => a.n - b.n)
    .map((s) => ({ n: s.n, label: s.label, id: String(s.shot?.id), row: s.shot as AnyRow }));
}

export default groupSummary;
