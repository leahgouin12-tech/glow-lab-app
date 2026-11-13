/**
 * THE GLOW LAB — tests for the matched-framing guide (src/ui/GhostGuide.tsx).
 *
 * Two things are being protected here:
 *   1. `conditionDiff` is arithmetic over recorded text, so it is tested as a
 *      pure function — including the case where a field was never recorded,
 *      which must never come back as a "difference".
 *   2. the guide must stay honest when the browser has no camera: no fake
 *      viewfinder, one plain sentence, and the reference panel still works.
 *
 * Rendered with `createElement` rather than JSX so this stays a .ts file.
 */
import { act, createElement as h, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CONDITION_FIELDS,
  GhostGuide,
  NOT_RECORDED,
  NO_LIVE_PREVIEW,
  cameraFailureMessage,
  canRequestCamera,
  comparableRows,
  conditionDiff,
  conditionRows
} from '../ui/GhostGuide';
import { PhotoPicker } from '../ui/media';
import type { AnyRow } from '../db/schema';

/* ------------------------------------------------------------------ fixtures */

const row = (over: Record<string, unknown> = {}): AnyRow =>
  ({
    id: 'med_ref',
    createdAt: 1,
    updatedAt: 1,
    deletedAt: null,
    rev: 1,
    deviceId: 'test-device',
    tags: [],
    text: '',
    data: {},
    kind: 'baseline',
    album: 'Face — Front',
    title: 'Baseline — March',
    caption: '',
    blobId: 'blb_1',
    remoteUrl: '',
    width: 1200,
    height: 1600,
    takenOn: '2026-03-01',
    conditions: 'Front · neutral',
    pose: 'Front',
    lighting: 'Window light',
    distance: '60cm phone',
    linkedDomain: 'face',
    linkedIds: [],
    sourceKind: 'user',
    sourceUrl: '',
    attribution: '',
    license: 'User-owned',
    private: true,
    hash: 'hash-ref',
    star: false,
    ...over
  }) as AnyRow;

/** A row with every capture field left blank, as a casual import would look. */
const bare = (over: Record<string, unknown> = {}) => row({ conditions: '', pose: '', lighting: '', distance: '', ...over });

const reference = { row: row(), src: 'blob:reference-shot' };
const preview = { url: 'blob:chosen-file', name: 'IMG_0042.jpg', count: 1 };
/** Exactly what PhotoPicker hands over: the four values the form holds. */
const typedMatch = { conditions: 'Front · neutral', pose: 'Front', lighting: 'Window light', distance: '60cm phone' };
const typedDrift = { conditions: 'Front · neutral', pose: 'Front', lighting: 'Overhead indoor', distance: '30cm phone' };

/* ------------------------------------------------------------------- DOM kit */

const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

let container: HTMLDivElement;
let root: Root;
let mounted = false;

const text = () => container.textContent ?? '';
const buttons = () => [...container.querySelectorAll('button')];
const buttonWith = (label: string) =>
  buttons().find((b) => (b.textContent ?? '').trim().toLowerCase().includes(label.toLowerCase()));

async function show(el: ReactElement) {
  await act(async () => {
    root.render(el);
    await tick();
  });
  mounted = true;
}

async function click(node: Element | undefined) {
  if (!node) throw new Error('the control under test is not on screen');
  await act(async () => {
    (node as HTMLElement).click();
    await tick();
  });
}

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  mounted = false;
});

afterEach(() => {
  if (mounted) {
    act(() => root.unmount());
    mounted = false;
  }
  container.remove();
  document.documentElement.removeAttribute('data-motion');
});

/* ------------------------------------------------------- the comparison maths */

