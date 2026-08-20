[CmdletBinding()]
param(
    [string]$NodePath = "node"
)

$ErrorActionPreference = "Stop"
$addonRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $addonRoot ".."))
$distRoot = [System.IO.Path]::GetFullPath((Join-Path $addonRoot "dist"))
$releaseRoot = [System.IO.Path]::GetFullPath((Join-Path $addonRoot "release"))

foreach ($target in @($distRoot, $releaseRoot)) {
    if (-not $target.StartsWith($addonRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Unsafe build path: $target"
    }
}

$package = Get-Content -LiteralPath (Join-Path $addonRoot "package.json") -Raw | ConvertFrom-Json
$version = $package.version

Push-Location $addonRoot
try {
    & $NodePath --check "src/model.mjs"
    & $NodePath --check "src/addon.mjs"
    & $NodePath --check "src/server.mjs"
    & $NodePath --check "scripts/build-static.mjs"
    & $NodePath --test
    & $NodePath "scripts/build-static.mjs"

    if (Test-Path -LiteralPath $releaseRoot) {
        Remove-Item -LiteralPath $releaseRoot -Recurse -Force
    }
    New-Item -ItemType Directory -Path $releaseRoot | Out-Null

    $serverStage = Join-Path $distRoot "server"
    if (Test-Path -LiteralPath $serverStage) {
        Remove-Item -LiteralPath $serverStage -Recurse -Force
    }
    New-Item -ItemType Directory -Path $serverStage | Out-Null
    Copy-Item -LiteralPath "src" -Destination $serverStage -Recurse
    Copy-Item -LiteralPath "package.json", "Dockerfile", "compose.yaml", "README.md" -Destination $serverStage
    Copy-Item -LiteralPath (Join-Path $repositoryRoot "LICENSE") -Destination (Join-Path $serverStage "LICENSE")

    $serverArchive = Join-Path $releaseRoot "kazumi-stremio-addon-server-v$version.zip"
    $staticArchive = Join-Path $releaseRoot "kazumi-stremio-addon-static-v$version.zip"
    Compress-Archive -Path (Join-Path $serverStage "*") -DestinationPath $serverArchive -CompressionLevel Optimal
    Compress-Archive -Path (Join-Path $distRoot "static\*") -DestinationPath $staticArchive -CompressionLevel Optimal

    $hashes = Get-FileHash -Algorithm SHA256 -LiteralPath $serverArchive, $staticArchive
    $hashLines = $hashes | ForEach-Object { "{0}  {1}" -f $_.Hash.ToLowerInvariant(), (Split-Path $_.Path -Leaf) }
    Set-Content -LiteralPath (Join-Path $releaseRoot "SHA256SUMS.txt") -Value $hashLines -Encoding utf8

    Get-ChildItem -LiteralPath $releaseRoot | Select-Object Name, Length
}
finally {
    Pop-Location
}
