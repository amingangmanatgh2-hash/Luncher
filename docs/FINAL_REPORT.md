# DLCK LNCH — Final Report

**Project Status:** ✅ Complete — all 13 phases delivered (SETUP → CREDENTIAL CONFIG → CREDENTIAL TEST → PROJECT INIT → ANDROID PROJECT → UI → LAUNCHER → GEMINI AI → INTENT SYSTEM → SECURITY CHECK → TESTS → BUILD APK → FINAL REPORT).

**Setup Status:** ✅ Done — Kotlin 2.0.20 / AGP 8.5.2 / Gradle 8.7 / Jetpack Compose (BOM 2024.09.00) / Material 3, `minSdk 26` (Android 8.0), `compileSdk 34`, `targetSdk 34`, package `com.dlck.lnch`. Clean architecture: `ui/ launcher/ apps/ ai/ gemini/ settings/ data/ utils/`. Build verified end-to-end by GitHub Actions run `36740797864`.

**Gemini Credential Status:** ⚠️ Runtime-only by your instruction — **no API key was provided, requested, embedded or stored anywhere**. The end user enters their own key inside the app (`AI Setup`), and it is persisted in `EncryptedSharedPreferences` (AES-256-GCM, Android Keystore), excluded from cloud backup, never redisplayed, never logged, and sent only in the `x-goog-api-key` header. A live credential test could not be performed from the build environment (`generativelanguage.googleapis.com` is unreachable there); `scripts/verify_gemini.sh` is provided so you can test your own key locally — it never prints the key.

**Security Check:** ✅ Passed
- `scripts/secret_scan.sh` — clean (no `AIza…`, OAuth secret, api_key literal, bearer token, private key, AWS or Slack token; no credential files tracked). Runs locally and as the first CI step.
- CI step **"Verify no credential is baked into the APK"** greps both built APKs for `AIza[0-9A-Za-z_-]{30,}` → no match.
- `.gitignore` covers `.env`, `.env.*`, `local.properties`, `*.key`, `*.pem`, `*.jks`, `*.keystore`, `secrets.*`, `credentials.*`, `service-account*.json`.
- Intent layer: 7-item whitelist, validator clamping, confirmation for sensitive actions, 16-entry settings allowlist. **No shell execution, no `Runtime.exec`/`ProcessBuilder`, no reflection, no dynamic code loading.**
- Permissions minimised: `INTERNET`, `ACCESS_NETWORK_STATE`, `SET_WALLPAPER`, optional `PACKAGE_USAGE_STATS`; `<queries>` instead of `QUERY_ALL_PACKAGES`. HTTPS enforced, cleartext disabled.
- Widgets are bound through the system consent dialog (`ACTION_APPWIDGET_BIND`) — the privileged `BIND_APPWIDGET` permission is **not** requested. The notification listener is opt-in from system settings and keeps only per-package **counts** in memory. Backups deliberately exclude the API key.

**Build Status:** ✅ Success — all steps green: secret scan → 76 JVM unit tests → `assembleDebug` → `assembleRelease` → APK credential scan → artifact upload → release publish.

**APK Path:**
- Release page → <https://github.com/amingangmanatgh2-hash/Luncher/releases/tag/v1.0.0-build.11>
- Debug → <https://github.com/amingangmanatgh2-hash/Luncher/releases/download/v1.0.0-build.11/dlck-lnch-1.0.0-debug.apk>
- Release → <https://github.com/amingangmanatgh2-hash/Luncher/releases/download/v1.0.0-build.11/dlck-lnch-1.0.0-release.apk>
- Also as workflow artifact `dlck-lnch-apk` on run `36740797864`.
- Locally after `./gradlew assembleDebug` → `app/build/outputs/apk/debug/app-debug.apk`.

**APK Type:** both variants published — **debug** (debuggable, unshrunk) and **release** (R8 minified + resource-shrunk, zipaligned, signed with the CI **debug keystore** because no signing secret exists in this repository; it installs and runs normally but is not Play-Store ready until you sign it with your own key — see README §14).

