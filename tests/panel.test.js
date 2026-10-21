/**
 * Panel UI tests — the real SPA, executed in a real DOM.
 *
 * `node --check` proves the app parses. It cannot prove the app *renders*: a
 * missing translation key, an icon name that does not exist, or a view that
 * reads a field the API never sends all produce a blank or broken panel with no
 * error anywhere. This suite loads the exact document the Worker serves, runs it
 * under jsdom, and drives it the way a user would — typing a password, clicking
 * buttons, clicking through the sidebar.
 *
 * The fixture data is built from the real settings/presets modules rather than
 * invented, so the UI is exercised against the shapes production actually sends.
 * No server is required; `fetch` is mocked in-process.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';
import * as acorn from 'acorn';

import { DEFAULTS, normalize, validateReport } from '../src/panel/settings.js';
import { FRAGMENT_PRESETS, CF_RANGES_V4, CF_RANGES_V6, SANCTIONED_DOMAINS, WORKER_TCP_PORTS, FINGERPRINTS, CIPHER_SUITES, DECOY_SNI } from '../src/panel/presets.js';
import { buildAll, buildXrayJson } from '../src/panel/configs.js';
import { qrToSvg } from '../src/lib/qr.js';
import { VERSION } from '../src/panel/api.js';

const read = (p) => readFileSync(new URL(`../src/ui/${p}`, import.meta.url), 'utf8');

/** Same assembly the Worker performs, so we test the served document itself. */
function assemble(settings, bootOverrides = {}) {
  const boot = { panelName: settings.panelName, language: settings.language, version: VERSION, ...bootOverrides };
  const bootJson = JSON.stringify(boot).replace(/</g, '\\u003c');
  return read('index.html')
    .replace('/*__LUNCHER_CSS__*/', () => read('styles.css.txt'))
    .replace('/*__LUNCHER_JS__*/', () => read('icons.js.txt') + '\n;\n' + read('app.js.txt'))
    .replace('/*__LUNCHER_BOOT__*/', () => bootJson);
}

/* ------------------------------------------------------------- fixtures */

const SETTINGS = normalize({ ...DEFAULTS, preset: 'irancell', panelName: 'Luncher', language: 'fa' });

const USER = {
  id: 'u1', name: 'Ali', uuid: 'fa907ea1-3236-4a0b-b2da-2f4b18c68af0',
  trojan_pass: 'V5k9rnGCEviJW63S', enabled: true, quota_gb: 5, expire_days: 30,
  max_ips: 3, used_bytes: 1073741824, preset: 'irancell', note: '',
  created_at: Date.now(), last_seen_at: 0,
  quota: { expired: false, expiresAt: Date.now() + 86400000 * 30, daysLeft: 30,
    overQuota: false, quotaBytes: 5368709120, usedBytes: 1073741824, usedPct: 20, active: true },
};

const ENDPOINTS = [
  { host: 'luncher.example.workers.dev', address: 'luncher.example.workers.dev', port: 443, label: 'Domain', tls: true },
  { host: 'luncher.example.workers.dev', address: '188.114.97.6', port: 443, label: 'CF 188.114.97.6', tls: true },
];

const OVERVIEW = {
  ok: true, version: VERSION, backend: 'd1', requestHost: 'luncher.example.workers.dev',
  budget: { requests: 12480, daily: 100000, pct: 12.48, mode: 'ok', bytes: 5368709120, estimated: true },
  users: { total: 1, active: 1, disabled: 0, expired: 0 },
  settings: { ...SETTINGS, report: validateReport(SETTINGS) },
  endpoints: ENDPOINTS,
  workerPorts: WORKER_TCP_PORTS, cfRanges: { v4: CF_RANGES_V4, v6: CF_RANGES_V6 },
  sanctionedCount: SANCTIONED_DOMAINS.length, sanctionedDomains: SANCTIONED_DOMAINS,
  fingerprints: FINGERPRINTS, cipherSuites: Object.keys(CIPHER_SUITES), decoys: DECOY_SNI,
  presets: Object.entries(FRAGMENT_PRESETS).map(([id, v]) => ({ id, label: v.label, labelFa: v.labelFa, note: v.note })),
  relayConfigured: false,
};

