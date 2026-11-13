/**
 * Local app lock. The hash lives in localStorage only — never in IndexedDB, so
 * it is absent from every backup archive and from the sync queue. A web app
 * cannot verify your device PIN; this stops a shoulder, not a determined
 * attacker who already owns the machine.
 */

const KEY = 'glow-lab:lock-hash';
const SESSION = 'glow-lab:lock-unlocked';
const IDLE = 'glow-lab:lock-hidden-at';

import { isLegacyFnvHash, legacyFnv1aHex, sha256Hex } from '../engine/sha256';

/**
 * The digest chain. SHA-256 whether or not the context has SubtleCrypto, so a
 * passcode armed in Safari still opens inside an iOS wrapper and a hash made in
 * one old browser is not a different value in a new one.
 */
async function digest(text: string): Promise<string> {
  return sha256Hex(text);
}

/** The 32-bit FNV chain some records were written with before the above existed. */
async function legacyDigest(text: string): Promise<string> {
  return legacyFnv1aHex(text);
}

function newSalt(): string {
  const bytes = new Uint8Array(16);
  if ((crypto as any).getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

interface LockRecord {
  salt: string;
  hash: string;
  setAt: number;
}

function read(): LockRecord | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as LockRecord) : null;
  } catch {
    return null;
  }
}

async function hashFor(code: string, saltValue: string): Promise<string> {
  let h = await digest(`${saltValue}:${code}`);
  for (let i = 0; i < 600; i += 1) h = await digest(`${h}:${saltValue}:${i}`);
  return h;
}

/** The FNV chain, replayed only to recognise a record written by it. */
async function legacyHashFor(code: string, saltValue: string): Promise<string> {
  let h = await legacyDigest(`${saltValue}:${code}`);
  for (let i = 0; i < 600; i += 1) h = await legacyDigest(`${h}:${saltValue}:${i}`);
  return h;
}

/**
 * A record armed before SHA-256 was the only path is matched with the chain
 * that actually made it, then rewritten with this one. Same passcode, same
 * salt — she is never told a code she set is wrong because of where she set it.
 */
async function matchesLegacy(rec: LockRecord, code: string): Promise<boolean> {
  return isLegacyFnvHash(rec.hash) && (await legacyHashFor(code, rec.salt)) === rec.hash;
}

export function lockIsSet(): boolean {
  return Boolean(read());
}

export async function armLock(code: string): Promise<{ ok: boolean; detail: string }> {
  if (code.length < 4) return { ok: false, detail: 'Use at least four characters.' };
  const saltValue = newSalt();
  localStorage.setItem(KEY, JSON.stringify({ salt: saltValue, hash: await hashFor(code, saltValue), setAt: Date.now() }));
  markUnlocked();
  return { ok: true, detail: 'App lock armed. It is not included in backups or sync.' };
}

export async function disarmLock(code: string): Promise<{ ok: boolean; detail: string }> {
  const rec = read();
  if (!rec) return { ok: false, detail: 'No lock is set on this device.' };
  if ((await hashFor(code, rec.salt)) !== rec.hash && !(await matchesLegacy(rec, code))) {
    return { ok: false, detail: 'That passcode does not match.' };
  }
  localStorage.removeItem(KEY);
  localStorage.removeItem(SESSION);
  return { ok: true, detail: 'App lock removed from this device.' };
}

export async function verifyLock(code: string): Promise<boolean> {
  const rec = read();
  if (!rec) return true;
  if ((await hashFor(code, rec.salt)) !== rec.hash) {
    if (!(await matchesLegacy(rec, code))) return false;
    /* unlocking with an old record is the moment to replace it, so the next
       boot checks the same way whether or not this one can */
    await armRewrite(rec, code);
  }
  markUnlocked();
  return true;
}

async function armRewrite(rec: LockRecord, code: string): Promise<void> {
  localStorage.setItem(KEY, JSON.stringify({ salt: rec.salt, hash: await hashFor(code, rec.salt), setAt: rec.setAt }));
}

export function sessionUnlocked(): boolean {
  if (!lockIsSet()) return true;
  return sessionStorage.getItem(SESSION) === 'open';
}

export function markUnlocked() {
  try {
    sessionStorage.setItem(SESSION, 'open');
  } catch {
    /* private-mode storage failures simply leave the lock screen up */
  }
}

export function lockNow() {
  try {
    sessionStorage.removeItem(SESSION);
  } catch {
    /* ignore */
  }
}

/**
 * Re-lock after the tab has been hidden this long. Returning to a tab you left
 * minutes ago is the case a shoulder actually exploits.
 */
export function noteVisibility(hidden: boolean, idleMinutes: number): boolean {
  if (!lockIsSet()) return false;
  if (hidden) {
    localStorage.setItem(IDLE, String(Date.now()));
    return false;
  }
  const started = Number(localStorage.getItem(IDLE) ?? 0);
  localStorage.removeItem(IDLE);
  if (!started) return false;
  const away = (Date.now() - started) / 60000;
  if (away >= Math.max(1, idleMinutes)) {
    lockNow();
    return true;
  }
  return false;
}
