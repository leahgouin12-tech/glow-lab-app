import { TABLES, type AnyRow } from '../db/schema';
import { findAll, blankRow, put } from '../db/repo';
import { REFERENCE_SETS } from '../content/referenceLibrary';
import { loadSettings } from '../state/settings';

/**
 * Feed rows are ephemeral until the user adopts them, but they still carry a
 * real row envelope so the same components, sorting and dedupe rules work on
 * local library rows and remote results alike.
 */
function feedRow(fields: Record<string, any>): AnyRow {
  const base = blankRow(TABLES.discoveryItems, 'feed');
  return { ...base, ...fields } as unknown as AnyRow;
}

/**
 * Discovery providers (spec Part 8.5 + Part 1 #11).
 *
 * Three always-work sources: the bundled original reference sets, the user's
 * own uploads, and links the user pasted by hand. Three optional remote
 * providers (Pexels / Unsplash / Pixabay) need two things: a key she saved
 * herself, and Settings → Privacy → "Allow external processing" switched on.
 * A saved key is not consent to send — the switch is, and with it off this
 * module makes no request at all, so her search text never leaves the device.
 * There is no anonymous "infinite stock content" feed pretending to
 * exist: when a provider is unavailable the UI says so and shows the local
 * library instead.
 */

export interface DiscoverySource {
  id: string;
  label: string;
  kind: 'bundled' | 'local' | 'remote' | 'manual';
  needsKey: boolean;
  license: string;
  worksOffline: boolean;
  note: string;
}

export const DISCOVERY_SOURCES: DiscoverySource[] = [
  {
    id: 'glow-lab-library',
    label: 'Glow Lab original sets',
    kind: 'bundled',
    needsKey: false,
    license: 'Commissioned originals shipped with this build',
    worksOffline: true,
    note: `${REFERENCE_SETS.length} commissioned reference sets, fully offline, with the elements and palettes already tagged.`
  },
  {
    id: 'my-uploads',
    label: 'My uploads & saved links',
    kind: 'local',
    needsKey: false,
    license: 'Yours — you decide what you may keep',
    worksOffline: true,
    note: 'Anything you saved through the Media Studio or pasted a link for. Never leaves the device.'
  },
  {
    id: 'pinterest',
    label: 'Your Pinterest saves',
    kind: 'local',
    needsKey: false,
    license: 'Your own saves — the pictures belong to whoever made them',
    worksOffline: true,
    note: 'Imported from the data archive Pinterest gave you, or from images and links you saved yourself. Read on this device only; never fetched for you.'
  },
  {
    id: 'manual-links',
    label: 'Manual reference links',
    kind: 'manual',
    needsKey: false,
    license: 'Source site decides',
    worksOffline: false,
    note: 'Reference links you pasted yourself, including Pinterest pins you found by hand.'
  },
  {
    id: 'pexels',
    label: 'Pexels (your key)',
    kind: 'remote',
    needsKey: true,
    license: 'Pexels licence — attribution shown',
    worksOffline: false,
    note: 'Optional. Needs a free Pexels API key you enter yourself in Settings → Integrations AND "Allow external processing" on in Settings → Privacy. With the switch off no search text is sent, ever.'
  },
  {
    id: 'unsplash',
    label: 'Unsplash (your key)',
    kind: 'remote',
    needsKey: true,
    license: 'Unsplash licence + their API terms',
    worksOffline: false,
    note: 'Optional. Needs your own Unsplash access key AND "Allow external processing" on in Settings → Privacy. Respect their hotlinking and attribution rules.'
  },
  {
    id: 'pixabay',
    label: 'Pixabay (your key)',
    kind: 'remote',
    needsKey: true,
    license: 'Pixabay Content Licence',
    worksOffline: false,
    note: 'Optional. Needs your own Pixabay key AND "Allow external processing" on in Settings → Privacy.'
  }
];

export interface FeedPage {
  items: AnyRow[];
  providerStatus: { id: string; label: string; state: 'ok' | 'no-key' | 'offline' | 'error' | 'exhausted'; detail: string }[];
  hasMore: boolean;
  page: number;
  /** 0 while the library is being served once; 1+ means every card is a re-surfaced second look. */
  lap: number;
}

const PAGE_SIZE = 12;

/**
 * Builds one page of the feed. Local sources are always included; remote
 * sources add results only when a key exists and the network responds.
 * Results are ranked against Aesthetic DNA when supplied.
 */