function configsPayload(user, client) {
  const links = buildAll({
    user, endpoints: ENDPOINTS,
    settings: { ...SETTINGS, clients: client ? [client] : SETTINGS.clients, profileTitle: SETTINGS.profileTitle },
    max: SETTINGS.maxLinksPerSub,
  });
  return {
    ok: true, links, endpoints: ENDPOINTS,
    subUrl: 'https://luncher.example.workers.dev/sub/' + user.uuid,
    statusUrl: 'https://luncher.example.workers.dev/s/' + user.uuid,
    json: buildXrayJson({ user, endpoint: ENDPOINTS[0], settings: SETTINGS, style: SETTINGS.jsonStyle,
      blockAds: SETTINGS.blockAds, unlockSanctioned: SETTINGS.unlockSanctioned }),
  };
}

/** A Response-shaped object; the app calls .json(), .text(), .ok and .status. */
function res(status, payload, asText = false) {
  const text = asText ? String(payload) : JSON.stringify(payload);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Map([['content-type', asText ? 'image/svg+xml' : 'application/json']]),
    json: async () => (asText ? (() => { throw new Error('not json'); })() : JSON.parse(text)),
    text: async () => text,
  };
}

/** Route table mirroring src/panel/api.js, backed by the fixtures above. */
function makeFetch(log) {
  let settings = OVERVIEW.settings;
  return async function fetchMock(input, init = {}) {
    const url = new URL(String(input), 'https://luncher.example.workers.dev');
    const path = url.pathname;
    const method = (init.method || 'GET').toUpperCase();
    log.push(`${method} ${path}`);

    if (path === '/api/state') return res(200, { ok: true, version: VERSION, panelName: settings.panelName,
      configured: true, backend: 'd1', language: settings.language, presets: OVERVIEW.presets });
    if (path === '/api/me') return res(200, { ok: true, ip: '1.2.3.4' });
    if (path === '/api/login') return res(200, { ok: true });
    if (path === '/api/logout') return res(200, { ok: true });
    if (path === '/api/setup') return res(200, { ok: true });
    if (path === '/api/overview') return res(200, { ...OVERVIEW, settings });
    if (path === '/api/users' && method === 'GET') return res(200, { ok: true, users: [USER] });
    if (path === '/api/users' && method === 'POST') return res(200, { ok: true, user: USER, ...configsPayload(USER) });
    if (path === '/api/settings' && method === 'GET') return res(200, { ok: true, settings, endpoints: ENDPOINTS });
    if (path === '/api/settings' && method === 'PUT') {
      settings = { ...settings, ...(init.body ? JSON.parse(init.body) : {}) };
      return res(200, { ok: true, settings, report: validateReport(settings) });
    }
    if (path === '/api/backup') return res(200, { ok: true, version: VERSION, exportedAt: Date.now(), users: [USER], settings });
    if (path === '/api/egress') return res(200, { ok: true, exitIp: '104.28.0.1', ms: 214, via: 'direct',
      country: 'Germany', detail: 'Germany · Frankfurt', sanctionRisk: false, target: 'api.ipify.org:80', hint: 'clean' });
    const mCfg = path.match(/^\/api\/users\/([^/]+)\/configs$/);
    if (mCfg) return res(200, configsPayload(USER, url.searchParams.get('client')));
    const mUser = path.match(/^\/api\/users\/([^/]+)$/);
    if (mUser) return res(200, { ok: true, user: USER });
    if (/^\/api\/users\/[^/]+\/(rotate|reset)$/.test(path)) return res(200, { ok: true, user: USER });
    if (path === '/api/qr') {
      const t = url.searchParams.get('t') || '';
      const svg = qrToSvg(t, { ec: 'M' });
      return svg ? res(200, svg, true) : res(400, { ok: false, error: 'too long' });
    }
    return res(404, { ok: false, error: 'not found: ' + path });
  };
}

/* --------------------------------------------------------------- harness */

