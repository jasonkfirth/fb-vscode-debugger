/*
    Project: FreeBASIC Native Debugger
    ----------------------------------

    File: adapter/freebasicGdbDebug.js

    Purpose:

        Implement a small Debug Adapter Protocol server that compiles
        FreeBASIC code with debug symbols and drives GDB through the
        machine interface protocol.

    Responsibilities:

        - receive DAP requests from VS Code
        - compile the target FreeBASIC source file with -g
        - translate debugger actions into GDB/MI commands
        - expose breakpoints, stack frames, locals, stepping, and evaluation

    This file intentionally does NOT contain:

        - VS Code extension activation logic
        - editor command registration
        - language grammar or syntax highlighting
*/

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const cp = require("child_process");
const toolchainPaths = require("../lib/toolchainPaths");

/* ------------------------------------------------------------------------- */
/* Toolchain discovery                                                       */
/* ------------------------------------------------------------------------- */

const WINDOWS_COMPILER_CANDIDATES = toolchainPaths.WINDOWS_COMPILER_CANDIDATES;
const WINDOWS_GDB_CANDIDATES = toolchainPaths.WINDOWS_GDB_CANDIDATES;
const MACOS_GDB_CANDIDATES = toolchainPaths.MACOS_GDB_CANDIDATES;
const LINUX_GDB_CANDIDATES = toolchainPaths.LINUX_GDB_CANDIDATES;

/* ------------------------------------------------------------------------- */
/* DAP protocol transport                                                    */
/* ------------------------------------------------------------------------- */

class DapConnection {
    constructor(input, output) {
        this.input = input;
        this.output = output;
        this.inputBuffer = Buffer.alloc(0);
        this.contentLength = null;
        this.messageHandler = null;
    }

    start(messageHandler) {
        this.messageHandler = messageHandler;
        this.input.on("data", (chunk) => this.handleData(chunk));
    }

    send(message) {
        const payload = Buffer.from(JSON.stringify(message), "utf8");
        const header = Buffer.from(`Content-Length: ${payload.length}\r\n\r\n`, "ascii");

        this.output.write(header);
        this.output.write(payload);
    }

    handleData(chunk) {
        this.inputBuffer = Buffer.concat([this.inputBuffer, chunk]);

        while (true) {
            if (this.contentLength === null) {
                const separatorIndex = this.inputBuffer.indexOf("\r\n\r\n");

                if (separatorIndex === -1)
                    return;

                const headerText = this.inputBuffer.slice(0, separatorIndex).toString("ascii");
                const match = /Content-Length:\s*(\d+)/i.exec(headerText);

                if (!match)
                    throw new Error("DAP header is missing Content-Length.");

                this.contentLength = Number(match[1]);
                this.inputBuffer = this.inputBuffer.slice(separatorIndex + 4);
            }

            if (this.inputBuffer.length < this.contentLength)
                return;

            const messageBuffer = this.inputBuffer.slice(0, this.contentLength);
            const messageText = messageBuffer.toString("utf8");

            this.inputBuffer = this.inputBuffer.slice(this.contentLength);
            this.contentLength = null;

            if (this.messageHandler)
                this.messageHandler(JSON.parse(messageText));
        }
    }
}

/* ------------------------------------------------------------------------- */
/* GDB/MI parser                                                             */
/* ------------------------------------------------------------------------- */

class MiValueParser {
    constructor(text, index) {
        this.text = text;
        this.index = index || 0;
    }

    parseResultList() {
        const result = {};

        while (this.index < this.text.length) {
            const variable = this.readIdentifier();

            if (!variable)
                break;

            if (this.peek() !== "=")
                break;

            this.index++;
            result[variable] = this.parseValue();

            if (this.peek() === ",") {
                this.index++;
                continue;
            }

            break;
        }

        return result;
    }

    parseValue() {
        const current = this.peek();

        if (current === "\"")
            return this.parseCString();

        if (current === "{")
            return this.parseTuple();

        if (current === "[")
            return this.parseList();

        return this.readBareWord();
    }

