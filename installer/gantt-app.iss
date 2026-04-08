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
AppName=Actual Plan
AppVersion={#AppVersion}
AppVerName=Actual Plan {#AppVersion}
AppPublisher=Moritz Bur
DefaultDirName={localappdata}\Actual Plan
DefaultGroupName=Actual Plan
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
WizardStyle=modern
Compression=lzma2
SolidCompression=yes
SetupIconFile={#SourceDir}\icons\gantt-app.ico
UninstallDisplayIcon={app}\icons\gantt-app.ico
OutputDir={#OutputDir}
OutputBaseFilename=ActualPlan-Setup-{#AppVersion}
UsePreviousAppDir=yes
SetupLogging=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional shortcuts:"; Flags: unchecked
Name: "autostart"; Description: "Start Actual Plan when I sign in"; GroupDescription: "Additional shortcuts:"; Flags: unchecked

[Dirs]
Name: "{userdocs}\Actual Plan Data"

[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Excludes: ".git\*,.gitignore,.claude\*,.codex,.codex\*,.playwright-mcp\*,node_modules\*,client\dist\*,data\*,data-dev\*,.env,installer\dist\*,installer\staging\*,Thumbs.db,.DS_Store"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{autoprograms}\Actual Plan"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\launch-windows.vbs"""; WorkingDir: "{app}"; IconFilename: "{app}\icons\gantt-app.ico"; Comment: "Launch Actual Plan"
Name: "{autodesktop}\Actual Plan"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\launch-windows.vbs"""; WorkingDir: "{app}"; IconFilename: "{app}\icons\gantt-app.ico"; Comment: "Launch Actual Plan"; Tasks: desktopicon
Name: "{userstartup}\Actual Plan"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\launch-windows.vbs"" -Quiet"; WorkingDir: "{app}"; IconFilename: "{app}\icons\gantt-app.ico"; Comment: "Start Actual Plan quietly when you sign in"; Tasks: autostart

[Run]
Filename: "{sys}\wscript.exe"; Parameters: """{app}\launch-windows.vbs"""; WorkingDir: "{app}"; Description: "Launch Actual Plan now"; Flags: postinstall skipifsilent nowait

[Code]
const
  NodeDownloadUrl = 'https://nodejs.org/';

var
  SetupPrepared: Boolean;
  PreflightPage: TWizardPage;
  PreflightMemo: TNewMemo;
  NodeDetected: Boolean;
  NodeVersionValid: Boolean;
  NpmDetected: Boolean;
  NodeVersionText: string;
  NpmVersionText: string;

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

function ReadCommandOutput(const Command: string; var Output: string; var ResultCode: Integer): Boolean;
var
  TempPath: string;
  RawOutput: AnsiString;
begin
  TempPath := ExpandConstant('{tmp}\gantt-installer-check.txt');
  if FileExists(TempPath) then begin
    DeleteFile(TempPath);
  end;

  Result := Exec(
    ExpandConstant('{cmd}'),
    '/C ' + Command + ' > "' + TempPath + '" 2>&1',
    '',
    SW_HIDE,
    ewWaitUntilTerminated,
    ResultCode
  );

  Output := '';
  if FileExists(TempPath) then begin
    RawOutput := '';
    LoadStringFromFile(TempPath, RawOutput);
    Output := RawOutput;
    DeleteFile(TempPath);
  end;

  Output := Trim(Output);
end;

procedure DetectDependencies();
var
  Output: string;
  ResultCode: Integer;
begin
  NodeDetected := ReadCommandOutput('where node.exe', Output, ResultCode) and (ResultCode = 0);
  if NodeDetected and ReadCommandOutput('node -v', Output, ResultCode) and (ResultCode = 0) then begin
    NodeVersionText := Output;
  end else if NodeDetected then begin
    NodeVersionText := 'found on PATH';
  end else begin
    NodeVersionText := 'not found';
  end;

  if NodeDetected then begin
    NodeVersionValid :=
      ReadCommandOutput(
        'node -e "process.stdout.write(process.versions.node.split(''.'')[0])"',
        Output,
        ResultCode
      ) and
      (ResultCode = 0) and
      (StrToIntDef(Output, 0) >= 20);
  end else begin
    NodeVersionValid := False;
  end;

  NpmDetected := ReadCommandOutput('where npm.cmd', Output, ResultCode) and (ResultCode = 0);
  if NpmDetected and ReadCommandOutput('npm -v', Output, ResultCode) and (ResultCode = 0) then begin
    NpmVersionText := Output;
  end else if NpmDetected then begin
    NpmVersionText := 'found on PATH';
  end else begin
    NpmVersionText := 'not found';
  end;
end;

function DependenciesMet(): Boolean;
begin
  Result := NodeDetected and NodeVersionValid and NpmDetected;
end;

function NodeRequirementStatusText(): string;
begin
  if NodeVersionValid then begin
    Result := 'met';
  end else begin
    Result := 'not met';
  end;
end;

function CurrentInstallDirText(): string;
begin
  Result := WizardDirValue();
  if Result = '' then begin
    Result := ExpandConstant('{localappdata}\Actual Plan');
  end;
end;

function BuildPreflightText(): string;
begin
  Result :=
    'This installer is a per-user install. Admin rights are not required.' + #13#10#13#10 +
    'Install plan:' + #13#10 +
    '- App files: ' + CurrentInstallDirText() + #13#10 +
    '- Data folder: ' + ExpandConstant('{userdocs}\Actual Plan Data') + #13#10 +
    '- During setup: copy files, run npm install, generate .env, build the frontend, and create shortcuts.' + #13#10#13#10 +
    'Dependency check:' + #13#10 +
    '- Node.js: ' + NodeVersionText + #13#10 +
    '- Node.js >= 20 requirement: ' + NodeRequirementStatusText() + #13#10 +
    '- npm: ' + NpmVersionText + #13#10#13#10;

  if DependenciesMet() then begin
    Result :=
      Result +
      'Status: prerequisites look good. You can continue with the installation.';
  end else begin
    Result :=
      Result +
      'Status: prerequisites are incomplete.' + #13#10 +
      'Install Node.js 20 or newer from nodejs.org, then run this installer again.';
  end;
end;

procedure RefreshPreflightPage();
begin
  DetectDependencies();
  PreflightMemo.Text := BuildPreflightText();
end;

function BuildDependencyFailureMessage(): string;
begin
  Result :=
    'Actual Plan needs Node.js 20 or newer and npm before setup can continue.' + #13#10#13#10 +
    'Detected Node.js: ' + NodeVersionText + #13#10 +
    'Detected npm: ' + NpmVersionText;
end;

function InitializeSetup(): Boolean;
begin
  Result := True;
end;

function QuotePowerShellArgument(Value: string): string;
begin
  StringChangeEx(Value, '"', '\"', True);
  Result := '"' + Value + '"';
end;

procedure InitializeWizard();
begin
  DetectDependencies();

  PreflightPage :=
    CreateCustomPage(
      wpSelectTasks,
      'System Check',
      'Review the install plan and dependency status before continuing.'
    );

  PreflightMemo := TNewMemo.Create(PreflightPage);
  PreflightMemo.Parent := PreflightPage.Surface;
  PreflightMemo.Left := 0;
  PreflightMemo.Top := 0;
  PreflightMemo.Width := PreflightPage.SurfaceWidth;
  PreflightMemo.Height := PreflightPage.SurfaceHeight;
  PreflightMemo.ReadOnly := True;
  PreflightMemo.WantReturns := False;
  PreflightMemo.ScrollBars := ssVertical;

  RefreshPreflightPage();
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
  DataDir := ExpandConstant('{userdocs}\Actual Plan Data');
  PowerShellExe := ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe');

  if not FileExists(PowerShellExe) then begin
    PowerShellExe := 'powershell.exe';
  end;

  Parameters :=
    '-NoLogo -NoProfile -ExecutionPolicy Bypass -File ' +
    QuotePowerShellArgument(ExpandConstant('{app}\setup.ps1')) +
    ' -BuildProductionAssets -DefaultDataDir ' +
    QuotePowerShellArgument(DataDir);

  WizardForm.StatusLabel.Caption :=
    'Running app setup: npm install, environment setup, and frontend build. This can take a minute.';
  WizardForm.Update();

  if not Exec(PowerShellExe, Parameters, ExpandConstant('{app}'), SW_HIDE, ewWaitUntilTerminated, ResultCode) then begin
    RaiseException('The bundled setup helper could not be started.');
  end;

  if ResultCode <> 0 then begin
    RaiseException(
      'Actual Plan setup failed with exit code ' + IntToStr(ResultCode) + '.'#13#10#13#10 +
      'Please make sure Node.js and npm work in a normal PowerShell window, then run the installer again.'
    );
  end;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;

  if CurPageID = PreflightPage.ID then begin
    RefreshPreflightPage();
    if not DependenciesMet() then begin
      OfferNodeDownload(BuildDependencyFailureMessage());
      Result := False;
    end;
  end;
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  if CurPageID = PreflightPage.ID then begin
    RefreshPreflightPage();
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then begin
    RunAppSetup();
  end;
end;
