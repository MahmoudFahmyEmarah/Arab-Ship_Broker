[CmdletBinding()]
param(
  [switch]$KeepStack,
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$env:SUPABASE_TELEMETRY_DISABLED = "1"

$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))
$stackRoot = [IO.Path]::GetFullPath("C:\tmp\asb-rules-e2e")
$expectedRoot = [IO.Path]::GetFullPath("C:\tmp\asb-rules-e2e")
$expectedProject = "asb-rules-e2e"
$container = "supabase_db_asb-rules-e2e"
$containerGuard = Join-Path $PSScriptRoot "rules-e2e-container-guard.sh"
$bash = "C:\Program Files\Git\bin\bash.exe"

if ($stackRoot -ne $expectedRoot -or [IO.Path]::GetFileName($stackRoot) -ne $expectedProject) {
  throw "Refusing an unexpected disposable stack path: $stackRoot"
}

$supabaseDir = Join-Path $stackRoot "supabase"
$configPath = Join-Path $supabaseDir "config.toml"
$startAttempted = $false
$startSucceeded = $false
$runCompleted = $false
$primaryFailure = $null
$cleanupFailure = $null

function Invoke-CheckedNative(
  [string]$label,
  [scriptblock]$action,
  [switch]$Quiet
) {
  # Windows PowerShell 5 surfaces every native stderr line as an ErrorRecord.
  # Supabase writes informational text (for example, "Using workdir") there,
  # so ErrorActionPreference=Stop would abort a successful command before its
  # exit code can be inspected. Contain that quirk to the native invocation and
  # keep PowerShell cmdlets fail-fast everywhere else.
  $priorPreference = $ErrorActionPreference
  $nativeOutput = @()
  try {
    $ErrorActionPreference = "Continue"
    if ($Quiet) {
      $nativeOutput = @(& $action 2>&1)
    } else {
      & $action 2>&1 | ForEach-Object { Write-Host $_ }
    }
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $priorPreference
  }
  if ($exitCode -ne 0) {
    $detail = @(
      $nativeOutput |
        Select-Object -Last 80 |
        ForEach-Object { $_.ToString() }
    ) -join "`n"
    if ($detail) {
      throw "$label failed with exit code $exitCode`n$detail"
    }
    throw "$label failed with exit code $exitCode"
  }
}

function Assert-ExactProjectConfig([string]$path) {
  if (!(Test-Path -LiteralPath $path -PathType Leaf)) {
    throw "Refusing to manage a disposable stack without its config: $path"
  }

  $content = [IO.File]::ReadAllText($path)
  $allProjectIds = [regex]::Matches($content, '(?m)^\s*project_id\s*=')
  $expectedProjectIds = [regex]::Matches(
    $content,
    '(?m)^\s*project_id\s*=\s*"asb-rules-e2e"\s*(?:#.*)?$'
  )
  if ($allProjectIds.Count -ne 1 -or $expectedProjectIds.Count -ne 1) {
    throw "Refusing a stack config whose sole project_id is not exactly $expectedProject."
  }
}

function Assert-TomlSectionValue(
  [string]$content,
  [string]$section,
  [string]$key,
  [string]$expectedValue
) {
  $sectionPattern = '(?ms)^\s*\[' + [regex]::Escape($section) + '\]\s*$' +
    '(?<body>.*?)(?=^\s*\[|\z)'
  $sectionMatch = [regex]::Match($content, $sectionPattern)
  if (!$sectionMatch.Success) {
    throw "Generated disposable config is missing [$section]."
  }

  $valuePattern = '(?m)^\s*' + [regex]::Escape($key) + '\s*=\s*' +
    [regex]::Escape($expectedValue) + '\s*(?:#.*)?$'
  $matches = [regex]::Matches($sectionMatch.Groups['body'].Value, $valuePattern)
  if ($matches.Count -ne 1) {
    throw "Generated disposable config must contain exactly [$section] $key = $expectedValue."
  }
}

