# Video script — DLCK LNCH setup tutorial

**File:** [`docs/video/dlck-lnch-setup-tutorial.mp4`](video/dlck-lnch-setup-tutorial.mp4)
**Length:** 2 min 38 s · **1280×720 · 24 fps · H.264 + AAC · 3.8 MB**
**Narration:** Persian (text-to-speech), 7 segments
**Type:** **animated walkthrough** — every frame is drawn programmatically with Pillow by
[`docs/video/render_video.py`](video/render_video.py). It is **not** a screen recording of a
physical device, and the phone frames in it are stylised mock-ups of the real UI, not screenshots.
No real API key appears anywhere; the key is always drawn masked.

## Regenerating it

```bash
python3 -m venv .venv
.venv/bin/pip install pillow imageio-ffmpeg arabic-reshaper python-bidi
# narration clips must exist in docs/video/.render/audio/ (01…07)
# Vazirmatn TTFs must exist in docs/video/.render/fonts/
.venv/bin/python docs/video/render_video.py
```

`.render/` is git-ignored: it holds the TTS audio, the Persian font files and the intermediate WAVs.

---

## Scene list

| # | Slide | Duration | Narration (FA) | English gloss |
|---|---|---|---|---|
| 1 | Title + 6-step pipeline | 24.7 s | به آموزش راه‌اندازی DLCK LNCH خوش آمدید؛ یک لانچر اندروید با دستیار هوش مصنوعی Gemini. در این ویدیوی کوتاه شش مرحله را با هم انجام می‌دهیم: ساخت کلید، ذخیره امن آن، تست اتصال، نصب برنامه، انتخاب به عنوان صفحه اصلی، و اجرای دستیار هوشمند. | Welcome to the DLCK LNCH setup guide — an Android launcher with a Gemini AI assistant. In this short video we'll go through six steps: creating the key, storing it securely, testing the connection, installing the app, selecting it as the home screen, and running the assistant. |
| 2 | AI Studio browser mock, "Create API key" pulsing | 22.2 s | مرحله یک: ساخت کلید. به نشانی ای آی استودیو گوگل بروید، با حساب گوگل خود وارد شوید و روی دکمه Create API key بزنید. کلید ساخته‌شده را کپی کنید. این کلید دقیقاً مثل رمز عبور شماست؛ آن را با کسی به اشتراک نگذارید و در جای عمومی منتشر نکنید. | Step one: create the key. Go to Google AI Studio, sign in with your Google account, press *Create API key*, copy it. The key is exactly like a password — don't share it, don't publish it. |
| 3 | Key → EncryptedSharedPreferences, ✗ Source/APK/Git/Logs/README | 22.2 s | مرحله دو: کلید کجا ذخیره می‌شود؟ در DLCK LNCH کلید هرگز داخل سورس‌کد، فایل APK یا گیت قرار نمی‌گیرد. شما آن را در خود برنامه وارد می‌کنید و کلید در حافظه رمزنگاری‌شده اندروید با الگوریتم ای ای اس دویست و پنجاه و شش ذخیره می‌شود. | Step two: where does the key live? In DLCK LNCH the key never goes into source code, the APK, or Git. You type it into the app itself and it is stored in Android's encrypted storage with AES-256. |
| 4 | AI Setup phone mock, masked field filling, Save | 20.7 s | مرحله سه: ذخیره کلید. برنامه را باز کنید، روی فضای خالی صفحه اصلی نگه دارید و گزینه AI Setup را انتخاب کنید. کلید را در کادر Gemini API key بچسبانید و دکمه ذخیره را بزنید. دقت کنید که کلید پس از ذخیره دیگر هرگز نمایش داده نمی‌شود. | Step three: save the key. Open the app, long-press empty space on the home screen and choose *AI Setup*. Paste the key into the *Gemini API key* field and press save. Note that the key is never displayed again once saved. |
| 5 | Spinner → green **Connected**, error table | 23.1 s | مرحله چهار: تست اتصال. روی دکمه Test connection بزنید. اگر همه چیز درست باشد، نشانگر سبز رنگ با عنوان Connected نمایش داده می‌شود. اگر خطایی دیدید، پیام خطا دقیقاً می‌گوید مشکل از کلید نامعتبر است، یا از دسترسی، یا از پایان یافتن سهمیه. | Step four: test the connection. Press *Test connection*. If everything is right, a green *Connected* indicator appears. If you see an error, the message tells you exactly whether it's an invalid key, a permission problem, or exhausted quota. |
| 6 | 3 install steps + home-screen mock + swipe-up arrow | 22.3 s | مرحله پنج: نصب و انتخاب لانچر. فایل APK را روی گوشی نصب کنید، سپس در تنظیمات اندروید به بخش برنامه‌های پیش‌فرض و سپس Home app بروید و DLCK LNCH را انتخاب کنید. حالا با کشیدن انگشت به بالا لیست برنامه‌ها و با کشیدن به پایین جستجو باز می‌شود. | Step five: install and select the launcher. Install the APK, then in Android settings go to Default apps → Home app and pick DLCK LNCH. Now swipe up for the app list and swipe down for search. |
| 7 | Chat mock with confirmation card + 7 intent chips | 23.4 s | مرحله شش: اجرای دستیار. در صفحه گفتگو بنویسید: یوتیوب رو باز کن، یا تنظیمات وای فای رو باز کن. برای کارهای حساس، برنامه قبل از اجرا از شما تأیید می‌گیرد. دستیار هرگز دستور شل اجرا نمی‌کند و فقط از اینتنت‌های امن اندروید استفاده می‌کند. موفق باشید! | Step six: run the assistant. In the chat screen type "open YouTube" or "open Wi-Fi settings". For sensitive actions the app asks for confirmation first. The assistant never runs shell commands — it only uses safe Android intents. Good luck! |

## Visual system

- Palette matches the app's default dark theme: background `#080B12`, surface `#0D111A`, primary cyan `#22D3EE`, violet `#A78BFA`, success `#22C55E`.
- Persian text is shaped with `arabic-reshaper` and reordered with `python-bidi` before rasterising, and set in **Vazirmatn** (SIL OFL 1.1).
- A six-node pipeline bar runs along the bottom of every slide and advances with the narration.
- Elements enter with a cubic ease-out fade + 18 px rise; each slide cross-fades 0.25 s at both edges.
