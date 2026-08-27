#!/usr/bin/env bash
#
# Project: FreeBASIC Native Debugger
# ----------------------------------
#
# File: tests/runExtensionSmoke.sh
#
# Purpose:
#
#     Launch VS Code in extension test mode on Linux and run the real smoke
#     harness against the local extension checkout.
#
# Responsibilities:
#
#     - create isolated user-data, extension, and workspace directories
#     - run the extension-host smoke harness with Workspace Trust disabled
#     - enforce a bounded test duration
#     - print the relevant log tails when the test fails
#
# This file intentionally does NOT contain:
#
#     - debugger implementation logic
#     - repository packaging work
#     - unit test coverage
#

set -euo pipefail

# ---------------------------------------------------------------------------
# Defaults and command-line handling
# ---------------------------------------------------------------------------

script_directory="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
extension_root="$(cd -- "$script_directory/.." && pwd -P)"
code_path="code"
timeout_seconds=180
keep_artifacts_on_failure=0
succeeded=0

show_usage() {
    echo "Usage: $0 [--extension-root PATH] [--code PATH] [--timeout SECONDS] [--keep-artifacts-on-failure]"
}

die() {
    echo "ERROR: $*" >&2
    exit 1
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        --extension-root)
            [ "$#" -ge 2 ] || die "--extension-root requires a path"
            extension_root="$2"
            shift 2
            ;;
        --code)
            [ "$#" -ge 2 ] || die "--code requires a path"
            code_path="$2"
            shift 2
            ;;
        --timeout)
            [ "$#" -ge 2 ] || die "--timeout requires a number of seconds"
            timeout_seconds="$2"
            shift 2
            ;;
        --keep-artifacts-on-failure)
            keep_artifacts_on_failure=1
            shift
            ;;
        --help|-h)
            show_usage
            exit 0
            ;;
        *)
            die "unknown argument '$1'"
            ;;
    esac
done

case "$timeout_seconds" in
    ''|*[!0-9]*) die "--timeout must be a positive integer" ;;
esac

[ "$timeout_seconds" -gt 0 ] || die "--timeout must be greater than zero"
[ -d "$extension_root" ] || die "extension root not found: $extension_root"
extension_root="$(cd -- "$extension_root" && pwd -P)"

if [ -f "$code_path" ] && [ -x "$code_path" ]; then
    code_path="$(cd -- "$(dirname -- "$code_path")" && pwd -P)/$(basename -- "$code_path")"
else
    resolved_code_path="$(command -v -- "$code_path" 2>/dev/null || true)"
    [ -n "$resolved_code_path" ] || die "VS Code executable not found: $code_path"
    code_path="$resolved_code_path"
fi

# ---------------------------------------------------------------------------
# Artifact paths and cleanup
# ---------------------------------------------------------------------------

workspace_root="$extension_root/test-workspace"
test_script_path="$extension_root/tests/runSmokeTest.js"
summary_path="$workspace_root/extension-smoke-summary.txt"
console_log_path="$workspace_root/extension-smoke-console.log"
window_log_path="$workspace_root/extension-smoke-window.log"
base_temp_path="$extension_root/.smoke-vscode"
user_data_path="$base_temp_path/user-data"
extensions_path="$base_temp_path/extensions"
user_settings_path="$user_data_path/User/settings.json"
stdout_path="$base_temp_path/code-stdout.txt"
stderr_path="$base_temp_path/code-stderr.txt"

[ -f "$test_script_path" ] || die "smoke test entry point not found: $test_script_path"
[ -f "$extension_root/tests/fixtures/gdb-console-smoke.bas" ] || die "console smoke source is missing"
[ -f "$extension_root/tests/fixtures/gdb-window-smoke.bas" ] || die "window smoke source is missing"

remove_temp_artifacts() {
    [ -n "$base_temp_path" ] || return
    [ "$base_temp_path" != "/" ] || return
    rm -rf -- "$base_temp_path"
}

finish() {
    result=$?
    trap - EXIT

    if [ "$succeeded" -eq 1 ] || [ "$keep_artifacts_on_failure" -eq 0 ]; then
        remove_temp_artifacts
    else
        echo "Smoke test artifacts preserved at: $base_temp_path" >&2
    fi

    exit "$result"
}

trap finish EXIT

remove_temp_artifacts
mkdir -p -- "$workspace_root" "$user_data_path/User" "$extensions_path"

#
# Integrated terminals inherit identifiers for the already-running VS Code
# process. A fresh extension-test host must not attach to that instance, and
# ELECTRON_RUN_AS_NODE must only be set internally by the code CLI wrapper.
#
while IFS='=' read -r environment_name _environment_value; do
    case "$environment_name" in
        VSCODE_*|ELECTRON_RUN_AS_NODE)
            unset "$environment_name"
            ;;
    esac
done < <(env)

printf '%s\n' \
    '{' \
    '    "security.workspace.trust.enabled": false' \
    '}' > "$user_settings_path"

rm -f -- \
    "$summary_path" \
    "$console_log_path" \
    "$window_log_path"

# ---------------------------------------------------------------------------
# Extension-host execution and result reporting
# ---------------------------------------------------------------------------

set +e
timeout --foreground --signal=TERM --kill-after=10s "${timeout_seconds}s" \
    "$code_path" \
    --verbose \
    --skip-release-notes \
    --user-data-dir "$user_data_path" \
    --extensions-dir "$extensions_path" \
    --extensionDevelopmentPath="$extension_root" \
    --extensionTestsPath="$test_script_path" \
    "$workspace_root" \
    > "$stdout_path" \
    2> "$stderr_path"
code_status=$?
set -e

summary_succeeded=0

if [ -f "$summary_path" ] && \
    grep -Fqx 'scenario-completed=console:started' "$summary_path" && \
    grep -Eq '^scenario-completed=window:.*started' "$summary_path"; then
    summary_succeeded=1
fi

if [ "$code_status" -eq 124 ]; then
    echo "VS Code extension smoke test timed out after ${timeout_seconds} seconds." >&2
elif [ "$code_status" -ne 0 ] && [ "$summary_succeeded" -ne 1 ]; then
    echo "VS Code extension smoke test failed with exit code $code_status." >&2
fi

if [ "$summary_succeeded" -ne 1 ]; then
    for report_path in \
        "$summary_path" \
        "$console_log_path" \
        "$window_log_path" \
        "$stdout_path" \
        "$stderr_path"
    do
        if [ -s "$report_path" ]; then
            echo >&2
            echo "Last 80 lines of $report_path:" >&2
            tail -n 80 -- "$report_path" >&2
        fi
    done

    die "the smoke summary does not show both scenarios succeeding"
fi

succeeded=1
cat -- "$summary_path"

# end of tests/runExtensionSmoke.sh
