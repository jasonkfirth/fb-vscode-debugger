/*
    Project: FreeBASIC Native Debugger
    ----------------------------------

    File: tests/run_unit_tests.js

    Purpose:

        Run the unit-style harnesses for the extension and adapter modules
        under a plain Node runtime.

    Responsibilities:

        - load each test module
        - run every exported test case sequentially
        - print a concise pass/fail summary
        - exit non-zero when any assertion fails

    This file intentionally does NOT contain:

        - test case logic
        - VS Code extension host startup
        - marketplace publishing behavior
*/

"use strict";

const path = require("path");

const suites = [
    {
        name: "extension",
        tests: require(path.join(__dirname, "extension.unit.js"))
    },
    {
        name: "adapter",
        tests: require(path.join(__dirname, "adapter.unit.js"))
    }
];

async function run() {
    let passed = 0;

    for (const suite of suites) {
        for (const testFunction of suite.tests) {
            const label = `${suite.name}:${testFunction.name}`;

            try {
                await testFunction();
                passed++;
                console.log(`PASS ${label}`);
            } catch (error) {
                console.error(`FAIL ${label}`);
                console.error(error && error.stack ? error.stack : String(error));
                process.exit(1);
            }
        }
    }

    console.log(`SUMMARY ${passed} tests passed`);
}

run().catch((error) => {
    console.error(error && error.stack ? error.stack : String(error));
    process.exit(1);
});

/* end of tests/run_unit_tests.js */
