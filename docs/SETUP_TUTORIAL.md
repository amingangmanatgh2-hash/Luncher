<div dir="rtl">

# راهنمای کامل راه‌اندازی DLCK LNCH

</div>

# DLCK LNCH — Complete Setup Tutorial

> **Persian below each English section.** / **زیر هر بخش انگلیسی، ترجمه فارسی آمده است.**
>
> 🎬 Prefer video? → [`docs/video/dlck-lnch-setup-tutorial.mp4`](video/dlck-lnch-setup-tutorial.mp4) (2 min 38 s, Persian narration).

---

## 0. The whole flow at a glance

```
 ┌──────────────────┐   1   ┌──────────────────┐   2   ┌────────────────────┐
 │ Google AI Studio │ ────▶ │  Create API key  │ ────▶ │  Copy key (AIza…)  │
 └──────────────────┘       └──────────────────┘       └─────────┬──────────┘
                                                                 │ 3
                                                                 ▼
 ┌──────────────────┐   6   ┌──────────────────┐   5   ┌────────────────────┐
 │  Chat with AI    │ ◀──── │ Set as Home app  │ ◀──── │ Paste in AI Setup  │
 └──────────────────┘       └──────────────────┘       └─────────┬──────────┘
          ▲                                                      │ 4
          │                                            ┌─────────▼──────────┐
          └──────────────────────────────────────────  │  Test connection   │
                            green = ready              └────────────────────┘
```

<div dir="rtl">

**نمای کلی:** ساخت کلید در Google AI Studio ← کپی کلید ← وارد کردن آن در بخش AI Setup داخل برنامه ← تست اتصال ← انتخاب DLCK LNCH به‌عنوان لانچر پیش‌فرض ← استفاده از دستیار.

</div>

---

## 1. Install the APK

| | |
|---|---|
| **Debug build** | `dlck-lnch-1.0.0-debug.apk` — 18.6 MB, easiest to install, includes debug symbols |
| **Release build** | `dlck-lnch-1.0.0-release.apk` — 2.4 MB, minified + resource-shrunk, signed with the CI debug key |

Both are attached to the GitHub Release: **<https://github.com/amingangmanatgh2-hash/Luncher/releases/tag/v1.0.0-build.4>**

1. Download one APK onto the phone (Android 8.0 / API 26 or newer).
2. Open it from the notification or from Files.
3. Android asks to allow installing from unknown sources → **Allow this source**.
4. Tap **Install**.

