#define MyAppName "Comicbox Tag Studio"
#define MyAppVersion "1.0.0"
#define MyAppPublisher "Comicbox Tag Studio"
#define MyAppExeName "ComicboxTagStudio.exe"
#define MyReleaseDir "..\\release\\ComicboxTagStudio"

[Setup]
AppId={{F2A82C98-3BE4-4DCE-A357-8AD4A91F0861}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={autopf}\\Comicbox Tag Studio
DefaultGroupName=Comicbox Tag Studio
UninstallDisplayIcon={app}\\{#MyAppExeName}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\\release\\installer
OutputBaseFilename=ComicboxTagStudio-Setup
PrivilegesRequired=admin

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional icons:"; Flags: unchecked
Name: "installunrar"; Description: "Install unrar (recommended for CBR support)"; GroupDescription: "Optional prerequisites:"; Flags: unchecked

[Files]
Source: "{#MyReleaseDir}\\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\\{#MyAppName}"; Filename: "{app}\\{#MyAppExeName}"
Name: "{group}\\Uninstall {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\\{#MyAppName}"; Filename: "{app}\\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\\{#MyAppExeName}"; Description: "Launch {#MyAppName}"; Flags: nowait postinstall skipifsilent
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""if (Get-Command winget -ErrorAction SilentlyContinue) {{ winget install --id RARLab.WinRAR -e --accept-package-agreements --accept-source-agreements }}"""; Tasks: installunrar; Flags: runhidden waituntilterminated
