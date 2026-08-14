$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$distDir = Join-Path $projectRoot 'dist'
$downloadsDir = Join-Path $projectRoot 'downloads'
$archivePath = Join-Path $distDir 'Hassle-Reduction-series-2-Gwangju-Place-Name-Filter-v0.4.0.zip'
$latestArchivePath = Join-Path $distDir 'Hassle-Reduction-series-2-Gwangju-Place-Name-Filter.zip'
$publicDownloadPath = Join-Path $downloadsDir 'Hassle-Reduction-series-2-Gwangju-Place-Name-Filter.zip'

if (-not (Test-Path -LiteralPath $distDir)) {
    New-Item -ItemType Directory -Path $distDir | Out-Null
}
if (-not (Test-Path -LiteralPath $downloadsDir)) {
    New-Item -ItemType Directory -Path $downloadsDir | Out-Null
}

$sourcePaths = @(
    (Join-Path $projectRoot 'manifest.json'),
    (Join-Path $projectRoot 'LICENSE'),
    (Join-Path $projectRoot 'README.md'),
    (Join-Path $projectRoot 'docs'),
    (Join-Path $projectRoot 'popup'),
    (Join-Path $projectRoot 'src')
)

Compress-Archive -LiteralPath $sourcePaths -DestinationPath $archivePath -CompressionLevel Optimal -Force
Copy-Item -LiteralPath $archivePath -Destination $latestArchivePath -Force
Copy-Item -LiteralPath $latestArchivePath -Destination $publicDownloadPath -Force
$sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $latestArchivePath).Hash
$checksumText = "$sha256 *Hassle-Reduction-series-2-Gwangju-Place-Name-Filter.zip`n"
[System.IO.File]::WriteAllText(
    (Join-Path $downloadsDir 'SHA256SUMS.txt'),
    $checksumText,
    [System.Text.UTF8Encoding]::new($false)
)
Write-Output "Created: $archivePath"
Write-Output "Created: $latestArchivePath"
Write-Output "Published copy: $publicDownloadPath"
Write-Output "SHA256: $sha256"
