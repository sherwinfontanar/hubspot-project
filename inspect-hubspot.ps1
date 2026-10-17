$ErrorActionPreference = "Stop"

$tokenLine = Get-Content .env |
    Where-Object { $_ -match '^HUBSPOT_ACCESS_TOKEN=' } |
    Select-Object -First 1

if (-not $tokenLine) {
    throw "HUBSPOT_ACCESS_TOKEN not found in .env"
}

$token = ($tokenLine -replace '^HUBSPOT_ACCESS_TOKEN=', '').Trim()

if (-not $token -or $token -eq 'replace_with_your_private_app_token') {
    throw "Set your real token in .env first."
}

$headers = @{ Authorization = "Bearer $token" }

Write-Host "`n=== DEAL PIPELINES AND STAGES ==="

$pipelines = Invoke-RestMethod `
    -Uri "https://api.hubapi.com/crm/v3/pipelines/deals" `
    -Headers $headers `
    -Method Get

foreach ($pipeline in $pipelines.results) {
    Write-Host "`nPipeline: $($pipeline.label)"
    Write-Host "Pipeline ID: $($pipeline.id)"

    foreach ($stage in $pipeline.stages) {
        Write-Host "  Stage: $($stage.label) | ID: $($stage.id) | Archived: $($stage.archived)"
    }
}

Write-Host "`n=== DEAL ORDER ID PROPERTY ==="

try {
    $property = Invoke-RestMethod `
        -Uri "https://api.hubapi.com/crm/v3/properties/deals/order_id" `
        -Headers $headers `
        -Method Get

    Write-Host "Property exists: $($property.name)"
    Write-Host "Label: $($property.label)"
    Write-Host "Type: $($property.type)"
    Write-Host "Unique values: $($property.hasUniqueValue)"
} catch {
    $status = [int]$_.Exception.Response.StatusCode

    if ($status -eq 404) {
        Write-Host "The order_id property does not exist yet."
    } else {
        Write-Host "Property lookup failed with HTTP $status."
    }
}
