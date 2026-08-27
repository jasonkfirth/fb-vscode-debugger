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

Audit the debugger assumptions against a FreeBASIC source checkout:

```sh
npm run audit:compiler -- --freebasic-root /path/to/fbc
```

If `--freebasic-root` is omitted, the audit checks `FREEBASIC_ROOT` and the
normal sibling checkout locations. A path ending in `src` is accepted and
normalized to the source-tree root.

Run the real VS Code extension-host smoke test on Linux:

```sh
FB_SMOKE_COMPILER=/path/to/fbc FB_SMOKE_GDB=/usr/bin/gdb npm run test:smoke:linux
```

The Bash launcher creates isolated VS Code user-data and extension folders,
removes inherited VS Code process identifiers, enforces a timeout, and prints
the relevant log tails on failure. Pass `-- --keep-artifacts-on-failure` to
preserve `.smoke-vscode` after a failed run.

If `node` is not on `PATH`, you can still run the tests with VS Code's bundled
runtime.

## What is covered by the unit harness

- compiler lookup for `fbc`, legacy `fbc.exe`, and known platform paths
- native Windows compiler selection for `fbc32.exe`, `fbc64.exe`, and
  `fbcarm64.exe`
- GDB lookup for bundled tools, common platform paths, and plain `gdb`
- reduced-functionality fallback selection for missing GDB and macOS unsigned-GDB cases
- default `F5` launch configuration generation
- compiler argument construction, including `-g` and output naming
- FreeBASIC compile success and compile failure handling
- current compiler error, warning-level, and promoted-warning parsing into VS
  Code diagnostics
- DAP message framing and parsing
- GDB/MI record parsing
- initial GDB prompt detection and startup command flow
- Unix terminal integration and reduced-functionality fallback launching
- compiler release-output parsing and the FreeBASIC 1.20.3 source audit

The unit harness files are in `tests/extension.unit.js` and
`tests/adapter.unit.js`.

The extension-host smoke sources are tracked under `tests/fixtures`. The
Windows PowerShell launchers and Linux Bash launcher use the same sources so
the platform tests exercise equivalent programs.

## Release and packaging

- The Marketplace package icon is built from the FreeBASIC horse artwork in
  `assets/`.
- Third-party attribution details are listed in `THIRD_PARTY_NOTICES.md`.
- Packaging exclusions are controlled by `.vscodeignore`.
- Marketplace-specific metadata can be filled in with
  `package.marketplace.template.json`.
- Exact packaging and publish commands are documented in `PUBLISHING.md`.
