# FormPilot Web V1.2 — offline launcher for the competition package (Windows PowerShell 5.1+, no Node / pnpm needed).
# Serves the packaged builds from this folder:
#   platform\  -> http://localhost:4175/   (FormPilot Web V1, competition build: AI Coach ACTIVE)
#   games\     -> http://localhost:5181/   (Motion Games Lab: 摘苹果 / 林间划船 / 林间射箭)
# Only listens on localhost. Nothing is uploaded; training records stay in the browser of this computer.
# Usage: double-click start-formpilot.cmd, or: powershell -NoProfile -ExecutionPolicy Bypass -File start-formpilot.ps1
param(
  [int]$PlatformPort = 4175,
  [int]$GamesPort = 5181,
  [switch]$NoBrowser
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$sites = @(
  @{ Name = 'FormPilot'; Port = $PlatformPort; Dir = (Join-Path $root 'platform'); Spa = $true },
  @{ Name = 'Motion Games Lab'; Port = $GamesPort; Dir = (Join-Path $root 'games'); Spa = $true }
)
foreach ($site in $sites) { if (-not (Test-Path (Join-Path $site.Dir 'index.html'))) { throw "Missing $($site.Dir)\index.html — is the package complete?" } }

$listener = New-Object System.Net.HttpListener
foreach ($site in $sites) { $listener.Prefixes.Add("http://localhost:$($site.Port)/") }
try { $listener.Start() } catch { Write-Host "Cannot listen on localhost:$PlatformPort / :$GamesPort. Close other servers on these ports and retry." -ForegroundColor Red; throw }

# Each request is handled in a runspace so a long video stream never blocks the page.
$handler = {
  param($context, $sites)
  $types = @{
    '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.mjs' = 'text/javascript; charset=utf-8'
    '.css' = 'text/css; charset=utf-8'; '.json' = 'application/json; charset=utf-8'; '.map' = 'application/json'
    '.svg' = 'image/svg+xml'; '.png' = 'image/png'; '.jpg' = 'image/jpeg'; '.jpeg' = 'image/jpeg'; '.webp' = 'image/webp'; '.ico' = 'image/x-icon'
    '.webm' = 'video/webm'; '.mp4' = 'video/mp4'; '.wasm' = 'application/wasm'; '.task' = 'application/octet-stream'
    '.tflite' = 'application/octet-stream'; '.bin' = 'application/octet-stream'; '.woff2' = 'font/woff2'; '.woff' = 'font/woff'
    '.txt' = 'text/plain; charset=utf-8'; '.md' = 'text/markdown; charset=utf-8'
  }
  $request = $context.Request; $response = $context.Response
  try {
    $site = $sites | Where-Object { $_.Port -eq $request.Url.Port } | Select-Object -First 1
    $path = [Uri]::UnescapeDataString($request.Url.AbsolutePath).TrimStart('/')
    $full = [IO.Path]::GetFullPath((Join-Path $site.Dir $path))
    $base = [IO.Path]::GetFullPath($site.Dir)
    if (-not $full.StartsWith($base, [StringComparison]::OrdinalIgnoreCase)) { $response.StatusCode = 403; return }
    if ((Test-Path $full -PathType Container)) { $full = Join-Path $full 'index.html' }
    if (-not (Test-Path $full -PathType Leaf)) {
      # Single-page app: unknown paths without a file extension get index.html; missing files are 404.
      if ($site.Spa -and -not [IO.Path]::HasExtension($path)) { $full = Join-Path $base 'index.html' } else { $response.StatusCode = 404; return }
    }
    $ext = [IO.Path]::GetExtension($full).ToLowerInvariant()
    $response.ContentType = if ($types.ContainsKey($ext)) { $types[$ext] } else { 'application/octet-stream' }
    $response.Headers['Accept-Ranges'] = 'bytes'
    $response.Headers['Cache-Control'] = if ($ext -eq '.html') { 'no-cache' } else { 'public, max-age=3600' }
    $stream = [IO.File]::Open($full, 'Open', 'Read', 'Read')
    try {
      $length = $stream.Length; $start = 0; $end = $length - 1
      $range = $request.Headers['Range']
      if ($range -and $range -match '^bytes=(\d*)-(\d*)$') {
        if ($Matches[1] -ne '') { $start = [int64]$Matches[1] } else { $start = [Math]::Max(0, $length - [int64]$Matches[2]) }
        if ($Matches[1] -ne '' -and $Matches[2] -ne '') { $end = [Math]::Min([int64]$Matches[2], $length - 1) }
        if ($start -ge $length) { $response.StatusCode = 416; $response.Headers['Content-Range'] = "bytes */$length"; return }
        $response.StatusCode = 206
        $response.Headers['Content-Range'] = "bytes $start-$end/$length"
      }
      $count = $end - $start + 1
      $response.ContentLength64 = $count
      if ($request.HttpMethod -eq 'HEAD') { return }
      [void]$stream.Seek($start, 'Begin')
      $buffer = New-Object byte[] 262144
      while ($count -gt 0) {
        $read = $stream.Read($buffer, 0, [int][Math]::Min($buffer.Length, $count))
        if ($read -le 0) { break }
        $response.OutputStream.Write($buffer, 0, $read)
        $count -= $read
      }
    } finally { $stream.Dispose() }
  } catch {
    # Client closed the connection (e.g. video seek) or the file is locked: ignore.
  } finally {
    try { $response.OutputStream.Close() } catch {}
  }
}

$pool = [RunspaceFactory]::CreateRunspacePool(1, 16)
$pool.Open()
Write-Host ''
Write-Host 'FormPilot Web V1.2 is running:' -ForegroundColor Green
Write-Host "  FormPilot         http://localhost:$PlatformPort/"
Write-Host "  Motion Games Lab  http://localhost:$GamesPort/"
Write-Host 'Use Microsoft Edge or Chrome. Keep this window open; close it (or press Ctrl+C) to stop.'
if (-not $NoBrowser) { Start-Process "http://localhost:$PlatformPort/" }
$jobs = New-Object System.Collections.ArrayList
try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    $ps = [PowerShell]::Create()
    $ps.RunspacePool = $pool
    [void]$ps.AddScript($handler).AddArgument($context).AddArgument($sites)
    [void]$jobs.Add(@{ PS = $ps; Handle = $ps.BeginInvoke() })
    foreach ($job in @($jobs)) { if ($job.Handle.IsCompleted) { $job.PS.EndInvoke($job.Handle); $job.PS.Dispose(); $jobs.Remove($job) } }
  }
} finally {
  $listener.Stop(); $pool.Close()
}
