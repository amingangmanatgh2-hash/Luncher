/**
 * Panel assembly tests.
 *
 * The whole panel ships as ONE inlined HTML document: markup, stylesheet, icons
 * and application logic, with no external assets. That is deliberate — it is the
 * single biggest saving against Cloudflare's daily request budget, and it means
 * the panel still renders when CDNs and Google Fonts are unreachable or blocked.
 *
 * It also makes the assembly step load-bearing. These tests guard the failure
 * modes that produce a *silently* broken page:
 *
 *   - a marker left unreplaced, so the page ships literal `/*__LUNCHER_CSS__* /`
 *   - an asset that resolved to an object instead of a string, which renders as
 *     `<style>[object Object]</style>` and an empty <script> with no build error
 *   - a boot payload whose `panelName` contains `</script>`, escaping the inline
 *     block and injecting markup into every admin's browser
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../src/ui/${p}`, import.meta.url), 'utf8');

const HTML = read('index.html');
const CSS = read('styles.css.txt');
const ICONS = read('icons.js.txt');
const APP = read('app.js.txt');

/** Mirrors renderShell() in src/worker.js exactly. */
function renderShell(settings) {
  const boot = {
    panelName: settings.panelName || 'Luncher',
    language: settings.language || 'fa',
    version: settings.version || '1.0.0',
  };
  const bootJson = JSON.stringify(boot).replace(/</g, '\\u003c');
  return HTML
    .replace('/*__LUNCHER_CSS__*/', () => CSS)
    .replace('/*__LUNCHER_JS__*/', () => ICONS + '\n;\n' + APP)
    .replace('/*__LUNCHER_BOOT__*/', () => bootJson);
}

test('the shell declares all three replacement markers', () => {
  for (const m of ['/*__LUNCHER_CSS__*/', '/*__LUNCHER_JS__*/', '/*__LUNCHER_BOOT__*/']) {
    assert.ok(HTML.includes(m), `index.html is missing the marker ${m}`);
  }
  assert.ok(HTML.includes('id="root"'), 'the mount point must exist');
  assert.ok(HTML.includes('id="toasts"'), 'the toast host must exist');
});

test('every asset is a non-empty string, never an object', () => {
  for (const [name, v] of [['css', CSS], ['icons', ICONS], ['app', APP], ['html', HTML]]) {
    assert.equal(typeof v, 'string', `${name} must be a string`);
    assert.ok(v.length > 1000, `${name} looks truncated (${v.length} bytes)`);
    // Prose warning about the failure mode is fine; an actual stringified
    // object is not. Only flag the bracketed form JS itself would emit.
    assert.ok(!/\[object (Object|Array|Uint8Array)\]/.test(v.replace(/stringified form/g, 'x')),
      `${name} contains a stringified object`);
  }
});

test('the assembled document replaces every marker with real content', () => {
  const doc = renderShell({ panelName: 'Luncher', language: 'fa', version: '1.0.0' });
  for (const m of ['/*__LUNCHER_CSS__*/', '/*__LUNCHER_JS__*/', '/*__LUNCHER_BOOT__*/']) {
    assert.ok(!doc.includes(m), `${m} survived assembly`);
  }
  assert.ok(!doc.includes('[object Object]'), 'an asset resolved to an object');

  const style = doc.match(/<style>([\s\S]*?)<\/style>/);
  assert.ok(style, 'no <style> block');
  assert.ok(style[1].includes('--ember'), 'the design tokens did not inline');
  assert.ok(style[1].includes('prefers-reduced-motion'), 'the motion guard did not inline');
  assert.ok(style[1].length > 10000, `stylesheet looks truncated (${style[1].length} bytes)`);

  assert.ok(doc.includes('const ICONS'), 'the icon set did not inline');
  assert.ok(doc.includes('window.LUNCHER_BOOT'), 'the boot script did not inline');
  assert.ok(doc.includes('VIEWS.antidpi'), 'the application code did not inline');
});

