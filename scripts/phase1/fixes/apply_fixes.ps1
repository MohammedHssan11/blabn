# Applies scripts/phase1/fixes/fix-plan.json with Microsoft Excel.
# Each source workbook is copied to a scratch folder, edited there, recalculated
# and saved as the corrected copy. Originals in source-material/workbooks are
# never opened for writing.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\phase1\fixes\apply_fixes.ps1 -Repo <repo> -Scratch <scratch>
# -SkipProtected (no password): apply only operations on unprotected sheets; the skipped ones are listed in <scratch>\<id>-skipped.txt and protected sheets stay unchanged.
param([string]$Repo, [string]$Scratch, [string]$Only = '', [string]$SheetPassword = '', [switch]$SkipProtected)
$ErrorActionPreference = 'Stop'
$plan = Get-Content -Raw -Encoding UTF8 (Join-Path $Repo 'scripts\phase1\fixes\fix-plan.json') | ConvertFrom-Json
New-Item -ItemType Directory -Force $Scratch | Out-Null
New-Item -ItemType Directory -Force (Join-Path $Repo 'source-material\corrected') | Out-Null
$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false; $excel.DisplayAlerts = $false; $excel.AskToUpdateLinks = $false; $excel.ScreenUpdating = $false
function SetProp($obj, [string]$name, $value) { [void]$obj.GetType().InvokeMember($name, [Reflection.BindingFlags]::SetProperty, $null, $obj, @($value)) }
try {
  foreach ($wb in $plan) {
    if ($Only -and $wb.id -ne $Only) { continue }
    $src = Join-Path $Repo ($wb.source -replace '/', '\')
    $work = Join-Path $Scratch ($wb.id + '-work.xlsx')
    $dest = Join-Path $Repo ($wb.output -replace '/', '\')
    Copy-Item -LiteralPath $src -Destination $work -Force
    $book = $excel.Workbooks.Open($work, 0, $false)
    $excel.Calculation = -4135   # manual while editing
    $n = 0
    $protected = @{}
    $skipped = New-Object System.Collections.ArrayList
    foreach ($op in $wb.ops) {
      try {
        if ($op.delete_sheet) { $book.Sheets.Item([string]$op.delete_sheet).Delete(); $n++; continue }
        if ($op.rename_sheet) { $book.Sheets.Item([string]$op.rename_sheet).Name = [string]$op.to; $n++; continue }
        if ($op.copy_sheet) {
          $s = $book.Worksheets.Item([string]$op.copy_sheet); $s.Copy([Type]::Missing, $s)
          $excel.ActiveSheet.Name = [string]$op.to; $n++; continue
        }
        if ($op.break_links) {
          $links = $book.LinkSources(1)
          if ($null -ne $links) { foreach ($l in $links) { $book.BreakLink([string]$l, 1) } }  # LinkSources returns a 1-based array: never index it
          $n++; continue
        }
        $ws = $book.Worksheets.Item([string]$op.sheet)
        if ($ws.ProtectContents -and $SkipProtected -and -not $SheetPassword) {
          [void]$skipped.Add(("{0} {1}!{2}" -f $op.finding, $op.sheet, $op.range)); continue
        }
        if ($ws.ProtectContents -and -not $protected.ContainsKey($ws.Name)) {
          # Never guess or remove an unknown password: without -SheetPassword a protected sheet stops this workbook.
          $ws.Unprotect($SheetPassword); $protected[$ws.Name] = 1
        }
        $rng = $ws.Range([string]$op.range)
        if ($op.replace) { [void]$rng.Replace($op.replace, $op.to, 1) }
        elseif ($op.PSObject.Properties.Name -contains 'formula') { SetProp $rng 'Formula' ([string]$op.formula) }
        elseif ($op.PSObject.Properties.Name -contains 'date') {
          if ($rng.NumberFormat -eq 'General' -and -not $op.numfmt) { SetProp $rng 'NumberFormat' 'yyyy-mm-dd' }
          [double]$oa = [datetime]::ParseExact([string]$op.date, 'yyyy-MM-dd', [Globalization.CultureInfo]::InvariantCulture).ToOADate()
          SetProp $rng 'Value2' $oa
        }
        elseif ($op.clear) {
          try { [void]$rng.ClearContents() }
          catch {
            # Range touches merged cells: clear each merge area once.
            $done = @{}
            foreach ($c in $rng.Cells) {
              $m = $c.MergeArea; $a = $m.Address()
              if (-not $done.ContainsKey($a)) { [void]$m.ClearContents(); $done[$a] = 1 }
            }
          }
        }
        elseif ($op.PSObject.Properties.Name -contains 'value') { SetProp $rng 'Value2' $op.value }
        if ($op.numfmt) { SetProp $rng 'NumberFormat' ([string]$op.numfmt) }
        $n++
      } catch {
        $book.Close($false); Remove-Item -LiteralPath $work -Force
        throw ("{0}: failed op {1} {2} {3}: {4} at {5}" -f $wb.id, $op.finding, $op.sheet, $op.range, $_.Exception.Message, $_.InvocationInfo.PositionMessage)
      }
    }
    foreach ($name in $protected.Keys) { $book.Worksheets.Item($name).Protect($SheetPassword) }
    $excel.Calculation = -4105
    $excel.CalculateFullRebuild()
    if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Force }
    $book.SaveAs($dest, 51)
    $book.Close($false)
    Remove-Item -LiteralPath $work -Force
    if ($skipped.Count) { $skipped | Set-Content -Encoding UTF8 (Join-Path $Scratch ($wb.id + '-skipped.txt')) }
    "{0}: {1} operations -> {2} ({3} skipped on protected sheets)" -f $wb.id, $n, $wb.output, $skipped.Count
  }
} finally {
  $excel.Quit()
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null
}
