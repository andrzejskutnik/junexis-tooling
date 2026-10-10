[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$TraceCollectorPublishPath,
    [string]$RuntimeIdentifier = 'win-x64',
    [string]$VsceTarget = 'win32-x64',
    [string]$OutputPath = ''
)

$ErrorActionPreference = 'Stop'

$supportedTargets = @{
    'win-x64' = 'win32-x64'
    'linux-x64' = 'linux-x64'
    'linux-arm64' = 'linux-arm64'
    'osx-arm64' = 'darwin-arm64'
}
if (-not $supportedTargets.ContainsKey($RuntimeIdentifier)) {
    throw "Unsupported TraceCollector runtime: $RuntimeIdentifier"
}
$expectedVsceTarget = $supportedTargets[$RuntimeIdentifier]
if ($VsceTarget -ne $expectedVsceTarget) {
    throw "VS Code target $VsceTarget does not match runtime $RuntimeIdentifier. Expected $expectedVsceTarget."
}

$extensionRoot = Split-Path -Parent $PSScriptRoot
$source = (Resolve-Path -LiteralPath $TraceCollectorPublishPath).Path
$manifestPath = Join-Path $source 'junexis-trace-collector.json'
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw "TraceCollector distribution manifest was not found: $manifestPath"
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($manifest.schemaVersion -ne 1) {
    throw "Unsupported TraceCollector distribution schema: $($manifest.schemaVersion)"
}
if ($manifest.name -ne 'Junexis.Debugger.TraceCollector.Server') {
    throw "Unexpected TraceCollector identity: $($manifest.name)"
}
if ($manifest.protocolVersion -ne 1) {
    throw "TraceCollector protocol $($manifest.protocolVersion) is incompatible with extension protocol 1."
}
if ($manifest.runtimeIdentifier -ne $RuntimeIdentifier) {
    throw "TraceCollector runtime $($manifest.runtimeIdentifier) does not match requested $RuntimeIdentifier."
}
if ($manifest.selfContained -ne $true) {
    throw "Production TraceCollector distribution $RuntimeIdentifier must be self-contained."
}
if (
    -not $manifest.entrypoint -or
    $manifest.entrypoint.Contains('/') -or
    $manifest.entrypoint.Contains('\')
) {
    throw "Invalid TraceCollector entrypoint: $($manifest.entrypoint)"
}

$entrypoint = Join-Path $source $manifest.entrypoint
if (-not (Test-Path -LiteralPath $entrypoint -PathType Leaf)) {
    throw "TraceCollector entrypoint was not found: $entrypoint"
}

$runtimeRoot = Join-Path $extensionRoot 'runtime'
$stage = Join-Path $runtimeRoot "trace-collector/$RuntimeIdentifier"
if (Test-Path -LiteralPath $runtimeRoot) {
    throw "Refusing to replace an existing extension runtime directory: $runtimeRoot"
}

$package = Get-Content -LiteralPath (Join-Path $extensionRoot 'package.json') -Raw | ConvertFrom-Json
if (-not $OutputPath) {
    $OutputPath = Join-Path $extensionRoot "junexislang-$($package.version)-$VsceTarget.vsix"
}
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputPath)

$verifiedRuntimeRoot = [System.IO.Path]::GetFullPath($runtimeRoot)
$expectedRuntimeRoot = [System.IO.Path]::GetFullPath((Join-Path $extensionRoot 'runtime'))
if ($verifiedRuntimeRoot -ne $expectedRuntimeRoot) {
    throw "Refusing unexpected staging path: $verifiedRuntimeRoot"
}

try {
    New-Item -ItemType Directory -Path $stage -Force | Out-Null
    Copy-Item -Path (Join-Path $source '*') -Destination $stage -Recurse -Force

    Push-Location $extensionRoot
    try {
        & npx vsce package --target $VsceTarget --allow-missing-repository --out $resolvedOutput
        if ($LASTEXITCODE -ne 0) {
            throw "vsce package failed with exit code $LASTEXITCODE."
        }
    } finally {
        Pop-Location
    }
} finally {
    if (Test-Path -LiteralPath $verifiedRuntimeRoot) {
        $resolvedStage = (Resolve-Path -LiteralPath $verifiedRuntimeRoot).Path
        if ($resolvedStage -ne $expectedRuntimeRoot) {
            throw "Refusing to remove unexpected staging path: $resolvedStage"
        }
        Remove-Item -LiteralPath $resolvedStage -Recurse -Force
    }
}

Write-Output $resolvedOutput
