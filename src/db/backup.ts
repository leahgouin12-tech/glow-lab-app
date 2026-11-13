import JSZip from 'jszip';
import { db, tableOf } from './db';
import { TABLES, ENTITY_TABLES, type AnyRow, type TableName } from './schema';
import { deviceId, findAll, put, todayISO } from './repo';

/**
 * Backup, restore and sync (spec Part 34).
 *
 * Local-first is the default and the only guaranteed path: a ZIP containing
 * every table as JSON plus the media blobs as real image files, restorable on
 * any platform. Optional sync posts the queue to an endpoint the user supplies
 * — it is not turned on by default and the app never implies a free cloud
 * backup exists.
 */

export const BACKUP_FORMAT = 'glow-lab-backup';
export const BACKUP_VERSION = 1;
export const APP_VERSION = '0.7.0-dark-femme';

export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  version: number;
  appVersion: string;
  exportedAt: string;
  device: string;
  schemaVersion: number;
  counts: Record<string, number>;
  mediaBytes: number;
  includesPrivateMedia: boolean;
  checksums: Record<string, string>;
}

export interface ExportOptions {
  includeMedia?: boolean;
  includePrivateMedia?: boolean;
  includeSeedContent?: boolean;
}

async function fnvHex(text: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export async function buildBackup(opts: ExportOptions = {}) {
  const includeMedia = opts.includeMedia !== false;
  const includePrivate = opts.includePrivateMedia !== false;
  const includeSeed = opts.includeSeedContent !== false;
  const zip = new JSZip();
  const counts: Record<string, number> = {};
  const checksums: Record<string, string> = {};
  let mediaBytes = 0;

  for (const table of [...ENTITY_TABLES, TABLES.logs, TABLES.settings]) {
    const rows = (await findAll(table, { includeDeleted: true })).filter((r) => includeSeed || r.seed !== 1);
    counts[table] = rows.length;
    const json = JSON.stringify(rows, null, 1);
    checksums[table] = await fnvHex(json);
    zip.file(`tables/${table}.json`, json);
  }

  if (includeMedia) {
    const items = (await findAll(TABLES.mediaItems, { includeDeleted: true })).filter((m) => includePrivate || !m.private);
    const folder = zip.folder('media');
    for (const m of items) {
      if (!m.blobId) continue;
      const blobRow = await db.mediaBlobs.get(m.blobId);
      if (!blobRow) continue;
      mediaBytes += blobRow.bytes;
      const ext = blobRow.mime.includes('webp') ? 'webp' : blobRow.mime.includes('png') ? 'png' : 'jpg';
      folder?.file(`${m.id}.${ext}`, blobRow.blob);
      folder?.file(`${m.id}.thumb.${ext}`, blobRow.thumb);
    }
    zip.file('media/index.json', JSON.stringify(items, null, 1));
    counts.mediaBlobs = items.filter((m) => m.blobId).length;
  }

  const manifest: BackupManifest = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    device: deviceId(),
    schemaVersion: 1,
    counts,
    mediaBytes,
    includesPrivateMedia: includePrivate,
    checksums
  };
  zip.file('manifest.json', JSON.stringify(manifest, null, 2));
  zip.file('README.txt', `THE GLOW LAB backup\nExported ${manifest.exportedAt}\n\nOpen with this app (Settings → Data → Restore). Tables are plain JSON in /tables, media files in /media. Everything in /tables is readable without the app; the row envelope is documented in ARCHITECTURE.md.\n`);
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  return { blob, manifest, filename: `glow-lab-backup-${todayISO()}.zip` };
}

export async function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export type RestoreMode = 'merge' | 'replace';

export interface RestoreReport {
  ok: boolean;
  detail: string;
  manifest?: BackupManifest;
  rowsWritten?: number;
  conflicts?: number;
  skipped?: number;
}

