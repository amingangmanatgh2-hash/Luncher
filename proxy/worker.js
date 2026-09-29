/**
 * DLCK LNCH — optional Gemini relay (Cloudflare Worker)
 * ---------------------------------------------------------------------------
 * Why this exists
 *   By default DLCK LNCH talks to Google directly and the user's API key lives
 *   only in EncryptedSharedPreferences on the phone. That is fine for personal
 *   use. If you distribute the launcher to other people and do not want each of
 *   them to own a Gemini key, deploy this Worker: the *real* key stays in
 *   Worker secrets, and the app is configured with a proxy base URL plus a
 *   revocable client token instead.
 *
 * Guarantees implemented here
 *   - The Gemini key is never sent to, or stored on, the device.
 *   - Only the two endpoints the launcher actually needs are reachable.
 *   - Every client needs a token; tokens are compared in constant time.
 *   - Per-token, per-minute rate limiting backed by a Durable Object (falls
 *     back to "allow" if the binding is absent, so the Worker still runs on the
 *     free plan without Durable Objects).
 *   - Server-Sent Events are streamed straight through, so the app keeps its
 *     token-by-token typing effect.
 *
 * Deploy
 *   npm i -g wrangler
 *   wrangler secret put GEMINI_API_KEY
 *   wrangler secret put CLIENT_TOKENS      # comma separated list
 *   wrangler deploy
 *
 * Then in the app: AI Setup → Advanced → Proxy base URL = https://<worker>.workers.dev
 *                  and paste one of the CLIENT_TOKENS in the key field.
 */

const UPSTREAM = "https://generativelanguage.googleapis.com";

/** Only these upstream paths may be reached through the relay. */
const ALLOWED_PATHS = [
  /^\/v1beta\/models$/,
  /^\/v1beta\/models\/[a-zA-Z0-9.\-_]+:generateContent$/,
  /^\/v1beta\/models\/[a-zA-Z0-9.\-_]+:streamGenerateContent$/,
];

const MAX_BODY_BYTES = 128 * 1024;
const DEFAULT_RPM = 20;

export default {
  async fetch(request, env, ctx) {
    if (request.method === "OPTIONS") return preflight(env);

    try {
      return await handle(request, env, ctx);
    } catch (err) {
      return json({ error: { code: 500, status: "PROXY_ERROR", message: String(err && err.message || err) } }, 500, env);
    }
  },
};

