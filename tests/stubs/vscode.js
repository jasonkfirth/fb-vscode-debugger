/*
    Project: FreeBASIC Native Debugger
    ----------------------------------

    File: tests/stubs/vscode.js

    Purpose:

        Provide a tiny VS Code API stub so unit harnesses can load the
        extension module under a plain Node runtime.

    Responsibilities:

        - supply the VS Code surface used by extension.js helper code
        - record diagnostics and user-facing messages for assertions

    This file intentionally does NOT contain:

        - a complete VS Code API implementation
        - debug adapter protocol behavior
        - extension host lifecycle logic
*/

"use strict";

class Range {
    constructor(startLine, startCharacter, endLine, endCharacter) {
        this.start = {
            line: startLine,
            character: startCharacter
        };
        this.end = {
            line: endLine,
            character: endCharacter
        };
    }
}

class Diagnostic {
    constructor(range, message, severity) {
        this.range = range;
        this.message = message;
        this.severity = severity;
        this.source = "";
        this.code = "";
    }
}

class DiagnosticCollection {
    constructor(name) {
        this.name = name;
        this.entries = new Map();
    }

    set(uri, diagnostics) {
        this.entries.set(uri.fsPath, diagnostics);
    }

    delete(uri) {
        this.entries.delete(uri.fsPath);
    }

    dispose() {
        this.entries.clear();
    }
}

class OutputChannel {
    constructor(name) {
        this.name = name;
        this.lines = [];
        this.wasShown = false;
    }

    appendLine(text) {
        this.lines.push(text);
    }

    show() {
        this.wasShown = true;
    }

    dispose() {
        this.lines.length = 0;
    }
}

const state = {
    activeTextEditor: null,
    messages: [],
    commands: [],
    settings: {},
    diagnosticCollections: [],
    outputChannels: []
};

function createConfiguration(section) {
    const sectionValues = state.settings[section] || {};

    return {
        get(name, defaultValue) {
            return Object.prototype.hasOwnProperty.call(sectionValues, name)
                ? sectionValues[name]
                : defaultValue;
        }
    };
}

const vscode = {
    Diagnostic,
    DiagnosticSeverity: {
        Error: 0,
        Warning: 1
    },
    Range,
    Uri: {
        file(fsPath) {
            return { fsPath };
        }
    },
    languages: {
        createDiagnosticCollection(name) {
            const collection = new DiagnosticCollection(name);

            state.diagnosticCollections.push(collection);

            return collection;
        }
    },
    workspace: {
        getConfiguration(section) {
            return createConfiguration(section);
        }
    },
    window: {
        get activeTextEditor() {
            return state.activeTextEditor;
        },
        set activeTextEditor(value) {
            state.activeTextEditor = value;
        },
        showErrorMessage(message) {
            state.messages.push(message);
        },
        createOutputChannel(name) {
            const outputChannel = new OutputChannel(name);

            state.outputChannels.push(outputChannel);

            return outputChannel;
        }
    },
    commands: {
        executeCommand(command) {
            state.commands.push(command);

            return Promise.resolve();
        }
    },
    debug: {
        registerDebugConfigurationProvider() {
            return { dispose() {} };
        },
        registerDebugAdapterTrackerFactory() {
            return { dispose() {} };
        },
        startDebugging() {
            return Promise.resolve(true);
        }
    },
    __state: state,
    __reset() {
        state.activeTextEditor = null;
        state.messages.length = 0;
        state.commands.length = 0;
        state.diagnosticCollections.length = 0;
        state.outputChannels.length = 0;
        state.settings = {};
    }
};

module.exports = vscode;

/* end of tests/stubs/vscode.js */
