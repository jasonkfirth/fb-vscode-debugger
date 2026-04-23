/*
    Project: FreeBASIC Native Debugger
    ----------------------------------

    File: tests/extension.unit.js

    Purpose:

        Exercise extension helper logic in isolation so compiler
        discovery, diagnostics parsing, and pre-launch build handling
        can be verified without the full VS Code UI.

    Responsibilities:

        - verify compiler and debugger configuration helpers
        - verify FreeBASIC diagnostic parsing
        - verify pre-debug compile success and failure paths
        - verify configuration resolution behavior

    This file intentionally does NOT contain:

        - adapter protocol tests
        - marketplace packaging tests
        - interactive UI tests
*/

"use strict";

const fs = require("fs");
const path = require("path");
const cp = require("child_process");
const {
    assert,
    createFakeSpawnProcess,
    createTemporaryDirectory,
    loadModuleWithVscodeStub,
    withPatchedMethod,
    withTemporaryEnv,
    withTemporaryPlatform,
    assertRejectsWithMessage
} = require("./test_helpers");

const extensionModule = loadModuleWithVscodeStub(path.join(__dirname, "..", "extension.js"));
const vscode = require("./stubs/vscode");
const testApi = extensionModule.__test;

async function testCommandExistsFindsExecutableOnPath() {
    const tempDirectory = createTemporaryDirectory("fb-path-");
    const commandPath = path.join(tempDirectory, "fbc.exe");

    fs.writeFileSync(commandPath, "echo", "utf8");

    withTemporaryPlatform("win32", () => {
        withTemporaryEnv({
            PATH: tempDirectory,
            PATHEXT: ".EXE"
        }, () => {
            assert.strictEqual(testApi.commandExists("fbc"), true);
            assert.strictEqual(testApi.commandExists("missing"), false);
        });
    });
}

async function testChooseCompilerPathPrefersWindowsFbcExe() {
    withTemporaryPlatform("win32", () => {
        withPatchedMethod(fs, "existsSync", (filePath) => /fbc\.exe$/i.test(String(filePath)), () => {
            assert.strictEqual(testApi.chooseCompilerPath("auto"), "C:\\freebasic\\fbc.exe");
            assert.strictEqual(testApi.chooseCompilerPath("x64"), "C:\\freebasic\\fbc.exe");
        });
    });
}

async function testChooseCompilerPathPrefersKnownMacosInstall() {
    withTemporaryPlatform("darwin", () => {
        withPatchedMethod(fs, "existsSync", (filePath) => (
            String(filePath) === "/opt/homebrew/bin/fbc"
        ), () => {
            assert.strictEqual(testApi.chooseCompilerPath("auto"), "/opt/homebrew/bin/fbc");
        });
    });
}

async function testChooseGdbPathPrefersKnownWindowsInstall() {
    withTemporaryPlatform("win32", () => {
        withPatchedMethod(fs, "existsSync", (filePath) => /mingw64\\bin\\gdb\.exe$/i.test(String(filePath)), () => {
            assert.strictEqual(testApi.chooseGdbPath(), "C:\\msys64\\mingw64\\bin\\gdb.exe");
        });
    });
}

async function testGetMacosUnsignedGdbMessageDetectsUnsignedBinary() {
    await withTemporaryPlatform("darwin", async () => {
        await withPatchedMethod(fs, "existsSync", (filePath) => (
            String(filePath) === "/usr/local/bin/gdb"
        ), async () => {
            await withPatchedMethod(cp, "spawnSync", () => ({
                status: 1,
                stdout: "",
                stderr: "/usr/local/bin/gdb: code object is not signed at all\n"
            }), async () => {
                const message = testApi.getMacosUnsignedGdbMessage("/usr/local/bin/gdb");

                assert.match(message, /not codesigned/i);
                assert.match(message, /freebasic\.debugger\.gdbPath/);
            });
        });
    });
}

