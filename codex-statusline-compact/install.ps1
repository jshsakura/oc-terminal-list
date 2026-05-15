$ErrorActionPreference = "Stop"

$codexHome = if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $HOME ".codex" }
$config = Join-Path $codexHome "config.toml"
$backup = "$config.bak.$(Get-Date -Format yyyyMMddHHmmss)"

New-Item -ItemType Directory -Force -Path $codexHome | Out-Null
if (Test-Path $config) {
  Copy-Item $config $backup
  $lines = Get-Content $config
} else {
  $lines = @()
  New-Item -ItemType File -Force -Path $config | Out-Null
}

$statusBlock = @(
  'status_line = [',
  '  "model-with-reasoning",',
  '  "project",',
  '  "git-branch",',
  '  "context-used",',
  '  "total-input-tokens",',
  '  "total-output-tokens",',
  '  "five-hour-limit",',
  '  "weekly-limit",',
  ']',
  'status_line_use_colors = true'
)

$out = New-Object System.Collections.Generic.List[string]
$inTui = $false
$sawTui = $false
$wrote = $false
$skip = $false

function Write-StatusBlock {
  if (-not $script:wrote) {
    foreach ($line in $statusBlock) { $out.Add($line) }
    $script:wrote = $true
  }
}

foreach ($line in $lines) {
  if ($line -match '^\[tui\]$') {
    if ($inTui) { Write-StatusBlock }
    $inTui = $true
    $sawTui = $true
    $out.Add($line)
    continue
  }
  if ($line -match '^\[') {
    if ($inTui) { Write-StatusBlock }
    $inTui = $false
    $skip = $false
    $out.Add($line)
    continue
  }
  if ($inTui -and $line -match '^status_line\s*=') {
    $skip = $line -notmatch '\]'
    continue
  }
  if ($skip) {
    if ($line -match '^\s*\]') { $skip = $false }
    continue
  }
  if ($inTui -and $line -match '^status_line_use_colors\s*=') {
    continue
  }
  $out.Add($line)
}

if ($inTui) { Write-StatusBlock }
if (-not $sawTui) {
  $out.Add("")
  $out.Add("[tui]")
  Write-StatusBlock
}

Set-Content -Path $config -Value $out -Encoding UTF8
Write-Host "Installed compact Codex status line: $config"
if (Test-Path $backup) { Write-Host "Backup: $backup" }