    parseCString() {
        let value = "";

        this.expect("\"");

        while (this.index < this.text.length) {
            const current = this.text[this.index++];

            if (current === "\"")
                break;

            if (current === "\\") {
                const escaped = this.text[this.index++];

                switch (escaped) {
                case "n":
                    value += "\n";
                    break;
                case "r":
                    value += "\r";
                    break;
                case "t":
                    value += "\t";
                    break;
                case "\"":
                    value += "\"";
                    break;
                case "\\":
                    value += "\\";
                    break;
                default:
                    value += escaped;
                    break;
                }

                continue;
            }

            value += current;
        }

        return value;
    }

    parseTuple() {
        const result = {};

        this.expect("{");

        while (this.index < this.text.length) {
            if (this.peek() === "}") {
                this.index++;
                break;
            }

            const variable = this.readIdentifier();

            if (this.peek() !== "=")
                break;

            this.index++;
            result[variable] = this.parseValue();

            if (this.peek() === ",") {
                this.index++;
                continue;
            }
        }

        return result;
    }

    parseList() {
        const result = [];

        this.expect("[");

        while (this.index < this.text.length) {
            if (this.peek() === "]") {
                this.index++;
                break;
            }

            const startIndex = this.index;
            const variable = this.readIdentifier();

            if (variable && this.peek() === "=") {
                this.index++;
                const wrapper = {};
                wrapper[variable] = this.parseValue();
                result.push(wrapper);
            } else {
                this.index = startIndex;
                result.push(this.parseValue());
            }

            if (this.peek() === ",") {
                this.index++;
                continue;
            }
        }

        return result;
    }

    readIdentifier() {
        const start = this.index;

        while (this.index < this.text.length) {
            const current = this.text[this.index];

            if ((current >= "a" && current <= "z") ||
                (current >= "A" && current <= "Z") ||
                (current >= "0" && current <= "9") ||
                current === "_" ||
                current === "-") {
                this.index++;
                continue;
            }

            break;
        }

        return this.text.slice(start, this.index);
    }

    readBareWord() {
        const start = this.index;

        while (this.index < this.text.length) {
            const current = this.text[this.index];

            if (current === "," || current === "]" || current === "}")
                break;

            this.index++;
        }

        return this.text.slice(start, this.index);
    }

    peek() {
        return this.text[this.index];
    }

    expect(character) {
        if (this.text[this.index] !== character)
            throw new Error(`Expected '${character}' in MI parser.`);

        this.index++;
    }
}

function parseMiLine(line) {
    const trimmed = line.trim();

    if (!trimmed || trimmed === "(gdb)")
        return null;

    let index = 0;
    let token = "";

    while (index < trimmed.length) {
        const current = trimmed[index];

        if (current >= "0" && current <= "9") {
            token += current;
            index++;
            continue;
        }

        break;
    }

    const recordType = trimmed[index];
    const remainder = trimmed.slice(index + 1);

    if ("^*+=".indexOf(recordType) === -1) {
        if (recordType === "~" || recordType === "@" || recordType === "&") {
            const parser = new MiValueParser(remainder, 0);
            return {
                token,
                type: recordType,
                payload: parser.parseValue()
            };
        }

        return {
            token,
            type: "output",
            payload: trimmed
        };
    }

    const commaIndex = remainder.indexOf(",");
    const recordClass = commaIndex === -1 ? remainder : remainder.slice(0, commaIndex);
    const payloadText = commaIndex === -1 ? "" : remainder.slice(commaIndex + 1);
    const parser = new MiValueParser(payloadText, 0);

    return {
        token,
        type: recordType,
        className: recordClass,
        payload: payloadText ? parser.parseResultList() : {}
    };
}

/* ------------------------------------------------------------------------- */
/* GDB session                                                               */
/* ------------------------------------------------------------------------- */

class GdbSession {
    constructor(adapter) {
        this.adapter = adapter;
        this.process = null;
        this.stdoutBuffer = "";
        this.commandToken = 1;
        this.pendingCommands = new Map();
        this.readyPromise = null;
        this.readyResolved = false;
        this.readyResolver = null;
        this.readyRejecter = null;
        this.readyTimer = null;
    }

