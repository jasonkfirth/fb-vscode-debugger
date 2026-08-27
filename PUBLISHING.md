# Publishing Guide

The checked-in manifest contains the Marketplace publisher metadata. Use
`package.marketplace.template.json` as a compact reference when release fields
need to be reviewed.

## Before packaging

1. Confirm that `package.json` and `package.marketplace.template.json` both use
   version `1.20.3` and the intended publisher.
2. Confirm the repository, homepage, and issue tracker URLs.
3. Make sure the icon, README, changelog, license, and third-party notices are
   all in their final form.

## Install packaging tools

```sh
npm install -g @vscode/vsce
```

## Validate the extension package contents

```sh
npm run lint
npm run audit:compiler -- --freebasic-root /path/to/fbc
npm run package:vsix
```

This creates a `.vsix` package in the repository root.

## Install the packaged extension locally

```sh
code --install-extension ./freebasic-native-debugger-1.20.3.vsix --force
```

## Publish to the Marketplace

Login is handled through `vsce`. You will need a publisher and a Personal
Access Token with Marketplace publishing rights.

Common publish commands:

```sh
npm run publish:manual
```

Version bump helpers:

```sh
npm run publish:patch
npm run publish:minor
npm run publish:major
```

## Pre-release packages

```sh
npm run package:pre-release
```

## Recommended release checklist

- `npm run lint` passes
- `npm run audit:compiler` passes against the release source
- `npm run test:unit` passes
- the Linux extension-host smoke test passes when preparing a Linux package
- local `.vsix` installs cleanly
- compiler discovery works with `fbc`, `fbc32.exe`, `fbc64.exe`, and
  `fbcarm64.exe` as applicable
- missing-tool messages are readable
- compile failures appear in Problems
- launch, run, and basic stepping work on a real `.bas` file
- README screenshots and wording match the shipped behavior
