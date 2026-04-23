<#
    Project: FreeBASIC Native Debugger
    ----------------------------------

    File: tests/runExtensionSmoke.ps1

    Purpose:

        Launch VS Code in extension test mode and run the real smoke
        harness against the local extension checkout.

    Responsibilities:

        - create isolated user data and extensions directories
        - run the extension-host smoke harness with Workspace Trust disabled
        - wait for VS Code to exit
        - print the summary and recent log tails when the test fails

    This file intentionally does NOT contain:

        - debugger implementation logic
        - repository packaging work
        - unit test coverage
#>

[CmdletBinding()]
param(
    [string]$ExtensionRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path,
    [string]$CodePath = "code.cmd",
    [int]$TimeoutSeconds = 180,
    [switch]$KeepArtifactsOnFailure
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Remove-PathIfPresent {
    param(
        [Parameter(Mandatory = $true)]
        [string]$LiteralPath
    )

    if (-not (Test-Path -LiteralPath $LiteralPath))
        { return }

    Remove-Item -LiteralPath $LiteralPath -Recurse -Force
}

function Get-TextTail {
    param(
        [Parameter(Mandatory = $true)]
        [string]$LiteralPath,
        [int]$LineCount = 40
    )

    if (-not (Test-Path -LiteralPath $LiteralPath))
        { return "" }

    return (Get-Content -LiteralPath $LiteralPath -Tail $LineCount) -join [Environment]::NewLine
}

function Test-SmokeSummarySucceeded {
    param(
        [Parameter(Mandatory = $true)]
        [string]$LiteralPath
    )

    if (-not (Test-Path -LiteralPath $LiteralPath))
        { return $false }

    $Lines = Get-Content -LiteralPath $LiteralPath

    return (
        ($Lines -contains "scenario-completed=console:started") -and
        @($Lines | Where-Object { $_ -like "scenario-completed=window:*started*" }).Count -gt 0
    )
}

function Resolve-CodePath {
    param(
        [Parameter(Mandatory = $true)]
        [string]$RequestedPath
    )

    if ($RequestedPath -and (Test-Path -LiteralPath $RequestedPath)) {
        return (Resolve-Path -LiteralPath $RequestedPath).Path
    }

    foreach ($CandidateName in @("code.cmd", "code", "Code.exe")) {
        $Command = Get-Command $CandidateName -ErrorAction SilentlyContinue

        if ($Command -and $Command.Source -and (Test-Path -LiteralPath $Command.Source)) {
            return (Resolve-Path -LiteralPath $Command.Source).Path
        }
    }

    throw "VS Code executable not found. Checked the explicit path and PATH-based Code.exe/code.cmd commands."
}

function Quote-CommandArgument {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Argument
    )

    if ($Argument -notmatch '[\s"]')
        { return $Argument }

    return '"' + ($Argument -replace '"', '\"') + '"'
}

$ExtensionRoot = (Resolve-Path -LiteralPath $ExtensionRoot).Path
$CodePath = Resolve-CodePath -RequestedPath $CodePath
$WorkspaceRoot = Join-Path $ExtensionRoot "test-workspace"
$TestScriptPath = Join-Path $ExtensionRoot "tests\runSmokeTest.js"
$SummaryPath = Join-Path $WorkspaceRoot "extension-smoke-summary.txt"
$ConsoleLogPath = Join-Path $WorkspaceRoot "extension-smoke-console.log"
$WindowLogPath = Join-Path $WorkspaceRoot "extension-smoke-window.log"
$ConsoleTracePath = Join-Path $WorkspaceRoot "extension-smoke-console-trace.log"
$WindowTracePath = Join-Path $WorkspaceRoot "extension-smoke-window-trace.log"
$ConsoleSessionPath = Join-Path $WorkspaceRoot "extension-smoke-console-session.log"
$WindowSessionPath = Join-Path $WorkspaceRoot "extension-smoke-window-session.log"
$BaseTempPath = Join-Path $ExtensionRoot ".smoke-vscode"
$UserDataPath = Join-Path $BaseTempPath "user-data"
$ExtensionsPath = Join-Path $BaseTempPath "extensions"
$UserSettingsPath = Join-Path $UserDataPath "User\settings.json"
$StdoutPath = Join-Path $BaseTempPath "code-stdout.txt"
$StderrPath = Join-Path $BaseTempPath "code-stderr.txt"
$StartTime = Get-Date
$Succeeded = $false

if (-not (Test-Path -LiteralPath $WorkspaceRoot)) {
    throw "Smoke workspace not found: $WorkspaceRoot"
}

