import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsPage from '../pages/SettingsPage';
import { ToastHost } from '../ui/primitives';
import { TABLES } from '../db/schema';
import { db } from '../db/db';
import { put, softDelete, todayISO } from '../db/repo';
import { DEFAULT_SETTINGS, updateSettings } from '../state/settings';
import { CSV_BOM, CSV_DEPARTMENTS, departmentLabel } from '../db/csv';

/**
 * The per-department CSV block in Settings → Backup & sync, driven the way she
 * drives it: pick a department, read the preview, download. What is asserted
 * here is the part that cannot be eyeballed in a screenshot — that every table
 * is offered with an honest count, that the preview is the same rows the file
 * carries, and that the bytes arriving on disk are quoted, BOM-led and free of
 * anything the app did not actually store.
 */

let container: HTMLDivElement;
let root: Root;

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const settle = async (rounds = 3) => {
  for (let i = 0; i < rounds; i += 1) await act(async () => tick(15));
};

const block = () => container.querySelector('[data-testid="csv-export"]') as HTMLElement;
const select = () => container.querySelector('[data-testid="csv-department"]') as HTMLSelectElement;
const preview = () => container.querySelector('[data-testid="csv-preview"]') as HTMLElement;
const downloadButton = () => container.querySelector('[data-testid="csv-download"]') as HTMLButtonElement;
const note = () => (block()?.querySelector('.gl-note')?.textContent ?? '').replace(/\s+/g, ' ');
const previewText = () => (preview()?.textContent ?? '').replace(/\s+/g, ' ');
const blockText = () => (block()?.textContent ?? '').replace(/\s+/g, ' ');

/** Read one CSV record back the way a spreadsheet does: quotes and all. */
function parseRow(line: string, delimiter = ','): string[] {
  const out: string[] = [];
  let cell = '';
  let quoted = false;
  let started = false;
  const endCell = () => {
    out.push(cell);
    cell = '';
    started = false;
  };
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (!started && ch === '"') {
      quoted = true;
      started = true;
    } else if (quoted && ch === '"' && line[i + 1] === '"') {
      cell += '"';
      i += 1;
    } else if (quoted && ch === '"') {
      quoted = false;
    } else if (!quoted && ch === delimiter) {
      endCell();
    } else cell += ch;
  }
  out.push(cell);
  return out;
}

async function waitUntil(what: string, done: () => boolean, budget = 12000) {
  const started = Date.now();
  for (;;) {
    if (done()) return;
    if (Date.now() - started > budget) throw new Error(`timed out waiting for ${what}`);
    await act(async () => {
      await tick(25);
    });
  }
}

async function chooseDepartment(table: string) {
  const el = select();
  const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value')!.set!;
  await act(async () => {
    setter.call(el, table);
    el.dispatchEvent(new Event('change', { bubbles: true }));
    await tick(15);
  });
  await settle(2);
}

function switchNamed(label: string) {
  return [...(block()?.querySelectorAll<HTMLElement>('button[role="switch"]') ?? [])].find((b) => (b.textContent ?? '').includes(label));
}

async function flip(label: string) {
  const node = switchNamed(label);
  if (!node) throw new Error(`no switch labelled “${label}”`);
  await act(async () => {
    node.click();
    await tick(15);
  });
  await settle(2);
}

const optionTextFor = (table: string) => {
  const el = select();
  const opt = el ? [...el.querySelectorAll('option')].find((o) => o.value === table) : undefined;
  return (opt?.textContent ?? '').replace(/\s+/g, ' ').trim();
};

async function mount() {
  root = createRoot(container);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={['/settings?tab=sync']}>
        <ToastHost>
          <SettingsPage />
        </ToastHost>
      </MemoryRouter>
    );
  });
  await settle(6);
}

const garment = (id: string, name: string, over: Record<string, unknown> = {}) =>
  ({
    id,
    name,
    category: 'outerwear',
    brand: 'Secondhand',
    colors: ['navy'],
    size: 'M',
    material: 'wool',
    fit: 'structured',
    price: 120,
    boughtOn: '2026-03-01',
    seasons: ['winter', 'autumn'],
    occasions: ['work'],
    wears: 12,
    mediaId: null,
    careNotes: 'dry clean',
    ...over
  }) as never;

async function seedCloset() {
  await put(TABLES.clothingItems, garment('c_1', 'Blazer, navy'));
  await put(TABLES.clothingItems, garment('c_2', 'Loafers', { category: 'shoes', wears: 3 }));
  await put(TABLES.clothingItems, garment('c_3', 'Old tee', { category: 'tops' }));
  await softDelete(TABLES.clothingItems, 'c_3');
  await put(TABLES.goals, { id: 'g_1', title: 'Even out tone', domain: 'skin', status: 'active', priority: 1 } as never);
}

