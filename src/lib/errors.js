/**
 * Error containment.
 *
 * Cloudflare reports **error 1101** when a Worker throws an exception that
 * escapes the fetch handler. It is never a "Cloudflare is blocking you" signal —
 * it is always a bug in the script: an unguarded property access, a promise
 * rejection nobody caught, a `WebSocket.send()` on a closed socket, or a
 * `connect()` to a port Workers is not allowed to dial.
 *
 * So the whole router runs inside `safe()`, which converts anything thrown into
 * a real HTTP response. Nothing reaches Cloudflare's exception path.
 */

const PAGE = (title, code, detail, hint) => `<!doctype html>
<html lang="en" dir="ltr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} · Luncher</title>
<style>
:root{color-scheme:dark}
body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px/1.6 ui-sans-serif,system-ui,"Segoe UI",Roboto,sans-serif;
background:#05060a;color:#e8eaf2;padding:24px}
.c{max-width:560px;text-align:center}
.n{font:700 72px/1 ui-monospace,SFMono-Regular,Menlo,monospace;
background:linear-gradient(135deg,#ff6b6b,#ffa94d);-webkit-background-clip:text;background-clip:text;color:transparent}
h1{font-size:20px;margin:12px 0 6px;font-weight:650}
p{color:#9aa2bd;margin:6px 0}
code{background:#12141d;border:1px solid #23263a;border-radius:6px;padding:2px 7px;font-size:13px;color:#ffd8a8}
.hint{margin-top:18px;padding:14px 16px;background:#0c0e16;border:1px solid #1e2233;border-radius:12px;text-align:left;color:#b9c0da;font-size:14px}
</style></head><body><div class="c">
<div class="n">${code}</div>
<h1>${title}</h1>
<p>${detail}</p>
${hint ? `<div class="hint">${hint}</div>` : ''}
</div></body></html>`;

export function html(status, body, headers = {}) {
  return new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', ...headers } });
}

export function json(status, data, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

const HINTS = {
  'no-transport': 'This Worker was invoked outside a runtime that provides <code>cloudflare:sockets</code>. Redeploy with <code>wrangler deploy</code>.',
  'port-blocked': 'Workers may only dial a fixed set of TCP ports (80, 443, 8080, 8443, 2052-2096, 20-22). The client asked for a port Cloudflare refuses.',
  'relay-auth': 'The configured relay rejected the credentials. Check Settings → Relays.',
  'relay-refused': 'The relay refused the CONNECT request. The upstream host may be down or rate-limiting.',
  'loopback': 'A client tried to make this Worker connect to itself or to a link-local metadata address. Refused.',
  'quota': 'This user is over quota or expired. Edit them in the panel to reset.',
  'budget': 'The daily request budget guard tripped. Proxy traffic is still allowed; the panel is serving cached pages. See docs/limits.md.',
};

/** Wrap a handler so no exception can ever become a 1101. */
export async function safe(fn, ctx = {}) {
  try {
    return await fn();
  } catch (err) {
    const code = err && err.code;
    const detail = escapeHtml(String((err && err.message) || err || 'unexpected error'));
    const hint = HINTS[code] || '';
    if (ctx.onLog) { try { ctx.onLog(err); } catch { /* never let logging throw */ } }
    // A blocked destination port is the CLIENT's fault — it asked for a port
    // Workers may not dial — so it is a 400, not a 500. The page used to display
    // "400" while the response actually carried 500, which sends a monitoring
    // system looking for a server bug that does not exist.
    const status = code === 'port-blocked' ? 400 : 500;
    if (ctx.wantsJson) return json(status, { ok: false, error: detail, code: code || 'internal' });
    return html(status, PAGE('Request failed', String(status), detail, hint));
  }
}

/** A 404 that does not disclose what routes exist. */
export function notFound(kind = 'html') {
  if (kind === 'json') return json(404, { ok: false, error: 'not found' });
  return html(404, PAGE('Not found', '404', 'Nothing is served at this path.', ''));
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export { PAGE };
