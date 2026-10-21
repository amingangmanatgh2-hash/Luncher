/**
 * Anti-DPI and routing presets.
 *
 * These are the tunables that decide whether a config actually works on a given
 * Iranian network. Everything is data, so the panel UI can edit and persist it
 * without code changes.
 */

/**
 * Cloudflare's published IPv4/IPv6 ranges. The panel's clean-IP scanner only
 * ever generates addresses inside these, so it cannot produce junk.
 * Source: https://www.cloudflare.com/ips/
 */
export const CF_RANGES_V4 = [
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22',
  '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20',
  '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
  '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
];

export const CF_RANGES_V6 = [
  '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32',
  '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32',
];

/**
 * Seed addresses for the scanner. NOT guaranteed to be clean for you —
 * cleanliness is per-ISP and per-city and changes constantly. Scan your own.
 */
export const CF_SEED_IPS_V4 = [
  '188.114.96.3', '188.114.97.6', '104.19.229.21', '104.20.156.12',
  '172.67.139.114', '141.101.120.10', '108.162.193.10', '162.159.135.42',
  '198.41.205.100', '190.93.246.17', '103.21.244.10', '172.66.44.1',
];

export const CF_SEED_IPS_V6 = ['2606:4700::bc72:6106', '2a06:98c0:3600::103'];

/**
 * TLS cipher-suite lists sent as the `cs` share-link parameter.
 * Only PattN / PattNG / patched v2rayN understand `cs`; other clients ignore
 * unknown parameters, which makes it safe to always include.
 *
 * Reordering suites changes the ClientHello, so a DPI box fingerprinting
 * "Xray's default suite order" no longer matches.
 */
export const CIPHER_SUITES = {
  standard: [
    'TLS_AES_256_GCM_SHA384', 'TLS_CHACHA20_POLY1305_SHA256', 'TLS_AES_128_GCM_SHA256',
    'TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384', 'TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384',
    'TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256', 'TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256',
    'TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256', 'TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305_SHA256',
    'TLS_ECDHE_ECDSA_WITH_AES_256_CBC_SHA', 'TLS_ECDHE_RSA_WITH_AES_256_CBC_SHA',
    'TLS_ECDHE_ECDSA_WITH_AES_128_CBC_SHA256', 'TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA256',
  ].join(':'),
  // ChaCha20 first: on Iranian mobile networks (no AES-NI on many handsets and
  // heavy midbox throttling) ChaCha20 usually sustains a higher upload rate.
  chacha: [
    'TLS_CHACHA20_POLY1305_SHA256', 'TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256',
    'TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305_SHA256', 'TLS_AES_256_GCM_SHA384',
    'TLS_AES_128_GCM_SHA256', 'TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384',
    'TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384', 'TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256',
    'TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256',
  ].join(':'),
  minimal: ['TLS_AES_256_GCM_SHA384', 'TLS_CHACHA20_POLY1305_SHA256', 'TLS_AES_128_GCM_SHA256'].join(':'),
};

/** uTLS fingerprints accepted by the `fp` parameter. */
export const FINGERPRINTS = ['chrome', 'firefox', 'safari', 'ios', 'android', 'edge', '360', 'qq', 'random', 'randomized', 'unsafe'];

/**
 * Fragmentation presets.
 *
 * Two shapes are produced from one preset:
 *   legacy -> `fragment=<length>,<interval>,<packets>`  (v2rayNG, Streisand, Happ, NekoBox)
 *   mask   -> `fm=<urlencoded finalMask JSON>`          (PattN / PattNG / patched v2rayN)
 *
 * `packets: tlshello` splits the TLS ClientHello so a DPI box that only reads
 * the first TCP segment never sees the SNI. `packets: 1-3` splits the first
 * three TCP writes, which is what defeats *upload throttling* applied to
 * foreign IPs — the reason Irancell/Hamrah-e-Aval connections crawl.
 */