async function loadPanel(bootOverrides = {}) {
  const log = [];
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push(String(e.message || e)));
  vc.on('error', (...a) => errors.push(a.join(' ')));
  // CSS parse noise from modern selectors is not a panel defect.
  vc.on('warn', () => {});

  const dom = new JSDOM(assemble(SETTINGS, bootOverrides), {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'https://luncher.example.workers.dev/panel',
    virtualConsole: vc,
    beforeParse(window) {
      window.fetch = makeFetch(log);
      window.LUNCHER_ERRORS = errors;
      // jsdom has no clipboard; the app feature-detects and falls back.
      Object.defineProperty(window.navigator, 'clipboard', { value: undefined, configurable: true });
      window.document.execCommand = () => true;
    },
  });

  const settle = async (ms = 60) => {
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, ms));
      await Promise.resolve();
    }
  };
  await settle();

  return { dom, window: dom.window, document: dom.window.document, errors, log, settle };
}

const txt = (el) => (el ? String(el.textContent || '').replace(/\s+/g, ' ').trim() : '');

/**
 * Rendered text of the UI, excluding the inlined source.
 *
 * The panel ships its stylesheet and scripts inside <body>, so `body.textContent`
 * includes the entire application source — including every Persian string in the
 * translation table and every literal `undefined` in the code. Asserting on that
 * produces failures about the *source* rather than the *rendering*, which is how
 * two of these tests first went red for the wrong reason.
 */
function rendered(doc, root) {
  const el = (root || doc.body).cloneNode(true);
  el.querySelectorAll('script,style').forEach((n) => n.remove());
  return String(el.textContent || '').replace(/\s+/g, ' ').trim();
}
const q = (doc, sel) => doc.querySelector(sel);
const qa = (doc, sel) => Array.from(doc.querySelectorAll(sel));

/* ----------------------------------------------------------------- tests */

test('the panel boots straight into the authenticated shell', async () => {
  const p = await loadPanel();
  assert.deepEqual(p.errors, [], 'the app threw during boot');
  assert.ok(q(p.document, '.sidebar'), 'sidebar did not render');
  assert.ok(q(p.document, '.topbar'), 'topbar did not render');
  assert.ok(q(p.document, '.view'), 'view container did not render');
  assert.ok(p.log.includes('GET /api/state'), 'should probe /api/state first');
  assert.ok(p.log.includes('GET /api/me'), 'should check the existing session');
  assert.ok(p.log.includes('GET /api/overview'), 'should load the overview');
});

test('every sidebar destination is present and labelled', async () => {
  const p = await loadPanel();
  const items = qa(p.document, '.nav-item');
  assert.equal(items.length, 7, `expected 7 nav items, got ${items.length}`);
  const labels = items.map((a) => txt(a));
  for (const want of ['داشبورد', 'کاربرها', 'کانفیگ‌ها', 'ضد فیلتر', 'رله‌ها', 'عیب‌یابی', 'تنظیمات']) {
    assert.ok(labels.some((l) => l.includes(want)), `missing Persian label "${want}" in ${JSON.stringify(labels)}`);
  }
  assert.ok(items.every((a) => q(a, 'svg')), 'every nav item needs an icon');
  assert.ok(qa(p.document, '.nav-label').length === 3, 'nav groups should be labelled');
});

test('the dashboard renders live budget, user and endpoint data', async () => {
  const p = await loadPanel();
  assert.equal(qa(p.document, '.stat').length, 4, 'expected four stat cards');
  const body = rendered(p.document, q(p.document, '.view'));
  assert.ok(body.includes('12,480'), 'request count should be formatted with separators');
  assert.ok(/12\.4?8?\d*%/.test(body), 'budget percentage should render');
  assert.ok(body.includes('luncher.example.workers.dev'), 'endpoint host should render');
  assert.ok(body.includes('188.114.97.6'), 'clean IP endpoint should render');
  const fill = q(p.document, '.gauge .fill');
  assert.ok(fill, 'budget gauge did not render');
  assert.match(fill.getAttribute('style') || '', /width:\s*12\.48%/);
  assert.ok(!body.includes('undefined') && !body.includes('NaN'),
    'the dashboard rendered an undefined/NaN value: ' + body.slice(0, 300));
  // Every row label must be a real translation, never a fallback key.
  const labels = qa(p.document, '.view dl.kv dt').map(txt);
  assert.ok(labels.length >= 4, 'the endpoint/setting list should render');
  for (const l of labels) {
    assert.ok(!/^[a-z][A-Za-z]+$/.test(l), `a settings row rendered a raw key: "${l}"`);
  }
});