    async start(configuration) {
        const gdbPath = resolveGdbPath(configuration.gdbPath || "gdb");
        const gdbArguments = ["--interpreter=mi2", configuration.program];

        this.process = cp.spawn(gdbPath, gdbArguments, {
            cwd: configuration.cwd,
            env: mergeEnvironment(configuration.env),
            stdio: ["pipe", "pipe", "pipe"]
        });

        this.process.on("error", (error) => {
            this.adapter.sendOutput("stderr", `Unable to start GDB: ${error.message}\n`);
            this.rejectReadyPrompt(new Error(`Unable to start GDB: ${error.message}`));
            this.rejectPendingCommands(new Error(`GDB failed to start: ${error.message}`));
        });
        this.process.stdout.on("data", (chunk) => this.handleStdout(chunk));
        this.process.stderr.on("data", (chunk) => this.adapter.sendOutput("stderr", chunk.toString("utf8")));
        this.process.on("exit", (code, signal) => this.handleExit(code, signal));

        this.readyPromise = this.waitForReadyPrompt();
        await this.readyPromise;

        await this.sendCommand("-gdb-set breakpoint pending on");
        await this.sendCommand("-gdb-set print pretty on");
        await this.sendCommand("-gdb-set disassemble-next-line auto");
        await this.sendCommand(`-environment-cd ${escapeMiString(toGdbPath(configuration.cwd))}`);

        if (Array.isArray(configuration.args) && configuration.args.length > 0) {
            const escapedArguments = configuration.args
                .map((argument) => escapeMiString(argument))
                .join(" ");

            await this.sendCommand(`-exec-arguments ${escapedArguments}`);
        }
    }

    async stop() {
        if (!this.process)
            return;

        try {
            await this.sendCommand("-gdb-exit");
        } catch (_error) {
            /*
                If GDB is already gone, process termination below is enough.
            */
        }

        if (!this.process.killed)
            this.process.kill();
    }

    waitForReadyPrompt() {
        return new Promise((resolve, reject) => {
            this.readyResolver = resolve;
            this.readyRejecter = reject;

            this.readyTimer = setTimeout(() => {
                if (this.readyResolved)
                    return;

                this.rejectReadyPrompt(new Error("Timed out waiting for the initial GDB prompt."));
            }, 10000);
        });
    }

    handleStdout(chunk) {
        this.stdoutBuffer += chunk.toString("utf8");

        while (true) {
            const newlineIndex = this.stdoutBuffer.indexOf("\n");

            if (newlineIndex === -1)
                break;

            const rawLine = this.stdoutBuffer.slice(0, newlineIndex);
            this.stdoutBuffer = this.stdoutBuffer.slice(newlineIndex + 1);

            const line = rawLine.replace(/\r$/, "");

            if (line.trim() === "(gdb)") {
                this.resolveReadyPrompt();
                continue;
            }

            const record = parseMiLine(line);

            if (!record)
                continue;

            this.handleRecord(record);
        }
    }

    handleRecord(record) {
        if (record.type === "^") {
            const pending = this.pendingCommands.get(record.token);

            if (!pending)
                return;

            this.pendingCommands.delete(record.token);

            if (record.className === "error") {
                const message = record.payload.msg || "Unknown GDB error.";
                pending.reject(new Error(message));
                return;
            }

            pending.resolve(record);
            return;
        }

        if (record.type === "*") {
            this.handleAsyncRecord(record);
            return;
        }

        if (record.type === "~" || record.type === "@")
            this.adapter.sendOutput("stdout", String(record.payload || ""));

        if (record.type === "&")
            this.adapter.sendOutput("stderr", String(record.payload || ""));
    }

    handleAsyncRecord(record) {
        if (record.className === "running") {
            this.adapter.onTargetRunning();
            return;
        }

        if (record.className === "stopped") {
            this.adapter.onTargetStopped(record.payload || {});
        }
    }

    handleExit(code, signal) {
        const description = signal
            ? `GDB exited with signal ${signal}.`
            : `GDB exited with code ${code}.`;

        this.rejectReadyPrompt(new Error(description));
        this.rejectPendingCommands(new Error(description));
        this.adapter.sendOutput("stderr", `${description}\n`);
        this.adapter.onDebuggerExit(code, signal);
    }

    resolveReadyPrompt() {
        if (this.readyResolved)
            return;

        this.readyResolved = true;
        this.clearReadyTimer();

        if (this.readyResolver)
            this.readyResolver();
    }

