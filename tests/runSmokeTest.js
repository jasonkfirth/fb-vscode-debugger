/*
    Project: FreeBASIC Native Debugger
    ----------------------------------

    File: tests/runSmokeTest.js

    Purpose:

        Run a real extension-host smoke test against the local VS Code
        installation by launching a simple FreeBASIC program under GDB.

    Responsibilities:

        - activate the extension under test
        - start a debug session against a known .bas file
        - verify that the session reaches a stopped state
        - fail fast with clear errors when activation or launch breaks

    This file intentionally does NOT contain:

        - unit test framework glue
        - repository packaging logic
        - extension implementation details
*/

"use strict";

const fs = require("fs");
const path = require("path");

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

function fileExists(filePath) {
    try {
        return fs.existsSync(filePath);
    } catch (_error) {
        return false;
    }
}

function writeMarkerLine(markerFile, line) {
    fs.appendFileSync(markerFile, `${line}\n`, "utf8");
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

exports.run = async function run() {
    const vscode = require("vscode");
    const extensionRoot = path.resolve(__dirname, "..");
    const workspaceRoot = path.join(extensionRoot, "test-workspace");
    const sourceFile = path.join(workspaceRoot, "smoke.bas");
    const programFile = path.join(workspaceRoot, "smoke-vscode-test.exe");
    const markerFile = path.join(workspaceRoot, "smoke-test-marker.txt");
    const traceFile = path.join(workspaceRoot, "adapter-trace.log");
    const compilerPath = "C:\\freebasic\\fbc64.exe";
    const gdbPath = "C:\\msys64\\mingw64\\bin\\gdb.exe";
    const gdbDirectory = path.dirname(gdbPath);
    const compilerDirectory = path.dirname(compilerPath);
    const extensionIdentifier = "local.freebasic-native-debugger";

    try {
        if (fileExists(programFile))
            fs.unlinkSync(programFile);

        if (fileExists(traceFile))
            fs.unlinkSync(traceFile);

        if (!fileExists(sourceFile))
            throw new Error(`Smoke test source file is missing: ${sourceFile}`);

        if (!fileExists(compilerPath))
            throw new Error(`FreeBASIC compiler not found: ${compilerPath}`);

        if (!fileExists(gdbPath))
            throw new Error(`GDB not found: ${gdbPath}`);

        fs.writeFileSync(markerFile, "", "utf8");
        writeMarkerLine(markerFile, "started");

        const extension = vscode.extensions.getExtension(extensionIdentifier);

        if (!extension)
            throw new Error(`Extension '${extensionIdentifier}' is not available in the extension host.`);

        await extension.activate();
        writeMarkerLine(markerFile, "extension-activated");

        const document = await vscode.workspace.openTextDocument(sourceFile);
        await vscode.window.showTextDocument(document);
        writeMarkerLine(markerFile, "document-opened");

        /*
            The debug session uses a real compiler and a real GDB instance.
            PATH is extended so mingw64 runtime DLLs and the FreeBASIC
            compiler directory are visible when child processes start.
        */
        const launchConfiguration = {
            name: "Smoke Test",
            type: "freebasic-gdb",
            request: "launch",
            sourceFile,
            cwd: workspaceRoot,
            program: programFile,
            compilerPath,
            gdbPath,
            stopAtEntry: true,
            env: {
                FREEBASIC_DEBUG_LOG: traceFile,
                PATH: `${gdbDirectory};${compilerDirectory};${process.env.PATH || ""}`
            }
        };

        const terminatedPromise = waitForEvent(
            vscode,
            "terminate",
            (session) => session.type === "freebasic-gdb",
            30000
        );

        const didStart = await vscode.debug.startDebugging(
            vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders[0],
            launchConfiguration
        );
        writeMarkerLine(markerFile, `startDebugging-returned:${didStart}`);

        if (!didStart)
            throw new Error("VS Code refused to start the FreeBASIC debug session.");

        if (!fileExists(programFile))
            throw new Error(`Expected compiled program was not created: ${programFile}`);

        writeMarkerLine(markerFile, "program-created");

        const activeSession = await waitForCondition(
            async () => {
                const session = vscode.debug.activeDebugSession;

                if (!session || session.type !== "freebasic-gdb")
                    return null;

                return session;
            },
            30000,
            "an active FreeBASIC debug session"
        );
        writeMarkerLine(markerFile, "active-session-detected");

        const threadsResponse = await activeSession.customRequest("threads");
        writeMarkerLine(markerFile, `threads-response:${Array.isArray(threadsResponse && threadsResponse.threads) ? threadsResponse.threads.length : 0}`);

        if (!threadsResponse || !Array.isArray(threadsResponse.threads) || threadsResponse.threads.length === 0)
            throw new Error("The FreeBASIC debug adapter did not return thread information.");

        await activeSession.customRequest("disconnect", {});
        writeMarkerLine(markerFile, "disconnect-request-sent");
        await terminatedPromise;
        writeMarkerLine(markerFile, "terminated-event-received");

        writeMarkerLine(markerFile, "completed");
        await delay(250);
    } catch (error) {
        writeMarkerLine(markerFile, `failed: ${error.message}`);
        throw error;
    }
};

/* end of tests/runSmokeTest.js */
