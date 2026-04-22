# Changelog

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
