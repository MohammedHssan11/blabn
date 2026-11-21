# Phase 1: recalculate scratch COPIES of the source workbooks with Microsoft Excel.
# Originals are never opened for writing. External links are not refreshed
# (UpdateLinks = 0), so externally linked cells keep their cached values.
# Usage: powershell -File recalc_with_excel.ps1 -Root <workspace> -Out <scratch\recalc>
param([string]$Root, [string]$Out)
$ErrorActionPreference = 'Stop'
$inv = Get-Content -Raw -Encoding UTF8 (Join-Path $Root 'blabn\docs\phase1\source-inventory.json') | ConvertFrom-Json
New-Item -ItemType Directory -Force $Out | Out-Null
$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false
$excel.DisplayAlerts = $false
$excel.AskToUpdateLinks = $false
try {
  foreach ($wb in $inv.workbooks) {
    $src = Join-Path $Root ($wb.path -replace '/', '\')
    $copy = Join-Path $Out ($wb.id + '-orig.xlsx')
    $dest = Join-Path $Out ($wb.id + '-recalc.xlsx')
    Copy-Item -LiteralPath $src -Destination $copy -Force
    $t = Get-Date
    $book = $excel.Workbooks.Open($copy, 0, $false)
    $excel.Calculation = -4105   # xlCalculationAutomatic
    $excel.CalculateFullRebuild()
    $book.SaveAs($dest, 51)
    $book.Close($false)
    Remove-Item -LiteralPath $copy -Force
    "{0} recalculated in {1:n1}s" -f $wb.id, ((Get-Date) - $t).TotalSeconds
  }
} finally {
  $excel.Quit()
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null
}