test('clicking through every view renders content without errors', async () => {
  const p = await loadPanel();
  const expectations = {
    users: ['.table-wrap', 'tbody tr'],
    configs: ['.tabs', '.linkrow'],
    antidpi: ['.chips', 'select'],
    relays: ['.notice'],
    diag: ['.kv', '.chips'],
    settings: ['input', '.switch'],
  };
  for (const [view, selectors] of Object.entries(expectations)) {
    const link = qa(p.document, '.nav-item').find((a) => a.getAttribute('href') === '#' + view);
    assert.ok(link, `no nav link for #${view}`);
    link.dispatchEvent(new p.window.MouseEvent('click', { bubbles: true, cancelable: true }));
    await p.settle(40);
    const rendered = txt(q(p.document, '.view'));
    for (const sel of selectors) {
      assert.ok(q(p.document, `.view ${sel}`), `view "${view}" is missing ${sel}`);
    }
    assert.ok(rendered.length > 40, `view "${view}" rendered almost nothing: "${rendered.slice(0, 80)}"`);
    assert.ok(!rendered.includes('undefined'), `view "${view}" rendered "undefined": ${rendered.slice(0, 160)}`);
    assert.equal(txt(q(p.document, '#pageTitle')), q(p.document, '.view') ? txt(q(p.document, '#pageTitle')) : '');
  }
  assert.deepEqual(p.errors, [], 'a view threw while rendering');
});

test('the users table shows quota, expiry and per-row actions', async () => {
  const p = await loadPanel();
  qa(p.document, '.nav-item').find((a) => a.getAttribute('href') === '#users')
    .dispatchEvent(new p.window.MouseEvent('click', { bubbles: true }));
  await p.settle();
  const rows = qa(p.document, '.view tbody tr');
  assert.equal(rows.length, 1, 'expected one user row');
  const row = txt(rows[0]);
  assert.ok(row.includes('Ali'), 'user name missing');
  assert.ok(/1(\.00)?\s*GB/.test(row), 'used bytes should be human formatted: ' + row.slice(0, 120));
  assert.ok(row.includes('VLESS') && row.includes('Trojan'), 'protocol chips missing');
  assert.ok(row.includes('30'), 'days-left missing');
  assert.equal(qa(rows[0], 'button').length, 5, 'expected configs/edit/rotate/reset/delete');
  assert.ok(q(rows[0], '.mini-bar'), 'quota bar missing');
});

