using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Luncher.Companion;

public static class ConfigStore
{
    private static readonly string Dir =
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Luncher");
    private static readonly string FilePath = Path.Combine(Dir, "store.json");

    private static readonly JsonSerializerOptions JsonOpts = new()
    {
        WriteIndented = true,
        Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    private static readonly Regex LinkRe =
        new(@"\b(?:vless|trojan|vmess|ss|ssh|socks|http|https|wireguard|hy2|hysteria2?)://[^\s""'<>\\)]+",
            RegexOptions.IgnoreCase | RegexOptions.Compiled);

    public static readonly string[] KnownProtocols =
        { "vless", "trojan", "vmess", "ss", "ssh", "socks", "http", "https", "wireguard", "hy2", "hysteria", "hysteria2" };

    private static Store _cache;

    public static Store Load()
    {
        if (_cache != null) return _cache;
        try
        {
            if (File.Exists(FilePath))
            {
                var json = File.ReadAllText(FilePath, Encoding.UTF8);
                _cache = JsonSerializer.Deserialize<Store>(json) ?? new Store();
            }
        }
        catch
        {
            // A corrupt store must never stop the app from opening; the user can
            // still add links and the next save replaces the bad file.
            _cache = null;
        }
        _cache ??= new Store();
        return _cache;
    }

    public static void Save()
    {
        try
        {
            Directory.CreateDirectory(Dir);
            File.WriteAllText(FilePath, JsonSerializer.Serialize(_cache ?? new Store(), JsonOpts), Encoding.UTF8);
        }
        catch
        {
            // Read-only profile or locked file: losing persistence is better than
            // crashing the UI thread over it.
        }
    }

    public static string ProtocolOf(string link)
    {
        var i = link.IndexOf("://", StringComparison.Ordinal);
        return i > 0 ? link.Substring(0, i).ToLowerInvariant() : "";
    }

    public static string RemarkOf(string link)
    {
        var hash = link.IndexOf('#');
        if (hash < 0 || hash == link.Length - 1) return "";
        try { return Uri.UnescapeDataString(link.Substring(hash + 1)); }
        catch { return link.Substring(hash + 1); }
    }

    // Subscription bodies arrive either as a newline list or as base64 of one.
    // Trying base64 first is wrong: a plain link list can accidentally decode,
    // so scan for links literally first and fall back to base64.
    public static List<string> ExtractLinks(string body)
    {
        var found = new List<string>();
        if (string.IsNullOrWhiteSpace(body)) return found;

        void Collect(string text)
        {
            foreach (Match m in LinkRe.Matches(text))
            {
                var link = m.Value.TrimEnd(',', ';', ')', ']', '}', '.', '"', '\'');
                if (link.Length > 12 && !found.Contains(link)) found.Add(link);
            }
        }

        Collect(body);
        if (found.Count == 0)
        {
            var trimmed = body.Trim();
            if (trimmed.Length % 4 == 0 && Regex.IsMatch(trimmed, "^[A-Za-z0-9+/=\\r\\n]+$"))
            {
                try
                {
                    Collect(Encoding.UTF8.GetString(Convert.FromBase64String(
                        trimmed.Replace("\r", "").Replace("\n", ""))));
                }
                catch { /* not base64 after all */ }
            }
        }
        return found;
    }

    public static SubscriptionItem AddSubscription(string name, string url)
    {
        var s = Load();
        var existing = s.Subs.FirstOrDefault(x =>
            string.Equals(x.Url, url, StringComparison.OrdinalIgnoreCase));
        if (existing != null)
        {
            if (!string.IsNullOrWhiteSpace(name)) existing.Name = name;
            Save();
            return existing;
        }
        var sub = new SubscriptionItem
        {
            Id = Guid.NewGuid().ToString("N"),
            Name = string.IsNullOrWhiteSpace(name) ? url : name,
            Url = url,
        };
        s.Subs.Add(sub);
        Save();
        return sub;
    }

    public static int AddLinks(IEnumerable<string> links, string subId, string subName)
    {
        var s = Load();
        var known = new HashSet<string>(s.Configs.Select(c => c.Link));
        var added = 0;
        foreach (var raw in links)
        {
            var link = raw.Trim();
            if (link.Length == 0 || known.Contains(link)) continue;
            known.Add(link);
            var proto = ProtocolOf(link);
            if (proto.Length == 0) continue;
            var remark = RemarkOf(link);
            s.Configs.Add(new ConfigItem
            {
                Id = Guid.NewGuid().ToString("N"),
                Link = link,
                Protocol = proto,
                Name = string.IsNullOrWhiteSpace(remark)
                    ? proto.ToUpperInvariant() + " " + (s.Configs.Count + 1)
                    : remark,
                SubId = subId ?? "",
                SubName = subName ?? "",
                AddedAt = DateTimeOffset.UtcNow.ToUnixTimeSeconds(),
            });
            added++;
        }
        if (added > 0) Save();
        return added;
    }

    public static void DeleteConfig(string id)
    {
        var s = Load();
        s.Configs.RemoveAll(c => c.Id == id);
        Save();
    }

    public static void DeleteSubscription(string id)
    {
        var s = Load();
        s.Subs.RemoveAll(x => x.Id == id);
        s.Configs.RemoveAll(c => c.SubId == id);
        Save();
    }

    public static void TouchSubscription(string id, int count)
    {
        var s = Load();
        var sub = s.Subs.FirstOrDefault(x => x.Id == id);
        if (sub != null)
        {
            sub.LastFetched = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            sub.Count = count;
            Save();
        }
    }

    public static string UpdateMode
    {
        get
        {
            var m = Load().UpdateMode;
            // Anything unrecognised falls back to auto rather than silently
            // disabling updates, which is the safer of the two defaults here.
            return m == "notify" || m == "off" ? m : "auto";
        }
        set { Load().UpdateMode = value; Save(); }
    }

    public static string Language
    {
        get => Load().Language;
        set { Load().Language = value; Save(); }
    }
}
