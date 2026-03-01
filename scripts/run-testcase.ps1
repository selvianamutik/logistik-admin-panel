param(
    [int]$Port = 3105,
    [string]$OutputJson = "automated_test_results_latest.json"
)

$ErrorActionPreference = "Stop"

$base = "http://127.0.0.1:$Port"
$results = @()

function Add-Result {
    param([string]$id, [bool]$pass, [string]$detail)
    $script:results += [pscustomobject]@{
        id = $id
        status = $(if ($pass) { "PASS" } else { "FAIL" })
        detail = $detail
    }
}

function Invoke-TestRequest {
    param(
        [string]$Method,
        [string]$Url,
        [object]$Body = $null,
        [Microsoft.PowerShell.Commands.WebRequestSession]$Session = $null,
        [switch]$NoRedirect
    )

    $params = @{
        Uri = $Url
        Method = $Method
        ErrorAction = "Stop"
    }

    if ($null -ne $Session) {
        $params.WebSession = $Session
    }
    if ($NoRedirect) {
        $params.MaximumRedirection = 0
    }
    if ($null -ne $Body) {
        $params.ContentType = "application/json"
        $params.Body = ($Body | ConvertTo-Json -Depth 10)
    }

    try {
        $resp = Invoke-WebRequest @params
        $json = $null
        try { $json = $resp.Content | ConvertFrom-Json } catch {}
        return [pscustomobject]@{
            status = [int]$resp.StatusCode
            location = $resp.Headers["Location"]
            json = $json
            raw = $resp.Content
        }
    }
    catch {
        $ex = $_.Exception
        if ($ex.Response) {
            $statusCode = [int]$ex.Response.StatusCode
            $location = $ex.Response.Headers["Location"]
            $content = ""
            if ($ex.Response.GetResponseStream()) {
                $reader = New-Object System.IO.StreamReader($ex.Response.GetResponseStream())
                $content = $reader.ReadToEnd()
                $reader.Close()
            }
            $json = $null
            if ($content) {
                try { $json = $content | ConvertFrom-Json } catch {}
            }
            return [pscustomobject]@{
                status = $statusCode
                location = $location
                json = $json
                raw = $content
            }
        }
        throw
    }
}

$devOut = Join-Path (Get-Location) "automated_dev_server.out.log"
$devErr = Join-Path (Get-Location) "automated_dev_server.err.log"
if (Test-Path $devOut) { Remove-Item $devOut -Force }
if (Test-Path $devErr) { Remove-Item $devErr -Force }

$dev = Start-Process npm.cmd -ArgumentList @("run", "dev", "--", "--hostname", "127.0.0.1", "--port", "$Port") -PassThru -RedirectStandardOutput $devOut -RedirectStandardError $devErr

