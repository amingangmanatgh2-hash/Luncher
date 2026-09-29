# 🗺️ نقشه راه ۲۰ فازی — نکسوس ۱۰۰۰

> مرجع قابلیت‌ها: [`FEATURES.md`](./FEATURES.md) — ۱۰۰۰ قابلیت با شناسه `F-0001` تا `F-1000`.
> قاعده: **هیچ فازی بدون تأیید کارفرما شروع نمی‌شود** و هر فاز با کد کامل + تست + اسکرین‌شات تحویل می‌شود.

## 🎯 اصول کلی

| موضوع | تصمیم |
|---|---|
| زبان | Kotlin 2.x + Jetpack Compose (100% Compose) |
| حداقل SDK | API 29 (اندروید ۱۰) — هدف: API 35 (اندروید ۱۵) |
| معماری | Clean Architecture + MVI، Multi-Module Gradle، Version Catalog |
| DI | Hilt |
| داده | Room + SQLCipher، DataStore، EncryptedSharedPreferences |
| گرافیک | Compose Canvas/GraphicsLayer + AGSL (API 33+) با فالبک، اختیاری Vulkan/Filament (P4) |
| AI | Gemini API با کلید کاربر (بدون هاردکد) + پروکسی اختیاری Cloudflare Worker |
| کیفیت | Detekt + ktlint + Unit/UI Test + Macrobenchmark + Baseline Profile + R8 |

## 🧱 ساختار ماژول‌ها (هدف نهایی)

```
:app
:core:ui            :core:design        :core:motion        :core:graphics
:core:data          :core:database      :core:datastore     :core:common
:core:security      :core:analytics(local)  :core:testing
:feature:home       :feature:drawer     :feature:search     :feature:folders
:feature:widgets    :feature:gestures   :feature:themes     :feature:wallpaper
:feature:setup      :feature:settings   :feature:ai         :feature:voice
:feature:automation :feature:devicectl  :feature:security   :feature:productivity
:feature:modes      :feature:labs
```

---

## 📅 فازها

| فاز | نام | قابلیت‌های هدف | خروجی کلیدی |
|---|---|---|---|
| ۱ | پی‌ریزی و زیرساخت | — | اسکلت Multi-Module، CI، Version Catalog، Detekt، Debug APK |
| ۲ | هسته لانچر | P0 دسته ۱ | Home/Drawer/Dock پایدار، PackageManager، Room |
| ۳ | سیستم طراحی و تم | P0 دسته ۲ | توکن‌های طراحی، ۵ تم پایه، RTL، فونت فارسی |
| ۴ | موتور موشن | P0 دسته ۳ | موتور انیمیشن فنری، ۶ انیمیشن باز/بسته اپ، هپتیک |
| ۵ | Setup Wizard و امنیت کلید | P0 دسته ۴/۸ | ویزارد ۷ مرحله‌ای، Keystore، تست اتصال Gemini |
| ۶ | دستیار AI — هسته | P0/P1 دسته ۴ | چت استریم، حافظه کوتاه، ۲۰ Function Call |
| ۷ | جستجوی جهانی | P0 دسته ۱ | جستجوی فازی/معنایی، فرمان سریع، جستجوی صوتی |
| ۸ | ویجت‌ها و پوشه‌ها | P1 دسته ۱ | Widget Host، Stack، پوشه هوشمند |
| ۹ | موتور گرافیک AGSL | P0/P1 دسته ۳ | شیدرها، سیستم ذرات GPU، کیفیت تطبیقی |
| ۱۰ | والپیپر زنده | P1 دسته ۲/۳ | ۱۰ والپیپر شیدری، پارالاکس، واکنش به سنسور |
| ۱۱ | کنترل دستگاه | P0/P1 دسته ۵ | AccessibilityService، ۶۰ اکشن کنترلی |
| ۱۲ | صدا و مکالمه | P1 دسته ۷ | Wake Word، STT/TTS، Gemini Live |
| ۱۳ | اتوماسیون | P1 دسته ۶ | موتور ماکرو، ویرایشگر گره‌ای، ۲۵ تریگر |
| ۱۴ | امنیت و حریم خصوصی | P1/P2 دسته ۸ | Vault، App Lock، داشبورد حریم خصوصی |
| ۱۵ | بهره‌وری | P1/P2 دسته ۹ | یادداشت/وظایف/فایل/ابزارها |
| ۱۶ | تم‌ساز پیشرفته و AI Theming | P1/P2 دسته ۲ | ۲۰ تم، تم‌ساز از متن/عکس، آیکون‌ساز |
| ۱۷ | حالت‌های زمینه‌ای | P2 دسته ۱۰ | ۱۵ حالت (گیمینگ، خواب، رانندگی…) |
| ۱۸ | دسترس‌پذیری و رابط تطبیقی | P2/P3 دسته ۱۰/۲ | دستیارهای ویژه، Circadian UI |
| ۱۹ | بهینه‌سازی و تست میدانی | همه | Baseline Profile، R8، تست اندروید ۱۰–۱۵ |
| ۲۰ | آزمایشگاه و انتشار | P4 | Vulkan/Filament/AR پشت پرچم، AAB امضاشده، مستندات |

---

## 🔍 جزئیات هر فاز

### فاز ۱ — پی‌ریزی و زیرساخت
- ایجاد پروژه Gradle چندماژولی با `libs.versions.toml`.
- پیکربندی Compose، Hilt، Detekt/ktlint، GitHub Actions (build + lint + test).
- `local.properties` → `GEMINI_API_KEY` (اختیاری، فقط برای دیباگ) + `buildConfigField`.
- **تحویل:** Debug APK قابل نصب با صفحه Placeholder، گزارش CI سبز.
- **معیار پذیرش:** `./gradlew assembleDebug testDebugUnitTest detekt` بدون خطا.

