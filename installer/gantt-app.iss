#ifndef AppVersion
  #define AppVersion "0.0.0-dev"
#endif

#ifndef SourceDir
  #define SourceDir ".."
#endif

#ifndef OutputDir
  #define OutputDir "."
#endif

[Setup]
AppId={{2B8A6517-BA87-4809-9F26-2493646B5BA0}
AppName=Gantt App
AppVersion={#AppVersion}
AppVerName=Gantt App {#AppVersion}
AppPublisher=Moritz Bur
DefaultDirName={localappdata}\Gantt App
DefaultGroupName=Gantt App
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
WizardStyle=modern
Compression=lzma2
SolidCompression=yes
SetupIconFile={#SourceDir}\icons\gantt-app.ico
UninstallDisplayIcon={app}\icons\gantt-app.ico
OutputDir={#OutputDir}
OutputBaseFilename=GanttApp-Setup-{#AppVersion}
UsePreviousAppDir=yes
SetupLogging=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional shortcuts:"; Flags: unchecked
Name: "autostart"; Description: "Start Gantt App when I sign in"; GroupDescription: "Additional shortcuts:"; Flags: unchecked

[Dirs]
Name: "{userdocs}\Gantt App Data"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Excludes: ".git\*,.gitignore,.claude\*,.codex,.codex\*,.playwright-mcp\*,node_modules\*,client\dist\*,data\*,data-dev\*,.env,installer\dist\*,installer\staging\*,Thumbs.db,.DS_Store"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{autoprograms}\Gantt App"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\launch-windows.vbs"""; WorkingDir: "{app}"; IconFilename: "{app}\icons\gantt-app.ico"; Comment: "Launch Gantt App"
Name: "{autodesktop}\Gantt App"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\launch-windows.vbs"""; WorkingDir: "{app}"; IconFilename: "{app}\icons\gantt-app.ico"; Comment: "Launch Gantt App"; Tasks: desktopicon
Name: "{userstartup}\Gantt App"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\launch-windows.vbs"" -Quiet"; WorkingDir: "{app}"; IconFilename: "{app}\icons\gantt-app.ico"; Comment: "Start Gantt App quietly when you sign in"; Tasks: autostart

[Run]
Filename: "{sys}\wscript.exe"; Parameters: """{app}\launch-windows.vbs"""; WorkingDir: "{app}"; Description: "Launch Gantt App now"; Flags: postinstall skipifsilent nowait

[Code]
const
  NodeDownloadUrl = 'https://nodejs.org/';

var
  SetupPrepared: Boolean;

function OfferNodeDownload(const Message: string): Boolean;
var
  ErrorCode: Integer;
begin
  if MsgBox(
    Message + #13#10#13#10 + 'Click Yes to open nodejs.org, then run the installer again.',
    mbError,
    MB_YESNO
  ) = IDYES then begin
    ShellExec('open', NodeDownloadUrl, '', '', SW_SHOWNORMAL, ewNoWait, ErrorCode);
  end;

  Result := False;
end;

function RunCmdCheck(const Parameters: string; const FailureMessage: string): Boolean;
var
  ResultCode: Integer;
begin
  Result :=
    Exec(ExpandConstant('{cmd}'), Parameters, '', SW_HIDE, ewWaitUntilTerminated, ResultCode) and
    (ResultCode = 0);

  if not Result then begin
    Result := OfferNodeDownload(FailureMessage);
  end;
end;

function CheckNodeAndNpm(): Boolean;
begin
  if not RunCmdCheck('/C where node.exe >nul 2>nul', 'Node.js 20 or newer is required to install Gantt App.') then begin
    Result := False;
    exit;
  end;

  if not RunCmdCheck('/C node -e "process.exit(Number(process.versions.node.split(''.'')[0]) >= 20 ? 0 : 20)"', 'Detected Node.js is too old. Please install Node.js 20 or newer to continue.') then begin
    Result := False;
    exit;
  end;

  Result := RunCmdCheck('/C where npm.cmd >nul 2>nul', 'npm was not found. Please reinstall Node.js from nodejs.org and run this installer again.');
end;

function InitializeSetup(): Boolean;
begin
  Result := CheckNodeAndNpm();
end;

function QuotePowerShellArgument(Value: string): string;
begin
  StringChangeEx(Value, '"', '\"', True);
  Result := '"' + Value + '"';
end;

procedure RunAppSetup();
var
  PowerShellExe: string;
  Parameters: string;
  ResultCode: Integer;
  DataDir: string;
begin
  if SetupPrepared then begin
    exit;
  end;

  SetupPrepared := True;
  DataDir := ExpandConstant('{userdocs}\Gantt App Data');
  PowerShellExe := ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe');

  if not FileExists(PowerShellExe) then begin
    PowerShellExe := 'powershell.exe';
  end;

  Parameters :=
    '-NoLogo -NoProfile -ExecutionPolicy Bypass -File ' +
    QuotePowerShellArgument(ExpandConstant('{app}\setup.ps1')) +
    ' -BuildProductionAssets -DefaultDataDir ' +
    QuotePowerShellArgument(DataDir);

  WizardForm.StatusLabel.Caption := 'Installing dependencies and building Gantt App...';
  WizardForm.Update();

  if not Exec(PowerShellExe, Parameters, ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, ResultCode) then begin
    RaiseException('The bundled setup helper could not be started.');
  end;

  if ResultCode <> 0 then begin
    RaiseException(
      Format(
        'Gantt App setup failed with exit code %d.'#13#10#13#10 +
        'Please make sure Node.js and npm work in a normal PowerShell window, then run the installer again.',
        [ResultCode]
      )
    );
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then begin
    RunAppSetup();
  end;
end;
