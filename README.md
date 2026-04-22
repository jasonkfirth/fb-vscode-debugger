# FreeBASIC Native Debugger

This is a native VS Code debugger for FreeBASIC.

Press `F5` on a `.bas` file, the extension builds it with `fbc -g`,
then starts the program under GDB. The goal is simple: make FreeBASIC feel like
a normal Run and Debug language in VS Code instead of a language that needs
manual task wiring every time.

## What it does

- Registers a `freebasic-gdb` debugger type.
- Builds the active `.bas` file with `fbc` by default.
- Lets you override the compiler path when a platform-specific launcher such as
  `fbc.exe`, `fbc64`, `fbc32`, `fbc64.exe`, or `fbc32.exe` is preferred.
- Launches the resulting program with `gdb --interpreter=mi2`.
- Exposes breakpoints, continue, pause, stepping, stack frames, locals, and
  expression evaluation through the Debug Adapter Protocol.
- Parses FreeBASIC compile errors into the Problems panel before debugger
  launch.
- Writes compiler and debugger status details to the `FreeBASIC Debugger`
  output channel.

## Platform support

- Windows, Linux, and macOS are supported.
- The extension assumes `fbc` and `gdb` are available on `PATH`.
- On Windows, compiler discovery prefers `fbc.exe` first, then falls back to
  `fbc64.exe` / `fbc32.exe` when needed.
- On Windows, the generated output name ends in `.exe`.
- On Linux and macOS, the generated output name has no `.exe` suffix.
- If your setup uses a non-default compiler or debugger location, set
  `compilerPath` and `gdbPath` in `launch.json`.

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
- If FreeBASIC or GDB is missing, the extension shows an error explaining how
  to proceed: install the missing tool, put it on `PATH`, or set the matching
  debugger setting explicitly.

## Release and packaging notes

- The Marketplace package icon is built from the FreeBASIC horse artwork in
  `assets/`.
- Third-party attribution details are listed in `THIRD_PARTY_NOTICES.md`.
- Packaging exclusions are controlled by `.vscodeignore`.
- Marketplace-specific metadata can be filled in with
  `package.marketplace.template.json`.
- Exact packaging and publish commands are documented in `PUBLISHING.md`.

## Development validation

Run the unit harness from the extension folder:

```powershell
npm run test:unit
```

If `node` is not on `PATH`, you can still run the tests with VS Code's bundled
runtime. That is how the test suite was validated during development.

The exact command used here was:

```powershell
$env:ELECTRON_RUN_AS_NODE='1'; & 'C:\Users\admin\AppData\Local\Programs\Microsoft VS Code\Code.exe' 'C:\Nextcloud\FBXL 5\vscode\tests\run_unit_tests.js'
```

That run completed successfully on April 21, 2026 with `SUMMARY 22 tests passed`.

## What was actually tested

- compiler lookup for `fbc`, `fbc.exe`, `fbc64.exe`, and Windows fallback paths
- GDB lookup for bundled tools, common platform paths, and plain `gdb`
- default `F5` launch configuration generation
- compiler argument construction, including `-g` and output naming
- FreeBASIC compile success and compile failure handling
- compiler error parsing into VS Code diagnostics
- DAP message framing and parsing
- GDB/MI record parsing
- initial GDB prompt detection and startup command flow

The unit harness files are in `tests/extension.unit.js` and
`tests/adapter.unit.js`.

## Marketplace preparation

The repository includes the main files needed for Marketplace release work:

- `package.json` for the working extension manifest
- `package.marketplace.template.json` for publisher/repository metadata
- `.vscodeignore` for package filtering
- `PUBLISHING.md` for the exact `vsce` workflow