function Assert-GeneratedStackConfig([string]$path) {
  Assert-ExactProjectConfig $path
  $content = [IO.File]::ReadAllText($path)
  Assert-TomlSectionValue $content "api" "port" "55321"
  Assert-TomlSectionValue $content "db" "port" "55322"
  Assert-TomlSectionValue $content "db" "shadow_port" "55320"
  Assert-TomlSectionValue $content "db.pooler" "port" "55329"
  Assert-TomlSectionValue $content "studio" "port" "55323"
  Assert-TomlSectionValue $content "inbucket" "port" "55324"
  Assert-TomlSectionValue $content "edge_runtime" "inspector_port" "5583"
  Assert-TomlSectionValue $content "analytics" "port" "55327"
  Assert-TomlSectionValue $content "auth" "site_url" '"http://127.0.0.1:3103"'
  Assert-TomlSectionValue $content "auth" "additional_redirect_urls" '["http://127.0.0.1:3103"]'
  Assert-TomlSectionValue $content "db.seed" "enabled" "false"
}

function Get-DisposableProjectContainers {
  $priorPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    $names = @(
      & docker container ls --all `
        --filter "label=com.supabase.cli.project=$expectedProject" `
        --format "{{.Names}}" 2>$null
    )
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $priorPreference
  }
  if ($exitCode -ne 0) {
    throw "listing disposable Supabase containers failed with exit code $exitCode"
  }
  return @($names | Where-Object { $_ -and $_.Trim() } | ForEach-Object { $_.Trim() })
}

function Test-ExactDatabaseContainerExists {
  $priorPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    $names = @(& docker container ls --all --format "{{.Names}}" 2>$null)
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $priorPreference
  }
  if ($exitCode -ne 0) {
    throw "listing Docker containers failed with exit code $exitCode"
  }
  return @($names | Where-Object { $_ -eq $container }).Count -eq 1
}

function Assert-DisposableDatabaseContainer {
  Invoke-CheckedNative "verifying disposable container identity" {
    & $bash $containerGuard $container
  }
}

function Stop-DisposableStack([string]$reason) {
  Assert-ExactProjectConfig $configPath
  $projectContainers = @(Get-DisposableProjectContainers)
  $databaseContainerExists = Test-ExactDatabaseContainerExists
  if ($databaseContainerExists -and $projectContainers -notcontains $container) {
    throw "Refusing ${reason}: the expected database container name exists without the exact disposable-project label."
  }
  if ($projectContainers.Count -eq 0) {
    return
  }
  if ($projectContainers -notcontains $container) {
    throw "Refusing ${reason}: project-labelled containers exist without the expected database container."
  }

  Assert-DisposableDatabaseContainer
  Invoke-CheckedNative $reason {
    & supabase stop --workdir $stackRoot --no-backup
  } -Quiet

  $remaining = @(Get-DisposableProjectContainers)
  $databaseContainerRemains = Test-ExactDatabaseContainerExists
  if ($remaining.Count -ne 0 -or $databaseContainerRemains) {
    throw "$reason left project-labelled containers behind: $($remaining -join ', ')"
  }
}

function Remove-ExistingDisposableStack {
  if (!(Test-Path -LiteralPath $stackRoot)) {
    $orphanedProjectContainers = @(Get-DisposableProjectContainers)
    $orphanedDatabaseContainer = Test-ExactDatabaseContainerExists
    if ($orphanedProjectContainers.Count -gt 0 -or $orphanedDatabaseContainer) {
      throw "Refusing to create a disposable stack over containers that have no exact, validated stack config."
    }
    return
  }

  Assert-ExactProjectConfig $configPath
  $projectContainers = @(Get-DisposableProjectContainers)
  $databaseContainerExists = Test-ExactDatabaseContainerExists
  if ($databaseContainerExists -and $projectContainers -notcontains $container) {
    throw "Refusing to remove a stack whose database container name is not bound to the exact disposable project label."
  }
  if ($projectContainers.Count -gt 0) {
    Stop-DisposableStack "stopping the existing disposable Supabase stack"
  }

  # Revalidate immediately before the only recursive deletion in this harness.
  Assert-ExactProjectConfig $configPath
  Remove-Item -LiteralPath $stackRoot -Recurse -Force
}