    rejectReadyPrompt(error) {
        if (this.readyResolved)
            return;

        this.readyResolved = true;
        this.clearReadyTimer();

        if (this.readyRejecter)
            this.readyRejecter(error);
    }

    clearReadyTimer() {
        if (!this.readyTimer)
            return;

        clearTimeout(this.readyTimer);
        this.readyTimer = null;
    }

    rejectPendingCommands(error) {
        const pendingEntries = Array.from(this.pendingCommands.values());

        this.pendingCommands.clear();

        for (const pending of pendingEntries)
            pending.reject(error);
    }

    sendCommand(command) {
        if (!this.process || !this.process.stdin.writable)
            return Promise.reject(new Error("GDB is not running."));

        const token = String(this.commandToken++);

        return new Promise((resolve, reject) => {
            this.pendingCommands.set(token, { resolve, reject });
            this.process.stdin.write(`${token}${command}\n`, "utf8");
        });
    }
}

/* ------------------------------------------------------------------------- */
/* Debug adapter core                                                        */
/* ------------------------------------------------------------------------- */

class FreeBasicGdbAdapter {
    constructor(connection) {
        this.connection = connection;
        this.sequence = 1;
        this.gdb = null;
        this.launched = false;
        this.lastStopFrame = null;
        this.variableHandles = new Map();
        this.nextVariableReference = 1000;
        this.breakpointsBySource = new Map();
        this.terminatedSent = false;
        this.exitedSent = false;
    }

    start() {
        this.connection.start((message) => this.handleMessage(message));
    }

    sendResponse(request, body) {
        traceAdapter(`response ${request.command} success`);
        this.connection.send({
            seq: this.sequence++,
            type: "response",
            request_seq: request.seq,
            success: true,
            command: request.command,
            body: body || {}
        });
    }

    sendErrorResponse(request, error) {
        traceAdapter(`response ${request.command} error: ${error.message || String(error)}`);
        this.connection.send({
            seq: this.sequence++,
            type: "response",
            request_seq: request.seq,
            success: false,
            command: request.command,
            message: error.message || String(error)
        });
    }

    sendEvent(event, body) {
        traceAdapter(`event ${event}`);
        this.connection.send({
            seq: this.sequence++,
            type: "event",
            event,
            body: body || {}
        });
    }

    sendOutput(category, output) {
        this.sendEvent("output", {
            category,
            output
        });
    }

    async handleMessage(message) {
        if (message.type !== "request")
            return;

        traceAdapter(`request ${message.command}`);
        const handlerName = `${message.command}Request`;

        if (typeof this[handlerName] !== "function") {
            this.sendErrorResponse(message, new Error(`Unsupported request: ${message.command}`));
            return;
        }

        try {
            await this[handlerName](message, message.arguments || {});
        } catch (error) {
            this.sendErrorResponse(message, error);
        }
    }

    /* --------------------------------------------------------------------- */
    /* DAP request handlers                                                  */
    /* --------------------------------------------------------------------- */

    async initializeRequest(request) {
        this.sendResponse(request, {
            supportsConfigurationDoneRequest: true,
            supportsEvaluateForHovers: true,
            supportsStepBack: false,
            supportsRestartRequest: false
        });
    }

    async launchRequest(request, args) {
        validateLaunchArguments(args);
        this.terminatedSent = false;
        this.exitedSent = false;

        if (!args.skipBuild) {
            this.sendOutput("console", `Compiling ${args.sourceFile}\n`);
            await compileProgram(args);
        }

        this.sendOutput("console", `Launching ${args.program} with GDB\n`);

        this.gdb = new GdbSession(this);
        await this.gdb.start(args);

        this.launchArguments = args;
        this.launched = true;
        this.sendEvent("initialized");
        this.sendResponse(request);
    }

    async configurationDoneRequest(request) {
        ensureSession(this.gdb);

        if (this.launchArguments.stopAtEntry)
            await this.gdb.sendCommand("-exec-run --start");
        else
            await this.gdb.sendCommand("-exec-run");

        this.sendResponse(request);
    }

