/*
    Project: FreeBASIC Native Debugger
    ----------------------------------

    File: extension.js

    Purpose:

        Provide VS Code integration for launching the custom
        FreeBASIC + GDB debugger from the active editor file.

    Responsibilities:

        - register the FreeBASIC debug configuration provider
        - synthesize a usable launch configuration for F5
        - offer a command that explicitly debugs the current file

    This file intentionally does NOT contain:

        - Debug Adapter Protocol message handling
        - GDB/MI parsing
        - compiler process execution
*/

"use strict";

const fs = require("fs");
const cp = require("child_process");
const path = require("path");
const vscode = require("vscode");
const toolchainPaths = require("./lib/toolchainPaths");

/* ------------------------------------------------------------------------- */
/* Constants                                                                 */
/* ------------------------------------------------------------------------- */

const FREEBASIC_LANGUAGE_ID = "freebasic";
const DEBUG_TYPE = "freebasic-gdb";
const WINDOWS_COMPILER_CANDIDATES = toolchainPaths.WINDOWS_COMPILER_CANDIDATES;
const WINDOWS_GDB_CANDIDATES = toolchainPaths.WINDOWS_GDB_CANDIDATES;
const MACOS_GDB_CANDIDATES = toolchainPaths.MACOS_GDB_CANDIDATES;
const LINUX_GDB_CANDIDATES = toolchainPaths.LINUX_GDB_CANDIDATES;
const FREEBASIC_DIAGNOSTIC_SOURCE = "FreeBASIC";
const FREEBASIC_SETTINGS_SECTION = "freebasic.debugger";
const FREEBASIC_OUTPUT_CHANNEL_NAME = "FreeBASIC Debugger";
const VALID_CONSOLE_KINDS = [
    "platformDefault",
    "internalConsole",
    "integratedTerminal",
    "externalTerminal"
];

/* ------------------------------------------------------------------------- */
/* Source file helpers                                                       */
/* ------------------------------------------------------------------------- */

function isFreeBasicSourceExtension(extension) {
    return extension === ".bas" || extension === ".bi";
}

function isRunnableFreeBasicSourceExtension(extension) {
    return extension === ".bas";
}

function isRunnableSourceFile(filePath) {
    return isRunnableFreeBasicSourceExtension(path.extname(String(filePath || "")).toLowerCase());
}

function getActiveSourceFile() {
    const editor = vscode.window.activeTextEditor;

    if (!editor || !editor.document || editor.document.isUntitled)
        return null;

    const documentPath = editor.document.uri.fsPath;
    const extension = path.extname(documentPath).toLowerCase();

    if (!isRunnableFreeBasicSourceExtension(extension))
        return null;

    return documentPath;
}

function getDefaultConsoleKind(platformName) {
    const resolvedPlatform = platformName || process.platform;

    if (resolvedPlatform === "win32")
        return "externalTerminal";

    return "integratedTerminal";
}

function normalizeConsoleKind(consoleKind, platformName) {
    const requestedConsoleKind = String(consoleKind || "platformDefault").trim();

    if (requestedConsoleKind === "platformDefault")
        return getDefaultConsoleKind(platformName);

    if (VALID_CONSOLE_KINDS.indexOf(requestedConsoleKind) !== -1)
        return requestedConsoleKind;

    return getDefaultConsoleKind(platformName);
}

/* ------------------------------------------------------------------------- */
/* Path selection helpers                                                    */
/* ------------------------------------------------------------------------- */

function fileExists(filePath) {
    try {
        return fs.existsSync(filePath);
    } catch (_error) {
        return false;
    }
}

function commandExists(commandName) {
    const pathValue = process.env.PATH || "";
    const pathEntries = pathValue.split(path.delimiter).filter((entry) => Boolean(entry));
    const candidateNames = [commandName];

    if (process.platform === "win32") {
        const extension = path.extname(commandName).toLowerCase();
        const pathextEntries = (process.env.PATHEXT || ".EXE;.CMD;.BAT;.COM")
            .split(";")
            .filter((entry) => Boolean(entry));

        if (!extension) {
            for (const pathextEntry of pathextEntries)
                candidateNames.push(`${commandName}${pathextEntry.toLowerCase()}`);
        }
    }

    for (const pathEntry of pathEntries) {
        for (const candidateName of candidateNames) {
            if (fileExists(path.join(pathEntry, candidateName)))
                return true;
        }
    }

    return false;
}

