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
  satellite: {
    label: 'Satellite (Starlink)', labelFa: 'ماهواره‌ای (استارلینک)',
    note: 'No fragmentation, deliberately. Starlink traffic does not traverse Iranian ISP infrastructure, so there is usually no SNI inspector in the path at all — and on a link with 25-60 ms RTT and heavy jitter, every inter-fragment delay costs a round trip. This preset trades stealth for throughput and keeps a shorter keepalive so a stalled flow is detected sooner. It is also the one case where an international cutoff does not matter, because the satellite link is not the Iranian link.',
    legacy: null, mask: null,
    // Preset-level socket tuning. Shorter keepalive idle than the default 100 s:
    // on a jittery LEO link a half-open connection is common and waiting 100 s to
    // notice is a very long stall for the user.
    sockopt: { tcpNoDelay: true, tcpFastOpen: true, tcpKeepAliveIdle: 30 },
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

/* ------------------------------------------------------------------ net melli */

/**
 * Domestic DNS for net-melli mode.
 *
 * Resolving a `.ir` name through a foreign resolver costs an international round
 * trip for a site that is hosted inside the country, and can return a CDN edge the
 * direct routing rule then has to match anyway. A domestic resolver returns
 * Iranian IPs straight away.
 *
 * HONEST CAVEAT: reachability of any specific domestic resolver varies by ISP and
 * changes over time, and it cannot be verified from a build environment outside
 * Iran. The default is a widely used Iranian DoH endpoint; `settings.netMelliDns`
 * overrides it, and `skipFallback` is left false so an unreachable resolver degrades
 * to the foreign servers instead of failing `.ir` outright.
 */
export const IRAN_DNS_SERVERS = [
  'https://dns.bitdns.ir/dns-query',
  'https://d00.dns.bitdns.ir/dns-query',
];

/* --------------------------------------------------------- client detection */

/**
 * User-Agent signatures, in the order they must be tested.
 *
 * Order is load-bearing: PattNG is a fork of v2rayNG, so its User-Agent can
 * contain "v2rayng" as well as its own name. Testing the specific signature first
 * is the only thing that keeps a PattNG user from being handed a plain v2rayNG
 * dialect and silently losing `fm`/`cs`.
 *
 * Only clients whose dialect we actually emit are listed. Everything else returns
 * null and falls back to the full configured set, which is the safe answer: a
 * wrong guess that serves one dialect is worse than no guess that serves all of
 * them. Deliberately absent for that reason are Clash, sing-box and Shadowrocket,
 * which do not consume `vless://` share links the same way and would only be
 * guessed at.
 */
export const CLIENT_UA_SIGNATURES = [
  { key: 'pattng', label: 'PattNG', patterns: ['pattng', 'patt-ng', 'patterniha'] },
  { key: 'hiddify', label: 'Hiddify', patterns: ['hiddify'] },
  { key: 'streisand', label: 'Streisand', patterns: ['streisand'] },
  // NekoBox / NekoRay and Windows v2rayN all speak the v2rayNG link dialect.
  { key: 'v2rayng', label: 'v2rayNG', patterns: ['v2rayng', 'v2ray-ng', 'v2rayn', 'nekobox', 'nekoray', 'sagernet'] },
];

/**
 * Map a User-Agent to the link dialect that client wants.
 * @returns {{key:string,label:string,source:string}|null} null when unknown
 */
export function detectClient(ua) {
  if (!ua) return null;
  const s = String(ua).toLowerCase();
  for (const sig of CLIENT_UA_SIGNATURES) {
    if (sig.patterns.some((pat) => s.includes(pat))) {
      return { key: sig.key, label: sig.label, source: 'user-agent' };
    }
  }
  return null;
}
