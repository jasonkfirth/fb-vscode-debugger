FreeBASIC Native Debugger
-------------------------

Folder: tools/gdb

Purpose:

    Optional home for a bundled GDB binary when the extension is
    distributed with its own debugger runtime.

Responsibilities:

    - provide a preferred debugger location before PATH lookup
    - keep platform-specific debugger payloads in one predictable place

This folder intentionally does NOT contain:

    - FreeBASIC compiler binaries
    - extension host scripts
    - user workspace output

Expected layout examples:

    tools/gdb/gdb.exe
    tools/gdb/win32/gdb.exe
    tools/gdb/linux/gdb
    tools/gdb/darwin/gdb

The resolver in extension.js checks this directory before it falls back
to well-known system install locations and then to plain "gdb" on PATH.

end of tools/gdb/README.txt
