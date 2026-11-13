import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QuickRate } from '../ui/QuickRate';
import type { AnyRow } from '../db/schema';

/**
 * The rater is the taste loop: every tap has to reach the interaction log
 * exactly once, advance, and be reversible. These tests drive the real keys and
 * buttons rather than the handlers, so a renamed control fails here.
 */

let container: HTMLDivElement;
let root: Root;
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const settle = async (rounds = 3) => {
  for (let i = 0; i < rounds; i += 1) await act(async () => tick(16));
};

const items = (n: number): AnyRow[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `dsc-${i}`,
    title: `Reference ${i + 1}`,
    categories: ['makeup', 'dark feminine'],
    aesthetic: 'Dark Feminine',
    providerId: 'glow-lab-library',
    attribution: 'Glow Lab original',
    license: 'Commissioned for this app',
    remoteUrl: `./assets/discovery/ref-0${i + 1}.webp`
  })) as unknown as AnyRow[];

const text = () => container.textContent ?? '';

const big = (label: string) => {
  const b = [...container.querySelectorAll('.qr__big')].find((el) => (el.textContent ?? '').includes(label));
  if (!b) throw new Error(`no big button matching "${label}"`);
  return b as HTMLButtonElement;
};

const small = (label: string) => {
  const b = [...container.querySelectorAll('button')].find((el) => (el.textContent ?? '').trim().startsWith(label));
  if (!b) throw new Error(`no button matching "${label}"`);
  return b as HTMLButtonElement;
};

async function mount(props: Partial<Parameters<typeof QuickRate>[0]> = {}) {
  const onRate = props.onRate ?? vi.fn(async () => 'row-x');
  const onUndo = props.onUndo ?? vi.fn();
  const onExit = props.onExit ?? vi.fn();
  const onRateMore = props.onRateMore ?? vi.fn();
  root = createRoot(container);
  await act(async () =>
    root.render(
      <QuickRate
        items={props.items ?? items(3)}
        onRate={onRate}
        onUndo={onUndo}
        onExit={onExit}
        onRateMore={onRateMore}
      />
    )
  );
  await settle();
  return { onRate, onUndo, onExit, onRateMore };
}

beforeEach(async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('QuickRate', () => {
  it('opens on the first reference with the two decisions front and centre', async () => {
    await mount();
    expect(text()).toContain('1 of 3');
    expect(text()).toContain('Reference 1');
    expect(text()).toContain('Not for me');
    expect(text()).toContain('Like');
    expect(container.querySelector('.qr__stage img')?.getAttribute('src')).toContain('ref-01');
  });

  it('writes one action per tap and moves on', async () => {
    const { onRate } = await mount();
    await act(async () => big('Like').click());
    await settle();
    expect(onRate).toHaveBeenCalledTimes(1);
    expect((onRate as ReturnType<typeof vi.fn>).mock.calls[0][1]).toBe('like');
    expect(text()).toContain('2 of 3');
    expect(text()).toContain('1 liked');
  });

  it('counts a thumbs-down separately from a like', async () => {
    const { onRate } = await mount();
    await act(async () => big('Not for me').click());
    await settle();
    expect((onRate as ReturnType<typeof vi.fn>).mock.calls[0][1]).toBe('dislike');
    expect(text()).toContain('1 not for me');
  });

  it('takes the keyboard: right likes, left rejects, space skips without writing', async () => {
    const { onRate } = await mount();
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
    await settle();
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })));
    await settle();
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })));
    await settle();
    expect((onRate as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[1])).toEqual(['like', 'dislike']);
    expect(text()).toContain('That is the batch');
    expect(text()).toContain('2 judged');
  });

  it('undo hands back the row id of the last tap and steps back one card', async () => {
    const onUndo = vi.fn();
    await mount({ onUndo });
    await act(async () => big('Like').click());
    await settle();
    await act(async () => small('Undo last').click());
    await settle();
    expect(onUndo).toHaveBeenCalledWith('row-x');
    expect(text()).toContain('1 of 3');
    expect(text()).toContain('0 liked');
  });

  it('finishes the batch with what was written, not a spinner', async () => {
    const onRateMore = vi.fn();
    const onRate = vi.fn(async () => 'r');
    await mount({ items: items(1), onRate, onRateMore });
    await act(async () => big('Like').click());
    await settle();
    expect(text()).toContain('That is the batch');
    expect(text()).toContain('1 action written');
    await act(async () => small('Rate the next batch').click());
    expect(onRateMore).toHaveBeenCalledTimes(1);
  });

  it('the secondary states are one tap each and still advance', async () => {
    const { onRate } = await mount();
    await act(async () => small('Want to buy').click());
    await settle();
    expect((onRate as ReturnType<typeof vi.fn>).mock.calls[0][1]).toBe('buy');
    expect(text()).toContain('2 of 3');
  });

  it('closes on Escape', async () => {
    const { onExit } = await mount();
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});
