# Changelog

## 1.20.1

- Added a macOS fallback chain that now tries Apple's signed `lldb-dap` before dropping to a reduced run-only session when `gdb` is present but blocked by `taskgated`
- Improved the user-facing documentation so the README explains the macOS fallback behavior clearly, while development and packaging notes now live in `DEVELOP.md`
- Rebuilt the release package for version `1.20.1`

## 1.20.0

- Added a macOS debugger fallback chain for unsigned `gdb`: prefer Apple's signed `lldb-dap` when available, and otherwise still launch the compiled program in a reduced run-only session
- Added clearer macOS diagnostics so unsigned `gdb` / `taskgated` failures explain both the codesigning requirement and the active fallback behavior
- Changed the extension version to `1.20.0` to align with the companion `fb-vscode-language` package from the same publisher
- Adopted the shared versioning scheme where the major and minor version match the FreeBASIC compiler line the extensions are based on, and the final digit is the package revision number
- Improved macOS compiler discovery so the debugger can find `fbc` in common install locations such as `/opt/homebrew/bin`, `/usr/local/bin`, and `/opt/local/bin` even when VS Code is launched without a shell-populated `PATH`
- Simplified the macOS and Unix helper terminal launch command by using `/bin/sh -c` instead of `/bin/sh -lc`, avoiding unnecessary login-shell startup behavior during `runInTerminal`
- Added unit coverage for the macOS compiler lookup path and the Unix helper-terminal command shape so the macOS fixes stay protected
- Verified the plugin on Windows, Linux, and macOS
- Rebuilt the release package as part of this version update

## 0.1.2

- Fixed a debug-adapter launch handshake deadlock where `configurationDone` could never arrive because the adapter was waiting too long to answer `launch`
- Fixed adapter startup reliability by launching the debug adapter explicitly from the extension host with an absolute script path instead of relying on the generic manifest runtime handoff
- Added raw GDB smoke tests for console and windowed FreeBASIC programs so toolchain behavior can be validated outside VS Code
- Added dedicated console and `gfxlib` smoke programs used to prove debugger launch behavior directly against `fbc` and GDB
- Verified on Windows that console apps run under raw GDB, and that `gfxlib` windowed apps require GDB `new-console` handling to start reliably
- Added a real VS Code extension-host smoke harness for both console and windowed FreeBASIC programs, with host-side and adapter-side trace logging for launch failures
- Verified on Windows that both smoke scenarios now start through the extension itself, not just under raw GDB

## 0.1.1

- Fixed debugger launch sequencing so the target starts after breakpoint configuration instead of stalling in a half-started GDB session
- Added platform-aware console handling with a new `freebasic.debugger.console` setting and matching `launch.json` option
- On Windows, console programs now request a separate console window through GDB so text-mode programs can actually appear and accept input
- On Linux and macOS, debug sessions now request a real VS Code terminal and bind the inferior TTY so console and `gfxlib` programs can present normally
- Improved helper-terminal cleanup so temporary terminal marker files are removed when the debug session exits
- Expanded unit coverage around console defaults, launch sequencing, Windows console handling, and Unix `runInTerminal` / TTY setup
- Removed generated packaging and test-output artifacts from the repository and updated ignore rules so they stay out

## 0.1.0

- First usable release of the FreeBASIC native debugger for VS Code
- `F5` can build the current FreeBASIC file with debug information and start it under GDB
- Compiler lookup works across Windows, Linux, and macOS, with extra Windows fallback paths for common FreeBASIC installs
- GDB lookup checks bundled tools first, then common install locations, then plain `gdb` on `PATH`
- FreeBASIC compile errors are parsed into the Problems panel instead of being left as raw debugger output
- Added debugger settings for compiler path, GDB path, architecture preference, compiler arguments, program arguments, and stop-at-entry
- Launch validation now treats `.bas` files as debug entry points and leaves `.bi` include files as source-level debug targets only
- Build and launch resolution now runs after VS Code variable substitution, so `${file}` and similar launch variables behave correctly
- Added unit harness coverage for config generation, tool discovery, compile handling, DAP framing, MI parsing, and GDB startup flow
