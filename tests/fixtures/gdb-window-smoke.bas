'
' Project: FreeBASIC Native Debugger
' ----------------------------------
'
' File: tests/fixtures/gdb-window-smoke.bas
'
' Purpose:
'
'     Provide a GUI-subsystem program for debugger smoke tests.
'
' Responsibilities:
'
'     - exercise the compiler's current -s gui launch path
'     - write a startup marker requested by the test harness
'
' This file intentionally does NOT contain:
'
'     - display-server dependencies
'     - interactive graphics behavior
'

dim as string markerPath = environ("FB_GDB_SMOKE_MARKER")

if len(markerPath) = 0 then
    end 1
end if

dim as integer markerFile = freefile

open markerPath for output as #markerFile

if err <> 0 then
    end 2
end if

print #markerFile, "started"
close #markerFile

sleep 10000, 1

' end of tests/fixtures/gdb-window-smoke.bas