test('the document is fully self-contained', () => {
  const doc = renderShell({});
  assert.deepEqual(doc.match(/(?:src|href)\s*=\s*"https?:\/\/[^"]+"/g) || [], [],
    'no absolute external references allowed');
  assert.deepEqual(doc.match(/(?:src|href)\s*=\s*"\/\/[^"]+"/g) || [], [],
    'no protocol-relative references allowed');
  assert.equal((doc.match(/<script[^>]+src=/g) || []).length, 0, 'no external scripts');
  assert.equal((doc.match(/<link[^>]+stylesheet/g) || []).length, 0, 'no external stylesheets');
  assert.equal((doc.match(/@import[^;]+;/g) || []).length, 0, 'no CSS @import');
  assert.equal((doc.match(/url\(\s*['"]?https?:/g) || []).length, 0, 'no remote url() in CSS');
  // The favicon is a data: URI, which is allowed and intentional.
  assert.ok(doc.includes('rel="icon" href="data:image/svg+xml'), 'favicon should stay inline');
});

test('a hostile panel name cannot escape the inline boot script', () => {
  const hostile = '</script><script>alert(1)</script>';
  const doc = renderShell({ panelName: hostile });
  // Exactly the scripts the shell declares: boot + app. One more means injection.
  const opens = (doc.match(/<script/g) || []).length;
  const closes = (doc.match(/<\/script>/g) || []).length;
  assert.equal(opens, 2, `expected 2 <script> tags, found ${opens} — the payload escaped`);
  assert.equal(opens, closes, 'unbalanced script tags');
  assert.ok(!doc.includes(hostile), 'the raw payload must not appear verbatim');
  // Only `<` needs escaping: breaking out of an inline script block requires the
  // literal `</script`, which is impossible once every `<` is gone. A bare `>`
  // cannot start a tag, so it is left alone.
  assert.ok(doc.includes('\\u003c/script>'), 'every `<` in the payload must become \\u003c');
  assert.ok(!doc.includes('\\u003c/script\\u003e'), 'sanity: `>` is not escaped');
});

test('the boot payload parses back to the same settings', () => {
  const doc = renderShell({ panelName: 'پنل من', language: 'en', version: '1.0.0' });
  const m = doc.match(/window\.LUNCHER_BOOT\s*=\s*([\s\S]*?);<\/script>/);
  assert.ok(m, 'boot assignment not found');
  const parsed = JSON.parse(m[1]);
  assert.equal(parsed.panelName, 'پنل من', 'non-ASCII panel names must survive');
  assert.equal(parsed.language, 'en');
  assert.equal(parsed.version, '1.0.0');
});

test('the icon set and app code are classic scripts, not ES modules', () => {
  // They are concatenated into one inline <script>. A stray `import`/`export`
  // would be a syntax error there, and inline module scripts need type="module",
  // which the shell does not declare.
  for (const [name, src] of [['icons', ICONS], ['app', APP]]) {
    assert.equal((src.match(/^\s*(import|export)\s/mg) || []).length, 0,
      `${name} must not use ES module syntax`);
  }
  // The `;` between them prevents an ASI hazard: the icon set ends with `};` and
  // the app begins with an IIFE, which would otherwise parse as a call on that
  // object literal. Assert the exact concatenation rather than a fuzzy pattern.
  const doc = renderShell({});
  assert.ok(doc.includes(ICONS + '\n;\n' + APP),
    'icons and app must be concatenated with a statement separator between them');
});

test('the assembled document is a complete HTML page', () => {
  const doc = renderShell({});
  assert.ok(doc.startsWith('<!doctype html>'), 'missing doctype');
  assert.ok(doc.trimEnd().endsWith('</html>'), 'document is not closed');
  assert.ok(doc.includes('lang="fa"') && doc.includes('dir="rtl"'), 'default RTL Persian');
  assert.ok(doc.includes('noindex,nofollow'), 'the panel must not be indexed');
  assert.ok(doc.includes('color-scheme'), 'dark scheme must be declared');
});

test('all referenced asset files exist on disk', () => {
  for (const f of ['index.html', 'styles.css.txt', 'app.js.txt', 'icons.js.txt']) {
    assert.ok(existsSync(new URL(`../src/ui/${f}`, import.meta.url)), `missing src/ui/${f}`);
  }
  // The `.js`/`.css` names must NOT come back: esbuild would claim them.
  for (const f of ['styles.css', 'app.js', 'icons.js']) {
    assert.ok(!existsSync(new URL(`../src/ui/${f}`, import.meta.url)),
      `src/ui/${f} exists — esbuild would load it as a module, not text`);
  }
});
