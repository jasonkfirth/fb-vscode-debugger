/*
    Project: FreeBASIC Native Debugger
    ----------------------------------

    File: tests/adapter.unit.js

    Purpose:

        Exercise adapter-side helper logic so DAP framing, MI parsing,
        tool discovery, and compiler invocation behavior can be verified
        without launching the full editor.

    Responsibilities:

        - verify MI parsing helpers
        - verify DAP transport framing
        - verify compiler and debugger resolution helpers
        - verify compiler invocation and ready-prompt handling

    This file intentionally does NOT contain:

        - extension host tests
        - UI interaction tests
        - Marketplace packaging tests
*/

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const cp = require("child_process");
const stream = require("stream");
const {
    assert,
    createFakeSpawnProcess,
    createTemporaryDirectory,
    withPatchedMethod,
    withTemporaryPlatform,
    assertRejectsWithMessage
} = require("./test_helpers");

const adapterModule = require(path.join(__dirname, "..", "adapter", "freebasicGdbDebug.js"));
const testApi = adapterModule.__test;

async function testMiValueParserParsesTupleAndListValues() {
    const parser = new testApi.MiValueParser("name=\"demo\",stack=[frame={level=\"0\",func=\"main\"}]", 0);
    const result = parser.parseResultList();

    assert.strictEqual(result.name, "demo");
    assert.strictEqual(result.stack[0].frame.func, "main");
}

async function testParseMiLineHandlesResultAndConsoleRecords() {
    const resultRecord = testApi.parseMiLine("12^done,value=\"42\"");
    const consoleRecord = testApi.parseMiLine("~\"hello\\n\"");

    assert.strictEqual(resultRecord.token, "12");
    assert.strictEqual(resultRecord.className, "done");
    assert.strictEqual(resultRecord.payload.value, "42");
    assert.strictEqual(consoleRecord.type, "~");
    assert.strictEqual(consoleRecord.payload, "hello\n");
}

async function testDapConnectionReadsAndWritesMessages() {
    const input = new stream.PassThrough();
    const output = new stream.PassThrough();
    const connection = new testApi.DapConnection(input, output);
    const messages = [];
    const requestText = "{\"seq\":2,\"type\":\"request\",\"command\":\"threads\"}";

    connection.start((message) => messages.push(message));
    connection.send({ seq: 1, type: "event", event: "test" });

    input.write(`Content-Length: ${Buffer.byteLength(requestText, "utf8")}\r\n\r\n`);
    input.write(requestText);

    await new Promise((resolve) => setTimeout(resolve, 10));

    assert.strictEqual(messages.length, 1);
    assert.strictEqual(messages[0].command, "threads");

    const writtenText = output.read().toString("utf8");

    assert.match(writtenText, /Content-Length:/);
    assert.match(writtenText, /"event":"test"/);
}

async function testResolveCompilerPathPrefersWindowsFbcExe() {
    withTemporaryPlatform("win32", () => {
        withPatchedMethod(fs, "existsSync", (filePath) => /fbc\.exe$/i.test(String(filePath)), () => {
            assert.strictEqual(testApi.resolveCompilerPath("fbc64.exe"), "C:\\freebasic\\fbc.exe");
            assert.strictEqual(testApi.resolveCompilerPath("fbc"), "C:\\freebasic\\fbc.exe");
        });
    });
}

async function testResolveCompilerPathPrefersKnownMacosInstall() {
    withTemporaryPlatform("darwin", () => {
        withPatchedMethod(fs, "existsSync", (filePath) => (
            String(filePath) === "/opt/homebrew/bin/fbc"
        ), () => {
            assert.strictEqual(testApi.resolveCompilerPath("fbc"), "/opt/homebrew/bin/fbc");
            assert.strictEqual(testApi.resolveCompilerPath(""), "/opt/homebrew/bin/fbc");
        });
    });
}

async function testResolveGdbPathFindsKnownWindowsInstall() {
    withTemporaryPlatform("win32", () => {
        withPatchedMethod(fs, "existsSync", (filePath) => /mingw64\\bin\\gdb\.exe$/i.test(String(filePath)), () => {
            assert.strictEqual(testApi.resolveGdbPath("gdb"), "C:\\msys64\\mingw64\\bin\\gdb.exe");
        });
    });
}

