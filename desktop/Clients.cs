using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using Microsoft.Win32;

namespace Luncher.Companion;

public sealed class FoundClient
{
    public string Name { get; set; } = "";
    public string Path { get; set; } = "";
    public string Detail => Path;
}

// Locates the tunnel client the user already has and hands the link to it. This is
// the deliberate scope boundary: building a Windows tunnel means shipping a Wintun
// driver, elevation, and Xray core binaries per ABI, and an installer that quietly
// fails to route traffic is worse than one that drives a maintained client.
public static class Clients
{
    private static readonly string[] ExeNames =
        { "PattN.exe", "v2rayN.exe", "Hiddify.exe", "NekoRay.exe", "nekoray.exe", "XrayN.exe" };

    public static List<FoundClient> Detect()
    {
        var found = new List<FoundClient>();
        void Add(string name, string path)
        {
            if (string.IsNullOrEmpty(path) || !File.Exists(path)) return;
            if (found.Any(f => string.Equals(f.Path, path, StringComparison.OrdinalIgnoreCase))) return;
            found.Add(new FoundClient { Name = name, Path = path });
        }

        foreach (var exe in ExeNames)
            foreach (var dir in CandidateDirs())
                Add(Path.GetFileNameWithoutExtension(exe), Path.Combine(dir, exe));

        foreach (var c in FromRegistry()) Add(c.Name, c.Path);

        // PattN first: it carries the finalMask/cipherSuites support the panel's
        // presets depend on, so a plain v2rayN build may ignore part of the link.
        return found
            .OrderByDescending(f => f.Name.IndexOf("patt", StringComparison.OrdinalIgnoreCase) >= 0)
            .ThenBy(f => f.Name)
            .ToList();
    }

    private static IEnumerable<string> CandidateDirs()
    {
        var roots = new List<string>();
        foreach (var folder in new[]
                 {
                     Environment.SpecialFolder.LocalApplicationData,
                     Environment.SpecialFolder.ProgramFiles,
                     Environment.SpecialFolder.ProgramFilesX86,
                     Environment.SpecialFolder.ApplicationData,
                     Environment.SpecialFolder.DesktopDirectory,
                 })
        {
            try { roots.Add(Environment.GetFolderPath(folder)); } catch { /* not present */ }
        }

        foreach (var root in roots.Where(r => !string.IsNullOrEmpty(r) && Directory.Exists(r)))
        {
            yield return root;
            foreach (var name in new[] { "PattN", "v2rayN", "Hiddify", "NekoRay", "Luncher" })
            {
                var p = Path.Combine(root, name);
                if (Directory.Exists(p)) yield return p;
            }
        }

        // Also look one level down, where portable unzips usually land.
        foreach (var root in roots.Where(r => !string.IsNullOrEmpty(r) && Directory.Exists(r)))
        {
            IEnumerable<string> subs;
            try { subs = Directory.GetDirectories(root); } catch { continue; }
            foreach (var sub in subs)
            {
                var leaf = Path.GetFileName(sub);
                if (leaf.IndexOf("patt", StringComparison.OrdinalIgnoreCase) >= 0 ||
                    leaf.IndexOf("v2ray", StringComparison.OrdinalIgnoreCase) >= 0 ||
                    leaf.IndexOf("hiddify", StringComparison.OrdinalIgnoreCase) >= 0 ||
                    leaf.IndexOf("neko", StringComparison.OrdinalIgnoreCase) >= 0)
                    yield return sub;
            }
        }
    }

    private static IEnumerable<FoundClient> FromRegistry()
    {
        var results = new List<FoundClient>();
        var hives = new[] { RegistryHive.LocalMachine, RegistryHive.CurrentUser };
        var views = new[] { RegistryView.Registry64, RegistryView.Registry32 };
        var keys = new[]
        {
            @"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
            @"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall",
        };

        foreach (var hive in hives)
        foreach (var view in views)
        foreach (var key in keys)
        {
            try
            {
                using var root = RegistryKey.OpenBaseKey(hive, view);
                using var un = root.OpenSubKey(key);
                if (un == null) continue;
                foreach (var sub in un.GetSubKeyNames())
                {
                    try
                    {
                        using var k = un.OpenSubKey(sub);
                        var display = k?.GetValue("DisplayName") as string ?? "";
                        var loc = k?.GetValue("InstallLocation") as string ?? "";
                        var icon = k?.GetValue("DisplayIcon") as string ?? "";
                        var interesting = ExeNames.Any(e =>
                            display.IndexOf(Path.GetFileNameWithoutExtension(e),
                                StringComparison.OrdinalIgnoreCase) >= 0);
                        if (!interesting) continue;

                        var exe = ExeNames.FirstOrDefault(e =>
                            display.IndexOf(Path.GetFileNameWithoutExtension(e),
                                StringComparison.OrdinalIgnoreCase) >= 0) ?? ExeNames[0];

                        if (!string.IsNullOrEmpty(loc) && Directory.Exists(loc))
                            results.Add(new FoundClient { Name = display, Path = Path.Combine(loc, exe) });
                        if (!string.IsNullOrEmpty(icon))
                        {
                            // DisplayIcon is often "path,0" — strip the index.
                            var p = icon.Split(',')[0].Trim('"');
                            if (p.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
                                results.Add(new FoundClient { Name = display, Path = p });
                        }
                    }
                    catch { /* unreadable subkey */ }
                }
            }
            catch { /* hive/view/key not available */ }
        }
        return results.Where(r => File.Exists(r.Path));
    }

    // Returns null when nothing could be launched. The caller then falls back to
    // "the link is on your clipboard", which is always true and always workable.
    public static string Launch(FoundClient client, string link)
    {
        try
        {
            System.Windows.Clipboard.SetText(link);
        }
        catch { /* clipboard can be locked by another process */ }

        if (client == null) return null;
        try
        {
            // The link is also passed as an argument. Forks that support it import
            // directly; those that do not simply ignore it, and the clipboard copy
            // above still covers them.
            Process.Start(new ProcessStartInfo
            {
                FileName = client.Path,
                Arguments = "\"" + link + "\"",
                UseShellExecute = true,
            });
            return client.Name;
        }
        catch
        {
            return null;
        }
    }
}
