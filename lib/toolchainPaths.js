/*
    Project: FreeBASIC Native Debugger
    ----------------------------------

    File: lib/toolchainPaths.js

    Purpose:

        Centralize the known compiler and debugger lookup paths used by
        both the VS Code extension host and the debug adapter process.

    Responsibilities:

        - define common FreeBASIC compiler fallback paths
        - describe compiler executable names used by current packages
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
/* FreeBASIC 1.20.3 compiler package layout                                  */
/* ------------------------------------------------------------------------- */

const FREEBASIC_RELEASE = "1.20.3";

const WINDOWS_COMPILER_NAMES = {
    x86: ["fbc32.exe", "fbc.exe", "fbc"],
    x64: ["fbc64.exe", "fbc.exe", "fbc"],
    arm64: ["fbcarm64.exe", "fbc.exe", "fbc"]
};

function normalizeCompilerArchitecture(architecture, hostArchitecture) {
    const requestedArchitecture = String(architecture || "auto").trim().toLowerCase();
    const currentHostArchitecture = String(hostArchitecture || process.arch).trim().toLowerCase();
    const architectureToNormalize = requestedArchitecture === "auto"
        ? currentHostArchitecture
        : requestedArchitecture;

    if (architectureToNormalize === "x86" ||
        architectureToNormalize === "ia32" ||
        architectureToNormalize === "i386" ||
        architectureToNormalize === "i686") {
        return "x86";
    }

    if (architectureToNormalize === "x64" ||
        architectureToNormalize === "x86_64" ||
        architectureToNormalize === "amd64") {
        return "x64";
    }

    if (architectureToNormalize === "arm64" || architectureToNormalize === "aarch64")
        return "arm64";

    return "x64";
}

function getWindowsCompilerNames(architecture, hostArchitecture) {
    const normalizedArchitecture = normalizeCompilerArchitecture(
        architecture,
        hostArchitecture
    );

    return WINDOWS_COMPILER_NAMES[normalizedArchitecture].slice();
}

/* ------------------------------------------------------------------------- */
/* Known compiler and debugger locations                                     */
/* ------------------------------------------------------------------------- */

const WINDOWS_COMPILER_CANDIDATES = [
    "C:\\freebasic\\fbc64.exe",
    "C:\\freebasic\\fbc32.exe",
    "C:\\freebasic\\fbcarm64.exe",
    "C:\\freebasic\\fbc.exe",
    "C:\\FreeBASIC\\fbc64.exe",
    "C:\\FreeBASIC\\fbc32.exe",
    "C:\\FreeBASIC\\fbcarm64.exe",
    "C:\\FreeBASIC\\fbc.exe",
    "C:\\freebasic\\bin\\fbc64.exe",
    "C:\\freebasic\\bin\\fbc32.exe",
    "C:\\freebasic\\bin\\fbcarm64.exe",
    "C:\\freebasic\\bin\\fbc.exe",
    "C:\\FreeBASIC\\bin\\fbc64.exe",
    "C:\\FreeBASIC\\bin\\fbc32.exe",
    "C:\\FreeBASIC\\bin\\fbcarm64.exe",
    "C:\\FreeBASIC\\bin\\fbc.exe"
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
    "C:\\msys64\\clangarm64\\bin\\gdb.exe",
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
    FREEBASIC_RELEASE,
    WINDOWS_COMPILER_NAMES,
    normalizeCompilerArchitecture,
    getWindowsCompilerNames,
    WINDOWS_COMPILER_CANDIDATES,
    MACOS_COMPILER_CANDIDATES,
    LINUX_COMPILER_CANDIDATES,
    WINDOWS_GDB_CANDIDATES,
    MACOS_GDB_CANDIDATES,
    LINUX_GDB_CANDIDATES,
    getBundledGdbCandidates
};

/* end of lib/toolchainPaths.js */
