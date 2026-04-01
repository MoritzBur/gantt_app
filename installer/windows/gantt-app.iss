#define AppName "Gantt App"
#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#define AppExeName "Gantt App.exe"

[Setup]
AppId={{F1AC1F77-6A7E-4A32-A9B7-6371437E7D84}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=Moritz Bur
DefaultDirName={localappdata}\Programs\Gantt App
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
OutputDir=..\..\dist\installer
OutputBaseFilename=GanttApp-Setup-{#AppVersion}
UninstallDisplayIcon={app}\{#AppExeName}
SetupLogging=yes

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; Flags: unchecked

[Files]
Source: "..\..\dist\windows\Gantt App.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\packaging\windows\launch.vbs"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\packaging\windows\stop.vbs"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\Gantt App"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\launch.vbs"""; WorkingDir: "{app}"; IconFilename: "{app}\{#AppExeName}"
Name: "{autoprograms}\Stop Gantt App"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\stop.vbs"""; WorkingDir: "{app}"; IconFilename: "{app}\{#AppExeName}"
Name: "{autodesktop}\Gantt App"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\launch.vbs"""; WorkingDir: "{app}"; Tasks: desktopicon; IconFilename: "{app}\{#AppExeName}"

[Run]
Filename: "{sys}\wscript.exe"; Parameters: """{app}\launch.vbs"""; Description: "Launch Gantt App"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{sys}\wscript.exe"; Parameters: """{app}\stop.vbs"""; Flags: runhidden skipifdoesntexist; RunOnceId: "StopGanttApp"