export const FRAGMENT_PRESETS = {
  none: {
    label: 'Off', labelFa: 'خاموش',
    note: 'No fragmentation. Use only when your network is not doing SNI inspection.',
    legacy: null, mask: null,
  },
  balanced: {
    label: 'Balanced', labelFa: 'متعادل',
    note: 'Safe default for most ISPs.',
    legacy: { length: '100-200', interval: '10-20', packets: 'tlshello' },
    mask: { tcp: [{ type: 'fragment', settings: { packets: 'tlshello', lengths: ['100-200'], delays: ['10-20'], maxSplit: '200' } }] },
  },
  mci: {
    label: 'Hamrah-e Aval (MCI)', labelFa: 'همراه اول',
    note: 'Mobile; moderate SNI filtering, occasional upload cap.',
    legacy: { length: '100-250', interval: '1-10', packets: 'tlshello' },
    mask: { tcp: [{ type: 'fragment', settings: { packets: 'tlshello', lengths: ['100-250'], delays: ['1-10'], maxSplit: '250' } }] },
  },
  irancell: {
    label: 'Irancell (MTN)', labelFa: 'ایرانسل',
    note: 'Mobile; the harshest upload throttling. Two-stage split is essential.',
    legacy: { length: '200-400', interval: '0-5', packets: '1-3' },
    mask: {
      tcp: [
        { type: 'fragment', settings: { packets: 'tlshello', lengths: ['100-250'], delays: ['0'], maxSplit: '200' } },
        { type: 'fragment', settings: { packets: '1-3', lengths: ['200-400'], delays: ['0'], maxSplit: '350' } },
      ],
    },
  },
  rightel: {
    label: 'Rightel', labelFa: 'رایتل',
    note: 'Mobile; lighter filtering, prefers small fragments.',
    legacy: { length: '50-120', interval: '5-15', packets: 'tlshello' },
    mask: { tcp: [{ type: 'fragment', settings: { packets: 'tlshello', lengths: ['50-120'], delays: ['5-15'], maxSplit: '120' } }] },
  },
  tci: {
    label: 'TCI / fixed line', labelFa: 'مخابرات / خط ثابت',
    note: 'ADSL/VDSL/fibre. Usually SNI-based only.',
    legacy: { length: '100-200', interval: '10-20', packets: 'tlshello' },
    mask: { tcp: [{ type: 'fragment', settings: { packets: 'tlshello', lengths: ['100-200'], delays: ['10-20'], maxSplit: '200' } }] },
  },
  gaming: {
    label: 'Gaming / low latency', labelFa: 'گیمینگ',
    note: 'Tiny fragments, near-zero delay. Keeps RTT low, weaker against DPI.',
    legacy: { length: '5-20', interval: '1-5', packets: '1-1' },
    mask: { tcp: [{ type: 'fragment', settings: { packets: '1-1', lengths: ['5-20'], delays: ['1-5'], maxSplit: '20' } }] },
  },
  maxStealth: {
    label: 'Maximum stealth', labelFa: 'حداکثر اختفا',
    note: 'Two-stage fragment + UDP noise. Slowest handshake, hardest to fingerprint.',
    legacy: { length: '20-60', interval: '20-60', packets: 'tlshello' },
    mask: {
      tcp: [
        { type: 'fragment', settings: { packets: 'tlshello', lengths: ['20-60', '60-120'], delays: ['20-60'], maxSplit: '120' } },
        { type: 'fragment', settings: { packets: '1-3', lengths: ['80-200'], delays: ['10-40'], maxSplit: '300' } },
      ],
      udp: [{ type: 'noise', settings: { reset: '30', noise: [{ rand: '300-500', delay: '0' }, { rand: '300-500', delay: '0' }] } }],
    },
  },
  pattngClassic: {
    label: 'PattNG classic', labelFa: 'پتنگ کلاسیک',
    note: 'The widely shared PattN/PattNG recipe. Note: a "0" length emits an empty TLS record, which some Xray builds reject — if it fails, use Irancell or Balanced.',
    legacy: { length: '0-104', interval: '0-1', packets: 'tlshello' },
    mask: {
      tcp: [
        { type: 'fragment', settings: { packets: 'tlshello', lengths: ['0', '104', '1'], delays: ['0'], maxSplit: '0' } },
        { type: 'fragment', settings: { packets: '1-1', lengths: ['114', '1'], delays: ['1'], maxSplit: '11' } },
      ],
    },
  },
};