const realObjectURL = URL.createObjectURL;
const realRevokeURL = URL.revokeObjectURL;

/**
 * jsdom's Blob has no `.text()`, and `FileReader.readAsText` swallows the BOM
 * the way a browser does — so fall back to the data URL and decode the bytes
 * ourselves, which is the only way to see the file exactly as it lands.
 */
async function readBlobText(blob: Blob): Promise<string> {
  /* decoded from the bytes, not blob.text(): text() consumes a leading BOM, and
     the whole point of reading the blob is to prove the BOM is in the file */
  const data = await blob.arrayBuffer();
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(data);
}

/** What the page would have handed the browser as a downloaded file. */
function captureDownloads() {
  const blobs: Blob[] = [];
  const anchors: { download: string; href: string; inDocument: boolean }[] = [];
  URL.createObjectURL = ((blob: Blob) => {
    blobs.push(blob);
    return `blob:glowlab/${blobs.length}`;
  }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL;
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    anchors.push({ download: this.download, href: this.href, inDocument: document.body.contains(this) });
  });
  return { blobs, anchors };
}

beforeEach(async () => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  await Promise.all(Object.values(TABLES).map((t) => db.table(t).clear()));
  localStorage.clear();
  await updateSettings({ ...DEFAULT_SETTINGS });
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  root?.unmount();
  container.remove();
  URL.createObjectURL = realObjectURL;
  URL.revokeObjectURL = realRevokeURL;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('the department list', () => {
  it('offers every table in the registry with its own row count', async () => {
    await seedCloset();
    await mount();
    expect(block()).toBeTruthy();
    await waitUntil('the closet count to land', () => optionTextFor(TABLES.clothingItems).includes('(2 rows)'));

    const values = [...select().querySelectorAll('option')].map((o) => o.value);
    for (const table of Object.values(TABLES)) expect(values, `missing ${table}`).toContain(table);
    expect(values).toHaveLength(CSV_DEPARTMENTS.length);

    /* a department she has never used is stated as empty, not hidden */
    expect(optionTextFor(TABLES.fragrances)).toContain('(0 rows)');
    expect(optionTextFor(TABLES.fragrances)).toContain(departmentLabel(TABLES.fragrances));
    expect(optionTextFor(TABLES.goals)).toBe(`${departmentLabel(TABLES.goals)} (1 row)`);
    /* the soft-deleted garment is not counted while the toggle is off */
    expect(optionTextFor(TABLES.clothingItems)).toContain('(2 rows)');
  });

  it('counts the deleted rows once she asks for them', async () => {
    await seedCloset();
    await mount();
    await waitUntil('the closet count to land', () => optionTextFor(TABLES.clothingItems).includes('(2 rows)'));
    await flip('Include rows I deleted');
    await waitUntil('the closet count to rise', () => optionTextFor(TABLES.clothingItems).includes('(3 rows)'));
  });
});

describe('the preview', () => {
  it('shows the seeded row of the department she picked', async () => {
    await seedCloset();
    await mount();
    await chooseDepartment(TABLES.clothingItems);
    await waitUntil('the preview to carry the garment', () => previewText().includes('Blazer, navy'));

    const head = [...preview().querySelectorAll('th')].map((th) => th.textContent ?? '');
    expect(head.slice(0, 6)).toEqual(['Garment', 'Category', 'Brand', 'Colours', 'Size', 'Material']);
    expect(head).toContain('Row ID');
    expect(head).not.toContain('Deleted at');

    const firstRow = [...(preview().querySelectorAll('tbody tr')[0]?.querySelectorAll('td') ?? [])].map((td) => td.textContent ?? '');
    expect(firstRow[0]).toBe('Blazer, navy');
    expect(firstRow[1]).toBe('outerwear');
    expect(firstRow[2]).toBe('Secondhand');
    expect(firstRow[3]).toBe('navy');
    expect(firstRow[4]).toBe('M');
    expect(firstRow[5]).toBe('wool');
    expect(firstRow).toHaveLength(head.length);

    /* the deleted row is absent, and the card says so rather than going quiet */
    expect(previewText()).not.toContain('Old tee');
    expect(blockText()).toContain('1 deleted row held back');
  });

  it('puts the deleted rows and their date back on the record when ticked', async () => {
    await seedCloset();
    await mount();
    await chooseDepartment(TABLES.clothingItems);
    await waitUntil('the preview to carry the garment', () => previewText().includes('Blazer, navy'));
    await flip('Include rows I deleted');
    await waitUntil('the deleted garment to appear', () => previewText().includes('Old tee'));
    const head = [...preview().querySelectorAll('th')].map((th) => th.textContent ?? '');
    expect(head).toContain('Deleted at');
  });

  it('says plainly when a department has nothing in it', async () => {
    await seedCloset();
    await mount();
    await chooseDepartment(TABLES.fragrances);
    await waitUntil('the empty notice', () => previewText().includes('no rows in this department yet'));
    const head = [...preview().querySelectorAll('th')].map((th) => th.textContent ?? '');
    expect(head[0]).toBe('Fragrance');
    expect(preview().querySelectorAll('tbody tr')).toHaveLength(0);
  });
});

describe('the download', () => {
  it('writes the bytes she previewed: BOM, header, and a quoted comma field', async () => {
    await seedCloset();
    await mount();
    await chooseDepartment(TABLES.clothingItems);
    await waitUntil('the preview to carry the garment', () => previewText().includes('Blazer, navy'));

    const captured = captureDownloads();
    await act(async () => {
      downloadButton().click();
      await tick(20);
    });
    await settle(2);

    expect(captured.blobs).toHaveLength(1);
    expect(captured.anchors).toHaveLength(1);
    expect(captured.anchors[0].download).toBe(`glowlab-closet-garments-${todayISO()}.csv`);
    expect(captured.anchors[0].href).toBe('blob:glowlab/1');
    expect(captured.anchors[0].inDocument).toBe(true);

    const body = await readBlobText(captured.blobs[0]);
    const lines = body.split('\r\n');
    expect(body.codePointAt(0)).toBe(CSV_BOM.codePointAt(0));
    expect(lines[0].slice(1)).toMatch(/^Garment,Category,Brand,Colours,Size/);
    expect(body).toContain('"Blazer, navy",outerwear');
    expect(body).toContain('Loafers');
    expect(body).not.toContain('Old tee');
    expect(body).not.toContain('undefined');
    /* header + exactly the two live garments, nothing invented */
    expect(lines.filter((l) => l.length)).toHaveLength(3);
    /* every record has exactly the header's column count, quotes included */
    const headerCells = parseRow(lines[0].slice(1));
    expect(headerCells[0]).toBe('Garment');
    expect(headerCells).not.toContain('Search text');
    for (const line of lines.filter((l) => l.length).slice(1)) {
      expect(parseRow(line)).toHaveLength(headerCells.length);
    }
    expect(parseRow(lines[1])[0]).toBe('Blazer, navy');
    expect(parseRow(lines[2])[0]).toBe('Loafers');
  });

  it('carries the deleted row and its date once she ticks the option', async () => {
    await seedCloset();
    await mount();
    await chooseDepartment(TABLES.clothingItems);
    await waitUntil('the preview to carry the garment', () => previewText().includes('Blazer, navy'));
    await flip('Include rows I deleted');
    await waitUntil('the deleted garment to appear', () => previewText().includes('Old tee'));

    const captured = captureDownloads();
    await act(async () => {
      downloadButton().click();
      await tick(20);
    });
    await settle(2);

    const body = await readBlobText(captured.blobs[0]);
    expect(body).toContain('Deleted at');
    expect(body).toContain('Old tee');
    expect(body.split('\r\n').filter((l) => l.length)).toHaveLength(4);
  });
});

describe('the honesty note', () => {
  it('states the real limits of a CSV in her language', async () => {
    await seedCloset();
    await mount();
    const where = note();
    expect(where).toContain('flat picture of these records taken now');
    expect(where).toContain('compact JSON inside one cell');
    expect(where).toContain('a binary was omitted');
    expect(where).toContain('the full backup above is what carries the files');
    expect(where).toContain('Include rows I deleted');
    expect(where).toContain('nothing to any server, because there is no server');
    expect(where).not.toMatch(/🚀|magic|AI-powered/i);
  });
});

describe('the block where she expects it', () => {
  it('sits in the Export card stack of the Backup & sync tab', async () => {
    await seedCloset();
    await mount();
    const cards = [...container.querySelectorAll('.gl-card')];
    const exportCard = cards.find((c) => (c.textContent ?? '').includes('Full backup (.zip)'));
    expect(exportCard).toBeTruthy();
    expect((exportCard?.textContent ?? '').includes('Records only (.json)')).toBe(true);
    /* the CSV block is its own card, right below, and is reachable without
       digging: same section, first stack on the page */
    expect(block()).toBeTruthy();
    const order = exportCard && block() ? exportCard.compareDocumentPosition(block() as Node) : 0;
    expect(Boolean(order & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });
});
