param(
    [Parameter(Mandatory = $false)]
    [string]$TargetRoot
)

$ErrorActionPreference = "Stop"

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

$targets = @()
$targets += Get-ChildItem -Path $root -Filter *.md -File
$docsPath = Join-Path $root "docs"
if (Test-Path $docsPath) {
    $targets += Get-ChildItem -Path $docsPath -Filter *.md -Recurse -File
}

foreach ($file in $targets) {
    $path = $file.FullName
    if ($path -match 'AGENTS\.md$' -or $path -match 'AGENTS-PL\.md$') {
        continue
    }

    $content = Get-Content $path -Raw
    if ($content -match '##\s+Status' -or $content -match '\*\*Status:\*\*') {
        $failed += ('"{0}" contains its own status section; status belongs only in AGENTS.md.' -f $path)
    }
}

if ($failed.Count -gt 0) {
    Write-Error ("Status location check failed:`n" + ($failed -join "`n"))
    exit 1
}
else {
    Write-Output "Status sections limited to AGENTS*.md."
}