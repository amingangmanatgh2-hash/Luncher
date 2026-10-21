/** User records, credentials and quota enforcement. */

import { randomToken } from './auth.js';
import { trojanKey } from '../lib/sha224.js';
import { uuidToBytes, bytesToUuid } from '../lib/bytes.js';

export function randomUuid() {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40; // version 4
  b[8] = (b[8] & 0x3f) | 0x80; // variant 10
  return bytesToUuid(b);
}

/** A Trojan password that is safe to put in a URI without escaping surprises. */
export function randomTrojanPassword(len = 16) {
  const alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const b = new Uint8Array(len);
  crypto.getRandomValues(b);
  return [...b].map((x) => alphabet[x % alphabet.length]).join('');
}

export function newUser({ name, uuid, trojanPass, quotaGb, expireDays, maxIps, preset, note }) {
  const id = randomToken(8);
  const u = uuid && uuidToBytes(uuid) ? uuid : randomUuid();
  const pass = trojanPass === null ? '' : (trojanPass || randomTrojanPassword());
  const now = Date.now();
  return {
    id,
    name: String(name || `user-${id.slice(0, 4)}`).slice(0, 48),
    uuid: u,
    trojan_pass: pass,
    trojan_key: pass ? trojanKey(pass) : '',
    enabled: 1,
    quota_gb: Math.max(0, Number(quotaGb) || 0),
    expire_days: Math.max(0, Number(expireDays) || 0),
    max_ips: Math.max(0, Number(maxIps) || 0),
    used_bytes: 0,
    request_count: 0,
    created_at: now,
    first_seen_at: 0,
    last_seen_at: 0,
    preset: preset || '',
    note: String(note || '').slice(0, 200),
  };
}

export function applyEdits(user, patch) {
  const out = { ...user };
  if (patch.name !== undefined) out.name = String(patch.name).slice(0, 48);
  if (patch.note !== undefined) out.note = String(patch.note).slice(0, 200);
  if (patch.preset !== undefined) out.preset = String(patch.preset);
  if (patch.enabled !== undefined) out.enabled = patch.enabled ? 1 : 0;
  if (patch.quota_gb !== undefined) out.quota_gb = Math.max(0, Number(patch.quota_gb) || 0);
  if (patch.expire_days !== undefined) out.expire_days = Math.max(0, Number(patch.expire_days) || 0);
  if (patch.max_ips !== undefined) out.max_ips = Math.max(0, Number(patch.max_ips) || 0);
  if (patch.uuid && uuidToBytes(patch.uuid)) out.uuid = patch.uuid;
  if (patch.trojan_pass !== undefined) {
    const p = String(patch.trojan_pass || '');
    out.trojan_pass = p;
    out.trojan_key = p ? trojanKey(p) : '';
  }
  return out;
}

/** Resolve expiry, honouring "start counting on first connect" when configured. */
export function quotaState(user, { startOnFirstConnect = true } = {}) {
  const now = Date.now();
  const anchor = startOnFirstConnect && user.first_seen_at ? user.first_seen_at : user.created_at;
  const expiresAt = user.expire_days > 0 ? anchor + user.expire_days * 86400000 : 0;
  const quotaBytes = user.quota_gb > 0 ? user.quota_gb * 1024 * 1024 * 1024 : 0;
  return {
    expired: !!expiresAt && now > expiresAt,
    expiresAt,
    daysLeft: expiresAt ? Math.max(0, Math.ceil((expiresAt - now) / 86400000)) : null,
    overQuota: !!quotaBytes && user.used_bytes >= quotaBytes,
    quotaBytes,
    usedBytes: user.used_bytes || 0,
    usedPct: quotaBytes ? Math.min(100, Math.round(((user.used_bytes || 0) / quotaBytes) * 1000) / 10) : null,
    active: !!user.enabled && !(expiresAt && now > expiresAt) && !(quotaBytes && user.used_bytes >= quotaBytes),
  };
}

/** The credential shapes the proxy layer authenticates against. */
export function credentialsOf(user) {
  return { uuid: user.uuid || null, trojanKey: user.trojan_key || null };
}

export function publicUser(user) {
  const q = quotaState(user);
  return {
    id: user.id, name: user.name, uuid: user.uuid, trojan_pass: user.trojan_pass,
    enabled: !!user.enabled, quota_gb: user.quota_gb, expire_days: user.expire_days,
    max_ips: user.max_ips, used_bytes: user.used_bytes, preset: user.preset, note: user.note,
    created_at: user.created_at, last_seen_at: user.last_seen_at,
    quota: q,
  };
}