test('the configs view renders real share links for every client', async () => {
  const p = await loadPanel();
  qa(p.document, '.nav-item').find((a) => a.getAttribute('href') === '#configs')
    .dispatchEvent(new p.window.MouseEvent('click', { bubbles: true }));
  await p.settle();
  const tabs = qa(p.document, '.tabs button');
  assert.equal(tabs.length, 5, 'expected five client tabs');
  assert.ok(tabs[0].textContent.includes('PattNG'), 'PattNG must be the first/default client');

  const rows = qa(p.document, '.linkrow');
  assert.ok(rows.length >= 4, `expected several config rows, got ${rows.length}`);
  const link = txt(q(rows[0], 'code'));
  assert.ok(link.startsWith('vless://') || link.startsWith('trojan://'), 'row should hold a share link');

  // The double-encoding bug this guards against is subtle and silent: an extra
  // %25 in `cs` collapses 13 cipher suites to one and the client drops stealth.
  const pattng = rows.map((r) => txt(q(r, 'code'))).find((l) => l.includes('fm='));
  assert.ok(pattng, 'a PattNG finalMask link should be present');
  assert.ok(!pattng.includes('%25'), 'share link is double percent-encoded');
  const cs = decodeURIComponent(pattng.match(/[?&]cs=([^&#]*)/)[1]);
  assert.equal(cs.split(':').length, CIPHER_SUITES.standard.split(':').length,
    'the cs list must survive encoding with all suites intact');
  assert.ok(pattng.includes('fp=unsafe'), 'PattNG links need fp=unsafe');

  // Switching client tabs must re-render, not just relabel.
  tabs[1].dispatchEvent(new p.window.MouseEvent('click', { bubbles: true }));
  await p.settle();
  const after = qa(p.document, '.linkrow').map((r) => txt(q(r, 'code'))).join('\n');
  assert.ok(!after.includes('fm='), 'v2rayNG links use `fragment=`, not `fm=`');
  assert.ok(after.includes('fragment='), 'v2rayNG links should carry the legacy fragment param');
});

test('the QR modal fetches SVG as text and inlines it', async () => {
  const p = await loadPanel();
  qa(p.document, '.nav-item').find((a) => a.getAttribute('href') === '#configs')
    .dispatchEvent(new p.window.MouseEvent('click', { bubbles: true }));
  await p.settle();
  // Each row's .acts holds [copy, qr]; both carry an <svg>, so select by position
  // rather than by "has an icon", which matches the copy button first.
  const acts = qa(q(p.document, '.linkrow'), '.acts button');
  assert.equal(acts.length, 2, 'each config row should offer copy and QR');
  const qrBtn = acts[1];
  qrBtn.dispatchEvent(new p.window.MouseEvent('click', { bubbles: true }));
  await p.settle();
  assert.ok(q(p.document, '.backdrop'), 'modal did not open');
  assert.ok(q(p.document, '.modal .qrbox svg'), 'the QR SVG was not inlined');
  assert.ok(p.log.some((l) => l.startsWith('GET /api/qr')), 'should request /api/qr');
  // Fetched as text and injected, never as <img src>, which would hit URL limits
  // on ~800-character share links.
  assert.equal(qa(p.document, '.modal img').length, 0, 'QR must not be an <img>');
  q(p.document, '.modal-foot .btn.primary').dispatchEvent(new p.window.MouseEvent('click', { bubbles: true }));
  await p.settle(20);
  assert.equal(q(p.document, '.backdrop'), null, 'modal did not close');
});

test('the anti-DPI view lists every preset with its Persian label and note', async () => {
  const p = await loadPanel();
  qa(p.document, '.nav-item').find((a) => a.getAttribute('href') === '#antidpi')
    .dispatchEvent(new p.window.MouseEvent('click', { bubbles: true }));
  await p.settle();
  const body = rendered(p.document, q(p.document, '.view'));
  for (const id of Object.keys(FRAGMENT_PRESETS)) {
    const fa = FRAGMENT_PRESETS[id].labelFa;
    assert.ok(body.includes(fa) || body.includes(id), `preset ${id} (${fa}) not rendered`);
  }
  assert.ok(body.includes('ایرانسل'), 'the Irancell preset should show its Persian name');
  // The active preset must be visibly marked.
  assert.ok(q(p.document, '.view .badge.ok'), 'the active preset should carry an "on" badge');
  // Enums come from the API, so they cannot drift from presets.js. The view holds
  // several selects (cipher suites, fingerprint, SNI mode, JSON style), so find
  // the fingerprint one by its options rather than assuming document order.
  const selects = qa(p.document, '.view select');
  assert.ok(selects.length >= 4, `expected several selects, got ${selects.length}`);
  const fpSelect = selects.find((sel) => qa(sel, 'option').some((o) => o.value === 'unsafe'));
  assert.ok(fpSelect, 'the fingerprint select was not rendered');
  const fpOptions = qa(fpSelect, 'option').map((o) => o.value);
  for (const fp of FINGERPRINTS) {
    assert.ok(fpOptions.includes(fp), `fingerprint ${fp} missing from the select`);
  }
  assert.equal(fpOptions[0], 'unsafe', 'unsafe should be offered first');
});

test('the diagnostics view explains the egress result honestly', async () => {
  const p = await loadPanel();
  qa(p.document, '.nav-item').find((a) => a.getAttribute('href') === '#diag')
    .dispatchEvent(new p.window.MouseEvent('click', { bubbles: true }));
  await p.settle();
  const run = qa(p.document, '.view button').find((b) => txt(b).includes('اجرای تست'));
  assert.ok(run, 'the egress test button is missing');
  run.dispatchEvent(new p.window.MouseEvent('click', { bubbles: true }));
  await p.settle();
  const body = rendered(p.document);
  assert.ok(body.includes('104.28.0.1'), 'exit IP should render');
  assert.ok(body.includes('Germany'), 'country should render');
  assert.ok(p.log.includes('POST /api/egress'), 'should call /api/egress');
  assert.ok(body.includes('214'), 'latency should render');
});

test('clean-IP editing round-trips through the settings API', async () => {
  const p = await loadPanel();
  qa(p.document, '.nav-item').find((a) => a.getAttribute('href') === '#antidpi')
    .dispatchEvent(new p.window.MouseEvent('click', { bubbles: true }));
  await p.settle();
  const before = qa(p.document, '.view .chip').length;
  const input = qa(p.document, '.view input').find((i) => (i.placeholder || '').includes('188.114'));
  assert.ok(input, 'the add-IP input is missing');
  input.value = '104.19.229.21, 172.66.0.1';
  const add = qa(p.document, '.view button').find((b) => txt(b).includes('افزودن'));
  assert.ok(add, 'the add button is missing');
  add.dispatchEvent(new p.window.MouseEvent('click', { bubbles: true }));
  await p.settle();
  const put = p.log.filter((l) => l === 'PUT /api/settings').length;
  assert.ok(put >= 1, 'adding IPs should persist via PUT /api/settings');
  assert.ok(qa(p.document, '.view .chip').length > before, 'the new chips did not render');
  assert.ok(rendered(p.document).includes('104.19.229.21'), 'the added IP should be visible');
});

test('the language toggle re-renders in English and persists the choice', async () => {
  const p = await loadPanel();
  assert.equal(p.document.documentElement.getAttribute('dir'), 'rtl', 'Persian is the default');
  assert.equal(p.document.documentElement.getAttribute('lang'), 'fa');
  const toggle = qa(p.document, '.topbar button').find((b) => txt(b) === 'EN');
  assert.ok(toggle, 'the language toggle is missing from the topbar');
  toggle.dispatchEvent(new p.window.MouseEvent('click', { bubbles: true }));
  await p.settle();
  assert.equal(p.document.documentElement.getAttribute('dir'), 'ltr', 'direction should flip');
  assert.equal(p.document.documentElement.getAttribute('lang'), 'en');
  const body = rendered(p.document);
  assert.ok(body.includes('Dashboard') || body.includes('Users'), 'English labels should render');
  assert.ok(!body.includes('داشبورد'), 'Persian labels should be gone');
  assert.equal(p.window.localStorage.getItem('luncher.lang'), 'en', 'choice should persist');
  assert.deepEqual(p.errors, [], 'the toggle threw');
});

test('an unconfigured panel shows the setup wizard, not the dashboard', async () => {
  const log = [];
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push(String(e.message || e)));
  const dom = new JSDOM(assemble(SETTINGS), {
    runScripts: 'dangerously', pretendToBeVisual: true,
    url: 'https://luncher.example.workers.dev/panel', virtualConsole: vc,
    beforeParse(window) {
      window.fetch = async (input) => {
        const path = new URL(String(input), 'https://x').pathname;
        log.push(path);
        if (path === '/api/state') return res(200, { ok: true, configured: false, panelName: 'Luncher',
          language: 'fa', version: VERSION, presets: OVERVIEW.presets });
        return res(401, { ok: false, error: 'nope' });
      };
    },
  });
  await new Promise((r) => setTimeout(r, 300));
  const doc = dom.window.document;
  assert.ok(q(doc, '.auth-card'), 'the setup card should render');
  const body = txt(doc.body);
  assert.ok(body.includes('راه‌اندازی اولیه'), 'should offer first-time setup in Persian');
  assert.ok(q(doc, 'input[type=password]'), 'a password field is required');
  assert.equal(q(doc, '.sidebar'), null, 'the shell must not render before authentication');
  assert.deepEqual(errors, [], 'the auth screen threw');
});

test('a failed login surfaces the server message instead of failing silently', async () => {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push(String(e.message || e)));
  const dom = new JSDOM(assemble(SETTINGS), {
    runScripts: 'dangerously', pretendToBeVisual: true,
    url: 'https://luncher.example.workers.dev/panel', virtualConsole: vc,
    beforeParse(window) {
      window.fetch = async (input, init = {}) => {
        const path = new URL(String(input), 'https://x').pathname;
        if (path === '/api/state') return res(200, { ok: true, configured: true, panelName: 'Luncher',
          language: 'fa', version: VERSION, presets: [] });
        if (path === '/api/me') return res(401, { ok: false, error: 'not authenticated' });
        if (path === '/api/login') return res(429, { ok: false, error: 'Too many attempts. Try again in 60s.' });
        return res(401, { ok: false, error: 'nope' });
      };
      window.document.execCommand = () => true;
    },
  });
  await new Promise((r) => setTimeout(r, 300));
  const doc = dom.window.document;
  assert.ok(q(doc, '.auth-card'), 'the login card should render');
  const pass = q(doc, 'input[type=password]');
  pass.value = 'wrong';
  const submit = qa(doc, '.auth-card button').find((b) => txt(b).includes('ورود'));
  assert.ok(submit, 'the sign-in button is missing');
  submit.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 300));
  const err = q(doc, '.auth-card .notice.danger');
  assert.ok(err, 'an error notice should appear');
  assert.ok(txt(err).includes('Too many attempts'), `the server message should surface, got "${txt(err)}"`);
  assert.equal(pass.value, '', 'the password field should be cleared after a failed attempt');
  assert.deepEqual(errors, [], 'login error handling threw');
});