function chooseCompilerPath(arch) {
    const normalizedArch = (arch || "auto").toLowerCase();
    const isWindows = process.platform === "win32";
    const candidateCompilers = [];
    const preferredCompilerNames = [];

    /*
        FreeBASIC packaging differs by platform.

        On Windows it is common to have fbc32/fbc64 launchers.
        On Linux and macOS the compiler is usually just "fbc" on PATH.
    */
    if (normalizedArch === "x64") {
        preferredCompilerNames.push(isWindows ? "fbc.exe" : "fbc");
        preferredCompilerNames.push(isWindows ? "fbc64.exe" : "fbc64");
        preferredCompilerNames.push("fbc");
    } else if (normalizedArch === "x86") {
        preferredCompilerNames.push(isWindows ? "fbc.exe" : "fbc");
        preferredCompilerNames.push(isWindows ? "fbc32.exe" : "fbc32");
        preferredCompilerNames.push("fbc");
    } else {
        if (isWindows) {
            preferredCompilerNames.push("fbc.exe");
            preferredCompilerNames.push("fbc64.exe");
            preferredCompilerNames.push("fbc32.exe");
        }

        preferredCompilerNames.push("fbc");
    }

    if (isWindows) {
        for (const candidatePath of WINDOWS_COMPILER_CANDIDATES) {
            if (normalizedArch === "x64" && candidatePath.toLowerCase().indexOf("fbc32") !== -1)
                continue;

            if (normalizedArch === "x86" && candidatePath.toLowerCase().indexOf("fbc64") !== -1)
                continue;

            candidateCompilers.push(candidatePath);
        }
    }

    for (const candidateName of preferredCompilerNames)
        candidateCompilers.push(candidateName);

    for (const candidateCompiler of candidateCompilers) {
        if (candidateCompiler.indexOf(path.sep) !== -1 || candidateCompiler.indexOf("/") !== -1) {
            if (fileExists(candidateCompiler))
                return candidateCompiler;

            continue;
        }

        return candidateCompiler;
    }

    return "fbc";
}

function getBundledGdbCandidates() {
    return toolchainPaths.getBundledGdbCandidates(__dirname, process.platform);
}

function chooseGdbPath() {
    const candidatePaths = [];

    for (const candidatePath of getBundledGdbCandidates())
        candidatePaths.push(candidatePath);

    if (process.platform === "win32") {
        for (const candidatePath of WINDOWS_GDB_CANDIDATES)
            candidatePaths.push(candidatePath);
    } else if (process.platform === "darwin") {
        for (const candidatePath of MACOS_GDB_CANDIDATES)
            candidatePaths.push(candidatePath);
    } else {
        for (const candidatePath of LINUX_GDB_CANDIDATES)
            candidatePaths.push(candidatePath);
    }

    for (const candidatePath of candidatePaths) {
        if (fileExists(candidatePath))
            return candidatePath;
    }

    return "gdb";
}

function getDebuggerSettings() {
    return vscode.workspace.getConfiguration(FREEBASIC_SETTINGS_SECTION);
}

function resolveConfiguredCompilerPath(compilerPath, arch) {
    if (compilerPath && String(compilerPath).trim())
        return String(compilerPath).trim();

    return chooseCompilerPath(arch);
}

function resolveConfiguredGdbPath(gdbPath) {
    if (gdbPath && String(gdbPath).trim())
        return String(gdbPath).trim();

    return chooseGdbPath();
}

function getProgramSuffix() {
    if (process.platform === "win32")
        return ".exe";

    return "";
}

function normalizeExistingPathCase(filePath) {
    if (!filePath)
        return filePath;

    try {
        return fs.realpathSync.native(filePath);
    } catch (_error) {
        return path.normalize(filePath);
    }
}

function createDiagnosticCollection() {
    return vscode.languages.createDiagnosticCollection("freebasic");
}

function createOutputChannel() {
    return vscode.window.createOutputChannel(FREEBASIC_OUTPUT_CHANNEL_NAME);
}

function clearDiagnosticsForSource(diagnosticCollection, sourceFile) {
    if (!sourceFile)
        return;

    diagnosticCollection.delete(vscode.Uri.file(normalizeExistingPathCase(sourceFile)));
}

