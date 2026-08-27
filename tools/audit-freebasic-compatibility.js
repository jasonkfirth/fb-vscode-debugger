/*
    Project: FreeBASIC Native Debugger
    ----------------------------------

    File: tools/audit-freebasic-compatibility.js

    Purpose:

        Verify the debugger's compiler assumptions against the FreeBASIC
        release source that defines them.

    Responsibilities:

        - locate a FreeBASIC source checkout on Windows or Unix
        - read the v1.20.3 compiler and packaging sources
        - verify debug flags, diagnostic syntax, and native compiler names
        - verify the extension manifest exposes the audited release profile

    This file intentionally does NOT contain:

        - compiler execution
        - generated extension code
        - source-tree modification
*/

"use strict";

const cp = require("child_process");
const fs = require("fs");
const path = require("path");
const toolchainPaths = require("../lib/toolchainPaths");

/* ------------------------------------------------------------------------- */
/* Paths and command-line handling                                           */
/* ------------------------------------------------------------------------- */

const REPOSITORY_ROOT = path.resolve(__dirname, "..");
const RELEASE_TAG = `v${toolchainPaths.FREEBASIC_RELEASE}`;
const AUDITED_SOURCE_PATHS = [
    "src/compiler/fbc.bas",
    "src/compiler/error.bas",
    "src/compiler/edbg_stab.bas",
    "build_scripts/msys2-build-freebasic.sh"
];

function parseArguments(argumentsList) {
    const options = {
        freeBasicRoot: ""
    };

    for (let index = 0; index < argumentsList.length; index++) {
        const argument = argumentsList[index];

        if (argument === "--freebasic-root") {
            if ((index + 1) >= argumentsList.length)
                throw new Error("--freebasic-root requires a path.");

            options.freeBasicRoot = argumentsList[++index];
            continue;
        }

        if (argument === "--help" || argument === "-h") {
            options.showHelp = true;
            continue;
        }

        throw new Error(`Unknown argument '${argument}'.`);
    }

    return options;
}

function normalizeFreeBasicRoot(candidatePath) {
    if (!candidatePath)
        return "";

    let normalizedPath = path.resolve(candidatePath);

    if (path.basename(normalizedPath).toLowerCase() === "src" &&
        fs.existsSync(path.join(normalizedPath, "compiler", "fbc.bas"))) {
        normalizedPath = path.dirname(normalizedPath);
    }

    return normalizedPath;
}

function isFreeBasicRoot(candidatePath) {
    return Boolean(candidatePath) &&
        fs.existsSync(path.join(candidatePath, "src", "compiler", "fbc.bas")) &&
        fs.existsSync(path.join(candidatePath, "mk", "version.mk"));
}

function discoverFreeBasicRoot(explicitPath) {
    const candidates = [
        explicitPath,
        process.env.FREEBASIC_ROOT,
        path.resolve(REPOSITORY_ROOT, "..", "..", "fbc"),
        path.resolve(REPOSITORY_ROOT, "..", "fbc")
    ];

    for (const candidate of candidates) {
        const normalizedCandidate = normalizeFreeBasicRoot(candidate);

        if (isFreeBasicRoot(normalizedCandidate))
            return normalizedCandidate;
    }

    throw new Error(
        "Unable to locate the FreeBASIC source tree. Pass --freebasic-root or set FREEBASIC_ROOT."
    );
}

/* ------------------------------------------------------------------------- */
/* Release source access                                                     */
/* ------------------------------------------------------------------------- */

function runGit(freeBasicRoot, argumentsList) {
    return cp.execFileSync("git", ["-C", freeBasicRoot].concat(argumentsList), {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
    });
}

function readWorkingFile(freeBasicRoot, relativePath) {
    return fs.readFileSync(path.join(freeBasicRoot, relativePath), "utf8");
}

