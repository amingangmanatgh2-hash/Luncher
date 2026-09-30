<div align="center">

# DLCK LNCH

**An Android launcher with a built-in Gemini AI assistant**
**لانچر اندروید با دستیار هوش مصنوعی Gemini**

[![Build APK](https://github.com/amingangmanatgh2-hash/Luncher/actions/workflows/build-apk.yml/badge.svg?branch=arena/01a0ed54-luncher)](https://github.com/amingangmanatgh2-hash/Luncher/actions/workflows/build-apk.yml)
[![Release](https://img.shields.io/github/v/release/amingangmanatgh2-hash/Luncher?include_prereleases&label=APK)](https://github.com/amingangmanatgh2-hash/Luncher/releases/latest)

Kotlin · Jetpack Compose · Material 3 · minSdk 26 (Android 8.0) · Persian & English · full RTL

[Download](#4-download--install) · [Gemini key](#5-get-a-gemini-api-key) · [Video tutorial](#16-video-tutorial) · [Security](#11-security-model) · [Build](#14-build-from-source)

</div>

---

## Table of contents · فهرست

| # | English | فارسی |
|---|---|---|
| 1 | [Overview](#1-overview) | معرفی |
| 2 | [Features](#2-features) | امکانات |
| 3 | [Requirements](#3-requirements) | پیش‌نیازها |
| 4 | [Download & install](#4-download--install) | دانلود و نصب |
| 5 | [Get a Gemini API key](#5-get-a-gemini-api-key) | ساخت کلید Gemini |
| 6 | [AI Setup inside the app](#6-ai-setup-inside-the-app) | تنظیم کلید در برنامه |
| 7 | [Set as default launcher](#7-set-as-default-launcher) | انتخاب به‌عنوان لانچر پیش‌فرض |
| 8 | [Gestures & usage](#8-gestures--usage) | ژست‌ها و کار با برنامه |
| 9 | [The AI assistant & intent system](#9-the-ai-assistant--intent-system) | دستیار و سامانه اینتنت |
| 10 | [Settings reference](#10-settings-reference) | مرجع تنظیمات |
| 11 | [Security model](#11-security-model) | مدل امنیتی |
| 12 | [Permissions](#12-permissions) | مجوزها |
| 13 | [Architecture](#13-architecture) | معماری |
| 14 | [Build from source](#14-build-from-source) | ساخت از سورس |
| 15 | [Tests & CI](#15-tests--ci) | تست و CI |
| 16 | [Video tutorial](#16-video-tutorial) | آموزش ویدیویی |
| 17 | [Troubleshooting](#17-troubleshooting) | رفع اشکال |
| 18 | [Optional Gemini relay](#18-optional-gemini-relay-proxy) | پروکسی اختیاری |
| 19 | [Known limitations](#19-known-limitations) | محدودیت‌های شناخته‌شده |
| 20 | [License & credits](#20-license--credits) | مجوز و تشکر |

---

## 1. Overview

DLCK LNCH replaces your home screen. It gives you a clock, favourites, an app drawer with
categories and search, and — if you supply your own Gemini API key — a chat assistant that can
actually *do* things: open apps, jump to system settings, start timers, run a web search, or just
answer a question.

The assistant is deliberately **narrow**. It can only emit one of seven whitelisted intents, and
three of those require an explicit tap-to-confirm. There is **no shell execution, no reflection and
no dynamic code loading** anywhere in the code path between the model and the device.

Your API key is **never** in this repository, in the APK, in logs, or in any screenshot. You type it
into the app once and it is stored in `EncryptedSharedPreferences` (AES-256-GCM via the Android
Keystore) on your device only.

<div dir="rtl">

### ۱. معرفی

DLCK LNCH جایگزین صفحه اصلی گوشی شما می‌شود: ساعت، برنامه‌های محبوب، لیست کامل برنامه‌ها با
دسته‌بندی و جستجو، و — در صورت وارد کردن کلید Gemini خودتان — یک دستیار گفتگو که واقعاً کار انجام
می‌دهد: باز کردن برنامه، رفتن به تنظیمات سیستم، ساخت تایمر، جستجوی وب، یا پاسخ به سؤال.

دستیار عمداً **محدود** است: فقط هفت اینتنت مجاز را می‌تواند برگرداند و سه مورد از آن‌ها نیاز به
تأیید صریح کاربر دارند. در کل مسیر بین مدل و دستگاه، هیچ اجرای دستور شل، reflection یا بارگذاری کد
پویا وجود ندارد.

کلید شما هرگز در این مخزن، در فایل APK، در لاگ‌ها یا در تصاویر نیست. یک‌بار داخل برنامه واردش
می‌کنید و در `EncryptedSharedPreferences` با الگوریتم AES-256-GCM و Android Keystore، فقط روی
دستگاه خودتان ذخیره می‌شود.

</div>

---

## 2. Features

### Launcher
- **Home screen** — clock (12/24 h), Gregorian **or Jalali/Persian** date, quick search bar, favourites grid, recently used row.
- **App drawer** — every launchable activity, instant fuzzy search, category filter chips, **sort by Name A–Z / Z–A / Most used / Recently installed**, pinned apps always on top.
- **Favourites & pinning** — long-press any icon to pin it to the drawer top or add it to the home favourites grid.
- **Recently used** — driven by the launcher's own launch history (zero permissions); enriched with Android UsageStats *only* if you grant Usage Access.
- **Categories** — Games, Social, Productivity, Media, News, Maps, System, Other, derived from the app's declared category with a package-name fallback.
- **App menu** — Open · Pin/Unpin · Favourite · Hide · App info · Uninstall (a safe `ACTION_DELETE`; the system asks for confirmation — the launcher never force-removes anything).
- **Smart suggestions** — a "Suggested for now" row that predicts what you are about to open from *when* you normally open it (hour-of-day context 50%, recency 30%, frequency 20%). Computed on-device from the launcher's own history, no permission and no network; one switch turns it off.
- **Search screen** — searches installed apps, does **maths inline** (`12*7+3` → `87`, Persian digits and `٫` included, tap to copy) and offers to hand the same query to the AI assistant or to the web.
- **A–Z fast scroll** — a letter rail on the drawer edge (English *and* Persian آ–ی, with `#` for digits/symbols); tap or drag to jump, with haptic ticks.
- **App shortcuts** — long-press an icon to get the app's own shortcuts ("New message", "Scan QR"…) straight from the system `LauncherApps` API, available once DLCK LNCH is your default home app.
- **Hidden-apps manager** — Settings lists everything you hid and brings it back with one tap, so hiding is never a one-way door.
- **Home-screen widgets** — a real `AppWidgetHost`: pick any widget installed on the device, run its own configuration activity, resize it (long-press → height stepper) and remove it. Widget ids are released back to the system on removal, and dead providers are pruned automatically.
- **Folders** — group apps into named folders with a 2×2 preview tile on the home screen. Long-press → *Move to folder…*, rename or delete from the folder itself, and an app always lives in exactly one folder. Uninstalling an app cleans the folder up for you.
- **Icon packs** — pick any of the thousands of existing Android icon packs (ADW / Nova / Go / Apex format). DLCK LNCH reads the pack's `appfilter.xml` and resources; anything a pack does not theme falls back to the stock icon, so a partial pack still looks complete.
- **Notification dots** — optional unread counters on icons, powered by a notification listener you enable yourself in system settings.
- **Backup & restore** — export layout, favourites, pins, hidden apps, folders and usage stats to a JSON file through the system file picker, and restore it on another device. The Gemini key is **never** part of a backup.
- **Custom gestures** — swipe up, swipe down and double-tap can each be assigned to App drawer / Search / Assistant / Settings / Wallpaper / AI Setup / nothing.

### Interface
- **Living aurora background** — soft colour blobs drift slowly over your wallpaper (translucent, never hides it) and freeze instantly when animations are off.
- **Frosted-glass panels** with gradient rims for the search bar, drawer and chat surfaces.
- **Springy touch feedback** — icons compress under the finger, screens rise and settle with spring physics, long-press is confirmed by haptics.
- **Adaptive + themed launcher icon** — gradient "D" monogram with a real monochrome layer, so Android 13+ tints it with your wallpaper palette.
- **Material 3** with dynamic colour on Android 12+, plus six accent presets (Cyan, Violet, Emerald, Amber, Rose, Blue).
- **Dark / Light / follow-system** themes.
- **Full Persian RTL** — every screen mirrors correctly, and a per-app language override (System / English / فارسی) that does not require changing the device language.
- **Animations** that can be turned off entirely in one switch (also respected by the screen transitions).

### AI
- Chat with **streaming responses** (SSE), typing indicator, retry, copy, and clear-chat.
- **Voice input** — dictate instead of typing. Handled by the *system* recogniser, so the launcher needs **no `RECORD_AUDIO` permission** and never touches the microphone; the transcript lands in the field so you can edit it before sending. The button hides itself when no recogniser is installed.
- **Markdown-aware replies** — `**bold**`, `` `code` `` and `- ` bullets render properly instead of showing raw markers.
- **Offline fast path** — a local, deterministic matcher handles "open X" / "search X" without ever calling the network.
- **Structured output** — the model answers with a JSON schema, so an intent is either valid or clamped to a plain chat reply.
- Explicit **confirmation cards** for sensitive actions.
- Clear error states for invalid key, permission, quota, model, timeout, offline and safety blocks.

<div dir="rtl">

### ۲. امکانات

**لانچر:** صفحه اصلی با ساعت (۱۲ یا ۲۴ ساعته) و تاریخ میلادی یا **شمسی**، نوار جستجو، شبکه
برنامه‌های محبوب و ردیف «اخیراً استفاده‌شده» · لیست کامل برنامه‌ها با جستجوی فازی، فیلتر دسته‌بندی و
**مرتب‌سازی بر اساس نام (صعودی/نزولی)، پرکاربردترین و تازه‌نصب‌شده** · سنجاق کردن و افزودن به
محبوب‌ها · منوی هر برنامه شامل باز کردن، سنجاق، محبوب، مخفی‌سازی، اطلاعات برنامه و حذف امن.

**هوشمندی روی گوشی:** ردیف **«پیشنهاد برای این ساعت»** که بر پایهٔ ساعتِ استفادهٔ خودتان (۵۰٪ زمینهٔ
زمانی، ۳۰٪ تازگی، ۲۰٪ تعداد) پیش‌بینی می‌کند چه می‌خواهید باز کنید — کاملاً محلی، بدون مجوز و بدون
اینترنت · **ماشین‌حساب داخل جستجو** (`۱۲×۷+۳`) با ارقام فارسی و کپی با یک لمس · **نوار حروف الفبا**
کنار لیست برنامه‌ها برای پرش سریع (آ تا ی و A تا Z) · **میان‌برهای برنامه‌ها** با نگه‌داشتن آیکن ·
**مدیریت برنامه‌های پنهان** در تنظیمات برای بازگرداندن آن‌ها.

**لانچر کامل:** **ویجت‌های واقعی صفحه اصلی** (افزودن، پیکربندی، تغییر اندازه، حذف با `AppWidgetHost`) ·
**پوشه‌ها** با پیش‌نمایش ۲×۲، تغییر نام و حذف · پشتیبانی از **بسته‌های آیکن** (فرمت استاندارد
`appfilter.xml`، سازگار با هزاران بستهٔ موجود) · **نشانگر اعلان** روی آیکن‌ها (اختیاری، فقط تعداد) ·
**پشتیبان‌گیری و بازیابی** کل چیدمان در قالب JSON (بدون کلید API) · **ژست‌های قابل تنظیم** برای
کشیدن به بالا، پایین و دو بار ضربه.

**رابط کاربری:** متریال ۳ با رنگ پویا در اندروید ۱۲ به بالا، شش رنگ تأکیدی، حالت روشن/تیره/سیستم،
**راست‌چین کامل فارسی**، تغییر زبان برنامه بدون تغییر زبان گوشی، و امکان خاموش کردن کامل انیمیشن‌ها.

**رابط خفن:** پس‌زمینه **شفق متحرک** روی والپیپر شما، پنل‌های **شیشه‌ای** با لبه گرادیانی، بازخورد
لمسی فنری، و آیکن تطبیقی با لایه **مونوکروم** برای تم‌پذیری اندروید ۱۳.

**هوش مصنوعی:** گفتگو با پاسخ **جریانی**، **ورودی صوتی** (با موتور تشخیص گفتار خود گوشی، بدون نیاز
به مجوز میکروفون)، نمایش **Markdown** در پاسخ‌ها، نشانگر تایپ، تلاش مجدد، کپی و پاک کردن گفتگو · مسیر سریع
**آفلاین** برای دستورهای ساده بدون تماس شبکه‌ای · خروجی ساختاریافته JSON · کارت **تأیید** برای
اقدامات حساس · پیام خطای دقیق برای کلید نامعتبر، دسترسی، سهمیه، مدل، زمان‌انتظار و آفلاین.

</div>

---

## 3. Requirements

| | |
|---|---|
| Android | 8.0 Oreo (API 26) or newer — tested target API 34 |
| Storage | ≈ 20 MB for the debug APK, ≈ 3 MB for the release APK |
| Network | only needed for AI features; the launcher itself works fully offline |
| Gemini key | your own, free from Google AI Studio — **not** required to use the launcher |

To build it yourself: JDK 17, Android SDK (compileSdk 34, build-tools 34), Gradle 8.7 (the wrapper handles it).

<div dir="rtl">

### ۳. پیش‌نیازها

اندروید ۸ به بالا · حدود ۲۰ مگابایت فضا برای نسخه debug و ۳ مگابایت برای release · اینترنت فقط برای
بخش هوش مصنوعی لازم است و خود لانچر کاملاً آفلاین کار می‌کند · کلید Gemini اختیاری است و رایگان از
Google AI Studio گرفته می‌شود. برای ساخت از سورس: JDK 17، Android SDK 34 و Gradle 8.7.

</div>

---

## 4. Download & install

**Latest release → <https://github.com/amingangmanatgh2-hash/Luncher/releases/latest>**

| Asset | Size | Notes |
|---|---|---|
| `dlck-lnch-1.0.0-debug.apk` | 18.9 MB | debuggable, no shrinking — the easy choice |
| `dlck-lnch-1.0.0-release.apk` | 2.5 MB | R8 minified + resource shrinking, signed with the CI **debug** key |

1. Download the APK to the phone.
2. Open it → Android asks to allow installs from this source → **Allow** → **Install**.
3. Launch it once from the app list before making it the default (step 7).

> Both APKs are produced by GitHub Actions from this exact source tree, and the workflow contains a
> step that greps the built APK for `AIza…` patterns and fails the build if a credential were ever
> baked in. See [`.github/workflows/build-apk.yml`](.github/workflows/build-apk.yml).

<div dir="rtl">

### ۴. دانلود و نصب

از صفحه Releases گیت‌هاب یکی از دو فایل بالا را دانلود کنید، اجازه نصب از منبع ناشناس را بدهید و
نصب کنید. هر دو فایل توسط GitHub Actions از همین سورس ساخته شده‌اند و در CI مرحله‌ای وجود دارد که
APK را برای الگوی کلید (`AIza…`) جستجو می‌کند و در صورت پیدا شدن، بیلد را رد می‌کند.

</div>

---

## 5. Get a Gemini API key

Official Google documentation:

- **Get an API key** → <https://ai.google.dev/gemini-api/docs/api-key>
- **Google AI Studio** → <https://aistudio.google.com/app/apikey>
- **API key best practices** → <https://ai.google.dev/gemini-api/docs/api-key#security>
- **Models & capabilities** → <https://ai.google.dev/gemini-api/docs/models>
- **Pricing & free tier** → <https://ai.google.dev/pricing>
- **Rate limits** → <https://ai.google.dev/gemini-api/docs/rate-limits>

Steps:

1. Open <https://aistudio.google.com/app/apikey> and sign in with a Google account.
2. Press **Create API key** and pick (or let it create) a Google Cloud project.
3. Copy the key — it starts with `AIzaSy` and is about 39 characters.
4. *(Recommended)* In Google Cloud Console → **APIs & Services → Credentials**, restrict the key to the **Generative Language API**.

Optional — verify it from your computer before typing it into the phone. The script prints results, never the key:

```bash
export GEMINI_API_KEY='your-key'      # or put it in .env (git-ignored)
./scripts/verify_gemini.sh
```

> A key is a bearer credential. Anyone who has it can spend your quota. Never commit it, never paste
> it in an issue, never put it in a screenshot. If it leaks: delete it in AI Studio — revocation is instant.

<div dir="rtl">

### ۵. ساخت کلید Gemini

به `aistudio.google.com/app/apikey` بروید، وارد حساب گوگل شوید و **Create API key** را بزنید. کلید با
`AIzaSy` شروع می‌شود. پیشنهاد می‌شود در Google Cloud Console دسترسی کلید را فقط به «Generative
Language API» محدود کنید. برای تست کلید از روی کامپیوتر، اسکریپت `scripts/verify_gemini.sh` را
اجرا کنید؛ این اسکریپت هرگز کلید را چاپ نمی‌کند. اگر کلید لو رفت، همان لحظه در AI Studio حذفش کنید.

</div>

---

## 6. AI Setup inside the app

Reach it from **long-press on empty home space → AI Setup**, or **Settings → AI Setup**, or the
prompt shown in the chat screen when no key is configured.

The screen contains exactly what the assistant needs and nothing more:

| Section | Purpose |
|---|---|
| **Connection status** | `Not configured` / `Saved` / `Connected` / the precise failure |
| **API key** | masked input; after saving it is **never** shown again — not even partially |
| **Model** | `gemini-2.5-flash` (default) · `gemini-2.5-flash-lite` · `gemini-2.0-flash` · `gemini-2.0-flash-lite`, with automatic fallback if a model is unavailable |
| **Proxy base URL** | optional; point the app at your own [relay](#18-optional-gemini-relay-proxy) instead of Google |
| **Test connection** | one real round-trip to `GET /v1beta/models` |
| **Change / delete credential** | overwrite or wipe the stored key |
| **Security info** | plain-language explanation of where the key lives |
| **Usage info** | request count and token totals, counted locally on the device |
| **Tutorial** | links to this README and Google's docs |

<div dir="rtl">

### ۶. بخش AI Setup در برنامه

از مسیر «نگه‌داشتن روی فضای خالی صفحه اصلی ← AI Setup» یا «تنظیمات ← AI Setup» وارد شوید. این صفحه
شامل وضعیت اتصال، کادر ورود کلید (که پس از ذخیره **هرگز** دوباره نمایش داده نمی‌شود)، انتخاب مدل،
آدرس پروکسی اختیاری، دکمه تست اتصال، تغییر یا حذف کلید، توضیح امنیتی و آمار مصرف محلی است.

</div>

---

## 7. Set as default launcher

```
Settings ▸ Apps ▸ Default apps ▸ Home app ▸ ◉ DLCK LNCH
```

| Brand | Path |
|---|---|
| Stock / Pixel | Settings → Apps → Default apps → Home app |
| Samsung One UI | Settings → Apps → ⋮ → Default apps → Home app |
| Xiaomi MIUI / HyperOS | Settings → Apps → Manage apps → ⋮ → Default apps → Launcher |
| Any device | Press Home → "Use which app?" chooser → DLCK LNCH → **Always** |

The app also has **Settings → Set as default launcher**, which opens the correct system screen for you.

<div dir="rtl">

### ۷. انتخاب به‌عنوان لانچر پیش‌فرض

از تنظیمات اندروید ← برنامه‌ها ← برنامه‌های پیش‌فرض ← **Home app** گزینه DLCK LNCH را انتخاب کنید.
مسیر در سامسونگ و شیائومی کمی متفاوت است (جدول بالا). داخل برنامه هم گزینه «Set as default launcher»
شما را مستقیم به همان صفحه سیستم می‌برد.

</div>

---

## 8. Gestures & usage

| Gesture | Result |
|---|---|
| **Swipe up** on home | open the App Drawer |
| **Swipe down** on home | open Search |
| **Double-tap** empty home space | jump straight into the AI assistant |
| **Long press** an app icon | app menu: Open · Pin · Favourite · Hide · App info · Uninstall |
| **Long press** empty home space | Wallpaper · Settings · AI Setup |
| Tap the search bar | Search screen (apps + "ask the AI" + "search the web") |
| Assist gesture / assistant button | jumps straight into the AI chat (`ACTION_ASSIST`) |
| **Back** | walks back through the launcher's own stack, then stops at home |

<div dir="rtl">

### ۸. ژست‌ها

کشیدن انگشت به **بالا** = لیست برنامه‌ها · کشیدن به **پایین** = جستجو · **دوبار ضربه** روی فضای
خالی = ورود مستقیم به دستیار · **نگه‌داشتن** روی آیکن =
منوی برنامه · **نگه‌داشتن** روی فضای خالی = والپیپر، تنظیمات، AI Setup · دکمه دستیار گوشی = ورود
مستقیم به گفتگوی هوش مصنوعی · دکمه بازگشت = عقب رفتن در پشته داخلی لانچر تا صفحه اصلی.

</div>

---

## 9. The AI assistant & intent system

```
  you type ──▶ offline matcher ──hit──▶ execute (no network at all)
                    │ miss
                    ▼
              Gemini (JSON schema, temp 0.1)
                    │
                    ▼
            IntentValidator  ── unknown/invalid ──▶ plain chat reply
                    │ valid
                    ▼
        sensitive? ──yes──▶ confirmation card ──tap──▶ Android Intent
                    │ no
                    └──────────────────────────────▶ Android Intent
```

| Intent | What it does | Needs confirmation |
|---|---|---|
| `OPEN_APP` | launches an installed app matched by the fuzzy matcher | — |
| `SEARCH_APP` | filters your app list | — |
| `SHOW_APPS` | opens the drawer, optionally on a category | — |
| `GENERAL_CHAT` | streamed text answer | — |
| `OPEN_SETTINGS` | opens one of **16** whitelisted system screens | ✅ |
| `CREATE_TIMER` | `AlarmClock.ACTION_SET_TIMER`, clamped to 1 s – 24 h | ✅ |
| `SEARCH_WEB` | `Intent.ACTION_WEB_SEARCH` | ✅ |

**Hard guarantees**

- Anything the model returns that is not in this list is clamped to `GENERAL_CHAT`.
- Strings are truncated (app name 80 chars, query 200 chars) before they ever reach an `Intent`.
- Settings targets are matched against a fixed allowlist of `Settings.ACTION_*` constants — a model-supplied string can never become an arbitrary action.
- No `Runtime.exec`, no `ProcessBuilder`, no reflection, no `DexClassLoader`, no WebView JS bridge.

**Persian understanding** — the matcher normalises `ي→ی`, `ك→ک`, `آأإ→ا`, zero-width non-joiners and
Persian/Arabic digits, and carries a ~35-entry Persian→English transliteration table, so
«تلگرام رو باز کن» finds *Telegram*. Scoring: exact 100 · prefix 85 · token 80 · contains 70 ·
package 60 · edit-distance 45 · overlap 40.

<div dir="rtl">

### ۹. دستیار و سامانه اینتنت

ابتدا یک تطبیق‌دهنده آفلاین تلاش می‌کند دستور را بدون شبکه اجرا کند؛ در غیر این‌صورت درخواست با
خروجی ساختاریافته JSON به Gemini می‌رود، سپس اعتبارسنجی می‌شود و در نهایت به یک Intent استاندارد
اندروید تبدیل می‌شود. سه اینتنت حساس (تنظیمات، تایمر، جستجوی وب) کارت تأیید نشان می‌دهند.

هر خروجی خارج از این هفت مورد به گفتگوی ساده تبدیل می‌شود، رشته‌ها قبل از رسیدن به Intent کوتاه
می‌شوند و مقصدهای تنظیمات فقط از فهرست ثابت ۱۶تایی انتخاب می‌شوند. هیچ `Runtime.exec`، `ProcessBuilder`،
reflection یا بارگذاری کد پویا در برنامه وجود ندارد.

پشتیبانی فارسی: یکسان‌سازی «ي/ی»، «ك/ک»، «آ/أ/إ ← ا»، نیم‌فاصله و ارقام فارسی، به‌همراه جدول
حرف‌نویسی فارسی به انگلیسی — بنابراین «تلگرام رو باز کن» برنامه Telegram را پیدا می‌کند.

</div>

---

## 10. Settings reference

| Group | Options |
|---|---|
| **Appearance** | Theme (System/Light/Dark) · Dynamic colour · Accent (6) · Language (System/EN/FA) |
| **Home** | Show clock · Show date · 24-hour clock · Persian (Jalali) date · Show search bar · Show recent · Favourites rows (1–3) |
| **Grid & icons** | Grid columns (3–6) · Icon size (40–80 dp) · Show labels · Background dim/blur (0–0.9) |
| **Behaviour** | Animations on/off · App drawer sort order · Set as default launcher · Usage-access permission |
| **AI** | Model selection · everything in [AI Setup](#6-ai-setup-inside-the-app) |
| **Data** | Reset all settings · reset favourites/pins/hidden/usage history |

<div dir="rtl">

### ۱۰. مرجع تنظیمات

**ظاهر:** تم، رنگ پویا، رنگ تأکیدی، زبان · **صفحه اصلی:** نمایش ساعت و تاریخ، ساعت ۲۴ساعته، تاریخ
شمسی، نوار جستجو، اخیراً استفاده‌شده، تعداد ردیف محبوب‌ها · **شبکه و آیکن:** تعداد ستون، اندازه
آیکن، نمایش نام، تیرگی پس‌زمینه · **رفتار:** انیمیشن، ترتیب مرتب‌سازی، انتخاب لانچر پیش‌فرض،
دسترسی Usage Access · **هوش مصنوعی:** انتخاب مدل و تنظیمات کلید · **داده‌ها:** بازنشانی کامل.

</div>

---

## 11. Security model

| Threat | Mitigation |
|---|---|
| Key committed to Git | no key exists in the repo; `scripts/secret_scan.sh` runs in CI and locally before every commit; `.env`, `*.key`, `*.pem`, `*.jks`, `secrets.*`, `credentials.*` are git-ignored |
| Key baked into the APK | CI step **"Verify no credential is baked into the APK"** greps the built APKs for `AIza[0-9A-Za-z_-]{30,}` and fails the job if found |
| Key extracted from the device | stored in `EncryptedSharedPreferences` (AES-256-GCM, key material in the Android Keystore), excluded from cloud backup via `backup_rules.xml` / `data_extraction_rules.xml` |
| Key leaked via the UI | the key is write-only: after saving, the app shows a state, never the value — no partial reveal, no "show key" toggle |
| Key leaked via logs | the credential is never passed to `Log`, and request bodies are not logged |
| Key leaked via URLs | sent only in the `x-goog-api-key` **header**, never as a query parameter, so it cannot land in proxy/server access logs |
| Man-in-the-middle | HTTPS enforced; plaintext traffic disabled in the manifest |
| Model doing something harmful | seven-intent whitelist + validator + confirmation cards; no shell/reflection/dynamic loading |
| Over-broad package visibility | `<queries>` element instead of the `QUERY_ALL_PACKAGES` permission |
| Distributing without giving out your key | optional [Cloudflare relay](#18-optional-gemini-relay-proxy) keeps the key server-side |

Uninstalling the app destroys the encrypted store, and with it the key.

<div dir="rtl">

### ۱۱. مدل امنیتی

هیچ کلیدی در مخزن نیست و `scripts/secret_scan.sh` قبل از هر کامیت و در CI اجرا می‌شود · CI فایل APK
را برای الگوی کلید جستجو می‌کند و در صورت یافتن، بیلد را رد می‌کند · کلید در
`EncryptedSharedPreferences` با AES-256-GCM و Android Keystore ذخیره و از بکاپ ابری مستثنا می‌شود ·
کلید فقط نوشتنی است و هرگز — حتی به‌صورت جزئی — نمایش داده نمی‌شود · فقط در هدر `x-goog-api-key`
ارسال می‌شود نه در URL · ارتباط اجباراً HTTPS است · دسترسی به فهرست برنامه‌ها با `<queries>` انجام
می‌شود نه مجوز `QUERY_ALL_PACKAGES` · با حذف برنامه، کلید هم پاک می‌شود.

</div>

---

## 12. Permissions

| Permission | Why | Optional? |
|---|---|---|
| `INTERNET` | talk to the Gemini API | required only for AI; launcher works without network |
| `ACCESS_NETWORK_STATE` | show a proper "offline" state instead of a timeout | no |
| `SET_WALLPAPER` | the wallpaper shortcut in the home long-press menu | no |
| `PACKAGE_USAGE_STATS` | more accurate "recently used" ordering | **optional** — never requested automatically; the section works from the launcher's own history without it |
| `<queries>` (not a permission) | list launchable activities, speech recognisers and icon packs without `QUERY_ALL_PACKAGES` | — |
| Notification access (special access, not a manifest permission) | the unread dots on icons | **optional** — you grant it yourself in system settings; only the *number* of notifications per app is read, never their content, and nothing is stored or sent |

Not requested: contacts, location, camera, **microphone**, storage, SMS, phone.
Voice input works *without* `RECORD_AUDIO` because dictation is delegated to the system recogniser
through `ACTION_RECOGNIZE_SPEECH` — DLCK LNCH only receives the final transcript.
Widgets work *without* the privileged `BIND_APPWIDGET` permission: binding goes through the system
consent dialog (`ACTION_APPWIDGET_BIND`). Backup/restore works *without* any storage permission
because the file is chosen by you in the system picker (Storage Access Framework).
Every one of these is explained in-app on the Settings screen next to the toggle that needs it.

<div dir="rtl">

### ۱۲. مجوزها

`INTERNET` برای تماس با Gemini · `ACCESS_NETWORK_STATE` برای نمایش درست حالت آفلاین ·
`SET_WALLPAPER` برای تغییر والپیپر · `PACKAGE_USAGE_STATS` **اختیاری** و فقط برای دقت بیشتر بخش
«اخیراً استفاده‌شده» (هرگز خودکار درخواست نمی‌شود). مجوز مخاطبین، موقعیت مکانی، دوربین، میکروفون،
حافظه، پیامک و تماس درخواست **نمی‌شود**. توضیح هر مجوز داخل خود برنامه کنار همان گزینه آمده است.

</div>

---

## 13. Architecture

```
app/src/main/java/com/dlck/lnch/
├── MainActivity.kt            single activity, edge-to-edge, locale switching, ACTION_ASSIST
├── LauncherApplication.kt     AppGraph — lazy singletons, no DI framework
├── ui/
│   ├── LauncherRoot.kt        animated back-stack host
│   ├── LauncherViewModel.kt   app lists, favourites, sorting, settings setters
│   ├── launcher/              ClockWidget, HomeScreen
│   ├── apps/                  AppDrawerScreen, AppActionSheet
│   ├── search/                SearchScreen
│   ├── ai/                    ChatScreen/ViewModel, AiSetupScreen/ViewModel
│   ├── settings/              SettingsScreen
│   ├── components/            AppTile, shared bits
│   └── theme/                 Material 3 theme, accents, dynamic colour
├── data/
│   ├── apps/                  AppRepository, AppInfo, IconCache (LRU)
│   ├── prefs/                 DataStore settings + app state (favourites/pins/hidden/usage)
│   └── secure/                CredentialStore (EncryptedSharedPreferences)
├── ai/
│   ├── gemini/                GeminiClient (OkHttp + SSE), DTOs, schemas, error mapping
│   └── intent/                LauncherIntent, validator, AppMatcher, LocalIntentMatcher,
│                              IntentExecutor, SystemPrompt
└── utils/                     JalaliDate, CrashGuard, UsageAccess, Network
```

**Performance** — icons come from an LRU `IconCache`; the app list is loaded off the main thread and
refreshed by package broadcasts; usage-stats queries run on `Dispatchers.Default`; lists are lazy
(`LazyVerticalGrid` / `LazyColumn`) with stable keys; nothing blocking runs on the main thread, so no
ANRs. `CrashGuard` installs an uncaught-exception handler that records the last crash so the next
launch can show it instead of silently dying.

<div dir="rtl">

### ۱۳. معماری

ساختار پوشه‌ها بالا آمده است: `ui/` رابط کاربری، `data/` مخازن داده و ذخیره امن، `ai/` کلاینت Gemini و
سامانه اینتنت، `utils/` ابزارها. تزریق وابستگی با یک گراف ساده و بدون فریم‌ورک انجام می‌شود.

**کارایی:** کش LRU برای آیکن‌ها، بارگذاری لیست برنامه‌ها خارج از ترد اصلی، اجرای پرس‌وجوی UsageStats
روی `Dispatchers.Default`، لیست‌های تنبل با کلید پایدار، و مدیریت کرش با `CrashGuard`.

</div>

---

## 14. Build from source

```bash
git clone https://github.com/amingangmanatgh2-hash/Luncher.git
cd Luncher
git checkout arena/01a0ed54-luncher

./gradlew testDebugUnitTest      # 76 JVM unit tests
./gradlew assembleDebug          # app/build/outputs/apk/debug/
./gradlew assembleRelease        # app/build/outputs/apk/release/
```

Signing your own release build:

```bash
keytool -genkeypair -v -keystore my-release.jks -keyalg RSA -keysize 2048 \
        -validity 10000 -alias dlck

export RELEASE_STORE_FILE=/abs/path/my-release.jks
export RELEASE_STORE_PASSWORD='…'
export RELEASE_KEY_ALIAS=dlck
export RELEASE_KEY_PASSWORD='…'
./gradlew assembleRelease
```

`app/build.gradle.kts` reads those four environment variables and falls back to the debug keystore
only when they are missing — which is exactly what CI does, because this repository intentionally
contains **no** signing secret.

<div dir="rtl">

### ۱۴. ساخت از سورس

مخزن را کلون کنید، به شاخه پروژه بروید و دستورهای بالا را اجرا کنید. برای امضای نسخه release با کلید
خودتان، یک keystore بسازید، چهار متغیر `RELEASE_*` را تنظیم کنید و دوباره `assembleRelease` بزنید.
هیچ کلید امضایی در این مخزن ذخیره نشده است.

</div>

---

## 15. Tests & CI

**76 JVM unit tests** (`app/src/test/java/com/dlck/lnch/`):

| File | Covers |
|---|---|
| `AppMatcherTest.kt` (6) | Persian/Arabic normalisation, transliteration, scoring order, no false positives |
| `IntentSystemTest.kt` (12) | validator clamping, string truncation, timer bounds, settings allowlist, confirmation flags, offline parser |
| `JalaliDateTest.kt` (4) | Gregorian ↔ Jalali conversion incl. leap years |
| `MarkdownTest.kt` (7) | bold/code/bullet/heading stripping, unbalanced markers kept verbatim, Persian intact |
| `CalculatorTest.kt` (7) | precedence, right-associative `^`, unary minus, Persian digits/separators, division by zero, and *not* treating "maps" or "42" as maths |
| `SuggesterTest.kt` (9) | hour-of-day ranking beats raw popularity, neighbour hours at half weight, recency tiebreak, midnight wrap, legacy stats without a histogram, hour-bucket recording |
| `AlphabetIndexTest.kt` (7) | section indices, `#` bucket, Arabic→Persian letter folding, unsorted lists, touch-offset clamping |
| `FolderOpsTest.kt` (9) | unique ids, one folder per app, no duplicates, pruning uninstalled apps, name sanitising |
| `IconPackParserTest.kt` (7) | `appfilter.xml` parsing, `.Relative` activity shorthand, malformed entries skipped, package-level fallback |
| `BackupCodecTest.kt` (8) | settings + state round-trip, clamping, unknown fields, foreign files rejected, **no credential in the export** |

**CI** ([`.github/workflows/build-apk.yml`](.github/workflows/build-apk.yml)) on every push to the working branch:

```
secret scan → unit tests → assembleDebug → assembleRelease
            → collect APKs → grep APKs for AIza… → upload artifacts → GitHub Release
```

Artifacts are attached both as workflow artifacts (`dlck-lnch-apk`, `reports`) and as assets on a
tagged release `v<version>-build.<run_number>`.

<div dir="rtl">

### ۱۵. تست‌ها و CI

۲۹ تست واحد JVM شامل تطبیق نام برنامه‌ها، اعتبارسنجی اینتنت‌ها و تبدیل تاریخ شمسی. خط لوله CI در هر
push اجرا می‌شود: اسکن رمز → تست‌ها → ساخت debug و release → جستجوی الگوی کلید داخل APK → آپلود
خروجی‌ها → انتشار Release.

</div>

---

## 16. Video tutorial

<div align="center">

### 🎬 [`docs/video/dlck-lnch-setup-tutorial.mp4`](docs/video/dlck-lnch-setup-tutorial.mp4)

**3 min 01 s · 1280×720 · H.264 + AAC · 4.8 MB · Persian narration**

</div>

> **What this video is:** an **animated walkthrough** — a motion-graphics explainer whose every frame
> is drawn programmatically by [`docs/video/render_video.py`](docs/video/render_video.py), with
> text-to-speech Persian narration.
>
> **What it is not:** it is **not** a screen recording of a physical Android device, and the phone
> frames inside it are stylised mock-ups of the UI, **not** real screenshots. It is labelled this way
> deliberately so nobody mistakes it for device footage.
>
> No API key appears in it — the key is always drawn masked.

| # | Scene | Length |
|---|---|---|
| 1 | Title + the six-step pipeline | 24.5 s |
| 2 | Creating the key in Google AI Studio | 21.6 s |
| 3 | Where the key is stored (and where it never goes) | 24.9 s |
| 4 | Saving the key in AI Setup | 22.2 s |
| 5 | Test connection + what each error means | 21.0 s |
| 6 | Installing and selecting the launcher | 23.4 s |
| 7 | Talking to the assistant + the 7 intents | 20.3 s |
| 8 | The polish: aurora, glass, springs, voice input, themed icon | 23.1 s |

Full script, scene table and regeneration instructions: [`docs/VIDEO_SCRIPT.md`](docs/VIDEO_SCRIPT.md).

<div dir="rtl">

### ۱۶. آموزش ویدیویی

فایل ویدیو: `docs/video/dlck-lnch-setup-tutorial.mp4` — مدت ۳ دقیقه و ۱ ثانیه، در ۸ صحنه، با گویندگی فارسی.

**این ویدیو یک «راهنمای انیمیشنی» است** که تمام فریم‌های آن به‌صورت برنامه‌نویسی‌شده تولید شده و
گویندگی آن با تبدیل متن به گفتار ساخته شده است. این ویدیو **ضبط صفحه یک گوشی واقعی نیست** و
قاب‌های موبایل داخل آن ماکت‌های گرافیکی رابط کاربری هستند، نه اسکرین‌شات واقعی. هیچ کلید واقعی در
ویدیو دیده نمی‌شود. متن کامل گفتار در `docs/VIDEO_SCRIPT.md` آمده است.

</div>

---

## 17. Troubleshooting

| Symptom | Fix |
|---|---|
| "App not installed" | an older build with a different signature exists — uninstall it first |
| Home button opens the old launcher | Settings → Apps → Default apps → Home app → DLCK LNCH |
| Chat says no credential | AI Setup → paste the key → Save |
| `Invalid key` immediately | re-copy the key; no spaces, no truncation |
| `Permission denied` | enable the Generative Language API for that Cloud project |
| `Quota exceeded` | free-tier limit reached — wait for the window or enable billing |
| `Offline` | the launcher keeps working; only AI pauses |
| Recent apps empty | grant Usage Access, or hide the section in Settings |
| Assistant asks before acting | expected — settings/timer/web actions always confirm |
| UI is in English | Settings → Language → فارسی |

More detail, including vendor-specific paths: [`docs/SETUP_TUTORIAL.md`](docs/SETUP_TUTORIAL.md).

<div dir="rtl">

### ۱۷. رفع اشکال

جدول بالا رایج‌ترین مشکلات و راه‌حل‌ها را نشان می‌دهد؛ توضیح کامل‌تر در
`docs/SETUP_TUTORIAL.md` آمده است.

</div>

---

## 18. Optional Gemini relay (proxy)

If you hand the APK to other people and don't want each of them to own a Gemini key, deploy the
included Cloudflare Worker: the real key lives in Worker secrets, and each client gets a revocable
token instead.

```bash
cd proxy
wrangler secret put GEMINI_API_KEY
wrangler secret put CLIENT_TOKENS      # comma-separated
wrangler deploy
```

Then in the app: **AI Setup → Proxy base URL** = your Worker URL, and use a client token in place of
the key. The relay exposes only `GET /v1beta/models`, `:generateContent` and `:streamGenerateContent`,
compares tokens in constant time, rate-limits per token, caps the body at 128 KB, and streams SSE
straight through. Details: [`proxy/README.md`](proxy/README.md) · code: [`proxy/worker.js`](proxy/worker.js).

<div dir="rtl">

### ۱۸. پروکسی اختیاری

اگر برنامه را به دیگران می‌دهید و نمی‌خواهید هرکس کلید جداگانه داشته باشد، Worker کلادفلر موجود در
پوشه `proxy/` را مستقر کنید: کلید واقعی سمت سرور می‌ماند و به هر کاربر یک توکن قابل ابطال می‌دهید.
سپس در برنامه، آدرس پروکسی را در بخش AI Setup وارد کنید.

</div>

---

## 19. Known limitations

- The published release APK is signed with the **CI debug keystore** (no signing secret is stored in this repo), so it installs and runs but is not Play-Store ready as-is — see [§14](#14-build-from-source).
- No instrumented (device) UI tests: CI has no emulator. Coverage is 76 JVM unit tests plus a real compile of both build types.
- The APKs have not been executed on physical hardware by the author of this branch — they are produced and verified by CI (compile, unit tests, credential scan, packaging), not by manual on-device QA.
- Widgets, icon packs, folders, and a desktop grid you can arrange freely are not implemented.
- Gemini streaming depends on the model supporting SSE; the client falls back to a single response otherwise.

<div dir="rtl">

### ۱۹. محدودیت‌های شناخته‌شده

نسخه release با کلید debug مربوط به CI امضا شده است · تست UI روی دستگاه واقعی انجام نشده چون CI
شبیه‌ساز ندارد؛ پوشش شامل ۲۹ تست واحد و کامپایل کامل هر دو نوع بیلد است · APKها روی گوشی فیزیکی
توسط نویسنده این شاخه اجرا نشده‌اند و صحت آن‌ها از طریق CI تأیید شده است · ویجت، آیکن‌پک، پوشه و
چیدمان آزاد دسکتاپ پیاده‌سازی نشده.

</div>

---

## 20. License & credits

- Source code: MIT (see [`LICENSE`](LICENSE) if present, otherwise treat as MIT by the repository owner's intent).
- **Vazirmatn** font by Saber Rastikerdar, SIL Open Font License 1.1 — used only to render the tutorial video, not bundled in the APK.
- Gemini, Google AI Studio and Android are trademarks of Google LLC. This project is not affiliated with or endorsed by Google.

<div dir="rtl">

### ۲۰. مجوز و تشکر

کد تحت مجوز MIT · فونت **وزیرمتن** اثر صابر راستی‌کردار با مجوز SIL OFL 1.1 که فقط برای ساخت ویدیو
استفاده شده و داخل APK قرار ندارد · Gemini و Android علائم تجاری گوگل هستند و این پروژه وابسته به
گوگل نیست.

</div>
