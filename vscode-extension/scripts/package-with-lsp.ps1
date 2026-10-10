[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$LspPublishPath,
    [string]$CliPublishPath = '',
    [string]$MentorPublishPath = '',
    [string]$TraceCollectorPublishPath = '',
    [Parameter(Mandatory)]
    [ValidateSet('win-x64', 'linux-x64', 'osx-arm64')]
    [string]$RuntimeIdentifier,
    [string]$VsceTarget = 'win32-x64',
    [string]$OutputPath = ''
)

$ErrorActionPreference = 'Stop'

$supportedTargets = @{
    'win-x64' = 'win32-x64'
    'linux-x64' = 'linux-x64'
    'osx-arm64' = 'darwin-arm64'
}
if (-not $supportedTargets.ContainsKey($RuntimeIdentifier)) {
    throw "Unsupported LspHost runtime: $RuntimeIdentifier"
}
$expectedVsceTarget = $supportedTargets[$RuntimeIdentifier]
if ($VsceTarget -ne $expectedVsceTarget) {
    throw "VS Code target $VsceTarget does not match runtime $RuntimeIdentifier. Expected $expectedVsceTarget."
}

$extensionRoot = Split-Path -Parent $PSScriptRoot
$source = (Resolve-Path -LiteralPath $LspPublishPath).Path
$manifestPath = Join-Path $source 'junexis-lsp.json'
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    throw "LspHost distribution manifest was not found: $manifestPath"
}

