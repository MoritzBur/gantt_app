Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
exePath = fso.BuildPath(fso.GetParentFolderName(WScript.ScriptFullName), "Gantt App.exe")
shell.Run """" & exePath & """ --stop", 0, True
