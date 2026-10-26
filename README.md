# Luncher

A **VLESS** and **Trojan** proxy panel that runs entirely on Cloudflare Workers, with anti-filtering presets built for Iranian networks and first-class **PattNG** support.

An original MIT-licensed build, not a fork of any existing panel.

[فارسی](README.fa.md)

## Deploy in one click

[![Deploy to Workers](assets/deploy-button.svg)](https://deploy.workers.cloudflare.com/?url=https://github.com/amingangmanatgh2-hash/Luncher)

Click it, pick a panel password, done. No server, no credit card, no configuration.

By hand instead:

```
npm install
npx wrangler deploy
```

Your panel lands at `https://<worker>.workers.dev/panel`.

> **No database required.** The Worker detects what is bound at runtime: D1 gives
> the full multi-user panel with quotas and history, KV gives the same without SQL
> reporting, and neither gives "solo mode" with one admin and one user. The Deploy
> button therefore works before you have created anything, because `wrangler.toml`
> deliberately ships D1 and KV commented out.

## What you get

**Nine anti-filtering presets**, seven of them for Iranian ISPs — MCI (Hamrah-e Aval), Irancell, Rightel, TCI, gaming, max-stealth, and PattNG classic. Each carries the real `finalMask` and `cipherSuites` values that PattN/PattNG understand, plus a satellite preset tuned for Starlink.

**Clients:** PattNG (first class — `fp=unsafe` + `fm` + `cs`), v2rayNG, Hiddify, Streisand, NekoBox.

**Automatic client detection.** The panel reads the `User-Agent` on subscription requests and puts the matching dialect first, so you never have to pass `?client=` by hand. An explicit `?client=` still wins, and the detection is reported back in an `x-luncher-client` header so it is debuggable rather than magic.

**Subscriptions** at `/sub/<token>`: raw newline-separated links, `?b64=1` for base64, and `/sub/<token>/json` for a complete Xray config.

**Net Melli mode** keeps domestic traffic on the direct path instead of the tunnel, with domestic DNS for `.ir` domains.

**Relays for sanctioned destinations.** Gemini and Google AI Studio refuse by *source IP*, not by SNI. Fragmentation cannot help an application-layer geo-refusal — only a clean exit IP can. The panel says so and asks for a relay rather than pretending a preset fixes it.

**UI** — fully bilingual (fa/en with automatic RTL), and the entire panel ships as **one inlined HTML document**: no framework, no CDN, no external fonts. One Worker request instead of a dozen, which is the single biggest lever against the free tier's daily budget.

## What this project does not claim

**Net Melli cannot work through Cloudflare.** When Iran cuts the international link, the Cloudflare edge is unreachable from inside the country, and no Worker code changes that. What does work is client-side split routing (domestic traffic stays direct), which the generated configs already do, plus honest detection on the device itself.

**Error 1101 means the Worker threw a JS exception** — a bug, not "Cloudflare blocked you". Every request is wrapped in a guard that renders a comprehensible error page instead.

**Speed is bounded** by Worker CPU, subrequest limits, and your ISP.

## Companion apps

| Platform | File | Guide |
|---|---|---|
| Windows | `Luncher-Setup-1.0.0.exe` | [docs/windows.md](docs/windows.md) |
| Android | `luncher-companion.apk` | [docs/android.md](docs/android.md) |

Get them from [Releases](https://deploy.workers.cloudflare.com/?url=https://github.com/amingangmanatgh2-hash/Luncher/releases). Both are **config managers and Net Melli diagnosticians, not tunnels** — they store your links and hand them to whichever client you already run.

🎮 **Built-in game:** the Android APK includes **NEON RUSH**, a fully offline 3D neon racer/shooter with its own launcher icon, and the Windows workflow also builds it as a standalone **`setup.exe`**. See [docs/neon-rush.md](docs/neon-rush.md) for downloads and controls.

The Net Melli check is the part nothing here can do server-side: it probes domestic and international endpoints in parallel, and *domestic reachable plus international unreachable* is the signature of the international link being cut, not of a broken config. A Worker outside the country only ever sees its own view of the internet.

> The Windows binary is **unsigned**, so SmartScreen warns on first run: **More info → Run anyway**. Verify the hash instead — that is the check that actually means something.

## Tests

```
npm test          # 70 unit tests
npm run test:dpi  # SNI-censorship sandbox (offline, on loopback)
npm run test:e2e  # end-to-end sandbox against the real workerd runtime
```

The DPI sandbox deliberately reports failures, not just passes. Against a **first-packet** inspector every fragmenting preset gets through. Against a **streaming** inspector that reassembles within a 40 ms window, only presets with real inter-fragment *delay* survive — `mci` and `irancell` do not, because their delay is ~0. Splitting a handshake only defeats an inspector that looks at one segment.

## Bugs the tests caught

Worth knowing, because each one was silent — the build passed and the panel looked fine:

- **Trojan was entirely dead code.** `buildLinks` read `user.trojanPass` while the stored record uses `trojan_pass`.
- **Every relayed connection died.** `session.js` called both `pipeTo()` and `.write()` on `tun.writable`, but the relay paths returned a locked *writer* while the direct path returned a *stream*. That was the Gemini-unlock path.
- **The panel rendered completely unstyled.** esbuild claims `.css` for its own loader *before* wrangler's Text rules apply, so the stylesheet imported as an object and the page shipped `<style>[object Object]</style>` with no build error. Assets now use `.txt`.
- **The QR button failed for every PattNG link** — a hardcoded 900-character cap, while real PattNG links are 918+ characters and the true byte-mode ceiling is 2953.

## License

MIT — see [LICENSE](LICENSE).