    async setBreakpointsRequest(request, args) {
        ensureSession(this.gdb);

        const sourcePath = normalizeSourcePath(args.source && args.source.path);
        const requestedBreakpoints = Array.isArray(args.breakpoints) ? args.breakpoints : [];
        const previousBreakpoints = this.breakpointsBySource.get(sourcePath) || [];

        for (const breakpointId of previousBreakpoints)
            await this.gdb.sendCommand(`-break-delete ${breakpointId}`);

        const gdbBreakpointIds = [];
        const verifiedBreakpoints = [];

        for (const breakpoint of requestedBreakpoints) {
            const line = Number(breakpoint.line);
            const escapedLocation = escapeMiString(`${sourcePath}:${line}`);
            const response = await this.gdb.sendCommand(`-break-insert ${escapedLocation}`);
            const breakpointRecord = response.payload.bkpt || {};
            const gdbBreakpointId = breakpointRecord.number || null;

            if (gdbBreakpointId)
                gdbBreakpointIds.push(gdbBreakpointId);

            verifiedBreakpoints.push({
                id: gdbBreakpointId ? Number(gdbBreakpointId) : undefined,
                verified: Boolean(gdbBreakpointId),
                line
            });
        }

        this.breakpointsBySource.set(sourcePath, gdbBreakpointIds);

        this.sendResponse(request, {
            breakpoints: verifiedBreakpoints
        });
    }

    async threadsRequest(request) {
        this.sendResponse(request, {
            threads: [
                {
                    id: 1,
                    name: "Main Thread"
                }
            ]
        });
    }

    async stackTraceRequest(request, args) {
        ensureSession(this.gdb);

        const response = await this.gdb.sendCommand("-stack-list-frames");
        const stack = normalizeMiArray(response.payload.stack);
        const stackFrames = [];

        for (const entry of stack) {
            const frame = entry.frame || entry;
            const frameId = Number(frame.level || stackFrames.length);
            const frameLine = Number(frame.line || 0);
            const framePath = frame.fullname || frame.file || this.launchArguments.sourceFile;

            stackFrames.push({
                id: frameId,
                name: frame.func || "<unknown>",
                line: frameLine > 0 ? frameLine : 1,
                column: 1,
                source: {
                    name: path.basename(framePath),
                    path: framePath
                }
            });
        }

        const startFrame = Number(args.startFrame || 0);
        const levels = Number(args.levels || stackFrames.length);
        const slicedFrames = stackFrames.slice(startFrame, startFrame + levels);

        this.sendResponse(request, {
            stackFrames: slicedFrames,
            totalFrames: stackFrames.length
        });
    }

    async scopesRequest(request, args) {
        ensureSession(this.gdb);

        const frameId = Number(args.frameId || 0);
        const variableReference = this.createVariableHandle({
            kind: "locals",
            frameId
        });

        this.sendResponse(request, {
            scopes: [
                {
                    name: "Locals",
                    presentationHint: "locals",
                    expensive: false,
                    variablesReference: variableReference
                }
            ]
        });
    }

    async variablesRequest(request, args) {
        ensureSession(this.gdb);

        const handle = this.variableHandles.get(Number(args.variablesReference));

        if (!handle)
            throw new Error("Unknown variable reference.");

        if (handle.kind === "locals") {
            const variables = await this.listFrameVariables(handle.frameId);
            this.sendResponse(request, { variables });
            return;
        }

        if (handle.kind === "children") {
            const variables = await this.listChildVariables(handle.expression, handle.frameId);
            this.sendResponse(request, { variables });
            return;
        }

        throw new Error("Unsupported variable handle.");
    }

    async continueRequest(request) {
        ensureSession(this.gdb);
        await this.gdb.sendCommand("-exec-continue");
        this.sendResponse(request, {
            allThreadsContinued: true
        });
    }

    async nextRequest(request) {
        ensureSession(this.gdb);
        await this.gdb.sendCommand("-exec-next");
        this.sendResponse(request);
    }

    async stepInRequest(request) {
        ensureSession(this.gdb);
        await this.gdb.sendCommand("-exec-step");
        this.sendResponse(request);
    }

    async stepOutRequest(request) {
        ensureSession(this.gdb);
        await this.gdb.sendCommand("-exec-finish");
        this.sendResponse(request);
    }

    async pauseRequest(request) {
        ensureSession(this.gdb);
        await this.gdb.sendCommand("-exec-interrupt");
        this.sendResponse(request);
    }

