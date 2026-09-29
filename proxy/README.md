# Secure Gemini proxy (production architecture)

For development, DLCK LNCH keeps the Gemini key on the device inside
`EncryptedSharedPreferences`. That is safe for *your own* key on *your own* phone.

For a **production / published** build you should not ship a key that belongs to you at all —
even an encrypted on-device key can be extracted by the owner of the device. The supported
pattern is a thin proxy that holds the credential server-side:

```
DLCK LNCH  ──HTTPS──▶  your proxy  ──HTTPS + x-goog-api-key──▶  Gemini API
 (no key)              (holds key)
```

The app already supports this: in **Settings → AI Setup → API endpoint (advanced)** set the base
URL to your proxy and leave the key field empty. The app will then send requests **without** any
credential and your proxy adds it.

Your proxy only has to implement the two paths the app uses, preserving the request/response
bodies verbatim:

| Method | Path |
|---|---|
| `GET`  | `/v1beta/models` |
| `POST` | `/v1beta/models/{model}:generateContent` |
| `POST` | `/v1beta/models/{model}:streamGenerateContent?alt=sse` (SSE passthrough) |

## Cloudflare Worker (recommended — free tier, global, no servers)

`worker.js` in this folder is a complete implementation. Deploy it with
[Wrangler](https://developers.cloudflare.com/workers/wrangler/):

```bash
cd proxy
npm install -g wrangler
wrangler login
wrangler secret put GEMINI_API_KEY      # prompts; the value is stored encrypted by Cloudflare
wrangler deploy
```

Then put the resulting `https://<name>.<account>.workers.dev` URL into the app's
**API endpoint** field.

## Hardening checklist

The reference worker already does 1–4; the rest depend on your deployment.

1. **The key never reaches the client.** It lives only in the Worker secret store.
2. **Allow-list the paths.** Only the three routes above are proxied; everything else is 404.
3. **Cap the request size** so nobody can use your key to send huge prompts.
4. **Strip client-supplied auth headers** so a caller cannot smuggle their own credential.
5. **Add app authentication** — e.g. Firebase App Check, a signed JWT, or Play Integrity — so
   only your app can call the proxy. Without this, anyone who learns the URL can spend your quota.
6. **Rate-limit per client** (Cloudflare Rate Limiting rules or a Durable Object counter).
7. **Set a budget alert** on the Google Cloud project that owns the key.
8. **Rotate the key** on a schedule: create a new key in AI Studio, `wrangler secret put` it,
   then delete the old one.
