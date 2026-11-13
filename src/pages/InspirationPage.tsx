import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Archive,
  ArrowLeft,
  Bookmark,
  Check,
  Copy,
  Download,
  Grid2x2,
  Heart,
  Images,
  Layers,
  Pencil,
  Plus,
  RotateCcw,
  ShoppingBag,
  Sparkles,
  Star,
  ThumbsDown,
  Trash2
} from 'lucide-react';
import {
  Button,
  Chip,
  Field,
  IconButton,
  Meter,
  Modal,
  SegmentedControl,
  Select,
  TextArea,
  TextInput,
  useToast
} from '../ui/primitives';
import { Chipbar, DeptIntro, EmptyPlate, IndexList, IndexRow, KvList, PullQuote, StatStrip } from '../ui/editorial';
import { Pin, type PinAction } from '../ui/media';
import { saveRow, useRows } from '../hooks/live';
import { softDelete, todayISO } from '../db/repo';
import { TABLES, type AnyRow, type BoardRow, type DiscoveryInteractionRow } from '../db/schema';
import { ACTION_WEIGHT, computeDna, scoreAgainstDna, type AestheticDna, type TasteSignal } from '../engine/taste';
import { AESTHETIC_IDENTITIES } from '../content/referenceLibrary';
import { useImageSrc } from '../media/store';
import '../styles/departments/discover.css';
import '../styles/departments/inspiration.css';

type Action = DiscoveryInteractionRow['action'];
type BoardKind = BoardRow['kind'];

const IDENTITIES = AESTHETIC_IDENTITIES.map((i) => ({ value: String(i).toLowerCase(), label: String(i) }));
const KINDS: { value: BoardKind; label: string; note: string }[] = [
  { value: 'inspiration', label: 'Inspiration board', note: 'A running set of references you keep coming back to.' },
  { value: 'moodboard', label: 'Moodboard', note: 'A composition — arranged on the canvas, exportable as a brief.' },
  { value: 'collection', label: 'Collection', note: 'Things you have decided you like, in one place.' },
  { value: 'goal', label: 'Goal board', note: 'The look you are working toward; strongest taste weight (+4).' }
];
const BOARD_ACTION: Record<BoardKind, Action> = { inspiration: 'board', moodboard: 'mood', collection: 'board', goal: 'goal' };
const COLS = 3;

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

function pos(itemId: string, index: number, positions: Record<string, { x: number; y: number; z: number }>) {
  const known = positions[itemId];
  if (known) return known;
  return { x: 2 + (index % COLS) * 32.5, y: 2 + Math.floor(index / COLS) * 25, z: index };
}

function paletteOf(items: AnyRow[]) {
  const out: string[] = [];
  for (const it of items) for (const c of (it.palette as string[]) ?? []) if (c && !out.includes(c)) out.push(c);
  return out.slice(0, 8);
}

/** Discovery rows point at mediaItems; the pixels (or the remote URL) live there. */
function withImage(item: AnyRow | undefined, mediaById: Map<string, AnyRow>): AnyRow | undefined {
  if (!item) return undefined;
  const m = item.mediaId ? mediaById.get(String(item.mediaId)) : undefined;
  if (m) return { ...item, blobId: m.blobId, remoteUrl: m.remoteUrl, width: m.width, height: m.height };
  const d = (item.data ?? {}) as Record<string, unknown>;
  return { ...item, blobId: item.blobId ?? null, remoteUrl: String(item.remoteUrl ?? d.thumbUrl ?? d.remoteUrl ?? ''), width: Number(item.width ?? d.width ?? 0), height: Number(item.height ?? d.height ?? 0) };
}