    async evaluateRequest(request, args) {
        ensureSession(this.gdb);

        if (typeof args.frameId === "number")
            await this.gdb.sendCommand(`-stack-select-frame ${args.frameId}`);

        const expression = String(args.expression || "").trim();

        if (!expression) {
            this.sendResponse(request, {
                result: "",
                variablesReference: 0
            });
            return;
        }

        const response = await this.gdb.sendCommand(
            `-data-evaluate-expression ${escapeMiString(expression)}`
        );

        const resultValue = response.payload.value || "";
        const variablesReference = shouldTryExpandValue(resultValue)
            ? this.createVariableHandle({
                kind: "children",
                expression,
                frameId: typeof args.frameId === "number" ? args.frameId : 0
            })
            : 0;

        this.sendResponse(request, {
            result: String(resultValue),
            variablesReference
        });
    }

    async disconnectRequest(request) {
        if (this.gdb)
            await this.gdb.stop();

        this.sendResponse(request);
        process.exit(0);
    }

    /* --------------------------------------------------------------------- */
    /* Variable support                                                      */
    /* --------------------------------------------------------------------- */

    createVariableHandle(handle) {
        const reference = this.nextVariableReference++;

        this.variableHandles.set(reference, handle);

        return reference;
    }

    async listFrameVariables(frameId) {
        await this.gdb.sendCommand(`-stack-select-frame ${frameId}`);

        const response = await this.gdb.sendCommand("-stack-list-variables --all-values");
        const variables = normalizeMiArray(response.payload.variables);
        const results = [];

        for (const entry of variables) {
            const variable = entry.name ? entry : entry.var || entry;
            const name = variable.name || "<unnamed>";
            const value = variable.value !== undefined ? String(variable.value) : "<not available>";
            const variablesReference = shouldTryExpandValue(value)
                ? this.createVariableHandle({
                    kind: "children",
                    expression: name,
                    frameId
                })
                : 0;

            results.push({
                name,
                value,
                type: variable.type || "",
                variablesReference
            });
        }

        return results;
    }

    async listChildVariables(expression, frameId) {
        await this.gdb.sendCommand(`-stack-select-frame ${frameId}`);

        const response = await this.gdb.sendCommand(
            `-var-create - * ${escapeMiString(expression)}`
        );
        const variableName = response.payload.name;

        if (!variableName)
            return [];

        const childrenResponse = await this.gdb.sendCommand(
            `-var-list-children --all-values ${escapeMiString(variableName)}`
        );
        const children = normalizeMiArray(childrenResponse.payload.children);
        const results = [];

        for (const entry of children) {
            const child = entry.child || entry;
            const childName = child.exp || child.name || "<child>";
            const childValue = child.value !== undefined ? String(child.value) : "<not available>";
            const nestedReference = shouldTryExpandValue(childValue)
                ? this.createVariableHandle({
                    kind: "children",
                    expression: childName,
                    frameId
                })
                : 0;

            results.push({
                name: childName,
                value: childValue,
                type: child.type || "",
                variablesReference: nestedReference
            });
        }

        return results;
    }

    /* --------------------------------------------------------------------- */
    /* GDB lifecycle events                                                  */
    /* --------------------------------------------------------------------- */

    onTargetRunning() {
        this.sendEvent("continued", {
            threadId: 1,
            allThreadsContinued: true
        });
    }

    onTargetStopped(payload) {
        if (isTargetExitReason(payload.reason)) {
            this.onTargetExited(payload);
            return;
        }

        const reason = mapStopReason(payload.reason);
        const frame = payload.frame || {};

        this.lastStopFrame = frame;
        this.variableHandles.clear();
        this.nextVariableReference = 1000;

        this.sendEvent("stopped", {
            reason,
            threadId: Number(payload["thread-id"] || 1),
            allThreadsStopped: true
        });
    }

    onTargetExited(payload) {
        this.sendExitedEvent(extractExitCode(payload));
        this.sendTerminatedEvent();
    }

    onDebuggerExit(_code, _signal) {
        this.sendTerminatedEvent();
    }

    sendTerminatedEvent() {
        if (this.terminatedSent)
            return;

        this.terminatedSent = true;
        this.sendEvent("terminated");
    }

