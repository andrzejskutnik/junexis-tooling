<#
.SYNOPSIS
    Buduje mały, wersjonowany plik VSIX dla wydania platformy Junexis.

.DESCRIPTION
    Rozszerzenie wydania korzysta z LSP zainstalowanego przez Junexis. Nie
    dołącza własnej kopii katalogu runtime, dzięki czemu Studio i VS Code
    używają jednego, sprawdzonego serwera językowego.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Version,
    [Parameter(Mandatory = $true)][string]$OutputPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$extensionRoot = Split-Path -Parent $PSScriptRoot
$runtimeRoot = Join-Path $extensionRoot 'runtime'
if (Test-Path -LiteralPath $runtimeRoot) {
    throw "Runtime directory cannot be included in the lightweight release VSIX: $runtimeRoot"
}

$resolvedOutput = [IO.Path]::GetFullPath($OutputPath)
$outputDirectory = Split-Path -Parent $resolvedOutput
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null

$vsce = Join-Path $extensionRoot 'node_modules\.bin\vsce.cmd'
if (-not (Test-Path -LiteralPath $vsce -PathType Leaf)) {
    throw 'Local vsce was not found. Run npm ci in the vscode-extension directory.'
}

$arguments = @(
    'package',
    $Version,
    '--no-update-package-json',
    '--allow-missing-repository',
    '--no-dependencies',
    '--out',
    $resolvedOutput
)
if ($Version.Contains('-')) {
    $arguments += '--pre-release'
}

Push-Location $extensionRoot
try {
    & $vsce @arguments
    if ($LASTEXITCODE -ne 0) {
        throw "VSIX packaging failed with code $LASTEXITCODE."
    }
}
finally {
    Pop-Location
}

if (-not (Test-Path -LiteralPath $resolvedOutput -PathType Leaf)) {
    throw "VSIX packaging did not create the expected file: $resolvedOutput"
}

Write-Output $resolvedOutput
