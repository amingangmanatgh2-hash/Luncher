/**
 * Panel configuration: defaults, load, validate, save.
 *
 * Stored as a single JSON document under the settings key `config`. One row
 * instead of twenty keeps D1 reads and writes to a minimum, which matters
 * because the free tier bills D1 by rows touched.
 */

import { DEFAULT_PRESET, FRAGMENT_PRESETS, CIPHER_SUITES, FINGERPRINTS, DECOY_SNI, CF_SEED_IPS_V4, CF_SEED_IPS_V6, IRAN_DNS_SERVERS } from './presets.js';
import { isIpv4 } from '../lib/bytes.js';

export const DEFAULTS = {
  panelName: 'Luncher',
  wsPath: '/luncher',
  earlyData: 2048,
  preset: DEFAULT_PRESET,
  cs: 'standard',
  fp: 'unsafe',
  sniMode: 'real',            // 'real' | 'decoy'
  decoy: DECOY_SNI[0],
  allowInsecure: false,
  profileTitle: 'Luncher',
  clients: ['pattng', 'v2rayng'],
  cleanIps: [],               // user-scanned IPv4 clean IPs
  cleanIp6: [],
  useWorkerHostAsAddress: true,
  // Optional custom domain for generated links (a Worker behind your own
  // hostname). Read by endpointsFor(), which puts it into BOTH the `host=`
  // parameter and the address, so an unvalidated value silently produces links
  // that look plausible and fail in every client.
  customHost: '',
  relays: [],                 // [{name,type:'socks5'|'http',host,port,username,password,tls,scope:'sanctioned'|'all'}]
  unlockSanctioned: true,
  blockAds: true,
  jsonStyle: 'finalmask',     // 'finalmask' (new Xray/PattNG) | 'outbound' (classic v2rayNG)
  // --- net melli ------------------------------------------------------------
  // Domestic traffic already goes direct in every generated config, because that
  // is simply correct routing. This flag adds the part that is not automatic: a
  // domestic resolver for .ir names, so a site hosted inside the country is not
  // resolved over an international round trip. It cannot make Cloudflare
  // reachable during an international cutoff, and nothing server-side can.
  netMelli: false,
  netMelliDns: IRAN_DNS_SERVERS[0],
  // --- client detection -----------------------------------------------------
  // Read the subscription's User-Agent and put the matching dialect first. Off
  // means always serve every configured dialect.
  autoDetectClient: true,
  subCacheSeconds: 120,
  maxLinksPerSub: 12,
  language: 'fa',
  decoyRedirect: 'https://www.cloudflare.com/',
};

const HEX32 = /^[a-f0-9]{32}$/i;

