# Changelog

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
