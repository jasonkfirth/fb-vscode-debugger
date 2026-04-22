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

async function testCompileProgramSucceedsWithMockCompiler() {
    const tempDirectory = createTemporaryDirectory("fb-adapter-");
    const outputProgram = path.join(tempDirectory, "demo.exe");

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

module.exports = [
    testMiValueParserParsesTupleAndListValues,
    testParseMiLineHandlesResultAndConsoleRecords,
    testDapConnectionReadsAndWritesMessages,
    testResolveCompilerPathPrefersWindowsFbcExe,
    testResolveGdbPathFindsKnownWindowsInstall,
    testNormalizeHelpersProduceExpectedShapes,
    testBuildCompilerArgumentsAddsDebugAndOutput,
    testCompileProgramSucceedsWithMockCompiler,
    testCompileProgramRejectsWithCompilerOutput,
    testGdbSessionStartWaitsForPromptAndSendsSetupCommands,
    testMapStopReasonAndExpandableValueHelpers
];

/* end of tests/adapter.unit.js */
