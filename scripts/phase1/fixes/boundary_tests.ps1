# Boundary tests for the corrected workbook copies: missing values, explicit zeros and empty periods.
# Each test opens a scratch copy of a corrected workbook in Microsoft Excel, enters test inputs,
# recalculates and reads the result. Nothing is saved; the corrected copies are not modified.
# Writes docs/phase1/boundary-tests.json.
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\phase1\fixes\boundary_tests.ps1 -Repo <repo> -Scratch <scratch>
param([string]$Repo, [string]$Scratch)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force $Scratch | Out-Null
$excel = New-Object -ComObject Excel.Application
$excel.Visible = $false; $excel.DisplayAlerts = $false; $excel.AskToUpdateLinks = $false; $excel.ScreenUpdating = $false
function SetProp($obj, [string]$name, $value) { [void]$obj.GetType().InvokeMember($name, [Reflection.BindingFlags]::SetProperty, $null, $obj, @($value)) }
$results = New-Object System.Collections.ArrayList

# A test: name, file, set = @(@(sheet, address, value-or-$null)), expect = @(@(sheet, address, expected))
# expected: 'blank' (empty or ""), a number, 'ref:<sheet>!<addr>' (equal to that cell), 'neg:<sheet>!<addr>' (minus that cell)
$tests = @(
  @{ name = 'Daily Sales: ratio blank when the day has no sales (blank)'; file = 'daily-sales-nov-2026.xlsx'
     set = @(@('Sheet1','B25',$null), @('Sheet1','H25',$null), @('Sheet1','J25',$null)); expect = @(@('Sheet1','I25','blank'), @('Sheet1','K25','blank')) },
  @{ name = 'Daily Sales: ratio blank when sales are an explicit 0 (division undefined)'; file = 'daily-sales-nov-2026.xlsx'
     set = @(@('Sheet1','B25',0), @('Sheet1','H25',0), @('Sheet1','J25',0)); expect = @(@('Sheet1','I25','blank'), @('Sheet1','K25','blank')) },
  @{ name = 'Daily Sales: ratio computed for a normal day'; file = 'daily-sales-nov-2026.xlsx'
     set = @(@('Sheet1','B25',1000), @('Sheet1','H25',250), @('Sheet1','J25',300)); expect = @(@('Sheet1','I25',0.25), @('Sheet1','K25',0.3)) },
  @{ name = 'Daily Sales: average blank when orders are blank (P1-03)'; file = 'daily-sales-nov-2026.xlsx'
     set = @(@('Sheet1','B25',1000), @('Sheet1','C25',$null)); expect = @(@('Sheet1','D25','blank')) },
  @{ name = 'Daily Sales: average blank when orders are an explicit 0 (P1-03)'; file = 'daily-sales-nov-2026.xlsx'
     set = @(@('Sheet1','B25',1000), @('Sheet1','C25',0)); expect = @(@('Sheet1','D25','blank')) },
  @{ name = 'Daily Sales: average = sales / orders, two decimals (P1-03)'; file = 'daily-sales-nov-2026.xlsx'
     set = @(@('Sheet1','B25',1000), @('Sheet1','C25',3)); expect = @(@('Sheet1','D25',333.33)) },
  @{ name = 'Daily Sales: average 0 when sales are an explicit 0 and orders recorded (P1-03)'; file = 'daily-sales-nov-2026.xlsx'
     set = @(@('Sheet1','B25',0), @('Sheet1','C25',5)); expect = @(@('Sheet1','D25',0)) },
  @{ name = 'Daily Sales: total row blank for a month with no entries'; file = 'daily-sales-nov-2026.xlsx'; clear = @(@('Sheet1','B3:C34'), @('Sheet1','G3:H34'), @('Sheet1','J3:J34'))
     set = @(); expect = @(@('Sheet1','D35','blank'), @('Sheet1','I35','blank'), @('Sheet1','K35','blank'), @('Sheet1','B35',0)) },
  @{ name = 'Comparison: growth blank when the current day is not entered'; file = 'sales-comparison-nov-2026.xlsx'
     set = @(@(1,'J8',$null), @(1,'F8',50000)); expect = @(@(1,'D8','blank')) },
  @{ name = 'Comparison: growth -100% when current sales are an explicit 0'; file = 'sales-comparison-nov-2026.xlsx'
     set = @(@(1,'J8',0), @(1,'F8',50000)); expect = @(@(1,'D8',-1)) },
  @{ name = 'Comparison: growth blank when the prior figure is 0'; file = 'sales-comparison-nov-2026.xlsx'
     set = @(@(1,'J8',60000), @(1,'F8',0)); expect = @(@(1,'D8','blank')) },
  @{ name = 'Comparison: growth blank when the prior figure is missing'; file = 'sales-comparison-nov-2026.xlsx'
     set = @(@(1,'J8',60000), @(1,'F8',$null)); expect = @(@(1,'D8','blank')) },
  @{ name = 'Comparison: growth for a normal day'; file = 'sales-comparison-nov-2026.xlsx'
     set = @(@(1,'J8',60000), @(1,'F8',50000)); expect = @(@(1,'D8',0.2)) },
  @{ name = 'Comparison: like-for-like total blank when no current day is entered'; file = 'sales-comparison-nov-2026.xlsx'; clear = @(@(1,'J6:J36'))
     set = @(); expect = @(@(1,'D37','blank')) },
  @{ name = 'Comparison: like-for-like total uses only days entered in both months'; file = 'sales-comparison-nov-2026.xlsx'; clear = @(@(1,'J6:J36'), @(1,'F6:F36'))
     set = @(@(1,'J6',110), @(1,'F6',100), @(1,'J7',0), @(1,'F7',100), @(1,'F8',500)); expect = @(@(1,'D37',-0.45)) },
  @{ name = 'Statement: over/short blank when system revenue is missing'; file = 'daily-statement-nov-2026.xlsx'
     set = @(@('27','D6',100), @('27','I25',$null)); expect = @(@('27','I17','blank'), @('27','I23',100)) },
  @{ name = 'Statement: over/short computed when system revenue is an explicit 0'; file = 'daily-statement-nov-2026.xlsx'
     set = @(@('27','D6',100), @('27','I25',0)); expect = @(@('27','I17',100)) },
  @{ name = 'Statement: over/short 0 when totals agree'; file = 'daily-statement-nov-2026.xlsx'
     set = @(@('27','D6',100), @('27','I25',100)); expect = @(@('27','I17',0)) },
  @{ name = 'Inventory: uncounted item opens next day at its book balance, no deviation'; file = 'inventory-nov-2026-days-1-13.xlsx'
     set = @(@('1','AC40',$null)); expect = @(@('2','P40','ref:1!AB40'), @('1','AD40','blank')) },
  @{ name = 'Inventory: explicit 0 count is a count (opens at 0, deviation = -book)'; file = 'inventory-nov-2026-days-1-13.xlsx'
     set = @(@('1','AC40',0)); expect = @(@('2','P40',0), @('1','AD40','neg:1!AB40')) },
  @{ name = 'Inventory: count equal to book gives deviation 0'; file = 'inventory-nov-2026-days-1-13.xlsx'
     set = @(@('1','AC40',4)); expect = @(@('1','AD40',0), @('2','P40',4)) },
  @{ name = 'Inventory: monthly deviation equals the cumulative deviation of the last day'; file = 'inventory-nov-2026-days-1-13.xlsx'
     set = @(); expect = @(@('Total','AD89','ref:31!AE89'), @('Total','AD40','ref:31!AE40')) },
  @{ name = 'Inventory: Product Mix share blank on a day with no sales'; file = 'inventory-nov-2026-days-1-13.xlsx'
     set = @(); expect = @(@('20','H8','blank'), @('20','I8','blank')) },
  @{ name = 'Review template: difference blank before a count'; file = 'inventory-review-template-nov-2026.xlsx'
     set = @(@('Sheet1','L7',$null)); expect = @(@('Sheet1','K7','blank')) },
  @{ name = 'Review template: explicit 0 count gives difference = -expected'; file = 'inventory-review-template-nov-2026.xlsx'
     set = @(@('Sheet1','L7',0)); expect = @(@('Sheet1','K7','neg:Sheet1!M7')) },
  @{ name = 'Review template: expected = total - consumption'; file = 'inventory-review-template-nov-2026.xlsx'
     set = @(@('Sheet1','O7',2)); expect = @(@('Sheet1','M7','calc:N-O')) }
)