export function normalize(raw) {
  const s = { ...DEFAULTS, ...(raw && typeof raw === 'object' ? raw : {}) };

  if (typeof s.wsPath !== 'string' || !/^\/[A-Za-z0-9_\-\/]{0,64}$/.test(s.wsPath)) s.wsPath = DEFAULTS.wsPath;
  if (!Number.isInteger(s.earlyData) || s.earlyData < 0 || s.earlyData > 4096) s.earlyData = DEFAULTS.earlyData;
  if (!FRAGMENT_PRESETS[s.preset]) s.preset = DEFAULT_PRESET;
  if (!CIPHER_SUITES[s.cs]) s.cs = 'standard';
  if (!FINGERPRINTS.includes(s.fp)) s.fp = 'unsafe';
  if (s.sniMode !== 'real' && s.sniMode !== 'decoy') s.sniMode = 'real';
  if (!Array.isArray(s.clients) || s.clients.length === 0) s.clients = DEFAULTS.clients;
  if (!['finalmask', 'outbound'].includes(s.jsonStyle)) s.jsonStyle = 'finalmask';
  s.netMelli = s.netMelli === true;
  // Accept a DoH URL or a bare resolver IP; anything else falls back rather than
  // emitting a config the client would reject at load time.
  if (typeof s.netMelliDns !== 'string' ||
      !/^https:\/\/[A-Za-z0-9.\-\/]{4,120}$/.test(s.netMelliDns) &&
      !/^([0-9]{1,3}\.){3}[0-9]{1,3}$/.test(s.netMelliDns)) {
    s.netMelliDns = DEFAULTS.netMelliDns;
  }
  s.autoDetectClient = s.autoDetectClient !== false;
  // A bare hostname, optionally with a port (endpointsFor strips the port).
  // Rejecting anything else matters because this string is interpolated into a
  // share link: a stray "/", "@" or space changes how the client parses the URL.
  if (typeof s.customHost !== 'string') s.customHost = '';
  s.customHost = s.customHost.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  if (s.customHost && !/^[A-Za-z0-9]([A-Za-z0-9\-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9\-]*[A-Za-z0-9])?)*(:\d{1,5})?$/.test(s.customHost)) {
    s.customHost = '';
  }
  if (typeof s.subCacheSeconds !== 'number' || s.subCacheSeconds < 0 || s.subCacheSeconds > 3600) s.subCacheSeconds = 120;
  if (typeof s.maxLinksPerSub !== 'number' || s.maxLinksPerSub < 1 || s.maxLinksPerSub > 40) s.maxLinksPerSub = 12;

  // Clean IPs: keep only syntactically valid, non-private addresses. A typo here
  // silently produces dead configs, so dropping invalid entries loudly in the
  // UI (see validateReport) is better than storing them.
  s.cleanIps = (Array.isArray(s.cleanIps) ? s.cleanIps : []).map((x) => String(x).trim()).filter(isIpv4);
  s.cleanIp6 = (Array.isArray(s.cleanIp6) ? s.cleanIp6 : [])
    .map((x) => String(x).trim()).filter((x) => /^[0-9a-fA-F:]{2,45}$/.test(x) && x.includes(':'));

  s.relays = (Array.isArray(s.relays) ? s.relays : []).filter((r) => r && typeof r === 'object' && r.host)
    .map((r) => ({
      name: String(r.name || r.host).slice(0, 40),
      type: r.type === 'http' ? 'http' : 'socks5',
      host: String(r.host).slice(0, 253),
      port: Math.max(1, Math.min(65535, Number(r.port) || 1080)),
      username: r.username ? String(r.username).slice(0, 128) : '',
      password: r.password ? String(r.password).slice(0, 128) : '',
      tls: !!r.tls,
      // 'sanctioned' -> only used for geo-blocked destinations (default)
      // 'all'        -> every tunnel exits through this relay
      scope: r.scope === 'all' ? 'all' : 'sanctioned',
    }));

  return s;
}

/** Human-readable problems, surfaced in the panel instead of silently ignored. */
export function validateReport(s) {
  const out = [];
  if (s.sniMode === 'decoy' && !s.cleanIps.length && !s.cleanIp6.length) {
    out.push({ level: 'warn', key: 'decoy-needs-ip',
      text: 'Decoy SNI only works when the client dials a Cloudflare IP directly. Add at least one clean IP.' });
  }
  if (s.preset === 'pattngClassic') {
    out.push({ level: 'info', key: 'pattng-zero-length',
      text: 'The PattNG classic preset uses a "0" fragment length. Some Xray builds reject it as an empty TLS record — switch to Irancell or Balanced if it fails.' });
  }
  if (s.unlockSanctioned && !s.relays.length) {
    out.push({ level: 'warn', key: 'no-relay',
      text: 'Sanction-unlock routing is on but no relay is configured. Traffic will exit from Cloudflare, which Google AI and OpenAI sometimes reject as datacenter traffic. Add a relay for reliable access.' });
  }
  if (s.allowInsecure) {
    out.push({ level: 'warn', key: 'insecure',
      text: 'allowInsecure disables certificate validation and exposes you to MitM. Only use it with a self-hosted origin.' });
  }
  return out;
}

export async function loadSettings(store) {
  let raw = null;
  try {
    const txt = await store.getSetting('config');
    if (txt) raw = JSON.parse(txt);
  } catch { raw = null; }
  const s = normalize(raw);
  // Seed sample clean IPs on first run so a fresh panel is not empty-handed.
  if (!raw) { s.cleanIps = CF_SEED_IPS_V4.slice(0, 4); s.cleanIp6 = CF_SEED_IPS_V6.slice(0, 1); }
  return s;
}

export async function saveSettings(store, patch) {
  const current = await loadSettings(store);
  const next = normalize({ ...current, ...patch });
  await store.setSetting('config', JSON.stringify(next));
  return { settings: next, report: validateReport(next) };
}

export { HEX32 };
