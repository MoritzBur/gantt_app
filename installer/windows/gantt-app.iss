#define AppName "Actual Plan"
#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#define AppExeName "Actual Plan.exe"

[Setup]
AppId={{F1AC1F77-6A7E-4A32-A9B7-6371437E7D84}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=Moritz Bur
DefaultDirName={localappdata}\Programs\Actual Plan
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
OutputDir=..\..\dist\installer
OutputBaseFilename=ActualPlan-Setup-{#AppVersion}
UninstallDisplayIcon={app}\{#AppExeName}
SetupLogging=yes

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; Flags: unchecked

[Files]
Source: "..\..\dist\windows\Actual Plan.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\packaging\windows\launch.vbs"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\packaging\windows\stop.vbs"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\Actual Plan"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\launch.vbs"""; WorkingDir: "{app}"; IconFilename: "{app}\{#AppExeName}"
Name: "{autoprograms}\Stop Actual Plan"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\stop.vbs"""; WorkingDir: "{app}"; IconFilename: "{app}\{#AppExeName}"
Name: "{autodesktop}\Actual Plan"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\launch.vbs"""; WorkingDir: "{app}"; Tasks: desktopicon; IconFilename: "{app}\{#AppExeName}"

[Run]
Filename: "{sys}\wscript.exe"; Parameters: """{app}\launch.vbs"""; Description: "Launch Actual Plan"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{sys}\wscript.exe"; Parameters: """{app}\stop.vbs"""; Flags: runhidden skipifdoesntexist; RunOnceId: "StopGanttApp"