test('the app never renders a raw translation key', async () => {
  // A missing key falls back to the key itself, which looks like a bug to users.
  const p = await loadPanel();
  for (const view of ['dash', 'users', 'configs', 'antidpi', 'relays', 'diag', 'settings']) {
    const link = qa(p.document, '.nav-item').find((a) => a.getAttribute('href') === '#' + view);
    link.dispatchEvent(new p.window.MouseEvent('click', { bubbles: true }));
    await p.settle(30);
    const body = txt(q(p.document, '.view'));
    assert.ok(!/\b(navMain|navTunnel|navSystem|quotaGb|expireDays|subCache|jsonStyle)\b/.test(body),
      `view "${view}" leaked a translation key: ${body.slice(0, 160)}`);
  }
});

test('every t() key the app uses exists in both locales', async () => {
  // This is the systematic guard for the bug class where `t(k) || k` can never
  // fall through, so a missing key renders verbatim in the UI. It caught a real
  // one: the dashboard labelled a row "fp" instead of the translated term.
  //
  // The table is parsed with acorn, not regex. A regex over the raw source also
  // matches `key:`-shaped text INSIDE translation values — the English string
  // "To scan it: raise your screen brightness" yields a phantom key "it" and a
  // false parity failure.
  const src = read('app.js.txt');
  const ast = acorn.parse(src, { ecmaVersion: 2023 });
  let table = null;
  const walk = (node) => {
    if (!node || typeof node.type !== 'string') return;
    if (node.type === 'VariableDeclarator' && node.id && node.id.name === 'T' && node.init) table = node.init;
    for (const k of Object.keys(node)) {
      if (k === 'type') continue;
      const v = node[k];
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v.type === 'string') walk(v);
    }
  };
  walk(ast);
  assert.ok(table && table.type === 'ObjectExpression', 'the T translation table was not found');

  const locales = {};
  for (const prop of table.properties) {
    const code = prop.key.name || prop.key.value;
    assert.equal(prop.value.type, 'ObjectExpression', `locale ${code} should be an object literal`);
    locales[code] = new Set(prop.value.properties.map((k) => k.key.name || k.key.value));
  }
  for (const code of ['fa', 'en']) {
    assert.ok(locales[code] && locales[code].size > 40,
      `locale ${code} looks incomplete (${locales[code] ? locales[code].size : 0} keys)`);
  }
  const used = new Set([...src.matchAll(/\bt\('([A-Za-z0-9_]+)'\)/g)].map((m) => m[1]));
  assert.ok(used.size > 40, `expected many translation keys, found ${used.size}`);
  const missing = {};
  for (const code of ['fa', 'en']) {
    missing[code] = [...used].filter((k) => !locales[code].has(k));
  }
  assert.deepEqual(missing.fa, [], 'keys used but absent from the Persian table');
  assert.deepEqual(missing.en, [], 'keys used but absent from the English table');

  const onlyFa = [...locales.fa].filter((k) => !locales.en.has(k));
  const onlyEn = [...locales.en].filter((k) => !locales.fa.has(k));
  assert.deepEqual(onlyFa, [], 'Persian keys with no English counterpart');
  assert.deepEqual(onlyEn, [], 'English keys with no Persian counterpart');
});

