/**
 * Storage layer with three interchangeable backends.
 *
 *   D1     -> full features (multi-user, quotas, stats, history)
 *   KV     -> same, minus SQL-style reporting
 *   memory -> "solo mode": one admin + one user driven by env vars
 *
 * Auto-detection means the Cloudflare one-click Deploy button produces a
 * working panel before the user has created any database. Nothing throws when a
 * binding is missing; the panel just runs with fewer features and says so.
 */

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  uuid TEXT NOT NULL,
  trojan_key TEXT NOT NULL DEFAULT '',
  trojan_pass TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  quota_gb REAL NOT NULL DEFAULT 0,
  expire_days INTEGER NOT NULL DEFAULT 0,
  max_ips INTEGER NOT NULL DEFAULT 0,
  used_bytes INTEGER NOT NULL DEFAULT 0,
  request_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT 0,
  first_seen_at INTEGER NOT NULL DEFAULT 0,
  last_seen_at INTEGER NOT NULL DEFAULT 0,
  preset TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_users_uuid ON users(uuid);
CREATE INDEX IF NOT EXISTS idx_users_key ON users(trojan_key);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, ip TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS usage (day TEXT NOT NULL, kind TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, kind));
CREATE TABLE IF NOT EXISTS active_ips (user_id TEXT NOT NULL, ip TEXT NOT NULL, seen_at INTEGER NOT NULL, PRIMARY KEY (user_id, ip));
`;

export { SCHEMA };

export function detectBackend(env) {
  if (env && env.DB && typeof env.DB.prepare === 'function') return 'd1';
  if (env && env.KV && typeof env.KV.get === 'function') return 'kv';
  return 'memory';
}

/* ------------------------------------------------------------------ memory */

function memoryBackend(env) {
  const settings = new Map();
  const users = new Map();
  const sessions = new Map();
  const usage = new Map();
  const ips = new Map();

  // Solo mode: seed one user from env so the panel is immediately usable.
  const seedUuid = env && env.USER_UUID;
  if (seedUuid) {
    users.set(seedUuid, {
      id: 'solo', name: (env && env.USER_NAME) || 'you', uuid: seedUuid,
      trojan_key: '', trojan_pass: '', enabled: 1, quota_gb: 0, expire_days: 0,
      max_ips: 0, used_bytes: 0, request_count: 0, created_at: Date.now(),
      first_seen_at: 0, last_seen_at: 0, preset: '', note: 'solo mode',
    });
  }

  return {
    kind: 'memory',
    async init() { /* nothing to do */ },
    async getSetting(k) { return settings.has(k) ? settings.get(k) : null; },
    async setSetting(k, v) { settings.set(k, String(v)); },
    async allSettings() { return Object.fromEntries(settings); },
    async listUsers() { return [...users.values()]; },
    async getUser(id) { return users.get(id) || null; },
    async findUser({ uuid, trojanKey }) {
      for (const u of users.values()) {
        if (uuid && u.uuid === uuid) return u;
        if (trojanKey && u.trojan_key && u.trojan_key === trojanKey) return u;
      }
      return null;
    },
    async putUser(u) { users.set(u.id, { ...u }); return u; },
    async deleteUser(id) { return users.delete(id); },
    async addUsage(bytes, requests = 1) {
      const day = new Date().toISOString().slice(0, 10);
      for (const [kind, val] of [['requests', requests], ['bytes', bytes]]) {
        usage.set(`${day}:${kind}`, (usage.get(`${day}:${kind}`) || 0) + val);
      }
    },
    async usage() {
      const day = new Date().toISOString().slice(0, 10);
      return { day, requests: usage.get(`${day}:requests`) || 0, bytes: usage.get(`${day}:bytes`) || 0,
               totalRequests: [...usage.keys()].filter((k) => k.endsWith(':requests')).reduce((a, k) => a + usage.get(k), 0) };
    },
    async createSession(token, ttl, ip) { sessions.set(token, { expires_at: Date.now() + ttl * 1000, ip }); },
    async getSession(token) {
      const s = sessions.get(token);
      if (!s) return null;
      if (s.expires_at < Date.now()) { sessions.delete(token); return null; }
      return s;
    },
    async deleteSession(token) { sessions.delete(token); },
    async touchIp(userId, ip, maxIps) {
      const key = `${userId}|${ip}`;
      ips.set(key, Date.now());
      if (!maxIps) return { allowed: true, count: 0 };
      const mine = [...ips.entries()].filter(([k]) => k.startsWith(`${userId}|`));
      const cutoff = Date.now() - 24 * 3600 * 1000;
      for (const [k, t] of mine) if (t < cutoff) ips.delete(k);
      const live = [...ips.keys()].filter((k) => k.startsWith(`${userId}|`));
      return { allowed: live.length <= maxIps, count: live.length };
    },
  };
}

/* ---------------------------------------------------------------------- KV */

function kvBackend(env) {
  const KV = env.KV;
  const jget = async (k, d) => { try { const v = await KV.get(k, 'json'); return v === null || v === undefined ? d : v; } catch { return d; } };
  const jput = (k, v) => KV.put(k, JSON.stringify(v));

  return {
    kind: 'kv',
    async init() { /* KV needs no schema */ },
    async getSetting(k) { const v = await jget(`s:${k}`, null); return v === null ? null : v.value; },
    async setSetting(k, v) { await jput(`s:${k}`, { value: String(v) }); },
    async allSettings() {
      const list = await KV.list({ prefix: 's:' });
      const out = {};
      for (const k of list.keys) { const v = await jget(k.name, null); if (v) out[k.name.slice(2)] = v.value; }
      return out;
    },
    async listUsers() {
      const list = await KV.list({ prefix: 'u:' });
      const out = [];
      for (const k of list.keys) { const v = await jget(k.name, null); if (v) out.push(v); }
      return out;
    },
    async getUser(id) { return jget(`u:${id}`, null); },
    async findUser({ uuid, trojanKey }) {
      const idx = await jget('idx', {});
      if (uuid && idx.uuid && idx.uuid[uuid]) return this.getUser(idx.uuid[uuid]);
      if (trojanKey && idx.key && idx.key[trojanKey]) return this.getUser(idx.key[trojanKey]);
      return null;
    },
    async putUser(u) {
      await jput(`u:${u.id}`, u);
      const idx = await jget('idx', {});
      idx.uuid = idx.uuid || {}; idx.key = idx.key || {};
      if (u.uuid) idx.uuid[u.uuid] = u.id;
      if (u.trojan_key) idx.key[u.trojan_key] = u.id;
      await jput('idx', idx);
      return u;
    },
    async deleteUser(id) {
      const u = await this.getUser(id);
      const idx = await jget('idx', {});
      if (u) { delete (idx.uuid || {})[u.uuid]; delete (idx.key || {})[u.trojan_key]; await jput('idx', idx); }
      await KV.delete(`u:${id}`);
      return true;
    },
    async addUsage(bytes, requests = 1) {
      const day = new Date().toISOString().slice(0, 10);
      const cur = await jget(`d:${day}`, { requests: 0, bytes: 0 });
      cur.requests += requests; cur.bytes += bytes;
      await jput(`d:${day}`, cur);
    },
    async usage() {
      const day = new Date().toISOString().slice(0, 10);
      const cur = await jget(`d:${day}`, { requests: 0, bytes: 0 });
      const list = await KV.list({ prefix: 'd:' });
      let total = 0;
      for (const k of list.keys) { const v = await jget(k.name, null); if (v) total += v.requests || 0; }
      return { day, requests: cur.requests, bytes: cur.bytes, totalRequests: total };
    },
    async createSession(token, ttl, ip) { await KV.put(`t:${token}`, JSON.stringify({ ip }), { expirationTtl: Math.max(60, ttl) }); },
    async getSession(token) { try { return await KV.getWithMetadata(`t:${token}`); } catch { return null; } },
    async deleteSession(token) { await KV.delete(`t:${token}`); },
    async touchIp(userId, ip, maxIps) {
      if (!maxIps) return { allowed: true, count: 0 };
      const key = `ip:${userId}`;
      const cur = await jget(key, {});
      const cutoff = Date.now() - 24 * 3600 * 1000;
      for (const [k, t] of Object.entries(cur)) if (t < cutoff) delete cur[k];
      cur[ip] = Date.now();
      const count = Object.keys(cur).length;
      if (count <= maxIps) await jput(key, cur);
      return { allowed: count <= maxIps, count };
    },
  };
}

/* ---------------------------------------------------------------------- D1 */

function d1Backend(env) {
  const DB = env.DB;
  const now = () => Date.now();

  return {
    kind: 'd1',
    async init() {
      // `exec` runs multiple statements; safe to re-run (everything is IF NOT EXISTS).
      try { await DB.batch(SCHEMA.split(';').filter((s) => s.trim()).map((s) => DB.prepare(s.trim()))); }
      catch { /* schema already present, or D1 in a read-only preview */ }
    },
    async getSetting(k) {
      const r = await DB.prepare('SELECT value FROM settings WHERE key=?').bind(k).first();
      return r ? r.value : null;
    },
    async setSetting(k, v) {
      await DB.prepare('INSERT INTO settings (key,value,updated_at) VALUES (?,?,?) ' +
        'ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at')
        .bind(k, String(v), now()).run();
    },
    async allSettings() {
      const { results } = await DB.prepare('SELECT key,value FROM settings').all();
      const out = {};
      for (const r of results || []) out[r.key] = r.value;
      return out;
    },
    async listUsers() {
      const { results } = await DB.prepare('SELECT * FROM users ORDER BY created_at DESC').all();
      return results || [];
    },
    async getUser(id) { return DB.prepare('SELECT * FROM users WHERE id=?').bind(id).first(); },
    async findUser({ uuid, trojanKey }) {
      if (uuid) { const r = await DB.prepare('SELECT * FROM users WHERE uuid=? AND enabled=1').bind(uuid).first(); if (r) return r; }
      if (trojanKey) { const r = await DB.prepare('SELECT * FROM users WHERE trojan_key=? AND enabled=1').bind(trojanKey).first(); if (r) return r; }
      return null;
    },
    async putUser(u) {
      const cols = ['id', 'name', 'uuid', 'trojan_key', 'trojan_pass', 'enabled', 'quota_gb', 'expire_days',
        'max_ips', 'used_bytes', 'request_count', 'created_at', 'first_seen_at', 'last_seen_at', 'preset', 'note'];
      const vals = cols.map((c) => (u[c] === undefined || u[c] === null ? (typeof u[c] === 'number' ? 0 : '') : u[c]));
      const ph = cols.map(() => '?').join(',');
      const upd = cols.filter((c) => c !== 'id').map((c) => `${c}=excluded.${c}`).join(',');
      await DB.prepare(`INSERT INTO users (${cols.join(',')}) VALUES (${ph}) ON CONFLICT(id) DO UPDATE SET ${upd}`)
        .bind(...vals).run();
      return u;
    },
    async deleteUser(id) { await DB.prepare('DELETE FROM users WHERE id=?').bind(id).run(); return true; },
    /**
     * Usage is written through a single UPSERT so a busy panel costs one row,
     * not one row per request.
     */
    async addUsage(bytes, requests = 1) {
      const day = new Date().toISOString().slice(0, 10);
      await DB.prepare('INSERT INTO usage (day,kind,n) VALUES (?,\'requests\',?) ' +
        'ON CONFLICT(day,kind) DO UPDATE SET n=n+excluded.n').bind(day, requests).run();
      if (bytes) {
        await DB.prepare('INSERT INTO usage (day,kind,n) VALUES (?,\'bytes\',?) ' +
          'ON CONFLICT(day,kind) DO UPDATE SET n=n+excluded.n').bind(day, bytes).run();
      }
    },
    async usage() {
      const day = new Date().toISOString().slice(0, 10);
      const { results } = await DB.prepare('SELECT kind,n FROM usage WHERE day=?').bind(day).all();
      let requests = 0, bytes = 0;
      for (const r of results || []) { if (r.kind === 'requests') requests = r.n; if (r.kind === 'bytes') bytes = r.n; }
      const t = await DB.prepare("SELECT COALESCE(SUM(n),0) AS n FROM usage WHERE kind='requests'").first();
      return { day, requests, bytes, totalRequests: t ? t.n : 0 };
    },
    async createSession(token, ttl, ip) {
      await DB.prepare('INSERT INTO sessions (token,created_at,expires_at,ip) VALUES (?,?,?,?) ' +
        'ON CONFLICT(token) DO UPDATE SET expires_at=excluded.expires_at, ip=excluded.ip')
        .bind(token, now(), now() + ttl * 1000, ip || '').run();
    },
    async getSession(token) {
      const r = await DB.prepare('SELECT * FROM sessions WHERE token=?').bind(token).first();
      if (!r) return null;
      if (r.expires_at < now()) { await DB.prepare('DELETE FROM sessions WHERE token=?').bind(token).run(); return null; }
      return r;
    },
    async deleteSession(token) { await DB.prepare('DELETE FROM sessions WHERE token=?').bind(token).run(); },
    async touchIp(userId, ip, maxIps) {
      await DB.prepare('INSERT INTO active_ips (user_id,ip,seen_at) VALUES (?,?,?) ' +
        'ON CONFLICT(user_id,ip) DO UPDATE SET seen_at=excluded.seen_at').bind(userId, ip, now()).run();
      if (!maxIps) return { allowed: true, count: 0 };
      const cutoff = now() - 24 * 3600 * 1000;
      await DB.prepare('DELETE FROM active_ips WHERE seen_at < ?').bind(cutoff).run();
      const r = await DB.prepare('SELECT COUNT(*) AS n FROM active_ips WHERE user_id=?').bind(userId).first();
      const count = r ? r.n : 0;
      return { allowed: count <= maxIps, count };
    },
  };
}

let cached = null;

/** Build (once per isolate) the best available backend for this environment. */
export function getStore(env) {
  if (cached && cached.kind === detectBackend(env)) return cached;
  const kind = detectBackend(env);
  cached = kind === 'd1' ? d1Backend(env) : kind === 'kv' ? kvBackend(env) : memoryBackend(env);
  return cached;
}

export function resetStoreCache() { cached = null; }
