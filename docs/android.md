# Luncher Companion — Android

## What this app is

A **config manager and network diagnostician**. It stores your `vless://` and
`trojan://` links and subscription URLs, and hands them to whichever tunnel
client you already have installed — PattNG, v2rayNG, Hiddify, Streisand or NekoBox.

## What it is not

**It is not a VPN client.** It declares no `VpnService` and creates no tunnel.

That is a deliberate scope decision, not a shortcut. A real Android tunnel client
needs Xray core compiled as native libraries for every ABI, a `VpnService` TUN
stack, and correct handling of DNS, UDP, IPv6 and split routing. An app that
claims to tunnel but silently fails to route traffic is far worse than one that
honestly drives a maintained, audited client you already have — because the
failure looks like censorship rather than like a bug, and you will spend your time
blaming the wrong thing.

The manifest deliberately does **not** register `vless://` or `trojan://` intent
filters. Those belong to the tunnel clients. Claiming them would make Android
offer this app as a proxy when it cannot act as one.

It does register `luncher://` and `ACTION_SEND`, so you can share a link to it
from a browser or another app.

## Installing

Download `luncher-companion.apk` from the
[latest release](https://github.com/amingangmanatgh2-hash/Luncher/releases) and
allow installation from unknown sources when Android asks.

`luncher-companion-debug.apk` is the debug build — same app, debuggable, larger.
Use it only if you are attaching a debugger.

`luncher-companion.aab` is an Android App Bundle. It is **not installable on a
phone**; it is the format the Play Store ingests.

Verify your download against `SHA256SUMS-android.txt`:

```
sha256sum luncher-companion.apk
```

## Signing — read this before publishing anywhere

The release APK is signed with a **throwaway keystore generated in CI**. It
installs and runs normally, but:

- It can **never be updated through the Play Store**. Android identifies an app by
  its signing key, so a different signature means a different app. Users would
  have to uninstall and reinstall, losing their stored configs.
- It cannot be published to Play at all — Google requires a stable upload key.

To sign with your own key, add a real keystore as a repository secret and change
the `release` signing config in `app/build.gradle`:

```groovy
signingConfigs {
    release {
        storeFile     file(System.getenv("LUNCHER_KEYSTORE"))
        storePassword System.getenv("LUNCHER_STORE_PASSWORD")
        keyAlias      System.getenv("LUNCHER_KEY_ALIAS")
        keyPassword   System.getenv("LUNCHER_KEY_PASSWORD")
    }
}
```

Back the keystore up. **Losing it means losing the ability to ever update the
app**, and there is no recovery path — that is a property of Android, not of this
project.

## Net Melli detection

The **Check network** button probes domestic and international endpoints in
parallel, then reports the combination:

| domestic | international | verdict |
|---|---|---|
| reachable | reachable | normal |
| reachable | **unreachable** | **Net Melli** — the international link is cut |
| unreachable | unreachable | offline |
| mixed | mixed | partial / unstable |

The second row is the reason this code runs on the device. It distinguishes
*"your country is offline"* from *"your config is broken"*.

**No Cloudflare Worker can make this determination.** The Worker sits outside Iran
and only ever sees its own view of the internet; from its position the network
looks perfectly healthy. Only a probe running inside the country can tell the two
apart. The dialog shows per-endpoint timings and error types, not just a verdict,
so you can see the evidence rather than take it on faith.

The practical consequence matters: in the Net Melli state the Cloudflare edge
itself is unreachable from inside the country, so **no panel change can fix it**.
What keeps domestic sites working is client-side split routing — the generated
Xray configs already send `geosite:ir`, `geoip:ir` and RFC1918 ranges direct
instead of through the tunnel.

## Building it yourself

The project builds with GitHub Actions; no binaries are committed, and the Gradle
wrapper jar is generated in CI rather than stored in the repository.

To build locally you need the Android SDK (platform 34) and JDK 17:

```
cd app
gradle wrapper --gradle-version 8.7
./gradlew assembleDebug assembleRelease bundleRelease
```

Toolchain: AGP 8.5.2, Kotlin 1.9.24, Gradle 8.7, `compileSdk`/`targetSdk` 34,
`minSdk` 26. `minSdk` stays at 26 because below that Android requires a
density-specific PNG launcher icon, and this repository deliberately ships no
binary assets.

Dependencies are the AndroidX basics only — no Room, no Hilt, no Compose, no
OkHttp. JSON is `org.json` and HTTP is `HttpURLConnection`, both built in, so
there is nothing to supply-chain.
