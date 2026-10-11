param([string]$Games = "", [switch]$Headless)
# Build minigame props in Blender and export them to godot/assets/models/props.
# Default: Blender's window opens so the build can be watched live, closes
# itself a few seconds after the export.
#   powershell -File blender\build.ps1 -Games "chairs,winch"
#   powershell -File blender\build.ps1 -Games "chairs" -Headless
$blender = "D:\SteamLibrary\steamapps\common\Blender\blender.exe"
$here = $PSScriptRoot
$tmp = Join-Path $env:TEMP ("bl_" + [guid]::NewGuid().ToString("N"))
if ($Headless) {
  $argList = @("-b", "--python", "`"$here\build_props.py`"", "--") + $Games.Split(",")
} else {
  $argList = @("--python", "`"$here\showcase.py`"", "--", "props:$Games", "quit")
}
$p = Start-Process -FilePath $blender -ArgumentList $argList -PassThru -RedirectStandardOutput "$tmp.out" -RedirectStandardError "$tmp.err" -WindowStyle Normal
if (-not $p.WaitForExit(600000)) { $p.Kill(); "!!! Blender TIMEOUT (killed)" }
Select-String -Path "$tmp.out", "$tmp.err" -Pattern 'exported|Error|Traceback|File "|line \d+|Exception' | Select-Object -First 40 | ForEach-Object { $_.Line }
Remove-Item "$tmp.out", "$tmp.err" -ErrorAction SilentlyContinue
"--- blender done"
