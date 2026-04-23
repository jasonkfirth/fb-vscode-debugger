<#
    Project: FreeBASIC Native Debugger
    ----------------------------------

    File: tests/gdb_launch_smoke_test.ps1

    Purpose:

        Validate the raw FreeBASIC + GDB toolchain without VS Code in the
        middle so debugger launch failures can be separated from editor-side
        handshake issues.

    Responsibilities:

        - compile a console smoke program with debug symbols
        - compile a gfxlib smoke program with debug symbols
        - launch each program through GDB/MI
        - confirm that each program writes its startup marker file

    This file intentionally does NOT contain:

        - VS Code extension host activation
        - VSIX packaging commands
        - Debug Adapter Protocol logic
#>

param(
    [string]$WorkspaceRoot = "C:\Nextcloud\FBXL 5\vscode",
    [string]$CompilerPath = "C:\freebasic\fbc64.exe",
    [string]$GdbPath = "C:\msys64\mingw64\bin\gdb.exe"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Wait-ForGdbPrompt {
    param(
        [System.IO.StreamReader]$Reader,
        [int]$TimeoutMilliseconds
    )

    $startedAt = [DateTime]::UtcNow
    $buffer = New-Object System.Text.StringBuilder

    while ($true) {
        if ((([DateTime]::UtcNow - $startedAt).TotalMilliseconds) -gt $TimeoutMilliseconds) {
            throw "Timed out waiting for the GDB prompt."
        }

        while (-not $Reader.EndOfStream) {
            $characterCode = $Reader.Read()

            if ($characterCode -lt 0) {
                Start-Sleep -Milliseconds 50
                break
            }

            [void]$buffer.Append([char]$characterCode)

            if ($buffer.ToString().Contains("(gdb)")) {
                return $buffer.ToString()
            }
        }

        Start-Sleep -Milliseconds 50
    }
}

function Send-GdbCommand {
    param(
        [System.IO.StreamWriter]$Writer,
        [string]$Command
    )

    $Writer.WriteLine($Command)
    $Writer.Flush()
}

function Wait-ForMarkerFile {
    param(
        [string]$MarkerPath,
        [int]$TimeoutMilliseconds
    )

    $startedAt = [DateTime]::UtcNow

    while ($true) {
        if (Test-Path -LiteralPath $MarkerPath) {
            $content = @(Get-Content -LiteralPath $MarkerPath -ErrorAction Stop)

            if ($content.Count -gt 0) {
                return $content
            }
        }

        if ((([DateTime]::UtcNow - $startedAt).TotalMilliseconds) -gt $TimeoutMilliseconds) {
            throw "Timed out waiting for marker file '$MarkerPath'."
        }

        Start-Sleep -Milliseconds 100
    }
}

function Invoke-FreeBasicCompile {
    param(
        [string]$SourcePath,
        [string]$ProgramPath,
        [string[]]$ExtraArguments
    )

    $arguments = @("-g")

    if ($ExtraArguments) {
        $arguments += $ExtraArguments
    }

    $arguments += @($SourcePath, "-x", $ProgramPath)

    & $CompilerPath @arguments

    if ($LASTEXITCODE -ne 0) {
        throw "FreeBASIC compilation failed for '$SourcePath'."
    }

    if (-not (Test-Path -LiteralPath $ProgramPath)) {
        throw "Expected compiled program was not created: $ProgramPath"
    }
}

function Invoke-GdbLaunchTest {
    param(
        [string]$Name,
        [string]$ProgramPath,
        [string]$MarkerPath,
        [switch]$UseNewConsole
    )

    if (Test-Path -LiteralPath $MarkerPath) {
        Remove-Item -LiteralPath $MarkerPath -Force
    }

    $gdbDirectory = Split-Path -Path $GdbPath -Parent
    $compilerDirectory = Split-Path -Path $CompilerPath -Parent
    $startInfo = New-Object System.Diagnostics.ProcessStartInfo
    $startInfo.FileName = $GdbPath
    $startInfo.Arguments = "--interpreter=mi2 `"$ProgramPath`""
    $startInfo.WorkingDirectory = $WorkspaceRoot
    $startInfo.UseShellExecute = $false
    $startInfo.RedirectStandardInput = $true
    $startInfo.RedirectStandardOutput = $true
    $startInfo.RedirectStandardError = $true
    $startInfo.Environment["PATH"] = "$gdbDirectory;$compilerDirectory;$env:PATH"
    $startInfo.Environment["FB_GDB_SMOKE_MARKER"] = $MarkerPath

    $process = New-Object System.Diagnostics.Process
    $process.StartInfo = $startInfo

    if (-not $process.Start()) {
        throw "Failed to start GDB for $Name."
    }

    try {
        Wait-ForGdbPrompt -Reader $process.StandardOutput -TimeoutMilliseconds 10000 | Out-Null

        Send-GdbCommand -Writer $process.StandardInput -Command "1-gdb-set breakpoint pending on"
        Wait-ForGdbPrompt -Reader $process.StandardOutput -TimeoutMilliseconds 10000 | Out-Null

        if ($UseNewConsole.IsPresent) {
            Send-GdbCommand -Writer $process.StandardInput -Command "2-gdb-set new-console on"
            Wait-ForGdbPrompt -Reader $process.StandardOutput -TimeoutMilliseconds 10000 | Out-Null
            Send-GdbCommand -Writer $process.StandardInput -Command "3-exec-run"
        } else {
            Send-GdbCommand -Writer $process.StandardInput -Command "2-exec-run"
        }

        $markerContent = Wait-ForMarkerFile -MarkerPath $MarkerPath -TimeoutMilliseconds 15000

        [pscustomobject]@{
            Name = $Name
            MarkerPath = $MarkerPath
            MarkerContent = ($markerContent -join ", ")
        }
    } finally {
        if (-not $process.HasExited) {
            try {
                Send-GdbCommand -Writer $process.StandardInput -Command "9-gdb-exit"
            } catch {
            }

            $process.WaitForExit(5000) | Out-Null

            if (-not $process.HasExited) {
                $process.Kill()
            }
        }

        $process.Dispose()
    }
}

$consoleSource = Join-Path $WorkspaceRoot "test-workspace\gdb-console-smoke.bas"
$consoleProgram = Join-Path $WorkspaceRoot "test-workspace\gdb-console-smoke.exe"
$windowSource = Join-Path $WorkspaceRoot "test-workspace\gdb-window-smoke.bas"
$windowProgram = Join-Path $WorkspaceRoot "test-workspace\gdb-window-smoke.exe"
$markerToken = "{0}-{1}" -f [System.Diagnostics.Process]::GetCurrentProcess().Id, [DateTime]::UtcNow.Ticks
$consoleMarker = Join-Path $WorkspaceRoot ("test-workspace\gdb-console-marker-{0}.txt" -f $markerToken)
$windowMarker = Join-Path $WorkspaceRoot ("test-workspace\gdb-window-marker-{0}.txt" -f $markerToken)

Invoke-FreeBasicCompile -SourcePath $consoleSource -ProgramPath $consoleProgram -ExtraArguments @()
Invoke-FreeBasicCompile -SourcePath $windowSource -ProgramPath $windowProgram -ExtraArguments @("-s", "gui")

$results = @()
$results += Invoke-GdbLaunchTest -Name "console" -ProgramPath $consoleProgram -MarkerPath $consoleMarker -UseNewConsole
$results += Invoke-GdbLaunchTest -Name "window" -ProgramPath $windowProgram -MarkerPath $windowMarker

$results

# end of tests/gdb_launch_smoke_test.ps1
