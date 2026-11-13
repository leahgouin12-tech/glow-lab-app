import { importExportZip, type ImportSummary } from './pinterestImport';
import { loadSettings, updateSettings } from '../state/settings';

/**
 * The one honest form of "auto" this app can have for Pinterest saves.
 *
 * A live call to Pinterest from the client is not possible — `api.pinterest.com`
 * answers 401 with no `Access-Control-Allow-Origin` and oEmbed sends no CORS
 * header either, and the route that would need a server holding a token is one
 * this app does not have. So the archive is prepared off-device by
 * `scripts/pin-board-grab.mjs`, dropped next to the app, and pulled here over
 * the same origin the app was already loaded from. Nothing new is contacted,
 * nothing is fetched from Pinterest by the app itself, and re-pulling is safe:
 * the importer keys on the stored picture, so a re-run only ever adds saves that
 * were not there before.
 */

export const PIN_ARCHIVE_PATH = 'pinterest-saves.zip';

export interface PinterestSyncResult {
  state: 'updated' | 'unchanged' | 'empty' | 'error' | 'off';
  pinsFound: number;
  imagesFound: number;
  imported: number;
  duplicates: number;
  linkOnly: number;
  sizeKb: number;
  at: number;
  detail: string;
}

const EMPTY: Omit<PinterestSyncResult, 'state' | 'detail'> = {
  pinsFound: 0,
  imagesFound: 0,
  imported: 0,
  duplicates: 0,
  linkOnly: 0,
  sizeKb: 0,
  at: 0
};

/** Reads whatever archive this device is already serving. Never contacts Pinterest. */
export async function syncPinterestArchive(opts: { force?: boolean } = {}): Promise<PinterestSyncResult> {
  const at = Date.now();
  if (!opts.force && !(await loadSettings()).pinterestAutoSync)
    return { ...EMPTY, state: 'off', at, detail: 'The switch in Settings is off, so nothing was pulled.' };

  let res: Response;
  try {
    res = await fetch(new URL(PIN_ARCHIVE_PATH, window.location.href).href, { cache: 'no-store' });
  } catch (e) {
    return { ...EMPTY, state: 'error', at, detail: `Could not read the archive on this device: ${(e as Error).message}` };
  }
  if (!res.ok)
    return {
      ...EMPTY,
      state: 'empty',
      at,
      detail: res.status === 404
        ? 'No archive on this device yet. Run the grab, then check again — the app never fetches from Pinterest itself.'
        : `The archive is there but would not serve (HTTP ${res.status}).`
    };

  // Decoding 300 pictures on every boot would be the cost of "auto", so an
  // archive the device already served is skipped on its ETag instead.
  const head = res.headers?.get?.('etag') ?? res.headers?.get?.('last-modified') ?? '';
  if (!opts.force && head && head === (await loadSettings()).pinterestArchiveStamp)
    return { ...EMPTY, state: 'unchanged', at, detail: 'Same archive as the last pull, so nothing was re-decoded.' };

  const blob = await res.blob();
  const summary: ImportSummary = await importExportZip(new File([blob], PIN_ARCHIVE_PATH, { type: 'application/zip' }));
  const result: PinterestSyncResult = {
    ...summary,
    state: 'updated',
    sizeKb: Math.round(blob.size / 1024),
    at,
    detail: summary.detail
  };
  await updateSettings({ pinterestSyncAt: at, pinterestArchiveStamp: head || `size:${blob.size}` });
  return result;
}

/** One line for Settings: what the last pull actually did. */
export function describeSync(r: PinterestSyncResult): string {
  if (r.state === 'updated')
    return r.imported
      ? `${r.imported} new card(s) from ${r.pinsFound} pin row(s); ${r.duplicates} already here.`
      : `Nothing new — all ${r.pinsFound} pin row(s) were already in your library.`;
  if (r.state === 'unchanged') return 'The archive has not changed since the last pull.';
  return r.detail;
}
