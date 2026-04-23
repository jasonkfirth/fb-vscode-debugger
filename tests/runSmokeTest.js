/*
    Project: FreeBASIC Native Debugger
    ----------------------------------

    File: tests/runSmokeTest.js

    Purpose:

        Run a real extension-host smoke test against the local VS Code
        installation and prove that the debuggee actually starts for both
        console and windowed FreeBASIC programs.

    Responsibilities:

        - activate the extension under test
        - launch a console smoke program through the extension
        - launch a gfxlib smoke program through the extension
        - verify that each debuggee writes its startup marker file
        - fail fast with trace details when launch does not progress

    This file intentionally does NOT contain:

        - unit test framework glue
        - repository packaging logic
        - debugger implementation details
*/

"use strict";

const fs = require("fs");
const path = require("path");

/* ------------------------------------------------------------------------- */
/* Generic helpers                                                           */
/* ------------------------------------------------------------------------- */

async function delay(milliseconds) {
    await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForCondition(checkFunction, timeoutMilliseconds, description) {
    const startTime = Date.now();

    while ((Date.now() - startTime) < timeoutMilliseconds) {
        const result = await checkFunction();

        if (result)
            return result;

        await delay(250);
    }

    throw new Error(`Timed out waiting for ${description}.`);
}

async function withTimeout(promise, timeoutMilliseconds, description) {
    return Promise.race([
        promise,
        (async () => {
            await delay(timeoutMilliseconds);
            throw new Error(`Timed out waiting for ${description}.`);
        })()
    ]);
}

function fileExists(filePath) {
    try {
        return fs.existsSync(filePath);
    } catch (_error) {
        return false;
    }
}

function ensureFileDeleted(filePath) {
    if (!fileExists(filePath))
        return;

    fs.unlinkSync(filePath);
}

function writeLogLine(logFile, line) {
    fs.appendFileSync(logFile, `${line}\n`, "utf8");
}

function readTextFileIfPresent(filePath) {
    if (!fileExists(filePath))
        return "";

    return fs.readFileSync(filePath, "utf8");
}

function readTraceTail(filePath, maxLines) {
    const text = readTextFileIfPresent(filePath);

    if (!text)
        return "";

    return text
        .trim()
        .split(/\r?\n/)
        .slice(-Math.max(maxLines || 40, 1))
        .join("\n");
}

function waitForMarkerLine(markerFile, expectedLine, timeoutMilliseconds) {
    return waitForCondition(
        async () => {
            const text = readTextFileIfPresent(markerFile);

            if (!text)
                return null;

            const lines = text
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter((line) => Boolean(line));

            if (lines.indexOf(expectedLine) !== -1)
                return lines;

            return null;
        },
        timeoutMilliseconds,
        `marker line '${expectedLine}' in ${markerFile}`
    );
}

async function waitForEvent(vscode, eventName, predicate, timeoutMilliseconds) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            subscription.dispose();
            reject(new Error(`Timed out waiting for debug event '${eventName}'.`));
        }, timeoutMilliseconds);

        const handler = (event) => {
            try {
                if (predicate && !predicate(event))
                    return;

                clearTimeout(timer);
                subscription.dispose();
                resolve(event);
            } catch (error) {
                clearTimeout(timer);
                subscription.dispose();
                reject(error);
            }
        };

        let subscription;

        switch (eventName) {
        case "start":
            subscription = vscode.debug.onDidStartDebugSession(handler);
            break;
        case "terminate":
            subscription = vscode.debug.onDidTerminateDebugSession(handler);
            break;
        default:
            throw new Error(`Unknown debug event '${eventName}'.`);
        }
    });
}

/* ------------------------------------------------------------------------- */
/* Toolchain and extension helpers                                           */
/* ------------------------------------------------------------------------- */

function getProgramSuffix() {
    if (process.platform === "win32")
        return ".exe";

    return "";
}

function getDefaultCompilerPath() {
    if (process.env.FB_SMOKE_COMPILER)
        return process.env.FB_SMOKE_COMPILER;

    if (process.platform === "win32")
        return "C:\\freebasic\\fbc64.exe";

    return "fbc";
}

function getDefaultGdbPath() {
    if (process.env.FB_SMOKE_GDB)
        return process.env.FB_SMOKE_GDB;

    if (process.platform === "win32")
        return "C:\\msys64\\mingw64\\bin\\gdb.exe";

    return "gdb";
}

function getDefaultConsoleKind() {
    if (process.platform === "win32")
        return "externalTerminal";

    return "integratedTerminal";
}

function getExtensionIdentifier(extensionRoot) {
    const packageJsonPath = path.join(extensionRoot, "package.json");
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));

    return `${packageJson.publisher}.${packageJson.name}`;
}