function parseCompilerDiagnostics(errorText) {
    const diagnosticsByFile = new Map();
    const lines = String(errorText || "").split(/\r?\n/);
    let lastDiagnostic = null;

    for (const rawLine of lines) {
        const line = rawLine.trim();

        if (!line)
            continue;

        const diagnosticMatch = /^(.*)\((\d+)\)\s+(error|warning)\s+(\d+):\s*(.*)$/i.exec(line);

        if (diagnosticMatch) {
            const filePath = normalizeExistingPathCase(diagnosticMatch[1].trim());
            const lineNumber = Math.max(Number(diagnosticMatch[2]) - 1, 0);
            const severityName = diagnosticMatch[3].toLowerCase();
            const errorCode = diagnosticMatch[4];
            const messageText = diagnosticMatch[5].trim();
            const diagnostic = new vscode.Diagnostic(
                new vscode.Range(lineNumber, 0, lineNumber, Number.MAX_SAFE_INTEGER),
                messageText,
                severityName === "warning"
                    ? vscode.DiagnosticSeverity.Warning
                    : vscode.DiagnosticSeverity.Error
            );

            diagnostic.source = FREEBASIC_DIAGNOSTIC_SOURCE;
            diagnostic.code = errorCode;

            if (!diagnosticsByFile.has(filePath))
                diagnosticsByFile.set(filePath, []);

            diagnosticsByFile.get(filePath).push(diagnostic);
            lastDiagnostic = diagnostic;
            continue;
        }

        /*
            FreeBASIC often emits a follow-up "in '...'" line that shows the
            exact source statement associated with the previous diagnostic.
            Appending it keeps the Problems view informative without creating
            a second synthetic diagnostic.
        */
        if (lastDiagnostic && /^in\s+'/.test(line)) {
            lastDiagnostic.message = `${lastDiagnostic.message}\n${line}`;
        }
    }

    return diagnosticsByFile;
}

function applyCompilerDiagnostics(diagnosticCollection, diagnosticsByFile) {
    for (const [filePath, diagnostics] of diagnosticsByFile.entries())
        diagnosticCollection.set(vscode.Uri.file(filePath), diagnostics);
}

function buildCompilerArguments(configuration) {
    const compilerArguments = Array.isArray(configuration.compilerArgs)
        ? configuration.compilerArgs.slice()
        : [];
    let hasDebugFlag = false;
    let hasOutputFlag = false;

    for (const argument of compilerArguments) {
        if (argument === "-g")
            hasDebugFlag = true;

        if (argument === "-x")
            hasOutputFlag = true;
    }

    if (!hasDebugFlag)
        compilerArguments.push("-g");

    compilerArguments.push(configuration.sourceFile);

    if (!hasOutputFlag) {
        compilerArguments.push("-x");
        compilerArguments.push(configuration.program);
    }

    return compilerArguments;
}

function mergeEnvironment(customEnvironment) {
    const environment = Object.assign({}, process.env);

    for (const key of Object.keys(customEnvironment || {}))
        environment[key] = String(customEnvironment[key]);

    return environment;
}

function compileProgramBeforeDebug(configuration, diagnosticCollection, outputChannel) {
    return new Promise((resolve, reject) => {
        const compilerArguments = buildCompilerArguments(configuration);
        const launchDescription = [configuration.compilerPath]
            .concat(compilerArguments)
            .join(" ");
        let settled = false;

        outputChannel.appendLine(`Compiling: ${launchDescription}`);

        const compiler = cp.spawn(configuration.compilerPath, compilerArguments, {
            cwd: configuration.cwd,
            env: mergeEnvironment(configuration.env),
            stdio: ["ignore", "pipe", "pipe"]
        });

        let stdoutText = "";
        let stderrText = "";

        compiler.stdout.on("data", (chunk) => {
            stdoutText += chunk.toString("utf8");
        });

        compiler.stderr.on("data", (chunk) => {
            stderrText += chunk.toString("utf8");
        });

        compiler.on("error", (error) => {
            if (settled)
                return;

            settled = true;
            outputChannel.appendLine(`Compiler start failed: ${error.message}`);
            reject(new Error(`Unable to start FreeBASIC compiler: ${error.message}`));
        });

        compiler.on("close", (code) => {
            if (settled)
                return;

            settled = true;
            const compilerOutput = [stdoutText, stderrText]
                .filter((text) => Boolean(text))
                .join("\n")
                .trim();

            if (code !== 0) {
                const diagnosticsByFile = parseCompilerDiagnostics(compilerOutput);

                if (diagnosticsByFile.size > 0)
                    applyCompilerDiagnostics(diagnosticCollection, diagnosticsByFile);

                if (compilerOutput)
                    outputChannel.appendLine(compilerOutput);

                reject(new Error(
                    compilerOutput
                        ? `FreeBASIC compilation failed.\n${compilerOutput}`
                        : `FreeBASIC compilation failed with exit code ${code}.`
                ));
                return;
            }

            if (!fileExists(configuration.program)) {
                outputChannel.appendLine(
                    `Compiler completed but output program was not created: ${configuration.program}`
                );
                reject(new Error(
                    `Compilation completed but '${configuration.program}' was not created.`
                ));
                return;
            }

            outputChannel.appendLine(`Compilation succeeded: ${configuration.program}`);
            resolve();
        });
    });
}