describe('conditionDiff', () => {
  it('says nothing when both shots recorded the same conditions', () => {
    expect(conditionDiff(row(), row({ id: 'med_new', takenOn: '2026-06-14' }))).toEqual([]);
  });

  it('names only the fields that genuinely conflict, in record order', () => {
    const gaps = conditionDiff(row(), row({ id: 'med_new', lighting: 'Overhead indoor', distance: '30cm phone' }));
    expect(gaps.map((g) => g.label)).toEqual(['Lighting', 'Distance']);
    expect(gaps[0]).toMatchObject({ from: 'Window light', to: 'Overhead indoor', same: false, recorded: true });
  });

  it('treats a value on one side and a blank on the other as a gap, and says so', () => {
    const gaps = conditionDiff(row(), row({ id: 'med_new', lighting: '' }));
    expect(gaps.map((g) => g.label)).toEqual(['Lighting']);
    expect(gaps[0].to).toBe(NOT_RECORDED);
  });

  it('never calls two blanks a difference', () => {
    expect(conditionDiff(bare(), bare({ id: 'med_new' }))).toEqual([]);
    const rows = conditionRows(bare(), bare({ id: 'med_new' }));
    expect(rows).toHaveLength(CONDITION_FIELDS.length);
    expect(rows.every((r) => !r.recorded && !r.same)).toBe(true);
  });

  it('skips a field the incoming side does not speak about, so a pose-less album is not a mismatch', () => {
    // Progress check-ins carry no pose at all: pose must drop out, not differ.
    const noPose = { conditions: 'Front · neutral', lighting: 'Window light', distance: '60cm phone' };
    expect(conditionDiff(row(), noPose)).toEqual([]);
    expect(comparableRows(row(), noPose).map((r) => r.key)).toEqual(['conditions', 'lighting', 'distance']);
    // the full table view still shows every field, which is what the compare
    // screens on the Face bench need
    expect(conditionRows(row(), noPose).map((r) => r.key)).toEqual(['conditions', 'pose', 'lighting', 'distance']);
  });

  it('reads the recorded text only — a missing reference side is reported, not guessed', () => {
    const gaps = conditionDiff(null, row({ id: 'med_new' }));
    expect(gaps.map((g) => g.label)).toEqual(['Condition set', 'Pose', 'Lighting', 'Distance']);
    expect(gaps.every((g) => g.from === NOT_RECORDED)).toBe(true);
    expect(conditionDiff(null, null)).toEqual([]);
  });

  it('ignores case-insensitive whitespace but not real wording, and never mutates its inputs', () => {
    const a = row();
    const b = row({ id: 'med_new', lighting: '  window light  ' });
    const before = JSON.stringify([a, b]);
    expect(conditionDiff(a, b).map((g) => g.label)).toEqual(['Lighting']);
    expect(conditionDiff(row(), row({ id: 'med_new', conditions: 'Left profile' })).map((g) => g.label)).toEqual([
      'Condition set'
    ]);
    expect(JSON.stringify([a, b])).toBe(before);
  });

  it('explains a refused or absent camera in one honest sentence per cause', () => {
    expect(cameraFailureMessage({ name: 'NotAllowedError' })).toContain('permission was declined');
    expect(cameraFailureMessage({ name: 'NotFoundError' })).toContain('no camera this page can reach');
    expect(cameraFailureMessage({ name: 'NotReadableError' })).toContain('busy in another app');
    expect(cameraFailureMessage(new Error('boom'))).toContain('would not hand over a camera');
    for (const msg of [NO_LIVE_PREVIEW, ...['NotAllowedError', 'NotFoundError', 'NotReadableError'].map(cameraFailureMessage)]) {
      expect(msg).toMatch(/photo picker|photo picker as usual|Close that app/);
    }
  });
});

/* ------------------------------------------------- the guide, without a camera */

describe('GhostGuide on a browser with no camera API', () => {
  it('has no camera to ask for in this environment', () => {
    expect(canRequestCamera()).toBe(false);
    expect(navigator.mediaDevices).toBeUndefined();
  });

  it('renders the reference, its recorded fields and the honest fallback line — and no fake viewfinder', async () => {
    await show(h(GhostGuide, { mode: 'lineup', reference }));
    expect(text()).toContain(NO_LIVE_PREVIEW);
    expect(buttonWith('Open camera')).toBeUndefined();
    expect(container.querySelector('video')).toBeNull();
    expect(container.querySelector('img[src="blob:reference-shot"]')).not.toBeNull();
    expect(text()).toContain('Baseline — March');
    expect(text()).toContain('Window light');
    expect(text()).toContain('60cm phone');
    expect(text()).toContain('Front');
  });

  it('draws the framing geometry in the DOM and switches it off from its own control', async () => {
    await show(h(GhostGuide, { mode: 'lineup', reference }));
    expect(container.querySelectorAll('.gg__lines i').length).toBeGreaterThanOrEqual(6);
    await click(buttonWith('Framing lines'));
    expect(container.querySelector('.gg__lines')).toBeNull();
    await click(buttonWith('Framing lines'));
    expect(container.querySelectorAll('.gg__lines i').length).toBeGreaterThanOrEqual(6);
  });

  it('renders without a reference instead of throwing, in both modes', async () => {
    await show(h(GhostGuide, { mode: 'lineup', reference: null }));
    expect(text()).toContain('no stored shot to line up against yet');
    expect(container.querySelector('input[type="range"]')).toBeNull();

    await show(h(GhostGuide, { mode: 'reconcile', reference: null, preview, typed: typedMatch }));
    expect(text()).toContain('no stored shot to check this one against yet');
    expect(text()).toContain('reads no pixels');
  });

  it('reconciles typed values against the reference before anything is stored', async () => {
    await show(h(GhostGuide, { mode: 'reconcile', reference, preview, typed: typedDrift }));
    expect(text()).toContain('2 recorded fields differ');
    expect(text()).toContain('Differing: Lighting (Window light vs Overhead indoor); Distance (60cm phone vs 30cm phone)');
    expect(text()).toContain('This compares what you recorded, not what the two images look like');
    expect(container.querySelector('img[src="blob:chosen-file"]')).not.toBeNull();
  });

  it('says so plainly when the record does match', async () => {
    await show(h(GhostGuide, { mode: 'reconcile', reference, preview, typed: typedMatch }));
    expect(text()).toContain('recorded fields match');
    expect(text()).toContain('Everything you recorded agrees with the reference');
  });

  it('switches between the ghosted overlay and the side-by-side view', async () => {
    await show(h(GhostGuide, { mode: 'reconcile', reference, preview, typed: typedMatch }));
    expect(container.querySelector('.gg__media--ghost')).not.toBeNull();
    expect(container.querySelector('.gg__split')).toBeNull();
    await click(buttonWith('Side by side'));
    expect(container.querySelectorAll('.gg__split img').length).toBe(2);
    expect(container.querySelector('.gg__media--ghost')).toBeNull();
    expect(text()).toContain('IMG_0042.jpg');
  });

  it('works the same with motion reduced and with motion left at full', async () => {
    for (const motion of ['reduced', 'full']) {
      document.documentElement.dataset.motion = motion;
      await show(h(GhostGuide, { mode: 'lineup', reference }));
      expect(text()).toContain(NO_LIVE_PREVIEW);
      expect(buttonWith('Framing lines')).toBeTruthy();
      await show(h(GhostGuide, { mode: 'reconcile', reference, preview, typed: typedDrift }));
      expect(text()).toContain('2 recorded fields differ');
    }
  });
});

