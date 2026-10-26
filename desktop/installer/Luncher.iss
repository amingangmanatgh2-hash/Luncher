; Inno Setup script for the Luncher Windows companion.
;
; PrivilegesRequired=lowest is deliberate: this installs per-user into %LOCALAPPDATA%
; with no UAC prompt. A config manager has no business demanding administrator
; rights, and an installer that elevates for no reason is exactly what a user
; should be suspicious of.

#define MyAppName "Luncher Companion"
#define MyAppVersion "1.1.0"
#define MyAppPublisher "Luncher"
#define MyAppExeName "Luncher.exe"
; Written into the installer metadata. Updater.CurrentVersion reads the assembly
; version and compares it against the release tag, so if this and the csproj ever
; disagree the app will either never update or update in a loop.
#define MyAppVersionInfo "1.1.0.0"
#define MyAppId "{{7C1F4A5E-9B2D-4C6E-8A3F-1D5E6B7C8A90}"

[Setup]
AppId={#MyAppId}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppSupportURL=https://github.com/amingangmanatgh2-hash/Luncher
AppUpdatesURL=https://github.com/amingangmanatgh2-hash/Luncher/releases
DefaultDirName={autopf}\Luncher
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputDir=..\..\dist
OutputBaseFilename=Luncher-Setup-{#MyAppVersion}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
UninstallDisplayIcon={app}\{#MyAppExeName}
UninstallDisplayName={#MyAppName}
VersionInfoVersion={#MyAppVersionInfo}
CloseApplications=yes
SetupLogging=yes
; No SignTool directive at all. The binary is unsigned: signing needs a
; certificate that costs money and requires verified identity. Leaving the
; directive empty is a hard error for ISCC, and claiming a signature that does
; not exist would be worse than the SmartScreen warning itself.

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "..\publish\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
; Interactive install: offer the launch checkbox.
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#MyAppName}}"; Flags: nowait postinstall skipifsilent
; Silent auto-update: relaunch without prompting. skipifnotsilent is the mirror
; of the entry above, so exactly one of the two runs in each mode. Without this
; an automatic update would close the app and leave the user with nothing open.
Filename: "{app}\{#MyAppExeName}"; Flags: nowait skipifnotsilent

[UninstallDelete]
; Self-contained publishing leaves stray files next to the app that the
; uninstaller would otherwise leave behind.
Type: filesandordirs; Name: "{app}"
