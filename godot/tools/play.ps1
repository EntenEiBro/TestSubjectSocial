param([string]$Extra = "", [int]$Timeout = 90, [int]$Wait = 900)
# Play the game VISIBLY through the open editor's Play button (Live Follow
# plugin; requests are queued, one game window at a time), e.g. to take
# screenshots:
#   powershell -File godot\tools\play.ps1 -Extra "--game=chairs --quick --shot=C:\tmp\c.png --shot-at=4,10,18"
# Returns when the run has ended (the game quits itself after the last --shot,
# or is stopped after -Timeout seconds). Without the editor it runs a
# standalone visible window instead.
$proj = Split-Path -Parent $PSScriptRoot
$startTime = Get-Date
$editor = Get-CimInstance Win32_Process -Filter "Name like 'Godot%'" | Where-Object { $_.CommandLine -match "--editor" -and $_.CommandLine -match [regex]::Escape((Split-Path -Leaf $proj)) }
if (-not $editor) {
  & (Join-Path $PSScriptRoot "run.ps1") -Visible -Extra $Extra -Timeout $Timeout
  exit 0
}
$id = [guid]::NewGuid().ToString("N")
$live = Join-Path $proj ".live"
New-Item -ItemType Directory -Force "$live\play", "$live\done" | Out-Null
$req = @{ args = $Extra; timeout = $Timeout } | ConvertTo-Json -Compress
Set-Content -Path "$live\play\$id.json" -Value $req -Encoding ascii
$deadline = (Get-Date).AddSeconds($Wait)
while (-not (Test-Path "$live\done\$id")) {
  if ((Get-Date) -gt $deadline) { "!!! play request not finished within $Wait s (queue busy?)"; exit 1 }
  Start-Sleep -Milliseconds 500
}
Remove-Item "$live\done\$id" -ErrorAction SilentlyContinue
if ($Extra -match "--shot=(\S+)") {
  $shot = $Matches[1]
  $base = [System.IO.Path]::Combine([System.IO.Path]::GetDirectoryName($shot), [System.IO.Path]::GetFileNameWithoutExtension($shot))
  $shots = @(Get-ChildItem "$base*.png" -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -gt $startTime })
  $shots | ForEach-Object { "screenshot $($_.FullName)" }
  if ($shots.Count -eq 0) {
    # Usually a script error somewhere in the project stopped the game: show what the editor saw.
    "!!! no screenshots were written. Last editor output:"
    Get-Content (Join-Path $live "editor.log") -Tail 25 -ErrorAction SilentlyContinue
  }
}
"--- played (editor)"