> The release APK is signed with the **CI debug keystore**, not a private production key. That is deliberate: no signing secret exists in this repository. It installs and runs normally, but it cannot be uploaded to Google Play as-is. See [§7](#7-signing-your-own-release-build).

<div dir="rtl">

### ۱. نصب فایل APK

دو فایل روی Release گیت‌هاب موجود است: نسخه debug با حجم ۱۸٫۶ مگابایت و نسخه release با حجم ۲٫۴ مگابایت. یکی را دانلود کنید، اجازه نصب از منابع ناشناس را بدهید و Install را بزنید. حداقل نسخه اندروید مورد نیاز، اندروید ۸ است.

نسخه release با کلید debug مربوط به CI امضا شده است — یعنی نصب و اجرا می‌شود اما برای انتشار در گوگل‌پلی باید خودتان آن را با کلید خصوصی امضا کنید (بخش ۷).

</div>

---

## 2. Create a Gemini API key

Official Google documentation — read these first:

- Get an API key → <https://ai.google.dev/gemini-api/docs/api-key>
- Google AI Studio → <https://aistudio.google.com/app/apikey>
- Pricing & free tier limits → <https://ai.google.dev/pricing>
- API key best practices (security) → <https://ai.google.dev/gemini-api/docs/api-key#security>
- Available models → <https://ai.google.dev/gemini-api/docs/models>

Steps:

1. Open <https://aistudio.google.com/app/apikey> in a browser.
2. Sign in with a Google account.
3. Press **Create API key**.
4. Choose an existing Google Cloud project, or let AI Studio create one for you.
5. The key appears once — press **Copy**. It looks like `AIzaSy…` (≈39 characters).
6. Optional but recommended: in Google Cloud Console → *APIs & Services → Credentials*, restrict the key to the **Generative Language API** only.

```
  Google account ──▶ AI Studio ──▶ [ Create API key ] ──▶ AIza•••••••••••••••••••••
                                                              │
                                             keep it private ─┘  (like a password)
```

> ⚠️ A key is a bearer credential: anyone holding it can spend your quota. Never paste it into a chat, screenshot, issue, or commit. If it leaks, delete it in AI Studio and create a new one — revocation is instant.

<div dir="rtl">

### ۲. ساخت کلید Gemini

به نشانی `aistudio.google.com/app/apikey` بروید، با حساب گوگل وارد شوید و روی **Create API key** بزنید. کلید فقط یک‌بار نمایش داده می‌شود؛ آن را کپی کنید. کلید با `AIzaSy` شروع می‌شود و حدود ۳۹ کاراکتر است.

پیشنهاد امنیتی: در Google Cloud Console دسترسی کلید را فقط به «Generative Language API» محدود کنید. اگر کلید لو رفت، همان لحظه در AI Studio حذفش کنید و کلید تازه بسازید.

</div>

---

## 3. (Optional) Verify the key from your computer first

The repository ships a local test script that never prints your key:

```bash
export GEMINI_API_KEY='paste-your-key-here'   # or put it in a .env file (git-ignored)
./scripts/verify_gemini.sh
```

What it does:

1. `GET  https://generativelanguage.googleapis.com/v1beta/models` — is the key accepted at all?
2. `POST .../v1beta/models/gemini-2.5-flash:generateContent` — can it actually generate?

Exit codes and messages map HTTP status to a human cause:

| HTTP | Meaning | What to do |
|---|---|---|
| `200` | key works | continue to step 4 |
| `400 API_KEY_INVALID` / `401` | key is wrong or truncated | copy it again, no spaces |
| `403` | Generative Language API disabled, or key restricted | enable the API in Cloud Console |
| `429` | free-tier quota exhausted | wait, or enable billing |
| `5xx` | Google-side outage | retry later |
| `000` | no network / DNS blocked | check connectivity, VPN, firewall |

<div dir="rtl">

### ۳. (اختیاری) تست کلید از روی کامپیوتر

اسکریپت `scripts/verify_gemini.sh` کلید شما را تست می‌کند و هرگز آن را چاپ نمی‌کند. کلید را در متغیر محیطی `GEMINI_API_KEY` یا در فایل `.env` (که در گیت نادیده گرفته می‌شود) قرار دهید و اسکریپت را اجرا کنید. جدول بالا معنی هر کد خطا را توضیح می‌دهد.

</div>

---

## 4. Enter the key inside the app (AI Setup)

```
 Home screen ──(long press on empty space)──▶ ┌─────────────┐
                                             │  Wallpaper  │
                                             │  Settings   │
                                             │  AI Setup   │ ◀── tap this
                                             └─────────────┘
```

Alternative route: **Settings → AI Setup**, or open the chat screen before a key exists — it links straight there.

In **AI Setup** you get:

| Element | What it shows |
|---|---|
| Connection status | `Not configured` / `Connected` / the exact error |
| Gemini API key field | Masked input. Once saved, the key is **never redisplayed** — you only see `•••• saved` |
| Model selector | `gemini-2.5-flash` (default), `-flash-lite`, `gemini-2.0-flash`, `-flash-lite` |
| Proxy base URL | Optional, for the [Cloudflare relay](../proxy/README.md) |
| Test connection | Live round-trip to Google |
| Change credential | Overwrites the stored key |
| Delete credential | Wipes it from the encrypted store |
| Security info | Where the key lives and what is never done with it |
| Usage info | Local request/token counters, stored only on the device |
| Tutorial | Links to this document and to Google's docs |

Paste → **Save credential** → the field clears and the status row turns into `Saved`.

<div dir="rtl">

### ۴. وارد کردن کلید در برنامه

روی فضای خالی صفحه اصلی نگه دارید و **AI Setup** را انتخاب کنید (یا از مسیر Settings → AI Setup). کلید را در کادر بچسبانید و **Save credential** را بزنید.

نکته مهم: کلید بعد از ذخیره **هرگز دوباره نمایش داده نمی‌شود**؛ فقط وضعیت «ذخیره شد» را می‌بینید. در همین صفحه می‌توانید مدل را انتخاب کنید، اتصال را تست کنید، کلید را تغییر دهید یا کاملاً حذف کنید، و آمار مصرف محلی را ببینید.

</div>

---

## 5. Test the connection

Press **Test connection**. Behind the scenes the app calls `GET /v1beta/models` with your key in the `x-goog-api-key` header (never in the URL, so it cannot end up in server logs).

```
  ┌────────────┐   x-goog-api-key   ┌───────────────────────────┐
  │ DLCK LNCH  │ ─────────────────▶ │ generativelanguage.google │
  └────────────┘   HTTPS / TLS      └───────────────────────────┘
        ▲                                        │
        └──────────  Connected ✓  ───────────────┘
```

Result states:

- 🟢 **Connected** + model name → done.
- 🔴 **Invalid key** → the key is wrong; create a new one.
- 🟠 **Permission denied** → enable the Generative Language API for that project.
- 🟠 **Quota exceeded** → free-tier limit hit; wait for the window to reset.
- ⚪ **Offline** → the launcher still works; only AI features pause.

<div dir="rtl">

### ۵. تست اتصال

دکمه **Test connection** را بزنید. کلید در هدر `x-goog-api-key` ارسال می‌شود، نه در آدرس URL — بنابراین در لاگ سرورها ثبت نمی‌شود. نتیجه سبز یعنی آماده است؛ قرمز یعنی کلید نامعتبر؛ نارنجی یعنی مشکل دسترسی یا سهمیه.

</div>

---

## 6. Set DLCK LNCH as your Home app

Android never switches launchers silently — you have to pick it:

```
Settings ▸ Apps ▸ Default apps ▸ Home app ▸ ◉ DLCK LNCH
```

Vendor variations:

| Brand | Path |
|---|---|
| Stock / Pixel | Settings → Apps → Default apps → Home app |
| Samsung (One UI) | Settings → Apps → ⋮ → Default apps → Home app |
| Xiaomi (MIUI/HyperOS) | Settings → Apps → Manage apps → ⋮ → Default apps → Launcher |
| Any device | Press Home, Android shows a "Use which app?" chooser → pick DLCK LNCH → **Always** |

The launcher also exposes a shortcut: **Settings → Set as default launcher** opens the right system screen for you.

Then the gestures become available:

| Gesture | Action |
|---|---|
| Swipe **up** on home | App Drawer |
| Swipe **down** on home | Search |
| **Long press** an app icon | App menu: Open, Pin/Unpin favourite, App info, Uninstall |
| **Long press** empty space | Wallpaper / Settings / AI Setup |
| Home button while already home | Return to the top of home |

<div dir="rtl">

### ۶. انتخاب به‌عنوان صفحه اصلی

از مسیر تنظیمات اندروید → برنامه‌ها → برنامه‌های پیش‌فرض → **Home app** گزینه DLCK LNCH را انتخاب کنید. در سامسونگ و شیائومی مسیر کمی متفاوت است (جدول بالا). داخل خود برنامه هم گزینه «Set as default launcher» شما را مستقیم به همان صفحه می‌برد.

بعد از آن: کشیدن انگشت به بالا = لیست برنامه‌ها، کشیدن به پایین = جستجو، نگه‌داشتن روی آیکن = منوی برنامه.

</div>

---

## 7. Signing your own release build

The CI release APK uses the debug keystore. To produce a Play-ready build:

```bash
keytool -genkeypair -v -keystore my-release.jks -keyalg RSA \
        -keysize 2048 -validity 10000 -alias dlck

export RELEASE_STORE_FILE=/absolute/path/my-release.jks
export RELEASE_STORE_PASSWORD='…'
export RELEASE_KEY_ALIAS=dlck
export RELEASE_KEY_PASSWORD='…'

./gradlew assembleRelease
```

`app/build.gradle.kts` reads those four `RELEASE_*` environment variables and falls back to the debug keystore only when they are absent. **Never commit the `.jks` file** — `*.jks`, `*.keystore`, and `keystore.properties` are already in `.gitignore`.

<div dir="rtl">

### ۷. امضای نسخه release با کلید خودتان

با `keytool` یک keystore بسازید، چهار متغیر محیطی `RELEASE_*` را تنظیم کنید و `./gradlew assembleRelease` را اجرا کنید. فایل keystore را هرگز کامیت نکنید؛ الگوهای آن از قبل در `.gitignore` هست.

</div>

---

## 8. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| "App not installed" | older version with a different signature is installed | uninstall the old one first |
| Home button still opens the old launcher | default not changed | Settings → Apps → Default apps → Home app |
| Chat says "no credential" | key not saved | AI Setup → paste → Save |
| `Invalid key` right after pasting | trailing space or partial copy | re-copy from AI Studio |
| `Permission denied` | Generative Language API not enabled on that Cloud project | enable it in Cloud Console |
| `Quota exceeded` | free tier RPM/RPD limit | wait for the window, or add billing |
| Recent apps section empty | Usage Access permission not granted | Settings → Recent apps → grant, or hide the section |
| Assistant refuses an action | it needs confirmation for settings/timers/web searches | press **Confirm** on the card |
| Everything is in English | language is following the system | Settings → Language → فارسی |

<div dir="rtl">

### ۸. رفع اشکال

جدول بالا رایج‌ترین مشکلات را پوشش می‌دهد: نصب نشدن به‌دلیل امضای متفاوت، تغییر نکردن لانچر پیش‌فرض، ذخیره نشدن کلید، فاصله اضافی هنگام کپی کلید، فعال نبودن API، اتمام سهمیه، نداشتن دسترسی Usage Access برای بخش «اخیراً استفاده‌شده»، و تغییر زبان به فارسی از بخش تنظیمات.

</div>

---

## 9. What the assistant is allowed to do

The model can only return one of **seven** intents. Anything else is clamped to a plain chat reply:

| Intent | Effect | Confirmation |
|---|---|---|
| `OPEN_APP` | launches an installed app | no |
| `SEARCH_APP` | filters your app list | no |
| `SHOW_APPS` | opens the drawer / a category | no |
| `GENERAL_CHAT` | text answer, streamed | no |
| `OPEN_SETTINGS` | opens one of 16 whitelisted system screens | **yes** |
| `CREATE_TIMER` | `AlarmClock.ACTION_SET_TIMER`, 1 s – 24 h | **yes** |
| `SEARCH_WEB` | `ACTION_WEB_SEARCH` | **yes** |

There is **no shell execution, no reflection, no dynamic code loading** anywhere in the intent path — only standard, documented Android `Intent`s.

<div dir="rtl">

### ۹. دستیار اجازه چه کارهایی دارد؟

مدل فقط می‌تواند یکی از **هفت** اینتنت بالا را برگرداند و هر چیز دیگری به گفتگوی ساده تبدیل می‌شود. سه مورد حساس (باز کردن تنظیمات، ساخت تایمر، جستجوی وب) قبل از اجرا از شما تأیید می‌گیرند. در کل مسیر اجرای اینتنت، **هیچ اجرای دستور شل، reflection یا بارگذاری کد پویا** وجود ندارد.

</div>
