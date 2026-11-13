import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Bookmark,
  Check,
  ExternalLink,
  Flag,
  Heart,
  Layers,
  Link2,
  RefreshCw,
  Share2,
  ShoppingBag,
  Sparkles,
  ThumbsDown,
  Trash2
} from 'lucide-react';
import {
  Button,
  Chip,
  Field,
  IconButton,
  Modal,
  SegmentedControl,
  Select,
  TagInput,
  TextArea,
  TextInput,
  Toggle,
  useDebounced,
  useToast
} from '../ui/primitives';
import { Carousel, Chipbar, DeptIntro, EmptyPlate, KvList, StatStrip, Timeline } from '../ui/editorial';
import { Lightbox, MasonryFeed, Pin, PhotoPicker, type PinAction } from '../ui/media';
import { QuickRate } from '../ui/QuickRate';
import { PinterestImport } from '../ui/PinterestImport';
import { saveRow, useRows } from '../hooks/live';
import { softDelete, todayISO } from '../db/repo';
import { TABLES, type AnyRow, type DiscoveryInteractionRow } from '../db/schema';
import { ACTION_WEIGHT, computeDna, excludedItemIds, scoreAgainstDna, type AestheticDna } from '../engine/taste';
import { DISCOVERY_SOURCES, fetchFeedPage, type FeedPage } from '../providers/discovery';
import { AESTHETIC_IDENTITIES, DISCOVERY_CATEGORIES, REFERENCE_SETS } from '../content/referenceLibrary';
import { loadSettings, subscribeSettings, type AppSettings } from '../state/settings';
import '../styles/departments/discover.css';

type Action = DiscoveryInteractionRow['action'];

const GROUPS = Object.keys(DISCOVERY_CATEGORIES);
const COACH_KEY = 'glow-lab:discover-coach-dismissed';
const IDENTITIES = AESTHETIC_IDENTITIES.map((i) => ({ value: String(i).toLowerCase(), label: String(i) }));
const REMOTE_IDS = DISCOVERY_SOURCES.filter((s) => s.kind === 'remote').map((s) => s.id);
const ALL_SOURCE_IDS = DISCOVERY_SOURCES.map((s) => s.id);
const LEAD_ITEM = { remoteUrl: `./${REFERENCE_SETS[0].file}`, width: 900, height: 1200 } as unknown as AnyRow;

const ACTION_LABEL: Record<Action, string> = {
  like: 'Liked',
  unlike: 'Unliked',
  dislike: 'Disliked',
  hide: 'Hidden from your feed',
  save: 'Saved',
  unsave: 'Unsaved',
  try: 'Marked want-to-try',
  buy: 'Marked want-to-buy',
  own: 'Marked already yours',
  board: 'Added to a board',
  mood: 'Added to a moodboard',
  goal: 'Added to a goal',
  more: 'More like this',
  less: 'Less like this',
  report: 'Reported',
  view: 'Viewed',
  'open-source': 'Opened the original source',
  share: 'Shared'
};

const STATUS_TEXT: Record<FeedPage['providerStatus'][number]['state'], string> = {
  ok: 'delivered results',
  'no-key': 'no key saved in Settings',
  offline: 'offline — not attempted',
  error: 'request failed',
  exhausted: 'no further results'
};

const REPORT_REASONS = ['Not my style', 'Misleading or staged', 'Wrong category', 'Copyright or attribution concern', 'Low quality', 'Other'];

function useAppSettings(): AppSettings | null {
  const [s, setS] = useState<AppSettings | null>(null);
  useEffect(() => {
    let alive = true;
    void loadSettings().then((v) => {
      if (alive) setS(v);
    });
    const unsub = subscribeSettings((v) => {
      if (alive) setS(v);
    });
    return () => {
      unsub();
    };
  }, []);
  return s;
}

/** The narrow shape engine/taste.ts accepts; AnyRow is too loose to pass directly. */
function dnaShape(item: AnyRow) {
  return {
    categories: (item.categories as string[]) ?? [],
    aesthetic: String(item.aesthetic ?? ''),
    elements: (item.elements as string[]) ?? [],
    palette: (item.palette as string[]) ?? []
  };
}

/** Discovery rows carry a mediaId; the pixels live in mediaItems (or a remote URL from a provider). */
function withImage(item: AnyRow, mediaById: Map<string, AnyRow>): AnyRow {
  const m = item.mediaId ? mediaById.get(String(item.mediaId)) : undefined;
  if (m) return { ...item, blobId: m.blobId, remoteUrl: m.remoteUrl, width: m.width, height: m.height };
  const d = (item.data ?? {}) as Record<string, unknown>;
  return {
    ...item,
    blobId: item.blobId ?? null,
    remoteUrl: String(item.remoteUrl ?? d.thumbUrl ?? d.remoteUrl ?? ''),
    width: Number(item.width ?? d.width ?? 0),
    height: Number(item.height ?? d.height ?? 0)
  };
}

/** A re-surfaced tile is the same card a second time on purpose (its id carries
    #lapN), so it must not be dropped by the upload/library dedupe below. */
const dedupeKey = (item: AnyRow) =>
  (item.data as Record<string, unknown>)?.resurface ? `i:${item.id}` : item.mediaId ? `m:${item.mediaId}` : `i:${item.id}`;

/** The exact terms scoreAgainstDna() uses, spelled out for the pin — plus your identity affinity. */
function whyParts(item: AnyRow, dna: AestheticDna | null, identityLabel: string, identityPoints: number) {
  const out: { label: string; kind: string; points: number; score: number }[] = [];
  if (Math.abs(identityPoints) >= 0.02) {
    out.push({ label: `actions you logged as “${identityLabel}”`, kind: 'identity', points: identityPoints, score: 0 });
  }
  if (dna?.signals.length) {
    const index = new Map(dna.signals.map((s) => [s.key, s]));
    const consider = (raw: unknown, mult: number) => {
      const key = String(raw ?? '').toLowerCase();
      if (!key || out.some((o) => o.label === key)) return;
      const s = index.get(key);
      if (!s) return;
      const pts = 0.55 * Math.sign(s.score) * Math.min(1, Math.abs(s.score) / 8) * mult;
      if (Math.abs(pts) < 0.06) return;
      out.push({ label: key, kind: s.kind, points: pts, score: s.score });
    };
    for (const c of (item.categories as string[]) ?? []) consider(c, 1);
    consider(item.aesthetic, 1.6);
    for (const e of (item.elements as string[]) ?? []) consider(e, 0.8);
    for (const p of (item.palette as string[]) ?? []) consider(p, 0.4);
  }
  return out.sort((a, b) => Math.abs(b.points) - Math.abs(a.points)).slice(0, 3);
}

const EMPTY_DNA: AestheticDna = {
  identity: 'everyday',
  signals: [],
  top: [],
  aversions: [],
  emerging: [],
  confidence: 0,
  interactions: 0,
  updatedAt: 0
};