async function handle(request, env, ctx) {
  if (request.method !== "POST" && request.method !== "GET") {
    return json({ error: { code: 405, status: "METHOD_NOT_ALLOWED", message: "Use GET or POST." } }, 405, env);
  }

  if (!env.GEMINI_API_KEY) {
    return json({ error: { code: 500, status: "NOT_CONFIGURED", message: "GEMINI_API_KEY secret is not set on the Worker." } }, 500, env);
  }

  const url = new URL(request.url);
  if (!ALLOWED_PATHS.some((re) => re.test(url.pathname))) {
    return json({ error: { code: 404, status: "PATH_NOT_ALLOWED", message: `Path ${url.pathname} is not exposed by this relay.` } }, 404, env);
  }

  // ---------------------------------------------------------------- auth
  const token = clientToken(request);
  const allowed = String(env.CLIENT_TOKENS || "").split(",").map((t) => t.trim()).filter(Boolean);
  if (allowed.length === 0) {
    return json({ error: { code: 500, status: "NOT_CONFIGURED", message: "CLIENT_TOKENS secret is not set on the Worker." } }, 500, env);
  }
  if (!token || !allowed.some((candidate) => timingSafeEqual(candidate, token))) {
    return json({ error: { code: 401, status: "UNAUTHENTICATED", message: "Missing or invalid client token." } }, 401, env);
  }

  // ------------------------------------------------------------ throttle
  const rpm = Number(env.RATE_LIMIT_RPM || DEFAULT_RPM);
  const verdict = await rateLimit(env, await tokenId(token), rpm);
  if (!verdict.ok) {
    return json(
      { error: { code: 429, status: "RESOURCE_EXHAUSTED", message: `Rate limit of ${rpm} requests/minute reached. Retry in ${verdict.retryAfter}s.` } },
      429,
      env,
      { "retry-after": String(verdict.retryAfter) },
    );
  }

  // ------------------------------------------------------------ the body
  let body = null;
  if (request.method === "POST") {
    const raw = await request.arrayBuffer();
    if (raw.byteLength > MAX_BODY_BYTES) {
      return json({ error: { code: 413, status: "PAYLOAD_TOO_LARGE", message: `Request body exceeds ${MAX_BODY_BYTES} bytes.` } }, 413, env);
    }
    try {
      JSON.parse(new TextDecoder().decode(raw)); // reject anything that is not JSON
    } catch {
      return json({ error: { code: 400, status: "INVALID_ARGUMENT", message: "Body must be JSON." } }, 400, env);
    }
    body = raw;
  }

  // --------------------------------------------------------- pass upstream
  const upstream = new URL(UPSTREAM + url.pathname);
  // Only forward the query parameters Gemini needs; never forward a caller "key".
  for (const name of ["alt", "pageSize", "pageToken"]) {
    const value = url.searchParams.get(name);
    if (value) upstream.searchParams.set(name, value);
  }

  const headers = new Headers({
    "x-goog-api-key": env.GEMINI_API_KEY,
    "accept": request.headers.get("accept") || "application/json",
    "user-agent": "dlck-lnch-relay/1.0",
  });
  if (body) headers.set("content-type", "application/json");

  const response = await fetch(upstream.toString(), {
    method: request.method,
    headers,
    body,
  });

  const out = new Headers();
  for (const name of ["content-type", "cache-control"]) {
    const value = response.headers.get(name);
    if (value) out.set(name, value);
  }
  applyCors(out, env);
  out.set("x-proxy", "dlck-lnch");
  // Never let an upstream header leak quota/identity details of the owner key.
  out.delete("x-goog-api-key");

  return new Response(response.body, { status: response.status, headers: out });
}

// ------------------------------------------------------------------ helpers

function clientToken(request) {
  const auth = request.headers.get("authorization");
  if (auth && auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return (request.headers.get("x-goog-api-key") || request.headers.get("x-client-token") || "").trim();
}

/** Constant-time string compare — avoids leaking token bytes through timing. */
function timingSafeEqual(a, b) {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  const len = Math.max(x.length, y.length);
  for (let i = 0; i < len; i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

/** Hash the token so no raw secret is used as a storage key or ever logged. */
async function tokenId(token) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function rateLimit(env, id, rpm) {
  if (!env.RATE_LIMITER) return { ok: true }; // Durable Object not bound → no limiting
  const stub = env.RATE_LIMITER.get(env.RATE_LIMITER.idFromName(id));
  const res = await stub.fetch(`https://limiter/hit?rpm=${rpm}`);
  return await res.json();
}

function applyCors(headers, env) {
  const origin = env.ALLOWED_ORIGIN || "*";
  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-allow-headers", "authorization, content-type, x-goog-api-key, x-client-token");
  headers.set("access-control-allow-methods", "GET, POST, OPTIONS");
  headers.set("access-control-max-age", "86400");
}

function preflight(env) {
  const headers = new Headers();
  applyCors(headers, env);
  return new Response(null, { status: 204, headers });
}

function json(payload, status, env, extra = {}) {
  const headers = new Headers({ "content-type": "application/json; charset=utf-8", ...extra });
  applyCors(headers, env);
  return new Response(JSON.stringify(payload), { status, headers });
}

/** Fixed-window limiter, one instance per token hash. */
export class RateLimiter {
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    const rpm = Number(new URL(request.url).searchParams.get("rpm") || DEFAULT_RPM);
    const now = Date.now();
    const window = Math.floor(now / 60000);
    const stored = (await this.state.storage.get("window")) || { window: -1, count: 0 };

    if (stored.window !== window) {
      stored.window = window;
      stored.count = 0;
    }
    stored.count += 1;
    await this.state.storage.put("window", stored);

    const ok = stored.count <= rpm;
    const retryAfter = Math.max(1, 60 - Math.floor((now % 60000) / 1000));
    return new Response(JSON.stringify({ ok, retryAfter }), {
      headers: { "content-type": "application/json" },
    });
  }
}
