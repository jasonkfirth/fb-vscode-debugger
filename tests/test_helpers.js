/*
    Project: FreeBASIC Native Debugger
    ----------------------------------

    File: tests/test_helpers.js

    Purpose:

        Provide tiny reusable helpers for the unit harnesses.

    Responsibilities:

        - load extension modules with the VS Code stub injected
        - offer simple assertion helpers for async tests
        - isolate temporary platform and environment overrides

    This file intentionally does NOT contain:

        - individual test cases
        - extension logic
        - marketplace packaging behavior
*/

"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Module = require("module");
const events = require("events");

const vscodeStubPath = path.join(__dirname, "stubs", "vscode.js");

function loadModuleWithVscodeStub(modulePath) {
    const absoluteModulePath = path.resolve(modulePath);
    const originalLoad = Module._load;

    delete require.cache[absoluteModulePath];
    delete require.cache[vscodeStubPath];

    Module._load = function patchedLoad(request, parent, isMain) {
        if (request === "vscode")
            return require(vscodeStubPath);

        return originalLoad.call(this, request, parent, isMain);
    };

    try {
        return require(absoluteModulePath);
    } finally {
        Module._load = originalLoad;
    }
}

function withTemporaryEnv(overrides, fn) {
    const originalValues = {};

    for (const key of Object.keys(overrides)) {
        originalValues[key] = process.env[key];

        if (overrides[key] === null)
            delete process.env[key];
        else
            process.env[key] = overrides[key];
    }

    let maybePromise;

    try {
        maybePromise = fn();
    } finally {
        if (maybePromise && typeof maybePromise.then === "function") {
            return maybePromise.finally(() => {
                for (const key of Object.keys(overrides)) {
                    if (originalValues[key] === undefined)
                        delete process.env[key];
                    else
                        process.env[key] = originalValues[key];
                }
            });
        }

        for (const key of Object.keys(overrides)) {
            if (originalValues[key] === undefined)
                delete process.env[key];
            else
                process.env[key] = originalValues[key];
        }

        return maybePromise;
    }
}

function withTemporaryPlatform(platformName, fn) {
    const originalDescriptor = Object.getOwnPropertyDescriptor(process, "platform");

    Object.defineProperty(process, "platform", {
        value: platformName
    });

    let maybePromise;

    try {
        maybePromise = fn();
    } finally {
        if (maybePromise && typeof maybePromise.then === "function") {
            return maybePromise.finally(() => {
                Object.defineProperty(process, "platform", originalDescriptor);
            });
        }

        Object.defineProperty(process, "platform", originalDescriptor);
        return maybePromise;
    }
}

function withPatchedMethod(target, methodName, replacement, fn) {
    const originalMethod = target[methodName];

    target[methodName] = replacement;

    let maybePromise;

    try {
        maybePromise = fn();
    } finally {
        if (maybePromise && typeof maybePromise.then === "function") {
            return maybePromise.finally(() => {
                target[methodName] = originalMethod;
            });
        }

        target[methodName] = originalMethod;
        return maybePromise;
    }
}

function createTemporaryDirectory(prefix) {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function createFakeSpawnProcess(script) {
    const child = new events.EventEmitter();
    const stdout = new events.EventEmitter();
    const stderr = new events.EventEmitter();
    const stdinWrites = [];

    child.stdout = stdout;
    child.stderr = stderr;
    child.stdin = {
        writable: true,
        write(text) {
            stdinWrites.push(text);

            if (script && typeof script.onStdinWrite === "function")
                script.onStdinWrite(text, child);
        }
    };
    child.killed = false;
    child.exitCode = null;
    child.kill = function kill() {
        child.killed = true;
    };
    child.__emit = child.emit.bind(child);
    child.emit = function emit(eventName, ...args) {
        const didEmit = child.__emit(eventName, ...args);

        if (eventName === "exit")
            child.__emit("close", ...args);

        return didEmit;
    };

    if (script && typeof script.start === "function")
        process.nextTick(() => script.start(child));

    child.__stdinWrites = stdinWrites;

    return child;
}

async function assertRejectsWithMessage(promiseFactory, expectedPattern) {
    let didReject = false;

    try {
        await promiseFactory();
    } catch (error) {
        didReject = true;
        assert.match(String(error.message || error), expectedPattern);
    }

    if (!didReject)
        assert.fail("Expected promise rejection.");
}

module.exports = {
    assert,
    createFakeSpawnProcess,
    createTemporaryDirectory,
    loadModuleWithVscodeStub,
    withPatchedMethod,
    withTemporaryEnv,
    withTemporaryPlatform,
    assertRejectsWithMessage
};

/* end of tests/test_helpers.js */
