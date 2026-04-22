<#
    Project: FreeBASIC Native Debugger
    ----------------------------------

    File: tests/adapter_smoke_test.ps1

    Purpose:

        Drive the debug adapter directly through the Debug Adapter
        Protocol so startup problems can be validated without relying
        on the full VS Code workbench test harness.

    Responsibilities:

        - launch the adapter under the VS Code bundled Node runtime
        - send initialize / launch / configurationDone requests
        - wait for launch, stop, and disconnect milestones
        - fail loudly when the adapter does not complete the handshake

    This file intentionally does NOT contain:

        - extension host activation logic
        - packaging commands
        - debugger implementation
#>

param(
    [string]$WorkspaceRoot = "C:\Nextcloud\FBXL 5\vscode",
    [string]$CodeExe = "C:\Users\admin\AppData\Local\Programs\Microsoft VS Code\Code.exe",
    [string]$CompilerPath = "C:\freebasic\fbc64.exe",
    [string]$GdbPath = "C:\msys64\mingw64\bin\gdb.exe"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-DapMessage {
    param(
        [System.IO.StreamWriter]$Writer,
        [hashtable]$Message
    )

    $json = $Message | ConvertTo-Json -Depth 20 -Compress
    $payload = [System.Text.Encoding]::UTF8.GetBytes($json)
    $header = [System.Text.Encoding]::ASCII.GetBytes("Content-Length: $($payload.Length)`r`n`r`n")

    $Writer.BaseStream.Write($header, 0, $header.Length)
    $Writer.BaseStream.Write($payload, 0, $payload.Length)
    $Writer.BaseStream.Flush()
}

function Read-DapMessage {
    param(
        [System.IO.StreamReader]$Reader,
        [int]$TimeoutMilliseconds
    )

    $start = [DateTime]::UtcNow
    $headerText = ""

    while ($true) {
        if ((([DateTime]::UtcNow - $start).TotalMilliseconds) -gt $TimeoutMilliseconds) {
            throw "Timed out waiting for DAP header."
        }

        while (-not $Reader.EndOfStream) {
            $characterCode = $Reader.Read()

            if ($characterCode -lt 0) {
                Start-Sleep -Milliseconds 50
                break
            }

            $headerText += [char]$characterCode

            if ($headerText.EndsWith("`r`n`r`n")) {
                $contentLengthMatch = [regex]::Match($headerText, "Content-Length:\s*(\d+)", "IgnoreCase")

                if (-not $contentLengthMatch.Success) {
                    throw "DAP header did not contain Content-Length."
                }

                $contentLength = [int]$contentLengthMatch.Groups[1].Value
                $buffer = New-Object char[] $contentLength
                $readCount = 0

                while ($readCount -lt $contentLength) {
                    $chunkRead = $Reader.Read($buffer, $readCount, $contentLength - $readCount)

                    if ($chunkRead -le 0) {
                        if ((([DateTime]::UtcNow - $start).TotalMilliseconds) -gt $TimeoutMilliseconds) {
                            throw "Timed out waiting for DAP payload."
                        }

                        Start-Sleep -Milliseconds 50
                        continue
                    }

                    $readCount += $chunkRead
                }

                $payloadText = -join $buffer
                return $payloadText | ConvertFrom-Json
            }
        }

        Start-Sleep -Milliseconds 50
    }
}

function Wait-ForDapMessage {
    param(
        [System.IO.StreamReader]$Reader,
        [scriptblock]$Predicate,
        [int]$TimeoutMilliseconds
    )

    $start = [DateTime]::UtcNow

    while ($true) {
        if ((([DateTime]::UtcNow - $start).TotalMilliseconds) -gt $TimeoutMilliseconds) {
            throw "Timed out waiting for expected DAP message."
        }

        $message = Read-DapMessage -Reader $Reader -TimeoutMilliseconds $TimeoutMilliseconds

        if (& $Predicate $message) {
            return $message
        }
    }
}

$sourceFile = Join-Path $WorkspaceRoot "test-workspace\smoke.bas"
$programFile = Join-Path $WorkspaceRoot "test-workspace\smoke-direct.exe"
$traceFile = Join-Path $WorkspaceRoot "test-workspace\adapter-direct-trace.log"
$adapterPath = Join-Path $WorkspaceRoot "adapter\freebasicGdbDebug.js"
$gdbDirectory = Split-Path -Path $GdbPath -Parent
$compilerDirectory = Split-Path -Path $CompilerPath -Parent
$pathValue = "$gdbDirectory;$compilerDirectory;$env:PATH"

if (Test-Path $traceFile) {
    Remove-Item -LiteralPath $traceFile -Force
}

$startInfo = New-Object System.Diagnostics.ProcessStartInfo
$startInfo.FileName = $CodeExe
$startInfo.Arguments = "`"$adapterPath`""
$startInfo.WorkingDirectory = $WorkspaceRoot
$startInfo.UseShellExecute = $false
$startInfo.RedirectStandardInput = $true
$startInfo.RedirectStandardOutput = $true
$startInfo.RedirectStandardError = $true
$startInfo.Environment["ELECTRON_RUN_AS_NODE"] = "1"

$process = New-Object System.Diagnostics.Process
$process.StartInfo = $startInfo

if (-not $process.Start()) {
    throw "Failed to start the debug adapter process."
}

$writer = $process.StandardInput
$reader = $process.StandardOutput
$stderrReader = $process.StandardError

Write-DapMessage -Writer $writer -Message @{
    seq = 1
    type = "request"
    command = "initialize"
    arguments = @{
        clientID = "powershell-smoke"
        adapterID = "freebasic-gdb"
        pathFormat = "path"
        linesStartAt1 = $true
        columnsStartAt1 = $true
    }
}

$initializeResponse = Wait-ForDapMessage -Reader $reader -TimeoutMilliseconds 10000 -Predicate {
    param($message)
    return $message.type -eq "response" -and $message.command -eq "initialize"
}

if (-not $initializeResponse.success) {
    throw "Initialize request failed."
}

Write-DapMessage -Writer $writer -Message @{
    seq = 2
    type = "request"
    command = "launch"
    arguments = @{
        name = "Direct Adapter Smoke Test"
        type = "freebasic-gdb"
        request = "launch"
        sourceFile = $sourceFile
        cwd = (Join-Path $WorkspaceRoot "test-workspace")
        program = $programFile
        compilerPath = $CompilerPath
        gdbPath = $GdbPath
        stopAtEntry = $true
        env = @{
            PATH = $pathValue
            FREEBASIC_DEBUG_LOG = $traceFile
        }
    }
}

$launchResponse = $null
$initializedEvent = $null
$launchStart = [DateTime]::UtcNow

while (-not $launchResponse -or -not $initializedEvent) {
    if ((([DateTime]::UtcNow - $launchStart).TotalMilliseconds) -gt 30000) {
        throw "Timed out waiting for launch handshake."
    }

    $message = Read-DapMessage -Reader $reader -TimeoutMilliseconds 30000

    if ($message.type -eq "response" -and $message.command -eq "launch") {
        $launchResponse = $message
        continue
    }

    if ($message.type -eq "event" -and $message.event -eq "initialized") {
        $initializedEvent = $message
        continue
    }
}

if (-not $launchResponse.success) {
    throw "Launch request failed."
}

Write-DapMessage -Writer $writer -Message @{
    seq = 3
    type = "request"
    command = "configurationDone"
    arguments = @{}
}

$configurationDoneResponse = Wait-ForDapMessage -Reader $reader -TimeoutMilliseconds 30000 -Predicate {
    param($message)
    return $message.type -eq "response" -and $message.command -eq "configurationDone"
}

if (-not $configurationDoneResponse.success) {
    throw "configurationDone request failed."
}

$stoppedEvent = Wait-ForDapMessage -Reader $reader -TimeoutMilliseconds 60000 -Predicate {
    param($message)
    return $message.type -eq "event" -and $message.event -eq "stopped"
}

Write-DapMessage -Writer $writer -Message @{
    seq = 4
    type = "request"
    command = "threads"
    arguments = @{}
}

$threadsResponse = Wait-ForDapMessage -Reader $reader -TimeoutMilliseconds 10000 -Predicate {
    param($message)
    return $message.type -eq "response" -and $message.command -eq "threads"
}

if (-not $threadsResponse.success) {
    throw "threads request failed."
}

Write-DapMessage -Writer $writer -Message @{
    seq = 5
    type = "request"
    command = "disconnect"
    arguments = @{}
}

$disconnectResponse = Wait-ForDapMessage -Reader $reader -TimeoutMilliseconds 10000 -Predicate {
    param($message)
    return $message.type -eq "response" -and $message.command -eq "disconnect"
}

if (-not $disconnectResponse.success) {
    throw "disconnect request failed."
}

$process.WaitForExit(10000) | Out-Null

if (-not (Test-Path $programFile)) {
    throw "The adapter smoke test did not produce the expected executable."
}

if ($process.ExitCode -ne 0) {
    throw "The adapter process exited with code $($process.ExitCode)."
}

[pscustomobject]@{
    InitializeEvent = $initializedEvent.event
    StopReason = $stoppedEvent.body.reason
    Threads = @($threadsResponse.body.threads).Count
    ProgramFile = $programFile
    TraceFile = $traceFile
}

# end of tests/adapter_smoke_test.ps1