async function testNormalizeHelpersProduceExpectedShapes() {
    assert.deepStrictEqual(testApi.normalizeMiArray(undefined), []);
    assert.deepStrictEqual(testApi.normalizeMiArray("value"), ["value"]);
    assert.strictEqual(testApi.toGdbPath("C:\\proj\\demo.bas"), "C:/proj/demo.bas");
    assert.strictEqual(testApi.normalizeSourcePath("C:\\proj\\demo.bas"), "C:/proj/demo.bas");
}

async function testBuildCompilerArgumentsAddsDebugAndOutput() {
    const argumentsList = testApi.buildCompilerArguments({
        compilerArgs: ["-lang", "fb"],
        sourceFile: "demo.bas",
        program: "demo.exe"
    });

    assert.deepStrictEqual(argumentsList, ["-lang", "fb", "-g", "demo.bas", "-x", "demo.exe"]);
}

async function testConsoleHelpersChooseExpectedDefaults() {
    assert.strictEqual(testApi.getDefaultConsoleKind("win32"), "externalTerminal");
    assert.strictEqual(testApi.getDefaultConsoleKind("linux"), "integratedTerminal");
    assert.strictEqual(
        testApi.normalizeConsoleKind("platformDefault", "darwin"),
        "integratedTerminal"
    );
    assert.strictEqual(
        testApi.normalizeConsoleKind("externalTerminal", "linux"),
        "externalTerminal"
    );
}

async function testCompileProgramSucceedsWithMockCompiler() {
    const tempDirectory = createTemporaryDirectory("fb-adapter-");
    const outputProgram = path.join(tempDirectory, "demo.exe");
    const originalExistsSync = fs.existsSync;

    await withPatchedMethod(fs, "existsSync", (filePath) => {
        if (String(filePath) === outputProgram)
            return true;

        return originalExistsSync.call(fs, filePath);
    }, async () => {
        await withPatchedMethod(cp, "spawn", () => createFakeSpawnProcess({
            start(child) {
                fs.writeFileSync(outputProgram, "binary", "utf8");
                child.emit("exit", 0);
            }
        }), async () => {
            await testApi.compileProgram({
                compilerPath: "fbc",
                compilerArgs: [],
                sourceFile: path.join(tempDirectory, "demo.bas"),
                program: outputProgram,
                cwd: tempDirectory,
                env: {}
            });
        });
    });
}

async function testCompileProgramRejectsWithCompilerOutput() {
    await withPatchedMethod(cp, "spawn", () => createFakeSpawnProcess({
        start(child) {
            child.stderr.emit("data", Buffer.from("demo.bas(10) error 42: broken\n"));
            child.emit("exit", 1);
        }
    }), async () => {
        await assertRejectsWithMessage(
            () => testApi.compileProgram({
                compilerPath: "fbc",
                compilerArgs: [],
                sourceFile: "demo.bas",
                program: "demo.exe",
                cwd: process.cwd(),
                env: {}
            }),
            /error 42: broken/
        );
    });
}

async function testGdbSessionStartWaitsForPromptAndSendsSetupCommands() {
    const outputs = [];
    const adapter = {
        sendOutput(category, output) {
            outputs.push({ category, output });
        },
        onTargetRunning() {},
        onTargetStopped() {},
        onDebuggerExit() {}
    };
    const session = new testApi.GdbSession(adapter);

    await withPatchedMethod(cp, "spawn", () => createFakeSpawnProcess({
        start(child) {
            setTimeout(() => {
                child.stdout.emit("data", Buffer.from("(gdb)\n"));
            }, 5);
        },
        onStdinWrite(text, child) {
            const tokenMatch = /^(\d+)/.exec(text);

            if (tokenMatch) {
                child.stdout.emit("data", Buffer.from(`${tokenMatch[1]}^done\n`));
                child.stdout.emit("data", Buffer.from("(gdb)\n"));
            }
        }
    }), async () => {
        await session.start({
            gdbPath: "gdb",
            program: "demo.exe",
            cwd: process.cwd(),
            env: {},
            args: ["one", "two"]
        });
    });

    const writes = session.process.__stdinWrites.join("");

    assert.match(writes, /-gdb-set breakpoint pending on/);
    assert.match(writes, /-environment-cd/);
    assert.match(writes, /-exec-arguments/);
    assert.strictEqual(outputs.length, 0);
}

