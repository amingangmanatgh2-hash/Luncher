using System;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Reflection;
using System.Security.Cryptography;
using System.Text.Json;
using System.Threading.Tasks;

namespace Luncher.Companion;

public sealed class UpdateInfo
{
    public bool Available { get; set; }
    public string Tag { get; set; } = "";
    public string Version { get; set; } = "";
    public string InstallerUrl { get; set; } = "";
    public string SumsUrl { get; set; } = "";
    public long Size { get; set; }
    public string Error { get; set; } = "";
    public bool Checked { get; set; }
}

/// <summary>
/// Checks GitHub Releases for a newer installer and applies it.
///
/// TRUST MODEL — read this before trusting the update path:
///
/// The binary is UNSIGNED (a code-signing certificate costs money and requires
/// verified identity), and SHA256SUMS-windows.txt is published in the same
/// release as the installer it describes. Verifying one against the other
/// therefore proves the download was not corrupted or swapped in transit — it
/// does NOT prove the release is authentic, because an attacker who could write
/// to the release could write to both files.
///
/// This is a real limitation and it is the reason the update mode is a user
/// setting rather than a silent default that cannot be turned off: automatically
/// installing an unverifiable binary is a trust decision that belongs to the
/// person running it, not to us. "notify" and "off" are both one click away.
/// </summary>
public static class Updater
{
    public const string Repo = "amingangmanatgh2-hash/Luncher";
    private const string LatestUrl = "https://api.github.com/repos/" + Repo + "/releases/latest";
    private const string InstallerPrefix = "Luncher-Setup-";

    /// <summary>Three components, so 1.0.0.0 compares equal to a tag of app-v1.0.0.</summary>
    public static string CurrentVersion =>
        (Assembly.GetExecutingAssembly().GetName().Version ?? new Version(1, 0, 0)).ToString(3);

    public static async Task<UpdateInfo> CheckAsync()
    {
        var info = new UpdateInfo { Checked = true };
        try
        {
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(20) };
            // api.github.com rejects requests with no User-Agent.
            http.DefaultRequestHeaders.UserAgent.ParseAdd("LuncherCompanion/" + CurrentVersion + " (+update-check)");
            http.DefaultRequestHeaders.Accept.ParseAdd("application/vnd.github+json");

            var json = await http.GetStringAsync(LatestUrl);
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;

            info.Tag = root.TryGetProperty("tag_name", out var t) ? t.GetString() ?? "" : "";
            if (root.TryGetProperty("draft", out var dr) && dr.GetBoolean())
            {
                info.Error = "latest release is a draft";
                return info;
            }

            // Tags look like "app-v1.2.3"; tolerate a bare "v1.2.3" or "1.2.3" too.
            var raw = info.Tag;
            var i = raw.IndexOf('v');
            var verText = i >= 0 ? raw.Substring(i + 1) : raw;
            if (!Version.TryParse(verText, out var remote))
            {
                info.Error = "could not parse version from tag " + info.Tag;
                return info;
            }
            info.Version = remote.ToString(3);

            if (!root.TryGetProperty("assets", out var assets))
            {
                info.Error = "release has no assets";
                return info;
            }

            foreach (var a in assets.EnumerateArray())
            {
                var name = a.TryGetProperty("name", out var n) ? n.GetString() ?? "" : "";
                var url = a.TryGetProperty("browser_download_url", out var u) ? u.GetString() ?? "" : "";
                var size = a.TryGetProperty("size", out var sz) && sz.TryGetInt64(out var l) ? l : 0;
                if (name.StartsWith(InstallerPrefix, StringComparison.OrdinalIgnoreCase) &&
                    name.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
                {
                    info.InstallerUrl = url;
                    info.Size = size;
                }
                else if (name.Equals("SHA256SUMS-windows.txt", StringComparison.OrdinalIgnoreCase))
                {
                    info.SumsUrl = url;
                }
            }

            if (string.IsNullOrEmpty(info.InstallerUrl))
            {
                info.Error = "no installer asset in " + info.Tag;
                return info;
            }

            if (!Version.TryParse(CurrentVersion, out var local)) local = new Version(0, 0, 0);
            info.Available = remote > local;
            return info;
        }
        catch (Exception ex)
        {
            info.Error = ex is HttpRequestException ? (ex.Message ?? ex.GetType().Name) : ex.GetType().Name;
            return info;
        }
    }