$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($manifest.schemaVersion -ne 1) {
    throw "Unsupported LspHost distribution schema: $($manifest.schemaVersion)"
}
if ($manifest.name -ne 'JunexisLang.Compiler.LspHost') {
    throw "Unexpected LspHost identity: $($manifest.name)"
}
if ($manifest.protocolVersion -ne 1) {
    throw "LspHost protocol $($manifest.protocolVersion) is incompatible with extension protocol 1."
}
if ($manifest.runtimeIdentifier -ne $RuntimeIdentifier) {
    throw "LspHost runtime $($manifest.runtimeIdentifier) does not match requested $RuntimeIdentifier."
}
if ($manifest.selfContained -ne $true) {
    throw "Production LspHost distribution $RuntimeIdentifier must be self-contained."
}
if (
    -not $manifest.entrypoint -or
    $manifest.entrypoint.Contains('/') -or
    $manifest.entrypoint.Contains('\')
) {
    throw "Invalid LspHost entrypoint: $($manifest.entrypoint)"
}

$entrypoint = Join-Path $source $manifest.entrypoint
if (-not (Test-Path -LiteralPath $entrypoint -PathType Leaf)) {
    throw "LspHost entrypoint was not found: $entrypoint"
}

$traceSource = $null
if ($TraceCollectorPublishPath) {
    $traceSource = (Resolve-Path -LiteralPath $TraceCollectorPublishPath).Path
    $traceManifestPath = Join-Path $traceSource 'junexis-trace-collector.json'
    if (-not (Test-Path -LiteralPath $traceManifestPath -PathType Leaf)) {
        throw "TraceCollector distribution manifest was not found: $traceManifestPath"
    }

    $traceManifest = Get-Content -LiteralPath $traceManifestPath -Raw | ConvertFrom-Json
    if ($traceManifest.schemaVersion -ne 1) {
        throw "Unsupported TraceCollector distribution schema: $($traceManifest.schemaVersion)"
    }
    if ($traceManifest.name -ne 'Junexis.Debugger.TraceCollector.Server') {
        throw "Unexpected TraceCollector identity: $($traceManifest.name)"
    }
    if ($traceManifest.protocolVersion -ne 1) {
        throw "TraceCollector protocol $($traceManifest.protocolVersion) is incompatible with extension protocol 1."
    }
    if ($traceManifest.runtimeIdentifier -ne $RuntimeIdentifier) {
        throw "TraceCollector runtime $($traceManifest.runtimeIdentifier) does not match requested $RuntimeIdentifier."
    }
    if ($traceManifest.selfContained -ne $true) {
        throw "Production TraceCollector distribution $RuntimeIdentifier must be self-contained."
    }
    if (
        -not $traceManifest.entrypoint -or
        $traceManifest.entrypoint.Contains('/') -or
        $traceManifest.entrypoint.Contains('\')
    ) {
        throw "Invalid TraceCollector entrypoint: $($traceManifest.entrypoint)"
    }
    $traceEntrypoint = Join-Path $traceSource $traceManifest.entrypoint
    if (-not (Test-Path -LiteralPath $traceEntrypoint -PathType Leaf)) {
        throw "TraceCollector entrypoint was not found: $traceEntrypoint"
    }
}

$cliSource = $null
if ($CliPublishPath) {
    $cliSource = (Resolve-Path -LiteralPath $CliPublishPath).Path
    $cliManifestPath = Join-Path $cliSource 'junexis-cli.json'
    if (-not (Test-Path -LiteralPath $cliManifestPath -PathType Leaf)) {
        throw "Junexis CLI distribution manifest was not found: $cliManifestPath"
    }

    $cliManifest = Get-Content -LiteralPath $cliManifestPath -Raw | ConvertFrom-Json
    if ($cliManifest.schemaVersion -ne 1) {
        throw "Unsupported Junexis CLI distribution schema: $($cliManifest.schemaVersion)"
    }
    if ($cliManifest.name -ne 'JunexisLang.Compiler.CLI') {
        throw "Unexpected Junexis CLI identity: $($cliManifest.name)"
    }
    if ($cliManifest.protocolVersion -ne 2) {
        throw "Junexis CLI protocol $($cliManifest.protocolVersion) is incompatible with extension protocol 2."
    }
    if ($cliManifest.runtimeIdentifier -ne $RuntimeIdentifier) {
        throw "Junexis CLI runtime $($cliManifest.runtimeIdentifier) does not match requested $RuntimeIdentifier."
    }
    if ($cliManifest.selfContained -ne $true) {
        throw "Production Junexis CLI distribution $RuntimeIdentifier must be self-contained."
    }
    if (
        -not $cliManifest.entrypoint -or
        $cliManifest.entrypoint.Contains('/') -or
        $cliManifest.entrypoint.Contains('\')
    ) {
        throw "Invalid Junexis CLI entrypoint: $($cliManifest.entrypoint)"
    }
    $cliEntrypoint = Join-Path $cliSource $cliManifest.entrypoint
    if (-not (Test-Path -LiteralPath $cliEntrypoint -PathType Leaf)) {
        throw "Junexis CLI entrypoint was not found: $cliEntrypoint"
    }
}

$mentorSource = $null
if ($MentorPublishPath) {
    $mentorSource = (Resolve-Path -LiteralPath $MentorPublishPath).Path
    $mentorManifestPath = Join-Path $mentorSource 'junexis-mentor.json'
    if (-not (Test-Path -LiteralPath $mentorManifestPath -PathType Leaf)) {
        throw "Mentor CLI distribution manifest was not found: $mentorManifestPath"
    }

    $mentorManifest = Get-Content -LiteralPath $mentorManifestPath -Raw | ConvertFrom-Json
    if ($mentorManifest.schemaVersion -ne 1) {
        throw "Unsupported Mentor CLI distribution schema: $($mentorManifest.schemaVersion)"
    }
    if ($mentorManifest.name -ne 'JunexisLang.Mentor.CLI') {
        throw "Unexpected Mentor CLI identity: $($mentorManifest.name)"
    }
    if ($mentorManifest.protocolVersion -ne 1) {
        throw "Mentor CLI protocol $($mentorManifest.protocolVersion) is incompatible with extension protocol 1."
    }
    if ($mentorManifest.runtimeIdentifier -ne $RuntimeIdentifier) {
        throw "Mentor CLI runtime $($mentorManifest.runtimeIdentifier) does not match requested $RuntimeIdentifier."
    }
    if ($mentorManifest.selfContained -ne $true) {
        throw "Production Mentor CLI distribution $RuntimeIdentifier must be self-contained."
    }
    if (
        -not $mentorManifest.entrypoint -or
        $mentorManifest.entrypoint.Contains('/') -or
        $mentorManifest.entrypoint.Contains('\')
    ) {
        throw "Invalid Mentor CLI entrypoint: $($mentorManifest.entrypoint)"
    }
    $mentorEntrypoint = Join-Path $mentorSource $mentorManifest.entrypoint
    if (-not (Test-Path -LiteralPath $mentorEntrypoint -PathType Leaf)) {
        throw "Mentor CLI entrypoint was not found: $mentorEntrypoint"
    }
}

$runtimeRoot = Join-Path $extensionRoot 'runtime'
$stage = Join-Path $runtimeRoot "lsp/$RuntimeIdentifier"
if (Test-Path -LiteralPath $runtimeRoot) {
    throw "Refusing to replace an existing extension runtime directory: $runtimeRoot"
}

$package = Get-Content -LiteralPath (Join-Path $extensionRoot 'package.json') -Raw | ConvertFrom-Json
if (-not $OutputPath) {
    $OutputPath = Join-Path $extensionRoot "junexislang-$($package.version)-$VsceTarget.vsix"
}
$resolvedOutput = [System.IO.Path]::GetFullPath($OutputPath)

$verifiedRuntimeRoot = [System.IO.Path]::GetFullPath($runtimeRoot)
$expectedRuntimePrefix = [System.IO.Path]::GetFullPath((Join-Path $extensionRoot 'runtime'))
if ($verifiedRuntimeRoot -ne $expectedRuntimePrefix) {
    throw "Refusing unexpected staging path: $verifiedRuntimeRoot"
}

try {
    New-Item -ItemType Directory -Path $stage -Force | Out-Null
    Copy-Item -Path (Join-Path $source '*') -Destination $stage -Recurse -Force
    if ($cliSource) {
        $cliStage = Join-Path $runtimeRoot "cli/$RuntimeIdentifier"
        New-Item -ItemType Directory -Path $cliStage -Force | Out-Null
        Copy-Item -Path (Join-Path $cliSource '*') -Destination $cliStage -Recurse -Force
    }
    if ($mentorSource) {
        $mentorStage = Join-Path $runtimeRoot "mentor/$RuntimeIdentifier"
        New-Item -ItemType Directory -Path $mentorStage -Force | Out-Null
        Copy-Item -Path (Join-Path $mentorSource '*') -Destination $mentorStage -Recurse -Force
    }
    if ($traceSource) {
        $traceStage = Join-Path $runtimeRoot "trace-collector/$RuntimeIdentifier"
        New-Item -ItemType Directory -Path $traceStage -Force | Out-Null
        Copy-Item -Path (Join-Path $traceSource '*') -Destination $traceStage -Recurse -Force
    }

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
        if ($resolvedStage -ne $expectedRuntimePrefix) {
            throw "Refusing to remove unexpected staging path: $resolvedStage"
        }
        Remove-Item -LiteralPath $resolvedStage -Recurse -Force
    }
}

Write-Output $resolvedOutput
