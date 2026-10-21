/**
 * wrangler.toml vs wrangler.local.toml drift guard.
 *
 * wrangler v3 has no config inheritance, so local development needs its own
 * file to bind a simulated KV namespace. Two hand-maintained copies of a build
 * configuration will drift, and the failure mode is nasty: `npm run dev` works,
 * `wrangler deploy` ships something different, and nobody notices until
 * production. These assertions make the two files' *deploy-critical* keys
 * provably identical while still allowing the one intended difference — the
 * storage bindings, which are commented out for the one-click Deploy button and
 * active for local dev.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/**
 * A deliberately small TOML reader: enough for wrangler configs, no dependency.
 * Handles comments, bare keys, quoted strings, integers, booleans, inline and
 * multi-line arrays, `[table]` and `[[array-of-tables]]`.
 */
function parseToml(text) {
  const root = {};
  let cur = root;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;

    const arrTable = line.match(/^\[\[([^\]]+)\]\]$/);
    if (arrTable) {
      const key = arrTable[1].trim();
      root[key] = root[key] || [];
      cur = {};
      root[key].push(cur);
      continue;
    }
    const table = line.match(/^\[([^\]]+)\]$/);
    if (table) {
      const key = table[1].trim();
      root[key] = root[key] || {};
      cur = root[key];
      continue;
    }

    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();

    // strip trailing comments that are not inside a string or array
    if (!val.startsWith('[') && !val.startsWith('"')) val = val.replace(/\s+#.*$/, '');

    // join multi-line arrays
    while (val.startsWith('[') && !isBalanced(val) && i + 1 < lines.length) {
      i++;
      val += ' ' + lines[i].trim();
    }
    cur[key] = parseValue(val);
  }
  return root;
}

function isBalanced(s) {
  let depth = 0; let inStr = false; let q = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (c === '\\') { i++; continue; } if (c === q) inStr = false; continue; }
    if (c === '"' || c === "'") { inStr = true; q = c; continue; }
    if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') { depth--; if (depth === 0) return true; }
  }
  return depth === 0;
}

function parseValue(v) {
  v = v.trim();
  if (v.startsWith('[')) {
    const inner = v.slice(1, v.lastIndexOf(']')).trim();
    if (!inner) return [];
    return splitTop(inner).map(parseValue);
  }
  if (v.startsWith('{')) {
    const inner = v.slice(1, v.lastIndexOf('}')).trim();
    const obj = {};
    for (const part of splitTop(inner)) {
      const eq = part.indexOf('=');
      if (eq < 0) continue;
      obj[part.slice(0, eq).trim()] = parseValue(part.slice(eq + 1).trim());
    }
    return obj;
  }
  if (/^".*"$/.test(v)) return v.slice(1, -1).replace(/\\"/g, '"');
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+$/.test(v)) return Number(v);
  return v;
}

/** Split on commas that are not nested inside brackets or strings. */
function splitTop(s) {
  const out = []; let depth = 0; let inStr = false; let q = ''; let cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      cur += c;
      if (c === '\\') { cur += s[++i] || ''; continue; }
      if (c === q) inStr = false;
      continue;
    }
    if (c === '"' || c === "'") { inStr = true; q = c; cur += c; continue; }
    if (c === '[' || c === '{') depth++;
    if (c === ']' || c === '}') depth--;
    if (c === ',' && depth === 0) { out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

const deploy = parseToml(readFileSync(new URL('../wrangler.toml', import.meta.url), 'utf8'));
const local = parseToml(readFileSync(new URL('../wrangler.local.toml', import.meta.url), 'utf8'));

test('the TOML reader handles the real config files', () => {
  assert.equal(deploy.main, 'src/worker.js');
  assert.equal(typeof deploy.compatibility_date, 'string');
  assert.deepEqual(deploy.compatibility_flags, ['nodejs_compat']);
  assert.equal(deploy.workers_dev, true);
  assert.equal(deploy.vars.PANEL_NAME, 'Luncher', 'nested [vars] table should parse');
  // The array-of-tables path still needs proving, since the local config uses it.
  assert.ok(Array.isArray(local.kv_namespaces), '[[kv_namespaces]] should parse as an array of tables');
  assert.equal(local.kv_namespaces[0].binding, 'KV');
});

test('entrypoint and runtime compatibility settings are identical', () => {
  assert.equal(local.main, deploy.main, '`main` must match or dev tests different code');
  assert.equal(local.compatibility_date, deploy.compatibility_date);
  assert.deepEqual(local.compatibility_flags, deploy.compatibility_flags);
  assert.equal(local.workers_dev, deploy.workers_dev);
  assert.equal(local.keep_vars, deploy.keep_vars);
});

test('neither config declares custom module rules', () => {
  // Every non-JS asset uses an extension wrangler treats as Text by default
  // (`**/*.txt`, `**/*.html`). Custom rules are therefore unnecessary, and
  // removing them also removes the `fallthrough` footgun: a rule without
  // `fallthrough = true` makes wrangler ignore its own defaults and the build
  // fails with "matched a module rule ... but was ignored".
  assert.equal(deploy.rules, undefined, 'wrangler.toml should need no rules');
  assert.equal(local.rules, undefined, 'wrangler.local.toml should need no rules');
});

test('every imported UI asset uses a default-Text extension', () => {
  // esbuild reserves `.js` and `.css` for its own loaders and applies them
  // BEFORE wrangler's module rules. Importing either as text silently yields an
  // object, so the served page contains `<style>[object Object]</style>` with no
  // build error. This is the guard on that failure mode.
  const worker = readFileSync(new URL('../src/worker.js', import.meta.url), 'utf8');
  const imports = [...worker.matchAll(/^import\s+\w+\s+from\s+'(\.\/ui\/[^']+)';$/gm)].map((m) => m[1]);
  assert.ok(imports.length >= 4, `expected the four UI assets to be imported, saw ${imports.length}`);
  for (const spec of imports) {
    assert.ok(/\.(txt|html)$/.test(spec),
      `${spec} must end in .txt or .html to load as Text; .js/.css are claimed by esbuild`);
  }
});

test('shared vars are identical', () => {
  assert.deepEqual(local.vars || {}, deploy.vars || {});
});

test('the deploy config leaves storage commented so the Deploy button works first-run', () => {
  // A placeholder id would make `wrangler deploy` fail outright for anyone using
  // the one-click button, so the bindings must be absent, not stubbed.
  assert.equal(deploy.d1_databases, undefined, 'D1 must stay commented in wrangler.toml');
  assert.equal(deploy.kv_namespaces, undefined, 'KV must stay commented in wrangler.toml');
});

test('the local config binds KV so dev exercises multi-user mode', () => {
  assert.ok(Array.isArray(local.kv_namespaces) && local.kv_namespaces.length === 1,
    'wrangler.local.toml should bind one simulated KV namespace');
  assert.equal(local.kv_namespaces[0].binding, 'KV');
});

test('worker name differs so a stray local deploy cannot hit production', () => {
  assert.notEqual(local.name, deploy.name,
    'local dev should use a distinct Worker name');
  assert.equal(deploy.name, 'luncher');
});

test('compatibility_date is one wrangler v3 actually supports', () => {
  // wrangler v3 ships a workerd whose newest supported date is 2025-07-18;
  // anything later logs a fallback warning on every single request.
  assert.ok(deploy.compatibility_date <= '2025-07-18',
    `${deploy.compatibility_date} is newer than wrangler v3 supports`);
});
