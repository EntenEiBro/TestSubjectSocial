# Import new / changed assets (e.g. freshly exported Blender .glb props) so the
# game can load them.
#   powershell -File godot\tools\import.ps1
# With the editor open (Live Follow plugin), the editor does the import
# itself (visible, and the only writer of .godot/imported). Without it, a
# headless import runs, serialised by a system-wide mutex.
$godot = "D:\Tools\Godot\4.7.2\Godot_v4.7.2-stable_win64_console.exe"
$proj = Split-Path -Parent $PSScriptRoot
$editor = Get-CimInstance Win32_Process -Filter "Name like 'Godot%'" | Where-Object { $_.CommandLine -match "--editor" -and $_.CommandLine -match [regex]::Escape((Split-Path -Leaf $proj)) }
if ($editor) {
  $id = [guid]::NewGuid().ToString("N")
  $live = Join-Path $proj ".live"
  New-Item -ItemType Directory -Force "$live\import", "$live\done" | Out-Null
  Set-Content -Path "$live\import\$id" -Value "import" -Encoding ascii
  $deadline = (Get-Date).AddSeconds(300)
  while (-not (Test-Path "$live\done\$id")) {
    if ((Get-Date) -gt $deadline) { "!!! editor import did not finish within 300 s"; exit 1 }
    Start-Sleep -Milliseconds 500
  }
  Remove-Item "$live\done\$id" -ErrorAction SilentlyContinue
  "--- import done (editor)"
  exit 0
}
$mutex = New-Object System.Threading.Mutex($false, "Global\TSS_GodotImport")
try {
  if (-not $mutex.WaitOne(600000)) { "!!! could not get the import lock"; exit 1 }
  $tmp = Join-Path $env:TEMP ("imp_" + [guid]::NewGuid().ToString("N"))
  $p = Start-Process -FilePath $godot -ArgumentList @("--headless", "--path", "`"$proj`"", "--import") -NoNewWindow -PassThru -RedirectStandardOutput "$tmp.out" -RedirectStandardError "$tmp.err"
  if (-not $p.WaitForExit(240000)) { $p.Kill(); "!!! import TIMEOUT (killed)" }
  Select-String -Path "$tmp.out", "$tmp.err" -Pattern "ERROR|Error importing" | Where-Object { $_.Line -notmatch "leaked|PagedAllocator" } | Select-Object -First 15 | ForEach-Object { $_.Line }
  Remove-Item "$tmp.out", "$tmp.err" -ErrorAction SilentlyContinue
  "--- import done (headless)"
} finally {
  try { $mutex.ReleaseMutex() } catch {}
  $mutex.Dispose()
}