export async function fetchFeedPage(
  opts: {
    page: number;
    categories?: string[];
    query?: string;
    sources?: string[];
    keys?: Record<string, string>;
    score?: (item: AnyRow) => number;
    /** Ordering for the second-look passes; left out, re-surfaced pages keep feed order. */
    resurfaceScore?: (item: AnyRow) => number;
    exclude?: Set<string>;
    online?: boolean;
  }
): Promise<FeedPage> {
  const page = Math.max(1, opts.page);
  const providerStatus: FeedPage['providerStatus'] = [];
  const pool: AnyRow[] = [];

  const wanted = opts.sources?.length ? opts.sources : DISCOVERY_SOURCES.map((s) => s.id);
  const all = await findAll(TABLES.discoveryItems);
  const local = all.filter((i) => wanted.includes(String(i.providerId)));
  pool.push(...local);

  const uploads = (await findAll(TABLES.mediaItems)).filter(
    (m) => wanted.includes('my-uploads') && (m.kind === 'upload' || m.sourceKind === 'user') && !m.remoteUrl
  );
  if (uploads.length) {
    pool.push(
      ...uploads.map((m) => feedRow({
        id: `virtual-${m.id}`,
        providerId: 'my-uploads',
        title: m.title || 'Untitled upload',
        description: m.caption || '',
        categories: (m.tags as string[]) ?? [],
        aesthetic: '',
        palette: ((m.data as Record<string, unknown>)?.palette as string[]) ?? [],
        elements: [],
        mediaId: m.id,
        virtual: true,
        createdAt: m.createdAt,
        tags: m.tags
      }))
    );
  }

  const maySendOut = (await loadSettings()).allowExternalProcessing;
  for (const src of DISCOVERY_SOURCES.filter((s) => s.kind === 'remote')) {
    if (!wanted.includes(src.id)) continue;
    const key = opts.keys?.[src.id];
    if (!key) {
      providerStatus.push({ id: src.id, label: src.label, state: 'no-key', detail: 'No key saved — using the bundled library instead.' });
      continue;
    }
    if (opts.online === false) {
      providerStatus.push({ id: src.id, label: src.label, state: 'offline', detail: 'No connection right now.' });
      continue;
    }
    /* The privacy switch is checked before any request is built, so a saved key
       alone cannot put her search text on the network. */
    if (!maySendOut) {
      providerStatus.push({
        id: src.id,
        label: src.label,
        state: 'error',
        detail: 'Nothing sent: “Allow external processing” is off in Settings → Privacy. Turn it on to let this query leave the device.'
      });
      continue;
    }
    try {
      const remote = await queryRemote(src.id, opts.query || poolCategoriesToQuery(opts.categories), key, page);
      pool.push(...remote);
      providerStatus.push({ id: src.id, label: src.label, state: 'ok', detail: `${remote.length} result(s).` });
    } catch (e) {
      providerStatus.push({ id: src.id, label: src.label, state: 'error', detail: (e as Error).message.slice(0, 140) });
    }
  }

  const excluded = opts.exclude ?? new Set<string>();
  let items = pool.filter((i) => !excluded.has(i.id));

  if (opts.categories?.length) {
    const want = opts.categories.map((c) => c.toLowerCase());
    const filtered = items.filter((i) => (i.categories as string[]).some((c) => want.some((w) => String(c).toLowerCase().includes(w) || w.includes(String(c).toLowerCase()))));
    if (filtered.length) items = filtered;
  }
  if (opts.query) {
    const q = opts.query.toLowerCase();
    const hit = items.filter((i) => `${i.title} ${i.description} ${(i.categories as string[])?.join(' ') ?? ''} ${i.aesthetic ?? ''} ${(i.elements as string[])?.join(' ') ?? ''}`.toLowerCase().includes(q));
    if (hit.length) items = hit;
  }
  if (opts.score) items = items.slice().sort((a, b) => opts.score!(b) - opts.score!(a));

  const total = items.length;
  const slice: AnyRow[] = [];
  let lap = 0;
  for (let k = 0; total > 0 && k < PAGE_SIZE; k += 1) {
    const n = (page - 1) * PAGE_SIZE + k;
    const pass = Math.floor(n / total);
    const order = pass === 0 ? items : lapOrder(items, pass, opts.resurfaceScore);
    const base = order[n % total];
    lap = pass;
    slice.push(
      pass === 0
        ? base
        : ({
            ...base,
            id: `${String(base.id)}#lap${pass}`,
            data: { ...((base.data as Record<string, unknown>) ?? {}), lap: pass, resurface: true }
          } as AnyRow)
    );
  }
  if (lap > 0)
    providerStatus.push({
      id: 'resurface',
      label: 'Second look',
      state: 'ok',
      detail: `Pass ${lap}: your ${total} library card(s) are being re-served, reordered by your interaction log.`
    });
  return { items: slice, providerStatus, hasMore: total > 0, page, lap };
}

/**
 * Ordering for a re-surface pass. Rotating by the pass number keeps consecutive
 * laps from starting on the same card, and the caller's score decides what is
 * actually worth a second look — nothing is invented to fill the gap.
 */