function buildLaunchPathValue(compilerPath, gdbPath) {
    const pathEntries = [];

    if (compilerPath && (compilerPath.indexOf(path.sep) !== -1 || compilerPath.indexOf("/") !== -1))
        pathEntries.push(path.dirname(compilerPath));

    if (gdbPath && (gdbPath.indexOf(path.sep) !== -1 || gdbPath.indexOf("/") !== -1))
        pathEntries.push(path.dirname(gdbPath));

    if (process.env.PATH)
        pathEntries.push(process.env.PATH);

    return pathEntries.filter((entry) => Boolean(entry)).join(path.delimiter);
}

function createScenarioDefinitions(workspaceRoot) {
    const programSuffix = getProgramSuffix();
    const defaultConsoleKind = getDefaultConsoleKind();

    return [
        {
            name: "console",
            sourceFile: path.join(workspaceRoot, "gdb-console-smoke.bas"),
            program: path.join(workspaceRoot, `gdb-console-smoke-vscode${programSuffix}`),
            compilerArgs: [],
            expectedMarkerLine: "started",
            console: defaultConsoleKind
        },
        {
            name: "window",
            sourceFile: path.join(workspaceRoot, "gdb-window-smoke.bas"),
            program: path.join(workspaceRoot, `gdb-window-smoke-vscode${programSuffix}`),
            compilerArgs: ["-s", "gui"],
            expectedMarkerLine: "started",
            console: defaultConsoleKind
        }
    ];
}

/* ------------------------------------------------------------------------- */
/* Scenario execution                                                        */
/* ------------------------------------------------------------------------- */

async function runScenario(vscode, scenario, options) {
    const markerFile = path.join(
        options.workspaceRoot,
        `extension-smoke-${scenario.name}-marker.txt`
    );
    const logFile = path.join(
        options.workspaceRoot,
        `extension-smoke-${scenario.name}.log`
    );
    const traceFile = path.join(
        options.workspaceRoot,
        `extension-smoke-${scenario.name}-trace.log`
    );
    const sessionTraceFile = path.join(
        options.workspaceRoot,
        `extension-smoke-${scenario.name}-session.log`
    );
    const hostTraceFile = path.join(
        options.workspaceRoot,
        `extension-smoke-${scenario.name}-host.log`
    );
    const launchConfiguration = {
        name: `Smoke Test (${scenario.name})`,
        type: "freebasic-gdb",
        request: "launch",
        sourceFile: scenario.sourceFile,
        cwd: options.workspaceRoot,
        program: scenario.program,
        compilerPath: options.compilerPath,
        gdbPath: options.gdbPath,
        compilerArgs: scenario.compilerArgs,
        stopAtEntry: false,
        console: scenario.console,
        env: {
            FB_GDB_SMOKE_MARKER: markerFile,
            FREEBASIC_DEBUG_LOG: traceFile,
            FREEBASIC_DEBUG_SESSION_LOG: sessionTraceFile,
            FREEBASIC_DEBUG_HOST_LOG: hostTraceFile,
            PATH: options.pathValue
        }
    };

    ensureFileDeleted(markerFile);
    ensureFileDeleted(traceFile);
    ensureFileDeleted(sessionTraceFile);
    ensureFileDeleted(hostTraceFile);
    ensureFileDeleted(logFile);
    ensureFileDeleted(scenario.program);

    writeLogLine(logFile, `scenario=${scenario.name}`);
    writeLogLine(logFile, `source=${scenario.sourceFile}`);
    writeLogLine(logFile, `program=${scenario.program}`);
    writeLogLine(logFile, `console=${scenario.console}`);
    writeLogLine(logFile, `workspace-trusted=${vscode.workspace.isTrusted}`);
    writeLogLine(
        logFile,
        `workspace-folder=${vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0] ? vscode.workspace.workspaceFolders[0].uri.fsPath : "<none>"}`
    );

    const document = await vscode.workspace.openTextDocument(scenario.sourceFile);
    await vscode.window.showTextDocument(document);
    writeLogLine(logFile, "document-opened");

    const startedPromise = waitForEvent(
        vscode,
        "start",
        (session) => session.type === "freebasic-gdb",
        30000
    );
    const terminatedPromise = waitForEvent(
        vscode,
        "terminate",
        (session) => session.type === "freebasic-gdb",
        60000
    );

    const didStart = await withTimeout(
        vscode.debug.startDebugging(
            vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0],
            launchConfiguration
        ),
        30000,
        `startDebugging() for scenario '${scenario.name}'`
    );
    writeLogLine(logFile, `startDebugging-returned=${didStart}`);

    if (!didStart) {
        const hostTraceTail = readTraceTail(hostTraceFile, 80);
        const detailParts = [
            `VS Code refused to start the ${scenario.name} smoke scenario.`
        ];

        if (hostTraceTail)
            detailParts.push(`Host trace tail:\n${hostTraceTail}`);

        throw new Error(detailParts.join("\n\n"));
    }

    await startedPromise;
    writeLogLine(logFile, "debug-session-started");

    if (!fileExists(scenario.program))
        throw new Error(`Expected compiled program was not created: ${scenario.program}`);

    writeLogLine(logFile, "program-created");

    const activeSession = await waitForCondition(
        async () => {
            const session = vscode.debug.activeDebugSession;

            if (!session || session.type !== "freebasic-gdb")
                return null;

            return session;
        },
        30000,
        `an active FreeBASIC debug session for ${scenario.name}`
    );

    writeLogLine(logFile, "active-session-detected");

    let markerLines;

    try {
        markerLines = await waitForMarkerLine(
            markerFile,
            scenario.expectedMarkerLine,
            20000
        );
    } catch (_error) {
        const traceTail = readTraceTail(traceFile, 80);
        const sessionTraceTail = readTraceTail(sessionTraceFile, 80);
        const hostTraceTail = readTraceTail(hostTraceFile, 80);
        const markerText = readTextFileIfPresent(markerFile);
        const detailParts = [
            `scenario '${scenario.name}' did not reach marker '${scenario.expectedMarkerLine}'.`
        ];

        if (markerText)
            detailParts.push(`Marker contents so far:\n${markerText}`);

        if (traceTail)
            detailParts.push(`Adapter trace tail:\n${traceTail}`);

        if (sessionTraceTail)
            detailParts.push(`Session trace tail:\n${sessionTraceTail}`);

        if (hostTraceTail)
            detailParts.push(`Host trace tail:\n${hostTraceTail}`);

        throw new Error(detailParts.join("\n\n"));
    }

    writeLogLine(logFile, `marker-lines=${markerLines.join(",")}`);

    const threadsResponse = await activeSession.customRequest("threads");
    const threadCount = Array.isArray(threadsResponse && threadsResponse.threads)
        ? threadsResponse.threads.length
        : 0;

    writeLogLine(logFile, `threads-response=${threadCount}`);

    if (threadCount <= 0)
        throw new Error(`The debug adapter returned no threads for scenario '${scenario.name}'.`);

    await activeSession.customRequest("disconnect", {});
    writeLogLine(logFile, "disconnect-request-sent");
    await terminatedPromise;
    writeLogLine(logFile, "terminated-event-received");

    return {
        name: scenario.name,
        markerFile,
        markerLines,
        traceFile,
        sessionTraceFile,
        hostTraceFile,
        logFile
    };
}

