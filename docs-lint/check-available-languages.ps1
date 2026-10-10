param(
    [Parameter(Mandatory = $false)]
    [string]$TargetRoot
)

$ErrorActionPreference = "Stop"

function Resolve-Link {
    param(
        [string]$BasePath,
        [string]$Relative
    )

    return [System.IO.Path]::GetFullPath((Join-Path -Path $BasePath -ChildPath $Relative))
}

if ([string]::IsNullOrWhiteSpace($TargetRoot)) {
    $root = (Get-Location).Path
}
else {
    $root = [System.IO.Path]::GetFullPath($TargetRoot)
}

if (-not (Test-Path $root)) {
    Write-Error "TargetRoot does not exist: $root"
    exit 1
}

$failed = @()

function Check-File {
    param([string]$Path)

    $content = Get-Content $Path -Raw
    $dir = Split-Path -Parent $Path

    if ($content -match 'Available Languages:\*\*\s*(.+)') {
        $links = $Matches[1] -split '\|'
        foreach ($link in $links) {
            if ($link -match '\(([^)]+)\)') {
                $target = $Matches[1].Trim()
                if ($target -ne 'TODO' -and $target -ne '' -and -not ($target -like 'English (this file)')) {
                    $resolved = Resolve-Link -BasePath $dir -Relative $target
                    if (-not (Test-Path $resolved)) {
                        $failed += ('"{0}" -> missing linked file "{1}"' -f $Path, $target)
                    }
                }
            }
        }
    }
}

Get-ChildItem -Path $root -Filter *.md -Recurse -File | ForEach-Object {
    Check-File -Path $_.FullName
}

if ($failed.Count -gt 0) {
    Write-Error ("Available Languages check failed:`n" + ($failed -join "`n"))
    exit 1
}
else {
    Write-Output "Available Languages links ok."
}