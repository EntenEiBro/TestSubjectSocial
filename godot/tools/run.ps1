param([string]$Extra = "", [int]$Frames = 100000, [int]$Max = 40, [int]$Timeout = 120, [switch]$Visible)
# Run the game (headless unless -Visible) with a hard timeout and print the
# first distinct script errors (with location), TEST_RESULT lines and screenshots.
#   powershell -File godot\tools\run.ps1 -Extra "--game=sawblade --test --seeds=3"
#   powershell -File godot\tools\run.ps1 -Visible -Extra "--game=sawblade --quick --shot=C:\tmp\s.png --shot-at=4,10"
$godot = "D:\Tools\Godot\4.7.2\Godot_v4.7.2-stable_win64_console.exe"
$proj = Split-Path -Parent $PSScriptRoot
$tmp = Join-Path $env:TEMP ("run_" + [guid]::NewGuid().ToString("N"))
$argList = @()
if (-not $Visible) { $argList += "--headless" }
$argList += @("--path", "`"$proj`"", "--quit-after", "$Frames")
if ($Extra -ne "") { $argList += "--"; $argList += $Extra.Split(" ") }
$p = Start-Process -FilePath $godot -ArgumentList $argList -NoNewWindow -PassThru -RedirectStandardOutput "$tmp.out" -RedirectStandardError "$tmp.err"
if (-not $p.WaitForExit($Timeout * 1000)) { $p.Kill(); "!!! TIMEOUT after $Timeout s (killed)" }
$pat = "ERROR|WARNING|TEST_RESULT|NETTEST|screenshot|Invalid|Nonexistent|^fps|^DBG|^\[eos\]|^\[net\]"
$skip = "PagedAllocator|leaked|Leaked|never freed|GL ID|resources still in use|~Dependency|invalid UID"
$seen = @{}
$n = 0
foreach ($f in @("$tmp.out", "$tmp.err")) {
  if (-not (Test-Path $f)) { continue }
  foreach ($m in (Select-String -Path $f -Pattern $pat -Context 0, 1)) {
    $line = $m.Line
    if ($line -match $skip) { continue }
    $at = if ($m.Context.PostContext.Count -gt 0 -and $m.Context.PostContext[0] -match "^\s+at:") { $m.Context.PostContext[0] } else { "" }
    $key = "$line|$at"
    if ($seen.ContainsKey($key)) { continue }
    $seen[$key] = 1
    $line
    if ($at) { $at }
    $n++
    if ($n -ge $Max) { break }
  }
}
Remove-Item "$tmp.out", "$tmp.err" -ErrorAction SilentlyContinue
"--- done"