function createDebugAdapterTrackerFactory(diagnosticCollection, outputChannel) {
    return {
        createDebugAdapterTracker(session) {
            if (session.type !== DEBUG_TYPE)
                return undefined;

            return {
                onWillStartSession() {
                    clearDiagnosticsForSource(diagnosticCollection, session.configuration.sourceFile);
                },

                onDidSendMessage(message) {
                    if (!message ||
                        message.type !== "response" ||
                        message.command !== "launch" ||
                        message.success !== false ||
                        !message.message) {
                        return;
                    }

                    const diagnosticsByFile = parseCompilerDiagnostics(message.message);

                    outputChannel.appendLine(message.message);

                    if (diagnosticsByFile.size === 0)
                        return;

                    applyCompilerDiagnostics(diagnosticCollection, diagnosticsByFile);
                }
            };
        }
    };
}

function createDefaultConfiguration(sourceFile) {
    const sourceDirectory = path.dirname(sourceFile);
    const sourceExtension = path.extname(sourceFile);
    const programSuffix = getProgramSuffix();
    const settings = getDebuggerSettings();
    const configuredArch = settings.get("arch", "auto");
    const programPath = path.join(
        sourceDirectory,
        `${path.basename(sourceFile, sourceExtension)}${programSuffix}`
    );

    return {
        name: "Debug Current FreeBASIC File",
        type: DEBUG_TYPE,
        request: "launch",
        sourceFile,
        cwd: sourceDirectory,
        program: programPath,
        arch: configuredArch,
        compilerPath: resolveConfiguredCompilerPath(
            settings.get("compilerPath", ""),
            configuredArch
        ),
        gdbPath: resolveConfiguredGdbPath(settings.get("gdbPath", "")),
        compilerArgs: settings.get("compilerArgs", []),
        args: settings.get("programArgs", []),
        env: {},
        console: normalizeConsoleKind(settings.get("console", "platformDefault")),
        skipBuild: false,
        stopAtEntry: settings.get("stopAtEntry", false)
    };
}

function buildConfigurationSkeleton(configuration) {
    const resolvedConfiguration = Object.assign({}, configuration || {});
    const settings = getDebuggerSettings();

    if (resolvedConfiguration.type !== DEBUG_TYPE)
        resolvedConfiguration.type = DEBUG_TYPE;

    if (!resolvedConfiguration.request)
        resolvedConfiguration.request = "launch";

    if (!resolvedConfiguration.name)
        resolvedConfiguration.name = "Debug Current FreeBASIC File";

    if (!resolvedConfiguration.sourceFile) {
        const activeSourceFile = getActiveSourceFile();

        if (!activeSourceFile)
            throw new Error("The FreeBASIC debugger needs a .bas source file. Set 'sourceFile' or open a .bas file first.");

        resolvedConfiguration.sourceFile = activeSourceFile;
    }

    resolvedConfiguration.arch = resolvedConfiguration.arch || settings.get("arch", "auto");

    if (!Object.prototype.hasOwnProperty.call(resolvedConfiguration, "compilerPath"))
        resolvedConfiguration.compilerPath = settings.get("compilerPath", "");

    if (!Object.prototype.hasOwnProperty.call(resolvedConfiguration, "gdbPath"))
        resolvedConfiguration.gdbPath = settings.get("gdbPath", "");

    if (!Array.isArray(resolvedConfiguration.compilerArgs))
        resolvedConfiguration.compilerArgs = settings.get("compilerArgs", []);

    if (!Array.isArray(resolvedConfiguration.args))
        resolvedConfiguration.args = settings.get("programArgs", []);

    if (!resolvedConfiguration.env)
        resolvedConfiguration.env = {};

    if (!resolvedConfiguration.console)
        resolvedConfiguration.console = settings.get("console", "platformDefault");

    if (typeof resolvedConfiguration.stopAtEntry !== "boolean")
        resolvedConfiguration.stopAtEntry = settings.get("stopAtEntry", false);

    resolvedConfiguration.skipBuild = Boolean(resolvedConfiguration.skipBuild);

    return resolvedConfiguration;
}