function readReleaseFile(freeBasicRoot, relativePath) {
    try {
        return runGit(freeBasicRoot, ["show", `${RELEASE_TAG}:${relativePath}`]);
    } catch (_error) {
        const versionText = readWorkingFile(freeBasicRoot, "mk/version.mk");
        const versionMatch = /^FBVERSION\s*:?=\s*([^\s#]+)/m.exec(versionText);

        if (!versionMatch || versionMatch[1] !== toolchainPaths.FREEBASIC_RELEASE) {
            throw new Error(
                `The checkout does not contain ${RELEASE_TAG}, and its working version is not ${toolchainPaths.FREEBASIC_RELEASE}.`
            );
        }

        return readWorkingFile(freeBasicRoot, relativePath);
    }
}

function getWorkingTreeVersion(freeBasicRoot) {
    const versionText = readWorkingFile(freeBasicRoot, "mk/version.mk");
    const versionMatch = /^FBVERSION\s*:?=\s*([^\s#]+)/m.exec(versionText);

    if (!versionMatch)
        throw new Error("Unable to read FBVERSION from mk/version.mk.");

    return versionMatch[1];
}

function verifyAuditedSourcesHaveNotDiverged(freeBasicRoot) {
    try {
        cp.execFileSync(
            "git",
            ["-C", freeBasicRoot, "diff", "--quiet", RELEASE_TAG, "--"].concat(AUDITED_SOURCE_PATHS),
            { stdio: "ignore" }
        );
    } catch (error) {
        if (error && error.status === 1) {
            throw new Error(
                `Compiler compatibility sources differ from ${RELEASE_TAG}; review and update the debugger profile before release.`
            );
        }

        /*
            A source archive may not contain Git metadata. The release file
            validation remains sufficient when the archive itself is 1.20.3.
        */
        if (getWorkingTreeVersion(freeBasicRoot) !== toolchainPaths.FREEBASIC_RELEASE)
            throw error;
    }
}

/* ------------------------------------------------------------------------- */
/* Compatibility checks                                                      */
/* ------------------------------------------------------------------------- */

function requireText(sourceText, expectedText, description) {
    if (sourceText.indexOf(expectedText) === -1)
        throw new Error(`FreeBASIC ${description} was not found in ${RELEASE_TAG}.`);
}

function verifyCompilerSources(freeBasicRoot) {
    const versionSource = readReleaseFile(freeBasicRoot, "mk/version.mk");
    const compilerSource = readReleaseFile(freeBasicRoot, "src/compiler/fbc.bas");
    const errorSource = readReleaseFile(freeBasicRoot, "src/compiler/error.bas");
    const debugSource = readReleaseFile(freeBasicRoot, "src/compiler/edbg_stab.bas");
    const windowsPackageSource = readReleaseFile(
        freeBasicRoot,
        "build_scripts/msys2-build-freebasic.sh"
    );

    const releaseVersionMatch = /^FBVERSION\s*:?=\s*([^\s#]+)/m.exec(versionSource);

    if (!releaseVersionMatch || releaseVersionMatch[1] !== toolchainPaths.FREEBASIC_RELEASE)
        throw new Error(`${RELEASE_TAG} does not declare the expected FBVERSION.`);

    requireText(compilerSource, "ONECHAR(OPT_G)", "-g debug option");
    requireText(compilerSource, "ONECHAR(OPT_X)", "-x output option");
    requireText(compilerSource, "ONECHAR(OPT_S)", "-s subsystem option");
    requireText(
        compilerSource,
        "case FB_COMPTARGET_CYGWIN, FB_COMPTARGET_WIN32, FB_COMPTARGET_JS",
        "-s subsystem target restriction"
    );
    requireText(compilerSource, "CHECK(\"nostrip\", OPT_NOSTRIP)", "-nostrip option");
    requireText(compilerSource, "FB_COMPOPT_DEBUGINFO, TRUE", "debug-info behavior");
    requireText(compilerSource, "@\"win32-aarch64\"", "Windows ARM64 target");
    requireText(compilerSource, "@\"arm64\"", "ARM64 architecture alias");
    requireText(
        errorSource,
        "warningMsgs(msgnum).level",
        "numbered warning-level diagnostic format"
    );
    requireText(debugSource, "STAB_TYPE_SOL", "include-file debug records");

    for (const compilerName of ["fbc32.exe", "fbc64.exe", "fbcarm64.exe"])
        requireText(windowsPackageSource, compilerName, `${compilerName} package name`);
}

function verifyExtensionProfile() {
    const packageJson = JSON.parse(
        fs.readFileSync(path.join(REPOSITORY_ROOT, "package.json"), "utf8")
    );
    const marketplaceTemplate = JSON.parse(
        fs.readFileSync(
            path.join(REPOSITORY_ROOT, "package.marketplace.template.json"),
            "utf8"
        )
    );
    const configurationArchitectures = packageJson.contributes.configuration.properties[
        "freebasic.debugger.arch"
    ].enum;
    const launchArchitectures = packageJson.contributes.debuggers[0]
        .configurationAttributes.launch.properties.arch.enum;

    if (packageJson.version !== toolchainPaths.FREEBASIC_RELEASE)
        throw new Error("package.json version does not match the compiler release profile.");

    if (marketplaceTemplate.version !== toolchainPaths.FREEBASIC_RELEASE) {
        throw new Error(
            "package.marketplace.template.json version does not match the compiler release profile."
        );
    }

    for (const architectures of [configurationArchitectures, launchArchitectures]) {
        for (const architecture of ["auto", "x86", "x64", "arm64"]) {
            if (architectures.indexOf(architecture) === -1)
                throw new Error(`The manifest is missing compiler architecture '${architecture}'.`);
        }
    }

    const configuredWindowsNames = new Set(
        toolchainPaths.WINDOWS_COMPILER_CANDIDATES.map((candidatePath) => (
            path.win32.basename(candidatePath).toLowerCase()
        ))
    );

    for (const compilerName of ["fbc32.exe", "fbc64.exe", "fbcarm64.exe"]) {
        if (!configuredWindowsNames.has(compilerName))
            throw new Error(`Toolchain discovery is missing '${compilerName}'.`);
    }
}

/* ------------------------------------------------------------------------- */
/* Entry point                                                               */
/* ------------------------------------------------------------------------- */

function printHelp() {
    console.log("Usage: node tools/audit-freebasic-compatibility.js [--freebasic-root PATH]");
}

function main() {
    const options = parseArguments(process.argv.slice(2));

    if (options.showHelp) {
        printHelp();
        return;
    }

    const freeBasicRoot = discoverFreeBasicRoot(options.freeBasicRoot);

    verifyCompilerSources(freeBasicRoot);
    verifyAuditedSourcesHaveNotDiverged(freeBasicRoot);
    verifyExtensionProfile();

    console.log(`FreeBASIC source: ${freeBasicRoot}`);
    console.log(`Working source version: ${getWorkingTreeVersion(freeBasicRoot)}`);
    console.log(`Debugger compatibility profile: ${RELEASE_TAG}`);
    console.log("Compiler compatibility audit passed.");
}

if (require.main === module) {
    try {
        main();
    } catch (error) {
        console.error(error && error.message ? error.message : String(error));
        process.exitCode = 1;
    }
}

module.exports = {
    parseArguments,
    normalizeFreeBasicRoot,
    discoverFreeBasicRoot,
    verifyCompilerSources,
    verifyAuditedSourcesHaveNotDiverged,
    verifyExtensionProfile
};

/* end of tools/audit-freebasic-compatibility.js */
