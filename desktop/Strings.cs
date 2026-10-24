using System.Collections.Generic;
using System.Windows;

namespace Luncher.Companion;

// Bilingual strings are applied through Application.Resources and referenced from
// XAML with DynamicResource. That is what makes the language switch work without
// naming every control: replacing a resource value refreshes every binding, and
// lookup still resolves inside a ContextMenu, which has its own name scope.
public static class Strings
{
    private static Dictionary<string, string> _current = Fa;

    public static string Get(string key) =>
        _current.TryGetValue(key, out var v) ? v : (En.TryGetValue(key, out var e) ? e : key);

    public static void Apply(string lang)
    {
        _current = lang == "en" ? En : Fa;
        foreach (var kv in _current)
            Application.Current.Resources[kv.Key] = kv.Value;
        // Anything the English table has but the target language does not.
        foreach (var kv in En)
            if (!_current.ContainsKey(kv.Key))
                Application.Current.Resources[kv.Key] = kv.Value;

        if (Application.Current.MainWindow is Window w)
            w.FlowDirection = lang == "fa" ? FlowDirection.RightToLeft : FlowDirection.LeftToRight;
    }

    private static readonly Dictionary<string, string> Fa = new()
    {
        ["K_Title"] = "لانچر — همراه ویندوز",
        ["K_Subtitle"] = "مدیریت کانفیگ و تشخیص وضعیت شبکه",
        ["K_AddLink"] = "افزودن لینک",
        ["K_AddSub"] = "افزودن اشتراک",
        ["K_Refresh"] = "بروزرسانی",
        ["K_CopyAll"] = "کپی همه",
        ["K_Export"] = "خروجی گرفتن",
        ["K_OpenClient"] = "باز کردن کلاینت",
        ["K_NetCheck"] = "بررسی شبکه",
        ["K_Lang"] = "English",
        ["K_Subs"] = "اشتراک‌ها",
        ["K_Configs"] = "کانفیگ‌ها",
        ["K_Copy"] = "کپی لینک",
        ["K_Open"] = "باز کردن در کلاینت",
        ["K_Delete"] = "حذف",
        ["K_Empty"] = "هنوز کانفیگی اضافه نشده",
        ["K_EmptyHint"] = "لینک vless:// یا trojan:// را بچسبانید، یا آدرس اشتراک پنل را وارد کنید.",
        ["K_StatusReady"] = "آماده",
        ["K_Ok"] = "تأیید",
        ["K_Cancel"] = "انصراف",
        ["K_DlgLinkTitle"] = "افزودن لینک",
        ["K_DlgLinkName"] = "نام (اختیاری)",
        ["K_DlgLinkText"] = "لینک یا لینک‌ها (هر خط یکی)",
        ["K_DlgSubTitle"] = "افزودن اشتراک",
        ["K_DlgSubName"] = "نام اشتراک",
        ["K_DlgSubUrl"] = "آدرس اشتراک",
        ["K_AddedMany"] = "{0} کانفیگ اضافه شد",
        ["K_AddedNone"] = "لینک معتبری پیدا نشد",
        ["K_SubFailed"] = "دریافت اشتراک ناموفق: {0}",
        ["K_NeverFetched"] = "هنوز دریافت نشده",
        ["K_SubCount"] = "{0} کانفیگ",
        ["K_NoClient"] = "کلاینتی مثل PattN یا v2rayN پیدا نشد. لینک در کلیپ‌بورد کپی شد؛ آن را در کلاینت خود Import کنید.",
        ["K_Copied"] = "کپی شد",
        ["K_ClientOpened"] = "لینک کپی شد و کلاینت باز شد: {0}",
        ["K_Exported"] = "در این مسیر ذخیره شد: {0}",
        ["K_NetTitle"] = "بررسی وضعیت شبکه",
        ["K_NetRunning"] = "در حال بررسی…",
        ["K_Verdict_normal"] = "اتصال بین‌المللی برقرار است",
        ["K_Verdict_netmelli"] = "نت ملی: فقط سایت‌های داخلی باز می‌شوند",
        ["K_Verdict_offline"] = "اینترنت قطع است",
        ["K_Verdict_partial"] = "اتصال ناپایدار است",
        ["K_NetMelliExplain"] = "سایت‌های داخلی باز می‌شوند ولی بین‌المللی نه. این امضای قطع دسترسی بین‌الملل است، نه خرابی کانفیگ شما. در این حالت هیچ ورکری روی کلودفلر کمک نمی‌کند، چون لبه‌ی کلودفلر از داخل کشور قابل دسترسی نیست.",
        ["K_Domestic"] = "داخلی",
        ["K_International"] = "بین‌المللی",
        ["K_NotATunnel"] = "این برنامه تونل نمی‌زند؛ کانفیگ‌ها را به کلاینتی مثل PattN یا v2rayN می‌سپارد.",
                ["K_BadUrl"] = "آدرس اشتراک معتبر نیست؛ باید http یا https باشد",
        ["K_ClientFound"] = "کلاینت شناسایی شد: {0} ({1} مورد)",
        ["K_ConfigsCount"] = "کانفیگ‌ها ({0})",
        ["K_CopiedAll"] = "{0} لینک کپی شد",
        ["K_FilterTxt"] = "فایل متنی",
        ["K_FilterAll"] = "همه فایل‌ها",
        ["K_NoSubs"] = "هنوز اشتراکی اضافه نشده",
        ["K_Update"] = "بررسی بروزرسانی",
        ["K_UpdateMode"] = "بروزرسانی خودکار: {0}",
        ["K_ModeAuto"] = "خودکار",
        ["K_ModeNotify"] = "فقط اطلاع بده",
        ["K_ModeOff"] = "خاموش",
        ["K_UpdateChecking"] = "در حال بررسی نسخه‌ی جدید…",
        ["K_UpdateLatest"] = "آخرین نسخه را داری ({0})",
        ["K_UpdateDownloading"] = "در حال دانلود بروزرسانی… {0}٪",
        ["K_UpdateInstalling"] = "در حال نصب — برنامه بسته و دوباره باز می‌شود",
        ["K_UpdateNotify"] = "نسخه‌ی {0} آماده است. برای نصب روی «بررسی بروزرسانی» بزن.",
        ["K_UpdateFailed"] = "بروزرسانی ناموفق: {0}",
        ["K_UpdateTrust"] = "بروزرسانی از گیت‌هاب می‌آید و هش SHA256 بررسی می‌شود، ولی فایل امضاشده نیست: چون هش از همان ریلیز می‌آید، سالم بودن دانلود را ثابت می‌کند نه اصالت انتشار را. اگر این اندازه اعتماد نمی‌کنی، حالت را روی «فقط اطلاع بده» یا «خاموش» بگذار.",
        ["K_Save"] = "ذخیره",
    };