export async function restoreFromZip(file: File | Blob, mode: RestoreMode = 'merge'): Promise<RestoreReport> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch {
    return { ok: false, detail: 'That file is not a readable ZIP archive.' };
  }
  const manifestFile = zip.file('manifest.json');
  if (!manifestFile) return { ok: false, detail: 'No manifest.json — this is not a Glow Lab backup.' };
  const manifest = JSON.parse(await manifestFile.async('string')) as BackupManifest;
  if (manifest.format !== BACKUP_FORMAT) return { ok: false, detail: `Manifest format is “${manifest.format}”, not a Glow Lab backup.` };
  if (manifest.version > BACKUP_VERSION) return { ok: false, detail: `Backup came from a newer format (v${manifest.version}). Update the app before restoring.` };

  if (mode === 'replace') {
    for (const t of [...ENTITY_TABLES, TABLES.logs]) await tableOf(t).clear();
    await db.mediaBlobs.clear();
  }

  let rowsWritten = 0;
  let conflicts = 0;
  let skipped = 0;

  for (const entry of Object.entries(zip.files)) {
    const [name, f] = entry;
    if (!/^tables\/(.+)\.json$/.test(name)) continue;
    const table = name.split('/')[1].replace('.json', '') as TableName;
    if (!(ENTITY_TABLES as string[]).includes(table) && table !== TABLES.settings && table !== TABLES.logs) {
      skipped += 1;
      continue;
    }
    const rows = JSON.parse(await f.async('string')) as AnyRow[];
    for (const row of rows) {
      if (!row?.id) {
        skipped += 1;
        continue;
      }
      if (mode === 'merge') {
        const local = (await tableOf(table).get(row.id)) as AnyRow | undefined;
        if (local) {
          if ((local.rev ?? 1) > (row.rev ?? 1) || (local.updatedAt ?? 0) > (row.updatedAt ?? 0)) {
            conflicts += 1;
            await put(TABLES.conflicts, {
              targetTable: table,
              targetId: row.id,
              localRev: local.rev ?? 1,
              remoteRev: row.rev ?? 1,
              resolution: 'pending',
              detail: `Imported copy dated ${new Date(row.updatedAt).toLocaleString()} vs local ${new Date(local.updatedAt).toLocaleString()}.`
            });
            continue;
          }
        }
      }
      await tableOf(table).put(row);
      rowsWritten += 1;
    }
  }

  const mediaIndex = zip.file('media/index.json');
  if (mediaIndex) {
    const items = JSON.parse(await mediaIndex.async('string')) as AnyRow[];
    for (const m of items) {
      if (!m.blobId) continue;
      if (await db.mediaBlobs.get(m.blobId)) continue;
      const ext = m.mime?.includes?.('png') ? 'png' : 'webp';
      const blobFile = zip.file(`media/${m.id}.${ext}`) ?? zip.file(`media/${m.id}.jpg`) ?? zip.file(`media/${m.id}.webp`);
      if (!blobFile) continue;
      const blob = await blobFile.async('blob');
      const thumbFile = zip.file(`media/${m.id}.thumb.${ext}`) ?? zip.file(`media/${m.id}.thumb.jpg`) ?? zip.file(`media/${m.id}.thumb.webp`);
      const thumb = thumbFile ? await thumbFile.async('blob') : blob;
      await db.mediaBlobs.put({ id: m.blobId, blob, thumb, createdAt: Date.now(), bytes: blob.size, mime: blob.type || 'image/jpeg' });
    }
    for (const m of items) {
      const local = (await db.mediaItems.get(m.id)) as AnyRow | undefined;
      if (!local) await db.mediaItems.put(m);
    }
  }

  await put(TABLES.logs, { channel: 'import', level: 'info', message: `Restored ${rowsWritten} row(s) in ${mode} mode`, detail: `${conflicts} conflict(s), ${skipped} skipped.` });
  return {
    ok: true,
    detail: mode === 'replace' ? 'Replaced local data with the backup.' : 'Merged the backup into local data.',
    manifest,
    rowsWritten,
    conflicts,
    skipped
  };
}

/** Quick JSON export without media — for reading, diffing and migration checks. */
export async function exportJson() {
  const out: Record<string, unknown> = { format: BACKUP_FORMAT, version: BACKUP_VERSION, exportedAt: new Date().toISOString(), device: deviceId() };
  for (const t of ENTITY_TABLES) {
    const rows = await findAll(t, { includeDeleted: true });
    out[t] = rows;
  }
  return JSON.stringify(out, null, 2);
}

/**
 * Optional sync (Part 34 + Part 1 #6). Pushes the local queue to the user's
 * own endpoint, applies returned changes, and records conflicts rather than
 * silently overwriting either side.
 */
export interface SyncResult {
  ok: boolean;
  detail: string;
  pushed: number;
  pulled: number;
  conflicts: number;
  pending: number;
}