function lapOrder(items: AnyRow[], pass: number, score?: (item: AnyRow) => number) {
  const base = score ? items.slice().sort((a, b) => score(b) - score(a)) : items.slice();
  if (base.length < 2) return base;
  const shift = (pass * 5) % base.length;
  return [...base.slice(shift), ...base.slice(0, shift)];
}

function poolCategoriesToQuery(cats?: string[]) {
  return (cats ?? []).slice(0, 2).join(' ');
}

async function queryRemote(source: string, query: string, key: string, page: number): Promise<AnyRow[]> {
  if (!query.trim()) return [];
  const signal = AbortSignal.timeout ? AbortSignal.timeout(9000) : undefined;
  if (source === 'pexels') {
    const r = await fetch(`https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=${PAGE_SIZE}&page=${page}`, {
      headers: { Authorization: key },
      signal
    });
    if (!r.ok) throw new Error(`Pexels responded ${r.status}`);
    const j = (await r.json()) as { photos?: { id: number; src: { large2x: string; medium: string }; alt?: string; user: { name: string }; photographer_url: string }[] };
    return (j.photos ?? []).map((p) => feedRow({
      id: `pexels-${p.id}`,
      providerId: 'pexels',
      title: p.alt || 'Pexels photo',
      description: p.alt || '',
      categories: [query],
      aesthetic: '',
      palette: [],
      elements: [],
      remoteUrl: p.src.large2x,
      thumbUrl: p.src.medium,
      sourceUrl: p.photographer_url,
      attribution: `Photo by ${p.user.name} on Pexels`,
      license: 'Pexels licence',
      width: 900,
      height: 1200,
      virtual: true
    }));
  }
  if (source === 'unsplash') {
    const r = await fetch(`https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=${PAGE_SIZE}&page=${page}`, {
      headers: { Authorization: `Client-ID ${key}`, 'Accept-Version': 'v1' },
      signal
    });
    if (!r.ok) throw new Error(`Unsplash responded ${r.status}`);
    const j = (await r.json()) as { results?: { id: string; urls: { raw: string; regular: string }; alt_description?: string; user: { name: string }; links: { html: string } }[] };
    return (j.results ?? []).map((p) => feedRow({
      id: `unsplash-${p.id}`,
      providerId: 'unsplash',
      title: p.alt_description || 'Unsplash photo',
      description: p.alt_description || '',
      categories: [query],
      aesthetic: '',
      palette: [],
      elements: [],
      remoteUrl: `${p.urls.raw}&w=900&fit=crop`,
      thumbUrl: `${p.urls.raw}&w=340&fit=crop`,
      sourceUrl: p.links.html,
      attribution: `Photo by ${p.user.name} on Unsplash`,
      license: 'Unsplash licence',
      width: 900,
      height: 1200,
      virtual: true
    }));
  }
  if (source === 'pixabay') {
    const r = await fetch(`https://pixabay.com/api/?key=${encodeURIComponent(key)}&q=${encodeURIComponent(query)}&per_page=${PAGE_SIZE}&page=${page}&safesearch=true`, { signal });
    if (!r.ok) throw new Error(`Pixabay responded ${r.status}`);
    const j = (await r.json()) as { hits?: { id: number; largeImageURL: string; webformatURL: string; tags: string; user: string; pageURL: string }[] };
    return (j.hits ?? []).map((p) => feedRow({
      id: `pixabay-${p.id}`,
      providerId: 'pixabay',
      title: p.tags || 'Pixabay image',
      description: p.tags || '',
      categories: (p.tags || '').split(',').map((s: string) => s.trim()).filter(Boolean),
      aesthetic: '',
      palette: [],
      elements: [],
      remoteUrl: p.largeImageURL,
      thumbUrl: p.webformatURL,
      sourceUrl: p.pageURL,
      attribution: `Image by ${p.user} on Pixabay`,
      license: 'Pixabay Content Licence',
      width: 900,
      height: 1200,
      virtual: true
    }));
  }
  return [];
}

/** Saves a remote result into the local library so it works offline afterwards. */
export async function adoptRemoteItem(item: AnyRow) {
  const row = await put(TABLES.discoveryItems, {
    slug: `${item.providerId}-${item.id}`,
    providerId: item.providerId,
    title: item.title,
    description: item.description,
    categories: item.categories,
    aesthetic: item.aesthetic,
    palette: item.palette,
    elements: item.elements,
    sourceUrl: item.sourceUrl,
    attribution: item.attribution,
    license: item.license,
    recreatable: false,
    data: { remoteUrl: item.remoteUrl, thumbUrl: item.thumbUrl, width: item.width, height: item.height, adoptedAt: Date.now() }
  });
  return row;
}

export function sourceById(id: string) {
  return DISCOVERY_SOURCES.find((s) => s.id === id);
}