test('every icon name the app requests exists in the icon set', async () => {
  const icons = read('icons.js.txt');
  const defined = new Set([...icons.matchAll(/^\s{2}([a-zA-Z][A-Za-z0-9]*):/gm)].map((m) => m[1]));
  assert.ok(defined.size >= 20, `expected a full icon set, found ${defined.size}`);
  const used = new Set();
  for (const m of read('app.js.txt').matchAll(/icon\(?'([a-zA-Z0-9]+)'/g)) used.add(m[1]);
  for (const m of read('app.js.txt').matchAll(/icon:\s*'([a-zA-Z0-9]+)'/g)) used.add(m[1]);
  for (const m of read('app.js.txt').matchAll(/ICONS\.([a-zA-Z0-9]+)/g)) used.add(m[1]);
  assert.ok(used.size >= 10, `expected many icon references, found ${used.size}`);
  const missing = [...used].filter((n) => !defined.has(n));
  assert.deepEqual(missing, [], 'icons referenced by the app but not defined');
});

test('every NAV destination has a view implementation', async () => {
  const src = read('app.js.txt');
  const navIds = [...src.matchAll(/\{ id: '([a-z]+)', icon:/g)].map((m) => m[1]);
  assert.ok(navIds.length >= 6, `expected the nav list, found ${navIds.length}`);
  const views = new Set([...src.matchAll(/VIEWS\.([a-z]+)\s*=/g)].map((m) => m[1]));
  for (const id of navIds) {
    assert.ok(views.has(id), `nav item "${id}" has no VIEWS.${id} implementation`);
  }
});

test('every CSS class the app applies is defined in the stylesheet', async () => {
  // Unstyled markup is invisible in jsdom and easy to miss in review. This is the
  // same class of silent failure as an unreplaced marker: the page renders, but
  // a piece of it has no visual treatment at all.
  const app = read('app.js.txt');
  const css = read('styles.css.txt');
  const used = new Set();
  for (const m of app.matchAll(/class:\s*'([^']+)'/g)) m[1].split(/\s+/).forEach((c) => c && used.add(c));
  for (const m of app.matchAll(/classList\.(?:add|remove|toggle)\('([^']+)'/g)) used.add(m[1]);
  const defined = new Set([...css.matchAll(/\.(-?[A-Za-z_][A-Za-z0-9_-]*)/g)].map((m) => m[1]));
  assert.ok(used.size > 40, `expected many class references, found ${used.size}`);
  const missing = [...used].filter((c) => !defined.has(c)).sort();
  assert.deepEqual(missing, [], 'classes applied by the app with no CSS rule');
});

test('the stylesheet defines no selector the app never uses', async () => {
  // Not a failure on its own, but dead CSS ships in every single page load and
  // this panel is deliberately one inlined document. Keep the list short.
  const app = read('app.js.txt');
  const css = read('styles.css.txt');
  const used = new Set();
  for (const m of app.matchAll(/class:\s*'([^']+)'/g)) m[1].split(/\s+/).forEach((c) => c && used.add(c));
  for (const m of app.matchAll(/classList\.(?:add|remove|toggle)\('([^']+)'/g)) used.add(m[1]);
  const defined = new Set([...css.matchAll(/\.(-?[A-Za-z_][A-Za-z0-9_-]*)/g)].map((m) => m[1]));
  const unused = [...defined].filter((c) => !used.has(c));
  assert.ok(unused.length <= 18,
    `${unused.length} stylesheet classes are never applied: ${unused.join(', ')}`);
});
