/*
    Project: FreeBASIC Native Debugger
    ----------------------------------

    File: lib/toolchainPaths.js

    Purpose:

        Centralize the known compiler and debugger lookup paths used by
        both the VS Code extension host and the debug adapter process.

    Responsibilities:

        - define common FreeBASIC compiler fallback paths
        - define common GDB fallback paths
        - build bundled GDB candidate paths from a chosen root directory

    This file intentionally does NOT contain:

        - PATH searching logic
        - process spawning
        - VS Code API usage
*/

"use strict";

const path = require("path");

/* ------------------------------------------------------------------------- */
/* Known compiler and debugger locations                                     */
/* ------------------------------------------------------------------------- */

const WINDOWS_COMPILER_CANDIDATES = [
    "C:\\freebasic\\fbc.exe",
    "C:\\freebasic\\fbc64.exe",
    "C:\\freebasic\\fbc32.exe",
    "C:\\FreeBASIC\\fbc.exe",
    "C:\\FreeBASIC\\fbc64.exe",
    "C:\\FreeBASIC\\fbc32.exe",
    "C:\\freebasic\\bin\\fbc.exe",
    "C:\\freebasic\\bin\\fbc64.exe",
    "C:\\freebasic\\bin\\fbc32.exe",
    "C:\\FreeBASIC\\bin\\fbc.exe",
    "C:\\FreeBASIC\\bin\\fbc64.exe",
    "C:\\FreeBASIC\\bin\\fbc32.exe"
];

const MACOS_COMPILER_CANDIDATES = [
    "/opt/homebrew/bin/fbc",
    "/usr/local/bin/fbc",
    "/opt/local/bin/fbc"
];

const LINUX_COMPILER_CANDIDATES = [
    "/usr/bin/fbc",
    "/usr/local/bin/fbc",
    "/snap/bin/fbc"
];

const WINDOWS_GDB_CANDIDATES = [
    "C:\\freebasic\\gdb.exe",
    "C:\\freebasic\\bin\\gdb.exe",
    "C:\\msys64\\mingw64\\bin\\gdb.exe",
    "C:\\msys64\\ucrt64\\bin\\gdb.exe",
    "C:\\msys64\\clang64\\bin\\gdb.exe",
    "C:\\msys64\\mingw32\\bin\\gdb.exe",
    "C:\\mingw64\\bin\\gdb.exe",
    "C:\\mingw32\\bin\\gdb.exe",
    "C:\\w64devkit\\bin\\gdb.exe",
    "C:\\TDM-GCC-64\\bin\\gdb.exe",
    "C:\\TDM-GCC-32\\bin\\gdb.exe"
];

const MACOS_GDB_CANDIDATES = [
    "/opt/homebrew/bin/gdb",
    "/usr/local/bin/gdb",
    "/opt/local/bin/gdb"
];

const LINUX_GDB_CANDIDATES = [
    "/usr/bin/gdb",
    "/usr/local/bin/gdb",
    "/snap/bin/gdb"
];

/* ------------------------------------------------------------------------- */
/* Candidate builders                                                        */
/* ------------------------------------------------------------------------- */

function getBundledGdbCandidates(rootDirectory, platformName) {
    const normalizedPlatform = platformName || process.platform;
    const executableName = normalizedPlatform === "win32" ? "gdb.exe" : "gdb";
    const platformDirectoryName = normalizedPlatform === "win32" ? "win32" : normalizedPlatform;
    const bundledToolsRoot = path.join(rootDirectory, "tools", "gdb");

    return [
        path.join(bundledToolsRoot, executableName),
        path.join(bundledToolsRoot, platformDirectoryName, executableName)
    ];
}

module.exports = {
    WINDOWS_COMPILER_CANDIDATES,
    MACOS_COMPILER_CANDIDATES,
    LINUX_COMPILER_CANDIDATES,
    WINDOWS_GDB_CANDIDATES,
    MACOS_GDB_CANDIDATES,
    LINUX_GDB_CANDIDATES,
    getBundledGdbCandidates
};

/* end of lib/toolchainPaths.js */