    /// <summary>
    /// Downloads the installer and the checksum file, then verifies one against
    /// the other. Returns the local path only when the hash matched.
    /// </summary>
    public static async Task<(bool ok, string path, string error)> DownloadAndVerifyAsync(
        UpdateInfo info, IProgress<double> progress)
    {
        try
        {
            var dir = Path.Combine(Path.GetTempPath(), "LuncherUpdate");
            Directory.CreateDirectory(dir);
            var fileName = Path.GetFileName(new Uri(info.InstallerUrl).AbsolutePath);
            if (string.IsNullOrEmpty(fileName) || fileName.IndexOfAny(Path.GetInvalidFileNameChars()) >= 0)
                return (false, "", "installer asset has an unusable filename");
            var target = Path.Combine(dir, fileName);

            using var http = new HttpClient { Timeout = TimeSpan.FromMinutes(10) };
            http.DefaultRequestHeaders.UserAgent.ParseAdd("LuncherCompanion/" + CurrentVersion + " (+update-download)");

            using (var resp = await http.GetAsync(info.InstallerUrl, HttpCompletionOption.ResponseHeadersRead))
            {
                resp.EnsureSuccessStatusCode();
                long total = resp.Content.Headers.ContentLength ?? Math.Max(info.Size, 1);
                await using var src = await resp.Content.ReadAsStreamAsync();
                await using var dst = File.Create(target);
                var buf = new byte[81920];
                long done = 0;
                int read;
                while ((read = await src.ReadAsync(buf, 0, buf.Length)) > 0)
                {
                    await dst.WriteAsync(buf, 0, read);
                    done += read;
                    progress?.Report(Math.Min(1.0, (double)done / total));
                }
            }

            // Fetch the published checksums. If they cannot be obtained the update
            // is refused: installing an unverified binary is exactly the failure
            // mode this step exists to prevent.
            if (string.IsNullOrEmpty(info.SumsUrl))
                return (false, "", "release publishes no SHA256SUMS-windows.txt; refusing to install unverified");

            string sums;
            using (var resp = await http.GetAsync(info.SumsUrl))
            {
                resp.EnsureSuccessStatusCode();
                sums = await resp.Content.ReadAsStringAsync();
            }

            var expected = ParseExpectedHash(sums, fileName);
            if (expected == null)
                return (false, "", "no checksum published for " + fileName + "; refusing to install unverified");

            string actual;
            using (var sha = SHA256.Create())
            await using (var fs = File.OpenRead(target))
                actual = BitConverter.ToString(sha.ComputeHash(fs)).Replace("-", "");

            if (!string.Equals(actual, expected, StringComparison.OrdinalIgnoreCase))
            {
                try { File.Delete(target); } catch { /* best effort */ }
                return (false, "", "checksum mismatch: expected " + expected + ", got " + actual);
            }

            progress?.Report(1.0);
            return (true, target, "");
        }
        catch (Exception ex)
        {
            return (false, "", ex.Message ?? ex.GetType().Name);
        }
    }

    /// <summary>
    /// Both `sha256sum` (lowercase, "<hash>  <file>") and PowerShell's Get-FileHash
    /// (uppercase, same shape) are accepted, because the two platform workflows
    /// produce the file with different tools.
    /// </summary>
    internal static string ParseExpectedHash(string sums, string fileName)
    {
        foreach (var line in (sums ?? "").Split('\n'))
        {
            var parts = line.Trim().Split(new[] { ' ', '\t' }, StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length < 2) continue;
            var hash = parts[0];
            var name = parts[parts.Length - 1].TrimStart('*');
            if (hash.Length != 64) continue;
            if (string.Equals(name, fileName, StringComparison.OrdinalIgnoreCase)) return hash;
        }
        return null;
    }

    /// <summary>
    /// Runs the installer silently and returns whether it started. The caller is
    /// expected to shut the app down immediately afterwards: the installer needs
    /// to replace files that this process currently has open.
    /// </summary>
    public static bool Install(string installerPath)
    {
        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = installerPath,
                // /RESTARTAPPLICATIONS plus the skipifnotsilent [Run] entry in the
                // Inno script is what brings the app back after a silent update.
                Arguments = "/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /CLOSEAPPLICATIONS /RESTARTAPPLICATIONS",
                UseShellExecute = true,
            });
            return true;
        }
        catch
        {
            return false;
        }
    }
}
