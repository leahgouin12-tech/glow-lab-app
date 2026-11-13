import type { AnyRow, BaseRow, TableName } from './schema';
import { ENTITY_TABLES } from './schema';
import { db, tableOf } from './db';

const DEVICE_KEY = 'glow-lab:device-id';

export function deviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = `dev_${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

export function newId(prefix = 'rec'): string {
  const rnd =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      : Math.random().toString(36).slice(2, 14);
  return `${prefix}_${Date.now().toString(36)}${rnd}`;
}

export function todayISO(d: Date | number = Date.now()): string {
  const date = typeof d === 'number' ? new Date(d) : d;
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return todayISO(dt);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y) return iso;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
}

/** Flattens scalars + string arrays into one lowercase haystack for search. */
export function buildText(row: Record<string, unknown>): string {
  const parts: string[] = [];
  const walk = (value: unknown, depth = 0) => {
    if (depth > 4) return;
    if (value === null || value === undefined) return;
    if (typeof value === 'string') {
      if (value.trim()) parts.push(value.toLowerCase());
      return;
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
      parts.push(String(value));
      return;
    }
    if (Array.isArray(value)) {
      for (const v of value) walk(v, depth + 1);
      return;
    }
    if (typeof value === 'object') {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (k === 'text' || k === 'blob' || k === 'thumb') continue;
        if (typeof v === 'string' && v.trim() && k !== 'id') parts.push(k.replace(/([A-Z])/g, ' $1').toLowerCase());
        walk(v, depth + 1);
      }
    }
  };
  walk(row);
  return parts.join(' ').slice(0, 6000);
}

export function blankRow<T extends TableName>(table: T, idPrefix?: string): BaseRow & Record<string, unknown> {
  const now = Date.now();
  return {
    id: newId(idPrefix ?? table.slice(0, 4)),
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    rev: 1,
    deviceId: deviceId(),
    tags: [],
    text: '',
    data: {}
  } as BaseRow & Record<string, unknown>;
}

async function queueSync(table: TableName, row: AnyRow, op: 'put' | 'delete') {
  if (!ENTITY_TABLES.includes(table)) return;
  await db.syncQueue.put({
    id: newId('sync'),
    createdAt: Date.now(),
    updatedAt: Date.now(),
    deletedAt: null,
    rev: 1,
    deviceId: deviceId(),
    tags: [],
    text: `${table} ${row.id} ${op}`,
    op,
    targetTable: table,
    targetId: row.id,
    targetRev: row.rev,
    baseRev: (row.rev ?? 1) - 1,
    attempts: 0,
    lastError: '',
    payload: op === 'put' ? JSON.stringify(row).slice(0, 400000) : '',
    flushGroup: 'default'
  });
}

export interface PutOptions {
  /** skip the sync queue (used when applying remote changes) */
  silent?: boolean;
}

export async function put<T extends TableName>(
  table: T,
  row: Partial<AnyRow> & { id?: string },
  opts: PutOptions = {}
): Promise<AnyRow> {
  const existing = row.id ? await tableOf(table).get(row.id) : undefined;
  // A caller updating "the row for this kind, if there is one" writes
  // `id: existing?.id`, which is a present-but-undefined key. Spread over the
  // blank row that clobbers the generated id, and IndexedDB rejects the put with
  // a DataError the UI never surfaces — the field just refuses to fill in.
  const patch: Partial<AnyRow> = { ...row };
  if (patch.id === undefined || patch.id === null || patch.id === '') delete patch.id;
  const merged: AnyRow = existing
    ? { ...existing, ...patch, updatedAt: Date.now(), rev: (existing.rev ?? 1) + 1 }
    : ({ ...blankRow(table), ...patch, updatedAt: Date.now(), rev: 1 } as AnyRow);
  merged.text = buildText(merged);
  await tableOf(table).put(merged);
  if (!opts.silent) await queueSync(table, merged, 'put');
  return merged;
}

export async function patch<T extends TableName>(table: T, id: string, changes: Record<string, unknown>) {
  const existing = await tableOf(table).get(id);
  if (!existing) throw new Error(`patch: missing ${table}/${id}`);
  return put(table, { ...existing, ...changes, id }, {});
}

export async function softDelete(table: TableName, id: string) {
  const existing = await tableOf(table).get(id);
  if (!existing) return null;
  const row = { ...existing, deletedAt: Date.now(), updatedAt: Date.now(), rev: (existing.rev ?? 1) + 1 };
  row.text = buildText(row);
  await tableOf(table).put(row);
  await queueSync(table, row, 'put');
  return row;
}

export async function hardDelete(table: TableName, id: string) {
  await tableOf(table).delete(id);
  if (table === 'mediaItems') {
    const items = await tableOf('mediaItems').where('blobId').equals(id).toArray();
    for (const it of items) if (it.blobId) await db.mediaBlobs.delete(it.blobId);
  }
  await queueSync(table, { id, rev: 0 } as AnyRow, 'delete');
}

export async function restore(table: TableName, id: string) {
  return patch(table, id, { deletedAt: null });
}

export type Filter = {
  includeDeleted?: boolean;
  where?: Record<string, unknown>;
  some?: Record<string, (row: AnyRow) => boolean>;
};

export function matches(row: AnyRow, f?: Filter): boolean {
  // Deleted rows stay hidden even when the caller passes no filter at all.
  if (row.deletedAt && !f?.includeDeleted) return false;
  if (!f) return true;
  if (f.where) {
    for (const [k, v] of Object.entries(f.where)) {
      const actual = (row as any)[k];
      if (Array.isArray(v)) {
        // A filter array means "any of these"; a row value array means "has a
        // tag in common". clothingItems.seasons and lists.items rely on both.
        if (Array.isArray(actual)) {
          if (!v.some((x) => actual.includes(x))) return false;
        } else if (!v.includes(actual)) return false;
      } else if (actual !== v) return false;
    }
  }
  if (f.some) {
    for (const predicate of Object.values(f.some)) if (!predicate(row)) return false;
  }
  return true;
}

export async function findAll<T extends TableName>(table: T, f?: Filter): Promise<AnyRow[]> {
  const rows = (await tableOf(table).toArray()) as AnyRow[];
  return rows.filter((r) => matches(r, f));
}

export async function findFirst<T extends TableName>(table: T, f?: Filter): Promise<AnyRow | undefined> {
  const rows = await findAll(table, f);
  return rows[0];
}

export async function countAll(tables: TableName[], f?: Filter): Promise<number> {
  let n = 0;
  for (const t of tables) n += (await findAll(t, f)).length;
  return n;
}

export async function findByText(table: TableName, needle: string): Promise<AnyRow[]> {
  const q = needle.toLowerCase().trim();
  if (!q) return [];
  const rows = (await tableOf(table).toArray()) as AnyRow[];
  return rows.filter((r) => !r.deletedAt && (r.text ?? '').includes(q));
}

/** Simple token search: every token must appear somewhere in the haystack. */
export function tokenMatch(text: string, query: string): number {
  const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return 0;
  let hits = 0;
  for (const t of tokens) {
    if (!text.includes(t)) return 0;
    hits += 1;
  }
  return hits / tokens.length;
}