    sendExitedEvent(exitCode) {
        if (this.exitedSent)
            return;

        this.exitedSent = true;
        this.sendEvent("exited", {
            exitCode
        });
    }
}

/* ------------------------------------------------------------------------- */
/* Utility helpers                                                           */
/* ------------------------------------------------------------------------- */

function ensureSession(gdbSession) {
    if (!gdbSession)
        throw new Error("The GDB session has not been started.");
}

function validateLaunchArguments(args) {
    const requiredFields = ["sourceFile", "program", "cwd", "compilerPath"];

    for (const field of requiredFields) {
        if (!args[field])
            throw new Error(`Missing required launch property '${field}'.`);
    }
}

function fileExists(filePath) {
    try {
        return fs.existsSync(filePath);
    } catch (_error) {
        return false;
    }
}

function resolveCompilerPath(compilerPath) {
    const requestedPath = String(compilerPath || "").trim();
    const isWindows = process.platform === "win32";

    if (requestedPath.indexOf(path.sep) !== -1 || requestedPath.indexOf("/") !== -1)
        return requestedPath;

    if (!isWindows)
        return requestedPath || "fbc";

    if (requestedPath.toLowerCase() === "fbc.exe" || requestedPath.toLowerCase() === "fbc") {
        for (const candidatePath of WINDOWS_COMPILER_CANDIDATES) {
            if (candidatePath.toLowerCase().indexOf("fbc.exe") !== -1 && fileExists(candidatePath))
                return candidatePath;
        }
    }

    if (requestedPath.toLowerCase() === "fbc64.exe") {
        for (const candidatePath of WINDOWS_COMPILER_CANDIDATES) {
            if (candidatePath.toLowerCase().indexOf("fbc64.exe") !== -1 && fileExists(candidatePath))
                return candidatePath;
        }
    }

    if (requestedPath.toLowerCase() === "fbc32.exe") {
        for (const candidatePath of WINDOWS_COMPILER_CANDIDATES) {
            if (candidatePath.toLowerCase().indexOf("fbc32.exe") !== -1 && fileExists(candidatePath))
                return candidatePath;
        }
    }

    for (const candidatePath of WINDOWS_COMPILER_CANDIDATES) {
        if (fileExists(candidatePath))
            return candidatePath;
    }

    return requestedPath || "fbc";
}

function getBundledGdbCandidates() {
    return toolchainPaths.getBundledGdbCandidates(path.join(__dirname, ".."), process.platform);
}

function resolveGdbPath(gdbPath) {
    const requestedPath = String(gdbPath || "").trim();

    if (requestedPath.indexOf(path.sep) !== -1 || requestedPath.indexOf("/") !== -1)
        return requestedPath;

    for (const candidatePath of getBundledGdbCandidates()) {
        if (fileExists(candidatePath))
            return candidatePath;
    }

    if (process.platform === "win32") {
        for (const candidatePath of WINDOWS_GDB_CANDIDATES) {
            if (fileExists(candidatePath))
                return candidatePath;
        }
    } else if (process.platform === "darwin") {
        for (const candidatePath of MACOS_GDB_CANDIDATES) {
            if (fileExists(candidatePath))
                return candidatePath;
        }
    } else {
        for (const candidatePath of LINUX_GDB_CANDIDATES) {
            if (fileExists(candidatePath))
                return candidatePath;
        }
    }

    return requestedPath || "gdb";
}

function normalizeMiArray(value) {
    if (!value)
        return [];

    if (Array.isArray(value))
        return value;

    return [value];
}

function normalizeSourcePath(sourcePath) {
    if (!sourcePath)
        throw new Error("Breakpoint request is missing the source path.");

    return toGdbPath(path.normalize(sourcePath));
}

function mergeEnvironment(customEnvironment) {
    const environment = Object.assign({}, process.env);

    for (const key of Object.keys(customEnvironment || {}))
        environment[key] = String(customEnvironment[key]);

    return environment;
}

function toGdbPath(filePath) {
    return String(filePath).replace(/\\/g, "/");
}