### فاز ۲ — هسته لانچر
- `F-0001…F-0020`, `F-0021…F-0030`, `F-0031…F-0045`, بخش سیستم پایه.
- LauncherApps + UserManager، کش آیکون، Room برای چیدمان، Drag & Drop.
- **تحویل:** لانچر قابل تنظیم به‌عنوان Home پیش‌فرض.

### فاز ۳ — سیستم طراحی و تم
- توکن رنگ/تایپوگرافی/فاصله، Material You، RTL کامل، ۵۰ فونت فارسی (لود تنبل).
- **تحویل:** صفحه Style Gallery داخلی برای بازبینی همه اجزا.

### فاز ۴ — موتور موشن
- `MotionEngine` با پروفایل فنری، Shared Element، Predictive Back، ۱۰۰ الگوی هپتیک.
- **تحویل:** صفحه «آزمایشگاه انیمیشن» + ویدیو ۶۰fps.

### فاز ۵ — Setup Wizard و امنیت کلید
- ۷ مرحله: خوش‌آمد → زبان → مجوزها → کلید API → تست اتصال → تم → معرفی دستیار.
- EncryptedSharedPreferences + AES-256-GCM + Master Key در Keystore، چند کلید + چرخش، Skip → حالت پایه.
- **تحویل:** ویزارد کامل + تست امنیتی (کلید در APK/لاگ نباشد).

### فاز ۶ — دستیار AI هسته
- استریم SSE، تاریخچه، انتخاب مدل، ۲۰ Function Call اولیه، Rate Limit، کش، خطای فارسی.

### فاز ۷ — جستجوی جهانی
- ایندکس اپ/مخاطب/تنظیمات/فایل، فازی فارسی، امبدینگ محلی، فرمان سریع.

### فاز ۸ — ویجت‌ها و پوشه‌ها
- AppWidgetHost، تغییر اندازه آزاد، Stack هوشمند، ۱۵ ویجت بومی، پوشه‌های هوشمند.

### فاز ۹ — موتور گرافیک AGSL
- کتابخانه شیدر، ذرات GPU (۱۰۰k)، Bloom/DOF/Motion Blur، سه پیش‌تنظیم کیفیت + فالبک API 29–32.

### فاز ۱۰ — والپیپر زنده
- WallpaperService شیدری، پارالاکس چندلایه، واکنش به ژیروسکوپ/موسیقی/باتری، بودجه مصرف.

### فاز ۱۱ — کنترل دستگاه
- AccessibilityService، اکشن‌های اتصال/صدا/صفحه/باتری/حافظه، تأیید کاربر برای اقدام حساس.

### فاز ۱۲ — صدا و مکالمه
- Wake Word روی دستگاه، VAD، STT استریم، TTS چندصدایی، Gemini Live، مترجم رودررو.

### فاز ۱۳ — اتوماسیون
- موتور Trigger/Condition/Action، ویرایشگر گره‌ای، ۲۵ تریگر و ۲۰ اکشن، ساخت ماکرو با زبان طبیعی.

### فاز ۱۴ — امنیت و حریم خصوصی
- App Lock، Vault، لانچر ساختگی، Duress PIN، داشبورد حریم خصوصی، DNS/Tracker Blocker.

### فاز ۱۵ — بهره‌وری
- یادداشت، وظایف، تقویم شمسی، فایل، PDF/OCR، ماشین‌حساب و مبدل‌ها، ابزارهای سریع.

### فاز ۱۶ — تم‌ساز پیشرفته
- ۲۰ تم کامل، تم‌ساز از متن/عکس/ویدیو/کاور آهنگ، ویرایشگر و تولید آیکون.

### فاز ۱۷ — حالت‌های زمینه‌ای
- ۱۵ حالت با پروفایل رابط، صدا، اعلان و اتوماسیون اختصاصی.

### فاز ۱۸ — دسترس‌پذیری و رابط تطبیقی
- دستیار نابینا/ناشنوا/سالمند/کودک/ADHD، Circadian UI، پیشنهاد فعال.

### فاز ۱۹ — بهینه‌سازی و تست میدانی
- Baseline + Startup Profile، R8 full mode، حذف منابع، کاهش حجم، Macrobenchmark، ماتریس تست اندروید ۱۰ تا ۱۵.
- **هدف عملکرد:** Cold Start < 450ms، Jank < 1%، حجم AAB < 60MB.

### فاز ۲۰ — آزمایشگاه و انتشار
- قابلیت‌های P4 پشت Feature Flag، AAB امضاشده، README فارسی با اسکرین‌شات، مستندات هر ماژول، لیست مجوزها با توضیح فارسی.

---

## 🧪 چرخه تحویل هر فاز
۱. طراحی کوتاه (Design Note) → ۲. پیاده‌سازی → ۳. تست واحد/UI → ۴. Benchmark → ۵. اسکرین‌شات/ویدیو → ۶. به‌روزرسانی ماتریس ردیابی → ۷. **تأیید کارفرما** → فاز بعد.

## 🚦 ریسک‌ها و پاسخ
| ریسک | پاسخ |
|---|---|
| محدودیت AGSL زیر API 33 | فالبک Canvas/Bitmap Shader و کاهش کیفیت خودکار |
| محدودیت سیستمی برای کنترل تنظیمات | استفاده از Accessibility + Settings Panel + راهنمای کاربر |
| مصرف باتری افکت‌های سنگین | بودجه فریم، توقف در پس‌زمینه، پروفایل کیفیت |
| هزینه و محدودیت Gemini API | کلید کاربر، کش، Rate Limit، چند کلید، حالت پایه بدون AI |
| حجم اپ با ۵۰ فونت و انیمیشن | Play Asset Delivery / دانلود درخواستی |
