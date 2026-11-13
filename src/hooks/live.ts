import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import { findAll, matches, put, type Filter } from '../db/repo';
import type { AnyRow, TableName } from '../db/schema';

/** Live, filter-preserving read of any table. Keeps departments off raw Dexie. */
export function useRows<T extends TableName>(table: T, f?: Filter): AnyRow[] {
  const key = JSON.stringify(f?.where ?? {}) + String(f?.includeDeleted) + String(f?.some ? Object.keys(f.some).join() : '');
  return (useLiveQuery(() => findAll(table, f), [table, key]) ?? []) as AnyRow[];
}

export function useRow<T extends TableName>(table: T, id: string | undefined): AnyRow | undefined {
  return useLiveQuery(() => (id ? db.table(table).get(id) : Promise.resolve(undefined)), [table, id]) as AnyRow | undefined;
}

/**
 * Live read that also reports whether the first query has resolved. An empty
 * array before the read lands is not evidence that the user has no records, so
 * anything that would create a row when a table looks empty must use this
 * version and wait.
 */
export function useRowsState<T extends TableName>(table: T, f?: Filter): [AnyRow[], boolean] {
  const key = JSON.stringify(f?.where ?? {}) + String(f?.includeDeleted) + String(f?.some ? Object.keys(f.some).join() : '');
  const rows = useLiveQuery(() => findAll(table, f), [table, key]);
  return [rows ?? [], rows !== undefined];
}

/** Cross-department refresh signal for anything a live query cannot see. */
let flagRevision = 0;
let flagNote = '';
const flagListeners = new Set<() => void>();

export function bumpFlags(note = '') {
  flagRevision += 1;
  flagNote = note;
  for (const l of flagListeners) l();
}

export function useFlags() {
  const [, force] = useState(0);
  useEffect(() => {
    const listener = () => force((n) => n + 1);
    flagListeners.add(listener);
    return () => {
      flagListeners.delete(listener);
    };
  }, []);
  return `${flagRevision}:${flagNote}`;
}

export async function saveRow(table: TableName, row: Record<string, unknown>) {
  const saved = await put(table, row as never);
  bumpFlags(table);
  return saved;
}

export function rowsMatch(rows: AnyRow[], f?: Filter) {
  return rows.filter((r) => matches(r, f));
}
