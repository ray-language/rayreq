# Installs the latest RayReq release on Windows, for the current user:
#
#   irm https://raw.githubusercontent.com/ray-language/rayreq/main/install.ps1 | iex
#
# It reads the release manifest (update.json), downloads the zip for this machine, checks its
# SHA-256 and puts the app in %LOCALAPPDATA%\Programs\RayReq (where it can later update itself)
# with a Start Menu shortcut. $env:RAYREQ_VERSION = "0.1.2" installs that release instead of
# the latest; $env:RAYREQ_INSTALL_DIR installs under that directory.
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$repo = 'https://github.com/ray-language/rayreq'
$manifest = if ($env:RAYREQ_VERSION) { "$repo/releases/download/v$($env:RAYREQ_VERSION)/update.json" } else { "$repo/releases/latest/download/update.json" }

$arch = switch ($env:PROCESSOR_ARCHITECTURE) {
  'ARM64' { 'aarch64' }
  'AMD64' { 'x86_64' }
  default { throw "rayreq install: unsupported architecture $($env:PROCESSOR_ARCHITECTURE)" }
}
$key = "windows-$arch"

$work = Join-Path ([IO.Path]::GetTempPath()) ("rayreq-install-" + [IO.Path]::GetRandomFileName())
New-Item -ItemType Directory -Path $work | Out-Null
try {
  Write-Host "reading $manifest"
  # The asset comes as application/octet-stream: through a file, so it is read as text.
  $manifestFile = Join-Path $work 'update.json'
  Invoke-WebRequest -UseBasicParsing -Uri $manifest -OutFile $manifestFile
  $json = Get-Content -Raw -Encoding UTF8 $manifestFile | ConvertFrom-Json
  $version = $json.version
  $artifact = $json.artifacts.$key
  if (-not $artifact) {
    $available = ($json.artifacts.PSObject.Properties.Name) -join ' '
    throw "rayreq install: release $version has no build for $key (available: $available)"
  }
  $url = $artifact.url
  if ($url -notmatch '^https?://') { $url = ($manifest -replace '/[^/]*$', '/') + $url }

  Write-Host "downloading RayReq $version for $key"
  $zip = Join-Path $work 'app.zip'
  Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $zip
  $got = (Get-FileHash -Algorithm SHA256 $zip).Hash.ToLower()
  if ($got -ne $artifact.sha256.ToLower()) {
    throw "rayreq install: the download does not match the manifest (sha256 $got, expected $($artifact.sha256))"
  }
  $unpacked = Join-Path $work 'unpacked'
  Expand-Archive -Path $zip -DestinationPath $unpacked
  $bundle = Join-Path $unpacked 'RayReq'
  if (-not (Test-Path (Join-Path $bundle 'RayReq.exe'))) { throw 'rayreq install: the zip holds no RayReq\RayReq.exe' }

  $root = if ($env:RAYREQ_INSTALL_DIR) { $env:RAYREQ_INSTALL_DIR } else { Join-Path $env:LOCALAPPDATA 'Programs' }
  New-Item -ItemType Directory -Force -Path $root | Out-Null
  $dest = Join-Path $root 'RayReq'
  if (Test-Path $dest) {
    try { Remove-Item -Recurse -Force $dest } catch { throw "rayreq install: cannot replace $dest (is RayReq running? close it and try again)" }
  }
  Move-Item $bundle $dest
  # The bundle's script (Start Menu shortcut) runs in a child shell that may run scripts: the
  # default execution policy refuses a .ps1 file even when this one came through iex.
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $dest 'install.ps1')
  if ($LASTEXITCODE -ne 0) { throw "rayreq install: the bundle's install.ps1 failed ($LASTEXITCODE)" }
  Write-Host "installed: $dest\RayReq.exe"
  Write-Host 'open it from the Start Menu. RayReq checks for new versions on its own (RayReq -> Check for Updates...).'
} finally {
  Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
}
