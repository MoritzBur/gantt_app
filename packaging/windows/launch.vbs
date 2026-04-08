Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
exePath = fso.BuildPath(fso.GetParentFolderName(WScript.ScriptFullName), "Actual Plan.exe")
shell.Run """" & exePath & """", 0, False