async function testChooseLldbDapPathPrefersKnownMacosInstall() {
    await withTemporaryPlatform("darwin", async () => {
        await withPatchedMethod(fs, "existsSync", (filePath) => (
            String(filePath) === "/Library/Developer/CommandLineTools/usr/bin/lldb-dap"
        ), async () => {
            assert.strictEqual(
                testApi.chooseLldbDapPath(),
                "/Library/Developer/CommandLineTools/usr/bin/lldb-dap"
            );
        });
    });
}

async function testChooseDebugserverPathPrefersKnownMacosInstall() {
    await withTemporaryPlatform("darwin", async () => {
        await withPatchedMethod(fs, "existsSync", (filePath) => (
            String(filePath) === "/Applications/Xcode.app/Contents/SharedFrameworks/LLDB.framework/Versions/A/Resources/debugserver"
        ), async () => {
            assert.strictEqual(
                testApi.chooseDebugserverPath(),
                "/Applications/Xcode.app/Contents/SharedFrameworks/LLDB.framework/Versions/A/Resources/debugserver"
            );
        });
    });
}

async function testCreateDefaultConfigurationUsesSettingsAndPlatformSuffix() {
    vscode.__reset();
    vscode.__state.settings["freebasic.debugger"] = {
        compilerPath: "",
        gdbPath: "",
        arch: "x64",
        compilerArgs: ["-w", "pedantic"],
        programArgs: ["demo"],
        console: "platformDefault",
        stopAtEntry: true
    };

    withTemporaryPlatform("win32", () => {
        withPatchedMethod(fs, "existsSync", (filePath) => /fbc\.exe$/i.test(String(filePath)), () => {
            const configuration = testApi.createDefaultConfiguration("C:\\games\\demo.bas");

            assert.strictEqual(configuration.arch, "x64");
            assert.strictEqual(configuration.program, "C:\\games\\demo.exe");
            assert.strictEqual(configuration.compilerPath, "C:\\freebasic\\fbc.exe");
            assert.deepStrictEqual(configuration.compilerArgs, ["-w", "pedantic"]);
            assert.deepStrictEqual(configuration.args, ["demo"]);
            assert.strictEqual(configuration.console, "externalTerminal");
            assert.strictEqual(configuration.stopAtEntry, true);
        });
    });
}

async function testConsoleHelpersChooseExpectedDefaults() {
    assert.strictEqual(testApi.getDefaultConsoleKind("win32"), "externalTerminal");
    assert.strictEqual(testApi.getDefaultConsoleKind("linux"), "integratedTerminal");
    assert.strictEqual(testApi.normalizeConsoleKind("platformDefault", "darwin"), "integratedTerminal");
    assert.strictEqual(testApi.normalizeConsoleKind("internalConsole", "win32"), "internalConsole");
}

async function testBuildConfigurationSkeletonKeepsVariableBasedSourceFile() {
    vscode.__reset();
    vscode.__state.settings["freebasic.debugger"] = {
        compilerPath: "",
        gdbPath: "",
        arch: "x64",
        compilerArgs: ["-w", "all"],
        programArgs: ["demo"],
        stopAtEntry: true
    };

    const configuration = testApi.buildConfigurationSkeleton({
        type: "freebasic-gdb",
        request: "launch",
        sourceFile: "${file}"
    });

    assert.strictEqual(configuration.sourceFile, "${file}");
    assert.strictEqual(configuration.arch, "x64");
    assert.deepStrictEqual(configuration.compilerArgs, ["-w", "all"]);
    assert.deepStrictEqual(configuration.args, ["demo"]);
    assert.strictEqual(configuration.stopAtEntry, true);
}

async function testFinalizeConfigurationRejectsBiLaunchTarget() {
    await assertRejectsWithMessage(
        async () => testApi.finalizeConfiguration({
            type: "freebasic-gdb",
            request: "launch",
            sourceFile: "C:\\proj\\demo.bi"
        }),
        /\.bi include files/
    );
}