/* -------------------------------------------- the guide where a camera exists */

describe('GhostGuide where getUserMedia is available', () => {
  /** jsdom implements neither of these; both are needed for the live branch. */
  const stubMedia = (getUserMedia: () => Promise<unknown>) => {
    vi.stubGlobal('navigator', { onLine: true, mediaDevices: { getUserMedia } });
    HTMLMediaElement.prototype.play = () => Promise.resolve();
  };

  it('offers the camera, then falls back honestly when permission is declined', async () => {
    const getUserMedia = vi.fn(() => Promise.reject(Object.assign(new Error('Permission denied'), { name: 'NotAllowedError' })));
    stubMedia(getUserMedia as unknown as () => Promise<unknown>);
    expect(canRequestCamera()).toBe(true);

    await show(h(GhostGuide, { mode: 'lineup', reference }));
    await click(buttonWith('Open camera'));

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(text()).toContain('Camera permission was declined, so there is no live preview');
    expect(container.querySelector('video')).toBeNull();
    expect(container.querySelector('img[src="blob:reference-shot"]')).not.toBeNull();
  });

  it('names the reason when no camera can be reached', async () => {
    const getUserMedia = vi.fn(() => Promise.reject(Object.assign(new Error('not found'), { name: 'NotFoundError' })));
    stubMedia(getUserMedia as unknown as () => Promise<unknown>);
    await show(h(GhostGuide, { mode: 'lineup', reference }));
    await click(buttonWith('Open camera'));
    expect(text()).toContain('no camera this page can reach');
  });

  it('shows the mirrored preview over the reference and releases every track on close', async () => {
    const stopped: string[] = [];
    const stream = {
      getTracks: () => [{ kind: 'video', stop: () => stopped.push('video') }],
      getVideoTracks: () => []
    };
    const getUserMedia = vi.fn(() => Promise.resolve(stream));
    stubMedia(getUserMedia as unknown as () => Promise<unknown>);

    await show(h(GhostGuide, { mode: 'lineup', reference }));
    await click(buttonWith('Open camera'));

    const video = container.querySelector('video');
    expect(video).not.toBeNull();
    expect(text()).toContain('live · mirrored');
    expect(container.querySelector('.gg__media--ghost')).not.toBeNull();
    expect(container.querySelector('input[type="range"]')).not.toBeNull();

    await click(buttonWith('Close the preview'));
    expect(stopped).toEqual(['video']);
    expect(container.querySelector('video')).toBeNull();
  });
});

/* -------------------------------------------------- PhotoPicker opt-in gate */

describe('PhotoPicker with the guide switched on', () => {
  it('stays exactly as it was for callers that pass no reference', async () => {
    await show(h(PhotoPicker, { kind: 'baseline', withConditions: true, standard: true, onPick: () => undefined }));
    expect(buttonWith('Line up first')).toBeUndefined();
    expect(text()).toContain('Add photograph');
    expect(container.querySelector('.gg')).toBeNull();
  });

  it('offers the line-up affordance and opens the reference panel from it', async () => {
    await show(
      h(PhotoPicker, {
        kind: 'baseline',
        withConditions: true,
        standard: true,
        label: 'Capture or import for “Front”',
        reference,
        onPick: () => undefined
      })
    );
    expect(buttonWith('Line up first')).toBeTruthy();
    expect(text()).toContain('Reproduce the shot stored as “Baseline — March”');

    await click(buttonWith('Line up first'));
    expect(container.querySelector('.gg[data-mode="lineup"]')).not.toBeNull();
    expect(text()).toContain(NO_LIVE_PREVIEW);
    expect(container.querySelectorAll('.gg__check li').length).toBeGreaterThanOrEqual(5);
  });

  it('says the set is empty rather than pretending there is a reference', async () => {
    await show(h(PhotoPicker, { kind: 'progress', standard: true, reference: null, onPick: () => undefined }));
    expect(text()).toContain('Nothing is stored in this set yet');
    await click(buttonWith('Line up first'));
    expect(text()).toContain('no stored shot to line up against yet');
  });
});
