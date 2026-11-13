/**
 * THE GLOW LAB — the N-shot capture grid as arithmetic.
 *
 * Nothing here touches a DOM, a blob or IndexedDB: a "shot" is a row-shaped
 * object the component would have got back from `ingestImage`, and what is
 * under test is ordering, slotting and the comparability statement the set
 * carries. The comparison itself is `conditionDiff`'s, imported from
 * `ui/GhostGuide`, so a set can never claim a rule the rest of the app does
 * not use — the last describe block pins that too.
 */
import { describe, expect, it } from 'vitest';
import type { AnyRow } from '../db/schema';
import { conditionDiff } from '../ui/GhostGuide';
import {
  CAPTURE_REFUSAL,
  DEFAULT_SHOT_TARGET,
  MAX_SHOT_TARGET,
  MIN_SHOT_TARGET,
  SHOT_GRID_LIMITS,
  SHOT_KINDS,
  SHOT_TARGETS,
  captureShot,
  changeTarget,
  clampTarget,
  clearSlot,
  createGroup,
  defaultKinds,
  filledCount,
  groupSummary,
  isComplete,
  labelForKind,
  lineupSlot,
  mediaIds,
  missingSlots,
  nextOpenSlot,
  openSequence,
  orderedShots,
  referenceSlot,
  setSlotKind,
  setSlotLabel,
  type ShotGroup
} from '../engine/shotGrid';

/* ------------------------------------------------------------------ fixtures */

/** A mediaItems row shaped like what `ingestImage` hands back. */
const shot = (id: string, over: Record<string, unknown> = {}): AnyRow =>
  ({
    id,
    kind: 'progress',
    album: 'Progress',
    title: `Shot ${id}`,
    blobId: `blb_${id}`,
    takenOn: '2026-11-12',
    conditions: 'Front · neutral',
    pose: '',
    lighting: 'Window light',
    distance: '60cm phone',
    deletedAt: null,
    ...over
  } as unknown as AnyRow);

const FIELDS = { conditions: 'Front · neutral', lighting: 'Window light', distance: '60cm phone' };
const drift = (over: Partial<typeof FIELDS> = {}) => ({ ...FIELDS, ...over });

/** Fill slots `ns` of a fresh group, in the order given. */
function fill(group: ShotGroup, ns: number[], rows?: Record<number, AnyRow>): ShotGroup {
  let g = group;
  ns.forEach((n, i) => {
    const row = rows?.[n] ?? shot(`med_${n}`);
    g = captureShot(g, n, row, drift({ conditions: n === 1 ? 'Front · neutral' : 'Progress check' })).group;
    void i;
  });
  return g;
}

/* ---------------------------------------------------------------- the shapes */

