# Luncher Companion — Windows

## What it is

A WPF **config manager and network diagnostician**. It stores your share links and
subscription URLs and hands them to whichever tunnel client is already installed —
**PattN first**, because PattN carries the `finalMask` / `cipherSuites` support
the panel's presets depend on. A plain v2rayN build may silently ignore part of a
Luncher link, so the client picker orders PattN above everything else.

It is **not a proxy**. See `docs/android.md` for why that boundary is drawn the
same way on both platforms: a Windows tunnel means shipping a Wintun driver,
elevation, and Xray core binaries per architecture.

## Installing

Run `Luncher-Setup-1.0.0.exe` from the
[latest release](https://github.com/amingangmanatgh2-hash/Luncher/releases).

### SmartScreen will warn. This is expected.

**The binary is unsigned.** Code signing requires a certificate that costs money
and requires verified identity, so on first run Windows shows *"Windows protected
your PC"*. Click **More info → Run anyway**.

This is true of every unsigned program, but because this is censorship tooling you
should not be surprised by it — and you should know that the warning says nothing
about whether the file is safe. **Verify the hash instead**, which is the check
that actually means something:

```
certutil -hashfile Luncher-Setup-1.0.0.exe SHA256
```

Compare against `SHA256SUMS-windows.txt`.

Some antivirus products also flag proxy tooling heuristically. That is a false
positive about the category of software, not about this build.

### Per-user install, no administrator rights

`PrivilegesRequired=lowest` in the Inno Setup script means it installs into your
profile with **no UAC prompt**. A config manager has no business demanding
administrator rights, and an installer that elevates for no reason is exactly what
a user ought to be suspicious of.

### Why 49 MB

The build is **self-contained**: it ships the .NET runtime with it. A
framework-dependent build would be about 2 MB, but would then require you to
download the .NET Desktop Runtime from Microsoft — a second download, from a host
that is often slow or blocked on Iranian connections. One download with no
dependencies was the better trade.

`Luncher-Portable-1.0.0.zip` is the same program without the installer: unzip it
anywhere and run `Luncher.exe`. Useful if you cannot or do not want to install.

## Net Melli detection

Same logic as the Android app, and the same reason for existing. The network check
probes domestic and international endpoints in parallel; domestic reachable plus
international unreachable means **the international link is cut**, not that your
config is broken.

A panel on Cloudflare cannot tell you this, because it is outside the country and
only sees its own view of the internet. Only a probe on your machine can.

## Language

Persian is the default and the window lays out right-to-left. The **English**
button in the header switches both the strings and the direction. Bilingual text
is served through `Application.Resources` with `DynamicResource`, so switching
refreshes every binding without any control being named individually.

## Where your data lives

`%APPDATA%\Luncher\store.json`. Plain JSON, no telemetry, nothing leaves the
machine except the subscription fetches you ask for and the network check.

A corrupt store is tolerated: the app still opens, and the next save replaces the
bad file.

## Building it yourself

```
dotnet publish desktop/Luncher.Companion.csproj -c Release -r win-x64 --self-contained true -o desktop/publish
choco install innosetup -y
& "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe" desktop/installer/Luncher.iss
```

The installer is written to `dist/`. Nothing is committed: `desktop/bin`,
`desktop/obj`, `desktop/publish` and `dist` are all ignored, and CI builds every
published artifact from source.
