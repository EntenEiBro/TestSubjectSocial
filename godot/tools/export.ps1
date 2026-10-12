param([ValidateSet("windows", "android")][string]$Target = "windows", [switch]$Install, [int]$Timeout = 1500)
# Export the game:   powershell -File godot\tools\export.ps1 -Target android -Install
#   windows -> build/godot/windows/Test Subject Social.exe (+ eos/ online helper when available)
#   android -> build/godot/android/Test Subject Social.apk (Gradle build; online play when
#              tools/build_android_plugin.py has put the TssEos plugin into addons/tss_eos/bin)
# Release builds signed with the local debug key (installs directly on your own phones).
$godot = "D:\Tools\Godot\4.7.2\Godot_v4.7.2-stable_win64_console.exe"
$proj = Split-Path -Parent $PSScriptRoot
$root = Split-Path -Parent $proj
$tools = "D:\AndroidDev"

# Android SDK / JDK / signing key for Godot's exporter (re-applied every time:
# a running editor writes its own copy of the settings when it closes).
$settings = Join-Path $env:APPDATA "Godot\editor_settings-4.7.tres"
$want = [ordered]@{
  "export/android/android_sdk_path" = "D:/AndroidDev/sdk"
  "export/android/java_sdk_path" = "D:/AndroidDev/jdk"
  "export/android/debug_keystore" = "D:/AndroidDev/android-home/debug.keystore"
  "export/android/debug_keystore_user" = "androiddebugkey"
  "export/android/debug_keystore_pass" = "android"
}
$lines = [System.Collections.Generic.List[string]](Get-Content $settings -Encoding UTF8)
foreach ($k in $want.Keys) {
  $line = "$k = `"$($want[$k])`""
  $i = $lines.FindIndex([Predicate[string]]{ param($l) $l.StartsWith("$k = ") })
  if ($i -ge 0) { $lines[$i] = $line } else { $lines.Add($line) }
}
[IO.File]::WriteAllLines($settings, $lines, (New-Object Text.UTF8Encoding($false)))

$env:JAVA_HOME = "$tools\jdk"
$env:ANDROID_HOME = "$tools\sdk"
$env:ANDROID_SDK_ROOT = "$tools\sdk"
$env:GRADLE_USER_HOME = "$tools\gradle-home"
$env:ANDROID_USER_HOME = "$tools\android-home"
$env:PATH = "$tools\jdk\bin;" + $env:PATH
# Release builds are signed with the local debug key (own phones, not the Play Store).
$env:GODOT_ANDROID_KEYSTORE_RELEASE_PATH = "$tools\android-home\debug.keystore"
$env:GODOT_ANDROID_KEYSTORE_RELEASE_USER = "androiddebugkey"
$env:GODOT_ANDROID_KEYSTORE_RELEASE_PASSWORD = "android"

$preset = if ($Target -eq "android") { "Android" } else { "Windows Desktop" }
$out = if ($Target -eq "android") { "$root\build\godot\android\Test Subject Social.apk" } else { "$root\build\godot\windows\Test Subject Social.exe" }
New-Item -ItemType Directory -Force (Split-Path $out) | Out-Null
$tmp = Join-Path $env:TEMP ("exp_" + [guid]::NewGuid().ToString("N"))
$args = @("--headless", "--path", "`"$proj`"", "--export-release", "`"$preset`"", "`"$out`"")
$p = Start-Process -FilePath $godot -ArgumentList $args -NoNewWindow -PassThru -RedirectStandardOutput "$tmp.out" -RedirectStandardError "$tmp.err"
if (-not $p.WaitForExit($Timeout * 1000)) { $p.Kill(); "!!! export TIMEOUT" }
Select-String -Path "$tmp.out", "$tmp.err" -Pattern "ERROR|error:|FAILED|BUILD|savepack|export" | Where-Object { $_.Line -notmatch "leaked|PagedAllocator|~Dependency" } | Select-Object -Last 40 | ForEach-Object { $_.Line }
Remove-Item "$tmp.out", "$tmp.err" -ErrorAction SilentlyContinue
if (-not (Test-Path $out)) { "!!! no output at $out"; exit 1 }
"exported: $out ($([math]::Round((Get-Item $out).Length / 1MB, 1)) MB)"

if ($Target -eq "windows") {
  # Online play: the packaged EOS helper (tools/build_eos_sidecar.py) + SDK + product IDs.
  $side = "$root\build\eos_sidecar\tss_eos"
  if (Test-Path "$side\tss_eos.exe") {
    $eos = Join-Path (Split-Path $out) "eos"
    if (Test-Path $eos) { Remove-Item $eos -Recurse -Force }
    Copy-Item $side $eos -Recurse
    Copy-Item "$root\EOS\win\SDK\Bin\EOSSDK-Win64-Shipping.dll", "$root\eos_config.json" $eos
    "online helper copied to $eos"
  } else {
    "(no packaged online helper yet: run python tools/build_eos_sidecar.py)"
  }
}
if ($Target -eq "android" -and $Install) {
  & "$tools\sdk\platform-tools\adb.exe" install -r "$out"
}
