/**
 * Batched per-user traffic accounting.
 *
 * Writing a counter row on every tunnel close would exhaust the D1 free-tier
 * write budget (100k rows/day) long before the Worker request budget. So deltas
 * accumulate in isolate memory and flush on a size-or-time trigger.
 *
 * The trade-off is explicit and acceptable: if an isolate is evicted before a
 * flush, up to FLUSH_BYTES of traffic goes unrecorded. Under-counting slightly
 * is far better than self-inflicting an outage.
 */

const FLUSH_BYTES = 4 * 1024 * 1024; // 4 MiB
const FLUSH_MS = 45_000;

export function createUsageCollector(store, waitUntil) {
  const pending = new Map(); // userId -> { bytes, firstSeen }
  let totalPending = 0;
  let lastFlush = Date.now();
  let timer = null;

  function scheduleFlush() {
    if (timer) return;
    timer = setTimeout(() => { timer = null; flush(); }, FLUSH_MS);
  }

  function flush() {
    if (timer) { clearTimeout(timer); timer = null; }
    if (pending.size === 0) return;
    const batch = [...pending.entries()];
    pending.clear();
    totalPending = 0;
    lastFlush = Date.now();

    const work = (async () => {
      for (const [userId, { bytes, firstSeen }] of batch) {
        try {
          const u = await store.getUser(userId);
          if (!u) continue;
          const next = { ...u, used_bytes: (u.used_bytes || 0) + bytes, request_count: (u.request_count || 0) + 1,
            last_seen_at: Date.now() };
          if (firstSeen && !u.first_seen_at) next.first_seen_at = Date.now();
          await store.putUser(next);
        } catch { /* accounting must never break a tunnel */ }
      }
      try { await store.addUsage(batch.reduce((a, [, v]) => a + v.bytes, 0), 0); } catch { /* ignore */ }
    })();

    if (typeof waitUntil === 'function') { try { waitUntil(work); return; } catch { /* fall through */ } }
    work.catch(() => { /* swallow */ });
  }

  return {
    record({ userId, bytes }) {
      if (!userId || !bytes) return;
      const cur = pending.get(userId) || { bytes: 0, firstSeen: false };
      cur.bytes += bytes;
      pending.set(userId, cur);
      totalPending += bytes;
      if (totalPending >= FLUSH_BYTES || Date.now() - lastFlush > FLUSH_MS) flush();
      else scheduleFlush();
    },
    markFirstSeen(userId) {
      const cur = pending.get(userId) || { bytes: 0, firstSeen: false };
      cur.firstSeen = true;
      pending.set(userId, cur);
    },
    pendingBytes: () => totalPending,
    flush,
  };
}