if (-not (Test-Path -LiteralPath $TestScriptPath)) {
    throw "Smoke test entry point not found: $TestScriptPath"
}

Remove-PathIfPresent -LiteralPath $BaseTempPath
New-Item -ItemType Directory -Path $UserDataPath -Force | Out-Null
New-Item -ItemType Directory -Path $ExtensionsPath -Force | Out-Null
New-Item -ItemType Directory -Path (Split-Path -Parent $UserSettingsPath) -Force | Out-Null
[System.IO.File]::WriteAllText($UserSettingsPath, @'
{
    "security.workspace.trust.enabled": false
}
'@, (New-Object System.Text.UTF8Encoding($false)))

foreach ($ArtifactPath in @(
    $SummaryPath,
    $ConsoleLogPath,
    $WindowLogPath,
    $ConsoleTracePath,
    $WindowTracePath,
    $ConsoleSessionPath,
    $WindowSessionPath,
    $StdoutPath,
    $StderrPath
)) {
    if (Test-Path -LiteralPath $ArtifactPath) {
        Remove-Item -LiteralPath $ArtifactPath -Force
    }
}

$ArgumentList = @(
    "--verbose",
    "--skip-release-notes",
    "--user-data-dir", $UserDataPath,
    "--extensions-dir", $ExtensionsPath,
    "--extensionDevelopmentPath=$ExtensionRoot",
    "--extensionTestsPath=$TestScriptPath",
    $WorkspaceRoot
)

$CommandItems = @($CodePath)
$CommandItems += $ArgumentList
$CommandLine = (
    $CommandItems |
    ForEach-Object { Quote-CommandArgument -Argument ([string]$_) }
) -join " "

$Process = Start-Process `
    -FilePath $env:ComSpec `
    -ArgumentList @("/d", "/c", "`"$CommandLine`"") `
    -PassThru `
    -RedirectStandardOutput $StdoutPath `
    -RedirectStandardError $StderrPath

try {
    $Deadline = $StartTime.AddSeconds($TimeoutSeconds)

    while (-not $Process.HasExited) {
        if ((Get-Date) -ge $Deadline) {
            try {
                Stop-Process -Id $Process.Id -Force
            } catch {
            }

            throw "Timed out waiting for the VS Code smoke test process to exit."
        }

        Start-Sleep -Milliseconds 500
    }

    $SmokeSummarySucceeded = Test-SmokeSummarySucceeded -LiteralPath $SummaryPath

    if ((($null -ne $Process.ExitCode) -and ($Process.ExitCode -ne 0)) -and (-not $SmokeSummarySucceeded)) {
        $SummaryText = Get-TextTail -LiteralPath $SummaryPath -LineCount 80
        $ConsoleTail = Get-TextTail -LiteralPath $ConsoleLogPath -LineCount 80
        $WindowTail = Get-TextTail -LiteralPath $WindowLogPath -LineCount 80
        $StdoutTail = Get-TextTail -LiteralPath $StdoutPath -LineCount 80
        $StderrTail = Get-TextTail -LiteralPath $StderrPath -LineCount 80
        $MessageParts = @(
            "VS Code extension smoke test failed with exit code $($Process.ExitCode)."
        )

        if ($SummaryText) {
            $MessageParts += "Summary:`n$SummaryText"
        }

        if ($ConsoleTail) {
            $MessageParts += "Console log tail:`n$ConsoleTail"
        }

        if ($WindowTail) {
            $MessageParts += "Window log tail:`n$WindowTail"
        }

        if ($StdoutTail) {
            $MessageParts += "VS Code stdout tail:`n$StdoutTail"
        }

        if ($StderrTail) {
            $MessageParts += "VS Code stderr tail:`n$StderrTail"
        }

        throw ($MessageParts -join [Environment]::NewLine + [Environment]::NewLine)
    }

    if (-not (Test-Path -LiteralPath $SummaryPath)) {
        throw "The smoke summary file was not created: $SummaryPath"
    }

    if (-not $SmokeSummarySucceeded) {
        throw "The smoke summary file was created, but it does not show both smoke scenarios succeeding."
    }

    $Succeeded = $true
    Get-Content -LiteralPath $SummaryPath
} finally {
    if ($Succeeded -or (-not $KeepArtifactsOnFailure)) {
        Remove-PathIfPresent -LiteralPath $BaseTempPath
    } else {
        Write-Host "Smoke test artifacts preserved at: $BaseTempPath"
    }
}

# end of tests/runExtensionSmoke.ps1