function finalizeConfiguration(configuration) {
    const resolvedConfiguration = buildConfigurationSkeleton(configuration);
    const normalizedSourceFile = normalizeExistingPathCase(resolvedConfiguration.sourceFile);
    const sourceDirectory = path.dirname(normalizedSourceFile);
    const sourceExtension = path.extname(normalizedSourceFile).toLowerCase();
    const programSuffix = getProgramSuffix();

    if (!isFreeBasicSourceExtension(sourceExtension))
        throw new Error("The FreeBASIC debugger only accepts .bas or .bi source files.");

    if (!isRunnableSourceFile(normalizedSourceFile)) {
        throw new Error(
            "FreeBASIC debug sessions must start from a .bas source file. .bi include files can be debugged when they are part of the running program, but they are not launch targets."
        );
    }

    resolvedConfiguration.sourceFile = normalizedSourceFile;
    resolvedConfiguration.cwd = normalizeExistingPathCase(
        resolvedConfiguration.cwd || sourceDirectory
    );
    resolvedConfiguration.program = resolvedConfiguration.program || path.join(
        sourceDirectory,
        `${path.basename(normalizedSourceFile, sourceExtension)}${programSuffix}`
    );
    resolvedConfiguration.arch = resolvedConfiguration.arch || "auto";
    resolvedConfiguration.compilerPath = resolveConfiguredCompilerPath(
        resolvedConfiguration.compilerPath,
        resolvedConfiguration.arch
    );
    resolvedConfiguration.gdbPath = resolveConfiguredGdbPath(resolvedConfiguration.gdbPath);
    resolvedConfiguration.compilerArgs = Array.isArray(resolvedConfiguration.compilerArgs)
        ? resolvedConfiguration.compilerArgs
        : [];
    resolvedConfiguration.args = Array.isArray(resolvedConfiguration.args)
        ? resolvedConfiguration.args
        : [];
    resolvedConfiguration.env = resolvedConfiguration.env || {};
    resolvedConfiguration.console = normalizeConsoleKind(resolvedConfiguration.console);
    resolvedConfiguration.stopAtEntry = Boolean(resolvedConfiguration.stopAtEntry);
    resolvedConfiguration.skipBuild = Boolean(resolvedConfiguration.skipBuild);

    return resolvedConfiguration;
}

/* ------------------------------------------------------------------------- */
/* Debug configuration provider                                              */
/* ------------------------------------------------------------------------- */

class FreeBasicConfigurationProvider {
    constructor(diagnosticCollection, outputChannel) {
        this.diagnosticCollection = diagnosticCollection;
        this.outputChannel = outputChannel;
    }

    async resolveDebugConfiguration(_folder, configuration) {
        let resolvedConfiguration = configuration || {};

        /*
            F5 may arrive with an empty debug configuration when the user
            has not created launch.json yet. In that case we synthesize a
            launch request from the active editor so debugging works from
            the first run.
        */
        if (!resolvedConfiguration.type &&
            !resolvedConfiguration.request &&
            !resolvedConfiguration.name) {
            const activeSourceFile = getActiveSourceFile();

            if (!activeSourceFile) {
                vscode.window.showErrorMessage(
                    "Open a .bas file before starting a FreeBASIC debug session."
                );

                return undefined;
            }

            resolvedConfiguration = createDefaultConfiguration(activeSourceFile);
        }

        try {
            resolvedConfiguration = buildConfigurationSkeleton(resolvedConfiguration);
        } catch (error) {
            vscode.window.showErrorMessage(
                error.message || String(error)
            );

            return undefined;
        }

        return resolvedConfiguration;
    }

