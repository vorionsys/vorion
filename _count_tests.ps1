Set-Location C:\voriongit\vorion
$all = Get-ChildItem -Recurse -Include *.test.ts,*.spec.ts,*.test.tsx,*.spec.tsx -File
$clean = @($all | Where-Object { -not ($_.FullName -like '*node_modules*' -or $_.FullName -like '*stryker*' -or $_.FullName -like '*.next*') })
Write-Host "TOTAL_ALL: $($all.Count)"
Write-Host "TOTAL_CLEAN: $($clean.Count)"

# Trust-related test files
$trust = @($clean | Where-Object { $_.FullName -like '*trust*' })
Write-Host "`nTRUST_TEST_FILES: $($trust.Count)"
$trust | ForEach-Object { Write-Host "  $_" }

# Compliance/NIST test files
$comp = @($clean | Where-Object { $_.FullName -like '*compliance*' -or $_.FullName -like '*nist*' -or $_.FullName -like '*800-53*' })
Write-Host "`nCOMPLIANCE_TEST_FILES: $($comp.Count)"
$comp | ForEach-Object { Write-Host "  $_" }

# Security test files
$sec = @($clean | Where-Object { $_.FullName -like '*security*' })
Write-Host "`nSECURITY_TEST_FILES: $($sec.Count)"
$sec | ForEach-Object { Write-Host "  $_" }

# Group by top-level directory
Write-Host "`nBY_DIRECTORY:"
$clean | ForEach-Object { 
    $rel = $_.FullName -replace [regex]::Escape('C:\voriongit\vorion\'), ''
    $parts = $rel -split '\\'
    if ($parts.Count -gt 1) { $parts[0] + '\' + $parts[1] } else { $parts[0] }
} | Group-Object | Sort-Object Count -Descending | ForEach-Object { Write-Host "  $($_.Count) $($_.Name)" }