async function testMapStopReasonAndExpandableValueHelpers() {
    assert.strictEqual(testApi.mapStopReason("breakpoint-hit"), "breakpoint");
    assert.strictEqual(testApi.mapStopReason("signal-received"), "exception");
    assert.strictEqual(testApi.mapStopReason("unknown"), "pause");
    assert.strictEqual(testApi.isTargetExitReason("exited-normally"), true);
    assert.strictEqual(testApi.isTargetExitReason("breakpoint-hit"), false);
    assert.strictEqual(testApi.extractExitCode({ "exit-code": "17" }), 17);
    assert.strictEqual(testApi.extractExitCode({}), 0);
    assert.strictEqual(testApi.shouldTryExpandValue("{demo}"), true);
    assert.strictEqual(testApi.shouldTryExpandValue("plain"), false);
}

async function testGetMacosGdbSetupHintRecognizesTaskgatedFailure() {
    await withTemporaryPlatform("darwin", async () => {
        const hint = testApi.getMacosGdbSetupHint(
            "Unable to find Mach task port for process-id 12676: (os/kern) failure (0x5). (please check gdb is codesigned - see taskgated(8))",
            "/usr/local/bin/gdb"
        );

        assert.match(hint, /macOS blocked GDB/i);
        assert.match(hint, /Codesign '\/usr\/local\/bin\/gdb'/);
    });
}

async function testShouldUseTerminalForRunOnlyLaunchDetectsGuiSubsystem() {
    assert.strictEqual(
        testApi.shouldUseTerminalForRunOnlyLaunch({
            compilerArgs: ["-s", "gui"]
        }),
        false
    );
    assert.strictEqual(
        testApi.shouldUseTerminalForRunOnlyLaunch({
            compilerArgs: ["-sgui"]
        }),
        false
    );
    assert.strictEqual(
        testApi.shouldUseTerminalForRunOnlyLaunch({
            compilerArgs: []
        }),
        true
    );
}

async function testLaunchResponseIsSentBeforeConfigurationDone() {
    const sentMessages = [];
    const connection = {
        send(message) {
            sentMessages.push(message);
        },
        start() {}
    };
    const adapter = new testApi.FreeBasicGdbAdapter(connection);
    const startCalls = [];
    const gdbCommands = [];

    await withPatchedMethod(
        testApi.GdbSession.prototype,
        "start",
        async function patchedStart(args) {
            startCalls.push(args);
        },
        async () => {
            await withPatchedMethod(
                testApi.GdbSession.prototype,
                "sendCommand",
                async function patchedSendCommand(command) {
                    gdbCommands.push(command);
                    return { payload: {} };
                },
                async () => {
                    await withPatchedMethod(
                        testApi.FreeBasicGdbAdapter.prototype,
                        "prepareInferiorPresentation",
                        async () => {},
                        async () => {
                            await adapter.launchRequest({
                                seq: 10,
                                command: "launch"
                            }, {
                                sourceFile: "demo.bas",
                                program: "demo.exe",
                                cwd: process.cwd(),
                                compilerPath: "fbc",
                                gdbPath: "gdb",
                                args: [],
                                env: {},
                                skipBuild: true,
                                stopAtEntry: false
                            });

                            assert.strictEqual(startCalls.length, 1);
                            assert.strictEqual(
                                sentMessages.some((message) => (
                                    message.type === "response" &&
                                    message.command === "launch"
                                )),
                                true
                            );
                            assert.strictEqual(
                                sentMessages.some((message) => (
                                    message.type === "event" &&
                                    message.event === "initialized"
                                )),
                                true
                            );

                            await adapter.configurationDoneRequest({
                                seq: 11,
                                command: "configurationDone"
                            });
                        }
                    );
                }
            );
        }
    );

    assert.strictEqual(gdbCommands[0], "-exec-run");
    assert.strictEqual(
        sentMessages.some((message) => (
            message.type === "response" &&
            message.command === "configurationDone"
        )),
        true
    );
}

