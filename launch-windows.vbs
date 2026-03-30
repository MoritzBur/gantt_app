Option Explicit

Dim shell
Dim fileSystem
Dim scriptDir
Dim powerShellScript
Dim command
Dim i

Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")

scriptDir = fileSystem.GetParentFolderName(WScript.ScriptFullName)
powerShellScript = scriptDir & "\launch-windows.ps1"

command = "powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File " & Quote(powerShellScript)

For i = 0 To WScript.Arguments.Count - 1
  command = command & " " & Quote(WScript.Arguments(i))
Next

shell.Run command, 0, False

Function Quote(ByVal value)
  Quote = Chr(34) & Replace(value, Chr(34), Chr(34) & Chr(34)) & Chr(34)
End Function
