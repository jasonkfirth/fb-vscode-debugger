'
' Project: FreeBASIC Native Debugger
' ----------------------------------
'
' File: tests/fixtures/gdb-console-smoke.bas
'
' Purpose:
'
'     Provide a native console program for debugger smoke tests.
'
' Responsibilities:
'
'     - write a startup marker requested by the test harness
'     - remain alive long enough for a DAP request round trip
'
' This file intentionally does NOT contain:
'
'     - graphics initialization
'     - debugger-specific source directives
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

' Ten seconds leaves ample time for the extension host to query the session.
sleep 10000, 1

' end of tests/fixtures/gdb-console-smoke.bas