export async function flushSyncQueue(): Promise<SyncResult> {
  const { loadSettings } = await import('../state/settings');
  const s = await loadSettings();
  if (!s.syncEnabled || !s.syncEndpoint) {
    const waiting = (await findAll(TABLES.syncQueue)).length;
    return {
      ok: false,
      detail: `Sync is off. Enable it and provide an endpoint in Settings → Sync. ${waiting} change(s) stay queued on this device.`,
      pushed: 0,
      pulled: 0,
      conflicts: 0,
      pending: waiting
    };
  }

  const queue = await findAll(TABLES.syncQueue);
  if (!s.allowExternalProcessing) {
    return {
      ok: false,
      detail: `Privacy blocks it: "Allow external processing" is off in Settings → Privacy, so nothing leaves this device. ${queue.length} change(s) stay queued locally.`,
      pushed: 0,
      pulled: 0,
      conflicts: 0,
      pending: queue.length
    };
  }
  if (!queue.length) return { ok: true, detail: 'Nothing queued.', pushed: 0, pulled: 0, conflicts: 0, pending: 0 };

  const body = queue.map((q) => ({ id: q.id, op: q.op, table: q.targetTable, targetId: q.targetId, rev: q.targetRev, baseRev: q.baseRev, payload: q.payload, device: deviceId() }));
  try {
    const r = await fetch(s.syncEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device: deviceId(), changes: body }),
      signal: AbortSignal.timeout ? AbortSignal.timeout(20000) : undefined
    });
    if (!r.ok) throw new Error(`Endpoint returned ${r.status}`);
    const j = (await r.json()) as { changes?: { table: string; row: AnyRow }[]; conflicts?: { table: string; id: string; remoteRev: number }[] };
    let pulled = 0;
    let conflicts = 0;
    for (const c of j.changes ?? []) {
      if (!c?.table || !c.row?.id) continue;
      if (!(ENTITY_TABLES as string[]).includes(c.table)) continue;
      const local = (await tableOf(c.table as TableName).get(c.row.id)) as AnyRow | undefined;
      if (local && (local.rev ?? 1) > (c.row.rev ?? 1)) {
        conflicts += 1;
        await put(TABLES.conflicts, { targetTable: c.table, targetId: c.row.id, localRev: local.rev ?? 1, remoteRev: c.row.rev ?? 1, resolution: 'pending', detail: 'Remote changed the same record.' });
        continue;
      }
      await tableOf(c.table as TableName).put({ ...c.row, deviceId: deviceId() });
      pulled += 1;
    }
    for (const q of queue) await db.syncQueue.delete(q.id);
    return { ok: true, detail: `Pushed ${body.length}, pulled ${pulled}.`, pushed: body.length, pulled, conflicts, pending: (await findAll(TABLES.syncQueue)).length };
  } catch (e) {
    for (const q of queue) await db.syncQueue.put({ ...q, attempts: (q.attempts ?? 0) + 1, lastError: (e as Error).message.slice(0, 200) });
    return { ok: false, detail: `Sync failed, kept queued: ${(e as Error).message.slice(0, 120)}`, pushed: 0, pulled: 0, conflicts: 0, pending: (await findAll(TABLES.syncQueue)).length };
  }
}

/** Last-write-wins by rev, with the losing copy preserved for manual merge. */
export async function resolveConflict(id: string, side: 'local' | 'remote') {
  const c = (await db.conflicts.get(id)) as AnyRow | undefined;
  if (!c) return false;
  if (side === 'local') {
    await put(TABLES.conflicts, { ...c, resolution: 'local' });
    return true;
  }
  const row = (await tableOf(c.targetTable as TableName).get(c.targetId)) as AnyRow | undefined;
  if (row) await put(TABLES.conflicts, { ...c, resolution: 'remote', detail: `${c.detail} Local copy kept in the conflict record.` });
  else await put(TABLES.conflicts, { ...c, resolution: 'remote' });
  return true;
}

export async function storageFootprint() {
  const rows = await Promise.all(ENTITY_TABLES.map(async (t) => ({ table: t, count: (await findAll(t, { includeDeleted: true })).length })));
  const blobs = await db.mediaBlobs.toArray();
  return {
    rows: rows.reduce((a, b) => a + b.count, 0),
    perTable: rows,
    mediaFiles: blobs.length,
    mediaBytes: blobs.reduce((a, b) => a + (b.bytes ?? 0), 0),
    queued: (await findAll(TABLES.syncQueue)).length,
    conflicts: (await findAll(TABLES.conflicts, { where: { resolution: 'pending' } })).length
  };
}

export async function eraseEverything(keepSeed = false) {
  for (const t of [...ENTITY_TABLES, TABLES.logs, TABLES.syncQueue, TABLES.conflicts]) {
    if (keepSeed && (t === TABLES.techniques || t === TABLES.tutorials || t === TABLES.exercises || t === TABLES.knowledge || t === TABLES.discoveryItems)) continue;
    await tableOf(t).clear();
  }
  if (!keepSeed) {
    for (const m of await db.mediaBlobs.toArray()) await db.mediaBlobs.delete(m.id);
  }
  await db.mediaItems.clear();
  localStorage.removeItem('glow-lab:seed-version');
  return true;
}