async function testRunOnlyFallbackSkipsGdbStartup() {
    const sentMessages = [];
    const connection = {
        send(message) {
            sentMessages.push(message);
        },
        start() {}
    };
    const adapter = new testApi.FreeBasicGdbAdapter(connection);
    let startedGdb = false;

    await withPatchedMethod(
        testApi.GdbSession.prototype,
        "start",
        async function patchedStart() {
            startedGdb = true;
        },
        async () => {
            await withTemporaryPlatform("linux", async () => {
                await adapter.launchRequest({
                    seq: 10,
                    command: "launch"
                }, {
                    sourceFile: "demo.bas",
                    program: "demo",
                    cwd: process.cwd(),
                    compilerPath: "fbc",
                    gdbPath: "/missing/gdb",
                    args: [],
                    env: {},
                    skipBuild: true,
                    stopAtEntry: false,
                    runWithoutDebugger: true,
                    runWithoutDebuggerMessage: "Unable to find GDB at '/missing/gdb'. The program will still launch when you press F5."
                });
            });
        }
    );

    assert.strictEqual(startedGdb, false);
    assert.strictEqual(adapter.runWithoutDebugger, true);
    assert.strictEqual(
        sentMessages.some((message) => (
            message.type === "response" &&
            message.command === "launch"
        )),
        true
    );
    assert.match(
        sentMessages
            .filter((message) => message.type === "event" && message.event === "output")
            .map((message) => message.body.output)
            .join(""),
        /still launch when you press F5/i
    );
}

async function testRunOnlyFallbackConfigurationDoneUsesRunInTerminal() {
    const sentMessages = [];
    const connection = {
        send(message) {
            sentMessages.push(message);
        },
        start() {}
    };
    const adapter = new testApi.FreeBasicGdbAdapter(connection);
    const tempDirectory = createTemporaryDirectory("fb-run-fallback-");
    const originalNow = Date.now;
    const originalRandom = Math.random;
    const originalExistsSync = fs.existsSync;
    const originalReadFileSync = fs.readFileSync;
    const clientRequests = [];

    adapter.clientSupportsRunInTerminal = true;
    adapter.runWithoutDebugger = true;
    adapter.launchArguments = {
        cwd: tempDirectory,
        console: "integratedTerminal",
        program: "/tmp/demo",
        args: ["one", "two"],
        env: {
            DEMO: "1"
        }
    };

    Date.now = () => 2000;
    Math.random = () => 0;

    try {
        await withTemporaryPlatform("darwin", async () => {
            await withPatchedMethod(os, "tmpdir", () => tempDirectory, async () => {
                await withPatchedMethod(fs, "existsSync", (filePath) => {
                    if (String(filePath).indexOf("freebasic-debugger-run-exit-") !== -1)
                        return true;

                    return originalExistsSync.call(fs, filePath);
                }, async () => {
                    await withPatchedMethod(fs, "readFileSync", (filePath, encoding) => {
                        if (String(filePath).indexOf("freebasic-debugger-run-exit-") !== -1)
                            return "0\n";

                        return originalReadFileSync.call(fs, filePath, encoding);
                    }, async () => {
                        adapter.sendClientRequest = async (command, args) => {
                            clientRequests.push({ command, args });
                            return {};
                        };

                        await adapter.configurationDoneRequest({
                            seq: 11,
                            command: "configurationDone"
                        });

                        await new Promise((resolve) => setImmediate(resolve));
                    });
                });
            });
        });
    } finally {
        Date.now = originalNow;
        Math.random = originalRandom;
    }

    assert.strictEqual(clientRequests.length, 1);
    assert.strictEqual(clientRequests[0].command, "runInTerminal");
    assert.strictEqual(clientRequests[0].args.kind, "integrated");
    assert.strictEqual(clientRequests[0].args.env.DEMO, "1");
    assert.match(clientRequests[0].args.args[2], /'\/tmp\/demo'/);
    assert.match(clientRequests[0].args.args[2], /'one' 'two'/);
    assert.strictEqual(
        sentMessages.some((message) => (
            message.type === "response" &&
            message.command === "configurationDone"
        )),
        true
    );
    assert.strictEqual(
        sentMessages.some((message) => (
            message.type === "event" &&
            message.event === "terminated"
        )),
        true
    );
}

