/**
 * Request-budget governor.
 *
 * Cloudflare's free plan allows **100,000 Worker requests per day**. Exceeding
 * it is what actually gets accounts suspended — not the content of the traffic.
 * A proxy Worker burns one request per client connection, so the honest levers
 * are:
 *
 *   1. Spend fewer requests on the panel itself. The whole UI is ONE inlined
 *      document, and the dashboard never polls: it refreshes on demand or over
 *      a single long-lived SSE stream.
 *   2. Cache what can be cached. Subscriptions are stored in the Cache API for
 *      120s, so a fleet of clients refreshing on a timer collapses into one
 *      generation.
 *   3. Count, and stop *non-essential* work before the limit rather than after.
 *      When usage crosses `softPct` the panel switches to cached-only serving;
 *      proxy traffic keeps flowing until `hardPct`.
 *
 * Counting is sampled and flushed per isolate, never once per request: writing
 * a counter row on every invocation would blow the D1 write quota long before
 * the Worker request quota, which would be a self-inflicted outage.
 */

const SAMPLE_RATE = 25;   // persist 1 row per ~25 invocations, multiply back out

export function createGovernor(store, env) {
  const limits = {
    daily: Number(env.REQUEST_BUDGET || 100000),
    softPct: Number(env.BUDGET_SOFT_PCT || 80),
    hardPct: Number(env.BUDGET_HARD_PCT || 97),
  };

  let pending = 0;
  let lastFlush = 0;
  let snapshot = null;
  let snapshotAt = 0;

  async function read() {
    const now = Date.now();
    if (snapshot && now - snapshotAt < 30000) return snapshot;
    let u = { requests: 0, bytes: 0, totalRequests: 0, day: '' };
    try { u = await store.usage(); } catch { /* store unavailable: report zeros */ }
    // Add back whatever this isolate has counted but not yet persisted.
    const requests = (u.requests || 0) + pending * SAMPLE_RATE;
    snapshot = { ...u, requests, estimated: pending > 0 };
    snapshotAt = now;
    return snapshot;
  }

  /** Call once per invocation. Returns the current state. */
  async function tick(waitUntil) {
    pending++;
    const now = Date.now();
    if (pending >= SAMPLE_RATE || now - lastFlush > 60000) {
      const n = pending; pending = 0; lastFlush = now;
      const write = store.addUsage(0, n * SAMPLE_RATE).then(() => { snapshot = null; }).catch(() => { pending += n; });
      if (typeof waitUntil === 'function') { try { waitUntil(write); } catch { await write; } } else { await write; }
    }
    return read();
  }

  function state(u) {
    const pct = limits.daily > 0 ? (u.requests / limits.daily) * 100 : 0;
    let mode = 'ok';
    if (pct >= limits.hardPct) mode = 'critical';
    else if (pct >= limits.softPct) mode = 'throttled';
    return { ...u, limits, pct: Math.round(pct * 100) / 100, mode };
  }

  return { limits, tick, read, state, SAMPLE_RATE };
}

export const GOVERNOR_DOC_NOTE =
  'Counting is sampled 1-in-25 and flushed per isolate, so the number shown is an estimate with a small lag. ' +
  'It is deliberately conservative: it over-reports rather than under-reports.';
