# Compile-check every GDScript in the project (autoloads loaded) and print
# the distinct errors.   powershell -File godot\tools\check.ps1
$godot = "D:\Tools\Godot\4.7.2\Godot_v4.7.2-stable_win64_console.exe"
$proj = Split-Path -Parent $PSScriptRoot
$tmp = Join-Path $env:TEMP ("chk_" + [guid]::NewGuid().ToString("N"))
$p = Start-Process -FilePath $godot -ArgumentList @("--headless", "--path", "`"$proj`"", "res://tools/check_all.tscn") -NoNewWindow -PassThru -RedirectStandardOutput "$tmp.out" -RedirectStandardError "$tmp.err"
if (-not $p.WaitForExit(120000)) { $p.Kill(); "TIMEOUT" }
$seen = @{}
foreach ($m in (Select-String -Path "$tmp.out", "$tmp.err" -Pattern "SCRIPT ERROR|CHECK_ALL|Parse Error" -Context 0, 1)) {
  $at = if ($m.Context.PostContext.Count -gt 0) { $m.Context.PostContext[0].Trim() } else { "" }
  $key = "$($m.Line)|$at"
  if ($seen.ContainsKey($key)) { continue }
  $seen[$key] = 1
  if ($m.Line -match "CHECK_ALL") { $m.Line } else { "$($m.Line.Trim())  [$at]" }
}
Remove-Item "$tmp.out", "$tmp.err" -ErrorAction SilentlyContinue
