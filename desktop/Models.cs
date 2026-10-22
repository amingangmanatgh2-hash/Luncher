using System;
using System.Collections.Generic;

namespace Luncher.Companion;

// Plain data classes with public settable properties so WPF can bind to them and
// System.Text.Json can round-trip them without custom converters.

public sealed class ConfigItem
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string Link { get; set; } = "";
    public string Protocol { get; set; } = "";
    public string SubId { get; set; } = "";
    public string SubName { get; set; } = "";
    public long AddedAt { get; set; }

    // Bound by the list template. Computed, so it never drifts out of sync.
    public string Detail => string.IsNullOrEmpty(SubName) ? Protocol : Protocol + "  ·  " + SubName;
}

public sealed class SubscriptionItem
{
    public string Id { get; set; } = "";
    public string Name { get; set; } = "";
    public string Url { get; set; } = "";
    public long LastFetched { get; set; }
    public int Count { get; set; }

    public string Detail => Count == 0
        ? Strings.Get("K_NeverFetched")
        : string.Format(Strings.Get("K_SubCount"), Count);
}

public sealed class Store
{
    public string Language { get; set; } = "fa";
    public List<ConfigItem> Configs { get; set; } = new();
    public List<SubscriptionItem> Subs { get; set; } = new();
}

public sealed class ProbeResult
{
    public string Host { get; set; } = "";
    public bool Domestic { get; set; }
    public bool Ok { get; set; }
    public int Status { get; set; }
    public long Ms { get; set; }
    public string Error { get; set; } = "";
}

public sealed class NetVerdict
{
    public string Code { get; set; } = "offline";   // normal | netmelli | offline | partial
    public List<ProbeResult> Results { get; set; } = new();
}
