import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { beforeAll, describe, expect, it } from 'vitest';
import { TABLES } from '../db/schema';
import { findAll, put } from '../db/repo';
import { db } from '../db/db';
import { ToastHost, useToast } from '../ui/primitives';
import { useUndoDelete } from '../ui/undo';

let container: HTMLDivElement;
let remove: (table: any, id: string, label: string) => Promise<void>;
let say: (body: string) => void;

function Probe() {
  const toast = useToast();
  remove = useUndoDelete();
  say = (body: string) => toast(body, 'info');
  return null;
}

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const settle = async (rounds = 3) => {
  for (let i = 0; i < rounds; i += 1) await act(async () => tick(15));
};

beforeAll(async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  for (const t of Object.values(TABLES)) await db.table(t).clear();
  container = document.createElement('div');
  document.body.appendChild(container);
  await act(async () => {
    createRoot(container).render(
      <ToastHost>
        <Probe />
      </ToastHost>
    );
  });
  await settle();
});

describe('deleting with a way back', () => {
  it('removes the row, offers Undo in the toast, and puts it back when taken', async () => {
    const row = await put(TABLES.routines, { name: 'Morning barrier', domain: 'skin', active: true, steps: [] } as any);
    expect((await findAll(TABLES.routines)).map((r) => r.id)).toContain(row.id);

    await act(async () => {
      await remove(TABLES.routines, row.id, 'Morning barrier');
    });
    await settle();

    expect((await findAll(TABLES.routines)).map((r) => r.id), 'gone from the live view').not.toContain(row.id);
    const toast = container.textContent ?? '';
    expect(toast).toContain('Morning barrier');
    const undo = [...container.querySelectorAll('button')].find((b) => /undo/i.test(b.textContent ?? ''));
    expect(undo, 'the toast carries an actual Undo control').toBeTruthy();

    await act(async () => {
      (undo as HTMLButtonElement).click();
    });
    await settle();

    expect((await findAll(TABLES.routines)).map((r) => r.id), 'undo restores the same row').toContain(row.id);
    const restored = (await findAll(TABLES.routines)).find((r) => r.id === row.id);
    expect(restored?.deletedAt, 'the soft-delete stamp is cleared').toBeFalsy();
  });

  it('keeps plain toasts working without an action', async () => {
    await act(async () => {
      say('Nothing to undo here.');
    });
    await settle();
    expect(container.textContent).toContain('Nothing to undo here.');
    expect([...container.querySelectorAll('button')].some((b) => /undo/i.test(b.textContent ?? ''))).toBe(false);
  });
});