describe('a capture set is built before anything is shot', () => {
  it('offers only 3, 4, 5 or 6 shots and defaults to four', () => {
    expect(SHOT_TARGETS).toEqual([3, 4, 5, 6]);
    expect(MIN_SHOT_TARGET).toBe(3);
    expect(MAX_SHOT_TARGET).toBe(6);
    expect(DEFAULT_SHOT_TARGET).toBe(4);
    expect(createGroup().slots.map((s) => s.n)).toEqual([1, 2, 3, 4]);
    expect(createGroup(6).slots.map((s) => s.n)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('clamps a number outside the stated limit instead of inventing a grid', () => {
    expect(clampTarget(1)).toBe(3);
    expect(clampTarget(9)).toBe(6);
    expect(clampTarget(4.4)).toBe(4);
    expect(clampTarget(Number.NaN)).toBe(DEFAULT_SHOT_TARGET);
  });

  it('opens each size with a sensible framing pattern and editable labels', () => {
    expect(defaultKinds(3)).toEqual(['front', 'side', 'back']);
    expect(defaultKinds(4)).toEqual(['front', 'side', 'back', 'detail']);
    expect(defaultKinds(5)).toEqual(['front', 'side', 'back', 'detail', 'free']);
    expect(defaultKinds(6)).toEqual(['front', 'side', 'back', 'detail', 'free', 'free']);
    expect(SHOT_KINDS.map((k) => k.value)).toEqual(['front', 'side', 'back', 'detail', 'free']);
    const g = createGroup(4);
    expect(g.slots.map((s) => s.label)).toEqual(['Front', 'Side', 'Back', 'Detail']);
    expect(g.slots.every((s) => s.shot === null && s.capturedAt === null)).toBe(true);
    expect(g.anchor).toBeNull();
  });

  it('keeps the label editable and resets it when the framing kind changes', () => {
    let g = setSlotLabel(createGroup(4), 2, 'Left profile, chin down');
    expect(g.slots[1].label).toBe('Left profile, chin down');
    expect(g.slots[1].kind).toBe('side');
    // a blank label is not a label: the kind default comes back
    g = setSlotLabel(g, 2, '   ');
    expect(g.slots[1].label).toBe('Side');
    g = setSlotKind(g, 2, 'detail');
    expect(g.slots[1].kind).toBe('detail');
    expect(g.slots[1].label).toBe(labelForKind('detail'));
    expect(setSlotKind(g, 99, 'front')).toBe(g);
  });
});

/* -------------------------------------------------------------- slot order */

describe('shots land in slots and the slots keep their order', () => {
  it('fills every slot of a complete set and reports nothing missing', () => {
    const g = fill(createGroup(4), [1, 2, 3, 4], {
      1: shot('med_a'),
      2: shot('med_b'),
      3: shot('med_c'),
      4: shot('med_d')
    });
    expect(filledCount(g)).toBe(4);
    expect(isComplete(g)).toBe(true);
    expect(missingSlots(g)).toEqual([]);
    expect(nextOpenSlot(g)).toBeNull();
    expect(mediaIds(g)).toEqual(['med_a', 'med_b', 'med_c', 'med_d']);
    expect(orderedShots(g).map((s) => `${s.n}:${s.label}:${s.id}`)).toEqual([
      '1:Front:med_a',
      '2:Side:med_b',
      '3:Back:med_c',
      '4:Detail:med_d'
    ]);
  });

  it('writes mediaIds in slot order, not in the order she happened to shoot', () => {
    // she shoots the detail first, then front, back, side
    const g = fill(createGroup(4), [4, 1, 3, 2], {
      1: shot('med_front'),
      2: shot('med_side'),
      3: shot('med_back'),
      4: shot('med_detail')
    });
    expect(mediaIds(g)).toEqual(['med_front', 'med_side', 'med_back', 'med_detail']);
    expect(orderedShots(g).map((s) => s.n)).toEqual([1, 2, 3, 4]);
    // capture order is remembered separately, and the first shot taken is shot 4
    expect(g.slots.find((s) => s.n === 4)?.capturedAt).toBe(1);
    expect(g.slots.find((s) => s.n === 2)?.capturedAt).toBe(4);
  });

  it('does not mutate the group it was given', () => {
    const before = createGroup(3);
    const snapshot = JSON.stringify(before);
    fill(before, [1, 2, 3]);
    expect(JSON.stringify(before)).toBe(snapshot);
  });
});

/* ------------------------------------------------------------ partial sets */

describe('a half-shot set saves as what was actually shot', () => {
  const one = fill(createGroup(4), [2], { 2: shot('med_only') });

  it('allows saving at a single shot and says so versus the target', () => {
    const s = groupSummary(one);
    expect(s.savable).toBe(true);
    expect(s.captured).toBe(1);
    expect(s.complete).toBe(false);
    expect(s.holes).toEqual([1, 3, 4]);
    expect(s.head).toContain('1 of 4 shots captured');
    expect(s.head).toContain('shots 1, 3 and 4 still empty');
    expect(s.head).toContain('no placeholder frame is written for a shot you did not take');
    expect(mediaIds(one)).toEqual(['med_only']);
    expect(nextOpenSlot(one)).toBe(1);
  });

  it('allows saving one short of the target and names the one empty slot', () => {
    const g3 = fill(createGroup(4), [1, 2, 4], { 1: shot('m1'), 2: shot('m2'), 4: shot('m4') });
    const s = groupSummary(g3);
    expect(s.captured).toBe(3);
    expect(s.holes).toEqual([3]);
    expect(s.head).toContain('3 of 4 shots captured — shot 3 still empty');
    expect(s.head).toContain('stores the 3 you took, in slot order');
    expect(mediaIds(g3)).toEqual(['m1', 'm2', 'm4']);
  });

  it('reports an untouched set as nothing stored, not as zero of something', () => {
    const s = groupSummary(createGroup(5));
    expect(s.savable).toBe(false);
    expect(s.captured).toBe(0);
    expect(s.head).toContain('No shot taken yet');
    expect(s.reference).toBeNull();
    expect(s.text).toContain('The first shot you take becomes it');
    expect(mediaIds(createGroup(5))).toEqual([]);
  });

  it('says the set is complete when it is exactly at target', () => {
    const g = fill(createGroup(3), [1, 2, 3]);
    const s = groupSummary(g);
    expect(s.complete).toBe(true);
    expect(s.holes).toEqual([]);
    expect(s.head).toContain('All 3 shots captured, in slot order: 1 Front · 2 Side · 3 Back');
  });
});

/* ------------------------------------------------------------------ retakes */

describe('a retake replaces its own slot and nothing else', () => {
  const base = fill(createGroup(4), [1, 2, 3, 4], {
    1: shot('med_1'),
    2: shot('med_2'),
    3: shot('med_3'),
    4: shot('med_4')
  });

  it('swaps one id, keeps the other three in place, and hands back the id to delete', () => {
    const res = captureShot(base, 3, shot('med_3b'), drift({ lighting: 'Overhead indoor' }));
    expect(res.displaced).toEqual(['med_3']);
    expect(mediaIds(res.group)).toEqual(['med_1', 'med_2', 'med_3b', 'med_4']);
    expect(res.group.slots.filter((s) => s.shot && s.n !== 3).map((s) => String(s.shot?.id))).toEqual([
      'med_1',
      'med_2',
      'med_4'
    ]);
    expect(res.group.anchor).toBe(1);
    // the retake is the newest frame in the set, but the reference is still shot 1
    expect(res.group.slots[2].capturedAt).toBe(5);
    expect(referenceSlot(res.group)?.n).toBe(1);
  });

  it('does not report a displacement when the same file comes back', () => {
    const res = captureShot(base, 2, shot('med_2'), FIELDS);
    expect(res.unchanged).toBe(true);
    expect(res.displaced).toEqual([]);
    expect(res.alreadyInSet).toBe(false);
    expect(res.group).toBe(base);
    expect(mediaIds(res.group)).toEqual(['med_1', 'med_2', 'med_3', 'med_4']);
  });

  it('flags a frame that already sits in another slot of the same set', () => {
    const res = captureShot(base, 4, shot('med_2'), FIELDS);
    expect(res.alreadyInSet).toBe(true);
    expect(mediaIds(res.group)).toEqual(['med_1', 'med_2', 'med_3', 'med_4']);
  });

  it('refuses to write into a slot number the set does not have', () => {
    const res = captureShot(createGroup(3), 7, shot('med_x'), FIELDS);
    expect(res.group.slots).toHaveLength(3);
    expect(mediaIds(res.group)).toEqual([]);
  });
});

/* --------------------------------------------------------------- the anchor */

describe('the first shot of the set is the reference', () => {
  it('gives no reference at all while the set is empty', () => {
    const g = createGroup(4);
    expect(referenceSlot(g)).toBeNull();
    expect(lineupSlot(g, 1)).toBeNull();
  });

  it('makes the shot just taken the reference for every later slot', () => {
    const g = fill(createGroup(4), [1], { 1: shot('med_ref') });
    expect(referenceSlot(g)?.n).toBe(1);
    expect(String(lineupSlot(g, 2)?.shot?.id)).toBe('med_ref');
    expect(String(lineupSlot(g, 4)?.shot?.id)).toBe('med_ref');
  });

  it('never uses a shot as the reference for its own first capture', () => {
    const empty = createGroup(4);
    // slot 1 is empty and slot 2 holds the reference: filling slot 1 must not
    // line up against slot 1 (nothing there), it lines up against the anchor
    const g = fill(empty, [2], { 2: shot('med_second') });
    expect(g.anchor).toBe(2);
    expect(lineupSlot(g, 1)?.n).toBe(2);
    // a retake of the anchor lines up against the frame it replaces, and after
    // the retake the anchor is still slot 2 — it is never replaced by itself
    const re = captureShot(g, 2, shot('med_second_b'), FIELDS);
    expect(re.group.anchor).toBe(2);
    expect(referenceSlot(re.group)?.n).toBe(2);
    expect(String(lineupSlot(re.group, 3)?.shot?.id)).toBe('med_second_b');
    // while slot 2 is empty there is no reference for slot 2 itself
    expect(lineupSlot(clearSlot(g, 2).group, 2)).toBeNull();
  });

  it('re-points the reference to the next-earliest shot when the anchor is cleared', () => {
    const g = fill(createGroup(4), [1, 2, 3], { 1: shot('m1'), 2: shot('m2'), 3: shot('m3') });
    const cleared = clearSlot(g, 1);
    expect(cleared.displaced).toEqual(['m1']);
    expect(cleared.group.anchor).toBe(2);
    expect(referenceSlot(cleared.group)?.n).toBe(2);
    expect(lineupSlot(cleared.group, 2)?.n).toBe(2);
    expect(lineupSlot(cleared.group, 4)?.n).toBe(2);
  });

  it('leaves a hole where the cleared shot was instead of shuffling the grid', () => {
    const g = fill(createGroup(4), [1, 2, 3, 4]);
    const cleared = clearSlot(g, 2);
    expect(cleared.group.slots.map((s) => s.n)).toEqual([1, 2, 3, 4]);
    expect(cleared.group.slots[1].shot).toBeNull();
    expect(mediaIds(cleared.group)).toEqual(['med_1', 'med_3', 'med_4']);
    expect(missingSlots(cleared.group)).toEqual([2]);
    expect(nextOpenSlot(cleared.group)).toBe(2);
    expect(groupSummary(cleared.group).head).toContain('3 of 4 shots captured — shot 2 still empty');
  });
});

/* --------------------------------------------------------- changing the size */

describe('the target count can be raised and lowered', () => {
  it('grows by appending the default framing for the new slots', () => {
    const res = changeTarget(fill(createGroup(3), [1, 2, 3]), 5);
    expect(res.reason).toBe('');
    expect(res.group.target).toBe(5);
    expect(res.group.slots.map((s) => s.kind)).toEqual(['front', 'side', 'back', 'detail', 'free']);
    expect(mediaIds(res.group)).toEqual(['med_1', 'med_2', 'med_3']);
    expect(res.group.anchor).toBe(1);
    expect(isComplete(res.group)).toBe(false);
  });

  it('shrinks by dropping only slots that are still empty', () => {
    const g = fill(createGroup(5), [1, 2]);
    const res = changeTarget(g, 4);
    expect(res.reason).toBe('');
    expect(res.group.slots.map((s) => s.n)).toEqual([1, 2, 3, 4]);
    expect(res.group.slots.every((s) => s.n <= 4)).toBe(true);
    expect(mediaIds(res.group)).toEqual(['med_1', 'med_2']);
    expect(groupSummary(res.group).captured).toBe(2);
  });

  it('refuses to lower the target across a captured frame', () => {
    const g = fill(createGroup(6), [1, 2, 5, 6]);
    const res = changeTarget(g, 4);
    expect(res.group).toBe(g);
    expect(res.reason).toContain('already captured past that number');
    expect(res.reason).toContain('shot 5 (Free)');
    expect(res.reason).toContain('Retake or clear them first, or leave the set at 6');
    expect(mediaIds(res.group)).toEqual(['med_1', 'med_2', 'med_5', 'med_6']);
  });

  it('accepts the target it already has', () => {
    const g = createGroup(4);
    expect(changeTarget(g, 4).group).toBe(g);
    expect(changeTarget(g, 4).reason).toBe('');
  });

  it('clamps a target typed outside 3 to 6', () => {
    expect(changeTarget(createGroup(3), 99).group.target).toBe(6);
    expect(changeTarget(createGroup(6), 1).group.target).toBe(3);
  });
});

/* ------------------------------------------------------------- conditions */

describe('the set carries its own condition notes', () => {
  const ref = shot('med_ref', { conditions: 'Front · neutral', lighting: 'Window light', distance: '60cm phone' });
  const same = shot('med_same');
  const drifted = shot('med_drift', { lighting: 'Overhead indoor', distance: '30cm phone' });

  it('names the fields of shots that differ from the reference, by name and value', () => {
    const g = fill(createGroup(3), [1, 2], { 1: ref, 2: drifted });
    const s = groupSummary(g);
    expect(s.differing).toEqual([2]);
    const line = s.lines[1];
    expect(line.diffs.map((d) => d.label)).toEqual(['Lighting', 'Distance']);
    expect(s.text).toContain('shot 2 (Side) — Lighting: Window light vs Overhead indoor; Distance: 60cm phone vs 30cm phone');
    expect(s.text).toContain('those frames are not interchangeable with the reference');
  });

  it('says nothing differs when the records agree', () => {
    const g = fill(createGroup(3), [1, 2], { 1: ref, 2: same });
    const s = groupSummary(g);
    expect(s.differing).toEqual([]);
    expect(s.lines[1].diffs).toEqual([]);
    expect(s.lines[1].rows.map((r) => r.key)).toEqual(['conditions', 'lighting', 'distance']);
    expect(s.text).toContain('every other shot in the set records the same conditions, lighting and distance');
  });

  it('never reports a pose the department does not record as a difference', () => {
    // both rows carry pose '' because the mediaItems column exists; an empty
    // field both sides say nothing about is not a conflict
    const g = fill(createGroup(3), [1, 2], { 1: ref, 2: same });
    expect(groupSummary(g).lines[1].rows.some((r) => r.key === 'pose')).toBe(false);
    expect(conditionDiff(ref, same).map((d) => d.label)).toEqual([]);
  });

  it('does not compare the reference against itself', () => {
    const g = fill(createGroup(3), [1, 2], { 1: ref, 2: same });
    const anchor = groupSummary(g).lines[0];
    expect(anchor.reference).toBe(true);
    expect(anchor.diffs).toEqual([]);
    expect(anchor.rows.map((r) => r.key)).toEqual(['conditions', 'lighting', 'distance']);
    expect(anchor.rows.every((r) => r.same)).toBe(true);
  });

  it('states the limits of the guarantee in the summary', () => {
    const s = groupSummary(fill(createGroup(3), [1, 2], { 1: ref, 2: drifted }));
    expect(s.limits).toBe(SHOT_GRID_LIMITS);
    expect(s.limits).toContain('reads no pixels');
    expect(s.limits).toContain('The shots inside one set are comparable with each other');
  });
});

/* ---------------------------------------------------------------- the gate */

describe('a refused capture starts nothing', () => {
  it('produces no group at all when photographs cannot be added', () => {
    const res = openSequence(4, false);
    expect(res.ok).toBe(false);
    expect(res.group).toBeNull();
    expect(res.note).toContain(CAPTURE_REFUSAL);
    expect(res.note).toContain('no sequence was started');
    expect(res.note).toContain('nothing was written');
    expect(mediaIds(createGroup(4))).toEqual([]);
  });

  it('opens an empty grid of the requested size when capture is allowed', () => {
    const res = openSequence(5, true);
    expect(res.ok).toBe(true);
    expect(res.group?.slots).toHaveLength(5);
    expect(res.group?.anchor).toBeNull();
    expect(res.note).toContain('5 empty slots');
  });
});