    async resolveDebugConfigurationWithSubstitutedVariables(_folder, configuration) {
        let resolvedConfiguration;

        try {
            resolvedConfiguration = finalizeConfiguration(configuration);
        } catch (error) {
            vscode.window.showErrorMessage(error.message || String(error));
            return undefined;
        }

        if (!fileExistsOrCommand(resolvedConfiguration.compilerPath)) {
            vscode.window.showErrorMessage(
                "Unable to find the FreeBASIC compiler. Install FreeBASIC, put 'fbc' or 'fbc.exe' on PATH, or set 'freebasic.debugger.compilerPath' or 'compilerPath' to a real compiler executable such as 'C:\\freebasic\\fbc.exe'."
            );

            return undefined;
        }

        if (!fileExistsOrCommand(resolvedConfiguration.gdbPath)) {
            vscode.window.showErrorMessage(
                "Unable to find GDB. Install it with your normal toolchain, put it on PATH, or set 'freebasic.debugger.gdbPath' or 'gdbPath' to the debugger executable."
            );

            return undefined;
        }

        clearDiagnosticsForSource(this.diagnosticCollection, resolvedConfiguration.sourceFile);

        try {
            await compileProgramBeforeDebug(
                resolvedConfiguration,
                this.diagnosticCollection,
                this.outputChannel
            );
        } catch (_error) {
            this.outputChannel.show(true);
            vscode.commands.executeCommand("workbench.actions.view.problems");
            vscode.window.showErrorMessage(
                "FreeBASIC compilation failed. See Problems for the parsed compiler errors."
            );

            return undefined;
        }

        resolvedConfiguration.skipBuild = true;
        return resolvedConfiguration;
    }
}

function fileExistsOrCommand(filePath) {
    if (!filePath)
        return false;

    if (filePath.indexOf(path.sep) === -1 && filePath.indexOf("/") === -1)
        return commandExists(filePath);

    return fileExists(filePath);
}

/* ------------------------------------------------------------------------- */
/* Extension activation                                                      */
/* ------------------------------------------------------------------------- */

function activate(context) {
    const diagnosticCollection = createDiagnosticCollection();
    const outputChannel = createOutputChannel();
    const provider = new FreeBasicConfigurationProvider(diagnosticCollection, outputChannel);
    const trackerFactory = createDebugAdapterTrackerFactory(diagnosticCollection, outputChannel);

    context.subscriptions.push(
        vscode.debug.registerDebugConfigurationProvider(DEBUG_TYPE, provider)
    );

    context.subscriptions.push(
        vscode.debug.registerDebugAdapterTrackerFactory(DEBUG_TYPE, trackerFactory)
    );

    context.subscriptions.push(diagnosticCollection);
    context.subscriptions.push(outputChannel);

    context.subscriptions.push(
        vscode.commands.registerCommand("freebasic.debugCurrentFile", async () => {
            const sourceFile = getActiveSourceFile();

            if (!sourceFile) {
                vscode.window.showErrorMessage(
                    "Open a .bas file before starting a FreeBASIC debug session."
                );

                return;
            }

            const configuration = createDefaultConfiguration(sourceFile);
            clearDiagnosticsForSource(diagnosticCollection, sourceFile);

            await vscode.debug.startDebugging(undefined, configuration);
        })
    );
}

function deactivate() {
    /*
        VS Code owns the extension lifecycle. No explicit teardown is
        required here because the debug adapter runs as a separate process.
    */
}

module.exports = {
    activate,
    deactivate,
    __test: {
        FREEBASIC_SETTINGS_SECTION,
        FREEBASIC_OUTPUT_CHANNEL_NAME,
        fileExists,
        commandExists,
        chooseCompilerPath,
        getBundledGdbCandidates,
        chooseGdbPath,
        resolveConfiguredCompilerPath,
        resolveConfiguredGdbPath,
        getProgramSuffix,
        getDefaultConsoleKind,
        normalizeConsoleKind,
        isFreeBasicSourceExtension,
        isRunnableFreeBasicSourceExtension,
        isRunnableSourceFile,
        normalizeExistingPathCase,
        clearDiagnosticsForSource,
        parseCompilerDiagnostics,
        applyCompilerDiagnostics,
        buildCompilerArguments,
        mergeEnvironment,
        compileProgramBeforeDebug,
        createDefaultConfiguration,
        buildConfigurationSkeleton,
        finalizeConfiguration,
        fileExistsOrCommand,
        FreeBasicConfigurationProvider
    }
};

/* end of extension.js */