    private static readonly Dictionary<string, string> En = new()
    {
        ["K_Title"] = "Luncher — Windows Companion",
        ["K_Subtitle"] = "Config manager and network diagnostician",
        ["K_AddLink"] = "Add link",
        ["K_AddSub"] = "Add subscription",
        ["K_Refresh"] = "Refresh",
        ["K_CopyAll"] = "Copy all",
        ["K_Export"] = "Export",
        ["K_OpenClient"] = "Open client",
        ["K_NetCheck"] = "Check network",
        ["K_Lang"] = "فارسی",
        ["K_Subs"] = "Subscriptions",
        ["K_Configs"] = "Configs",
        ["K_Copy"] = "Copy link",
        ["K_Open"] = "Open in client",
        ["K_Delete"] = "Delete",
        ["K_Empty"] = "No configs yet",
        ["K_EmptyHint"] = "Paste a vless:// or trojan:// link, or add your panel's subscription URL.",
        ["K_StatusReady"] = "Ready",
        ["K_Ok"] = "OK",
        ["K_Cancel"] = "Cancel",
        ["K_DlgLinkTitle"] = "Add link",
        ["K_DlgLinkName"] = "Name (optional)",
        ["K_DlgLinkText"] = "Link or links (one per line)",
        ["K_DlgSubTitle"] = "Add subscription",
        ["K_DlgSubName"] = "Subscription name",
        ["K_DlgSubUrl"] = "Subscription URL",
        ["K_AddedMany"] = "{0} configs added",
        ["K_AddedNone"] = "No valid link found",
        ["K_SubFailed"] = "Subscription failed: {0}",
        ["K_NeverFetched"] = "Not fetched yet",
        ["K_SubCount"] = "{0} configs",
        ["K_NoClient"] = "No client such as PattN or v2rayN was found. The link was copied to the clipboard — import it in your client.",
        ["K_Copied"] = "Copied",
        ["K_ClientOpened"] = "Link copied and client launched: {0}",
        ["K_Exported"] = "Saved to {0}",
        ["K_NetTitle"] = "Network status",
        ["K_NetRunning"] = "Checking…",
        ["K_Verdict_normal"] = "International connectivity is working",
        ["K_Verdict_netmelli"] = "Net Melli: only domestic sites are reachable",
        ["K_Verdict_offline"] = "No internet connectivity",
        ["K_Verdict_partial"] = "Connectivity is unstable",
        ["K_NetMelliExplain"] = "Domestic sites load but international ones do not. That is the signature of the international link being cut — not of a broken config. No Cloudflare Worker can help in this state, because the Cloudflare edge itself is unreachable from inside the country.",
        ["K_Domestic"] = "Domestic",
        ["K_International"] = "International",
        ["K_NotATunnel"] = "This app does not tunnel. It hands configs to a client such as PattN or v2rayN.",
                ["K_BadUrl"] = "That is not a valid subscription URL (must be http or https)",
        ["K_ClientFound"] = "Client detected: {0} ({1} found)",
        ["K_ConfigsCount"] = "Configs ({0})",
        ["K_CopiedAll"] = "{0} links copied",
        ["K_FilterTxt"] = "Text file",
        ["K_FilterAll"] = "All files",
        ["K_NoSubs"] = "No subscriptions yet",
        ["K_Update"] = "Check for updates",
        ["K_UpdateMode"] = "Auto-update: {0}",
        ["K_ModeAuto"] = "on",
        ["K_ModeNotify"] = "notify only",
        ["K_ModeOff"] = "off",
        ["K_UpdateChecking"] = "Checking for a newer release…",
        ["K_UpdateLatest"] = "You are on the latest version ({0})",
        ["K_UpdateDownloading"] = "Downloading update… {0}%",
        ["K_UpdateInstalling"] = "Installing — the app will close and reopen",
        ["K_UpdateNotify"] = "Version {0} is available. Press Check for updates to install it.",
        ["K_UpdateFailed"] = "Update failed: {0}",
        ["K_UpdateTrust"] = "Updates come from GitHub Releases and the SHA256 is verified, but the binary is unsigned: the checksum ships in the same release, so it proves the download is intact, not that the release is authentic. If that is not enough trust for you, set the mode to notify-only or off.",
        ["K_Save"] = "Save",
    };
}