**APK Size:** debug **18.86 MB** · release **2.54 MB**.

**Installation Instructions:**
1. Open the release page on the phone and download one APK (Android 8.0+).
2. Tap the downloaded file → allow "install from this source" when prompted → **Install**.
3. Open DLCK LNCH once from the app list.
4. Long-press empty space → **AI Setup** → paste your Gemini API key → **Save credential** → **Test connection** (expect a green *Connected*).
5. If an old build is present with a different signature, uninstall it first ("App not installed" error).

**Latest additions (run `36740797864`):**
- *On-device intelligence*: **smart suggestions** (hour-of-day prediction, no permission, no network), an **inline calculator** in search, an **A–Z / آ–ی fast-scroll rail**, real **app shortcuts** via `LauncherApps`, and a **hidden-apps manager**.
- *Full launcher parity*: **home-screen widgets** (real `AppWidgetHost` — pick, bind, configure, resize, remove, ids released), **folders** with preview tiles, **icon-pack support** (`appfilter.xml`), optional **notification dots**, **backup & restore** via the Storage Access Framework, and **user-assignable gestures**.
- Covered by 45 new unit tests across `Calculator`, `Suggester`, `AlphabetIndex`, `FolderOps`, `IconPackParser` and `BackupCodec`.

**Launcher Setup:** Android never switches launcher silently. Go to **Settings → Apps → Default apps → Home app → DLCK LNCH** (Samsung: Settings → Apps → ⋮ → Default apps → Home app; Xiaomi: Settings → Apps → Manage apps → ⋮ → Default apps → Launcher). Alternatively press Home and pick DLCK LNCH → **Always** in the chooser, or use the in-app shortcut **Settings → Set as default launcher**. Then: swipe **up** = App Drawer, swipe **down** = Search, **long-press icon** = app menu, **long-press empty space** = Wallpaper / Settings / AI Setup.

**Tutorial Location:**
- `README.md` — bilingual (فارسی + English), 20 sections.
- `docs/SETUP_TUTORIAL.md` — full step-by-step guide with diagrams, vendor-specific paths, error tables, bilingual.
- `docs/VIDEO_SCRIPT.md` — complete narration script + scene table.
- `proxy/README.md` — optional Cloudflare relay architecture and hardening checklist.
- Official Google docs are linked from README §5 and the in-app AI Setup screen.

**Video Tutorial:** `docs/video/dlck-lnch-setup-tutorial.mp4` — **3 min 01 s, 1280×720, 24 fps, H.264 + AAC, 4.8 MB, Persian narration**, 8 scenes covering key creation → secure storage → saving the key → connection test → installation & launcher selection → talking to the assistant → the visual polish.
**Honest labelling:** this is an **animated walkthrough** (motion graphics drawn programmatically by `docs/video/render_video.py`, narration produced with text-to-speech). It is **not** a screen recording of a physical device, and the phone frames inside it are stylised UI mock-ups, **not** real screenshots. No API key appears in it — the key is always rendered masked.

**Remaining Issues:**
1. The published release APK is signed with the **CI debug keystore**; sign it with your own key (four `RELEASE_*` env vars, README §14) before any store distribution.
2. **The APKs have not been run on physical hardware.** They are verified by CI only: compile of both variants, 76 unit tests, credential scan, packaging. On-device QA is still up to you.
3. **The Gemini key path was never exercised against the live API from here** — outbound access to `generativelanguage.googleapis.com` is blocked in the build environment. Use `scripts/verify_gemini.sh` and the in-app **Test connection** button to confirm.
4. No instrumented/UI tests (CI has no emulator); coverage is JVM unit tests only.
5. Not implemented by design/scope: a free-form drag-and-drop desktop grid and multiple home pages. (Widgets, folders, icon packs, notification dots and voice input **are** implemented.)
6. `androidx.security:security-crypto` is at `1.1.0-alpha06` — the only version exposing the `MasterKey.Builder` API. Watch for a stable release and bump when available.
