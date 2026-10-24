using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Net.Http;
using System.Threading.Tasks;

namespace Luncher.Companion;

// The point of this class is a distinction no server can make. A panel running on
// Cloudflare sits outside Iran and only ever sees its own view of the internet, so
// it cannot tell "your config is broken" from "your country's international link
// is cut". Probing domestic and international endpoints from the machine itself
// can: domestic reachable plus international unreachable is the Net Melli case.
public static class NetProbe
{
    private static readonly (string Url, bool Domestic)[] Targets =
    {
        ("https://www.aparat.com/",              true),
        ("https://www.digikala.com/",            true),
        ("https://snapp.ir/",                    true),
        ("https://cp.cloudflare.com/generate_204", false),
        ("https://www.gstatic.com/generate_204",   false),
        ("https://clients3.google.com/generate_204", false),
    };

    public static async Task<NetVerdict> DiagnoseAsync()
    {
        using var handler = new HttpClientHandler { AllowAutoRedirect = false };
        using var http = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(6) };
        http.DefaultRequestHeaders.UserAgent.ParseAdd("LuncherCompanion/1.0 (+net-melli-probe)");

        var tasks = Targets.Select(t => ProbeAsync(http, t.Url, t.Domestic)).ToArray();
        var results = (await Task.WhenAll(tasks)).ToList();

        var dom = results.Where(r => r.Domestic).ToList();
        var intl = results.Where(r => !r.Domestic).ToList();
        int domOk = dom.Count(r => r.Ok), intlOk = intl.Count(r => r.Ok);

        string code;
        if (domOk == 0 && intlOk == 0) code = "offline";
        else if (domOk > 0 && intlOk == 0) code = "netmelli";
        else if (intlOk > 0) code = "normal";
        else code = "partial";

        return new NetVerdict { Code = code, Results = results };
    }

    private static async Task<ProbeResult> ProbeAsync(HttpClient http, string url, bool domestic)
    {
        var host = new Uri(url).Host;
        var sw = Stopwatch.StartNew();
        try
        {
            // Only the status line matters; never buffer the body.
            using var resp = await http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead);
            sw.Stop();
            int code = (int)resp.StatusCode;
            // 2xx and 3xx both prove the TLS handshake and a real server answer,
            // which is all this probe is testing. 403 does not: a filter can
            // answer that itself.
            return new ProbeResult
            {
                Host = host, Domestic = domestic, Status = code, Ms = sw.ElapsedMilliseconds,
                Ok = code is >= 200 and < 400,
            };
        }
        catch (Exception ex)
        {
            sw.Stop();
            return new ProbeResult
            {
                Host = host, Domestic = domestic, Ms = sw.ElapsedMilliseconds,
                Ok = false, Error = ex.GetType().Name,
            };
        }
    }
}