async function testParseCompilerDiagnosticsGroupsMessagesByFile() {
    const diagnosticsByFile = testApi.parseCompilerDiagnostics([
        "c:\\proj\\imk.bas(133) error 42: Variable not declared, FLAG1",
        "in 'IF k = \"6\" THEN WALKF1: FLAG1 = 1: GOSUB CHECK1'",
        "c:\\proj\\imk.bas(143) error 133: Too many errors, exiting"
    ].join("\n"));

    const diagnostics = diagnosticsByFile.get("c:\\proj\\imk.bas");

    assert.strictEqual(diagnostics.length, 2);
    assert.strictEqual(diagnostics[0].code, "42");
    assert.match(diagnostics[0].message, /Variable not declared/);
    assert.match(diagnostics[0].message, /in 'IF k = "6"/);
    assert.strictEqual(diagnostics[1].code, "133");
}

async function testBuildCompilerArgumentsAddsDebugAndOutput() {
    const argumentsList = testApi.buildCompilerArguments({
        compilerArgs: ["-w", "all"],
        sourceFile: "demo.bas",
        program: "demo.exe"
    });

    assert.deepStrictEqual(argumentsList, ["-w", "all", "-g", "demo.bas", "-x", "demo.exe"]);
}

async function testCompileProgramBeforeDebugSuccessWritesOutput() {
    const diagnosticCollection = vscode.languages.createDiagnosticCollection("freebasic");
    const outputChannel = vscode.window.createOutputChannel("test");
    const tempDirectory = createTemporaryDirectory("fb-compile-");
    const programPath = path.join(tempDirectory, "demo.exe");

    withPatchedMethod(cp, "spawn", () => createFakeSpawnProcess({
        start(child) {
            fs.writeFileSync(programPath, "binary", "utf8");
            child.emit("exit", 0);
        }
    }), async () => {
        await testApi.compileProgramBeforeDebug({
            compilerPath: "fbc",
            compilerArgs: [],
            sourceFile: path.join(tempDirectory, "demo.bas"),
            program: programPath,
            cwd: tempDirectory,
            env: {}
        }, diagnosticCollection, outputChannel);
    });

    await new Promise((resolve) => setImmediate(resolve));
    assert.match(outputChannel.lines.join("\n"), /Compilation succeeded/);
}

async function testCompileProgramBeforeDebugFailurePublishesDiagnostics() {
    vscode.__reset();
    const diagnosticCollection = vscode.languages.createDiagnosticCollection("freebasic");
    const outputChannel = vscode.window.createOutputChannel("test");

    await withPatchedMethod(cp, "spawn", () => createFakeSpawnProcess({
        start(child) {
            child.stderr.emit("data", Buffer.from(
                "c:\\proj\\demo.bas(10) error 42: Variable not declared, value\n"
            ));
            child.emit("exit", 1);
        }
    }), async () => {
        await assertRejectsWithMessage(
            () => testApi.compileProgramBeforeDebug({
                compilerPath: "fbc",
                compilerArgs: [],
                sourceFile: "c:\\proj\\demo.bas",
                program: "c:\\proj\\demo.exe",
                cwd: "c:\\proj",
                env: {}
            }, diagnosticCollection, outputChannel),
            /FreeBASIC compilation failed/
        );
    });

    assert.strictEqual(diagnosticCollection.name, "freebasic");
}

async function testProviderStopsDebuggingOnCompileFailure() {
    vscode.__reset();
    const diagnosticCollection = vscode.languages.createDiagnosticCollection("freebasic");
    const outputChannel = vscode.window.createOutputChannel("test");
    const provider = new testApi.FreeBasicConfigurationProvider(diagnosticCollection, outputChannel);

    await withTemporaryPlatform("win32", async () => {
        withPatchedMethod(fs, "existsSync", (filePath) => {
            const normalized = String(filePath).toLowerCase();

            return normalized.indexOf("fbc.exe") !== -1 || normalized.indexOf("gdb.exe") !== -1;
        }, async () => {
            await withPatchedMethod(cp, "spawn", () => createFakeSpawnProcess({
                start(child) {
                    child.stderr.emit("data", Buffer.from(
                        "c:\\proj\\demo.bas(10) error 42: Variable not declared, value\n"
                    ));
                    child.emit("exit", 1);
                }
            }), async () => {
                const preSubstitutionConfiguration = await provider.resolveDebugConfiguration(undefined, {
                    type: "freebasic-gdb",
                    request: "launch",
                    sourceFile: "${file}",
                    cwd: "${fileDirname}",
                    program: "${fileDirname}\\demo.exe",
                    compilerPath: "C:\\freebasic\\fbc.exe",
                    gdbPath: "C:\\msys64\\mingw64\\bin\\gdb.exe"
                });
                const result = await provider.resolveDebugConfigurationWithSubstitutedVariables(
                    undefined,
                    Object.assign({}, preSubstitutionConfiguration, {
                        sourceFile: "c:\\proj\\demo.bas",
                        cwd: "c:\\proj",
                        program: "c:\\proj\\demo.exe"
                    })
                );

                assert.strictEqual(result, undefined);
            });
        });
    });
}

async function testSelectMacosDebuggerFallbackUsesRunOnlyEvenWhenLldbToolsExist() {
    await withTemporaryPlatform("darwin", async () => {
        await withPatchedMethod(fs, "existsSync", (filePath) => {
            const normalized = String(filePath);

            return normalized === "/usr/local/bin/gdb" ||
                normalized === "/Library/Developer/CommandLineTools/usr/bin/lldb-dap" ||
                normalized === "/Applications/Xcode.app/Contents/SharedFrameworks/LLDB.framework/Versions/A/Resources/debugserver";
        }, async () => {
            await withPatchedMethod(cp, "spawnSync", (command, args) => {
                if (command === "codesign") {
                    return {
                        status: 1,
                        stdout: "",
                        stderr: "/usr/local/bin/gdb: code object is not signed at all\n"
                    };
                }

                assert.fail(`Unexpected spawnSync command: ${command} ${args.join(" ")}`);
            }, async () => {
                const result = testApi.selectMacosDebuggerFallback("/usr/local/bin/gdb");

                assert.strictEqual(result.kind, "run-only");
                assert.match(result.message, /reduced-functionality session/i);
            });
        });
    });
}

async function testSelectMacosDebuggerFallbackUsesRunOnlyWhenDebugserverMissing() {
    await withTemporaryPlatform("darwin", async () => {
        await withPatchedMethod(fs, "existsSync", (filePath) => {
            const normalized = String(filePath);

            return normalized === "/usr/local/bin/gdb" ||
                normalized === "/Library/Developer/CommandLineTools/usr/bin/lldb-dap";
        }, async () => {
            await withPatchedMethod(cp, "spawnSync", (command, args) => {
                if (command === "codesign") {
                    return {
                        status: 1,
                        stdout: "",
                        stderr: "/usr/local/bin/gdb: code object is not signed at all\n"
                    };
                }

                if (command === "xcrun" && args[0] === "--find" && args[1] === "lldb-dap") {
                    return {
                        status: 1,
                        stdout: "",
                        stderr: "not found\n"
                    };
                }

                if (command === "xcrun" && args[0] === "--find" && args[1] === "debugserver") {
                    return {
                        status: 1,
                        stdout: "",
                        stderr: "not found\n"
                    };
                }

                assert.fail(`Unexpected spawnSync command: ${command} ${args.join(" ")}`);
            }, async () => {
                const result = testApi.selectMacosDebuggerFallback("/usr/local/bin/gdb");

                assert.strictEqual(result.kind, "run-only");
                assert.match(result.message, /reduced-functionality session/i);
            });
        });
    });
}

async function testGetMissingGdbFallbackMessageExplainsRunOnlyMode() {
    const message = testApi.getMissingGdbFallbackMessage("gdb");

    assert.match(message, /Unable to find GDB/i);
    assert.match(message, /still launch when you press F5/i);
    assert.match(message, /breakpoints, stepping, watches, and pause/i);
}

async function testProviderFallsBackToRunOnlyWhenGdbMissingOnLinux() {
    vscode.__reset();
    const diagnosticCollection = vscode.languages.createDiagnosticCollection("freebasic");
    const outputChannel = vscode.window.createOutputChannel("test");
    const provider = new testApi.FreeBasicConfigurationProvider(diagnosticCollection, outputChannel);

    await withTemporaryPlatform("linux", async () => {
        await withPatchedMethod(fs, "existsSync", (filePath) => (
            String(filePath) === "/usr/bin/fbc" || String(filePath) === "/work/demo"
        ), async () => {
            await withPatchedMethod(cp, "spawn", () => createFakeSpawnProcess({
                start(child) {
                    child.emit("exit", 0);
                }
            }), async () => {
                const result = await provider.resolveDebugConfigurationWithSubstitutedVariables(
                    undefined,
                    {
                        type: "freebasic-gdb",
                        request: "launch",
                        sourceFile: "/work/demo.bas",
                        cwd: "/work",
                        program: "/work/demo",
                        compilerPath: "/usr/bin/fbc",
                        gdbPath: "/missing/gdb"
                    }
                );

                assert.strictEqual(result.runWithoutDebugger, true);
                assert.match(result.runWithoutDebuggerMessage, /Unable to find GDB/i);
                assert.strictEqual(result.skipBuild, true);
                assert.match(vscode.__state.messages.join("\n"), /still launch when you press F5/i);
            });
        });
    });
}

async function testProviderFallsBackToRunOnlyWhenGdbMissingOnWindows() {
    vscode.__reset();
    const diagnosticCollection = vscode.languages.createDiagnosticCollection("freebasic");
    const outputChannel = vscode.window.createOutputChannel("test");
    const provider = new testApi.FreeBasicConfigurationProvider(diagnosticCollection, outputChannel);

    await withTemporaryPlatform("win32", async () => {
        await withPatchedMethod(fs, "existsSync", (filePath) => {
            const normalized = String(filePath).toLowerCase();

            return normalized === "c:/freebasic/fbc.exe" || normalized === "c:/proj/demo.exe";
        }, async () => {
            await withPatchedMethod(cp, "spawn", () => createFakeSpawnProcess({
                start(child) {
                    child.emit("exit", 0);
                }
            }), async () => {
                const result = await provider.resolveDebugConfigurationWithSubstitutedVariables(
                    undefined,
                    {
                        type: "freebasic-gdb",
                        request: "launch",
                        sourceFile: "C:/proj/demo.bas",
                        cwd: "C:/proj",
                        program: "C:/proj/demo.exe",
                        compilerPath: "C:/freebasic/fbc.exe",
                        gdbPath: "C:/missing/gdb.exe"
                    }
                );

                assert.strictEqual(result.runWithoutDebugger, true);
                assert.match(result.runWithoutDebuggerMessage, /Unable to find GDB/i);
                assert.strictEqual(result.skipBuild, true);
                assert.match(vscode.__state.messages.join("\n"), /still launch when you press F5/i);
            });
        });
    });
}

module.exports = [
    testCommandExistsFindsExecutableOnPath,
    testChooseCompilerPathPrefersWindowsFbcExe,
    testChooseCompilerPathPrefersKnownMacosInstall,
    testChooseGdbPathPrefersKnownWindowsInstall,
    testGetMacosUnsignedGdbMessageDetectsUnsignedBinary,
    testChooseLldbDapPathPrefersKnownMacosInstall,
    testChooseDebugserverPathPrefersKnownMacosInstall,
    testCreateDefaultConfigurationUsesSettingsAndPlatformSuffix,
    testConsoleHelpersChooseExpectedDefaults,
    testBuildConfigurationSkeletonKeepsVariableBasedSourceFile,
    testFinalizeConfigurationRejectsBiLaunchTarget,
    testParseCompilerDiagnosticsGroupsMessagesByFile,
    testBuildCompilerArgumentsAddsDebugAndOutput,
    testCompileProgramBeforeDebugSuccessWritesOutput,
    testCompileProgramBeforeDebugFailurePublishesDiagnostics,
    testProviderStopsDebuggingOnCompileFailure,
    testSelectMacosDebuggerFallbackUsesRunOnlyEvenWhenLldbToolsExist,
    testSelectMacosDebuggerFallbackUsesRunOnlyWhenDebugserverMissing,
    testGetMissingGdbFallbackMessageExplainsRunOnlyMode,
    testProviderFallsBackToRunOnlyWhenGdbMissingOnLinux,
    testProviderFallsBackToRunOnlyWhenGdbMissingOnWindows
];

/* end of tests/extension.unit.js */
