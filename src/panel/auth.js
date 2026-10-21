/**
 * Panel authentication.
 *
 *  - Passwords are never stored; only SHA-256 hex, compared in constant time.
 *  - Failed logins are counted per IP in isolate memory and lock the source out
 *    for a growing window. Isolate memory is the right place for this: it is
 *    fast, costs no storage quota, and a lockout that evaporates after a few
 *    minutes is an acceptable trade for zero extra D1 writes.
 *  - Sessions are opaque 256-bit random tokens stored server side, delivered in
 *    an HttpOnly Secure cookie so panel JS can never read them.
 */

import { safeEqual } from '../lib/sha224.js';

const MAX_ATTEMPTS = 5;
const BASE_LOCKOUT_MS = 60_000;          // doubles per further failure, capped
const MAX_LOCKOUT_MS = 30 * 60_000;
const SESSION_TTL_S = 12 * 3600;

const attempts = new Map(); // ip -> { n, until }

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomToken(bytes = 32) {
  const a = new Uint8Array(bytes);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function clientIp(request) {
  return request.headers.get('cf-connecting-ip')
    || request.headers.get('x-real-ip')
    || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || '0.0.0.0';
}

export function lockoutState(ip) {
  const a = attempts.get(ip);
  if (!a) return { locked: false, remaining: MAX_ATTEMPTS, retryAfter: 0 };
  if (a.until > Date.now()) return { locked: true, remaining: 0, retryAfter: Math.ceil((a.until - Date.now()) / 1000) };
  return { locked: false, remaining: Math.max(0, MAX_ATTEMPTS - a.n), retryAfter: 0 };
}

export function noteFailure(ip) {
  const a = attempts.get(ip) || { n: 0, until: 0 };
  a.n += 1;
  if (a.n >= MAX_ATTEMPTS) {
    const over = a.n - MAX_ATTEMPTS;
    a.until = Date.now() + Math.min(MAX_LOCKOUT_MS, BASE_LOCKOUT_MS * 2 ** over);
  }
  attempts.set(ip, a);
  return lockoutState(ip);
}

export function noteSuccess(ip) { attempts.delete(ip); }

export function readToken(request) {
  const cookie = request.headers.get('cookie') || '';
  const m = cookie.match(/(?:^|;\s*)luncher_session=([a-f0-9]{16,128})/);
  if (m) return m[1];
  const h = request.headers.get('authorization') || '';
  if (h.startsWith('Bearer ')) return h.slice(7).trim();
  return null;
}

export function sessionCookie(token, maxAge = SESSION_TTL_S) {
  return `luncher_session=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=Lax`;
}

export async function currentSession(request, store) {
  const token = readToken(request);
  if (!token) return null;
  try { return await store.getSession(token); } catch { return null; }
}

/**
 * Resolve the admin credential. Three cases:
 *   - env.ADMIN_PASS_HASH set  -> that hash wins (good for scripted deploys)
 *   - store has 'admin_hash'   -> use it
 *   - neither                  -> unconfigured; the setup wizard must run
 */
export async function adminCredential(env, store) {
  const fromEnv = env && env.ADMIN_PASS_HASH;
  if (fromEnv) return { hash: fromEnv, source: 'env', configured: true };
  let fromStore = null;
  try { fromStore = await store.getSetting('admin_hash'); } catch { fromStore = null; }
  if (fromStore) return { hash: fromStore, source: 'store', configured: true };
  return { hash: null, source: null, configured: false };
}

export async function verifyPassword(password, env, store) {
  const cred = await adminCredential(env, store);
  if (!cred.configured) return { ok: false, reason: 'not-configured' };
  const h = await sha256Hex(password);
  return { ok: safeEqual(h, cred.hash), reason: safeEqual(h, cred.hash) ? null : 'bad-password' };
}

export async function login(request, env, store, password) {
  const ip = clientIp(request);
  const lock = lockoutState(ip);
  if (lock.locked) return { ok: false, reason: 'locked', retryAfter: lock.retryAfter };

  const v = await verifyPassword(password, env, store);
  if (!v.ok) {
    if (v.reason === 'not-configured') return { ok: false, reason: 'not-configured' };
    const next = noteFailure(ip);
    return { ok: false, reason: 'bad-password', remaining: next.remaining, retryAfter: next.retryAfter };
  }
  noteSuccess(ip);
  const token = randomToken(32);
  try { await store.createSession(token, SESSION_TTL_S, ip); } catch { /* session store down */ }
  return { ok: true, token, ttl: SESSION_TTL_S };
}

export async function logout(request, store) {
  const token = readToken(request);
  if (token) { try { await store.deleteSession(token); } catch { /* best effort */ } }
  return sessionCookie('', 0);
}

export { MAX_ATTEMPTS, SESSION_TTL_S };