export default function DiscoverPage() {
  const toast = useToast();
  const settings = useAppSettings();

  const items = useRows(TABLES.discoveryItems);
  const interactions = useRows(TABLES.discoveryInteractions);
  const boards = useRows(TABLES.boards);
  const media = useRows(TABLES.mediaItems);
  const refs = useRows(TABLES.manualReferences);
  const knowledge = useRows(TABLES.knowledge);
  const profiles = useRows(TABLES.profile);
  const integrations = useRows(TABLES.integrations);

  const [view, setView] = useState<'feed' | 'states' | 'links' | 'signals'>('feed');
  const [rating, setRating] = useState(false);
  const [rateOffset, setRateOffset] = useState(0);
  const [coachHidden, setCoachHidden] = useState(() => localStorage.getItem(COACH_KEY) === '1');
  const [pinOpen, setPinOpen] = useState(false);
  const [search, setSearch] = useState('');
  const query = useDebounced(search, 320);
  const [group, setGroup] = useState<string>(GROUPS[0]);
  const [cats, setCats] = useState<string[]>([]);
  const [identity, setIdentity] = useState('everyday');
  const [rank, setRank] = useState<'dna' | 'newest' | 'library'>('dna');
  const [sources, setSources] = useState<string[]>(ALL_SOURCE_IDS);

  const [feed, setFeed] = useState<AnyRow[]>([]);
  const [page, setPage] = useState(1);
  const [lap, setLap] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [status, setStatus] = useState<FeedPage['providerStatus']>([]);
  const [loading, setLoading] = useState(false);

  const [lbItems, setLbItems] = useState<AnyRow[]>([]);
  const [lbIndex, setLbIndex] = useState<number | null>(null);
  const [libIndex, setLibIndex] = useState<number | null>(null);
  const [reportFor, setReportFor] = useState<AnyRow | null>(null);
  const [reportReason, setReportReason] = useState(REPORT_REASONS[0]);
  const [reportNote, setReportNote] = useState('');
  const [boardFor, setBoardFor] = useState<AnyRow | null>(null);
  const [boardPick, setBoardPick] = useState('');
  const [boardNew, setBoardNew] = useState('');
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkDraft, setLinkDraft] = useState({ url: '', title: '', note: '' });
  const [uploadDraft, setUploadDraft] = useState<AnyRow | null>(null);
  const [uploadTags, setUploadTags] = useState({
    title: '',
    aesthetic: '',
    categories: [] as string[],
    elements: [] as string[],
    palette: [] as string[],
    description: '',
    recreatable: true
  });
  const [catOpen, setCatOpen] = useState(false);
  const [catDraft, setCatDraft] = useState({ name: '', group: GROUPS[0] });
  const [ask, setAsk] = useState<{ title: string; body: string; run: () => void } | null>(null);

  const liveItems = useMemo(() => items.filter((i) => !i.deletedAt), [items]);
  const mediaById = useMemo(() => new Map(media.map((m) => [String(m.id), m])), [media]);
  const customCats = useMemo(() => knowledge.filter((k) => ((k.tags as string[]) ?? []).includes('custom-category')), [knowledge]);
  const prefRow = useMemo(() => profiles.find((p) => p.kind === 'style' && p.singleton === 1), [profiles]);
  const identityLabel = IDENTITIES.find((i) => i.value === identity)?.label ?? 'Everyday';

  /* ---------------- feed preferences: restored on load, stored on change ---------------- */
  const hydrated = useRef(false);
  useEffect(() => {
    if (hydrated.current || !prefRow) return;
    hydrated.current = true;
    const d = (prefRow.data ?? {}) as Record<string, unknown>;
    if (typeof d.identity === 'string') setIdentity(d.identity);
    if (typeof d.rank === 'string') setRank(d.rank as typeof rank);
    if (Array.isArray(d.categories)) setCats(d.categories as string[]);
    // Remembered as the sources switched OFF, never as the list that was on: a
    // source added in a later build would otherwise stay hidden forever by a
    // preference written before it existed.
    if (Array.isArray(d.sourcesOff)) setSources(ALL_SOURCE_IDS.filter((id) => !(d.sourcesOff as string[]).includes(id)));
    if (typeof d.query === 'string') setSearch(d.query);
  }, [prefRow]);

  useEffect(() => {
    if (!hydrated.current) return;
    const t = setTimeout(() => {
      void saveRow(TABLES.profile, {
        id: prefRow?.id,
        kind: 'style',
        singleton: 1,
        data: { ...(prefRow?.data ?? {}), identity, rank, categories: cats, sourcesOff: ALL_SOURCE_IDS.filter((id) => !sources.includes(id)), query, savedAt: Date.now() }
      });
    }, 700);
    return () => clearTimeout(t);
  }, [identity, rank, cats, sources, query, prefRow]);

  /* ---------------- taste DNA, recomputed from the user's own interaction rows ---------------- */
  const [dna, setDna] = useState<AestheticDna | null>(null);
  useEffect(() => {
    let alive = true;
    void computeDna(identity).then((d) => alive && setDna(d));
    return () => {
      alive = false;
    };
  }, [identity, interactions.length, liveItems.length]);

  const exclude = useMemo(
    () =>
      excludedItemIds(
        interactions.map((x) => ({ itemId: String(x.itemId), action: String(x.action), createdAt: Number(x.createdAt) }))
      ),
    [interactions]
  );

  /** identity affinity: what you did while this identity was selected. Deterministic, own data only. */
  const identityAffinity = useMemo(() => {
    const m = new Map<string, number>();
    for (const x of interactions) {
      const di = String(((x.data ?? {}) as Record<string, unknown>).identity ?? '');
      if (di !== identity) continue;
      const id = String(x.itemId);
      m.set(id, (m.get(id) ?? 0) + Number(x.weight ?? 0));
    }
    return m;
  }, [interactions, identity]);

  const lastByItem = useMemo(() => {
    const map = new Map<string, Record<string, boolean>>();
    for (const x of [...interactions].sort((a, b) => Number(a.createdAt) - Number(b.createdAt))) {
      const key = String(x.itemId);
      const cur = { ...(map.get(key) ?? {}) };
      const action = String(x.action) as Action;
      if (action === 'unlike') cur.like = false;
      else if (action === 'unsave') cur.save = false;
      else cur[action] = action !== 'view' && action !== 'share' && action !== 'open-source';
      if (action === 'like') {
        cur.like = true;
        cur.dislike = false;
      }
      if (action === 'dislike') cur.like = false;
      map.set(key, cur);
    }
    return map;
  }, [interactions]);

  const boardIdsByItem = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const b of boards)
      for (const id of (b.itemIds as string[]) ?? []) map.set(String(id), [...(map.get(String(id)) ?? []), String(b.id)]);
    return map;
  }, [boards]);

  const backingId = useCallback(
    (item: AnyRow) => {
      const raw = String(item.id).replace(/#lap\d+$/, '');
      if (!raw.startsWith('virtual-')) return raw;
      const found = liveItems.find((i) => String(i.mediaId) === raw.replace('virtual-', ''));
      return found ? String(found.id) : raw;
    },
    [liveItems]
  );

  const stateOf = useCallback(
    (item: AnyRow) => {
      const key = backingId(item);
      const st = lastByItem.get(key) ?? {};
      return {
        key,
        liked: Boolean(st.like),
        disliked: Boolean(st.dislike),
        hidden: Boolean(st.hide) || Boolean(st.report),
        saved: Boolean(st.save),
        tried: Boolean(st.try),
        bought: Boolean(st.buy),
        owned: Boolean(st.own),
        more: Boolean(st.more),
        less: Boolean(st.less),
        reported: Boolean(st.report),
        boards: boardIdsByItem.get(key) ?? []
      };
    },
    [backingId, lastByItem, boardIdsByItem]
  );

  /**
   * What deserves a second look once the library has been served once. Pure
   * arithmetic over the interaction log: cards you asked to see more of, cards
   * you never actually decided on, cards that touch your closet — and cards you
   * rejected sink to the back. No model, no invented content.
   */
  const resurfaceScore = useCallback(
    (item: AnyRow) => {
      const key = backingId(item);
      const st = lastByItem.get(key) ?? {};
      let s = 0;
      if (st.more) s += 3;
      if (!st.like && !st.dislike && !st.save && !st.hide && !st.report) s += 2;
      if (st.tried || st.bought || st.owned) s += 1;
      if (st.disliked) s -= 4;
      if (st.save) s += 1;
      s += Math.min(2, Math.abs(identityAffinity.get(key) ?? 0) / 8);
      return s;
    },
    [backingId, lastByItem, identityAffinity]
  );

  /* ---------------- the feed itself, paged through fetchFeedPage ---------------- */
  const seq = useRef(0);
  const load = useCallback(
    async (n: number, reset: boolean) => {
      const my = (seq.current += 1);
      setLoading(true);
      const keys: Record<string, string> = {};
      for (const r of integrations) {
        const svc = String(r.service);
        if (REMOTE_IDS.includes(svc) && r.token) keys[svc] = String(r.token);
      }
      const affinityOf = (it: AnyRow) => {
        const raw = identityAffinity.get(backingId(it)) ?? 0;
        return Math.max(-1, Math.min(1, raw / 10));
      };
      const score =
        rank === 'dna'
          ? (it: AnyRow) => 0.55 * scoreAgainstDna(dnaShape(it), dna ?? EMPTY_DNA) + 0.45 * affinityOf(it)
          : rank === 'newest'
            ? (it: AnyRow) => Number(it.createdAt ?? 0) / 1e12
            : undefined;
      try {
        const res = await fetchFeedPage({
          page: n,
          categories: cats,
          query,
          sources,
          keys,
          score,
          resurfaceScore,
          exclude: new Set([...exclude].flatMap((id) => [id, `virtual-${id}`])),
          online: navigator.onLine
        });
        if (my !== seq.current) return;
        setStatus(res.providerStatus);
        setHasMore(res.hasMore);
        setLap(res.lap);
        setPage(res.page);
        setFeed((prev) => {
          const base = reset ? [] : prev;
          const seen = new Set(base.map(dedupeKey));
          const next = [...base];
          for (const it of res.items) {
            const k = dedupeKey(it);
            if (seen.has(k)) continue;
            seen.add(k);
            next.push(it);
          }
          return next;
        });
      } catch (e) {
        if (my !== seq.current) return;
        setStatus([{ id: 'feed', label: 'Feed', state: 'error', detail: (e as Error).message.slice(0, 140) }]);
        setHasMore(false);
      } finally {
        if (my === seq.current) setLoading(false);
      }
    },
    [cats, query, sources, rank, dna, exclude, integrations, identityAffinity, backingId, resurfaceScore]
  );

  const loadRef = useRef(load);
  loadRef.current = load;
  const catsKey = cats.join('|');
  const sourcesKey = sources.join('|');
  useEffect(() => {
    void loadRef.current(1, true);
  }, [catsKey, query, sourcesKey, rank, identity]);

  const loadMore = useCallback(() => {
    if (loading || !hasMore) return;
    void loadRef.current(page + 1, false);
  }, [loading, hasMore, page]);

  const feedVisible = useMemo(
    () => feed.map((it) => withImage(it, mediaById)).filter((it) => !stateOf(it).hidden),
    [feed, mediaById, stateOf]
  );
  const libraryItems = useMemo(
    () => liveItems.filter((i) => i.providerId === 'glow-lab-library').map((i) => withImage(i, mediaById)),
    [liveItems, mediaById]
  );

  /* ---------------- interactions ---------------- */
  const writeInteraction = useCallback(
    async (item: AnyRow, action: Action, opts: { boardId?: string | null; reason?: string; quiet?: boolean } = {}) => {
      // a virtual upload tile needs a real discovery row before a signal can be learned from it
      let targetId = backingId(item);
      if (targetId.startsWith('virtual-')) {
        const mediaId = targetId.replace('virtual-', '');
        const existing = liveItems.find((i) => String(i.mediaId) === mediaId);
        if (existing) targetId = String(existing.id);
        else {
          const saved = await saveRow(TABLES.discoveryItems, {
            slug: `my-uploads-${mediaId}`,
            providerId: 'my-uploads',
            title: item.title || 'My upload',
            description: item.description || '',
            categories: (item.categories as string[]) ?? [],
            aesthetic: String(item.aesthetic ?? ''),
            palette: (item.palette as string[]) ?? [],
            elements: (item.elements as string[]) ?? [],
            mediaId,
            sourceUrl: '',
            attribution: 'Uploaded by you — stored on this device',
            license: 'User-owned',
            recreatable: true,
            seed: 0,
            data: { identity }
          });
          targetId = String(saved.id);
        }
      }
      const row = await saveRow(TABLES.discoveryInteractions, {
        itemId: targetId,
        action,
        weight: ACTION_WEIGHT[action],
        boardId: opts.boardId ?? null,
        reason: opts.reason ?? '',
        tags: [action],
        data: { identity, providerId: String(item.providerId ?? ''), title: String(item.title ?? ''), on: todayISO() }
      });
      if (!opts.quiet) toast(`${ACTION_LABEL[action]} — written to your interaction log.`);
      return String(row.id);
    },
    [liveItems, identity, toast]
  );

  /** Quick rate's "undo last" deletes the row it just wrote rather than writing
      an inverse, so a mis-tap leaves no phantom signal in the taste arithmetic. */
  const undoInteraction = useCallback(
    (rowId: string) => {
      void softDelete(TABLES.discoveryInteractions, rowId).then(() => toast('That tap was removed from your interaction log.'));
    },
    [toast]
  );

  const toggleLike = (item: AnyRow) => void writeInteraction(item, stateOf(item).liked ? 'unlike' : 'like');
  const toggleSave = (item: AnyRow) => void writeInteraction(item, stateOf(item).saved ? 'unsave' : 'save');

  const pinActions = useCallback(
    (item: AnyRow): PinAction[] => {
      const st = stateOf(item);
      return [
        {
          key: 'like',
          label: st.liked ? 'Liked — tap to undo' : 'Like this',
          icon: <Heart size={14} />,
          on: st.liked,
          onClick: () => void writeInteraction(item, st.liked ? 'unlike' : 'like')
        },
        {
          key: 'save',
          label: st.saved ? 'Saved — tap to remove' : 'Save to your collection',
          icon: <Bookmark size={14} />,
          on: st.saved,
          onClick: () => void writeInteraction(item, st.saved ? 'unsave' : 'save')
        },
        { key: 'try', label: 'Want to try', icon: <Sparkles size={14} />, on: st.tried, onClick: () => void writeInteraction(item, 'try') },
        { key: 'buy', label: 'Want to buy', icon: <ShoppingBag size={14} />, on: st.bought, onClick: () => void writeInteraction(item, 'buy') },
        { key: 'own', label: 'Already yours', icon: <Check size={14} />, on: st.owned, onClick: () => void writeInteraction(item, 'own') },
        { key: 'dislike', label: 'Not for me', icon: <ThumbsDown size={14} />, on: st.disliked, onClick: () => void writeInteraction(item, 'dislike') }
      ];
    },
    [stateOf, writeInteraction]
  );

  const openWith = (item: AnyRow, list: AnyRow[]) => {
    setLbItems(list);
    setLbIndex(Math.max(0, list.findIndex((x) => x.id === item.id)));
    void writeInteraction(item, 'view', { quiet: true });
  };

  const share = async (item: AnyRow) => {
    const text = `${item.title ?? 'Glow Lab reference'}${item.attribution ? ` — ${item.attribution}` : ''}${item.sourceUrl ? ` ${item.sourceUrl}` : ''} (saved in The Glow Lab)`;
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied to your clipboard.', 'ok');
    } catch {
      toast('The browser blocked the clipboard — the reference text is shown in the panel above.', 'bad');
    }
    await writeInteraction(item, 'share');
  };

  const openSource = (item: AnyRow) => {
    const url = String(item.sourceUrl ?? '');
    if (!url) {
      toast('No external source for this one — it is a Glow Lab original shipped inside the app, so there is nothing to open.');
      return;
    }
    window.open(url, '_blank', 'noopener');
    void writeInteraction(item, 'open-source');
  };

  const assignBoard = async (boardId: string, item: AnyRow) => {
    const board = boards.find((b) => String(b.id) === boardId);
    if (!board) return;
    const key = backingId(item);
    const ids = new Set([...((board.itemIds as string[]) ?? []), key]);
    const kind = String(board.kind) as 'inspiration' | 'moodboard' | 'goal' | 'collection';
    await saveRow(TABLES.boards, {
      id: boardId,
      itemIds: [...ids],
      coverMediaId: board.coverMediaId ?? (item.mediaId ? String(item.mediaId) : null),
      palette: [...new Set([...((board.palette as string[]) ?? []), ...((item.palette as string[]) ?? [])])].filter(Boolean).slice(0, 8)
    });
    await writeInteraction(item, kind === 'moodboard' ? 'mood' : kind === 'goal' ? 'goal' : 'board', { boardId });
    toast(`Added to “${board.name}”.`);
  };

  const createAndAdd = async () => {
    const name = boardNew.trim();
    if (!name) {
      toast('Give the new board a name first.', 'bad');
      return;
    }
    const saved = await saveRow(TABLES.boards, {
      kind: 'inspiration',
      name,
      purpose: '',
      identity,
      coverMediaId: null,
      itemIds: [],
      palette: [],
      exported: false
    });
    setBoardNew('');
    setBoardPick(String(saved.id));
    toast(`Board “${name}” created.`);
  };

  /* ---------------- custom categories: real knowledge rows ---------------- */
  const addCustomCat = async () => {
    const name = catDraft.name.trim();
    if (!name) {
      toast('Type a name first.', 'bad');
      return;
    }
    await saveRow(TABLES.knowledge, {
      title: name,
      kind: 'reference',
      body: `Custom discovery category “${name}”, filed under ${catDraft.group}. Created ${todayISO()}. Usable as a feed filter and as a tag on your own uploads.`,
      domain: 'discovery',
      confidence: 3,
      worked: 'unset',
      linkedGoalIds: [],
      linkedTechniqueIds: [],
      linkedProductIds: [],
      linkedExperimentIds: [],
      tags: ['custom-category', catDraft.group],
      data: { group: catDraft.group }
    });
    setCatDraft({ name: '', group: catDraft.group });
    setCatOpen(false);
    toast('Custom category saved and added to the filter tree.');
  };

  const saved = useMemo(() => {
    const pick = (test: (st: ReturnType<typeof stateOf>) => boolean) =>
      liveItems.filter((i) => test(stateOf(i))).map((i) => withImage(i, mediaById));
    const seen = new Map<string, number>();
    for (const x of interactions) if (String(x.action) === 'view') seen.set(String(x.itemId), Number(x.createdAt));
    return {
      savedList: pick((s) => s.saved),
      liked: pick((s) => s.liked),
      tryList: pick((s) => s.tried),
      buyList: pick((s) => s.bought),
      ownList: pick((s) => s.owned),
      disliked: pick((s) => s.disliked),
      hidden: liveItems.filter((i) => exclude.has(String(i.id))).map((i) => withImage(i, mediaById)),
      viewed: [...seen.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 24)
        .map(([id]) => liveItems.find((i) => String(i.id) === id))
        .filter((i): i is AnyRow => Boolean(i))
        .map((i) => withImage(i, mediaById))
    };
  }, [liveItems, interactions, mediaById, exclude, stateOf]);

  const groupCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const g of [...GROUPS, 'YOUR CATEGORIES']) {
      const subs = g === 'YOUR CATEGORIES' ? customCats.map((c) => String(c.title)) : DISCOVERY_CATEGORIES[g];
      map.set(
        g,
        liveItems.filter((i) =>
          ((i.categories as string[]) ?? []).some((c) => subs.some((s) => String(c).toLowerCase().includes(s.toLowerCase())))
        ).length
      );
    }
    return map;
  }, [liveItems, customCats]);

  const subs = useMemo(
    () => (group === 'YOUR CATEGORIES' ? customCats.map((c) => String(c.title)) : DISCOVERY_CATEGORIES[group] ?? []),
    [group, customCats]
  );
  const totalFilterable = useMemo(() => {
    const set = new Set<string>();
    for (const g of GROUPS) for (const s of DISCOVERY_CATEGORIES[g]) set.add(s.toLowerCase());
    for (const c of customCats) set.add(String(c.title).toLowerCase());
    return set.size;
  }, [customCats]);

  const remoteAsked = status.filter((s) => REMOTE_IDS.includes(s.id)).length;
  const affinityOfItem = (item: AnyRow) => 0.45 * Math.max(-1, Math.min(1, (identityAffinity.get(backingId(item)) ?? 0) / 10));

  return (
    <div className="gl-page">
      <DeptIntro
        id="discover"
        image={LEAD_ITEM}
        deck={
          settings?.imageAnalysis
            ? 'An endless dark editorial feed that learns from what you actually do. Image analysis is switched on in Settings — but this build has no vision service, so every tag you see is either yours or a deterministic rule over the tags already stored with a reference.'
            : undefined
        }
        actions={
          <>
            <Button
              variant="gold"
              icon={<Heart size={14} />}
              onClick={() => {
                setRateOffset(0);
                setRating(true);
              }}
            >
              Rate one by one
            </Button>
            <Button variant="ghost" icon={<Link2 size={14} />} onClick={() => setPinOpen(true)}>
              Add your Pinterest saves
            </Button>
            <PhotoPicker
              kind="upload"
              album="My uploads"
              label="Add your own image"
              onPick={(rows) => {
                const first = rows[0];
                if (!first) return;
                setUploadDraft(first);
                setUploadTags({
                  title: String(first.title ?? ''),
                  aesthetic: '',
                  categories: [],
                  elements: [],
                  palette: (((first.data as Record<string, unknown>)?.palette as string[]) ?? []).slice(0, 6),
                  description: '',
                  recreatable: true
                });
              }}
            />
            <Button icon={<Link2 size={14} />} onClick={() => setLinkOpen(true)}>
              Paste a reference link
            </Button>
            <Button
              variant="ghost"
              icon={<RefreshCw size={14} />}
              onClick={() => {
                void loadRef.current(1, true);
                toast('Feed rebuilt from your library plus whichever providers answered.');
              }}
              disabled={loading}
            >
              {loading ? 'Rebuilding…' : 'Refresh'}
            </Button>
          </>
        }
        meta={[
          { label: 'In your library', value: liveItems.length },
          { label: 'Signals logged', value: interactions.length },
          { label: 'Identity', value: identityLabel },
          { label: 'Taste confidence', value: dna ? `${Math.round(dna.confidence * 100)}%` : 'computing' }
        ]}
      />

      <StatStrip
        items={[
          { label: 'Loaded this session', value: feedVisible.length, hint: `page ${page} · ${lap === 0 ? 'first pass' : `second look, pass ${lap}`}` },
          { label: 'Saved', value: saved.savedList.length, hint: 'one row per action' },
          { label: 'Want to try', value: saved.tryList.length },
          { label: 'Want to buy', value: saved.buyList.length },
          { label: 'Already yours', value: saved.ownList.length },
          { label: 'Boards', value: boards.filter((b) => !b.deletedAt).length }
        ]}
      />

      <section className="gl-section">
        <div className="gl-deck">
          <div className="gl-deck__col">
            <Field label="Search your own library — and any provider you have keyed">
              <TextInput value={search} onChange={setSearch} placeholder="oxblood lip, sister locs, vanity, chrome nails…" />
            </Field>
            <div>
              <div className="gl-label" style={{ marginBottom: 6 }}>Feed identity — re-ranks now, stored forever</div>
              <Chipbar items={IDENTITIES} value={identity} onChange={setIdentity} allLabel="Everyday" />
            </div>
            <div>
              <div className="gl-label" style={{ marginBottom: 6 }}>Order</div>
              <SegmentedControl
                value={rank}
                onChange={(v) => setRank(v as typeof rank)}
                options={[
                  { value: 'dna', label: 'Your signals + this identity' },
                  { value: 'newest', label: 'Newest in library' },
                  { value: 'library', label: 'Untouched provider order' }
                ]}
              />
            </div>
            <div>
              <div className="gl-label" style={{ marginBottom: 6 }}>Sources</div>
              <div className="gl-row gl-row--tight" style={{ flexWrap: 'wrap' }}>
                {DISCOVERY_SOURCES.map((s) => (
                  <Chip
                    key={s.id}
                    active={sources.includes(s.id)}
                    onClick={() => setSources((prev) => (prev.includes(s.id) ? prev.filter((x) => x !== s.id) : [...prev, s.id]))}
                    title={s.note}
                  >
                    {s.label}
                  </Chip>
                ))}
              </div>
            </div>
            <div className="gl-prov" aria-live="polite">
              {status.map((s) => (
                <span key={s.id} className="gl-prov__item" data-state={s.state} title={s.detail}>
                  {s.label}: {STATUS_TEXT[s.state]}
                </span>
              ))}
              {!status.length ? <span className="gl-prov__item">Local library only — no remote provider was asked.</span> : null}
              {remoteAsked ? (
                <span className="gl-small gl-faint">
                  Remote providers only run with a key you saved in Settings → Integrations; {remoteAsked} reported above.
                </span>
              ) : null}
            </div>
          </div>

          <div className="gl-deck__col">
            <div>
              <div className="gl-row gl-row--between" style={{ marginBottom: 6 }}>
                <span className="gl-label">Category tree</span>
                <Button size="sm" variant="ghost" onClick={() => setCatOpen(true)}>
                  New custom category
                </Button>
              </div>
              <Chipbar
                items={[...GROUPS, 'YOUR CATEGORIES'].map((g) => ({ value: g, label: g, count: groupCounts.get(g) ?? 0 }))}
                value={group}
                onChange={setGroup}
                allLabel="All groups"
              />
              <div className="gl-catgroup">
                <div className="gl-catgroup__label">{group === 'YOUR CATEGORIES' ? 'Categories you created' : `${group} — sub-categories`}</div>
                <div className="gl-row gl-row--tight" style={{ flexWrap: 'wrap' }}>
                  {subs.map((s) => (
                    <Chip
                      key={s}
                      active={cats.some((c) => c.toLowerCase() === s.toLowerCase())}
                      onClick={() =>
                        setCats((prev) =>
                          prev.some((c) => c.toLowerCase() === s.toLowerCase())
                            ? prev.filter((c) => c.toLowerCase() !== s.toLowerCase())
                            : [...prev, s]
                        )
                      }
                    >
                      {s}
                    </Chip>
                  ))}
                  {!subs.length ? <span className="gl-small gl-faint">None yet — create one above; it will persist like any other record.</span> : null}
                </div>
              </div>
            </div>
            {cats.length ? (
              <div className="gl-row gl-row--tight">
                <span className="gl-small gl-faint">Filtering on:</span>
                {cats.map((c) => (
                  <Chip key={c} active onClick={() => setCats((prev) => prev.filter((x) => x !== c))} title="Remove filter">
                    {c} ✕
                  </Chip>
                ))}
                <Button size="sm" variant="ghost" onClick={() => setCats([])}>
                  Clear all
                </Button>
              </div>
            ) : null}
            {customCats.length ? (
              <div className="gl-stack" style={{ gap: 6 }}>
                <span className="gl-label">Custom categories ({customCats.length})</span>
                {customCats.map((c) => (
                  <div key={String(c.id)} className="gl-linklist__row">
                    <div>
                      <div className="gl-serif">{String(c.title)}</div>
                      <div className="gl-tech">{String(((c.data ?? {}) as Record<string, unknown>).group ?? 'FASHION')}</div>
                    </div>
                    <IconButton
                      label={`Delete custom category ${String(c.title)}`}
                      onClick={() =>
                        setAsk({
                          title: 'Delete this custom category?',
                          body: `“${String(c.title)}” leaves the filter tree. Items already tagged with it keep their tag until you edit them.`,
                          run: () => void softDelete(TABLES.knowledge, String(c.id))
                        })
                      }
                    >
                      <Trash2 size={14} />
                    </IconButton>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <div className="gl-tabs" role="tablist">
        {(
          [
            { value: 'feed', label: 'Feed' },
            { value: 'states', label: `Saved & states (${saved.savedList.length})` },
            { value: 'links', label: `Reference links (${refs.filter((r) => !r.deletedAt).length})` },
            { value: 'signals', label: 'Why & signals' }
          ] as const
        ).map((t) => (
          <button key={t.value} type="button" role="tab" aria-selected={view === t.value} className="gl-tab" onClick={() => setView(t.value)}>
            {t.label}
          </button>
        ))}
      </div>

      {view === 'feed' ? (
        <section className="gl-section">
          {coachHidden ? null : (
            <div className="gl-coach">
              <div>
                <b>How this teaches the app.</b> Every card carries a small rail on its top-right: heart = like, thumbs-down = not for
                me, and the rest file it as saved, want-to-try, want-to-buy or already yours. Those taps are the only taste data this
                build has — the order of this feed is arithmetic over them, not a model reading your face or your photos. Keep
                scrolling and it does not stop: once every card you own has been served, the feed goes into labelled{' '}
                <b>second-look</b> passes, reordered by what your log says is worth another decision. To make it deeper rather than
                just re-served, add your Pinterest saves, your own images, or a free image key in Settings.
              </div>
              <div className="gl-row gl-row--tight">
                <Button
                  size="sm"
                  variant="gold"
                  onClick={() => {
                    setRateOffset(0);
                    setRating(true);
                  }}
                >
                  Rate one by one
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    localStorage.setItem(COACH_KEY, '1');
                    setCoachHidden(true);
                  }}
                >
                  Got it
                </Button>
              </div>
            </div>
          )}

          {!cats.length && !query && feedVisible.length < 24 && libraryItems.length > 2 ? (
            <div style={{ marginBottom: 'var(--glow-sp-5)' }}>
              <div className="gl-label" style={{ marginBottom: 8 }}>
                The commissioned sets shipped inside this build — original artwork, not stock
              </div>
              <Carousel height={200}>
                {libraryItems.map((it, i) => (
                  <Pin key={String(it.id)} item={it} title={String(it.title)} sub="Glow Lab original" onOpen={() => setLibIndex(i)} />
                ))}
              </Carousel>
            </div>
          ) : null}

          {!feedVisible.length && !loading ? (
            <EmptyPlate
              kicker="Nothing to show"
              title="No reference matches that filter"
              body="This feed only contains real rows: the commissioned sets, your own uploads, links you pasted, and providers whose key you saved. Nothing is invented to fill the space."
              action={
                <div className="gl-row gl-row--tight">
                  <Button
                    onClick={() => {
                      setCats([]);
                      setSearch('');
                      setSources(ALL_SOURCE_IDS);
                    }}
                  >
                    Clear filters
                  </Button>
                  <PhotoPicker kind="upload" album="My uploads" label="Upload a reference" onPick={(rows) => rows[0] && setUploadDraft(rows[0])} />
                </div>
              }
            />
          ) : (
            <MasonryFeed
              items={feedVisible}
              hasMore={hasMore}
              onLoadMore={loadMore}
              skeleton={loading ? 3 : 0}
              render={(it: AnyRow) => {
                const st = stateOf(it);
                const why = rank === 'dna' ? whyParts(it, dna, identityLabel, affinityOfItem(it)) : [];
                const lapOf = Number((it.data as Record<string, unknown>)?.lap ?? 0);
                const badges = [
                  lapOf ? `Second look` : '',
                  st.saved ? 'Saved' : '',
                  st.liked ? 'Liked' : '',
                  st.tried ? 'Try' : '',
                  st.bought ? 'Buy' : '',
                  st.owned ? 'Yours' : '',
                  st.disliked ? 'Not for me' : ''
                ].filter(Boolean);
                return (
                  <div className="gl-feedcell">
                    <Pin
                      item={it}
                      title={String(it.title ?? 'Untitled reference')}
                      sub={`${((it.categories as string[]) ?? []).slice(0, 2).join(' · ')}${it.aesthetic ? ` · ${it.aesthetic}` : ''}`}
                      badge={badges.length ? <span className="gl-tech">{badges.join(' · ')}</span> : undefined}
                      actions={pinActions(it)}
                      onOpen={() => openWith(it, feedVisible)}
                    />
                    <div className="gl-feedcell__lic">
                      <Chip tone="info" title={String(it.license ?? '')}>
                        {String(it.providerId ?? 'unknown source')}
                      </Chip>
                      {it.recreatable ? <Chip>Recreatable</Chip> : null}
                      {String(it.providerId ?? '') === 'glow-lab-library' ? <Chip tone="gold">Glow Lab original</Chip> : null}
                      {st.boards.length ? <Chip tone="gold">{st.boards.length} board(s)</Chip> : null}
                    </div>
                    <div className="gl-why">
                      {lapOf ? (
                        <span>
                          Second look, pass {lapOf}. Your library holds {liveItems.length} card(s) and the feed has served every one, so
                          from here it re-serves them in the order your interaction log says is worth another decision — nothing is
                          invented to fill the gap, and hiding a card here takes it out of the rotation.
                        </span>
                      ) : rank !== 'dna' ? (
                        <span>
                          Ordered by {rank === 'newest' ? 'the date the record entered your library' : 'raw provider order'} — taste is not
                          influencing this list.
                        </span>
                      ) : why.length ? (
                        <>
                          <b>Why you’re seeing this:</b>{' '}
                          {why.map((w) => (
                            <span key={w.label}>
                              <span className="gl-why__pts">
                                {w.points > 0 ? `+${w.points.toFixed(2)}` : w.points.toFixed(2)}
                              </span>{' '}
                              from “{w.label}”
                              {w.score ? ` (your signal ${w.score.toFixed(1)}, ${w.kind})` : ''}{' '}
                            </span>
                          ))}
                          <span className="gl-faint">Arithmetic over your logged actions — no model, no guess.</span>
                        </>
                      ) : (
                        <span>No stored signal matches this reference yet, so it sits here on source order alone.</span>
                      )}
                    </div>
                  </div>
                );
              }}
            />
          )}
        </section>
      ) : null}

      {view === 'states' ? (
        <section className="gl-section">
          <div className="gl-note">
            Every state below is a row in <code>discoveryInteractions</code>. Latest action wins, so “un-hiding” is recorded as re-opening the
            item rather than as a delete you could not audit.
          </div>
          <div className="gl-states" style={{ marginTop: 'var(--glow-sp-4)' }}>
            {[
              { title: 'Saved collection', list: saved.savedList },
              { title: 'Things I like', list: saved.liked },
              { title: 'Want to try', list: saved.tryList },
              { title: 'Want to buy', list: saved.buyList },
              { title: 'Already own', list: saved.ownList },
              { title: 'Disliked', list: saved.disliked },
              { title: 'Hidden or reported — out of your feed', list: saved.hidden },
              { title: 'Recently viewed', list: saved.viewed }
            ].map((block) => (
              <div key={block.title} className="gl-states__block">
                <div className="gl-states__head">
                  <h3 style={{ margin: 0 }}>{block.title}</h3>
                  <span className="gl-tech">{block.list.length}</span>
                </div>
                {block.list.length ? (
                  <>
                    <div className="gl-masonry">
                      {block.list.slice(0, 12).map((it) => (
                        <Pin
                          key={String(it.id)}
                          item={it}
                          title={String(it.title ?? '')}
                          sub={String(it.aesthetic ?? it.providerId ?? '')}
                          actions={pinActions(it)}
                          onOpen={() => openWith(it, block.list)}
                        />
                      ))}
                    </div>
                    {block.title.startsWith('Hidden') ? (
                      <div className="gl-row gl-row--tight" style={{ marginTop: 'var(--glow-sp-3)' }}>
                        {block.list.slice(0, 6).map((it) => (
                          <Button key={String(it.id)} size="sm" variant="ghost" onClick={() => void writeInteraction(it, 'view')}>
                            Show “{String(it.title).slice(0, 20)}” again
                          </Button>
                        ))}
                      </div>
                    ) : null}
                  </>
                ) : (
                  <p className="gl-small gl-faint">Nothing recorded yet — this only fills when you actually perform the action.</p>
                )}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {view === 'links' ? (
        <section className="gl-section">
          <div className="gl-split">
            <div className="gl-stack">
              <EmptyPlate
                kicker="Manual references"
                title="Links you pasted yourself"
                body="Glow Lab never scrapes Pinterest or any other site. Paste a link, keep your own note, and open the original when you want to look at it. Link, note and provider tag are stored on this device."
                action={
                  <Button variant="primary" onClick={() => setLinkOpen(true)}>
                    Paste a reference link
                  </Button>
                }
              />
              <div className="gl-linklist">
                {refs
                  .filter((r) => !r.deletedAt)
                  .map((r) => (
                    <div key={String(r.id)} className="gl-linklist__row">
                      <div>
                        <div className="gl-serif">{String(r.title || r.url)}</div>
                        <div className="gl-tech">
                          {String(r.provider || 'manual')} · {String(r.url).slice(0, 60)}
                        </div>
                        {r.note ? <div className="gl-small gl-muted">{String(r.note)}</div> : null}
                        {r.boardHint ? <Chip>{String(r.boardHint)}</Chip> : null}
                        {r.imported ? <Chip tone="gold">copied into library</Chip> : null}
                      </div>
                      <div className="gl-row gl-row--tight">
                        <Button size="sm" onClick={() => window.open(String(r.url), '_blank', 'noopener')} icon={<ExternalLink size={13} />}>
                          Open
                        </Button>
                        <IconButton
                          label={`Delete reference ${String(r.title || r.url)}`}
                          onClick={() =>
                            setAsk({
                              title: 'Remove this reference link?',
                              body: 'Soft-deleted, so it stays restorable until you purge deleted records in Settings.',
                              run: () => void softDelete(TABLES.manualReferences, String(r.id))
                            })
                          }
                        >
                          <Trash2 size={14} />
                        </IconButton>
                      </div>
                    </div>
                  ))}
                {!refs.filter((r) => !r.deletedAt).length ? <p className="gl-small gl-faint">No links saved yet.</p> : null}
              </div>
            </div>
            <Panel>
              <h3 style={{ marginTop: 0 }}>What can and cannot be shown</h3>
              <KvList
                items={[
                  { k: 'Pasted link', v: 'Stored, searchable, opened in your browser' },
                  { k: 'The pin image behind it', v: 'Never fetched automatically — the source site decides' },
                  { k: 'Pinterest boards', v: 'Only through your own authorised connection in Settings' },
                  { k: 'Taste learning', v: 'Pinterest-sourced items are deliberately excluded from your DNA' },
                  { k: 'Your uploads', v: 'Become ordinary feed entries you can tag, board and recreate' }
                ]}
              />
            </Panel>
          </div>
        </section>
      ) : null}

      {view === 'signals' ? (
        <section className="gl-section">
          <div className="gl-split">
            <div className="gl-stack">
              <h2 className="gl-serif">Your last actions, in order</h2>
              <Timeline
                items={[...interactions]
                  .sort((a, b) => Number(b.createdAt) - Number(a.createdAt))
                  .slice(0, 18)
                  .map((x) => {
                    const it = liveItems.find((i) => String(i.id) === String(x.itemId));
                    return {
                      when: new Date(Number(x.createdAt)).toLocaleString(),
                      title: ACTION_LABEL[String(x.action) as Action] ?? String(x.action),
                      body: `${it ? String(it.title) : 'a record you have since removed'} · weight ${Number(x.weight ?? 0)}${
                        x.reason ? ` — ${String(x.reason)}` : ''
                      }`,
                      tone: (Number(x.weight) >= 0 ? 'accent' : 'plain') as 'accent' | 'plain'
                    };
                  })}
              />
              {!interactions.length ? <p className="gl-small gl-faint">No actions logged yet, so the feed is in plain library order.</p> : null}
            </div>
            <div className="gl-stack">
              <Panel>
                <h3 style={{ marginTop: 0 }}>Signals for “{identityLabel}”</h3>
                <p className="gl-small gl-muted">
                  <code>engine/taste.ts</code> aggregated {dna?.interactions ?? 0} weighted actions. Confidence rises with volume and halves
                  itself until one signal crosses ±3. Correct any of it in Inspiration Universe.
                </p>
                <div className="gl-row gl-row--tight" style={{ flexWrap: 'wrap' }}>
                  {(dna?.top ?? []).slice(0, 10).map((s) => (
                    <Chip key={s.key} tone="gold" title={`${s.kind} · ${s.positives} positive, ${s.negatives} negative actions`}>
                      {s.key} {s.score.toFixed(1)}
                    </Chip>
                  ))}
                  {!dna?.top.length ? <span className="gl-small gl-faint">No strong signal yet.</span> : null}
                </div>
                <div className="gl-row gl-row--tight" style={{ flexWrap: 'wrap', marginTop: 'var(--glow-sp-3)' }}>
                  {(dna?.aversions ?? []).map((s) => (
                    <Chip key={s.key} tone="danger" title={`${s.kind} — you pushed this away`}>
                      Avoiding {s.key}
                    </Chip>
                  ))}
                  {(dna?.emerging ?? []).map((s) => (
                    <Chip key={s.key} tone="info" title="Two or more positives in the last 45 days">
                      Emerging: {s.key}
                    </Chip>
                  ))}
                </div>
                <div className="gl-row" style={{ marginTop: 'var(--glow-sp-4)' }}>
                  <Button
                    size="sm"
                    onClick={() => {
                      void saveRow(TABLES.profile, {
                        kind: 'aesthetic-dna',
                        singleton: 1,
                        data: {
                          identity,
                          signals: (dna?.top ?? []).map((t) => ({ key: t.key, kind: t.kind, score: Math.round(t.score * 10) / 10 })),
                          aversions: (dna?.aversions ?? []).map((t) => t.key),
                          confidence: Math.round((dna?.confidence ?? 0) * 100),
                          computedAt: Date.now()
                        }
                      });
                      toast('DNA snapshot saved to Profile as a real record.');
                    }}
                  >
                    Save this snapshot to Profile
                  </Button>
                  <span className="gl-small gl-faint">
                    {totalFilterable} categories filterable · identity affinity is 45% of the ranking, DNA signals 55%.
                  </span>
                </div>
              </Panel>
            </div>
          </div>
        </section>
      ) : null}

      {rating ? (
        <QuickRate
          key={rateOffset}
          items={feedVisible.slice(rateOffset, rateOffset + 24)}
          onRate={(item, action) => writeInteraction(item, action)}
          onUndo={undoInteraction}
          onExit={() => setRating(false)}
          onRateMore={() => setRateOffset((o) => o + 24)}
        />
      ) : null}

      <Lightbox
        items={lbItems}
        index={lbIndex}
        onIndex={setLbIndex}
        onClose={() => setLbIndex(null)}
        header={(it) => (
          <div className="gl-row gl-row--tight">
            <span className="gl-eyebrow">{String(it.providerId ?? '')}</span>
            {it.aesthetic ? <Chip>{String(it.aesthetic)}</Chip> : null}
            {((it.categories as string[]) ?? []).slice(0, 3).map((c) => (
              <Chip key={c} tone="info">
                {c}
              </Chip>
            ))}
          </div>
        )}
        footer={(it) => {
          const st = stateOf(it);
          return (
            <div className="gl-stack" style={{ gap: 'var(--glow-sp-3)' }}>
              <div className="gl-serif" style={{ fontSize: '1.3rem' }}>
                {String(it.title)}
              </div>
              <p className="gl-small gl-muted" style={{ margin: 0 }}>
                {String(it.description ?? '')}
              </p>
              <div className="gl-row gl-row--tight" style={{ flexWrap: 'wrap' }}>
                <Button size="sm" variant={st.liked ? 'gold' : 'default'} onClick={() => toggleLike(it)}>
                  <Heart size={13} /> {st.liked ? 'Liked' : 'Like'}
                </Button>
                <Button size="sm" variant={st.saved ? 'gold' : 'default'} onClick={() => toggleSave(it)}>
                  <Bookmark size={13} /> {st.saved ? 'Saved' : 'Save'}
                </Button>
                <Button size="sm" onClick={() => void writeInteraction(it, 'try')}>
                  <Sparkles size={13} /> Want to try
                </Button>
                <Button size="sm" onClick={() => void writeInteraction(it, 'buy')}>
                  <ShoppingBag size={13} /> Want to buy
                </Button>
                <Button size="sm" onClick={() => void writeInteraction(it, 'own')}>
                  <Check size={13} /> Already own
                </Button>
                <Button size="sm" variant={st.more ? 'gold' : 'default'} onClick={() => void writeInteraction(it, 'more')}>
                  More like this
                </Button>
                <Button size="sm" variant={st.less ? 'gold' : 'default'} onClick={() => void writeInteraction(it, 'less')}>
                  Less like this
                </Button>
                <Button size="sm" onClick={() => setBoardFor(it)}>
                  <Layers size={13} /> Board / moodboard / goal
                </Button>
                <Button size="sm" onClick={() => void share(it)}>
                  <Share2 size={13} /> Share
                </Button>
                <Button size="sm" onClick={() => openSource(it)}>
                  <ExternalLink size={13} /> Open source
                </Button>
                <Button size="sm" onClick={() => void writeInteraction(it, 'hide')}>
                  Hide this item
                </Button>
                <Button size="sm" variant="danger" onClick={() => setReportFor(it)}>
                  <Flag size={13} /> Report
                </Button>
              </div>
              <KvList
                items={[
                  { k: 'Licence', v: String(it.license || 'Not stated — verify before reuse') },
                  { k: 'Attribution', v: String(it.attribution || 'None supplied') },
                  {
                    k: 'Source',
                    v: it.sourceUrl ? (
                      <a href={String(it.sourceUrl)} target="_blank" rel="noreferrer">
                        {String(it.sourceUrl)}
                      </a>
                    ) : (
                      'No external source — this reference lives in your library only'
                    )
                  },
                  { k: 'Stored as', v: `${String(it.providerId)} · ${backingId(it)}` }
                ]}
              />
            </div>
          );
        }}
      />
      <Lightbox
        items={libraryItems}
        index={libIndex}
        onIndex={setLibIndex}
        onClose={() => setLibIndex(null)}
        footer={(it) => (
          <p className="gl-small" style={{ margin: 0 }}>
            <b>{String(it.attribution)}</b> — {String(it.license)}. The twelve commissioned sets are original artwork made for this application:
            no brand, product or price is implied, and nothing here is hotlinked.
          </p>
        )}
      />

      <Modal
        open={Boolean(reportFor)}
        onClose={() => setReportFor(null)}
        title="Report this reference"
        footer={
          <>
            <span className="gl-small gl-faint">Reporting removes it from your feed and is your strongest negative weight (−4).</span>
            <Button
              variant="danger"
              onClick={async () => {
                if (!reportFor) return;
                await writeInteraction(reportFor, 'report', { reason: `${reportReason}${reportNote ? `: ${reportNote}` : ''}` });
                setReportFor(null);
                setReportNote('');
              }}
            >
              Report and hide
            </Button>
          </>
        }
      >
        <Field label="Why?">
          <Select value={reportReason} onChange={setReportReason} options={REPORT_REASONS.map((r) => ({ value: r, label: r }))} />
        </Field>
        <Field label="Note — only ever stored on this device">
          <TextArea value={reportNote} onChange={setReportNote} placeholder="What exactly is wrong with it" />
        </Field>
      </Modal>

      <Modal
        open={Boolean(boardFor)}
        onClose={() => setBoardFor(null)}
        title={`Put “${boardFor ? String(boardFor.title).slice(0, 40) : ''}” on a board`}
        footer={
          <>
            <span className="gl-small gl-faint">Writes the board membership and a weighted interaction row.</span>
            <Button
              variant="primary"
              onClick={async () => {
                if (!boardFor || !boardPick) {
                  toast('Pick or create a board first.', 'bad');
                  return;
                }
                await assignBoard(boardPick, boardFor);
                setBoardFor(null);
              }}
            >
              Add to board
            </Button>
          </>
        }
      >
        <Field label="Existing board">
          <Select
            value={boardPick}
            onChange={setBoardPick}
            placeholder="Choose a board"
            options={boards.filter((b) => !b.deletedAt).map((b) => ({ value: String(b.id), label: `${String(b.name)} · ${String(b.kind)}` }))}
          />
        </Field>
        <Field label="…or a new board" hint="Created as an inspiration board; rename or re-kind it in Inspiration Universe.">
          <div className="gl-row gl-row--tight">
            <TextInput value={boardNew} onChange={setBoardNew} placeholder="e.g. Vamp winter" />
            <Button onClick={() => void createAndAdd()}>Create</Button>
          </div>
        </Field>
      </Modal>

      <Modal
        open={Boolean(uploadDraft)}
        onClose={() => setUploadDraft(null)}
        title="Tag your own reference"
        wide
        footer={
          <>
            <span className="gl-small gl-faint">
              Nothing is detected for you — this build has no image-recognition service, so these tags are yours and they feed your DNA.
            </span>
            <Button
              variant="primary"
              onClick={async () => {
                if (!uploadDraft) return;
                await saveRow(TABLES.discoveryItems, {
                  slug: `my-uploads-${uploadDraft.id}`,
                  providerId: 'my-uploads',
                  title: uploadTags.title || String(uploadDraft.title || 'My upload'),
                  description: uploadTags.description,
                  categories: uploadTags.categories,
                  aesthetic: uploadTags.aesthetic,
                  palette: uploadTags.palette,
                  elements: uploadTags.elements,
                  mediaId: String(uploadDraft.id),
                  sourceUrl: '',
                  attribution: 'Uploaded by you — private by default',
                  license: 'User-owned',
                  recreatable: uploadTags.recreatable,
                  seed: 0,
                  data: { identity }
                });
                setUploadDraft(null);
                toast('Your image is now part of the feed.', 'ok');
                void loadRef.current(1, true);
              }}
            >
              Save to the feed
            </Button>
          </>
        }
      >
        <div className="gl-form-row">
          <Field label="Title">
            <TextInput value={uploadTags.title} onChange={(v) => setUploadTags({ ...uploadTags, title: v })} placeholder="What this reference means to you" />
          </Field>
          <Field label="Aesthetic tag" hint="Use one of yours or invent it — it becomes a signal.">
            <TextInput value={uploadTags.aesthetic} onChange={(v) => setUploadTags({ ...uploadTags, aesthetic: v })} placeholder="dark feminine" />
          </Field>
        </div>
        <Field label="Categories">
          <TagInput values={uploadTags.categories} onChange={(v) => setUploadTags({ ...uploadTags, categories: v })} placeholder="type a category, press Enter" />
        </Field>
        <Field label="Elements you can actually see">
          <TagInput values={uploadTags.elements} onChange={(v) => setUploadTags({ ...uploadTags, elements: v })} placeholder="satin wrap, pointed boot…" />
        </Field>
        <Field label="Palette hexes (the app did extract these from the file itself — edit freely)">
          <TagInput values={uploadTags.palette} onChange={(v) => setUploadTags({ ...uploadTags, palette: v })} placeholder="#6b1226, press Enter" />
        </Field>
        <Field label="Why you kept it">
          <TextArea value={uploadTags.description} onChange={(v) => setUploadTags({ ...uploadTags, description: v })} />
        </Field>
        <Toggle
          checked={uploadTags.recreatable}
          onChange={(v) => setUploadTags({ ...uploadTags, recreatable: v })}
          label="Worth recreating"
          hint="Puts it in the reference list of Recreate This Look."
        />
      </Modal>

      <Modal open={pinOpen} onClose={() => setPinOpen(false)} title="Bring your Pinterest saves into the feed" wide>
        <PinterestImport
          onImported={() => {
            void loadRef.current(1, true);
          }}
        />
      </Modal>

      <Modal
        open={linkOpen}
        onClose={() => setLinkOpen(false)}
        title="Save a reference link"
        footer={
          <>
            <span className="gl-small gl-faint">Stored in manualReferences. Nothing is fetched, scraped or mirrored.</span>
            <Button
              variant="primary"
              onClick={async () => {
                const url = linkDraft.url.trim();
                if (!/^https?:\/\//i.test(url)) {
                  toast('That is not an http(s) link.', 'bad');
                  return;
                }
                let provider = 'manual';
                try {
                  const host = new URL(url).hostname;
                  provider = host.includes('pinterest') ? 'pinterest' : host.split('.')[0];
                } catch {
                  /* stays manual */
                }
                await saveRow(TABLES.manualReferences, {
                  url,
                  title: linkDraft.title.trim() || url.slice(0, 60),
                  note: linkDraft.note.trim(),
                  provider,
                  boardHint: identity,
                  imported: false
                });
                setLinkDraft({ url: '', title: '', note: '' });
                setLinkOpen(false);
                setView('links');
                toast('Link saved locally.', 'ok');
              }}
            >
              Save link
            </Button>
          </>
        }
      >
        <Field label="URL — a pin, a magazine page, anything">
          <TextInput value={linkDraft.url} onChange={(v) => setLinkDraft({ ...linkDraft, url: v })} placeholder="https://pin.it/…" />
        </Field>
        <Field label="Title">
          <TextInput value={linkDraft.title} onChange={(v) => setLinkDraft({ ...linkDraft, title: v })} />
        </Field>
        <Field label="Your note — what you take from it">
          <TextArea value={linkDraft.note} onChange={(v) => setLinkDraft({ ...linkDraft, note: v })} />
        </Field>
      </Modal>

      <Modal
        open={catOpen}
        onClose={() => setCatOpen(false)}
        title="New custom category"
        footer={
          <>
            <span className="gl-small gl-faint">Saved as a knowledge record, so it is searchable and exportable.</span>
            <Button variant="primary" onClick={() => void addCustomCat()}>
              Save category
            </Button>
          </>
        }
      >
        <Field label="Name">
          <TextInput value={catDraft.name} onChange={(v) => setCatDraft({ ...catDraft, name: v })} placeholder="e.g. Mob wife coats" />
        </Field>
        <Field label="Filed under">
          <Select value={catDraft.group} onChange={(v) => setCatDraft({ ...catDraft, group: v })} options={[...GROUPS, 'YOUR CATEGORIES'].map((g) => ({ value: g, label: g }))} />
        </Field>
        <p className="gl-small gl-faint">{totalFilterable} categories are currently filterable, including the ones you made.</p>
      </Modal>

      <Modal
        open={Boolean(ask)}
        onClose={() => setAsk(null)}
        title={ask?.title ?? ''}
        footer={
          <>
            <span className="gl-small gl-faint">Nothing leaves this device.</span>
            <div className="gl-row gl-row--tight">
              <Button variant="ghost" onClick={() => setAsk(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  ask?.run();
                  setAsk(null);
                }}
              >
                Confirm
              </Button>
            </div>
          </>
        }
      >
        <p className="gl-small">{ask?.body}</p>
      </Modal>
    </div>
  );
}

function Panel({ children }: { children: ReactNode }) {
  return <div className="gl-card gl-card--plain">{children}</div>;
}
