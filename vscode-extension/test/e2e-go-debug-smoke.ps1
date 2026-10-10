[CmdletBinding()]
param(
    [switch]$KeepOutput
)

$ErrorActionPreference = 'Stop'
$extensionRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$platformRoot = (Resolve-Path (Join-Path $extensionRoot '..\..')).Path
$outputRoot = Join-Path $platformRoot '.e2e-vscode-debug'
$expectedOutput = [System.IO.Path]::GetFullPath(
    (Join-Path $platformRoot '.e2e-vscode-debug'))
$compilerProject = Join-Path $platformRoot 'junexis-lang\compiler\JunexisLang.Compiler.CLI\JunexisLang.Compiler.CLI.csproj'
$sampleProject = Join-Path $platformRoot 'junexis-lang\examples\projects\01-temperature-monitor'

function Remove-VerifiedOutput {
    if (-not (Test-Path -LiteralPath $outputRoot)) {
        return
    }

    $resolved = (Resolve-Path -LiteralPath $outputRoot).Path
    if (-not $resolved.Equals($expectedOutput, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to remove unexpected E2E path: $resolved"
    }
    Remove-Item -LiteralPath $resolved -Recurse -Force
}

try {
    Remove-VerifiedOutput

    $buildJson = & dotnet run --project $compilerProject --no-build -- build `
        $sampleProject -o $outputRoot --target server --json --output-schema 2.0
    if ($LASTEXITCODE -ne 0) {
        throw "Junexis build failed with exit code $LASTEXITCODE."
    }
    $build = $buildJson | ConvertFrom-Json
    if (-not $build.success -or $build.schemaVersion -ne '2.0' -or -not $build.buildId) {
        throw 'Junexis build did not return a successful schema 2.0 envelope.'
    }

    $sourceMapPath = Join-Path $outputRoot 'debug\junexis.source-map.json'
    $sourceMap = Get-Content -LiteralPath $sourceMapPath -Raw | ConvertFrom-Json
    if ($sourceMap.schemaVersion -ne '1.0' -or $sourceMap.kind -ne 'junexis.debug-source-map') {
        throw 'Compiler returned an unsupported debug source-map.'
    }
    $mapping = $sourceMap.mappings |
        Where-Object { $_.generated.target -eq 'server' -and $_.kind -eq 'statement' } |
        Select-Object -First 1
    if ($null -eq $mapping) {
        throw 'Source-map contains no server statement mapping.'
    }

    $serverRoot = Join-Path $outputRoot 'server'
    & go -C $serverRoot mod tidy
    if ($LASTEXITCODE -ne 0) {
        throw "go mod tidy failed with exit code $LASTEXITCODE."
    }
    & go -C $serverRoot build -buildvcs=false '-gcflags=all=-N -l' -o junexis-e2e.exe .
    if ($LASTEXITCODE -ne 0) {
        throw "Go debug build failed with exit code $LASTEXITCODE."
    }

    $generatedPath = Join-Path $outputRoot ($mapping.generated.file -replace '/', '\')
    $initPath = Join-Path $outputRoot 'dlv-init.txt'
    @(
        "break $($generatedPath.Replace('\', '/')):$($mapping.generated.startLine)"
        'continue'
        'stack'
        'locals'
        'quit'
    ) | Set-Content -LiteralPath $initPath

    $executable = Join-Path $serverRoot 'junexis-e2e.exe'
    $previousErrorAction = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $dlvOutput = & dlv exec $executable --init $initPath --allow-non-terminal-interactive=true 2>&1
        $dlvExitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorAction
    }
    if ($dlvExitCode -ne 0) {
        throw "Delve smoke failed with exit code $dlvExitCode.`n$($dlvOutput -join "`n")"
    }
    $joined = $dlvOutput -join "`n"
    if ($joined -notmatch '\[Breakpoint 1\]' -or
        $joined -notmatch [regex]::Escape("main.go:$($mapping.generated.startLine)")) {
        throw "Delve did not hit the mapped generated location.`n$joined"
    }

    Write-Output 'E2E PASS'
    Write-Output "Build ID: $($build.buildId)"
    Write-Output "Junexis: $($mapping.source.file):$($mapping.source.line):$($mapping.source.column)"
    Write-Output "Generated: $($mapping.generated.file):$($mapping.generated.startLine):$($mapping.generated.startColumn)"
    Write-Output "Symbol: $($mapping.symbolId)"
}
finally {
    if (-not $KeepOutput) {
        Remove-VerifiedOutput
    }
}