async function testRunOnlyFallbackWindowedProgramSkipsRunInTerminal() {
    const sentMessages = [];
    const connection = {
        send(message) {
            sentMessages.push(message);
        },
        start() {}
    };
    const adapter = new testApi.FreeBasicGdbAdapter(connection);
    let runInTerminalUsed = false;

    adapter.clientSupportsRunInTerminal = true;
    adapter.runWithoutDebugger = true;
    adapter.launchArguments = {
        cwd: process.cwd(),
        console: "integratedTerminal",
        program: "/tmp/demo-window",
        args: [],
        compilerArgs: ["-s", "gui"],
        env: {}
    };

    await withPatchedMethod(cp, "spawn", () => createFakeSpawnProcess({
        start(child) {
            child.emit("exit", 0);
        }
    }), async () => {
        adapter.sendClientRequest = async () => {
            runInTerminalUsed = true;
            return {};
        };

        await adapter.configurationDoneRequest({
            seq: 12,
            command: "configurationDone"
        });

        await new Promise((resolve) => setImmediate(resolve));
    });

    assert.strictEqual(runInTerminalUsed, false);
    assert.match(
        sentMessages
            .filter((message) => message.type === "event" && message.event === "output")
            .map((message) => message.body.output)
            .join(""),
        /windowed program directly/i
    );
}

async function testPrepareInferiorPresentationUsesRunInTerminalOnUnix() {
    const connection = {
        send() {},
        start() {}
    };
    const adapter = new testApi.FreeBasicGdbAdapter(connection);
    const tempDirectory = createTemporaryDirectory("fb-terminal-");
    const originalNow = Date.now;
    const originalRandom = Math.random;
    const originalExistsSync = fs.existsSync;
    const originalReadFileSync = fs.readFileSync;
    const sentCommands = [];
    const clientRequests = [];

    adapter.clientSupportsRunInTerminal = true;
    adapter.gdb = {
        sendCommand: async (command) => {
            sentCommands.push(command);
            return { payload: {} };
        }
    };

    Date.now = () => 1000;
    Math.random = () => 0;

    try {
        await withTemporaryPlatform("linux", async () => {
            await withPatchedMethod(os, "tmpdir", () => tempDirectory, async () => {
                await withPatchedMethod(fs, "existsSync", (filePath) => {
                    if (String(filePath).indexOf("freebasic-debugger-tty-") !== -1)
                        return true;

                    return originalExistsSync.call(fs, filePath);
                }, async () => {
                    await withPatchedMethod(fs, "readFileSync", (filePath, encoding) => {
                        if (String(filePath).indexOf("freebasic-debugger-tty-") !== -1)
                            return "/dev/pts/7\n";

                        return originalReadFileSync.call(fs, filePath, encoding);
                    }, async () => {
                        adapter.sendClientRequest = async (command, args) => {
                            clientRequests.push({ command, args });
                            return {};
                        };

                        await adapter.prepareInferiorPresentation({
                            cwd: tempDirectory,
                            console: "integratedTerminal"
                        });
                    });
                });
            });
        });
    } finally {
        Date.now = originalNow;
        Math.random = originalRandom;
    }

    assert.strictEqual(clientRequests.length, 1);
    assert.strictEqual(clientRequests[0].command, "runInTerminal");
    assert.strictEqual(clientRequests[0].args.kind, "integrated");
    assert.deepStrictEqual(clientRequests[0].args.args.slice(0, 2), ["/bin/sh", "-c"]);
    assert.strictEqual(sentCommands[0], "-inferior-tty-set \"/dev/pts/7\"");
    assert.strictEqual(adapter.inferiorTerminalSession.ttyPath, "/dev/pts/7");
}

async function testPrepareInferiorPresentationUsesNewConsoleOnWindows() {
    const connection = {
        send() {},
        start() {}
    };
    const adapter = new testApi.FreeBasicGdbAdapter(connection);
    const sentCommands = [];

    adapter.gdb = {
        sendCommand: async (command) => {
            sentCommands.push(command);
            return { payload: {} };
        }
    };

    await withTemporaryPlatform("win32", async () => {
        await adapter.prepareInferiorPresentation({
            console: "externalTerminal"
        });
    });

    assert.deepStrictEqual(sentCommands, ["-gdb-set new-console on"]);
}