function usePos(item: AnyRow | undefined) {
  return useImageSrc(item, 'thumb');
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

function downloadJson(name: string, payload: unknown) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export default function InspirationPage() {
  const toast = useToast();
  const boards = useRows(TABLES.boards);
  const items = useRows(TABLES.discoveryItems);
  const interactions = useRows(TABLES.discoveryInteractions);
  const media = useRows(TABLES.mediaItems);
  const knowledge = useRows(TABLES.knowledge);
  const profiles = useRows(TABLES.profile);

  const [view, setView] = useState<'boards' | 'dna' | 'collections'>('boards');
  const [openId, setOpenId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<{ name: string; kind: BoardKind; purpose: string; identity: string }>({
    name: '',
    kind: 'inspiration',
    purpose: '',
    identity: 'everyday'
  });
  const [renaming, setRenaming] = useState<AnyRow | null>(null);
  const [rename, setRename] = useState('');
  const [adding, setAdding] = useState(false);
  const [addQuery, setAddQuery] = useState('');
  const [addPick, setAddPick] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [purposeDraft, setPurposeDraft] = useState('');
  const [ask, setAsk] = useState<{ title: string; body: string; run: () => void } | null>(null);
  const [dnaIdentity, setDnaIdentity] = useState('everyday');
  const [correctionFor, setCorrectionFor] = useState<TasteSignal | null>(null);
  const [correctionNote, setCorrectionNote] = useState('');
  const [compare, setCompare] = useState<{ a: TasteSignal | null; b: TasteSignal | null }>({ a: null, b: null });

  const mediaById = useMemo(() => new Map(media.map((m) => [String(m.id), m])), [media]);
  const itemById = useMemo(() => new Map(items.map((i) => [String(i.id), withImage(i, mediaById) as AnyRow])), [items, mediaById]);
  const liveBoards = useMemo(() => boards.filter((b) => !b.deletedAt), [boards]);
  const visibleBoards = useMemo(
    () => liveBoards.filter((b) => (showArchived ? true : !((b.data ?? {}) as Record<string, unknown>).archived)),
    [liveBoards, showArchived]
  );
  const archivedCount = liveBoards.filter((b) => ((b.data ?? {}) as Record<string, unknown>).archived).length;
  const board = openId ? liveBoards.find((b) => String(b.id) === openId) : undefined;

  const lastByItem = useMemo(() => {
    const map = new Map<string, Record<string, boolean>>();
    for (const x of [...interactions].sort((a, b) => Number(a.createdAt) - Number(b.createdAt))) {
      const key = String(x.itemId);
      const cur = { ...(map.get(key) ?? {}) };
      const action = String(x.action) as Action;
      if (action === 'unlike') cur.like = false;
      else if (action === 'unsave') cur.save = false;
      else cur[action] = action !== 'view' && action !== 'share' && action !== 'open-source';
      if (action === 'like') cur.dislike = false;
      if (action === 'dislike') cur.like = false;
      map.set(key, cur);
    }
    return map;
  }, [interactions]);

  const stateOf = useCallback(
    (id: string) => {
      const st = lastByItem.get(id) ?? {};
      return {
        liked: Boolean(st.like),
        saved: Boolean(st.save),
        tried: Boolean(st.try),
        bought: Boolean(st.buy),
        owned: Boolean(st.own),
        disliked: Boolean(st.dislike)
      };
    },
    [lastByItem]
  );

  const logAction = useCallback(
    async (itemId: string, action: Action, extra: { boardId?: string | null; reason?: string } = {}) => {
      await saveRow(TABLES.discoveryInteractions, {
        itemId,
        action,
        weight: ACTION_WEIGHT[action],
        boardId: extra.boardId ?? null,
        reason: extra.reason ?? '',
        tags: [action],
        data: { surface: 'inspiration', on: todayISO(), identity: dnaIdentity }
      });
    },
    [dnaIdentity]
  );

  /* ------------------------------------------------------------------ board */
  const members = useMemo(() => {
    if (!board) return [];
    return ((board.itemIds as string[]) ?? []).map((id) => itemById.get(String(id))).filter((v): v is AnyRow => Boolean(v));
  }, [board, itemById]);

  const positions = useMemo(
    () => (((board?.data ?? {}) as Record<string, unknown>).positions ?? {}) as Record<string, { x: number; y: number; z: number }>,
    [board]
  );
  const notes = useMemo(
    () => (((board?.data ?? {}) as Record<string, unknown>).notes ?? {}) as Record<string, string>,
    [board]
  );
  const order = useMemo(() => ((board?.itemIds as string[]) ?? []).map(String), [board]);

  const [localPos, setLocalPos] = useState(positions);
  useEffect(() => setLocalPos(positions), [positions, openId]);
  useEffect(() => setPurposeDraft(String(board?.purpose ?? '')), [openId]);
  useEffect(() => {
    if (!selected) return;
    setNoteDraft((((board?.data ?? {}) as Record<string, unknown>).notes as Record<string, string> | undefined)?.[selected] ?? '');
  }, [selected, openId]);

  const persistPositions = useCallback(
    async (next: Record<string, { x: number; y: number; z: number }>) => {
      if (!board) return;
      await saveRow(TABLES.boards, {
        id: String(board.id),
        data: { ...((board.data as Record<string, unknown>) ?? {}), positions: next }
      });
    },
    [board]
  );

  const boardRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ id: string; dx: number; dy: number; moved: boolean } | null>(null);

  const onItemPointerDown = (e: React.PointerEvent, id: string, p: { x: number; y: number; z: number }) => {
    const rect = boardRef.current?.getBoundingClientRect();
    if (!rect) return;
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    drag.current = { id, dx: px * 100 - p.x, dy: py * 100 - p.y, moved: false };
    setSelected(id);
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  };

  const onBoardPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const rect = boardRef.current?.getBoundingClientRect();
    if (!d || !rect) return;
    const x = Math.max(0, Math.min(78, ((e.clientX - rect.left) / rect.width) * 100 - d.dx));
    const y = Math.max(0, Math.min(88, ((e.clientY - rect.top) / rect.height) * 100 - d.dy));
    d.moved = true;
    setLocalPos((prev) => ({ ...prev, [d.id]: { ...(prev[d.id] ?? pos(d.id, 0, {})), x, y } }));
  };

  const onBoardPointerUp = async () => {
    if (!drag.current?.moved) {
      drag.current = null;
      return;
    }
    drag.current = null;
    await persistPositions(localPos);
    toast('Canvas arrangement saved — it reloads exactly where you left it.');
  };

  const nudge = async (id: string, dx: number, dy: number) => {
    const cur = localPos[id] ?? pos(id, order.indexOf(id), localPos);
    const next = { ...localPos, [id]: { ...cur, x: Math.max(0, Math.min(78, cur.x + dx)), y: Math.max(0, Math.min(88, cur.y + dy)) } };
    setLocalPos(next);
    await persistPositions(next);
  };

  const reOrder = async (id: string, dir: -1 | 1) => {
    if (!board) return;
    const ids = [...order];
    const i = ids.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    await saveRow(TABLES.boards, { id: String(board.id), itemIds: ids });
  };

  const autoArrange = async () => {
    const next: Record<string, { x: number; y: number; z: number }> = {};
    order.forEach((id, i) => {
      next[id] = { x: 2 + (i % COLS) * 32.5, y: 2 + Math.floor(i / COLS) * 25, z: i };
    });
    setLocalPos(next);
    await persistPositions(next);
    toast('Tidied into a grid.');
  };

  const createBoard = async () => {
    const name = draft.name.trim();
    if (!name) {
      toast('A board needs a name.', 'bad');
      return;
    }
    const saved = await saveRow(TABLES.boards, {
      kind: draft.kind,
      name,
      purpose: draft.purpose.trim(),
      identity: draft.identity,
      coverMediaId: null,
      itemIds: [],
      palette: [],
      exported: false,
      data: { archived: false, positions: {}, notes: {}, createdAt: todayISO() }
    });
    setCreating(false);
    setDraft({ name: '', kind: draft.kind, purpose: '', identity: draft.identity });
    setOpenId(String(saved.id));
    setView('boards');
    toast(`Board “${name}” saved.`);
  };

  const duplicateBoard = async (b: AnyRow) => {
    const copy = await saveRow(TABLES.boards, {
      kind: b.kind as BoardKind,
      name: `${String(b.name)} (copy)`,
      purpose: String(b.purpose ?? ''),
      identity: String(b.identity ?? 'everyday'),
      coverMediaId: (b.coverMediaId as string) ?? null,
      itemIds: [...(((b.itemIds as string[]) ?? []) as string[])],
      palette: [...(((b.palette as string[]) ?? []) as string[])],
      exported: false,
      data: {
        ...(((b.data as Record<string, unknown>) ?? {}) as Record<string, unknown>),
        archived: false,
        duplicatedFrom: String(b.id),
        duplicatedAt: todayISO()
      }
    });
    for (const itemId of (b.itemIds as string[]) ?? []) {
      await logAction(itemId, BOARD_ACTION[String(b.kind) as BoardKind], { boardId: String(copy.id), reason: `Copied from “${String(b.name)}”` });
    }
    setOpenId(String(copy.id));
    toast('Board duplicated with its own arrangement and its own interaction rows.');
  };

  const setArchived = async (b: AnyRow, archived: boolean) => {
    await saveRow(TABLES.boards, {
      id: String(b.id),
      data: { ...((b.data as Record<string, unknown>) ?? {}), archived, archivedAt: archived ? todayISO() : null }
    });
    toast(archived ? 'Archived — still here, out of the way.' : 'Back in the active set.');
  };

  const addToBoard = async (itemIds: string[]) => {
    if (!board || !itemIds.length) return;
    const ids = [...new Set([...((board.itemIds as string[]) ?? []).map(String), ...itemIds])];
    const newItems = itemIds.map((i) => itemById.get(i)).filter(Boolean) as AnyRow[];
    await saveRow(TABLES.boards, {
      id: String(board.id),
      itemIds: ids,
      palette: paletteOf(ids.map((i) => itemById.get(i)).filter(Boolean) as AnyRow[]),
      coverMediaId: (board.coverMediaId as string) ?? (newItems[0]?.mediaId ? String(newItems[0].mediaId) : null),
      data: { ...((board.data as Record<string, unknown>) ?? {}) }
    });
    for (const id of itemIds) await logAction(id, BOARD_ACTION[String(board.kind) as BoardKind], { boardId: String(board.id) });
    setAdding(false);
    setAddPick([]);
    toast(`${itemIds.length} added to “${String(board.name)}” — membership and a weighted signal row, both stored.`);
  };

  const removeFromBoard = async (itemId: string) => {
    if (!board) return;
    await saveRow(TABLES.boards, {
      id: String(board.id),
      itemIds: ((board.itemIds as string[]) ?? []).map(String).filter((i) => i !== itemId),
      palette: paletteOf(((board.itemIds as string[]) ?? []).map(String).filter((i) => i !== itemId).map((i) => itemById.get(i)).filter(Boolean) as AnyRow[]),
      data: { ...((board.data as Record<string, unknown>) ?? {}), positions: localPos }
    });
    await logAction(itemId, 'unsave', { boardId: String(board.id), reason: `Removed from “${String(board.name)}”` });
    setSelected(null);
    toast('Removed from this board and logged as −2 against your taste.');
  };

  const saveNote = async (itemId: string, value: string) => {
    if (!board) return;
    await saveRow(TABLES.boards, {
      id: String(board.id),
      data: { ...((board.data as Record<string, unknown>) ?? {}), notes: { ...notes, [itemId]: value } }
    });
    toast('Note stored on the board, not on the shared reference.');
  };

  const exportBoard = async () => {
    if (!board) return;
    downloadJson(`glow-lab-${String(board.name).toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`, {
      app: 'THE GLOW LAB',
      record: 'board',
      exportedAt: new Date().toISOString(),
      board: {
        id: board.id,
        kind: board.kind,
        name: board.name,
        purpose: board.purpose,
        identity: board.identity,
        palette: board.palette,
        exported: true,
        arrangement: localPos,
        notes
      },
      items: members.map((m) => ({
        id: m.id,
        title: m.title,
        description: m.description,
        categories: m.categories,
        aesthetic: m.aesthetic,
        palette: m.palette,
        elements: m.elements,
        license: m.license,
        attribution: m.attribution,
        sourceUrl: m.sourceUrl,
        providerId: m.providerId
      })),
      note: 'Reference metadata only — no original image files are included in this export.'
    });
    await saveRow(TABLES.boards, {
      id: String(board.id),
      exported: true,
      data: { ...((board.data as Record<string, unknown>) ?? {}), exportedAt: todayISO(), positions: localPos }
    });
    toast('Board exported as JSON. Images are not embedded — licences and sources are.');
  };

  /* -------------------------------------------------------------------- dna */
  const [dna, setDna] = useState<AestheticDna | null>(null);
  useEffect(() => {
    let alive = true;
    void computeDna(dnaIdentity).then((d) => alive && setDna(d));
    return () => {
      alive = false;
    };
  }, [dnaIdentity, interactions.length, items.length]);

  const [identityScan, setIdentityScan] = useState<{ identity: string; top: number; count: number }[]>([]);
  useEffect(() => {
    let alive = true;
    void Promise.all(
      IDENTITIES.map(async (i) => {
        const d = await computeDna(i.value);
        return { identity: i.label, top: d.top.reduce((s, x) => s + Math.max(0, x.score), 0), count: d.interactions };
      })
    ).then((r) => alive && setIdentityScan(r));
    return () => {
      alive = false;
    };
  }, [interactions.length, items.length]);

  const corrections = useMemo(() => knowledge.filter((k) => ((k.tags as string[]) ?? []).includes('dna-correction')), [knowledge]);

  const allSignals = useMemo(() => {
    const d = dna ?? EMPTY_DNA;
    const map = new Map<string, TasteSignal>();
    for (const s of [...d.top, ...d.aversions, ...d.emerging, ...d.signals]) if (!map.has(s.key)) map.set(s.key, s);
    return [...map.values()].sort((a, b) => b.score - a.score);
  }, [dna]);

  const applyCorrection = async (signal: TasteSignal, mode: 'stronger' | 'weaker' | 'reject', note: string) => {
    const action: Action = mode === 'stronger' ? 'more' : mode === 'weaker' ? 'less' : 'dislike';
    const samples = signal.sampleIds.length ? signal.sampleIds.slice(0, 6) : [];
    if (!samples.length) {
      toast('This signal has no linked references to act on, so nothing was written.', 'bad');
      return;
    }
    for (const id of samples) await logAction(id, action, { reason: `DNA correction (${mode}): ${signal.key}${note ? ` — ${note}` : ''}` });
    await saveRow(TABLES.knowledge, {
      title: `DNA correction — ${signal.key}`,
      kind: 'observation',
      body: `You corrected the “${signal.key}” signal (${signal.kind}) as “${mode}” on ${todayISO()} while viewing the ${dnaIdentity} identity. ` +
        `Previous score ${signal.score.toFixed(1)} from ${signal.positives} positive and ${signal.negatives} negative actions across ${samples.length} reference(s). ` +
        `${note ? `Your note: “${note}”. ` : ''}This correction was written as ${samples.length} interaction row(s), so it changes the ranking by the same arithmetic as any other action.`,
      domain: 'aesthetic-dna',
      confidence: 5,
      worked: mode === 'stronger' ? 'yes' : mode === 'weaker' ? 'mixed' : 'no',
      linkedGoalIds: [],
      linkedTechniqueIds: [],
      linkedProductIds: [],
      linkedExperimentIds: [],
      tags: ['dna-correction', signal.key, mode],
      data: { signal: signal.key, kind: signal.kind, before: Math.round(signal.score * 10) / 10, mode, samples, identity: dnaIdentity, note }
    });
    setCorrectionFor(null);
    setCorrectionNote('');
    toast(`Correction recorded — ${samples.length} interaction row(s) plus a knowledge entry.`);
  };

  const saveSnapshot = async () => {
    const d = dna ?? EMPTY_DNA;
    const existing = profiles.find((p) => p.kind === 'aesthetic-dna' && p.singleton === 1);
    await saveRow(TABLES.profile, {
      id: existing?.id,
      kind: 'aesthetic-dna',
      singleton: 1,
      data: {
        identity: d.identity,
        signals: d.top.map((t) => ({ key: t.key, kind: t.kind, score: Math.round(t.score * 10) / 10 })),
        aversions: d.aversions.map((t) => t.key),
        emerging: d.emerging.map((t) => t.key),
        confidence: Math.round(d.confidence * 100),
        interactions: d.interactions,
        computedAt: Date.now()
      }
    });
    toast(existing ? 'Aesthetic DNA snapshot updated in your Profile.' : 'Aesthetic DNA snapshot saved to your Profile.');
  };

  /* ------------------------------------------------------------ collections */
  const collections = useMemo(() => {
    const pick = (test: (s: ReturnType<typeof stateOf>) => boolean) =>
      items.filter((i) => test(stateOf(String(i.id)))).map((i) => withImage(i, mediaById) as AnyRow);
    const seen = new Map<string, number>();
    for (const x of interactions) if (String(x.action) === 'view') seen.set(String(x.itemId), Number(x.createdAt));
    return [
      { title: 'Saved collection', list: pick((s) => s.saved) },
      { title: 'Things I like', list: pick((s) => s.liked) },
      { title: 'Want to try', list: pick((s) => s.tried) },
      { title: 'Want to buy', list: pick((s) => s.bought) },
      { title: 'Already own', list: pick((s) => s.owned) },
      { title: 'Disliked', list: pick((s) => s.disliked) },
      {
        title: 'Recently viewed',
        list: [...seen.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 24)
          .map(([id]) => itemById.get(id))
          .filter((v): v is AnyRow => Boolean(v))
      }
    ];
  }, [items, interactions, mediaById, stateOf, itemById]);

  const pinActions = useCallback(
    (item: AnyRow): PinAction[] => {
      const st = stateOf(String(item.id));
      return [
        { key: 'like', label: 'Like', icon: <Heart size={14} />, on: st.liked, onClick: () => void logAction(String(item.id), st.liked ? 'unlike' : 'like') },
        { key: 'save', label: 'Save', icon: <Bookmark size={14} />, on: st.saved, onClick: () => void logAction(String(item.id), st.saved ? 'unsave' : 'save') },
        { key: 'try', label: 'Want to try', icon: <Sparkles size={14} />, on: st.tried, onClick: () => void logAction(String(item.id), 'try') },
        { key: 'buy', label: 'Want to buy', icon: <ShoppingBag size={14} />, on: st.bought, onClick: () => void logAction(String(item.id), 'buy') },
        { key: 'own', label: 'Already own', icon: <Check size={14} />, on: st.owned, onClick: () => void logAction(String(item.id), 'own') },
        { key: 'dislike', label: 'Not for me', icon: <ThumbsDown size={14} />, on: st.disliked, onClick: () => void logAction(String(item.id), 'dislike') }
      ];
    },
    [stateOf, logAction]
  );

  const addPool = useMemo(() => {
    const q = addQuery.toLowerCase().trim();
    const onBoard = new Set(order);
    return items
      .map((i) => withImage(i, mediaById) as AnyRow)
      .filter((i) => !onBoard.has(String(i.id)))
      .filter((i) => !q || `${i.title} ${i.description} ${(i.categories as string[])?.join(' ') ?? ''} ${i.aesthetic}`.toLowerCase().includes(q));
  }, [items, mediaById, order, addQuery]);

  const selectedSignal = selected ? itemById.get(selected) : undefined;

  return (
    <div className="gl-page">
      <DeptIntro
        id="inspiration"
        actions={
          <>
            <Button
              variant="primary"
              icon={<Plus size={14} />}
              onClick={() => {
                setDraft({ ...draft, kind: 'inspiration' });
                setCreating(true);
              }}
            >
              New board
            </Button>
            <Button
              icon={<Layers size={14} />}
              onClick={() => {
                setDraft({ ...draft, kind: 'moodboard' });
                setCreating(true);
              }}
            >
              New moodboard
            </Button>
          </>
        }
        meta={[
          { label: 'Boards', value: `${visibleBoards.length}${archivedCount ? ` (+${archivedCount} archived)` : ''}` },
          { label: 'References inside', value: liveBoards.reduce((n, b) => n + ((b.itemIds as string[]) ?? []).length, 0) },
          { label: 'Signals logged', value: interactions.length },
          { label: 'Corrections', value: corrections.length }
        ]}
      />

      <div className="gl-tabs" role="tablist">
        {(
          [
            { value: 'boards', label: `Boards (${visibleBoards.length})` },
            { value: 'dna', label: 'Aesthetic DNA' },
            { value: 'collections', label: 'Collections' }
          ] as const
        ).map((t) => (
          <button key={t.value} type="button" role="tab" aria-selected={view === t.value} className="gl-tab" onClick={() => setView(t.value)}>
            {t.label}
          </button>
        ))}
      </div>

      {view === 'boards' && !board ? (
        <section className="gl-section">
          <div className="gl-row gl-row--between" style={{ marginBottom: 'var(--glow-sp-4)', gap: 'var(--glow-sp-3)', flexWrap: 'wrap' }}>
            <p className="gl-small gl-muted" style={{ margin: 0, maxWidth: '66ch' }}>
              Four kinds of board, one record type. Membership is stored on the board and mirrored as a weighted interaction, so a goal board
              shapes your taste profile harder than a passing like.
            </p>
            <div className="gl-row gl-row--tight">
              <Chip active={showArchived} onClick={() => setShowArchived((v) => !v)}>
                {showArchived ? 'Hiding nothing' : `Show archived (${archivedCount})`}
              </Chip>
              {KINDS.map((k) => (
                <Chip
                  key={k.value}
                  title={k.note}
                  onClick={() => {
                    setDraft({ ...draft, kind: k.value });
                    setCreating(true);
                  }}
                >
                  + {k.label}
                </Chip>
              ))}
            </div>
          </div>

          {visibleBoards.length ? (
            <div className="gl-boardrail">
              {visibleBoards.map((b) => (
                <BoardCard
                  key={String(b.id)}
                  board={b}
                  count={((b.itemIds as string[]) ?? []).length}
                  archived={Boolean(((b.data ?? {}) as Record<string, unknown>).archived)}
                  onOpen={() => {
                    setOpenId(String(b.id));
                    setSelected(null);
                  }}
                  onRename={() => {
                    setRenaming(b);
                    setRename(String(b.name));
                  }}
                  onDuplicate={() => void duplicateBoard(b)}
                  onArchive={() => void setArchived(b, !Boolean(((b.data ?? {}) as Record<string, unknown>).archived))}
                  onDelete={() =>
                    setAsk({
                      title: 'Delete this board?',
                      body: `“${String(b.name)}” is soft-deleted: its ${((b.itemIds as string[]) ?? []).length} memberships stay restorable until you purge deleted records in Settings. Interaction rows you logged from it are kept as history.`,
                      run: () => {
                        void softDelete(TABLES.boards, String(b.id));
                        toast('Board moved to deleted records — restorable in Settings.', 'ok');
                      }
                    })
                  }
                />
              ))}
            </div>
          ) : (
            <EmptyPlate
              kicker="Nothing here yet"
              title="No boards in the active set"
              body="Boards are the container half of this app: a reference you have liked, a plan you are building, a version of your style you want to keep an eye on. Create one and it persists like any other record."
              action={
                <Button variant="primary" onClick={() => setCreating(true)}>
                  Create your first board
                </Button>
              }
            />
          )}
        </section>
      ) : null}

      {view === 'boards' && board ? (
        <section className="gl-section">
          <div className="gl-row gl-row--between" style={{ gap: 'var(--glow-sp-3)', flexWrap: 'wrap', marginBottom: 'var(--glow-sp-4)' }}>
            <Button variant="ghost" onClick={() => setOpenId(null)}>
              <ArrowLeft size={14} /> All boards
            </Button>
            <div className="gl-row gl-row--tight" style={{ flexWrap: 'wrap' }}>
              <Button variant="primary" icon={<Plus size={14} />} onClick={() => setAdding(true)} disabled={!members.length && !addPool.length}>
                Add references
              </Button>
              <Button icon={<Download size={14} />} onClick={() => void exportBoard()}>
                Export JSON
              </Button>
              <Button icon={<Grid2x2 size={14} />} onClick={() => void autoArrange()} disabled={!members.length}>
                Tidy grid
              </Button>
              <Button variant="ghost" onClick={() => void setArchived(board, !Boolean(((board.data ?? {}) as Record<string, unknown>).archived))}>
                <Archive size={14} /> {((board.data ?? {}) as Record<string, unknown>).archived ? 'Unarchive' : 'Archive'}
              </Button>
            </div>
          </div>

          <div className="gl-split">
            <div className="gl-stack">
              <div className="gl-board" ref={boardRef} onPointerMove={onBoardPointerMove} onPointerUp={onBoardPointerUp} onPointerLeave={onBoardPointerUp}>
                {members.length ? (
                  members.map((m, i) => {
                    const p = localPos[String(m.id)] ?? pos(String(m.id), i, localPos);
                    return (
                      <BoardItem
                        key={String(m.id)}
                        item={m}
                        style={{ left: `${p.x}%`, top: `${p.y}%`, zIndex: p.z }}
                        selected={selected === String(m.id)}
                        note={notes[String(m.id)] ?? ''}
                        onSelect={() => setSelected(String(m.id))}
                        onPointerDown={(e) => onItemPointerDown(e, String(m.id), p)}
                        buttons={
                          <>
                            <button type="button" onClick={() => void nudge(String(m.id), -6, 0)} title="Move left" aria-label="Move left">
                              ←
                            </button>
                            <button type="button" onClick={() => void nudge(String(m.id), 6, 0)} title="Move right" aria-label="Move right">
                              →
                            </button>
                            <button type="button" onClick={() => void nudge(String(m.id), 0, -5)} title="Move up" aria-label="Move up">
                              ↑
                            </button>
                            <button type="button" onClick={() => void nudge(String(m.id), 0, 5)} title="Move down" aria-label="Move down">
                              ↓
                            </button>
                            <button type="button" onClick={() => void reOrder(String(m.id), -1)} title="Earlier in the list" aria-label="Earlier in the list">
                              ⇤
                            </button>
                            <button type="button" onClick={() => void reOrder(String(m.id), 1)} title="Later in the list" aria-label="Later in the list">
                              ⇥
                            </button>
                          </>
                        }
                      />
                    );
                  })
                ) : (
                  <div className="gl-board__empty">
                    <div>
                      <div className="gl-serif" style={{ fontSize: '1.2rem', color: 'var(--glow-text-strong)' }}>
                        An empty {String(board.kind)} canvas
                      </div>
                      <p className="gl-small" style={{ maxWidth: '48ch', margin: '8px auto 0' }}>
                        Add references from your library and arrange them. Positions, order and notes save to this board row, so the composition
                        you leave here is the one you come back to.
                      </p>
                      <div style={{ marginTop: 'var(--glow-sp-3)' }}>
                        <Button variant="primary" onClick={() => setAdding(true)}>
                          <Plus size={14} /> Add references
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <p className="gl-small gl-faint">
                Drag, or use the arrow keys on each tile — both write the same position to <code>boards.data.positions</code>. Nothing here is
                simulated: only references you actually stored can appear.
              </p>
            </div>

            <div className="gl-stack">
              <div className="gl-card gl-card--plain">
                <div className="gl-eyebrow">{String(board.kind)}</div>
                <h2 className="gl-serif" style={{ margin: '6px 0 10px', fontSize: '1.6rem' }}>
                  {String(board.name)}
                </h2>
                <div className="gl-row gl-row--tight" style={{ flexWrap: 'wrap', marginBottom: 'var(--glow-sp-3)' }}>
                  <Chip tone="info">{IDENTITIES.find((i) => i.value === String(board.identity))?.label ?? String(board.identity)}</Chip>
                  <Chip>{members.length} references</Chip>
                  {board.exported ? <Chip tone="gold">Exported {String(((board.data ?? {}) as Record<string, unknown>).exportedAt ?? '')}</Chip> : null}
                  {((board.data ?? {}) as Record<string, unknown>).archived ? <Chip tone="danger">Archived</Chip> : null}
                </div>
                {paletteOf(members).length ? (
                  <div className="gl-swatch-set" title="Palette derived from the references on this board">
                    {paletteOf(members).map((c) => (
                      <i key={c} style={{ background: c }} />
                    ))}
                  </div>
                ) : (
                  <div className="gl-palette__empty gl-small gl-faint">No palette recorded on these references yet.</div>
                )}
                <div className="gl-row gl-row--tight" style={{ marginTop: 'var(--glow-sp-4)' }}>
                  <Button size="sm" icon={<Pencil size={13} />} onClick={() => { setRenaming(board); setRename(String(board.name)); }}>
                    Rename
                  </Button>
                  <Button size="sm" icon={<Copy size={13} />} onClick={() => void duplicateBoard(board)}>
                    Duplicate
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    icon={<Trash2 size={13} />}
                    onClick={() =>
                      setAsk({
                        title: 'Delete this board?',
                        body: 'Soft-deleted and restorable until you purge. The references themselves are untouched.',
                        run: () => void softDelete(TABLES.boards, String(board.id))
                      })
                    }
                  >
                    Delete
                  </Button>
                </div>
              </div>

              <Field label="Purpose — why this board exists">
                <TextArea value={purposeDraft} onChange={setPurposeDraft} placeholder="One sentence you will believe in later." rows={3} />
              </Field>
              <div className="gl-row gl-row--tight">
                <Button
                  size="sm"
                  variant="primary"
                  onClick={async () => {
                    await saveRow(TABLES.boards, { id: String(board.id), purpose: purposeDraft.trim() });
                    toast('Purpose saved.');
                  }}
                  disabled={purposeDraft === String(board.purpose ?? '')}
                >
                  Save purpose
                </Button>
                <Button size="sm" variant="ghost" icon={<RotateCcw size={13} />} onClick={() => setPurposeDraft(String(board.purpose ?? ''))} disabled={purposeDraft === String(board.purpose ?? '')}>
                  Revert
                </Button>
              </div>
              <Field label="Identity this board belongs to">
                <Select
                  value={String(board.identity ?? 'everyday')}
                  onChange={(v) => void saveRow(TABLES.boards, { id: String(board.id), identity: v })}
                  options={IDENTITIES}
                />
              </Field>

              {selectedSignal ? (
                <div className="gl-card gl-card--accent">
                  <div className="gl-eyebrow">Selected tile</div>
                  <h3 style={{ marginTop: 4 }}>{String(selectedSignal.title)}</h3>
                  <div className="gl-row gl-row--tight" style={{ flexWrap: 'wrap', margin: '8px 0' }}>
                    {((selectedSignal.categories as string[]) ?? []).slice(0, 4).map((c) => (
                      <Chip key={c} tone="info">
                        {c}
                      </Chip>
                    ))}
                  </div>
                  <Field label="Your note about this piece on this board">
                    <TextArea value={noteDraft} onChange={setNoteDraft} rows={3} placeholder="What exactly you would take from it" />
                  </Field>
                  <div className="gl-row gl-row--tight" style={{ marginTop: 'var(--glow-sp-3)' }}>
                    <Button size="sm" variant="primary" onClick={() => void saveNote(String(selectedSignal.id), noteDraft.trim())}>
                      Save note
                    </Button>
                    <Button size="sm" onClick={() => void saveRow(TABLES.boards, { id: String(board.id), coverMediaId: (selectedSignal.mediaId as string) ?? null })}>
                      <Star size={13} /> Set as cover
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => void removeFromBoard(String(selectedSignal.id))}>
                      Remove from board
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="gl-inset gl-small gl-muted">Select a tile to attach a note, set the board cover, or remove it.</div>
              )}

              <KvList
                items={[
                  { k: 'Licence care', v: members.every((m) => m.license) ? 'Every member carries its own licence line.' : 'Some members have no licence recorded — check before reuse.' },
                  { k: 'Originals inside', v: members.filter((m) => String(m.providerId) === 'glow-lab-library').length },
                  { k: 'Your uploads inside', v: members.filter((m) => String(m.providerId) === 'my-uploads').length },
                  { k: 'Cover', v: board.coverMediaId ? 'Set from a member image' : 'Not set — first member is used' }
                ]}
              />
            </div>
          </div>
        </section>
      ) : null}

      {view === 'dna' ? (
        <section className="gl-section">
          <StatStrip
            items={[
              { label: 'Signals', value: allSignals.length, hint: 'categories, aesthetics, palettes, elements' },
              { label: 'Weighted actions', value: dna?.interactions ?? 0 },
              { label: 'Confidence', value: `${Math.round((dna?.confidence ?? 0) * 100)}%` },
              { label: 'Your corrections', value: corrections.length }
            ]}
          />
          <div className="gl-row gl-row--between" style={{ gap: 'var(--glow-sp-4)', flexWrap: 'wrap', margin: 'var(--glow-sp-4) 0' }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="gl-label" style={{ marginBottom: 6 }}>View the DNA for one identity</div>
              <Chipbar items={IDENTITIES} value={dnaIdentity} onChange={setDnaIdentity} allLabel="Everyday (average of all)" />
            </div>
            <Button onClick={() => void saveSnapshot()}>Save snapshot to Profile</Button>
          </div>

          <div className="gl-dna">
            <div className="gl-stack">
              <div className="gl-card gl-card--plain">
                <h3 style={{ marginTop: 0 }}>Every signal, correctable</h3>
                <p className="gl-small gl-muted">
                  These are counters over your own <code>discoveryInteractions</code> rows — not a model. “Stronger”, “weaker” and “not me” write
                  real interaction rows against the references that produced the signal, so the next ranking uses them.
                </p>
                <Meter value={(dna?.confidence ?? 0) * 100} label="Confidence (40 weighted actions = 100%)" tone="var(--glow-metal)" />
                <div style={{ marginTop: 'var(--glow-sp-4)' }}>
                  {allSignals.slice(0, 40).map((s) => (
                    <div key={s.key} className="gl-signal">
                      <div className="gl-signal__name">
                        <div className="gl-serif" style={{ fontSize: '1.02rem' }}>
                          {s.key}
                        </div>
                        <div className="gl-tech">
                          {s.kind} · score {s.score.toFixed(1)} · {s.positives}+/{s.negatives}− · last {s.lastOn || '—'}
                        </div>
                      </div>
                      <div className="gl-signal__acts">
                        <button type="button" onClick={() => void applyCorrection(s, 'stronger', '')} title="Write +2 (more like this) on its sources">
                          Stronger
                        </button>
                        <button type="button" onClick={() => void applyCorrection(s, 'weaker', '')} title="Write −2 (less like this) on its sources">
                          Weaker
                        </button>
                        <button type="button" onClick={() => setCorrectionFor(s)} title="Record why before writing −3 (dislike)">
                          Not me
                        </button>
                      </div>
                    </div>
                  ))}
                  {!allSignals.length ? (
                    <p className="gl-small gl-faint">
                      No interactions yet for “{IDENTITIES.find((i) => i.value === dnaIdentity)?.label ?? dnaIdentity}”. Like, save or board a few
                      references in Glow Discover and the arithmetic appears here.
                    </p>
                  ) : null}
                </div>
              </div>
            </div>

            <div className="gl-stack">
              <div className="gl-card gl-card--plain">
                <h3 style={{ marginTop: 0 }}>Aversions &amp; emerging</h3>
                <div className="gl-row gl-row--tight" style={{ flexWrap: 'wrap' }}>
                  {(dna?.aversions ?? []).map((s) => (
                    <Chip key={s.key} tone="danger" title={`${s.kind} — score ${s.score.toFixed(1)}`}>
                      {s.key} {s.score.toFixed(1)}
                    </Chip>
                  ))}
                  {!dna?.aversions.length ? <span className="gl-small gl-faint">Nothing pushed away strongly yet.</span> : null}
                </div>
                <div className="gl-row gl-row--tight" style={{ flexWrap: 'wrap', marginTop: 'var(--glow-sp-3)' }}>
                  {(dna?.emerging ?? []).map((s) => (
                    <Chip key={s.key} tone="info" title="Two or more positives in the last 45 days, still under ±3">
                      {s.key} →
                    </Chip>
                  ))}
                  {!dna?.emerging.length ? <span className="gl-small gl-faint">No new interests forming yet.</span> : null}
                </div>
              </div>

              <div className="gl-card gl-card--plain">
                <h3 style={{ marginTop: 0 }}>Compare two signals</h3>
                <div className="gl-form-row">
                  <Field label="Signal A">
                    <Select
                      value={compare.a?.key ?? ''}
                      onChange={(v) => setCompare({ ...compare, a: allSignals.find((s) => s.key === v) ?? null })}
                      placeholder="Choose"
                      options={allSignals.slice(0, 60).map((s) => ({ value: s.key, label: `${s.key} (${s.score.toFixed(1)})` }))}
                    />
                  </Field>
                  <Field label="Signal B">
                    <Select
                      value={compare.b?.key ?? ''}
                      onChange={(v) => setCompare({ ...compare, b: allSignals.find((s) => s.key === v) ?? null })}
                      placeholder="Choose"
                      options={allSignals.slice(0, 60).map((s) => ({ value: s.key, label: `${s.key} (${s.score.toFixed(1)})` }))}
                    />
                  </Field>
                </div>
                {compare.a && compare.b ? (
                  <div className="gl-compare--grid" style={{ marginTop: 'var(--glow-sp-3)' }}>
                    {[compare.a, compare.b].map((s) => (
                      <div key={s.key} className="gl-inset">
                        <div className="gl-serif" style={{ fontSize: '1.1rem' }}>
                          {s.key}
                        </div>
                        <div className="gl-tech">{s.kind}</div>
                        <Meter value={Math.min(100, Math.abs(s.score) * 10)} label={s.score >= 0 ? 'Pulling you in' : 'Pushing you away'} />
                        <div className="gl-small gl-muted" style={{ marginTop: 8 }}>
                          {s.positives} positive · {s.negatives} negative · {s.sampleIds.length} source reference(s)
                        </div>
                        <div className="gl-row gl-row--tight" style={{ flexWrap: 'wrap', marginTop: 8 }}>
                          {s.sampleIds.map((id) => {
                            const it = itemById.get(id);
                            return it ? <Pin key={id} item={it} title={String(it.title)} style={{ width: 76 }} /> : null;
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="gl-small gl-faint">Pick two signals to see which one actually has more evidence behind it.</p>
                )}
              </div>

              <div className="gl-card gl-card--plain">
                <h3 style={{ marginTop: 0 }}>Per-identity breakdown</h3>
                <p className="gl-small gl-muted">Same arithmetic, different identity filter. A board tagged “going out” only moves that identity.</p>
                <IndexList>
                  {identityScan.map((r) => (
                    <IndexRow
                      key={r.identity}
                      no={r.identity}
                      title={r.identity}
                      sub={`${r.count} weighted action(s) contribute`}
                      right={<span className="gl-tech">{r.top.toFixed(1)}</span>}
                      onClick={() => setDnaIdentity(r.identity.toLowerCase())}
                    />
                  ))}
                </IndexList>
              </div>

              <PullQuote cite="engine/taste.ts — deliberate, inspectable counters">
                A taste profile you cannot argue with is a rumour. Every line below has buttons that change it.
              </PullQuote>

              <div className="gl-card gl-card--plain">
                <h3 style={{ marginTop: 0 }}>Your corrections ({corrections.length})</h3>
                {corrections.length ? (
                  <div className="gl-list">
                    {[...corrections]
                      .sort((a, b) => Number(b.createdAt) - Number(a.createdAt))
                      .slice(0, 12)
                      .map((c) => (
                        <div key={String(c.id)} className="gl-list__row">
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div className="gl-serif">{String(c.title)}</div>
                            <div className="gl-tech">
                              {String(((c.data ?? {}) as Record<string, unknown>).mode ?? '')} · recorded {String(((c.data ?? {}) as Record<string, unknown>).before ?? '—')} →{' '}
                              {new Date(Number(c.createdAt)).toLocaleDateString()}
                            </div>
                          </div>
                          <IconButton
                            label={`Delete correction ${String(c.title)}`}
                            onClick={() => {
                              void softDelete(TABLES.knowledge, String(c.id));
                              toast('Correction record deleted. The interaction rows it wrote stay — they are your history.', 'info');
                            }}
                          >
                            <Trash2 size={14} />
                          </IconButton>
                        </div>
                      ))}
                  </div>
                ) : (
                  <p className="gl-small gl-faint">No corrections yet.</p>
                )}
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {view === 'collections' ? (
        <section className="gl-section">
          <div className="gl-note">
            These six views read the same interaction rows as Glow Discover. Nothing here is a separate list you have to maintain — it is the
            same ledger, grouped.
          </div>
          <div className="gl-states" style={{ marginTop: 'var(--glow-sp-4)' }}>
            {collections.map((block) => (
              <div key={block.title} className="gl-states__block">
                <div className="gl-states__head">
                  <h3 style={{ margin: 0 }}>{block.title}</h3>
                  <span className="gl-tech">{block.list.length}</span>
                </div>
                {block.list.length ? (
                  <div className="gl-masonry">
                    {block.list.slice(0, 9).map((it) => (
                      <Pin key={String(it.id)} item={it} title={String(it.title ?? '')} sub={String(it.aesthetic ?? it.providerId ?? '')} actions={pinActions(it)} />
                    ))}
                  </div>
                ) : (
                  <p className="gl-small gl-faint">Nothing recorded in this state yet.</p>
                )}
              </div>
            ))}
          </div>
          {interactions.length > 3 ? (
            <div className="gl-inset" style={{ marginTop: 'var(--glow-sp-5)' }}>
              <div className="gl-label" style={{ marginBottom: 8 }}>Where these would rank your library right now</div>
              <div className="gl-row gl-row--tight" style={{ flexWrap: 'wrap' }}>
                {items
                  .map((i) => ({ id: String(i.id), title: String(i.title), s: scoreAgainstDna(dnaShape(i), dna ?? EMPTY_DNA) }))
                  .sort((a, b) => b.s - a.s)
                  .slice(0, 8)
                  .map((r) => (
                    <Chip key={r.id} tone={r.s > 0.15 ? 'gold' : 'info'} title={`${(r.s * 100).toFixed(0)} against your DNA`}>
                      {r.title.slice(0, 26)} · {r.s.toFixed(2)}
                    </Chip>
                  ))}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}

      {/* ------------------------------------------------------------ modals */}
      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="New board"
        footer={
          <>
            <span className="gl-small gl-faint">Saved to <code>boards</code> immediately; add references next.</span>
            <Button variant="primary" onClick={() => void createBoard()}>
              Create board
            </Button>
          </>
        }
      >
        <Field label="Name">
          <TextInput value={draft.name} onChange={(v) => setDraft({ ...draft, name: v })} placeholder="Vamp winter, loc archive, interview armour…" />
        </Field>
        <Field label="Kind">
          <SegmentedControl
            value={draft.kind}
            onChange={(v) => setDraft({ ...draft, kind: v as BoardKind })}
            options={KINDS.map((k) => ({ value: k.value, label: k.label }))}
          />
        </Field>
        <p className="gl-small gl-faint">{KINDS.find((k) => k.value === draft.kind)?.note}</p>
        <Field label="Purpose">
          <TextArea value={draft.purpose} onChange={(v) => setDraft({ ...draft, purpose: v })} rows={3} />
        </Field>
        <Field label="Identity">
          <Select value={draft.identity} onChange={(v) => setDraft({ ...draft, identity: v })} options={IDENTITIES} />
        </Field>
      </Modal>

      <Modal
        open={Boolean(renaming)}
        onClose={() => setRenaming(null)}
        title="Rename board"
        footer={
          <>
            <span className="gl-small gl-faint">The kind, purpose and arrangement are untouched.</span>
            <Button
              variant="primary"
              onClick={async () => {
                if (!renaming || !rename.trim()) {
                  toast('A board needs a name.', 'bad');
                  return;
                }
                await saveRow(TABLES.boards, { id: String(renaming.id), name: rename.trim() });
                setRenaming(null);
                toast('Renamed.');
              }}
            >
              Save name
            </Button>
          </>
        }
      >
        <Field label="Name">
          <TextInput value={rename} onChange={setRename} />
        </Field>
      </Modal>

      <Modal
        open={adding}
        onClose={() => setAdding(false)}
        title={`Add references to “${board ? String(board.name) : ''}”`}
        wide
        footer={
          <>
            <span className="gl-small gl-faint">{addPick.length} selected — writes membership plus a weighted interaction each.</span>
            <Button variant="primary" onClick={() => void addToBoard(addPick)} disabled={!addPick.length}>
              Add {addPick.length || ''}
            </Button>
          </>
        }
      >
        <Field label="Search your library">
          <TextInput value={addQuery} onChange={setAddQuery} placeholder="oxblood, locs, vanity, chrome…" />
        </Field>
        <div className="gl-assetgrid" style={{ maxHeight: '46vh', overflow: 'auto' }}>
          {addPool.slice(0, 60).map((it) => {
            const on = addPick.includes(String(it.id));
            return (
              <button
                key={String(it.id)}
                type="button"
                className="gl-asset"
                data-pick={on}
                onClick={() => setAddPick((prev) => (on ? prev.filter((x) => x !== String(it.id)) : [...prev, String(it.id)]))}
              >
                <TileImg item={it} />
                <div className="gl-asset__body">
                  <div className="gl-serif" style={{ fontSize: '0.95rem' }}>
                    {String(it.title)}
                  </div>
                  <div className="gl-tech">{String(it.providerId)}</div>
                </div>
              </button>
            );
          })}
          {!addPool.length ? <p className="gl-small gl-faint">Everything in your library is already on this board.</p> : null}
        </div>
      </Modal>

      <Modal
        open={Boolean(correctionFor)}
        onClose={() => setCorrectionFor(null)}
        title={`“${correctionFor?.key ?? ''}” is not me`}
        footer={
          <>
            <span className="gl-small gl-faint">Writes −3 on up to six source references and one knowledge record.</span>
            <Button
              variant="danger"
              onClick={() => correctionFor && void applyCorrection(correctionFor, 'reject', correctionNote.trim())}
            >
              Record the rejection
            </Button>
          </>
        }
      >
        <p className="gl-small gl-muted">
          Score {correctionFor?.score.toFixed(1)} from {correctionFor?.positives} positive and {correctionFor?.negatives} negative actions.
          Saying why turns a number into a note you can read back later.
        </p>
        <Field label="Why (optional)">
          <TextArea value={correctionNote} onChange={setCorrectionNote} rows={3} placeholder="It reads as costume, not as me." />
        </Field>
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

/* ------------------------------------------------------------------ pieces */

function BoardCard({
  board,
  count,
  archived,
  onOpen,
  onRename,
  onDuplicate,
  onArchive,
  onDelete
}: {
  board: AnyRow;
  count: number;
  archived: boolean;
  onOpen: () => void;
  onRename: () => void;
  onDuplicate: () => void;
  onArchive: () => void;
  onDelete: () => void;
}) {
  const cover = useBoardCover(board);
  const palette = ((board.palette as string[]) ?? []).slice(0, 8);
  return (
    <article className="gl-boardcard" data-open="false">
      <button type="button" className="gl-boardcard__cover" onClick={onOpen} aria-label={`Open board ${String(board.name)}`} style={{ border: 0, cursor: 'pointer', padding: 0 }}>
        {cover ? (
          <img src={cover} alt="" loading="lazy" className="gl-img-treated" />
        ) : (
          <div className="gl-missing-img" style={{ position: 'absolute', inset: 0 }}>
            No cover set
          </div>
        )}
      </button>
      <div className="gl-boardcard__body">
        <div className="gl-row gl-row--between" style={{ alignItems: 'baseline' }}>
          <div className="gl-serif" style={{ fontSize: '1.1rem', color: 'var(--glow-text-strong)' }}>
            {String(board.name)}
          </div>
          <span className="gl-tech">{String(board.kind)}</span>
        </div>
        {board.purpose ? <p className="gl-small gl-muted" style={{ margin: 0 }}>{String(board.purpose)}</p> : null}
        <div className="gl-row gl-row--tight" style={{ flexWrap: 'wrap' }}>
          <Chip>{count} items</Chip>
          <Chip tone="info">{String(board.identity || 'shared')}</Chip>
          {board.exported ? <Chip tone="gold">exported</Chip> : null}
          {archived ? <Chip tone="danger">archived</Chip> : null}
        </div>
        {palette.length ? (
          <div className="gl-swatch-set">
            {palette.map((c) => (
              <i key={c} style={{ background: c }} />
            ))}
          </div>
        ) : (
          <div className="gl-tech">No palette yet</div>
        )}
        <div className="gl-boardcard__acts">
          <Button size="sm" variant="primary" onClick={onOpen}>
            <Images size={13} /> Open
          </Button>
          <Button size="sm" variant="ghost" onClick={onRename} title="Rename">
            <Pencil size={13} />
          </Button>
          <Button size="sm" variant="ghost" onClick={onDuplicate} title="Duplicate with its arrangement">
            <Copy size={13} />
          </Button>
          <Button size="sm" variant="ghost" onClick={onArchive} title={archived ? 'Unarchive' : 'Archive'}>
            <Archive size={13} />
          </Button>
          <Button size="sm" variant="ghost" onClick={onDelete} title="Delete (soft)">
            <Trash2 size={13} />
          </Button>
        </div>
      </div>
    </article>
  );
}

function useBoardCover(board: AnyRow) {
  const media = useRows(TABLES.mediaItems);
  const boardsItems = useRows(TABLES.discoveryItems);
  const coverId = (board.coverMediaId as string) ?? '';
  const firstMedia = useMemo(() => {
    if (coverId) return media.find((m) => String(m.id) === coverId);
    for (const id of (board.itemIds as string[]) ?? []) {
      const it = boardsItems.find((i) => String(i.id) === id);
      if (it?.mediaId) {
        const m = media.find((x) => String(x.id) === String(it.mediaId));
        if (m) return m;
      }
    }
    return undefined;
  }, [coverId, media, boardsItems, board]);
  return useImageSrc(firstMedia, 'thumb');
}

function TileImg({ item }: { item: AnyRow }) {
  const src = useImageSrc(item, 'thumb');
  return (
    <div className="gl-asset__img">
      {src ? <img src={src} alt="" loading="lazy" /> : <div className="gl-missing-img" style={{ height: '100%' }}>Unavailable</div>}
    </div>
  );
}

function BoardItem({
  item,
  style,
  selected,
  note,
  onSelect,
  onPointerDown,
  buttons
}: {
  item: AnyRow;
  style: React.CSSProperties;
  selected: boolean;
  note: string;
  onSelect: () => void;
  onPointerDown: (e: React.PointerEvent) => void;
  buttons: ReactNode;
}) {
  const src = usePos(item);
  return (
    <div className="gl-board__item" data-selected={selected} style={style} onClick={onSelect} onPointerDown={onPointerDown}>
      {src ? <img src={src} alt={String(item.title)} loading="lazy" /> : <div className="gl-missing-img" style={{ aspectRatio: '3 / 4' }}>Unavailable</div>}
      <div className="gl-board__cap">{String(item.title)}</div>
      {note ? <div className="gl-tech" style={{ marginTop: 4 }}>{note.slice(0, 60)}</div> : null}
      <div className="gl-board__tools">{buttons}</div>
    </div>
  );
}
