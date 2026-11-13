import { TABLES, type AnyRow, type DiscoveryInteractionRow, type EvidenceGrade } from '../db/schema';
import { findAll } from '../db/repo';
import { loadSettings } from '../state/settings';

/**
 * Taste-learning engine (spec Part 8.4).
 *
 * Deliberately NOT a model: explicit, inspectable counters over the user's own
 * interactions. Every number below can be traced back to the interactions that
 * produced it, which is why the UI is allowed to show it as "your data says"
 * rather than "AI thinks".
 *
 * Pinterest data is excluded on purpose (Part 9): providerId 'pinterest' rows
 * never contribute to Aesthetic DNA.
 */

/** Positive/negative weight per action, matching the DiscoveryInteractionRow weights. */
export const ACTION_WEIGHT: Record<DiscoveryInteractionRow['action'], number> = {
  like: 2,
  save: 3,
  board: 3,
  mood: 2,
  goal: 4,
  try: 3,
  buy: 4,
  own: 1,
  more: 2,
  view: 0.25,
  unlike: -1,
  unsave: -2,
  dislike: -3,
  less: -2,
  hide: -2,
  report: -4,
  'open-source': 0.5,
  share: 1
};

export interface TasteSignal {
  key: string;
  kind: 'category' | 'aesthetic' | 'palette' | 'element';
  score: number;
  positives: number;
  negatives: number;
  lastOn: string;
  sampleIds: string[];
}

export interface AestheticDna {
  identity: string;
  signals: TasteSignal[];
  top: TasteSignal[];
  aversions: TasteSignal[];
  emerging: TasteSignal[];
  confidence: number;
  interactions: number;
  updatedAt: number;
}

export const AVERAGE_IDENTITY = 'everyday';

function bump(map: Map<string, TasteSignal>, key: string, kind: TasteSignal['kind'], weight: number, on: string, id: string) {
  const cur = map.get(key) ?? { key, kind, score: 0, positives: 0, negatives: 0, lastOn: '', sampleIds: [] };
  cur.score += weight;
  if (weight > 0) cur.positives += 1;
  if (weight < 0) cur.negatives += 1;
  if (on > cur.lastOn) cur.lastOn = on;
  if (cur.sampleIds.length < 6 && !cur.sampleIds.includes(id)) cur.sampleIds.push(id);
  map.set(key, cur);
}

/** Aggregates every interaction into weighted, per-identity taste signals. */
export async function computeDna(
  identity: string = AVERAGE_IDENTITY,
  opts: { pinterestCounts?: boolean } = {}
): Promise<AestheticDna> {
  const [interactions, items] = await Promise.all([
    findAll(TABLES.discoveryInteractions, { includeDeleted: false }),
    findAll(TABLES.discoveryItems, { includeDeleted: true })
  ]);
  const byItem = new Map(items.map((i) => [i.id, i]));
  const pinterestCounts = opts.pinterestCounts ?? (await loadSettings()).pinterestTeachesTaste;
  const map = new Map<string, TasteSignal>();
  let used = 0;

  for (const x of interactions as DiscoveryInteractionRow[]) {
    const item = byItem.get(x.itemId);
    if (!item) continue;
    // Part 9: provider-sourced data is kept separate from the preference-learning
    // set until the user expressly allows their Pinterest saves to count.
    if (item.providerId === 'pinterest' && !pinterestCounts) continue;
    const itemIdentity = (item.data?.identity as string) ?? 'shared';
    if (identity !== AVERAGE_IDENTITY && itemIdentity !== identity && itemIdentity !== 'shared') continue;
    const weight = typeof x.weight === 'number' ? x.weight : ACTION_WEIGHT[x.action] ?? 0;
    if (weight === 0) continue;
    used += 1;
    const on = (x.createdAt ? new Date(x.createdAt).toISOString().slice(0, 10) : '') as string;
    for (const c of item.categories ?? []) bump(map, c.toLowerCase(), 'category', weight, on, item.id);
    if (item.aesthetic) bump(map, String(item.aesthetic).toLowerCase(), 'aesthetic', weight * 1.4, on, item.id);
    for (const p of item.palette ?? []) bump(map, p, 'palette', weight * 0.6, on, item.id);
    for (const e of item.elements ?? []) bump(map, String(e).toLowerCase(), 'element', weight, on, item.id);
  }

  const signals = [...map.values()].sort((a, b) => b.score - a.score);
  const strong = signals.filter((s) => Math.abs(s.score) >= 3);
  const confidence = Math.max(0, Math.min(1, used / 40)) * (strong.length ? 1 : 0.5);
  const recentCutoff = new Date(Date.now() - 1000 * 60 * 60 * 24 * 45).toISOString().slice(0, 10);

  return {
    identity,
    signals,
    top: strong.filter((s) => s.score > 0).slice(0, 14),
    aversions: strong.filter((s) => s.score < 0).slice(0, 10),
    emerging: signals
      .filter((s) => s.score > 0 && s.positives >= 2 && s.lastOn >= recentCutoff && s.score < 3)
      .slice(0, 8),
    confidence,
    interactions: used,
    updatedAt: Date.now()
  };
}

/**
 * Ranks discovery candidates against the DNA. Returns a score in -1..1.
 * Deterministic: same data in, same order out, no randomness, no fake "for you".
 */
export function scoreAgainstDna(
  item: { categories?: string[]; aesthetic?: string; elements?: string[]; palette?: string[] } | AnyRow,
  dna: AestheticDna
): number {
  if (!dna.interactions) return 0;
  const index = new Map(dna.signals.map((s) => [s.key, s]));
  let raw = 0;
  let hits = 0;
  const consider = (key: string, mult: number) => {
    const s = index.get(key);
    if (!s) return;
    raw += Math.sign(s.score) * Math.min(1, Math.abs(s.score) / 8) * mult;
    hits += 1;
  };
  for (const c of item.categories ?? []) consider(String(c).toLowerCase(), 1);
  if (item.aesthetic) consider(String(item.aesthetic).toLowerCase(), 1.6);
  for (const e of item.elements ?? []) consider(String(e).toLowerCase(), 0.8);
  for (const p of item.palette ?? []) consider(p, 0.4);
  const denom = Math.max(4, (item.categories?.length ?? 0) + (item.elements?.length ?? 0) * 0.8 + 2.6);
  return hits ? Math.max(-1, Math.min(1, raw / denom)) : 0;
}

/** Aversions and hidden items are removed from the feed, not merely down-ranked. */
export function excludedItemIds(interactions: { itemId: string; action: string }[]): Set<string> {
  const last = new Map<string, { action: string; at: number }>();
  for (const x of interactions) {
    const at = (x as unknown as { createdAt: number }).createdAt ?? 0;
    const prev = last.get(x.itemId);
    if (!prev || at >= prev.at) last.set(x.itemId, { action: x.action, at });
  }
  const out = new Set<string>();
  for (const [id, v] of last) if (v.action === 'hide' || v.action === 'report') out.add(id);
  return out;
}

export function dnaToProfileRow(dna: AestheticDna) {
  return {
    kind: 'aesthetic-dna' as const,
    singleton: 0 as const,
    identity: dna.identity,
    signals: dna.top.map((t) => ({ key: t.key, kind: t.kind, score: Math.round(t.score * 10) / 10 })),
    aversions: dna.aversions.map((t) => t.key),
    confidence: Math.round(dna.confidence * 100),
    computedAt: Date.now()
  };
}

export type { EvidenceGrade };
