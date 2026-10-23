import { isIpv6 } from '../lib/bytes.js';
/**
 * Share-link and full Xray-JSON generation.
 *
 * One user + one endpoint description produces every client dialect we support:
 *
 *   pattng   -> cs + fm (finalMask JSON) + fp=unsafe     [PattN / PattNG / patched v2rayN]
 *   v2rayng  -> fragment=<len>,<int>,<packets> + fp      [v2rayNG / NekoBox / v2rayN]
 *   hiddify  -> fragment=<len>,<int>,hellotls            [Hiddify uses a different keyword]
 *   streisand-> same as v2rayng                          [Streisand / Happ / V2Box]
 *   plain    -> no fragmentation                         [unfiltered networks]
 *   json     -> a complete Xray config object, in two fragment styles
 *
 * Unknown query parameters are ignored by every mainstream client, so emitting
 * cs/fm/fp on all of them is safe and means one subscription works everywhere.
 */

import { FRAGMENT_PRESETS, CIPHER_SUITES, DEFAULT_PRESET, SANCTIONED_DOMAINS, IRAN_DIRECT_DOMAINS, IRAN_DIRECT_IPS, IRAN_DNS_SERVERS } from './presets.js';

const e = encodeURIComponent;

export const CLIENTS = ['pattng', 'v2rayng', 'hiddify', 'streisand', 'plain'];

function preset(name) {
  return FRAGMENT_PRESETS[name] || FRAGMENT_PRESETS[DEFAULT_PRESET];
}

/** `fragment=length,interval,packets` — the dialect most clients speak. */
export function legacyFragmentParam(p, keyword = 'tlshello') {
  if (!p || !p.legacy) return null;
  const pk = p.legacy.packets === 'tlshello' ? keyword : p.legacy.packets;
  return `${p.legacy.length},${p.legacy.interval},${pk}`;
}

/** The finalMask JSON as a raw string — `buildQuery` encodes it once. */
export function finalMaskParam(p) {
  if (!p || !p.mask) return null;
  return JSON.stringify(p.mask);
}

/**
 * Percent-encode each value exactly once. `encodeURIComponent` is the right
 * tool: it leaves `-._~` and alphanumerics alone and escapes `,` `/` `:` `{`
 * `"` `?` `=` `&`, which is precisely what real PattNG/v2rayNG links contain.
 */
export function buildQuery(params) {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${e(k)}=${e(String(v))}`)
    .join('&');
}

/**
 * @param {object} o
 * @param {object} o.user      { name, uuid, trojan_pass } (also accepts trojanPass)
 * @param {object} o.endpoint  { address, port, host, sni, tls, ipv6 }
 * @param {object} o.settings  { path, preset, cs, fp, decoy, sniMode, earlyData, client, allowInsecure }
 */
export function buildLinks(o) {
  const { user, endpoint, settings } = o;
  const p = preset(settings.preset);
  const client = settings.client || 'pattng';

  const wsHost = endpoint.host;                       // real Worker hostname (Host header)
  const address = endpoint.address || wsHost;         // what we dial: hostname or clean IP
  const port = Number(endpoint.port || 443);
  const tls = endpoint.tls !== false;
  const ed = settings.earlyData ?? 2048;
  const rawPath = settings.path || '/luncher';
  const path = `${rawPath.startsWith('/') ? rawPath : '/' + rawPath}${ed ? `?ed=${ed}` : ''}`;

  // In decoy mode the ClientHello advertises an innocent SNI while the HTTP
  // Host header still routes to this Worker. Only useful with a clean CF IP.
  const sni = settings.sniMode === 'decoy' && settings.decoy ? settings.decoy : (endpoint.sni || wsHost);

  const base = {
    type: 'ws',
    host: wsHost,
    path,
    security: tls ? 'tls' : 'none',
    alpn: tls ? 'h2,http/1.1' : undefined,
    fp: settings.fp || 'unsafe',
    allowInsecure: settings.allowInsecure ? '1' : undefined,
  };

  // Values are stored RAW here and percent-encoded exactly once by buildQuery.
  // Double-encoding is the classic way a subscription silently breaks: the `cs`
  // list collapses from 13 suites to one opaque string, and `fm` fails to parse,
  // so the client quietly drops fragmentation instead of erroring.
  const extra = {};
  if (client === 'pattng') {
    const fm = finalMaskParam(p);
    const cs = CIPHER_SUITES[settings.cs || 'standard'];
    if (fm) extra.fm = fm;
    if (cs) extra.cs = cs;
    extra.fp = 'unsafe';
  } else if (client === 'hiddify') {
    const f = legacyFragmentParam(p, 'hellotls');
    if (f) extra.fragment = f;
  } else if (client === 'v2rayng' || client === 'streisand') {
    const f = legacyFragmentParam(p);
    if (f) extra.fragment = f;
  }
  if (settings.allowInsecure) extra.insecure = '1';

  const qs = buildQuery({ ...base, ...extra });

  const remark = sanitizeRemark(`${settings.profileTitle ? settings.profileTitle + '-' : ''}${user.name}`);
  // Bracket ONLY genuine IPv6 literals. Testing for ':' alone is wrong twice
  // over: a host that still carries a port (e.g. "127.0.0.1:8787" from a local
  // request URL) gets bracketed into an unparseable "[127.0.0.1:8787]:443", and
  // the resulting link silently fails in every client.
  const addrLiteral = isIpv6(address) ? `[${address}]` : address;

  const links = [];
  if (user.uuid) {
    links.push({
      protocol: 'vless',
      client,
      preset: settings.preset,
      sniMode: settings.sniMode || 'real',
      remark: `${remark} ⟡ VLESS`,
      link: `vless://${user.uuid}@${addrLiteral}:${port}?${buildQuery({ ...base, encryption: 'none', ...extra })}#${e(`${remark} ⟡ VLESS`)}`,
    });
  }
  // The stored user record uses `trojan_pass` (snake_case, matching the D1/KV
  // schema and `newUser()`'s output), while `newUser()`'s *input* argument and
  // some callers use `trojanPass`. Reading only the camelCase form meant the
  // condition was never true for a real stored user, so no Trojan link was ever
  // emitted: the whole protocol was dead code even though the panel advertised
  // it. Accept both, preferring the stored shape.
  const trojanPass = user.trojan_pass || user.trojanPass || '';
  if (trojanPass) {
    links.push({
      protocol: 'trojan',
      client,
      preset: settings.preset,
      sniMode: settings.sniMode || 'real',
      remark: `${remark} ⟡ Trojan`,
      link: `trojan://${e(trojanPass)}@${addrLiteral}:${port}?${qs}#${e(`${remark} ⟡ Trojan`)}`,
    });
  }
  return links;
}

