# FreeBASIC Native Debugger

This is a native VS Code debugger for FreeBASIC.

Press `F5` on a `.bas` file, the extension builds it with `fbc -g`,
then starts the program under the available native debugger for your platform.
The goal is simple: make FreeBASIC feel like a normal Run and Debug language in
VS Code instead of a language that needs manual task wiring every time.

## What it does

- Registers a `freebasic-gdb` debugger type.
- Builds the active `.bas` file with `fbc` by default.
- Lets you override the compiler path when a platform-specific launcher such as
  `fbc.exe`, `fbc64`, `fbc32`, `fbc64.exe`, or `fbc32.exe` is preferred.
- Launches the resulting program with GDB by default, with a run-only fallback
  when GDB is missing or unusable.
- Exposes breakpoints, continue, pause, stepping, stack frames, locals, and
  expression evaluation through the Debug Adapter Protocol.
- Parses FreeBASIC compile errors into the Problems panel before debugger
  launch.
- Writes compiler and debugger status details to the `FreeBASIC Debugger`
  output channel.

## Platform support

- Windows, Linux, and macOS all use GDB for full debugger features.
- If GDB is missing, or if macOS blocks an unsigned GDB through `taskgated`,
  the extension still launches the program in a reduced run-only session
  without debugger features.
- The extension assumes `fbc` and `gdb` are available on `PATH`.
- On Windows, compiler discovery prefers `fbc.exe` first, then falls back to
  `fbc64.exe` / `fbc32.exe` when needed.
- On Windows, the generated output name ends in `.exe`.
- On Windows, console programs default to an external console window because
  that is the most reliable way to let a GDB-launched console program interact
  normally.
- On Linux and macOS, the generated output name has no `.exe` suffix.
- On Linux and macOS, console programs default to the integrated terminal so
  the debuggee gets a real TTY.
- If your setup uses a non-default compiler or debugger location, set
  `compilerPath` and `gdbPath` in `launch.json`.

## Fallback behavior

When you press `F5`, the extension uses this order:

1. A usable `gdb`
2. A run-only session if GDB is missing
3. On macOS, a run-only session if `gdb` exists but the OS blocks it because it is unsigned

The fallback still compiles and launches your program, but debugging features
such as breakpoints, stepping, pause, stack inspection, and watches will be
unavailable for that session.

## GDB discovery

The debugger looks for GDB in this order:

1. A bundled debugger inside `tools/gdb`
2. Common platform-specific install paths
3. Plain `gdb` on `PATH`

On Windows, the built-in search includes common locations such as:

- `C:\freebasic\gdb.exe`
- `C:\freebasic\bin\gdb.exe`
- `C:\msys64\mingw64\bin\gdb.exe`
- `C:\msys64\ucrt64\bin\gdb.exe`
- `C:\mingw64\bin\gdb.exe`
- `C:\w64devkit\bin\gdb.exe`

In the common Windows setups, that means you usually do not have to set
`gdbPath` by hand even if GDB did not ship with FreeBASIC itself.

If we later bundle GDB with the extension, placing it in `tools/gdb` is enough
for the resolver to prefer it automatically.

## Using F5

1. Open a folder containing a FreeBASIC source file in VS Code.
2. Press `F5` while a `.bas` file is active.
3. Choose `FreeBASIC GDB` if VS Code asks which debugger to use.

If you want a persistent configuration, create `.vscode/launch.json` with:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Debug Current FreeBASIC File",
      "type": "freebasic-gdb",
      "request": "launch",
      "sourceFile": "${file}",
      "cwd": "${fileDirname}",
      "arch": "auto",
      "compilerPath": "fbc",
      "gdbPath": "gdb",
      "compilerArgs": [],
      "args": [],
      "stopAtEntry": false
    }
  ]
}
```

If `program` is omitted, the extension derives it from the source file name and
uses the correct platform suffix automatically.

`.bi` include files are still valid places to set breakpoints when they are used
by the running program, but they are not sensible launch targets on their own.

## What this is not

- It is not a language server.
- It is not a project system.
- It is not trying to replace the mature C/C++ debugging extensions feature for
  feature.

The job here is narrower: compile the current FreeBASIC file, launch it, show
breakpoints, stack frames, locals, watches, and compile errors, and make that
workflow feel dependable.

## Settings

For the common cases you can stay out of `launch.json` entirely and just set
these in normal VS Code settings:

- `freebasic.debugger.compilerPath`
- `freebasic.debugger.gdbPath`
- `freebasic.debugger.arch`
- `freebasic.debugger.compilerArgs`
- `freebasic.debugger.programArgs`
- `freebasic.debugger.console`
- `freebasic.debugger.stopAtEntry`

## Notes

- The adapter is intentionally lightweight and currently assumes a single
  debugged thread in the UI.
- Build and launch now happen after VS Code has finished substituting variables
  such as `${file}` and `${fileDirname}` from `launch.json`.
- Complex variable expansion depends on what GDB reports through MI and may
  be less complete than the mature C/C++ debugger extensions.
- If `fbc` or `gdb` are not on `PATH`, point `compilerPath` and `gdbPath` at
  the exact executables.
- If FreeBASIC is missing, the extension stops and explains how to point
  `compilerPath` at a real compiler.
- If GDB is missing or unusable, the extension still builds and launches with
  `F5`, but it warns that the session is running without debugger features.
- On macOS, the best experience is still a properly codesigned GDB.