export const DEFAULT_PRESET = 'balanced';

/**
 * Decoy SNIs for host/SNI masking. The client presents one of these in the
 * ClientHello while the HTTP Host header still points at your Worker, so
 * Cloudflare terminates TLS for the decoy and then routes to you.
 *
 * Requirements: the decoy must itself be behind Cloudflare and must not be
 * blocked in Iran. Verify before relying on one.
 */
export const DECOY_SNI = [
  'www.cloudflare.com', 'developers.cloudflare.com', 'www.hcaptcha.com',
  'blog.cloudflare.com', 'www.speedtest.net', 'nginx.com', 'www.digitalocean.com',
];

/**
 * Domains that refuse traffic from Iranian or datacenter source IPs at the
 * application layer. Fragmentation cannot help these — only a clean exit IP
 * can. The panel routes them through a relay when one is configured and flags
 * them in the UI otherwise.
 */
export const SANCTIONED_DOMAINS = [
  // Google AI
  'gemini.google.com', 'bard.google.com', 'aistudio.google.com', 'ai.google.dev',
  'notebooklm.google.com', 'deepmind.google', 'generativelanguage.googleapis.com',
  'alkalimakersuite-pa.clients6.google.com', 'aistudio-static.googleusercontent.com',
  // OpenAI
  'openai.com', 'chat.openai.com', 'chatgpt.com', 'api.openai.com', 'platform.openai.com',
  'auth.openai.com', 'ab.chatgpt.com', 'auth0.openai.com', 'openai.com.cdn.cloudflare.net',
  // Anthropic
  'anthropic.com', 'claude.ai', 'console.anthropic.com', 'api.anthropic.com',
  // Others
  'copilot.microsoft.com', 'sydney.bing.com', 'perplexity.ai', 'groq.com', 'grok.com',
  'x.ai', 'mistral.ai', 'cohere.com', 'together.ai', 'replicate.com', 'huggingface.co',
  'open.spotify.com', 'spotify.com', 'netflix.com', 'paypal.com', 'venmo.com',
  'adobe.com', 'accounts.adobe.com', 'notion.so', 'www.notion.so', 'medium.com',
  'twitch.tv', 'www.twitch.tv', 'discord.com', 'cdn.discordapp.com',
];

/**
 * True when `host` is (or is a subdomain of) a known sanctioned destination.
 * Suffix-matched so `api.openai.com`, `ab.chatgpt.com` etc. are all covered.
 */
const SANCTION_SET = new Set(SANCTIONED_DOMAINS);
export function isSanctioned(host) {
  if (!host) return false;
  const h = String(host).toLowerCase().replace(/\.$/, '');
  if (SANCTION_SET.has(h)) return true;
  let i = h.indexOf('.');
  while (i >= 0 && i < h.length - 1) {
    if (SANCTION_SET.has(h.slice(i + 1))) return true;
    i = h.indexOf('.', i + 1);
  }
  return false;
}

/** Iranian destinations that should stay direct so the tunnel is not wasted. */
export const IRAN_DIRECT_DOMAINS = [
  'geosite:ir', 'regexp:.*\\.ir$',
  'digikala.com', 'snapp.ir', 'divar.ir', 'aparat.com', 'filimo.com',
  'tapsi.ir', 'bale.ai', 'eitaa.com', 'soroush.plus', 'rubika.ir', 'shad.ir',
  'bankmellat.ir', 'bmi.ir', 'sb24.com', 'toplearn.com', 'faradars.org',
  'sanjesh.org', 'azmoon.org', 'iranecar.com', 'basalam.com', 'eghtesadnews.com',
];

export const IRAN_DIRECT_IPS = ['geoip:ir', '10.0.0.0/8', '192.168.0.0/16', '172.16.0.0/12', '127.0.0.1/32'];

/** Ports Cloudflare Workers is allowed to dial out on. */
export const WORKER_TCP_PORTS = [20, 21, 22, 80, 443, 8080, 8443, 2052, 2053, 2082, 2083, 2086, 2087, 2095, 2096];