function buildCompilerArguments(args) {
    const compilerArguments = [];
    const extraArguments = Array.isArray(args.compilerArgs) ? args.compilerArgs.slice() : [];
    let hasDebugFlag = false;
    let hasOutputFlag = false;

    for (const argument of extraArguments) {
        if (argument === "-g")
            hasDebugFlag = true;

        if (argument === "-x")
            hasOutputFlag = true;

        compilerArguments.push(argument);
    }

    if (!hasDebugFlag)
        compilerArguments.push("-g");

    compilerArguments.push(args.sourceFile);

    if (!hasOutputFlag) {
        compilerArguments.push("-x");
        compilerArguments.push(args.program);
    }

    return compilerArguments;
}

function compileProgram(args) {
    return new Promise((resolve, reject) => {
        const compilerPath = resolveCompilerPath(args.compilerPath);
        const compilerArguments = buildCompilerArguments(args);
        const environment = mergeEnvironment(args.env);
        let settled = false;

        const compiler = cp.spawn(compilerPath, compilerArguments, {
            cwd: args.cwd,
            env: environment,
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
            reject(new Error(`Unable to start FreeBASIC compiler: ${error.message}`));
        });

        compiler.on("close", (code) => {
            if (settled)
                return;

            settled = true;
            if (code !== 0) {
                const compilerOutput = [stdoutText, stderrText]
                    .filter((text) => Boolean(text))
                    .join("\n")
                    .trim();
                const detail = compilerOutput ? `\n${compilerOutput}` : "";

                reject(new Error(`FreeBASIC compilation failed with exit code ${code}.${detail}`));
                return;
            }

            if (!fs.existsSync(args.program)) {
                reject(new Error(
                    `Compilation completed but '${args.program}' was not created.`
                ));
                return;
            }

            resolve();
        });
    });
}

function escapeMiString(text) {
    return `"${String(text)
        .replace(/\\/g, "\\\\")
        .replace(/"/g, "\\\"")}"`;
}

function mapStopReason(reason) {
    switch (reason) {
    case "breakpoint-hit":
        return "breakpoint";
    case "end-stepping-range":
        return "step";
    case "function-finished":
        return "step";
    case "signal-received":
        return "exception";
    default:
        return "pause";
    }
}

function isTargetExitReason(reason) {
    return reason === "exited" ||
        reason === "exited-normally" ||
        reason === "exited-signalled";
}

function extractExitCode(payload) {
    const exitCodeText = payload ? payload["exit-code"] : undefined;
    const parsedExitCode = Number(exitCodeText);

    if (Number.isFinite(parsedExitCode))
        return parsedExitCode;

    return 0;
}

function shouldTryExpandValue(value) {
    if (!value)
        return false;

    return value.indexOf("{") !== -1 || value.indexOf("[") !== -1;
}

function getTraceLogPath() {
    if (process.env.FREEBASIC_DEBUG_LOG)
        return process.env.FREEBASIC_DEBUG_LOG;

    return path.join(os.tmpdir(), "freebasic-native-debugger.log");
}

function traceAdapter(message) {
    const line = `${new Date().toISOString()} ${message}\n`;

    try {
        fs.appendFileSync(getTraceLogPath(), line, "utf8");
    } catch (_error) {
        /*
            Tracing is best-effort only and must never interfere with
            the debugging session itself.
        */
    }
}

/* ------------------------------------------------------------------------- */
/* Adapter entry point                                                       */
/* ------------------------------------------------------------------------- */

if (require.main === module) {
    const connection = new DapConnection(process.stdin, process.stdout);
    const adapter = new FreeBasicGdbAdapter(connection);

    adapter.start();
}

module.exports = {
    __test: {
        DapConnection,
        MiValueParser,
        parseMiLine,
        GdbSession,
        FreeBasicGdbAdapter,
        ensureSession,
        validateLaunchArguments,
        fileExists,
        resolveCompilerPath,
        getBundledGdbCandidates,
        resolveGdbPath,
        normalizeMiArray,
        normalizeSourcePath,
        mergeEnvironment,
        toGdbPath,
        buildCompilerArguments,
        compileProgram,
        escapeMiString,
        mapStopReason,
        isTargetExitReason,
        extractExitCode,
        shouldTryExpandValue,
        getTraceLogPath,
        traceAdapter
    }
};

/* end of adapter/freebasicGdbDebug.js */