/* ------------------------------------------------------------------------- */
/* Smoke test entry point                                                    */
/* ------------------------------------------------------------------------- */

exports.run = async function run() {
    const vscode = require("vscode");
    const extensionRoot = path.resolve(__dirname, "..");
    const workspaceRoot = path.join(extensionRoot, "test-workspace");
    const compilerPath = getDefaultCompilerPath();
    const gdbPath = getDefaultGdbPath();
    const pathValue = buildLaunchPathValue(compilerPath, gdbPath);
    const extensionIdentifier = getExtensionIdentifier(extensionRoot);
    const summaryFile = path.join(workspaceRoot, "extension-smoke-summary.txt");
    const scenarios = createScenarioDefinitions(workspaceRoot);
    const results = [];

    ensureFileDeleted(summaryFile);
    writeLogLine(summaryFile, `extension=${extensionIdentifier}`);
    writeLogLine(summaryFile, `compiler=${compilerPath}`);
    writeLogLine(summaryFile, `gdb=${gdbPath}`);
    writeLogLine(summaryFile, `workspace-trusted=${vscode.workspace.isTrusted}`);
    writeLogLine(
        summaryFile,
        `workspace-folders=${vscode.workspace.workspaceFolders ? vscode.workspace.workspaceFolders.length : 0}`
    );

    if (!fileExists(workspaceRoot))
        throw new Error(`Smoke test workspace is missing: ${workspaceRoot}`);

    if (!vscode.workspace.isTrusted)
        throw new Error("The extension smoke test must run in a trusted workspace.");

    if (compilerPath.indexOf(path.sep) !== -1 || compilerPath.indexOf("/") !== -1) {
        if (!fileExists(compilerPath))
            throw new Error(`FreeBASIC compiler not found: ${compilerPath}`);
    }

    if (gdbPath.indexOf(path.sep) !== -1 || gdbPath.indexOf("/") !== -1) {
        if (!fileExists(gdbPath))
            throw new Error(`GDB not found: ${gdbPath}`);
    }

    const extension = vscode.extensions.getExtension(extensionIdentifier);

    if (!extension)
        throw new Error(`Extension '${extensionIdentifier}' is not available in the extension host.`);

    await extension.activate();
    writeLogLine(summaryFile, "extension-activated");

    for (const scenario of scenarios) {
        writeLogLine(summaryFile, `running-scenario=${scenario.name}`);
        const result = await runScenario(vscode, scenario, {
            workspaceRoot,
            compilerPath,
            gdbPath,
            pathValue
        });

        results.push(result);
        writeLogLine(
            summaryFile,
            `scenario-completed=${scenario.name}:${result.markerLines.join(",")}`
        );

        await delay(500);
    }

    return results;
};

/* end of tests/runSmokeTest.js */
