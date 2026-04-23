# Development Notes

This file keeps the package-development details out of the user-facing README.

## Local validation

Run the unit harness from the extension folder:

```sh
npm run test:unit
```

Run the syntax checks:

```sh
npm run lint
```

If `node` is not on `PATH`, you can still run the tests with VS Code's bundled
runtime.

## What is covered by the unit harness

- compiler lookup for `fbc`, `fbc.exe`, `fbc64.exe`, and Windows fallback paths
- GDB lookup for bundled tools, common platform paths, and plain `gdb`
- reduced-functionality fallback selection for missing GDB and macOS unsigned-GDB cases
- default `F5` launch configuration generation
- compiler argument construction, including `-g` and output naming
- FreeBASIC compile success and compile failure handling
- compiler error parsing into VS Code diagnostics
- DAP message framing and parsing
- GDB/MI record parsing
- initial GDB prompt detection and startup command flow
- Unix terminal integration and reduced-functionality fallback launching

The unit harness files are in `tests/extension.unit.js` and
`tests/adapter.unit.js`.

## Release and packaging

- The Marketplace package icon is built from the FreeBASIC horse artwork in
  `assets/`.
- Third-party attribution details are listed in `THIRD_PARTY_NOTICES.md`.
- Packaging exclusions are controlled by `.vscodeignore`.
- Marketplace-specific metadata can be filled in with
  `package.marketplace.template.json`.
- Exact packaging and publish commands are documented in `PUBLISHING.md`.