function Sheet($book, $s) {
  try { if ($s -is [int]) { return $book.Worksheets.Item([int]$s) } else { return $book.Worksheets.Item([string]$s) } }
  catch { throw ("sheet '{0}' not found in {1}" -f $s, $book.Name) }
}
function IsBlank($v) { return ($null -eq $v) -or ($v -is [string] -and $v -eq '') }
function Read($book, $ref) { $p = $ref.Split('!'); return (Sheet $book $p[0]).Range($p[1]).Value2 }

$books = @{}
try {
  foreach ($t in $tests) {
    if (-not $books.ContainsKey($t.file)) {
      $work = Join-Path $Scratch ('bt-' + $t.file)
      Copy-Item -LiteralPath (Join-Path $Repo ('source-material\corrected\' + $t.file)) -Destination $work -Force
      $books[$t.file] = $excel.Workbooks.Open($work, 0, $true)
    }
    $book = $books[$t.file]
    # PowerShell flattens a one-item @(@(...)): wrap such lists again
    foreach ($k in 'set', 'expect', 'clear') { $v = $t[$k]; if ($v -and $v.Count -and $v[0] -isnot [array]) { $t[$k] = ,$v } }
    $saved = New-Object System.Collections.ArrayList
    foreach ($c in @($t["clear"])) { if ($c) { $r = (Sheet $book $c[0]).Range($c[1]); foreach ($cell in $r.Cells) { [void]$saved.Add(@($cell, [string]$cell.Formula)) }; [void]$r.ClearContents() } }
    foreach ($s in $t.set) {
      $r = (Sheet $book $s[0]).Range($s[1]); [void]$saved.Add(@($r, [string]$r.Formula))
      if ($null -eq $s[2]) { [void]$r.MergeArea.ClearContents() } else { SetProp $r 'Value2' ([double]$s[2]) }
    }
    $excel.CalculateFull()
    $checks = @(); $ok = $true
    foreach ($e in $t.expect) {
      $ws = Sheet $book $e[0]; $got = $ws.Range($e[1]).Value2; $want = $e[2]
      if ($want -eq 'blank') { $pass = IsBlank $got; $wantShow = '(blank)' }
      elseif ($want -is [string] -and $want.StartsWith('ref:')) { $w = Read $book $want.Substring(4); $pass = (-not (IsBlank $got)) -and [math]::Abs([double]$got - [double]$w) -lt 1e-9; $wantShow = "$w ($($want.Substring(4)))" }
      elseif ($want -is [string] -and $want.StartsWith('neg:')) { $w = -[double](Read $book $want.Substring(4)); $pass = (-not (IsBlank $got)) -and [math]::Abs([double]$got - $w) -lt 1e-9; $wantShow = "$w (-$($want.Substring(4)))" }
      elseif ($want -eq 'calc:N-O') { $w = [double]$ws.Range('N7').Value2 - [double]$ws.Range('O7').Value2; $pass = [math]::Abs([double]$got - $w) -lt 1e-9; $wantShow = "$w (N7-O7)" }
      else { $pass = (-not (IsBlank $got)) -and ($got -isnot [string]) -and [math]::Abs([double]$got - [double]$want) -lt 1e-9; $wantShow = $want }
      if ($got -is [int] -and $got -lt -2146820000) { $pass = $false }   # Excel error value
      if (-not $pass) { $ok = $false }
      $checks += [ordered]@{ cell = "$($e[0])!$($e[1])"; got = $(if (IsBlank $got) { '(blank)' } else { $got }); want = $wantShow; ok = $pass }
    }
    # restore what this test changed so later tests start from the corrected copy
    for ($i = $saved.Count - 1; $i -ge 0; $i--) { SetProp $saved[$i][0] 'Formula' $saved[$i][1] }
    $excel.CalculateFull()
    [void]$results.Add([ordered]@{ test = $t.name; file = $t.file; ok = $ok; checks = $checks })
    "{0} {1}" -f $(if ($ok) { 'PASS' } else { 'FAIL' }), $t.name
  }
} finally {
  foreach ($b in $books.Values) { $b.Close($false) }
  $excel.Quit()
  [System.Runtime.InteropServices.Marshal]::ReleaseComObject($excel) | Out-Null
  foreach ($f in $books.Keys) { Remove-Item -LiteralPath (Join-Path $Scratch ('bt-' + $f)) -Force -ErrorAction SilentlyContinue }
}
$out = [ordered]@{
  generated = (Get-Date).ToString('s'); passed = @($results | Where-Object { $_.ok }).Count; total = $results.Count
  not_tested = @(
    'Ledger copies (SRC-10/11): cancellation totals and carry-forward read protected day sheets; inputs cannot be entered without the sheet password.',
    'Weekly comparison (SRC-12): only dates changed (P1-10); the ratio formulas are the original ones.'
  )
  results = $results
}
$out | ConvertTo-Json -Depth 6 | Set-Content -Encoding UTF8 (Join-Path $Repo 'docs\phase1\boundary-tests.json')
"{0}/{1} boundary tests passed" -f $out.passed, $out.total