Push-Location $repoRoot
try {
  try {
    Remove-ExistingDisposableStack
    New-Item -ItemType Directory -Path $supabaseDir -Force | Out-Null

    $sourceConfigPath = Join-Path $repoRoot "supabase\config.toml"
    $config = [IO.File]::ReadAllText($sourceConfigPath)
    $config = $config.Replace('project_id = "arab-ship-broker"', 'project_id = "asb-rules-e2e"')
    $config = $config.Replace('port = 54321', 'port = 55321')
    $config = $config.Replace('port = 54322', 'port = 55322')
    $config = $config.Replace('shadow_port = 54320', 'shadow_port = 55320')
    $config = $config.Replace('port = 54329', 'port = 55329')
    $config = $config.Replace('port = 54323', 'port = 55323')
    $config = $config.Replace('port = 54324', 'port = 55324')
    $config = $config.Replace('port = 54327', 'port = 55327')
    $config = $config.Replace('inspector_port = 8083', 'inspector_port = 5583')
    $config = $config.Replace('site_url = "http://127.0.0.1:3000"', 'site_url = "http://127.0.0.1:3103"')
    $config = $config.Replace(
      'additional_redirect_urls = ["https://127.0.0.1:3000"]',
      'additional_redirect_urls = ["http://127.0.0.1:3103"]'
    )
    $seedRegex = [regex]::new(
      '(?ms)(\[db\.seed\].*?enabled = )true',
      [Text.RegularExpressions.RegexOptions]::None
    )
    $config = $seedRegex.Replace($config, '${1}false', 1)
    [IO.File]::WriteAllText($configPath, $config, [Text.UTF8Encoding]::new($false))

    $sourceTemplates = Join-Path $repoRoot "supabase\templates"
    $targetTemplates = Join-Path $supabaseDir "templates"
    New-Item -ItemType Directory -Path $targetTemplates -Force | Out-Null
    foreach ($templateName in @("confirmation.html", "recovery.html")) {
      $sourceTemplate = Join-Path $sourceTemplates $templateName
      if (!(Test-Path -LiteralPath $sourceTemplate -PathType Leaf)) {
        throw "Required local auth template is missing: $sourceTemplate"
      }
      Copy-Item -LiteralPath $sourceTemplate -Destination (Join-Path $targetTemplates $templateName)
    }
    Assert-GeneratedStackConfig $configPath

    $excluded = "edge-runtime,imgproxy,logflare,mailpit,postgres-meta,realtime,storage-api,studio,supavisor,vector"
    $startAttempted = $true
    Invoke-CheckedNative "starting disposable Supabase" {
      & supabase start --workdir $stackRoot --exclude $excluded
    } -Quiet
    $startSucceeded = $true

    Assert-DisposableDatabaseContainer

    Invoke-CheckedNative "repository database rebuild" {
      & $bash scripts/db-rebuild.sh --container $container --db postgres
    }

    $nonceBytes = [byte[]]::new(32)
    $nonceGenerator = [Security.Cryptography.RandomNumberGenerator]::Create()
    try {
      $nonceGenerator.GetBytes($nonceBytes)
    } finally {
      $nonceGenerator.Dispose()
    }
    $nonce = [BitConverter]::ToString($nonceBytes).Replace("-", "").ToLowerInvariant()
    $guardSql = [IO.File]::ReadAllText((Join-Path $repoRoot "scripts\rules-e2e-guard.sql"))
    Invoke-CheckedNative "installing disposable environment marker" {
      $guardSql | & docker exec -i $container psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q -v "rules_nonce=$nonce" -f -
    }

    $priorPreference = $ErrorActionPreference
    try {
      $ErrorActionPreference = "Continue"
      $statusJson = & supabase status --workdir $stackRoot -o json 2>$null
      $statusExitCode = $LASTEXITCODE
    } finally {
      $ErrorActionPreference = $priorPreference
    }
    if ($statusExitCode -ne 0) {
      throw "reading disposable Supabase status failed with exit code $statusExitCode"
    }
    $status = (($statusJson -join [Environment]::NewLine) | ConvertFrom-Json)
    $apiUrl = [string]$status.API_URL
    $anonKey = [string]$status.ANON_KEY
    $serviceKey = [string]$status.SERVICE_ROLE_KEY
    $apiUri = [Uri]$apiUrl
    if (
      $apiUri.Scheme -ne "http" -or
      $apiUri.Host -ne "127.0.0.1" -or
      $apiUri.Port -ne 55321 -or
      !$anonKey -or
      !$serviceKey
    ) {
      throw "Disposable Supabase returned an unexpected endpoint or incomplete local keys."
    }

    $env:NEXT_PUBLIC_SUPABASE_URL = $apiUrl
    $env:NEXT_PUBLIC_SUPABASE_ANON_KEY = $anonKey
    $env:SUPABASE_SERVICE_ROLE_KEY = $serviceKey
    $env:E2E_SUPABASE_URL = $apiUrl
    $env:E2E_SUPABASE_ANON_KEY = $anonKey
    $env:E2E_SUPABASE_SERVICE_ROLE_KEY = $serviceKey
    $env:E2E_RULES_STACK_NONCE = $nonce
    $env:E2E_RULES_DISPOSABLE_STACK = "1"
    $env:E2E_BASE_URL = "http://127.0.0.1:3103"

    # The disposable acceptance stack needs no third-party network credentials.
    # Blank inherited secrets so a browser/build regression cannot contact a
    # hosted mail, model, deployment or registrar API during this proof.
    $env:VERCEL_TOKEN = ""
    $env:RESEND_API_KEY = ""
    $env:ANTHROPIC_API_KEY = ""
    $env:OPENAI_API_KEY = ""
    $env:GROQ_API_KEY = ""
    $env:NAMECHEAP_API_KEY = ""
    $env:NAMECHEAP_API_USER = ""
    $env:NAMECHEAP_USERNAME = ""

    if ($SkipBuild) {
      $buildId = Join-Path $repoRoot ".next\BUILD_ID"
      if (!(Test-Path -LiteralPath $buildId -PathType Leaf)) {
        throw "-SkipBuild requires an existing successful production build at $buildId"
      }
      Write-Host "production build: reusing the already-verified .next artifact (-SkipBuild)"
    } else {
      Invoke-CheckedNative "production build" { & npm.cmd run build }
    }
    Invoke-CheckedNative "Stream R Playwright" {
      & npx.cmd playwright test --config=playwright.rules.config.ts
    }
    $runCompleted = $true
  } catch {
    $primaryFailure = $_
  } finally {
    $mustClean = $startAttempted -and (!$KeepStack -or !$runCompleted)
    if ($mustClean) {
      try {
        Stop-DisposableStack "stopping the disposable Supabase stack"
      } catch {
        $cleanupFailure = $_
      }
    }
  }
} finally {
  Pop-Location
}

if ($primaryFailure -and $cleanupFailure) {
  throw "Stream R browser run failed: $($primaryFailure.Exception.Message)`nCleanup also failed: $($cleanupFailure.Exception.Message)"
}
if ($primaryFailure) {
  throw $primaryFailure
}
if ($cleanupFailure) {
  throw $cleanupFailure
}
if ($startSucceeded -and $KeepStack) {
  Write-Host "Disposable Stream R stack retained at $stackRoot by -KeepStack."
}