async function testGdbSessionRejectsPendingCommandsWhenDebuggerExits() {
    const outputs = [];
    const adapter = {
        sendOutput(category, output) {
            outputs.push({ category, output });
        },
        onTargetRunning() {},
        onTargetStopped() {},
        onDebuggerExit() {}
    };
    const session = new testApi.GdbSession(adapter);

    await withPatchedMethod(cp, "spawn", () => createFakeSpawnProcess({
        start(child) {
            setTimeout(() => {
                child.stdout.emit("data", Buffer.from("(gdb)\n"));
            }, 5);
        },
        onStdinWrite(text, child) {
            const tokenMatch = /^(\d+)/.exec(text);

            if (tokenMatch && text.indexOf("-exec-next") === -1) {
                child.stdout.emit("data", Buffer.from(`${tokenMatch[1]}^done\n`));
                child.stdout.emit("data", Buffer.from("(gdb)\n"));
            }
        }
    }), async () => {
        await session.start({
            gdbPath: "gdb",
            program: "demo.exe",
            cwd: process.cwd(),
            env: {},
            args: []
        });

        const pendingCommand = session.sendCommand("-exec-next");
        const rejectionCheck = assertRejectsWithMessage(
            () => pendingCommand,
            /GDB exited with code 1/
        );

        session.process.emit("exit", 1, null);

        await rejectionCheck;
    });

    assert.match(outputs.map((entry) => entry.output).join(""), /GDB exited with code 1/);
}

async function testAdapterAddsMacosGdbHintToErrors() {
    const connection = {
        send() {},
        start() {}
    };
    const adapter = new testApi.FreeBasicGdbAdapter(connection);

    await withTemporaryPlatform("darwin", async () => {
        adapter.launchArguments = {
            gdbPath: "/usr/local/bin/gdb"
        };

        const message = adapter.formatErrorMessage(new Error(
            "Unable to find Mach task port for process-id 12676: (os/kern) failure (0x5)."
        ));

        assert.match(message, /macOS blocked GDB/i);
        assert.match(message, /\/usr\/local\/bin\/gdb/);
    });
}

async function testRunOnlyFallbackBreakpointsUseGenericMessage() {
    const sentMessages = [];
    const connection = {
        send(message) {
            sentMessages.push(message);
        },
        start() {}
    };
    const adapter = new testApi.FreeBasicGdbAdapter(connection);

    adapter.runWithoutDebugger = true;

    await adapter.setBreakpointsRequest({
        seq: 22,
        command: "setBreakpoints"
    }, {
        source: {
            path: "demo.bas"
        },
        breakpoints: [
            { line: 12 }
        ]
    });

    const response = sentMessages.find((message) => (
        message.type === "response" && message.command === "setBreakpoints"
    ));

    assert.match(response.body.breakpoints[0].message, /without GDB/i);
}

module.exports = [
    testMiValueParserParsesTupleAndListValues,
    testParseMiLineHandlesResultAndConsoleRecords,
    testDapConnectionReadsAndWritesMessages,
    testResolveCompilerPathPrefersWindowsFbcExe,
    testResolveCompilerPathPrefersKnownMacosInstall,
    testResolveGdbPathFindsKnownWindowsInstall,
    testNormalizeHelpersProduceExpectedShapes,
    testBuildCompilerArgumentsAddsDebugAndOutput,
    testConsoleHelpersChooseExpectedDefaults,
    testCompileProgramSucceedsWithMockCompiler,
    testCompileProgramRejectsWithCompilerOutput,
    testGdbSessionStartWaitsForPromptAndSendsSetupCommands,
    testMapStopReasonAndExpandableValueHelpers,
    testGetMacosGdbSetupHintRecognizesTaskgatedFailure,
    testShouldUseTerminalForRunOnlyLaunchDetectsGuiSubsystem,
    testLaunchResponseIsSentBeforeConfigurationDone,
    testRunOnlyFallbackSkipsGdbStartup,
    testRunOnlyFallbackConfigurationDoneUsesRunInTerminal,
    testRunOnlyFallbackWindowedProgramSkipsRunInTerminal,
    testPrepareInferiorPresentationUsesRunInTerminalOnUnix,
    testPrepareInferiorPresentationUsesNewConsoleOnWindows,
    testGdbSessionRejectsPendingCommandsWhenDebuggerExits,
    testAdapterAddsMacosGdbHintToErrors,
    testRunOnlyFallbackBreakpointsUseGenericMessage
];

/* end of tests/adapter.unit.js */