try {
    $ready = $false
    for ($i = 0; $i -lt 180; $i++) {
        Start-Sleep -Seconds 1
        try {
            $ping = Invoke-WebRequest -Uri "$base/login" -Method GET -ErrorAction Stop
            if ($ping.StatusCode -ge 200 -and $ping.StatusCode -lt 500) {
                $ready = $true
                break
            }
        }
        catch {}

        if ($dev.HasExited) {
            break
        }
    }

    Add-Result "ENV-001" $ready $(if ($ready) { "Dev server reachable at $base/login" } else { "Dev server not reachable within timeout or process exited" })
    if (-not $ready) { throw "Dev server not ready" }

    $r = Invoke-TestRequest -Method POST -Url "$base/api/auth/login" -Body @{}
    Add-Result "AUTH-001" ($r.status -eq 400) "Expected 400, got $($r.status)"

    $r = Invoke-TestRequest -Method POST -Url "$base/api/auth/login" -Body @{ email = "nobody@company.local"; password = "wrong" }
    Add-Result "AUTH-002" ($r.status -eq 401) "Expected 401, got $($r.status)"

    $ownerSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
    $adminSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession

    $ownerLogin = Invoke-TestRequest -Method POST -Url "$base/api/auth/login" -Body @{ email = "owner@company.local"; password = "TEST1234" } -Session $ownerSession
    Add-Result "AUTH-003" ($ownerLogin.status -eq 200) "Owner login status $($ownerLogin.status)"

    $adminLogin = Invoke-TestRequest -Method POST -Url "$base/api/auth/login" -Body @{ email = "admin@company.local"; password = "TEST1234" } -Session $adminSession
    Add-Result "AUTH-004" ($adminLogin.status -eq 200) "Admin login status $($adminLogin.status)"

    $r = Invoke-TestRequest -Method GET -Url "$base/api/auth/session" -Session $ownerSession
    $ownerName = if ($r.json -and $r.json.user) { [string]$r.json.user.name } else { "" }
    Add-Result "AUTH-005" ($r.status -eq 200 -and $ownerName.Length -gt 0) "Session status $($r.status), user='$ownerName'"

    $r = Invoke-TestRequest -Method GET -Url "$base/api/auth/session" -NoRedirect
    Add-Result "AUTH-006" ($r.status -eq 401) "Expected 401, got $($r.status)"

    $r = Invoke-TestRequest -Method POST -Url "$base/api/auth/logout" -Session $ownerSession
    $r2 = Invoke-TestRequest -Method GET -Url "$base/api/auth/session" -Session $ownerSession -NoRedirect
    Add-Result "AUTH-007" ($r.status -eq 200 -and $r2.status -eq 401) "Logout $($r.status), session after logout $($r2.status)"

    $r = Invoke-TestRequest -Method GET -Url "$base/dashboard" -NoRedirect
    $redirLogin = ($r.status -ge 300 -and $r.status -lt 400 -and [string]$r.location -like "*/login*")
    Add-Result "AUTH-008" $redirLogin "Status $($r.status), location '$($r.location)'"

    [void](Invoke-TestRequest -Method POST -Url "$base/api/auth/login" -Body @{ email = "owner@company.local"; password = "TEST1234" } -Session $ownerSession)
    $r = Invoke-TestRequest -Method GET -Url "$base/" -Session $ownerSession -NoRedirect
    $redirDash = ($r.status -ge 300 -and $r.status -lt 400 -and [string]$r.location -like "*/dashboard*")
    Add-Result "AUTH-009" $redirDash "Status $($r.status), location '$($r.location)'"

    $r = Invoke-TestRequest -Method GET -Url "$base/settings/users" -Session $adminSession -NoRedirect
    $rbacUsers = ($r.status -ge 300 -and $r.status -lt 400 -and [string]$r.location -like "*/dashboard*")
    Add-Result "RBAC-001" $rbacUsers "Status $($r.status), location '$($r.location)'"

    $r = Invoke-TestRequest -Method GET -Url "$base/reports" -Session $adminSession -NoRedirect
    $rbacReports = ($r.status -ge 300 -and $r.status -lt 400 -and [string]$r.location -like "*/dashboard*")
    Add-Result "RBAC-002" $rbacReports "Status $($r.status), location '$($r.location)'"

    $r = Invoke-TestRequest -Method GET -Url "$base/api/data?entity=orders" -NoRedirect
    Add-Result "API-001" ($r.status -eq 401) "Expected 401, got $($r.status)"

    $r = Invoke-TestRequest -Method POST -Url "$base/api/data" -Body @{ entity = "orders"; action = "create"; data = @{} } -NoRedirect
    Add-Result "API-002" ($r.status -eq 401) "Expected 401, got $($r.status)"

    $r = Invoke-TestRequest -Method GET -Url "$base/api/data?entity=invalid" -Session $ownerSession
    Add-Result "API-003" ($r.status -eq 400) "Expected 400, got $($r.status)"

    $r = Invoke-TestRequest -Method POST -Url "$base/api/data" -Session $ownerSession -Body @{ entity = "invalid"; action = "create"; data = @{} }
    Add-Result "API-004" ($r.status -eq 400) "Expected 400, got $($r.status)"

    $r = Invoke-TestRequest -Method GET -Url "$base/api/data?entity=orders&id=non-existent-id" -Session $ownerSession
    Add-Result "API-005" ($r.status -eq 404) "Expected 404, got $($r.status)"

    $r = Invoke-TestRequest -Method GET -Url "$base/api/data?entity=audit-logs" -Session $adminSession
    Add-Result "RBAC-006" ($r.status -eq 403) "Expected 403, got $($r.status)"
}
finally {
    if ($dev -and -not $dev.HasExited) {
        Stop-Process -Id $dev.Id -Force
    }
}

$resultsPath = Join-Path (Get-Location) $OutputJson
$results | ConvertTo-Json -Depth 10 | Set-Content -Path $resultsPath -Encoding UTF8

$pass = ($results | Where-Object { $_.status -eq "PASS" }).Count
$fail = ($results | Where-Object { $_.status -eq "FAIL" }).Count
Write-Output "Executed $($results.Count) tests: PASS=$pass FAIL=$fail"
$results | Format-Table -AutoSize | Out-String -Width 200 | Write-Output
Write-Output "Saved: $resultsPath"
