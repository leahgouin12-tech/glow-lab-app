import { TABLES, type AnyRow } from '../db/schema';
import { findAll, put } from '../db/repo';

/**
 * Pinterest integration (spec Part 9) — official API + OAuth only.
 *
 * Hard rules enforced by this module:
 *  - never asks for a Pinterest password (there is no code path for one);
 *  - never scrapes, never bypasses access restrictions, no unofficial endpoints;
 *  - stores the token in the integration row and warns that browser storage is
 *    not a secure enclave — for real credential isolation a server swap is
 *    required, which is documented rather than pretended about;
 *  - Pinterest content is flagged providerId 'pinterest' and is excluded from
 *    the taste-learning dataset by engine/taste.ts;
 *  - when access is unavailable the app degrades to manual reference links and
 *    reports the status honestly instead of showing a fake connected state.
 */

const AUTH_BASE = 'https://www.pinterest.com';
const API_BASE = 'https://api.pinterest.com/v5';
export const REQUIRED_SCOPE = 'boards:read';
export const OPTIONAL_SCOPES = ['pins:read'];

function b64url(buf: ArrayBuffer) {
  let bin = '';
  for (const b of new Uint8Array(buf)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function randomVerifier() {
  const bytes = new Uint8Array(48);
  crypto.getRandomValues(bytes);
  return btoa(Array.from(bytes, (b) => String.fromCharCode(b)).join('')).replace(/[^a-zA-Z0-9]/g, '').slice(0, 64);
}

export interface PinterestFlow {
  authorizeUrl: string;
  state: string;
  pkceRequired: boolean;
  redirectUri: string;
}

export async function startAuth(opts: { clientId: string; redirectUri: string; includeWrite?: boolean }): Promise<PinterestFlow> {
  if (!opts.clientId.trim()) throw new Error('A Pinterest app client ID is required before connecting.');
  const state = randomVerifier().slice(0, 24);
  sessionStorage.setItem('glow-pinterest-state', state);
  const scopes = [REQUIRED_SCOPE, ...(opts.includeWrite ? OPTIONAL_SCOPES : [])].join(' ');
  let url = `${AUTH_BASE}/oauth/authorize?client_id=${encodeURIComponent(opts.clientId)}&response_type=code&redirect_uri=${encodeURIComponent(
    opts.redirectUri
  )}&scope=${encodeURIComponent(scopes)}&state=${encodeURIComponent(state)}`;

  if (crypto.subtle) {
    const verifier = randomVerifier();
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    sessionStorage.setItem('glow-pinterest-verifier', verifier);
    url += `&code_challenge=${encodeURIComponent(b64url(digest))}&code_challenge_method=S256`;
  }
  return { authorizeUrl: url, state, pkceRequired: Boolean(crypto.subtle), redirectUri: opts.redirectUri };
}

export async function exchangeCode(opts: { clientId: string; redirectUri: string; code: string }): Promise<{ ok: boolean; detail: string; token?: string; expiresAt?: number }> {
  const state = new URLSearchParams(location.search).get('state');
  const saved = sessionStorage.getItem('glow-pinterest-state');
  if (saved && state && state !== saved) return { ok: false, detail: 'State mismatch — the callback was rejected. Nothing was stored.' };

  const body: Record<string, string> = {
    code: opts.code,
    grant_type: 'authorization_code',
    redirect_uri: opts.redirectUri
  };
  const verifier = sessionStorage.getItem('glow-pinterest-verifier');
  if (verifier) body.code_verifier = verifier;

  try {
    const r = await fetch(`${API_BASE}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout ? AbortSignal.timeout(12000) : undefined
    });
    const j = (await r.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; message?: string };
    if (!r.ok || !j.access_token) {
      return {
        ok: false,
        detail:
          j.message ||
          `Pinterest returned ${r.status}. A browser-side token exchange usually needs a server proxy or the code must be redeemed from the registered app origin — see INTEGRATIONS.md.`
      };
    }
    sessionStorage.removeItem('glow-pinterest-verifier');
    sessionStorage.removeItem('glow-pinterest-state');
    return { ok: true, detail: 'Token received.', token: j.access_token, expiresAt: j.expires_in ? Date.now() + j.expires_in * 1000 : undefined };
  } catch (e) {
    return { ok: false, detail: `Could not reach Pinterest: ${(e as Error).message}. Connection remains disconnected.` };
  }
}

export async function apiGet<T>(token: string, path: string): Promise<{ ok: true; data: T } | { ok: false; detail: string }> {
  try {
    const r = await fetch(`${API_BASE}${path}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout ? AbortSignal.timeout(12000) : undefined });
    if (r.status === 401) return { ok: false, detail: 'Token rejected (401). Reconnect, or fall back to manual reference links.' };
    if (r.status === 403) return { ok: false, detail: 'Access forbidden (403). Your app may still be in development mode or lacks the approved scope.' };
    if (r.status === 429) return { ok: false, detail: 'Rate limited (429). Try again later — the app does not retry aggressively.' };
    if (!r.ok) return { ok: false, detail: `Pinterest returned ${r.status}.` };
    return { ok: true, data: (await r.json()) as T };
  } catch (e) {
    return { ok: false, detail: `Network error: ${(e as Error).message}` };
  }
}

export interface PBoard {
  id: string;
  name: string;
  description?: string;
  pin_count?: number;
  url?: string;
}
export interface PPin {
  id: string;
  title?: string;
  description?: string;
  link?: string;
  url?: string;
  media?: { url?: string };
  created_at?: string;
}

export async function listBoards(token: string) {
  const r = await apiGet<{ items?: PBoard[] }>(token, '/me/boards?page_size=50');
  return r.ok ? { ok: true as const, boards: r.data.items ?? [] } : { ok: false as const, detail: r.detail, boards: [] };
}

export async function listPins(token: string, boardId: string, cursor?: string) {
  const q = `?page_size=30${cursor ? `&bookmark=${encodeURIComponent(cursor)}` : ''}`;
  const r = await apiGet<{ items?: PPin[]; bookmark?: string }>(token, `/boards/${encodeURIComponent(boardId)}/pins${q}`);
  return r.ok ? { ok: true as const, pins: r.data.items ?? [], cursor: r.data.bookmark } : { ok: false as const, detail: r.detail, pins: [] as PPin[], cursor: undefined };
}

/** Turns authorised pins into local discovery rows, keeping the provider tag. */
export async function importPins(pins: PPin[]) {
  let imported = 0;
  for (const p of pins) {
    if (!p.media?.url) continue;
    const existing = await findAll(TABLES.discoveryItems, { where: { slug: `pinterest-${p.id}` }, includeDeleted: true });
    if (existing.length) continue;
    await put(TABLES.discoveryItems, {
      slug: `pinterest-${p.id}`,
      providerId: 'pinterest',
      title: p.title || p.description || 'Pinterest pin',
      description: p.description || '',
      categories: ['Pinterest'],
      aesthetic: '',
      palette: [],
      elements: [],
      sourceUrl: p.link || p.url || '',
      attribution: 'Pin accessed through your own authorised Pinterest connection',
      license: 'Pinterest data — retention and display per Pinterest terms',
      recreatable: false,
      data: { remoteUrl: p.media.url, width: 736, height: 1104, pinId: p.id, importedAt: Date.now() }
    });
    imported += 1;
  }
  return imported;
}

export async function disconnect() {
  const rows = await findAll(TABLES.integrations, { where: { service: 'pinterest' } });
  for (const r of rows) await put(TABLES.integrations, { ...r, status: 'disconnected', token: '', tokenExpiresAt: null, accountLabel: '', capabilities: [], lastSyncAt: null });
  sessionStorage.removeItem('glow-pinterest-verifier');
  sessionStorage.removeItem('glow-pinterest-state');
  return rows.length;
}

export const PINTEREST_FALLBACK_NOTE =
  'No authorised connection? Manual reference links still work: paste a pin URL, keep your own note, and open the original on Pinterest. The app never fetches pins without authorisation and never scrapes.';