/**
 * Every endpoint x client x protocol combination, so a subscription hands the
 * user a working option for whatever network they are currently on.
 *
 * `max` caps the total: a 500-line subscription wastes Cloudflare requests and
 * overwhelms the client. 12 is enough to cover 3 endpoints x 2 protocols x 2 modes.
 */
export function buildAll({ user, endpoints, settings, max = 12 }) {
  const out = [];
  const clients = settings.clients || ['pattng', 'v2rayng'];
  for (const ep of endpoints || []) {
    for (const c of clients) {
      for (const l of buildLinks({ user, endpoint: ep, settings: { ...settings, client: c } })) {
        l.endpoint = ep.label || ep.address || ep.host;
        out.push(l);
        if (out.length >= max) return out;
      }
    }
  }
  return out;
}

/** A complete Xray config object. `style: 'finalmask' | 'outbound'`. */
export function buildXrayJson({ user, endpoint, settings, style = 'finalmask', blockAds = true, unlockSanctioned = true }) {
  const p = preset(settings.preset);
  const ed = settings.earlyData ?? 2048;
  const rawPath = settings.path || '/luncher';
  const path = `${rawPath.startsWith('/') ? rawPath : '/' + rawPath}${ed ? `?ed=${ed}` : ''}`;
  const wsHost = endpoint.host;
  const address = endpoint.address || wsHost;
  const port = Number(endpoint.port || 443);
  const sni = settings.sniMode === 'decoy' && settings.decoy ? settings.decoy : (endpoint.sni || wsHost);
  const fp = settings.fp || 'unsafe';
  const cipherSuites = CIPHER_SUITES[settings.cs || 'standard'];

  const tlsSettings = {
    serverName: sni,
    fingerprint: fp,
    alpn: ['h2', 'http/1.1'],
    allowInsecure: !!settings.allowInsecure,
  };
  if (cipherSuites) tlsSettings.cipherSuites = cipherSuites;

  const streamSettings = {
    network: 'ws',
    security: endpoint.tls === false ? 'none' : 'tls',
    wsSettings: { path, headers: { Host: wsHost }, maxEarlyData: ed, earlyDataHeaderName: '' },
    // A preset may override socket tuning. `satellite` shortens the keepalive
    // because a half-open flow is common on a jittery LEO link and 100 s is a
    // very long stall to wait through before noticing.
    sockopt: p.sockopt || { tcpNoDelay: true, tcpFastOpen: true, tcpKeepAliveIdle: 100 },
  };
  if (streamSettings.security === 'tls') streamSettings.tlsSettings = tlsSettings;

  const proxyOutbound = {
    tag: 'proxy',
    protocol: 'vless',
    settings: {
      vnext: [{ address, port, users: [{ id: user.uuid, encryption: 'none', level: 8 }] }],
      decryption: 'none',
    },
    streamSettings,
    mux: { enabled: false, concurrency: 8 },
  };

  const outbounds = [];

  if (style === 'finalmask' && p.mask) {
    // New Xray: masking lives on the outbound's own stream settings.
    proxyOutbound.streamSettings.finalmask = p.mask;
    outbounds.push(proxyOutbound);
  } else if (p.legacy) {
    // Classic Xray/v2rayNG: a chained `freedom` outbound does the splitting and
    // dials through `proxy` via dialerProxy.
    proxyOutbound.streamSettings.sockopt = { ...proxyOutbound.streamSettings.sockopt, dialerProxy: 'fragment' };
    outbounds.push({
      tag: 'fragment',
      protocol: 'freedom',
      settings: { fragment: p.legacy, ...(p.mask && p.mask.udp ? { noises: p.mask.udp[0].settings.noise } : {}) },
      streamSettings: { network: 'tcp', sockopt: { tcpNoDelay: true, tcpFastOpen: true } },
    }, proxyOutbound);
  } else {
    outbounds.push(proxyOutbound);
  }

  outbounds.push(
    { tag: 'block', protocol: 'blackhole', settings: { response: { type: 'http' } } },
    { tag: 'direct', protocol: 'freedom', settings: { domainStrategy: 'UseIP' } },
  );

  const rules = [];
  if (blockAds) rules.push({ type: 'field', outboundTag: 'block', domain: ['geosite:category-ads-all'] });
  rules.push({ type: 'field', outboundTag: 'direct', domain: IRAN_DIRECT_DOMAINS, ip: IRAN_DIRECT_IPS });
  rules.push({ type: 'field', outboundTag: 'direct', ip: ['127.0.0.1/32', '10.0.0.0/8', '192.168.0.0/16', '172.16.0.0/12'] });
  if (unlockSanctioned) {
    rules.push({ type: 'field', outboundTag: style === 'finalmask' && p.mask ? 'proxy' : 'fragment',
      domain: SANCTIONED_DOMAINS.map((d) => `full:${d}`) });
  }
  rules.push({ type: 'field', outboundTag: style === 'finalmask' && p.mask ? 'proxy' : (p.legacy ? 'fragment' : 'proxy'),
    network: 'tcp,udp' });

  return {
    log: { loglevel: 'warning' },
    dns: {
      servers: [
        // Net-melli mode puts a domestic resolver ahead of everything else for
        // .ir names. skipFallback stays false on purpose: if that resolver is
        // unreachable, degrading to 1.1.1.1 keeps domestic sites working, whereas
        // skipping the fallback would fail .ir resolution entirely.
        ...(settings.netMelli
          ? [{ address: settings.netMelliDns || IRAN_DNS_SERVERS[0], port: 443,
               domains: ['geosite:ir', 'regexp:.*\\.ir$'],
               expectIPs: ['geoip:ir'], skipFallback: false }]
          : []),
        { address: 'https://1.1.1.1/dns', port: 443, domains: ['geosite:ir'], skipFallback: false },
        { address: '1.1.1.1', port: 53 },
        { address: '8.8.8.8', port: 53 },
        'localhost',
      ],
      queryStrategy: 'UseIPv4',
    },
    inbounds: [
      { port: 10808, protocol: 'socks', tag: 'socks-in',
        settings: { auth: 'noauth', udp: true, userLevel: 8 },
        sniffing: { enabled: true, destOverride: ['http', 'tls'] } },
      { port: 10809, protocol: 'http', tag: 'http-in', settings: { userLevel: 8 } },
    ],
    outbounds,
    routing: { domainStrategy: 'IPIfNonMatch', rules },
    policy: {
      levels: { 8: { connIdle: 300, downlinkOnly: 1, handshake: 4, uplinkOnly: 1 } },
      system: { statsOutboundUplink: true, statsOutboundDownlink: true },
    },
  };
}

export function buildSubscription({ links, profileTitle, supportUrl, json }) {
  const lines = links.map((l) => l.link);
  if (json) lines.push(btoa(unescape(encodeURIComponent(JSON.stringify(json, null, 2)))));
  return lines.join('\n');
}

export function subscriptionHeaders({ profileTitle, supportUrl, updateIntervalHours = 12 }) {
  const title = profileTitle || 'Luncher';
  return {
    'content-type': 'text/plain; charset=utf-8',
    'content-disposition': `attachment; filename="${title.replace(/[^A-Za-z0-9._-]/g, '_')}.txt"`,
    'profile-title': btoa(unescape(encodeURIComponent(title))),
    'profile-update-interval': String(updateIntervalHours),
    ...(supportUrl ? { 'support-url': supportUrl } : {}),
    // Let Cloudflare edge-cache the subscription briefly. Every client refreshes
    // on a timer; caching collapses N clients into one Worker invocation and is
    // the single biggest lever against the free-tier request budget.
    'cache-control': 'public, max-age=120, s-maxage=120, stale-while-revalidate=600',
  };
}

export function sanitizeRemark(s) {
  return String(s || 'Luncher').replace(/[\r\n#&?%]/g, ' ').trim().slice(0, 64);
}
